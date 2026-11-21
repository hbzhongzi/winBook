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
 * 三格式定位器：
 * - EPUB：CFI（epubjs annotations 渲染高亮，display(cfi) 跳转）；
 * - TXT：字符偏移（字号无关，与 ReadingPosition.anchor 同口径）；
 * - PDF：页码 + quote（本版 PDF 无文本层，quote 恒为空串，见方案 D73）。
 */
export type MarkLocator =
  | { kind: "epub"; cfi: string; href: string; chapter: string }
  | { kind: "txt"; start: number; end: number }
  | { kind: "pdf"; page: number; quote: string };

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
    return { kind: "pdf", page, quote: typeof r.quote === "string" ? r.quote.slice(0, MAX_TEXT) : "" };
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
export function updateMark(id: string, patch: { note?: string; color?: MarkColor; text?: string }): void {
  const all = loadMarks();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const cur = all[idx];
  const next: Mark = {
    ...cur,
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
