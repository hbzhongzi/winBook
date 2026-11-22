// D113：PDF 画笔「擦除」的快照式历史（纯函数，便于单测）。
//
// 为什么不用原来的「撤销=删最后一笔」模型：D111 起橡皮是按范围做局部擦除，
// 它会修改笔迹内容（切分/缩短/删除段），既不是新增一笔也不是删除一笔。
// 用 popLastDraft 去撤擦除，撤掉的是「最后一笔」而非被擦的段，语义完全错位；
// 恢复同理。因此把一次擦除拖拽作为原子操作，记录操作前后的页笔迹快照。

import type { MarkColor, PdfStroke } from "./marks";

/** 一个已落库标记内的笔迹（恢复时按颜色 + 笔迹重建标记） */
export type InkSavedMark = {
  color: MarkColor;
  strokes: PdfStroke[];
};

/** 某一页的完整笔迹快照：未保存草稿 + 已落库标记 */
export type InkPageSnapshot = {
  page: number;
  drafts: PdfStroke[];
  saved: InkSavedMark[];
};

/** 一次擦除拖拽的历史条目 */
export type InkEraseEntry = {
  before: InkPageSnapshot;
  after: InkPageSnapshot;
};

/** 擦除历史上限：防止长时间连续编辑无限增长 */
export const INK_ERASE_HISTORY_LIMIT = 50;

/** 笔迹列表是否「同一份」：按数组与元素引用比较，不做深比较。
 *  擦除实现保留未修改笔迹的引用，因此引用比较足以判断内容是否被改。 */
export function sameStrokeList(a: PdfStroke[], b: PdfStroke[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 两个页快照是否一致 */
export function samePageSnapshot(a: InkPageSnapshot, b: InkPageSnapshot): boolean {
  if (a === b) return true;
  if (a.page !== b.page) return false;
  if (!sameStrokeList(a.drafts, b.drafts)) return false;
  if (a.saved.length !== b.saved.length) return false;
  for (let i = 0; i < a.saved.length; i++) {
    const x = a.saved[i];
    const y = b.saved[i];
    if (x.color !== y.color) return false;
    if (!sameStrokeList(x.strokes, y.strokes)) return false;
  }
  return true;
}

/** 构造「擦除后」快照：草稿里是擦除结果，原已落库笔迹已在处理时移出标记 */
export function createErasedSnapshot(page: number, drafts: PdfStroke[]): InkPageSnapshot {
  return { page, drafts, saved: [] };
}

/** 压入一条擦除历史并截断到上限（保留最近 limit 条） */
export function pushEraseEntry(
  stack: InkEraseEntry[],
  entry: InkEraseEntry,
  limit = INK_ERASE_HISTORY_LIMIT
): InkEraseEntry[] {
  const out = [...stack, entry];
  return out.length > limit ? out.slice(out.length - limit) : out;
}
