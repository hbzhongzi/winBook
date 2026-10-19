import type { main } from "../../wailsjs/go/models";

type Props = {
  book: main.BookData | null;
  loading: boolean;
  onOpen: () => void;
};

const formatLabel: Record<string, string> = { epub: "EPUB", pdf: "PDF", txt: "TXT" };

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + " MB";
  if (size >= 1024) return (size / 1024).toFixed(0) + " KB";
  return size + " B";
}

export default function Toolbar({ book, loading, onOpen }: Props) {
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
      </div>
    </header>
  );
}
