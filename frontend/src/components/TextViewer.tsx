import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ReaderMode } from "../utils/settings";
import { setReaderCommandHandler, scrollStepFor } from "../utils/readerCommands";
import { usePagerVisibility } from "../utils/usePagerVisibility";
import type { ReadingPosition, PositionReport } from "../utils/library";
import { MARK_SELECT_MIN, type Mark, type MarkLocator } from "../utils/marks";
import MarkToolbar, { type MarkToolbarMode } from "./MarkToolbar";
import type { MarksContext } from "./marksContext";

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
  /** v0.3.0 标记上下文（App 组装、BookViewer 透传）；缺失时纯阅读无标记 */
  marksCtx?: MarksContext;
};

/** 渲染片段：无标记相邻片段合并，减少 DOM 节点；重叠取 updatedAt 最新者 */
type Segment = { start: number; end: number; mark: Mark | null };

function buildSegments(text: string, marks: Mark[]): Segment[] {
  if (marks.length === 0) return [{ start: 0, end: text.length, mark: null }];
  const points = new Set<number>([0, text.length]);
  for (const m of marks) {
    if (m.locator.kind !== "txt") continue;
    const s = Math.max(0, Math.min(text.length, m.locator.start));
    const e = Math.max(s, Math.min(text.length, m.locator.end));
    if (e > s) {
      points.add(s);
      points.add(e);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (e <= s) continue;
    let top: Mark | null = null;
    for (const m of marks) {
      if (m.locator.kind !== "txt") continue;
      if (m.locator.start <= s && m.locator.end >= e && (!top || m.updatedAt >= top.updatedAt)) top = m;
    }
    const last = segs[segs.length - 1];
    if (!top && last && !last.mark && last.end === s) {
      last.end = e; // 与前一无标记片段合并
      continue;
    }
    segs.push({ start: s, end: e, mark: top });
  }
  return segs;
}

/** DOM 文本节点 → 全文偏移（选词采集；pre 内容与 text 严格一致故偏移对齐） */
function textOffset(root: Node, node: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return count + offset;
    count += n.textContent?.length ?? 0;
  }
  return count;
}

/** 全文偏移 → DOM 文本节点位置（跳转定位） */
function locateOffset(root: Node, target: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = n.textContent?.length ?? 0;
    if (count + len >= target) return { node: n, offset: target - count };
    count += len;
  }
  return null;
}

type ToolbarState = {
  x: number;
  y: number;
  mode: MarkToolbarMode;
  /** 划选原文（mouseup 时捕获，落库/复制用） */
  text: string;
  locator: MarkLocator;
  /** existing 态：被重叠的既有条目 id */
  markId: string | null;
};

export default function TextViewer({ text, mode, resume, getterRef, onReady, marksCtx }: Props) {
  const isPage = mode === "page"; // true=文本翻页；false=纵向滚动（默认）
  const scrollRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // ===== 文本翻页模式 =====
  const pageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement>(null); // section：工具条/气泡定位容器 + 划词监听宿主
  const innerRef = useRef<HTMLPreElement>(null); // 翻页 pre
  const preRef = useRef<HTMLPreElement>(null); // 滚动 pre
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageHeightRef = useRef(0);
  const innerHeightRef = useRef(0);
  // 翻页导航显隐（v0.2.6）：共享 hook，悬停一级状态，避免移向按钮途中消失
  const pager = usePagerVisibility();
  const showPager = pager.show;

  // ===== v0.3.0 标记：渲染片段 + 划词工具条/气泡/跳转 =====
  const marksCtxRef = useRef(marksCtx);
  marksCtxRef.current = marksCtx;
  const segments = useMemo(
    () => buildSegments(text, marksCtx?.marks ?? []),
    [text, marksCtx?.marks]
  );
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [bubble, setBubble] = useState<{ mark: Mark; x: number; y: number } | null>(null);
  const jumpNonceRef = useRef(-1);

  const clearSelection = () => window.getSelection()?.removeAllRanges();

  const renderText = () =>
    segments.map((seg, i) =>
      seg.mark ? (
        <mark key={i} className={"mark-hl mark-hl-" + seg.mark.color} data-mark-id={seg.mark.id}>
          {text.slice(seg.start, seg.end)}
        </mark>
      ) : (
        <span key={i}>{text.slice(seg.start, seg.end)}</span>
      )
    );

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
    const section = hostRef.current;
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

  // ===== v0.3.0 划词监听（§4.1/4.4/4.5）=====
  // mouseup 挂在 section（滚动/翻页两模式共用宿主）：选区 ≥ 8 字符弹工具条
  // （与既有高亮重叠 → existing 三态）；无选区点击高亮 → 气泡。
  // 工具条/气泡自身的 mouseup 直接放过（其 mousedown 已 preventDefault 保选区）。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onUp = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.(".mark-toolbar") || t?.closest?.(".mark-bubble")) return;
      // 部分浏览器 mouseup 时 selection 尚未最终确定，等一帧再读
      requestAnimationFrame(() => {
        const ctx = marksCtxRef.current;
        const pre = isPage ? innerRef.current : preRef.current;
        if (!pre) return;
        const sel = window.getSelection();
        const str = sel && sel.rangeCount > 0 ? sel.toString() : "";
        if (str.trim().length >= MARK_SELECT_MIN && sel) {
          if (!ctx || !ctx.enabled) {
            setToolbar(null); // 总开关关闭：不弹工具条（既有高亮照常显示）
            return;
          }
          const range = sel.getRangeAt(0);
          const a = textOffset(pre, range.startContainer, range.startOffset);
          const b = textOffset(pre, range.endContainer, range.endOffset);
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          if (end <= start) {
            setToolbar(null);
            return;
          }
          const rect = range.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          // existing：选区与任一既有 txt 标记区间重叠（多条重叠取首个）
          const hit = ctx.marks.find(
            (m) => m.locator.kind === "txt" && start < m.locator.end && end > m.locator.start
          );
          setBubble(null);
          setToolbar({
            // 以选区中心水平居中（CSS translateX(-50%)），夹紧在容器内
            x: Math.min(
              Math.max(rect.left - hostRect.left + rect.width / 2, 170),
              Math.max(170, hostRect.width - 170)
            ),
            // 上方空间不足翻到下方（§4.2）
            y:
              rect.top - hostRect.top > 48
                ? rect.top - hostRect.top - 42
                : rect.bottom - hostRect.top + 6,
            mode: hit ? "existing" : "new",
            text: str,
            locator: { kind: "txt", start, end },
            markId: hit?.id ?? null,
          });
          return;
        }
        // 无有效选区：点击高亮 → 气泡（§4.5）
        setToolbar(null);
        const mk = t?.closest?.("mark[data-mark-id]") as HTMLElement | null;
        if (mk && ctx?.enabled) {
          const id = mk.getAttribute("data-mark-id");
          const m = ctx.marks.find((x) => x.id === id);
          if (m) {
            const r = mk.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            setBubble({
              mark: m,
              x: Math.min(Math.max(r.left - hostRect.left, 8), Math.max(8, hostRect.width - 268)),
              y: r.bottom - hostRect.top + 6,
            });
            return;
          }
        }
        setBubble(null);
      });
    };
    host.addEventListener("mouseup", onUp);
    return () => host.removeEventListener("mouseup", onUp);
  }, [isPage]);

  // 工具条动作（§4.3/4.4/4.6）
  const onToolbarColor = (color: Mark["color"]) => {
    const ctx = marksCtxRef.current;
    if (!ctx || !toolbar) return;
    if (toolbar.mode === "existing" && toolbar.markId) {
      ctx.onUpdate(toolbar.markId, { color }); // 改色
    } else {
      ctx.onAdd({ color, text: toolbar.text, locator: toolbar.locator });
    }
    clearSelection();
    setToolbar(null);
  };

  const onToolbarNote = () => {
    const ctx = marksCtxRef.current;
    if (!ctx || !toolbar) return;
    if (toolbar.mode === "existing" && toolbar.markId) {
      const m = ctx.marks.find((x) => x.id === toolbar.markId);
      if (m) ctx.onEdit(m);
    } else {
      ctx.onNoteNew({ quote: toolbar.text, locator: toolbar.locator });
    }
    clearSelection();
    setToolbar(null);
  };

  const onToolbarCopy = () => {
    if (toolbar) marksCtxRef.current?.onCopy(toolbar.text);
    clearSelection();
    setToolbar(null);
  };

  const onToolbarDelete = () => {
    const ctx = marksCtxRef.current;
    if (!ctx || !toolbar?.markId) return;
    ctx.onDelete(toolbar.markId);
    clearSelection();
    setToolbar(null);
  };

  // 跳转目标（§4.16）：面板点条目 → App 置 jumpTarget（nonce 防重复）→ 定位 + 闪烁 1.6s
  useEffect(() => {
    const ctx = marksCtxRef.current;
    const jt = ctx?.jumpTarget ?? null;
    if (!jt || jt.nonce === jumpNonceRef.current) return;
    jumpNonceRef.current = jt.nonce;
    const m = jt.mark;
    const loc = m.locator;
    if (loc.kind !== "txt") {
      ctx?.onJumpDone();
      return;
    }
    requestAnimationFrame(() => {
      const pre = isPage ? innerRef.current : preRef.current;
      if (!pre) {
        ctx?.onJumpDone();
        return;
      }
      if (isPage) {
        // 翻页模式：anchor → 页码
        const ratio = Math.min(1, Math.max(0, loc.start / Math.max(1, text.length)));
        setPage(clampPage(Math.round(ratio * totalPages)));
      } else {
        const el = scrollRef.current;
        const at = locateOffset(pre, loc.start);
        if (el && at) {
          const range = document.createRange();
          range.setStart(at.node, at.offset);
          range.setEnd(at.node, at.offset);
          const rect = range.getBoundingClientRect();
          const hostRect = hostRef.current?.getBoundingClientRect();
          if (hostRect) {
            el.scrollTo({
              top: el.scrollTop + (rect.top - hostRect.top) - el.clientHeight / 3,
            });
          }
        }
      }
      const el = pre.querySelector('mark[data-mark-id="' + m.id + '"]');
      if (el) {
        el.classList.add("mark-flash");
        window.setTimeout(() => el.classList.remove("mark-flash"), 1600);
      }
      ctx?.onJumpDone();
    });
  }, [marksCtx, isPage, text.length, totalPages]);

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
      <section className="state state-txt active" aria-label="TXT 显示" ref={hostRef}>
        <div className="txt-page" ref={pageRef}>
          <pre
            className="txt-filmstrip"
            ref={innerRef}
            style={{ transform: `translateY(${-page * pageHeightRef.current}px)` }}
          >
            {renderText()}
          </pre>
        </div>
        {toolbar && (
          <MarkToolbar
            x={toolbar.x}
            y={toolbar.y}
            mode={toolbar.mode}
            onColor={onToolbarColor}
            onNote={onToolbarNote}
            onCopy={onToolbarCopy}
            onDelete={onToolbarDelete}
          />
        )}
        {bubble && (
          <div
            className="mark-bubble"
            style={{ left: bubble.x, top: bubble.y }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="mb-quote">{bubble.mark.text || "（无原文）"}</div>
            {bubble.mark.note && <div className="mb-note">{bubble.mark.note}</div>}
            <div className="mb-acts">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const m = bubble.mark;
                  setBubble(null);
                  marksCtxRef.current?.onEdit(m);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const id = bubble.mark.id;
                  setBubble(null);
                  marksCtxRef.current?.onDelete(id);
                }}
              >
                删除
              </button>
            </div>
          </div>
        )}
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
    <section className="state state-txt active" aria-label="TXT 显示" ref={hostRef}>
      <div className="txt-scroll" ref={scrollRef}>
        <pre className="txt-viewer" ref={preRef}>
          {renderText()}
        </pre>
      </div>
      {toolbar && (
        <MarkToolbar
          x={toolbar.x}
          y={toolbar.y}
          mode={toolbar.mode}
          onColor={onToolbarColor}
          onNote={onToolbarNote}
          onCopy={onToolbarCopy}
          onDelete={onToolbarDelete}
        />
      )}
      {bubble && (
        <div
          className="mark-bubble"
          style={{ left: bubble.x, top: bubble.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="mb-quote">{bubble.mark.text || "（无原文）"}</div>
          {bubble.mark.note && <div className="mb-note">{bubble.mark.note}</div>}
          <div className="mb-acts">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const m = bubble.mark;
                setBubble(null);
                marksCtxRef.current?.onEdit(m);
              }}
            >
              编辑
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const id = bubble.mark.id;
                setBubble(null);
                marksCtxRef.current?.onDelete(id);
              }}
            >
              删除
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
