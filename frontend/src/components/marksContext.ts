// v0.3.0 三 Viewer（TXT/EPUB/PDF）共用的标记上下文：App 组装、BookViewer 透传。
// 设计动机：划词落库、编辑器开关、跳转闪烁等流程对三格式一致，差异只在
// 定位器（TXT 偏移 / EPUB CFI / PDF 页码）与选词采集方式，故抽成共享契约。
// 口径见 doce/BookEditor-v0.3.0-标记记录模块开发方案.md §3/§4。

import type { Mark, MarkColor, MarkLocator, PdfStroke } from "../utils/marks";

export type AddMarkInput = {
  color: MarkColor;
  /** 划选原文（独立想法/PDF 页级标记为空串） */
  text: string;
  note?: string;
  locator: MarkLocator;
  /** true = 独立想法（不依赖选区） */
  idea?: boolean;
};

export type MarksContext = {
  /** 当前书标记（App 订阅 marks 后按 bookPath 过滤；关闭总开关时仍传入以照常显示高亮） */
  marks: Mark[];
  /** 标记记录总开关（settings.markEnabled）：关闭时不弹工具条/气泡，仅展示既有高亮 */
  enabled: boolean;
  /** 新标记默认色（settings.markDefaultColor）：写感悟/写想法入口的初始色 */
  defaultColor: MarkColor;
  /** 色点/标记本页：直接落库；返回落库后的 Mark（EPUB 需要 id 挂 annotation） */
  onAdd: (input: AddMarkInput) => Mark;
  /** 既有条目改色（工具条 existing 态色点） */
  onUpdate: (id: string, patch: { color?: MarkColor }) => void;
  /**
   * 替换某条 PDF 标记的笔迹（D101 画笔）：
   * 画笔是「一页多条笔迹」的聚合结构，增删一笔用整组替换最简单且不会产生中间态。
   * 笔迹清空时由调用方改为删除整条标记（不保留空壳）。
   */
  onReplaceInk?: (id: string, strokes: PdfStroke[]) => void;
  /** 打开感悟编辑器（新建：quote 为划选原文；idea=true 为「写想法」） */
  onNoteNew: (info: { quote: string; locator: MarkLocator; idea?: boolean }) => void;
  /** 打开感悟编辑器（编辑既有条目，回显 note/color） */
  onEdit: (m: Mark) => void;
  /** 删除条目（App 出 toast） */
  onDelete: (id: string) => void;
  /** 复制文本到剪贴板（App 出 toast） */
  onCopy: (text: string) => void;
  /** 跳转目标：面板点条目/更多菜单时置入；nonce 防同一条目重复触发 */
  jumpTarget: { mark: Mark; nonce: number } | null;
  /** 跳转完成：App 清空 jumpTarget */
  onJumpDone: () => void;
};
