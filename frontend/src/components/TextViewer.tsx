import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ReaderMode } from "../utils/settings";
import { setReaderCommandHandler, scrollStepFor } from "../utils/readerCommands";
import { usePagerVisibility } from "../utils/usePagerVisibility";
import type { ReadingPosition, PositionReport } from "../utils/library";

type Props = {
  text: string;
  /** 阅读模式：scroll=纵向滚动（默认），page=文本翻页（filmstrip） */
  mode: ReaderMode;
  /** 恢复位置：挂载后按章内比例一次性定位（与 EPUB/PDF 同语义） */
  resume?: ReadingPosition | null;
  /**
   * 同步取位置注册位：App 在离场节点（退出软件/点击书架/切书）flush 时
   * 调用取当前比例（不依赖任何定时器；卸载时组件置回 null）。
   */
  getterRef?: MutableRefObject<(() => PositionReport | null) | null>;
  /** 挂载与位置恢复完成：App 淡出加载遮罩 */
  onReady?: () => void;
};

export default function TextViewer({ text, mode, resume, getterRef, onReady }: Props) {
  const isPage = mode === "page"; // true=文本翻页；false=纵向滚动（默认）
  const scrollRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // ===== 文本翻页模式 =====
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null); // 翻页 section：mousemove 监听挂这里（祖先，覆盖正文区与按钮组）
  const innerRef = useRef<HTMLPreElement>(null);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageHeightRef = useRef(0);
  const innerHeightRef = useRef(0);
  // 翻页导航显隐（v0.2.6）：共享 hook，悬停一级状态，避免移向按钮途中消失
  const pager = usePagerVisibility();
  const showPager = pager.show;

  const clampPage = (p: number) => Math.min(Math.max(0, p), Math.max(0, totalPages - 1));

  // 重新测量分页（容器高度变化 / 字号变化 / 内容变化时）
  const recompute = () => {
    const root = pageRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    const ph = root.clientHeight;
    const ih = inner.scrollHeight;
    pageHeightRef.current = ph;
    innerHeightRef.current = ih;
    const tp = Math.max(1, Math.ceil(ih / Math.max(1, ph)));
    setTotalPages(tp);
    setPage((p) => clampPage(p));
  };

  // 恢复：一次性。pre 与 text 同步渲染，挂载时 scrollHeight 即可用；
  // 若极端情况下内容后到（scrollHeight 为 0），下一帧再补一次。
  // 完成后通知 App 淡出加载遮罩（TXT 无异步渲染，挂载即就绪）。
  useEffect(() => {
    const r = resume;
    if (!r || r.kind !== "txt") {
      onReadyRef.current?.();
      return;
    }
    if (isPage) {
      // 翻页模式：等布局完成后定位到页。优先用 anchor（字符偏移，字号无关）→
      // 反算页码；无 anchor（旧数据）回退到 ratio。
      const apply = () => {
        recompute();
        if (innerHeightRef.current > 0) {
          const ratio =
            r.anchor != null
              ? Math.min(1, Math.max(0, r.anchor / Math.max(1, text.length)))
              : Math.min(1, Math.max(0, r.ratio));
          const p = clampPage(Math.round(ratio * totalPages));
          setPage(p);
        }
        onReadyRef.current?.();
      };
      // 多等一帧确保 pre 已布局
      requestAnimationFrame(() => requestAnimationFrame(apply));
    } else {
      const el = scrollRef.current;
      if (!el) {
        onReadyRef.current?.();
        return;
      }
      // 优先用 anchor（字符偏移，字号无关）→ 比例；无 anchor 回退到 ratio
      const ratio =
        r.anchor != null
          ? Math.min(1, Math.max(0, r.anchor / Math.max(1, text.length)))
          : Math.min(1, Math.max(0, r.ratio));
      const apply = () => {
        el.scrollTop = ratio * Math.max(0, el.scrollHeight - el.clientHeight);
        onReadyRef.current?.();
      };
      apply();
      if (el.scrollHeight === 0) requestAnimationFrame(apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, isPage]);

  // 翻页模式：监听容器/内容尺寸变化重算分页（键盘翻页已上收 window 级统一派发，v0.2.5 F22）
  useEffect(() => {
    if (!isPage) return;
    recompute();
    const root = pageRef.current;
    const inner = innerRef.current;
    const section = sectionRef.current;
    if (!root || !inner || !section) return;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => recompute());
    ro?.observe(root);
    ro?.observe(inner);
    // 翻页导航自动隐藏（v0.2.6）：mousemove 挂在 section（按钮组与正文区的共同祖先），
    // 命中测试据此判定悬停/闲置——按钮组上静止不启动计时，移入正文区才 2.5s 淡出。
    section.addEventListener("mousemove", showPager);
    showPager(); // 初始展示，随后自动隐藏
    return () => {
      ro?.disconnect();
      section.removeEventListener("mousemove", showPager);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPage]);

  // 阅读命令注册（v0.2.5 F22）：window 级快捷键经 readerCommands 槽位派达到本 Viewer。
  // 翻页模式：prev/next/home/end 映射页码；滚动模式：方向键微滚、翻页键整屏（D46）。
  useEffect(() => {
    if (isPage) {
      setReaderCommandHandler((action) => {
        showPager(); // 键盘翻页即复现导航并重置计时（R4）
        if (action === "prev") {
          setPage((p) => clampPage(p - 1));
          return true;
        }
        if (action === "next") {
          setPage((p) => clampPage(p + 1));
          return true;
        }
        if (action === "home") {
          setPage(0);
          return true;
        }
        setPage(Math.max(0, totalPages - 1));
        return true;
      });
    } else {
      setReaderCommandHandler((action, key) => {
        const el = scrollRef.current;
        if (!el) return false;
        if (action === "home") {
          el.scrollTo({ top: 0 });
          return true;
        }
        if (action === "end") {
          el.scrollTo({ top: el.scrollHeight });
          return true;
        }
        const step = scrollStepFor(key, el.clientHeight);
        el.scrollBy({ top: action === "prev" ? -step : step });
        return true;
      });
    }
    return () => setReaderCommandHandler(null);
  }, [isPage, totalPages]);

  // 采集：同步读当前比例。记录时机（2026-10-21 用户口径）：只保留离场节点
  // ——退出软件与点击书架（切书同理），阅读中不挂 scroll 监听、不周期性写库。
  const collectPosition = (): PositionReport | null => {
    if (isPage) {
      const tp = totalPages;
      if (tp <= 0) return { position: { kind: "txt", ratio: 0, mode: "page" }, progress: 0 };
      const ratio = Math.min(1, Math.max(0, page / tp));
      // anchor：字号无关的字符偏移（page/totalPages 映射到字符位置）
      const anchor = Math.round(ratio * text.length);
      return { position: { kind: "txt", ratio, anchor, mode: "page" }, progress: ratio };
    }
    const el = scrollRef.current;
    if (!el) return null;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return { position: { kind: "txt", ratio: 0, mode: "scroll" }, progress: 0 };
    const ratio = Math.min(1, Math.max(0, el.scrollTop / max));
    // anchor：字号无关的字符偏移
    const anchor = Math.round(ratio * text.length);
    return { position: { kind: "txt", ratio, anchor, mode: "scroll" }, progress: ratio };
  };

  // 同步取位置注册：App 在离场节点 flush 时调用（卸载置回 null）
  useEffect(() => {
    if (!getterRef) return;
    getterRef.current = collectPosition;
    return () => {
      if (getterRef.current === collectPosition) getterRef.current = null;
    };
  }, [getterRef, isPage, page, totalPages]);

  if (isPage) {
    return (
      <section className="state state-txt active" aria-label="TXT 显示" ref={sectionRef}>
        <div className="txt-page" ref={pageRef}>
          <pre
            className="txt-filmstrip"
            ref={innerRef}
            style={{ transform: `translateY(${-page * pageHeightRef.current}px)` }}
          >
            {text}
          </pre>
        </div>
        {isPage && totalPages > 1 && (
          <div
            className={"txt-pager" + (pager.visible ? " show" : "")}
            role="group"
            aria-label="翻页"
            ref={pager.setPagerEl}
          >
          <button
            type="button"
            className="pg-btn"
            onClick={() => {
              showPager();
              setPage((p) => clampPage(p - 1));
            }}
            disabled={page <= 0}
            aria-label="上一页"
          >
            ‹
          </button>
          <span className="pg-indicator">
            {totalPages > 0 ? page + 1 + " / " + totalPages : "载入中…"}
          </span>
          <button
            type="button"
            className="pg-btn"
            onClick={() => {
              showPager();
              setPage((p) => clampPage(p + 1));
            }}
            disabled={page >= totalPages - 1}
            aria-label="下一页"
          >
            ›
          </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="state state-txt active" aria-label="TXT 显示">
      <div className="txt-scroll" ref={scrollRef}>
        <pre className="txt-viewer">{text}</pre>
      </div>
    </section>
  );
}
