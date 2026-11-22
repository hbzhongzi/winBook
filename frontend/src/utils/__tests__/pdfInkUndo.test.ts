import { describe, it, expect } from "vitest";
import { visiblePages, undoTargetPage, canUndoInk, canClearInk } from "../pdfInkUndo";

describe("D105：PDF 画笔撤销/清空页范围口径", () => {
  const drafts: Record<number, number> = {};
  const saved = new Set<number>();
  const draftCounts = (p: number) => drafts[p] ?? 0;
  const hasSaved = (p: number) => saved.has(p);

  it("单栏：可见页只有 current", () => {
    expect(visiblePages(1, 1)).toEqual([1]);
    expect(visiblePages(7, 1)).toEqual([7]);
  });

  it("双栏：可见页含右页 current+1（核心 bug）", () => {
    expect(visiblePages(1, 2)).toEqual([1, 2]);
    expect(visiblePages(10, 2)).toEqual([10, 11]);
  });

  it("双栏右页有草稿：撤销目标命中右页，且 canUndo/canClear 为 true", () => {
    drafts[2] = 2;
    const pages = visiblePages(1, 2);
    expect(undoTargetPage(pages, draftCounts, hasSaved)).toBe(2);
    expect(canUndoInk(pages, draftCounts, hasSaved)).toBe(true);
    expect(canClearInk(pages, draftCounts, hasSaved)).toBe(true);
    delete drafts[2];
  });

  it("双栏两页都有草稿：优先撤销右页（后画）", () => {
    drafts[1] = 1;
    drafts[2] = 1;
    expect(undoTargetPage(visiblePages(1, 2), draftCounts, hasSaved)).toBe(2);
    delete drafts[1];
    delete drafts[2];
  });

  it("无草稿但右页有已落库笔迹：撤销目标命中右页", () => {
    saved.add(3);
    expect(undoTargetPage(visiblePages(2, 2), draftCounts, hasSaved)).toBe(3);
    expect(canUndoInk(visiblePages(2, 2), draftCounts, hasSaved)).toBe(true);
    saved.delete(3);
  });

  it("可见页无任何内容：撤销目标 null，按钮不可用", () => {
    const pages = visiblePages(5, 2);
    expect(undoTargetPage(pages, draftCounts, hasSaved)).toBeNull();
    expect(canUndoInk(pages, draftCounts, hasSaved)).toBe(false);
    expect(canClearInk(pages, draftCounts, hasSaved)).toBe(false);
  });

  it("可见页外的草稿不参与撤销判定（避免误撤其它页）", () => {
    drafts[99] = 3;
    expect(canUndoInk(visiblePages(1, 2), draftCounts, hasSaved)).toBe(false);
    delete drafts[99];
  });
});
