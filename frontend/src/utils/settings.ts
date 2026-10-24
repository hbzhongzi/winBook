// 应用设置 v4：EPUB 预加载章节数、阅读主题、界面强调色、正文字号、阅读模式、
// 行距、正文字体、正文页边距（v0.2.4 版式三件套）、阅读快捷键键位（v0.2.5 F24）。
// 持久化到 localStorage；变更通过订阅机制广播，让已打开的书籍即时生效（无需重开图书）。
// v3（含版式三件套）全量迁移、v2 全量迁移、v1（仅 epubPreloadCount）只读保留，均不删除。

import {
  DEFAULT_HOTKEYS,
  cloneHotkeyMap,
  normalizeHotkeyMap,
  type HotkeyMap,
} from "./readerHotkeys";

export type ThemeName = "light" | "dark" | "eye" | "sepia";

/** 阅读模式：scroll=纵向滚动，page=横向翻页（v0.2.2） */
export type ReaderMode = "scroll" | "page";

export const READER_MODES: ReaderMode[] = ["scroll", "page"];
export const READER_MODE_DEFAULT: ReaderMode = "scroll";

/** 正文字体（v0.2.4 F13）：system=系统默认（存量零回归） */
export type FontFamily = "system" | "song" | "kai";
export const FONT_FAMILIES: FontFamily[] = ["system", "song", "kai"];
export const FONT_FAMILY_DEFAULT: FontFamily = "system";
/** 面板展示名 */
export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  system: "系统",
  song: "宋体",
  kai: "楷体",
};
/** CSS font-family 栈：system 与既有默认（Microsoft YaHei）一致 */
export const FONT_FAMILY_STACKS: Record<FontFamily, string> = {
  system: '"Microsoft YaHei", sans-serif',
  song: '"SimSun", "Songti SC", serif',
  kai: '"KaiTi", "Kaiti SC", cursive',
};

export type Settings = {
  /** 预加载章节数：当前可见章节前后各保留的章节数（窗口 = 2N+1） */
  epubPreloadCount: number;
  /** 阅读主题：作用于 EPUB/TXT 正文与应用框架 */
  theme: ThemeName;
  /** 界面强调色（白名单十六进制） */
  accent: string;
  /** 正文字号 px：作用于 EPUB/TXT 正文 */
  fontSize: number;
  /** 阅读模式：scroll=纵向滚动，page=横向翻页；默认 "scroll" 保持存量行为 */
  readerMode: ReaderMode;
  /** 行距倍数（v0.2.4 F12）：1.4–2.2，步进 0.05，默认 1.75 */
  lineHeight: number;
  /** 正文字体（v0.2.4 F13）：默认 "system" 保持存量行为 */
  fontFamily: FontFamily;
  /** 正文页边距 px（v0.2.4 F14）：0–80，默认 0 保持存量行为 */
  contentMargin: number;
  /** 阅读快捷键键位（v0.2.5 F24）：动作 → KeyboardEvent.key 数组，可设置面板自定义 */
  hotkeys: HotkeyMap;
};

export const PRELOAD_MIN = 0;
export const PRELOAD_MAX = 10;
export const PRELOAD_DEFAULT = 2;

export const THEMES: ThemeName[] = ["light", "dark", "eye", "sepia"];

export const FONT_MIN = 13;
export const FONT_MAX = 20;
export const FONT_DEFAULT = 14;

export const LINE_HEIGHT_MIN = 1.4;
export const LINE_HEIGHT_MAX = 2.2;
export const LINE_HEIGHT_STEP = 0.05;
export const LINE_HEIGHT_DEFAULT = 1.75;

export const MARGIN_MIN = 0;
export const MARGIN_MAX = 80;
export const MARGIN_STEP = 4;
export const MARGIN_DEFAULT = 0;

export type AccentOption = { name: string; value: string; hover: string };

export const ACCENTS: AccentOption[] = [
  { name: "蓝", value: "#2563eb", hover: "#1d4ed8" },
  { name: "靛蓝", value: "#4f46e5", hover: "#4338ca" },
  { name: "绿", value: "#059669", hover: "#047857" },
  { name: "琥珀", value: "#d97706", hover: "#b45309" },
  { name: "玫红", value: "#e11d48", hover: "#be123c" },
  { name: "青", value: "#0891b2", hover: "#0e7490" },
];

const STORAGE_KEY = "bookeditor.settings.v4";
const LEGACY_V3_KEY = "bookeditor.settings.v3";
const LEGACY_V2_KEY = "bookeditor.settings.v2";
const LEGACY_V1_KEY = "bookeditor.settings.v1";

export const DEFAULT_ACCENT = ACCENTS[0].value;

export const DEFAULT_SETTINGS: Settings = {
  epubPreloadCount: PRELOAD_DEFAULT,
  theme: "light",
  accent: DEFAULT_ACCENT,
  fontSize: FONT_DEFAULT,
  readerMode: READER_MODE_DEFAULT,
  lineHeight: LINE_HEIGHT_DEFAULT,
  fontFamily: FONT_FAMILY_DEFAULT,
  contentMargin: MARGIN_DEFAULT,
  hotkeys: cloneHotkeyMap(DEFAULT_HOTKEYS),
};

type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeTheme(v: unknown): ThemeName {
  return typeof v === "string" && (THEMES as string[]).includes(v) ? (v as ThemeName) : "light";
}

function normalizeReaderMode(v: unknown): ReaderMode {
  return typeof v === "string" && (READER_MODES as string[]).includes(v) ? (v as ReaderMode) : READER_MODE_DEFAULT;
}

function normalizeFontFamily(v: unknown): FontFamily {
  return typeof v === "string" && (FONT_FAMILIES as string[]).includes(v) ? (v as FontFamily) : FONT_FAMILY_DEFAULT;
}

/** 行距：clamp 到 [1.4, 2.2] 并对齐 0.05 步进；NaN/非数字回落默认 */
function normalizeLineHeight(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return LINE_HEIGHT_DEFAULT;
  const clamped = Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, n));
  // 整数步进计数 + 两位小数修正：规避 0.05 二进制浮点误差（如 28*0.05=1.4000000000000001）
  const steps = Math.round(clamped / LINE_HEIGHT_STEP);
  return Math.round(steps * LINE_HEIGHT_STEP * 100) / 100;
}

function normalizeContentMargin(v: unknown): number {
  return clamp(Number(v), MARGIN_MIN, MARGIN_MAX, MARGIN_DEFAULT);
}

function normalizeAccent(v: unknown): string {
  if (typeof v === "string") {
    const hit = ACCENTS.find((a) => a.value.toLowerCase() === v.toLowerCase());
    if (hit) return hit.value;
  }
  return DEFAULT_ACCENT;
}

/** 按 accent 取值查 hover；非法值回落默认色的 hover */
export function accentHover(accent: string): string {
  const hit = ACCENTS.find((a) => a.value.toLowerCase() === accent.toLowerCase());
  return hit ? hit.hover : ACCENTS[0].hover;
}

/** 逐字段校验：非法值静默回落默认（与 v1 clamp 行为一致） */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const r = raw ?? {};
  return {
    epubPreloadCount: clamp(Number(r.epubPreloadCount), PRELOAD_MIN, PRELOAD_MAX, PRELOAD_DEFAULT),
    theme: normalizeTheme(r.theme),
    accent: normalizeAccent(r.accent),
    fontSize: clamp(Number(r.fontSize), FONT_MIN, FONT_MAX, FONT_DEFAULT),
    readerMode: normalizeReaderMode(r.readerMode),
    lineHeight: normalizeLineHeight(r.lineHeight),
    fontFamily: normalizeFontFamily(r.fontFamily),
    contentMargin: normalizeContentMargin(r.contentMargin),
    hotkeys: normalizeHotkeyMap(r.hotkeys),
  };
}

/** 从 v3 键迁移：v0.2.5 前的十字段原值搬移（hotkeys 缺省→默认，逐字段校验兜底） */
function migrateFromV3(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(LEGACY_V3_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Settings>;
  } catch {
    return null;
  }
}

/** 从 v2 键迁移：v0.2.4 前的六字段原值搬移（新增三字段缺省→默认，逐字段校验兜底） */
function migrateFromV2(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(LEGACY_V2_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Settings>;
  } catch {
    return null;
  }
}

/** 从 v1 键迁移：仅迁移预加载值，其余取默认 */
function migrateFromV1(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(LEGACY_V1_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { epubPreloadCount: Number(parsed.epubPreloadCount) };
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  let raw: Partial<Settings> | null = null;
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) raw = JSON.parse(text) as Partial<Settings>;
  } catch {
    raw = null; // 损坏 JSON：尝试迁移，再回落默认
  }
  if (!raw) raw = migrateFromV3();
  if (!raw) raw = migrateFromV2();
  if (!raw) raw = migrateFromV1();
  return normalizeSettings(raw);
}

/** 保存（与当前生效值合并后校验）；返回规范化结果 */
export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...loadSettings(), ...next };
  const normalized = normalizeSettings(merged);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 隐私模式/存储不可用时静默降级为内存态
  }
  listeners.forEach((fn) => fn(normalized));
  return normalized;
}

/** 恢复默认并广播 */
export function resetSettings(): Settings {
  return saveSettings({ ...DEFAULT_SETTINGS });
}

/** 订阅设置变化，返回取消订阅函数 */
export function subscribeSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
