import type { main } from "../../wailsjs/go/models";
import type { LibraryEntry } from "../utils/library";
import type { ReaderMode } from "../utils/settings";

type Props = {
  book: main.BookData | null;
  detail: string;
  entries: LibraryEntry[];
  /** 阅读模式（scroll=纵向滚动 / page=横向翻页）：用于动态文案 */
  readerMode: ReaderMode;
  /** 位置刚落库：显示「进度已保存」闪烁（过渡动画，1.5s 后由 App 撤下） */
  savedFlash?: boolean;
  /**
   * v0.2.9：PDF 动态文案（App 据 PdfViewer 上报的实际倍率生成，
   * 如「单页翻页 · 适宽 208% · 高清渲染开」）；非 PDF 或未上报时走 defaultDetail。
   */
  pdfDetail?: string | null;
};

/** 状态栏默认文案（无章节详情时显示）：三格式 × 两模式 */
function defaultDetail(format: string, mode: ReaderMode): string {
  if (format === "txt") {
    return mode === "page" ? "文本翻页 · 编码：UTF-8 / GBK 自动兼容" : "纵向滚动 · 编码：UTF-8 / GBK 自动兼容";
  }
  if (format === "pdf") {
    // v0.2.9：默认缩放由写死 1.2 改为自适应（D65）
    return mode === "page" ? "单页翻页 · 缩放：自适应" : "连续滚动 · 缩放：自适应";
  }
  // epub
  return mode === "page" ? "横向翻页（分页）" : "连续滚动";
}

export default function StatusBar({ book, detail, entries, readerMode, savedFlash, pdfDetail }: Props) {
  // 欢迎页（无书）：右侧显示书架条数（与 HTML 基线一致）
  const right = detail || pdfDetail || (book ? defaultDetail(book.format, readerMode) : "就绪 · 书架 " + entries.length + " 条记录");
  return (
    <footer className="statusbar">
      <span className="path">{book ? book.path : "—"}</span>
      {/* 位置落库反馈：挂载即播放一次弹出动画，撤下后下次保存重新触发 */}
      {savedFlash && <span className="save-flash on">进度已保存</span>}
      <span>{right}</span>
    </footer>
  );
}
