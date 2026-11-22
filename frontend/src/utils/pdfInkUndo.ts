// PDF 画笔撤销/清空的页范围口径（D105 新增）。
//
// 问题（用户截图）：双栏模式下两页都画了笔迹，「保存（2 笔）」可用，但
// 「撤销」「清空本页」却呈灰色不可用。根因是旧实现把这几个操作都只作用于
// `current`（左页），忽略了右页 `current+1`；而草稿计数 `inkDraftTotal`
// 是跨所有页统计的——两边口径不一致。
//
// 本模块统一口径：
// - 翻页单栏：可见页 = [current]
// - 翻页双栏：可见页 = [current, current+1]
// - 滚动模式：页面分散在虚拟列表，按当前滚动到的页算（调用方传 activePage）
//
// 「撤销」语义：在可见页范围内，从最大的页开始找有草稿的页，撤它的最后一笔；
// 若可见页都无草稿，则找已落库笔迹的页（调用方通过 hasSaved 回调判定）。
//
// D106 追加「恢复」（redo）：撤销时把被撤的一步压栈，恢复时反向执行。
// 草稿笔直接加回草稿栈；已落库笔迹整组写回（标记被删则用记录的颜色/页码重建）。

import type { MarkColor, PdfStroke } from "./marks";

/** 撤销后可恢复的一步 */
export type InkRedoEntry =
  | { kind: "draft"; page: number; stroke: PdfStroke }
  | {
      kind: "saved";
      page: number;
      markId: string;
      /** 撤销前的完整笔迹（恢复时整组写回，避免中间态） */
      strokes: PdfStroke[];
      color: MarkColor;
    };

/** 是否还有可恢复的一步 */
export function canRedoInk(entries: InkRedoEntry[]): boolean {
  return entries.length > 0;
}

/** 取草稿栈最后一笔；空栈返回 null（撤销/恢复的原子步骤） */
export function popLastDraft(
  strokes: PdfStroke[]
): { rest: PdfStroke[]; last: PdfStroke } | null {
  if (!strokes || strokes.length === 0) return null;
  return { rest: strokes.slice(0, -1), last: strokes[strokes.length - 1] };
}

/** 当前可见页集合：双栏含右页 current+1 */
export function visiblePages(current: number, columns: 1 | 2): number[] {
  return columns === 2 ? [current, current + 1] : [current];
}

/**
 * 选撤销目标页：可见页中「有草稿」的最大页码优先，其次「有已落库笔迹」的最大页码。
 * 返回 null 表示没有可撤销内容。
 */
export function undoTargetPage(
  pages: number[],
  draftCounts: (page: number) => number,
  hasSaved: (page: number) => boolean
): number | null {
  // 倒序：双栏下右页（后画）优先撤销
  const ordered = [...pages].sort((a, b) => b - a);
  for (const p of ordered) {
    if (draftCounts(p) > 0) return p;
  }
  for (const p of ordered) {
    if (hasSaved(p)) return p;
  }
  return null;
}

/** 是否可撤销：可见页中有草稿或有已落库笔迹 */
export function canUndoInk(
  pages: number[],
  draftCounts: (page: number) => number,
  hasSaved: (page: number) => boolean
): boolean {
  return undoTargetPage(pages, draftCounts, hasSaved) !== null;
}

/** 是否可清空：与撤销同口径（有草稿或有已落库笔迹） */
export function canClearInk(
  pages: number[],
  draftCounts: (page: number) => number,
  hasSaved: (page: number) => boolean
): boolean {
  return canUndoInk(pages, draftCounts, hasSaved);
}
