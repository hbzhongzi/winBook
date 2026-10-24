import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { main } from "../../wailsjs/go/models";
import type { ReaderMode, Settings } from "../utils/settings";
import type { LibraryEntry, PositionReport, ReadingPosition } from "../utils/library";
import { entryCategory, formatRelativeTime, progressLabel } from "../utils/library";
import { ALL_TAB, UNCLASSIFIED, allCategories, visibleCategories } from "../utils/categories";
import TextViewer from "./TextViewer";
import PdfViewer from "./PdfViewer";
import EpubViewer from "./EpubViewer";

type Props = {
  book: main.BookData | null;
  openCount: number;
  settings: Settings;
  /** 阅读模式（scroll=纵向滚动 / page=横向翻页），驱动 Viewer 呈现与重挂载 */
  readerMode: ReaderMode;
  /** 书架条目（欢迎页「继续阅读」区） */
  entries: LibraryEntry[];
  /** v0.2.8：用户自定义分类名清单（预设分类由 categories.ts 提供） */
  customCats: string[];
  /** v0.2.8：当前选中的页签（ALL_TAB 或分类名） */
  currentCat: string;
  onCategoryChange: (cat: string) => void;
  /** 把图书归入分类；cat 为空串表示「未分类」 */
  onAssignCategory: (path: string, cat: string) => void;
  /** 新建自定义分类；返回失败原因供就地提示 */
  onCreateCategory: (name: string) => { ok: boolean; reason?: string };
  /** 本次打开要恢复的位置（一次性，格式不匹配时丢弃） */
  resume: ReadingPosition | null;
  onDetail: (detail: string) => void;
  /** Viewer 初始渲染（含位置恢复）完成：App 淡出加载遮罩 */
  onReady?: () => void;
  /**
   * 同步取位置注册位：App 在退出/切书 flush 时实时取 Viewer 当前位置
   * （不依赖 debounce 缓存；Viewer 挂载时注册、卸载时置回 null）。
   */
  getterRef?: MutableRefObject<(() => PositionReport | null) | null>;
  onOpenPath: (path: string) => void;
  onRemoveEntry: (path: string) => void;
  /** v0.2.8：打开书架管理对话框（自选清除 / 二次确认），取代原直接清空 */
  onOpenManager: () => void;
};

const formatLabel: Record<string, string> = { epub: "EPUB", pdf: "PDF", txt: "TXT" };

/** 状态栏/详情的渲染模式标签（三格式 × 两模式） */
function renderModeLabel(format: string, mode: ReaderMode): string {
  if (mode === "page") {
    if (format === "epub") return "横向翻页（分页）";
    if (format === "pdf") return "单页翻页";
    return "文本翻页";
  }
  if (format === "pdf") return "连续滚动";
  return "纵向滚动";
}

export default function BookViewer({
  book,
  openCount,
  settings,
  readerMode,
  entries,
  customCats,
  currentCat,
  onCategoryChange,
  onAssignCategory,
  onCreateCategory,
  resume,
  onDetail,
  getterRef,
  onReady,
  onOpenPath,
  onRemoveEntry,
  onOpenManager,
}: Props) {
  // ===== v0.2.8 分类交互状态 =====
  // 卡片分类标签菜单：menuPath 为打开菜单的图书 path；newCatFor 为「就地新建分类」态
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [newCatFor, setNewCatFor] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [menuError, setMenuError] = useState<string | null>(null);
  // 分类行「＋ 新建分类」就地输入
  const [addingCat, setAddingCat] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  // 分类行提示位（新建/归类后的临时反馈，2.6s 还原）
  const [catHint, setCatHint] = useState<string | null>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const tabInputRef = useRef<HTMLInputElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashHint = useCallback((msg: string) => {
    setCatHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setCatHint(null), 2600);
  }, []);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  // 菜单外点击关闭（点标签自身由按钮 onClick 负责开合）
  useEffect(() => {
    if (!menuPath) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest(".cat-menu") || t?.closest(".cat-tag")) return;
      setMenuPath(null);
      setNewCatFor(null);
      setMenuError(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuPath]);

  useEffect(() => {
    if (newCatFor) menuInputRef.current?.focus();
  }, [newCatFor]);
  useEffect(() => {
    if (addingCat) tabInputRef.current?.focus();
  }, [addingCat]);

  const closeMenu = useCallback(() => {
    setMenuPath(null);
    setNewCatFor(null);
    setNewCatName("");
    setMenuError(null);
  }, []);

  const submitMenuNewCat = useCallback(
    (path: string) => {
      const name = newCatName.trim();
      if (!name) return;
      const res = onCreateCategory(name);
      if (!res.ok) {
        setMenuError(res.reason ?? "创建失败");
        return;
      }
      onAssignCategory(path, name);
      closeMenu();
      flashHint(`已创建「${name}」并移入该分类`);
    },
    [newCatName, onCreateCategory, onAssignCategory, closeMenu, flashHint]
  );

  const submitTabNewCat = useCallback(() => {
    const name = newTabName.trim();
    if (!name) {
      setAddingCat(false);
      return;
    }
    const res = onCreateCategory(name);
    if (!res.ok) {
      flashHint(res.reason ?? "创建失败");
      return;
    }
    setAddingCat(false);
    setNewTabName("");
    flashHint(`已创建分类「${name}」（有图书后显示页签）`);
  }, [newTabName, onCreateCategory, flashHint]);

  // 内容淡入：每次换书重置，Viewer 初始渲染完成后置 true（过渡动画，见 styles.css）
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
  }, [book?.path, openCount]);
  const handleReady = useCallback(() => {
    setReady(true);
    onReady?.();
  }, [onReady]);
  if (!book) {
    // v0.2.8：页签（空分类不显示）与当前页签下的可见条目
    const tabs = visibleCategories(entries, customCats);
    const visible =
      currentCat === ALL_TAB ? entries : entries.filter((e) => entryCategory(e) === currentCat);
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
            {/* 书架（继续阅读）：为空时整区隐藏 */}
            {entries.length > 0 && (
              <section className="shelf" aria-label="书架">
                <div className="shelf-head">
                  <span className="shelf-title">继续阅读</span>
                  <span className="shelf-count">{entries.length} 条记录</span>
                  <button type="button" className="shelf-clear" onClick={onOpenManager}>
                    清空
                  </button>
                </div>

                {/* v0.2.8 分类页签行：空分类不显示（F30），「全部」恒显示 */}
                <div className="cat-row">
                  <button
                    type="button"
                    className={"cat-chip" + (currentCat === ALL_TAB ? " active" : "")}
                    onClick={() => onCategoryChange(ALL_TAB)}
                  >
                    全部 <span className="n">{entries.length}</span>
                  </button>
                  {tabs.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={"cat-chip" + (currentCat === c.name ? " active" : "")}
                      onClick={() => onCategoryChange(c.name)}
                    >
                      {c.name} <span className="n">{c.count}</span>
                    </button>
                  ))}
                  {addingCat ? (
                    <input
                      ref={tabInputRef}
                      className="cat-input"
                      value={newTabName}
                      placeholder="分类名，回车创建"
                      onChange={(e) => setNewTabName(e.target.value)}
                      onBlur={submitTabNewCat}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitTabNewCat();
                        }
                        if (e.key === "Escape") {
                          setAddingCat(false);
                          setNewTabName("");
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="cat-add"
                      onClick={() => setAddingCat(true)}
                    >
                      ＋ 新建分类
                    </button>
                  )}
                  <span className="cat-hint">
                    {catHint ?? "空分类自动隐藏 · 点击卡片左下角标签可归类"}
                  </span>
                </div>

                <div className="shelf-grid">
                  {visible.map((entry) => {
                    const pct = Math.round(Math.min(1, Math.max(0, entry.progress)) * 100);
                    const label = formatLabel[entry.format] ?? entry.format.toUpperCase();
                    const cat = entryCategory(entry);
                    const menuOpen = menuPath === entry.path;
                    return (
                      <div
                        key={entry.path}
                        className="shelf-card"
                        role="button"
                        tabIndex={0}
                        title={entry.path}
                        onClick={() => onOpenPath(entry.path)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenPath(entry.path);
                          }
                        }}
                      >
                        <span className={"shelf-cover c-" + entry.format}>
                          {entry.name.slice(0, 1)}
                        </span>
                        <span className="shelf-body">
                          <span className="shelf-name">{entry.name}</span>
                          <span className="shelf-meta">
                            <span className={"badge badge-" + entry.format}>{label}</span>
                            <span className="shelf-time">
                              {formatRelativeTime(entry.lastOpen)}
                            </span>
                          </span>
                          <span className="shelf-progress">
                            <span className="shelf-bar">
                              <i style={{ width: pct + "%" }} />
                            </span>
                            {progressLabel(entry)}
                          </span>
                        </span>
                        <span
                          className="shelf-remove"
                          role="button"
                          tabIndex={0}
                          aria-label={"移除 " + entry.name + " 的记录"}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveEntry(entry.path);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onRemoveEntry(entry.path);
                            }
                          }}
                        >
                          &#10005;
                        </span>

                        {/* v0.2.8 分类标签：点击打开「移至分类」菜单 */}
                        <button
                          type="button"
                          className="cat-tag"
                          aria-label={"修改《" + entry.name + "》的分类"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuError(null);
                            setNewCatFor(null);
                            setNewCatName("");
                            setMenuPath(menuOpen ? null : entry.path);
                          }}
                        >
                          {cat} ▾
                        </button>

                        {menuOpen && (
                          <div
                            className="cat-menu"
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {newCatFor === entry.path ? (
                              <>
                                <div className="menu-title">新分类名称（回车创建并移入）</div>
                                <input
                                  ref={menuInputRef}
                                  value={newCatName}
                                  placeholder="如：哲学、外刊…"
                                  onChange={(e) => setNewCatName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      submitMenuNewCat(entry.path);
                                    }
                                    if (e.key === "Escape") setNewCatFor(null);
                                  }}
                                />
                                {menuError && <div className="menu-error">{menuError}</div>}
                              </>
                            ) : (
                              <>
                                <div className="menu-title">移至分类</div>
                                {[UNCLASSIFIED, ...allCategories(customCats)].map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    role="menuitem"
                                    className={"menu-item" + (cat === c ? " current" : "")}
                                    onClick={() => {
                                      onAssignCategory(
                                        entry.path,
                                        c === UNCLASSIFIED ? "" : c
                                      );
                                      closeMenu();
                                      flashHint(`《${entry.name}》已移至「${c}」`);
                                    }}
                                  >
                                    <span className="ck">✓</span>
                                    {c}
                                  </button>
                                ))}
                                <div className="menu-sep" />
                                <button
                                  type="button"
                                  className="menu-item menu-new"
                                  onClick={() => {
                                    setNewCatFor(entry.path);
                                    setNewCatName("");
                                    setMenuError(null);
                                  }}
                                >
                                  ＋ 新建分类…
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="shelf-empty" hidden={visible.length > 0}>
                  {currentCat === ALL_TAB
                    ? "书架为空——打开过的图书会出现在这里，可随时继续阅读。"
                    : `「${currentCat}」分类下暂无图书。`}
                </div>
              </section>
            )}
          </section>
        </div>
      </main>
    );
  }

  // resume 按格式分流：记录的位置与当前格式不一致时丢弃（防御性，同 path 格式不会变）
  const fmtResume: ReadingPosition | null =
    resume && resume.kind === book.format ? resume : null;

  return (
    <main className="content">
      {/* key 变化时整体重挂载，确保旧 Viewer 执行 destroy / 渲染任务取消；
          openCount 保证重复打开同一文件（path+size 相同）也会重建 */}
      <div
        className={"state-host" + (ready ? " ready" : "")}
        key={book.path + ":" + book.size + ":" + openCount + ":" + readerMode}
      >
        {book.format === "txt" && (
          <TextViewer
            text={book.text ?? ""}
            mode={readerMode}
            resume={fmtResume}
            getterRef={getterRef}
            onReady={handleReady}
          />
        )}
        {book.format === "pdf" && (
          <PdfViewer
            dataBase64={book.dataBase64 ?? ""}
            mode={readerMode}
            initialPage={fmtResume?.kind === "pdf" ? fmtResume.page : undefined}
            getterRef={getterRef}
            onReady={handleReady}
          />
        )}
        {book.format === "epub" && (
          <EpubViewer
            dataBase64={book.dataBase64 ?? ""}
            settings={settings}
            mode={readerMode}
            resume={fmtResume}
            getterRef={getterRef}
            onReady={handleReady}
            onChapterChange={(title) =>
              onDetail(
                title
                  ? "渲染模式：" + renderModeLabel("epub", readerMode) + " · 当前：" + title
                  : ""
              )
            }
          />
        )}
      </div>
    </main>
  );
}
