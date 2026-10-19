import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import { base64ToUint8Array } from "../utils/base64";

// epubjs 类型声明不完整，按使用面定义最小接口
type EpubNavItem = { label: string; href: string };
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  resize: (width: string, height: string) => void;
  on?: (event: string, cb: (payload: unknown) => void) => void;
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

// epubjs 打开/目录加载超时：损坏文件时 epubjs 的 opened 可能永久挂起
// （既不 resolve 也不 reject，见 e2e/check_epubjs.cjs 实测），无超时则白屏无提示
const OPEN_TIMEOUT_MS = 10000;
// display() resolve 后等待 iframe 绘制的时间，再做内容校验
const SETTLE_MS = 700;
// 首章渲染为空白的自动后移次数（商业书常见：首章为图片页/空壳页）
const EMPTY_SECTION_RETRY = 1;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EPUB_OPEN_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 等待 iframe 绘制，零高度则强制重新布局，返回内容状态（true 有 / false 空白 / null 无法判定） */
async function settleAndCheck(
  container: HTMLElement,
  rendition: EpubRendition,
  strict: boolean
): Promise<boolean | null> {
  await sleep(SETTLE_MS);
  if (iframeIsZeroSized(container)) {
    try {
      rendition.resize("100%", "100%");
    } catch {
      // 忽略重布局异常
    }
    await sleep(500);
  }
  return iframeContentState(container, strict);
}

/**
 * 检查 rendition iframe 是否已渲染出可见内容。
 * 返回 true=有内容，false=确认空白，null=尚无法判定（未加载完成/跨域不可访问）。
 * strict=true 时要求文档加载完成才下结论（首轮保守判定，避免误判慢加载章节）。
 */
function iframeContentState(container: HTMLElement, strict: boolean): boolean | null {
  const iframe = container.querySelector("iframe");
  if (!(iframe instanceof HTMLIFrameElement)) return null;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null; // 跨域：不阻断渲染流程
  }
  if (!doc || !doc.body) return null;
  if (strict && doc.readyState !== "complete") return null; // 仍在加载，避免误判
  const text = (doc.body.innerText || doc.body.textContent || "").replace(/[\s\u3000]+/g, "");
  if (text.length > 0) return true;
  const els = doc.body.querySelectorAll(
    "img,svg,canvas,video,picture,object,embed,div,p,span,h1,h2,h3,h4,table,blockquote"
  );
  for (let i = 0; i < els.length; i++) {
    const r = (els[i] as HTMLElement).getBoundingClientRect();
    if (r.width > 8 && r.height > 8) return true;
  }
  return false;
}

/** iframe 是否被布局成零高度（renderTo 时容器尚未完成布局会导致白屏） */
function iframeIsZeroSized(container: HTMLElement): boolean {
  const iframe = container.querySelector("iframe");
  if (!(iframe instanceof HTMLIFrameElement)) return false;
  const r = iframe.getBoundingClientRect();
  return r.height < 40 || r.width < 40;
}

export default function EpubViewer({ dataBase64, onChapterChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const [toc, setToc] = useState<EpubNavItem[]>([]);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  // onChapterChange 经 ref 调用：父组件每次渲染都会传入新函数引用，
  // 若直接进 effect 依赖会导致 effect 反复重跑（书籍被销毁重建、目录状态重置）。
  const onChapterChangeRef = useRef(onChapterChange);
  onChapterChangeRef.current = onChapterChange;

  useEffect(() => {
    let destroyed = false;
    const container = containerRef.current;
    if (!container) return;

    const fail = () => {
      if (destroyed) return;
      setFailed(true);
      // 打开失败（含超时）时主动销毁，避免挂起的 book 实例残留
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略销毁异常
      }
      bookRef.current = null;
      renditionRef.current = null;
    };

    (async () => {
      // displayError 仅在初始显示阶段触发失败：用户主动点击无效目录项时
      // 由 jump() 自行吞掉拒绝，不整本书判定失败。
      let initialPhase = true;

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

        // displayError：section 加载失败时 epubjs 只抛事件、display() 永久挂起，
        // 监听后立即失败，不必等超时（实测：部分真实书触发此路径）。
        rendition.on?.("displayError", () => {
          if (initialPhase) fail();
        });

        // 先加载目录：即便后续 display 失败/超时，用户也能看到目录与错误提示，
        // 而不是纯白屏（真实书测试反馈：目录加载成功但正文空白）。
        const nav = await withTimeout(book.loaded.navigation, OPEN_TIMEOUT_MS);
        if (destroyed) return;
        const items = (nav.toc ?? []).map((t) => ({ label: t.label, href: t.href }));
        setToc(items);
        if (items.length > 0) {
          setActive(0);
          onChapterChangeRef.current?.(items[0].label);
        }

        await withTimeout(rendition.display(), OPEN_TIMEOUT_MS);
        if (destroyed) return;

        // 渲染后校验：iframe 零高度 → 强制重新布局自愈；内容空白 → 确认后向后跳一章。
        // 背景：部分商业 EPUB 首章为图片页/空壳页，或 renderTo 时容器未完成布局，
        // 表现为目录正常、正文纯白且无任何错误提示（用户实测反馈）。
        let state = await settleAndCheck(container, rendition, true);
        if (destroyed) return;
        if (state !== false) {
          initialPhase = false;
          return; // 有内容 / 无法判定 → 接受
        }

        // 二次沉淀复检（放宽 readyState 要求），排除章节体积大、绘制慢导致的误判
        state = await settleAndCheck(container, rendition, false);
        if (destroyed) return;
        if (state !== false) {
          initialPhase = false;
          return;
        }

        // 确认空白：向后跳章（最多 EMPTY_SECTION_RETRY 次）
        for (let step = 1; step <= EMPTY_SECTION_RETRY && step < items.length; step++) {
          setActive(step);
          onChapterChangeRef.current?.(items[step].label);
          try {
            await withTimeout(rendition.display(items[step].href), OPEN_TIMEOUT_MS);
          } catch {
            initialPhase = false;
            return; // 跳章失败：保持当前状态
          }
          if (destroyed) return;
          state = await settleAndCheck(container, rendition, false);
          if (destroyed) return;
          if (state !== false) {
            initialPhase = false;
            return;
          }
        }
        // 多次校验仍为空白：按解析失败提示，避免无提示白屏
        fail();
      } catch {
        fail();
      } finally {
        initialPhase = false;
      }
    })();

    const onResize = () => renditionRef.current?.resize("100%", "100%");
    window.addEventListener("resize", onResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      onChapterChangeRef.current?.("");
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略销毁异常
      }
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [dataBase64]);

  const jump = (index: number, href: string) => {
    setActive(index);
    onChapterChange?.(toc[index]?.label ?? "");
    // display() 对无效 href 会 reject，避免未处理的 Promise 拒绝
    Promise.resolve(renditionRef.current?.display(href)).catch(() => {});
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
