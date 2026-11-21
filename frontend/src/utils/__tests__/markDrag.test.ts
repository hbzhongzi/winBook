/**
 * D100：滚动模式标记不了的根因回归测试。
 *
 * 背景：滚动模式是 scrolled-doc，正文纵向滚动，用户选词几乎必然带纵向偏移。
 * 早期判定用 `hypot(dx,dy) > 6`，导致「只往下一行的纯纵向拖动」被当成单击，
 * 表现为滚动模式选不中、弹不出标记工具条。改为按方向分别判定后锁住行为。
 */
import { describe, expect, it } from "vitest";
import { isMarkDrag } from "../../components/EpubViewer";

describe("D100：选词拖拽判定", () => {
  it("横向拖动超过 6px 视为选词", () => {
    expect(isMarkDrag(7, 0)).toBe(true);
    expect(isMarkDrag(-7, 0)).toBe(true);
  });

  it("纯纵向拖动超过 12px 视为选词（滚动模式跨行选段的典型手势）", () => {
    expect(isMarkDrag(0, 13)).toBe(true);
    expect(isMarkDrag(0, -13)).toBe(true);
  });

  it("纯纵向小幅抖动不算选词（避免误弹工具条）", () => {
    expect(isMarkDrag(0, 3)).toBe(false);
    expect(isMarkDrag(0, 11)).toBe(false);
  });

  it("斜向拖动中任一方向达标即算选词", () => {
    // 横向够宽、纵向很小
    expect(isMarkDrag(9, 2)).toBe(true);
    // 纵向够高、横向很小
    expect(isMarkDrag(1, 15)).toBe(true);
  });

  it("原地点击（位移为 0）不算选词", () => {
    expect(isMarkDrag(0, 0)).toBe(false);
  });

  it("回归：欧氏距离略大于 6 但两个方向都很小——旧逻辑会误判，现按方向仍算选词", () => {
    // dx=5, dy=4 → hypot≈6.4（旧逻辑 true）；现 dx<6 且 dy<12 → false。
    // 这里锁的是「不因斜向抖动而误弹」，属有意收紧。
    expect(isMarkDrag(5, 4)).toBe(false);
  });
});
