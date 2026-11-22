import { describe, it, expect } from "vitest";
import {
  visiblePages,
  undoTargetPage,
  canUndoInk,
  canClearInk,
  canRedoInk,
  popLastDraft,
  type InkRedoEntry,
} from "../pdfInkUndo";
import type { PdfStroke } from "../marks";

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

describe("D106：PDF 画笔恢复（redo）", () => {
  const stroke = (n: number): PdfStroke => ({
    brush: "highlighter",
    color: "yellow",
    width: 16,
    points: [n, n, n + 10, n],
    baseW: 800,
    baseH: 1000,
    top: n / 1000,
  });

  it("popLastDraft：取最后一笔，其余按原序保留", () => {
    const a = stroke(1);
    const b = stroke(2);
    const c = stroke(3);
    const out = popLastDraft([a, b, c]);
    expect(out?.last).toBe(c);
    expect(out?.rest).toEqual([a, b]);
  });

  it("popLastDraft：空栈返回 null，不抛错", () => {
    expect(popLastDraft([])).toBeNull();
  });

  it("canRedoInk：空栈不可恢复，压入一步后可恢复", () => {
    expect(canRedoInk([])).toBe(false);
    const entry: InkRedoEntry = { kind: "draft", page: 3, stroke: stroke(1) };
    expect(canRedoInk([entry])).toBe(true);
  });

  it("saved 型 redo 记录保留整组笔迹与颜色（供标记被删后重建）", () => {
    const entry: InkRedoEntry = {
      kind: "saved",
      page: 7,
      markId: "m-7",
      strokes: [stroke(1), stroke(2)],
      color: "blue",
    };
    expect(entry.kind).toBe("saved");
    expect(entry.strokes).toHaveLength(2);
    expect(entry.color).toBe("blue");
    expect(canRedoInk([entry])).toBe(true);
  });
});
