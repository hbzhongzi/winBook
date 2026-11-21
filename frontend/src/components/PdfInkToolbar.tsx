// PDF 画笔工具栏（D101）：悬浮在阅读区底部，开启画笔后出现。
//
// 交互口径：
// - 未开启画笔时不渲染任何元素，PDF 阅读体验保持原样（不遮挡正文/不影响选中）；
// - 开启后点「完成」或「保存」退出画笔模式，避免忘记退出导致无法拖拽选中文本；
// - 工具顺序固定：高亮笔 / 自由笔 / 橡皮擦 —— 与用户确认的口径一致。

import { PDF_INK_COLORS, PDF_INK_HEX, type PdfBrush, type PdfInkColor } from "../utils/marks";
import type { InkTool } from "./PdfInkCanvas";

const BRUSH_META: { key: Exclude<PdfBrush, "eraser">; label: string; title: string }[] = [
  { key: "highlighter", label: "高亮", title: "高亮笔：半透明粗笔，不挡原文" },
  { key: "pen", label: "自由笔", title: "自由笔：实色细线，可写字圈画" },
];

const SIZE_PRESETS = [
  { scale: 0.6, label: "细" },
  { scale: 1, label: "中" },
  { scale: 1.8, label: "粗" },
];

type Props = {
  tool: InkTool;
  /** 草稿笔数（未保存） */
  draftCount: number;
  /** 当前页是否已有笔迹（决定「清空本页」是否可用） */
  canClear: boolean;
  canUndo: boolean;
  onChange: (patch: Partial<InkTool>) => void;
  onUndo: () => void;
  onClearPage: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function PdfInkToolbar({
  tool,
  draftCount,
  canClear,
  canUndo,
  onChange,
  onUndo,
  onClearPage,
  onSave,
  onClose,
}: Props) {
  const isEraser = tool.brush === "eraser";
  return (
    <div className="pdf-ink-bar" role="toolbar" aria-label="PDF 画笔">
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
          title="橡皮擦：划过笔迹即擦除"
          aria-pressed={isEraser}
          onClick={() => onChange({ brush: "eraser" })}
        >
          橡皮
        </button>
      </div>

      {/* 橡皮擦不使用颜色与粗细，隐藏以减少干扰 */}
      {!isEraser && (
        <>
          <div className="ib-sep" />
          <div className="ib-group" role="group" aria-label="颜色">
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
          <div className="ib-sep" />
          <div className="ib-group" role="group" aria-label="粗细">
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.scale}
                type="button"
                className={"ib-btn" + (tool.sizeScale === s.scale ? " on" : "")}
                aria-pressed={tool.sizeScale === s.scale}
                onClick={() => onChange({ sizeScale: s.scale })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="ib-sep" />
      <div className="ib-group">
        <button type="button" className="ib-btn" disabled={!canUndo} onClick={onUndo} title="撤销上一笔（本页）">
          撤销
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
