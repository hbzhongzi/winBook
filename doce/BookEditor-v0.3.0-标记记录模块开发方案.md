# BookEditor v0.3.0 —— 标记记录模块 开发方案

> 状态：**方案阶段，代码未实施**（2026-11-21）。
> 验证：暂无（本文为开发前方案；实施后回填 `tsc --noEmit` / `vitest` / `wails build` / 真机验收状态）。
> 视觉基线：`doce/BookEditor-前端界面示例-v0.3.0-标记记录.html`（可交互，交互口径即本文 §4 口径）。
> 上游版本：v0.2.9（PDF 显示优化，A67–A74 待真机）。本版不改动阅读器渲染主链路，仅在三个 Viewer 内挂载划词监听与高亮渲染。
> 需求来源：用户 2026-11-21 要求 —— ① 阅读中可对正文做标记（划词高亮）；② 可记录阅读感悟（笔记）；③ 标记与感悟可按书管理、跳转回原文、可导出。

---

## 1. 需求拆解与功能编号

| 编号 | 需求 | 本版口径 |
|---|---|---|
| **F31** | 划词高亮 | 选中正文 ≥ 8 字符时弹出**标记工具条**（4 色圆点 + 写感悟 + 复制），点色点即落库高亮 |
| **F32** | 阅读感悟 | 高亮可附带笔记；「写感悟」编辑器引用原文（≤ 3 行）+ 多行输入；纯高亮（无笔记）合法 |
| **F33** | 独立想法 | 面板「＋ 写想法」不依赖选区，以当前阅读位置记录一段自由笔记 |
| **F34** | 标记列表面板 | 右侧抽屉（默认 340px）：按章节分组、组内时间倒序；条目含色条、原文摘录、感悟预览、相对时间 |
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
| EPUB 渲染 | `EpubViewer.tsx` 用 epubjs 0.3.93 `rendition`；`hooks.content` 已用于注入章节窗口逻辑 | 高亮走 `rendition.annotations` + hooks.content 注入 CSS；跳转走 `rendition.display(cfi)`（现有 resume 已在用） |
| PDF 渲染 | `PdfViewer.tsx`（897 行）pdfjs textLayer 自绘 | 高亮为**页内 quote 重匹配**（见 §3.2），正文渲染链路不动 |
| 设置 | `settings.ts` v4，键 `bookeditor.settings.v4`，v0.2.9 起新增字段不改 version（D67） | `markEnabled` 以可选字段追加，缺省 `true` |
| 快捷键 | `readerHotkeys.ts` 动作映射 + `dispatchReaderCommand`；Ctrl+O 已有前端拦截先例 | 新增全局 `Ctrl+M` 开关面板，与 Ctrl+O 同一拦截层 |
| 删除记录 | `removeEntry` / `removeEntries` / `clearLibrary`（library.ts） | App 层 handler 串联清理 marks，避免 utils 间循环依赖 |
| 退出 flush | Go `OnBeforeClose` → `app:flush-request` → 前端 `flushCurrent` → `app:flush-done` | **marks 不纳入 flush**：每次标记操作即时写盘（见 D69） |

---

## 3. 数据契约

### 3.1 标记模型（新增 `utils/marks.ts`）

```ts
export type MarkColor = "yellow" | "green" | "blue" | "pink";

/** 三格式定位器：EPUB 用 CFI，TXT 用字符偏移，PDF 用页码 + quote 重匹配 */
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
| EPUB | iframe `contentDocument.getSelection()` → `range` → **CFI**（`epubjs` 的 range→CFI 工具，实施期以 0.3.93 实际导出为准，失败降级 quote 锚点） | `{cfi, href, chapter}` | `rendition.annotations.add("highlight", cfi, {}, cb, "mark-hl mark-hl-yellow")`；样式经 `hooks.content` 注入 iframe | `rendition.display(cfi)`（resume 已在用） |
| TXT | 宿主 `getSelection()` → TreeWalker 累计字符偏移（与现有 anchor 口径同源） | `{start, end}`（字号无关） | 渲染层按偏移拆 `<mark data-mark-id>` 片段 | `scrollTo` 对应片段元素 + 闪烁 |
| PDF | textLayer 内 `getSelection()` → 所在页 + 页内 `textContent` 偏移 → 存 `{page, quote}` | quote（截取前后各 24 字符上下文防误匹配） | 当前可见页重绘：页内按 quote 查找子串并包 `<span class="mark-hl">` | `display(page)` 后查找 |

- **PDF 已知限制（D65）**：跨页选词、quote 在页内多处出现时，取首次匹配；正文高亮仅在**当前可见页**绘制，滚动后按需重绘（复用现有渲染节流）。侧栏列表不受影响。
- **EPUB 已知风险（D67）**：`rendition.annotations` 在纵向 scroll 模式下的重绘行为需真机验证；若异常，降级为 hooks.content 内自行按 CFI `getRange` 包裹（epubjs 提供 `rendition.getRange(cfi)` 反查）。

### 3.3 设置扩展（`utils/settings.ts`）

```ts
/** v0.3.0：标记记录总开关；缺省 true（旧配置零回归，D67 口径） */
markEnabled: boolean;
```

- 存储键与 version 不变（`bookeditor.settings.v4` / 4）；`normalizeSettings` 增 `markEnabled: typeof r.markEnabled === "boolean" ? r.markEnabled : true`。
- 关闭后：划词不弹工具条、Ctrl+M 无面板、正文已有高亮**照常显示**（关闭只影响新增，与「删除需显式操作」一致）。

### 3.4 不变项

- **Go 侧零改动**：`app.go` / `main.go` / `SupportedExts` 不受影响，无新增绑定。
- `library.ts` 数据结构不变（不加 `marks` 字段，见 §2 理由）。
- 退出 flush 链路（`flushCurrent`）不纳入 marks（D69）。

---

## 4. 交互口径（与 HTML 示例逐条对齐）

**划词与高亮**
1. 选中正文 ≥ 8 字符（`sel.toString().trim().length`）才弹工具条；低于阈值或点空白处只清除选区。
2. 工具条浮于选区上方（空间不足时翻到下方）：4 个色点 + 「写感悟」+ 「复制」。色点 hover 显示色名（黄/绿/蓝/粉）。
3. 点色点 → 即时落库 + 高亮上色 + toast「已标记」；工具条收回。
4. 在已有高亮上再次选词（选区与已标记区间重叠）→ 工具条变为「改色 / 写感悟 / 删除标记」三态，删除需该条目的更多菜单确认（工具条内删除直接生效并 toast「已删除标记」，不二次确认——与单本 ✕ 同口径）。
5. 点击正文中的高亮 → 弹出该条气泡：原文 1 行 + 感悟预览（≤ 2 行）+「编辑」「删除」。
6. 「复制」复制划选原文到剪贴板（复用现有 Ctrl+C 文案链路）。

**写感悟编辑器（MarkNoteEditor）**
7. 入口：工具条「写感悟」、气泡「编辑」、面板条目「编辑」——同一受控组件。
8. 布局：原文引用块（左侧色条，≤ 3 行省略）+ 多行文本域（自动 focus，Enter 直接保存 / Esc 取消，Shift+Enter 换行）+ 色点改色 + 「保存」「取消」。
9. 已有笔记则回显；保存空笔记 = 纯高亮（合法，不删除条目）。
10. 「＋ 写想法」：入口在面板头部；不依赖选区，`text` 为空、`idea: true`，定位取当前阅读位置（无位置时仍可保存，`locator` 记当前页/章节）。

**标记记录面板（MarksPanel）**
11. 入口：工具栏「标记」按钮（带数量徽标）、Ctrl+M；右侧抽屉 340px，遮罩点击 / Esc / 「×」关闭。
12. 头部：标题「标记记录」+ 计数 N + 「＋ 写想法」+ 导出按钮 + 「×」。
13. 工具行：搜索框（placeholder「搜索原文与感悟」）+ 筛选 chips：`全部 N` / `有感悟 N` / 四色各 N；搜索与筛选为「与」关系；无结果显示空态「无匹配标记」。
14. 列表按**章节分组**（EPUB 取 `locator.chapter`；PDF「第 N 页」；TXT 统一「全文」），组头显示名称 + 组内计数；组内按 `updatedAt` 倒序。
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
| `frontend/src/components/EpubViewer.tsx` | hooks.content 内挂划词监听 + annotations 增删 + CSS 注入；`displayCfi(cfi)` 跳转 API 经 `getterRef` 同款注册位暴露 |
| `frontend/src/components/PdfViewer.tsx` | textLayer 划词监听；当前可见页 quote 重匹配绘制；`gotoPage` 跳转 + flash |
| `frontend/src/components/BookViewer.tsx` | 透传 marks 相关 props 与三个 Viewer 的标记上下文；书架入口不变 |
| `frontend/src/components/SettingsPanel.tsx` | 新增「标记记录」分组：总开关 + 默认色选择（4 色）+ 说明文案 |
| `frontend/src/App.tsx` | `marks` state + 订阅；`showMarks` state；Ctrl+M 拦截（仿 Ctrl+O）；flush 不变；书架移除 handler 串联 marks 清理；渲染 `<MarksPanel>` |
| `frontend/src/utils/readerCommands.ts` / `readerHotkeys.ts` | 新增 `toggle-marks` 命令（可选：也支持单键 `m`，与翻页键同层豁免规则） |
| `frontend/src/styles.css` | `.mark-hl`（四色变体 + `.mark-flash` 动画）、`.mark-toolbar`、`.mark-note-editor`、`.marks-panel`、`.mark-item`、`.mark-export-modal` 等 |
| `e2e/` | 新增 `smoke_marks.py`（划词→落库→面板计数→跳转→导出）；`smoke_shelf.py` 移除记录断言补 marks 联动清理 |

---

## 6. 验收映射（建议 A83–A96）

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A83 | TXT 选词 ≥ 8 字符 → 工具条弹出，点黄色 → 高亮落库，刷新后仍在 | 手动真机 + 截图 | ⏳ 待实施 |
| A84 | < 8 字符选词不弹工具条 | 手动真机 | ⏳ |
| A85 | 高亮上写感悟 → 保存 → 面板条目显示感悟预览 → 重启应用仍在 | 手动真机 | ⏳ |
| A86 | 空感悟保存 = 纯高亮（条目无感悟，筛选「有感悟」不含它） | 手动真机 + 单测 | ⏳ |
| A87 | 点面板条目 → 跳回原文位置 + 闪烁 1.6s（三格式各一遍） | 手动真机 | ⏳ |
| A88 | 搜索「 solitude 」→ 仅剩 1 条；切「有感悟」chips → 计数联动 | 手动真机 | ⏳ |
| A89 | 导出 Markdown → 预览结构正确 → 下载 `《溪畔笔记》-标记.md` | 手动真机 | ⏳ |
| A90 | 清空本书 → 二次确认显示条数 → 确认后列表空、书架记录保留 | 手动真机 | ⏳ |
| A91 | 移除书架单本 → 该书标记联动清空（面板无残留） | 手动真机 | ⏳ |
| A92 | 设置关闭「标记记录」→ 划词无工具条；已有高亮仍显示；重开恢复 | 手动真机 | ⏳ |
| A93 | Ctrl+M 开/关面板；设置面板打开时 Ctrl+M 归面板 | 手动真机 | ⏳ |
| A94 | 单本 500 条上限：连续划词至上限，最旧被淘汰且无卡死 | 手动真机（可脚本灌数） | ⏳ |
| A95 | EPUB 高亮经 annotations 渲染，翻页/切章后高亮仍在；scroll 模式正常 | 手动真机 | ⏳ |
| A96 | PDF 页内 quote 高亮；滚动出页再回来高亮重绘；跨页选词降级为侧栏条目 | 手动真机 | ⏳ |

**自动化覆盖（实施后回填）**
- 单测：`marks.test.ts` 预计 ≥ 20 例（normalize / 批量广播 / 淘汰 / 导出结构）；`settings.test.ts` 补 `markEnabled` 缺省与迁移 2 例。
- e2e：`smoke_marks.py` 拟 6 场景（划词落库 / 感悟保存 / 跳转 / 导出 / 清空 / 书架联动）。

---

## 7. 偏差与风险（实施期如实回填）

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D65 | PDF 正文高亮与 EPUB 同精度 | PDF 为**页内 quote 重匹配**，仅当前可见页绘制；跨页选词降级为侧栏条目 | pdfjs textLayer 无持久 range 句柄；quote 匹配对复制版式足够，扫描版 PDF 本就无 textLayer（不适用本模块） |
| D66 | 标记不限量 | 单本 500 / 总量 2000，静默淘汰最旧 | localStorage 预算约 5MB；按单条 ~600B 估算 2000 条 ≈ 1.2MB，与书架/设置共存安全 |
| D67 | EPUB annotations 即插即用 | 待验证：epubjs 0.3.93 `rendition.annotations` 在 scroll 模式的重绘；失败则降级 hooks.content 内 `getRange(cfi)` 自行包裹 | 复用现有 `hooks.content` 注入点，降级路径不新增依赖 |
| D68 | TXT 高亮不动渲染层 | 改为**片段数组渲染**（偏移字号无关，与 anchor 口径一致；字号变化不触发重算） | `pre` 整篇文本无法局部高亮；渲染拆分后选区偏移计算需同步改为 TreeWalker（同一函数供划词与跳转共用） |
| D69 | marks 随退出 flush 落库 | **即时写盘**，不纳入 `flushCurrent` | 标记是低频显式操作，每次操作即落盘语义更简单；flush 链路已为 position 定制，混入会增加时序复杂度 |
| D70 | 删除书记录同步删标记 | App 层 handler 串联（`handleRemoveEntry(s)` / `handleClearLibrary` 内调用 marks 清理） | 避免 `library.ts ↔ marks.ts` 循环依赖；与 v0.2.8「批量单次广播」经验一致，UI 无中间态 |
| D71 | 导出仅 Markdown | 本版仅 `.md`（复制 + 下载）；JSON/HTML 导出列后续 | Markdown 可被主流笔记软件直接导入，优先级最高 |
| D72 | 想法条目也参与分组 | 独立想法归入「想法」分组，置顶显示 | 与章节分组正交；避免想法混入章节序列破坏跳转语义（想法无原文可跳） |

**风险**
- EPUB iframe 内选词的坐标换算已有先例（`bindStageInteraction` 的 `iframeContentPoint`），工具条定位复用该函数，不新造轮子。
- marks 面板与设置面板可同显（从设置打开时）：层级高于设置面板，Esc 分层关（沿用 v0.2.8 先例）。
- 导出大量标记时 Markdown 字符串拼接在渲染线程同步执行（2000 条 ≈ 数毫秒），可接受；不引入 Web Worker。

---

## 8. 实施步骤

| 步骤 | 内容 | 完成判据 | 状态 |
|---|---|---|---|
| T1 | 视觉基线 HTML（`doce/BookEditor-前端界面示例-v0.3.0-标记记录.html`） | 与本文 §4 口径一致，可交互 | ⏳ 本次已随方案产出 |
| T2 | `utils/marks.ts` + 单测 | `marks.test.ts` 全绿 | ⏳ |
| T3 | `settings.ts` 加 `markEnabled` + 单测补例 | `settings.test.ts` 全绿 | ⏳ |
| T4 | `MarkToolbar.tsx` + `MarkNoteEditor.tsx` | tsc 通过，受控渲染 | ⏳ |
| T5 | `MarksPanel.tsx`（列表/筛选/搜索/导出/二次确认） | tsc 通过 | ⏳ |
| T6 | `TextViewer.tsx` 划词 + 片段高亮 + 跳转 | 真机 A83/A84/A87 | ⏳ |
| T7 | `EpubViewer.tsx` annotations 高亮 + CFI 跳转 | 真机 A95（D67 验证点） | ⏳ |
| T8 | `PdfViewer.tsx` quote 高亮 + 页码跳转 | 真机 A96 | ⏳ |
| T9 | `App.tsx` 接线 + Ctrl+M + 书架联动清理 + `styles.css` | 真机 A91–A94 | ⏳ |
| T10 | `smoke_marks.py` + 真机验收回填 | A83–A96 全过 + 本文 §6 状态回填 | ⏳ |

**DoD**：`tsc --noEmit` PASS ⏳、`vitest run` 全绿（新增 ≥ 22 例）⏳、`wails build` 成功 ⏳、A83–A96 真机通过 ⏳、本文 §6/§7 状态回填 ⏳、整合文档 §2/§11/§12 补 v0.3.0 行与 D65–D72 ⏳。

---

## 9. 本期不做（后续候选）

- 多设备云同步（当前纯本机 localStorage，与书架同边界）。
- 标注分享（图片卡片 / 长图）。
- 手写、画笔、区域框选标注（PDF 扫描版另论）。
- 标签体系（多标签归类标记）与标记的 AI 摘要/回顾。
- JSON / HTML 导出（D71 已排期候选）。
- 想法与高亮的互相转换（想法补选原文 → 转高亮）。
