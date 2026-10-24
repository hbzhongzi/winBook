# BookEditor v0.2.2 阅读模式切换（横向翻页 ⇄ 纵向滚动）落地方案

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0（方案评审） |
| 更新日期 | 2026-10-21 |
| 上位文档 | `doce/BookEditor-v0.2.0-个性化功能落地方案.md`（F1–F4 已落地，本方案为新增个性化项） |
| 关联文档 | `doce/BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md`、`doce/BookEditor-v0.1.0-整合项目文档.md` |
| 状态 | 方案评审：技术路径已探查真实代码，落地前待确认范围与默认值 |

## 1. 背景与目标

v0.2.0 已落地「阅读体验 / 界面外观 / 高级」三分类设置面板（主题、强调色、字号、章节预加载），v0.2.1 已落地书架与阅读位置记忆。当前三种格式的**呈现方式被写死**：

- **EPUB**：`EpubViewer.tsx` 用 `manager: "continuous"` + `flow: "scrolled"`，纵向连续滚动 + 自定义章节窗口化（`chapterWindow.ts`，基于 `stage.scrollTop` 做 append/prepend 与回收）。
- **PDF**：`PdfViewer.tsx` 单页逐页渲染（`renderPage` + 上一页/下一页按钮），横向翻页。
- **TXT**：`TextViewer.tsx` 单容器 `scrollTop` 纵向滚动。

用户希望把「横向翻页 / 纵向滚动」做成**可切换的个性化设置**，三格式统一受控。目标约束（沿用 v0.2.0）：

- 全部设置本地持久化，不上传、不联网；
- 默认值保持当前行为，**存量用户升级后阅读体验零回归**（故默认 = 纵向滚动，翻页为可选）；
- 切换时不丢失阅读位置（与 v0.2.1 的位置记忆正交协作）；
- 必须有单元测试与真书回归，不允许只做 UI 壳子。

## 2. 设计基线：阅读模式交互

新增设置项 **阅读模式**，两个互斥选项：

| 选项 | 含义（三格式统一语义） | 对应各格式实现 |
|---|---|---|
| 纵向滚动 | 一整条流式内容，滚轮/滚动条纵向推进 | EPUB=continuous+scrolled；PDF=连续滚动；TXT=当前滚动 |
| 横向翻页 | 按页/跨页呈现，上一页/下一页推进 | EPUB=default+paginated（分栏）；PDF=当前单页翻页；TXT=文本分页 |

**入口（两处，写入同一持久字段）**：

1. 设置面板「阅读体验」分类：新增「阅读模式」卡片，分段选择器（纵向滚动 / 横向翻页），保存后生效。
2. 阅读中工具栏（常显，仅 `book` 非空时）：同一分段选择器，改动**即时生效**（无需进设置面板），与设置面板双向同步。

> 两入口写同一个 `readerMode` 字段，故「设置里改 = 工具栏里改」等价；工具栏仅作便捷入口。

## 3. 功能清单

| 编号 | 功能 | 生效范围 | 默认值 |
|---|---|---|---|
| M1 | 阅读模式设置字段 + 持久化 + 迁移 | 全局 | 纵向滚动（保现状） |
| M2 | 设置面板「阅读模式」分段选择器 | 全局（即时预览） | — |
| M3 | 工具栏阅读模式快捷切换 | 阅读中（即时生效） | — |
| M4 | EPUB 横向翻页模式（默认 manager 分页） | EPUB | — |
| M5 | PDF 纵向连续滚动模式（懒加载虚拟化） | PDF | — |
| M6 | TXT 横向翻页模式（文本分页） | TXT | — |
| M7 | 状态栏渲染模式文案动态化 | 全局 | — |
| M8 | 切换模式时阅读位置保护（flush→重挂载→恢复） | 全局 | — |

## 4. 技术方案

### 4.1 设置数据模型新增 `readerMode`

`frontend/src/utils/settings.ts` 的 `Settings` 增加：

```ts
export type ReaderMode = "scroll" | "page";
export type Settings = {
  epubPreloadCount: number;
  theme: ThemeName;
  accent: string;
  fontSize: number;
  readerMode: ReaderMode;   // 新增：scroll=纵向滚动，page=横向翻页，默认 "scroll"
};
export const READER_MODE_DEFAULT: ReaderMode = "scroll";
```

- `normalizeSettings` 增加枚举校验（非法值回落 `"scroll"`），与现有 `clamp`/`normalizeTheme` 同风格。
- `DEFAULT_SETTINGS` 补 `readerMode: READER_MODE_DEFAULT`。
- 存储键仍为 `bookeditor.settings.v2`，**无需升键**：`normalizeSettings` 对缺失字段自动补默认（存量用户读到的旧对象无 `readerMode` → 回落 `"scroll"` → 零回归）。单测补「缺省字段回落默认」「非法枚举拒绝」。

### 4.2 全局流转：readerMode 到达 Viewer 与触发重挂载（含位置保护）

当前链路：`App` 托管 `settings` → `BookViewer` 透传 → 各 Viewer；`state-host` 的 `key` 为 `book.path + ":" + book.size + ":" + openCount`（`BookViewer.tsx:163`）。

改造：

1. **透传**：`BookViewer` 新增 `readerMode` prop，下发给 `EpubViewer`/`PdfViewer`/`TextViewer`；`App` 在设置变更时同步。
2. **重挂载触发**：把 `readerMode` 并入 `state-host` 的 `key`。任一入口改模式 → React 卸载旧 Viewer、挂载新 Viewer（沿用 v0.2.1 的加载遮罩过渡，切换有「正在恢复阅读位置…」动画，不闪）。
3. **位置保护（M8，核心不变量）**：重挂载前必须保留当前位置，否则切换模式会丢进度。实现：
   - 改模式时，`App` 先调用现有 `positionGetterRef.current?.()` 取当前实时位置（与 v0.2.1 离场节点 flush 同一取位通道），写入一个 `transientResume` 状态；
   - 重挂载后，Viewer 用 `transientResume ?? libraryResume` 作为 `resume` 恢复。
   - 因 v0.2.1 已保证「退出/点书架」节点也会写库，即便 `transientResume` 取位失败，仍有书架落库兜底，不会丢失超过一个离场周期的位置。
   - 触发点：`SettingsPanel` 提交与工具栏切换都先 `onChange(settings)` 回写 `App`，`App` 在 `readerMode` 实际变化分支里执行上述 flush+重挂载；为收敛改动，`App` 用 `useEffect` 监听 `settings.readerMode` 变化执行 M8（与现有 `subscribeSettings` 主题注入通道一致）。

### 4.3 EPUB 双模式（M4，最复杂）

当前 EPUB 强依赖 `chapterWindow.ts`：该窗口化系统用 `stage.scrollTop` 驱动相邻章节的 append/prepend 与回收（见 `EpubViewer.tsx:592-600` 接管 `manager.fill/check`、`:931-933` 用 `stage.scrollTop += ...` 跳转）。**这套逻辑只在 continuous+scrolled 下成立**。

两模式策略：

- **纵向滚动（默认，不变）**：`manager: "continuous"` + `flow: "scrolled"` + 自定义窗口化，完全保持现状。
- **横向翻页（新增）**：`manager: "default"` + `flow: "paginated"`（epubjs 分栏横向翻页）。
  - **关掉自定义窗口化**：把 `managerAny.fill/check` 的接管（`:596-599`）与 `createChapterWindow` 调用（`:600` 附近）用 `if (mode === "scroll")` 门控。paginated 模式下由 epubjs 默认 manager 自行管理章节加载（其分页加载本身就是按需的，但**不享受「窗口外章节回收」的内存优化**——这是翻页模式的有意取舍，见第 7 章风险表）。
  - **主题/字号注入保留**：`hooks.content` 注册（`:515-523`）对两种 manager 通用，继续注入阅读样式（与 v0.2.0 F2/F4 一致）。
  - **翻页导航**：paginated 模式新增上一页/下一页（工具栏复用 PDF 的 `pg-btn` 思路，或 EPUB 专用分段箭头），绑定 `rendition.prev()` / `rendition.next()`；键盘 `PageUp`/`PageDown` 或 `←/→` 翻页。
  - **位置采集（paginated）**：`getAnchor`（基于视口中线 `stage` 探针，`:774-796`）在 paginated 下无 `stage.scrollTop` 语义，需改用 `rendition.currentLocation()` 取当前可见章节与页内偏移；为与现有 `ReadingPosition` 兼容，**paginated 模式记录为章节级**（取 `sectionIndex`、`href`，`ratio` 取当前页在章节内的近似进度，无法精确时记 0）。这与 v0.2.1 已确认的「EPUB 章节级口径（D32）」一致，属预期内精度。
  - **位置恢复（paginated）**：`applyResume`（`:760-805`）的 `stage.scrollTop` 算法在 paginated 下无效 → 改用 `rendition.display(r.href)` 定位到章节首，章内比例在 paginated 下忽略（章节级恢复）。scroll 模式恢复逻辑完全不变。
- **`epubPreloadCount`（F1）在 paginated 模式下无意义**，界面与文档标注「仅滚动模式生效」。

### 4.4 PDF 双模式（M5）

当前 PDF 为单页翻页（`PdfViewer.tsx`）：`renderPage(current)` 逐页渲染到单一 canvas，上一页/下一页按钮。

- **横向翻页（默认，不变）**：单页翻页保持现状。
- **纵向连续滚动（新增）**：虚拟化连续滚动，避免一次性渲染全书页面撑爆内存（大 PDF 关键风险）。实现：
  - 外层纵向 `overflow:auto` 容器，内部按 `pageCount` 生成等高的页面占位槽（高度 = `viewport.height`，`SCALE` 沿用 1.2）；
  - 用 `IntersectionObserver` 只渲染「视口内 + 前后缓冲 N 页」的 canvas；离屏超过阈值的页清空 canvas（释放位图），回到视口再渲染；
  - 当前位置 = 视口顶部最靠上的可见页 → 复用现有 `PositionReport { kind:"pdf", page, pageCount }`，`progress = page/pageCount` 两模式通用；
  - 恢复：`scrollTo` 使 `initialPage` 所在槽置顶；翻页按钮在滚动模式下隐藏（或改为「回到上/下一页」跳转并滚动）。
- 两种模式共用 `pdfjsLib.getDocument` 解析与 `cleanup()`；仅渲染路径按 `readerMode` 分支。

### 4.5 TXT 双模式（M6）

当前 TXT 为单容器 `scrollTop` 纵向滚动（`TextViewer.tsx:36` 恢复、`:52` 采集，ratio 模型）。

- **纵向滚动（默认，不变）**：完全保持现状。
- **横向翻页（新增）**：把纯文本按当前字体/宽度分页，逐页展示。实现：
  - 用隐藏测量节点（与正文同字体、`white-space: pre-wrap`、同宽度）渲染全文，按每行 `offsetTop` 取得换行后的真实行边界；
  - `linesPerPage = floor(pageHeight / lineHeight)`，`lineHeight` 由测量节点 `getComputedStyle` 取；按行边界切分出每页起始行，得到 `totalPages`；
  - 展示固定高度页容器（同字体，溢出隐藏）+ 上一页/下一页；`resize` 与 `fontSize` 变更时重算分页；
  - 位置复用 `ReadingPosition { kind:"txt", ratio }`：`ratio = currentPage / totalPages`（翻页模式），恢复 `currentPage = round(ratio*totalPages)`；滚动模式 ratio 语义不变 → **两模式位置互通、互不破坏**（核心不变量）。

### 4.6 状态栏动态文案（M7）

`StatusBar.tsx:15` 的 `defaultDetail.epub` 写死「scrolled-doc（纵向滚动）」，`BookViewer.tsx:189` 的 `onChapterChange` 回调也写死「渲染模式：连续滚动」。改为按 `readerMode` 动态：

| 格式 \ 模式 | 纵向滚动 | 横向翻页 |
|---|---|---|
| EPUB | 连续滚动 | 横向翻页（分页） |
| PDF | 连续滚动 | 单页翻页 |
| TXT | 纵向滚动 | 文本翻页 |

`BookViewer` 把 `readerMode` 透传给 `StatusBar`（或 `onDetail` 拼接时带入），章节名仍随 `onChapterChange` 显示。

### 4.7 位置模型不变（核心不变量，重点）

`library.ts` 的 `ReadingPosition` 按 `kind` 区分（`epub`/`pdf`/`txt`），**不含任何渲染模式字段**；`reportPosition` 同步写库。本方案**不改动位置 schema**：

- EPUB 位置 = `{kind:"epub", tocIndex, href, sectionIndex, ratio}`，`ratio` 为章节内相对比例，与「滚动还是翻页」正交；
- PDF 位置 = `{kind:"pdf", page, pageCount}`，与模式正交；
- TXT 位置 = `{kind:"txt", ratio}`，与模式正交。

因此「先在某模式读、切换模式后退出、再原/异模式重开」都不会破坏已存位置；唯一精度差异是 EPUB paginated 模式记录为章节级（已在 4.3 说明，与 D32 一致）。

### 4.8 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/settings.ts` | 新增 `ReaderMode` 类型、`readerMode` 字段、校验、默认、单测 |
| `frontend/src/App.tsx` | 托管 `readerMode`；监听变化执行 M8（flush→重挂载）；`state-host` key 并入 `readerMode` |
| `frontend/src/components/BookViewer.tsx` | 透传 `readerMode` 到三 Viewer 与 `StatusBar`；key 并入 `readerMode` |
| `frontend/src/components/EpubViewer.tsx` | 新增 `mode` prop；paginated 分支（`manager:"default"`+跳过窗口化+`prev/next` 导航+章节级采集/恢复）；scroll 分支不变 |
| `frontend/src/components/PdfViewer.tsx` | 新增 `mode` prop；连续滚动虚拟化分支（IntersectionObserver 懒渲染）；单页翻页分支不变 |
| `frontend/src/components/TextViewer.tsx` | 新增 `mode` prop；文本分页分支（测量行分页+翻页）；滚动分支不变 |
| `frontend/src/components/StatusBar.tsx` | `defaultDetail` 与 `onDetail` 文案按模式动态 |
| `frontend/src/components/Toolbar.tsx` | 阅读中显示阅读模式分段切换（写入同一 `readerMode`） |
| `frontend/src/components/SettingsPanel.tsx` | 「阅读体验」分类新增「阅读模式」分段选择器 |
| `frontend/src/styles.css` | 翻页控件、TXT 分页容器、PDF 滚动容器、工具栏分段器等样式（四主题令牌化） |
| `e2e/verify_mode.py`（新增） | 三格式 × 两模式的切换流程 + 位置保护核对（切换前后截图/位置比对） |

## 5. 任务拆分与完成定义

| 任务 | 内容 | DoD |
|---|---|---|
| T1 | 设置模型 + 迁移 | 单测覆盖缺省回落/非法枚举；`npm test` 通过 |
| T2 | 全局流转 + 位置保护 M8 | 改模式触发重挂载且位置不丢（getter flush + transientResume 恢复）；三格式各验证一次切换前后位置一致 |
| T3 | EPUB 横向翻页 M4 | 真书《关键对话》翻页/键盘/主题注入正确；章节窗口化在 scroll 模式行为不变；paginated 章节级恢复正确 |
| T4 | PDF 连续滚动 M5 | 大 PDF 滚动流畅、内存可控（虚拟化）；位置 page 模型两模式通用；恢复置顶正确 |
| T5 | TXT 翻页 M6 | 分页与字号/resize 联动正确；ratio 两模式互通；翻页位置恢复正确 |
| T6 | 状态栏 + 工具栏/设置面板 UI M2/M3/M7 | 三入口同步；文案动态；四主题令牌化；Esc/取消不落库（设置面板） |
| T7 | 回归与文档回写 | 全场景 e2e（三格式×两模式 + 切换位置保护）+ 单测；整合文档新增阅读模式章节与验收项；本方案回写「落地状态与偏差」 |

## 6. 验收标准（新增）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A35 | 默认值 | 升级后无 `readerMode` 的存量设置回落「纵向滚动」，阅读行为不变 |
| A36 | 设置面板切换 | 选「横向翻页」保存后，EPUB/PDF/TXT 按各自翻页实现呈现 |
| A37 | 工具栏即时切换 | 阅读中点工具栏切换即时生效，无需重开图书 |
| A38 | 切换位置保护 | 滚动到中部 → 切翻页 → 再切回，章节/页/比例恢复一致（EPUB 章节级 mad 阈值同 D32/A29） |
| A39 | EPUB 翻页 | 翻页/键盘/上一页下一页正常；主题字号注入生效；章节窗口化在滚动模式不受影响 |
| A40 | PDF 滚动 | 连续滚动虚拟化简历/大 PDF 不卡死；内存不随页数线性爆炸；位置 page 互通 |
| A41 | TXT 翻页 | 分页随字号/窗口宽度自适应；翻页位置可恢复；与滚动 ratio 互通 |
| A42 | 持久化 | 关闭重开应用后阅读模式保持 |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| EPUB 章节窗口化与 paginated 冲突 | 翻页模式若复用窗口化会错位/空白 | 4.3 用 `mode==="scroll"` 门控，paginated 走 epubjs 默认 manager（已知：翻页模式不享受窗口外章节回收，内存占用高于滚动模式——记为取舍，非缺陷） |
| EPUB paginated 章内比例不可精确取得 | 翻页模式记录退化为章节级 | 与已确认 D32 章节级口径一致；未来可上 CFI 精确取位（P2） |
| PDF 连续滚动内存爆炸 | 大 PDF 卡顿/崩溃 | 4.4 虚拟化（IntersectionObserver 懒渲染 + 离屏清 canvas） |
| TXT 分页换行测量不准 | 翻页错位/漏行 | 4.5 用隐藏同样式测量节点取真实行边界；resize/字号变更重算 |
| 切换模式重挂载丢位置 | 用户体验回归 | 4.2 M8：先 getter flush 再重挂载恢复；书架落库兜底 |
| 设置升级丢字段 | 用户设置丢失 | `normalizeSettings` 缺省补默认，不抛错（沿用 v0.2.0） |
| 翻页模式主题/字号注入失效 | 个性化看起来没生效 | paginated 仍走 `hooks.content` 注入（与 scroll 同一通道） |

## 8. 当前实现状态与偏差（基线快照，如实记录）

- 阅读模式当前**全部写死**：EPUB=连续滚动（continuous+scrolled+自定义窗口化）、PDF=单页翻页、TXT=纵向滚动。
- `settings.ts` 仅有 `epubPreloadCount/theme/accent/fontSize` 四字段，无 `readerMode`（方案 T1 新增）。
- `StatusBar` 与 `BookViewer.onChapterChange` 渲染模式文案写死，方案 M7 动态化。
- 位置模型 `ReadingPosition` 已与渲染模式正交（方案 4.7 核心不变量成立），切换模式无需改 schema——这是本方案可行性的关键。
- 存量用户零回归的保障来自「默认 = 纵向滚动」+ 「`normalizeSettings` 缺省补默认」。
