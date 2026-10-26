import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  FONT_FAMILY_STACKS,
  FONT_MAX,
  FONT_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_STEP,
  MARGIN_MAX,
  MARGIN_MIN,
  MARGIN_STEP,
  PRELOAD_MAX,
  PRELOAD_MIN,
  type Settings,
  type ThemeName,
} from "../utils/settings";
import {
  FIT_LABELS,
  PDF_FITS,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PDF_ZOOM_STEP,
} from "../utils/pdfScale";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  HOTKEY_ACTION_LABELS,
  MAX_KEYS_PER_ACTION,
  cloneHotkeyMap,
  hotkeyKeyLabel,
  normalizeHotkeyKey,
  type HotkeyAction,
} from "../utils/readerHotkeys";
import { subscribeLibrary, type LibraryEntry } from "../utils/library";

type Props = {
  settings: Settings;
  /**
   * v0.2.8（D60）：打开书架管理对话框（自选清除 + 清空二次确认）。
   * 取代原面板内二态确认清空——对话框已提供更强确认。
   */
  onOpenManager: () => void;
  onChange: (s: Settings) => void;
  onClose: () => void;
};

type Pane = "reading" | "appearance" | "hotkeys" | "advanced";

const THEME_CARDS: { value: ThemeName; name: string; mini: string }[] = [
  { value: "light", name: "浅色", mini: "mini-light" },
  { value: "dark", name: "深色", mini: "mini-dark" },
  { value: "eye", name: "护眼", mini: "mini-eye" },
  { value: "sepia", name: "羊皮纸", mini: "mini-sepia" },
];

const PRELOAD_PRESETS = [0, 1, 2, 3, 5];
const PRESET_LABELS: Record<number, string> = {
  0: "省内存",
  1: "均衡",
  2: "默认",
  3: "顺滑",
  5: "极速",
};

/** 章节窗口预览图：窗口外 · 向前 N · 当前 · 向后 N · 窗口外 */
function WindowPreview({ count }: { count: number }) {
  return (
    <div className="win-preview" aria-hidden="true">
      <div className="wp-block wp-out">窗口外</div>
      {count > 0 && (
        <div className="wp-group">
          <span className="wp-group-label">向前 {count} 章</span>
          <div className="wp-row">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="wp-block wp-pre">预加载</div>
            ))}
          </div>
        </div>
      )}
      <div className="wp-block wp-cur">当前章节</div>
      {count > 0 && (
        <div className="wp-group">
          <span className="wp-group-label">向后 {count} 章</span>
          <div className="wp-row">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="wp-block wp-pre">预加载</div>
            ))}
          </div>
        </div>
      )}
      <div className="wp-block wp-out">窗口外</div>
    </div>
  );
}

const NAV_ITEMS: { pane: Pane; label: string; icon: ReactNode }[] = [
  {
    pane: "reading",
    label: "阅读体验",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    pane: "appearance",
    label: "界面外观",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="13.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="17.5" cy="10.5" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="8.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="6.5" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.103-.297-.297-.438-.652-.438-1.097a1.688 1.688 0 0 1 1.688-1.688h1.999c3.191 0 5.8-2.609 5.8-5.8C22.262 5.761 17.716 2 12 2z" />
      </svg>
    ),
  },
  {
    pane: "hotkeys",
    label: "快捷键",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
      </svg>
    ),
  },
  {
    pane: "advanced",
    label: "高级",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6L6 18M18 6l1.6-1.6" />
      </svg>
    ),
  },
];

export default function SettingsPanel({ settings, onOpenManager, onChange, onClose }: Props) {
  // 草稿态：所有控件只改草稿，保存才落库；取消/Esc/遮罩不落库
  const [draft, setDraft] = useState<Settings>(settings);
  const [pane, setPane] = useState<Pane>("reading");
  const [savedFlash, setSavedFlash] = useState(false);
  // 书架：面板内自订阅（落地文档 5.9，避免 prop 层层传递）
  const [shelfCount, setShelfCount] = useState(0);
  // 快捷键录制（v0.2.5 F24）：非 null 时正在为某动作捕获按键
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [hkConflict, setHkConflict] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦点移入对话框：否则 Tab 会从主页面的齿轮继续向后走（跑进阅读器），
  // 键盘操作落在弹窗外的元素上
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => subscribeLibrary((entries: LibraryEntry[]) => setShelfCount(entries.length)), []);

  // 与全局设置保持同步：工具栏即时切换 / 其他实例改动后，面板草稿跟随更新
  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const patch = (p: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSavedFlash(false);
  };

  // 快捷键录制（v0.2.5 F24）：capture 阶段拦截，先于 App 的 window 冒泡派发与
  // 面板 Esc 关闭；Esc 取消录制；纯修饰键/组合键忽略（继续录）；Tab 保留给焦点导航。
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab") return;
      const key = normalizeHotkeyKey(e.key);
      if (!key) return; // 纯修饰键：忽略，继续录制
      const owner = HOTKEY_ACTIONS.find((a) => a !== recording && draft.hotkeys[a]?.includes(key));
      if (owner) {
        setHkConflict("该键已被「" + HOTKEY_ACTION_LABELS[owner] + "」占用");
        return;
      }
      const cur = draft.hotkeys[recording] ?? [];
      if (cur.includes(key)) {
        setHkConflict("该键已绑定到当前动作");
        return;
      }
      if (cur.length >= MAX_KEYS_PER_ACTION) {
        setHkConflict("每个动作最多绑定 " + MAX_KEYS_PER_ACTION + " 个键");
        return;
      }
      patch({ hotkeys: { ...draft.hotkeys, [recording]: [...cur, key] } });
      setHkConflict(null);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, draft.hotkeys]);

  // 移除单个键位：至少保留一个（防动作变砖；normalize 层对空动作亦有默认兜底）
  const removeHotkey = (action: HotkeyAction, key: string) => {
    const cur = draft.hotkeys[action] ?? [];
    if (cur.length <= 1) return;
    patch({ hotkeys: { ...draft.hotkeys, [action]: cur.filter((k) => k !== key) } });
  };

  // 恢复默认键位（草稿态，保存后生效）
  const resetHotkeys = () => {
    patch({ hotkeys: cloneHotkeyMap(DEFAULT_HOTKEYS) });
    setHkConflict(null);
  };

  const flashSaved = () => {
    setSavedFlash(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1800);
  };

  const commit = () => {
    onChange(draft);
    flashSaved();
  };

  const resetDraft = () => {
    setDraft({ ...DEFAULT_SETTINGS });
    setSavedFlash(false);
  };

  // 书架清空（v0.2.8 D60）：打开管理对话框，由用户在其中自选清除或走二次确认。
  // 实际清空发生在对话框内，App 的条目订阅会自动刷新此处计数。
  const onClearShelfClick = () => {
    onOpenManager();
  };

  const preload = draft.epubPreloadCount;
  const total = preload * 2 + 1;

  return (
    <div
      className="modal-mask"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal settings-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header className="settings-head">
          <h2 className="modal-title">设置</h2>
          <span className="settings-version">BookEditor v0.1.0</span>
          <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置">
            &#10005;
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.pane}
                type="button"
                className={"settings-nav-item" + (pane === item.pane ? " active" : "")}
                onClick={() => setPane(item.pane)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <div className="settings-nav-foot">设置保存在本机<br />不会上传任何数据</div>
          </nav>

          <div className="settings-panes">
            {/* ===== 阅读体验 ===== */}
            {pane === "reading" && (
              <section className="settings-pane active" aria-label="阅读体验">
                <h3 className="pane-title">阅读</h3>
                <div className="set-card">
                  <div className="set-card-head">
                    <div>
                      <h3>章节预加载</h3>
                      <p className="set-desc">当前章节前后各自预先加载的章节数量。数值越大，翻页越顺滑，但同时驻留内存的章节越多。</p>
                    </div>
                    <span className="set-value-badge">{preload} 章</span>
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => patch({ epubPreloadCount: preload - 1 })}
                      disabled={preload <= PRELOAD_MIN}
                      aria-label="减少预加载章节数"
                    >
                      &#8722;
                    </button>
                    <span className="step-value">{preload}</span>
                    <button
                      type="button"
                      className="step-btn"
                      onClick={() => patch({ epubPreloadCount: preload + 1 })}
                      disabled={preload >= PRELOAD_MAX}
                      aria-label="增加预加载章节数"
                    >
                      +
                    </button>
                    <span className="step-unit">章</span>
                  </div>
                  <div className="chip-row">
                    {PRELOAD_PRESETS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={"chip" + (preload === v ? " active" : "")}
                        onClick={() => patch({ epubPreloadCount: v })}
                      >
                        {v} · {PRESET_LABELS[v]}
                      </button>
                    ))}
                  </div>
                  <WindowPreview count={preload} />
                  <p className="set-note">
                    {preload === 0
                      ? "仅驻留当前章节：内存占用最低，向后翻页时会有一次短暂加载。"
                      : `约同时存在 ${total} 个章节 · 预计内存占用 ${total * 6} MB 左右（按每章约 6 MB 估算）。`}
                  </p>
                </div>
                <div className="set-card">
                  <div className="set-card-head">
                    <div>
                      <h3>阅读模式</h3>
                      <p className="set-desc">选择正文呈现方式：纵向滚动（整页流式推进）或横向翻页（逐页/分页）。翻页模式下 EPUB 记录为章节级、PDF/TXT 按页恢复。</p>
                    </div>
                  </div>
                  <div className="mode-seg mode-seg-block" role="group" aria-label="阅读模式">
                    <button
                      type="button"
                      className={"mode-opt" + (draft.readerMode === "scroll" ? " active" : "")}
                      onClick={() => patch({ readerMode: "scroll" })}
                      aria-pressed={draft.readerMode === "scroll"}
                    >
                      纵向滚动
                    </button>
                    <button
                      type="button"
                      className={"mode-opt" + (draft.readerMode === "page" ? " active" : "")}
                      onClick={() => patch({ readerMode: "page" })}
                      aria-pressed={draft.readerMode === "page"}
                    >
                      横向翻页
                    </button>
                  </div>
                  <p className="set-note">修改后点击「保存」生效；也可在阅读中直接通过工具栏切换，立即生效。</p>
                </div>
                {/* ===== v0.2.9：PDF 适配三件套（与阅读器四处入口写同一状态）===== */}
                <div className="set-card">
                  <div className="set-card-head">
                    <div>
                      <h3>
                        PDF 适配方式 <span className="tag-roadmap">v0.2.9</span>
                      </h3>
                      <p className="set-desc">
                        默认「自适应」：按容器与页面宽高比，自动取适宽 / 适高中倍率更大者。适宽字号最大但需页内纵向滚动；适高 / 双页整页可见，适合看图与版式。
                      </p>
                    </div>
                  </div>
                  <div className="mode-seg mode-seg-block" role="group" aria-label="PDF 适配方式">
                    {PDF_FITS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={"mode-opt" + (draft.pdfFit === f ? " active" : "")}
                        onClick={() => patch({ pdfFit: f })}
                        aria-pressed={draft.pdfFit === f}
                      >
                        {FIT_LABELS[f]}
                      </button>
                    ))}
                  </div>
                  <div className={"set-card-row" + (draft.pdfFit !== "custom" ? " row-off" : "")}>
                    <span className="set-row-label">
                      自定义倍率
                      <span className="set-sub">50%–400%，仅「自定义」时生效；从其它方式切过来时继承当前倍率</span>
                    </span>
                    <span className="zoom-set">
                      <input
                        type="range"
                        className="zoom-range"
                        min={PDF_ZOOM_MIN}
                        max={PDF_ZOOM_MAX}
                        step={PDF_ZOOM_STEP}
                        value={draft.pdfZoom}
                        disabled={draft.pdfFit !== "custom"}
                        onChange={(e) => patch({ pdfFit: "custom", pdfZoom: Number(e.target.value) })}
                        aria-label="PDF 自定义倍率"
                      />
                      <span className="zoom-num">{draft.pdfZoom}%</span>
                    </span>
                  </div>
                  <div className="set-card-row">
                    <span className="set-row-label">
                      高清渲染
                      <span className="set-sub">按显示器 DPI 渲染位图（devicePixelRatio，上限 2）；关闭后按 CSS 像素渲染，放大时边缘发虚、更省内存</span>
                    </span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={draft.pdfDpr}
                        onChange={(e) => patch({ pdfDpr: e.target.checked })}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>
                  <p className="set-note">
                    四个入口写同一状态并持久化：控制条 chip 档位菜单、工具栏「－ ＋」、阅读区 Ctrl+滚轮、本面板。修改后点击「保存」生效。
                  </p>
                </div>
                <div className="set-card set-card-teased">
                  <div className="set-card-head">
                    <div>
                      <h3>
                        阅读位置记忆 <span className="tag-roadmap">v0.2</span>
                      </h3>
                      <p className="set-desc">自动记录每本书的阅读位置，再次打开时恢复到上次读到的章节。</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" disabled />
                      <span className="switch-slider" />
                    </label>
                  </div>
                </div>
              </section>
            )}

            {/* ===== 界面外观 ===== */}
            {pane === "appearance" && (
              <section className="settings-pane active" aria-label="界面外观">
                <h3 className="pane-title">阅读主题</h3>
                <div className="theme-grid">
                  {THEME_CARDS.map((card) => (
                    <button
                      key={card.value}
                      type="button"
                      className={"theme-card" + (draft.theme === card.value ? " active" : "")}
                      onClick={() => patch({ theme: card.value })}
                      aria-label={"主题：" + card.name}
                    >
                      <span className="check">&#10003;</span>
                      <span className={"theme-mini " + card.mini}>
                        <i className="t" />
                        <i className="l1" />
                        <i className="l2" />
                        <i className="l3" />
                      </span>
                      <span className="theme-name">{card.name}</span>
                    </button>
                  ))}
                </div>
                <p className="set-note">主题对 EPUB / TXT 正文立即生效；PDF 仅影响页面外围背景。</p>

                <h3 className="pane-title">强调色</h3>
                <div className="set-card">
                  <div className="swatch-row">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        className={"swatch" + (draft.accent === a.value ? " active" : "")}
                        style={{ background: a.value, color: a.value }}
                        onClick={() => patch({ accent: a.value })}
                        aria-label={"强调色：" + a.name}
                      />
                    ))}
                  </div>
                  <p className="set-note">强调色用于按钮、目录高亮与选中状态，保存后整个界面立即跟随。</p>
                </div>

                <h3 className="pane-title">正文字号</h3>
                <div className="set-card">
                  <div className="font-row">
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>A</span>
                    <input
                      type="range"
                      min={FONT_MIN}
                      max={FONT_MAX}
                      step={1}
                      value={draft.fontSize}
                      onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                      aria-label="正文字号"
                    />
                    <span style={{ fontSize: 16, color: "var(--text-2)" }}>A</span>
                    <span className="font-value">{draft.fontSize} px</span>
                  </div>
                  <div className="font-preview" style={{ fontSize: draft.fontSize }}>
                    列车进站的时候，雾还没有散尽。站台像一张被哈气糊住的玻璃，所有的轮廓都在，只是边缘发软。
                  </div>
                  <p className="set-note">对 EPUB / TXT 正文生效；PDF 使用文档自身字号，可通过缩放调整。</p>
                </div>

                <h3 className="pane-title">行距</h3>
                <div className="set-card">
                  <div className="font-row">
                    <span style={{ fontSize: 12, color: "var(--text-2)" }} aria-hidden="true">≡</span>
                    <input
                      type="range"
                      min={LINE_HEIGHT_MIN}
                      max={LINE_HEIGHT_MAX}
                      step={LINE_HEIGHT_STEP}
                      value={draft.lineHeight}
                      onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
                      aria-label="行距"
                    />
                    <span className="font-value">{draft.lineHeight.toFixed(2)}</span>
                  </div>
                  <div
                    className="font-preview"
                    style={{ fontSize: draft.fontSize, lineHeight: draft.lineHeight }}
                  >
                    列车进站的时候，雾还没有散尽。站台像一张被哈气糊住的玻璃，所有的轮廓都在，只是边缘发软。
                  </div>
                  <p className="set-note">行距越大越省力；TXT 翻页总页数随行距自动重算，阅读位置不丢失。</p>
                </div>

                <h3 className="pane-title">正文字体</h3>
                <div className="set-card">
                  <div className="mode-seg-block">
                    {FONT_FAMILIES.map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={"mode-opt" + (draft.fontFamily === f ? " active" : "")}
                        style={{ fontFamily: FONT_FAMILY_STACKS[f] }}
                        onClick={() => patch({ fontFamily: f })}
                      >
                        {FONT_FAMILY_LABELS[f]}
                      </button>
                    ))}
                  </div>
                  <p className="set-note">对 EPUB / TXT 正文生效；「系统」为默认字体，宋体 / 楷体在未安装的字体环境会回落相似字体。</p>
                </div>

                <h3 className="pane-title">正文页边距</h3>
                <div className="set-card">
                  <div className="font-row">
                    <input
                      type="range"
                      min={MARGIN_MIN}
                      max={MARGIN_MAX}
                      step={MARGIN_STEP}
                      value={draft.contentMargin}
                      onChange={(e) => patch({ contentMargin: Number(e.target.value) })}
                      aria-label="正文页边距"
                    />
                    <span className="font-value">{draft.contentMargin} px</span>
                  </div>
                  <div
                    className="font-preview"
                    style={{
                      fontSize: draft.fontSize,
                      lineHeight: draft.lineHeight,
                      paddingLeft: draft.contentMargin,
                      paddingRight: draft.contentMargin,
                    }}
                  >
                    宽屏阅读时增大页边距可缩短单行长度，减轻扫读负担。
                  </div>
                  <p className="set-note">作用于 EPUB / TXT 正文两侧；PDF 不受影响。</p>
                </div>
              </section>
            )}

            {/* ===== 快捷键 ===== */}
            {pane === "hotkeys" && (
              <section className="settings-pane active" aria-label="快捷键">
                <h3 className="pane-title">阅读</h3>
                <div className="set-card">
                  <div className="set-card-head">
                    <div>
                      <h3>阅读快捷键</h3>
                      <p className="set-desc">
                        自定义翻页与滚动快捷键。点击「+ 绑定」后按下任意按键即可；同一按键不能绑定到多个动作。
                      </p>
                    </div>
                    <button type="button" className="btn" onClick={resetHotkeys}>
                      恢复默认
                    </button>
                  </div>
                  {HOTKEY_ACTIONS.map((action) => (
                    <div className="hk-row" key={action}>
                      <span className="hk-action">{HOTKEY_ACTION_LABELS[action]}</span>
                      <div className="hk-keys">
                        {(draft.hotkeys[action] ?? []).map((k) => (
                          <span className="hk-chip" key={k}>
                            {hotkeyKeyLabel(k)}
                            <button
                              type="button"
                              className="hk-chip-x"
                              aria-label={"移除 " + hotkeyKeyLabel(k)}
                              disabled={(draft.hotkeys[action] ?? []).length <= 1}
                              onClick={() => removeHotkey(action, k)}
                            >
                              &#10005;
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          className={"hk-bind" + (recording === action ? " recording" : "")}
                          onClick={() => {
                            setHkConflict(null);
                            setRecording(recording === action ? null : action);
                          }}
                        >
                          {recording === action ? "请按下按键…" : "+ 绑定"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {hkConflict && <p className="hk-conflict">{hkConflict}</p>}
                  <p className="set-note">
                    修改后点击「保存」生效；保存后阅读中立即可用新键位，无需重开图书。录制中按 Esc 取消。
                  </p>
                </div>
              </section>
            )}

            {/* ===== 高级 ===== */}
            {pane === "advanced" && (
              <section className="settings-pane active" aria-label="高级">
                <h3 className="pane-title">通用</h3>
                <div className="set-card">
                  <div className="adv-row">
                    <span className="k">恢复默认设置</span>
                    <button type="button" className="btn-danger" onClick={resetDraft}>
                      重置
                    </button>
                  </div>
                  <div className="adv-row">
                    <span className="k">书架记录</span>
                    <span className="v">{shelfCount} 条 · 本机 localStorage</span>
                    <button type="button" className="btn-danger" onClick={onClearShelfClick}>
                      清空
                    </button>
                  </div>
                  <div className="adv-row">
                    <span className="k">版本</span>
                    <span className="v">BookEditor v0.1.0</span>
                  </div>
                  <div className="adv-row">
                    <span className="k">设置存储</span>
                    <span className="v">本机 localStorage（bookeditor.settings.v4）</span>
                  </div>
                  <div className="adv-row">
                    <span className="k">书架存储</span>
                    <span className="v">本机 localStorage（bookeditor.library.v1）</span>
                  </div>
                  <div className="adv-row">
                    <span className="k">数据收集</span>
                    <span className="v">无 · 所有数据仅保存在本机</span>
                  </div>
                </div>
                <p className="set-note">「重置」只把面板恢复为默认值，点击「保存」后才会写入并生效；「清空」打开书架管理对话框，可勾选部分记录移除或清空全部（需二次确认），不影响图书文件本身。</p>
              </section>
            )}
          </div>
        </div>

        <footer className="settings-foot">
          <span className={"settings-hint" + (savedFlash ? " saved" : "")}>
            {savedFlash ? "已保存 ✓" : "修改后点击「保存」生效，取消则维持原设置"}
          </span>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={commit}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
