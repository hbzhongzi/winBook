# BookEditor v0.3.0 —— 标记记录模块 开发方案

> 状态：**T1–T10 实施完成**（2026-11-21；T1–T9 提交 2ad7218–a575152，T10 见当次提交）。
> 验证：`tsc --noEmit` PASS；`vitest run` 214 例全绿（marks 43 例 + settings 补 6 例）；`go test ./...` ok；`wails build -platform windows/amd64` 成功（build/bin/book-editor.exe 已刷新）。A83–A96 真机 GUI 断言待真机执行（本环境无 GUI；`e2e/smoke_marks.py` 9 步已就绪，语法校验通过）。
> 视觉基线：`doce/BookEditor-前端界面示例-v0.3.0-标记记录.html`（可交互，交互口径即本文 §4 口径）。
> 上游版本：v0.2.9（PDF 显示优化，A67–A74 待真机）。本版以在三个 Viewer 内挂载划词监听与高亮渲染为主：TXT 渲染层按 D68 改片段数组，PDF 按 D73 退化为页级，Go 侧零改动。
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
| EPUB 渲染 | `EpubViewer.tsx` 用 epubjs 0.3.93 `rendition`；`hooks.content` 已用于阅读主题注入/禁内层滚动/快捷键转发 | 高亮走 `rendition.annotations`（SVG 覆盖层在宿主文档，宿主 CSS 直接生效，无需注入）；跳转走 `rendition.display(cfi)`（现有 resume 已在用） |
| PDF 渲染 | `PdfViewer.tsx` 纯 canvas 渲染（无 pdfjs textLayer） | 高亮退化为**页级标记**（D73，见 §3.2），正文渲染链路不动 |
| 设置 | `settings.ts` v4，键 `bookeditor.settings.v4`，v0.2.9 起新增字段不改 version（D67） | `markEnabled` 以可选字段追加，缺省 `true` |
| 快捷键 | `readerHotkeys.ts` 动作映射 + `dispatchReaderCommand`；Ctrl+O 已有前端拦截先例 | 新增全局 `Ctrl+M` 开关面板，与 Ctrl+O 同一拦截层 |
| 删除记录 | `removeEntry` / `removeEntries` / `clearLibrary`（library.ts） | App 层 handler 串联清理 marks，避免 utils 间循环依赖 |
| 退出 flush | Go `OnBeforeClose` → `app:flush-request` → 前端 `flushCurrent` → `app:flush-done` | **marks 不纳入 flush**：每次标记操作即时写盘（见 D69） |

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
| `frontend/src/components/EpubViewer.tsx` | 宿主 `stage` mouseup 监听（遍历 iframe contentDocument 取选词，工具条/气泡在宿主 DOM）+ annotations 增量同步（未渲染章节经 `hooks.render.inject` 补挂）；`display(cfi)` 跳转 + 高亮闪烁（两级延迟重试等补挂） |
| `frontend/src/components/PdfViewer.tsx` | **D73 页级**：「标记本页」悬浮按钮（无控制条时显形，当前页已有标记时 active）+ 页码定位器；跳转 = 单页翻页 / 滚动模式页槽置顶（复用初始恢复重钉机制）+ 页级闪烁 1.6s |
| `frontend/src/components/BookViewer.tsx` | 透传 marks 相关 props 与三个 Viewer 的标记上下文；书架入口不变 |
| `frontend/src/components/SettingsPanel.tsx` | 新增「标记记录」分组：总开关 + 默认色选择（4 色）+ 说明文案 |
| `frontend/src/App.tsx` | `marks` state + 订阅；`showMarks` state；Ctrl+M 拦截（仿 Ctrl+O）；flush 不变；书架移除 handler 串联 marks 清理；渲染 `<MarksPanel>` |
| `frontend/src/utils/readerCommands.ts` / `readerHotkeys.ts` | **未改动**：Ctrl+M 走 `App.tsx` 窗口级拦截（仿 Ctrl+O，D74），不经阅读器命令层；可选单键 `m` 未做 |
| `frontend/src/styles.css` | `.mark-hl`（四色变体 + `.mark-flash` 动画）、`.mark-toolbar`、`.mark-note-editor`、`.marks-panel`、`.mark-item`、`.mark-export-modal` 等 |
| `e2e/` | 新增 `smoke_marks.py`（TXT 全流程 9 步：复位 → 划词落库 → Ctrl+M 面板 → 写想法 → 跳转闪烁 → 删除 → 开关幂等 → 总开关 → 书架联动 A91）；A91 联动断言随造标记同流程落在 smoke_marks（原计划放 smoke_shelf，但其移除对象 12.epub 无标记，见 D75）；`smoke_settings.py` nav 坐标随「标记记录」窗格插入修正 |

---

## 6. 验收映射（建议 A83–A96）

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
| A95 | EPUB 高亮经 annotations 渲染，翻页/切章后高亮仍在；scroll 模式正常 | 手动真机 | ⏳ 代码完成（D67 结论）；真机终验待执行 |
| A96 | PDF 页级标记：按钮落库/active 态；滚动出页再回来；跨页选词降级为侧栏条目 | 手动真机 | ⏳ 代码完成（D73 页级口径）；真机终验待执行 |

**自动化覆盖（实施后回填）**
- 单测：`marks.test.ts` 43 例（normalize / 批量广播 / 淘汰 / 导出结构）；`settings.test.ts` 补 `markEnabled` 缺省迁移 + `markDefaultColor` 白名单共 6 例；`vitest run` 合计 214 例全绿。
- e2e：`smoke_marks.py` 9 步（sm-marks-00–09），覆盖 A83（TXT）/ A85 / A86（部分）/ A87（TXT）/ A91 / A92 / A93（口径见上表）；A84 / A88 / A89 / A90 / A94（真机部分）/ A95 / A96 待真机。运行前需 `wails build` 刷新 `build/bin/book-editor.exe`（T10 已构建）。

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

**风险**
- EPUB iframe 内选词的坐标换算已有先例（`bindStageInteraction` 的 `iframeContentPoint`），工具条定位复用该函数，不新造轮子。
- marks 面板与设置面板可同显（从设置打开时）：层级高于设置面板，Esc 分层关（沿用 v0.2.8 先例）。
- 导出大量标记时 Markdown 字符串拼接在渲染线程同步执行（2000 条 ≈ 数毫秒），可接受；不引入 Web Worker。

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
| T10 | `smoke_marks.py` + 真机验收回填 | A83–A96 全过 + 本文 §6 状态回填 | 🔶 本次提交：smoke_marks.py 9 步 + smoke_settings 坐标修正 + 本文回填完成；**A83–A96 真机执行待真实环境跑批**（exe 已刷新） |

**DoD**：`tsc --noEmit` PASS ✅、`vitest run` 214 例全绿（marks 43 + settings 6）✅、`go test ./...` ok ✅、`wails build -platform windows/amd64` 成功 ✅、A83–A96 真机通过 ⏳（脚本就绪，待真机）、本文 §6/§7 状态回填 ✅、整合文档 §2/§11/§12 补 v0.3.0 行与 D65–D75 ⏳（下一步，未在本版范围）。

---

## 9. 本期不做（后续候选）

- 多设备云同步（当前纯本机 localStorage，与书架同边界）。
- 标注分享（图片卡片 / 长图）。
- 手写、画笔、区域框选标注（PDF 扫描版另论）。
- 标签体系（多标签归类标记）与标记的 AI 摘要/回顾。
- JSON / HTML 导出（D71 已排期候选）。
- 想法与高亮的互相转换（想法补选原文 → 转高亮）。
