import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import { base64ToUint8Array } from "../utils/base64";

// epubjs 类型声明不完整，按使用面定义最小接口
type EpubNavItem = { label: string; href: string };
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  resize: (width: string, height: string) => void;
};
type EpubBook = {
  renderTo: (el: HTMLElement, opts: Record<string, unknown>) => EpubRendition;
  destroy: () => void;
  loaded: { navigation: Promise<{ toc: EpubNavItem[] }> };
};

type Props = {
  dataBase64: string;
  onChapterChange?: (title: string) => void;
};

export default function EpubViewer({ dataBase64, onChapterChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const [toc, setToc] = useState<EpubNavItem[]>([]);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let destroyed = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        const bytes = base64ToUint8Array(dataBase64);
        const book = ePub(bytes.buffer as ArrayBuffer) as unknown as EpubBook;
        bookRef.current = book;
        const rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          flow: "scrolled-doc",
        });
        renditionRef.current = rendition;
        await rendition.display();
        if (destroyed) return;
        const nav = await book.loaded.navigation;
        if (destroyed) return;
        const items = (nav.toc ?? []).map((t) => ({ label: t.label, href: t.href }));
        setToc(items);
        if (items.length > 0) {
          setActive(0);
          onChapterChange?.(items[0].label);
        }
      } catch {
        if (!destroyed) setFailed(true);
      }
    })();

    const onResize = () => renditionRef.current?.resize("100%", "100%");
    window.addEventListener("resize", onResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      onChapterChange?.("");
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略销毁异常
      }
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [dataBase64, onChapterChange]);

  const jump = (index: number, href: string) => {
    setActive(index);
    onChapterChange?.(toc[index]?.label ?? "");
    renditionRef.current?.display(href);
  };

  if (failed) {
    return (
      <section className="state state-epub active" aria-label="EPUB 解析失败">
        <div className="welcome">
          <span className="welcome-title">EPUB 解析失败，请确认文件未加密或损坏</span>
        </div>
      </section>
    );
  }

  return (
    <section className="state state-epub active" aria-label="EPUB 显示">
      {toc.length > 0 && (
        <aside className="toc-sidebar">
          <div className="toc-title">目录</div>
          {toc.map((item, i) => (
            <button
              key={item.href + ":" + i}
              type="button"
              className={"toc-item" + (i === active ? " active" : "")}
              onClick={() => jump(i, item.href)}
            >
              {item.label}
            </button>
          ))}
        </aside>
      )}
      <div className="epub-content" ref={containerRef} />
    </section>
  );
}
