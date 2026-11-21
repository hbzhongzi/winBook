// 标记记录（v0.3.0 F31–F38）：划词高亮 + 阅读感悟，按书管理。
// 存储于 localStorage 键 bookeditor.marks.v1；变更经订阅机制广播
// （同页 listeners + storage 事件，与 library v1 / settings v4 一致，
// 支持多实例同步）。
// 实施口径见 doce/BookEditor-v0.3.0-标记记录模块开发方案.md 第 3 章。
//
// 与 library 的差异（D69）：marks 每次操作即时写盘，不纳入退出 flush
// ——标记是低频显式操作，即时落库语义更简单，flush 链路已为 position 定制。

/** 高亮四色（与设置面板默认色、HTML 基线同一份白名单） */
export type MarkColor = "yellow" | "green" | "blue" | "pink";
export const MARK_COLORS: MarkColor[] = ["yellow", "green", "blue", "pink"];

/** 面板/提示展示名 */
export const MARK_COLOR_LABELS: Record<MarkColor, string> = {
  yellow: "黄",
  green: "绿",
  blue: "蓝",
  pink: "粉",
};

/**
 * PDF 画笔笔刷（D101）：
 * - highlighter：半透明粗笔，模拟荧光笔，覆盖在正文上仍可读；
 * - pen：自由笔，实色细线；
 * - eraser：橡皮擦（**不落库**，只删本页已绘笔画）。
 */
export type PdfBrush = "highlighter" | "pen" | "eraser";
export const PDF_BRUSHES: PdfBrush[] = ["highlighter", "pen", "eraser"];

/** 画笔颜色白名单（比划词高亮多两色：墨黑用于书写、红用于批注强调） */
export type PdfInkColor = "yellow" | "green" | "blue" | "pink" | "ink" | "red";
export const PDF_INK_COLORS: PdfInkColor[] = ["yellow", "green", "blue", "pink", "red", "ink"];

export const PDF_INK_HEX: Record<PdfInkColor, string> = {
  yellow: "#f5c518",
  green: "#38b26a",
  blue: "#3b82f6",
  pink: "#ec4899",
  red: "#e5484d",
  ink: "#1f2328",
};

/**
 * 一条笔迹（D101）。
 *
 * 坐标单位按用户选择存**像素**（绘制时该页 canvas 的 CSS 像素），但每条笔迹
 * 额外记录 `baseW`/`baseH`（绘制时的页面 CSS 尺寸）。渲染时按
 * `当前尺寸 / baseW` 等比缩放——这样：
 *   1. 存储口径确实是用户要的像素坐标，语义直观、便于排查；
 *   2. 缩放、适宽、窗口拉伸、DPR 变化后笔迹**仍然对齐**，不会飘移。
 * 若只存像素而不存基准尺寸，任何缩放都会整体错位（这是像素坐标方案的固有缺陷，
 * 用 baseW/baseH 做归一化可完全规避，代价只是每笔多两个数）。
 */
export type PdfStroke = {
  /** 笔刷类型（eraser 不落库） */
  brush: Exclude<PdfBrush, "eraser">;
  color: PdfInkColor;
  /** 线宽（绘制时 CSS 像素，随页面等比缩放） */
  width: number;
  /** 坐标序列 [x0,y0,x1,y1,...]，绘制时 canvas CSS 像素 */
  points: number[];
  /** 绘制时页面 CSS 宽高（归一化基准） */
  baseW: number;
  baseH: number;
  /** 笔迹在页面上的起始纵向位置占页高比例（0~1），用于「按页内位置」排序 */
  top: number;
};

/**
 * 三格式定位器：
 * - EPUB：CFI（epubjs annotations 渲染高亮，display(cfi) 跳转）；
 * - TXT：字符偏移（字号无关，与 ReadingPosition.anchor 同口径）；
 * - PDF：页码 + quote + strokes（D101 画笔笔迹，无笔迹时为空数组）。
 */
export type MarkLocator =
  | { kind: "epub"; cfi: string; href: string; chapter: string }
  | { kind: "txt"; start: number; end: number }
  | { kind: "pdf"; page: number; quote: string; strokes?: PdfStroke[] };

export type Mark = {
  id: string;
  /** 归属图书（书架 path 主键） */
  bookPath: string;
  color: MarkColor;
  /** 划选原文（独立想法为空串） */
  text: string;
  /** 感悟（空串 = 纯高亮，合法） */
  note: string;
  locator: MarkLocator;
  /** true = 独立想法（不依赖选区；PDF 页级标记同为无原文条目） */
  idea?: boolean;
  createdAt: number;
  updatedAt: number;
};

export const MARKS_KEY = "bookeditor.marks.v1";
/** 单本上限：超出静默淘汰最旧（D66） */
export const PER_BOOK_LIMIT = 500;
/** 总上限：超出按 updatedAt 静默淘汰最旧（D66） */
export const TOTAL_LIMIT = 2000;
/** 原文存储上限（超长截断，防异常选区写爆存储） */
const MAX_TEXT = 2000;
/** 划词最小长度：低于不弹工具条（方案 §4.1） */
export const MARK_SELECT_MIN = 8;

type MarksFile = { version: 1; marks: Mark[] };
type Listener = (marks: Mark[]) => void;

const listeners = new Set<Listener>();

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isColor(v: unknown): v is MarkColor {
  return typeof v === "string" && (MARK_COLORS as string[]).includes(v);
}

function isInkColor(v: unknown): v is PdfInkColor {
  return typeof v === "string" && (PDF_INK_COLORS as string[]).includes(v);
}

/** 单页笔迹条数上限：防止异常数据写爆存储（正常手写一页远低于此值） */
export const MAX_STROKES_PER_PAGE = 200;
/** 单条笔迹点数上限 */
const MAX_POINTS_PER_STROKE = 4000;

/**
 * 笔迹校验（D101）：任何一处不合法就整条丢弃——
 * 画笔数据只在「绘制时」产生，损坏的笔迹重放出来会是乱线，不如不画。
 */
function normalizeStroke(raw: unknown): PdfStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.brush !== "highlighter" && r.brush !== "pen") return null;
  if (!isInkColor(r.color)) return null;
  const width = Number(r.width);
  const baseW = Number(r.baseW);
  const baseH = Number(r.baseH);
  if (!Number.isFinite(width) || width <= 0 || width > 200) return null;
  if (!Number.isFinite(baseW) || baseW <= 0) return null;
  if (!Number.isFinite(baseH) || baseH <= 0) return null;
  if (!Array.isArray(r.points)) return null;
  const pts = r.points.slice(0, MAX_POINTS_PER_STROKE);
  // 至少两个点（4 个数）才构成一条可画的线
  if (pts.length < 4 || pts.length % 2 !== 0) return null;
  const clean: number[] = [];
  for (const p of pts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < -1_000_000 || n > 1_000_000) return null;
    clean.push(n);
  }
  const top = Number(r.top);
  return {
    brush: r.brush,
    color: r.color,
    width,
    points: clean,
    baseW,
    baseH,
    top: Number.isFinite(top) ? Math.min(1, Math.max(0, top)) : 0,
  };
}

function normalizeStrokes(raw: unknown): PdfStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: PdfStroke[] = [];
  for (const s of raw.slice(0, MAX_STROKES_PER_PAGE)) {
    const n = normalizeStroke(s);
    if (n) out.push(n);
  }
  return out;
}

function normalizeLocator(raw: unknown): MarkLocator | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "epub") {
    if (typeof r.cfi !== "string" || !r.cfi) return null;
    return {
      kind: "epub",
      cfi: r.cfi,
      href: typeof r.href === "string" ? r.href : "",
      chapter: typeof r.chapter === "string" ? r.chapter : "",
    };
  }
  if (r.kind === "txt") {
    const start = clampInt(Number(r.start), 0, 1_000_000_000, -1);
    const end = clampInt(Number(r.end), 0, 1_000_000_000, -1);
    if (start < 0 || end < start) return null;
    return { kind: "txt", start, end };
  }
  if (r.kind === "pdf") {
    const page = clampInt(Number(r.page), 1, 1_000_000, 0);
    if (page < 1) return null;
    const strokes = normalizeStrokes(r.strokes);
    return {
      kind: "pdf",
      page,
      quote: typeof r.quote === "string" ? r.quote.slice(0, MAX_TEXT) : "",
      // 空数组不写字段：纯书签条目保持与 v0.3.0 完全一致的存储形态（向后兼容）
      ...(strokes.length ? { strokes } : {}),
    };
  }
  return null;
}

/** 逐条校验：结构不合法返回 null（调用方丢弃该条） */
export function normalizeMark(raw: unknown): Mark | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.bookPath !== "string" || !r.bookPath) return null;
  let locator = normalizeLocator(r.locator);
  // 独立想法（idea=true）不依赖选区定位（§4.10）：EPUB 完全无实时位置时
  // ideaLocator 只能给空 cfi，而 normalizeLocator 拒绝空 cfi，会让想法条目
  // 在 loadMarks 时被整条丢弃——表现为「写想法后保存成功、面板仍 0 条」（D77）。
  // 这里仅为 idea 条目补一个合法占位 cfi；划词标记仍要求真实 cfi（既有校验口径不变）。
  if (!locator && r.idea === true && r.locator && typeof r.locator === "object") {
    const l = r.locator as Record<string, unknown>;
    if (l.kind === "epub") {
      locator = {
        kind: "epub",
        cfi: typeof l.cfi === "string" && l.cfi ? l.cfi : "epubcfi(/)",
        href: typeof l.href === "string" ? l.href : "",
        chapter: typeof l.chapter === "string" ? l.chapter : "",
      };
    }
  }
  if (!locator) return null;
  const text = typeof r.text === "string" ? r.text.slice(0, MAX_TEXT) : "";
  const note = typeof r.note === "string" ? r.note.slice(0, MAX_TEXT) : "";
  return {
    id: typeof r.id === "string" && r.id ? r.id : "",
    bookPath: r.bookPath,
    color: isColor(r.color) ? r.color : "yellow",
    text,
    note,
    locator,
    ...(r.idea === true ? { idea: true } : {}),
    createdAt: clampInt(Number(r.createdAt), 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampInt(Number(r.updatedAt), 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

/** 读取 + 校验；损坏 JSON / version 不符整体回落 [] */
export function loadMarks(): Mark[] {
  let parsed: unknown = null;
  try {
    const text = localStorage.getItem(MARKS_KEY);
    if (text) parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const file = parsed as Partial<MarksFile>;
  if (file.version !== 1 || !Array.isArray(file.marks)) return [];
  return file.marks
    .map(normalizeMark)
    .filter((m): m is Mark => m !== null && m.id !== "");
}

/** 单本书的标记（按 updatedAt 倒序） */
export function bookMarks(bookPath: string): Mark[] {
  return loadMarks()
    .filter((m) => m.bookPath === bookPath)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function persist(marks: Mark[]): Mark[] {
  const trimmed =
    marks.length > TOTAL_LIMIT
      ? [...marks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, TOTAL_LIMIT)
      : marks;
  try {
    const file: MarksFile = { version: 1, marks: trimmed };
    localStorage.setItem(MARKS_KEY, JSON.stringify(file));
  } catch {
    // 隐私模式/存储不可用时静默降级为内存态（返回仍反映内存结果）
  }
  listeners.forEach((fn) => fn(trimmed));
  return trimmed;
}

/** 生成主键：时间戳 + 随机后缀（同毫秒多次创建不碰撞） */
function newId(): string {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 新建标记；返回落库后的 Mark（含 id）。触发单本/总量淘汰（D66）。 */
export function addMark(input: {
  bookPath: string;
  color: MarkColor;
  text: string;
  note?: string;
  locator: MarkLocator;
  idea?: boolean;
}): Mark {
  const now = Math.floor(Date.now() / 1000);
  const mark: Mark = {
    id: newId(),
    bookPath: input.bookPath,
    color: isColor(input.color) ? input.color : "yellow",
    text: input.text.slice(0, MAX_TEXT),
    note: (input.note ?? "").slice(0, MAX_TEXT),
    locator: input.locator,
    ...(input.idea ? { idea: true } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const all = loadMarks();
  const next = [...all, mark];
  // 单本淘汰：只保留该书最新的 PER_BOOK_LIMIT 条
  const sameBook = next.filter((m) => m.bookPath === mark.bookPath);
  const overflow = sameBook.length - PER_BOOK_LIMIT;
  if (overflow > 0) {
    const drop = new Set(
      [...sameBook].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, overflow).map((m) => m.id)
    );
    persist(next.filter((m) => !drop.has(m.id)));
  } else {
    persist(next);
  }
  return mark;
}

/** 更新字段（note/color/text）；刷新 updatedAt 并置顶 */
export function updateMark(
  id: string,
  patch: { note?: string; color?: MarkColor; text?: string; strokes?: PdfStroke[] }
): void {
  const all = loadMarks();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const cur = all[idx];
  let locator = cur.locator;
  // D101：笔迹替换只对 PDF 定位器有意义（其它格式没有画笔层）
  if (patch.strokes !== undefined && locator.kind === "pdf") {
    const clean = normalizeStrokes(patch.strokes);
    locator = {
      ...locator,
      ...(clean.length ? { strokes: clean } : { strokes: undefined }),
    } as MarkLocator;
  }
  const next: Mark = {
    ...cur,
    locator,
    ...(patch.note !== undefined ? { note: patch.note.slice(0, MAX_TEXT) } : {}),
    ...(patch.color !== undefined && isColor(patch.color) ? { color: patch.color } : {}),
    ...(patch.text !== undefined ? { text: patch.text.slice(0, MAX_TEXT) } : {}),
    updatedAt: Math.floor(Date.now() / 1000),
  };
  all[idx] = next;
  persist(all);
}

export function removeMark(id: string): void {
  persist(loadMarks().filter((m) => m.id !== id));
}

/** 批量移除：单次写盘 + 单次广播（D59 口径） */
export function removeMarks(ids: string[]): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  persist(loadMarks().filter((m) => !drop.has(m.id)));
}

/** 清空单本标记（书架移除记录时由 App 层串联调用，D70） */
export function clearBookMarks(bookPath: string): void {
  persist(loadMarks().filter((m) => m.bookPath !== bookPath));
}

/** 清空全部标记（清空书架时由 App 层串联调用，D70） */
export function clearAllMarks(): void {
  persist([]);
}

/** 订阅标记变化，返回取消订阅函数 */
export function subscribeMarks(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === MARKS_KEY) fn(loadMarks());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** 分组名：想法置顶组；EPUB 取章节；PDF 第 N 页；TXT 全文（D72 口径由调用方排序） */
export function markGroup(m: Mark): string {
  if (m.idea) return "想法";
  if (m.locator.kind === "epub") return m.locator.chapter || "正文";
  if (m.locator.kind === "pdf") return "第 " + m.locator.page + " 页";
  return "全文";
}

/** 该标记是否为 PDF 画笔笔迹（D101） */
export function isInkMark(m: Mark): boolean {
  return m.locator.kind === "pdf" && (m.locator.strokes?.length ?? 0) > 0;
}

/** 笔迹条数（面板条目展示「N 笔」；非笔迹标记返回 0） */
export function inkStrokeCount(m: Mark): number {
  return m.locator.kind === "pdf" ? m.locator.strokes?.length ?? 0 : 0;
}

/**
 * 标记在页面上的纵向起始位置（0~1，用于「按页内位置」排序）。
 * - PDF 笔迹：取所有笔画 `top` 的最小值（一条标记可能跨多笔）；
 * - 其它格式/纯书签：null（排序时殿后，不参与页内位置比较）。
 */
export function markPageTop(m: Mark): number | null {
  if (m.locator.kind !== "pdf") return null;
  const strokes = m.locator.strokes;
  if (!strokes || strokes.length === 0) return null;
  let min = 1;
  for (const s of strokes) if (s.top < min) min = s.top;
  return min;
}

/**
 * PDF 标记排序（D101）：
 * 1. 页码升序 —— 与阅读顺序一致；
 * 2. 同页内按页内纵向位置升序 —— 从上到下；
 * 3. 无位置者（纯书签/其它）排在同页末端，保持相对稳定（按 updatedAt 新→旧）。
 */
export function sortPdfMarks(marks: Mark[]): Mark[] {
  const pageOf = (m: Mark) => (m.locator.kind === "pdf" ? m.locator.page : 0);
  return [...marks].sort((a, b) => {
    const pa = pageOf(a);
    const pb = pageOf(b);
    if (pa !== pb) return pa - pb;
    const ta = markPageTop(a);
    const tb = markPageTop(b);
    if (ta === null && tb === null) return b.updatedAt - a.updatedAt;
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta !== tb) return ta - tb;
    return b.updatedAt - a.updatedAt;
  });
}

/** 章节路径（D96）：EPUB 侧记录的「父章 › 子节」阅读顺序路径；其它格式无层级 */
export type MarkChapterPath = {
  key: string; // href#fragment（与 toc 定位同源，用于排序匹配）
  order: number[]; // 目录树索引路径，如 [3, 1]
  labels: string[]; // 对应标签，如 ["Part 1", "A Study in Scarlet"]
  href: string;
};

/**
 * 按目录树给标记反查章节路径（D96「按章节显示」）。
 *
 * 只认 `locator.chapter` 与目录标签的精确匹配——不做模糊猜（宁可落到「未归类」），
 * 因为错归档比不归档更误导。同一标签可能出现在多个目录项（合集名重复），
 * 取第一个匹配（目录顺序即阅读顺序）。
 *
 * @param marks 待标注的标记（顺序即调用方给的分组顺序）
 * @param nodes 扁平化目录项（含 depth / order / labels）
 * @returns 每条标记对应的章节路径；非 EPUB 或无匹配返回 null
 */
export function markChapterPaths(
  marks: Mark[],
  nodes: ReadonlyArray<{ href: string; label: string; depth: number; order: number[]; labels: string[] }>
): Map<string, MarkChapterPath> {
  const byLabel = new Map<string, (typeof nodes)[number]>();
  for (const n of nodes) if (!byLabel.has(n.label)) byLabel.set(n.label, n);
  const out = new Map<string, MarkChapterPath>();
  for (const m of marks) {
    if (m.locator.kind !== "epub" || m.idea) continue;
    const hit = byLabel.get(m.locator.chapter);
    if (!hit) continue;
    out.set(m.id, {
      key: hit.href,
      order: hit.order,
      labels: hit.labels,
      href: hit.href,
    });
  }
  return out;
}

/**
 * 章节分组排序（D96）：按目录阅读顺序（order 字典序）而非首次出现顺序。
 * 没有路径的分组（「想法」「未归类」「第 N 页」「全文」）保持调用方给定顺序并殿后。
 */
export function sortChapterGroups<G extends { order: number[] | null }>(
  groups: G[]
): G[] {
  return [...groups].sort((a, b) => {
    if (!a.order && !b.order) return 0;
    if (!a.order) return 1;
    if (!b.order) return -1;
    const len = Math.max(a.order.length, b.order.length);
    for (let i = 0; i < len; i++) {
      const x = a.order[i] ?? -1;
      const y = b.order[i] ?? -1;
      if (x !== y) return x - y;
    }
    return 0;
  });
}

/** 条目显示用原文（独立想法返回空串，由 UI 决定占位文案） */
export function markDisplayText(m: Mark): string {
  return m.text;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / M 月 D 日 */
export function formatMarkTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
  const d = new Date(ts * 1000);
  return d.getMonth() + 1 + " 月 " + d.getDate() + " 日";
}

/**
 * 导出 Markdown（F37，纯函数可单测）：
 * 《书名》→ 分组（首次出现顺序）→ 组内 updatedAt 倒序。
 * 纯高亮（无感悟）只输出引用与位置脚注。
 */
export function exportMarksMarkdown(bookName: string, marks: Mark[]): string {
  const lines: string[] = ["# 《" + bookName + "》标记记录", ""];
  const groups = new Map<string, Mark[]>();
  for (const m of marks) {
    const g = markGroup(m);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(m);
  }
  for (const [group, items] of groups) {
    lines.push("## " + group, "");
    for (const m of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (m.idea) {
        lines.push("◆ **想法**（" + formatMarkTime(m.updatedAt) + "）", "");
        if (m.note) lines.push(m.note, "");
        continue;
      }
      if (m.text) {
        lines.push("> " + m.text.replace(/\n/g, "\n> "), "");
      }
      // D101：PDF 画笔标记——Markdown 无法承载矢量笔迹，导出为「笔数 + 页内位置」描述
      if (isInkMark(m)) {
        const n = inkStrokeCount(m);
        const top = markPageTop(m);
        const where = top === null ? "" : "，位于页面 " + Math.round(top * 100) + "% 高度处";
        lines.push("✎ 手写标注：" + n + " 笔" + where, "");
      }
      if (m.note) lines.push("**感悟：** " + m.note, "");
      const pos =
        m.locator.kind === "pdf"
          ? "第 " + m.locator.page + " 页"
          : m.locator.kind === "epub"
            ? m.locator.chapter || "正文"
            : "字符区间 " + m.locator.start + "–" + m.locator.end;
      lines.push("*位置：" + pos + " · " + formatMarkTime(m.updatedAt) + "*", "");
    }
  }
  if (marks.length === 0) lines.push("（暂无标记）", "");
  return lines.join("\n");
}
