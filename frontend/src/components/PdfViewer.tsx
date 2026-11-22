import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask, PDFPageProxy } from "pdfjs-dist";
import { base64ToUint8Array } from "../utils/base64";
import type { ReaderMode, Settings } from "../utils/settings";
import { setReaderCommandHandler, scrollStepFor } from "../utils/readerCommands";
import type { PositionReport } from "../utils/library";
import type { MarksContext } from "./marksContext";
import InkCanvas, { type InkTool } from "./PdfInkCanvas";
import PdfInkToolbar from "./PdfInkToolbar";
import {
  canClearInk,
  canRedoInk,
  canUndoInk,
  popLastDraft,
  undoTargetPage,
  visiblePages,
  type InkRedoEntry,
} from "../utils/pdfInkUndo";
import type { PdfStroke } from "../utils/marks";
import { BRUSH_ALPHA, ERASER_RADIUS } from "../utils/pdfInk";
import { PDF_INK_COLORS, PDF_INK_HEX, type PdfBrush, type PdfInkColor } from "../utils/marks";
import {
  FIT_LABELS,
  PDF_FITS,
  PDF_PAGE_GAP,
  PDF_WHEEL_THROTTLE_MS,
  PDF_ZOOM_PRESETS,
  clampPdfZoom,
  clampSpreadLeft,
  columnStep,
  fitRatio,
  migratePdfFit,
  resolvePdfScale,
  spreadLeftMax,
  wheelZoomDelta,
  zoomAnchorScroll,
  type PdfColumns,
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
  /** v0.3.0 标记上下文（App 组装、BookViewer 透传）；缺失时纯阅读无标记 */
  marksCtx?: MarksContext;
};

export default function PdfViewer({ dataBase64, mode, initialPage, settings, getterRef, onReady, pdfView, marksCtx }: Props) {
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

  // ===== D110：以鼠标为中心缩放的锚点 =====
  // Ctrl+滚轮触发缩放后，settings 更新与 canvas 重排是异步的；先记下锚点，
  // 待 renderPage/renderScrollPage 完成（canvas 尺寸已写入 DOM）再校正滚动位置，
  // 使鼠标下的内容点在缩放前后停留在视口同一位置。
  type ZoomAnchor = {
    vx: number; // 鼠标相对容器视口的 x（缩放前后固定）
    vy: number;
    px: number; // 鼠标相对内容元素左边缘的 x（缩放前测量）
    py: number;
    w: number; // 缩放前内容元素宽（算缩放比）
    h: number;
    at: number; // 记录时刻：缩放被钳制未触发重渲时，超时作废
  };
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  /** 缩放锚点参照的内容元素：翻页取 .pdf-page（双栏含间距的总宽由 JS 同步写入），
   *  滚动取当前页 canvas（其 style.width 在 renderOnCanvas 中同步写入） */
  const anchorContent = useCallback(
    (el: HTMLElement): HTMLElement | null =>
      isScroll
        ? el.querySelector<HTMLElement>(".pdf-page-slot .pdf-canvas")
        : el.querySelector<HTMLElement>(".pdf-page"),
    [isScroll]
  );
  /** 在页面重绘完成后应用锚点校正（幂等：应用一次即清空） */
  const applyZoomAnchor = useCallback(() => {
    const a = zoomAnchorRef.current;
    if (!a) return;
    zoomAnchorRef.current = null;
    if (Date.now() - a.at > 3000) return; // 缩放被钳制/未重渲：过期作废
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el) return;
    const content = anchorContent(el);
    if (!content) return;
    const elRect = el.getBoundingClientRect();
    const cRect = content.getBoundingClientRect();
    const rx = a.w > 0 ? cRect.width / a.w : 1;
    const ry = a.h > 0 ? cRect.height / a.h : 1;
    const leadX = cRect.left - elRect.left;
    const leadY = cRect.top - elRect.top;
    el.scrollLeft = zoomAnchorScroll(el.scrollLeft, leadX, a.px, a.vx, rx);
    el.scrollTop = zoomAnchorScroll(el.scrollTop, leadY, a.py, a.vy, ry);
  }, [isScroll, anchorContent]);

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
    // D103：custom 下 r.scale 是「相对页面基准 pw 的真实倍率」，双栏时它已含
    // (baseW/pw) 的折算系数，直接 ×100 上报会得到与用户设定值不符的数字
    // （双栏 100% 会显示成 ~55%），且 handleZoomNudge 会拿它当基点把倍率算飞。
    // 故 custom 一律上报用户设定的 zoom，其余适配方式仍报实际倍率。
    const s = settingsRef.current;
    const pct = r.fit === "custom" ? clampPdfZoom(s.pdfZoom) : Math.round(r.scale * 100);
    const key = s.pdfFit + ":" + pct;
    setScalePct(pct);
    if (lastReportRef.current === key) return;
    lastReportRef.current = key;
    viewRef.current?.onScaleReport?.({ pct, fit: s.pdfFit });
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
      // D112：写 canvas.width/height 会立即清空位图。连续缩放时若每次都无条件
      // 重设，就会出现「清空 → 异步重绘 → 再清空」的闪烁。尺寸未变则保留旧位图，
      // pdfjs 的 render 会直接覆盖，画面稳定得多。
      if (canvas.width !== r.bmpW) canvas.width = r.bmpW;
      if (canvas.height !== r.bmpH) canvas.height = r.bmpH;
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
        // D102：栏数是独立设置的维度，不再从 pdfFit 推导（否则一切缩放都会退回单页）
        const cols = settingsRef.current.pdfColumns;
        const spread = cols === 2;
        const flip = (p: number, d: number) => {
          const n = p + d * columnStep(cols);
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
      const r = resolvePdfScale(
        s.pdfFit,
        s.pdfZoom,
        box.w,
        box.h,
        base.width,
        base.height,
        s.pdfDpr,
        s.pdfColumns
      );
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
      // D102：栏数独立于适配方式
      const spread = settingsRef.current.pdfColumns === 2;
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
          // D101：回填画笔层尺寸（画笔按页面 CSS 像素对齐）
          setInkBox((prev) => (prev.w === r0.cssW && prev.h === r0.cssH ? prev : { w: r0.cssW, h: r0.cssH }));
          reportScale(r0);
          applyZoomAnchor(); // D110：canvas 尺寸已写入 DOM，校正鼠标锚点
        } else {
          const c0 = canvasRefs.current[0];
          if (!c0) return;
          const r = await drawInto(left, c0);
          if (!r) return;
          if (host) host.style.width = r.cssW + "px";
          if (area) area.dataset.fit = r.cssH <= boxRef.current.h ? "center" : "top";
          setInkBox((prev) => (prev.w === r.cssW && prev.h === r.cssH ? prev : { w: r.cssW, h: r.cssH }));
          reportScale(r);
          applyZoomAnchor(); // D110：canvas 尺寸已写入 DOM，校正鼠标锚点
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
    [cancelRenderTask, drawInto, fireReady, prefetchNeighbors, reportScale, applyZoomAnchor]
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
  }, [
    isScroll,
    pageCount,
    box.w,
    box.h,
    settings.pdfFit,
    settings.pdfZoom,
    settings.pdfDpr,
    settings.pdfColumns,
    renderPage,
  ]);

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
      const r = resolvePdfScale(
        s.pdfFit,
        s.pdfZoom,
        box.w,
        box.h,
        base.width,
        base.height,
        s.pdfDpr,
        s.pdfColumns
      );
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
        applyZoomAnchor(); // D110：canvas 尺寸已写入 DOM，校正鼠标锚点（幂等）
      }
      reportScale(r);
    },
    [getPageCached, fireReady, cumulativeTop, reportScale, renderOnCanvas, applyZoomAnchor]
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
          // D102：栏数独立——初始定位按栏数决定是否摊开到左页
          setCurrent(
            settingsRef.current.pdfColumns === 2 ? clampSpreadLeft(start, pdf.numPages) : start
          );
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

  // ===== v0.3.0 标记：页级标记 + 页码跳转 =====
  // D73：PdfViewer 为纯 canvas 渲染（无 pdfjs textLayer），页内 quote 重匹配高亮
  // 本版不做（in-text 高亮列后续候选）；标记退化为「页级」——text 空、非 idea、
  // 定位器只记页码，面板按「第 N 页」分组、导出含位置脚注。
  const marksCtxRef = useRef(marksCtx);
  marksCtxRef.current = marksCtx;
  const jumpNonceRef = useRef(-1);

  /** 「标记本页」：直接落库（默认色），toast 由 App 的 onAdd 包装出 */
  const onMarkPage = useCallback(() => {
    const ctx = marksCtxRef.current;
    if (!ctx?.enabled) return;
    const page = isScroll ? scrollCurrentRef.current : current;
    if (page < 1 || pageCountRef.current <= 0) return;
    ctx.onAdd({ color: ctx.defaultColor, text: "", locator: { kind: "pdf", page, quote: "" } });
  }, [isScroll, current]);

  /** 当前页是否已有标记（按钮 active 态；读 prop 保证 marks 变更时随渲染更新） */
  const markPage = isScroll ? scrollCurrent : current;
  const pageMarked =
    marksCtx?.marks.some((m) => m.locator.kind === "pdf" && m.locator.page === markPage) ?? false;

  // ===== D101：PDF 画笔（高亮笔 / 自由笔 / 橡皮擦，翻页与滚动双模式）=====
  // 与 D73「标记本页」的关系：
  //   - 「标记本页」= 页级书签，一个标记、无笔迹；
  //   - 画笔 = 在页面上真正圈画，落库为带 strokes 的标记（一个标记可含多笔）。
  // 两者共存：书签不占画布，笔迹按页聚合。同一页已有笔迹标记时继续画即追加到它，
  // 避免「一页画十次生十条标记」把面板刷爆。
  // 图片版 PDF 没有文字层，无法划词，所以画笔是本版 PDF 唯一的「页内标记」手段。
  type InkDraft = { page: number; strokes: PdfStroke[] };
  const [inkTool, setInkTool] = useState<InkTool>({
    active: false,
    brush: "highlighter",
    color: "yellow",
    sizeScale: 1,
    alpha: BRUSH_ALPHA.highlighter,
    eraserSize: ERASER_RADIUS,
  });
  /** 每页草稿笔迹：page → strokes（落笔画完即入草稿，点「保存」才落库） */
  const [inkDrafts, setInkDrafts] = useState<Record<number, PdfStroke[]>>({});
  /** D106：撤销栈——保存被撤的一步，供「恢复」反向执行；新落笔/保存/清空时作废 */
  const [inkRedo, setInkRedo] = useState<InkRedoEntry[]>([]);
  /** 画布页面尺寸（随 canvas 渲染结果回填，画笔层据此对齐） */
  const [inkBox, setInkBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  /** 该页已落库的笔迹（可能分散在多个标记里，按标记顺序拼接） */
  const inkStrokesOf = useCallback(
    (page: number): PdfStroke[] => {
      const out: PdfStroke[] = [];
      for (const m of marksCtx?.marks ?? []) {
        if (m.locator.kind !== "pdf" || m.locator.page !== page) continue;
        const s = m.locator.strokes;
        if (s && s.length) out.push(...s);
      }
      return out;
    },
    [marksCtx?.marks]
  );

  const setDraftFor = useCallback((page: number, strokes: PdfStroke[]) => {
    setInkDrafts((prev) => ({ ...prev, [page]: strokes }));
  }, []);

  /** 新落笔/擦除：写入草稿并作废 redo 栈（D106：新操作后不能再恢复旧撤销） */
  const onInkStrokesChange = useCallback(
    (page: number, next: PdfStroke[]) => {
      setDraftFor(page, next);
      setInkRedo([]);
    },
    [setDraftFor]
  );

  /** 草稿是否有未保存内容（工具栏显示「保存」高亮） */
  const inkDirty = Object.values(inkDrafts).some((s) => s.length > 0);
  const inkDraftTotal = Object.values(inkDrafts).reduce((n, s) => n + s.length, 0);

  /**
   * 当前画笔操作覆盖的页（D105）：翻页单栏 = [current]，双栏 = [current, current+1]；
   * 滚动模式 = [scrollCurrent]。解决此前双栏右页笔迹无法撤销/清空的问题。
   */
  const inkPages = useCallback((): number[] => {
    if (isScroll) return [scrollCurrentRef.current];
    return visiblePages(current, settingsRef.current.pdfColumns);
  }, [isScroll, current]);

  /** 可见页中是否有已落库笔迹 */
  const inkHasSaved = useCallback(
    (page: number): boolean => inkStrokesOf(page).length > 0,
    [inkStrokesOf]
  );

  /** 撤销：在可见页里找草稿最多的页（右页优先），撤它最后一笔；再退到已落库笔迹。
   *  D106：被撤的一步压入 redo 栈，供「恢复」反向执行。 */
  const undoInk = useCallback(() => {
    const ctx = marksCtxRef.current;
    const pages = inkPages();
    const target = undoTargetPage(
      pages,
      (p) => inkDrafts[p]?.length ?? 0,
      (p) => inkStrokesOf(p).length > 0
    );
    if (target === null) return;
    const popped = popLastDraft(inkDrafts[target] ?? []);
    if (popped) {
      setInkRedo((prev) => [...prev, { kind: "draft", page: target, stroke: popped.last }]);
      setDraftFor(target, popped.rest);
      return;
    }
    if (!ctx) return;
    // 草稿已空：找该页最后一个带笔迹的标记，削掉最后一笔
    const candidates = ctx.marks.filter(
      (m) => m.locator.kind === "pdf" && m.locator.page === target && (m.locator.strokes?.length ?? 0) > 0
    );
    const last = candidates[candidates.length - 1];
    if (!last || last.locator.kind !== "pdf") return;
    const strokes = last.locator.strokes ?? [];
    if (strokes.length === 0) return;
    // 整组记入 redo：恢复时写回全部，避免逐笔增删的中间态
    setInkRedo((prev) => [
      ...prev,
      { kind: "saved", page: target, markId: last.id, strokes, color: last.color },
    ]);
    if (strokes.length > 1) {
      // 还有剩：写回剩余笔迹（App 侧 onUpdate 只支持 color，故走替换式更新）
      ctx.onReplaceInk?.(last.id, strokes.slice(0, -1));
    } else {
      ctx.onDelete(last.id);
    }
  }, [inkPages, inkDrafts, inkStrokesOf, setDraftFor]);

  /** 恢复（D106）：反向执行最近一次撤销；已落库标记若在撤销时被删则按记录重建 */
  const redoInk = useCallback(() => {
    const entry = inkRedo[inkRedo.length - 1];
    if (!entry) return;
    if (entry.kind === "draft") {
      setDraftFor(entry.page, [...(inkDrafts[entry.page] ?? []), entry.stroke]);
      setInkRedo((prev) => prev.slice(0, -1));
      return;
    }
    const ctx = marksCtxRef.current;
    const existing = ctx?.marks.find((m) => m.id === entry.markId && m.locator.kind === "pdf");
    if (existing) {
      ctx?.onReplaceInk?.(entry.markId, entry.strokes);
    } else {
      // 撤销时整条标记被删：用记录的颜色与页码重建（新 id，笔迹一致）
      ctx?.onAdd({
        color: entry.color,
        text: "",
        locator: { kind: "pdf", page: entry.page, quote: "", strokes: entry.strokes },
      });
    }
    setInkRedo((prev) => prev.slice(0, -1));
  }, [inkRedo, inkDrafts, setDraftFor]);

  /** 清空可见页画笔（草稿 + 已落库该页笔迹标记） */
  const clearInkPage = useCallback(() => {
    const ctx = marksCtxRef.current;
    const pages = inkPages();
    setInkRedo([]); // D106：清空是不可逆操作，redo 栈作废
    for (const page of pages) {
      setDraftFor(page, []);
      if (!ctx) continue;
      for (const m of ctx.marks) {
        if (m.locator.kind === "pdf" && m.locator.page === page && (m.locator.strokes?.length ?? 0) > 0) {
          ctx.onDelete(m.id);
        }
      }
    }
  }, [inkPages, setDraftFor]);

  /** 保存：把各页草稿落库。同页已有笔迹标记则追加进去，否则新建标记。 */
  const saveInk = useCallback(() => {
    const ctx = marksCtxRef.current;
    if (!ctx) return;
    setInkRedo([]); // D106：落库后历史作废，避免恢复到已保存的旧状态
    const pages = Object.keys(inkDrafts)
      .map(Number)
      .filter((p) => (inkDrafts[p]?.length ?? 0) > 0)
      .sort((a, b) => a - b);
    for (const page of pages) {
      const fresh = inkDrafts[page];
      const existing = ctx.marks.find(
        (m) => m.locator.kind === "pdf" && m.locator.page === page && (m.locator.strokes?.length ?? 0) > 0
      );
      if (existing && existing.locator.kind === "pdf") {
        ctx.onReplaceInk?.(existing.id, [...(existing.locator.strokes ?? []), ...fresh]);
      } else {
        ctx.onAdd({
          color: ctx.defaultColor,
          text: "",
          locator: { kind: "pdf", page, quote: "", strokes: fresh },
        });
      }
    }
    setInkDrafts({});
    setInkTool((t) => ({ ...t, active: false }));
  }, [inkDrafts]);

  // 跳转目标（§4.16/F35）：面板点条目 → 目标页置顶/翻页 + 页槽闪烁 1.6s。
  // 滚动模式复用初始恢复的重钉机制：未测量页先用估算高度落位，真实高度回填后再校正。
  useEffect(() => {
    const ctx = marksCtxRef.current;
    const jt = ctx?.jumpTarget ?? null;
    if (!jt || jt.nonce === jumpNonceRef.current) return;
    jumpNonceRef.current = jt.nonce;
    const loc = jt.mark.locator;
    if (loc.kind !== "pdf") {
      ctx?.onJumpDone();
      return;
    }
    const page = Math.min(Math.max(Math.round(loc.page), 1), Math.max(1, pageCountRef.current));
    if (isScroll) {
      const root = scrollRef.current;
      if (root) {
        initialRecoverRef.current = { active: true, target: page };
        root.scrollTo({ top: cumulativeTop(page - 1) });
      }
      scrollCurrentRef_set(page);
    } else {
      setCurrent(page);
    }
    const flash = () => {
      // 滚动模式闪页槽（canvas 虚拟化，槽恒在 DOM）；单页模式闪 .pdf-page 宿主
      const el = isScroll ? slotRefs.current[page - 1] : hostRef.current;
      if (!el) return false;
      el.classList.add("mark-flash");
      window.setTimeout(() => el.classList.remove("mark-flash"), 1600);
      return true;
    };
    if (!flash()) window.setTimeout(() => { if (!flash()) window.setTimeout(flash, 500); }, 300);
    ctx?.onJumpDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksCtx?.jumpTarget]);

  // ===== v0.2.9 / D110 / D112：Ctrl+滚轮调倍率，以鼠标为中心缩放 =====
  // D112：把短窗口内的连续 wheel 合并成一次 nudge —— 每个事件都 ±10% 会让
  // canvas 反复清空重绘、锚点反复校正，是「抖动严重」的主因。锚点仍取最后一次
  // 滚轮位置，保证合并后的那一次缩放仍以鼠标为中心。
  useEffect(() => {
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el) return;
    let acc = 0;
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const delta = wheelZoomDelta(acc);
      acc = 0;
      if (delta !== 0) viewRef.current?.onZoomNudge?.(delta);
    };
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault(); // 阻止浏览器默认页面缩放
      // D110：记下鼠标锚点；canvas 重排后由 applyZoomAnchor 校正滚动位置。
      // 窗口内重复滚轮会覆盖上一次锚点（以最后一次为准），符合连续缩放直觉。
      const elRect = el.getBoundingClientRect();
      const content = anchorContent(el);
      if (content) {
        const cRect = content.getBoundingClientRect();
        zoomAnchorRef.current = {
          vx: ev.clientX - elRect.left,
          vy: ev.clientY - elRect.top,
          px: ev.clientX - cRect.left,
          py: ev.clientY - cRect.top,
          w: cRect.width,
          h: cRect.height,
          at: Date.now(),
        };
      }
      acc += ev.deltaY;
      if (timer === null) timer = window.setTimeout(flush, PDF_WHEEL_THROTTLE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isScroll, pageCount, anchorContent]);

  // ===== D110：Ctrl+拖动平移视图 =====
  // 挂在阅读容器的 capture 阶段：先于 InkCanvas 的 React 处理器消费事件，
  // 避免按住 Ctrl 拖动画布时误落笔。setPointerCapture 让后续 move/up 都发到容器。
  useEffect(() => {
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el || pageCount <= 0) return;
    let panning = false;
    let panPid = -1;
    let startX = 0;
    let startY = 0;
    let startSL = 0;
    let startST = 0;
    const onDown = (ev: PointerEvent) => {
      if (!ev.ctrlKey || ev.button !== 0) return;
      panning = true;
      panPid = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      startSL = el.scrollLeft;
      startST = el.scrollTop;
      el.classList.add("pdf-panning");
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* 指针已释放等边界情况忽略 */
      }
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onMove = (ev: PointerEvent) => {
      if (!panning || ev.pointerId !== panPid) return;
      el.scrollLeft = startSL - (ev.clientX - startX);
      el.scrollTop = startST - (ev.clientY - startY);
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onUp = (ev: PointerEvent) => {
      if (!panning || ev.pointerId !== panPid) return;
      panning = false;
      panPid = -1;
      el.classList.remove("pdf-panning");
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* 忽略 */
      }
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove, true);
    el.addEventListener("pointerup", onUp, true);
    el.addEventListener("pointercancel", onUp, true);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onUp, true);
      el.classList.remove("pdf-panning", "pdf-pan-ready");
    };
  }, [isScroll, pageCount]);

  // D110：按住 Ctrl 时把阅读容器光标切成抓手，给出「可拖动」提示
  useEffect(() => {
    const el = isScroll ? scrollRef.current : areaRef.current;
    if (!el) return;
    const sync = (ev: KeyboardEvent) => el.classList.toggle("pdf-pan-ready", ev.ctrlKey);
    const clear = () => el.classList.remove("pdf-pan-ready");
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
      el.classList.remove("pdf-pan-ready");
    };
  }, [isScroll, pageCount]);

  // ===== v0.2.9：页码跳转（O11，随视觉基线一并落地）=====
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const flipFrom = useCallback((p: number, d: number) => {
    const n = pageCountRef.current;
    const cols = settingsRef.current.pdfColumns;
    if (cols === 2) return clampSpreadLeft(p + d * columnStep(cols), n);
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
                    <>
                      <canvas
                        className="pdf-canvas"
                        ref={(el) => {
                          canvasRefs.current[i] = el;
                        }}
                      />
                      {/* D101：画笔层叠在页面 canvas 上；尺寸取该页真实渲染尺寸。
                          heights 在该页渲染完成前为 0，此时退化为槽位占位高度，
                          保证画笔层在页面可见的第一时间就能画（回填后自动校正）。 */}
                      <InkCanvas
                        strokes={inkStrokesOf(i + 1)}
                        draftStrokes={inkDrafts[i + 1] ?? []}
                        pageW={widths[i] || box.w}
                        pageH={heights[i] || ESTIMATE_H}
                        tool={inkTool}
                        onStrokesChange={(next) => onInkStrokesChange(i + 1, next)}
                      />
                    </>
                  ) : (
                    <div className="pdf-page-placeholder" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* v0.3.0 标记本页（D73 页级）：滚动模式无控制条，用悬浮按钮 */}
        {marksCtx?.enabled && (
          <button
            type="button"
            className={"pdf-mark-fab" + (pageMarked ? " marked" : "")}
            onClick={onMarkPage}
            disabled={pageCount <= 0}
            title="把当前页加入标记记录（页级标记）"
            aria-label="标记本页"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span>标记本页</span>
          </button>
        )}
        {/* D101：画笔入口（滚动模式浮在右下角，与「标记本页」并排） */}
        {marksCtx?.enabled && pageCount > 0 && !inkTool.active && (
          <button
            type="button"
            className="pdf-ink-fab"
            onClick={() => setInkTool((t) => ({ ...t, active: true }))}
            title="在页面上做记号（高亮笔 / 自由笔 / 橡皮擦）"
            aria-label="画笔"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
            <span>画笔</span>
          </button>
        )}
        {marksCtx?.enabled && inkTool.active && (
          <PdfInkToolbar
            tool={inkTool}
            draftCount={inkDraftTotal}
            canClear={canClearInk([scrollCurrent], (p) => inkDrafts[p]?.length ?? 0, inkHasSaved)}
            canUndo={canUndoInk([scrollCurrent], (p) => inkDrafts[p]?.length ?? 0, inkHasSaved)}
            canRedo={canRedoInk(inkRedo)}
            onChange={(patch) => setInkTool((t) => ({ ...t, ...patch }))}
            onUndo={undoInk}
            onRedo={redoInk}
            onClearPage={clearInkPage}
            onSave={saveInk}
            onClose={() => {
              // 「完成」= 保存并退出：静默丢弃未保存笔迹会让用户白画一通，
              // 故有草稿时先落库再退出（与「保存」的唯一差别是不显式提示）。
              if (inkDraftTotal > 0) saveInk();
              else setInkTool((t) => ({ ...t, active: false }));
            }}
          />
        )}
      </section>
    );
  }

  // D102：栏数来自独立设置，与适配方式/倍率完全解耦——缩放永不改变栏数
  const spreadOn = settings.pdfColumns === 2;
  const nextLimit = spreadOn ? spreadLeftMax(pageCount) : pageCount;
  const chipFit = settings.pdfFit;

  return (
    <section className="state state-pdf active" aria-label="PDF 显示">
      <div className="pdf-canvas-area" ref={areaRef}>
        <div className="pdf-page" ref={hostRef} data-spread={spreadOn ? "1" : "0"}>
          {spreadOn ? (
            <>
              <div className="pdf-page-cell">
                <canvas
                  className="pdf-canvas"
                  ref={(el) => {
                    canvasRefs.current[0] = el;
                  }}
                />
                {/* D101：画笔层（左页） */}
                <InkCanvas
                  strokes={inkStrokesOf(current)}
                  draftStrokes={inkDrafts[current] ?? []}
                  pageW={inkBox.w}
                  pageH={inkBox.h}
                  tool={inkTool}
                  onStrokesChange={(next) => onInkStrokesChange(current, next)}
                />
              </div>
              <div className="pdf-page-cell">
                <canvas
                  className="pdf-canvas"
                  ref={(el) => {
                    canvasRefs.current[1] = el;
                  }}
                />
                {/* D101：画笔层（右页） */}
                <InkCanvas
                  strokes={inkStrokesOf(current + 1)}
                  draftStrokes={inkDrafts[current + 1] ?? []}
                  pageW={inkBox.w}
                  pageH={inkBox.h}
                  tool={inkTool}
                  onStrokesChange={(next) => onInkStrokesChange(current + 1, next)}
                />
              </div>
            </>
          ) : (
            <>
              <canvas
                className="pdf-canvas"
                ref={(el) => {
                  canvasRefs.current[0] = el;
                }}
              />
              {/* D101：画笔层（单页） */}
              <InkCanvas
                strokes={inkStrokesOf(current)}
                draftStrokes={inkDrafts[current] ?? []}
                pageW={inkBox.w}
                pageH={inkBox.h}
                tool={inkTool}
                onStrokesChange={(next) => onInkStrokesChange(current, next)}
              />
            </>
          )}
          {pageCount > 0 && <div className="pdf-footer">— {current} —</div>}
        </div>
      </div>
      {/* D101：画笔工具栏（翻页模式浮在控制条上方） */}
      {marksCtx?.enabled && inkTool.active && (
        <PdfInkToolbar
          tool={inkTool}
          draftCount={inkDraftTotal}
          canClear={canClearInk(
            visiblePages(current, settings.pdfColumns),
            (p) => inkDrafts[p]?.length ?? 0,
            inkHasSaved
          )}
          canUndo={canUndoInk(
            visiblePages(current, settings.pdfColumns),
            (p) => inkDrafts[p]?.length ?? 0,
            inkHasSaved
          )}
          canRedo={canRedoInk(inkRedo)}
          onChange={(patch) => setInkTool((t) => ({ ...t, ...patch }))}
          onUndo={undoInk}
          onRedo={redoInk}
          onClearPage={clearInkPage}
          onSave={saveInk}
          onClose={() => {
            if (inkDraftTotal > 0) saveInk();
            else setInkTool((t) => ({ ...t, active: false }));
          }}
        />
      )}
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
        {/* v0.3.0 标记本页（D73 页级）：无文本层，页级标记即本版 PDF 全部标记能力 */}
        {marksCtx?.enabled && (
          <button
            type="button"
            className={"pg-btn pg-mark" + (pageMarked ? " marked" : "")}
            onClick={onMarkPage}
            disabled={pageCount <= 0}
            title="把当前页加入标记记录（页级标记）"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            标记本页
          </button>
        )}
        {/* D101：画笔入口（翻页模式放在控制条内） */}
        {marksCtx?.enabled && pageCount > 0 && !inkTool.active && (
          <button
            type="button"
            className="pg-btn pg-ink"
            onClick={() => setInkTool((t) => ({ ...t, active: true }))}
            title="在页面上做记号（高亮笔 / 自由笔 / 橡皮擦）"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
            画笔
          </button>
        )}
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
            <span>
              {(chipFit === "custom" ? "自定义" : FIT_LABELS[migratePdfFit(chipFit)]) +
                " · " +
                (settings.pdfColumns === 2 ? "双栏" : "单栏") +
                " " +
                (scalePct > 0 ? scalePct + "%" : "—")}
            </span>
            <span className="cv">&#9662;</span>
          </button>
          {zoomMenuOpen && (
            <div className="zoom-menu" role="menu">
              <div className="menu-title">适配方式</div>
              {PDF_FITS.map((f: PdfFit) => {
                const ratio = fitRatio(lastResolvedRef.current, f, settings.pdfZoom);
                // D102：存量配置可能是 spread（旧的「双页」口径），比较时按迁移后的值
                const cur = migratePdfFit(chipFit) === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="menuitemradio"
                    aria-checked={cur}
                    className={"menu-item" + (cur ? " current" : "")}
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
              {/* D102：栏数独立开关——任何适配方式/倍率下都保持不变 */}
              <div className="menu-title">页面布局</div>
              <div className="menu-presets">
                {([1, 2] as PdfColumns[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={settings.pdfColumns === c ? "on" : ""}
                    aria-pressed={settings.pdfColumns === c}
                    onClick={() => {
                      viewRef.current?.onColumnsChange?.(c);
                      setZoomMenuOpen(false);
                    }}
                  >
                    {c === 1 ? "单栏" : "双栏"}
                  </button>
                ))}
              </div>
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
