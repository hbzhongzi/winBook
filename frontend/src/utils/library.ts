// 书架与阅读位置记忆（v0.2.1）：最近阅读记录 + 退出位置持久化。
// 存储于 localStorage 键 bookeditor.library.v1；变更经订阅机制广播
// （同页 listeners + storage 事件，与 settings v3 一致，支持多实例同步）。
// 实施口径见 doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md 第 3 章。

import type { ReaderMode } from "./settings";

export type ReadingPosition =
  | { kind: "epub"; tocIndex: number; href: string; sectionIndex: number; ratio: number; cfi?: string; mode?: ReaderMode }
  | { kind: "pdf"; page: number; pageCount: number; mode?: ReaderMode }
  | { kind: "txt"; ratio: number; anchor?: number; mode?: ReaderMode };

export type BookFormat = "epub" | "pdf" | "txt";

/** Viewer 上报/取位的数据结构（三 Viewer 与 App flush 共用） */
export type PositionReport = { position: ReadingPosition; progress: number };

export type LibraryEntry = {
  path: string;
  name: string;
  format: BookFormat;
  size: number;
  mtime: number;
  lastOpen: number;
  position: ReadingPosition | null;
  progress: number; // 0..1，展示用（EPUB 为约值）
  /**
   * v0.2.8（F27）：分类名；缺省/空串 = 未分类。
   * 存分类名而非 id（D64）——分类量小，改名时由 renameCategory 调用方批量改写。
   */
  cat?: string;
};

export const LIBRARY_KEY = "bookeditor.library.v1";
export const LIBRARY_LIMIT = 50;

type LibraryFile = { version: 1; entries: LibraryEntry[] };
type Listener = (entries: LibraryEntry[]) => void;

const listeners = new Set<Listener>();

const FORMATS: BookFormat[] = ["epub", "pdf", "txt"];

function clamp01(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isFormat(v: unknown): v is BookFormat {
  return typeof v === "string" && (FORMATS as string[]).includes(v);
}

/** 逐位置校验：结构不合法返回 null（调用方按「无位置」处理） */
export function normalizePosition(raw: unknown): ReadingPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "epub") {
    if (typeof r.href !== "string" || !r.href) return null;
    // 向后兼容：cfi/mode 缺失或非法时丢弃（降级章节级恢复），不阻断整体解析
    const cfiRaw = r.cfi;
    const cfi = typeof cfiRaw === "string" && cfiRaw.length > 0 ? cfiRaw : undefined;
    const modeRaw = r.mode;
    const mode = modeRaw === "scroll" || modeRaw === "page" ? modeRaw : undefined;
    return {
      kind: "epub",
      tocIndex: clampInt(Number(r.tocIndex), 0, 100000, 0),
      href: r.href,
      sectionIndex: clampInt(Number(r.sectionIndex), 0, 100000, 0),
      ratio: clamp01(Number(r.ratio)),
      ...(cfi ? { cfi } : {}),
      ...(mode ? { mode } : {}),
    };
  }
  if (r.kind === "pdf") {
    const modeRaw = r.mode;
    const mode = modeRaw === "scroll" || modeRaw === "page" ? modeRaw : undefined;
    return {
      kind: "pdf",
      page: clampInt(Number(r.page), 1, 1000000, 1),
      pageCount: clampInt(Number(r.pageCount), 1, 1000000, 1),
      ...(mode ? { mode } : {}),
    };
  }
  if (r.kind === "txt") {
    // anchor：字号无关的字符偏移；缺失/非有限数丢弃，越界钳制到 [0, 1e9]
    const anchorRaw = r.anchor;
    const anchorVal = Number(anchorRaw);
    const anchorOk = anchorRaw !== undefined && anchorRaw !== null && anchorVal === anchorVal; // isFinite
    const modeRaw = r.mode;
    const mode = modeRaw === "scroll" || modeRaw === "page" ? modeRaw : undefined;
    return {
      kind: "txt",
      ratio: clamp01(Number(r.ratio)),
      ...(anchorOk ? { anchor: clampInt(anchorVal, 0, 1_000_000_000, 0) } : {}),
      ...(mode ? { mode } : {}),
    };
  }
  return null;
}

/** 逐条目校验：非法字段静默回落，format 白名单外整条丢弃 */
function normalizeEntry(raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string" || !r.path) return null;
  if (!isFormat(r.format)) return null;
  // v0.2.8：cat 为可选字段——旧数据（无 cat）解析为 undefined，即「未分类」
  const catRaw = r.cat;
  const cat = typeof catRaw === "string" && catRaw.trim() ? catRaw.trim() : undefined;
  return {
    path: r.path,
    name: typeof r.name === "string" && r.name ? r.name : r.path.split(/[\\/]/).pop() ?? r.path,
    format: r.format,
    size: clampInt(Number(r.size), 0, Number.MAX_SAFE_INTEGER, 0),
    mtime: clampInt(Number(r.mtime), 0, Number.MAX_SAFE_INTEGER, 0),
    lastOpen: clampInt(Number(r.lastOpen), 0, Number.MAX_SAFE_INTEGER, 0),
    position: normalizePosition(r.position),
    progress: clamp01(Number(r.progress)),
    ...(cat ? { cat } : {}),
  };
}

/** 条目的分类名（缺省为「未分类」哨兵）；供 UI 与派生函数统一取用 */
export function entryCategory(entry: LibraryEntry, fallback = "未分类"): string {
  return entry.cat?.trim() ? entry.cat.trim() : fallback;
}

/** 读取 + 校验 + 按 lastOpen 倒序；损坏 JSON / version 不符整体回落 [] */
export function loadLibrary(): LibraryEntry[] {
  let parsed: unknown = null;
  try {
    const text = localStorage.getItem(LIBRARY_KEY);
    if (text) parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const file = parsed as Partial<LibraryFile>;
  if (file.version !== 1 || !Array.isArray(file.entries)) return [];
  return file.entries
    .map(normalizeEntry)
    .filter((e): e is LibraryEntry => e !== null)
    .sort((a, b) => b.lastOpen - a.lastOpen);
}

/** 供 React 初始 state 使用（语义同 loadLibrary） */
export function listEntries(): LibraryEntry[] {
  return loadLibrary();
}

function persist(entries: LibraryEntry[]): LibraryEntry[] {
  const sorted = [...entries].sort((a, b) => b.lastOpen - a.lastOpen);
  // 淘汰最旧至上限
  const trimmed =
    sorted.length > LIBRARY_LIMIT ? sorted.slice(0, LIBRARY_LIMIT) : sorted;
  try {
    const file: LibraryFile = { version: 1, entries: trimmed };
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(file));
  } catch {
    // 隐私模式/存储不可用时静默降级为内存态（返回仍反映内存结果）
  }
  listeners.forEach((fn) => fn(trimmed));
  return trimmed;
}

/** 新建或更新条目（path 主键去重）；返回写盘后的全量列表 */
export function upsertEntry(entry: LibraryEntry): LibraryEntry[] {
  const entries = loadLibrary().filter((e) => e.path !== entry.path);
  entries.push(entry);
  return persist(entries);
}

export function removeEntry(path: string): LibraryEntry[] {
  const entries = loadLibrary().filter((e) => e.path !== path);
  return persist(entries);
}

/**
 * v0.2.8（D59）：批量移除。单次写盘 + 单次广播，
 * 避免逐条循环导致 N 次全量 JSON.stringify 与 N 次订阅回调（书架重排闪烁）。
 */
export function removeEntries(paths: string[]): LibraryEntry[] {
  if (paths.length === 0) return loadLibrary();
  const drop = new Set(paths);
  const entries = loadLibrary().filter((e) => !drop.has(e.path));
  return persist(entries);
}

/**
 * v0.2.8：批量设置分类。cat 传 undefined/null/空串表示「未分类」。
 * 同样为单次写盘 + 单次广播（D59）。
 */
export function setEntriesCategory(
  paths: string[],
  cat: string | undefined | null
): LibraryEntry[] {
  if (paths.length === 0) return loadLibrary();
  const target = new Set(paths);
  const next = typeof cat === "string" && cat.trim() ? cat.trim() : undefined;
  const entries = loadLibrary().map((e) => {
    if (!target.has(e.path)) return e;
    const copy = { ...e };
    if (next) copy.cat = next;
    else delete copy.cat;
    return copy;
  });
  return persist(entries);
}

/** 单本归类（批量 API 的单路径便捷形式） */
export function setEntryCategory(
  path: string,
  cat: string | undefined | null
): LibraryEntry[] {
  return setEntriesCategory([path], cat);
}

export function clearLibrary(): LibraryEntry[] {
  return persist([]);
}

export function getEntry(path: string): LibraryEntry | null {
  return loadLibrary().find((e) => e.path === path) ?? null;
}

/**
 * 打开成功时调用：建/更新条目并刷新 lastOpen。
 * position 传当前已知位置（首次打开为旧值或 null），打开瞬间先占位，
 * 避免条目位置被清空的闪烁；首次 onPosition 上报后再更新。
 */
export function savePosition(input: {
  path: string;
  name: string;
  format: BookFormat;
  size: number;
  mtime: number;
  position: ReadingPosition | null;
  progress: number;
}): void {
  upsertEntry({
    path: input.path,
    name: input.name,
    format: input.format,
    size: input.size,
    mtime: input.mtime,
    lastOpen: Math.floor(Date.now() / 1000),
    position: input.position,
    progress: clamp01(input.progress),
  });
}

/** 阅读中调用：只更新 position/progress，不刷新 lastOpen（不打乱书架排序） */
export function reportPosition(input: {
  path: string;
  position: ReadingPosition;
  progress: number;
}): void {
  const entries = loadLibrary();
  const idx = entries.findIndex((e) => e.path === input.path);
  if (idx < 0) return; // 未记录的书（如打开后立刻清空书架）：不补建条目
  const updated = { ...entries[idx], position: input.position, progress: clamp01(input.progress) };
  entries[idx] = updated;
  persist(entries);
}

/** 订阅书架变化，返回取消订阅函数 */
export function subscribeLibrary(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === LIBRARY_KEY) fn(loadLibrary());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** 相对时间：刚刚 / N 小时前 / N 天前 / M 月 D 日 */
export function formatRelativeTime(ts: number): string {
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

/** 进度展示文案：EPUB「约 N%」/ PDF「N / M 页」/ TXT「N%」 */
export function progressLabel(entry: LibraryEntry): string {
  const p = Math.round(clamp01(entry.progress) * 100);
  if (entry.format === "pdf" && entry.position?.kind === "pdf") {
    return entry.position.page + " / " + entry.position.pageCount + " 页";
  }
  if (entry.format === "epub") return "约 " + p + "%";
  return p + "%";
}
