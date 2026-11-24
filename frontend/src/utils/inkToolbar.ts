// D112：PDF 画笔工具栏的停靠判定（纯函数，便于单测）。
// 工具栏被拖到阅读区左侧或右侧一定范围内时改为纵向布局，避免横向长条
// 压住正文；回到中部则恢复横向。阈值按「距容器边缘的像素」计算。

/** 距左/右边缘多少像素内判定为停靠侧边 */
export const INK_DOCK_EDGE = 160;

export type InkDockSide = "left" | "right" | null;

/**
 * 判定工具栏当前应停靠哪一侧。
 * - 两侧都在阈值内时取更近的一侧；
 * - 非法尺寸或越界位置返回 null（回横向）。
 */
export function inkDockSide(
  x: number,
  barWidth: number,
  parentWidth: number,
  threshold = INK_DOCK_EDGE
): InkDockSide {
  if (![x, barWidth, parentWidth].every((n) => Number.isFinite(n))) return null;
  if (barWidth <= 0 || parentWidth <= 0) return null;
  const t = Number.isFinite(threshold) && threshold >= 0 ? threshold : INK_DOCK_EDGE;
  const left = x;
  const right = parentWidth - (x + barWidth);
  if (left <= t && left <= right) return "left";
  if (right <= t) return "right";
  return null;
}

/** 停靠后的横坐标：贴边并留 12px 内边距；容器过窄时钳到 0 */
export function inkDockX(
  side: Exclude<InkDockSide, null>,
  barWidth: number,
  parentWidth: number
): number {
  if (![barWidth, parentWidth].every((n) => Number.isFinite(n))) return 0;
  if (side === "left") return 12;
  return Math.max(0, parentWidth - barWidth - 12);
}

/**
 * D115：拖拽落点钳制（纯函数，供 pointermove/up 共用）。
 * 输入全部来自「按下时的基准坐标 + 当前指针位移 + 容器上限」，不依赖任何
 * React state，从根上避开 pointerup 闭包里 pos 还是旧值导致停靠判定失效。
 */
export function clampInkToolbarPos(
  baseX: number,
  baseY: number,
  dx: number,
  dy: number,
  maxX: number,
  maxY: number
): { x: number; y: number } {
  const nums = [baseX, baseY, dx, dy, maxX, maxY];
  if (!nums.every((n) => Number.isFinite(n))) return { x: 0, y: 0 };
  const hiX = Math.max(0, maxX);
  const hiY = Math.max(0, maxY);
  return {
    x: Math.min(hiX, Math.max(0, baseX + dx)),
    y: Math.min(hiY, Math.max(0, baseY + dy)),
  };
}
