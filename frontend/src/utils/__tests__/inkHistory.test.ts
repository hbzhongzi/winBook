import { describe, it, expect } from "vitest";
import {
  INK_ERASE_HISTORY_LIMIT,
  createErasedSnapshot,
  pushEraseEntry,
  samePageSnapshot,
  sameStrokeList,
  type InkEraseEntry,
  type InkPageSnapshot,
} from "../inkHistory";
import type { PdfStroke } from "../marks";

function stroke(): PdfStroke {
  return {
    brush: "pen",
    color: "yellow",
    width: 2,
    points: [0, 0, 10, 10],
    baseW: 100,
    baseH: 100,
    top: 0,
  };
}

function snapshot(page: number, drafts: PdfStroke[], saved: InkPageSnapshot["saved"] = []): InkPageSnapshot {
  return { page, drafts, saved };
}

describe("D113 擦除快照历史", () => {
  it("sameStrokeList：同引用为真，长度或任一元素引用不同即为假", () => {
    const a = stroke();
    const b = stroke();
    expect(sameStrokeList([a], [a])).toBe(true);
    expect(sameStrokeList([a], [b])).toBe(false); // 内容相同但引用不同也算被改过
    expect(sameStrokeList([a], [a, b])).toBe(false);
    expect(sameStrokeList([], [])).toBe(true);
  });

  it("samePageSnapshot：页码、草稿、已落库标记任一变化都不一致", () => {
    const a = stroke();
    const b = stroke();
    const base = snapshot(1, [a], [{ color: "blue", strokes: [a] }]);
    expect(samePageSnapshot(base, base)).toBe(true);
    expect(samePageSnapshot(base, snapshot(2, [a], [{ color: "blue", strokes: [a] }]))).toBe(false);
    expect(samePageSnapshot(base, snapshot(1, [b], [{ color: "blue", strokes: [a] }]))).toBe(false);
    expect(samePageSnapshot(base, snapshot(1, [a], [{ color: "pink", strokes: [a] }]))).toBe(false);
    expect(samePageSnapshot(base, snapshot(1, [a], [{ color: "blue", strokes: [b] }]))).toBe(false);
    expect(samePageSnapshot(base, snapshot(1, [a], []))).toBe(false);
  });

  it("createErasedSnapshot：擦除后已落库笔迹已移出，saved 为空", () => {
    const a = stroke();
    expect(createErasedSnapshot(3, [a])).toEqual({ page: 3, drafts: [a], saved: [] });
  });

  it("pushEraseEntry：追加并保持最近 limit 条", () => {
    const a = stroke();
    const entry = (n: number): InkEraseEntry => ({
      before: snapshot(n, [a]),
      after: createErasedSnapshot(n, []),
    });
    let stack: InkEraseEntry[] = [];
    for (let i = 0; i < INK_ERASE_HISTORY_LIMIT + 5; i++) {
      stack = pushEraseEntry(stack, entry(i));
    }
    expect(stack.length).toBe(INK_ERASE_HISTORY_LIMIT);
    expect(stack[stack.length - 1].after.page).toBe(INK_ERASE_HISTORY_LIMIT + 4);
    expect(stack[0].after.page).toBe(5);
  });
});
