/**
 * D101：PDF 画笔几何与命中判定。
 *
 * canvas 在 jsdom 里没有真实实现，但坐标换算、抽稀、橡皮擦命中
 * 这些纯计算才是最容易出错的部分，全部离线可测。
 */
import { describe, expect, it } from "vitest";
import {
  BRUSH_ALPHA,
  BRUSH_WIDTH,
  MIN_POINT_DIST,
  decimate,
  distToSegmentSq,
  hitStrokes,
  paintStroke,
  pushPoint,
  scaledPoints,
  strokeScale,
  strokeTop,
  clampEraserSize,
  clampInkAlpha,
  eraserCursorDiameter,
} from "../../utils/pdfInk";
import type { PdfStroke } from "../../utils/marks";

const stroke = (over: Partial<PdfStroke> = {}): PdfStroke => ({
  brush: "pen",
  color: "red",
  width: 3,
  points: [10, 20, 30, 20],
  baseW: 100,
  baseH: 200,
  top: 0.1,
  ...over,
});

describe("D101：笔迹坐标缩放", () => {
  it("基准尺寸与当前尺寸相同时比例为 1", () => {
    expect(strokeScale(stroke(), 100, 200)).toBe(1);
  });

  it("放大 2 倍后坐标等比放大（缩放不错位的关键）", () => {
    const s = stroke();
    expect(strokeScale(s, 200, 400)).toBe(2);
    expect(scaledPoints(s, 200, 400)).toEqual([20, 40, 60, 40]);
  });

  it("缩小一半后坐标等比缩小", () => {
    expect(scaledPoints(stroke(), 50, 100)).toEqual([5, 10, 15, 10]);
  });

  it("基准尺寸异常时退化为 1，不产生 NaN/Infinity", () => {
    expect(strokeScale(stroke({ baseW: 0 }), 100, 200)).toBe(1);
    expect(strokeScale(stroke(), 0, 200)).toBe(1);
  });
});

describe("D101：采样与抽稀", () => {
  it("间距过近的点被丢弃", () => {
    const pts: number[] = [0, 0];
    expect(pushPoint(pts, 0.5, 0.5)).toBe(false); // 小于 MIN_POINT_DIST
    expect(pts).toEqual([0, 0]);
  });

  it("间距够远的点被保留", () => {
    const pts: number[] = [0, 0];
    expect(pushPoint(pts, MIN_POINT_DIST + 1, 0)).toBe(true);
    expect(pts).toEqual([0, 0, MIN_POINT_DIST + 1, 0]);
  });

  it("首个点无条件保留", () => {
    const pts: number[] = [];
    expect(pushPoint(pts, 5, 5)).toBe(true);
    expect(pts).toEqual([5, 5]);
  });

  it("点数未超预算时原样返回", () => {
    const pts = [0, 0, 1, 1, 2, 2];
    expect(decimate(pts, 10)).toBe(pts);
  });

  it("超预算时抽稀，且严格保留首尾点", () => {
    const pts: number[] = [];
    for (let i = 0; i < 100; i++) pts.push(i, i);
    const out = decimate(pts, 10);
    expect(out.length).toBe(20); // budget 点 × 2
    expect([out[0], out[1]]).toEqual([0, 0]);
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([99, 99]);
  });
});

describe("D101：橡皮擦命中", () => {
  it("点到线段距离：垂直投影落在线段内", () => {
    // 线段 (0,0)-(10,0)，点 (5,3) → 距离 3 → 平方 9
    expect(distToSegmentSq(5, 3, 0, 0, 10, 0)).toBeCloseTo(9);
  });

  it("点到线段距离：投影落在线段外，取端点距离", () => {
    // 点 (20,0) 到线段 (0,0)-(10,0)：最近端点是 (10,0)，距离 10
    expect(distToSegmentSq(20, 0, 0, 0, 10, 0)).toBeCloseTo(100);
  });

  it("退化为点时按点距离计算", () => {
    expect(distToSegmentSq(3, 4, 0, 0, 0, 0)).toBeCloseTo(25);
  });

  it("命中笔画中段（不只是端点）", () => {
    const s = stroke({ points: [0, 0, 100, 0], width: 2 });
    // 坐标基准与页面一致 → 页面像素即笔迹坐标
    const hits = hitStrokes([s], 50, 1, 5, 100, 200);
    expect(hits).toEqual([0]);
  });

  it("远离笔画时不命中", () => {
    const s = stroke({ points: [0, 0, 100, 0] });
    expect(hitStrokes([s], 50, 50, 5, 100, 200)).toEqual([]);
  });

  it("粗笔画的线宽计入命中半径：边缘附近可擦", () => {
    const thin = stroke({ points: [0, 0, 100, 0], width: 1 });
    const thick = stroke({ points: [0, 0, 100, 0], width: 20 });
    // 距线 8px：细笔画擦不到，粗笔画（半宽 10）能擦到
    expect(hitStrokes([thin], 50, 8, 2, 100, 200)).toEqual([]);
    expect(hitStrokes([thick], 50, 8, 2, 100, 200)).toEqual([0]);
  });

  it("返回全部命中笔迹的下标", () => {
    const a = stroke({ points: [0, 0, 100, 0] });
    const b = stroke({ points: [0, 2, 100, 2] });
    expect(hitStrokes([a, b], 50, 1, 3, 100, 200).sort()).toEqual([0, 1]);
  });

  it("缩放后命中判定使用页面像素坐标", () => {
    // 笔迹基准 100 宽，原线段 (0,0)-(50,0)；在 200 宽页面上放大 2 倍 → 覆盖 x∈[0,100]
    const s = stroke({ points: [0, 0, 50, 0] });
    // 放大后：x=100 处正好在线段末端，可命中
    expect(hitStrokes([s], 100, 0, 3, 200, 200)).toEqual([0]);
    // 缩小到 100 宽：线段变为 x∈[0,50]，x=80 已超出线段 → 不命中
    expect(hitStrokes([s], 80, 0, 3, 100, 200)).toEqual([]);
    // 同一缩放下 x=40 仍在线段内 → 命中
    expect(hitStrokes([s], 40, 0, 3, 100, 200)).toEqual([0]);
  });
});

describe("D101：页内位置与常量", () => {
  it("取笔迹最高（y 最小）处占页高比例", () => {
    expect(strokeTop([10, 100, 20, 40, 30, 80], 200)).toBeCloseTo(0.2);
  });

  it("越界时钳制到 0~1", () => {
    expect(strokeTop([0, -50], 200)).toBe(0);
    expect(strokeTop([0, 500], 200)).toBe(1);
  });

  it("空点列与零页高退化返回 0", () => {
    expect(strokeTop([], 200)).toBe(0);
    expect(strokeTop([1, 2], 0)).toBe(0);
  });

  it("荧光笔比自由笔粗（视觉口径）", () => {
    expect(BRUSH_WIDTH.highlighter).toBeGreaterThan(BRUSH_WIDTH.pen);
  });
});

describe("D107：颜色深浅与橡皮大小可调", () => {
  it("深浅钳制到 [0.05, 1]，默认 0.32 不被步进改写", () => {
    expect(clampInkAlpha(0.32)).toBe(0.32);
    expect(clampInkAlpha(0)).toBe(0.05);
    expect(clampInkAlpha(2)).toBe(1);
    expect(clampInkAlpha(Number.NaN)).toBe(BRUSH_ALPHA.highlighter);
  });

  it("橡皮大小钳制到 [4, 24]，非法值回落默认 10", () => {
    expect(clampEraserSize(10)).toBe(10);
    expect(clampEraserSize(1)).toBe(4);
    expect(clampEraserSize(99)).toBe(24);
    expect(clampEraserSize(Number.NaN)).toBe(10);
  });

  it("D109：橡皮范围光标直径 = 命中直径 × 缩放，非法缩放回落 1", () => {
    // eraserSize 是半径；直径 = 2×半径。缩放 1.5 时光标同步放大到 36px
    expect(eraserCursorDiameter(12, 1)).toBe(24);
    expect(eraserCursorDiameter(12, 1.5)).toBe(36);
    // 钳制先于换算：越界半径按 24 算，直径 48
    expect(eraserCursorDiameter(99, 1)).toBe(48);
    expect(eraserCursorDiameter(10, 0)).toBe(20);
    expect(eraserCursorDiameter(10, Number.NaN)).toBe(20);
  });

  it("绘制优先用笔迹自带 alpha，旧笔迹回落笔刷默认（向后兼容）", () => {
    // canvas 在 jsdom 不可用：用最小 stub 捕获每次赋给 globalAlpha 的值
    const captured: number[] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      stroke() {},
      clearRect() {},
      canvas: { width: 100, height: 200 },
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      set globalAlpha(v: number) {
        captured.push(v);
      },
    } as unknown as CanvasRenderingContext2D;

    const deep = stroke({ brush: "highlighter", alpha: 0.7 });
    const legacy = stroke({ brush: "highlighter" }); // D101–D106 旧笔迹无 alpha
    paintStroke(ctx, deep, 100, 200);
    paintStroke(ctx, legacy, 100, 200);
    expect(captured).toEqual([0.7, BRUSH_ALPHA.highlighter]);
  });
});
