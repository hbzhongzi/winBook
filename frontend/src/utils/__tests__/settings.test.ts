// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  ACCENTS,
  DEFAULT_ACCENT,
  DEFAULT_SETTINGS,
  FONT_DEFAULT,
  FONT_FAMILY_DEFAULT,
  FONT_MAX,
  FONT_MIN,
  LINE_HEIGHT_DEFAULT,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  MARGIN_DEFAULT,
  MARGIN_MAX,
  MARGIN_MIN,
  PRELOAD_DEFAULT,
  PRELOAD_MAX,
  PRELOAD_MIN,
  accentHover,
  loadSettings,
  normalizeSettings,
  resetSettings,
  saveSettings,
  subscribeSettings,
} from "../settings";
import { DEFAULT_HOTKEYS } from "../readerHotkeys";

describe("settings v2", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无存储时返回默认值", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings().epubPreloadCount).toBe(PRELOAD_DEFAULT);
    expect(loadSettings().theme).toBe("light");
    expect(loadSettings().accent).toBe(DEFAULT_ACCENT);
    expect(loadSettings().fontSize).toBe(FONT_DEFAULT);
  });

  it("保存后可读回", () => {
    saveSettings({ epubPreloadCount: 5, theme: "dark", accent: "#059669", fontSize: 17 });
    const s = loadSettings();
    expect(s.epubPreloadCount).toBe(5);
    expect(s.theme).toBe("dark");
    expect(s.accent).toBe("#059669");
    expect(s.fontSize).toBe(17);
  });

  it("部分字段保存时与当前生效值合并", () => {
    saveSettings({ theme: "sepia", fontSize: 18 });
    const s = saveSettings({ theme: "eye" });
    expect(s.theme).toBe("eye");
    expect(s.fontSize).toBe(18); // 未提供的字段保留
  });

  it("越界值被夹紧到合法区间", () => {
    expect(saveSettings({ epubPreloadCount: 999 }).epubPreloadCount).toBe(PRELOAD_MAX);
    expect(saveSettings({ epubPreloadCount: -3 }).epubPreloadCount).toBe(PRELOAD_MIN);
    expect(saveSettings({ fontSize: 999 }).fontSize).toBe(FONT_MAX);
    expect(saveSettings({ fontSize: 1 }).fontSize).toBe(FONT_MIN);
  });

  it("非整数被四舍五入", () => {
    expect(saveSettings({ epubPreloadCount: 2.6 }).epubPreloadCount).toBe(3);
    expect(saveSettings({ epubPreloadCount: 2.4 }).epubPreloadCount).toBe(2);
    expect(saveSettings({ fontSize: 15.5 }).fontSize).toBe(16);
  });

  it("非法值（NaN）回落到默认", () => {
    expect(saveSettings({ epubPreloadCount: Number.NaN }).epubPreloadCount).toBe(PRELOAD_DEFAULT);
    expect(saveSettings({ fontSize: Number.NaN }).fontSize).toBe(FONT_DEFAULT);
  });

  it("theme 白名单外回落 light", () => {
    expect(normalizeSettings({ theme: "neon" as never }).theme).toBe("light");
    expect(normalizeSettings({ theme: undefined }).theme).toBe("light");
    expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
  });

  it("accent 白名单外回落默认色", () => {
    expect(normalizeSettings({ accent: "#123456" }).accent).toBe(DEFAULT_ACCENT);
    expect(normalizeSettings({ accent: 42 as never }).accent).toBe(DEFAULT_ACCENT);
    // 大小写不敏感命中白名单
    expect(normalizeSettings({ accent: "#059669".toUpperCase() }).accent).toBe("#059669");
  });

  it("accentHover 返回配对 hover，非法值回落默认 hover", () => {
    expect(accentHover("#2563eb")).toBe("#1d4ed8");
    expect(accentHover("#e11d48")).toBe("#be123c");
    expect(accentHover("#000000")).toBe(ACCENTS[0].hover);
  });

  it("v1 键迁移：预加载值保留，其余取默认", () => {
    localStorage.setItem("bookeditor.settings.v1", JSON.stringify({ epubPreloadCount: 7 }));
    const s = loadSettings();
    expect(s.epubPreloadCount).toBe(7);
    expect(s.theme).toBe("light");
    expect(s.accent).toBe(DEFAULT_ACCENT);
    expect(s.fontSize).toBe(FONT_DEFAULT);
  });

  it("v1 键损坏时不抛异常，回落默认值", () => {
    localStorage.setItem("bookeditor.settings.v1", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("v3 键优先于 v2/v1 键", () => {
    localStorage.setItem("bookeditor.settings.v2", JSON.stringify({ epubPreloadCount: 7 }));
    localStorage.setItem("bookeditor.settings.v1", JSON.stringify({ epubPreloadCount: 9 }));
    saveSettings({ epubPreloadCount: 3 });
    expect(loadSettings().epubPreloadCount).toBe(3);
  });

  it("v2 键全量迁移：六字段原值搬移，新增版式字段取默认", () => {
    localStorage.setItem(
      "bookeditor.settings.v2",
      JSON.stringify({ epubPreloadCount: 4, theme: "dark", accent: "#059669", fontSize: 17, readerMode: "page" })
    );
    const s = loadSettings();
    expect(s.epubPreloadCount).toBe(4);
    expect(s.theme).toBe("dark");
    expect(s.accent).toBe("#059669");
    expect(s.fontSize).toBe(17);
    expect(s.readerMode).toBe("page");
    // v3 新增字段缺省回落默认（存量零回归）
    expect(s.lineHeight).toBe(LINE_HEIGHT_DEFAULT);
    expect(s.fontFamily).toBe(FONT_FAMILY_DEFAULT);
    expect(s.contentMargin).toBe(MARGIN_DEFAULT);
  });

  it("损坏的 JSON 不抛异常，回落默认值", () => {
    localStorage.setItem("bookeditor.settings.v4", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("saveSettings 通知订阅者", () => {
    const seen: number[] = [];
    const off = subscribeSettings((s) => seen.push(s.epubPreloadCount));
    saveSettings({ epubPreloadCount: 4 });
    off();
    saveSettings({ epubPreloadCount: 6 });
    expect(seen).toEqual([4]); // 取消订阅后不再收到
  });

  it("resetSettings 写回默认并广播", () => {
    saveSettings({ theme: "dark", fontSize: 20 });
    const seen: string[] = [];
    subscribeSettings((s) => seen.push(s.theme));
    const s = resetSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(seen).toEqual(["light"]);
  });

  it("缺失字段时按默认值补齐", () => {
    localStorage.setItem("bookeditor.settings.v4", JSON.stringify({}));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("readerMode 默认 scroll，缺字段时回落（存量零回归）", () => {
    expect(DEFAULT_SETTINGS.readerMode).toBe("scroll");
    localStorage.setItem("bookeditor.settings.v4", JSON.stringify({ theme: "dark" }));
    expect(loadSettings().readerMode).toBe("scroll"); // A35：旧设置无 readerMode 回落滚动
  });

  it("readerMode 非法枚举回落 scroll", () => {
    expect(normalizeSettings({ readerMode: "vertical" as never }).readerMode).toBe("scroll");
    expect(normalizeSettings({ readerMode: undefined }).readerMode).toBe("scroll");
    expect(normalizeSettings({ readerMode: "page" }).readerMode).toBe("page");
  });

  it("readerMode 保存后可读回", () => {
    saveSettings({ readerMode: "page" });
    expect(loadSettings().readerMode).toBe("page");
    saveSettings({ readerMode: "scroll" });
    expect(loadSettings().readerMode).toBe("scroll");
  });

  it("readerMode 与体积类字段混合保存互不干扰", () => {
    saveSettings({ readerMode: "page", fontSize: 18 });
    const s = loadSettings();
    expect(s.readerMode).toBe("page");
    expect(s.fontSize).toBe(18);
  });
});

describe("settings v3（v0.2.4 版式三件套）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("行距/字体/页边距默认值（存量零回归）", () => {
    const s = loadSettings();
    expect(s.lineHeight).toBe(LINE_HEIGHT_DEFAULT);
    expect(s.fontFamily).toBe(FONT_FAMILY_DEFAULT);
    expect(s.contentMargin).toBe(MARGIN_DEFAULT);
  });

  it("保存后可读回", () => {
    saveSettings({ lineHeight: 1.9, fontFamily: "song", contentMargin: 40 });
    const s = loadSettings();
    expect(s.lineHeight).toBe(1.9);
    expect(s.fontFamily).toBe("song");
    expect(s.contentMargin).toBe(40);
  });

  it("行距越界 clamp 到 [1.4, 2.2]", () => {
    expect(saveSettings({ lineHeight: 3 }).lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(saveSettings({ lineHeight: 0.5 }).lineHeight).toBe(LINE_HEIGHT_MIN);
  });

  it("行距对齐 0.05 步进", () => {
    expect(saveSettings({ lineHeight: 1.83 }).lineHeight).toBe(1.85);
    expect(saveSettings({ lineHeight: 1.82 }).lineHeight).toBe(1.8);
  });

  it("行距非数字回落默认", () => {
    expect(saveSettings({ lineHeight: Number.NaN }).lineHeight).toBe(LINE_HEIGHT_DEFAULT);
    expect(saveSettings({ lineHeight: "wide" as never }).lineHeight).toBe(LINE_HEIGHT_DEFAULT);
  });

  it("字体白名单外回落 system", () => {
    expect(saveSettings({ fontFamily: "cursive" as never }).fontFamily).toBe(FONT_FAMILY_DEFAULT);
    expect(saveSettings({ fontFamily: undefined }).fontFamily).toBe(FONT_FAMILY_DEFAULT);
    expect(saveSettings({ fontFamily: "kai" }).fontFamily).toBe("kai");
    expect(saveSettings({ fontFamily: "song" }).fontFamily).toBe("song");
  });

  it("页边距越界 clamp 到 [0, 80]", () => {
    expect(saveSettings({ contentMargin: 999 }).contentMargin).toBe(MARGIN_MAX);
    expect(saveSettings({ contentMargin: -5 }).contentMargin).toBe(MARGIN_MIN);
    expect(saveSettings({ contentMargin: Number.NaN }).contentMargin).toBe(MARGIN_DEFAULT);
  });

  it("版式三件套与既有字段混合保存互不干扰", () => {
    saveSettings({ readerMode: "page", fontSize: 18 });
    const s = saveSettings({ lineHeight: 2.0, fontFamily: "kai", contentMargin: 24 });
    expect(s.readerMode).toBe("page");
    expect(s.fontSize).toBe(18);
    expect(s.lineHeight).toBe(2.0);
    expect(s.fontFamily).toBe("kai");
    expect(s.contentMargin).toBe(24);
  });

  it("normalizeSettings 直接校验版式字段", () => {
    const s = normalizeSettings({ lineHeight: 9, fontFamily: "x" as never, contentMargin: 500 });
    expect(s.lineHeight).toBe(LINE_HEIGHT_MAX);
    expect(s.fontFamily).toBe(FONT_FAMILY_DEFAULT);
    expect(s.contentMargin).toBe(MARGIN_MAX);
  });
});

describe("settings v4（v0.2.5 快捷键自定义）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认键位与 DEFAULT_HOTKEYS 一致（存量零回归）", () => {
    expect(loadSettings().hotkeys).toEqual(DEFAULT_HOTKEYS);
  });

  it("v3 存量迁移：十字段保真，hotkeys 补默认", () => {
    localStorage.setItem(
      "bookeditor.settings.v3",
      JSON.stringify({
        epubPreloadCount: 4,
        theme: "dark",
        accent: "#059669",
        fontSize: 17,
        readerMode: "page",
        lineHeight: 1.9,
        fontFamily: "song",
        contentMargin: 24,
      })
    );
    const s = loadSettings();
    expect(s.epubPreloadCount).toBe(4);
    expect(s.theme).toBe("dark");
    expect(s.readerMode).toBe("page");
    expect(s.lineHeight).toBe(1.9);
    expect(s.fontFamily).toBe("song");
    expect(s.contentMargin).toBe(24);
    expect(s.hotkeys).toEqual(DEFAULT_HOTKEYS);
  });

  it("自定义键位保存后可读回", () => {
    saveSettings({ hotkeys: { prev: ["a"], next: ["d"], home: ["g"], end: ["G"] } });
    const s = loadSettings();
    expect(s.hotkeys.prev).toEqual(["a"]);
    expect(s.hotkeys.next).toEqual(["d"]);
    expect(s.hotkeys.home).toEqual(["g"]);
    expect(s.hotkeys.end).toEqual(["G"]);
  });

  it("键位过滤修饰键、去重、上限 4", () => {
    const s = saveSettings({
      hotkeys: {
        prev: ["Shift", "a", "a", "b", "c", "d", "e"],
        next: DEFAULT_HOTKEYS.next,
        home: DEFAULT_HOTKEYS.home,
        end: DEFAULT_HOTKEYS.end,
      },
    });
    expect(s.hotkeys.prev).toEqual(["a", "b", "c", "d"]);
  });

  it("跨动作同键冲突：canonical 顺序先到先得，后到者回落默认", () => {
    const s = saveSettings({
      hotkeys: { prev: ["x"], next: ["x"], home: ["x"], end: ["x"] },
    });
    expect(s.hotkeys.prev).toEqual(["x"]);
    expect(s.hotkeys.next).toEqual(DEFAULT_HOTKEYS.next);
    expect(s.hotkeys.home).toEqual(DEFAULT_HOTKEYS.home);
    expect(s.hotkeys.end).toEqual(DEFAULT_HOTKEYS.end);
  });

  it("动作键位为空时回落默认（防手改存储变砖）", () => {
    const s = saveSettings({
      hotkeys: { prev: [], next: DEFAULT_HOTKEYS.next, home: DEFAULT_HOTKEYS.home, end: DEFAULT_HOTKEYS.end },
    });
    expect(s.hotkeys.prev).toEqual(DEFAULT_HOTKEYS.prev);
  });

  it("hotkeys 与既有字段混合保存互不干扰", () => {
    saveSettings({ readerMode: "page", fontSize: 18 });
    const s = saveSettings({
      hotkeys: { prev: ["j"], next: DEFAULT_HOTKEYS.next, home: DEFAULT_HOTKEYS.home, end: DEFAULT_HOTKEYS.end },
    });
    expect(s.readerMode).toBe("page");
    expect(s.fontSize).toBe(18);
    expect(s.hotkeys.prev).toEqual(["j"]);
  });
});

describe("settings v0.2.9（PDF 适配三件套）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("DEFAULT_SETTINGS 含三字段且口径正确", () => {
    expect(DEFAULT_SETTINGS.pdfFit).toBe("auto");
    expect(DEFAULT_SETTINGS.pdfZoom).toBe(100);
    expect(DEFAULT_SETTINGS.pdfDpr).toBe(true);
  });

  it("旧配置（无三字段）载入后回落默认，不抛错", () => {
    localStorage.setItem(
      "bookeditor.settings.v4",
      JSON.stringify({ theme: "dark", readerMode: "page", fontSize: 16 })
    );
    const s = loadSettings();
    expect(s.theme).toBe("dark");
    expect(s.pdfFit).toBe("auto");
    expect(s.pdfZoom).toBe(100);
    expect(s.pdfDpr).toBe(true);
  });

  it("normalizeSettings 逐字段校验：非法 fit/越界 zoom/非布尔 dpr", () => {
    const s = normalizeSettings({
      pdfFit: "neon" as never,
      pdfZoom: 9999,
      pdfDpr: "yes" as never,
    });
    expect(s.pdfFit).toBe("auto");
    expect(s.pdfZoom).toBe(400);
    expect(s.pdfDpr).toBe(true);
  });

  it("合法值原样保留（含 spread 与自定义倍率）", () => {
    const s = normalizeSettings({ pdfFit: "spread", pdfZoom: 175, pdfDpr: false });
    expect(s.pdfFit).toBe("spread");
    expect(s.pdfZoom).toBe(175);
    expect(s.pdfDpr).toBe(false);
  });

  it("saveSettings 合并语义：只改 pdfFit 不动其余字段", () => {
    saveSettings({ readerMode: "page", fontSize: 18 });
    const s = saveSettings({ pdfFit: "height" });
    expect(s.readerMode).toBe("page");
    expect(s.fontSize).toBe(18);
    expect(s.pdfFit).toBe("height");
  });

  it("订阅广播携带新字段（Viewer 即时生效链路）", () => {
    const seen: string[] = [];
    const off = subscribeSettings((s) => seen.push(s.pdfFit));
    saveSettings({ pdfFit: "custom", pdfZoom: 130 });
    off();
    expect(seen).toEqual(["custom"]);
    expect(loadSettings().pdfZoom).toBe(130);
  });

  it("resetSettings 把三字段复位为默认", () => {
    saveSettings({ pdfFit: "spread", pdfZoom: 300, pdfDpr: false });
    const s = resetSettings();
    expect(s.pdfFit).toBe("auto");
    expect(s.pdfZoom).toBe(100);
    expect(s.pdfDpr).toBe(true);
  });
});
