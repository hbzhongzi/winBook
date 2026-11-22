// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MARKS_KEY,
  MARK_COLORS,
  PER_BOOK_LIMIT,
  TOTAL_LIMIT,
  addMark,
  bookMarks,
  clearAllMarks,
  clearBookMarks,
  exportMarksMarkdown,
  formatMarkTime,
  loadMarks,
  markDisplayText,
  markGroup,
  markChapterPaths,
  sortChapterGroups,
  isInkMark,
  inkStrokeCount,
  markPageTop,
  sortPdfMarks,
  normalizeMark,
  removeMark,
  removeMarks,
  subscribeMarks,
  updateMark,
  type Mark,
  type MarkLocator,
} from "../marks";

const BOOK = "E:\\books\\a.epub";
const OTHER = "E:\\books\\b.txt";

function txtLocator(start = 0, end = 10): MarkLocator {
  return { kind: "txt", start, end };
}

function rawMark(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    bookPath: BOOK,
    color: "yellow",
    text: "一段原文",
    note: "",
    locator: { kind: "txt", start: 0, end: 10 },
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

describe("marks v1：读取与校验", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无存储时返回空列表", () => {
    expect(loadMarks()).toEqual([]);
    expect(bookMarks(BOOK)).toEqual([]);
  });

  it("addMark 基本流程：落库、读回、时间戳", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); // 1792497600
    const m = addMark({ bookPath: BOOK, color: "green", text: "划选的文字", locator: txtLocator(5, 12) });
    expect(m.id).toMatch(/^m/);
    expect(m.createdAt).toBe(1792497600);
    expect(m.updatedAt).toBe(1792497600);
    expect(m.note).toBe(""); // note 缺省空串
    expect(m.idea).toBeUndefined();
    const list = loadMarks();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(m);
    vi.useRealTimers();
  });

  it("addMark 写入结构为 { version: 1, marks: [...] }", () => {
    addMark({ bookPath: BOOK, color: "blue", text: "x", locator: txtLocator() });
    const file = JSON.parse(localStorage.getItem(MARKS_KEY)!);
    expect(file.version).toBe(1);
    expect(file.marks).toHaveLength(1);
  });

  it("addMark：同毫秒多次创建 id 不碰撞", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(addMark({ bookPath: BOOK, color: "yellow", text: "t" + i, locator: txtLocator(i, i + 1) }).id);
    }
    expect(ids.size).toBe(50);
    expect(loadMarks()).toHaveLength(50);
    vi.useRealTimers();
  });

  it("addMark：非法颜色回落 yellow，idea 透传", () => {
    const m = addMark({ bookPath: BOOK, color: "rainbow" as never, text: "", locator: txtLocator(), idea: true });
    expect(m.color).toBe("yellow");
    expect(m.idea).toBe(true);
  });

  it("addMark：超长 text/note 截断到 2000 字符", () => {
    const long = "x".repeat(2500);
    const m = addMark({ bookPath: BOOK, color: "yellow", text: long, note: long, locator: txtLocator() });
    expect(m.text).toHaveLength(2000);
    expect(m.note).toHaveLength(2000);
  });

  it("损坏 JSON 回落空列表", () => {
    localStorage.setItem(MARKS_KEY, "{not json");
    expect(loadMarks()).toEqual([]);
  });

  it("version 不符回落空列表", () => {
    localStorage.setItem(MARKS_KEY, JSON.stringify({ version: 99, marks: [rawMark()] }));
    expect(loadMarks()).toEqual([]);
  });

  it("marks 非数组回落空列表", () => {
    localStorage.setItem(MARKS_KEY, JSON.stringify({ version: 1, marks: "nope" }));
    expect(loadMarks()).toEqual([]);
  });

  it("混合存储：非法条目丢弃、合法条目保留", () => {
    localStorage.setItem(
      MARKS_KEY,
      JSON.stringify({
        version: 1,
        marks: [
          rawMark({ id: "ok" }),
          rawMark({ id: "bad-locator", locator: { kind: "mobi" } }),
          rawMark({ id: "bad-book", bookPath: "" }),
          rawMark({ id: "bad-locator2", locator: null }),
          null,
          42,
        ],
      })
    );
    const list = loadMarks();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("ok");
  });

  it("id 为空的条目被丢弃", () => {
    localStorage.setItem(MARKS_KEY, JSON.stringify({ version: 1, marks: [rawMark({ id: "" })] }));
    expect(loadMarks()).toEqual([]);
  });
});

describe("marks v1：normalizeMark 定位器与字段", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("epub 定位器：合法原样通过", () => {
    const m = normalizeMark(
      rawMark({ locator: { kind: "epub", cfi: "epubcfi(/6/4!/4/2)", href: "Text/ch1.xhtml", chapter: "第一章" } })
    );
    expect(m).not.toBeNull();
    expect(m!.locator).toEqual({ kind: "epub", cfi: "epubcfi(/6/4!/4/2)", href: "Text/ch1.xhtml", chapter: "第一章" });
  });

  it("epub 定位器：缺 cfi 返回 null", () => {
    expect(normalizeMark(rawMark({ locator: { kind: "epub", href: "x" } }))).toBeNull();
    expect(normalizeMark(rawMark({ locator: { kind: "epub", cfi: "" } }))).toBeNull();
  });

  it("epub 独立想法：无 cfi 时补占位 cfi 而非丢弃（D77）", () => {
    const m = normalizeMark(
      rawMark({ idea: true, locator: { kind: "epub", cfi: "", href: "", chapter: "" } })
    );
    expect(m).not.toBeNull();
    expect(m!.idea).toBe(true);
    expect(m!.locator.kind).toBe("epub");
    if (m!.locator.kind === "epub") expect(m!.locator.cfi).toBe("epubcfi(/)");
  });

  it("epub 划词标记（非 idea）缺 cfi 仍拒绝", () => {
    expect(normalizeMark(rawMark({ idea: false, locator: { kind: "epub", cfi: "" } }))).toBeNull();
  });

  it("txt 定位器：越界 start 钳制到 0", () => {
    const m = normalizeMark(rawMark({ locator: { kind: "txt", start: -5, end: 3 } }));
    expect(m!.locator).toEqual({ kind: "txt", start: 0, end: 3 });
  });

  it("txt 定位器：end < start 返回 null", () => {
    expect(normalizeMark(rawMark({ locator: { kind: "txt", start: 10, end: 5 } }))).toBeNull();
  });

  it("txt 定位器：非数字 start 返回 null", () => {
    expect(normalizeMark(rawMark({ locator: { kind: "txt", start: "abc", end: 5 } }))).toBeNull();
  });

  it("pdf 定位器：page 合法通过；非数字返回 null；0 钳到 1", () => {
    expect(normalizeMark(rawMark({ locator: { kind: "pdf", page: 12, quote: "" } }))!.locator).toEqual({
      kind: "pdf",
      page: 12,
      quote: "",
    });
    expect(normalizeMark(rawMark({ locator: { kind: "pdf", page: "x" } }))).toBeNull();
    expect(normalizeMark(rawMark({ locator: { kind: "pdf", page: 0 } }))!.locator).toEqual({
      kind: "pdf",
      page: 1,
      quote: "",
    });
  });

  it("未知 kind / 缺 locator 返回 null", () => {
    expect(normalizeMark(rawMark({ locator: { kind: "mobi" } }))).toBeNull();
    expect(normalizeMark(rawMark({ locator: undefined }))).toBeNull();
    expect(normalizeMark(null)).toBeNull();
    expect(normalizeMark("mark")).toBeNull();
  });

  it("颜色白名单外回落 yellow", () => {
    expect(normalizeMark(rawMark({ color: "rainbow" }))!.color).toBe("yellow");
    for (const c of MARK_COLORS) {
      expect(normalizeMark(rawMark({ color: c }))!.color).toBe(c);
    }
  });

  it("idea：仅 true 保留字段，false/非布尔不写入", () => {
    expect(normalizeMark(rawMark({ idea: true }))!.idea).toBe(true);
    expect(normalizeMark(rawMark({ idea: false }))!.idea).toBeUndefined();
    expect(normalizeMark(rawMark({ idea: "yes" }))!.idea).toBeUndefined();
  });

  it("createdAt/updatedAt 非数字回落 0", () => {
    const m = normalizeMark(rawMark({ createdAt: "soon", updatedAt: null }))!;
    expect(m.createdAt).toBe(0);
    expect(m.updatedAt).toBe(0);
  });

  it("超长 text/note 截断到 2000 字符", () => {
    const m = normalizeMark(rawMark({ text: "y".repeat(2500), note: "z".repeat(2500) }))!;
    expect(m.text).toHaveLength(2000);
    expect(m.note).toHaveLength(2000);
  });
});

describe("marks v1：增删改与广播", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("bookMarks 只返回本书且按 updatedAt 倒序", () => {
    localStorage.setItem(
      MARKS_KEY,
      JSON.stringify({
        version: 1,
        marks: [
          rawMark({ id: "a", updatedAt: 100 }),
          rawMark({ id: "b", updatedAt: 300 }),
          rawMark({ id: "c", bookPath: OTHER, updatedAt: 999 }),
          rawMark({ id: "d", updatedAt: 200 }),
        ],
      })
    );
    expect(bookMarks(BOOK).map((m) => m.id)).toEqual(["b", "d", "a"]);
    expect(bookMarks(OTHER).map((m) => m.id)).toEqual(["c"]);
    expect(bookMarks("E:\\ghost.epub")).toEqual([]);
  });

  it("updateMark 刷新 updatedAt 且只改 patch 字段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    addMark({ bookPath: BOOK, color: "yellow", text: "原文", note: "旧感悟", locator: txtLocator(1, 5) });
    const id = loadMarks()[0].id;
    vi.setSystemTime(new Date("2026-10-20T13:00:00Z")); // +3600s
    updateMark(id, { note: "新感悟" });
    const m = loadMarks()[0];
    expect(m.note).toBe("新感悟");
    expect(m.updatedAt).toBe(1792501200);
    expect(m.text).toBe("原文"); // 未提供的字段不动
    expect(m.color).toBe("yellow");
    vi.useRealTimers();
  });

  it("updateMark：非法颜色不覆盖、id 不存在静默且不广播", () => {
    addMark({ bookPath: BOOK, color: "pink", text: "原文", locator: txtLocator() });
    const id = loadMarks()[0].id;
    updateMark(id, { color: "rainbow" as never });
    expect(loadMarks()[0].color).toBe("pink");
    const fn = vi.fn();
    const off = subscribeMarks(fn);
    updateMark("ghost-id", { note: "x" });
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("removeMark 移除单条", () => {
    addMark({ bookPath: BOOK, color: "yellow", text: "a", locator: txtLocator(0, 1) });
    addMark({ bookPath: BOOK, color: "yellow", text: "b", locator: txtLocator(1, 2) });
    const [first] = loadMarks();
    removeMark(first.id);
    expect(loadMarks()).toHaveLength(1);
    expect(loadMarks()[0].text).toBe("b");
  });

  it("removeMarks 批量移除：单次写盘单次广播（D59）", () => {
    addMark({ bookPath: BOOK, color: "yellow", text: "a", locator: txtLocator(0, 1) });
    addMark({ bookPath: BOOK, color: "yellow", text: "b", locator: txtLocator(1, 2) });
    addMark({ bookPath: BOOK, color: "yellow", text: "c", locator: txtLocator(2, 3) });
    const seen: number[] = [];
    const off = subscribeMarks((list) => seen.push(list.length));
    removeMarks([loadMarks()[0].id, loadMarks()[1].id]);
    expect(seen).toEqual([1]); // 一次广播
    expect(loadMarks()).toHaveLength(1);
    off();
  });

  it("removeMarks 空数组不写盘不广播", () => {
    addMark({ bookPath: BOOK, color: "yellow", text: "a", locator: txtLocator() });
    const fn = vi.fn();
    const off = subscribeMarks(fn);
    removeMarks([]);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("clearBookMarks 只清本书；clearAllMarks 清全部", () => {
    addMark({ bookPath: BOOK, color: "yellow", text: "a", locator: txtLocator(0, 1) });
    addMark({ bookPath: OTHER, color: "yellow", text: "b", locator: txtLocator(1, 2) });
    clearBookMarks(BOOK);
    expect(bookMarks(BOOK)).toEqual([]);
    expect(bookMarks(OTHER)).toHaveLength(1);
    clearAllMarks();
    expect(loadMarks()).toEqual([]);
  });

  it("订阅：同页广播 + 取消后静默；storage 事件同步（同键触发、异键不触发）", () => {
    const seen: number[] = [];
    const off = subscribeMarks((list) => seen.push(list.length));
    addMark({ bookPath: BOOK, color: "yellow", text: "a", locator: txtLocator() });
    expect(seen).toEqual([1]);
    off();
    addMark({ bookPath: BOOK, color: "yellow", text: "b", locator: txtLocator(1, 2) });
    expect(seen).toEqual([1]); // 取消后无回调

    const fn = vi.fn();
    const off2 = subscribeMarks(fn);
    window.dispatchEvent(new StorageEvent("storage", { key: "some.other.key" }));
    expect(fn).not.toHaveBeenCalled(); // 异键不触发
    window.dispatchEvent(new StorageEvent("storage", { key: MARKS_KEY }));
    expect(fn).toHaveBeenCalledTimes(1);
    off2();
  });

  it("多个订阅者均收到广播", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeMarks(a);
    const offB = subscribeMarks(b);
    addMark({ bookPath: BOOK, color: "yellow", text: "x", locator: txtLocator() });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });
});

describe("marks v1：容量上限（D66）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function fill(bookPath: string, count: number, idPrefix: string, baseTs: number): void {
    const marks = [];
    for (let i = 0; i < count; i++) {
      marks.push(
        rawMark({
          id: idPrefix + i,
          bookPath,
          updatedAt: baseTs + i,
          createdAt: baseTs + i,
          locator: { kind: "txt", start: i, end: i + 1 },
        })
      );
    }
    localStorage.setItem(MARKS_KEY, JSON.stringify({ version: 1, marks }));
  }

  it("单本超限静默淘汰最旧", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    fill(BOOK, PER_BOOK_LIMIT, "old", 1000);
    const m = addMark({ bookPath: BOOK, color: "green", text: "new", locator: txtLocator(0, 4) });
    const list = loadMarks();
    expect(list).toHaveLength(PER_BOOK_LIMIT);
    expect(list.some((x) => x.id === m.id)).toBe(true); // 新条目保留
    expect(list.some((x) => x.id === "old0")).toBe(false); // 最旧被淘汰
    expect(list.some((x) => x.id === "old" + (PER_BOOK_LIMIT - 1))).toBe(true);
    vi.useRealTimers();
  });

  it("总量超限按 updatedAt 淘汰最旧", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    // 5 本书：400×4 + 401 = 2001 条（单本均不超限，确保走总量淘汰路径）
    const all: Record<string, unknown>[] = [];
    let idx = 0;
    for (let b = 0; b < 5; b++) {
      const count = b < 4 ? 400 : 401;
      for (let i = 0; i < count; i++, idx++) {
        all.push(
          rawMark({
            id: "t" + idx,
            bookPath: "E:\\b" + b + ".epub",
            updatedAt: 1000 + idx,
            createdAt: 1000 + idx,
            locator: { kind: "txt", start: i, end: i + 1 },
          })
        );
      }
    }
    localStorage.setItem(MARKS_KEY, JSON.stringify({ version: 1, marks: all }));
    expect(loadMarks()).toHaveLength(TOTAL_LIMIT + 1);

    const m = addMark({ bookPath: "E:\\b0.epub", color: "blue", text: "x", locator: txtLocator(0, 1) });
    const list = loadMarks();
    expect(list).toHaveLength(TOTAL_LIMIT);
    expect(list.some((x) => x.id === m.id)).toBe(true);
    expect(list.some((x) => x.id === "t0")).toBe(false); // 全局最旧被淘汰
    expect(list.some((x) => x.id === "t1")).toBe(false); // 次旧也被淘汰
    expect(list.some((x) => x.id === "t2")).toBe(true);
    vi.useRealTimers();
  });
});

describe("marks v1：分组与展示辅助", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const base: Mark = {
    id: "x",
    bookPath: BOOK,
    color: "yellow",
    text: "",
    note: "",
    locator: txtLocator(),
    createdAt: 0,
    updatedAt: 0,
  };

  it("markGroup：想法 / EPUB 章节 / PDF 页码 / TXT 全文", () => {
    expect(markGroup({ ...base, idea: true })).toBe("想法");
    expect(markGroup({ ...base, locator: { kind: "epub", cfi: "c", href: "h", chapter: "第三章" } })).toBe("第三章");
    expect(markGroup({ ...base, locator: { kind: "epub", cfi: "c", href: "h", chapter: "" } })).toBe("正文");
    expect(markGroup({ ...base, locator: { kind: "pdf", page: 12, quote: "" } })).toBe("第 12 页");
    expect(markGroup(base)).toBe("全文");
  });

  it("markDisplayText 原样返回 text", () => {
    expect(markDisplayText({ ...base, text: "引文" })).toBe("引文");
    expect(markDisplayText({ ...base, text: "", idea: true })).toBe("");
  });

  it("formatMarkTime 各区间", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); // 1792497600
    const now = 1792497600;
    expect(formatMarkTime(now - 30)).toBe("刚刚");
    expect(formatMarkTime(now - 300)).toBe("5 分钟前");
    expect(formatMarkTime(now - 7200)).toBe("2 小时前");
    expect(formatMarkTime(now - 86400 * 3)).toBe("3 天前");
    expect(formatMarkTime(now - 86400 * 30)).toMatch(/\d+ 月 \d+ 日/);
    expect(formatMarkTime(0)).toBe("—");
    expect(formatMarkTime(-5)).toBe("—");
    expect(formatMarkTime(Number.NaN)).toBe("—");
    vi.useRealTimers();
  });
});

describe("marks v1：导出 Markdown（F37）", () => {
  const T = 1792497600; // 2026-10-20T12:00:00Z

  beforeEach(() => {
    localStorage.clear();
    // formatMarkTime 依赖当前时间：固定系统时间使「N 分钟前」可确定断言
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mk(id: string, over: Partial<Mark>): Mark {
    return {
      id,
      bookPath: BOOK,
      color: "yellow",
      text: "",
      note: "",
      locator: txtLocator(),
      createdAt: T,
      updatedAt: T,
      ...over,
    };
  }

  it("空列表输出占位文案", () => {
    const md = exportMarksMarkdown("空书", []);
    expect(md).toContain("# 《空书》标记记录");
    expect(md).toContain("（暂无标记）");
  });

  it("标题、分组顺序（首次出现）、组内 updatedAt 倒序", () => {
    const md = exportMarksMarkdown("测试书", [
      mk("1", { text: "旧的全文章条", note: "n1", updatedAt: T - 5000 }),
      mk("2", { text: "新的全文章条", note: "n2", updatedAt: T - 50 }),
      mk("3", { locator: { kind: "epub", cfi: "c", href: "h", chapter: "第三章" }, text: "EPUB 引文", note: "" }),
      mk("4", { idea: true, note: "一个念头" }),
    ]);
    expect(md.startsWith("# 《测试书》标记记录")).toBe(true);
    // 分组顺序 = 首次出现顺序：全文 → 第三章 → 想法
    expect(md.indexOf("## 全文")).toBeLessThan(md.indexOf("## 第三章"));
    expect(md.indexOf("## 第三章")).toBeLessThan(md.indexOf("## 想法"));
    // 组内倒序：新的在全文的旧的前面
    expect(md.indexOf("新的全文章条")).toBeLessThan(md.indexOf("旧的全文章条"));
  });

  it("想法条目：◆ 前缀 + 感悟正文，无引用块", () => {
    const md = exportMarksMarkdown("测试书", [mk("1", { idea: true, note: "睡觉前想到的", updatedAt: T - 100 })]);
    expect(md).toContain("◆ **想法**（1 分钟前）");
    expect(md).toContain("睡觉前想到的");
    expect(md).not.toContain("> ");
  });

  it("普通条目：引用块 + 感悟 + 位置脚注", () => {
    const md = exportMarksMarkdown("测试书", [
      mk("1", {
        text: "第一行\n第二行",
        note: "跨行的感悟",
        locator: { kind: "txt", start: 10, end: 20 },
        updatedAt: T - 200,
      }),
    ]);
    expect(md).toContain("> 第一行\n> 第二行"); // 多行引用逐行加前缀
    expect(md).toContain("**感悟：** 跨行的感悟");
    expect(md).toContain("*位置：字符区间 10–20 · 3 分钟前*");
  });

  it("纯高亮（无感悟）只输出引用与位置脚注", () => {
    const md = exportMarksMarkdown("测试书", [
      mk("1", { text: "只是划线", note: "", locator: txtLocator(3, 9), updatedAt: T - 3600 }),
    ]);
    expect(md).toContain("> 只是划线");
    expect(md).not.toContain("**感悟：**");
    expect(md).toContain("*位置：字符区间 3–9 · 1 小时前*");
  });

  it("PDF 页级条目：无引用块，位置脚注为页码", () => {
    const md = exportMarksMarkdown("测试书", [
      mk("1", { text: "", note: "这页是重点", locator: { kind: "pdf", page: 12, quote: "" }, updatedAt: T - 400 }),
    ]);
    expect(md).toContain("**感悟：** 这页是重点");
    expect(md).toContain("*位置：第 12 页 · 6 分钟前*");
    expect(md).not.toContain("> ");
  });

  it("EPUB 条目脚注取章节名", () => {
    const md = exportMarksMarkdown("测试书", [
      mk("1", { text: "引文", locator: { kind: "epub", cfi: "c", href: "h", chapter: "第三章" }, updatedAt: T - 400 }),
    ]);
    expect(md).toContain("*位置：第三章 · 6 分钟前*");
  });
});

describe("D96：标记按章节组织", () => {
  const nodes = [
    { href: "p1.html", label: "Part 1", depth: 0, order: [0], labels: ["Part 1"] },
    { href: "s1.html", label: "Story One", depth: 1, order: [0, 0], labels: ["Part 1", "Story One"] },
    { href: "p2.html", label: "Part 2", depth: 0, order: [1], labels: ["Part 2"] },
    { href: "s2.html", label: "Story Two", depth: 1, order: [1, 0], labels: ["Part 2", "Story Two"] },
  ];

  const epubMark = (id: string, chapter: string): Mark => ({
    id,
    bookPath: BOOK,
    color: "yellow",
    text: "原文",
    note: "",
    locator: { kind: "epub", cfi: "epubcfi(/6/2)", href: "s1.html", chapter },
    createdAt: 1,
    updatedAt: 1,
  });

  it("按标签精确匹配反查章节路径", () => {
    const paths = markChapterPaths([epubMark("a", "Story Two")], nodes);
    expect(paths.get("a")).toEqual({
      key: "s2.html",
      order: [1, 0],
      labels: ["Part 2", "Story Two"],
      href: "s2.html",
    });
  });

  it("标签不匹配时不猜：返回空映射（面板落「由 markGroup 决定的分组」）", () => {
    const paths = markChapterPaths([epubMark("a", "不存在的章")], nodes);
    expect(paths.size).toBe(0);
  });

  it("独立想法与 TXT/PDF 不参与章节路径（无原文可归章）", () => {
    const idea: Mark = { ...epubMark("i", "Story One"), idea: true };
    const txt: Mark = { ...epubMark("t", "Story One"), locator: { kind: "txt", start: 0, end: 3 } };
    expect(markChapterPaths([idea, txt], nodes).size).toBe(0);
  });

  it("分组按目录阅读顺序排序，父章在子节之前", () => {
    const sorted = sortChapterGroups([
      { name: "Story Two", order: [1, 0], items: [] },
      { name: "Part 1", order: [0], items: [] },
      { name: "Story One", order: [0, 0], items: [] },
    ]);
    expect(sorted.map((g) => g.name)).toEqual(["Part 1", "Story One", "Story Two"]);
  });

  it("无路径的分组（想法/未归类）殿后并保持相对顺序", () => {
    const sorted = sortChapterGroups([
      { name: "想法", order: null, items: [] },
      { name: "Story Two", order: [1, 0], items: [] },
      { name: "未归类", order: null, items: [] },
      { name: "Part 1", order: [0], items: [] },
    ]);
    expect(sorted.map((g) => g.name)).toEqual(["Part 1", "Story Two", "想法", "未归类"]);
  });
});

describe("D101：PDF 画笔笔迹", () => {
  const mkStroke = (over: Partial<Record<string, unknown>> = {}) => ({
    brush: "pen",
    color: "red",
    width: 3,
    points: [10, 20, 30, 40],
    baseW: 800,
    baseH: 1000,
    top: 0.2,
    ...over,
  });

  const mkInkMark = (strokes: unknown[], page = 3) =>
    normalizeMark({
      id: "m1",
      bookPath: "/a.pdf",
      color: "yellow",
      text: "",
      note: "",
      locator: { kind: "pdf", page, quote: "", strokes },
      createdAt: 1,
      updatedAt: 1,
    });

  it("合法笔迹被保留，坐标与基准尺寸不变", () => {
    const m = mkInkMark([mkStroke()]);
    expect(m).not.toBeNull();
    const loc = m!.locator;
    expect(loc.kind).toBe("pdf");
    if (loc.kind !== "pdf") return;
    expect(loc.strokes).toHaveLength(1);
    expect(loc.strokes![0].points).toEqual([10, 20, 30, 40]);
    expect(loc.strokes![0].baseW).toBe(800);
  });

  it("D107：合法 alpha 被保留，非法值只回落默认而不丢弃笔迹", () => {
    const locOf = (alpha: unknown) =>
      mkInkMark([mkStroke({ brush: "highlighter", alpha })])!.locator;

    const ok = locOf(0.7);
    if (ok.kind !== "pdf") return;
    expect(ok.strokes![0].alpha).toBe(0.7);

    // 边界值保留
    const lo = locOf(0.05);
    if (lo.kind === "pdf") expect(lo.strokes![0].alpha).toBe(0.05);
    const hi = locOf(1);
    if (hi.kind === "pdf") expect(hi.strokes![0].alpha).toBe(1);

    // 越界 / 非数字 / NaN / null 一律回落 undefined，但笔迹本身仍在
    for (const bad of [0, 1.5, Number.NaN, "deep", null]) {
      const loc = locOf(bad);
      if (loc.kind !== "pdf") continue;
      expect(loc.strokes).toHaveLength(1);
      expect(loc.strokes![0].alpha).toBeUndefined();
    }
  });

  it("D107：旧笔迹无 alpha 字段仍正常保留（零回归）", () => {
    const loc = mkInkMark([mkStroke()])!.locator;
    if (loc.kind !== "pdf") return;
    expect(loc.strokes).toHaveLength(1);
    expect(loc.strokes![0].alpha).toBeUndefined();
    expect(loc.strokes![0].brush).toBe("pen");
  });

  it("无笔迹的纯书签条目不写 strokes 字段（兼容旧数据）", () => {
    const m = mkInkMark([]);
    const loc = m!.locator;
    if (loc.kind !== "pdf") return;
    expect(loc.strokes).toBeUndefined();
    expect(isInkMark(m!)).toBe(false);
  });

  it("损坏笔迹逐条丢弃：点数不足 4 个、奇数个、非法笔刷、非法颜色", () => {
    const m = mkInkMark([
      mkStroke({ points: [1, 2] }), // 只有一个点
      mkStroke({ points: [1, 2, 3] }), // 奇数
      mkStroke({ brush: "eraser" }), // 橡皮擦不落库
      mkStroke({ color: "紫" }), // 非法颜色
      mkStroke(), // 唯一合法
    ]);
    const loc = m!.locator;
    if (loc.kind !== "pdf") return;
    expect(loc.strokes).toHaveLength(1);
  });

  it("基准尺寸缺失或为 0 的笔迹被丢弃（否则缩放时无法归一化）", () => {
    // 校验的是 isInkMark / inkStrokeCount 的可见结果，而不是字段是否存在
    expect(isInkMark(mkInkMark([mkStroke({ baseW: 0 })])!)).toBe(false);
    expect(isInkMark(mkInkMark([mkStroke({ baseH: -1 })])!)).toBe(false);
    expect(inkStrokeCount(mkInkMark([mkStroke({ baseW: 0 })])!)).toBe(0);
  });

  it("top 被钳制到 0~1", () => {
    const m = mkInkMark([mkStroke({ top: 5 })]);
    const loc = m!.locator;
    if (loc.kind !== "pdf") return;
    expect(loc.strokes![0].top).toBe(1);
  });

  it("isInkMark / inkStrokeCount / markPageTop 读值正确", () => {
    const m = mkInkMark([mkStroke({ top: 0.6 }), mkStroke({ top: 0.3 })])!;
    expect(isInkMark(m)).toBe(true);
    expect(inkStrokeCount(m)).toBe(2);
    // 取最早（最上）的位置
    expect(markPageTop(m)).toBeCloseTo(0.3);
  });

  it("sortPdfMarks：先按页码，再按页内纵向位置，无位置者殿后", () => {
    const ink = (page: number, top: number, id: string) =>
      normalizeMark({
        id,
        bookPath: "/a.pdf",
        color: "yellow",
        text: "",
        note: "",
        locator: { kind: "pdf", page, quote: "", strokes: [mkStroke({ top })] },
        createdAt: 1,
        updatedAt: 1,
      })!;
    const bookmark = (page: number, id: string) =>
      normalizeMark({
        id,
        bookPath: "/a.pdf",
        color: "yellow",
        text: "",
        note: "",
        locator: { kind: "pdf", page, quote: "" },
        createdAt: 1,
        updatedAt: 1,
      })!;
    const sorted = sortPdfMarks([
      ink(5, 0.8, "e"),
      bookmark(3, "bm"),
      ink(5, 0.1, "d"),
      ink(2, 0.5, "c"),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["c", "bm", "d", "e"]);
  });

  it("导出 Markdown 含手写标注与页内位置描述", () => {
    const m = mkInkMark([mkStroke({ top: 0.42 })])!;
    const md = exportMarksMarkdown("测试书", [m]);
    expect(md).toContain("手写标注：1 笔");
    expect(md).toContain("42%");
  });
});
