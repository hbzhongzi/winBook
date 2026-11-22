# BookEditor v0.3.0 —— 标记记录模块 开发方案

> 状态：**T1–T23 实施完成 + D76–D112 真机反馈修复、体验增强与静态审查修正**（2026-11-22）。
> 提交链：T1–T9 = `2ad7218`–`a575152`，T10 = `a31f2c0`；D76/D77 = `d4abaf6`，D79 = `f354434`，D80 = `2aeaf8a`，D81 = `17a9a11`，D82 = `b5c4048`，D83 = `d63b9b5`，D84 = `b53604b`，D85 = `935adec`，D85补/D86 = `0ec65ba`，D87 = `5bf6e47`，D88 = `da777f2`，D89 = `8cf60c7`，D90 = `510c97f`，D91 = `ef5a4ec`，D92 = `93f5eea`，D93 = `62aceec`，D95 = `967da35`，D96/D97 = `aaac6c7`，D98 = `c0f8457`，D100 = `13a4ab3`，D101 = `9c74ae1`，D102 = `c0bd409`，D103 = `c5c2bb6`，D104 = `39c909f`，D105 = `24a7785`，D106 = `7937f17`，D107 = `2194ad8`，D108 = `f0ca2bd`，D109 = `45c5c9b`，D110 = `4ed80c9`，D111 = `33d7057`，D112 = `a4c4f95`。**D94 未单独构建/提交**，其 `.content{min-width:0}` 保险并入 D95。**D99 未单独提交**（用户真机反馈后与 D100 一并修复）。
> 验证：`tsc --noEmit` PASS；`vitest run` **321 例全绿**（marks 60 例，含 D76/D77 回归 2 例、D96 章节组织 5 例、D101 画笔数据 8 例、D107 alpha normalize 2 例；`pdfInk.test.ts` 33 例覆盖坐标缩放/采样/抽稀/橡皮擦命中/页内位置 + D107 深浅/橡皮钳制与 alpha 绘制优先 3 例 + D109 橡皮光标直径换算 1 例 + D111 局部擦除与光标颜色 8 例；`markDrag.test.ts` 6 例；D102 新增 `pdfScale.test.ts` 栏数解耦 4 例 + `settings.test.ts` `pdfColumns` 迁移 2 例；D103 新增 `pdfScale.test.ts` 双栏倍率基准 4 例；D110 新增 `pdfScale.test.ts` 鼠标锚点 4 例、D112 新增 `wheelZoomDelta` 1 例与 `inkToolbar.test.ts` 停靠判定 8 例；`epubHighlight.test.ts` D105 改写为 11 例（过滤方向反转：丢容器框留逐行框）；`pdfInkUndo.test.ts` D105 7 例（双栏撤销页范围）+ D106 4 例（恢复）；`settings.test.ts` D106 4 例（PDF 模式独立）；D104 移除被弃用的 `toSvgRect` 及其 2 例）；`go test ./...` ok；`wails build -platform windows/amd64` 成功（最新交付 `build/bin/book-editor-D112.exe`）。A83–A115 真机 GUI 断言：A91 已由 `smoke_marks.py` 自动化；A95 部分经真机确认（D88 翻页正文加载、D91 目录层级），EPUB 高亮 annotations 终验仍待；其余待真机执行。**D89 翻页划词工具条、D95 弹窗视觉、D98 悬停/右键、D100 双模式悬停与滚动选词、D101 PDF 画笔、D102 三项、D103 两项、D104 高亮坐标系、D105 两项（高亮颜色/容器框 + 双栏撤销）、D106 三项（恢复 / 默认翻页双栏 / 滚动划词）、D107 画笔扩展、D108 两处（EPUB 滚动划词 CFI / 橡皮示例）、D109 两项（橡皮光标模型 / 工具栏拖动布局）、D110 两项（Ctrl+拖动平移 / 鼠标中心缩放）、D111 两项（橡皮局部擦除 / 三笔刷光标）、D112 两项（滚轮缩放去抖 / 工具栏靠边纵向），均待用户真机确认后方可标为通过。**

> D108 取证：用户 11:29 回传日志显示滚动划词已越过 D106 的 range 断点（`DRAG_CARET a=1 b=1`、`DRAG_RANGE_OK len=35` 均有），但停在新的 `DRAG_CFI len=35 contents=0 cfi=0` → `SELECT_DROP reason=cfi`。根因是 `rendition.views()` 返回 Views **管理器**而非数组，其 `find(section)` 收 section 对象（读 `.index`），传入回调恒不匹配 → Contents 恒 undefined → CFI 无法生成。D106 修好了「range 生成」，但 CFI 阶段这个更早埋下的 API 误用随即暴露。
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
| PDF | **无划词**（纯 canvas 渲染，无 textLayer）。**D101 画笔**：高亮笔 / 自由笔 / 橡皮擦，叠一层透明 canvas 手写圈画（翻页 + 滚动双模式） | `{page, quote: "", strokes?: PdfStroke[]}`（strokes 每条含 points/baseW/baseH/top） | 画笔层 canvas 回放笔迹（按 `当前尺寸/baseW` 等比缩放）；「标记本页」按钮 active 态表示当前页已有标记 | 页码翻页（单页）/ 页槽置顶（滚动，复用初始恢复重钉）+ 页级闪烁 1.6s |

- **PDF 能力边界（D65→D73→D101）**：PdfViewer 为纯 canvas 渲染（无 pdfjs textLayer），页内 quote 重匹配高亮本版不做。**D73** 时标记退化为「页级书签」；**D101 补齐页内标记**——不做文字层划词，改为**画笔手写标注**（用户明确选择「类似画笔那种可以自由作画标记」），既绕开 textLayer 的对齐/虚拟化复杂度，又能覆盖扫描版 PDF。两条能力并存：书签记「读到这页」，画笔记「这里有内容」。跨页/扫描版 PDF 均可正常涂画。
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
5. **（D98 修订）**鼠标悬停正文高亮（有原文的标记）稳定约 220ms 即浮出**标记内容**（原文 + 感悟），**鼠标离开立即消失**；提示 `pointer-events:none`、跟随光标，不可交互。**右键高亮 → 上下文菜单「编辑标记 / 删除标记」**。左键单击高亮不再弹气泡（原 §4.5 气泡方案已废止）。
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
| `frontend/src/utils/marks.ts` | **新增**：`MarkColor`/`MarkLocator`/`Mark` 类型、`MARKS_KEY` 与上限、读写 + normalize、批量 API、订阅、淘汰、`exportMarksMarkdown` 纯函数。**D107**：`PdfStroke` 增可选 `alpha?: number`（高亮深浅），`normalizeStroke` 兼容校验（非法值仅回落默认、不丢弃整条笔迹），D101–D106 旧笔迹零回归 |
| `frontend/src/utils/__tests__/marks.test.ts` | **新增**单测：normalize 各分支、批量单次广播、上限淘汰、导出 Markdown 结构（章节分组/感悟空值/位置脚注）。**D107**：+2 例（合法 alpha 保留 / 非法值回落默认、旧笔迹零回归） |
| `frontend/src/utils/__tests__/pdfInk.test.ts` | **D101 新增**几何/命中纯函数测试。**D107**：+3 例（深浅钳制、橡皮大小钳制、canvas stub 验证 `stroke.alpha` 优先且旧笔迹回落默认），21→24 例。**D109**：+1 例（橡皮光标直径=命中直径×缩放、非法缩放回落），24→25 例。**D111**：+8 例（局部擦除：未命中同引用 / 中间拆两段 / 整条删 / 端点缩短与 top 重算 / 缩放反变换 / 线宽边界；光标颜色 hex→rgba 与钳制），25→33 例 |
| `frontend/src/components/MarkToolbar.tsx` | **新增**：划词工具条（新选 / 已选三态）、色点、写感悟、复制、删除；受控 props（x/y/state/onXxx） |
| `frontend/src/components/MarkNoteEditor.tsx` | **新增**：感悟编辑器（引用块 + 文本域 + 改色 + 保存/取消），新建与编辑复用 |
| `frontend/src/components/MarksPanel.tsx` | **新增**：抽屉（头部/工具行/分组列表/条目/更多菜单/底部行/空态）+ 清空二次确认 + 导出弹层 |
| `frontend/src/components/TextViewer.tsx` | 渲染层按 marks 偏移拆 `<mark>` 片段；划词监听（mouseup + 偏移计算）；跳转 `scrollIntoView` + flash |
| `frontend/src/components/EpubViewer.tsx` | 宿主 `stage` mouseup 监听（遍历 iframe contentDocument 取选词，工具条/气泡在宿主 DOM）+ annotations 增量同步（未渲染章节经 `hooks.render.inject` 补挂）；`display(cfi)` 跳转 + 高亮闪烁（两级延迟重试等补挂）。**实施期 D76–D95 大改**：诊断打点、首次 display 前 patch continuous `fill/check`（D80）、DOM 探针 + 空白自愈（D81）、浮动诊断按钮（D82）、resize 基线/恢复（D83）、虚假膨胀过滤 + jump guard（D84）、空壳扉页判定（D85/D86）、像素 resize（D88）、交互打点（D89/D90）、平铺目录层级推断（D90/D91），详见 §7。**D103/D104 高亮重画**：`syncAnnotations` 与 `hooks.render` 补挂两处调用 `repaintHighlight()`；D104 改为**临时替换 Mark.filteredRanges() 后调用原 render()**，不再自行写 `<rect>`（原 render 的 `r.left - offset.left + container.left` 才正确处理 iframe 内坐标 → SVG 局部坐标）。**D105**：`repaintHighlight` 加颜色兜底（按 `<g data-id>` 反查 marks 真实 color 逐 `<rect>` 写 fill）。**D106 滚动模式划词修复**：`bindStageMarks` 的 `down` 改记按下时命中的 iframe，mouseup 复用**同一 iframe** 换算终点（旧实现重新 `iframeAtPoint(ev)`，多 iframe 堆叠时起止跨坐标系 → caret 落错位置/静默返回）；`onDragSelect` 增按 `range.startContainer.ownerDocument` 二次匹配 contents 的 fallback，补 `DRAG_CARET`/`DRAG_RANGE_OK`/`DRAG_RANGE_NULL`/`DRAG_CFI`/`SELECT_DROP` 打点定位断点。**D108 滚动划词 CFI 修复（关键）**：三处 `rendition.views?.().find(回调)` 全部改成 `allViews()`（`manager.views.all()`）——`views()` 实为 Views 管理器，其 `find(section)` 收 section 对象（读 `.index`），传回调恒 undefined → `contents=0` → `cfi=0` → `SELECT_DROP reason=cfi`（11:29 日志铁证）；涉及 `chapterInfoForDoc`、`onDragSelect`、`installAll` 右键补装；`DRAG_CFI` 打点增 `views=` 数量。修正 `EpubRendition.views` 类型标注 |
| `frontend/src/components/PdfViewer.tsx` | **D73 页级**：「标记本页」悬浮按钮（无控制条时显形，当前页已有标记时 active）+ 页码定位器；跳转 = 单页翻页 / 滚动模式页槽置顶（复用初始恢复重钉机制）+ 页级闪烁 1.6s。**D101 画笔**：`inkTool`/`inkDrafts` 状态、`inkStrokesOf()` 按页聚合已落库笔迹、`undoInk`/`clearInkPage`/`saveInk`，翻页与滚动两种模式均挂 `PdfInkCanvas` 与 `PdfInkToolbar`。**D102 栏数**：`spreadOn` 改读 `settings.pdfColumns`（不再从 `pdfFit` 推导），翻页步进/初始定位/`flipFrom`/键盘处理/`nextLimit` 全部改走 `columnStep(columns)`，档位菜单新增「页面布局 单栏/双栏」并上报 `onColumnsChange`。**D106 画笔恢复**：`undoInk` 把被撤一步压入 `inkRedo` 栈（草稿笔存 stroke，已落库存整组 strokes + 颜色 + 页码），新增 `redoInk` 反向执行（标记被删则按记录重建）；新落笔/保存/清空时清空 redo 栈。**D107**：`inkTool` 初始化增 `alpha: BRUSH_ALPHA.highlighter` / `eraserSize: ERASER_RADIUS`。**D110**：Ctrl+滚轮记下鼠标锚点（相对视口与相对内容元素，含缩放前尺寸），重绘完成后由 `applyZoomAnchor()` 校正 scrollLeft/Top；两模式阅读容器在 capture 阶段处理 Ctrl+pointer 拖动平移（`setPointerCapture` + `stopPropagation` 防误落笔）；按住 Ctrl 切换抓手光标 class。**D112**：Ctrl+滚轮改为短窗口（60ms）累积去抖，`wheelZoomDelta` 量化整格后一次 nudge（锚点取最后一次滚轮位置，仍以鼠标为中心）；`renderOnCanvas` 仅当位图尺寸真变化时才写 `canvas.width/height`，避免连续缩放反复清空位图导致闪烁 |
| `frontend/src/components/PdfInkCanvas.tsx` | **D101 新增**：透明画笔 canvas（绝对覆盖页面 canvas）。指针绘制、增量描边、DPR 位图、尺寸变化整页回放、橡皮擦逐段命中。未激活时 `pointer-events:none`。**D107**：`InkTool` 增 `alpha`/`eraserSize`；高亮笔落笔写入 `stroke.alpha`；橡皮命中半径改用 `clampEraserSize(t.eraserSize)`。**D109**：橡皮激活时渲染跟随指针的范围圆圈（`.pdf-ink-cursor`），直径由 `eraserCursorDiameter` 按缩放换算、与命中范围一致；橡皮模式隐藏系统光标避免双光标干扰。**D111**：`eraseAt` 改用 `eraseStrokesAt` 局部擦除、去掉「一次拖拽同一条只删一次」的 Set（局部擦除幂等）；`syncEraserCursor` 泛化为 `syncInkCursor`，按笔刷显示橡皮圈 / 高亮胶囊条（色点 + 深浅着色）/ 自由笔圆点，三种笔刷统一隐藏系统光标 |
| `frontend/src/components/PdfInkToolbar.tsx` | **D101 新增**：画笔工具栏（高亮/自由/橡皮、六色、撤销、清空本页、保存、完成），未开启画笔时不渲染。**D102**：三档粗细按钮 → `range` 滑块（0.4–4，步长 0.1），右侧实时像素读数；`SIZE_MIN/MAX/STEP` 与 `clampSize()` 导出。**D106**：新增「恢复」按钮（`canRedo`/`onRedo`），紧邻「撤销」；撤销 title 改为「双栏可见页内，右页优先」。**D107**：布局重写为五段式（笔刷/颜色/样式/历史/动作），样式区按当前笔刷条件渲染——高亮=粗细+深浅、自由笔=粗细、橡皮=大小；新增高亮「深浅」滑块（`INK_ALPHA_*`，实时百分比）与橡皮「大小」滑块（`ERASER_SIZE_*`），所有输入先经钳制函数。**D108**：橡皮样式区新增 `EraserPreview` 可视化示例——固定 26px 视窗内按 `直径/最大直径` 比例画实心圆（擦除覆盖）+ 虚线圈（最大范围参考），旁边标 `4–24` 范围读数，解决「橡皮缺少示例范围」。**D109**：加入 `ib-grip` 拖动手柄（按住移动、双击复位），`pos` 状态写绝对 left/top 并钳制在父容器内；布局紧凑化（padding/gap 缩小、滑块 64px、`.ib-group`/滑块 `flex:none`）减少换行挤压。**D112**：松手时 `inkDockSide` 判定靠左/右边缘，`dock` 状态驱动 `.vertical` 纵向布局；`inkDockX` + layout effect 按切换后的新宽度重新贴边并钳制高度；双击复位同时清空 dock |
| `frontend/src/utils/pdfInk.ts` | **D101 新增**：画笔纯函数层——`strokeScale`/`scaledPoints`（尺寸归一化）、`tracePath`（中点二次贝塞尔平滑）、`paintStroke`/`repaintPage`、`distToSegmentSq`/`hitStrokes`（橡皮擦逐段命中）、`pushPoint`（采样降噪）、`decimate`（点数抽稀）、`strokeTop`（页内位置）。**D107**：新增 `INK_ALPHA_MIN/MAX/STEP` + `clampInkAlpha()`、`ERASER_SIZE_MIN/MAX/STEP` + `clampEraserSize()`；`paintStroke()` 改用 `stroke.alpha ?? BRUSH_ALPHA[stroke.brush]`。**D109**：新增 `eraserCursorDiameter(size, scale)`（光标直径=命中直径×缩放，非法缩放回落 1）。**D111**：新增 `eraseStrokesAt(strokes, x, y, r, pageW, pageH)`（按橡皮范围逐段切分，只删覆盖段，其余连续段拆成新笔迹；在笔迹基准坐标系判定避免缩放错位，返回原数组引用表示无变化）与 `inkCursorColor(hex, alpha)`（光标着色，alpha 钳 0–1） |
| `frontend/src/utils/pdfScale.ts` | 适配与缩放纯函数层。**D102**：`resolvePdfScale` 增 `columns` 参数（双栏先扣 `PDF_PAGE_GAP` 再对半分）；新增 `columnStep(columns)`、`migratePdfFit()`、`normalizePdfColumns()`、`PDF_FITS_ALL`；`PDF_FITS` 剔除 `spread`；`spreadStep(fit)` 标 `@deprecated` 仅留兼容。**D103**：custom 倍率基准随栏数走（单栏 `pw` / 双栏 `(cw−gap)/2`）。**D110**：新增 `zoomAnchorScroll(scroll, currentLead, anchorInContent, anchorViewport, ratio)`——以鼠标为锚点算缩放后的滚动位置（`scroll + currentLead − (anchorViewport − anchorInContent × ratio)`），非法输入原样返回、结果钳 ≥0；`pdfScale.test.ts` +4 例（放大/缩小/自洽/钳制与非法值），34→38 例。**D112**：新增 `PDF_WHEEL_THROTTLE_MS`/`WHEEL_DELTA_PER_NOTCH` 与 `wheelZoomDelta(acc, step)`——把累积滚轮 delta 按绝对值对称量化成整数格（不足一格返回 0），一次返回总步进，避免高频 wheel 反复触发重绘；`pdfScale.test.ts` +1 例，38→39 例 |
| `frontend/src/utils/inkToolbar.ts` | **D112 新增**：靠边停靠判定纯函数层——`INK_DOCK_EDGE=160`、`inkDockSide(x, barW, parentW)`（距左/右边缘阈值内判定，两侧都近取更近者，非法尺寸回 null）、`inkDockX(side, barW, parentW)`（贴边留 12px，窄容器钳到 0） |
| `frontend/src/utils/__tests__/inkToolbar.test.ts` | **D112 新增** 8 例：中部不靠边 / 左右判定 / 两侧都近取更近 / 非法值 / 贴边留白 / 窄容器不越界 |
| `frontend/src/utils/epubHighlight.ts` | **D103 新增**：EPUB 高亮 rect 过滤层。**D105 过滤方向反转**：`filterRects` 改为**丢弃包含其它框的容器大框**（段落/body 级包围盒）、保留逐行框——D103/D104 曾「保留全部」，容器框仍会盖住整段（截图里的灰色块/横向溢出）。新增 `containsBox`（2px 容差）。**D104**：移除 D103 的 `toSvgRect`（跨坐标系会导致整体偏移）；坐标换算回交 marks-pane 原 render |
| `frontend/src/utils/pdfInkUndo.ts` | **D105 新增**：PDF 画笔撤销/清空页范围纯函数层。`visiblePages`（翻页双栏 = [current, current+1]）、`undoTargetPage`（可见页内草稿优先、右页优先）、`canUndoInk`/`canClearInk`。统一了此前「保存按钮跨页统计、撤销按钮只看左页」的口径不一致。**D106**：新增 `InkRedoEntry`（draft/saved 两类）、`canRedoInk`、`popLastDraft`，支撑「恢复」反向操作 |
| `frontend/src/components/BookViewer.tsx` | 透传 marks 相关 props 与三个 Viewer 的标记上下文；书架入口不变 |
| `frontend/src/components/SettingsPanel.tsx` | 新增「标记记录」分组：总开关 + 默认色选择（4 色）+ 说明文案。**D102**：PDF 适配区新增「页面布局 单栏/双栏」独立开关（与 `pdfFit` 解耦），适配方式按钮的选中态改按 `migratePdfFit()` 比较以兼容旧 `spread` |
| `frontend/src/App.tsx` | `marks` state + 订阅；`showMarks` state；Ctrl+M 拦截（仿 Ctrl+O，D74 mirror-ref 门控）；flush 不变；书架移除 handler 串联 marks 清理；渲染 `<MarksPanel>`。**D92 加 `MARK_PANEL_TOGGLE` 打点；D95 改为弹窗浮层（`.marks-backdrop` 遮罩点击关闭 + MarksPanel）**。**D106**：新增 `effectiveReaderMode`（PDF 读 `settings.pdfReaderMode`、其余读 `settings.readerMode`），统一传给 Toolbar/BookViewer/StatusBar；`toggleReaderMode` 按当前书格式写对应字段，`handleSettingsChange` 同时检测两个模式字段；`pdfDetail` 改读 `pdfReaderMode` |
| `frontend/src/utils/readerCommands.ts` / `readerHotkeys.ts` | **未改动**：Ctrl+M 走 `App.tsx` 窗口级拦截（仿 Ctrl+O，D74），不经阅读器命令层；可选单键 `m` 未做 |
| `frontend/src/styles.css` | `.mark-hl`（四色变体 + `.mark-flash` 动画）、`.mark-toolbar`、`.mark-note-editor`、`.marks-panel`、`.mark-item`、`.mark-export-modal` 等。**实施期追加**：失败页诊断区（D79）、浮动诊断按钮 z-index 1001（D82/D87）、目录层级 `.toc-depth-0/1`（D90/D91）、`.content{min-width:0}`（D94/D95）、`.marks-backdrop` + `.marks-panel` absolute 弹窗浮层 + 滑入动画（D95）、`.pdf-ink*` / `.pdf-ink-bar`（D101）。**D102**：高亮类拆成 `mark.mark-hl-*`（TXT）与 `g.mark-hl*`（SVG，强制无 background/box-shadow/padding）两套；`.pdf-ink-bar .ib-range` / `.ib-size-*`（粗细滑块）。**D107**：`.pdf-ink-bar` padding/gap 收紧（7px 10px / 6px）、`.ib-btn` 更紧凑（4px 8px）；`.ib-size-*` 改为通用 `.ib-field`（label / val / range）支撑深浅与橡皮滑块。**D108**：新增 `.ib-eraser-preview`（26px 固定示例框）与 `.ib-range-scale`（范围端点小字）。**D109**：移除 `.pdf-ink.eraser{cursor:cell}`（改内联隐藏系统光标），新增 `.pdf-ink-cursor`（跟随指针的橡皮范围圆圈，`pointer-events:none`）；`.ib-grip`（抓取/拖动光标、touch-action:none）；工具栏 padding/gap 再收紧、滑块 64px、`.ib-group` flex:none。**D110**：`.pdf-canvas-area` 的 `justify-content`/`align-items` 追加 `safe center`（放大溢出时不再裁掉左/顶部，可双向滚动）；新增 `.pdf-pan-ready`/`.pdf-panning` 抓手光标（`grab`/`grabbing`，子元素 `!important` 覆盖画笔层内联光标）。**D111**：`.pdf-ink-cursor` 拆为基础样式 + `[data-brush="eraser|highlighter|pen"]` 三变体（橡皮范围圈 / 高亮胶囊条 / 自由笔圆点）。**D112**：新增 `.pdf-ink-bar.vertical`（分组竖排、分隔符转横线、色点保持单行、按钮全宽、滑块自适应填满，限高可滚动） |
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
| A98 | **PDF 画笔（D101）**：翻页/滚动双模式可画；缩放与适宽后笔迹不错位；橡皮擦可擦中段；保存后面板出现「第 N 页 · X%」条目；点条目跳到该页；撤销与清空本页生效 | 手动真机 | ⏳ 代码完成，待真机执行 |
| A97 | EPUB 翻页模式划词 → 工具条弹出 → 点颜色/写感悟落库（D89） | 手动真机 + `epub-diag.log` 打点 | ⏳ **未验证**：D89 提升 `.mark-toolbar` z-index 并加 `SELECTED_EVENT`/`TOOLBAR_SHOW`/`TOOLBAR_ACTION` 打点，但用户历次回传日志均无划词链路打点；需完成一次「翻页划词 → 点颜色」并回传新日志方可定案 |
| A99 | **EPUB 滚动模式高亮不再糊成矩形（D102）**：滚动模式下多行高亮逐行贴合文字，不出现整块实心矩形盖住正文；翻页模式高亮外观不变；TXT 高亮外观不变 | 手动真机（滚动模式多行划词截图比对） | ⏳ 代码完成，待真机执行（CSS/代码双保险，见 §7 D102） |
| A100 | **PDF 粗细可连续调节（D102）**：画笔工具栏出现 range 滑块，拖动即时改变落笔线宽，右侧显示实时像素读数；范围 0.4–4，默认 1 | 手动真机 | ⏳ 代码完成，待真机执行 |
| A101 | **PDF 单双栏与缩放解耦（D102）**：切换自适应/适宽/适高/自定义、拖动倍率、Ctrl+滚轮放大缩小，栏数始终保持用户选择的单栏或双栏不变；旧配置 `pdfFit:"spread"` 升级后仍为双栏 | 单测 + 手动真机 | 🟡 单测已覆盖（`pdfScale.test.ts` 栏数解耦 4 例 + `settings.test.ts` 迁移 2 例）；真机待执行 |
| A102 | **EPUB 高亮不再整块实心、且不错位（D103/D104/D105）**：滚动模式跨段落/跨块选区划词，高亮**逐行贴合文字**、段间留白不额外填充，不出现整块矩形；翻页模式同样正确；**高亮位置与实际文字对齐、颜色正确（非灰色）、无横向溢出容器框** | 单测 + 手动真机 | 🟡 `epubHighlight.test.ts` 11 例（D105 改为丢容器框留逐行框）；D104 修正坐标偏移、D105 加颜色兜底 + 容器框剔除，真机待执行 |
| A103 | **PDF 双栏缩放基准（D103）**：双栏下 100% 时两页恰好铺满容器、不横向溢出裁切；缩小到 50% 时两页整体变小、仍并排；单栏 100% 口径与旧版一致（存量零回归） | 单测 + 手动真机 | 🟡 `pdfScale.test.ts` 双栏 custom 4 例覆盖（100% 铺满 / 50% 不溢出 / 单栏零回归 / ≤100% 全程装得下）；真机待执行 |
| A104 | **PDF 画笔撤销/清空覆盖双栏两页（D105）**：双栏模式左右页都画上笔迹后，「撤销」「清空本页」按钮可用（不再灰色），撤销优先撤右页最后一笔，清空同时清掉两页 | 单测 + 手动真机 | 🟡 `pdfInkUndo.test.ts` 7 例覆盖（双栏可见页含 current+1、右页草稿/已落库笔迹命中、可见页外不误撤）；真机待执行 |
| A105 | **PDF 画笔恢复（D106）**：点「撤销」后「恢复」按钮变可用；点恢复把刚撤的草稿笔加回（或把已落库笔迹整组写回/标记重建）；新落笔、保存、清空后恢复按钮作废 | 单测 + 手动真机 | 🟡 `pdfInkUndo.test.ts` 新增 4 例（popLastDraft / canRedoInk / saved 记录）；真机待执行 |
| A106 | **PDF 默认翻页双栏（D106）**：新装/恢复默认后打开 PDF 即翻页 + 双栏；EPUB/TXT 仍默认滚动（不被误伤）；用户手动切过的单栏/滚动被尊重；PDF 与 EPUB 模式切换互不影响 | 单测 + 手动真机 | 🟡 `settings.test.ts` 新增 4 例（默认值/旧配置迁移/非法值/字段独立）；真机待执行 |
| A107 | **EPUB 滚动模式划词能生成标记（D106/D108）**：滚动模式拖拽选词后工具条弹出（不再静默失败），点色点落库；`epub-diag.log` 出现 `DRAG_CARET`/`DRAG_RANGE_OK`/`DRAG_CFI` 且 `cfi=1`/`TOOLBAR_SHOW` | 手动真机 + 日志打点 | 🔶 D106 修好 range 生成（11:29 日志 `DRAG_CARET a=1 b=1`、`DRAG_RANGE_OK len=35` 均到位）；D108 修好其后暴露的 CFI 断点（`views().find(回调)` → `manager.views.all().find(回调)`，旧日志 `contents=0 cfi=0` 即此）；**真机待执行**，需回传新日志确认 `DRAG_CFI cfi=1` + `TOOLBAR_SHOW` |
| A109 | **橡皮擦范围示例（D108）**：选橡皮后样式区出现可视示例——实心圆随「大小」滑块联动放大缩小，外面虚线圈标最大范围，旁注 `4–24` 端点，直观体现当前擦除覆盖范围 | 手动真机 | ⏳ 代码完成（`EraserPreview` + CSS），真机视觉待执行 |
| A110 | **橡皮光标模型（D109）**：选橡皮后画布内鼠标光标变成一个随「大小」滑块联动的圆圈，直径与实际擦除范围一致（跟随缩放）；系统光标不再叠加 | 手动真机 | ⏳ 代码完成（`.pdf-ink-cursor` + `eraserCursorDiameter`，+1 单测），真机手感待执行 |
| A111 | **画笔工具栏可拖动（D109）**：工具栏左侧手柄按住可拖到阅读区任意位置（含侧边），自动钳制不越界；双击手柄复位到底部居中；换行不再把「保存/完成」单独挤到第二行 | 手动真机 | ⏳ 代码完成（`ib-grip` + pos 钳制 + 布局紧凑化），真机拖动/布局待执行 |
| A112 | **Ctrl+拖动平移视图（D110）**：翻页与滚动模式阅读区按住 Ctrl 拖动可平移画布（放大后查看被裁切部分），光标变抓手；拖动期间不误落笔（即使画笔开启）；松手即停 | 单测 + 手动真机 | 🟡 代码完成（容器 capture 阶段 pointer 拖动 + `setPointerCapture` + `stopPropagation`），真机手感待执行 |
| A113 | **以鼠标为中心缩放（D110）**：Ctrl+滚轮放大/缩小时，鼠标下的内容点保持在视口同一位置（不再围绕容器中心跳走）；放大溢出后左右/上下都能滚到，不再裁掉左/顶部 | 单测 + 手动真机 | 🟡 `pdfScale.test.ts` +4 例（放大/缩小/ratio=1 自洽/钳制与非法值），真机手感待执行 |
| A114 | **橡皮按范围局部擦除（D111）**：橡皮只擦掉光标圆覆盖的笔迹段，长笔画中间擦一下断成两段、端点擦一下只缩短；不再「碰一段就整条消失」；缩放后擦除位置仍与光标对齐 | 单测 + 手动真机 | 🟡 `pdfInk.test.ts` +6 例（未命中同引用 / 中间拆两段 / 整条删 / 端点缩短与 top 重算 / 缩放反变换 / 线宽边界），真机手感待执行 |
| A115 | **三种笔刷光标可视化（D111）**：高亮笔显示与线宽等宽的半透明胶囊条（颜色随色点与深浅）、自由笔显示实心色点、橡皮显示范围圈；切换笔刷时光标形状/颜色随之变化，无系统光标叠加 | 手动真机 | ⏳ 代码完成（`syncInkCursor` + `data-brush` CSS 变体 + `inkCursorColor`），真机视觉待执行 |
| A116 | **缩放滚轮去抖（D112）**：Ctrl+滚轮放大/缩小时不再剧烈抖动或闪烁；快速连滚合并为一次倍率步进，鼠标下的内容点仍停在视口原位（A113 语义不回退） | 单测 + 手动真机 | 🟡 `pdfScale.test.ts` +1 例（`wheelZoomDelta` 整格量化 / 不足一格忽略 / 自定义步长 / 非法值），真机手感待执行 |
| A117 | **画笔工具栏靠边纵向（D112）**：工具栏拖到阅读区左/右边缘时自动改纵向排布，不横向压住正文；拖回中部恢复横向；双击手柄复位到底部居中 | 单测 + 手动真机 | 🟡 `inkToolbar.test.ts` 8 例（左右判定 / 两侧取近 / 非法值 / 贴边留白 / 窄容器钳制），真机拖动与视觉待执行 |
| A108 | **PDF 画笔扩展（D107）**：高亮笔「深浅」滑块可连续调节透明度（0.05–1），调节后新落笔深浅随之变化、刷新回放后仍保持；橡皮「大小」滑块可连续调节命中半径（4–24px）；样式区按当前笔刷条件显示；五段式布局紧凑不换行 | 单测 + 手动真机 | 🟡 `pdfInk.test.ts` +3 例（钳制 + canvas stub 验证 `stroke.alpha` 优先 / 旧笔迹回落默认）、`marks.test.ts` +2 例（alpha normalize 零回归）；真机手感与视觉待执行 |

**自动化覆盖（实施后回填）**
- 单测：`marks.test.ts` 60 例（normalize / 批量广播 / 淘汰 / 导出结构；D77 新增 2 例 EPUB 独立想法空 cfi 回归；D101 新增 8 例 PDF 画笔笔迹；D107 +2 alpha normalize）；`pdfInk.test.ts` 33 例（D101 画笔几何与命中；D107 +3 深浅/橡皮钳制；D109 +1 橡皮光标直径；D111 +8 局部擦除 6 与光标颜色 2）；`markDrag.test.ts` 6 例（D100 方向判定）；`pdfScale.test.ts` 39 例（D102 栏数解耦 4 例、D103 双栏倍率基准 4 例、D110 鼠标锚点 4 例、D112 滚轮量化 1 例）；`inkToolbar.test.ts` 8 例（D112 工具栏靠边停靠判定）；`epubHighlight.test.ts` 11 例（D103 rect 过滤，含容器大矩形不吞逐行框的关键回归）；`settings.test.ts` 54 例（PDF 独立设置/迁移）；`vitest run` 合计 **321 例全绿**。
- e2e：`smoke_marks.py` 9 步（sm-marks-00–09），覆盖 A83（TXT）/ A85 / A86（部分）/ A87（TXT）/ A91 / A92 / A93（口径见上表）；A84 / A88 / A89 / A90 / A94（真机部分）/ A95 / A96 / A97 / A99–A115 待真机。运行前需 `wails build` 刷新 exe（最新交付 `book-editor-D112.exe`）。

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
| D97 | §4.5 仅「点击高亮 → 气泡」 | **悬停提示** `.mark-hovertip`：`bindStageMarks` 增 `mousemove`/`mouseleave` 命中，稳定停留后浮出；新增 `HOVER_TIP` 打点 | 用户首轮要求「悬停显示感悟」；后经 D98 修订为显示全部标记内容 |
| D98 | D97 口径：悬停只显示**感悟**、点击仍弹气泡（可编辑/删除） | **按用户最终要求重定**：① 悬停显示**标记内容**（原文 + 感悟，不只是感悟），悬浮即显、鼠标离开立即消失；② 提示 `position:fixed` + 视口坐标跟随光标、`pointer-events:none` 完全穿透（「移开即消失」才成立，不再需要「移入提示保持」豁免）；③ **右键高亮 → 「编辑标记 / 删除标记」菜单**（`.mark-menu`，fixed 定位，靠近边界夹紧；点别处/Esc/滚动/缩放关闭）；④ **左键点击高亮的 `mark-bubble` 气泡整体移除**（EPUB 与 TXT 两处），`showBubble`/`bubble` state 一并删除 | 用户明确要求「悬停显示内容 鼠标离开消失，右键可以编辑删除，悬停只显示标记内容」——原「点击弹气泡」不符合直觉。三个实现要点：① epubjs `DOM_EVENTS` 常量**不含 contextmenu**（只有 keydown/keyup/mouseup/mousedown/mousemove/click/touch*），翻页模式 iframe 内右键既冒泡不出也代理不到 → 直接在 iframe document 上装 `contextmenu`，并在 `rendered`/`relocated` 时对新文档补装；② TXT 侧同口径（`mousemove` 命中 `mark[data-mark-id]`、`contextmenu` 弹菜单）；③ 悬停判定条件由「有感悟(note)」改为「有原文(text)」，独立想法无原文不参与悬停 |
| D99 | 翻页模式可标记、滚动模式标记不了；翻页模式悬停看不到 | **D100 一并修复**（见下行）。D99 交付的 `book-editor-D99.exe` 未含此修复，用户真机反馈后定位 | 用户原话：「滚动模式悬停能看到 但是 翻页模式悬停看不到；翻页模式可以进行标记 但是 滚动模式标记不了」 |
| D100 | ① 滚动模式拖拽选词判定为欧氏距离 `hypot(dx,dy) > 6`；② 悬停判定只挂在滚动模式的 stage 上 | **两处根因，各自独立**：<br>① **滚动模式标记不了** — scrolled-doc 正文纵向滚动，选词必然带纵向偏移（选到行末下带半行约 8px），而 `hypot > 6` 对「纯纵向小幅拖动」门槛过高，斜向才勉强能过。改为按方向判定：`isMarkDrag()` 抽为可测纯函数，**横向 ≥ 6px 或纵向 ≥ 12px**（纵向门槛更高，因纵向手势更易与滚动混淆）。<br>② **翻页模式悬停看不到** — 翻页模式 iframe **未设** `pointer-events:none`（可交互），鼠标事件进 iframe 文档、不冒泡到宿主 stage，而悬停判定只注册在 stage 上 → 翻页模式从来没有悬停通道（日志里只有滚动模式那次会话的 `HOVER_TIP`，可为证）。改为在 `rendition.hooks.content` 里对章节文档直接挂 `mousemove`，命中后加 `iframe.getBoundingClientRect()` 换算宿主坐标，复用同一个 `scheduleHover`；`WeakSet` 去重防 relocated 重复绑定；离开用 `mouseout + relatedTarget` 判空（Chrome 跨文档边界只发 mouseout，`mouseleave` 不一定触发） | 顺序验证：[D99 日志](./) 只有 `mode=scroll` 一次会话的 `HOVER_TIP`，**翻页模式零悬停打点** → 反证通道缺失而非命中失败。附带清理：`bindStageMarks` 里 `overTip()` 用 `stage.querySelector(".mark-hovertip")` 做豁免是**死代码**（提示浮层渲染在 stage 的兄弟节点，恒返回 null），已删除并留注释防回归——提示本身 `pointer-events:none` 已保证不自激。新增诊断：`DRAG_UP`（dx/dy/isDrag）、`DRAG_UP_NOSTART`（mouseup 到达但 mousedown 未命中 iframe）、`DRAG_DOWN_NOIFRAME`、`HOVER_PAGE_HIT`（翻页命中，按 id 变化节流）、`HOVER_PAGE_NOIFRAME` |
| D101 | PDF 只有 D73 页级「标记本页」书签，**无法在页面上圈画哪句话/哪张图**；定位器 `quote` 恒空、从未用上 | **新增 PDF 画笔**（用户口径：类似画笔自由作画）：<br>① **数据**：`MarkLocator.pdf` 增加可选 `strokes?: PdfStroke[]`；`PdfStroke = {brush:'highlighter'\|'pen', color, width, points:number[], baseW, baseH, top}`。<br>② **坐标口径**（用户选「像素坐标」）：点的单位就是绘制时该页 canvas 的 CSS 像素；但每条笔迹额外记 `baseW/baseH` 基准尺寸，渲染时按 `当前宽/baseW` 等比缩放 —— 存储口径是像素（直观、可排查），**缩放/适宽/换窗口后笔迹仍严格对齐**。只存像素不存基准尺寸会必然错位，这是像素方案的固有缺陷，`baseW/baseH` 以极低代价规避。<br>③ **画笔层**：新增 `PdfInkCanvas`，每页一块透明 canvas 绝对定位覆盖在页面 canvas 上，`z-index:2`、尺寸按页面 CSS 尺寸 + DPR 位图（上限 4096px）。**未开启画笔时 `pointer-events:none`**，完全不影响阅读/滚动/缩放。<br>④ **工具**：高亮笔（透明度 0.32、粗线 16px）、自由笔（实色 2.5px）、橡皮擦（半径 10px + 线宽/2，逐段距离判定故长笔画中段也能擦）。三档粗细、六色（黄绿蓝粉红墨）。<br>⑤ **双模式**：翻页模式画笔层挂在 `.pdf-page`（双页则各自 `.pdf-page-cell`）；滚动模式挂进每个 `.pdf-page-slot`（虚拟化回收 canvas 时画笔层随之重建，笔迹由 marks 回放）。<br>⑥ **保存口径**：绘制中的笔迹存草稿（不触发 React 重渲染，落笔才提交），点「保存」才落库；同页已有笔迹标记则**追加**进同一条（避免一页画十次生十条面板条目）。「完成」= 有草稿时先自动保存再退出，避免白画。<br>⑦ **面板组织**（用户选「按页码 + 页内位置」）：PDF 走独立排序 `sortPdfMarks()` —— 先页码升序，同页内按 `top`（笔迹最高点/页高）升序，纯书签排同页末端；组头仍是「第 N 页」，条目 meta 补 `第 N 页 · X%` | **为什么不做文字层划词**：pdfjs textLayer 需要与 canvas 逐页对齐、缩放重算、虚拟化重挂，且扫描版 PDF 根本没有文字层；用户要的是「自由作画」，画笔方案直接覆盖这两类场景且不碰已验证的渲染链路。**校验层**：`normalizeStroke` 对点数 <4、奇数点、非法笔刷/颜色、`baseW/baseH<=0` 一律整条丢弃（画坏的笔迹重放出来是乱线，不如不画）；单页上限 200 笔、单笔 4000 点，超长笔画按预算抽稀。**向后兼容**：无笔迹时不写 `strokes` 字段，旧数据与旧标记形态完全不变 |
| D105 | 用户真机反馈（截图 + epub-diag.log）：① EPUB 滚动模式标记**仍是灰色块、且横向溢出正文**（覆盖文字的浅色块从正文左侧伸出）；② PDF 双栏模式下两页都画了笔迹，「保存（2 笔）」可用但「撤销/清空本页」呈灰色不可用 | <br>① **过滤方向错了（D103/D104 都错）** — `filterRects` 此前只丢「几何完全重复项」，**保留了容器级大框**（段落/body 包围盒）；marks-pane 原 render 会把它画出来 → 覆盖整段/横向溢出。marks-pane 原算法是「被包含即丢弃」（保留最大框），D103 记反了方向。**D105 反转**：丢弃「包含其它框的容器框」（`containsBox` 2px 容差），保留逐行框。另：截图高亮呈灰色说明 `attributes.fill` 缺失，加**颜色兜底**——按 `<g data-id>` 反查 marks 的真实 color 取 `MARK_HL_FILLS`，确保任何路径都有正确填充色；`HL_REPAINT` 打点增补 `rects=过滤后/原始` 与 `fill=` 便于真机核对。<br>② **撤销/清空页范围口径不一致** — `draftCount` 跨所有页统计（故「保存（2 笔）」可用），但 `canUndo`/`canClear`/`undoInk`/`clearInkPage` 全只看 `current`（左页），双栏右页 `current+1` 的草稿被忽略 → 按钮灰色、右页笔迹无法撤销。新增 `utils/pdfInkUndo.ts`：`visiblePages`（双栏含 current+1）、`undoTargetPage`（可见页内草稿优先、右页优先）、`canUndoInk`/`canClearInk`，统一口径。 | ① 这是**第三次**针对同一视觉现象的调整（D102 CSS→D103 去重→D104 坐标→D105 过滤方向）。关键教训：**第三方算法的方向要逐字验证，不能凭「它有问题所以反过来就对」**——D103 把 marks-pane 的「被包含即丢弃」误读成「保留全部」，恰恰又保留了它想去掉的容器框。截图是唯一可信证据：灰色 + 溢出 = 容器框被画 + fill 缺失，两条同时修。<br>② 「保存可用但撤销灰色」是**口径分裂**的典型信号：同一个工具栏里两个按钮对「当前页」的理解不同。统一到纯函数层并配 7 例单测（含「可见页外草稿不误撤」）防回归。 |
| D112 | 用户新反馈：「pdf 放大缩小抖动严重 需要优化」「画笔的状态栏 如果在左右2 边需要改成纵向的」 | <br>① **滚轮缩放去抖**：原实现每个 `wheel` 事件都 `±PDF_ZOOM_NUDGE(10%)` 并触发一次 settings 更新→双页重绘→锚点校正；高频滚轮/触控板使 canvas 反复「清空→异步重绘→再清空」，视觉上剧烈抖动。改为 60ms 窗口内累积 `deltaY`，`wheelZoomDelta` 按绝对值对称量化成整数格（不足一格不动，常见一格 100→±10%），一次性调用一次 `onZoomNudge`；锚点仍取窗口内最后一次滚轮位置，保持 zoom-to-cursor。另 `renderOnCanvas` 仅当 `canvas.width/height` 真变化时才赋值，避免无谓清空位图。<br>② **工具栏靠边纵向**：D109 的拖动位置是纯 left/top，横向长条移到侧边仍横着挡正文。新增 `inkToolbar.ts` 判定层：松手时按落点距容器左/右边缘（阈值 160px）决定 `dock`，非空时根节点加 `.vertical`；`inkDockX` + layout effect 按切换后的新宽度重新贴边（留 12px）并钳制高度；双击复位同时清 dock。CSS 竖排分组、分隔符转横线、色点保持单行、按钮全宽、滑块自适应填满 | ① 抖动有两层：一是**事件频率 × 固定步进**导致重绘风暴，二是**canvas.width/height 赋值会立即清空位图**，两者叠加才是「严重抖动」。只在 JS 侧节流而不改位图赋值仍会闪；只在 CSS 侧做过渡又消除不了重绘。锚点逻辑本身（D110）是对的，不动它，只减少调用次数。滚轮 delta 用**绝对值对称取整**（`Math.round(-2.5)` 得 -2，正负手感不一致）。<br>② 用户说的「状态栏」实际指画笔**工具栏**（D109 起可拖动）；需求不是「再加一个按钮」，而是**同一工具栏在不同落点改变排布方向**。判定放在松手时而非拖动中，避免横/纵切换导致宽度变化与位置互相拉扯；重新贴边放到 layout effect（DOM 已换成纵向宽度后）才能一次到位。 |
| D111 | 用户反馈：「橡皮的逻辑不太对 直接把 标注内容完全擦除了 跟范围完全没有关系 并且 自由笔 和 高亮的 鼠标图标也可以优化一下」 | <br>① **局部擦除（真正的按范围擦除）**：`hitStrokes` 只返回「命中的笔迹下标」，`eraseAt` 随即 `filter` 掉整条 → 用户看到「碰一下整条标注消失」，与滑块调的范围无关。新增 `eraseStrokesAt`：把橡皮中心/半径按 `pageW/baseW` 反变换到笔迹自身基准系，逐段用 `distToSegmentSq` 判定（线宽一半算进范围，与旧命中口径一致），连续未命中段聚合成新笔迹（`...stroke` 保留色/笔刷/基准尺寸，`top` 按 `baseH` 重算），被覆盖段丢弃；无变化返回原数组引用跳过 setState。去掉「一次拖拽同一条只删一次」的 Set（局部擦除幂等，连续拖拽本就该持续削除）。<br>② **三种笔刷光标可视化**：D109 只给橡皮做了 overlay 圈，自由笔/高亮仍是系统 `crosshair`，看不到线宽与颜色。`syncEraserCursor` 泛化为 `syncInkCursor`：橡皮=范围圈、高亮=与落笔线宽等宽的半透明胶囊条（`inkCursorColor` 按色点+深浅着色）、自由笔=实心色点（最小 6px 保证可见）；统一 `data-brush` + CSS 三变体，三种笔刷都隐藏系统光标 | ① 这是「命中判定」被当成「删除粒度」用的典型：`hitStrokes` 的语义是「这条笔迹是否被碰到」，拿它做 filter 必然整条删——范围可调但删除粒度不可调，用户自然觉得「跟范围无关」。切分必须在**笔迹基准坐标系**做：切分后的点直接写进 `points`，若用当前页面坐标切分再以旧 `baseW/baseH` 回放，缩放后会整体错位（D101 像素方案的老问题）。<br>② 用户说的「鼠标图标」与 D109 的「橡皮范围示例」是同一设计语言在不同笔刷上的缺失：橡皮有 overlay 圈、笔刷却没有，且系统 crosshair 不体现线宽/颜色，调了粗细深浅也看不出差别。三种笔刷统一用 overlay 是把 D109 做法补齐，不是另起机制。 |
| D110 | 用户新需求：「pdf 按着 ctrl 键需要支持拖动，放大也应该根据鼠标进行放大」（截图为双栏 80%） | <br>① **Ctrl+拖动平移**：两模式阅读容器（`.pdf-canvas-area` / `.pdf-scroll`）在 **capture 阶段**监听 pointerdown/move/up，Ctrl+左键拖动按指针位移改 `scrollLeft/Top`；`setPointerCapture` 锁定指针、`stopPropagation` 阻止事件到达 `InkCanvas`（画笔开启也不误落笔）；按住 Ctrl 给容器及子元素加 `grab`/`grabbing` 光标。<br>② **鼠标锚点缩放**：Ctrl+滚轮在缩放前记录鼠标相对视口（`vx/vy`）与相对内容元素（`px/py`）的偏移及内容尺寸；待 settings 异步更新、canvas 重排完成（`renderPage`/`renderScrollPage` 内、canvas 尺寸已写入 DOM）后用 `zoomAnchorScroll` 算新 `scrollLeft/Top`，使 `anchorInContent × ratio` 后的内容点仍落在原 `anchorViewport`；3 秒过期保护避免缩放被钳制时残留锚点误校正。<br>③ **flex 居中溢出修正**：`.pdf-canvas-area` 的 `justify-content`/`align-items` 追加 `safe center`——放大后内容宽于容器时回退到起点，否则左侧被裁到滚动区外且滚不到。 | ① 「拖动」与「落笔」共用同一指针通道，**必须在 capture 阶段抢先消费**，否则画笔层先收到 pointerdown 就画出一笔（D109 的画笔层已铺满页面，冲突是现实存在的）。<br>② 缩放中心是异步状态：settings 更新与 canvas 尺寸写入不同帧，**锚点校正必须放到重绘完成后**，不能在 wheel 回调里同步算——那时 DOM 还是旧尺寸，ratio=1 等于没做。用户口径「根据鼠标放大」即 zoom-to-cursor，不是「放大按钮位移」，故保留原有倍率步进口径、只改滚动校正。<br>③ flex `center` + `overflow:auto` 是已知陷阱：内容溢出时左侧不可达，既是独立可用性缺陷，也会让锚点缩放看起来「跳走」，必须与 JS 校正同步修。 |
| D109 | 用户反馈（截图）：① 橡皮应优化「鼠标的模型」；② 画笔侧边栏不能拖动、布局需优化（截图显示「保存/完成」被挤到第二行） | <br>① **橡皮光标模型**：`PdfInkCanvas` 在橡皮激活时渲染 `.pdf-ink-cursor` 圆圈（跟随指针、`pointer-events:none`），直径由 `eraserCursorDiameter(size, scale)` 按 `rect/page` 缩放换算、**与 hitStrokes 命中直径严格一致**；橡皮模式 `cursor:none` 隐藏系统光标避免双光标。选 DOM overlay 而非 CSS `cursor:url()`——后者受系统光标尺寸上限（常见 32px）约束，橡皮直径最大 48px 会被截断。抽 `eraserCursorDiameter` 纯函数供组件与测试共用。<br>② **工具栏可拖动 + 布局优化**：`PdfInkToolbar` 加 `ib-grip` 手柄，按住拖动写 `pos`（绝对 left/top），双击复位 `null` 回默认底部居中；拖动与 resize 都把位置钳制在父容器（`section.state`，`position:relative`）内。布局紧凑化：padding 6px 8px、滑块 76→64px、`.ib-group`/滑块 `flex:none`（防按钮被 flex-wrap 拆散）、`align-content:center`（换行后整齐） | ① 用户 D108 已能在工具栏看到范围示例，但鼠标落到画布上仍是 `cell` 光标——**示例在工具栏、光标在画布，是两处不同的呈现**，用户要的是「鼠标本身」体现橡皮范围，故补画布光标并与命中范围共用同一换算口径（避免示例画一个尺寸、实际擦另一个尺寸）。<br>② 工具栏固定 `left:50%; translateX(-50%)` 底部居中，不能移开——用户想拖到侧边不挡正文。截图里「保存/完成」被换行挤到左下，根因是 `flex-wrap` 下各 group 可被拆散；`flex:none` 让每组作为整体换行，配合缩小间距尽量回到单行。 |
| D108 | 用户两项反馈：① 橡皮缺少示例范围；② EPUB 滚动模式标记仍没有（11:29 日志 `DRAG_CFI len=35 contents=0 cfi=0` → `SELECT_DROP reason=cfi`） | <br>① **橡皮范围示例**：`PdfInkToolbar` 新增 `EraserPreview`——26px 固定视窗内按 `直径/最大直径`（橡皮半径 4–24 → 直径 8–48）比例画实心圆（擦除覆盖）+ 虚线圈（最大范围参考），滑块旁标 `4–24` 端点，CSS 补 `.ib-eraser-preview` / `.ib-range-scale`。<br>② **滚动划词 CFI 修复（关键）**：`rendition.views()` 实为 Views **管理器**，其 `find(section)` 收 section 对象（读 `.index`），而三处代码传了箭头函数回调 → 恒 undefined。`chapterInfoForDoc`/`onDragSelect`/`installAll` 全部改走新增的 `allViews()`（`manager.views.all()`）；修正 `EpubRendition.views` 类型标注（一度误标为 `() => EpubView[]` 掩盖了错误）；`DRAG_CFI` 打点增 `views=` 数量便于区分「无 view」与「view 有但 contents 不匹配」 | ① 用户能在 D107 调深浅/橡皮大小，却看不出「这个数字到底擦多大」——数值读数不等于范围示例，补一个所见即所得的圆。<br>② **这是 D106 修复后立刻暴露的更深层错误**：D106 把划词断点从「range 生成」修通后，CFI 阶段的 `views().find(回调)` 误用才浮出水面——此前划词根本走不到这里，错误被前面的静默失败掩盖。教训：**当日志证明链路越过了旧断点、又停在新打点时，要顺着链路逐段核对每一处 API 的真实签名，而不是回头重修上一段**。`views()` 的返回类型被错误标注为数组，是这次误用能长期潜伏的直接原因——**第三方 API 的类型标注要与运行时源码核对，不能凭名字猜**（与 D105「算法方向逐字验证」同源）。11:29 日志是决定性证据：`DRAG_CARET`/`DRAG_RANGE_OK` 全到位、唯 `contents=0 cfi=0`，直接锁定 CFI 阶段而非过滤/绘制阶段。 |
| D107 | 用户反馈：画笔功能要扩展、布局要优化，「目前连画笔的颜色深浅都不能调整」 | <br>① **深浅可调**：`PdfStroke` 增可选 `alpha`，`paintStroke` 改用 `stroke.alpha ?? BRUSH_ALPHA[stroke.brush]`；工具栏高亮笔加「深浅」滑块（0.05–1，步长 0.05，实时百分比读数），`normalizeStroke` 兼容校验（非法值仅回落默认、不丢弃整条笔迹）。<br>② **橡皮大小可调**：新增 `ERASER_SIZE_*` 常量与 `clampEraserSize`（4–24px，步长 1），`InkTool.eraserSize` 与命中半径联动，工具栏加「大小」滑块。<br>③ **布局重组与紧凑化**：工具栏重写为五段式（笔刷 / 颜色 / 样式 / 历史 / 动作），样式区按当前笔刷条件渲染（高亮=粗细+深浅、自由笔=粗细、橡皮=大小）；CSS padding/gap 收紧、`.ib-size-*` 改为通用 `.ib-field`（label/val/range） | 用户原话「连颜色深浅都不能调整」说明这是**可用性缺口**而非锦上添花——透明度此前写死在 `BRUSH_ALPHA`（高亮 0.32 / 自由笔 1）。沿用 D101–D106 一贯做法：**新字段一律可选**（`alpha?`），D101–D106 旧笔迹零回归；深浅只在高亮笔暴露（自由笔实色无深浅语义）、橡皮只暴露大小，避免无效控件；所有滑块输入先经钳制函数再入状态，防止脏值经 localStorage 回流。` | 
| D106 | 用户三项反馈：① PDF 画笔有「撤销」但没有「恢复」；② PDF 打开希望默认翻页 + 双栏；③ EPUB 滚动模式标记仍有问题（10:57 日志 `mode=scroll`，3 次 `DRAG_UP isDrag=true`，但零 `SELECTED_EVENT`/`TOOLBAR_SHOW`/`HL_REPAINT`） | <br>① **恢复（redo）**：`pdfInkUndo.ts` 新增 `InkRedoEntry`（draft/saved 两类）、`canRedoInk`、`popLastDraft`；`undoInk` 压栈，`redoInk` 反向执行（草稿笔加回草稿栈；已落库整组写回，标记若在撤销时被删则按记录的颜色/页码重建）。新落笔/保存/清空时作废 redo 栈。<br>② **PDF 默认翻页双栏**：新增 `Settings.pdfReaderMode`（默认 `"page"`）与 `PDF_READER_MODE_DEFAULT`，与 EPUB/TXT 的 `readerMode`（默认 `"scroll"`）解耦；`pdfColumns` 缺省由 1 改 2（显式值优先，尊重用户手动切换）。App 用 `effectiveReaderMode` 收敛，工具栏按当前书格式写对应字段。<br>③ **滚动模式划词静默失败**：`bindStageMarks` 的 `down` 从 `{x,y}` 改为 `{x,y,iframe}`，mouseup 复用**按下时的 iframe** 换算终点——旧实现重新 `iframeAtPoint(ev)`，滚动模式多章节 iframe 纵向堆叠时起止可能落在不同 iframe/坐标系，`caretRangeFromPoint` 返回 null 后静默 return；另加按 `range.startContainer.ownerDocument` 二次匹配 contents 的 fallback，并补 `DRAG_CARET`/`DRAG_RANGE_OK`/`DRAG_RANGE_NULL`/`DRAG_CFI`/`SELECT_DROP` 五组打点 | ① undo/redo 必须成对，只加撤销不加恢复是交互缺口；已落库笔迹的恢复要能应对标记在撤销时被删，故记录整组 strokes + 颜色 + 页码用于重建。<br>② 这是 D102「正交维度不要塞进同一个枚举」的延伸——**不同格式的阅读模式也是正交维度**，塞进同一个 `readerMode` 会导致「改 PDF 默认误伤 EPUB/TXT」。旧配置显式 `pdfColumns:1` 仍被尊重。<br>③ 同一类错误再次出现：**鼠标交互的起止点必须锁定同一坐标系来源**（D100 教训的延续，D100 修事件通道、D106 修坐标来源）。日志证据链是 `DRAG_UP isDrag=true` 之后链路全断，说明断点在 range/CFI 阶段而非过滤/绘制阶段——**先按打点定位断点再改代码**，避免又去动已经过四轮的高亮过滤方向。 |
| D104 | **静态审查发现（非用户新反馈）**：D103 新增的 `repaintHighlight()` 自行用 `svg.getBoundingClientRect()` 当原点写 `<rect>`，跨了两个坐标系 —— `Range.getClientRects()` 返回的是 **iframe 内容文档视口坐标**（从 0 起），而 `svg.getBoundingClientRect()` 是**宿主页面坐标**（含侧栏/留白偏移）。容器一旦不在页面原点，高亮会**整体左上偏移** | **只替换矩形过滤，不接管坐标计算**：改为临时替换 `Mark.filteredRanges()` 喂入 `filterRects()` 的结果，然后 `originalRender.call(mark)` 调用 marks-pane 原 `render()`。原公式 `r.left - offset.left + container.left` 中的 `+ container.left` 正好抵消 Pane 容器在宿主页面的偏移，是正确的 iframe 内坐标 → SVG 局部坐标桥梁；D103 自行换算把它丢了。`finally` 中恢复原方法（按 `hasOwnProperty` 判断是否需要 `delete`），避免污染后续 relocate/其它视图。保留 D103 的 `rx=2` 与「颜色写到每个 `<rect>`」防御措施。移除 D103 的 `toSvgRect()` 及其 2 个单测（错误方案的产物）→ vitest 279→277 | D103 修的是「矩形数量」（去重吞掉逐行框），D104 修的是「矩形位置」（坐标系混用），**两条独立缺陷**。本条由静态审查 epubjs/marks-pane 源码发现：`marks-pane/src/marks.js` 的 `Highlight.render()` 明写 `+ container.left`，`epubjs/src/managers/views/iframe.js` 的 `highlight()` 用 `new Pane(this.iframe, this.element)` 创建覆盖层 —— 两处合起来证明原 render 的坐标系是自洽的，自行接管必然出错。`HL_REPAINT` 打点字段由 `svg=…` 改为 `g=…`（原 render 重画后实测包围盒）。**教训：接管第三方渲染时，若只替换其中一个环节（过滤），应复用其余环节（坐标换算），不要整条重写。** |
| D103 | ① D102 的 CSS 拆分修完后，EPUB 滚动模式高亮**仍**是整块实心矩形盖住正文；② PDF 双栏下放大缩小，页面横向溢出被裁切（截图「自定义 · 双栏 70%」左右两页都被切） | <br>① **另一条独立成因（几何侧，D102 只修了 CSS 侧）** — epubjs 的高亮由 `marks-pane` 的 `Highlight.render()` 绘制，其 `filteredRanges()` 去重规则是「凡被另一个矩形**包含**即丢弃」。`Range.getClientRects()` 在跨块（段落/body）选区时会额外返回一个**容器级包围盒**，于是所有逐行框都被它吞掉 → 只剩一个大矩形 = 整块实心色块。用 node 脚本复现验证：纯多行 → 3 个 rect（正常），加入整段包围盒 → **1 个**（即整块），加入整页包围盒 → 1 个。修复：新增 `utils/epubHighlight.ts`（`filterRects` 只丢零面积项与几何重复项、**保留被包含的逐行框**；`toSvgRect` 显式传原点），`EpubViewer` 新增 `repaintHighlight()` **自己算 rect、自己写 `<rect>`**，在 annotations 同步与 `hooks.render` 补挂两处都重画一遍；原点改用 pane 的 `<svg>` 视口矩形（`<g>` 首次渲染前包围盒为 0，用它当原点会整体偏移）。颜色写到每个 `<rect>` 上而非依赖 `<g>` 继承（`rx=2` 圆角）。<br>② **双栏缩放基准错误** — 此前 custom 恒用 `pw × zoom/100`，双栏时两页总宽 = 2×单栏基准，必然溢出裁切；且 `reportScale` 上报的是折算后的真实倍率，`handleZoomNudge` 拿它当基点会把倍率算飞。修复：`resolvePdfScale` 的 custom 基准改为**随栏数走** —— 单栏 100% = `pw`（旧口径，存量零回归），双栏 100% = `(cw − gap)/2`（两页恰好铺满）；`reportScale` 在 custom 下改报用户设定值而非折算倍率。**栏数只改变倍率基准，不改变一次铺几页，因此怎么缩放都不破栏。** | ① 这是「同一视觉 bug 有两条独立成因」的典型：D102 修 CSS（`g` 上的 background 按包围盒填色）、D103 修几何（rect 被错误去重）。用户第二次反馈「标记还是有问题」正是只修一条的证据。**关键取证动作**：写 node 脚本直接复现 `filterRects` 与 `marks-pane` 的算法差异（B 场景 1 个 rect），把「猜测」变成「已证」。日志侧新增 `HL_REPAINT` 打点（id/rects 数/svg 尺寸）供真机核对。<br>② 用户口径是「缩放与扩大都不会打破单双栏规则」。取 100% = 铺满 是唯一能让「既要放大又要不出界」自洽的基准；>100% 允许溢出属用户主动放大（可横向滚动），≤100% 必须装得下，单测按此边界断言。 |
| D102 | ① EPUB 滚动模式高亮糊成一整块实心矩形盖住正文；② PDF 画笔粗细只有「细/中/粗」三档按钮，无法微调；③ PDF「双页」被做成 `pdfFit` 的一个取值，任何缩放/换适配方式都会退回单页 | **三项独立修复**：<br>① **高亮矩形（根因：CSS 选择器跨格式误伤）** — `.mark-hl-*` 同时作用于 TXT 的 `<mark>` 与 EPUB 的 SVG `<g>`。`background` 在 SVG `<g>` 上按**包围盒**（所有高亮行的外接矩形）填色，多行高亮就连成一整块实心矩形。改为两套：`mark.mark-hl-*`（TXT 保留 background + inset 下划线）、`g.mark-hl*`（强制 `background:none; box-shadow:none; padding:0`，EPUB 颜色本来由 annotation 的 `fill`/`fill-opacity` 给出）；`EpubViewer.tsx` 两处挂类**只加功能类 `mark-hl`、不加颜色类**，并对已渲染 DOM `classList.remove` 残留旧颜色类（升级前写入的节点会带着它）。<br>② **粗细滑块** — `SIZE_PRESETS` 三档按钮 → `<input type="range">`，范围 0.4–4、步长 0.1、默认 1（与 `PdfInkCanvas` 落笔时的钳制区间一致），右侧显示实时像素线宽读数（高亮基准 16px / 自由笔 2.5px × 倍率）；`clampSize()` 导出供工具栏与测试共用。<br>③ **栏数解耦** — 新增 `Settings.pdfColumns: 1\|2`，与 `pdfFit` 完全独立。`pdfScale.ts`：`resolvePdfScale` 增加 `columns` 参数（双栏时可用宽度先扣 `PDF_PAGE_GAP` 再对半分），新增 `columnStep(columns)` 取代 `spreadStep(fit)`；`PDF_FITS` 剔除 `spread`（保留 `PDF_FITS_ALL` 作归一百名单），新增 `migratePdfFit()` 把旧 `spread` 等价改写为 `auto`。`normalizePdfColumns(v, legacyFit)` 做迁移：无 `pdfColumns` 而 `pdfFit==='spread'` → 2，否则 1；显式值优先。`PdfViewer.tsx` 全部 `spreadStep(...)` 改读 `settings.pdfColumns`（翻页步进、初始定位、`flipFrom`、键盘处理、`spreadOn`、`nextLimit`、尺寸 effect 依赖），控制条 chip 同时显示「适配方式 · 单栏/双栏 倍率」，档位菜单新增「页面布局 单栏/双栏」；`SettingsPanel` 同步加同一开关 | **三处都属「表象在 A、根因在 B」**：① 用户现象是「滚动模式高亮有问题」，根因却在共享 CSS 的跨格式误伤（TXT 与 EPUB 共用一套类名）；修完必须**同时**清掉已渲染 DOM 的旧类，否则老会话里残留的类仍会画出矩形。② 三档按钮是 D101 的简化取舍，真机上手写字才发现「差一点点手感完全不同」，改滑块是必然。③ 旧设计把「双页」当适配方式是**建模错误**——栏数（一次铺几页）与适配方式（每页多大）是两个正交维度，混在一个枚举里必然互相踩踏；`spread` 仅作为兼容别名保留在 `PDF_FITS_ALL` 与 `FIT_LABELS` 里（避免查表 undefined），导航层统一走 `migratePdfFit` 解释。**行为回归防护**：升级后原本的双页读者仍是双栏（迁移 2），且此后任何缩放都不再改变栏数 |

**风险**
- EPUB iframe 内选词的坐标换算已有先例（`bindStageInteraction` 的 `iframeContentPoint`），工具条定位复用该函数，不新造轮子。
- marks 面板与设置面板可同显（从设置打开时）：层级高于设置面板，Esc 分层关（沿用 v0.2.8 先例）。**D95 改弹窗浮层后，与设置面板同显时的遮罩/层级关系待真机确认。**
- 导出大量标记时 Markdown 字符串拼接在渲染线程同步执行（2000 条 ≈ 数毫秒），可接受；不引入 Web Worker。
- EPUB 翻页模式 epubjs iframe 带 `translateZ(0)` 合成层，跳章瞬间宽度可达数万像素（实测 43764px）；**任何关于层叠/宽度的推断都必须先由 `epub-diag.log` 的几何打点实证**（D84/D88/D93 三次教训）。
- `rendition.resize()` 严禁传百分比字符串（D88 会引发宽度指数暴涨）；参数必须是由 `getBoundingClientRect()` 实测的 floor 像素。
- **两种模式的鼠标事件通道完全不同，任何鼠标交互都必须双路实现**（D100 教训）：滚动模式 iframe 被设 `pointer-events:none`，事件落在宿主 stage（`bindStageMarks`）；翻页模式 iframe 可交互，事件进 iframe 文档、宿主收不到，必须在 `rendition.hooks.content` 里对章节文档直挂监听并用 `getBoundingClientRect()` 换算坐标。**不要假设「在 stage 上挂一次就两种模式都能用」**——D98 的右键（`contextmenu`）与 D100 的悬停（`mousemove`）都栽在这个假设上，两次都是同一根因。
- 查找提示浮层/菜单等 React 渲染的浮层，**不能用 `stage.querySelector`**——它们是 stage 的兄弟节点，恒返回 null。曾据此写出一个永假的「豁免」判断（D100 已删）。
- 平铺 `toc.ncx` 无真实层级信息，D91 只能启发式推断；个别落在分页边界且无锚点的故事仍被判为父项，属已知残留，非实现缺陷。
- **共享 CSS 类名必须按宿主元素类型限定作用域**（D102 教训）：`.mark-hl-*` 曾同时命中 TXT 的 HTML `<mark>` 与 EPUB 的 SVG `<g>`。HTML 的 `background` 与 SVG 的 `background` 语义完全不同（后者按包围盒填色），一个类名跨两种宿主必然出事故。今后凡「同一语义在 HTML 与 SVG 两侧都要生效」的样式，**必须写成 `tag.class` 双份**，并在注释里写明另一侧的存在。
- **正交维度不要塞进同一个枚举**（D102 教训）：栏数（铺几页）与适配方式（每页多大）是正交的，旧实现把「双页」做成 `pdfFit` 的取值，导致切适配方式必然踩掉栏数。凡两个维度可以独立取值，就是两个字段。
- **第三方库的「去重/优化」逻辑必须验证语义，不能假设它是对的**（D103 教训）：`marks-pane` 的 `filteredRanges()` 用「被其它矩形包含即丢弃」做去重，单行选区看不出问题，跨块选区时 `getClientRects()` 会返回容器包围盒，于是逐行框全被吞掉、只剩一个大矩形 —— 渲染出来就是整块实心色块。凡依赖第三方几何/布局计算，先用最小用例验证其输出与预期一致，否则自己接管该步骤。
- **同一个视觉 bug 可能有两条独立成因，必须分别验证**（D102/D103 教训）：EPUB 高亮「整块矩形」既有 D102 的 CSS 侧（SVG `<g>` 上的 `background` 按包围盒填色），又有 D103 的几何侧（rect 被错误去重）。只修一条不会好——用户第二次反馈正是证据。遇到「修了没效果」时，不要重复加固同一处，而要质疑「是否还有第二条路径」。
- **接管第三方渲染时，只替换有缺陷的环节，其余环节原样复用**（D104 教训）：D103 为了修「矩形被错误去重」，把 marks-pane 的整个 `render()` 重写了，连带丢掉它正确的坐标换算（`r.left - offset.left + container.left` 中的 `+ container.left` 抵消容器偏移），引入新的整体偏移缺陷。正确做法是临时替换 `filteredRanges()` 再调用原 `render()`——**改一处、留一处**。跨坐标系尤其危险：`getClientRects()` 是 iframe 内文档视口坐标，`getBoundingClientRect()` 是宿主页面坐标，两者不可直接相减。
- **第三方算法的方向要逐字验证，不要「它有问题就反过来」**（D105 教训）：marks-pane 的 `filteredRanges()` 是「被包含即丢弃」（保留最大框），D103 想修它却写成「保留全部」，反而把想去掉的容器框也留下了——同一视觉 bug 拖了 D102→D105 四轮。凡「反向操作第三方逻辑」，必须先写出真值表/最小用例证明新方向的输入→输出，再落地。
- **同一个工具栏里多个按钮对「当前范围」的理解必须一致**（D105 教训）：PDF「保存（2 笔）」跨页统计、「撤销/清空」只看当前页，导致「保存可用但撤销灰色」的矛盾态。凡按「当前页/当前范围」启用的按钮，统一走同一个纯函数层算范围（这里是 `pdfInkUndo.visiblePages`），不要各处自行推导。
- **同一指针通道上的「导航手势」要在 capture 阶段抢先消费**（D110 教训）：Ctrl+拖动平移与画笔落笔共用 pointer 事件，若在冒泡阶段处理，画布层会先收到 pointerdown 并落笔。用容器 capture 监听 + `setPointerCapture` + `stopPropagation` 三重保证「导航手势优先」，且拖动中不误画。
- **依赖 DOM 几何的校正必须等尺寸真正落定**（D110 教训）：缩放由异步 settings 驱动，wheel 回调里 DOM 还是旧尺寸，此时算出的 ratio≈1 等于没做。锚点校正要放到渲染函数内（canvas 尺寸已同步写入 DOM）执行，并加过期保护防止缩放被钳制时残留锚点误校正事件。
- **`display:flex; justify-content:center` + `overflow:auto` 会裁掉溢出侧内容**（D110 教训）：内容宽于容器时 flex 居中把起点推到滚动区外且滚不到。需要放大/缩小的阅读容器一律用 `safe center`（或 `margin:auto` 方案），否则「放大后看不全」且鼠标锚点校正也会表现得像是跳位。
- **「命中判定」不等于「删除粒度」**（D111 教训）：`hitStrokes` 返回的是「笔迹是否被碰到」，直接拿去 filter 必然整条删——范围可调而删除粒度不可调，用户自然觉得「跟范围无关」。凡「按范围作用于对象的一部分」，先明确目标是整对象还是局部段，再选算法（这里是逐段切分 `eraseStrokesAt`）。
- **几何切分要在数据自身的坐标系做**（D111 教训）：笔迹存基准坐标 + `baseW/baseH`，若用当前页面坐标切分再按旧基准回放，缩放后会整体错位（D101 像素方案的老问题）。把橡皮中心/半径反变换到基准系再判定，切出的点可直接持久化。
- **高频输入事件要合并后再驱动重渲染**（D112 教训）：Ctrl+滚轮每个事件都改 settings，会引发「状态更新 → 双页重绘 → 锚点校正」风暴；再叠加 `canvas.width/height` 赋值立即清空位图，就成了用户口中的「严重抖动」。先按时间窗口合并事件、量化成一步，再落到渲染；同时避免无谓的位图尺寸写入。DOM 几何校正（D110 锚点）本身没错时不要推倒重做，先减少它被触发的次数。
- **可拖动 UI 的布局方向要在落点确定后再切换**（D112 教训）：横/纵切换会改变元素宽度，若拖动过程中实时切换，位置钳制与新宽度互相拉扯会抖。松手时再判定靠边、用 layout effect 在新宽度下重新贴边一次到位；阈值判定与贴边坐标都抽纯函数配单测，避免视觉问题变成不可测的手感问题。

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
| T13 | D98–D102 体验增强：悬停/右键口径重定、双模式事件通道、PDF 画笔、高亮矩形修复、粗细滑块、单双栏解耦 | tsc/vitest/go test/build 全过 + 真机视觉确认 | 🔶 代码完成并提交 `c0f8457`(D98)/`13a4ab3`(D100)/`9c74ae1`(D101)，D102 交付 `build/bin/book-editor-D102.exe`；vitest 221→**264 例全绿**（D100 markDrag 6 例；D101 pdfInk 21 例 + marks 8 例；D102 pdfScale 栏数 4 例 + settings 迁移 2 例）；**真机视觉与交互全部待用户确认** |
| T14 | D103 修复：EPUB 高亮 rect 重画 + PDF 双栏缩放基准 | tsc/vitest/build 全过 + 真机视觉确认 | 🔶 代码完成并提交 `c5c2bb6`，交付 `build/bin/book-editor-D103.exe`；vitest 264→**279 例全绿**（新增 `epubHighlight.test.ts` 11 例、`pdfScale.test.ts` 双栏基准 4 例）；**真机待确认**：滚动模式跨段划词是否逐行贴合、双栏 100% 是否铺满不溢出 |

| T15 | D104 静态审查修正：高亮重画改用原 render 坐标系 | tsc/vitest/build 全过 + 真机不偏移 | 🔶 代码完成并提交 `39c909f`，交付 `build/bin/book-editor-D104.exe`；vitest 279→**277 例全绿**（移除 D103 弃用的 `toSvgRect` 2 例，过滤逻辑 9 例保留）；**真机待确认**：A102 高亮逐行贴合且**位置不整体偏移** |

| T16 | D105 真机反馈修复：EPUB 高亮颜色/容器框 + PDF 双栏撤销口径 | tsc/vitest/build 全过 + 真机视觉确认 | 🔶 代码完成并提交 `24a7785`，交付 `build/bin/book-editor-D105.exe`；vitest 277→**286 例全绿**（`epubHighlight.test.ts` 改为 11 例、新增 `pdfInkUndo.test.ts` 7 例）；**真机待确认**：高亮颜色非灰、无横溢容器框、双栏撤销/清空可用 |

| T17 | D106 三项：PDF 画笔恢复 + PDF 默认翻页双栏 + EPUB 滚动模式划词修复 | tsc/vitest/build 全过 + 真机确认 | 🔶 代码完成并提交 `7937f17`，交付 `build/bin/book-editor-D106.exe`；vitest 286→**294 例全绿**（`pdfInkUndo.test.ts` +4、`settings.test.ts` +4）；**真机待确认**：A105 恢复可用、A106 PDF 默认翻页双栏、A107 滚动划词弹工具条 |

| T18 | D107 画笔扩展：高亮深浅可调 + 橡皮大小可调 + 工具栏五段式布局 | tsc/vitest/build 全过 + 真机手感确认 | 🔶 代码完成并提交 `2194ad8`，`tsc --noEmit` PASS、`vitest run` 294→**299 例全绿**（marks +2、pdfInk +3），交付 `build/bin/book-editor-D107.exe`；**真机待确认**：A108 深浅/橡皮滑块手感、五段式布局视觉 |

| T19 | D108 两项：EPUB 滚动划词 CFI 修复 + 橡皮范围示例 | tsc/vitest/build 全过 + 真机确认 | 🔶 代码完成并提交 `f0ca2bd`，`tsc --noEmit` PASS、`vitest run` **299 例全绿**（无新增纯函数用例，修复为组件内 API 误用 + UI 示例），交付 `build/bin/book-editor-D108.exe`；**真机待确认**：A107 滚动划词弹工具条且日志 `DRAG_CFI cfi=1`、A109 橡皮范围示例视觉 |

| T20 | D109 两项：橡皮光标模型 + 工具栏可拖动与布局优化 | tsc/vitest/build 全过 + 真机手感确认 | 🔶 代码完成并提交 `45c5c9b`，`tsc --noEmit` PASS、`vitest run` 299→**300 例全绿**（pdfInk +1：橡皮光标直径换算），交付 `build/bin/book-editor-D109.exe`；**真机待确认**：A110 橡皮光标与命中范围一致、A111 工具栏拖动/复位/布局不再挤压 |

| T21 | D110 两项：Ctrl+拖动平移 + 以鼠标为中心缩放 | tsc/vitest/build 全过 + 真机手感确认 | 🔶 代码完成并提交 `4ed80c9`，`tsc --noEmit` PASS、`vitest run` 300→**304 例全绿**（pdfScale +4：zoomAnchorScroll），交付 `build/bin/book-editor-D110.exe`；**真机待确认**：A112 按住 Ctrl 拖动平移且不误落笔、A113 缩放锚点跟随鼠标且溢出可双向滚动 |

| T22 | D111 两项：橡皮按范围局部擦除 + 三种笔刷光标可视化 | tsc/vitest/build 全过 + 真机手感确认 | 🔶 代码完成并提交 `33d7057`，`tsc --noEmit` PASS、`vitest run` 304→**312 例全绿**（pdfInk +8：局部擦除 6 + 光标颜色 2），交付 `build/bin/book-editor-D111.exe`；**真机待确认**：A114 橡皮只擦范围、长笔画断成两段、缩放后对齐；A115 高亮/自由笔/橡皮光标形状与颜色 |

| T23 | D112 两项：滚轮缩放去抖 + 工具栏靠边纵向 | tsc/vitest/build 全过 + 真机手感确认 | 🔶 代码完成并提交 `a4c4f95`，`tsc --noEmit` PASS、`vitest run` 312→**321 例全绿**（pdfScale +1：`wheelZoomDelta`；新增 `inkToolbar` 8 例靠边停靠判定），交付 `build/bin/book-editor-D112.exe`；**真机待确认**：A116 快速连滚不抖且鼠标锚点不回退、A117 拖到左/右边缘自动纵向、回中部恢复横向、双击复位 |

**DoD**：`tsc --noEmit` PASS ✅、`vitest run` 321 例全绿（marks 60 + pdfInk 33 + pdfInkUndo 11 + pdfScale 39 + inkToolbar 8 + settings 54 + epubHighlight 11 + markDrag 6 + 其余 99）✅、
`go test ./...` ok ✅、`wails build -platform windows/amd64` 成功 ✅（最新交付 `book-editor-D112.exe`）、本文 §6/§7/§8 回填至 D112 ✅、D95 弹窗用户确认 ⏳、D89 翻页划词真机验证 ⏳、D98 悬停/右键真机 ⏳、D100 双模式悬停与滚动选词真机 ⏳、D101 PDF 画笔真机 ⏳、D102 三项（A99–A101）真机 ⏳、D103 两项（A102–A103）真机 ⏳、D104 高亮坐标系（A102）真机 ⏳、D105 两项（A102 颜色/容器框、A104 双栏撤销）真机 ⏳、D106 三项（A105 恢复 / A106 默认翻页双栏 / A107 滚动划词）真机 ⏳、D107 画笔扩展（A108）真机 ⏳、D108 两项（A107 滚动划词 CFI / A109 橡皮示例）真机 ⏳、D109 两项（A110 橡皮光标 / A111 工具栏拖动）真机 ⏳、D110 两项（A112 Ctrl+拖动平移 / A113 鼠标中心缩放）真机 ⏳、D111 两项（A114 橡皮局部擦除 / A115 三笔刷光标）真机 ⏳、D112 两项（A116 滚轮缩放去抖 / A117 工具栏靠边纵向）真机 ⏳、A83–A117 其余真机通过 ⏳、整合文档 §2/§11/§12 补 v0.3.0 行与 D65–D112 ⏳（下一步，未在本版范围）。

---

## 9. 本期不做（后续候选）

- 多设备云同步（当前纯本机 localStorage，与书架同边界）。
- 标注分享（图片卡片 / 长图）。
- 手写、画笔、区域框选标注（PDF 扫描版另论）。
- 标签体系（多标签归类标记）与标记的 AI 摘要/回顾。
- JSON / HTML 导出（D71 已排期候选）。
- 想法与高亮的互相转换（想法补选原文 → 转高亮）。
