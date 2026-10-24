# BookEditor v0.2.2 阅读模式切换（横向翻页 ⇄ 纵向滚动）落地说明文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 更新日期 | 2026-10-21 |
| 上位文档 | `doce/_archive/BookEditor-v0.2.2-阅读模式切换落地方案.md`（v1.0，设计基线 + 风险 + 验收，已归档） |
| 规划基线 | `doce/_archive/BookEditor-v0.2.2-开发更新规划文档.md`（v1.0，逐任务路线图，已归档） |
| 关联文档 | `doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md`、`doce/BookEditor-v0.1.0-整合项目文档.md`、`doce/BookEditor-v0.2.0-个性化功能落地说明文档.md` |
| 本版范围 | 阅读模式 `readerMode`（横向翻页 / 纵向滚动）设置项 + 三格式双渲染分支 + 工具栏/设置面板切换入口 + 切换位置保护（M8） |
| 状态 | 已实施：tsc --noEmit PASS；vitest 68/68 PASS（64 既有 + 4 新增 readerMode 迁移）；vite build PASS；go test PASS；wails build PASS（build/bin/book-editor.exe）；`e2e/verify_mode.py` 已交付并语法校验通过，但**未在本无头环境实跑**，需真实 Windows 桌面会话回归（见第 6 章） |

## 1. 范围

### 1.1 本版实现

| 编号 | 功能 | 生效范围 | 默认值 |
|---|---|---|---|
| T1 | 设置项 `readerMode`（`"scroll" \| "page"`）+ 迁移归一 | 全局 | `scroll`（纵向滚动） |
| T2 | 全局流转 + 位置保护 M8（`transientResume`） | 三格式 | —— |
| T3 | EPUB 横向翻页：`manager:"default"`+`flow:"paginated"`，跳过窗口化，翻页导航 + 键盘 + 章节级采集/恢复 | EPUB | 翻页模式专属 |
| T4 | PDF 连续滚动虚拟化（页槽 + IntersectionObserver 懒渲染 + 离屏清 canvas） | PDF | 滚动模式专属 |
| T5 | TXT 文本翻页（filmstrip 平移法 + 页码指示） | TXT | 翻页模式专属 |
| T6 | 状态栏动态文案 + 工具栏/设置面板分段器（双入口写同一字段） + 样式令牌化 | 全局 | —— |
| T7 | 回归（单测 + 构建 + e2e）+ 文档回写 | 全局 | —— |

### 1.2 不在本版

- 阅读模式记忆按「全局单一 `readerMode`」实现，**不支持按书记忆不同模式**（方案 4.2 已定）；
- EPUB 翻页模式不做精准定位，沿用 v0.2.1 章节级口径（`ratio=0`，与 D32 一致）；
- 翻页模式不引入自定义章节窗口化（与 `paginated` 冲突，已跳过）；
- PDF 连续滚动不实现「双页/缩放模式」等高级分页视图。

## 2. 交付物清单

| 类型 | 文件 | 改动 |
|---|---|---|
| 设置层 | `frontend/src/utils/settings.ts` | 新增 `ReaderMode` 类型、`READER_MODES`、`READER_MODE_DEFAULT="scroll"`；`Settings.readerMode`；`DEFAULT_SETTINGS` 补默认；`normalizeSettings` 枚举校验 |
| 单测 | `frontend/src/utils/__tests__/settings.test.ts` | 新增 4 例：默认值/缺字段回落 scroll、非法枚举回落、保存读回、与 fontSize 互不干扰 |
| 应用层 | `frontend/src/App.tsx` | 新增 `transientResume` 状态与 `captureForRemount`；`handleSettingsChange` 在 `readerMode` 变化且 `book` 非空时先捕获位置再保存；`toggleReaderMode`；`handleReady` 清 `transientResume`；透传 `readerMode` 到 `BookViewer`/`StatusBar`/`Toolbar`/`SettingsPanel` |
| 容器 | `frontend/src/components/BookViewer.tsx` | 新增 `readerMode` prop；`state-host` key 并入 `readerMode` 触发重挂载；`renderModeLabel(format, mode)`；三 Viewer 传 `mode` 与 `resume={transientResume ?? resume}` |
| 阅读器 | `frontend/src/components/EpubViewer.tsx` | 新增 `mode` prop、`pagerRef`、`currentHrefRef`；双分支（scroll 窗口化 / page paginated + relocated 章节跟踪 + 翻页键盘 + 章节级采集恢复）；`.epub-pager` 上一页/下一页 |
| 阅读器 | `frontend/src/components/PdfViewer.tsx` | 新增 `mode` prop；单页翻页（原样）+ 连续滚动虚拟化（页槽/IntersectionObserver/高度回填/离屏清 canvas）；`collectPosition` 两模式通用 |
| 阅读器 | `frontend/src/components/TextViewer.tsx` | 新增 `mode` prop；滚动分支原样 + 翻页 filmstrip 平移（page/totalPages/页码指示/键盘/ResizeObserver 重算）；`collectPosition` 两模式互通 |
| UI | `frontend/src/components/StatusBar.tsx` | 新增 `readerMode` prop；`defaultDetail(format, mode)` 动态文案 |
| UI | `frontend/src/components/Toolbar.tsx` | 新增 `readerMode`/`onModeChange`；阅读中显示 `.mode-seg` 分段器 |
| UI | `frontend/src/components/SettingsPanel.tsx` | 「阅读体验」新增「阅读模式」`.set-card`；草稿与全局/工具栏切换同步 |
| 样式 | `frontend/src/styles.css` | 追加 `.mode-seg`/`.mode-seg-block`/`.mode-opt`/`.epub-pager`/`.txt-page`/`.txt-filmstrip`/`.txt-pager`/`.pdf-scroll`/`.pdf-scroll-track`/`.pdf-page-slot`/`.pdf-page-placeholder`（令牌化）；`.state` 补 `position: relative`（D35） |
| 测试 | `e2e/verify_mode.py` | 新建：三格式×两模式 + 切换位置保护（A35–A42）回归脚本，语法校验通过，待真机运行 |

## 3. 数据契约

### 3.1 存储键

| 键 | 内容 | 备注 |
|---|---|---|
| `bookeditor.settings.v1` | 全局设置（含本版新增 `readerMode`） | 沿用 v0.2.0 设置层；`normalizeSettings` 对 `readerMode` 做枚举校验 |

### 3.2 `readerMode` 字段

```ts
export type ReaderMode = "scroll" | "page";
export const READER_MODE_DEFAULT = "scroll";
// settings.readerMode?: ReaderMode —— 缺省或非法均回落 "scroll"（存量零回归）
```

位置模型（`ReadingPosition`）**不含**渲染模式字段，切换模式不改动 `library.ts` schema（核心不变量 #1）。

## 4. 验收映射（A35–A42）

| 编号 | 标准 | 落地 | 结果 | 验证方式 |
|---|---|---|---|---|
| A35 | 默认回落纵向滚动，存量零回归 | T1 | ✅ PASS | 单测 `settings.test.ts`（缺省/非法回落 scroll）+ tsc/build |
| A36 | 设置面板选翻页后三格式按各自翻页呈现 | T3/T4/T5 | ✅ PASS（代码） | 三 Viewer 双分支实现 + tsc；GUI 呈现待真机 |
| A37 | 工具栏即时切换，无需重开 | T2/T6 | ✅ PASS（代码） | `toggleReaderMode` 即时写 `saveSettings` + 重挂载 |
| A38 | 切换位置保护（切回一致） | T2 | ✅ PASS（代码） | `transientResume` 捕获→重挂载→恢复；e2e 位置保护待真机 |
| A39 | EPUB 翻页：分页/键盘/主题注入/scroll 窗口化不受影响 | T3 | ✅ PASS（代码） | scroll 分支未改动；paginated 独立分支 + `hooks.content` 同通道 |
| A40 | PDF 滚动虚拟化流畅、内存可控、位置互通 | T4 | ✅ PASS（代码） | 页槽 + IO 懒渲染 + 离屏清 canvas；单页分支未改动 |
| A41 | TXT 分页随字号/宽度自适应、位置可恢复、与滚动 ratio 互通 | T5 | ✅ PASS（代码） | filmstrip 平移 + ResizeObserver 重算 + ratio 互通 |
| A42 | 关闭重开应用后阅读模式保持 | T1/T7 | ✅ PASS | 单测「保存读回」覆盖持久化；`normalizeSettings` 回落 |

> 标注「（代码）」的条目指逻辑/类型/构建已验证，最终 GUI 交互与真书表现以 `e2e/verify_mode.py` 真机回归 + 人工看截图为准（仓库既有 e2e 口径一致）。

## 5. 偏差记录（D35–D39）

| 编号 | 偏差 | 影响 | 处置 |
|---|---|---|---|
| D35 | `styles.css` 原 `.state` 规则缺 `position: relative`，导致 `.epub-pager`/`.txt-pager` 绝对定位锚到 `.content`/`.app` 外层，翻页导航错位 | T6 收尾发现 | 给 `.state`/`.state.active` 补 `position: relative`，pager 正确锚定正文区 |
| D36 | EpubViewer 原降级路径存在未定义变量 `mgr`（`mgr?.views?.all?.()`），为历史笔误 | T3 重构窗口化块时暴露 | 修正为 `manager.views?.all?.()` |
| D37 | PdfViewer / TextViewer 误从 `../utils/library` 导入 `ReaderMode`（实际定义在 `../utils/settings`） | T7 类型检查拦截 | 拆分导入：`ReaderMode` 来自 settings，其余类型来自 library |
| D38 | PdfViewer `IntersectionObserver` 的 effect 依赖初版误含 `win.min/win.max`，导致窗口尺寸变化即重建观察器（性能/抖动） | T7 类型检查前自查 | 依赖改为 `[isScroll, pageCount]`，窗口计算由 `winRef`+`setWin` 驱动，观察器稳定 |
| D39 | React 19 类型收紧：`ref` 回调不可返回值（PdfViewer 三处 `ref={(el)=>(x=el)}`）；`rendition.on` 回调 `payload` 为 `unknown` | T7 `tsc --noEmit` 拦截 | ref 回调改块体返回 void；relocated 回调参数改 `unknown` 后内部断言 |

## 6. 回归与文档

### 6.1 自动化门禁（本环境已执行）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | ✅ EXIT=0 |
| 单元测试 | `vitest run` | ✅ 68/68（64 既有 + 4 新增） |
| 前端构建 | `vite build` | ✅ 产物 dist（index + pdf.worker） |
| Go 测试 | `go test ./...` | ✅ ok（cached） |
| 桌面构建 | `wails build` | ✅ `build/bin/book-editor.exe`（Wails CLI v2.16.0，Go 1.25.6） |

### 6.2 GUI 真机回归（待执行）

- `e2e/verify_mode.py [epub|pdf|txt|all]`：三格式 × 两模式打开 + 切换位置保护（A35–A42）。
  - 需在**真实 Windows 桌面会话**运行（Wails/WebView2 需可见窗口，本无头环境无法点击 GUI）；
  - 工具栏「阅读模式」分段器坐标 `MODE_TOGGLE_POINT` 按 1280×720 默认皮肤标定，尺寸/皮肤变化可用环境变量覆盖；
  - 翻页导航存在性用底栏中段深色像素探测近似判定，最终以人工看 `e2e/shots/` 截图为准。
- 真书《关键对话》EPUB 回归：确认 scroll 模式窗口化/目录/章节级恢复未被破坏（A39）。

### 6.3 文档回写

- 本文件（落地说明 v1.0）为 v0.2.2 事实展开；
- `doce/_archive/BookEditor-v0.2.2-开发更新规划文档.md` 已回填 T1–T7 实际状态与偏差 D35–D39；
- 整合文档 `BookEditor-v0.1.0-整合项目文档.md` 待补「阅读模式」章节与验收项（v0.2.2 收尾项）。
