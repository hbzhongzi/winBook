// v0.3.0 标记记录面板（F35/F36/F37/F38）：右侧抽屉 340px，按书管理标记与感悟。
// 口径对齐 doce/BookEditor-v0.3.0-标记记录模块开发方案.md §4.11–4.21：
// - 头部：标题 + 计数 + 写想法 + 导出 + 关闭；
// - 工具行：搜索（原文与感悟，「与」关系）+ 筛选 chips（全部/有感悟/四色）；
// - 列表：按章节分组（「想法」组置顶），组内 updatedAt 倒序；
// - 条目：色条 + 原文摘录（≤3 行）+ 感悟预览（≤2 行）+ 相对时间 + 「⋯」菜单
//   （跳转/编辑/复制/删除）；点正文区跳转定位（面板保持打开）；
// - 底部：共 N 条 · 有感悟 M 条 + 清空本书（二次确认）；
// - 导出弹层：Markdown + 范围（当前图书/全部图书）+ 前 40 行预览 + 复制/下载。
// 数据由 App 订阅后传入（marks=当前书，allMarks=全部）；写操作经回调上交。

import { useEffect, useMemo, useState } from "react";
import {
  MARK_COLORS,
  MARK_COLOR_LABELS,
  exportMarksMarkdown,
  formatMarkTime,
  markGroup,
  type Mark,
  type MarkColor,
} from "../utils/marks";

type Filter = "all" | "noted" | MarkColor;

type Props = {
  /** 书架条目名（去扩展名）：导出标题/文件名与清空确认展示 */
  bookName: string;
  /** 当前书标记 */
  marks: Mark[];
  /** 全部标记（导出「全部图书」范围） */
  allMarks: Mark[];
  onClose: () => void;
  /** 跳转定位：Viewer 负责滚动 + 闪烁 1.6s；跳转后面板保持打开（§4.16） */
  onJump: (m: Mark) => void;
  /** 编辑：App 打开 MarkNoteEditor（编辑态，回显 note/color） */
  onEdit: (m: Mark) => void;
  /** 「＋ 写想法」：App 以默认色打开编辑器（idea 新建态，§4.10） */
  onWriteIdea: () => void;
  onDelete: (id: string) => void;
  /** 清空本书（二次确认后生效） */
  onClearBook: () => void;
  onToast: (msg: string) => void;
};

/** 条目原文摘录：独立想法显示「◆ 想法」前缀；PDF 页级标记无原文时给占位 */
function itemText(m: Mark): string {
  if (m.idea) return "◆ 想法";
  if (m.text) return m.text;
  if (m.locator.kind === "pdf") return "（第 " + m.locator.page + " 页标记）";
  return "（无原文）";
}

/**  meta 行位置补充：EPUB 章节 / PDF 页码；TXT 不补（组头已体现） */
function metaPos(m: Mark): string | null {
  if (m.locator.kind === "epub") return m.locator.chapter || "正文";
  if (m.locator.kind === "pdf") return "第 " + m.locator.page + " 页";
  return null;
}

export default function MarksPanel({
  bookName,
  marks,
  allMarks,
  onClose,
  onJump,
  onEdit,
  onWriteIdea,
  onDelete,
  onClearBook,
  onToast,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exScope, setExScope] = useState<"book" | "all">("book");
  const [showClear, setShowClear] = useState(false);

  const sorted = useMemo(() => [...marks].sort((a, b) => b.updatedAt - a.updatedAt), [marks]);

  // 搜索 + 筛选为「与」关系（§4.13）：筛选先过，再匹配原文/感悟
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((m) => {
      if (filter === "noted") {
        if (!m.note) return false;
      } else if (filter !== "all" && m.color !== filter) {
        return false;
      }
      if (!q) return true;
      return m.text.toLowerCase().includes(q) || m.note.toLowerCase().includes(q);
    });
  }, [sorted, query, filter]);

  // 分组：首次出现顺序，「想法」组置顶（HTML 基线口径）
  const groups = useMemo(() => {
    const map = new Map<string, Mark[]>();
    for (const m of filtered) {
      const g = markGroup(m);
      const arr = map.get(g);
      if (arr) arr.push(m);
      else map.set(g, [m]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "想法" ? -1 : b === "想法" ? 1 : 0));
  }, [filtered]);

  const notedCount = useMemo(() => marks.filter((m) => !!m.note).length, [marks]);
  const chipCount = (f: Filter): number => {
    if (f === "all") return marks.length;
    if (f === "noted") return notedCount;
    return marks.filter((m) => m.color === f).length;
  };

  // Esc 分层关闭（§4.22）：导出 → 清空确认 → 面板。捕获阶段拦截并
  // stopPropagation，避免 App 层阅读快捷键/设置面板同时响应；
  // 更高层模态（感悟编辑器）打开时 Esc 归其处理，本层让行。
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (document.querySelector(".note-editor")) return; // 编辑器开着：Esc 归编辑器
      ev.stopPropagation();
      ev.preventDefault();
      if (showExport) setShowExport(false);
      else if (showClear) setShowClear(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [showExport, showClear, onClose]);

  // 「⋯」菜单：再次点按钮开关由按钮 onClick 负责；点菜单外关闭
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest(".cat-menu") || t?.closest(".mi-more")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  // ===== 导出（§4.19/4.20/4.21）=====
  const exportName = exScope === "book" ? bookName : "全部图书";
  const exportList = exScope === "book" ? marks : allMarks;
  const exportText = useMemo(
    () => exportMarksMarkdown(exportName, exportList),
    [exportName, exportList]
  );
  const previewText = useMemo(
    () => exportText.split("\n").slice(0, 40).join("\n"),
    [exportText]
  );

  const copyText = (text: string): Promise<void> =>
    navigator.clipboard
      ? navigator.clipboard.writeText(text).then(
          () => undefined,
          () => {
            throw new Error("clipboard");
          }
        )
      : Promise.reject(new Error("clipboard"));

  const handleCopyExport = () => {
    copyText(exportText)
      .then(() => onToast("已复制 " + exportList.length + " 条标记"))
      .catch(() => onToast("复制失败：请检查浏览器权限"));
  };

  const handleDownload = () => {
    const blob = new Blob([exportText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportName + "-标记.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setShowExport(false);
    onToast("已下载 " + exportList.length + " 条标记");
  };

  return (
    <aside className="marks-panel" aria-label="标记记录">
      <div className="mp-head">
        <span className="t">标记记录</span>
        <span className="n">{marks.length} 条</span>
        <span className="sp">
          <button
            type="button"
            className="btn-icon"
            onClick={onWriteIdea}
            title="写想法"
            aria-label="写想法"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setShowExport(true)}
            title="导出"
            aria-label="导出标记"
            disabled={marks.length === 0 && allMarks.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            title="关闭面板"
            aria-label="关闭面板"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      </div>

      <div className="mp-tools">
        <input
          className="mp-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索原文与感悟"
          aria-label="搜索原文与感悟"
        />
        <div className="mp-chips" role="group" aria-label="筛选">
          <button
            type="button"
            className={"chip" + (filter === "all" ? " active" : "")}
            onClick={() => setFilter("all")}
          >
            全部 <span className="cnt">{chipCount("all")}</span>
          </button>
          <button
            type="button"
            className={"chip" + (filter === "noted" ? " active" : "")}
            onClick={() => setFilter("noted")}
          >
            有感悟 <span className="cnt">{chipCount("noted")}</span>
          </button>
          {MARK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={"chip" + (filter === c ? " active" : "")}
              onClick={() => setFilter(c)}
            >
              <span className={"cdot cdot-" + c} />
              {MARK_COLOR_LABELS[c]} <span className="cnt">{chipCount(c)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mp-list">
        {marks.length === 0 ? (
          <div className="mp-empty">
            <svg className="ic" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <div>还没有标记</div>
            <div>选中正文即可添加标记与感悟</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mp-empty">
            <div>无匹配标记</div>
          </div>
        ) : (
          groups.map(([group, items]) => (
            <div key={group}>
              <div className={"mp-group" + (group === "想法" ? " idea" : "")}>
                {group === "想法" ? "◆ 想法" : group} <span className="gc">{items.length}</span>
              </div>
              {items.map((m) => (
                <div className="mark-item" key={m.id}>
                  <span className={"bar bar-" + m.color} />
                  <div
                    className="body"
                    role="button"
                    tabIndex={0}
                    title="跳转到原文"
                    onClick={() => onJump(m)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onJump(m);
                    }}
                  >
                    <div className={"mi-text" + (m.idea ? " idea" : "")}>{itemText(m)}</div>
                    {m.note && <div className="mi-note">{m.note}</div>}
                    <div className="mi-meta">
                      <span>{formatMarkTime(m.updatedAt)}</span>
                      {metaPos(m) && (
                        <>
                          <span>·</span>
                          <span>{metaPos(m)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mi-more"
                    title="更多"
                    aria-label={"更多操作：" + itemText(m)}
                    onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                  >
                    ⋯
                  </button>
                  {menuFor === m.id && (
                    <div className="cat-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          setMenuFor(null);
                          onJump(m);
                        }}
                      >
                        跳转到原文
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          setMenuFor(null);
                          onEdit(m);
                        }}
                      >
                        编辑
                      </button>
                      {m.text && (
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => {
                            setMenuFor(null);
                            copyText(m.text)
                              .then(() => onToast("已复制原文"))
                              .catch(() => onToast("复制失败：请检查浏览器权限"));
                          }}
                        >
                          复制原文
                        </button>
                      )}
                      <button
                        type="button"
                        className="menu-item danger"
                        onClick={() => {
                          setMenuFor(null);
                          onDelete(m.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="mp-foot">
        <span>
          共 {marks.length} 条 · 有感悟 {notedCount} 条
        </span>
        <button
          type="button"
          className="link-btn clear"
          onClick={() => setShowClear(true)}
          disabled={marks.length === 0}
        >
          清空本书…
        </button>
      </div>

      {/* ===== 导出弹层（§4.19–4.21）===== */}
      {showExport && (
        <div
          className="modal-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowExport(false);
          }}
        >
          <div className="export-modal" role="dialog" aria-modal="true" aria-label="导出标记">
            <h3>导出标记</h3>
            <div className="ex-row">
              <span className="rl">格式</span>
              <button type="button" className="radio-pill active">
                Markdown（.md）
              </button>
              <button type="button" className="radio-pill" disabled title="本版仅 Markdown（D71）">
                JSON
              </button>
            </div>
            <div className="ex-row">
              <span className="rl">范围</span>
              <button
                type="button"
                className={"radio-pill" + (exScope === "book" ? " active" : "")}
                onClick={() => setExScope("book")}
              >
                当前图书
              </button>
              <button
                type="button"
                className={"radio-pill" + (exScope === "all" ? " active" : "")}
                onClick={() => setExScope("all")}
              >
                全部图书
              </button>
            </div>
            <textarea className="ex-preview" readOnly value={previewText} aria-label="导出预览" />
            <div className="ex-foot">
              <button type="button" className="btn" onClick={() => setShowExport(false)}>
                取消
              </button>
              <button type="button" className="btn" onClick={handleCopyExport}>
                复制到剪贴板
              </button>
              <button type="button" className="btn primary" onClick={handleDownload}>
                下载 .md
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 清空本书二次确认（§4.17）===== */}
      {showClear && (
        <div
          className="modal-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowClear(false);
          }}
        >
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-label="清空本书标记">
            <h3>清空本书标记</h3>
            <p>
              将删除《<b>{bookName}</b>》的全部 <b>{marks.length}</b> 条标记与感悟。
            </p>
            <p className="warn">此操作不可恢复；书架记录不受影响。</p>
            <div className="foot">
              <button type="button" className="btn" onClick={() => setShowClear(false)}>
                返回
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setShowClear(false);
                  onClearBook();
                }}
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
