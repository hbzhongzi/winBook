// 阅读主题：框架层/阅读层令牌、EPUB 内容注入与应用层挂载。
// EPUB 的 iframe 是独立文档，宿主 CSS 变量不会渗入，必须把令牌物化成具体值注入（D21 取舍）。
import { accentHover, FONT_FAMILY_STACKS, type Settings, type ThemeName } from "./settings";

export type ReadingTokens = {
  bg: string;
  text: string;
  text2: string;
  border: string;
  scheme: "light" | "dark";
};

const TOKENS: Record<ThemeName, ReadingTokens> = {
  light: { bg: "#ffffff", text: "#374151", text2: "#6b7280", border: "#e5e9f0", scheme: "light" },
  dark: { bg: "#1e293b", text: "#cbd5e1", text2: "#94a3b8", border: "#334155", scheme: "dark" },
  eye: { bg: "#e8eedd", text: "#3d4a33", text2: "#6b7a5e", border: "#c9d6b8", scheme: "light" },
  sepia: { bg: "#f4ecd8", text: "#5b4632", text2: "#8a7458", border: "#ddcbab", scheme: "light" },
};

/** 阅读层令牌具体值（ EPUB 注入与 TXT 区共用同一组取值 ） */
export function readingTokens(theme: ThemeName): ReadingTokens {
  return TOKENS[theme] ?? TOKENS.light;
}

/**
 * 生成注入 EPUB 章节文档的样式文本。
 * 颜色用 !important：书籍自带 CSS 与用户主题冲突时，用户显式意图优先（已知取舍）。
 * 只设 body 级背景/文字/字号/行距/字体/页边距：书籍对具体元素设了字号的不受影响（已知局限，见落地文档第 9 章）。
 * v0.2.4：行距/字体/页边距随字号同通道注入；页边距为 0 时不注入（存量零回归）。
 */
export function readingStyleText(settings: Settings): string {
  const t = readingTokens(settings.theme);
  const margin =
    settings.contentMargin > 0
      ? " padding-left: " + settings.contentMargin + "px !important; padding-right: " + settings.contentMargin + "px !important;"
      : "";
  return (
    ":root { color-scheme: " + t.scheme + "; }\n" +
    "html, body { background-color: " + t.bg + " !important; }\n" +
    "body { color: " + t.text + " !important; font-size: " + settings.fontSize + "px !important; " +
    "line-height: " + settings.lineHeight + " !important; " +
    "font-family: " + FONT_FAMILY_STACKS[settings.fontFamily] + " !important;" +
    margin + " }\n"
  );
}

/** 注入样式在章节文档中的固定 id（幂等更新用） */
export const READING_STYLE_ID = "bookeditor-reading-style";

/** 在文档内按固定 id 创建/更新阅读样式（幂等：重复调用只改 textContent） */
export function applyReadingStyle(doc: Document, settings: Settings): void {
  const head = doc.head ?? doc.documentElement;
  if (!head) return;
  let style = doc.getElementById(READING_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = READING_STYLE_ID;
    head.appendChild(style);
  }
  style.textContent = readingStyleText(settings);
}

/**
 * 应用层挂载：theme 走 dataset（触发 :root[data-theme=...] 分支），
 * accent / 字号走 inline CSS 变量（强调色与主题正交，深色分支不定义 --accent）。
 */
export function applyAppTheme(
  settings: Settings,
  root: HTMLElement = document.documentElement
): void {
  root.dataset.theme = settings.theme;
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--accent-hover", accentHover(settings.accent));
  root.style.setProperty("--reading-font-size", settings.fontSize + "px");
  // v0.2.4 版式三件套：TXT 滚动/翻页容器经 CSS 变量消费（styles.css）
  root.style.setProperty("--reading-line-height", String(settings.lineHeight));
  root.style.setProperty("--reading-font-family", FONT_FAMILY_STACKS[settings.fontFamily]);
  root.style.setProperty("--reading-content-margin", settings.contentMargin + "px");
}
