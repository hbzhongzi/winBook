import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpenBook, OpenBookPath, SupportedExts } from "../wailsjs/go/main/App";
import { WindowSetTitle, EventsEmit, EventsOn, OnFileDrop, OnFileDropOff } from "../wailsjs/runtime/runtime";
import type { main } from "../wailsjs/go/models";
import Toolbar from "./components/Toolbar";
import ErrorBar from "./components/ErrorBar";
import BookViewer from "./components/BookViewer";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import ShelfManager from "./components/ShelfManager";
import MarksPanel, { type TocContext } from "./components/MarksPanel";
import MarkNoteEditor from "./components/MarkNoteEditor";
import type { MarksContext, AddMarkInput } from "./components/marksContext";
import { toAppError, type AppError } from "./utils/appError";
import { epubDiag } from "./utils/epubDiag";
import {
  addCategory,
  loadCustomCategories,
  subscribeCategories,
  ALL_TAB,
} from "./utils/categories";
import { loadSettings, saveSettings, subscribeSettings, type ReaderMode, type Settings } from "./utils/settings";
import {
  FIT_LABELS,
  migratePdfFit,
  nudgeZoom,
  type PdfColumns,
  type PdfFit,
  type PdfViewHandlers,
} from "./utils/pdfScale";
import { resolveHotkeyAction } from "./utils/readerHotkeys";
import { dispatchReaderCommand, notifyPagerActivity } from "./utils/readerCommands";
import { applyAppTheme } from "./utils/readingTheme";
import { isSupportedExt, extOf } from "./utils/dropOpen";
import {
  listEntries,
  getEntry,
  savePosition,
  reportPosition,
  removeEntry,
  removeEntries,
  setEntryCategory,
  entryCategory,
  clearLibrary,
  subscribeLibrary,
  type LibraryEntry,
  type PositionReport,
  type ReadingPosition,
} from "./utils/library";
import {
  loadMarks,
  addMark,
  updateMark,
  removeMark,
  clearBookMarks,
  clearAllMarks,
  subscribeMarks,
  type Mark,
  type MarkColor,
  type MarkLocator,
  type PdfStroke,
} from "./utils/marks";

type Book = main.BookData;

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState("");
  // 每次成功打开自增：重复打开同一文件（path+size 相同）时也能强制重建 Viewer
  const [openCount, setOpenCount] = useState(0);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  // 书架（v0.2.1）：最近阅读记录；resume 一次性传给 Viewer，恢复后即弃
  const [entries, setEntries] = useState<LibraryEntry[]>(listEntries);
  // v0.2.8：用户自定义分类清单 + 当前分类页签 + 管理对话框开关
  const [customCats, setCustomCats] = useState<string[]>(loadCustomCategories);
  const [currentCat, setCurrentCat] = useState<string>(ALL_TAB);
  const [showShelfManager, setShowShelfManager] = useState(false);
  const [resume, setResume] = useState<ReadingPosition | null>(null);
  // 切换阅读模式时的瞬态恢复位：改模式前经 getter 取实时位置，重挂载后优先恢复
  // （M8 位置保护；恢复完成即清空，避免污染后续打开）。
  const [transientResume, setTransientResume] = useState<ReadingPosition | null>(null);
  // 当前书路径：getter 取到位置时补 path 用（getter 只回位置不带 path）
  const bookPathRef = useRef<string | null>(null);
  // 同步取位置注册位：Viewer 挂载时注册（离场节点 flush 实时取）
  const positionGetterRef = useRef<(() => PositionReport | null) | null>(null);
  // v0.2.9：PDF 实际缩放上报（工具栏数值 / 状态栏文案 / 倍率微调基点同一真相）
  const [pdfScale, setPdfScale] = useState<{ pct: number; fit: PdfFit } | null>(null);

  // ===== v0.3.0 标记记录 =====
  // 全量标记（App 单一事实源；按 bookPath 过滤后交给 Viewer/面板）。
  // 订阅覆盖同页写入与多实例 storage 事件（与 settings/library 一致）。
  const [marks, setMarks] = useState<Mark[]>(() => loadMarks());
  // 面板开关（工具栏按钮 / Ctrl+M / Esc 由面板自理）
  const [showMarks, setShowMarks] = useState(false);
  // D96：EPUB 目录树路径（由 EpubViewer 回传），供标记面板按章节组织分组。
  // 仅当前书为 EPUB 时有值；切书/关闭时由 BookViewer 卸载清空。
  const [tocCtx, setTocCtx] = useState<TocContext | null>(null);
  // 跳转目标：面板点条目置入；nonce 防同一条目重复触发
  const [markJump, setMarkJump] = useState<{ mark: Mark; nonce: number } | null>(null);
  // 感悟编辑器：new = 新建（划词/写想法，locator 由调用方给出）；
  // edit = 编辑既有条目（回显 note/color）
  const [noteEdit, setNoteEdit] = useState<
    | { mode: "new"; quote: string; idea?: boolean; locator: MarkLocator }
    | { mode: "edit"; mark: Mark }
    | null
  >(null);
  // 标记操作轻提示（复用 .app-toast，2.6s 自动消失）
  const [markToast, setMarkToast] = useState<string | null>(null);
  const markToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markNonceRef = useRef(0);

  // ===== 过渡动画状态（v0.2.1）=====
  // busy：打开/恢复位置的加载遮罩（leaving = 淡出中，220ms 后卸载）
  const [busy, setBusy] = useState<{ text: string; leaving: boolean } | null>(null);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // exitSaving：退出前 flush 的轻提示（Go 侧 OnBeforeClose 拦截期间可见）
  const [exitSaving, setExitSaving] = useState(false);
  // savedFlash：位置落库后的状态栏闪烁反馈（点书架时可见）
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // dropHint：拖放相关轻提示（如「仅打开第一个，其余已忽略」），复用 .app-toast 样式
  const [dropHint, setDropHint] = useState<string | null>(null);
  const dropHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideBusy = useCallback(() => {
    setBusy((b) => (b ? { ...b, leaving: true } : b));
    if (busyTimer.current) clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(() => setBusy(null), 220);
  }, []);

  // 位置落库反馈：状态栏「进度已保存」闪烁 1.5s（连续触发只重置计时）
  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  // 拖放轻提示：复用 .app-toast，2.6s 自动消失（连续触发只重置计时）
  const showDropHint = useCallback((msg: string) => {
    setDropHint(msg);
    if (dropHintTimer.current) clearTimeout(dropHintTimer.current);
    dropHintTimer.current = setTimeout(() => setDropHint(null), 2600);
  }, []);

  // 多窗口/多实例场景下设置需保持一致：其他实例改动也能同步到本页
  useEffect(() => subscribeSettings(setSettings), []);

  // 书架订阅：同页写入与其他实例 storage 事件都经此刷新（落地文档 5.1）
  useEffect(() => subscribeLibrary(setEntries), []);
  // v0.2.8：自定义分类订阅（新建/删除后页签与菜单即时刷新）
  useEffect(() => subscribeCategories(setCustomCats), []);
  // 当前页签失效时回到「全部」：该分类最后一本书被移出/移除后页签会消失
  useEffect(() => {
    if (currentCat === ALL_TAB) return;
    if (!entries.some((e) => entryCategory(e) === currentCat)) setCurrentCat(ALL_TAB);
  }, [entries, currentCat]);

  // v0.3.0：标记订阅（同页写入与其他实例 storage 事件都经此刷新）
  useEffect(() => subscribeMarks(setMarks), []);

  // 标记轻提示：复用 .app-toast，2.6s 自动消失（连续触发只重置计时）
  const showMarkToast = useCallback((msg: string) => {
    setMarkToast(msg);
    if (markToastTimer.current) clearTimeout(markToastTimer.current);
    markToastTimer.current = setTimeout(() => setMarkToast(null), 2600);
  }, []);

  // 复制到剪贴板：失败（权限/非安全上下文）时如实提示，不静默
  const copyToClipboard = useCallback(
    (text: string): Promise<void> =>
      navigator.clipboard
        ? navigator.clipboard.writeText(text).then(
            () => undefined,
            () => {
              throw new Error("clipboard");
            }
          )
        : Promise.reject(new Error("clipboard")),
    []
  );

  // 主题/强调色/字号挂载到 documentElement：theme 走 data-theme 分支，
  // accent 与字号走 inline CSS 变量（与主题正交，深色分支不定义 --accent）
  useEffect(() => {
    applyAppTheme(settings);
  }, [settings]);

  // ===== 阅读快捷键派发（v0.2.5 F22/F24）=====
  // window 级单一事实源：焦点在正文区外、刚打开未点击均可翻页；
  // EPUB 翻页模式焦点在 iframe 内文档时，按键经 EpubViewer 注入的转发器
  // postMessage 到这里（iframe 事件不跨 frame 冒泡）。
  // 豁免：修饰键组合（保留 Ctrl+A/C 选区/复制）、输入类目标（设置面板/未来搜索框）、
  // 设置面板打开、无书（欢迎页）。键位读 settings.hotkeys 实时值，自定义保存即时生效。
  const settingsMirrorRef = useRef(settings);
  settingsMirrorRef.current = settings;
  const bookMirrorRef = useRef<Book | null>(book);
  bookMirrorRef.current = book;
  const showSettingsRef = useRef(showSettings);
  showSettingsRef.current = showSettings;
  // v0.3.0：Ctrl+M 门控镜像（effect 单次注册，需读实时值）
  const noteEditMirrorRef = useRef(noteEdit);
  noteEditMirrorRef.current = noteEdit;
  const showShelfManagerRef = useRef(showShelfManager);
  showShelfManagerRef.current = showShelfManager;
  useEffect(() => {
    const fire = (key: string): boolean => {
      const action = resolveHotkeyAction(key, settingsMirrorRef.current.hotkeys);
      if (!action) return false;
      return dispatchReaderCommand(action, key);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (!bookMirrorRef.current) return; // 欢迎页不劫键
      if (showSettingsRef.current) return; // 面板打开：键归面板（录制态另有 capture 拦截）
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // 保留 Ctrl+A/C 等组合
      const t = ev.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (fire(ev.key)) ev.preventDefault();
    };
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { __readerHotkey?: boolean; key?: string; __readerPager?: boolean } | null;
      if (!data) return;
      // iframe 内鼠标移动：翻页导航复现（F21 修正，iframe 覆盖内容区时宿主
      // container 收不到 mousemove，改由转发器经此通知 Viewer）
      if (data.__readerPager === true) {
        notifyPagerActivity();
        return;
      }
      if (data.__readerHotkey !== true || typeof data.key !== "string") return;
      if (!bookMirrorRef.current || showSettingsRef.current) return;
      fire(data.key); // iframe 内按键：无宿主事件可 prevent，转发前已在iframe侧阻止默认行为
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  // 打开/恢复的失败保险：Viewer 因任何原因未回调 onReady，遮罩 10s 后也淡出
  useEffect(() => {
    if (!busy || busy.leaving) return;
    const t = setTimeout(hideBusy, 10000);
    return () => clearTimeout(t);
  }, [busy, hideBusy]);

  // 卸载清定时器
  useEffect(
    () => () => {
      if (busyTimer.current) clearTimeout(busyTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (dropHintTimer.current) clearTimeout(dropHintTimer.current);
      if (markToastTimer.current) clearTimeout(markToastTimer.current);
    },
    []
  );


  // 离场节点 flush：退出软件 / 点击书架 / 切书时同步取 Viewer 实时位置写库。
  // 记录时机（2026-10-21 用户口径）：只保留这三个离场节点，阅读中不周期性写库。
  const flushCurrent = useCallback(() => {
    const live = positionGetterRef.current?.() ?? null;
    if (live && bookPathRef.current) {
      reportPosition({
        path: bookPathRef.current,
        position: live.position,
        progress: live.progress,
      });
      flashSaved(); // 状态栏「进度已保存」（点书架时可见；退出时窗口即将关闭）
    }
  }, [flashSaved]);

  // 切换阅读模式前捕获实时位置（M8 位置保护）：必须在 setSettings 触发重挂载之前
  // 于事件处理器内同步取——重挂载后旧 Viewer 已卸载、getter 置空，事后取不到。
  const captureForRemount = useCallback(() => {
    const live = positionGetterRef.current?.();
    if (live) setTransientResume(live.position);
  }, []);

  // 设置面板提交：readerMode 变化且正在阅读时，先捕获位置再落库重挂载
  const handleSettingsChange = useCallback(
    (next: Settings) => {
      if (next.readerMode !== settings.readerMode && book) {
        captureForRemount();
        setBusy({ text: "正在切换阅读模式…", leaving: false });
      }
      // v0.2.9：从其它适配方式切到「自定义」且本次未显式带倍率时，
      // 继承当前实际倍率（HTML 基线口径；显式设值则不覆盖用户选择）
      const inheritZoom =
        next.pdfFit === "custom" &&
        settings.pdfFit !== "custom" &&
        next.pdfZoom === settings.pdfZoom &&
        pdfScale != null;
      const effective = inheritZoom ? { ...next, pdfZoom: pdfScale.pct } : next;
      setSettings(saveSettings(effective));
    },
    [settings.readerMode, book, captureForRemount, settings.pdfFit, settings.pdfZoom, pdfScale]
  );

  // v0.2.9：倍率微调（工具栏 ± / Ctrl+滚轮）。非自定义模式下以当前实际倍率为基点，
  // 一次点击即切到「自定义」（避免「自适应下点 + 无反应」的死锁感）。
  const handleZoomNudge = useCallback(
    (delta: number) => {
      const base = settings.pdfFit === "custom" ? settings.pdfZoom : (pdfScale?.pct ?? settings.pdfZoom);
      const next = nudgeZoom(base, delta);
      if (next === base) return;
      handleSettingsChange({ ...settings, pdfFit: "custom", pdfZoom: next });
    },
    [settings, pdfScale, handleSettingsChange]
  );

  const handleScaleReport = useCallback((r: { pct: number; fit: PdfFit }) => {
    setPdfScale((prev) => (prev && prev.pct === r.pct && prev.fit === r.fit ? prev : r));
  }, []);

  // 换书/回书架：作废旧书的上报，避免工具栏与状态栏短暂显示上一本的倍率
  useEffect(() => {
    setPdfScale(null);
  }, [book]);

  const pdfView = useMemo<PdfViewHandlers>(
    () => ({
      onScaleReport: handleScaleReport,
      onFitChange: (fit: PdfFit) => handleSettingsChange({ ...settings, pdfFit: fit }),
      onZoomPreset: (zoom: number) => handleSettingsChange({ ...settings, pdfFit: "custom", pdfZoom: zoom }),
      onZoomNudge: handleZoomNudge,
      // D102：栏数切换是独立维度——切栏不动 pdfFit / pdfZoom，反之亦然
      onColumnsChange: (columns: PdfColumns) => handleSettingsChange({ ...settings, pdfColumns: columns }),
    }),
    [handleScaleReport, handleSettingsChange, handleZoomNudge, settings]
  );

  // v0.2.9：状态栏 PDF 动态文案（实际适配方式 + 栏数 + 倍率 + 高清开关）
  const pdfDetail =
    book?.format === "pdf" && pdfScale
      ? (settings.readerMode === "page" ? "单页翻页" : "连续滚动") +
        " · " +
        (settings.readerMode === "page" ? (settings.pdfColumns === 2 ? "双栏" : "单栏") + " · " : "") +
        FIT_LABELS[migratePdfFit(pdfScale.fit)] +
        " " +
        pdfScale.pct +
        "% · 高清渲染" +
        (settings.pdfDpr ? "开" : "关")
      : null;

  // 工具栏即时切换阅读模式（与设置面板写同一 readerMode 字段）
  const toggleReaderMode = useCallback(() => {
    if (!book) return;
    captureForRemount();
    setBusy({ text: "正在切换阅读模式…", leaving: false });
    const next: ReaderMode = settings.readerMode === "page" ? "scroll" : "page";
    setSettings(saveSettings({ readerMode: next }));
  }, [book, settings.readerMode, captureForRemount]);

  // Go 侧关闭拦截：main.go 的 OnBeforeClose 发 app:flush-request，
  // 前端同步 flush 后回 app:flush-done，Go 最多等 600ms 再退出
  useEffect(() => {
    const cancel = EventsOn("app:flush-request", () => {
      setExitSaving(true);
      flushCurrent();
      EventsEmit("app:flush-done");
    });
    return cancel;
  }, [flushCurrent]);

  // 打开图书：对话框或书架续读统一入口。任何打开方式都恢复记录位置（D30）
  const handleOpen = useCallback(
    async (path?: string) => {
      flushCurrent(); // 切书：先落当前书位置
      setError(null);
      setLoading(true);
      // 过渡动画：点击后立即给加载反馈（书架进入时带恢复语义）
      const prev = path ? getEntry(path) : null;
      setBusy({
        text: prev?.position ? "正在恢复阅读位置…" : "正在打开图书…",
        leaving: false,
      });
      try {
        const result = path ? await OpenBookPath(path) : await OpenBook();
        if (!result) {
          hideBusy(); // 用户取消：遮罩淡出，静默不提示
          return;
        }
        const prevEntry = getEntry(result.path);
        // 建/更新条目 + lastOpen；position 先用旧值占位，Viewer 挂载后首次上报补上，
        // 避免「打开瞬间条目位置被清空」的闪烁（落地文档 5.7）
        savePosition({
          path: result.path,
          name: result.name,
          format: result.format as LibraryEntry["format"],
          size: result.size,
          mtime: result.modTime ?? 0,
          position: prevEntry?.position ?? null,
          progress: prevEntry?.progress ?? 0,
        });
        setResume(prevEntry?.position ?? null);
        bookPathRef.current = result.path; // getter flush 的 path 来源
        setBook(result);
        setOpenCount((n) => n + 1);
        setDetail("");
        // 有恢复位时更新遮罩文案；否则显示书名（对话框打开此时才知书名）
        setBusy((b) =>
          b
            ? {
                ...b,
                text: prevEntry?.position
                  ? "正在恢复阅读位置…"
                  : "正在打开《" + result.name + "」…",
              }
            : b
        );
        await WindowSetTitle("BookEditor — " + result.name);
      } catch (e) {
        hideBusy(); // 打开失败：遮罩淡出，错误条接管提示
        const appError = toAppError(e);
        if (appError.code !== "USER_CANCELED") {
          setError(appError);
        }
      } finally {
        setLoading(false);
      }
    },
    [flushCurrent, hideBusy]
  );

  // 拖放打开（v0.2.7）：整窗 OnFileDrop 回调。仅放行 SupportedExts() 白名单，
  // 不支持则即时 ErrorBar 拒绝（不走 loading 闪烁）；支持则复用 handleOpen。
  // 多文件只开第一个并轻提示；loading 中（正在打开另一本）直接忽略防竞态。
  const handleDrop = useCallback(
    async (paths: string[]) => {
      if (loading) return;
      if (!paths || paths.length === 0) return;
      if (paths.length > 1) {
        showDropHint("已打开第一个文件，其余文件已忽略");
      }
      const allowed = await SupportedExts();
      const first = paths[0];
      if (!isSupportedExt(first, allowed)) {
        const ext = extOf(first);
        setError(toAppError(new Error("UNSUPPORTED_FORMAT: 暂不支持 ." + ext + " 格式")));
        return;
      }
      void handleOpen(first);
    },
    [loading, handleOpen, showDropHint]
  );

  // 注册整窗拖放监听（v0.2.7，D56 修订）：
  // - Go 侧 main.go 必须 EnableFileDrop:true，否则 wails:file-drop 事件不存在；
  // - useDropTarget=false：跳过 --wails-drop-target 元素检查，任何位置落下都回调；
  // - 自兜底 dragover/drop preventDefault：即使 Wails 监听未注册（旧 exe/时序），
  //   也阻止 WebView2 默认行为（文件被当导航/下载处理）。
  useEffect(() => {
    OnFileDrop((_x: number, _y: number, paths: string[]) => {
      void handleDrop(paths);
    }, false);
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer && e.dataTransfer.types.includes("Files");
    const preventNav = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);
    return () => {
      OnFileDropOff();
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  }, [handleDrop]);

  // Ctrl+O 打开文件对话框（v0.2.7 D57）：此前无绑定，WebView2 默认加速键
  // 接管 Ctrl+O 弹出浏览器级「打开文件」，选中的文件被载入 webview（行为错误）。
  // 前端拦截并复用 handleOpen；欢迎页（无书）同样可用，故不依赖 book 状态。
  useEffect(() => {
    const onOpenKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      if (ev.key !== "o" && ev.key !== "O") return;
      if (showSettingsRef.current) return; // 设置面板打开：键归面板
      ev.preventDefault();
      void handleOpen();
    };
    window.addEventListener("keydown", onOpenKey);
    return () => window.removeEventListener("keydown", onOpenKey);
  }, [handleOpen]);

  // v0.3.0：Ctrl+M 打开/关闭标记记录面板（F38）。仿 Ctrl+O 做窗口级拦截，
  // 防止 WebView2 默认加速键；无书时面板无宿主故不劫键；设置面板/编辑器/
  // 书架管理打开时键归更高层模态。
  useEffect(() => {
    const onMarkKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
      if (ev.key !== "m" && ev.key !== "M") return;
      if (!bookMirrorRef.current) return; // 欢迎页不劫键
      if (showSettingsRef.current) return; // 设置面板打开：键归面板
      if (noteEditMirrorRef.current) return; // 感悟编辑器打开：键归编辑器
      if (showShelfManagerRef.current) return; // 书架管理对话框：键归对话框
      ev.preventDefault();
      setShowMarks((v) => !v);
    };
    window.addEventListener("keydown", onMarkKey);
    return () => window.removeEventListener("keydown", onMarkKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewer 初始渲染（含位置恢复）完成：淡出加载遮罩；清空瞬态恢复位
  // （M8：切换模式时的 transientResume 仅用于本次重挂载恢复，恢复后丢弃）
  const handleReady = useCallback(() => {
    hideBusy();
    setTransientResume(null);
  }, [hideBusy]);

  // 回书架：flush → 卸载 Viewer → 欢迎页（书架常显按钮，无书时点击无变化）
  const handleShelf = useCallback(() => {
    flushCurrent();
    bookPathRef.current = null;
    setBook(null);
    setResume(null);
    setDetail("");
    void WindowSetTitle("BookEditor");
  }, [flushCurrent]);

  const handleRemoveEntry = useCallback((path: string) => {
    removeEntry(path);
    // D70：移除书架记录时同步清掉该书的标记（按 path 主键关联，无孤儿数据）
    clearBookMarks(path);
  }, []);

  // v0.2.8：批量移除（管理对话框「移除所选」），单次写盘（D59）
  const handleRemoveEntries = useCallback((paths: string[]) => {
    removeEntries(paths);
    // D70：批量移除同样清标记（逐本 clear，写盘合并由订阅广播兜底）
    paths.forEach((p) => clearBookMarks(p));
  }, []);

  const handleClearLibrary = useCallback(() => {
    clearLibrary();
    // D70：清空书架 = 全部阅读记录失效，标记整体清空（与单本移除同口径）
    clearAllMarks();
  }, []);

  // 回到欢迎页（无书）时关闭标记面板：面板以当前书为宿主，无书无意义
  useEffect(() => {
    if (!book) setShowMarks(false);
  }, [book]);

  // D96：切书/换格式时清空目录上下文——避免上一本书的目录把新书标记归错章节
  useEffect(() => {
    setTocCtx(null);
  }, [book?.path, book?.format]);

  // v0.2.8：图书归类；cat 为空串表示「未分类」
  const handleAssignCategory = useCallback((path: string, cat: string) => {
    setEntryCategory(path, cat.trim() ? cat.trim() : undefined);
  }, []);

  // v0.2.8：新建自定义分类；失败原因回传 UI 就地提示
  const handleCreateCategory = useCallback((name: string) => {
    const res = addCategory(name);
    return res.ok ? { ok: true } : { ok: false, reason: res.reason };
  }, []);

  // beforeunload：best-effort 同步 flush（localStorage 同步写来得及）
  useEffect(() => {
    const onUnload = () => flushCurrent();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [flushCurrent]);

  // ===== v0.3.0 标记记录：上下文组装（Viewer/面板共用）=====
  // 当前书标记：App 持有全量，按 path 过滤后下发（关闭总开关时仍传入，
  // 既有高亮照常展示，只是不弹新工具条）。
  const currentBookMarks = useMemo(
    () => (book ? marks.filter((m) => m.bookPath === book.path) : []),
    [marks, book]
  );

  // 「＋ 写想法」的定位器：取当前阅读处（§4.10）。EPUB 优先 relocated 的
  // cfi，缺失时退回 href（epubjs display 两种 target 都认，spine.get 同解）；
  // 完全无实时位置（Viewer 未上报）时给中性定位器，条目不依赖定位展示。
  const ideaLocator = useCallback((): MarkLocator => {
    const pos = positionGetterRef.current?.()?.position ?? null;
    if (pos && book && pos.kind === book.format) {
      if (pos.kind === "epub") return { kind: "epub", cfi: pos.cfi || pos.href, href: pos.href, chapter: "" };
      if (pos.kind === "pdf") return { kind: "pdf", page: pos.page, quote: "" };
      return { kind: "txt", start: pos.anchor ?? 0, end: pos.anchor ?? 0 };
    }
    if (book?.format === "pdf") return { kind: "pdf", page: 1, quote: "" };
    if (book?.format === "epub") return { kind: "epub", cfi: "", href: "", chapter: "" };
    return { kind: "txt", start: 0, end: 0 };
  }, [book]);

  const marksCtx = useMemo<MarksContext>(
    () => ({
      marks: currentBookMarks,
      enabled: settings.markEnabled,
      defaultColor: settings.markDefaultColor,
      onAdd: (input: AddMarkInput): Mark => {
        const path = book?.path ?? bookPathRef.current ?? "";
        const m = addMark({ bookPath: path, ...input });
        if (path) showMarkToast("已标记");
        return m;
      },
      onUpdate: (id: string, patch: { color?: MarkColor }) => updateMark(id, patch),
      // D101：画笔笔迹替换（整组覆盖，避免逐笔增删产生中间态）
      onReplaceInk: (id: string, strokes: PdfStroke[]) => updateMark(id, { strokes }),
      onNoteNew: (info: { quote: string; locator: MarkLocator; idea?: boolean }) =>
        setNoteEdit({ mode: "new", quote: info.quote, idea: info.idea, locator: info.locator }),
      onEdit: (m: Mark) => setNoteEdit({ mode: "edit", mark: m }),
      onDelete: (id: string) => {
        removeMark(id);
        showMarkToast("已删除标记");
      },
      onCopy: (text: string) => {
        void copyToClipboard(text).then(
          () => showMarkToast("已复制"),
          () => showMarkToast("复制失败：请检查浏览器权限")
        );
      },
      jumpTarget: markJump,
      onJumpDone: () => setMarkJump(null),
    }),
    [currentBookMarks, settings.markEnabled, settings.markDefaultColor, book, markJump, showMarkToast, copyToClipboard]
  );

  // 面板跳转：置入 nonce 目标（Viewer 消费后回调 onJumpDone 清空）
  const handleMarkJump = useCallback((m: Mark) => {
    markNonceRef.current += 1;
    setMarkJump({ mark: m, nonce: markNonceRef.current });
  }, []);

  // 面板「＋ 写想法」：默认色 + 当前阅读处定位
  const handleWriteIdea = useCallback(() => {
    setNoteEdit({ mode: "new", quote: "", idea: true, locator: ideaLocator() });
  }, [ideaLocator]);

  // 感悟编辑器保存：new=落库（划词带原文/想法空原文）；edit=改 note/color。
  // 空 note 合法（纯高亮，§4.9）；保存后统一关闭编辑器。
  const handleNoteSave = useCallback(
    (note: string, color: MarkColor) => {
      const cur = noteEdit;
      if (!cur) return;
      const path = book?.path ?? bookPathRef.current ?? "";
      if (cur.mode === "new") {
        addMark({
          bookPath: path,
          color,
          text: cur.idea ? "" : cur.quote,
          note,
          locator: cur.locator,
          ...(cur.idea ? { idea: true } : {}),
        });
        showMarkToast(cur.idea ? "想法已记录" : note ? "已保存感悟" : "已标记");
      } else {
        updateMark(cur.mark.id, { note, color });
        showMarkToast("已保存感悟");
      }
      setNoteEdit(null);
    },
    [noteEdit, book, showMarkToast]
  );

  // 面板「清空本书」：MarksPanel 内已做二次确认，这里直接执行
  const handleClearBookMarks = useCallback(() => {
    if (!book) return;
    clearBookMarks(book.path);
    showMarkToast("已清空本书标记");
  }, [book, showMarkToast]);

  return (
    <div className="app">
      <Toolbar
        book={book}
        loading={loading}
        readerMode={settings.readerMode}
        onOpen={() => void handleOpen()}
        onShelf={handleShelf}
        onSettings={() => setShowSettings(true)}
        onModeChange={toggleReaderMode}
        pdfScalePct={book?.format === "pdf" ? pdfScale?.pct ?? null : null}
        onZoomNudge={handleZoomNudge}
        markEnabled={settings.markEnabled}
        markOpen={showMarks}
        markCount={currentBookMarks.length}
        onToggleMarks={() => {
          epubDiag("MARK_PANEL_TOGGLE", `open=${!showMarks} hasBook=${!!book}`);
          setShowMarks((v) => !v);
        }}
      />
      <ErrorBar error={error} onClose={() => setError(null)} />
      {/* v0.3.0：正文区 + 标记面板同行（面板 340px 固定在右侧） */}
      <div className="app-body">
        <BookViewer
          book={book}
          openCount={openCount}
          settings={settings}
          readerMode={settings.readerMode}
          entries={entries}
          customCats={customCats}
          currentCat={currentCat}
          onCategoryChange={setCurrentCat}
          onAssignCategory={handleAssignCategory}
          onCreateCategory={handleCreateCategory}
          resume={transientResume ?? resume}
          getterRef={positionGetterRef}
          onDetail={setDetail}
          onReady={handleReady}
          onOpenPath={(path) => void handleOpen(path)}
          onRemoveEntry={handleRemoveEntry}
          onOpenManager={() => setShowShelfManager(true)}
          pdfView={pdfView}
          marksCtx={marksCtx}
          onTocContext={setTocCtx}
        />
        {showMarks && book && (
          <>
            {/* D95：弹窗浮层——点击遮罩关闭，面板浮在正文右侧不占布局 */}
            <div className="marks-backdrop" onClick={() => setShowMarks(false)} />
            <MarksPanel
              bookName={book.name.replace(/\.[^.]+$/, "")}
              marks={currentBookMarks}
              allMarks={marks}
              tocCtx={tocCtx}
              onClose={() => setShowMarks(false)}
              onJump={handleMarkJump}
              onEdit={marksCtx.onEdit}
              onWriteIdea={handleWriteIdea}
              onDelete={marksCtx.onDelete}
              onClearBook={handleClearBookMarks}
              onToast={showMarkToast}
            />
          </>
        )}
      </div>
      <StatusBar
        book={book}
        detail={detail}
        entries={entries}
        readerMode={settings.readerMode}
        savedFlash={savedFlash}
        pdfDetail={pdfDetail}
      />
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onOpenManager={() => setShowShelfManager(true)}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
      {/* v0.2.8：书架管理对话框（自选清除 + 清空二次确认），层级高于设置面板 */}
      {showShelfManager && (
        <ShelfManager
          entries={entries}
          onRemove={handleRemoveEntries}
          onClearAll={handleClearLibrary}
          onClose={() => setShowShelfManager(false)}
        />
      )}
      {/* v0.3.0：感悟编辑器（划词「写感悟」/ 面板「写想法」/ 条目「编辑」）。
          key 保证切换编辑目标时草稿不串味（组件自持 note/color 草稿态） */}
      {noteEdit && (
        <MarkNoteEditor
          key={noteEdit.mode === "edit" ? noteEdit.mark.id : "new"}
          quote={noteEdit.mode === "edit" ? noteEdit.mark.text : noteEdit.quote}
          idea={noteEdit.mode === "edit" ? noteEdit.mark.idea : noteEdit.idea}
          initialColor={
            noteEdit.mode === "edit" ? noteEdit.mark.color : settings.markDefaultColor
          }
          initialNote={noteEdit.mode === "edit" ? noteEdit.mark.note : ""}
          onSave={handleNoteSave}
          onCancel={() => setNoteEdit(null)}
        />
      )}
      {/* 打开/恢复加载遮罩：进入书架续读时的过渡反馈 */}
      {busy && (
        <div className={"loading-overlay" + (busy.leaving ? " leaving" : "")} role="status">
          <div className="loading-card">
            <span className="spinner" aria-hidden="true" />
            <span className="loading-text">{busy.text}</span>
          </div>
        </div>
      )}
      {/* 退出前保存提示（OnBeforeClose flush 期间可见） */}
      {exitSaving && (
        <div className="app-toast" role="status">
          正在保存阅读进度…
        </div>
      )}
      {/* 拖放轻提示（v0.2.7）：多文件拖入仅开第一个等 */}
      {dropHint && (
        <div className="app-toast" role="status">
          {dropHint}
        </div>
      )}
      {/* v0.3.0：标记操作轻提示（已标记/已删除/已复制等） */}
      {markToast && (
        <div className="app-toast" role="status">
          {markToast}
        </div>
      )}
    </div>
  );
}
