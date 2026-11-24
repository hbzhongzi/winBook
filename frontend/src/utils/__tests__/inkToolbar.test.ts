import { describe, it, expect } from "vitest";
import {
  INK_DOCK_EDGE,
  INK_VERTICAL_W,
  inkDockSide,
  inkDockX,
  clampInkToolbarPos,
} from "../inkToolbar";

describe("D112 画笔工具栏靠边停靠判定", () => {
  it("默认阈值固定，避免不同版本口径漂移", () => {
    expect(INK_DOCK_EDGE).toBe(160);
  });

  it("停在中部时保持横向", () => {
    expect(inkDockSide(400, 600, 1200)).toBeNull();
  });

  it("靠左边缘判定为 left", () => {
    expect(inkDockSide(20, 600, 1200)).toBe("left");
  });

  it("靠右边缘判定为 right", () => {
    expect(inkDockSide(560, 600, 1200)).toBe("right"); // 右距 40
  });

  it("两侧都近时取更近的一侧", () => {
    expect(inkDockSide(20, 200, 300)).toBe("left"); // 左 20 / 右 80
    expect(inkDockSide(80, 200, 300)).toBe("right"); // 左 80 / 右 20
  });

  it("非法尺寸返回 null", () => {
    expect(inkDockSide(NaN, 600, 1200)).toBeNull();
    expect(inkDockSide(20, 0, 1200)).toBeNull();
    expect(inkDockSide(20, 600, 0)).toBeNull();
  });

  it("纵向停靠横坐标贴边留 12px", () => {
    expect(inkDockX("left", 180, 1200)).toBe(12);
    expect(inkDockX("right", 180, 1200)).toBe(1008);
  });

  it("容器比工具栏窄时不产生负坐标", () => {
    expect(inkDockX("right", 500, 300)).toBe(0);
    expect(inkDockX("left", 500, 300)).toBe(12);
  });

  it("工具栏几乎占满容器时，拖到最左/最右仍能判定靠边", () => {
    // 复现 D115 真机场景：窗口 980px、横向工具栏 900px，可移动余量只有 80px。
    const parentW = 980;
    const barW = 900;
    expect(inkDockSide(0, barW, parentW)).toBe("left"); // 左距 0 / 右距 80
    expect(inkDockSide(80, barW, parentW)).toBe("right"); // 左距 80 / 右距 0
  });

  it("D116：宽工具栏停在可移动范围中部时保持横向（旧实现误判为停靠）", () => {
    // 复现判定缺陷：900px 工具栏 / 980px 容器，旧口径右距=980-(x+900) 恒 <160，
    // 中间 x=40 时左距右距相等仍被判 left。新口径 maxX=80、阈值=80/3≈26.7，中间保持 null。
    const parentW = 980;
    const barW = 900;
    expect(inkDockSide(40, barW, parentW)).toBeNull();
    expect(inkDockSide(10, barW, parentW)).toBe("left");
    expect(inkDockSide(70, barW, parentW)).toBe("right");
  });

  it("D116：固定阈值与 maxX/3 取更小者", () => {
    // 大容器小工具栏：maxX/3=600 > 160，仍用固定 160
    expect(inkDockSide(100, 200, 2000)).toBe("left");
    expect(inkDockSide(170, 200, 2000)).toBeNull();
    // 小容器：maxX/3=33.3 < 160，用 33.3
    expect(inkDockSide(30, 200, 300)).toBe("left");
    expect(inkDockSide(50, 200, 300)).toBeNull();
  });

  it("D116：工具栏比容器宽或位置越界时不产生错误停靠", () => {
    expect(inkDockSide(0, 1200, 980)).toBeNull(); // 比容器宽，无移动空间
    expect(inkDockSide(2000, 200, 300)).toBe("right"); // 越右界钳到最右
    expect(inkDockSide(-50, 200, 300)).toBe("left"); // 越左界钳到最左
  });

  it("D116：纵向宽度常量固定，供停靠定位与预览共用", () => {
    expect(INK_VERTICAL_W).toBe(148);
  });
});

describe("D115 拖拽落点钳制（不依赖 React state）", () => {
  it("基准坐标 + 位移落在容器内取实际值", () => {
    expect(clampInkToolbarPos(10, 20, 30, 40, 500, 300)).toEqual({ x: 40, y: 60 });
  });

  it("越过右/下边界时钳到上限", () => {
    expect(clampInkToolbarPos(400, 250, 500, 500, 500, 300)).toEqual({ x: 500, y: 300 });
  });

  it("越过左/上边界时钳到 0，且负上限按 0 处理", () => {
    expect(clampInkToolbarPos(50, 50, -200, -200, 500, 300)).toEqual({ x: 0, y: 0 });
    expect(clampInkToolbarPos(0, 0, 10, 10, -100, -100)).toEqual({ x: 0, y: 0 });
  });

  it("非法输入回退到 0,0 而不是 NaN 污染样式", () => {
    expect(clampInkToolbarPos(NaN, 0, 1, 1, 500, 300)).toEqual({ x: 0, y: 0 });
    expect(clampInkToolbarPos(0, 0, Infinity, 1, 500, 300)).toEqual({ x: 0, y: 0 });
  });
});
