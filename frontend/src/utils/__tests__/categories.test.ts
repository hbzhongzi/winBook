// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ALL_TAB,
  CATS_KEY,
  PRESET_CATEGORIES,
  UNCLASSIFIED,
  addCategory,
  allCategories,
  loadCustomCategories,
  removeCategory,
  renameCategory,
  subscribeCategories,
  validateCategoryName,
  visibleCategories,
  type CatLike,
} from "../categories";

describe("categories v1", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无存储时自定义分类为空，候选集只含预设", () => {
    expect(loadCustomCategories()).toEqual([]);
    expect(allCategories()).toEqual(PRESET_CATEGORIES);
  });

  it("新增自定义分类可持久化并读回", () => {
    expect(addCategory("哲学").ok).toBe(true);
    expect(loadCustomCategories()).toEqual(["哲学"]);
    expect(allCategories()).toEqual([...PRESET_CATEGORIES, "哲学"]);
  });

  it("重名 / 与预设重名 / 保留字 / 空名 / 超长均拒绝", () => {
    addCategory("哲学");
    expect(validateCategoryName("哲学").ok).toBe(false);
    expect(validateCategoryName("小说").ok).toBe(false);
    expect(validateCategoryName(UNCLASSIFIED).ok).toBe(false);
    expect(validateCategoryName(ALL_TAB).ok).toBe(false);
    expect(validateCategoryName("   ").ok).toBe(false);
    expect(validateCategoryName("这是一个非常非常长的分类名称").ok).toBe(false);
  });

  it("新增时自动 trim 且不产生空白项", () => {
    expect(addCategory("  外刊  ").ok).toBe(true);
    expect(loadCustomCategories()).toEqual(["外刊"]);
  });

  it("预设分类不可删除，自定义可删除", () => {
    addCategory("哲学");
    expect(removeCategory("小说")).toBe(false);
    expect(removeCategory("哲学")).toBe(true);
    expect(loadCustomCategories()).toEqual([]);
  });

  it("自定义分类可改名，预设不可", () => {
    addCategory("哲学");
    expect(renameCategory("小说", "文学").ok).toBe(false);
    expect(renameCategory("哲学", "外刊").ok).toBe(true);
    expect(loadCustomCategories()).toEqual(["外刊"]);
  });

  it("订阅：新增/删除均广播最新清单", () => {
    const fn = vi.fn();
    const off = subscribeCategories(fn);
    addCategory("哲学");
    expect(fn).toHaveBeenLastCalledWith(["哲学"]);
    removeCategory("哲学");
    expect(fn).toHaveBeenLastCalledWith([]);
    off();
    addCategory("哲学");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("损坏 JSON / version 不符回落空清单", () => {
    localStorage.setItem(CATS_KEY, "{not json");
    expect(loadCustomCategories()).toEqual([]);
    localStorage.setItem(CATS_KEY, JSON.stringify({ version: 2, custom: ["x"] }));
    expect(loadCustomCategories()).toEqual([]);
  });

  it("脏数据过滤：非字符串、超长、保留字、预设重名、重复项", () => {
    localStorage.setItem(
      CATS_KEY,
      JSON.stringify({
        version: 1,
        custom: ["外刊", 123, "这是一个非常非常长的分类名称", UNCLASSIFIED, "小说", "外刊"],
      })
    );
    expect(loadCustomCategories()).toEqual(["外刊"]);
  });

  describe("visibleCategories（空分类不显示）", () => {
    it("无图书时无任何可见分类", () => {
      expect(visibleCategories([])).toEqual([]);
    });

    it("未归类图书归入「未分类」且计数正确", () => {
      const entries: CatLike[] = [{}, { cat: "" }, { cat: "小说" }];
      expect(visibleCategories(entries)).toEqual([
        { name: UNCLASSIFIED, count: 2 },
        { name: "小说", count: 1 },
      ]);
    });

    it("空预设分类（诗集）不显示；混入自定义分类按序输出", () => {
      const entries: CatLike[] = [{ cat: "技术" }, { cat: "技术" }, { cat: "外刊" }];
      const out = visibleCategories(entries, ["外刊"]);
      expect(out.map((c) => c.name)).toEqual(["技术", "外刊"]);
      expect(out).not.toContainEqual({ name: "诗集", count: 0 });
    });

    it("分类名前后空白按 trim 后归并", () => {
      const entries: CatLike[] = [{ cat: " 小说 " }, { cat: "小说" }];
      expect(visibleCategories(entries)).toEqual([{ name: "小说", count: 2 }]);
    });
  });
});
