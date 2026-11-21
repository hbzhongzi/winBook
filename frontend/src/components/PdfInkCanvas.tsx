// PDF 画笔画布（D101）：叠在 pdf canvas 之上的透明绘制层。
//
// 关键设计：
// - 每页一个独立的 <canvas class="pdf-ink">，**绝对定位覆盖**在同位置 canvas 上，
//   `pointer-events` 由「画笔是否开启」决定：关闭时置 none，完全不影响阅读/选中/滚动；
// - 坐标一律换算成该页 CSS 像素（`getBoundingClientRect()` 差值），再按 DPR 放大
//   位图分辨率，保证高清屏上线条不糊；
// - 绘制中的数据存 ref（不触发 React 渲染），仅在落笔结束时提交给上层；
// - 页面尺寸变化（缩放/适宽/窗口拉伸）时按 baseW/baseH 等比回放，笔迹不飘移。

import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { PdfInkColor, PdfBrush, PdfStroke } from "../utils/marks";
import {
  BRUSH_WIDTH,
  ERASER_RADIUS,
  MAX_POINTS_TOTAL,
  decimate,
  hitStrokes,
  paintStroke,
  pushPoint,
  strokeTop,
} from "../utils/pdfInk";

/** 画笔工具状态（由 PdfViewer 持有，工具栏与画布共用） */
export type InkTool = {
  /** 是否处于画笔模式（true 时画布接收指针事件） */
  active: boolean;
  brush: PdfBrush;
  color: PdfInkColor;
  /** 相对线宽倍率（1 = 默认） */
  sizeScale: number;
};

export type InkCanvasProps = {
  /** 该页已落库的笔迹（回放用；来自 marks） */
  strokes: PdfStroke[];
  /** 当前正在编辑、尚未落库的笔迹（同一页内临时） */
  draftStrokes: PdfStroke[];
  /** 页面当前 CSS 尺寸（由渲染链路回填；变化时触发重绘） */
  pageW: number;
  pageH: number;
  tool: InkTool;
  /** 笔迹变化：落笔结束 / 擦除时回调（上层负责存入草稿或落库） */
  onStrokesChange: (next: PdfStroke[]) => void;
  /** 画布 ref 登记（供命中测试/截图等外部使用） */
  canvasRefOut?: MutableRefObject<HTMLCanvasElement | null>;
};

/** canvas 位图尺寸上限：超大图会触发浏览器警告并变慢 */
const MAX_BITMAP_SIDE = 4096;

export default function InkCanvas({
  strokes,
  draftStrokes,
  pageW,
  pageH,
  tool,
  onStrokesChange,
  canvasRefOut,
}: InkCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  /** 正在绘制的当前笔迹点（CSS 像素坐标 / 页面基准） */
  const drawingRef = useRef<{ pts: number[]; stroke: PdfStroke | null } | null>(null);
  /** 擦除中的连续擦除会话：一次拖拽内不重复删除同一条 */
  const erasingRef = useRef<Set<number> | null>(null);

  // 最新 props 镜像：指针事件回调里读，避免闭包陈旧
  const latest = useRef({ strokes, draftStrokes, pageW, pageH, tool, onStrokesChange });
  latest.current = { strokes, draftStrokes, pageW, pageH, tool, onStrokesChange };

  const allStrokes = useCallback(
    () => [...latest.current.strokes, ...latest.current.draftStrokes],
    []
  );

  /** 尺寸 + DPR 变化时重建位图并整页回放 */
  const repaint = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { pageW: w, pageH: h } = latest.current;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 位图侧限制：超大页面按比例降到上限内，避免浏览器拒绝分配
    const limit = Math.min(1, MAX_BITMAP_SIDE / (Math.max(w, h) * dpr));
    const scale = dpr * limit;
    const bw = Math.max(1, Math.round(w * scale));
    const bh = Math.max(1, Math.round(h * scale));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 回放：已落库 + 本页草稿（绘制中的那笔由增量绘制负责，不参与回放）
    for (const s of allStrokes()) paintStroke(ctx, s, w, h);
  }, [allStrokes]);

  useEffect(() => {
    repaint();
  }, [repaint, strokes, draftStrokes, pageW, pageH]);

  /** 指针位置 → 页面 CSS 像素坐标 */
  const pointOf = (ev: PointerEvent | React.PointerEvent): { x: number; y: number } | null => {
    const canvas = ref.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    // 用 rect 反算比例：即使 style 尺寸与实际渲染尺寸不一致也能校正
    const sx = r.width / latest.current.pageW;
    const sy = r.height / latest.current.pageH;
    if (sx <= 0 || sy <= 0) return null;
    return { x: (ev.clientX - r.left) / sx, y: (ev.clientY - r.top) / sy };
  };

  /** 增量绘制当前笔迹（每次移动只画新增段，避免整页重绘卡顿） */
  const paintLive = useCallback(() => {
    const canvas = ref.current;
    const d = drawingRef.current;
    if (!canvas || !d || !d.stroke) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { pageW: w, pageH: h } = latest.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const limit = Math.min(1, MAX_BITMAP_SIDE / (Math.max(w, h) * dpr));
    const scale = dpr * limit;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintStroke(ctx, d.stroke, w, h);
  }, []);

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool: t, pageW: w, pageH: h } = latest.current;
    if (!t.active) return;
    if (ev.button !== 0) return; // 只响应左键（右键留给菜单/原生菜单）
    const p = pointOf(ev);
    if (!p) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);

    if (t.brush === "eraser") {
      erasingRef.current = new Set();
      eraseAt(p.x, p.y);
      return;
    }
    const pts: number[] = [];
    pushPoint(pts, p.x, p.y);
    const stroke: PdfStroke = {
      brush: t.brush,
      color: t.color,
      width: BRUSH_WIDTH[t.brush] * Math.max(0.4, Math.min(4, t.sizeScale)),
      points: pts,
      baseW: w,
      baseH: h,
      top: strokeTop(pts, h),
    };
    drawingRef.current = { pts, stroke };
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool: t } = latest.current;
    if (!t.active) return;
    const p = pointOf(ev);
    if (!p) return;
    if (t.brush === "eraser") {
      if (erasingRef.current) eraseAt(p.x, p.y);
      return;
    }
    const d = drawingRef.current;
    if (!d?.stroke) return;
    if (!pushPoint(d.pts, p.x, p.y)) return;
    d.stroke.points = d.pts;
    paintLive();
  };

  const finishStroke = () => {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d?.stroke) return;
    // 只画一个点：不落库（无意义，且校验层也会丢弃）
    if (d.stroke.points.length < 4) {
      repaint();
      return;
    }
    // 抽稀：超长笔画压到点数预算内
    const pts = decimate(d.stroke.points, MAX_POINTS_TOTAL);
    const stroke: PdfStroke = {
      ...d.stroke,
      points: pts,
      top: strokeTop(pts, latest.current.pageH),
    };
    latest.current.onStrokesChange([...allStrokes(), stroke]);
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (ev.currentTarget.hasPointerCapture?.(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture?.(ev.pointerId);
    }
    if (erasingRef.current) {
      erasingRef.current = null;
      return;
    }
    finishStroke();
  };

  /** 橡皮擦：命中即删（一次拖拽内同一条只删一次） */
  const eraseAt = (x: number, y: number) => {
    const { pageW: w, pageH: h } = latest.current;
    const all = allStrokes();
    if (all.length === 0) return;
    const hits = hitStrokes(all, x, y, ERASER_RADIUS, w, h);
    if (hits.length === 0) return;
    const seen = erasingRef.current;
    const toDrop = new Set<number>();
    for (const idx of hits) {
      if (seen?.has(idx)) continue;
      seen?.add(idx);
      toDrop.add(idx);
    }
    if (toDrop.size === 0) return;
    latest.current.onStrokesChange(all.filter((_, i) => !toDrop.has(i)));
  };

  const curTool = latest.current.tool;
  const interactive = curTool.active;

  return (
    <canvas
      ref={(el) => {
        ref.current = el;
        if (canvasRefOut) canvasRefOut.current = el;
      }}
      className={
        "pdf-ink" +
        (interactive ? " active" : "") +
        (curTool.brush === "eraser" && interactive ? " eraser" : "")
      }
      style={{
        pointerEvents: interactive ? "auto" : "none",
        cursor: interactive ? "crosshair" : "auto",
        touchAction: interactive ? "none" : "auto",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(ev) => {
        // 指针意外离开画布（如移出窗口）时收尾，避免笔迹悬挂
        if (drawingRef.current) finishStroke();
        void ev;
      }}
      aria-hidden="true"
    />
  );
}
