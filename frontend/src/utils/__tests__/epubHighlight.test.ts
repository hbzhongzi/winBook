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

describe("D105：EPUB 高亮 rect 过滤（丢容器框、留逐行框）", () => {
  it("多行选区：逐行框互不包含，全部保留", () => {
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 400, 20), rect(144, 50, 300, 20)];
    expect(filterRects(lines)).toHaveLength(3);
  });

  it("跨块选区：段落容器大框被丢弃，逐行框保留（关键回归）", () => {
    // D103/D104 曾保留全部 → 容器框盖住整段（截图里的整块/横向溢出）。
    // D105：容器框包含逐行框 → 丢弃，只留贴合文字的行框。
    const para = rect(100, 50, 400, 66);
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 400, 20), rect(144, 50, 300, 20)];
    const out = filterRects([para, ...lines]);
    expect(out).toHaveLength(3);
    expect(out).not.toContainEqual(para);
  });

  it("body 级超大包围盒也被丢弃", () => {
    const body = rect(0, 0, 1027, 30000);
    const lines = [rect(100, 50, 400, 20), rect(122, 50, 380, 20)];
    const out = filterRects([body, ...lines]);
    expect(out).toHaveLength(2);
    expect(out).not.toContainEqual(body);
  });

  it("单行选区：仅一个框时保留（不被自身误判为容器）", () => {
    expect(filterRects([rect(100, 50, 400, 20)])).toHaveLength(1);
  });

  it("两个互不包含的框都保留（同一行的两段独立选区）", () => {
    expect(filterRects([rect(100, 50, 100, 20), rect(100, 200, 100, 20)])).toHaveLength(2);
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

  it("相邻行不被误判为包含关系（容差内只丢真正的容器框）", () => {
    const a = rect(100, 50, 400, 20); // bottom=120
    const b = rect(121, 50, 400, 20); // bottom=141，a.bottom 未覆盖 b.bottom
    expect(filterRects([a, b])).toHaveLength(2);
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
