// PDF 画笔工具栏（D101）：悬浮在阅读区底部，开启画笔后出现。
//
// 交互口径：
// - 未开启画笔时不渲染任何元素，PDF 阅读体验保持原样（不遮挡正文/不影响选中）；
// - 开启后点「完成」或「保存」退出画笔模式，避免忘记退出导致无法拖拽选中文本；
// - 工具顺序固定：高亮笔 / 自由笔 / 橡皮擦 —— 与用户确认的口径一致。
//
// D107 布局：五段式分组 —— 笔刷 | 颜色 | 样式 | 历史 | 动作。
// 样式区随笔刷切换：高亮笔可调「粗细 + 深浅」，自由笔只调粗细，橡皮只调大小。
// 这样所有可调参数都收在同一段里，不随功能增加而把工具栏横向撑爆。

import {
  PDF_INK_COLORS,
  PDF_INK_HEX,
  type PdfBrush,
  type PdfInkColor,
} from "../utils/marks";
import {
  ERASER_SIZE_MAX,
  ERASER_SIZE_MIN,
  ERASER_SIZE_STEP,
  INK_ALPHA_MAX,
  INK_ALPHA_MIN,
  INK_ALPHA_STEP,
  clampEraserSize,
  clampInkAlpha,
} from "../utils/pdfInk";
import type { InkTool } from "./PdfInkCanvas";

const BRUSH_META: { key: Exclude<PdfBrush, "eraser">; label: string; title: string }[] = [
  { key: "highlighter", label: "高亮", title: "高亮笔：半透明粗笔，不挡原文" },
  { key: "pen", label: "自由笔", title: "自由笔：实色细线，可写字圈画" },
];

// 粗细：D102 改为连续可调控的进度条（滑块）。
// 旧实现是三档按钮（细/中/粗），只能跳档、无法微调——用户在 PDF 上写字时
// 粗细差一点点手感就完全不同，故换成 range 滑块。范围与 PdfInkCanvas 的
// 钳制区间一致（0.4–4），默认 1。
export const SIZE_MIN = 0.4;
export const SIZE_MAX = 4;
export const SIZE_STEP = 0.1;

/** 滑块某一档对应的实际像素线宽（用于右侧「16.0」这类读数） */
function widthOf(brush: PdfBrush, sizeScale: number): number {
  const base = brush === "highlighter" ? 16 : 2.5;
  return base * sizeScale;
}

/** 粗细钳制：与 PdfInkCanvas 落笔时的 Math.max(0.4, Math.min(4, …)) 保持同一区间 */
export function clampSize(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v * 10) / 10));
}

/**
 * D108：橡皮范围示例。
 * eraserSize 是命中「半径」（见 pdfInk.hitStrokes 的 r），故实际擦除覆盖直径 = 2×r。
 * 示例用固定 26px 视窗 + 内圆按 (直径 / 最大直径) 比例缩放，外面再画一个虚线圈表示
 * 命中边界，让用户直观看到「当前能擦多大范围」，而不是只看到 4–24 的抽象数字。
 */
function EraserPreview({ radius }: { radius: number }) {
  const diameter = radius * 2;
  const maxDiameter = ERASER_SIZE_MAX * 2;
  const box = 26;
  const scale = box / maxDiameter;
  const r = Math.max(2, (diameter * scale) / 2);
  return (
    <span
      className="ib-eraser-preview"
      title={"示例：擦除直径约 " + diameter + "px（半径 " + radius + "px）"}
      aria-label={"橡皮范围示例，直径约 " + diameter + " 像素"}
    >
      <svg width={box} height={box} viewBox={"0 0 " + box + " " + box}>
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="var(--accent)"
          fillOpacity="0.35"
          stroke="var(--accent)"
          strokeWidth="1"
        />
        <circle
          cx={box / 2}
          cy={box / 2}
          r={box / 2 - 1}
          fill="none"
          stroke="var(--text-3)"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      </svg>
    </span>
  );
}

type Props = {
  tool: InkTool;
  /** 草稿笔数（未保存） */
  draftCount: number;
  /** 当前页是否已有笔迹（决定「清空本页」是否可用） */
  canClear: boolean;
  canUndo: boolean;
  /** D106：是否有可恢复的一步 */
  canRedo: boolean;
  onChange: (patch: Partial<InkTool>) => void;
  onUndo: () => void;
  /** D106：恢复最近一次撤销 */
  onRedo: () => void;
  onClearPage: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function PdfInkToolbar({
  tool,
  draftCount,
  canClear,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
  onClearPage,
  onSave,
  onClose,
}: Props) {
  const isEraser = tool.brush === "eraser";
  // 手改 localStorage / 旧配置可能带来越界值，显示与写入都先钳制
  const size = clampSize(tool.sizeScale);
  const alpha = clampInkAlpha(tool.alpha);
  const eraserSize = clampEraserSize(tool.eraserSize);

  return (
    <div className="pdf-ink-bar" role="toolbar" aria-label="PDF 画笔">
      {/* ① 笔刷 */}
      <div className="ib-group" role="group" aria-label="笔刷">
        {BRUSH_META.map((b) => (
          <button
            key={b.key}
            type="button"
            className={"ib-btn" + (!isEraser && tool.brush === b.key ? " on" : "")}
            title={b.title}
            aria-pressed={!isEraser && tool.brush === b.key}
            onClick={() => onChange({ brush: b.key })}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className={"ib-btn" + (isEraser ? " on" : "")}
          title="橡皮擦：划过笔迹即擦除，大小可调"
          aria-pressed={isEraser}
          onClick={() => onChange({ brush: "eraser" })}
        >
          橡皮
        </button>
      </div>

      {/* ② 颜色（橡皮擦不用颜色，隐藏以减少干扰） */}
      {!isEraser && (
        <>
          <div className="ib-sep" />
          <div className="ib-group ib-color" role="group" aria-label="颜色">
            {PDF_INK_COLORS.map((c: PdfInkColor) => (
              <button
                key={c}
                type="button"
                className={"ib-dot" + (tool.color === c ? " on" : "")}
                style={{ background: PDF_INK_HEX[c] }}
                title={"颜色：" + c}
                aria-pressed={tool.color === c}
                aria-label={"颜色 " + c}
                onClick={() => onChange({ color: c })}
              />
            ))}
          </div>
        </>
      )}

      {/* ③ 样式：高亮=粗细+深浅，自由笔=粗细，橡皮=大小 */}
      <div className="ib-sep" />
      <div className="ib-group ib-style" role="group" aria-label="样式">
        {!isEraser ? (
          <>
            <div className="ib-field">
              <span className="ib-field-label">粗细</span>
              <input
                type="range"
                className="ib-range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={SIZE_STEP}
                value={size}
                aria-label="笔刷粗细"
                aria-valuemin={SIZE_MIN}
                aria-valuemax={SIZE_MAX}
                aria-valuenow={size}
                onChange={(e) => onChange({ sizeScale: clampSize(Number(e.target.value)) })}
              />
              <span className="ib-field-val">{widthOf(tool.brush, size).toFixed(1)}</span>
            </div>
            {tool.brush === "highlighter" && (
              <div className="ib-field">
                <span className="ib-field-label">深浅</span>
                <input
                  type="range"
                  className="ib-range"
                  min={INK_ALPHA_MIN}
                  max={INK_ALPHA_MAX}
                  step={INK_ALPHA_STEP}
                  value={alpha}
                  aria-label="高亮深浅"
                  aria-valuemin={INK_ALPHA_MIN}
                  aria-valuemax={INK_ALPHA_MAX}
                  aria-valuenow={alpha}
                  onChange={(e) => onChange({ alpha: clampInkAlpha(Number(e.target.value)) })}
                />
                <span className="ib-field-val">{Math.round(alpha * 100)}%</span>
              </div>
            )}
          </>
        ) : (
          <div className="ib-field">
            <span className="ib-field-label">橡皮</span>
            <EraserPreview radius={eraserSize} />
            <input
              type="range"
              className="ib-range"
              min={ERASER_SIZE_MIN}
              max={ERASER_SIZE_MAX}
              step={ERASER_SIZE_STEP}
              value={eraserSize}
              aria-label="橡皮大小"
              aria-valuemin={ERASER_SIZE_MIN}
              aria-valuemax={ERASER_SIZE_MAX}
              aria-valuenow={eraserSize}
              onChange={(e) => onChange({ eraserSize: clampEraserSize(Number(e.target.value)) })}
            />
            <span className="ib-field-val">{eraserSize}px</span>
            <span className="ib-range-scale" aria-hidden="true">
              {ERASER_SIZE_MIN}–{ERASER_SIZE_MAX}
            </span>
          </div>
        )}
      </div>

      {/* ④ 历史 */}
      <div className="ib-sep" />
      <div className="ib-group">
        <button type="button" className="ib-btn" disabled={!canUndo} onClick={onUndo} title="撤销上一笔（双栏可见页内，右页优先）">
          撤销
        </button>
        <button
          type="button"
          className="ib-btn"
          disabled={!canRedo}
          onClick={onRedo}
          title="恢复刚才撤销的一笔"
        >
          恢复
        </button>
        <button
          type="button"
          className="ib-btn"
          disabled={!canClear}
          onClick={onClearPage}
          title="清空本页所有笔迹（含已保存的）"
        >
          清空本页
        </button>
      </div>

      {/* ⑤ 动作 */}
      <div className="ib-sep" />
      <div className="ib-group ib-actions">
        <button
          type="button"
          className={"ib-btn primary" + (draftCount > 0 ? " dirty" : "")}
          disabled={draftCount === 0}
          onClick={onSave}
          title="把本页涂画保存为标记记录"
        >
          保存{draftCount > 0 ? "（" + draftCount + " 笔）" : ""}
        </button>
        <button type="button" className="ib-btn" onClick={onClose} title="退出画笔模式">
          完成
        </button>
      </div>
    </div>
  );
}
