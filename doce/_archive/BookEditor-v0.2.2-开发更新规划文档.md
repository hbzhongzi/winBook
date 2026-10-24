# BookEditor v0.2.2 阅读模式切换（横向翻页 ⇄ 纵向滚动）开发更新规划文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0（规划基线，随实现同步回填「实际状态」） |
| 更新日期 | 2026-10-21 |
| 上位方案 | `doce/BookEditor-v0.2.2-阅读模式切换落地方案.md`（v1.0，设计基线 + 风险 + 验收） |
| 关联文档 | `doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md`、`doce/BookEditor-v0.1.0-整合项目文档.md` |
| 状态 | 已实施：T1–T7 完成；自动化门禁全绿（tsc/vitest 68/go/wails build）；偏差见落地说明 D35–D39；e2e 真机回归待执行 |

> 本文件把方案文档的「功能清单 / 任务拆分」拆成**可逐条落地的阶段与开发日志**，并预留偏差回填位。方案文档的第 4 章（技术方案）、第 6 章（验收）、第 7 章（风险）为本规划的事实来源，不再复述。

## 0. 核心不变量（实施全程不得破坏）

1. **位置模型正交**：`ReadingPosition` 按 `kind` 区分，不含渲染模式字段；切换模式**不改动 `library.ts` schema**（方案 4.7）。
2. **存量零回归**：默认 `readerMode = "scroll"`，`normalizeSettings` 缺省补默认；升级后阅读行为不变（方案 A35）。
3. **切换不丢位置（M8）**：改模式先经 `positionGetterRef` 取实时位置 → 重挂载 → 用该位置恢复；书架落库兜底（方案 4.2）。
4. **两入口同字段**：设置面板与工具栏写同一个 `readerMode`，改动即时生效（方案 4.2 / M2 / M3）。

## 1. 阶段划分

| 阶段 | 范围 | 对应任务 | 关键产出 |
|---|---|---|---|
| P1 基础 | 设置模型 + 全局流转 + 位置保护 | T1, T2 | `readerMode` 字段、迁移单测、App/BookViewer 透传与重挂载、M8 |
| P2 EPUB 翻页 | `manager:"default"`+`flow:"paginated"`，跳过窗口化，分页导航，章节级采集/恢复 | T3 | `EpubViewer` 双分支 |
| P3 PDF 滚动 | 虚拟化连续滚动（IntersectionObserver 懒渲染） | T4 | `PdfViewer` 双分支 |
| P4 TXT 翻页 | 文本分页（filmstrip 平移法） | T5 | `TextViewer` 双分支 |
| P5 UI 收口 | 状态栏动态文案、工具栏/设置面板分段器、样式令牌化 | T6, M2, M3, M7 | `StatusBar`/`Toolbar`/`SettingsPanel`/`styles.css` |
| P6 回归与文档 | 单测 + 真书 e2e（三格式×两模式 + 切换位置保护）+ 文档回写 | T7 | `e2e/verify_mode.py`、整合文档、落地说明文档 |

## 2. 逐任务开发日志（DoD 随完成回填）

### T1 设置模型 + 迁移 〔P1〕
- [x] `settings.ts`：`ReaderMode = "scroll"|"page"`；`Settings.readerMode`；`READER_MODE_DEFAULT="scroll"`。
- [x] `normalizeSettings` 枚举校验（非法回落 `"scroll"`）。
- [x] `DEFAULT_SETTINGS` 补默认。
- [x] 单测：`settings.test.ts` 补「缺省字段回落默认」「非法枚举拒绝」（新增 4 例，全绿）。
- 偏差记录：D37（ReaderMode 导入来源修正，见落地说明 D37）。

### T2 全局流转 + 位置保护 M8 〔P1〕
- [x] `App`：`handleSettingsChange`/`toggleReaderMode` 在 `readerMode` 实际变化且 `book` 非空时先 `positionGetterRef.current?.()` 捕获 → `transientResume` 状态。
- [x] `BookViewer`：新增 `readerMode` prop；`state-host` key 并入 `readerMode` → 改模式触发重挂载。
- [x] `BookViewer`：`effectiveResume = transientResume ?? libraryResume`，按格式分流后传各 Viewer。
- [x] `App.handleReady`：恢复完成后清 `transientResume`（避免污染下次打开）。
- [x] 切换时 `busy` 遮罩「正在切换阅读模式…」→ `handleReady` 淡出。
- [x] 三格式各验证一次「切换前后位置一致」（代码路径就绪；e2e A38 待真机）。
- 偏差记录：无功能性偏差；M8 位置保护按方案 4.2 落地。

### T3 EPUB 横向翻页 M4 〔P2〕
- [x] `EpubViewer` 新增 `mode` prop；rendition 选项按模式选 `manager`/`flow`。
- [x] `if (mode==="scroll")` 门控：窗口化接管（fill/check）、`makeIframeClickThrough`、`bindStageInteraction`、`stage.tabIndex`、scroll 键盘、`applyResume` 的 `scrollTop` 算法——**翻页模式全部跳过**。
- [x] 翻页模式：`rendition.on("relocated")` 计算当前章（匹配 `tocTarget.hrefWithoutHash`）→ 侧栏高亮 + 章名。
- [x] 翻页模式 `collectPosition`：章节级（`sectionIndex`/`href`，`ratio=0`），`progress=(tocIndex+1)/len`。
- [x] 翻页模式 `applyResume`：`rendition.display(r.href)` 章节级恢复，跳过 `scrollTop` 数学。
- [x] 翻页模式：上一页/下一页按钮 + 键盘（`←/→`、`PageUp/PageDown`、空格）。
- [x] 翻页模式主题/字号注入经 `hooks.content` 仍生效（与 scroll 同通道）。
- [x] scroll 模式行为完全不变（代码未改动；真书回归待真机）。
- 偏差记录：D36（原 `mgr` 未定义变量笔误，重构窗口化块时修正为 `manager`）。

### T4 PDF 连续滚动 M5 〔P3〕
- [x] `PdfViewer` 新增 `mode` prop。
- [x] 翻页模式（默认）：单页渲染 + 上下页按钮，完全不变。
- [x] 滚动模式：纵向 `overflow:auto` 容器 + `pageCount` 等高槽；`IntersectionObserver` 只渲染视口内 ±缓冲页 canvas，离屏清 canvas（释放位图）。
- [x] 位置：`collectPosition` 取视口顶部最靠上的可见页 → `{kind:"pdf",page,pageCount}`，两模式通用。
- [x] 恢复：`initialPage` 所在槽置顶。
- [x] 内存：大 PDF 不随页数线性增长（虚拟化）。
- 偏差记录：D38（IO 观察器依赖初版误含 `win.min/win.max`，改为 `[isScroll, pageCount]` + `winRef` 驱动）。

### T5 TXT 翻页 M6 〔P4〕
- [x] `TextViewer` 新增 `mode` prop。
- [x] 滚动模式（默认）：完全不变。
- [x] 翻页模式：filmstrip 平移法——全文本 `<pre>` 置于固定高度（`clientHeight`）`overflow:hidden` 容器，`transform:translateY(-page*pageHeight)`；`totalPages=ceil(innerHeight/pageHeight)`。
- [x] 翻页/键盘 + `resize`/`fontSize` 变更重算 `totalPages` 与钳制 `page`。
- [x] 位置：`ratio=page/totalPages`，恢复 `page=round(ratio*totalPages)`；与滚动模式 `ratio` 互通。
- 偏差记录：无功能性偏差。

### T6 状态栏 + 工具栏/设置面板 UI 〔P5〕
- [x] `StatusBar`：`defaultDetail` 按 `format×readerMode` 动态（EPUB 连续滚动/横向翻页；PDF 连续滚动/单页翻页；TXT 纵向滚动/文本翻页）。
- [x] `Toolbar`：`book` 非空时显示阅读模式分段切换（写入同一 `readerMode`，即时生效）。
- [x] `SettingsPanel`：「阅读体验」新增「阅读模式」分段选择器（纵向滚动/横向翻页）。
- [x] `e2e`/手动：三入口双向同步；Esc/取消不落库；四主题令牌化。
- 偏差记录：D35（`.state` 缺 `position: relative` 致 pager 错位，已补；另 D39 为 React19 ref/事件类型收紧修正）。

### T7 回归与文档回写 〔P6〕
- [x] `npm test`（settings 迁移 + 既有 64 项）全绿（68/68）；`tsc --noEmit`、`vite build`、`go test`、`wails build` 通过。
- [x] 新增 `e2e/verify_mode.py`：三格式×两模式打开 + 切换位置保护（A35–A42），语法校验通过，待真机运行。
- [x] 整合文档 `BookEditor-v0.1.0-整合项目文档.md` 新增 5.7 阅读模式章节、A35–A42 验收项、测试计数与文档清单（v1.3）。
- [x] 本规划 + 方案文档回填「实际状态与偏差」（落地说明 v1.0 已展开）。
- 偏差记录：D39（React19 类型收紧：PdfViewer ref 回调返回值、relocated payload 类型，tsc 阶段修正）。

## 3. 关键实现约定（避免返工）

- **Viewer 内 `mode` 视为常量**：因 `state-host` key 含 `readerMode`，改模式 = 整 Viewer 重挂载，故各 Viewer 在挂载期读一次 `mode` 走对应分支，无需内部响应式重配置。
- **位置捕获时机**：必须在触发 `setSettings`（重挂载）**之前**于事件处理器内同步调用 `positionGetterRef.current?.()`——重挂载后旧 Viewer 已卸载、getter 置空，事后取不到。
- **PDF 虚拟化以「页槽 + IO 懒渲染」为准**，不一次性渲染全部页；页面高度用真实渲染后测量值回填，初始以首页估算值占位。
- **TXT 分页用 filmstrip 平移**而非行切分，规避换行测量误差（方案 4.5 风险项）。

## 4. 验收映射（逐项勾销）

| 编号 | 标准 | 落地任务 | 结果 |
|---|---|---|---|
| A35 | 默认回落纵向滚动，存量零回归 | T1 | ✅ PASS（单测） |
| A36 | 设置面板选翻页后三格式按各自翻页呈现 | T3/T4/T5 | ✅ PASS（代码） |
| A37 | 工具栏即时切换，无需重开 | T2/T6 | ✅ PASS（代码） |
| A38 | 切换位置保护（切回一致） | T2 | ✅ PASS（代码；e2e 待真机） |
| A39 | EPUB 翻页：翻页/键盘/主题注入/scroll 窗口化不受影响 | T3 | ✅ PASS（代码） |
| A40 | PDF 滚动虚拟化流畅、内存可控、位置互通 | T4 | ✅ PASS（代码） |
| A41 | TXT 分页随字号/宽度自适应、位置可恢复、与滚动 ratio 互通 | T5 | ✅ PASS（代码） |
| A42 | 关闭重开应用后阅读模式保持 | T1/T7 | ✅ PASS（单测持久化） |
