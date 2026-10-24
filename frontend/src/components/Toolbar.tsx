import type { main } from "../../wailsjs/go/models";
import type { ReaderMode } from "../utils/settings";

type Props = {
  book: main.BookData | null;
  loading: boolean;
  readerMode: ReaderMode;
  onOpen: () => void;
  onShelf: () => void;
  onSettings: () => void;
  onModeChange: () => void;
};

const formatLabel: Record<string, string> = { epub: "EPUB", pdf: "PDF", txt: "TXT" };

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + " MB";
  if (size >= 1024) return (size / 1024).toFixed(0) + " KB";
  return size + " B";
}

export default function Toolbar({ book, loading, readerMode, onOpen, onShelf, onSettings, onModeChange }: Props) {
  return (
    <header className="toolbar">
      <button type="button" className="btn-primary" onClick={onOpen} disabled={loading}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        {loading ? "打开中…" : "打开图书"}
      </button>
      <div className="book-meta">
        {book ? (
          <>
            <span className="book-name" title={book.path}>{book.name}</span>
            <span className={"badge badge-" + book.format}>
              {formatLabel[book.format] ?? book.format.toUpperCase()}
            </span>
            <span className="book-size">{formatSize(book.size)}</span>
          </>
        ) : (
          <span className="book-name book-name-empty">未打开图书</span>
        )}
        {/* 书架：常显可用；无书时点击回到欢迎页（已在欢迎页则无变化） */}
        <button
          type="button"
          className="btn-icon"
          onClick={onShelf}
          title="书架"
          aria-label="书架"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m16 6 4 14" />
            <path d="M12 6v14" />
            <path d="M8 8v12" />
            <path d="M4 4v16" />
          </svg>
        </button>
        {/* 阅读模式快捷切换：阅读中常显；与设置面板写同一 readerMode 字段 */}
        {book && (
          <div className="mode-seg" role="group" aria-label="阅读模式">
            <button
              type="button"
              className={"mode-opt" + (readerMode === "scroll" ? " active" : "")}
              onClick={() => readerMode !== "scroll" && onModeChange()}
              title="纵向滚动"
              aria-pressed={readerMode === "scroll"}
            >
              滚动
            </button>
            <button
              type="button"
              className={"mode-opt" + (readerMode === "page" ? " active" : "")}
              onClick={() => readerMode !== "page" && onModeChange()}
              title="横向翻页"
              aria-pressed={readerMode === "page"}
            >
              翻页
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-icon"
          onClick={onSettings}
          title="设置"
          aria-label="设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
