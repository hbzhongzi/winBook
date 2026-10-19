import type { main } from "../../wailsjs/go/models";

type Props = {
  book: main.BookData | null;
  detail: string;
};

const defaultDetail: Record<string, string> = {
  txt: "编码：UTF-8 / GBK 自动兼容",
  pdf: "缩放：120%（默认 1.2）",
  epub: "渲染模式：scrolled-doc（纵向滚动）",
};

export default function StatusBar({ book, detail }: Props) {
  const right = detail || (book ? defaultDetail[book.format] ?? "" : "就绪");
  return (
    <footer className="statusbar">
      <span className="path">{book ? book.path : "—"}</span>
      <span>{right}</span>
    </footer>
  );
}
