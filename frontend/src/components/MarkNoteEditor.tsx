// v0.3.0 感悟编辑器（F34）：新建与编辑复用的同一受控组件（方案 §4.7–4.9）。
// 入口：划词工具条「写感悟」（新建）、高亮气泡「编辑」、面板条目「编辑」。
// 行为：自动聚焦；Enter 直接保存 / Esc 取消 / Shift+Enter 换行；
//       保存空笔记 = 纯高亮（合法，不删除条目）。
// 本地草稿态（note/color）由组件自持，保存时经 onSave 一次性提交；
// 调用方应以 key（如条目 id）挂载，保证切换编辑目标时草稿不串味。
// 视觉口径对齐 doce/BookEditor-前端界面示例-v0.3.0-标记记录.html 状态 C。

import { useEffect, useRef, useState } from "react";
import { MARK_COLORS, MARK_COLOR_LABELS, type MarkColor } from "../utils/marks";

type Props = {
  /** 原文引用；独立想法传空串，引用块显示「◆ 独立想法」占位（§4.10） */
  quote: string;
  /** true = 独立想法（不依赖选区，text 恒空） */
  idea?: boolean;
  initialColor: MarkColor;
  initialNote: string;
  onSave: (note: string, color: MarkColor) => void;
  onCancel: () => void;
};

export default function MarkNoteEditor({ quote, idea, initialColor, initialNote, onSave, onCancel }: Props) {
  const [note, setNote] = useState(initialNote);
  const [color, setColor] = useState<MarkColor>(initialColor);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // 自动聚焦（§4.8）：挂载即聚焦，Esc/Enter 即时可答
  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const commit = () => onSave(note, color);

  return (
    <div
      className="modal-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="note-editor" role="dialog" aria-modal="true" aria-label="写感悟">
        <div className="ne-quote">
          <span className={"bar bar-" + color} />
          {idea || !quote ? (
            <span className="qt qt-idea">◆ 独立想法（不依赖选区，位置取当前阅读处）</span>
          ) : (
            <span className="qt">{quote}</span>
          )}
        </div>
        <div className="ne-body">
          <textarea
            ref={areaRef}
            value={note}
            placeholder="记录这一刻的感悟…（Enter 保存，Shift+Enter 换行）"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
            }}
          />
          <div className="ne-colors">
            <span>颜色</span>
            {MARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={"dot dot-" + c + (c === color ? " active" : "")}
                title={MARK_COLOR_LABELS[c]}
                aria-label={"选择" + MARK_COLOR_LABELS[c] + "色"}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="ne-foot">
          <span className="kbd-hint">留空保存 = 纯高亮</span>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={commit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
