// v0.3.0 划词工具条（F32/F33）：受控展示组件，定位与状态由调用方（Viewer）驱动。
// 两态：
// - new     新选词：四色点 + 写感悟 + 复制（点色点即落库高亮，方案 §4.2/4.3）
// - existing 与既有高亮重叠：改色 + 写感悟 + 删除（删除直接生效不二次确认，§4.4）
// 坐标 x/y 为相对定位容器的 px，调用方已完成「空间不足翻到下方」的翻转计算。
// 视觉与交互口径对齐 doce/BookEditor-前端界面示例-v0.3.0-标记记录.html 状态 A/B。

import { MARK_COLORS, MARK_COLOR_LABELS, type MarkColor } from "../utils/marks";

export type MarkToolbarMode = "new" | "existing";

type Props = {
  x: number;
  y: number;
  mode: MarkToolbarMode;
  /** 点色点：new=新建标记；existing=改色（调用方定位到具体条目） */
  onColor: (color: MarkColor) => void;
  /** 写感悟：打开 MarkNoteEditor（新建或编辑由调用方状态决定） */
  onNote: () => void;
  /** 复制划选原文（new 态；selection 需存活，故容器拦截了 mousedown） */
  onCopy: () => void;
  /** 删除既有标记（existing 态；直接生效 + toast，方案 §4.4） */
  onDelete: () => void;
};

export default function MarkToolbar({ x, y, mode, onColor, onNote, onCopy, onDelete }: Props) {
  return (
    <div
      className="mark-toolbar"
      style={{ left: x, top: y }}
      role="toolbar"
      aria-label={mode === "new" ? "划词标记" : "修改标记"}
      // 关键：阻止 mousedown 默认行为，避免点击工具条时正文选区被清空
      // （色点落库与「复制」都依赖当前 selection 仍然存活）
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="tt-label">{mode === "new" ? "标记" : "改色"}</span>
      {MARK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={"dot dot-" + c}
          title={MARK_COLOR_LABELS[c]}
          aria-label={"标记为" + MARK_COLOR_LABELS[c] + "色"}
          onClick={() => onColor(c)}
        />
      ))}
      <span className="tt-sep" />
      <button type="button" className="tt-btn" onClick={onNote}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        写感悟
      </button>
      {mode === "new" ? (
        <button type="button" className="tt-btn" onClick={onCopy}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          复制
        </button>
      ) : (
        <button type="button" className="tt-btn danger" onClick={onDelete}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
          删除
        </button>
      )}
    </div>
  );
}
