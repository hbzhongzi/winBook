// D112：PDF 画笔工具栏的停靠判定（纯函数，便于单测）。
// 工具栏被拖到阅读区左侧或右侧一定范围内时改为纵向布局，避免横向长条
// 压住正文；回到中部则恢复横向。阈值按「距容器边缘的像素」计算。

/** 距可移动极限多少像素内判定为停靠侧边（相对 maxX，非容器绝对边缘） */
export const INK_DOCK_EDGE = 160;

/** D116：纵向停靠后的固定宽度；停靠定位与拖动预览共用同一基准，避免两处口径漂移 */
export const INK_VERTICAL_W = 148;

export type InkDockSide = "left" | "right" | null;

/**
 * 判定工具栏当前应停靠哪一侧。
 *
 * D116 修正：旧实现用「工具栏边缘到容器边缘」的绝对距离判定，横向工具栏很宽时
 * （如 900px 工具栏 / 980px 容器），可移动余量只有 80px，右距恒 < 阈值，
 * 导致中间位置也被判为可停靠、横纵反复跳。改为按「可移动范围」的相对位置判定：
 *
 *   maxX = parentWidth - barWidth
 *   左距 = x，右距 = maxX - x；阈值 = min(固定阈值, maxX/3)
 *
 * 这样：宽工具栏中间留出约 1/3 的横向区，窄工具栏仍用固定 160px 阈值；两侧
 * 都在阈值内取更近的一侧。工具栏比容器还宽（maxX<=0）时无处可停，保持横向。
 */
export function inkDockSide(
  x: number,
  barWidth: number,
  parentWidth: number,
  threshold = INK_DOCK_EDGE
): InkDockSide {
  if (![x, barWidth, parentWidth].every((n) => Number.isFinite(n))) return null;
  if (barWidth <= 0 || parentWidth <= 0) return null;
  const maxX = parentWidth - barWidth;
  if (maxX <= 0) return null;
  const cx = Math.min(maxX, Math.max(0, x));
  const leftDist = cx;
  const rightDist = maxX - cx;
  const tRaw = Number.isFinite(threshold) && threshold >= 0 ? threshold : INK_DOCK_EDGE;
  // maxX/3 保证窄窗口里左右各留约 1/3 停靠区、中间 1/3 保持横向，避免全宽都判停靠
  const t = Math.min(tRaw, maxX / 3);
  if (leftDist <= t && leftDist <= rightDist) return "left";
  if (rightDist <= t) return "right";
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
