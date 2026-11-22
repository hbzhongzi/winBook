// PDF 画笔渲染/命中工具（D101）。
//
// 设计口径（与用户确认一致）：
// - 三种笔刷：highlighter（半透明粗笔）、pen（实色细笔）、eraser（橡皮擦，不落库）；
// - 坐标存**像素**（绘制时该页 canvas 的 CSS 像素），但每条笔迹带 baseW/baseH 基准尺寸，
//   渲染时按 `当前尺寸 / baseW` 等比缩放 —— 缩放/适宽/换窗口后笔迹不飘移；
// - 两种阅读模式（翻页 + 连续滚动）共用同一套绘制与回放逻辑。
//
// 之所以把「变换」「路径」「命中」抽成纯函数：canvas 本身在 jsdom 里不可用，
// 但坐标换算与命中判定是最容易出错、也最需要回归保护的部分。

import type { PdfInkColor, PdfStroke } from "./marks";
import { PDF_INK_HEX } from "./marks";

/** 笔刷默认线宽（CSS 像素 @ 100% 适宽） */
export const BRUSH_WIDTH: Record<"highlighter" | "pen", number> = {
  highlighter: 16,
  pen: 2.5,
};

/** 半透明笔触透明度：荧光笔透（能看清字），自由笔实（看得清线）；也是 D107 深浅滑块的默认值 */
export const BRUSH_ALPHA: Record<"highlighter" | "pen", number> = {
  highlighter: 0.32,
  pen: 1,
};

/** D107：深浅可调范围与步进（0.05–1，默认跟随笔刷） */
export const INK_ALPHA_MIN = 0.05;
export const INK_ALPHA_MAX = 1;
export const INK_ALPHA_STEP = 0.05;

/** 深浅钳制：非法值回落默认；合法值原样保留（默认 0.32 不必对齐 0.05 步进） */
export function clampInkAlpha(v: number, fallback = BRUSH_ALPHA.highlighter): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(INK_ALPHA_MAX, Math.max(INK_ALPHA_MIN, v));
}

/** 橡皮擦判定半径（CSS 像素）：比实际线宽宽松，好擦（D107 起可由工具栏调节） */
export const ERASER_RADIUS = 10;
export const ERASER_SIZE_MIN = 4;
export const ERASER_SIZE_MAX = 24;
export const ERASER_SIZE_STEP = 1;

/** 橡皮大小钳制：非法值回落默认 10 */
export function clampEraserSize(v: number): number {
  if (!Number.isFinite(v)) return ERASER_RADIUS;
  const c = Math.min(ERASER_SIZE_MAX, Math.max(ERASER_SIZE_MIN, v));
  return Math.round(c / ERASER_SIZE_STEP) * ERASER_SIZE_STEP;
}

/**
 * D109：橡皮范围光标直径（屏幕像素）。
 * eraserSize 是「页面像素半径」，命中直径 = 2×半径；光标与命中范围一致，
 * 故按 rect/page 缩放比例换算到屏幕像素。非法缩放（0/NaN）回落 1 避免光标消失。
 */
export function eraserCursorDiameter(eraserSize: number, scale: number): number {
  const r = clampEraserSize(eraserSize);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return 2 * r * s;
}

/** 采样最小间距（CSS 像素）：过滤指针抖动产生的大量冗余点，控制存储体积 */
export const MIN_POINT_DIST = 1.4;

/** 单页笔迹点数预算：超长涂画时抽稀，避免一笔写爆 localStorage */
export const MAX_POINTS_TOTAL = 6000;

/**
 * 笔迹坐标变换：把「以 baseW/baseH 为基准的像素坐标」映射到「当前 pageW/pageH」。
 * 返回统一的缩放比例（x/y 取同一比例，避免笔迹被拉伸变形）。
 */
export function strokeScale(stroke: Pick<PdfStroke, "baseW" | "baseH">, pageW: number, pageH: number): number {
  if (stroke.baseW <= 0 || pageW <= 0) return 1;
  return pageW / stroke.baseW;
}

/** 笔迹在页面上的像素坐标（已按当前页面尺寸缩放） */
export function scaledPoints(stroke: PdfStroke, pageW: number, pageH: number): number[] {
  const s = strokeScale(stroke, pageW, pageH);
  const out = new Array<number>(stroke.points.length);
  for (let i = 0; i < stroke.points.length; i++) out[i] = stroke.points[i] * s;
  return out;
}

/** 把坐标序列画成平滑折线（中点二次贝塞尔，避免折角难看） */
export function tracePath(ctx: CanvasRenderingContext2D, pts: number[]): void {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 4) {
    ctx.lineTo(pts[2], pts[3]);
    return;
  }
  for (let i = 2; i < pts.length - 2; i += 2) {
    const cx = pts[i];
    const cy = pts[i + 1];
    const nx = (pts[i] + pts[i + 2]) / 2;
    const ny = (pts[i + 1] + pts[i + 3]) / 2;
    ctx.quadraticCurveTo(cx, cy, nx, ny);
  }
  ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
}

/** 在指定 2D 上下文里画一条笔迹（按当前页面尺寸缩放；含透明度与圆头圆角） */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: PdfStroke,
  pageW: number,
  pageH: number
): void {
  const pts = scaledPoints(stroke, pageW, pageH);
  if (pts.length < 4) return;
  const s = strokeScale(stroke, pageW, pageH);
  ctx.save();
  // D107：优先用笔迹自带 alpha（用户调过的深浅）；旧笔迹无该字段时回落笔刷默认
  ctx.globalAlpha = stroke.alpha ?? BRUSH_ALPHA[stroke.brush];
  ctx.strokeStyle = PDF_INK_HEX[stroke.color];
  ctx.lineWidth = Math.max(0.5, stroke.width * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  tracePath(ctx, pts);
  ctx.stroke();
  ctx.restore();
}

/** 清除上下文并回放整页笔迹（页面尺寸变化时整体重绘） */
export function repaintPage(
  ctx: CanvasRenderingContext2D,
  strokes: PdfStroke[],
  pageW: number,
  pageH: number
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) paintStroke(ctx, s, pageW, pageH);
}

/**
 * 点到线段距离的平方（橡皮擦命中判定）。坐标与线宽都按**页面像素**计。
 * 用平方距离避免反复开方。
 */
export function distToSegmentSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ax = px - x1;
    const ay = py - y1;
    return ax * ax + ay * ay;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * 橡皮擦命中：返回与该点（半径 r，页面像素）相交的笔迹下标集合。
 * 逐段比较而非逐点，长笔画中段也能擦到。
 */
export function hitStrokes(
  strokes: PdfStroke[],
  x: number,
  y: number,
  r: number,
  pageW: number,
  pageH: number
): number[] {
  const out: number[] = [];
  const rSq = r * r;
  strokes.forEach((stroke, idx) => {
    const pts = scaledPoints(stroke, pageW, pageH);
    // 线宽也算进命中半径：粗笔画边缘附近应可擦
    const s = strokeScale(stroke, pageW, pageH);
    const eff = r + (stroke.width * s) / 2;
    const effSq = Math.max(rSq, eff * eff);
    for (let i = 0; i + 3 < pts.length; i += 2) {
      if (distToSegmentSq(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]) <= effSq) {
        out.push(idx);
        return;
      }
    }
    // 单点笔迹（理论上不会落库，防御）
    if (pts.length === 2) {
      const dx = pts[0] - x;
      const dy = pts[1] - y;
      if (dx * dx + dy * dy <= effSq) out.push(idx);
    }
  });
  return out;
}

/**
 * D111：局部擦除——只擦掉橡皮圆覆盖的笔迹段，保留其余部分。
 *
 * D101–D110 的橡皮是「命中即删整条」（hitStrokes 返回下标 → filter 掉整条），
 * 用户反馈「跟范围完全无关」。本函数改为逐段判定：把连续未命中的段聚合成新
 * 笔迹，被覆盖的段丢弃。一条长笔画中间擦一下会变成两条，只擦到端点则缩短。
 *
 * 判定在**笔迹自身的基准坐标系**进行（把橡皮中心/半径按 pageW/baseW 反变换），
 * 这样切分出的点仍是原始基准坐标，可直接持久化，缩放后再回放不会错位；
 * 命中口径与 hitStrokes 一致（线宽一半也算进范围）。
 *
 * 返回原数组（同一引用）表示无任何变化，便于调用方跳过 setState。
 */
export function eraseStrokesAt(
  strokes: PdfStroke[],
  x: number,
  y: number,
  r: number,
  pageW: number,
  pageH: number
): PdfStroke[] {
  if (
    strokes.length === 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(r) ||
    !(pageW > 0) ||
    !(pageH > 0)
  ) {
    return strokes;
  }
  let changed = false;
  const out: PdfStroke[] = [];

  for (const stroke of strokes) {
    const bw = stroke.baseW;
    const bh = stroke.baseH;
    const pts = stroke.points;
    if (!(bw > 0) || !(bh > 0) || pts.length < 2) {
      out.push(stroke);
      continue;
    }
    const sx = pageW / bw;
    const sy = pageH / bh;
    if (!(sx > 0) || !(sy > 0)) {
      out.push(stroke);
      continue;
    }
    // 橡皮 → 基准坐标（与 stroke.points 同坐标系）
    const bx = x / sx;
    const by = y / sy;
    const br = r / sx;
    const eff = br + stroke.width / 2;
    const effSq = Math.max(br * br, eff * eff);
    const n = Math.floor(pts.length / 2);

    if (n === 1) {
      const dx = pts[0] - bx;
      const dy = pts[1] - by;
      if (dx * dx + dy * dy <= effSq) changed = true;
      else out.push(stroke);
      continue;
    }

    const keep: boolean[] = [];
    let anyHit = false;
    for (let i = 0; i < n - 1; i++) {
      const hit =
        distToSegmentSq(
          bx,
          by,
          pts[2 * i],
          pts[2 * i + 1],
          pts[2 * i + 2],
          pts[2 * i + 3]
        ) <= effSq;
      keep.push(!hit);
      if (hit) anyHit = true;
    }
    if (!anyHit) {
      out.push(stroke);
      continue;
    }
    changed = true;

    // 连续保留段聚合成新笔迹（点在基准坐标系，top 按 baseH 重算）
    let group: number[] = [];
    const flush = () => {
      if (group.length >= 4) {
        out.push({ ...stroke, points: group, top: strokeTop(group, bh) });
      }
      group = [];
    };
    for (let i = 0; i < n - 1; i++) {
      if (keep[i]) {
        if (group.length === 0) group.push(pts[2 * i], pts[2 * i + 1]);
        group.push(pts[2 * i + 2], pts[2 * i + 3]);
      } else {
        flush();
      }
    }
    flush();
  }
  return changed ? out : strokes;
}

/**
 * D111：#RRGGBB → rgba(...)，供画布光标按当前色点与深浅着色。
 * 非法 hex 原样返回、alpha 钳到 0–1，避免脏值把 CSS 颜色写坏。
 */
export function inkCursorColor(hex: string, alpha: number): string {
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 采样点追加：与上一点距离过近则丢弃（降噪 + 控体积） */
export function pushPoint(pts: number[], x: number, y: number): boolean {
  if (pts.length >= 2) {
    const dx = x - pts[pts.length - 2];
    const dy = y - pts[pts.length - 1];
    if (dx * dx + dy * dy < MIN_POINT_DIST * MIN_POINT_DIST) return false;
  }
  pts.push(x, y);
  return true;
}

/**
 * 笔迹抽稀（按总点数预算）：超预算时按步长隔点取样，保留首尾。
 * 用于「画了很长一笔」时压缩，避免占满单页存储预算。
 */
export function decimate(pts: number[], budget: number): number[] {
  const count = Math.floor(pts.length / 2);
  if (count <= budget) return pts;
  const step = count / budget;
  const out: number[] = [];
  for (let i = 0; i < budget - 1; i++) {
    const src = Math.round(i * step) * 2;
    out.push(pts[src], pts[src + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

/** 笔迹在页面上的纵向起始比例（0~1）：用于面板「按页内位置」排序 */
export function strokeTop(pts: number[], pageH: number): number {
  if (pts.length < 2 || pageH <= 0) return 0;
  let min = Infinity;
  for (let i = 1; i < pts.length; i += 2) if (pts[i] < min) min = pts[i];
  if (!Number.isFinite(min)) return 0;
  return Math.max(0, Math.min(1, min / pageH));
}

/** 笔迹颜色 → CSS 值（工具栏色点用） */
export function inkColorHex(c: PdfInkColor): string {
  return PDF_INK_HEX[c];
}
