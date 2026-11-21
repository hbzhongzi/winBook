// PDF 缩放适配纯函数层（v0.2.9，方案 §3.4「单一真相」）。
// 零 DOM 依赖：输入容器内盒尺寸 + 页面基准尺寸 + 用户设置，输出渲染/位图尺寸。
// PdfViewer（单页/滚动/双栏三路）、档位菜单、Toolbar、StatusBar 共用本层，
// 保证「同一本书、同一个容器」下各处读数一致。
//
// D102 重要变更：**栏数与适配方式彻底解耦**。
// 旧实现把「双页」做成 `pdfFit` 的一个取值（spread），于是用户选自适应 / 适宽 /
// 适高 / 自定义任一适配方式时栏数都被迫退回单页——「缩放会打破双栏」的根因。
// 现在 `pdfColumns: 1 | 2` 是独立维度，本层所有函数都接受 columns，任何适配方式、
// 任何倍率下栏数恒定。`spread` 仅作为旧配置的兼容别名保留（归一时转成 columns=2）。

/** 适配方式：auto=自适应 / width=适宽 / height=适高 / custom=自定义
 *  （`spread` 为 v0.2.9 旧取值，仅为兼容存量配置保留，D102 起不再出现在菜单里） */
export type PdfFit = "auto" | "width" | "height" | "spread" | "custom";

/** 菜单里可选的适配方式（D102：剔除 spread，双栏改由独立的「单栏/双栏」开关切换） */
export const PDF_FITS: PdfFit[] = ["auto", "width", "height", "custom"];
/** 全部合法取值（含兼容别名），仅供归一化白名单使用 */
export const PDF_FITS_ALL: PdfFit[] = ["auto", "width", "height", "spread", "custom"];
export const PDF_FIT_DEFAULT: PdfFit = "auto";

/** 栏数（D102）：1 = 单栏，2 = 双栏并排 */
export type PdfColumns = 1 | 2;
export const PDF_COLUMNS_DEFAULT: PdfColumns = 1;

/** 面板/菜单/状态栏展示名 */
export const FIT_LABELS: Record<PdfFit, string> = {
  auto: "自适应",
  width: "适宽",
  height: "适高",
  spread: "单页/双页",
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
/** 双栏模式两页间距 px（与 HTML 基线一致） */
export const PDF_PAGE_GAP = 14;

export type ResolvedPdfScale = {
  /** 生效的适配方式（auto 已解析为 width/height；spread 已迁移为 width/height 口径） */
  fit: "width" | "height" | "custom";
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
  /** 各适配在当前容器/页面下的倍率：供档位菜单显示「选它实际是多少」 */
  sw: number;
  sh: number;
  /** 双栏适配倍率（1 栏时等于 sw，仅供内部/兼容引用） */
  sp: number;
};

/** 白名单归一化：非法值（含 undefined/手改存储）回落 auto */
export function normalizePdfFit(v: unknown): PdfFit {
  return typeof v === "string" && (PDF_FITS_ALL as string[]).includes(v) ? (v as PdfFit) : PDF_FIT_DEFAULT;
}

/**
 * 栏数归一化（D102）：显式 1/2 才采用；缺字段从旧口径迁移
 * （`pdfFit === "spread"` → 2），否则 1。
 */
export function normalizePdfColumns(v: unknown, legacyFit?: unknown): PdfColumns {
  if (v === 1 || v === 2) return v;
  return normalizePdfFit(legacyFit) === "spread" ? 2 : 1;
}

/**
 * 迁移后的适配方式：`spread` 是 v0.2.9 的「双页」取值，D102 起栏数独立，
 * 故把它等价改写为 auto（双页的倍率本来就是「两页一起按适宽/适高取小」，
 * auto 在双栏下会算出完全相同的效果，见 resolvePdfScale）。
 */
export function migratePdfFit(fit: PdfFit): PdfFit {
  const f = normalizePdfFit(fit);
  return f === "spread" ? "auto" : f;
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
 * 解析缩放（方案 §3.1 判定式，D102 增加 columns，D103 修正双栏倍率基准）。
 *
 * - 单页：适宽 sw = cw/pw；适高 sh = ch/ph；auto = sw > sh ? width : height
 * - 双栏：两页并排，可用宽度要先扣掉页间距，故
 *     sw2 = (cw − gap) / (2·pw)、sh 不变，auto 依旧取「谁大用谁」
 * - custom：**倍率的 100% 基准随栏数走**
 *     单栏 100% = 页面基准宽 pw（与 v0.2.9 完全一致，存量零回归）
 *     双栏 100% = 双栏可用宽的一半 (cw − gap) / 2
 *   D103 根因（用户截图实证）：此前 custom 恒用 pw × zoom/100，双栏时两页总宽
 *   变成「2 页 × 单栏基准」，必然横向溢出容器、左右都被裁切，且一放大缩小就破栏。
 *   现在双栏 100% 恰好两页铺满，「100% 就是看着刚刚好」成为一致直觉。
 *   关键：栏数只改变**倍率基准**，不改变「一次铺几页」——因此怎么缩放都不破栏。
 * - 容器未测量（cw/ch ≤ 0）或页面尺寸非法时 scale = 0，调用方据此跳过渲染
 */
export function resolvePdfScale(
  fit: PdfFit,
  zoom: number,
  cw: number,
  ch: number,
  pw: number,
  ph: number,
  dprEnabled: boolean,
  columns: PdfColumns = PDF_COLUMNS_DEFAULT
): ResolvedPdfScale {
  const dpr = currentDpr(dprEnabled);
  const okBox = cw > 0 && ch > 0;
  const okPage = pw > 0 && ph > 0;
  const cols = columns === 2 ? 2 : 1;
  // 双栏时中间有 gap，可用宽度要扣掉；单栏不扣
  const usableW = cols === 2 ? Math.max(0, cw - PDF_PAGE_GAP) : cw;
  const sw = okBox && okPage ? usableW / (cols * pw) : 0;
  const sh = okBox && okPage ? ch / ph : 0;
  const sp = sw; // 兼容字段：双栏倍率即 sw（已按栏数折算）
  const normFit = migratePdfFit(fit);
  const resolved: ResolvedPdfScale["fit"] =
    normFit === "auto" ? (sw > sh ? "width" : "height") : normFit === "custom" ? "custom" : (normFit as "width" | "height");
  // 自定义倍率（D103）：100% 的基准宽 = 该栏数下「每页的可用宽」。
  // 单栏 = cw（等价于传统 pw×zoom/100 只在 pw≈cw 时……故单栏保持 pw 基准以免存量跳动）
  // 双栏 = (cw − gap)/2，使 100% 恰好两页铺满。
  const baseW = cols === 2 ? (okBox ? usableW / 2 : pw) : pw;
  const sCustom = okPage ? (baseW / pw) * (clampPdfZoom(zoom) / 100) : 0;
  const scale = resolved === "width" ? sw : resolved === "height" ? sh : sCustom;
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

/** 翻页步进：栏数即步进（双栏 2 页，单栏 1 页） */
export function columnStep(columns: PdfColumns): number {
  return columns === 2 ? 2 : 1;
}

/**
 * @deprecated D102 起用 `columnStep(settings.pdfColumns)`。旧的 `spreadStep(fit)`
 * 把栏数绑在适配方式上，正是「缩放打破双栏」的根因，仅保留以防外部引用断裂。
 */
export function spreadStep(fit: PdfFit): number {
  return migratePdfFit(fit) === "spread" ? 2 : 1;
}

/**
 * 双栏左页码：奇数页 → 自身（右页为次页）；偶数页 → 该页−1（还原为「该页在右」的摊开视图）。
 * 方案 §6 风险 3 的钳制规则，单测覆盖。
 */
export function spreadLeftPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  const p = Math.max(1, Math.round(page));
  return p % 2 === 1 ? p : p - 1;
}

/** 双栏左页码上限：总页数为偶数 → 末页在前一页左侧摊开；奇数 → 末页单独一页 */
export function spreadLeftMax(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 1) return 1;
  const n = Math.round(pageCount);
  return n % 2 === 0 ? n - 1 : n;
}

/** 双栏左页码钳制（翻页与恢复共用） */
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
 * 注意：r 已按当前栏数算出，故这里再切栏数会即时更新（菜单读数与栏数一致）。
 */
export function fitRatio(r: ResolvedPdfScale | null, fit: PdfFit, zoom: number): number | null {
  if (!r) return null;
  switch (migratePdfFit(fit)) {
    case "auto":
      return r.fit === "width" ? r.sw : r.sh;
    case "width":
      return r.sw;
    case "height":
      return r.sh;
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
  /** 切换栏数（D102）：1 单栏 / 2 双栏，与适配方式无关 */
  onColumnsChange?: (columns: PdfColumns) => void;
};
