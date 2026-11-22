// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { filterRects, type RectLike } from "../epubHighlight";

const rect = (top: number, left: number, width: number, height: number): RectLike => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
  width,
  height,
});

describe("D103：EPUB 高亮 rect 过滤", () => {
  it("多行选区：逐行框全部保留（不被任何包含关系吞掉）", () => {
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 400, 20), rect(144, 50, 300, 20)];
    expect(filterRects(lines)).toHaveLength(3);
  });

  it("跨块选区：容器大矩形与逐行框共存时**都保留**（关键回归）", () => {
    // 这正是 marks-pane 出错的地方：它会把三条线全丢掉只留大块，
    // 渲染成整块实心色块盖住正文。
    const para = rect(100, 50, 400, 66);
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 400, 20), rect(144, 50, 300, 20)];
    const out = filterRects([para, ...lines]);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual(para);
  });

  it("body 级超大包围盒也不会吃掉逐行框", () => {
    const body = rect(0, 0, 1027, 30000);
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 380, 20)];
    expect(filterRects([body, ...lines])).toHaveLength(3);
  });

  it("几何完全重复的框只留一个（getClientRects 行内嵌套元素会重复返回）", () => {
    const a = rect(100, 50, 400, 20);
    expect(filterRects([a, { ...a }, { ...a }])).toHaveLength(1);
  });

  it("容差 1px：亚像素差异视为同一矩形", () => {
    const a = rect(100, 50, 400, 20);
    const b = rect(100.4, 50.3, 399.8, 20.2);
    expect(filterRects([a, b])).toHaveLength(1);
  });

  it("超过 1px 差异视为不同矩形，全部保留", () => {
    expect(filterRects([rect(100, 50, 400, 20), rect(102, 50, 400, 20)])).toHaveLength(2);
  });

  it("零面积/退化矩形被丢弃", () => {
    expect(filterRects([rect(100, 50, 0, 20), rect(100, 50, 400, 0)])).toHaveLength(0);
    expect(filterRects([rect(100, 50, 0.2, 20)])).toHaveLength(0);
  });

  it("NaN 尺寸被丢弃，不产生非法 SVG 属性", () => {
    expect(filterRects([{ top: 0, bottom: 0, left: 0, right: 0, width: Number.NaN, height: 20 }])).toHaveLength(0);
  });

  it("空输入返回空数组", () => {
    expect(filterRects([])).toEqual([]);
  });
});
