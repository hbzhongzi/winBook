// PDF 缩放适配纯函数层（v0.2.9，方案 §3.4「单一真相」）。
// 零 DOM 依赖：输入容器内盒尺寸 + 页面基准尺寸 + 用户设置，输出渲染/位图尺寸。
// PdfViewer（单页/滚动/双页三路）、档位菜单、Toolbar、StatusBar 共用本层，
// 保证「同一本书、同一个容器」下各处读数一致。

/** 适配方式：auto=自适应 / width=适宽 / height=适高 / spread=双页 / custom=自定义 */
export type PdfFit = "auto" | "width" | "height" | "spread" | "custom";

export const PDF_FITS: PdfFit[] = ["auto", "width", "height", "spread", "custom"];
export const PDF_FIT_DEFAULT: PdfFit = "auto";

/** 面板/菜单/状态栏展示名 */
export const FIT_LABELS: Record<PdfFit, string> = {
  auto: "自适应",
  width: "适宽",
  height: "适高",
  spread: "双页",
  custom: "自定义",
};

export const PDF_ZOOM_MIN = 50;
export const PDF_ZOOM_MAX = 400;
export const PDF_ZOOM_DEFAULT = 100;
export const PDF_ZOOM_STEP = 5;
/** 工具栏 ± 与 Ctrl+滚轮的单次步进（HTML 基线口径：±10） */
export const PDF_ZOOM_NUDGE = 10;
/** 档位菜单倍率预设（HTML 基线口径） */
export const PDF_ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300];
/** 位图倍率上限：再高内存 ×dpr² 增长陡峭（D68） */
export const PDF_DPR_MAX = 2;
/** 双页模式两页间距 px（与 HTML 基线一致） */
export const PDF_PAGE_GAP = 14;

export type ResolvedPdfScale = {
  /** auto 已解析为 width/height 后的实际模式（spread/custom 原样） */
  fit: "width" | "height" | "spread" | "custom";
  /** 缩放倍率（相对页面基准尺寸） */
  scale: number;
  /** CSS 显示尺寸 px（单页） */
  cssW: number;
  cssH: number;
  /** 实际位图倍率（关闭高清时锁 1） */
  dpr: number;
  /** 位图像素尺寸 */
  bmpW: number;
  bmpH: number;
  /** 三种适配在当前容器/页面下的倍率：供档位菜单显示「选它实际是多少」 */
  sw: number;
  sh: number;
  sp: number;
};

/** 白名单归一化：非法值（含 undefined/手改存储）回落 auto */
export function normalizePdfFit(v: unknown): PdfFit {
  return typeof v === "string" && (PDF_FITS as string[]).includes(v) ? (v as PdfFit) : PDF_FIT_DEFAULT;
}

/** 自定义倍率钳制：NaN/非数字回落默认 100 */
export function clampPdfZoom(v: number): number {
  if (!Number.isFinite(v)) return PDF_ZOOM_DEFAULT;
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, Math.round(v)));
}

/** 当前生效位图倍率：devicePixelRatio 上限 2；关闭高清锁 1（SSR/测试环境无 window 时按 1） */
export function currentDpr(enabled: boolean): number {
  if (!enabled) return 1;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(dpr, PDF_DPR_MAX);
}

/**
 * 解析缩放（方案 §3.1 判定式）。
 *
 * - 适宽 sw = cw/pw；适高 sh = ch/ph；双页 sp = min(cw/(2·pw), ch/ph)
 * - auto = sw > sh ? width : height（等价于容器宽高比 > 页面宽高比时适宽）
 * - 容器未测量（cw/ch ≤ 0）或页面尺寸非法时 scale = 0，调用方据此跳过渲染
 */
export function resolvePdfScale(
  fit: PdfFit,
  zoom: number,
  cw: number,
  ch: number,
  pw: number,
  ph: number,
  dprEnabled: boolean
): ResolvedPdfScale {
  const dpr = currentDpr(dprEnabled);
  const okBox = cw > 0 && ch > 0;
  const okPage = pw > 0 && ph > 0;
  const sw = okBox && okPage ? cw / pw : 0;
  const sh = okBox && okPage ? ch / ph : 0;
  const sp = okBox && okPage ? Math.min(cw / (2 * pw), ch / ph) : 0;
  const normFit = normalizePdfFit(fit);
  const resolved: ResolvedPdfScale["fit"] =
    normFit === "auto" ? (sw > sh ? "width" : "height") : normFit === "custom" ? "custom" : normFit;
  const scale =
    resolved === "width" ? sw : resolved === "height" ? sh : resolved === "spread" ? sp : clampPdfZoom(zoom) / 100;
  const cssW = okPage ? Math.round(pw * scale) : 0;
  const cssH = okPage ? Math.round(ph * scale) : 0;
  return {
    fit: resolved,
    scale,
    cssW,
    cssH,
    dpr,
    bmpW: Math.round(cssW * dpr),
    bmpH: Math.round(cssH * dpr),
    sw,
    sh,
    sp,
  };
}

/** 翻页步进：双页模式 2 页，其余 1 页 */
export function spreadStep(fit: PdfFit): number {
  return normalizePdfFit(fit) === "spread" ? 2 : 1;
}

/**
 * 双页左页码：奇数页 → 自身（右页为次页）；偶数页 → 该页−1（还原为「该页在右」的摊开视图）。
 * 方案 §6 风险 3 的钳制规则，单测覆盖。
 */
export function spreadLeftPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  const p = Math.max(1, Math.round(page));
  return p % 2 === 1 ? p : p - 1;
}

/** 双页左页码上限：总页数为偶数 → 末页在前一页左侧摊开；奇数 → 末页单独一页 */
export function spreadLeftMax(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 1) return 1;
  const n = Math.round(pageCount);
  return n % 2 === 0 ? n - 1 : n;
}

/** 双页左页码钳制（翻页与恢复共用） */
export function clampSpreadLeft(page: number, pageCount: number): number {
  return Math.min(Math.max(spreadLeftPage(page), 1), spreadLeftMax(pageCount));
}

/** 倍率微调（工具栏 ± / Ctrl+滚轮）：钳制后返回；无变化返回原值 */
export function nudgeZoom(current: number, delta: number): number {
  return clampPdfZoom(current + delta);
}

/**
 * 档位菜单中各适配方式在当前容器/页面下的实际倍率。
 * r 为 null（尚未测量/渲染）时返回 null，菜单显示「—」。
 */
export function fitRatio(r: ResolvedPdfScale | null, fit: PdfFit, zoom: number): number | null {
  if (!r) return null;
  switch (normalizePdfFit(fit)) {
    case "auto":
      return r.fit === "width" ? r.sw : r.sh;
    case "width":
      return r.sw;
    case "height":
      return r.sh;
    case "spread":
      return r.sp;
    default:
      return clampPdfZoom(zoom) / 100;
  }
}

/**
 * PDF 视图交互回调（v0.2.9）：Viewer 只发请求，统一由 App 写 settings 持久化，
 * 保证「四处入口写同一状态」（HTML 基线口径）。
 */
export type PdfViewHandlers = {
  /** 实际缩放上报（仅变化时触发）：工具栏数值 / 状态栏文案 / chip 读数同一真相 */
  onScaleReport?: (r: { pct: number; fit: PdfFit }) => void;
  /** 切换适配方式 */
  onFitChange?: (fit: PdfFit) => void;
  /** 选用倍率预设（自动切到「自定义」） */
  onZoomPreset?: (zoom: number) => void;
  /** 倍率微调（Ctrl+滚轮 / 工具栏 ±） */
  onZoomNudge?: (delta: number) => void;
};
