# BookEditor v0.3.0 —— 标记记录模块 开发方案

> 状态：**T1–T12 实施完成 + D76–D97 真机反馈修复与体验增强**（2026-11-21）。
> 提交链：T1–T9 = `2ad7218`–`a575152`，T10 = `a31f2c0`；D76/D77 = `d4abaf6`，D79 = `f354434`，D80 = `2aeaf8a`，D81 = `17a9a11`，D82 = `b5c4048`，D83 = `d63b9b5`，D84 = `b53604b`，D85 = `935adec`，D85补/D86 = `0ec65ba`，D87 = `5bf6e47`，D88 = `da777f2`，D89 = `8cf60c7`，D90 = `510c97f`，D91 = `ef5a4ec`，D92 = `93f5eea`，D93 = `62aceec`，D95 = `967da35`，D96/D97 = `aaac6c7`。**D94 未单独构建/提交**，其 `.content{min-width:0}` 保险并入 D95。
> 验证：`tsc --noEmit` PASS；`vitest run` 221 例全绿（marks 50 例，含 D76/D77 回归 2 例与 D96 章节组织 5 例；settings 补 6 例）；`go test ./...` ok；`wails build -platform windows/amd64` 成功（最新交付 `build/bin/book-editor-D98.exe`）。A83–A97 真机 GUI 断言：A91 已由 `smoke_marks.py` 自动化；A95 部分经真机确认（D88 翻页正文加载、D91 目录层级），EPUB 高亮 annotations 终验仍待；其余待真机执行。
> 取证通道：D87 起 EPUB 诊断自动节流落盘到 exe 同目录 `epub-diag.log`（`utils/epubDiag.ts` + Go `DiagLogPath()`/`WriteDiagLog()`），不再依赖点按钮；D76–D95 全部修复均据该日志定位。
> 视觉基线：`doce/BookEditor-前端界面示例-v0.3.0-标记记录.html`（可交互；**§4.11 面板形态已由 D95 改为弹窗浮层，HTML 基线此点未同步更新**）。
> 上游版本：v0.2.9（PDF 显示优化，A67–A74 待真机）。本版以在三个 Viewer 内挂载划词监听与高亮渲染为主：TXT 渲染层按 D68 改片段数组，PDF 按 D73 退化为页级，Go 侧零改动。
> 需求来源：用户 2026-11-21 要求 —— ① 阅读中可对正文做标记（划词高亮）；② 可记录阅读感悟（笔记）；③ 标记与感悟可按书管理、跳转回原文、可导出。

---

## 1. 需求拆解与功能编号

| 编号 | 需求 | 本版口径 |
|---|---|---|
| **F31** | 划词高亮 | 选中正文 ≥ 8 字符时弹出**标记工具条**（4 色圆点 + 写感悟 + 复制），点色点即落库高亮 |
| **F32** | 阅读感悟 | 高亮可附带笔记；「写感悟」编辑器引用原文（≤ 3 行）+ 多行输入；纯高亮（无笔记）合法 |
| **F33** | 独立想法 | 面板「＋ 写想法」不依赖选区，以当前阅读位置记录一段自由笔记 |
| **F34** | 标记列表面板 | 340px 弹窗浮层（D95，原方案为右侧抽屉）：按章节分组、组内时间倒序；条目含色条、原文摘录、感悟预览、相对时间 |
| **F35** | 跳转定位 | 点列表条目跳回原文：EPUB `display(cfi)` / TXT 字符偏移定位 / PDF 页码定位；目标高亮闪烁 1.6s |
| **F36** | 筛选与搜索 | 面板内关键词搜索（原文 + 感悟）+ 筛选 chips（全部 / 有感悟 / 四色） |
| **F37** | 导出 | 按书导出 Markdown（书名 → 章节 → 原文/感悟/位置），支持复制到剪贴板与下载 `.md` |
| **F38** | 管理 | 单条编辑 / 复制 / 删除；「清空本书标记」二次确认（沿用 v0.2.8 对话框口径）；移除/清空书架记录时联动清理 |

---

## 2. 现状（据代码核实）

| 面 | 现状 | 影响 |
|---|---|---|
| 书架存储 | `utils/library.ts`，键 `bookeditor.library.v1`，订阅广播（同页 listeners + storage 事件） | 标记数据**独立建文件**，沿用同一订阅范式，不混入书架条目 |
| 位置模型 | `ReadingPosition` 已含 EPUB `cfi?` / TXT `anchor`（字符偏移）/ PDF `page` | 标记定位复用同一套定位原语，无需新概念 |
| TXT 渲染 | `TextViewer.tsx` 以 `pre.txt-viewer` 整篇渲染，anchor = `round(ratio * text.length)` | 高亮需改为**片段数组渲染**（偏移字号无关，字号变化无需重算） |
| EPUB 渲染 | `EpubViewer.tsx` 用 epubjs 0.3.93 `rendition`；`hooks.content` 已用于阅读主题注入/禁内层滚动/快捷键转发 | 高亮走 `rendition.annotations`（SVG 覆盖层在宿主文档，宿主 CSS 直接生效，无需注入）；跳转走 `rendition.display(cfi)`（现有 resume 已在用） |
| PDF 渲染 | `PdfViewer.tsx` 纯 canvas 渲染（无 pdfjs textLayer） | 高亮退化为**页级标记**（D73，见 §3.2），正文渲染链路不动 |
| 设置 | `settings.ts` v4，键 `bookeditor.settings.v4`，v0.2.9 起新增字段不改 version（D67） | `markEnabled` 以可选字段追加，缺省 `true` |
| 快捷键 | `readerHotkeys.ts` 动作映射 + `dispatchReaderCommand`；Ctrl+O 已有前端拦截先例 | 新增全局 `Ctrl+M` 开关面板，与 Ctrl+O 同一拦截层 |
| 删除记录 | `removeEntry` / `removeEntries` / `clearLibrary`（library.ts） | App 层 handler 串联清理 marks，避免 utils 间循环依赖 |
| 退出 flush | Go `OnBeforeClose` → `app:flush-request` → 前端 `flushCurrent` → `app:flush-done` | **marks 不纳入 flush**：每次标记操作即时写盘（见 D69） |
| EPUB 诊断（实施期新增） | `utils/epubDiag.ts`（D79）环形缓冲 200 条；Go `DiagLogPath()`/`WriteDiagLog()`（D87）写 exe 同目录 `epub-diag.log` | 400ms 节流落盘，生产构建无需点按钮取证；D76–D95 全部修复均据该日志定位 |

---

## 3. 数据契约

### 3.1 标记模型（新增 `utils/marks.ts`）

```ts
export type MarkColor = "yellow" | "green" | "blue" | "pink";

/** 三格式定位器：EPUB 用 CFI，TXT 用字符偏移，PDF 用页码（quote 恒空，D73） */
export type MarkLocator =
  | { kind: "epub"; cfi: string; href: string; chapter: string }
  | { kind: "txt"; start: number; end: number }
  | { kind: "pdf"; page: number; quote: string };

export type Mark = {
  id: string;              // 主键：Date.now().toString(36) + 随机后缀
  bookPath: string;        // 归属图书（书架 path 主键）
  color: MarkColor;
  text: string;            // 划选原文（独立想法为空串）
  note: string;            // 感悟（可空串 = 纯高亮）
  locator: MarkLocator;
  idea?: boolean;          // true = 独立想法（无对应原文）
  createdAt: number;       // unix 秒
  updatedAt: number;
};

export const MARKS_KEY = "bookeditor.marks.v1";   // { version: 1, marks: Mark[] }
export const PER_BOOK_LIMIT = 500;                // 单本上限（D66）
export const TOTAL_LIMIT = 2000;                  // 总上限
```

- `loadMarks(): Mark[]`、`bookMarks(path): Mark[]`、`addMark`、`updateMark(id, patch)`、`removeMark(id)`、`removeMarks(ids)`（批量单次写盘，D59 口径）、`clearBookMarks(path)`、`clearAllMarks()`、`subscribeMarks(fn)`。
- `normalizeMark` 逐字段校验：`color` 白名单外回落 `yellow`；`locator` 结构不合法整条丢弃；`text` 超长（> 2000）截断；旧数据（无字段）静默兼容。
- 上限淘汰：单本超 500 删最旧；总量超 2000 按 `updatedAt` 删最旧。淘汰在 `addMark` 时静默执行，不弹确认（与书架 50 条淘汰同口径）。
- 导出纯函数（可单测）：`exportMarksMarkdown(bookName: string, marks: Mark[]): string`；分组标题取 `locator.chapter`（EPUB）/「第 N 页」（PDF）/「全文」（TXT）。

### 3.2 三格式划词与定位

| 格式 | 取选词 | 定位原语 | 高亮渲染 | 跳转 |
|---|---|---|---|---|
| EPUB | 宿主 `stage` mouseup → 遍历 iframe `contentDocument` 取 `getSelection()` → **CFI**（epubjs 0.3.93 range→CFI 实测可用） | `{cfi, href, chapter}` | `rendition.annotations.add(type, cfi, {id}, cb, "mark-hl mark-hl-*", fill)` 增量 diff；未渲染章节经 `hooks.render.inject` 补挂 | `rendition.display(cfi)`（resume 已在用；href 亦可，作降级） |
| TXT | 宿主 `getSelection()` → TreeWalker 累计字符偏移（与现有 anchor 口径同源） | `{start, end}`（字号无关） | 渲染层按偏移拆 `<mark data-mark-id>` 片段 | `scrollTo` 对应片段元素 + 闪烁 |
| PDF | **无划词**（D73：纯 canvas 渲染，无 textLayer）；页级「标记本页」悬浮按钮 | `{page, quote: ""}`（quote 本版恒空） | 无页内高亮；按钮 active 态表示当前页已有标记 | 页码翻页（单页）/ 页槽置顶（滚动，复用初始恢复重钉）+ 页级闪烁 1.6s |

- **PDF 能力边界（D65→D73）**：PdfViewer 为纯 canvas 渲染（无 pdfjs textLayer），页内 quote 重匹配高亮本版不做（in-text 高亮列后续候选）；标记退化为「页级」——text 空、非 idea、定位器只记页码，面板按「第 N 页」分组、导出含位置脚注。跨页/扫描版 PDF 同样只落侧栏页级条目。
- **EPUB annotations 结论（D67）**：`rendition.annotations` 在纵向 scroll（窗口化滚动）模式下经 `hooks.render.inject` 在视图渲染时补挂，高亮不丢，**无需降级**；增量 diff（remove+add）处理新增/换色/删除，想法/空原文条目不挂高亮（collapsed CFI 无可见区域，面板条目照常可跳转）。

### 3.3 设置扩展（`utils/settings.ts`）

```ts
/** v0.3.0：标记记录总开关；缺省 true（旧配置零回归，D67 口径） */
markEnabled: boolean;
/** v0.3.0：新标记默认高亮色；四色白名单，缺省 "yellow"（T5 随面板落地） */
markDefaultColor: MarkColor;
```

- 存储键与 version 不变（`bookeditor.settings.v4` / 4）；`normalizeSettings` 增 `markEnabled: typeof r.markEnabled === "boolean" ? r.markEnabled : true` 与 `markDefaultColor` 白名单校验（非法值回落 `yellow`）。
- 关闭后：划词不弹工具条、Ctrl+M 无面板、正文已有高亮**照常显示**（关闭只影响新增，与「删除需显式操作」一致）。
- `markDefaultColor` 为 T5 实施期新增（HTML 基线「默认高亮颜色」设置项）：工具条色点初始选中、PDF「标记本页」按钮、「＋ 写想法」均以它作为初始色。

### 3.4 不变项与实施期变更

- **Go 侧无业务改动，但 D87 新增两个只读诊断绑定**：`app.go` / `main.go` / `SupportedExts` 的图书读取逻辑不变；仅新增 `DiagLogPath()` 与 `WriteDiagLog(text)` 用于写 `epub-diag.log`（`wailsjs/go/main/App.js` / `App.d.ts` 同步补签名）。方案阶段「无新增绑定」的口径被取证需求打破，如实记录（见 D87）。
- `library.ts` 数据结构不变（不加 `marks` 字段，见 §2 理由）。
- 退出 flush 链路（`flushCurrent`）不纳入 marks（D69）。

---

## 4. 交互口径（与 HTML 示例逐条对齐）

**划词与高亮**
1. 选中正文 ≥ 8 字符（`sel.toString().trim().length`）才弹工具条；低于阈值或点空白处只清除选区。
2. 工具条浮于选区上方（空间不足时翻到下方）：4 个色点 + 「写感悟」+ 「复制」。色点 hover 显示色名（黄/绿/蓝/粉）。
3. 点色点 → 即时落库 + 高亮上色 + toast「已标记」；工具条收回。
4. 在已有高亮上再次选词（选区与已标记区间重叠）→ 工具条变为「改色 / 写感悟 / 删除标记」三态，删除需该条目的更多菜单确认（工具条内删除直接生效并 toast「已删除标记」，不二次确认——与单本 ✕ 同口径）。
5. 点击正文中的高亮 → 弹出该条气泡：原文 1 行 + 感悟预览（≤ 2 行）+「编辑」「删除」。**D97 增补**：鼠标悬停高亮（有感悟的条目）稳定 320ms 即浮出只读感悟提示，移开收起；点击仍是完整气泡。
6. 「复制」复制划选原文到剪贴板（复用现有 Ctrl+C 文案链路）。

**写感悟编辑器（MarkNoteEditor）**
7. 入口：工具条「写感悟」、气泡「编辑」、面板条目「编辑」——同一受控组件。
8. 布局：原文引用块（左侧色条，≤ 3 行省略）+ 多行文本域（自动 focus，Enter 直接保存 / Esc 取消，Shift+Enter 换行）+ 色点改色 + 「保存」「取消」。
9. 已有笔记则回显；保存空笔记 = 纯高亮（合法，不删除条目）。
10. 「＋ 写想法」：入口在面板头部；不依赖选区，`text` 为空、`idea: true`，定位取当前阅读位置（无位置时仍可保存，`locator` 记当前页/章节）。

**标记记录面板（MarksPanel）**
11. 入口：工具栏「标记」按钮（带数量徽标）、Ctrl+M；**340px 弹窗浮层**（D95：`.app-body` 内 `position:absolute`，配半透明遮罩，脱离 flex 流、不挤占正文宽度），遮罩点击 / Esc / 「×」关闭。
12. 头部：标题「标记记录」+ 计数 N + 「＋ 写想法」+ 导出按钮 + 「×」。
13. 工具行：搜索框（placeholder「搜索原文与感悟」）+ 筛选 chips：`全部 N` / `有感悟 N` / 四色各 N；搜索与筛选为「与」关系；无结果显示空态「无匹配标记」。
14. 列表按**章节分组**（EPUB 取 `locator.chapter`；PDF「第 N 页」；TXT 统一「全文」），组头显示名称 + 组内计数；组内按 `updatedAt` 倒序。**D96 增补**：EPUB 分组按目录树组织——按阅读顺序排列（父章在前、子节紧随），子节缩进并显示父章面包屑，当前阅读章加「当前章」标识；分组名与目录标签精确不匹配时退回平铺分组，不做模糊归类。
15. 条目结构：色条 + 原文摘录（≤ 3 行省略；独立想法显示「◆ 想法」前缀）+ 感悟预览（≤ 2 行，斜体或引号样式）+ 相对时间（复用 `formatRelativeTime`）+ hover 出现「⋯」更多菜单（跳转 / 编辑 / 复制 / 删除）。
16. 点条目正文区 → 跳转定位 + 目标高亮闪烁 1.6s（`.mark-flash` 动画）；跳转后面板保持打开（不抢焦点）。
17. 底部信息行：「共 N 条 · 有感悟 M 条」；「清空本书…」入口，二次确认面板显示书名与条数（沿用 v0.2.8 ShelfManager 两层面板口径）。
18. 空态（无任何标记）：居中图标 + 「还没有标记」+ 「选中正文即可添加标记与感悟」引导文案。

**导出（导出弹层）**
19. 入口：面板头部导出按钮；弹层 480px：格式单选「Markdown」+ 范围单选「当前图书 / 全部图书」+ 预览框（前 40 行）+ 「复制到剪贴板」「下载 .md」。
20. 下载文件名：`{书名}-标记.md`（书名取自书架条目 `name` 去扩展名）；复制成功 toast「已复制 N 条标记」。
21. Markdown 结构：`# 《书名》标记记录` → `## 章节名` → 每条 `> 原文摘录` + `**感悟：**` + 位置脚注（EPUB 章节 / PDF 第 N 页 / TXT 字符区间）。

**其他**
22. 快捷键：`Ctrl+M` 开关面板（设置面板打开时键归面板，同 Ctrl+O 口径）；Esc 关面板（捕获阶段 `stopPropagation`，从设置面板打开时只关最上层——沿用 v0.2.8 分层先例）。
23. 书架联动：`removeEntry` / `removeEntries` / `clearLibrary` 成功后，App 层串联 `clearBookMarks(path)` / `clearAllMarks()`；打开的书被移除时面板即时清空。
24. 多实例同步：marks 走 `subscribeMarks` + storage 事件，与 library / settings 一致。

---

## 5. 逐文件实现

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/marks.ts` | **新增**：`MarkColor`/`MarkLocator`/`Mark` 类型、`MARKS_KEY` 与上限、读写 + normalize、批量 API、订阅、淘汰、`exportMarksMarkdown` 纯函数 |
| `frontend/src/utils/__tests__/marks.test.ts` | **新增**单测：normalize 各分支、批量单次广播、上限淘汰、导出 Markdown 结构（章节分组/感悟空值/位置脚注） |
| `frontend/src/components/MarkToolbar.tsx` | **新增**：划词工具条（新选 / 已选三态）、色点、写感悟、复制、删除；受控 props（x/y/state/onXxx） |
| `frontend/src/components/MarkNoteEditor.tsx` | **新增**：感悟编辑器（引用块 + 文本域 + 改色 + 保存/取消），新建与编辑复用 |
| `frontend/src/components/MarksPanel.tsx` | **新增**：抽屉（头部/工具行/分组列表/条目/更多菜单/底部行/空态）+ 清空二次确认 + 导出弹层 |
| `frontend/src/components/TextViewer.tsx` | 渲染层按 marks 偏移拆 `<mark>` 片段；划词监听（mouseup + 偏移计算）；跳转 `scrollIntoView` + flash |
| `frontend/src/components/EpubViewer.tsx` | 宿主 `stage` mouseup 监听（遍历 iframe contentDocument 取选词，工具条/气泡在宿主 DOM）+ annotations 增量同步（未渲染章节经 `hooks.render.inject` 补挂）；`display(cfi)` 跳转 + 高亮闪烁（两级延迟重试等补挂）。**实施期 D76–D95 大改**：诊断打点、首次 display 前 patch continuous `fill/check`（D80）、DOM 探针 + 空白自愈（D81）、浮动诊断按钮（D82）、resize 基线/恢复（D83）、虚假膨胀过滤 + jump guard（D84）、空壳扉页判定（D85/D86）、像素 resize（D88）、交互打点（D89/D90）、平铺目录层级推断（D90/D91），详见 §7 |
| `frontend/src/components/PdfViewer.tsx` | **D73 页级**：「标记本页」悬浮按钮（无控制条时显形，当前页已有标记时 active）+ 页码定位器；跳转 = 单页翻页 / 滚动模式页槽置顶（复用初始恢复重钉机制）+ 页级闪烁 1.6s |
| `frontend/src/components/BookViewer.tsx` | 透传 marks 相关 props 与三个 Viewer 的标记上下文；书架入口不变 |
| `frontend/src/components/SettingsPanel.tsx` | 新增「标记记录」分组：总开关 + 默认色选择（4 色）+ 说明文案 |
| `frontend/src/App.tsx` | `marks` state + 订阅；`showMarks` state；Ctrl+M 拦截（仿 Ctrl+O，D74 mirror-ref 门控）；flush 不变；书架移除 handler 串联 marks 清理；渲染 `<MarksPanel>`。**D92 加 `MARK_PANEL_TOGGLE` 打点；D95 改为弹窗浮层（`.marks-backdrop` 遮罩点击关闭 + MarksPanel）** |
| `frontend/src/utils/readerCommands.ts` / `readerHotkeys.ts` | **未改动**：Ctrl+M 走 `App.tsx` 窗口级拦截（仿 Ctrl+O，D74），不经阅读器命令层；可选单键 `m` 未做 |
| `frontend/src/styles.css` | `.mark-hl`（四色变体 + `.mark-flash` 动画）、`.mark-toolbar`、`.mark-note-editor`、`.marks-panel`、`.mark-item`、`.mark-export-modal` 等。**实施期追加**：失败页诊断区（D79）、浮动诊断按钮 z-index 1001（D82/D87）、目录层级 `.toc-depth-0/1`（D90/D91）、`.content{min-width:0}`（D94/D95）、`.marks-backdrop` + `.marks-panel` absolute 弹窗浮层 + 滑入动画（D95） |
| `frontend/src/utils/epubDiag.ts` | **D79 新增**：`epubDiag(code,detail)` / `getEpubDiagText(limit)` / `clearEpubDiag()`，localStorage 键 `bookeditor.epub.diag.v1` 环形缓冲 200 条；**D87 增** `scheduleDiskFlush()`（400ms 节流）调用 Go 绑定写 `epub-diag.log` |
| `frontend/src/utils/chapterWindow.ts` | 滚动模式自定义章节窗口管理器；D80 首次 display 前把 continuous `fill/check` patch 为 no-op + 委托 `wmRef.scheduleSync()`；`appendAndDisplay()`/`prependAndDisplay()` 显式 `view.show()` |
| `app.go` / `wailsjs/go/main/App.js` / `App.d.ts` | **D87 新增** `DiagLogPath()` / `WriteDiagLog(text)` 绑定与前端签名（仅诊断落盘，无业务逻辑；见 §3.4） |
| `frontend/src/components/MarksPanel.tsx` | **D92/D93 新增**挂载/卸载打点 + `requestAnimationFrame` 几何命中打点 `MARK_PANEL_RECT`（x/y/w/h/visibility/zIndex/hit），成为 D94 布局挤出定案的决定性证据 |
| `e2e/` | 新增 `smoke_marks.py`（TXT 全流程 9 步：复位 → 划词落库 → Ctrl+M 面板 → 写想法 → 跳转闪烁 → 删除 → 开关幂等 → 总开关 → 书架联动 A91）；A91 联动断言随造标记同流程落在 smoke_marks（原计划放 smoke_shelf，但其移除对象 12.epub 无标记，见 D75）；`smoke_settings.py` nav 坐标随「标记记录」窗格插入修正 |

---

## 6. 验收映射（建议 A83–A97）

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A83 | TXT 选词 ≥ 8 字符 → 工具条弹出，点黄色 → 高亮落库，刷新后仍在 | 手动真机 + 截图 | 🟡 自动化 sm-marks-02（TXT 落库+高亮渲染）；「刷新后仍在」重启持久化待真机 |
| A84 | < 8 字符选词不弹工具条 | 手动真机 | ⏳ 待真机（阈值未脚本化：拖拽长度固定） |
| A85 | 高亮上写感悟 → 保存 → 面板条目显示感悟预览 → 重启应用仍在 | 手动真机 | 🟡 自动化 sm-marks-04（保存+遮罩复原+toast）；重启持久化待真机 |
| A86 | 空感悟保存 = 纯高亮（条目无感悟，筛选「有感悟」不含它） | 手动真机 + 单测 | 🟡 自动化 sm-marks-02（标记即无感悟纯高亮）；chips 过滤联动待真机 |
| A87 | 点面板条目 → 跳回原文位置 + 闪烁 1.6s（三格式各一遍） | 手动真机 | 🟡 自动化 sm-marks-05（TXT 跳转+闪烁环）；EPUB/PDF 待真机 |
| A88 | 搜索「 solitude 」→ 仅剩 1 条；切「有感悟」chips → 计数联动 | 手动真机 | ⏳ 待真机（搜索/chips 未脚本化） |
| A89 | 导出 Markdown → 预览结构正确 → 下载 `《溪畔笔记》-标记.md` | 手动真机 | ⏳ 待真机（导出弹层未脚本化）；导出纯函数有单测 |
| A90 | 清空本书 → 二次确认显示条数 → 确认后列表空、书架记录保留 | 手动真机 | ⏳ 待真机（清空二次确认未脚本化） |
| A91 | 移除书架单本 → 该书标记联动清空（面板无残留） | 手动真机 | ✅ 自动化 sm-marks-09（TXT：移除→重开同 path→高亮不复现） |
| A92 | 设置关闭「标记记录」→ 划词无工具条；已有高亮仍显示；重开恢复 | 手动真机 | 🟡 自动化 sm-marks-08（关闭→无色点→重开恢复）；「已有高亮仍显示」待真机 |
| A93 | Ctrl+M 开/关面板；设置面板打开时 Ctrl+M 归面板 | 手动真机 | 🟡 自动化 sm-marks-03/07（Ctrl+M 开+Esc 关+再开）；「键归面板」待真机 |
| A94 | 单本 500 条上限：连续划词至上限，最旧被淘汰且无卡死 | 手动真机（可脚本灌数） | 🟡 单测覆盖淘汰逻辑（marks.test.ts）；连续划词真机待验 |
| A95 | EPUB 高亮经 annotations 渲染，翻页/切章后高亮仍在；scroll 模式正常 | 手动真机 | 🟡 部分真机确认：D88 翻页正文加载（日志 `len=113151` 持续保持）、D91 目录层级用户已确认；**高亮 annotations 真机翻页/切章后仍在那一项未终验** |
| A96 | PDF 页级标记：按钮落库/active 态；滚动出页再回来；跨页选词降级为侧栏条目 | 手动真机 | ⏳ 代码完成（D73 页级口径）；真机终验待执行 |
| A97 | EPUB 翻页模式划词 → 工具条弹出 → 点颜色/写感悟落库（D89） | 手动真机 + `epub-diag.log` 打点 | ⏳ **未验证**：D89 提升 `.mark-toolbar` z-index 并加 `SELECTED_EVENT`/`TOOLBAR_SHOW`/`TOOLBAR_ACTION` 打点，但用户历次回传日志均无划词链路打点；需完成一次「翻页划词 → 点颜色」并回传新日志方可定案 |

**自动化覆盖（实施后回填）**
- 单测：`marks.test.ts` 45 例（normalize / 批量广播 / 淘汰 / 导出结构；D77 新增 2 例 EPUB 独立想法空 cfi 回归）；`settings.test.ts` 补 `markEnabled` 缺省迁移 + `markDefaultColor` 白名单共 6 例；`vitest run` 合计 216 例全绿。
- e2e：`smoke_marks.py` 9 步（sm-marks-00–09），覆盖 A83（TXT）/ A85 / A86（部分）/ A87（TXT）/ A91 / A92 / A93（口径见上表）；A84 / A88 / A89 / A90 / A94（真机部分）/ A95 / A96 / A97 待真机。运行前需 `wails build` 刷新 exe（T10 时构建 `book-editor.exe`，D95 最新交付为 `book-editor-D95.exe`）。

---

## 7. 偏差与风险（实施期如实回填）

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D65 | PDF 正文高亮与 EPUB 同精度 | **已被 D73 取代**：原「页内 quote 重匹配」方案因 PdfViewer 纯 canvas（无 textLayer）不成立，最终落地为页级标记 | 保留本行备查；实际口径以 D73 为准 |
| D66 | 标记不限量 | 单本 500 / 总量 2000，静默淘汰最旧 | localStorage 预算约 5MB；按单条 ~600B 估算 2000 条 ≈ 1.2MB，与书架/设置共存安全 |
| D67 | EPUB annotations 即插即用 | **成立，无需降级**：annotations 增量 diff（remove+add 处理新增/换色/删除）；`add` 只对已渲染视图挂载，未渲染章节由 epubjs `hooks.render.inject` 在视图渲染时补挂（注册时序已核实：annotations 钩子先于本项目 hooks.content 注册）；想法/空原文条目不挂高亮 | scroll（窗口化滚动）模式下翻页/切章高亮不丢；真机终验列 A95 |
| D68 | TXT 高亮不动渲染层 | 改为**片段数组渲染**（偏移字号无关，与 anchor 口径一致；字号变化不触发重算） | `pre` 整篇文本无法局部高亮；渲染拆分后选区偏移计算需同步改为 TreeWalker（同一函数供划词与跳转共用） |
| D69 | marks 随退出 flush 落库 | **即时写盘**，不纳入 `flushCurrent` | 标记是低频显式操作，每次操作即落盘语义更简单；flush 链路已为 position 定制，混入会增加时序复杂度 |
| D70 | 删除书记录同步删标记 | App 层 handler 串联（`handleRemoveEntry(s)` / `handleClearLibrary` 内调用 marks 清理） | 避免 `library.ts ↔ marks.ts` 循环依赖；与 v0.2.8「批量单次广播」经验一致，UI 无中间态 |
| D71 | 导出仅 Markdown | 本版仅 `.md`（复制 + 下载）；JSON/HTML 导出列后续 | Markdown 可被主流笔记软件直接导入，优先级最高 |
| D72 | 想法条目也参与分组 | 独立想法归入「想法」分组，置顶显示 | 与章节分组正交；避免想法混入章节序列破坏跳转语义（想法无原文可跳） |
| D73 | PDF 与 EPUB 同精度 quote 高亮（D65 原口径） | **页级退化**：PdfViewer 纯 canvas 渲染（无 pdfjs textLayer，方案 §2 现状描述有误，已修正），页内 quote 重匹配本版不做；「标记本页」悬浮按钮落 `{page, quote:""}`，面板按「第 N 页」分组；跳转 = 翻页/页槽置顶 + 页级闪烁 1.6s | textLayer 缺失是渲染架构事实（非实现疏漏）；in-text 高亮列后续候选；跨页/扫描版同样只落页级条目 |
| D74 | Ctrl+M 走 readerCommands 命令层（§5 计划行） | **App.tsx 窗口级拦截**（仿 Ctrl+O 先例）：`noteEditMirrorRef` / `showShelfManagerRef` mirror-ref 门控，避免 effect 单次注册的闭包陈旧——实施期自查发现「编辑器/书架管理打开时 Ctrl+M 穿透切换面板」并修复 | readerHotkeys 是阅读器内键位体系（焦点需在阅读区）；窗口级拦截才能满足 §4.22「设置面板打开时键归面板」；可选单键 `m` 未做 |
| D75 | A91 联动断言放 smoke_shelf.py（§5 计划行） | 落 **smoke_marks.py 步骤 9**：smoke_shelf 的移除对象 12.epub 无标记，补断言需先造标记；smoke_marks 与造标记同流程，且 TXT 绿封面可去坐标化定位（列密度+行跨度结构判据滤徽标） | 副作用：步骤 9 整类移除书架全部 TXT 卡（无法按书名区分），冒烟环境可接受（smoke_shelf 起始即清空书架） |
| D76 | `displayError` 一律判整本解析失败 | 新增 `failOnDisplayError` 标志，两处 `applyResume()` 调用前置 false / 后置 true，只让首章加载阶段的 displayError 判失败 | 旧 CFI/href 恢复失败本可降级，原逻辑误判为整本 EPUB 损坏 → 白屏 |
| D77 | 独立想法 EPUB 无 cfi 也能存 | `normalizeMark` 对 `idea=true` 且 epub 空 cfi 补占位 `epubcfi(/)`；划词标记空 cfi 仍拒绝 | 原 `normalizeLocator` 整条丢弃，写想法保存后立刻从面板消失（0 条）；新增 2 例回归测试 |
| D78 | display() 在无 GUI 下挂起 | 仅 jsdom 观测，未在 WebView2 确认 | 如实记录：jsdom 无真实 iframe 渲染，挂起属环境限制，不作产品结论 |
| D79 | Wails 生产构建无可见日志 | 新增 `utils/epubDiag.ts`（localStorage 环形缓冲 200 条）+ 失败页「查看诊断日志」按钮/复制 | 用户拿不到 FAIL 触发点，无法据日志定位；后续 D80–D95 全部依赖此通道 |
| D80 | 首次 display 前未接管 continuous 补章 | 首次 display 前 patch `fill=Promise.resolve()`、`check=()=>{wmRef?.scheduleSync();return Promise.resolve(false)}`（打点 `PATCH_FILL_CHECK`）；page 模式不 patch | `display()` Promise 既不 resolve 也不 reject，10s 超时；根因 continuous manager 递归 `fill/check` 卡住（本书首章在 spine index 12） |
| D81 | applyResume 二次 display 清正文后无补救 | applyResume 后 `settleAndCheck` 复检，确认空白则重新 `display(startTarget)` 捞回；新增 `probeEpubDom` 探针 | 日志证实 display 成功后 views 被清空致纯白；D80 修好首次后该问题才暴露 |
| D82 | 诊断按钮放在目录标题内，滚动后滚出视口点不到 | 改右下角固定浮动按钮 `.epub-diag-fab`；`jump()` 加 `JUMP_*` 打点 + after-jump DOM 探针 | 连续多版未根治，先修取证 UX 并补探针，不盲改渲染逻辑 |
| D83 | 假设 resize 尺寸未变会提前返回 | **推翻该假设**：epubjs `DefaultViewManager.resize()` 无条件 `clear()`；`onResized()` 靠 `location.start.cfi` 自愈，首章刚 display 时 location 未就绪 | ResizeObserver 首次回调 / window resize 清空 views 后无恢复路径，两模式都空白；修为 RO 基线 + `resizeWithRecovery()` 复检重显 |
| D84 | ResizeObserver 观察 container 即可 | 三层防护：忽略 `w > innerWidth+200` 虚假膨胀且不污染 baseline；忽略高度 <40px 抖动；`jumpResizeGuardRef` jump 后 1.2s 禁 resize | 跳章时 paginated iframe 宽度瞬时撑到 43764px，RO 误判容器变宽，两次 clear 后回首章空壳 |
| D85 | settle 判据 `text.length>0` 即有正文 | 翻页模式首章 strict settle 后读文本长度，`0<=len<80` 判空壳扉页，强制 `state=false` 走跳章循环 | 本书首章是书名扉页（len=25）被误判有正文；滚动模式有窗口管理器补齐相邻章节故不受影响 |
| D85补/D86 | D85 空壳判定被抵消 + resume 二次 display | ① 提取 `shellCoverCheck()`，strict / loose / 跳章循环三处复检统一应用；② 打开流程内跳章前设 `jumpResizeGuardRef=now+1500`；③ 恢复位置指向空壳扉页时跳过 applyResume（`RESUME_SKIP_SHELL`） | D85 的 state=false 被 loose 复检重新判回 true；日志 `RESUME href=split_011` 正指向扉页，跳章后又被 display 拉回——即用户所见「一瞬间后消失」 |
| D87 | 诊断按钮 z-index 31 被 loading-overlay 900 覆盖 | Go 新增 `DiagLogPath()`/`WriteDiagLog()`；`epubDiag.ts` 加 400ms 节流自动落盘；按钮/日志面板 z-index → 1001 | 按钮显示一下就消失、点不到；建立不依赖点击的落盘日志通道 |
| D88 | `rendition.resize("100%","100%")` | 改像素尺寸：新增 `resizeRenditionToContainer()`，用 `getBoundingClientRect()` 实测 floor 像素传给 resize；类型签名放宽为 `string\|number` | 日志证实宽度按数量级暴涨（39596→435556→6176976→22369398px）：`stage.size()` 写 `style.width="100%"`，在 overflow:hidden + 超宽 iframe 下形成正反馈。**用户日志已确认修复成功**（`len=113151` 持续保持） |
| D89 | 翻页划词工具条按钮点击无效 | `.mark-toolbar` z-index 40→1002、`.mark-bubble` 41→1003；加 `SELECTED_EVENT`/`TOOLBAR_SHOW`/`TOOLBAR_ACTION`/`MARK_DISMISS` 打点 | 滚动正常、仅翻页异常；推断 iframe `translateZ(0)` 合成层拦截点击（**推断，未实证**）；用户历次日志均无划词打点，**修复仍未验证，不得宣称已修好** |
| D90 | 目录层级只识别中文小节 | `tocDepth()` 扩英文 `part/section/appendix` 规则；`selected` 回调加 `SELECTED_EVENT` 打点 | 样本 Part 1/2 能降级，但用户反馈「目录只修复了一部分」 |
| D91 | D90 只修一部分 | 解析样本 `toc.ncx`：**源文件 76 项全平铺、无嵌套**，epubjs depth 恒 0；新增 `isSubItemLabel()`+`inferTocDepths()`，按 自带 depth→标题模式→href `#` 锚点→无锚点首项 推断（本地模拟 76→23 父/53 子） | 原书层级信息缺失，无法 100% 还原；个别落分页边界且无锚点的故事仍判父项；**用户已确认「目录结构好了」** |
| D92 | 标记面板点击不显示（首次归因层叠） | `.marks-panel` 加 `position:relative; z-index:1004`；加 `MARK_PANEL_TOGGLE`/`MOUNT`/`UNMOUNT` 打点 | 日志证实 toggle/mount 都正常，面板确实渲染；单纯 z-index 无效（**该推断被证伪**） |
| D93 | D92 z-index 无效，改试合成层 | 面板加 `transform:translateZ(0)`；加 `MARK_PANEL_RECT` 几何 + `elementFromPoint` 命中打点 | 第二次层叠尝试仍属推断；RECT 打点成为定案证据 |
| D94/D95 | 面板被合成层遮挡（D92/D93 假设） | **定案：布局挤出**。日志 `MARK_PANEL_RECT x=1266 y=55 w=340 h=708 hit=none`，视口宽 1266 → 面板恰在右边界外；根因 `.content` flex item 默认 `min-width:auto` 被超宽 iframe 撑满。用户决策改**弹窗浮层**：`.app-body{position:relative}`、`.marks-panel{position:absolute;right/top/bottom:0}`、新增 `.marks-backdrop` 遮罩、保留 `.content{min-width:0}` 保险 | D92 z-index / D93 合成层两次层叠尝试均无效；**教训：渲染了但看不见，先量几何位置再判断是否层叠**。副作用消除：开关面板不再改正文宽度、不再触发 ResizeObserver/resize |
| D95 状态 | 面板弹窗化后的真机视觉 | 已构建、提交、交付 `build/bin/book-editor-D95.exe`；**用户尚未确认最终视觉与关闭交互** | 如实记录待确认；D89 划词问题仍未验证 |
| D96 | §4.14 分组口径「按章节分组、组内时间倒序」，分组顺序为首次出现顺序 | **按目录树组织**：`EpubViewer` 经 `tocNodesWithPath()` 回传 `{href,label,depth,order,labels}` 树路径（走 `onTocContext` → App `tocCtx` → 面板）；`marks.ts` 新增 `markChapterPaths()`（按 `locator.chapter` **精确匹配**目录标签反查路径，不模糊猜）与 `sortChapterGroups()`（按 order 字典序，父章→子节；无路径分组殿后）；面板分组加 `.mp-depth-0/1/2` 缩进、父章面包屑 `.gpath`、当前章 `.gcur` 标识 | 用户反馈「标记可以按章节显示吗」——原实现虽按 `locator.chapter` 分组，但**顺序是首次出现**、无层级、看不出归属（截图里两个分组平铺同字号）。标签不匹配时宁可不归类（错归档比不归类更误导）；切书/换格式时 App 清空 `tocCtx` 防串书 |
| D97 | §4.5 仅「点击高亮 → 气泡」 | **新增悬停只读提示** `.mark-hovertip`：`bindStageMarks` 增 `mousemove`/`mouseleave` 命中，稳定停留 `HOVER_DELAY_MS=320ms` 才浮出；只对**有感悟**的条目标示（纯高亮无信息可显示）；鼠标移入提示矩形内时保持（`.mark-hovertip` 命中豁免，否则提示会在光标接近瞬间消失、永远点不进）；点击仍走完整气泡（`showBubble` 先 `cancelHover`）；新增 `HOVER_TIP` 打点 | 用户反馈「鼠标悬停标记点可以显示感悟吗」。分页模式 `markClicked` 不变；悬停提示 z-index 1001 低于气泡 1003，两者不叠 |

**风险**
- EPUB iframe 内选词的坐标换算已有先例（`bindStageInteraction` 的 `iframeContentPoint`），工具条定位复用该函数，不新造轮子。
- marks 面板与设置面板可同显（从设置打开时）：层级高于设置面板，Esc 分层关（沿用 v0.2.8 先例）。**D95 改弹窗浮层后，与设置面板同显时的遮罩/层级关系待真机确认。**
- 导出大量标记时 Markdown 字符串拼接在渲染线程同步执行（2000 条 ≈ 数毫秒），可接受；不引入 Web Worker。
- EPUB 翻页模式 epubjs iframe 带 `translateZ(0)` 合成层，跳章瞬间宽度可达数万像素（实测 43764px）；**任何关于层叠/宽度的推断都必须先由 `epub-diag.log` 的几何打点实证**（D84/D88/D93 三次教训）。
- `rendition.resize()` 严禁传百分比字符串（D88 会引发宽度指数暴涨）；参数必须是由 `getBoundingClientRect()` 实测的 floor 像素。
- 平铺 `toc.ncx` 无真实层级信息，D91 只能启发式推断；个别落在分页边界且无锚点的故事仍被判为父项，属已知残留，非实现缺陷。

---

## 8. 实施步骤

| 步骤 | 内容 | 完成判据 | 状态 |
|---|---|---|---|
| T1 | 视觉基线 HTML（`doce/BookEditor-前端界面示例-v0.3.0-标记记录.html`） | 与本文 §4 口径一致，可交互 | ✅ 2ad7218 |
| T2 | `utils/marks.ts` + 单测 | `marks.test.ts` 全绿 | ✅ c265dbf（43 例；与 T3 同提交） |
| T3 | `settings.ts` 加 `markEnabled` + 单测补例 | `settings.test.ts` 全绿 | ✅ c265dbf（3 例；T5 又补 `markDefaultColor` 3 例） |
| T4 | `MarkToolbar.tsx` + `MarkNoteEditor.tsx` | tsc 通过，受控渲染 | ✅ 3de9032 |
| T5 | `MarksPanel.tsx`（列表/筛选/搜索/导出/二次确认） | tsc 通过 | ✅ 0069e91（含 `markDefaultColor`） |
| T6 | `TextViewer.tsx` 划词 + 片段高亮 + 跳转 | 真机 A83/A84/A87 | ✅ 1d11f74（代码；真机见 sm-marks-02/05） |
| T7 | `EpubViewer.tsx` annotations 高亮 + CFI 跳转 | 真机 A95（D67 验证点） | ✅ 1163867（代码；D67 结论已回填，真机终验待执行） |
| T8 | `PdfViewer.tsx` 页级标记与页码跳转（D73） | 真机 A96 | ✅ a9c80a6（代码；真机终验待执行） |
| T9 | `App.tsx` 接线 + Ctrl+M + 书架联动清理 + `styles.css` | 真机 A91–A94 | ✅ a575152（代码；Ctrl+M 闭包陈旧 bug 自查修复见 D74） |
| T10 | `smoke_marks.py` + 真机验收回填 | A83–A96 全过 + 本文 §6 状态回填 | 🔶 smoke_marks.py 9 步 + smoke_settings 坐标修正 + 本文回填完成；A83–A96 真机执行待真实环境跑批 |
| T11 | D76–D95 真机反馈修复（EPUB 打开/空白/resize/目录/标记面板） | 据 `epub-diag.log` 逐版定位 + 用户真机确认 | 🔶 20 版修复已逐版构建提交（D78 仅观测项，未单独修复）；**已真机确认**：D88 翻页正文加载、D91 目录层级、D93→D95 面板布局挤出定案；**待确认**：D95 弹窗视觉/关闭交互、D89 翻页划词工具条（历次日志均无划词打点）；EPUB 高亮 annotations 真机终验（A95）未完成。**D94 未单独构建/提交**，其保险并入 D95 |
| T12 | D96/D97 体验增强：标记按章节组织 + 悬停显示感悟 | tsc/vitest/go test/build 全过 + 真机视觉确认 | 🔶 代码完成并提交 `aaac6c7`，交付 `build/bin/book-editor-D98.exe`；`marks.test.ts` 45→50 例（D96 新增 5 例：路径反查/不猜/想法与 TXT 不归章/顺序/殿后），vitest 221 例全绿；**真机视觉与交互待用户确认**（章节缩进层次、面包屑、悬停 320ms 手感） |

**DoD**：`tsc --noEmit` PASS ✅、`vitest run` 216 例全绿（marks 45 + settings 6）✅、`go test ./...` ok ✅、`wails build -platform windows/amd64` 成功 ✅（最新交付 `book-editor-D95.exe`）、本文 §6/§7/§8 回填至 D95 ✅、D95 弹窗用户确认 ⏳、D89 翻页划词真机验证 ⏳、A83–A97 其余真机通过 ⏳、整合文档 §2/§11/§12 补 v0.3.0 行与 D65–D95 ⏳（下一步，未在本版范围）。

---

## 9. 本期不做（后续候选）

- 多设备云同步（当前纯本机 localStorage，与书架同边界）。
- 标注分享（图片卡片 / 长图）。
- 手写、画笔、区域框选标注（PDF 扫描版另论）。
- 标签体系（多标签归类标记）与标记的 AI 摘要/回顾。
- JSON / HTML 导出（D71 已排期候选）。
- 想法与高亮的互相转换（想法补选原文 → 转高亮）。
