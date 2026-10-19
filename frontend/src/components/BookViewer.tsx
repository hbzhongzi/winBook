import type { main } from "../../wailsjs/go/models";
import TextViewer from "./TextViewer";
import PdfViewer from "./PdfViewer";
import EpubViewer from "./EpubViewer";

type Props = {
  book: main.BookData | null;
  openCount: number;
  onDetail: (detail: string) => void;
};

export default function BookViewer({ book, openCount, onDetail }: Props) {
  if (!book) {
    return (
      <main className="content">
        <div className="state-host">
          <section className="state state-empty active" aria-label="空态">
            <div className="welcome">
              <span className="welcome-icon">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </span>
              <span className="welcome-title">尚未打开图书</span>
              <span className="welcome-hint">点击工具栏「打开图书」，选择 EPUB / PDF / TXT 文件</span>
              <span className="welcome-sub">取消文件选择时不显示任何提示</span>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="content">
      {/* key 变化时整体重挂载，确保旧 Viewer 执行 destroy / 渲染任务取消；
          openCount 保证重复打开同一文件（path+size 相同）也会重建 */}
      <div className="state-host" key={book.path + ":" + book.size + ":" + openCount}>
        {book.format === "txt" && <TextViewer text={book.text ?? ""} />}
        {book.format === "pdf" && <PdfViewer dataBase64={book.dataBase64 ?? ""} />}
        {book.format === "epub" && (
          <EpubViewer
            dataBase64={book.dataBase64 ?? ""}
            onChapterChange={(title) =>
              onDetail(title ? "渲染模式：scrolled-doc · 当前：" + title : "")
            }
          />
        )}
      </div>
    </main>
  );
}
