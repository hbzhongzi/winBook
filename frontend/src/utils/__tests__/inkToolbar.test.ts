import { describe, it, expect } from "vitest";
import {
  INK_DOCK_EDGE,
  inkDockSide,
  inkDockX,
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
});
