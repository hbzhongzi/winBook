import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask, PDFPageProxy } from "pdfjs-dist";
import { base64ToUint8Array } from "../utils/base64";
import type { ReaderMode } from "../utils/settings";
import { setReaderCommandHandler, scrollStepFor } from "../utils/readerCommands";
import type { ReadingPosition, PositionReport } from "../utils/library";

// worker 方案 A（主选）：Vite 打包期解析；文件名以 node_modules/pdfjs-dist/build 实际结果为准
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const SCALE = 1.2; // 默认缩放比例（与原文档 6.3 一致）
const BUFFER = 2; // 连续滚动模式前后缓冲页数（虚拟化）
const ESTIMATE_H = 800; // 未测量页的估算高度，仅供滚动条占位

type Props = {
  dataBase64: string;
  /** 阅读模式：page=单页翻页（默认），scroll=连续滚动（虚拟化） */
  mode: ReaderMode;
  /** 恢复页码：打开时跳转到书架的记录页（越界钳制到 [1, numPages]） */
  initialPage?: number;
  /**
   * 同步取位置注册位：App 在离场节点（退出软件/点击书架/切书）flush 时
   * 调用取当前页码（翻页即写已取消，改由离场时同步取；卸载置回 null）。
   */
  getterRef?: MutableRefObject<(() => PositionReport | null) | null>;
  /** 首页渲染完成（或解析失败）：App 淡出加载遮罩 */
  onReady?: () => void;
};

export default function PdfViewer({ dataBase64, mode, initialPage, getterRef, onReady }: Props) {
  const isScroll = mode === "scroll"; // true=连续滚动；false=单页翻页（默认）
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // 首渲完成只通知一次（翻页不再触发）
  const readyFiredRef = useRef(false);
  const fireReady = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, []);
  const [pageCount, setPageCount] = useState(0);
  const [failed, setFailed] = useState(false);

  // ===== 单页翻页模式 =====
  const [current, setCurrent] = useState(1);

  // ===== 连续滚动模式 =====
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<number[]>([]); // 各页真实高度（懒测量）
  const [heights, setHeights] = useState<number[]>([]); // 触发重排
  const estimateRef = useRef<number>(ESTIMATE_H);
  const [win, setWin] = useState<{ min: number; max: number }>({ min: 0, max: 0 });
  const winRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });
  const visibleRef = useRef<Set<number>>(new Set());
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageCacheRef = useRef<Map<number, PDFPageProxy>>(new Map());
  const [scrollCurrent, setScrollCurrent] = useState(1);
  const scrollCurrentRef = useRef(1);
  const scrollCurrentRef_set = (n: number) => {
    scrollCurrentRef.current = n;
    setScrollCurrent(n);
  };
  // 已渲染页集合（连续滚动虚拟化）：fresh canvas 默认 300×150 而非 0×0，
  // 不能用尺寸判「未渲染」（D52：原 canvas.width===0 守卫恒假 → 滚动模式全空白）；
  // 释放页时移出集合，重入窗口时重新渲染。
  const renderedRef = useRef<Set<number>>(new Set());
  // 初始恢复：章节级（页级）定位，待真实高度回填后重新置顶目标页
  const initialRecoverRef = useRef<{ active: boolean; target: number } | null>(null);

  // 阅读命令注册（v0.2.5 F22/F24）：window 级快捷键经 readerCommands 槽位派达到本 Viewer。
  // 单页模式：prev/next/home/end 映射页码；滚动模式：方向键微滚、翻页键整屏（D46）。
  useEffect(() => {
    if (isScroll) {
      setReaderCommandHandler((action, key) => {
        const root = scrollRef.current;
        if (!root) return false;
        if (action === "home") {
          root.scrollTo({ top: 0 });
          return true;
        }
        if (action === "end") {
          root.scrollTo({ top: root.scrollHeight });
          return true;
        }
        const step = scrollStepFor(key, root.clientHeight);
        root.scrollBy({ top: action === "prev" ? -step : step });
        return true;
      });
    } else {
      setReaderCommandHandler((action) => {
        if (pageCount <= 0) return false;
        if (action === "prev") {
          setCurrent((p) => Math.max(1, p - 1));
          return true;
        }
        if (action === "next") {
          setCurrent((p) => Math.min(pageCount, p + 1));
          return true;
        }
        if (action === "home") {
          setCurrent(1);
          return true;
        }
        setCurrent(pageCount);
        return true;
      });
    }
    return () => setReaderCommandHandler(null);
  }, [isScroll, pageCount]);

  const cancelRenderTask = useCallback(() => {
    const task = renderTaskRef.current;
    renderTaskRef.current = null;
    if (!task) return;
    try {
      task.cancel();
    } catch {
      // 已完成/已取消的任务再取消时忽略
    }
  }, []);

  /** 累计偏移：第 idx 页（0-based）顶部相对滚动容器顶部的距离 */
  const cumulativeTop = useCallback((idx: number): number => {
    const h = heightsRef.current;
    let sum = 0;
    for (let i = 0; i < idx; i++) sum += h[i] || estimateRef.current;
    return sum;
  }, []);

  /** 根据 scrollTop 求当前可见首页（连续滚动模式） */
  const pageAtScroll = useCallback(
    (top: number): number => {
      const h = heightsRef.current;
      let sum = 0;
      for (let i = 0; i < pageCount; i++) {
        const ph = h[i] || estimateRef.current;
        if (top < sum + ph) return i + 1;
        sum += ph;
      }
      return pageCount;
    },
    [pageCount]
  );

  // 把某一页渲染进指定 canvas（连续滚动模式；含高度回填与缓存）
  const renderScrollPage = useCallback(
    async (pageNum: number, canvas: HTMLCanvasElement, token: { stale: boolean }) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      let page = pageCacheRef.current.get(pageNum);
      if (!page) {
        try {
          page = await pdf.getPage(pageNum);
        } catch {
          fireReady(); // 取页失败：不赌 10s 兜底，直接放行遮罩
          return;
        }
        pageCacheRef.current.set(pageNum, page);
      }
      if (token.stale) return;
      const viewport = page.getViewport({ scale: SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // 回填真实高度 → 滚动条精确；并据此重钉初始恢复的目标页顶
      if (heightsRef.current[pageNum - 1] !== viewport.height) {
        heightsRef.current[pageNum - 1] = viewport.height;
        setHeights([...heightsRef.current]);
        const rec = initialRecoverRef.current;
        if (rec?.active) {
          const root = scrollRef.current;
          if (root) root.scrollTop = cumulativeTop(rec.target - 1);
          if (pageNum - 1 >= rec.target || heightsRef.current.every((x) => x > 0)) {
            rec.active = false;
          }
        }
      }
      const task = page.render({ canvas, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // RenderingCancelledException 等：忽略
      } finally {
        if (renderTaskRef.current === task) renderTaskRef.current = null;
        // 滚动模式首屏渲染完成：通知 App 淡出加载遮罩（D51：原实现仅 page 模式
        // 调 fireReady，滚动模式遮罩要等 10s 兜底，期间遮罩吞掉工具栏点击）
        fireReady();
      }
    },
    [fireReady]
  );

  /** 置空某页 canvas（超出窗口时释放位图，控制内存） */
  const clearScrollPage = useCallback((pageNum: number) => {
    const canvas = canvasRefs.current[pageNum - 1];
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, []);

  // ===== 加载文档（两种模式共用）=====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = base64ToUint8Array(dataBase64);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) {
          pdf.cleanup();
          return;
        }
        pdfRef.current = pdf;
        heightsRef.current = new Array(pdf.numPages).fill(0);
        renderedRef.current.clear(); // 新文档：已渲染集重置（懒渲染重来）
        setHeights([...heightsRef.current]);
        setPageCount(pdf.numPages);
        // 恢复：越界钳制；无记录回落首页
        const start = Math.min(Math.max(Math.round(initialPage ?? 1), 1), pdf.numPages);
        if (isScroll) {
          scrollCurrentRef_set(start);
          initialRecoverRef.current = { active: true, target: start };
          winRef.current = { min: 0, max: 0 };
          setWin({ min: 0, max: 0 });
        } else {
          setCurrent(start);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          fireReady(); // 解析失败也放行遮罩（错误态由失败分支渲染）
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelRenderTask();
      renderedRef.current.clear();
      pdfRef.current?.cleanup();
      pdfRef.current = null;
      pageCacheRef.current.clear();
    };
  }, [dataBase64, initialPage, isScroll, cancelRenderTask, fireReady]);

  // ===== 单页翻页渲染（仅 page 模式）=====
  const renderPage = useCallback(
    async (pageNum: number) => {
      const pdf = pdfRef.current;
      const canvas = canvasRefs.current[0];
      if (!pdf || !canvas) return;
      cancelRenderTask();
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: SCALE });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const task = page.render({ canvas, viewport });
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
        fireReady(); // 首页渲染完成：通知 App 淡出加载遮罩
      } catch (e) {
        if ((e as Error | null)?.name !== "RenderingCancelledException") {
          setFailed(true);
          fireReady();
        }
      }
    },
    [cancelRenderTask, fireReady]
  );

  useEffect(() => {
    if (!isScroll && pageCount > 0 && current >= 1 && current <= pageCount) {
      renderPage(current);
    }
  }, [isScroll, current, pageCount, renderPage]);

  // ===== 连续滚动：窗口计算 + 虚拟化渲染 =====
  useEffect(() => {
    if (!isScroll) return;
    const root = scrollRef.current;
    if (!root || pageCount <= 0) return;

    const recomputeWin = () => {
      if (visibleRef.current.size === 0) return;
      let min = pageCount;
      let max = 0;
      for (const v of visibleRef.current) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      min = Math.max(0, min - BUFFER);
      max = Math.min(pageCount - 1, max + BUFFER);
      const w = winRef.current;
      if (w.min !== min || w.max !== max) {
        winRef.current = { min, max };
        setWin({ min, max });
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const idx = Number((en.target as HTMLElement).dataset.page);
          if (en.isIntersecting) visibleRef.current.add(idx);
          else visibleRef.current.delete(idx);
        }
        recomputeWin();
      },
      { root, rootMargin: `${BUFFER * estimateRef.current}px 0px`, threshold: 0 }
    );
    slotRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [isScroll, pageCount]);

  // win 变化 → 渲染窗口内页、释放窗口外页
  useEffect(() => {
    if (!isScroll) return;
    const { min, max } = win;
    for (let i = min; i <= max; i++) {
      const canvas = canvasRefs.current[i];
      // 判据用 renderedRef 而非 canvas 尺寸：新挂载 canvas 默认 300×150，
      // 尺寸守卫永远为假（D52）；释放过的页已移出集合，重入窗口会重渲。
      if (canvas && !renderedRef.current.has(i)) {
        renderedRef.current.add(i);
        const token = { stale: false };
        void renderScrollPage(i + 1, canvas, token);
      }
    }
    // 释放窗口外但已渲染的页（仅当前在窗口外且之前被渲染过）
    for (let i = 0; i < pageCount; i++) {
      if (i < min || i > max) {
        renderedRef.current.delete(i);
        const canvas = canvasRefs.current[i];
        if (canvas && (canvas.width > 0 || canvas.height > 0)) clearScrollPage(i + 1);
      }
    }
  }, [isScroll, win, pageCount, renderScrollPage, clearScrollPage]);

  // 滚动 → 计算当前页 + 初始恢复定位（连续滚动）
  useEffect(() => {
    if (!isScroll) return;
    const root = scrollRef.current;
    if (!root || pageCount <= 0) return;
    const onScroll = () => {
      const p = pageAtScroll(root.scrollTop);
      if (p !== scrollCurrentRef.current) scrollCurrentRef_set(p);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    // 初始恢复：把 initialPage 所在槽置顶（估算高度即可，页级恢复足够）
    const target = Math.min(Math.max(scrollCurrentRef.current, 1), pageCount);
    root.scrollTop = cumulativeTop(target - 1);
    return () => root.removeEventListener("scroll", onScroll);
  }, [isScroll, pageCount, cumulativeTop]);

  // 窗口尺寸变化（page 模式）：重渲当前页
  useEffect(() => {
    if (isScroll) return;
    const onResize = () => renderPage(current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isScroll, current, renderPage]);

  // 采集：同步读当前页码。记录时机（2026-10-21 用户口径）：只保留离场节点
  // ——退出软件与点击书架（切书同理），翻页/加载过程不写库。两模式通用（page 模型）。
  const collectPosition = (): PositionReport | null => {
    if (pageCount <= 0) return null;
    const page = isScroll ? scrollCurrentRef.current : current;
    if (page < 1) return null;
    return {
      position: { kind: "pdf", page, pageCount, mode: isScroll ? "scroll" : "page" },
      progress: page / pageCount,
    };
  };

  // 同步取位置注册：App 在离场节点 flush 时调用（卸载置回 null）
  useEffect(() => {
    if (!getterRef) return;
    getterRef.current = collectPosition;
    return () => {
      if (getterRef.current === collectPosition) getterRef.current = null;
    };
  }, [getterRef, pageCount, current, scrollCurrent, isScroll]);

  if (failed) {
    return (
      <section className="state state-pdf active" aria-label="PDF 解析失败">
        <div className="welcome">
          <span className="welcome-title">PDF 解析失败，请确认文件未加密或损坏</span>
        </div>
      </section>
    );
  }

  if (isScroll) {
    // 连续滚动：纵向 overflow + 等高槽 + 虚拟化渲染
    return (
      <section className="state state-pdf active" aria-label="PDF 显示">
        <div className="pdf-scroll" ref={scrollRef}>
          <div className="pdf-scroll-track">
            {Array.from({ length: pageCount }, (_, i) => {
              const h = heights[i] || estimateRef.current;
              const inWin = i >= win.min && i <= win.max;
              return (
                <div
                  key={i}
                  className="pdf-page-slot"
                  data-page={i}
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  style={{ height: h }}
                >
                  {inWin ? (
                    <canvas
                      className="pdf-canvas"
                      ref={(el) => {
                        canvasRefs.current[i] = el;
                      }}
                    />
                  ) : (
                    <div className="pdf-page-placeholder" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="state state-pdf active" aria-label="PDF 显示">
      <div className="pdf-canvas-area">
        <div className="pdf-page">
          <canvas ref={(el) => { canvasRefs.current[0] = el; }} className="pdf-canvas" />
          {pageCount > 0 && <div className="pdf-footer">— {current} —</div>}
        </div>
      </div>
      <div className="pdf-controls">
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => Math.max(1, p - 1))}
          disabled={current <= 1}
        >
          上一页
        </button>
        <span className="pg-indicator">
          {pageCount > 0 ? current + " / " + pageCount : "载入中…"}
        </span>
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => Math.min(pageCount, p + 1))}
          disabled={pageCount === 0 || current >= pageCount}
        >
          下一页
        </button>
        <span className="zoom-chip">缩放 120%</span>
      </div>
    </section>
  );
}
