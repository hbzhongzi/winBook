// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LIBRARY_KEY,
  LIBRARY_LIMIT,
  clearLibrary,
  entryCategory,
  formatRelativeTime,
  getEntry,
  listEntries,
  loadLibrary,
  normalizePosition,
  progressLabel,
  removeEntries,
  removeEntry,
  reportPosition,
  savePosition,
  setEntriesCategory,
  setEntryCategory,
  subscribeLibrary,
  upsertEntry,
  type LibraryEntry,
  type ReadingPosition,
} from "../library";

const EPUB_POS: ReadingPosition = {
  kind: "epub",
  tocIndex: 3,
  href: "Text/ch4.xhtml",
  sectionIndex: 5,
  ratio: 0.42,
};

function entry(path: string, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    path,
    name: path.split("\\").pop() ?? path,
    format: "epub",
    size: 1024,
    mtime: 1000,
    lastOpen: 1000,
    position: EPUB_POS,
    progress: 0.5,
    ...over,
  };
}

describe("library v1", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无存储时返回空库", () => {
    expect(loadLibrary()).toEqual([]);
    expect(listEntries()).toEqual([]);
    expect(getEntry("x")).toBeNull();
  });

  it("upsert 后可读回", () => {
    upsertEntry(entry("E:\\a.epub"));
    const list = loadLibrary();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("E:\\a.epub");
    expect(list[0].position).toEqual(EPUB_POS);
  });

  it("同 path 去重更新，不新增条目", () => {
    upsertEntry(entry("E:\\a.epub", { progress: 0.1 }));
    upsertEntry(entry("E:\\a.epub", { progress: 0.9, lastOpen: 2000 }));
    const list = loadLibrary();
    expect(list).toHaveLength(1);
    expect(list[0].progress).toBe(0.9);
    expect(list[0].lastOpen).toBe(2000);
  });

  it("按 lastOpen 倒序", () => {
    upsertEntry(entry("E:\\old.epub", { lastOpen: 1000 }));
    upsertEntry(entry("E:\\new.epub", { lastOpen: 5000 }));
    upsertEntry(entry("E:\\mid.epub", { lastOpen: 3000 }));
    expect(loadLibrary().map((e) => e.path)).toEqual([
      "E:\\new.epub",
      "E:\\mid.epub",
      "E:\\old.epub",
    ]);
  });

  it("超过上限淘汰最旧", () => {
    for (let i = 0; i < LIBRARY_LIMIT + 5; i++) {
      upsertEntry(entry(`E:\\b${i}.epub`, { lastOpen: 1000 + i }));
    }
    const list = loadLibrary();
    expect(list).toHaveLength(LIBRARY_LIMIT);
    // 最旧的 5 条（lastOpen 1000..1004）应被淘汰
    expect(list.some((e) => e.lastOpen === 1000)).toBe(false);
    expect(list[0].lastOpen).toBe(1000 + LIBRARY_LIMIT + 4);
  });

  it("savePosition 建条目并刷新 lastOpen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); // 1792497600
    savePosition({
      path: "E:\\a.epub",
      name: "a.epub",
      format: "epub",
      size: 2048,
      mtime: 999,
      position: EPUB_POS,
      progress: 0.31,
    });
    const e = getEntry("E:\\a.epub");
    expect(e).not.toBeNull();
    expect(e!.lastOpen).toBe(1792497600);
    expect(e!.progress).toBe(0.31);
    vi.useRealTimers();
  });

  it("savePosition 保留既有分类（D72：重开不丢分类）", () => {
    // 真实路径：先打开入架（upsert）→ 书架里归类 → 再次打开（savePosition）
    upsertEntry(entry("E:\\b.pdf", { format: "pdf" }));
    setEntryCategory("E:\\b.pdf", "技术");
    expect(getEntry("E:\\b.pdf")!.cat).toBe("技术"); // 归类生效
    // 重开：handleOpen 调 savePosition 刷新 lastOpen，应保留 cat
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    savePosition({
      path: "E:\\b.pdf",
      name: "b.pdf",
      format: "pdf",
      size: 4096,
      mtime: 5,
      position: { kind: "pdf", page: 1, pageCount: 120 },
      progress: 0,
    });
    vi.useRealTimers();
    const e = getEntry("E:\\b.pdf");
    expect(e).not.toBeNull();
    expect(e!.cat).toBe("技术"); // 关键：分类不被 savePosition 清空
    expect(e!.position).toEqual({ kind: "pdf", page: 1, pageCount: 120 });
  });

  it("savePosition 首次打开（无旧条目）不写脏 cat", () => {
    savePosition({
      path: "E:\\c.txt",
      name: "c.txt",
      format: "txt",
      size: 10,
      mtime: 1,
      position: null,
      progress: 0,
    });
    const e = getEntry("E:\\c.txt");
    expect(e).not.toBeNull();
    expect(e!.cat).toBeUndefined(); // 首次打开不应出现「未分类」脏字段
  });

  it("reportPosition 只更位置，不刷新 lastOpen", () => {
    upsertEntry(entry("E:\\a.epub", { lastOpen: 1234 }));
    reportPosition({
      path: "E:\\a.epub",
      position: { kind: "txt", ratio: 0.77 },
      progress: 0.77,
    });
    const e = getEntry("E:\\a.epub");
    expect(e!.lastOpen).toBe(1234); // 不被打乱
    expect(e!.position).toEqual({ kind: "txt", ratio: 0.77 });
  });

  it("reportPosition 对未记录的书不补建条目", () => {
    reportPosition({ path: "E:\\ghost.epub", position: EPUB_POS, progress: 0.5 });
    expect(loadLibrary()).toEqual([]);
  });

  it("removeEntry 与 clearLibrary", () => {
    upsertEntry(entry("E:\\a.epub"));
    upsertEntry(entry("E:\\b.pdf", { format: "pdf" }));
    expect(removeEntry("E:\\a.epub")).toHaveLength(1);
    expect(getEntry("E:\\a.epub")).toBeNull();
    expect(clearLibrary()).toEqual([]);
  });

  it("损坏 JSON 回落空库", () => {
    localStorage.setItem(LIBRARY_KEY, "{not json");
    expect(loadLibrary()).toEqual([]);
  });

  it("version 不符回落空库", () => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ version: 99, entries: [entry("E:\\a.epub")] }));
    expect(loadLibrary()).toEqual([]);
  });

  it("format 白名单外的条目被丢弃", () => {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        entries: [entry("E:\\a.mobi", { format: "mobi" as never }), entry("E:\\b.epub")],
      })
    );
    const list = loadLibrary();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("E:\\b.epub");
  });

  it("position 结构非法时置 null 而不丢条目", () => {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ ...entry("E:\\a.epub"), position: { kind: "epub" } }],
      })
    );
    const list = loadLibrary();
    expect(list).toHaveLength(1);
    expect(list[0].position).toBeNull();
  });

  it("ratio/progress 越界被钳制", () => {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ ...entry("E:\\a.epub"), progress: 5, position: { kind: "txt", ratio: -2 } }],
      })
    );
    const list = loadLibrary();
    expect(list[0].progress).toBe(1);
    expect(list[0].position).toEqual({ kind: "txt", ratio: 0 });
  });

  it("normalizePosition：pdf 补 pageCount、epub 缺 href 为 null、未知 kind 为 null", () => {
    expect(normalizePosition({ kind: "pdf", page: 3, pageCount: 120 })).toEqual({
      kind: "pdf",
      page: 3,
      pageCount: 120,
    });
    expect(normalizePosition({ kind: "epub", tocIndex: 1, sectionIndex: 2, ratio: 0.5 })).toBeNull();
    expect(normalizePosition({ kind: "mobi" })).toBeNull();
    expect(normalizePosition(null)).toBeNull();
  });

  it("订阅：同页广播 + 取消后不再回调；storage 事件触发", () => {
    const seen: number[] = [];
    const unsub = subscribeLibrary((list) => seen.push(list.length));
    upsertEntry(entry("E:\\a.epub"));
    expect(seen).toEqual([1]);
    unsub();
    upsertEntry(entry("E:\\b.epub"));
    expect(seen).toEqual([1]); // 取消后无回调

    // storage 事件（多实例同步通道）
    const onStorage = vi.fn();
    const unsub2 = subscribeLibrary(onStorage);
    window.dispatchEvent(new StorageEvent("storage", { key: LIBRARY_KEY }));
    expect(onStorage).toHaveBeenCalledTimes(1);
    unsub2();
  });

  it("formatRelativeTime 各区间", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(formatRelativeTime(now - 30)).toBe("刚刚");
    expect(formatRelativeTime(now - 300)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 7200)).toBe("2 小时前");
    expect(formatRelativeTime(now - 86400 * 3)).toBe("3 天前");
    expect(formatRelativeTime(now - 86400 * 30)).toMatch(/月.*日/);
    expect(formatRelativeTime(0)).toBe("—");
  });

  it("progressLabel：EPUB 约值 / PDF 页数 / TXT 百分比", () => {
    expect(progressLabel(entry("E:\\a.epub", { progress: 0.314 }))).toBe("约 31%");
    expect(
      progressLabel(
        entry("E:\\a.pdf", {
          format: "pdf",
          position: { kind: "pdf", page: 3, pageCount: 120 },
          progress: 0.025,
        })
      )
    ).toBe("3 / 120 页");
    expect(progressLabel(entry("E:\\a.txt", { format: "txt", progress: 0.61 }))).toBe("61%");
  });

  it("normalizePosition 保留合法 cfi，丢弃非法 mode/空 cfi", () => {
    expect(
      normalizePosition({ kind: "epub", tocIndex: 2, href: "x", sectionIndex: 3, ratio: 0.1, cfi: "epubcfi(/6/4!/c)" })
    ).toEqual({ kind: "epub", tocIndex: 2, href: "x", sectionIndex: 3, ratio: 0.1, cfi: "epubcfi(/6/4!/c)" });
    // 非法 mode 丢弃
    expect(
      normalizePosition({ kind: "epub", href: "x", tocIndex: 0, sectionIndex: 0, ratio: 0, mode: "weird" as never })
    ).toEqual({ kind: "epub", href: "x", tocIndex: 0, sectionIndex: 0, ratio: 0 });
    // 空 cfi 丢弃
    expect(
      normalizePosition({ kind: "epub", href: "x", tocIndex: 0, sectionIndex: 0, ratio: 0, cfi: "" })
    ).toEqual({ kind: "epub", href: "x", tocIndex: 0, sectionIndex: 0, ratio: 0 });
  });

  it("normalizePosition txt 保留合法 anchor，缺失/非有限丢弃，越界钳制", () => {
    expect(normalizePosition({ kind: "txt", ratio: 0.2, anchor: 5000 })).toEqual({
      kind: "txt",
      ratio: 0.2,
      anchor: 5000,
    });
    expect(normalizePosition({ kind: "txt", ratio: 0.2 })).toEqual({ kind: "txt", ratio: 0.2 });
    expect(normalizePosition({ kind: "txt", ratio: 0.2, anchor: "notnum" as never })).toEqual({
      kind: "txt",
      ratio: 0.2,
    });
    // 越界锚点钳制到 1e9
    expect(normalizePosition({ kind: "txt", ratio: 0.2, anchor: 9_000_000_000 })).toEqual({
      kind: "txt",
      ratio: 0.2,
      anchor: 1_000_000_000,
    });
  });

  it("normalizePosition pdf 保留 mode", () => {
    expect(normalizePosition({ kind: "pdf", page: 5, pageCount: 200, mode: "page" })).toEqual({
      kind: "pdf",
      page: 5,
      pageCount: 200,
      mode: "page",
    });
  });

  it("旧版位置（无 cfi/anchor/mode）降级恢复不报错，结构保持", () => {
    const legacy = { kind: "epub", tocIndex: 1, href: "T", sectionIndex: 1, ratio: 0.3 };
    expect(normalizePosition(legacy)).toEqual(legacy);
    const legacyTxt = { kind: "txt", ratio: 0.5 };
    expect(normalizePosition(legacyTxt)).toEqual(legacyTxt);
  });
});

// ===== v0.2.8：分类字段与批量 API =====
describe("library v0.2.8 分类与批量操作", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("cat 归一化：缺失/空串/空白 → 未定义；有效值 trim 后保留", () => {
    upsertEntry(entry("E://a.epub", { cat: "  小说  " }));
    upsertEntry(entry("E://b.epub", { cat: "   " }));
    upsertEntry(entry("E://c.epub"));
    const list = loadLibrary();
    const byPath = (p: string) => list.find((e) => e.path === p)!;
    expect(byPath("E://a.epub").cat).toBe("小说");
    expect(byPath("E://b.epub").cat).toBeUndefined();
    expect(byPath("E://c.epub").cat).toBeUndefined();
  });

  it("entryCategory 缺省回落到「未分类」", () => {
    expect(entryCategory(entry("E://a.epub"))).toBe("未分类");
    expect(entryCategory(entry("E://a.epub", { cat: "技术" }))).toBe("技术");
    expect(entryCategory(entry("E://a.epub"), "未归类")).toBe("未归类");
  });

  it("setEntriesCategory 批量归类：单次写盘且只广播一次", () => {
    upsertEntry(entry("E://a.epub"));
    upsertEntry(entry("E://b.epub"));
    upsertEntry(entry("E://c.epub"));
    const fn = vi.fn();
    subscribeLibrary(fn);
    setEntriesCategory(["E://a.epub", "E://b.epub"], "技术");
    expect(fn).toHaveBeenCalledTimes(1);
    const list = loadLibrary();
    expect(list.find((e) => e.path === "E://a.epub")!.cat).toBe("技术");
    expect(list.find((e) => e.path === "E://b.epub")!.cat).toBe("技术");
    expect(list.find((e) => e.path === "E://c.epub")!.cat).toBeUndefined();
  });

  it("setEntriesCategory 传空值清除分类（回到未分类）", () => {
    upsertEntry(entry("E://a.epub", { cat: "小说" }));
    setEntryCategory("E://a.epub", "");
    expect(loadLibrary()[0].cat).toBeUndefined();
  });

  it("removeEntries 批量移除：单次写盘且只广播一次", () => {
    upsertEntry(entry("E://a.epub"));
    upsertEntry(entry("E://b.epub"));
    upsertEntry(entry("E://c.epub"));
    const fn = vi.fn();
    subscribeLibrary(fn);
    const left = removeEntries(["E://a.epub", "E://c.epub"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(left.map((e) => e.path)).toEqual(["E://b.epub"]);
  });

  it("removeEntries 空数组不写盘", () => {
    upsertEntry(entry("E://a.epub"));
    const fn = vi.fn();
    subscribeLibrary(fn);
    removeEntries([]);
    expect(fn).not.toHaveBeenCalled();
    expect(loadLibrary()).toHaveLength(1);
  });

  it("旧版数据（无 cat 字段）载入后仍可用，不报错", () => {
    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        entries: [{ path: "E://old.epub", name: "old.epub", format: "epub", size: 1, mtime: 1, lastOpen: 2, position: null, progress: 0.1 }],
      })
    );
    const list = loadLibrary();
    expect(list).toHaveLength(1);
    expect(list[0].cat).toBeUndefined();
    expect(entryCategory(list[0])).toBe("未分类");
  });
});
