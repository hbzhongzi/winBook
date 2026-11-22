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
import { PDF_INK_HEX, type PdfInkColor, type PdfBrush, type PdfStroke } from "../utils/marks";
import {
  BRUSH_WIDTH,
  MAX_POINTS_TOTAL,
  clampEraserSize,
  decimate,
  eraserCursorDiameter,
  eraseStrokesAt,
  inkCursorColor,
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
  /** D107：笔迹透明度（0.05–1），仅高亮笔写入；自由笔恒实色 */
  alpha: number;
  /** D107：橡皮擦判定半径（4–24 CSS px） */
  eraserSize: number;
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
  /** D111：笔刷光标（橡皮圈/高亮条/自由笔圆点），ref 直改样式避免 mousemove 触发 React 渲染 */
  const cursorRef = useRef<HTMLSpanElement | null>(null);
  /** 正在绘制的当前笔迹点（CSS 像素坐标 / 页面基准） */
  const drawingRef = useRef<{ pts: number[]; stroke: PdfStroke | null } | null>(null);
  /** D111：一次擦除拖拽进行中（局部擦除是幂等的，不再需要「同一条只删一次」的 Set） */
  const erasingRef = useRef(false);

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

  /**
   * D111：三种笔刷统一用 DOM overlay 光标，系统 crosshair 不体现笔刷尺寸与颜色。
   * - 橡皮：圆圈，直径 = 命中直径（与 D109 一致）
   * - 高亮笔：胶囊条，宽 = 落笔线宽，颜色按当前色点 + 深浅（半透明可见底下的字）
   * - 自由笔：圆点，直径 = 落笔线宽（设最小可见尺寸），颜色按当前色点
   * 尺寸一律按 rect/page 比例换算到屏幕像素，与落笔/命中口径一致。
   */
  const syncInkCursor = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const el = cursorRef.current;
    const canvas = ref.current;
    if (!el || !canvas) return;
    const { tool: t, pageW } = latest.current;
    if (!t.active) {
      el.style.display = "none";
      return;
    }
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0 || pageW <= 0) {
      el.style.display = "none";
      return;
    }
    const scale = r.width / pageW; // 屏幕像素 / 页面像素
    const brush = t.brush;
    el.dataset.brush = brush;
    // 清掉上一种笔刷留下的尺寸/颜色，由下方分支与 data-brush 的 CSS 变体重写
    el.style.background = "";

    if (brush === "eraser") {
      const d = eraserCursorDiameter(t.eraserSize, scale);
      el.style.width = d + "px";
      el.style.height = d + "px";
    } else if (brush === "highlighter") {
      const w = BRUSH_WIDTH.highlighter * Math.max(0.4, Math.min(4, t.sizeScale)) * scale;
      el.style.width = Math.max(4, w) + "px";
      el.style.height = Math.max(4, Math.min(12, w * 0.5)) + "px";
      el.style.background = inkCursorColor(PDF_INK_HEX[t.color], t.alpha);
    } else {
      const d = BRUSH_WIDTH.pen * Math.max(0.4, Math.min(4, t.sizeScale)) * scale;
      const size = Math.max(6, d);
      el.style.width = size + "px";
      el.style.height = size + "px";
      el.style.background = PDF_INK_HEX[t.color];
    }
    el.style.left = ev.clientX - r.left + "px";
    el.style.top = ev.clientY - r.top + "px";
    el.style.display = "block";
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
    syncInkCursor(ev);
    const p = pointOf(ev);
    if (!p) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture?.(ev.pointerId);

    if (t.brush === "eraser") {
      erasingRef.current = true;
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
      // D107：高亮笔写入用户调过的深浅；自由笔不写，回放时走 BRUSH_ALPHA.pen（实色）
      ...(t.brush === "highlighter" ? { alpha: t.alpha } : {}),
    };
    drawingRef.current = { pts, stroke };
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const { tool: t } = latest.current;
    if (!t.active) return;
    syncInkCursor(ev);
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
      erasingRef.current = false;
      return;
    }
    finishStroke();
  };

  /**
   * D111：橡皮按范围局部擦除。eraseStrokesAt 返回原数组引用即代表没擦到，
   * 跳过 setState 避免无谓重绘；长笔画中间被擦会拆成两条，端点被擦则缩短。
   */
  const eraseAt = (x: number, y: number) => {
    const { pageW: w, pageH: h, tool: t } = latest.current;
    const all = allStrokes();
    if (all.length === 0) return;
    // D107：橡皮半径跟随工具栏调节（钳制防手改状态越界）
    const next = eraseStrokesAt(all, x, y, clampEraserSize(t.eraserSize), w, h);
    if (next !== all) latest.current.onStrokesChange(next);
  };

  const curTool = latest.current.tool;
  const interactive = curTool.active;
  const eraserOn = interactive && curTool.brush === "eraser";

  return (
    <>
      <canvas
        ref={(el) => {
          ref.current = el;
          if (canvasRefOut) canvasRefOut.current = el;
        }}
        className={
          "pdf-ink" +
          (interactive ? " active" : "") +
          (eraserOn ? " eraser" : "")
        }
        style={{
          pointerEvents: interactive ? "auto" : "none",
          // D111：三种笔刷都由 overlay 呈现光标，隐藏系统光标避免叠加
          cursor: interactive ? "none" : "auto",
          touchAction: interactive ? "none" : "auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(ev) => {
          // 指针意外离开画布（如移出窗口）时收尾，避免笔迹悬挂
          if (drawingRef.current) finishStroke();
          if (cursorRef.current) cursorRef.current.style.display = "none";
          void ev;
        }}
        aria-hidden="true"
      />
      {/* D111：笔刷光标——按 data-brush 呈现橡皮圈/高亮条/自由笔圆点，跟随指针 */}
      <span
        ref={cursorRef}
        className="pdf-ink-cursor"
        aria-hidden="true"
        style={{ display: "none" }}
      />
    </>
  );
}
