# BookEditor v0.1.0 落地说明文档

| 项 | 内容 |
|---|---|
| 文档名称 | BookEditor v0.1.0 落地说明文档 |
| 依据文档 | 《BookEditor-Windows 初版项目说明文档》v0.1.0（2026-10-19，下称"原文档"） |
| 文档版本 | v1.1 |
| 日期 | 2026-10-19（v1.1：编码与 GUI 测试完成，补测试期修正注记） |
| 状态 | 已实施并通过 GUI 验收（A16 净机项受环境限制跳过，见开发规划文档 10.3） |
| 适用范围 | Windows 10/11 x64 初版落地 |

---

## 0. 文档定位与使用方式

本文档不做需求变更，只解决四个问题：

1. **排序**：原文档定义"做什么"，本文档给出"按什么顺序做、每步怎么算完成"。
2. **补全**：原文档未覆盖但实施必然遇到的细节（版本锁定、错误传递机制、worker 加载、测试样本制备等）。
3. **纠偏**：原文档中与当前上游生态事实不符或存在实施坑位的口径，逐条记录偏差（见第 10 章），不静默修改。
4. **验收**：把原文档第 10 章验收标准展开为可执行测试矩阵（见第 8 章）。

使用顺序：第 1 章总览 → 第 2 章环境 → 第 3 章初始化 → 第 4 章按里程碑实施（第 5–7 章为查考）→ 第 8 章验收 → 第 10 章同步偏差。

**冲突处理规则**：需求以原文档为准；本文档与原文档不一致处，以第 10 章偏差记录为准。实施完成后应回写原文档（或合并为 v0.1.1），避免两份文档长期并存冲突。

---

## 1. 一页总览

### 1.1 不变项

- 目标平台：Windows 10/11 x64
- 技术路线：Wails v2 + Go + React + TypeScript + WebView2
- 初版范围：打开并正确显示 EPUB / PDF / TXT；错误提示；wails build 产出 x64 可执行文件
- 非目标：编辑、批注、书架、进度持久化、云同步、MOBI/AZW3、DRM（与原文档 2.2 一致）

### 1.2 落地路线图

| 里程碑 | 内容 | 验证门槛（Gate） | 主要涉及文件 |
|---|---|---|---|
| M0 | 环境核对与项目初始化 | wails doctor 全绿；wails dev 首启成功；wailsjs 绑定生成 | main.go, wails.json, frontend/* |
| M1 | 打通主链路（仅 TXT） | UTF-8/GBK TXT 正常；取消静默；.mobi 被拒绝并提示 | app.go, App.tsx, BookViewer/TextViewer, appError.ts |
| M2 | PDF 显示 | 首页渲染、翻页、边界钳制；worker 无加载失败；30MB PDF 可开 | app.go, PdfViewer.tsx |
| M3 | EPUB 显示 | 正文显示；目录跳转；切换/关闭后无残留 | EpubViewer.tsx |
| M4 | 错误与边界收尾 | 错误矩阵（第 8 章）全过 | app.go, App.tsx |
| M5 | 打包与净机验证 | build/bin/book-editor.exe 在无 Go/Node 机器可用；关闭后进程退出 | — |
| M6 | 验收 | 第 8 章矩阵全过并留记录 | — |

排序理由：M1 用 TXT 打通"对话框 → Go → JSON → 前端分派 → 显示"与错误路径，不涉及二进制传输，反馈最快；M2 引入 Base64 传输 + worker + canvas；M3 的 EPUB 涉及 zip 解析、iframe、目录，风险最高放最后。每个 Gate 不过不进入下一里程碑。

---

## 2. 前置条件与版本核对

### 2.1 环境要求

| 组件 | 要求 | 核对命令 | 说明 |
|---|---|---|---|
| 操作系统 | Windows 10/11 x64 | — | — |
| Go | ≥ 1.25 | `go version` | 原文档写 1.22+；当前 Wails v2 CLI（v2.16+）go.mod 要求 1.25（偏差 D8）。若本机已装 1.26.x 可直接满足 |
| Node.js | ≥ 22.13 | `node -v` | 原文档写 20+；pdfjs-dist 6.x 的 engines 声明 node >=22.13.0 \|\| >=24（偏差 D8） |
| npm | ≥ 10 | `npm -v` | — |
| Wails CLI | v2.17.x | `wails -v` | `go install github.com/wailsapp/wails/v2/cmd/wails@latest`；安装后确认 PATH 含 GOPATH/bin |
| WebView2 Runtime | 已安装 | `wails doctor` | Windows 11 内置；Windows 10 需 Evergreen Runtime（检测命令见 8.3） |

补充说明：Windows 平台原生构建不需要 gcc / MinGW（CGO 非必需），不要额外安装。

### 2.2 依赖版本锁定

| 依赖 | 建议版本 | 说明 |
|---|---|---|
| wails | v2.17.x（go install @latest） | v3 为 beta，不纳入初版 |
| epubjs | 0.3.93（`npm view epubjs version` 核对） | 0.3.x 唯一活跃线；jszip 为其依赖，随 npm 自动装入，无需单独安装；自带 TS 类型 |
| pdfjs-dist | ^6（当前 6.4.299，`npm view pdfjs-dist version` 核对） | v4+ 起 worker 文件为 build/pdf.worker.min.mjs（v3 为 .js）；以 `ls node_modules/pdfjs-dist/build` 实际结果为准 |
| golang.org/x/text | 固定 v0.39.0（2026-10-19 编码期修正，偏差 D12） | GBK 解码用；最新 v0.43.0 要求 Go ≥1.26，与本文档 Go ≥1.25 冲突，故锁定 v0.39.0 |
| React / Vite | 随 react-ts 模板 | 不手改，避免与模板构建脚本冲突 |

---

## 3. 项目初始化（一次性）

按序执行，每步确认结果再继续：

| 步骤 | 命令 | 通过标准 |
|---|---|---|
| 1 | `wails doctor` | 全项通过（含 WebView2 检查） |
| 2 | `wails init -n book-editor -t react-ts` | 生成 book-editor/ 目录，含 frontend/ |
| 3 | `cd book-editor && npm install --prefix frontend` | 无 error 级日志 |
| 4 | `npm install --prefix frontend epubjs@0.3.93 pdfjs-dist` | 两包进入 frontend/package.json dependencies |
| 5 | `go get golang.org/x/text` | go.mod 新增依赖 |
| 6 | `wails dev` | 窗口启动并加载模板页；控制台无红色错误 |
| 7 | 检查 `frontend/wailsjs/go/main/App.d.ts` | 模板默认方法绑定已生成（此时尚无 OpenBook） |

初始化后调整点：

| 位置 | 调整 | 说明 |
|---|---|---|
| main.go | Title 改 "BookEditor"；Width/Height 建议 1280×860；可加 MinWidth/MinHeight（900×600，若模板 options 结构不支持可删）；可加白色 BackgroundColour 防启动白闪 | 模板默认 1024×768 对阅读器偏小（偏差 D6） |
| wails.json | 确认 name / outputfilename 为 book-editor；frontend 安装/构建命令保持模板默认 | 产出文件名即 book-editor.exe |
| frontend/package.json | 确认 epubjs、pdfjs-dist 在 dependencies（不是 devDependencies） | 生产构建需要 |

**绑定生成规则（重要）**：`wails dev` / `wails build` 会自动重新生成 `frontend/wailsjs/`；修改 Go 结构体或方法后，先确认 `wailsjs/go/main/App.d.ts` 与 `wailsjs/go/models.ts` 已更新，再写前端调用代码；wailsjs 为生成物，禁止手改。

---

## 4. 里程碑拆解

### M1 打通主链路（仅 TXT）

目标：以最低复杂度验证完整链路与错误契约。

步骤清单：

- [ ] app.go：定义 BookData 结构体、startup 存 ctx、OpenBook（本期 switch 仅放行 txt，其余扩展名直接返回 UNSUPPORTED_FORMAT）
- [ ] main.go：Bind: []interface{}{app}；确认窗口参数已按第 3 章调整
- [ ] wails dev 重启，确认 wailsjs 已生成 OpenBook 与 BookData 类型
- [ ] 前端新增 utils/appError.ts（错误码解析，参考附录 A.2）
- [ ] App.tsx：工具栏按钮 + 调用 OpenBook + 错误状态；BookViewer 按 format 分派；TextViewer 用 <pre> 显示
- [ ] styles.css 增加 .txt-viewer（按原文档 8.5）
- [ ] 错误条组件：可关闭，显示 message

验证门槛（全部满足才进 M2）：

| # | 验证 | 预期 |
|---|---|---|
| 1 | 打开 UTF-8 中文 TXT | 正常显示，换行保留 |
| 2 | 打开 GBK 编码 TXT（样本见 8.3） | 无乱码 |
| 3 | 对话框取消 | 无任何提示、无控制台报错 |
| 4 | 选 .mobi 文件（对话框切"所有文件"） | 错误条显示"暂不支持 .mobi 格式"类信息 |
| 5 | 确认取消时 OpenBook 解析结果为 null | 前端不进入分派 |

回退建议：绑定未生成 → 检查 wails.json 与 frontend 目录名约定；对话框不弹 → 检查 startup 中 ctx 赋值。

### M2 PDF 显示

步骤清单：

- [ ] app.go：OpenBook 增加 epub/pdf 分支（Base64）与 100MB 大小检查（注意先判格式再读文件，偏差 D1）
- [ ] PdfViewer.tsx：worker 配置（主选附录 A.3 方案 A）
- [ ] 上一页 / 下一页 / 页码（x / N），页码钳制在 [1, numPages]
- [ ] 默认 scale 1.2；窗口 resize 重渲当前页
- [ ] 翻页竞态：切换页面前取消未完成的 renderTask
- [ ] 解析失败统一走 PARSE_FAILED 文案

验证门槛：

| # | 验证 | 预期 |
|---|---|---|
| 1 | 小型单页 PDF | 正常渲染 |
| 2 | 多页 PDF 翻页 | 正常；边界页不越界 |
| 3 | 控制台 | 无 worker 加载失败 / fake worker 告警 |
| 4 | ~30MB PDF | 可打开，记录任务管理器内存数值（验证原文档 Base64 翻倍风险的实测基线） |
| 5 | 非 PDF 改名 .pdf | 显示解析失败提示，不崩溃、不白屏卡死 |

回退建议：worker 失败 → 切换附录 A.3 方案 B；中文缺字/方框 → 启用 F1（cMapUrl/standardFontDataUrl，见 7.2）。

### M3 EPUB 显示

步骤清单：

- [ ] EpubViewer.tsx：base64ToUint8Array → ePub(bytes.buffer) → renderTo(flow: "scrolled-doc")
- [ ] 目录侧边栏：book.loaded.navigation 取一级目录，点击 rendition.display(href)
- [ ] useEffect cleanup 中 epubBook.destroy()；unmount 后不再 setState
- [ ] 窗口 resize 调 rendition.resize
- [ ] 解析失败显示"EPUB 解析失败，请确认文件未加密或损坏"

验证门槛：

| # | 验证 | 预期 |
|---|---|---|
| 1 | 无目录 EPUB | 正文正常滚动显示 |
| 2 | 带目录 EPUB | 侧边栏一级目录可点击跳转 |
| 3 | 反复打开/切换 10 次 | 内存曲线平稳，无累积 |
| 4 | 加密 EPUB | 明确错误提示（预期走 PARSE_FAILED 文案） |
| 5 | 容器高度 | iframe 内容不出现无限拉高/空白 |

回退建议：iframe 空白 → 检查容器显式高度与 CSS；目录为空 → 该文件无 nav 或结构异常，降级为隐藏侧边栏，不报错。

### M4 错误与边界收尾

- [ ] 错误码按 5.2 表全覆盖；未知错误落入 UNKNOWN 并展示原文
- [ ] 100MB 边界行为与原文档一致：严格大于才拒绝（恰好 100MB 放行），并在测试矩阵留证（A11）
- [ ] 空 TXT：显示空白不报错；0 页/损坏 PDF：解析失败文案
- [ ] 错误条不阻塞主流程，可关闭

验证门槛：第 8 章错误相关行全部通过。

### M5 打包与净机验证

- [ ] `wails build -platform windows/amd64`
- [ ] 确认产物 build/bin/book-editor.exe，记录文件大小（预期 10MB 量级）
- [ ] 在未安装 Go/Node 的 Windows 环境（干净虚拟机或同机其他用户）双击启动
- [ ] 净机最小集复验：启动 → 打开 TXT/PDF/EPUB → 取消 → 错误提示
- [ ] 关闭窗口后任务管理器确认进程退出

### M6 验收

按第 8 章矩阵逐条执行并记录结果（通过/失败/备注），作为 v0.1.0 验收依据。任何失败项修复后回归全量矩阵，不接受抽样通过。

---

## 5. 接口与错误契约（落地口径）

### 5.1 BookData

与原文档 7.1 一致；前端对应 TS 类型由 wailsjs/models.ts 自动生成，禁止手写重复定义。

| 字段 | json tag | 类型 | 填充条件 | 前端消费点 |
|---|---|---|---|---|
| Name | name | string | 总是 | 工具栏标题 |
| Path | path | string | 总是 | Viewer key（强制重挂载） |
| Format | format | string | 总是：epub/pdf/txt | BookViewer 分派 |
| Size | size | number | 总是 | 信息展示/调试 |
| DataBase64 | dataBase64 | string | epub/pdf | EpubViewer/PdfViewer |
| Text | text | string | txt | TextViewer |

### 5.2 错误码与传递机制

**机制（重要）**：Wails v2 桥接层将 Go 返回的 error 以其 Error() 字符串形式 reject 给前端；原文档的 AppError 是前端展示结构，Go 侧没有结构化错误类型。落地采用 **"CODE: message" 前缀约定**：Go 用 fmt.Errorf("CODE: ...") 产出，前端用统一函数解析（偏差 D2）。好处是零额外依赖；代价是需维护解析函数，且新错误码必须同步 5.2 表。

| code | 含义 | Go 产生点 | 前端表现 |
|---|---|---|---|
| USER_CANCELED | 用户取消 | 不产生（返回 nil, nil） | 静默 |
| FILE_NOT_FOUND | 文件不存在/无权限 | os.Stat 失败 | 错误条 |
| FILE_TOO_LARGE | 超过 100MB | 大小检查 | 错误条 |
| UNSUPPORTED_FORMAT | 格式不支持 | 扩展名 switch | 错误条（含"暂不支持"字样） |
| READ_FAILED | 读取失败（含对话框异常） | os.ReadFile / OpenFileDialog | 错误条 |
| PARSE_FAILED | 前端解析失败 | 前端 catch（epub.js/pdf.js） | 错误条（按格式给对应文案） |
| UNKNOWN | 兜底 | 前端解析失败时 | 错误条显示原文 |

### 5.3 用户取消语义

OpenBook 取消时返回 (nil, nil)，前端得到 null：不提示、不分派、不清空当前已打开图书。此行为须在 M1 验证门槛 #5 实证（不同 Wails 小版本对 nil 指针的序列化行为以实测为准）。

---

## 6. 分文件实施清单

| 文件 | 职责 | 必须包含 | 完成判据 |
|---|---|---|---|
| app.go | Go 绑定层 | BookData、OpenBook、decodeText、maxBookSize 常量 | 错误码前缀与 5.2 一致；先判格式后读文件 |
| main.go | 入口 | embed assets、wails.Run、Bind、窗口参数 | 双击 exe 出现 1280×860 窗口 |
| wails.json | 构建配置 | name/outputfilename=book-editor | build 产物名正确 |
| frontend/src/main.tsx | 挂载 | 模板默认 + styles.css 引入 | 页面无样式缺失 |
| frontend/src/App.tsx | 编排 | 打开按钮、book/error/loading 状态、错误条挂载 | 取消/错误/正常三态行为正确 |
| components/Toolbar.tsx | 工具栏 | "打开图书"按钮、当前书名 | 点击触发 OpenBook |
| components/BookViewer.tsx | 分派 | format → Viewer；key={path+size} 强制重挂载 | 切换图书旧实例被销毁 |
| components/EpubViewer.tsx | EPUB | renderTo scrolled-doc、目录侧栏、destroy | M3 Gate 全过 |
| components/PdfViewer.tsx | PDF | worker、翻页、钳制、resize 重渲 | M2 Gate 全过 |
| components/TextViewer.tsx | TXT | <pre className="txt-viewer"> | 换行/中文正常 |
| utils/base64.ts | 工具 | base64ToUint8Array（原文档 8.2） | PDF/EPUB 取数正确 |
| utils/appError.ts | 工具 | toAppError 解析（附录 A.2） | 各错误码解析正确 |
| styles.css | 样式 | .txt-viewer、错误条、侧边栏、容器高度 | EPUB/PDF 容器有显式高度 |
| frontend/wailsjs/ | 生成物 | — | 每次改 Go 后确认已重新生成；不手改 |

---

## 7. 渲染层要点与坑位

### 7.1 TXT

- Go 侧解码链：utf8.Valid → 直接转字符串；否则 GBK；再失败按 UTF-8 替换非法字符（原文档口径）。
- 建议去 BOM：UTF-8 文件首字节 EF BB BF 会以不可见 U+FEFF 进入文本，建议 TrimPrefix 去除（偏差 D7，建议采纳）。
- 已知限制：UTF-16 编码 TXT（BOM FF FE）会先判 UTF-8 失败、再被 GBK"成功解码"为乱码。原文档未覆盖，记录为已知限制；v0.2 可加 BOM 探测分流。
- 前端 <pre> + white-space: pre-wrap（原文档 8.5）。

### 7.2 PDF

- **worker 两种装法**：
  - 方案 A（主选）：`GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()`，由 Vite 打包时解析。
  - 方案 B（备选）：将 node_modules/pdfjs-dist/build/pdf.worker.min.mjs 拷到 frontend/public/，设 workerSrc = "/pdf.worker.min.mjs"。public/ 内容会原样进入 dist，经 Wails 资源服务器提供。
  - 判据：控制台无 "No GlobalWorkerOptions.workerSrc" 警告与 worker 404；打包态（M5）重点复查。
- 版本差异：v3 worker 为 pdf.worker.min.js，v4+ 为 .mjs；以 `ls node_modules/pdfjs-dist/build` 为准，不要凭记忆写死。
- **v6 API 修正（2026-10-19 编码期实测，偏差 D13）**：pdfjs-dist 6.x 中 `page.render()` 的类型要求传入 `canvas`（元素）而非 `canvasContext`；PDF 文档清理方法为 `cleanup()`，`destroy()` 在 v6 类型中已移除。原文档 8.4 与本文档附录 A.3 中 `canvasContext` 写法在 v6 下无法通过类型检查，实施时以 `page.render({ canvas, viewport })` 与 `pdf.cleanup()` 为准；原文档 8.4 的回写留待验收后（T902）。
- 翻页竞态：保存上一 renderTask，切页时 task.cancel() 后再渲染新页，避免快速翻页花屏。
- CJK 缺字（条件启用 F1）：部分中文 PDF 未内嵌字体时需要 cmap。按需给 getDocument 传 cMapUrl / standardFontDataUrl（路径以包内实际目录为准，如 node_modules/pdfjs-dist/cmaps）。初版验收样本若全部正常则不必开启。
- 安全：保持版本较新（CVE-2024-4367 类问题已在 4.2.67+ 修复）；如需收紧可显式 isEvalSupported: false。
- 清晰度（可选，v0.1 可跳过）：scale 乘 devicePixelRatio 后用 CSS 缩回显示尺寸。

### 7.3 EPUB

- ArrayBuffer 直传 ePub()；jszip 为 epubjs 依赖，npm 安装时自动装入，无需单独安装。
- flow: "scrolled-doc"；渲染容器必须有显式高度（CSS 100%）。
- 目录：await book.loaded.navigation 后取 toc（label/href），点击 rendition.display(href)。无目录文件降级隐藏侧边栏。
- 卸载：useEffect cleanup 调 book.destroy()；unmount 后禁止 setState（ignored 标记）。
- **epubjs 挂起行为与超时兜底（2026-10-19 测试期实测，偏差 D15）**：epubjs 0.3.93 对非 zip 数据（如 txt 改名 .epub）时，`book.opened` 与 `rendition.display()` **既不 resolve 也不 reject**（Node 侧以最小 DOM 垫片复现确认），若无兜底会白屏且无任何提示，违反 A13。落地实现：`rendition.display()` 与 `book.loaded.navigation` 均包 10s 超时（`Promise.race`），超时按解析失败处理（显示"EPUB 解析失败…"并销毁实例）。副作用：正常书籍打开耗时远小于 10s；若个别超大 EPUB 打开超过 10s 会被误判失败，记为已知限制（v0.2 可改进度提示 + 手动取消）。
- **effect 依赖稳定性（2026-10-19 测试期修复）**：目录联动回调（onChapterChange）若直接进入 useEffect 依赖，父组件每次渲染传入的新函数引用都会导致 effect 重跑（书籍被销毁重建、目录状态重置、状态栏联动循环）。实现以 ref 持有最新回调，effect 只依赖 dataBase64。
- 安全澄清：epub.js 默认以 sandbox iframe 渲染且禁用脚本内容（allowScriptedContent 默认 false）。原文档风险条目"EPUB 安全/后续加 sandbox"在库层面已有默认缓解，初版不额外处理，交互式 EPUB 不开启 allowScriptedContent（偏差记录 D9，澄清性质）。

---

## 8. 验收测试矩阵

### 8.1 场景矩阵（对应原文档第 10 章）

| # | 场景 | 操作 | 预期 | 原文档条款 |
|---|---|---|---|---|
| A01 | 启动 | 双击 exe | 窗口出现，无报错弹窗 | 10.1 |
| A02 | 文件对话框 | 点"打开图书" | 弹出 Windows 选择框，过滤器含电子书/所有文件 | 10.2 |
| A03 | EPUB 正文 | 打开 .epub | 显示正文内容 | 10.3 |
| A04 | PDF 翻页 | 打开 .pdf | 显示第一页；上/下页正常，页码正确 | 10.4 |
| A05 | TXT UTF-8 | 打开 UTF-8 中文 txt | 正常不乱码 | 10.5 |
| A06 | TXT GBK | 打开 GBK txt | 正常不乱码 | 10.5 |
| A07 | MOBI 拒绝 | 选 .mobi | 提示"暂不支持" | 10.6 |
| A08 | AZW3 拒绝 | 选 .azw3 | 提示"暂不支持" | 10.6 |
| A09 | 取消 | 对话框取消 | 无错误弹窗、无提示 | 10.7 |
| A10 | 超大文件 | 打开 >100MB 文件 | 提示文件过大 | 10.8 |
| A11 | 边界大小 | 打开恰好 100MB 文件 | 不出现 FILE_TOO_LARGE（后续按内容解析） | 10.8 边界 |
| A12 | 损坏 PDF | txt 改名 .pdf 打开 | 解析失败提示，不崩溃 | 6.5 |
| A13 | 损坏 EPUB | txt 改名 .epub 打开 | "EPUB 解析失败…"提示 | 6.2 |
| A14 | 空 TXT | 打开 0 字节 txt | 空白显示，不报错 | — |
| A15 | 进程退出 | 关闭窗口 | 任务管理器无残留进程 | 10.9 |
| A16 | 净机运行 | 无 Go/Node 机器运行 exe | 功能最小集可用（需 WebView2） | 10.10 |
| A17 | 性能基线 | 打开 ~30MB PDF | 可打开；记录内存数值备查 | 11 |
| A18 | 目录跳转 | 打开带目录 EPUB | 一级目录可跳转 | 6.2 |

备注：A12/A13 依赖制造损坏样本（见 8.3）；"文件不存在/无权限"路径由代码层覆盖（os.Stat → FILE_NOT_FOUND），时序难以手工复现，不单列验收行，M4 代码审查确认。

### 8.2 结果记录

验收时按上表逐行记录：通过 / 失败（附现象）/ 跳过（附理由）。失败项修复后全量回归。

### 8.3 测试样本制备命令

```bash
# GBK 编码中文样本（PowerShell，码页 936）
$enc = [System.Text.Encoding]::GetEncoding(936)
[System.IO.File]::WriteAllText("$env:USERPROFILE\Desktop\gbk-sample.txt", "中文GBK编码测试。`r`n第二行。", $enc)

# 带 BOM 的 UTF-8 样本
[System.IO.File]::WriteAllText("$env:USERPROFILE\Desktop\utf8bom-sample.txt", "中文UTF-8 BOM测试。", (New-Object System.Text.UTF8Encoding($true)))

# 恰好 100MB（104857600 字节）与 100MB+1 样本（免提权，NTFS 下瞬间完成）
$f = [System.IO.File]::Create("$env:USERPROFILE\Desktop\exact-100mb.pdf"); $f.SetLength(104857600); $f.Close()
$g = [System.IO.File]::Create("$env:USERPROFILE\Desktop\over-100mb.pdf"); $g.SetLength(104857601); $g.Close()

# 损坏 PDF / EPUB 样本
Copy-Item "$env:USERPROFILE\Desktop\gbk-sample.txt" "$env:USERPROFILE\Desktop\broken.pdf"
Copy-Item "$env:USERPROFILE\Desktop\gbk-sample.txt" "$env:USERPROFILE\Desktop\broken.epub"

# WebView2 Runtime 检测（有输出即已安装；两个注册表视图都可查）
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv
reg query "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv
```

---

## 9. 风险与应对（落地侧补充）

| 风险 | 影响 | 落地应对 | 状态 |
|---|---|---|---|
| Base64 内存翻倍（原文档） | 大文件内存峰值约 2 倍+ | A17 实测 30MB 基线；超限即收紧或改协议 | 已设验证门 |
| 100MB 上限（原文档） | 大书不可用 | 初版保持；挂点见第 11 章 | 接受 |
| worker 打包态加载失败 | PDF 不可用 | 方案 A/B 双路径 + M5 净机复查 | 已设回退 |
| pdfjs-dist 大版本差异 | API/文件名不匹配 | 锁主版本 + 安装后 ls build 目录核对 | 已设核对 |
| Go/Node 版本要求上调 | 环境装错 | 第 2 章核对命令先行（D8） | 已设核对 |
| UTF-16 TXT 乱码 | 少数文本不可读 | 记录已知限制；v0.2 BOM 探测 | 已知限制 |
| 中文 PDF 缺 cmap | 文字方框/缺失 | F1 条件启用（7.2） | 条件回退 |
| WebView2 缺失（原文档） | 旧机器无法运行 | 8.3 检测命令；v0.2 NSIS 引导 | 已设检测 |
| EPUB 脚本安全（原文档） | 恶意内容 | 库默认 sandbox + 禁脚本，澄清无需额外处理（D9） | 澄清 |
| DRM 文件（原文档） | 无法解析 | 明确提示，不尝试绕过（与原文档一致） | 接受 |

---

## 10. 与原文档的偏差记录

| # | 原文档口径 | 落地处理 | 原因 | 影响 | 状态 |
|---|---|---|---|---|---|
| D1 | 先 os.ReadFile 再按扩展名分支 | 先判扩展名，不支持直接返回 | 避免为 .mobi 等读取上百 MB 后才拒绝 | 无功能影响 | 采纳 |
| D2 | Go 错误以 code/message 结构描述（前端 AppError） | Go 用 "CODE: message" 前缀，前端统一解析 | Wails v2 桥接仅传 error 字符串 | 需维护解析函数 | 采纳 |
| D3 | worker 仅 new URL 一种装法 | 增加 public/ 静态拷贝备选 | 打包态模块 worker 加载存在不确定性 | 无 | 采纳 |
| D4 | 未指定 pdfjs-dist 版本 | 锁定主版本（当前 ^6，worker 为 build/pdf.worker.min.mjs） | v3/v4+ worker 文件名不同 | 无 | 采纳 |
| D5 | 未指定 epubjs 版本 | 锁定 0.3.93 | 0.3.x 为唯一活跃线 | 无 | 采纳 |
| D6 | 未定义窗口尺寸（模板默认 1024×768） | 1280×860 + 最小 900×600 | 阅读器可用性 | 无 | 采纳 |
| D7 | 未提及 UTF-8 BOM | 建议 TrimPrefix 去 U+FEFF | 避免首行不可见字符 | 无 | 建议采纳 |
| D8 | Go 1.22+ / Node 20+ | Go ≥1.25 / Node ≥22.13 | Wails v2.16+ go.mod 与 pdfjs-dist 6.x engines 要求 | 需核对本机环境 | 采纳 |
| D9 | 风险条目列"EPUB 安全→后续加 iframe sandbox" | 澄清：epub.js 默认 sandbox 且禁脚本 | 库默认行为已覆盖该风险 | 无 | 澄清 |
| D10 | 错误码表未含 UNKNOWN | 增加 UNKNOWN 兜底 | 桥接层可能带回非约定格式错误 | 无 | 采纳 |
| D15 | 6.2：EPUB 解析失败时显示提示（隐含"库会报错"） | display()/navigation 包 10s 超时，超时按解析失败处理 | epubjs 0.3.93 对损坏数据永久挂起（不 resolve 不 reject），无超时则白屏无提示 | 超大 EPUB 打开 >10s 有误判风险（已知限制） | 采纳（测试期发现） |

---

## 11. 后续迭代挂点（v0.2+）

| 方向 | 初版预留的挂点 |
|---|---|
| 替换 Base64 传输 | OpenBook 内部实现 + 前端取数方式（utils/base64.ts）整体可替换 |
| 最近打开/进度持久化 | Go 侧 os.UserConfigDir 建配置目录；BookData 已带 Path/Name |
| MOBI/AZW3 | 格式分支扩展点（OpenBook switch 与 BookViewer 分派） |
| NSIS 安装包 | wails build -nsis + WebView2 检测引导 |
| 主题/字号 | styles.css 变量化预留 |

---

## 附录 A 参考实现片段

> 以下片段为落地参考，按第 6 章清单落位到对应文件；本文档不构成对项目代码的修改，实施时可在此基础上调整。

### A.1 app.go（含 D1/D2/D7 处理）

```go
package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const maxBookSize = 100 * 1024 * 1024

type BookData struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Format     string `json:"format"` // epub | pdf | txt
	Size       int64  `json:"size"`
	DataBase64 string `json:"dataBase64,omitempty"` // epub/pdf
	Text       string `json:"text,omitempty"`       // txt
}

type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// OpenBook 弹出文件选择框并读取图书；用户取消返回 (nil, nil)。
func (a *App) OpenBook() (*BookData, error) {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择图书",
		Filters: []runtime.FileFilter{
			{DisplayName: "电子书 (*.epub;*.pdf;*.txt)", Pattern: "*.epub;*.pdf;*.txt"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("READ_FAILED: 打开文件对话框失败: %w", err)
	}
	if selection == "" {
		return nil, nil
	}

	// D1: 先判格式，不支持直接拒绝，不读取文件内容
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(selection), "."))
	switch ext {
	case "epub", "pdf", "txt":
	default:
		return nil, fmt.Errorf("UNSUPPORTED_FORMAT: 暂不支持 .%s 格式", ext)
	}

	info, err := os.Stat(selection)
	if err != nil {
		return nil, fmt.Errorf("FILE_NOT_FOUND: %w", err)
	}
	if info.Size() > maxBookSize {
		return nil, fmt.Errorf("FILE_TOO_LARGE: 文件超过 100MB 限制")
	}

	data, err := os.ReadFile(selection)
	if err != nil {
		return nil, fmt.Errorf("READ_FAILED: %w", err)
	}

	book := &BookData{
		Name:   filepath.Base(selection),
		Path:   selection,
		Format: ext,
		Size:   info.Size(),
	}
	switch ext {
	case "epub", "pdf":
		book.DataBase64 = base64.StdEncoding.EncodeToString(data)
	case "txt":
		book.Text = decodeText(data)
	}
	return book, nil
}

func decodeText(data []byte) string {
	if utf8.Valid(data) {
		// D7: 去掉 UTF-8 BOM
		return strings.TrimPrefix(string(data), "\uFEFF")
	}
	if out, err := simplifiedchinese.GBK.NewDecoder().Bytes(data); err == nil {
		return string(out)
	}
	return strings.ToValidUTF8(string(data), "\uFFFD")
}
```

### A.2 utils/appError.ts

```ts
export type AppError = { code: string; message: string };

// Wails v2 将 Go error 以字符串形式 reject，按 "CODE: message" 前缀解析
export function toAppError(e: unknown): AppError {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const m = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(raw.trim());
  return m ? { code: m[1], message: m[2].trim() } : { code: "UNKNOWN", message: raw };
}
```

### A.3 PdfViewer worker 配置

```ts
import * as pdfjsLib from "pdfjs-dist";

// 方案 A（主选）：Vite 打包期解析；文件名以 ls node_modules/pdfjs-dist/build 为准
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// 方案 B（备选）：worker 拷至 frontend/public/pdf.worker.min.mjs 后改用
// pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```

### A.4 App/BookViewer 结构骨架

```tsx
// App.tsx 要点：三态（book / error / loading）+ 取消静默 + 错误条可关闭
// BookViewer 要点：按 format 分派；key 用 path+size 强制重挂载以销毁旧实例
const open = async () => {
  setError(null);
  try {
    const b = await OpenBook();
    if (!b) return; // 用户取消
    setBook(b);
  } catch (e) {
    const err = toAppError(e);
    if (err.code !== "USER_CANCELED") setError(err);
  }
};
```
