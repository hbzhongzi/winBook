// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  READING_STYLE_ID,
  applyAppTheme,
  applyReadingStyle,
  readingStyleText,
  readingTokens,
} from "../readingTheme";
import { DEFAULT_SETTINGS, type Settings, type ThemeName } from "../settings";

const THEMES: ThemeName[] = ["light", "dark", "eye", "sepia"];

function makeSettings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe("readingTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--reading-font-size");
    document.documentElement.style.removeProperty("--reading-line-height");
    document.documentElement.style.removeProperty("--reading-font-family");
    document.documentElement.style.removeProperty("--reading-content-margin");
  });

  it("四主题令牌非空且互异", () => {
    const bgs = THEMES.map((t) => readingTokens(t).bg);
    expect(new Set(bgs).size).toBe(THEMES.length);
    for (const t of THEMES) {
      const tok = readingTokens(t);
      expect(tok.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tok.text).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tok.text2).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tok.border).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(readingTokens("dark").scheme).toBe("dark");
    expect(readingTokens("light").scheme).toBe("light");
  });

  it("未知主题回落浅色令牌", () => {
    expect(readingTokens("neon" as ThemeName)).toEqual(readingTokens("light"));
  });

  it("readingStyleText 含主题色、字号与 color-scheme", () => {
    const text = readingStyleText(makeSettings({ theme: "dark", fontSize: 17 }));
    expect(text).toContain("#1e293b"); // 深色阅读背景
    expect(text).toContain("#cbd5e1"); // 深色文字
    expect(text).toContain("17px");
    expect(text).toContain("color-scheme: dark");
    expect(text).toContain("!important"); // 用户意图优先于书籍样式
  });

  it("applyReadingStyle 幂等：同 id 只建一个 style，二次调用只更新文本", () => {
    const doc = document.implementation.createHTMLDocument("t");
    applyReadingStyle(doc, makeSettings({ theme: "sepia", fontSize: 13 }));
    const first = doc.getElementById(READING_STYLE_ID);
    expect(first).toBeTruthy();
    expect(first?.textContent).toContain("13px");
    applyReadingStyle(doc, makeSettings({ theme: "sepia", fontSize: 20 }));
    expect(doc.querySelectorAll("#" + READING_STYLE_ID).length).toBe(1);
    expect(doc.getElementById(READING_STYLE_ID)?.textContent).toContain("20px");
  });

  it("applyAppTheme 设置 dataset 与 CSS 变量", () => {
    applyAppTheme(makeSettings({ theme: "eye", accent: "#4f46e5", fontSize: 16 }));
    expect(document.documentElement.dataset.theme).toBe("eye");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#4f46e5");
    expect(document.documentElement.style.getPropertyValue("--accent-hover")).toBe("#4338ca");
    expect(document.documentElement.style.getPropertyValue("--reading-font-size")).toBe("16px");
  });

  it("v0.2.4：readingStyleText 含行距/字体/页边距", () => {
    const text = readingStyleText(
      makeSettings({ fontSize: 15, lineHeight: 1.9, fontFamily: "song", contentMargin: 32 })
    );
    expect(text).toContain("line-height: 1.9");
    expect(text).toContain("font-family:");
    expect(text).toContain("SimSun"); // 宋体栈
    expect(text).toContain("padding-left: 32px");
    expect(text).toContain("padding-right: 32px");
    expect(text).toContain("15px");
  });

  it("v0.2.4：页边距为 0 时不注入 padding（存量零回归）", () => {
    const text = readingStyleText(makeSettings({ contentMargin: 0, lineHeight: 1.75 }));
    expect(text).not.toContain("padding-left");
    expect(text).not.toContain("padding-right");
    expect(text).toContain("line-height: 1.75"); // 行距仍注入
  });

  it("v0.2.4：楷体栈与 system 栈按 fontFamily 切换", () => {
    expect(readingStyleText(makeSettings({ fontFamily: "kai" }))).toContain("KaiTi");
    expect(readingStyleText(makeSettings({ fontFamily: "system" }))).toContain("Microsoft YaHei");
  });

  it("v0.2.4：applyAppTheme 设置版式三件套 CSS 变量", () => {
    applyAppTheme(
      makeSettings({ fontSize: 13, lineHeight: 2.0, fontFamily: "kai", contentMargin: 48 })
    );
    const st = document.documentElement.style;
    expect(st.getPropertyValue("--reading-font-size")).toBe("13px");
    expect(st.getPropertyValue("--reading-line-height")).toBe("2");
    expect(st.getPropertyValue("--reading-font-family")).toContain("KaiTi");
    expect(st.getPropertyValue("--reading-content-margin")).toBe("48px");
  });
});
