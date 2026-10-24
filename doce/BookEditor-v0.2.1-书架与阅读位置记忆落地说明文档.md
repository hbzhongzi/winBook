# BookEditor v0.2.1 书架与阅读位置记忆落地说明文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.2 |
| 更新日期 | 2026-10-21 |
| 上位文档 | `doce/_archive/BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md`（已归档） |
| 设计基线 | `doce/BookEditor-前端界面示例.html`（「书架（欢迎页）」状态、工具栏书架按钮、设置 · 高级页书架行） |
| 关联文档 | `doce/BookEditor-v0.1.0-整合项目文档.md`、`doce/BookEditor-v0.2.0-个性化功能落地说明文档.md` |
| 本版范围 | G1 书架（最近阅读）、G2 退出位置记忆、G3 打开恢复、G4 目录侧栏显隐记忆（可选） |
| 状态 | 已实施：单测 64/64、tsc/build 通过、smoke_shelf 13/13、verify_positions A29 章节级 PASS / A30、A31 像素级一致、verify_flush 三场景 PASS（flush-A/B/C）；记录时机收敛为离场节点（2026-10-21 用户口径，D34）；状态栏章名探针与 flush 锚点同源修复记 D33 |

## 1. 范围

### 1.1 本版实现

| 编号 | 功能 | 生效范围 | 默认值 |
|---|---|---|---|
| G1 | 书架：欢迎页「继续阅读」卡片区 + 工具栏书架按钮 + 高级页清空 | 全局 | 空（无记录时整区隐藏） |
| G2 | 位置记忆：离场节点 flush（退出软件 / 点击书架 / 切书时同步取实时位置写库；阅读中不周期性写库） | EPUB / PDF / TXT | 开（不可关闭） |
| G3 | 打开恢复：任何方式打开已记录的书都恢复到退出位置 | EPUB / PDF / TXT | 开 |
| G4 | 目录侧栏显隐记忆（可选，低成本） | EPUB | 展开 |

### 1.2 不在本版

- 真封面缩略图（用格式渐变色块 + 首字占位，见 D25）；
- 阅读统计、排序自定义、置顶；
- 侧栏宽度记忆（G4 只做显隐）；
- Go 侧 JSON 文件存储（沿用 localStorage，见方案 4.1）。

## 2. 交付物清单

| 类型 | 文件 | 改动 |
|---|---|---|
| 数据层 | `frontend/src/utils/library.ts` | 新建：书架存储、条目 CRUD、淘汰、校验、订阅、位置上报封装 |
| 数据层 | `frontend/src/utils/__tests__/library.test.ts` | 新建：单测 |
| 阅读器 | `frontend/src/utils/chapterWindow.ts` | `WindowManager` 增加 `getAnchor()` |
| 阅读器 | `frontend/src/components/EpubViewer.tsx` | 位置 getter（`getterRef` 注册）+ 恢复逻辑 + 章名探针同源（D33） |
| 阅读器 | `frontend/src/components/PdfViewer.tsx` | `initialPage` 恢复 + 位置 getter |
| 阅读器 | `frontend/src/components/TextViewer.tsx` | 滚动恢复 + 位置 getter（加 ref） |
| 应用层 | `frontend/src/App.tsx` | 书架状态、打开/续读/回书架编排、离场节点 flush、加载过渡动画 |
| 应用层 | `frontend/src/components/Toolbar.tsx` | 「书架」按钮 |
| UI | `frontend/src/components/BookViewer.tsx` | 欢迎页书架区 + `resume`/`getterRef`/`onReady` 透传 |
| UI | `frontend/src/components/SettingsPanel.tsx` | 高级页「书架记录」行（二态确认清空） |
| 样式 | `frontend/src/styles.css` | 书架样式（令牌化，四主题适配）+ 加载遮罩/退出提示/保存闪烁过渡动画 |
| 后端 | `app.go` | 抽 `openBookAt`，新增 `OpenBookPath`；`BookData` 增 `ModTime` |
| 后端 | `main.go` | `OnBeforeClose` 拦截关闭前 flush（flush-request/flush-done 事件握手，600ms 超时） |
| 测试 | `e2e/smoke_shelf.py` | 新建：书架 GUI 冒烟 |
| 测试 | `e2e/verify_positions.py` | 新建：三格式位置恢复核对（A29–A31） |
| 测试 | `e2e/verify_flush.py` | 新建：离场节点 flush 三场景（flush-A 点书架 / flush-B 退出重启 / flush-C EPUB 退出链） |
| 文档 | `doce/BookEditor-v0.2.1-个性化功能落地方案.md` | 无需改（本文件为其展开） |

## 3. 数据契约

### 3.1 存储键

| 键 | 内容 | 备注 |
|---|---|---|
| `bookeditor.library.v1` | 书架条目 + 阅读位置 | 本版新增 |
| `bookeditor.ui.v1` | G4 侧栏显隐等零散 UI 偏好 | 仅实施 G4 时新增 |

### 3.2 `library.v1` 结构

```json
{
  "version": 1,
  "entries": [
    {
      "path": "E:\\Books\\雾中列车.epub",
      "name": "雾中列车.epub",
      "format": "epub",
      "size": 1887436,
      "mtime": 1760409600,
      "lastOpen": 1760999000,
      "position": { "kind": "epub", "tocIndex": 12, "href": "Text/chapter13.xhtml", "sectionIndex": 14, "ratio": 0.42 },
      "progress": 0.31
    }
  ]
}
```

### 3.3 类型定义（library.ts 精确契约）

```ts
export type ReadingPosition =
  | { kind: "epub"; tocIndex: number; href: string; sectionIndex: number; ratio: number }
  | { kind: "pdf"; page: number }
  | { kind: "txt"; ratio: number };

export type LibraryEntry = {
  path: string;
  name: string;
  format: "epub" | "pdf" | "txt";
  size: number;
  mtime: number;
  lastOpen: number;
  position: ReadingPosition | null;
  progress: number; // 0..1，展示用
};

export const LIBRARY_KEY = "bookeditor.library.v1";
export const LIBRARY_LIMIT = 50;
```

### 3.4 函数面

```ts
loadLibrary(): LibraryEntry[]                 // 读取 + 校验 + 按 lastOpen 倒序；损坏回落 []
listEntries(): LibraryEntry[]                 // = loadLibrary（供 React 初始 state）
upsertEntry(e: LibraryEntry): LibraryEntry[]  // path 主键去重；淘汰最旧至 50；写盘 + 广播
removeEntry(path: string): LibraryEntry[]
clearLibrary(): LibraryEntry[]
getEntry(path: string): LibraryEntry | null
savePosition(input: {             // 打开成功时调用（建/更新条目 + lastOpen）
  path, name, format, size, mtime, position: ReadingPosition, progress: number
}): void
reportPosition(input: {           // 阅读中调用（只更新 position/progress，不刷新 lastOpen）
  path, position: ReadingPosition, progress: number
}): void
subscribeLibrary(cb: (entries: LibraryEntry[]) => void): () => void  // storage 事件 + 同页广播
```

要点：

- `reportPosition` 同步写盘（无内部节流）；节流在 Viewer 侧（见 5.3–5.5），这样退出 flush 只需写 App 缓存的最新值，不引入待写队列。
- 同页广播与 `storage` 事件双通道，行为与 settings v2 订阅一致（多实例/多窗口同步）。
- 校验：`format` 白名单外整条丢弃；`ratio`/`progress` 非有限数或越界钳制；`position` 结构不合法置 null；`version` 非 1 或 JSON 损坏整体回落 `[]`。

### 3.5 Go 侧契约（app.go）

```go
type BookData struct {
    Name       string `json:"name"`
    Path       string `json:"path"`
    Format     string `json:"format"`
    Size       int64  `json:"size"`
    ModTime    int64  `json:"modTime"`        // 新增：unix 秒
    DataBase64 string `json:"dataBase64,omitempty"`
    Text       string `json:"text,omitempty"`
}

func (a *App) OpenBook() (*BookData, error)                    // 现有：对话框
func (a *App) OpenBookPath(path string) (*BookData, error)     // 新增：书架续读
```

- 两者共用抽出的 `openBookAt(path)`：格式判断 → `os.Stat`（取 size/mtime）→ 大小上限 → 读取 → 组装。错误契约完全不变（`CODE: message` 前缀），书架点到失效文件时与对话框打开失败走同一条错误条。
- `frontend/wailsjs/` 由 `wails build` 重新生成，禁止手改。

## 4. UI 结构映射（HTML 基线 → 组件）

| HTML 基线 | 组件 / 类名 | 说明 |
|---|---|---|
| 工具栏书架按钮 | `Toolbar` `.btn-icon#shelfBtn` | 图标与基线一致（lucide library 竖条） |
| 欢迎页 + 继续阅读区 | `BookViewer` 空态分支 `.shelf` | 书架为空时整区 `hidden` |
| `.shelf-head` / `.shelf-count` / `.shelf-clear` | 同名 | count 取自 `entries.length` |
| `.shelf-grid` / `.shelf-card` | 同名 | 卡片 = `div role="button" tabindex={0}` |
| `.shelf-cover c-epub/c-pdf/c-txt` | 同名 | 格式渐变色块 + 书名首字（D25） |
| `.shelf-name` / `.shelf-meta` / `.shelf-time` | 同名 | meta 内放格式徽标（复用 `.badge`）与相对时间 |
| `.shelf-progress` / `.shelf-bar` | 同名 | EPUB 显示「约 N%」，PDF 显示「N / M 页」，TXT 显示「N%」 |
| `.shelf-remove` | 同名（`span role="button"`） | 悬停显示；Enter/Space 可触发 |
| `.shelf-empty` | 同名 | 清空后的空态提示 |
| 设置 · 高级页书架行 | `SettingsPanel` `.adv-row` | 「书架记录 \| N 条 · 本机 localStorage \| 清空」 |

相对时间格式：`< 1 小时`→「刚刚」；`< 24 小时`→「N 小时前」；`< 7 天`→「N 天前」；否则「M 月 D 日」。集中一个 `formatRelativeTime(ts)` 助手函数放 library.ts。

## 5. 实现细节

### 5.1 `library.ts`

- 读写全部经 `localStorage`，`try/catch` 包裹（隐私模式/配额失败静默降级为不持久化，不弹错）。
- `upsertEntry` 淘汰策略：插入/更新后若 `entries.length > 50`，删 `lastOpen` 最小的直至 50。
- `savePosition` 与 `upsertEntry` 的区别：`savePosition` 用于「刚打开」（建条目 + 刷 `lastOpen`）；`reportPosition` 用于「阅读中」（只更位置，不动 `lastOpen`，避免打开后立刻把排序打乱）。

### 5.2 `chapterWindow.ts`：`getAnchor()`

```ts
export type WindowAnchor = { sectionIndex: number; ratio: number };
// WindowManager 增加：
getAnchor(): WindowAnchor | null;
```

- 内部复用 `findVisibleViewIndex` 的结果：`sectionIndex` = 可见 view 的 section.index；`ratio` = 视口中线探针在该 view 内的相对位置 `(probe - rect.top) / rect.height`，钳制 [0,1]。
- 无 views 或视口探针落在章节间隙时返回 null，调用方忽略本次上报。
- **探针同源（D33，2026-10-21）**：视口中线是本版唯一的「当前阅读位置」判据。`EpubViewer` 的章名上报/侧栏高亮（`onVisibleChange`）最初用「视口顶部 +72px」探针，与 `getAnchor` 的中线探针在滚动过渡态（上一章尾巴还在视口顶部、中线已进下一章）会给出不同章节——flush-C 实测状态栏章名与 flush 锚点不一致导致 mad 误报 4.963。已将 `onVisibleChange` 的探针统一为视口中线。

### 5.3 `EpubViewer.tsx`

新增 props：

```ts
resume?: ReadingPosition | null;                 // 一次性初始位置（epub 类）
getterRef?: MutableRefObject<(() => PositionReport | null) | null>;  // 同步取位置注册位
onReady?: () => void;                            // 初始渲染（含恢复）完成
```

**采集（2026-10-21 离场节点口径，D34）**：

- 不做 scroll 监听、不起定时器、阅读中不写库。改为暴露同步 getter：挂载时 `getterRef.current = collectPosition`，卸载置 null（`unwireScroll` 内校验身份后清）。
- `collectPosition` = `wm.getAnchor()` + `tocTargetsRef` 按 `anchor.sectionIndex` 过滤、`activeRef.current` 选中（无匹配回落该 section 首项；该 section 无目录项返回 null）→ `{ position: { kind:"epub", tocIndex, href, sectionIndex, ratio }, progress: (tocIndex+1)/toc.length }`。
- App 的 `flushCurrent()` 在离场节点实时调用 getter：不依赖任何 debounce 缓存，持续滚动（定时器不断重置）或停止不足一个周期时退出也能拿到最新位置——这是「直接退出/点书架记录不更新」缺陷的根因修复。
- **章名探针（D33）**：`onVisibleChange` 内选目录项的探针用视口中线 `(rect.top+rect.bottom)/2`（与 `getAnchor` 的 `findVisibleViewIndex` 同一探针），选「最后一个锚点顶部已过中线」的项。顶探针会在过渡态把章名报成上一章，与 flush 锚点不同源（A29/flush-C 的 mad 判定因此误报）。
- progress：`(tocIndex + 1) / Math.max(1, toc.length)`（约值，D27）。

**恢复**（在现有「初始 display + 空白自检」流程完全走完之后、`initialPhase = false` 之前插入）：

```ts
if (resume && resume.kind === "epub" && resume.href) {
  try { await withTimeout(rendition.display(resume.href), OPEN_TIMEOUT_MS); } catch { return; }
  await waitStageStable(stage, 1500);            // scrollHeight 连续两帧不变或超时
  const view = manager.views.all().find((v) => v.section.index === resume.sectionIndex);
  if (view) {
    // 与 jump() 同一套视口坐标换算法（不用 epubjs bounds()，其语义随版本漂移）
    const rect = view.element.getBoundingClientRect();
    const target = stage.scrollTop + (rect.top - stageRect.top) + clamp01(resume.ratio) * rect.height;
    stage.scrollTop = Math.max(0, Math.min(target, max));
    // 自校正：读回锚点与目标比较，差值按当前章节高度折算 scrollTop 修正，最多 2 次
    for (let i = 0; i < 2; i++) {
      const now = windowRef.current?.getAnchor();
      if (!now || now.sectionIndex !== resume.sectionIndex) break;
      const delta = resume.ratio - now.ratio;
      if (Math.abs(delta) < 0.01) break;
      const h = view.element.getBoundingClientRect().height;
      if (h <= 0) break;
      stage.scrollTop = Math.max(0, Math.min(stage.scrollTop + delta * h, max));
    }
  }
  windowRef.current?.sync();
}
// 侧栏高亮与章名同步（无论 view 是否找到都执行）
const idx = clampInt(resume.tocIndex, 0, items.length - 1);
activeRef.current = idx; setActive(idx);
onChapterChangeRef.current?.(items[idx]?.label ?? "");
```

- `waitStageStable(stage, 1500)`：100ms 轮询 `stage.scrollHeight`，连续两次相同即返回；超时也返回（不等绘制完成，比例应用允许少量误差）。
- 恢复用的坐标公式与 `jump()` 的视口换算法一致（`stage.scrollTop + (viewRect.top - stageRect.top)`），不使用 epubjs `bounds()`（语义在不同版本有偏差）。
- **自校正循环**：首次应用目标 scrollTop 后，延迟 400ms 读回当前锚点与目标 `{sectionIndex, ratio}` 比较；差值折算为 scrollTop 修正，最多 2 次。用于吸收恢复实例与上报实例之间的几何差异（书内图片 `max-width:99%` 异步加载会改变章节高度）。
- **精度口径（2026-10-20 用户确认）**：EPUB 恢复只要求**章节级**——恢复后停在与上报时相同的章节（侧栏高亮一致）即达标；章内位置按章节内比例恢复 + 自校正，属最佳努力，不做像素级要求。实测章内漂移约 369px（约 2–3 段，12.epub 推荐序二），已作为偏差 D32 记录。
- `resume` 只消费一次：存入 ref，恢复完成后置 null（防止 effect 因 `dataBase64` 以外的原因重入时二次恢复——本 effect 依赖仅 `[dataBase64]`，重复打开同书由 `openCount` 重建组件，天然一次性；置 null 是双保险）。

### 5.4 `PdfViewer.tsx`

- 新增 `initialPage?: number`、`getterRef?` props。
- 文档加载完成分支：`setCurrent(clampInt(initialPage ?? 1, 1, pdf.numPages))`（替换现有 `setCurrent(1)`）。
- 位置采集走同步 getter（离场节点口径）：`useEffect(..., [getterRef, pageCount, current])` 注册/清理；`collectPosition` 返回 `{ kind:"pdf", page: current, pageCount }`，`pageCount <= 0` 或 `current < 1` 返回 null；progress = `current / pageCount`。翻页 effect 内不再有上报调用。
- 无需节流：翻页是低频离散事件（旧版描述；现已统一为离场节点 getter）。

### 5.5 `TextViewer.tsx`

- 新增 `resume?: ReadingPosition | null`、`getterRef?` props；组件加 `scrollRef`。
- 恢复：挂载 effect 内 `el.scrollTop = clamp01(resume.ratio) * (el.scrollHeight - el.clientHeight)`（布局已完成，`pre` 已撑开容器）。
- 采集走同步 getter（离场节点口径）：`ratio = el.scrollTop / (el.scrollHeight - el.clientHeight)`，分母为 0 报 0；无 scroll 监听、无定时器。

### 5.6 `BookViewer.tsx`

- 空态分支：欢迎区之后渲染书架区（entries 为空 → `hidden`）。卡片点击 → `onOpenPath(entry.path)`；移除 → `onRemoveEntry(entry.path)`；清空 → `onClearLibrary()`。
- 有书分支：三个 Viewer 透传 `resume`、`getterRef` 与 `onReady`；`resume` 按 `book.format` 分流（格式不匹配的 position 丢弃，如书记录的是 PDF 位置但现在是 EPUB——理论上同 path 格式不会变，防御性处理）。`onPosition` 已于 2026-10-21 移除（改 getter 模式，见 5.7）。

### 5.7 `App.tsx` 编排（2026-10-21 离场节点版）

```tsx
const [entries, setEntries] = useState(listEntries);
const [resume, setResume] = useState<ReadingPosition | null>(null);
// 当前书路径：getter 取到位置时补 path 用（getter 只回位置不带 path）
const bookPathRef = useRef<string | null>(null);
// 同步取位置注册位：Viewer 挂载时注册（离场节点 flush 实时取）
const positionGetterRef = useRef<(() => PositionReport | null) | null>(null);

useEffect(() => subscribeLibrary(setEntries), []);

// 离场节点 flush：退出软件 / 点击书架 / 切书时同步取 Viewer 实时位置写库。
// 记录时机（2026-10-21 用户口径，D34）：只保留这三个离场节点，阅读中不周期性写库。
const flushCurrent = useCallback(() => {
  const live = positionGetterRef.current?.() ?? null;
  if (live && bookPathRef.current) {
    reportPosition({ path: bookPathRef.current, position: live.position, progress: live.progress });
    flashSaved(); // 状态栏「进度已保存」（点书架时可见；退出时窗口即将关闭）
  }
}, [flashSaved]);

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

const handleOpen = useCallback(async (path?: string) => {
  flushCurrent();                       // 切书：先落当前书位置
  setError(null); setLoading(true);
  const prev = path ? getEntry(path) : null;
  setBusy({ text: prev?.position ? "正在恢复阅读位置…" : "正在打开图书…", leaving: false }); // 过渡动画
  try {
    const result = path ? await OpenBookPath(path) : await OpenBook();
    if (!result) { hideBusy(); return; }            // 取消：遮罩淡出，静默
    const prevEntry = getEntry(result.path);
    savePosition({                     // 建/更新条目 + lastOpen（position 先用旧值占位，D31）
      path: result.path, name: result.name, format: result.format,
      size: result.size, mtime: result.modTime ?? 0,
      position: prevEntry?.position ?? null,         // 任何打开方式都恢复（D30）
      progress: prevEntry?.progress ?? 0,
    });
    setResume(prevEntry?.position ?? null);
    bookPathRef.current = result.path;               // getter flush 的 path 来源
    setBook(result); setOpenCount((n) => n + 1); setDetail("");
    await WindowSetTitle("BookEditor — " + result.name);
  } catch (e) { /* 同现有错误契约 */ }
  finally { setLoading(false); }
}, [flushCurrent, hideBusy]);

// Viewer 初始渲染（含位置恢复）完成：淡出加载遮罩（一次性标志防重复）
const handleReady = useCallback(() => hideBusy(), [hideBusy]);

// 回书架：flush → 卸载 Viewer → 欢迎页
const handleShelf = useCallback(() => {
  flushCurrent();
  bookPathRef.current = null;
  setBook(null); setResume(null); setDetail("");
  void WindowSetTitle("BookEditor");
}, [flushCurrent]);

// beforeunload：best-effort 同步 flush（localStorage 同步写来得及）
useEffect(() => {
  const onUnload = () => flushCurrent();
  window.addEventListener("beforeunload", onUnload);
  return () => window.removeEventListener("beforeunload", onUnload);
}, [flushCurrent]);
```

与 v1.1 的差异：

- **删除 `lastPosRef` 缓存与 `handlePosition`**：flush 不再读 debounce 缓存，改为 `positionGetterRef.current?.()` 实时取（Viewer 挂载注册 / 卸载置 null）。这是「阅读中直接退出 / 点书架记录不更新」的根因修复——旧 flush 只读 3s debounce 缓存，持续滚动（每次滚动重置定时器）或停止不足 3s 即离场时缓存为空，位置丢失。
- **新增 `app:flush-request` 监听**：Go 侧 `OnBeforeClose`（见 5.12）在 WM_CLOSE 时拦截关闭，前端同步 flush 后回 `app:flush-done`；期间显示「正在保存阅读进度…」轻提示。
- **新增过渡动画**（缓解「书架重进卡顿」的用户反馈，2026-10-21）：`busy` 加载遮罩（打开 / 恢复位置期间，`leaving` 淡出 220ms 后卸载；Viewer 未回调 `onReady` 时 10s 保险淡出）；`exitSaving` 退出保存提示；`savedFlash` 状态栏「进度已保存 ✓」闪烁 1.5s。
- `savePosition` 仍用旧 position 先占位（D31）；`getEntry` 只读一次。

### 5.12 `main.go`：`OnBeforeClose` 关闭前 flush

```go
var quitting bool
OnBeforeClose: func(ctx context.Context) bool {
  if quitting { return false }        // 退出流程中：放行，由 Quit 完成退出
  quitting = true
  go func() {
    done := make(chan struct{})
    cancel := runtime.EventsOn(ctx, "app:flush-done", func(...interface{}) { close(done) })
    runtime.EventsEmit(ctx, "app:flush-request")
    select {
    case <-done:
    case <-time.After(600 * time.Millisecond):
    }
    cancel()
    runtime.Quit(ctx)
  }()
  return true                        // 本次关闭被接管：等 flush 后由 Quit 退出
}
```

实现要点：

1. `prevent=true` 阻止本次关闭，等待必须放**后台 goroutine**：`EventsEmit` 的 ExecJS 经 PostMessage 派发到窗口消息队列，若在 WM_CLOSE 的处理线程（消息循环）里阻塞等待，派发会被堵住形成死锁，flush-request 永远到不了前端（只能等超时）。
2. 先注册 flush-done 监听再发请求，避免 flush-done 早于监听注册到达（前端同步 flush 是毫秒级）。
3. `runtime.Quit` 内部会再次进入 `OnBeforeClose`，由 `quitting` 标志放行，不会自锁。
4. 600ms 超时：localStorage 同步写仅毫秒级，600ms 是留足极端情况（大书架序列化）的余量；超时未回也照常退出，不阻塞用户。
5. beforeunload 在 WebView2 销毁时不一定触发（缺陷背景），本拦截是「退出软件」离场节点的主路径；beforeunload 保留为 best-effort 兜底。

### 5.8 `Toolbar.tsx`

- 新增 `onShelf` prop 与书架按钮（放在设置齿轮左侧，与 HTML 基线一致）。
- 按钮常显可用（无书时点击回到欢迎页 = 当前已在欢迎页则无变化）。

### 5.9 `SettingsPanel.tsx`

- 高级页新增行：`书架记录 | N 条 · 本机 localStorage | 清空`。
- 清空二态确认：点击后按钮文案变「确认清空？」并进入 3s 确认窗；窗内再点执行 `clearLibrary()` + 面板内「已保存 ✓」位改显「书架已清空」；超时或点击面板其他区域还原。不用 `window.confirm`（D29）。
- 书架行数据来源：`subscribeLibrary`（SettingsPanel 内自订阅，避免 prop 层层传递）。

### 5.10 `styles.css`

- 按 HTML 基线搬迁 `.shelf*` 样式，**硬编码色全部替换为令牌**（`#fff`→`var(--surface-bg)`、边框→`var(--border-soft)` 等），封面渐变保留（三格式固定渐变更利于识别，不随主题变——D26）。
- 深色主题核对项：卡片背景、进度条轨道、悬停阴影、移除按钮悬停色在 `data-theme="dark"` 下的可读性。
- 响应式：`@media (max-width: 760px)` 书架网格 3 列 → 2 列（与基线一致）。
- **过渡动画（2026-10-21，缓解「书架重进卡顿」用户反馈）**：`.loading-overlay` 居中加载遮罩（`.loading-card` = 旋转 `.spinner` + 文案，`@keyframes spin`）；`.leaving` 220ms 淡出后卸载；`.app-toast` 退出保存轻提示（`exitSaving`）；`.shelf-card` 入场动画与 `:active` 按压缩放；`.shelf-bar i` 过渡。状态栏 `savedFlash` 右区「进度已保存 ✓」由 `StatusBar.tsx` 渲染。

### 5.11 G4 侧栏显隐（可选）

- 键 `bookeditor.ui.v1`：`{ "tocOpen": true }`。
- `EpubViewer` 侧栏渲染条件 `toc.length > 0 && uiTocOpen`；侧栏标题栏加一个折叠按钮；状态读写走一个新的 `uiPrefs.ts`（或并入 library.ts 的轻量封装）。
- 若迭代排期紧，G4 可整体后移，不影响 G1–G3 验收。

## 6. 测试计划

### 6.1 单元测试（vitest）

`library.test.ts`：默认空库、读写回、`upsertEntry` 新增、同 path 去重更新（lastOpen 刷新、position 覆盖）、50 条上限淘汰最旧、lastOpen 倒序、损坏 JSON 回落 `[]`、version 不符回落、`removeEntry`、`clearLibrary`、`reportPosition` 只更位置不刷 lastOpen、`format` 白名单外丢弃、ratio/progress 钳制、`subscribeLibrary` 同页广播与取消、`formatRelativeTime` 各区间。

`chapterWindow.test.ts` 增加 `getAnchor` 用例：滚动到不同章节时 anchor.sectionIndex 正确；探针在章内不同位置 ratio 正确且钳制；无 views 返回 null。

### 6.2 构建与类型

`npx tsc --noEmit`、`npm test`、`npm run build`、`wails build` 全绿；`wails build` 后确认 `frontend/wailsjs/go/main/App.js` 含 `OpenBookPath`、models 含 `modTime`。

**实测（2026-10-20）**：vitest 64/64（`library` 18 + `chapterWindow` 12 含 getAnchor 3 项 + 其余既有用例）；`tsc --noEmit` 通过；`vite build` 通过；`go test ./...` 通过；`wails build` 产出 `build/bin/book-editor.exe`（约 15 MB），绑定含 `OpenBookPath`/`modTime`。

**回归（2026-10-21，离场节点版）**：vitest 64/64；`tsc --noEmit` 通过；`go test ./...` 通过；`wails build` 产出 `build/bin/book-editor.exe`（13.6 MB）。

### 6.3 GUI 冒烟（`e2e/smoke_shelf.py`）

复用 `smoke_settings.py` 的驱动与键盘导航范式：

1. 打开 12.epub → 滚动/翻章 → 点工具栏「书架」回欢迎页 → 截图验证书架卡片出现（sm-shelf-01）；
2. 点卡片续读 → 验证对话框不出现、书打开（sm-shelf-02）；
3. 悬停移除（坐标法：卡片区右上角逐卡扫描 × 位置）→ 卡片消失（sm-shelf-03）；
4. 高级页清空（二态确认）→ 书架区隐藏（sm-shelf-04）；
5. 关应用重开 → 验证欢迎页书架仍在（A27 持久化）。

如实说明：**A29–A31 的位置恢复以截图 + 人工核对验收**（e2e 无 DOM/OCR 能力）；`e2e/verify_positions.py` 自动化跑完流程并留档前后截图，A29 另加章节级自动判定（状态栏章名区域像素比对，实测同章 mad=0.000、异内容 mad≈5.9，阈值 1.0）。按 2026-10-20 用户确认口径：A29 只要求**同章**（章节级），PDF（A30）/TXT（A31）实测像素级一致。

**实测结果（2026-10-20）**：`smoke_shelf.py` **13/13 通过**（基线清空、回书架标题、卡片出现、进度条填充已上报、续读不弹框、续读书打开、悬停移除、A28 重复打开、A28 去重、A34 二态确认清空、A27 重建条目、A27 重启回欢迎页、A27 重启书架保留）；`verify_positions.py` 三格式全部跑通——A29 EPUB 章节判定 PASS（mad=0.000）+ 截图确认同章（推荐序二，章内漂移 369px = D32）；A30 PDF 前后均第 2/3 页、像素级一致；A31 TXT 前后比例一致、像素级一致。

**回归（2026-10-21，离场节点版 + 探针同源修复）**：`smoke_shelf.py` 13/13；`verify_positions.py` A29 mad=0.000 PASS、A30/A31 留档一致；`verify_flush.py` 三场景 PASS（见 6.5）。

### 6.5 离场节点 flush 验证（`e2e/verify_flush.py`，2026-10-21 新建）

三个场景全部用「改变位置后**不等任何周期立即离场**」稳定复现旧缺陷（旧 flush 只读 debounce 缓存，缓存未触发即丢位置）：

- **flush-A（点书架，TXT）**：打开 → Page Down ×5 → 立即点书架 → 书架卡片进度填充 > 20px（旧行为 0）→ 点卡能续读。实测 PASS。
- **flush-B（WM_CLOSE 退出，TXT）**：打开 → Page Down ×5 → 立即 WM_CLOSE（触发 Go `OnBeforeClose` → flush-request 链路）→ 等退出 → 重启 → 书架进度 > 20px + 续读后与关闭前**像素级一致**（`ImageChops.difference` 无差异区）。实测 PASS。
- **flush-C（WM_CLOSE 退出，EPUB）**：打开 → Page Down ×3 → WM_CLOSE → 重启 → 点卡续读 → 状态栏章名 mad < 1.0（同章）。实测 PASS（mad=0.000）。
- flush-C 曾误报 FAIL（mad=4.963）：根因是章名探针（视口顶 +72px）与 flush 锚点（视口中线）不同源，滚动过渡态两探针分处不同章——非数据错误，已按 D33 统一探针修复。

### 6.4 位置恢复核对（`e2e/verify_positions.py`）

三格式各执行：打开 → 确定性改变位置（EPUB/TXT 用正文聚焦 + Page Down，PDF 翻页）→ 截图 A → 回书架（点书架 = 离场节点 flush）→ 点卡片续读 → 截图 B。v1.2 起不再有 debounce 等待（记录时机收敛为离场节点，D34）。环境注意事项：

- QQ/微信通知弹窗会盖住屏幕右上角的应用窗口区（书架/齿轮按钮），导致点击落空：脚本在 `open_file` 后统一 `move_to(40, 60)` 移窗到屏幕左侧，书架/齿轮点击带 3 次重试。
- 滚轮事件可能被弹窗中途偷走（实测导致上报位置早于视觉位置），位置改变一律用键盘 Page Down，鼠标只用于点击。
- TXT 样本需用长文本（内置 `sample-utf8.txt` 仅 3 行滚不动），脚本用 `e2e/fixtures/long-sample.txt`（600 行）。
- 截图时避开屏幕右下角系统提示条（曾污染判定区）；A29 章名判定区为窗口右下 `(W-630, H-30, W-40, H)`。

## 7. 验收标准

沿用方案第 6 章 A27–A34，验证方式：

| 编号 | 验证方式 |
|---|---|
| A27 书架记录与重启保留 | 冒烟步骤 1+5 + 截图 |
| A28 去重 | 单测 + 冒烟（重复打开后卡片数不变） |
| A29 EPUB 位置恢复 | 真书人工 + 自动判定：滚到中部退出 → 书架续读，截图核对同章（章节级口径，2026-10-20 用户确认；章内比例最佳努力，实测章内漂移 369px = D32）；mad 自动判定要求章名探针与 flush 锚点同源（D33） |
| A30 PDF 页码恢复 | 同上（翻到第 N 页） |
| A31 TXT 位置恢复 | 同上 |
| A32 书架续读不弹框 | 冒烟步骤 2 |
| A33 失效文件 | 手动：删文件后点卡片，错误条出现、不崩溃、条目保留 |
| A34 清空 | 冒烟步骤 3+4 + 高级页清空 |

## 8. 已知取舍与偏差记录

| 编号 | 内容 |
|---|---|
| D25 | 书架封面用格式渐变色块 + 书名首字，不取 EPUB 真封面：解包 manifest 取封面资源的成本与失败率（加密书/异常 manifest）不值得在 v0.2.1 承担，留 P2 |
| D26 | HTML 设计基线只有浅色稿：书架实现按 CSS 令牌推导四主题形态，深色态未出设计稿，实现时以令牌与可读性为准 |
| D27 | EPUB 进度为「当前目录下标 / 总目录数」约值：精确进度需要字符级 CFI 与全文长度统计，成本高于收益；UI 标注「约」 |
| D28 | `beforeunload` 不保证触发（taskkill/崩溃）：最多丢失一个节流周期（3s）的位置进度；文档如实标注，不做「退出必然保存」的表述。**2026-10-21 更新**：退出路径已由 Go `OnBeforeClose` 拦截接管（flush-request/flush-done 握手，600ms 超时），「退出软件」节点不再依赖 beforeunload；taskkill/崩溃仍不保证（保留如实表述） |
| D29 | 设置面板清空书架用面板内二态确认，不用 `window.confirm`：与面板既有的「已保存」反馈位一致，避免系统弹窗打断 |
| D30 | 从文件对话框打开已记录的书同样恢复位置：超出「仅从书架打开才恢复」的原始描述，但更符合「重开=续读」的直觉；不欲恢复时可先用移除/清空 |
| D31 | 打开瞬间先用旧 position 占位条目、首次上报后更新：避免「打开后条目位置被清空」的闪烁，代价是多一次写盘 |
| D32 | EPUB 恢复按章节级验收（2026-10-20 用户确认「不需要精准定位，定位到对应章节即可」）：章内比例 + 自校正仍按上报值恢复，但书内图片（`max-width:99%`）异步加载使恢复实例与上报实例存在几何差，实测章内漂移约 369px（12.epub 推荐序二，约 2–3 段）；不再投入字符级/像素级精度 |
| D33 | 章名/侧栏探针与 flush 锚点同源（2026-10-21）：`onVisibleChange` 原用「视口顶 +72px」探针，`getAnchor` 用视口中线，滚动过渡态（上一章尾巴仍在视口顶部、中线已进下一章）两探针分处不同章——flush-C 实测状态栏报「推荐序一」而 flush 锚点与视觉已在「推荐序二」，mad 判定误报 4.963（曾误判为系统提示条遮挡）。已将 `onVisibleChange` 探针统一为视口中线；「当前章」语义 = 阅读焦点（中线）所在章 |
| D34 | 记录时机收敛为离场节点（2026-10-21 用户口径「只定位到用户退出软件和点击书架的时间节点」）：退出软件 / 点击书架 / 切书三处同步取实时位置写库，阅读中不周期性写库。实现为 Viewer getter（`getterRef` 挂载注册/卸载置 null）+ Go `OnBeforeClose` 拦截；放弃了 v1.1 的 scroll debounce 上报（持续滚动时定时器不断重置，停止不足 3s 即离场会丢位置——「直接退出/点书架记录不更新」缺陷根因） |
| D35 | 退出 flush 等待放后台 goroutine + 600ms 超时（2026-10-21）：`EventsEmit` 的 ExecJS 经 PostMessage 派发，WM_CLOSE 处理线程（消息循环）内阻塞等待会死锁；`Quit` 会二次进入 `OnBeforeClose`，用 `quitting` 标志放行。等待期间前端显示「正在保存阅读进度…」轻提示 |

## 9. 任务顺序与完成定义

| 顺序 | 任务 | DoD |
|---|---|---|
| T1 | `library.ts` + 单测 | 3.4 函数面用例全绿（含淘汰/广播/钳制） |
| T2 | Go 侧 `OpenBookPath` + `ModTime` | `go test ./...` 通过；对话框打开无回归 |
| T3 | 采集：`getAnchor` + 三 Viewer 上报 | 单测 + 真书滚动/翻页/文本滚动产生合法 position；无高频写盘 |
| T4 | 恢复：三 Viewer + App 编排 | T4 DoD：EPUB 同章（章节级口径）；PDF 同页；TXT 接近；真书多轮滚动回归无恶化（窗口化缺陷观察项） |
| T5 | 退出/切书 flush | 离场节点三路径（退出软件经 OnBeforeClose / 点书架 / 切书）实时取位置落库；`verify_flush.py` flush-A/B/C 全 PASS（2026-10-21 实测） |
| T6 | 书架 UI + 设置行 + 样式令牌化 | 与 HTML 基线结构一致；四主题截图核对；深色可读 |
| T7 | 全量测试 + 冒烟 + 文档回写 | 单测全绿、tsc/build 通过、`smoke_shelf.py` 通过；整合文档 5.5/8.1/8.4/9.2 回写；本文档状态更新 |

## 10. 遗留问题（不在本版解决）

- **EPUB 章节窗口化滚动卡死缺陷未修**：T4 的恢复逻辑会新增 `display + 滚动` 路径，必须做真书多轮滚动回归；若卡死复现，优先修窗口化再合入位置恢复，不带缺陷叠加功能。（状态：v0.2.0 起 EPUB 白屏/挂起类缺陷已修复并回归，v0.2.1 三格式回归未复现卡死；窗口化本身继续观察。）
- EPUB 章内像素级恢复（字符级 CFI 或全流坐标）：用户已确认章节级即可（D32），不再投入。
- taskkill / 崩溃场景的位置丢失：Go 侧无法拦截 SIGKILL，属预期上限（D28/D35）。
- 真封面、阅读统计、排序自定义（P2）。
- 侧栏宽度记忆（G4 只做显隐）。
