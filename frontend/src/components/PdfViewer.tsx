import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask, PDFPageProxy } from "pdfjs-dist";
import { base64ToUint8Array } from "../utils/base64";
import type { ReaderMode, Settings } from "../utils/settings";
import { setReaderCommandHandler, scrollStepFor } from "../utils/readerCommands";
import type { PositionReport } from "../utils/library";
import {
  FIT_LABELS,
  PDF_FITS,
  PDF_PAGE_GAP,
  PDF_ZOOM_NUDGE,
  PDF_ZOOM_PRESETS,
  clampSpreadLeft,
  fitRatio,
  resolvePdfScale,
  spreadLeftMax,
  spreadStep,
  type PdfFit,
  type PdfViewHandlers,
  type ResolvedPdfScale,
} from "../utils/pdfScale";

// worker 方案 A（主选）：Vite 打包期解析；文件名以 node_modules/pdfjs-dist/build 实际结果为准
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const BUFFER = 2; // 连续滚动模式前后缓冲页数（虚拟化）
const ESTIMATE_H = 800; // 未测量页的估算高度，仅供滚动条占位
/** PDFPageProxy LRU 上限（O7）：262 页大书滚动全程内存可控 */
const PAGE_CACHE_MAX = 24;
/** .pdf-canvas-area 内盒 = client 盒 − padding 22px×2（styles.css .pdf-canvas-area） */
const AREA_PAD = 22;

/**
 * D71（根因修正）：PDF 二次打开 / 翻页 / 切换适配时，单页与双页模式偶发被表面为
 * “PDF 解析失败”，而连续滚动模式却正常——根因并非 worker 竞争，而是 pdfjs 全局静态集
 * `InternalRenderTask.#canvasInUse`：同一 <canvas> 上有未结束的 render() 时再次调用会
 * 同步抛 “Cannot use the same canvas during multiple render() operations”。单页模式
 * renderPage 把该异常 setFailed 表面成了“解析失败”，连续滚动 renderScrollPage 用
 * catch {} 静默吞掉，于是产生“横屏(单页/双页)坏、竖屏滚动好”的观感。
 * 修复见 renderTasksRef + renderOnCanvas：重渲前 await 取消在飞任务、释放该 canvas。
 */

type Props = {
  dataBase64: string;
  /** 阅读模式：page=单页翻页（默认），scroll=连续滚动（虚拟化） */
  mode: ReaderMode;
  /** 恢复页码：打开时跳转到书架的记录页（越界钳制到 [1, numPages]） */
  initialPage?: number;
  /** v0.2.9：阅读设置（pdfFit/pdfZoom/pdfDpr），变化即时生效不重挂载 */
  settings: Settings;
  /**
   * 同步取位置注册位：App 在离场节点（退出软件/点击书架/切书）flush 时
   * 调用取当前页码（翻页即写已取消，改由离场时同步取；卸载置回 null）。
   */
  getterRef?: MutableRefObject<(() => PositionReport | null) | null>;
  /** 首页渲染完成（或解析失败）：App 淡出加载遮罩 */
  onReady?: () => void;
  /** v0.2.9：视图交互回调（缩放上报与变更请求，App 统一持久化） */
  pdfView?: PdfViewHandlers;
};

export default function PdfViewer({ dataBase64, mode, initialPage, settings, getterRef, onReady, pdfView }: Props) {
  const isScroll = mode === "scroll"; // true=连续滚动；false=单页翻页（默认）
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  /** 各 canvas 在飞渲染任务（按 canvas 维度登记）：翻页/设置变化/二次打开时，重渲前先 await
   *  其取消，释放 pdfjs 全局 #canvasInUse，避免同步抛
   *  "Cannot use the same canvas during multiple render() operations"（D71：单页/双页模式因此被
   *  表面为“PDF 解析失败”，而连续滚动模式 catch {} 静默吞掉 → 用户观感“横屏坏、竖屏好”）。 */
  const renderTasksRef = useRef<Map<HTMLCanvasElement, RenderTask>>(new Map());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // 首渲完成只通知一次（翻页不再触发）
  const readyFiredRef = useRef(false);
  const fireReady = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, []);

  // 设置/回调镜像：渲染链路读 ref，避免 effect 依赖抖动导致重复渲染
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const viewRef = useRef(pdfView);
  viewRef.current = pdfView;

  const [pageCount, setPageCount] = useState(0);
  const pageCountRef = useRef(0);
  pageCountRef.current = pageCount;
  const [failed, setFailed] = useState(false);

  // ===== 单页翻页模式 =====
  const [current, setCurrent] = useState(1);
  const areaRef = useRef<HTMLDivElement>(null); // .pdf-canvas-area（滚动容器，量内盒用）
  const hostRef = useRef<HTMLDivElement>(null); // .pdf-page（定宽包裹，页脚居中/双页排布）
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // ===== 连续滚动模式 =====
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<number[]>([]); // 各页渲染后真实高度（懒测量）
  const widthsRef = useRef<number[]>([]); // 各页渲染后真实宽度（异尺寸页兼容）
  const [heights, setHeights] = useState<number[]>([]); // 触发重排
  const [widths, setWidths] = useState<number[]>([]);
  const estimateRef = useRef<number>(ESTIMATE_H);
  const [win, setWin] = useState<{ min: number; max: number }>({ min: 0, max: 0 });
  const winRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });
  const visibleRef = useRef<Set<number>>(new Set());
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
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
  // 初始恢复/容器变化后重钉：章节级（页级）定位，待真实高度回填后重新置顶目标页
  const initialRecoverRef = useRef<{ active: boolean; target: number } | null>(null);
  // 最近一次适配解析结果：档位菜单据此显示各方式在当前容器/页面下的实际倍率
  const lastResolvedRef = useRef<ResolvedPdfScale | null>(null);

  // ===== v0.2.9：容器内盒测量 =====
  // page 模式量 .pdf-canvas-area（扣 22px padding），scroll 模式量 .pdf-scroll（无横向 padding）。
  // RO 变化守卫：仅自身尺寸变化才重算，否则「量容器→改 canvas→再触发 RO」会死循环（方案 §6 风险 1）。
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el || pageCount <= 0) return;
    const pad = isScroll ? 0 : AREA_PAD * 2;
    const measure = () => {
      const w = el.clientWidth - pad;
      const h = el.clientHeight - pad;
      if (w === boxRef.current.w && h === boxRef.current.h) return;
      boxRef.current = { w, h };
      setBox({ w, h });
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [isScroll, pageCount]);

  // 上报实际缩放（仅变化时）：工具栏数值、状态栏文案、控制条 chip 同一真相
  const lastReportRef = useRef("");
  const [scalePct, setScalePct] = useState(0);
  const reportScale = useCallback((r: ResolvedPdfScale) => {
    const pct = Math.round(r.scale * 100);
    const fit = settingsRef.current.pdfFit;
    const key = fit + ":" + pct;
    setScalePct(pct);
    if (lastReportRef.current === key) return;
    lastReportRef.current = key;
    viewRef.current?.onScaleReport?.({ pct, fit });
  }, []);

  const cancelRenderTask = useCallback(() => {
    // 取消所有在飞渲染，但不在 map 中移除：renderOnCanvas 重渲同 canvas 前需 await 其释放，
    // 否则仍会命中 pdfjs “same canvas during multiple render() operations”
    for (const t of renderTasksRef.current.values()) {
      try {
        t.cancel();
      } catch {
        // 已完成/已取消的任务再取消时忽略
      }
    }
  }, []);

  /**
   * 在指定 canvas 渲染一页，并确保该 canvas 此刻没有其他在飞渲染（D71 根因修复）：
   * 若同一 canvas 上有未结束任务，先 cancel 并 await 其落定（释放 pdfjs 全局 #canvasInUse），
   * 再开始新渲染。仅“非取消类”异常向上抛（交给调用方决定失败/静默）。
   */
  const renderOnCanvas = useCallback(
    async (page: PDFPageProxy, canvas: HTMLCanvasElement, r: ResolvedPdfScale): Promise<void> => {
      const prev = renderTasksRef.current.get(canvas);
      if (prev) {
        try {
          prev.cancel();
        } catch {
          /* 已取消/已完成忽略 */
        }
        try {
          await prev.promise;
        } catch {
          /* 取消态为 RenderingCancelledException，忽略 */
        }
        renderTasksRef.current.delete(canvas);
      }
      canvas.style.width = r.cssW + "px";
      canvas.style.height = r.cssH + "px";
      canvas.width = r.bmpW;
      canvas.height = r.bmpH;
      const viewport = page.getViewport({ scale: r.scale * r.dpr });
      const task = page.render({ canvas, viewport });
      renderTasksRef.current.set(canvas, task);
      try {
        await task.promise;
      } catch (e) {
        if ((e as Error | null)?.name !== "RenderingCancelledException") throw e;
      } finally {
        if (renderTasksRef.current.get(canvas) === task) renderTasksRef.current.delete(canvas);
      }
    },
    []
  );

  /** LRU 取页（O6/O7）：命中后移到队尾；超上限淘汰最久未用 */
  const getPageCached = useCallback(async (pdf: PDFDocumentProxy, pageNum: number): Promise<PDFPageProxy> => {
    const hit = pageCacheRef.current.get(pageNum);
    if (hit) {
      pageCacheRef.current.delete(pageNum);
      pageCacheRef.current.set(pageNum, hit);
      return hit;
    }
    const page = await pdf.getPage(pageNum);
    pageCacheRef.current.set(pageNum, page);
    while (pageCacheRef.current.size > PAGE_CACHE_MAX) {
      const oldest = pageCacheRef.current.keys().next().value;
      if (oldest === undefined) break;
      pageCacheRef.current.delete(oldest);
    }
    return page;
  }, []);

  /** 邻页预取（O6）：只取 PDFPageProxy（解析是大头），不渲染位图 */
  const prefetchNeighbors = useCallback(
    (pageNum: number) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      const n = pageCountRef.current;
      for (const p of [pageNum - 1, pageNum + 1]) {
        if (p >= 1 && p <= n) void getPageCached(pdf, p).catch(() => {});
      }
    },
    [getPageCached]
  );

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

  // 阅读命令注册（v0.2.5 F22/F24）：window 级快捷键经 readerCommands 槽位派达到本 Viewer。
  // 单页模式：prev/next/home/end 映射页码；滚动模式：方向键微滚、翻页键整屏（D46）。
  // v0.2.9：单页模式 + 页内高于视口（适宽）时，方向键先滚完本页再翻页（方案 §6 风险 2）。
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
      setReaderCommandHandler((action, key) => {
        if (pageCount <= 0) return false;
        const area = areaRef.current;
        const spread = spreadStep(settingsRef.current.pdfFit) === 2;
        const flip = (p: number, d: number) => {
          const n = p + d * (spread ? 2 : 1);
          return spread ? clampSpreadLeft(n, pageCount) : Math.min(pageCount, Math.max(1, n));
        };
        // 方向键页内滚动优先：仅 ArrowUp/ArrowDown，且本页确实高于视口
        const vertical = key === "ArrowUp" || key === "ArrowDown";
        const scrollable = area ? area.scrollHeight > area.clientHeight + 1 : false;
        if (area && scrollable && vertical) {
          const atTop = area.scrollTop <= 1;
          const atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 1;
          if (action === "next" && !atBottom) {
            area.scrollBy({ top: scrollStepFor(key, area.clientHeight) });
            return true;
          }
          if (action === "prev" && !atTop) {
            area.scrollBy({ top: -scrollStepFor(key, area.clientHeight) });
            return true;
          }
        }
        if (area) area.scrollTop = 0; // 翻页后从页顶开始
        if (action === "prev") {
          setCurrent((p) => flip(p, -1));
          return true;
        }
        if (action === "next") {
          setCurrent((p) => flip(p, 1));
          return true;
        }
        if (action === "home") {
          setCurrent(1);
          return true;
        }
        setCurrent(spread ? spreadLeftMax(pageCount) : pageCount);
        return true;
      });
    }
    return () => setReaderCommandHandler(null);
  }, [isScroll, pageCount]);

  /**
   * 把一页画进指定 canvas（v0.2.9 适配链路）：
   * 量容器 → resolvePdfScale → 预设 canvas 尺寸（O8）→ DPR 位图（O3）→ render。
   * 返回本次解析结果供调用方排布（双页总宽/垂直居中）。
   */
  const drawInto = useCallback(
    async (pageNum: number, canvas: HTMLCanvasElement): Promise<ResolvedPdfScale | null> => {
      const pdf = pdfRef.current;
      const box = boxRef.current;
      if (!pdf || box.w <= 0 || box.h <= 0) return null;
      const s = settingsRef.current;
      let page: PDFPageProxy;
      try {
        page = await getPageCached(pdf, pageNum);
      } catch {
        fireReady(); // 取页失败：不赌 10s 兜底，直接放行遮罩
        return null;
      }
      const base = page.getViewport({ scale: 1 });
      const r = resolvePdfScale(s.pdfFit, s.pdfZoom, box.w, box.h, base.width, base.height, s.pdfDpr);
      if (r.scale <= 0) return null;
      lastResolvedRef.current = r; // 档位菜单据此显示各方式实际倍率
      // 渲染（renderOnCanvas 负责同 canvas 的在飞任务 cancel+await，杜绝“multiple render”抛错）
      await renderOnCanvas(page, canvas, r);
      return r;
    },
    [getPageCached, fireReady, renderOnCanvas]
  );

  // ===== 单页翻页渲染（仅 page 模式；含双页并排）=====
  const renderPage = useCallback(
    async (pageNum: number) => {
      const host = hostRef.current;
      const area = areaRef.current;
      const spread = spreadStep(settingsRef.current.pdfFit) === 2;
      const left = spread ? clampSpreadLeft(pageNum, pageCountRef.current) : pageNum;
      cancelRenderTask();
      try {
        if (spread) {
          const c0 = canvasRefs.current[0];
          if (!c0) return;
          const r0 = await drawInto(left, c0);
          if (!r0) return;
          let totalW = r0.cssW;
          let maxH = r0.cssH;
          const c1 = canvasRefs.current[1];
          const right = left + 1;
          if (c1 && right <= pageCountRef.current) {
            const r1 = await drawInto(right, c1);
            if (r1) {
              totalW = r0.cssW + PDF_PAGE_GAP + r1.cssW;
              maxH = Math.max(maxH, r1.cssH);
            }
          }
          if (host) host.style.width = totalW + "px";
          if (area) area.dataset.fit = maxH <= boxRef.current.h ? "center" : "top";
          reportScale(r0);
        } else {
          const c0 = canvasRefs.current[0];
          if (!c0) return;
          const r = await drawInto(left, c0);
          if (!r) return;
          if (host) host.style.width = r.cssW + "px";
          if (area) area.dataset.fit = r.cssH <= boxRef.current.h ? "center" : "top";
          reportScale(r);
        }
        fireReady(); // 首页渲染完成：通知 App 淡出加载遮罩
        prefetchNeighbors(left);
      } catch (e) {
        if ((e as Error | null)?.name !== "RenderingCancelledException") {
          setFailed(true);
          fireReady();
        }
      }
    },
    [cancelRenderTask, drawInto, fireReady, prefetchNeighbors, reportScale]
  );

  // 页码变化 → 重渲（box/settings 变化走下面的 effect，避免依赖抖动）
  useEffect(() => {
    if (!isScroll && pageCount > 0 && current >= 1 && current <= pageCount) {
      void renderPage(current);
    }
  }, [isScroll, current, pageCount, renderPage]);

  // 容器尺寸或适配设置变化 → 重算（含首测）；滚动模式同时作废槽位尺寸并重钉当前页
  useEffect(() => {
    if (pageCount <= 0 || box.w <= 0 || box.h <= 0) return;
    if (isScroll) {
      widthsRef.current = new Array(pageCount).fill(box.w);
      heightsRef.current = new Array(pageCount).fill(0);
      setWidths([...widthsRef.current]);
      setHeights([...heightsRef.current]);
      renderedRef.current.clear();
      initialRecoverRef.current = { active: true, target: scrollCurrentRef.current };
    } else {
      void renderPage(current);
    }
  }, [isScroll, pageCount, box.w, box.h, settings.pdfFit, settings.pdfZoom, settings.pdfDpr, renderPage]);

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

  // 把某一页渲染进指定 canvas（连续滚动模式；含高度/宽度回填与重钉）
  const renderScrollPage = useCallback(
    async (pageNum: number, canvas: HTMLCanvasElement, token: { stale: boolean }) => {
      const pdf = pdfRef.current;
      const box = boxRef.current;
      if (!pdf || box.w <= 0 || box.h <= 0) return;
      let page: PDFPageProxy;
      try {
        page = await getPageCached(pdf, pageNum);
      } catch {
        fireReady();
        return;
      }
      if (token.stale) return;
      const s = settingsRef.current;
      const base = page.getViewport({ scale: 1 });
      const r = resolvePdfScale(s.pdfFit, s.pdfZoom, box.w, box.h, base.width, base.height, s.pdfDpr);
      if (r.scale <= 0) return;
      const idx = pageNum - 1;
      // 回填真实高度/宽度 → 滚动条精确；并据此重钉恢复的目标页顶
      if (heightsRef.current[idx] !== r.cssH || widthsRef.current[idx] !== r.cssW) {
        heightsRef.current[idx] = r.cssH;
        widthsRef.current[idx] = r.cssW;
        setHeights([...heightsRef.current]);
        setWidths([...widthsRef.current]);
        const rec = initialRecoverRef.current;
        if (rec?.active) {
          const root = scrollRef.current;
          if (root) root.scrollTop = cumulativeTop(rec.target - 1);
          if (idx >= rec.target || heightsRef.current.every((x) => x > 0)) {
            rec.active = false;
          }
        }
      }
      // 渲染（renderOnCanvas 处理同 canvas 在飞任务 cancel+await；滚动模式渲染异常静默，不弹“解析失败”）
      try {
        await renderOnCanvas(page, canvas, r);
      } catch {
        /* 滚动模式：渲染异常静默处理（与单页模式不同，不表面为“PDF 解析失败”） */
      } finally {
        // 滚动模式首屏渲染完成：通知 App 淡出加载遮罩（D51：原实现仅 page 模式
        // 调 fireReady，滚动模式遮罩要等 10s 兜底，期间遮罩吞掉工具栏点击）
        fireReady();
      }
      reportScale(r);
    },
    [getPageCached, fireReady, cumulativeTop, reportScale, renderOnCanvas]
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
      if (cancelled) return;
      try {
        const bytes = base64ToUint8Array(dataBase64);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) {
          pdf.cleanup();
          return;
        }
        pdfRef.current = pdf;
        heightsRef.current = new Array(pdf.numPages).fill(0);
        widthsRef.current = new Array(pdf.numPages).fill(0);
        renderedRef.current.clear(); // 新文档：已渲染集重置（懒渲染重来）
        setHeights([...heightsRef.current]);
        setWidths([...widthsRef.current]);
        setPageCount(pdf.numPages);
        // 恢复：越界钳制；无记录回落首页。双页模式按摊开规则定位左页（方案 §6 风险 3）
        const start = Math.min(Math.max(Math.round(initialPage ?? 1), 1), pdf.numPages);
        if (isScroll) {
          scrollCurrentRef_set(start);
          initialRecoverRef.current = { active: true, target: start };
          winRef.current = { min: 0, max: 0 };
          setWin({ min: 0, max: 0 });
        } else {
          setCurrent(spreadStep(settingsRef.current.pdfFit) === 2 ? clampSpreadLeft(start, pdf.numPages) : start);
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
      cancelRenderTask(); // 取消在飞渲染（renderOnCanvas 重渲前仍会 await 释放 canvas）
      renderedRef.current.clear();
      pageCacheRef.current.clear();
      // 仅释放文档资源、保留 worker 复用（单本阅读器无需反复销毁/重建 worker；
      // 重建竞态才是“二次打开偶发解析失败”的混淆源之一，D71 根因已修正为 canvas 维度）
      pdfRef.current?.cleanup();
      pdfRef.current = null;
    };
  }, [dataBase64, initialPage, isScroll, cancelRenderTask, fireReady]);

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

  // 采集：同步读当前页码。记录时机（2026-10-21 用户口径）：只保留离场节点
  // ——退出软件与点击书架（切书同理），翻页/加载过程不写库。两模式通用（page 模型）。
  // v0.2.9：双页模式记录左页码，语义向后兼容（方案 §3.3）。
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

  // ===== v0.2.9：Ctrl+滚轮调倍率（阅读区任意位置）=====
  useEffect(() => {
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault(); // 阻止浏览器默认页面缩放
      viewRef.current?.onZoomNudge?.(ev.deltaY < 0 ? PDF_ZOOM_NUDGE : -PDF_ZOOM_NUDGE);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isScroll, pageCount]);

  // ===== v0.2.9：页码跳转（O11，随视觉基线一并落地）=====
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const flipFrom = useCallback((p: number, d: number) => {
    const n = pageCountRef.current;
    if (spreadStep(settingsRef.current.pdfFit) === 2) return clampSpreadLeft(p + d * 2, n);
    return Math.min(n, Math.max(1, p + d));
  }, []);
  const openJump = useCallback(() => {
    if (pageCountRef.current <= 0) return;
    setJumpText(String(current));
    setJumpOpen(true);
  }, [current]);
  useEffect(() => {
    if (!jumpOpen) return;
    const el = jumpInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [jumpOpen]);
  const commitJump = useCallback(() => {
    const n = parseInt(jumpText, 10);
    if (Number.isFinite(n) && pageCountRef.current > 0) {
      // 越界静默钳制（指示器即时反映结果，不为单交互引入全局提示通道）
      setCurrent(flipFrom(Math.min(Math.max(n, 1), pageCountRef.current), 0));
    }
    setJumpOpen(false);
  }, [jumpText, flipFrom]);

  // ===== v0.2.9：档位菜单（控制条 chip）=====
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const chipWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (chipWrapRef.current && !chipWrapRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [zoomMenuOpen]);

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
    // 连续滚动：纵向 overflow + 等高槽 + 虚拟化渲染；槽宽由适配结果 inline 写入（去 720px 硬编码，O4）
    return (
      <section className="state state-pdf active" aria-label="PDF 显示">
        <div className="pdf-scroll" ref={scrollRef}>
          <div className="pdf-scroll-track">
            {Array.from({ length: pageCount }, (_, i) => {
              const inWin = i >= win.min && i <= win.max;
              const w = widths[i] || box.w;
              return (
                <div
                  key={i}
                  className="pdf-page-slot"
                  data-page={i}
                  ref={(el) => {
                    slotRefs.current[i] = el;
                  }}
                  style={{ width: w > 0 ? w : undefined, height: heights[i] || ESTIMATE_H }}
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

  const spreadOn = spreadStep(settings.pdfFit) === 2;
  const nextLimit = spreadOn ? spreadLeftMax(pageCount) : pageCount;
  const chipFit = settings.pdfFit;

  return (
    <section className="state state-pdf active" aria-label="PDF 显示">
      <div className="pdf-canvas-area" ref={areaRef}>
        <div className="pdf-page" ref={hostRef} data-spread={spreadOn ? "1" : "0"}>
          {spreadOn ? (
            <>
              <canvas
                className="pdf-canvas"
                ref={(el) => {
                  canvasRefs.current[0] = el;
                }}
              />
              <canvas
                className="pdf-canvas"
                ref={(el) => {
                  canvasRefs.current[1] = el;
                }}
              />
            </>
          ) : (
            <canvas
              className="pdf-canvas"
              ref={(el) => {
                canvasRefs.current[0] = el;
              }}
            />
          )}
          {pageCount > 0 && <div className="pdf-footer">— {current} —</div>}
        </div>
      </div>
      <div className="pdf-controls">
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => flipFrom(p, -1))}
          disabled={current <= 1}
        >
          上一页
        </button>
        <span
          className={"pg-jump" + (jumpOpen ? " editing" : "")}
          onClick={openJump}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openJump();
            }
          }}
          role="button"
          tabIndex={0}
          title="点击输入页码跳转"
        >
          {jumpOpen ? (
            <input
              ref={jumpInputRef}
              type="text"
              inputMode="numeric"
              value={jumpText}
              onChange={(e) => setJumpText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitJump();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setJumpOpen(false);
                }
              }}
              onBlur={commitJump}
              aria-label="跳转页码"
            />
          ) : pageCount > 0 ? (
            current + " / " + pageCount
          ) : (
            "载入中…"
          )}
        </span>
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => flipFrom(p, 1))}
          disabled={pageCount === 0 || current >= nextLimit}
        >
          下一页
        </button>
        <div className="zoom-chip-wrap" ref={chipWrapRef}>
          <button
            type="button"
            className="zoom-chip-btn"
            onClick={() => setZoomMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
            title="适配方式与倍率（Ctrl+滚轮也可调）"
          >
            <span>{(chipFit === "custom" ? "自定义" : FIT_LABELS[chipFit]) + " " + (scalePct > 0 ? scalePct + "%" : "—")}</span>
            <span className="cv">&#9662;</span>
          </button>
          {zoomMenuOpen && (
            <div className="zoom-menu" role="menu">
              <div className="menu-title">适配方式</div>
              {PDF_FITS.map((f: PdfFit) => {
                const ratio = fitRatio(lastResolvedRef.current, f, settings.pdfZoom);
                return (
                  <button
                    key={f}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chipFit === f}
                    className={"menu-item" + (chipFit === f ? " current" : "")}
                    onClick={() => {
                      viewRef.current?.onFitChange?.(f);
                      setZoomMenuOpen(false);
                    }}
                  >
                    <span>{FIT_LABELS[f]}</span>
                    <span className="dim">{ratio === null ? "—" : Math.round(ratio * 100) + "%"}</span>
                    <span className="ck">&#10003;</span>
                  </button>
                );
              })}
              <div className="menu-sep" />
              <div className="menu-title">倍率预设（切到「自定义」后生效）</div>
              <div className="menu-presets">
                {PDF_ZOOM_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      viewRef.current?.onZoomPreset?.(p);
                      setZoomMenuOpen(false);
                    }}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <div className="menu-note">Ctrl+滚轮可在阅读区直接调整倍率</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
