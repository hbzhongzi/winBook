# BookEditor v0.1.0 项目整合文档

| 项目 | 内容 |
|---|---|
| 项目名称 | BookEditor / Winbook 图书阅读器 |
| 当前版本 | v0.1.0（另叠加 v0.2.0 个性化功能 P0、v0.2.1 书架/位置记忆、v0.2.2 阅读模式切换、v0.2.3 翻页模式位置定位优化、v0.2.4 版式三件套（P0）、v0.2.5 翻页导航与快捷键优化已落地，见 5.5、5.6、5.7、5.8、5.10、5.11 与 8.4） |
| 文档版本 | v1.6（补 v0.2.5 翻页导航与快捷键优化落地口径） |
| 更新时间 | 2026-10-21 |
| 目标平台 | Windows 10/11 x64 |
| 文档依据 | `doce/BookEditor-v0.1.0-落地说明文档.md`、`doce/BookEditor-v0.1.0-开发规划文档.md`、`doce/BookEditor-v0.2.0-个性化功能落地说明文档.md`、`doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md`、`doce/BookEditor-v0.2.2-阅读模式切换落地方案.md`、`doce/BookEditor-v0.2.2-开发更新规划文档.md`、`doce/BookEditor-v0.2.2-阅读模式切换落地说明文档.md`、`doce/BookEditor-v0.2.3-翻页模式位置定位优化方案.md`、`doce/BookEditor-v0.2.3-翻页模式位置定位落地说明文档.md`、`doce/BookEditor-v0.2.4-用户体验个性化更新方案.md`、`doce/BookEditor-v0.2.4-用户体验个性化落地说明文档.md`、`doce/BookEditor-v0.2.5-翻页导航与快捷键优化方案.md`、`doce/BookEditor-v0.2.5-翻页导航与快捷键优化落地说明文档.md`、仓库源码、测试脚本与日志 |
| 文档位置 | `doce/BookEditor-v0.1.0-整合项目文档.md` |

## 1. 项目概述

BookEditor 是一个基于 Wails 的 Windows 桌面图书阅读器，负责从本地文件选择并读取图书，再由前端按文件类型渲染阅读内容。

### 1.1 已实现范围

- 支持 `EPUB`、`PDF`、`TXT` 三种格式。
- 支持 Windows 文件选择框、打开状态、当前图书信息和窗口标题更新。
- TXT 自动识别合法 UTF-8 与 GBK，并移除 UTF-8 BOM。
- PDF 使用 `pdfjs-dist` 绘制到 Canvas，支持翻页、页码边界限制和窗口变化重绘。
- EPUB 使用 `epubjs` 连续纵向滚动，支持目录跳转、目录高亮和章节窗口化加载。
- 对损坏文件、超大文件和不支持格式提供可读错误提示。
- 个性化设置（v0.2.0 P0）：章节预加载数量、四套阅读主题、六种强调色、正文字号，均在设置面板调整并持久化，详见 5.5。
- 书架与阅读位置记忆（v0.2.1）：欢迎页书架（最近阅读、进度、移除/清空）、退出位置记忆与续读，EPUB 章节级/PDF 同页/TXT 比例恢复，详见 5.6。
- 阅读模式切换（v0.2.2）：全局 `readerMode`（纵向滚动 / 横向翻页），三格式各自双渲染分支（EPUB `paginated`、PDF 连续滚动虚拟化、TXT filmstrip 分页），工具栏与设置面板双入口即时切换，切换不丢位置（与 v0.2.1 位置记忆正交），详见 5.7。
- 翻页模式位置定位优化（v0.2.3）：为 EPUB 增加 CFI 精确锚点、TXT 增加字号无关的字符锚点 `anchor`、三格式统一补 `mode` 落库，解决翻页模式章内页丢失与跨模式/字号漂移，详见 5.8。
- 版式三件套（v0.2.4 P0）：行距（1.4–2.2）、正文字体（系统/宋体/楷体）、正文页边距（0–80px）写入 settings v3（v2 全量迁移），经 EPUB iframe 注入与 TXT CSS 变量双通道即时生效，与位置系统正交，详见 5.10。
- 翻页导航与快捷键优化（v0.2.5）：翻页按钮悬浮贴底 + 2.5s 闲置自动隐藏；快捷键 window 级收口（三格式全键位、iframe 内经 postMessage 转发、PDF 补齐）；快捷键自定义（settings v4 + 设置面板「快捷键」分类录制式绑定），详见 5.11。
- 已包含单元测试、测试样本生成器和 Windows GUI E2E 驱动。

**版本演进**（当前累计）：

| 版本 | 主题 | 关键交付 |
|---|---|---|
| v0.1.0 | 基础阅读器 | EPUB 连续滚动 + 章节窗口化、PDF 翻页、TXT、错误契约 |
| v0.2.0 | 个性化 P0 | Settings v2（预加载 / 四主题 / 强调色 / 字号）、CSS 双层令牌、iframe 阅读层注入 |
| v0.2.1 | 书架 + 位置记忆 | library.v1 书架、退出位置记忆、离场节点 flush（Go `OnBeforeClose` 握手）、续读恢复 |
| v0.2.2 | 阅读模式切换 | `readerMode` 双模式、三格式双渲染分支、`state-host` 重挂载、M8 切换位置保护 |
| v0.2.3 | 翻页位置定位优化 | EPUB CFI 精确还原、TXT 字号无关 `anchor`、三格式 `mode` 落库、跨模式无损 |
| v0.2.4 | 用户体验个性化（P0 已实施） | 测试检查全绿 + 构建 chunk 拆分（D42）；settings v3 版式三件套：行距/字体/页边距，EPUB 注入 + TXT CSS 变量双通道，与位置系统正交；P1/P2 待排期 |
| v0.2.5 | 翻页导航与快捷键优化 | F21 翻页导航悬浮贴底 + 自动隐藏；F22 window 级快捷键收口（三格式 + iframe 转发 + PDF 补齐）；F24 快捷键自定义（settings v4 + 面板录制式绑定）；冒烟 7/7 + 翻页导航验证 7/7 真机通过（D45–D50） |

### 1.2 不在 v0.1.0 范围内

- 编辑、批注、搜索、云同步、账号体系、DRM 处理（书架与阅读位置记忆已于 v0.2.1 落地，见 5.6）。
- `MOBI`、`AZW3` 等格式。
- 安装包、自动安装 WebView2、自动更新。

## 2. 当前状态

当前仓库代码与落地说明文档的主要设计已对齐。基于当前工作区执行的验证结果如下：

| 验证项 | 结果 |
|---|---|
| `frontend` 单元测试 | 7 个测试文件、109 项测试全部通过（v0.2.1 新增 `library` 18 项、`chapterWindow` 补 `getAnchor` 3 项；v0.2.2 新增 `settings` 4 项 readerMode 迁移；v0.2.3 新增 `library` 4 项 cfi/anchor/mode 规范与降级；v0.2.4 新增 `settings` 10 项 + `readingTheme` 4 项 v3 迁移与版式注入；v0.2.5 新增 `readerHotkeys` 16 项 + `settings` 7 项 v4 键位模型/迁移/冲突消解） |
| Go 测试 | `go test ./...` 通过 |
| 前端生产构建 | `npm run build` 通过 |
| 前端构建产物 | 已生成 `frontend/dist`，PDF worker 被 Vite 打包 |
| Wails CLI | v2.16.0 |
| Windows 可执行文件 | `build/bin/book-editor.exe`，当前 13.00 MB |
| 个性化 GUI 冒烟 | `e2e/smoke_settings.py` 7/7 通过：复位链路、基线、A19 主题/强调色保存即生效、A20 重启持久化、A21 保存后主按钮绿（坐标点击 + 像素断言，2026-10-21 重构，见 D47–D49） |
| 翻页导航与快捷键验证 | `e2e/verify_pager.py` 7/7 通过：A60 贴底悬浮、A61 自动隐藏/复现/点击生效、A62 window 级默认键、A63 iframe 内焦点默认键（2026-10-21） |
| 书架 GUI 冒烟 | `e2e/smoke_shelf.py` 13/13 通过：基线清空、回书架、卡片与进度、续读不弹框、悬停移除、去重、二态确认清空、重启保留（2026-10-20） |
| 位置恢复核对 | `e2e/verify_positions.py`：A29 EPUB 章节级判定 PASS（mad=0.000），A30 PDF / A31 TXT 像素级一致（截图留档 `e2e/shots/A29-A31-*.png`） |
| 离场节点 flush 验证 | `e2e/verify_flush.py`：flush-A 点书架即时更新 PASS、flush-B 退出+重启像素级续读 PASS、flush-C EPUB 退出链章节判定 PASS（mad=0.000）（2026-10-21，含探针同源修复 D33） |
| 记录时机 | 离场节点口径（2026-10-21 用户确认）：退出软件（Go `OnBeforeClose` 拦截）/ 点击书架 / 切书三处实时取位置写库；阅读中不周期性写库（D34） |
| 阅读模式切换（v0.2.2） | 代码 + 自动化门禁全绿：`tsc --noEmit` PASS、`vitest` 68/68、`vite build` PASS、`go test` PASS、`wails build` 产出 `book-editor.exe`；`e2e/verify_mode.py` 已交付（语法校验通过，待真实 Windows 桌面会话回归 A35–A42） |
| 翻页模式位置定位优化（v0.2.3） | 代码 + 自动化门禁全绿：`tsc --noEmit` PASS、`vitest` 72/72、`vite build` PASS、`go test` PASS、`wails build` 产出 `book-editor.exe`；`e2e/verify_mode.py` 扩展 `page-resume` 子命令（语法校验通过，待真实 Windows 桌面会话回归 A43–A50） |
| 版式三件套（v0.2.4 P0） | 代码 + 自动化门禁全绿：`tsc --noEmit` PASS、`vitest` 86/86（+14 v3 迁移与版式注入）、`vite build` PASS（vendor 三拆，首屏 gzip 83.7 kB）、`go test` PASS、`wails build` 产出 `book-editor.exe`（13.6 MB）；A51–A53 真机交互待验 |
| 翻页导航与快捷键优化（v0.2.5） | 代码 + 自动化门禁全绿：`tsc --noEmit` PASS、`vitest` 109/109（+23 键位模型与 v4 迁移）、`go test` PASS、`wails build` 产出 `book-editor.exe`（13.00 MB）；`smoke_settings.py` 7/7 + `verify_pager.py` 7/7 真机通过；A64–A67（TXT/PDF 快捷键）与 A68–A70（录制交互）验收在 v0.2.6 收口（D51/D52 修复后重跑 `verify_hotkeys.py`） |
| 翻页按钮显隐优化（v0.2.6） | 代码 + 单测全绿：`tsc --noEmit` PASS、`vitest` 109/109、`wails build` 产出 `book-editor.exe`（13.00 MB）；新增 `usePagerVisibility` 共享 hook，TextViewer/EpubViewer 去重，单页不渲染 pager；收口 D51/D52（PDF 滚动 `fireReady` + 虚拟化 `renderedRef`）；`verify_pager.py` 新增 A64 悬停不隐藏 / A65 移出闲置隐藏。悬停机制经 D53 修订：初版依赖 `mouseenter/leave`（WebView2 合成输入不派发，A64 真机 FAIL）→ 改为容器 `mousemove` 命中测试（`pagerElRef.contains(e.target)`），监听元素上移到 `section`（pager 与正文区为兄弟）。A64/A65 命中测试重构后待真机重跑 |
| 拖拽打开支持类型文件（v0.2.7） | 代码 + 单测全绿：`tsc --noEmit` PASS、`vitest` 114/114（新增 dropOpen 5 例）、`wails build` 产出 `book-editor.exe`；方案 A 落地：`app.go` 新增 `SupportedExts()` 绑定（类型单源），前端 `App.tsx` 接 `OnFileDrop(cb, false)` 整窗拖放 → `handleDrop` 仅放行 epub/pdf/txt、复用 `handleOpen`、白名单外即时 ErrorBar、多文件轻提示、loading 中忽略。**真机反馈修复（D56–D58）**：`main.go` 补 `DragAndDrop{EnableFileDrop:true}`（原缺失致拖入被 WebView2 当下载）+ 前端自兜底 dragover/drop preventDefault；新增 Ctrl+O 打开文件快捷键（原被 WebView2 默认加速键接管）；书架网格改 `minmax(0,1fr)` 修复长书名撑宽首列。A71–A74 待真机复验 |
| 书架分类与清空确认（v0.2.8） | 代码 + 单测全绿：`tsc --noEmit` PASS、`vitest` **134/134**（新增 categories 13 例 + library 7 例）、`wails build` 产出 `book-editor.exe`（13.6 MB）。新增 `utils/categories.ts`（预设模板只读 + 自定义分类 `bookeditor.cats.v1`）与 `components/ShelfManager.tsx`（面板一自选清除 / 面板二清空二次确认）；`library.ts` 增 `cat?` 与批量 `removeEntries`/`setEntriesCategory`（单次写盘 D59）；`BookViewer` 增分类页签（空分类隐藏）、卡片归类标签菜单与就地新建；设置高级页清空改开对话框（D60，已同步改写 `smoke_shelf.py`/`smoke_settings.py`）。A75–A82 待真机 |
| PDF 显示优化（v0.2.9） | 代码 + 单测全绿：`tsc --noEmit` PASS、`vitest` **165/165**（新增 `pdfScale` 24 例 + `settings` 7 例）、`wails build` 产出 `book-editor.exe`。缩放改五态（`auto`/`width`/`height`/`spread`/`custom`）且默认 `auto` 自适应（D65：废除写死 `SCALE=1.2`）；新增 `utils/pdfScale.ts` 纯函数层（`resolvePdfScale` 单源解析）；`PdfViewer` 重写：DPR 清晰渲染（`canvas.width = cssW × min(dpr,2)`，D68）、LRU 页面缓存（24 页）、双页 spread、ResizeObserver 循环防护（`scrollbar-gutter: stable`）；缩放四入口同源（控制条 ±、档位菜单附实际倍率、Ctrl+滚轮、设置面板）；页码跳转提前落地（D70②，越界静默钳制）。A83–A95 待真机（`e2e/verify_pdf_fit.py` 已交付，语法校验通过；A85 翻转点真机不可达改单测，D70①）；**D71 hotfix（2026-10-26）：修复「二次打开/横屏报『PDF 解析失败』、竖屏滚动正常」——根因 pdfjs 全局 `#canvasInUse` 同 canvas 并发 render 同步抛错，单页模式 `setFailed` 表面化、连续滚动 `catch {}` 静默规避，已改为按 canvas 维度登记在飞任务并重渲前 await 释放**；**D72 hotfix（2026-10-26）：修复「PDF 分类后重新打开分类消失，其他格式暂未复现」——根因 `library.savePosition` 以全新对象 `upsertEntry` 重写条目时未带上旧条目的 `cat`（分类字段），重开即丢分类；改为「合并旧条目」只覆盖打开相关标量修复，三格式统一保留分类（`library.test.ts` 增 2 例回归，167/167 全绿）** |
| GUI 验收 | `e2e/run.log` 有 TXT/EPUB 真书流程和关闭进程记录；净机项依赖外部环境 |

说明：工作区在整理文档前已经存在用户改动，本文件不回退、不覆盖这些源码改动。`frontend/wailsjs/` 是 Wails 生成文件，修改 Go 绑定后应由 Wails 重新生成，禁止手工维护。

## 3. 技术架构

```text
Windows Desktop
       |
       v
Wails v2 / WebView2
       |
       +-- Go backend
       |     +-- runtime.OpenFileDialog
       |     +-- 文件扩展名与大小校验
       |     +-- TXT 解码 / EPUB、PDF Base64 编码
       |     +-- OpenBook() -> BookData
       |
       +-- React + TypeScript frontend
             +-- App 状态编排
             +-- BookViewer 按 format 分派
             +-- TextViewer
             +-- PdfViewer + pdfjs-dist
             +-- EpubViewer + epubjs
             +-- 错误条、状态栏、设置面板
```

### 3.1 数据流

1. 用户点击工具栏的“打开图书”。
2. Go 端打开 Windows 文件对话框。
3. Go 端先检查扩展名，再执行 `Stat`、100 MB 大小检查和文件读取。
4. TXT 解码为字符串；EPUB/PDF 编码为 Base64，统一封装为 `BookData`。
5. Wails 将返回值传给 React。
6. `BookViewer` 根据 `format` 创建对应 Viewer。
7. Viewer 在卸载或切换文件时清理渲染任务、iframe 和解析实例。

### 3.2 目录结构

```text
book-editor/
├─ app.go                         Go 文件选择、读取、编码与错误契约
├─ main.go                        Wails 入口、窗口配置、资源嵌入
├─ app_test.go                    Go 侧 TXT 解码测试
├─ go.mod / go.sum                Go 依赖
├─ wails.json                     Wails 项目与构建配置
├─ frontend/
│  ├─ package.json                前端脚本与依赖
│  ├─ vite.config.ts              Vite 配置
│  ├─ src/
│  │  ├─ App.tsx                  页面状态与打开流程
│  │  ├─ styles.css               全局布局和阅读器样式
│  │  ├─ components/              各格式 Viewer、工具栏、错误条、设置
│  │  └─ utils/                   Base64、错误、设置和章节窗口工具
│  └─ wailsjs/                    Wails 自动生成绑定，不手改
├─ e2e/                            测试样本、GUI 驱动、验证脚本
├─ build/                          Windows 图标和构建产物
└─ doce/                           项目文档（整合/规划/历史/界面示例）
```

## 4. 后端实现

### 4.1 `main.go`

- 通过 `//go:embed all:frontend/dist` 嵌入前端生产资源。
- Wails 窗口标题为 `BookEditor`。
- 默认窗口为 `1280 x 860`，最小窗口为 `900 x 600`。
- 绑定 `App`，暴露 `OpenBook()` 给前端。
- 配置白色背景，减少启动时的白闪。

### 4.2 `app.go`

`OpenBook()` 的处理顺序必须保持为：

```text
打开文件对话框
  -> 用户取消：返回 (nil, nil)
  -> 扩展名检查：仅 epub/pdf/txt
  -> os.Stat：文件存在与大小
  -> 大小 > 100 MiB：FILE_TOO_LARGE
  -> os.ReadFile
  -> TXT 解码，或 EPUB/PDF Base64 编码
  -> 返回 BookData
```

先检查扩展名再读取文件，避免用户选择不支持的大文件时发生不必要的读取。大小限制是严格大于 `100 * 1024 * 1024` 才拒绝，恰好 100 MiB 会继续进入解析流程。

### 4.3 `BookData` 契约

| 字段 | JSON 字段 | 类型 | 使用方式 |
|---|---|---|---|
| `Name` | `name` | string | 工具栏显示和窗口标题 |
| `Path` | `path` | string | 当前文件路径，也用于 Viewer 重挂载 key |
| `Format` | `format` | string | `epub`、`pdf` 或 `txt` |
| `Size` | `size` | number | 文件大小和工具栏信息 |
| `DataBase64` | `dataBase64` | string，可选 | EPUB/PDF 二进制数据 |
| `Text` | `text` | string，可选 | TXT 解码后的文本 |

前端类型来自 `frontend/wailsjs/go/models.ts`，不得额外手写重复模型。

### 4.4 TXT 解码策略

1. `utf8.Valid(data)` 为真时按 UTF-8 解码，并去掉开头的 U+FEFF。
2. UTF-8 不合法时尝试 GBK。
3. GBK 也失败时使用 UTF-8 替换非法字节，保证前端拿到合法字符串。

当前已知限制：UTF-16 TXT 没有专门的 BOM 分流，可能被错误地按 GBK 处理，后续版本可增加 UTF-16 LE/BE 检测。

## 5. 前端实现

### 5.1 页面状态

`App` 管理以下状态：

- `book`：当前 `BookData`，为空时显示空状态。
- `loading`：调用文件对话框和读取期间禁用打开按钮。
- `error`：结构化的错误码与消息，错误条可关闭。
- `openCount`：每次成功打开递增，确保重复打开同一路径、同一大小的文件也会重建 Viewer。
- `settings`：阅读设置（v2：`epubPreloadCount`/`theme`/`accent`/`fontSize`/`readerMode`）。
- `detail`：状态栏中显示当前 EPUB 章节 / 渲染模式等信息。
- `entries` / `resume`（v0.2.1）：书架记录与续读位置（`resume` 一次性消费）。
- `transientResume`（v0.2.2）：切换阅读模式时的瞬态恢复位（M8 位置保护；重挂载后优先恢复，`handleReady` 完成后清空）。
- `busy` / `exitSaving` / `savedFlash`（v0.2.1 过渡动画）：打开/恢复加载遮罩、退出保存轻提示、状态栏「进度已保存」闪烁。
- refs：`bookPathRef`（getter 取到位置时补 path）、`positionGetterRef`（Viewer 挂载注册的同步取位函数，离场节点实时取）。

用户取消对话框时 Go 返回 `nil, nil`，前端不提示、不清空当前已打开图书，也不进入 Viewer 分派。

### 5.2 Viewer 分派与清理

`BookViewer` 按 `book.format` 分派：

| 格式 | 组件 | 主要渲染方式 |
|---|---|---|
| TXT | `TextViewer` | `<pre>`，保留换行并自动换行 |
| PDF | `PdfViewer` | `pdfjs-dist` + Canvas |
| EPUB | `EpubViewer` | `epubjs` + iframe + 连续滚动 |

Viewer 容器的 key 为 `path + size + openCount + readerMode`（v0.2.2 起并入 `readerMode`，改阅读模式即触发 Viewer 子树重挂载）。文件切换、重复打开或切换阅读模式时，React 会先卸载旧组件，触发 PDF renderTask、EPUB book、章节窗口和事件监听器的清理。

### 5.3 PDF

- `pdfjs-dist` 当前实际安装版本为 `6.4.299`。
- worker 使用 Vite 模块 URL：`pdfjs-dist/build/pdf.worker.min.mjs`。
- Go 返回的 Base64 先转为 `Uint8Array`，再传入 `getDocument`。
- 默认缩放比例为 `auto` 自适应（v0.2.9 起，见下方 5.3.1；v0.2.9 之前为写死 `1.2`，记 D65）。
- 只渲染当前页（双页模式渲染两页），页码限制在 `[1, numPages]`。
- 翻页或重绘前取消未完成的 `RenderTask`，忽略正常的取消异常。
- 组件卸载时调用 `pdf.cleanup()`，避免解析对象残留。
- 解析失败显示“PDF 解析失败，请确认文件未加密或损坏”。

生产构建已验证 PDF worker 会进入 `frontend/dist/assets`。若未来升级 `pdfjs-dist`，必须同时核对 worker 文件名和 `page.render` API。

#### 5.3.1 五态缩放适配（v0.2.9）

纯函数层 `frontend/src/utils/pdfScale.ts` 为单一真相：`resolvePdfScale(fit, zoom, cw, ch, pw, ph, dprEnabled)` 输入适配方式/倍率/容器与页面尺寸，输出解析结果（`fit`/`scale`/`cssW`/`cssH`/`dpr`/`bmpW`/`bmpH` 及三种比例参考值 `sw`/`sh`/`sp`）。

- 五态：`auto`（默认，`sw > sh` 判适宽否则适高）/ `width` / `height` / `spread`（双页，两页总宽 + 间距与视口双约束取小）/ `custom`（倍率 50–400%，钳制）。
- 清晰渲染：`canvas.width/height = cssW/H × min(devicePixelRatio, 2)`，CSS 尺寸不变；viewport 的 scale 已含 DPR 因子。
- 单页模式接 LRU 页面缓存（`Map` 命中移队尾，上限 24 页）与邻页预取（只取 `PDFPageProxy` 不渲染位图）。
- 滚动模式逐页 resolve 并回填真实宽高，去掉原 720px 硬编码。
- 设置字段 `pdfFit`/`pdfZoom`/`pdfDpr` 沿用 `bookeditor.settings.v4` 存储键（version 不变，D67）；缩放四入口同源：控制条 ±、档位菜单（附实际倍率）、Ctrl+滚轮、设置面板。
- 翻页模式 + 适宽时方向键优先页内滚动（仅 ArrowUp/Down 且本页高于视口且未到边），翻页后 `scrollTop = 0`。
- 偏差记录（D65–D72）与验收（A83–A95）见 `doce/BookEditor-v0.2.9-PDF显示优化开发方案.md`。

### 5.4 EPUB

- `epubjs` 锁定为 `0.3.93`。
- 使用 `ePub(bytes.buffer)` 打开二进制数据。
- 纵向滚动（默认）使用 `manager: "continuous"` 和 `flow: "scrolled"`，形成纵向连续阅读流；横向翻页模式改用 `manager:"default"` + `flow:"paginated"` 并跳过章节窗口化，见 5.7。
- 等待 `book.opened`、`rendition.started` 和目录加载完成后再显示首章，避免资源 Blob URL 尚未准备好导致白屏。
- 优先打开目录第一项；没有目录时使用 EPUB 默认起点。
- 有目录时显示侧栏，点击目录项可以滚动到章节；正文滚动时侧栏高亮同步变化。
- 目录项会映射到 spine 的 `section.index + #anchor`；同一个 XHTML 内的多个章节通过锚点区分，避免正文在“献词”时误高亮到后面的章节。该映射也用于处理封面、书内目录等非正文 spine 项。
- 监听 `displayError`，并对 `book.opened`、`navigation`、`display` 设置 10 秒超时。epubjs 对部分损坏数据可能既不 resolve 也不 reject，超时是避免白屏无提示的兜底。
- 通过 `chapterWindow.ts` 只保留当前章节前后若干章节，滚动时动态补齐并销毁窗口外 iframe。
- 动态补齐 section 时会显式等待新 view 的 `display()` 完成；只创建 DOM view 而不显示 iframe 会导致“目录仍有后续章节、正文却空白”。
- 动态 section 渲染失败时会移除失败 iframe，不保留占位空白高度，下一次窗口同步可以重新尝试加载。
- 有目录的 EPUB 使用稳定的 spine index 推进窗口，并保留首个目录 section 之后的线性 spine section，避免目录不完整或 `next()/prev()` 链异常时提前停止加载。
- 目录根据 EPUB 层级及“如何/小结/总结/案例”等小节标题自动分层，主章节加重显示，小节缩进显示；目录项仍保留原始锚点跳转关系。
- 回收上方章节时以当前章节为锚点补偿 `scrollTop`，避免滚动位置跳回顶部。
- `ResizeObserver` 和 `window.resize` 都会触发重新布局，适配目录侧栏出现后的正文宽度变化。
- 组件卸载时销毁窗口管理器、取消监听、销毁 EPUB 实例。

epubjs 默认使用沙箱 iframe，且没有开启交互式脚本内容。DRM 或加密 EPUB 不属于支持范围。

### 5.5 设置（v2）

设置数据模型由 `frontend/src/utils/settings.ts` 定义，四个字段：

| 字段 | 范围 | 默认值 | 说明 |
|---|---:|---:|---|
| `epubPreloadCount` | 0–10 | 2 | 当前章节前后各自预加载的章节数 |
| `theme` | `light` / `dark` / `eye` / `sepia` | `light` | 阅读主题；`eye`/`sepia` 只改阅读层，框架保持浅色 |
| `accent` | 六色白名单 | `#2563eb`（蓝） | 强调色，与主题正交 |
| `fontSize` | 12–20 px | 14 px | EPUB/TXT 正文字号；PDF 用文档自身字号 |

存储键为 `bookeditor.settings.v2`；旧键 `bookeditor.settings.v1` 只读迁移（仅迁移 `epubPreloadCount`，v1 键不删除）。读取时逐字段校验：数值超范围钳制、主题和强调色白名单外静默回落默认，与 v1 的 clamp 行为一致。变更通过订阅机制广播：EPUB 立即同步预加载窗口并重新注入阅读样式，不需要重新打开图书。

主题与强调色经 CSS 双层令牌落地：框架层（`--app-bg`/`--bar-bg`/`--surface-bg`/`--accent` 等）经 `documentElement.dataset.theme` 与行内变量切换；阅读层（`--reading-bg`/`--reading-text`/`--reading-font-size` 等）由 `frontend/src/utils/readingTheme.ts` 生成样式文本。EPUB 的 epubjs iframe 是独立文档，宿主变量不渗入，因此阅读层令牌在 `rendition.hooks.content` 中被物化成具体值注入 iframe（固定 style id，幂等更新；颜色带 `!important`，优先于书籍自身样式）。

预加载值为 `N` 时，窗口目标大小为 `2N + 1` 章；设置为 0 表示只保留当前章节。

「阅读位置记忆」开关已在 v0.2.1 落地为完整能力（书架 + 退出位置记忆），见 5.6。实施口径、逐文件实现细节与偏差记录见 `doce/BookEditor-v0.2.0-个性化功能落地说明文档.md` 与 `doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md`；设计基线与功能分级见 `doce/BookEditor-v0.2.0-个性化功能落地方案.md`、`doce/BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md` 与 `doce/BookEditor-前端界面示例.html` 的设置面板/书架部分。

### 5.6 书架与阅读位置记忆（v0.2.1）

数据层 `frontend/src/utils/library.ts`，localStorage 键 `bookeditor.library.v1`：50 条上限，`path` 主键去重，`lastOpen` 倒序；读取时整体校验，损坏或版本不符回落 `[]`。位置数据三型：

| 格式 | position | 说明 |
|---|---|---|
| EPUB | `{ kind: "epub", tocIndex, href, sectionIndex, ratio, cfi?, mode? }` | `sectionIndex + ratio` 为滚动模式「章节内比例」（章节窗口化下 stage 只含窗口内章节，全流比例会随窗口构成漂移，故不用）；`tocIndex/href` 直达章节；`cfi` 为 v0.2.3 新增的**模式无关精确锚点**（`relocated.start.cfi`）；`mode` 记录捕获时的渲染模式 |
| PDF | `{ kind: "pdf", page, pageCount, mode? }` | 翻页即时上报；页码两模式语义一致；`mode` 仅记录（v0.2.3） |
| TXT | `{ kind: "txt", ratio, anchor?, mode? }` | `ratio` 为滚动比例 / 翻页 `page/totalPages`；`anchor` 为 v0.2.3 新增的**字号无关字符偏移**；`mode` 记录捕获模式 |

> v0.2.3 起 `cfi`/`anchor`/`mode` 均为**可选字段**，`normalizePosition` 校验缺失即丢弃，旧版存储（无新字段）走降级恢复，行为等同 v0.2.1（A49）。

Go 侧契约：`OpenBookPath(path)` 供书架续读直接打开；`BookData.ModTime`（unix 秒）随打开结果返回。

采集与记录时机（2026-10-21 更新，用户口径 D34）：**只在离场节点记录**——退出软件 / 点击书架 / 切书时，App 调 Viewer 注册的同步 getter（`getterRef`，挂载注册/卸载置 null）实时取位置写库；阅读中不周期性写库（废弃 v1.1 的 scroll debounce 上报——持续滚动时定时器不断重置，停止不足一个周期即离场会丢位置，是「直接退出/点书架记录不更新」缺陷的根因）。「退出软件」节点由 Go `main.go` 的 `OnBeforeClose` 拦截 WM_CLOSE（`app:flush-request` → 前端 flush → `app:flush-done` → `Quit`，600ms 超时；等待在后台 goroutine，避免消息循环死锁）；`beforeunload` 保留为 best-effort 兜底。EPUB 章名/侧栏探针与 flush 锚点同源（视口中线，D33）。

恢复路径：**任何打开方式都恢复位置**（文件对话框与书架一致，D30），`resume` 一次性消费。

- **EPUB（v0.2.3 起 CFI 优先）**：`applyResume` 有 `cfi` 时 `rendition.display(cfi)`（paginated/scrolled 两 flow 均精确，天然跨模式），CFI 失败回退 `display(href)` → `waitStageStable` → 视口坐标公式设 `scrollTop` → 自校正循环（最多 2 次）；无 `cfi`（旧数据）直接走 v0.2.1 原路径。EPUB 精度口径仍为**章节级**达标（2026-10-20 用户确认 D32），CFI 将章内精度从「最佳努力」提升为「模式内精确」，但跨实例几何漂移仍在。
- **PDF**：同页恢复（`initialPage`），页码两模式一致。
- **TXT（v0.2.3 起 anchor 优先）**：有 `anchor` 时按 `anchor / text.length` 反算页 / 滚动比例（与字号无关）；无 `anchor` 回退 `ratio`。

v0.2.3 前 EPUB 恢复统一为 `display(href)` + 章内 ratio 数学；翻页模式曾因强制 `ratio=0` 丢失章内页（G1），本版由 CFI 修复，详见 5.8。

UI：欢迎页「继续阅读」书架区（卡片含格式色块封面、名称、徽标、相对时间、进度条、悬停移除）、工具栏书架按钮回欢迎页、设置高级页「书架记录」二态确认清空、状态栏书架计数。样式按 CSS 令牌落地四主题。加载过渡动画（2026-10-21）：打开/恢复位置的加载遮罩（淡出 220ms 卸载）、退出保存轻提示、状态栏「进度已保存 ✓」闪烁。

### 5.7 阅读模式切换（v0.2.2）

全局设置 `readerMode: "scroll" | "page"`，默认值 `"scroll"`（纵向滚动）；`normalizeSettings` 对该字段做枚举校验，缺省或非法均回落 `"scroll"`，保证**存量零回归**。设置层文件 `frontend/src/utils/settings.ts`，复用 v0.2.0 的 `bookeditor.settings.v1` 键。

核心机制：

- **`state-host` key 并入 `readerMode`**：改模式 = 整个 Viewer 子树重挂载；各 Viewer 在挂载期读一次 `mode` 走对应分支（视为常量，无需内部响应式重配置）。
- **切换不丢位置（M8）**：`App.handleSettingsChange` / `toggleReaderMode` 在 `readerMode` 实际变化且 `book` 非空时，**先**于事件处理器内同步调用 `positionGetterRef.current?.()` 捕获实时位置写入 `transientResume`，再 `saveSettings` 触发重挂载；重挂载后 `BookViewer` 用 `resume = transientResume ?? libraryResume` 恢复，`handleReady` 完成后清 `transientResume`。位置模型（`ReadingPosition`）不含渲染模式字段，切换不改动 `library.ts` schema（与 v0.2.1 位置记忆正交）。
- **双入口写同一字段**：工具栏 `.mode-seg` 分段器（阅读中显示）与设置面板「阅读体验 · 阅读模式」均写入 `readerMode`，即时生效；设置面板草稿与全局切换经 `useEffect` 同步。

三格式双分支：

| 格式 | 纵向滚动（默认） | 横向翻页 |
|---|---|---|
| EPUB | `manager:"continuous"`+`flow:"scrolled"`，章节窗口化接管（原 scroll 行为不变） | `manager:"default"`+`flow:"paginated"`，**跳过窗口化**；`relocated` 章节跟踪 + 翻页键盘（←/→、PageUp/PageDown、空格）+ 采集/恢复（v0.2.3 起 **CFI 优先**，`ratio=0` 仅作侧栏匹配，见 5.8） |
| PDF | 连续滚动虚拟化：页槽 + `IntersectionObserver` 懒渲染视口内 ±缓冲页 canvas，离屏清 canvas 释放位图；位置取视口顶最靠上可见页 | 单页渲染 + 上下页按钮（原样不变） |
| TXT | 视口比例滚动（原样不变） | filmstrip 平移法：全文本 `<pre>` 置于固定高度 `overflow:hidden` 容器，`transform:translateY(-page*pageHeight)`，`totalPages=ceil(innerHeight/pageHeight)`；`ResizeObserver` 监听宽度/字号变更重算；位置 `ratio=page/totalPages`，v0.2.3 起补字号无关 `anchor`（见 5.8） |

状态栏 `defaultDetail(format, mode)` 按格式×模式动态返回渲染模式文案；翻页导航（`.epub-pager`/`.txt-pager`）绝对定位，已由 `.state { position: relative }` 锚定正文区（D35）。设计基线与偏差见 `doce/BookEditor-v0.2.2-阅读模式切换落地说明文档.md` 与 `doce/_archive/BookEditor-v0.2.2-阅读模式切换落地方案.md`（已归档）。

### 5.8 翻页模式位置定位优化（v0.2.3）

v0.2.2 的位置系统按滚动模式设计，翻页模式未做适配（G1–G4）。本版本补足：

- **EPUB CFI 精确还原**：新增 `currentCfiRef`，两模式 `relocated` 均采集 CFI；`applyResume` 改为 **CFI 优先**（`rendition.display(cfi)`，paginated/scrolled 下均精确），解决翻页章内页丢失（G1）与会话内/跨模式切换掉章首（G4/O1/O2）。
- **TXT 字号无关锚点 `anchor`**：位置改为字符偏移（`anchor = ratio * text.length`），恢复反算页码/滚动比例，字号变化不再漂移（G3/O3）。
- **`mode` 落库与跨模式收口**：`ReadingPosition` 三分支补 `mode` 与 EPUB `cfi`、TXT `anchor` 可选字段；`normalizePosition` 校验/降级，旧数据缺失即走 `href+ratio` 降级（A49）。
- **PDF 仅补 `mode` 元数据**：页码对两模式语义一致，恢复逻辑不变（A48）。
- 数据契约向后兼容：新字段全可选，旧版存储降级恢复不报错（A49）。

设计基线与偏差见 `doce/_archive/BookEditor-v0.2.3-翻页模式位置定位优化方案.md`（已归档） 与 `doce/BookEditor-v0.2.3-翻页模式位置定位落地说明文档.md`。

### 5.9 前端源码文件清单

前端源码位于 `frontend/src/`（源文件 20 个，约 5540 行；另有测试 7 文件共 109 用例，约 1310 行）：

| 层 | 文件 | 职责 |
|---|---|---|
| 入口 | `main.tsx` | React 挂载入口 |
| 根组件 | `App.tsx` | 应用状态、打开/切书/离场 flush、模式切换（M8）、过渡动画、阅读快捷键 window 级派发（v0.2.5） |
| 分派 | `components/BookViewer.tsx` | 按 `format` 分派 Viewer；`state-host` key（含 `readerMode`） |
| Viewer | `components/EpubViewer.tsx` | EPUB：滚动（continuous + 章节窗口化）/ 翻页（default + paginated）、CFI 位置、章节联动、主题注入、翻页导航显隐与快捷键命令注册（v0.2.5） |
| Viewer | `components/PdfViewer.tsx` | PDF：单页翻页 / 连续滚动虚拟化（IntersectionObserver 懒渲染）、快捷键命令注册（v0.2.5）；五态缩放适配 + DPR 清晰渲染 + LRU 页面缓存 + 双页 + 缩放四入口 + 页码跳转（v0.2.9） |
| Viewer | `components/TextViewer.tsx` | TXT：纵向滚动 / filmstrip 翻页、快捷键命令注册（v0.2.5） |
| 界面 | `components/SettingsPanel.tsx` | 设置面板：双栏四分类（含「快捷键」）+ 阅读模式分段器 + 录制式键位绑定（v0.2.5） |
| 界面 | `components/Toolbar.tsx` | 工具栏：打开 / 书架 / 设置 / 阅读模式分段器 |
| 界面 | `components/StatusBar.tsx` | 状态栏：章节 / 渲染模式 / 书架计数 / 进度已保存 |
| 界面 | `components/ErrorBar.tsx` | 结构化错误条 |
| 工具 | `utils/settings.ts` | Settings v4（含 `readerMode`/`hotkeys`）与迁移链 |
| 工具 | `utils/readerHotkeys.ts` | 快捷键键位模型与纯函数（默认表/反查/规范化/冲突消解，v0.2.5） |
| 工具 | `utils/pdfScale.ts` | PDF 五态缩放适配纯函数层（resolvePdfScale 单源解析 + 双页钳制 + 倍率钳制，v0.2.9） |
| 工具 | `utils/readerCommands.ts` | 阅读命令注册表 + 滚动步进 + 翻页导航复现槽位（v0.2.5） |
| 工具 | `utils/library.ts` | 书架 + `ReadingPosition` 契约（含 `cfi`/`anchor`/`mode`） |
| 工具 | `utils/chapterWindow.ts` | EPUB 章节窗口化 + `getAnchor` |
| 工具 | `utils/readingTheme.ts` | 阅读层令牌注入（iframe） |
| 工具 | `utils/appError.ts` / `utils/base64.ts` | 错误码 / Base64 解码 |
| 样式 | `styles.css` | CSS 双层令牌 + 组件样式（四主题）+ 翻页导航自动隐藏（v0.2.5） |
| 测试 | `utils/__tests__/*.test.ts` | 10 文件 165 用例（v0.2.9 新增 `pdfScale` 24 例 + `settings` 7 例） |

### 5.10 版式三件套（v0.2.4 P0）

「阅读体验」设置窗格在字号之外新增三项排版控制（settings v3，键 `bookeditor.settings.v3`）：

| 设置 | 取值 | 默认 | 注入通道 |
|---|---|---|---|
| 行距 | 1.4–2.2，步进 0.05 | 1.75 | EPUB iframe `line-height`；TXT `--reading-line-height` |
| 正文字体 | 系统 / 宋体 / 楷体 | 系统 | EPUB iframe `font-family`（字体栈）；TXT `--reading-font-family` |
| 正文页边距 | 0–80 px，步进 4 | 0 | EPUB iframe body padding（0 时不注入）；TXT `calc(基础 + var(--reading-content-margin))` |

- **存量零回归**：三项默认值即旧行为（默认行距 1.75 为滚动 1.8/翻页 1.7 的统一值，D43）；v2 键六字段全量迁移，v1 键只读保留。
- **即时生效**：设置订阅广播 → EPUB 经 `reinjectReading()` 重注已加载 iframe、新章节经 `hooks.content` 自动带上；TXT 经 CSS 变量级联；均无需重开图书。
- **与位置系统正交**：排版为 CSS 级变更，不进 `state-host` key（不触发重挂载）、不进 `ReadingPosition`；TXT 翻页 `totalPages` 由 ResizeObserver 触发重算；EPUB 位置由 CFI/ratio 机制保持。
- **P1/P2 未启动**：翻页动画、进度显示、TOC 侧栏宽度记忆、PDF 缩放记忆、设置导入导出、快捷键自定义，见 `doce/_archive/BookEditor-v0.2.4-用户体验个性化更新方案.md`（已归档）§5。

### 5.11 翻页导航与快捷键（v0.2.5）

**F21 翻页导航**（EPUB/TXT 翻页模式）：`.epub-pager`/`.txt-pager` 悬浮贴底（`bottom:10px` 居中），`opacity + visibility` 0.3s 过渡；鼠标移动（宿主 container + iframe 内双通道，D50）/ 点击按钮 / 键盘翻页 / 章节切换（`relocated`）即复现并重置 2500ms 计时；隐藏态 `visibility:hidden` 防「看不见的按钮」被 Tab 聚焦（R3）；触达 40×40，半透明底 + 1px 边框 + `--page-shadow`，四主题令牌化。PDF 保持流内控件（页脚页码常驻），仅视觉统一。

**F22 快捷键体系**（window 级单一事实源）：`utils/readerHotkeys.ts` 定义动作（`prev/next/home/end`）与默认键位表；`utils/readerCommands.ts` 单一槽位注册表（同一时刻仅一个 Viewer 挂载）；`App.tsx` window `keydown` 经四重豁免（无书 / 面板打开 / 修饰键组合 / 输入类目标）后 `resolveHotkeyAction` → `dispatchReaderCommand` → Viewer 处理器（返回 true 才 preventDefault）。EPUB 翻页模式 iframe 覆盖内容区，其内 keydown 不冒泡宿主——经 `rendition.hooks.content` 向章节文档注入转发器（keydown → `{__readerHotkey,key}`；mousemove → 节流 120ms → `{__readerPager}`，D50），宿主 message 事件消费。各 Viewer 内旧 stage/root 键盘监听已移除（防双触发翻两页）。

**F24 快捷键自定义**（settings v4，键 `bookeditor.settings.v4`）：`Settings.hotkeys: HotkeyMap`；`normalizeHotkeyMap` 过滤非法键（纯修饰/锁定键、非串、空、超长）、去重、每动作 ≤4、跨动作冲突 canonical 先到先得、空动作回落默认；加载链 v4→v3→v2→v1，v3 存量十字段原值搬移 + hotkeys 补默认（存量零回归）。设置面板新增「快捷键」nav 分类：动作行（chips + ×删 + 「+ 绑定」）、录制态 window capture 拦截（Esc 取消、纯修饰/组合键忽略、Tab 保留焦点导航）、三类冲突行内提示、卡片级「恢复默认」；草稿态保存生效，阅读中实时生效的是已保存配置。

**与位置系统正交**：快捷键只发命令，走既有翻页/滚动通道；`hotkeys` 不进 `ReadingPosition`、不进 `state-host` key。EPUB 翻页 home/end 为目录首/末章（章节级，D32 口径）。

## 6. 错误契约与边界

### 6.1 Go 到前端

Wails v2 会把 Go 的 `error` 以字符串形式 reject，因此项目采用 `CODE: message` 前缀约定，前端统一由 `toAppError()` 解析。

| 错误码 | 产生位置 | 用户行为 |
|---|---|---|
| `USER_CANCELED` | 仅作为前端兼容码，当前取消实际返回空结果 | 静默 |
| `FILE_NOT_FOUND` | `os.Stat` 失败 | 错误条 |
| `FILE_TOO_LARGE` | 文件大于 100 MiB | 错误条 |
| `UNSUPPORTED_FORMAT` | 扩展名不是 EPUB/PDF/TXT | 错误条 |
| `READ_FAILED` | 文件对话框或读取失败 | 错误条 |
| `PARSE_FAILED` | 解析层约定码 | 错误条或格式专用失败页 |
| `UNKNOWN` | 无法识别的异常格式 | 显示原始消息 |

错误条是叠加状态，不会卸载当前已打开 Viewer；用户可手动关闭错误提示。

### 6.2 边界行为

| 场景 | 预期 |
|---|---|
| 空 TXT | 正常显示空内容，不报错 |
| 恰好 100 MiB | 放行到解析层，不触发 `FILE_TOO_LARGE` |
| 大于 100 MiB | 读取前拒绝 |
| TXT 改名为 PDF | PDF 解析失败，不崩溃 |
| TXT 改名为 EPUB | EPUB 10 秒内失败并提示，不永久白屏 |
| MOBI/AZW3 | 不读取内容，直接提示格式不支持 |
| 重复打开同一文件 | 重建 Viewer，清理旧渲染实例 |
| 关闭窗口 | 进程应退出，不保留后台 Viewer 进程 |

## 7. 环境、依赖与运行

### 7.1 推荐环境

| 组件 | 当前项目要求/版本 |
|---|---|
| Windows | Windows 10/11 x64 |
| Go | `go.mod` 为 Go 1.25；当前环境 Go 1.25.6 |
| Node.js | pdfjs-dist 6.x 要求 Node 22.13+；当前环境 Node 24.12.0 |
| npm | 当前环境 npm 11.6.2 |
| Wails CLI | 当前环境 v2.16.0 |
| WebView2 | Windows 运行时必须存在 |

实际依赖版本以 lock 文件和安装结果为准：`epubjs 0.3.93`、`pdfjs-dist 6.4.299`、React 19、Vite 7、Vitest 5。

### 7.2 开发与构建

```powershell
# 安装前端依赖
cd frontend
npm install

# 前端单元测试与生产构建
npm test
npm run build

# 返回项目根目录执行 Go 测试
cd ..
go test ./...

# Wails 开发模式
wails dev

# Windows x64 构建
wails build -platform windows/amd64
```

Wails 构建结果通常位于 `build/bin/book-editor.exe`。构建完成后应重点检查：

- exe 能否在没有 Go/Node 的机器上启动。
- WebView2 是否存在。
- PDF worker 是否被打入 dist。
- 打开 TXT、PDF、EPUB 和损坏样本是否与开发模式一致。

## 8. 测试体系

### 8.1 单元测试

当前前端测试覆盖：

- `base64ToUint8Array`：空数据、文本、二进制字节和长度。
- `toAppError`：前缀解析、未知错误、多行消息和全部错误码。
- `settings`（v2）：默认值、读写回、部分合并、范围钳制、四舍五入、NaN、主题/强调色白名单、`accentHover`、v1 迁移、v1/v2 损坏 JSON、订阅、`resetSettings`、缺字段补齐。
- `readingTheme`：四主题令牌互异、未知主题回落、样式文本含字号/主题色/`!important`、注入幂等、应用主题挂载。
- `chapterWindow`：章节补齐、动态 view display、窗口上限、书首/书尾边界、跳转、回收和零预加载；`getAnchor` 顶部/滚动后锚点与钳制、无 views 返回 null。
- `library`（v0.2.1 起，v0.2.3 增补）：默认空、读写回、去重、50 条淘汰、倒序、`savePosition`/`reportPosition` 时间戳与 lastOpen 语义、损坏 JSON、版本不符回落、position 非法置 null、钳制、订阅广播/取消、`formatRelativeTime` 区间、`progressLabel`；v0.2.3 新增 `cfi`/`anchor`/`mode` 规范与降级（合法 cfi/mode 保留、非法 mode/空 cfi 丢弃、缺失/非有限 anchor 丢弃、越界 anchor 钳制、旧版位置结构不变）。
- `readerHotkeys`（v0.2.5 新建，16 项）：`resolveHotkeyAction` 默认/自定义/未命中/双绑 canonical；`normalizeHotkeyKey` Spacebar 归一、修饰键拒绝、非法输入拒绝；`normalizeHotkeyMap` 默认相等、过滤去重截断、跨动作冲突消解、空动作回落、垃圾输入兜底、结构完整；`cloneHotkeyMap` 深拷贝、`hotkeyKeyLabel` 空格文案。
- `settings`（v0.2.5 增补 v4 组 7 项）：默认键位与 `DEFAULT_HOTKEYS` 一致、v3 存量迁移保真（hotkeys 补默认）、自定义保存读回、键位过滤去重上限、跨动作冲突 canonical、空动作回落、hotkeys 与既有字段混合互不干扰。

### 8.2 E2E 文件

| 文件 | 用途 |
|---|---|
| `e2e/make_fixtures.py` | 生成 TXT、PDF、EPUB、损坏文件和 100 MiB 边界样本 |
| `e2e/validate_fixtures.py` | 校验 PDF xref、页数、EPUB zip/nav、编码和大小 |
| `e2e/driver.py` | Windows GUI 自动化、窗口定位、文件对话框、截图和日志 |
| `e2e/verify_epub_flow.py` | 真书 EPUB 连续滚动、章节联动、设置面板和退出验证 |
| `e2e/smoke_settings.py` | 设置面板个性化冒烟：双栏四分类（含 v0.2.5「快捷键」）、四主题、强调色、字号、保存与重启持久化（坐标点击 + nav 选中态像素验证 + 丢点击重试；7 断言） |
| `e2e/smoke_shelf.py` | 书架冒烟：回书架、卡片与进度条、续读不弹框、悬停移除、去重、二态确认清空、重启保留（13 断言） |
| `e2e/verify_pager.py` | v0.2.5 翻页导航与快捷键真机验证（7 断言）：A60 贴底悬浮、A61 自动隐藏/鼠标复现/按钮点击生效、A62 window 级默认键翻页、A63 iframe 内焦点默认键（postMessage 转发器） |
| `e2e/verify_positions.py` | A29–A31 位置恢复核对：三格式前后截图留档 + A29 章节级自动判定（状态栏章名像素比对，探针与 flush 锚点同源） |
| `e2e/verify_flush.py` | 离场节点 flush 三场景：flush-A 点书架即时更新 / flush-B WM_CLOSE 退出+重启像素级续读 / flush-C EPUB 退出链章节判定 |
| `e2e/verify_mode.py` | 阅读模式切换回归：三格式×两模式打开 + 切换位置保护（A35–A42）；`page-resume` 子命令强化翻页位置保护（A43/A45/A48）；状态栏像素签名判定 + 底栏翻页导航探测，截图落 `e2e/shots/` |
| `e2e/verify_pdf_fit.py` | v0.2.9 PDF 五态适配真机验证（A83/A84/A87/A88/A89/A91）：自标定「近白像素」横向扫描测页面渲染宽、chip/菜单/模式段坐标标定常量、`App.resize_to` 按客户区设窗、Ctrl+滚轮经 `SetCursorPos`+`mouse_event` 模拟；环境异常记 ABORT 并返回 1 |
| `e2e/validate_pdf.mjs` | 使用 pdfjs-dist 做 PDF 结构/打开校验 |
| `e2e/check_epubjs.cjs` | 复现 epubjs 损坏数据永久挂起问题 |
| `e2e/attach_dev.py` | 附加到 `wails dev` 实例进行流程验证 |

其余为样本生成与 GUI 调试/标定辅助脚本（非验收门禁，按需使用）：`make_real_fixtures.py`（真书样本）、`make_icon.py`（应用图标）、`run_realbook.py`（真书驱动运行）、`calib_shelf.py` / `focus_debug.py` / `scroll_check.py` / `scroll_debug.py` / `scroll_probe.py` / `probe_stability.py` / `wheel_probe.py`（滚动/焦点/稳定性标定）、`inspect_spine.cjs` / `trace_display.cjs` / `race_check.cjs`（epubjs/竞态诊断）、`watch_standalone.py`（独立观察）。

### 8.3 推荐 E2E 顺序

```powershell
python e2e/make_fixtures.py
python e2e/validate_fixtures.py

# 先确保 build/bin/book-editor.exe 是最新版本
python e2e/driver.py run txt
python e2e/driver.py run pdf
python e2e/driver.py run epub
python e2e/driver.py run errors
python e2e/driver.py run perf
python e2e/driver.py run epub10x
```

输出默认写入 `e2e/shots/` 和 `e2e/run.log`。测试样本与截图不应提交到仓库，需要时重新生成即可。

### 8.4 验收矩阵

| 编号 | 验收场景 | 通过标准 |
|---|---|---|
| A01 | 启动 | 窗口出现，无异常弹窗 |
| A02 | 文件对话框 | 存在电子书过滤器和所有文件过滤器 |
| A03 | EPUB 正文 | 正文显示并可连续滚动 |
| A04 | PDF 翻页 | 首页、上一页、下一页、边界页码正确 |
| A05 | UTF-8 TXT | 中文和换行正常 |
| A06 | GBK TXT | 中文不乱码 |
| A07/A08 | MOBI/AZW3 | 提示格式不支持 |
| A09 | 取消 | 无提示，原图书状态保留 |
| A10 | 超大文件 | 大于 100 MiB 时提示文件过大 |
| A11 | 100 MiB 边界 | 不触发文件过大错误 |
| A12 | 损坏 PDF | 失败提示，不崩溃、不死锁 |
| A13 | 损坏 EPUB | 失败提示，10 秒内结束等待 |
| A14 | 空 TXT | 空内容正常显示 |
| A15 | 退出 | 关闭后进程退出 |
| A16 | 净机 | 无 Go/Node 时仍可运行，依赖 WebView2 |
| A17 | 性能 | 约 30 MB PDF 可打开并记录内存 |
| A18 | EPUB 目录 | 一级目录可以跳转并高亮同步 |
| A19 | 主题切换 | EPUB/TXT 立即变色，无需重开图书；EPUB 已加载章节同步换肤 |
| A20 | 主题持久化 | 关闭重开应用后主题保持 |
| A21 | 强调色 | 按钮、目录高亮、选中态全部跟随，无遗漏硬编码 |
| A22 | 字号 | EPUB/TXT 生效；13/20 边界不破版 |
| A23 | 预加载档位 | 0/1/2/3/5 点选后预览图与窗口章节数一致 |
| A24 | 设置取消 | 取消后重开面板显示旧值 |
| A25 | 恢复默认 | 一键回默认，保存后生效 |
| A26 | 迁移 | 装有 v1 设置的机器升级后预加载值保留 |
| A27 | 书架记录与重启保留 | 打开图书后欢迎页书架出现该记录（名称/格式/进度/时间），重启后仍在 |
| A28 | 去重 | 重复打开同一本书只更新原条目，不新增 |
| A29 | EPUB 位置恢复 | 滚到书中部退出，书架续读落在同一章（章节级口径，2026-10-20 用户确认；章内比例最佳努力） |
| A30 | PDF 页码恢复 | 翻到第 N 页退出，重开落在第 N 页 |
| A31 | TXT 位置恢复 | 滚到中部退出，重开位置接近 |
| A32 | 书架续读不弹框 | 点卡片直接打开，无任何确认弹窗 |
| A33 | 失效文件 | 删文件后点卡片：错误条出现、不崩溃、条目保留 |
| A34 | 清空 | 单卡移除 + 高级页二态确认清空，书架区隐藏 |
| A35 | 阅读模式默认 | 新装/旧配置均回落纵向滚动，存量阅读行为不变 |
| A36 | 设置选翻页 | 设置面板选「横向翻页」后三格式按各自翻页呈现 |
| A37 | 工具栏即时切换 | 阅读中工具栏分段器即时切换，无需重开/重进 |
| A38 | 切换位置保护 | 切换模式前后阅读位置一致（与 v0.2.1 位置记忆正交） |
| A39 | EPUB 翻页 | `paginated` 分页 + 翻页/键盘 + 主题注入；scroll 窗口化不受影响 |
| A40 | PDF 滚动虚拟化 | 连续滚动懒渲染流畅、内存可控、位置与翻页互通 |
| A41 | TXT 分页 | filmstrip 随字号/宽度自适应、位置可恢复、与滚动 ratio 互通 |
| A42 | 模式持久化 | 关闭重开应用后阅读模式保持（设置持久化） |
| A43 | EPUB 翻页退出重开落到章内同页（CFI） | ✅ 已落地，真机待验 |
| A44 | EPUB 滚动⇄翻页切换落到最近阅读点（±1 页） | ✅ CFI 优先 + M8，真机待验 |
| A45 | EPUB 跨模式重开无损（CFI 优先） | ✅ 已落地，真机待验 |
| A46 | TXT 翻页位置与字号解耦 | ✅ `anchor` 反算，真机待验 |
| A47 | TXT 跨模式恢复一致 | ✅ 两模式上报 `anchor`，真机待验 |
| A48 | PDF 翻页正确 + `mode` 落库 | ✅ 已落地 |
| A49 | 旧版位置降级恢复不报错 | ✅ 单测覆盖 |
| A50 | `tsc`/`vitest`/`build`/`go test`/`wails build` 全绿 | ✅ 全绿 |
| A60 | 翻页按钮不遮挡正文 | ✅ 真机（`verify_pager.py` 贴底像素实证 + 截图） |
| A61 | 按钮 2.5s 闲置自动隐藏；移动/翻页/hover 复现 | ✅ 真机 7/7 |
| A62 | EPUB 翻页：刚打开未点击正文时默认键即生效 | ✅ 真机（diff=40767） |
| A63 | EPUB 翻页：焦点在正文（iframe）内时默认键仍生效 | ✅ 真机（diff=37294） |
| A64 | TXT 翻页全键位生效 | 代码 ✅ / 真机待验 |
| A65 | PDF 单页默认键翻页正确 | 代码 ✅ / 真机待验 |
| A66 | PDF 滚动 PageDown/空格/Home/End | 代码 ✅ / 真机待验 |
| A67 | 面板打开时翻页键不穿透；Ctrl+A/C 不受影响 | 代码 ✅（四重豁免）/ 真机待验 |
| A68 | 「快捷键」分类：录制绑定/删除/冲突提示/恢复默认 | 代码 ✅；渲染与可达性截图实证；录制交互真机待验 |
| A69 | 自定义键位保存后阅读中即时生效 | 代码 ✅（settings 订阅）/ 真机待验 |
| A70 | 自定义键位跨重启保持 | 代码 ✅（v4 持久化）/ 真机待验 |
| A71 | settings v4 迁移：v3 存量保真、hotkeys 补默认、读回一致 | ✅ 单测 7 项 |
| A72 | 单测：hotkeys 校验/冲突消解/迁移 + resolveHotkeyAction 映射 | ✅ 23 项（readerHotkeys 16 + settings v4 组 7） |
| A73 | 门禁五项全绿，既有 86 项无回归 | ✅ 109/109；tsc/vitest/go test/vite build/wails build 全绿 |
| A83 | 默认 `auto`：1280×860 窗口开 A4 PDF → 判适宽 208%、页面铺满内容区宽度、无左右空白条 | 代码 ✅；`verify_pdf_fit.py` 宽度像素断言待真机 |
| A84 | 窗口拉到 900×600（最窄）→ `auto` 仍判适宽（约 144%），页面仍铺满宽度；整页可见需手动切「适高」（0.50×） | 代码 ✅；`verify_pdf_fit.py`（`App.resize_to`）待真机 |
| A85 | 内容区宽度 <480px → `auto` 翻转为适高（81%），整页可见不裁切 | ✅ 单测 2 例（cw=481/480；真机不可达，D70①） |
| A86 | 宽幅页面（宽高比 >1.82）→ `auto` 稳定判适高；16:9 页在默认窗下判适宽 129%（底溢 16px，近似平局） | ✅ 单测覆盖，真机目视待补 |
| A87 | 切「适高」整页可见垂直居中；切「双页」两页并排、步进 2、页码 `4 / 262` | 代码 ✅；`verify_pdf_fit.py` 双白段检测待真机 |
| A88 | 缩放四入口（控制条 ±/档位菜单/Ctrl+滚轮/设置面板）生效，钳制 50–400% | 代码 ✅；单测（clamp/nudge）+ 真机 Ctrl+滚轮待验 |
| A89 | 倍率写入 settings，重启应用后保持 | 代码 ✅；`verify_pdf_fit.py` 重启宽度复现待真机 |
| A90 | DPR：125% 与 200% 系统缩放下文字边缘清晰（与关闭开关对比） | 代码 ✅；真机目视（脚本无法读 DOM） |
| A91 | 连续滚动模式视口 1000px 宽时 canvas 精确铺满、无拉伸模糊 | 代码 ✅；`verify_pdf_fit.py` 滚动铺满断言待真机 |
| A92 | 连续 10 次「下一页」无可见白屏/重解析延迟 | 代码 ✅；真机计时 |
| A93 | 262 页书滚动全程 RSS 增长平缓（LRU 生效） | 代码 ✅；真机任务管理器观测 |
| A94 | 首渲与翻页时 `.pdf-canvas-area` 无跳动 | 代码 ✅（RO 守卫 + 尺寸预设）；真机目视 |
| A95 | 回归：进度保存/恢复仍按页码精确（含双页模式重启） | 代码 ✅；`verify_positions.py` 待真机 |

A43–A50 验证状态（2026-10-21，v0.2.3）：自动化门禁全绿——`tsc --noEmit` PASS、`vitest` 72/72（68 既有 + 4 新增 library cfi/anchor/mode 规范与降级）、`vite build` PASS、`go test` PASS、`wails build` 产出 `build/bin/book-editor.exe`。A48/A49/A50 由代码与单测直接覆盖；A43–A47 逻辑/类型/构建已验证（`e2e/verify_mode.py` 的 `page-resume` 子命令已交付，语法校验通过），最终 GUI 交互与真书 CFI/字号表现以真实 Windows 桌面会话运行 `python e2e/verify_mode.py page-resume` + 人工看 `e2e/shots/` 截图为准。偏差见 `doce/BookEditor-v0.2.3-翻页模式位置定位落地说明文档.md` 的 D40–D41。

A19–A26 验证状态（2026-10-20，`e2e/smoke_settings.py` 6/6 + 单元测试）：A19/A20/A21/A25 已经像素断言与截图实测通过（主题保存即生效、重启持久化、强调色全局跟随、重置回默认）；A22 字号 20px 实测生效，边界钳制由单测覆盖；A23 档位交互在界面截图中确认，未纳入冒烟断言；A24 取消回退未做 GUI 验证（面板关闭即丢弃草稿的实现路径清晰，待补断言）；A26 由 `settings.test.ts` 迁移用例覆盖，未在装有 v1 设置的真机环境验证。

A27–A34 验证状态（2026-10-20）：`e2e/smoke_shelf.py` 13/13 通过（基线清空、回书架标题与卡片、位置已上报进度条、续读不弹框、悬停移除、A28 去重、A34 高级页二态确认清空、A27 重启保留）；`e2e/verify_positions.py` 三格式留档截图——A29 章节级自动判定 PASS（状态栏章名像素 mad=0.000）+ 人工截图确认同章（推荐序二），A30 PDF 第 2/3 页像素级一致，A31 TXT 像素级一致；A33 失效文件为手动验收项（删文件点卡片错误条不崩溃，未自动化）。

A35–A42 验证状态（2026-10-21，v0.2.2）：自动化门禁全绿——`tsc --noEmit` PASS、`vitest` 68/68（64 既有 + 4 新增 readerMode 迁移）、`vite build` PASS、`go test` PASS、`wails build` 产出 `build/bin/book-editor.exe`。A35/A42 由 `settings.test.ts` 迁移用例直接覆盖（默认回落 + 保存读回）；A36–A41 逻辑/类型/构建已验证（`e2e/verify_mode.py` 已交付，语法校验通过），最终 GUI 交互与真书表现以真实 Windows 桌面会话运行 `python e2e/verify_mode.py [epub|pdf|txt|all]` + 人工看 `e2e/shots/` 截图为准（本无头环境无法点击 GUI，未实跑）。偏差见 `doce/BookEditor-v0.2.2-阅读模式切换落地说明文档.md` 的 D35–D39。

A60–A73 验证状态（2026-10-21，v0.2.5）：自动化门禁全绿——`tsc --noEmit` PASS、`vitest` 109/109（86 既有 + 23 新增：readerHotkeys 16 / settings v4 组 7）、`go test` PASS、`wails build` 产出 `build/bin/book-editor.exe`（13.00 MB）。真机：`e2e/smoke_settings.py` 7/7（复位链路、基线、A19/A20/A21、快捷键 nav 可达）+ `e2e/verify_pager.py` 7/7（A60 贴底、A61 隐藏/复现/点击、A62 window 派发、A63 iframe 转发）。A64–A67（TXT/PDF 快捷键、面板豁免）与 A68–A70（录制交互）为代码+单测层面验证，真机待补。偏差见 `doce/BookEditor-v0.2.5-翻页导航与快捷键优化落地说明文档.md` 的 D45–D50（含 D45 对话框定高 600px、D50 iframe mousemove 转发器两处产品代码修正）。

A83–A95 验证状态（2026-10-24 基线，2026-10-26 追加 D71/D72 hotfix）：自动化门禁全绿——`tsc --noEmit` PASS、`vitest` **167/167**（134 既有 + 24 `pdfScale` + 7 `settings` + 2 `library` 分类回归 [D72]）、`go test` PASS、`wails build` 产出 `build/bin/book-editor.exe`（沙箱无 Go/Wails，构建需本机执行）。A85/A86 由 `pdfScale.test.ts` 直接覆盖（含翻转点 cw=481/480 两例）；A83/A84/A87/A88/A89/A91 由新增 `e2e/verify_pdf_fit.py` 覆盖（自标定像素断言，chip/菜单/模式段坐标为标定常量，几何不符时需微调），待真实 Windows 桌面会话回归；A90/A92/A93/A94 依赖真机目视/计时，不强行自动化；A95 由 `verify_positions.py` 回归。偏差见 `doce/BookEditor-v0.2.9-PDF显示优化开发方案.md` 的 D65–D72；其中 **D71（二次打开/横屏报「PDF 解析失败」、竖屏滚动正常）与 D72（PDF 分类后重开分类消失）为上线后真机反馈的 hotfix**，二者均需在下一 `wails build` 后回归。

## 9. 风险与后续规划

### 9.1 当前风险

| 风险 | 影响 | 当前处理 |
|---|---|---|
| Base64 传输带来内存放大 | 大 EPUB/PDF 打开时峰值较高 | 保留 100 MiB 上限，E2E 有 30 MB 基线 |
| EPUB 超时阈值固定 10 秒 | 极大的正常 EPUB 可能被误判失败 | 后续增加加载进度和取消操作 |
| EPUB 章节窗口复杂 | 不同书脊、封面页、非线性章节可能有兼容性差异 | 使用 spine 映射、窗口测试和真书 E2E |
| UTF-16 TXT 未专门处理 | 少数文本可能乱码 | v0.2 增加 BOM 检测 |
| WebView2 缺失 | 应用无法启动或显示 | 净机验证和安装引导待补 |
| PDF 中文字体/CMap | 部分 PDF 可能出现缺字 | 按实际样本增加 cMap 配置 |
| EPUB CFI 跨 flow 还原精度（v0.2.3） | 极个别损坏书 CFI 还原可能偏章首 | `href+ratio` 降级兜底（A49），真机回归 A43–A45 |
| TXT `anchor` 均匀假设（v0.2.3） | 极端不等长段落翻页偏差 < 1 页 | 滚动 `ratio` 兜底，O3 允许 ±1 屏 |
| 书籍自带 CSS 覆盖版式（v0.2.4） | 书籍对具体元素设了 `line-height`/`font-family` 时注入不生效 | 既有局限（v0.1.0 落地文档第 9 章）；注入用 `!important` 已覆盖 body 级 |
| iframe mousemove 转发节流 120ms（v0.2.5 D50） | 连续移动时每 120ms 一条 postMessage，低性能机消息量未测 | 当前实测无体感问题；必要时上调节流或改 rAF 合并 |
| TXT/PDF 快捷键与录制交互真机未验（v0.2.5） | A64–A67、A68–A70 仅代码+单测层面 | 补 `verify_*.py` 或人工走查后回填验收矩阵 |
| PDF DPR 位图内存 ×dpr²（v0.2.9 D68） | 200% 缩放 + DPR=2 时单页位图约 9.8MB，连续翻页堆叠峰值待实测 | 上限锁 `min(dpr,2)` + `pdfDpr` 开关；43.6MB 大书 200% 缩放下待真机实测（A92/A93） |

### 9.2 v0.2+ 建议

1. 用临时文件或流式接口替换 EPUB/PDF Base64，降低内存峰值。
2. 增加 UTF-16、更多 PDF 字体和加密文件测试。
3. 增加最近打开、阅读位置和书架能力。**已落地：`doce/_archive/BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md`（2026-10-20 产出并实施，`e2e/smoke_shelf.py` 13/13 + A27–A31 截图验证通过；实施口径见对应落地说明）。**
4. 增加 NSIS 安装包和 WebView2 检测/引导。
5. 将 EPUB、PDF 重型依赖拆分为动态加载，降低前端首屏包体积。
6. 为 E2E 输出正式的 A01-A18 汇总报告，区分通过、失败和环境跳过。
7. 按《_archive/BookEditor-v0.2.0-个性化功能落地方案》（已归档）落地阅读主题、强调色、正文字号与阅读位置记忆等个性化能力（该文档含 P0/P1/P2 分级、任务拆分与 A19-A26 验收项；实施口径见对应落地说明）。**进度（2026-10-20）：P0 已全部落地并通过冒烟与单测；P1（阅读位置记忆）已随 v0.2.1 书架功能完整落地（localStorage 书架 + 三格式位置记忆，A27–A34 验收）；P2 未启动。**
8. 阅读模式切换与翻页位置定位优化。**已落地：v0.2.2 横向翻页 ⇄ 纵向滚动（A35–A42，见 5.7）、v0.2.3 翻页位置定位优化（A43–A50，见 5.8）。**
9. 翻页导航遮挡与快捷键缺失。**已落地：v0.2.5 翻页按钮悬浮贴底 + 自动隐藏（F21，A60/A61）、window 级快捷键收口 + PDF 补齐（F22，A62–A67）、快捷键自定义（F24，A68–A71，见 5.11）。后续候选：F25 点击半屏翻页、快捷键导入导出。**
10. PDF 显示优化（v0.2.9）。**已落地：五态适配默认 `auto`（D65，废除写死 1.2）、DPR 清晰渲染、LRU 页面缓存、双页 spread、Ctrl+滚轮、页码跳转；A83–A95 待真机（`e2e/verify_pdf_fit.py`）。2026-10-26 追加两个上线后 hotfix：① D71 修复「二次打开/横屏报『PDF 解析失败』、竖屏滚动正常」（pdfjs 全局 `#canvasInUse` 同 canvas 并发 render 同步抛错，单页 `setFailed` 表面化、连续滚动 `catch {}` 静默规避），改为按 canvas 维度登记在飞任务并重渲前 await 释放；② D72 修复「PDF 分类后重开分类消失」（根因 `library.savePosition` 以全新对象 `upsertEntry` 重写条目漏带 `cat`，改为合并旧条目，三格式统一保留分类，2 例单测回归）。二者均待本机 `wails build` 后回归。后续候选（D69）：目录面板、文本重排，建议 v0.3.0 独立立项。**

## 10. 维护规则

- 修改 Go 的公开方法或结构体后，重新运行 `wails dev` 或 `wails build`，检查 `frontend/wailsjs/` 生成结果。
- 新增错误码时同时更新 Go 产生点、`toAppError` 测试和本文件错误表。
- 修改 EPUB 渲染生命周期时，至少回归章节窗口单元测试、真书滚动、重复打开和关闭进程。
- 修改 PDF 依赖时同时验证 worker 路径、类型检查、打包产物和损坏 PDF。
- 修改文件大小、格式或取消语义时，回归 A07-A14，尤其是 100 MiB 边界。
- `e2e/fixtures/`、`e2e/shots/` 和运行日志属于测试输出，不作为源码文档维护。

## 11. 文档清单

全部项目文档统一存放在 `doce/` 目录，工程根目录与上级目录不再散落文档：

| 文档 | 定位 | 维护状态 |
|---|---|---|
| `BookEditor-v0.1.0-整合项目文档.md` | 整合入口：架构、实现口径、验收矩阵、维护规则（持续更新，事实入口） | 随代码持续更新 |
| `BookEditor-前端界面示例.html` | React 实现前的 UI 静态参考，含设置面板个性化设计 | 随界面设计更新 |
| `BookEditor-前端界面示例-v0.2.8-书架分类与清空确认.html` | v0.2.8 视觉基线（可交互）：清空管理对话框（自选清除 + 二次确认）、分类页签、卡片归类菜单 | 已产出，为 v0.2.8 实施基线 |
| `BookEditor-v0.2.8-书架分类与清空确认开发方案.md` | v0.2.8 实施口径（F25–F30、数据契约、A75–A82、D59–D64、T1–T8） | 代码已落地，A75–A82 待真机 |
| `BookEditor-v0.2.9-PDF显示优化开发方案.md` | v0.2.9 实施口径（O1–O13 目标、五态缩放、数据契约、A83–A95、D65–D72、T1–T9） | 代码已落地，A83–A95 待真机；D71/D72 为上线后反馈的 hotfix（D71：二次打开/横屏报「解析失败」、竖屏滚动正常；D72：分类后重开分类消失） |
| `BookEditor-前端界面示例-v0.2.9-PDF显示优化.html` | v0.2.9 视觉基线（可交互）：½ 比例前后对比、五态适配实时演算与翻转点演示、四处缩放入口、页码跳转、设置面板同步、DPR 位图读数 | 已产出，为 v0.2.9 实施基线 |
| `BookEditor-v0.2.0-个性化功能落地说明文档.md` | v0.2.0 P0 实施口径（Settings v2 契约、CSS 双层令牌、EPUB 注入、偏差记录） | 随代码持续更新 |
| `BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md` | v0.2.1 实施口径（library.v1 契约、逐文件实现、D25–D35 偏差记录） | 已实施，随代码持续更新 |
| `BookEditor-v0.2.2-阅读模式切换落地说明文档.md` | v0.2.2 实施口径（交付物、数据契约、A35–A42 验收、D35–D39 偏差） | 已实施，随代码持续更新 |
| `BookEditor-v0.2.3-翻页模式位置定位落地说明文档.md` | v0.2.3 实施口径（数据契约、逐文件实现、A43–A50 验收、D40–D41 偏差） | 已实施，随代码持续更新 |
| `BookEditor-v0.2.4-用户体验个性化落地说明文档.md` | v0.2.4 实施口径（settings v3 契约、逐文件实现、A51–A59 映射、D42–D44 偏差） | P0 已实施，随代码持续更新 |
| `BookEditor-v0.2.5-翻页导航与快捷键优化落地说明文档.md` | v0.2.5 实施口径（settings v4 契约、键位表与派发链路、A60–A73 映射、D45–D50 偏差、e2e 坐标化重构） | 已实施，随代码持续更新 |
| `BookEditor-v0.2.6-翻页按钮显隐优化落地说明文档.md` | v0.2.6 实施口径（`usePagerVisibility` 共享 hook、悬停一级状态、单页不渲染、D51/D52 PDF 修复、A64/A65 新增断言） | 已实施，随代码持续更新 |
| `BookEditor-v0.2.7-拖拽打开支持类型文件开发方案.md` | v0.2.7 实施口径（方案 A：`SupportedExts()` 绑定 + 整窗 `OnFileDrop(cb,false)` + `handleDrop` 白名单校验、Ctrl+O 快捷键、A71–A74 验收、D54 修订/D55 消解/D56–D58 真机反馈修复） | 代码已落地，A71–A74 待真机复验 |
| `e2e/_debug/` | 一次性诊断脚本（`probe_*`/`dbg_*`/`calib_*`/`scroll_*`/`wheel_*`/`race_check` 等），移出活跃 e2e 目录，仅追溯 | 归档，不参与门禁 |

**归档（`doce/_archive/`，仅追溯；方案稿在落地后已被对应落地说明吸收，每版仅保留「落地说明」一份权威记录）**：
`BookEditor-v0.1.0-开发规划文档.md`、`BookEditor-v0.1.0-落地说明文档.md`、`BookEditor-v0.2.0-个性化功能落地方案.md`、`BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md`、`BookEditor-v0.2.2-开发更新规划文档.md`、`BookEditor-v0.2.2-阅读模式切换落地方案.md`、`BookEditor-v0.2.3-翻页模式位置定位优化方案.md`、`BookEditor-v0.2.4-用户体验个性化更新方案.md`、`BookEditor-v0.2.5-翻页导航与快捷键优化方案.md`。

规则：新文档一律写入 `doce/`；每版仅保留「落地说明」一份权威记录，方案稿落地后归档至 `_archive/`；口径冲突以整合文档为准。

## 12. 偏差记录索引

各版本偏差分散在对应落地说明文档，此处汇总索引（口径以各落地说明为准）：

| 版本 | 偏差编号 | 落地说明文档 |
|---|---|---|
| v0.1.0 | D1–D19 | `_archive/BookEditor-v0.1.0-落地说明文档.md`（已归档） |
| v0.2.0 | D20–D24 | `BookEditor-v0.2.0-个性化功能落地说明文档.md` |
| v0.2.1 | D25–D35（含 D33 探针同源 / D34 离场节点口径 / D35 退出 flush 握手） | `BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md` |
| v0.2.2 | D35–D39（`.state` 定位 / `mgr` 笔误 / `ReaderMode` 误导入 / IO 依赖 / React19 类型收紧） | `BookEditor-v0.2.2-阅读模式切换落地说明文档.md` |
| v0.2.3 | D40–D41（`matchTarget` 作用域 / `ReaderMode` 单向依赖） | `BookEditor-v0.2.3-翻页模式位置定位落地说明文档.md` |
| v0.2.4 | D42–D44（vendor chunk 拆分 / TXT 默认行距统一 1.75 / 行距 0.05 步进浮点修正） | `BookEditor-v0.2.4-用户体验个性化落地说明文档.md` |
| v0.2.5 | D45–D50（对话框定高 600px / 滚动步进区分 / smoke 坐标化重构 / A21 去恒真化 / 前台哨兵 / iframe mousemove 转发器） | `BookEditor-v0.2.5-翻页导航与快捷键优化落地说明文档.md` |
| v0.2.6 | D51–D53（PDF 滚动 `fireReady` 缺失致遮罩吞点击 / 虚拟化渲染守卫恒假致整页空白 / 悬停判定由 `mouseenter/leave` 改 `mousemove` 命中测试，监听上移 `section`） | `BookEditor-v0.2.6-翻页按钮显隐优化落地说明文档.md` |
| v0.2.7 | D54（`useDropTarget` 语义修订：false 跳过 drop-target 元素检查）/ D55（类型单源：`SupportedExts()` 绑定，已消解）/ D56（Go 侧 `EnableFileDrop` 缺失致拖入被当下载，已修）/ D57（Ctrl+O 被 WebView2 默认加速键接管，已前端拦截）/ D58（书架 `1fr` 轨道 auto 最小宽致列不等宽，已改 `minmax(0,1fr)`） | `BookEditor-v0.2.7-拖拽打开支持类型文件开发方案.md` |
| v0.2.8 | D59（批量写盘：新增 `removeEntries`/`setEntriesCategory` 避免 N 次写盘与广播）/ D60（设置高级页二态确认被管理对话框取代，e2e 脚本须改写）/ D61（预设分类只读不可删）/ D62（分类名 1–12 字符 + 保留字「未分类」「全部」）/ D63（删除自定义分类时图书转入「未分类」并二次确认）/ D64（分类存名而非 id） | `BookEditor-v0.2.8-书架分类与清空确认开发方案.md` |
| v0.2.9 | D65（PDF 默认缩放由写死 1.2 改 `auto` 自适应，与原说明文档 6.3 冲突，验收通过后回写）/ D66（适宽模式页内需纵向滚动，纸面比例与宽窗的固有矛盾）/ D67（缩放字段沿用 `settings.v4`，version 不变）/ D68（DPR 位图内存 ×dpr²，上限锁 2 + 开关）/ D69（目录/页码跳转/文本重排不在本期，建议 v0.3.0 独立立项）/ D70（A85 翻转点真机不可达改单测覆盖并修正误算值 492→480px；O11 页码跳转提前落地，越界静默钳制）/ D71（上线后反馈：二次打开/横屏报「PDF 解析失败」、竖屏滚动正常；根因为 pdfjs 全局 `#canvasInUse` 同 canvas 并发 render 同步抛错，单页模式 `setFailed` 表面化、连续滚动 `catch {}` 吞掉；修复为按 canvas 维度登记在飞任务并重渲前 await 释放，废弃误入的 worker 销毁串行锁）/ D72（上线后反馈：PDF 分类后重开分类消失；根因为 `library.savePosition` 以全新对象 `upsertEntry` 重写条目未带旧 `cat`，重开即丢分类；修复为合并旧条目只覆盖打开相关标量，三格式统一保留分类，含 2 例单测回归） | `BookEditor-v0.2.9-PDF显示优化开发方案.md` |

> **编号冲突（如实记录）**：`D35` 在 v0.2.1（退出 flush 放后台 goroutine + 600ms 超时）与 v0.2.2（`.state` 补 `position: relative`）两处含义不同，属跨版本编号复用。后续新增偏差建议按全局连续编号（自 D42 起）以避免歧义；既有编号暂不返工，以免破坏各落地说明的交叉引用。

> **v0.2.5 编号说明（如实记录）**：D46（滚动步进区分）在实现期已写入 4 处代码注释（`readerCommands.ts` / `EpubViewer.tsx` / `PdfViewer.tsx` / `TextViewer.tsx`），落地说明沿用该编号；D45 为对话框定高修正，D47–D50 为 T6 期 smoke 重构与 F21 转发器修复，按记录时序编号。
