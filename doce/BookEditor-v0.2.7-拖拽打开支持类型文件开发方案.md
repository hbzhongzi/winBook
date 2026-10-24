# BookEditor v0.2.7 拖拽打开「支持类型」文件 开发方案

> 版本：v0.2.7（候选，待确认）　起草：2026-10-22　来源：用户需求「支持符合类型的文件拖拽打开」
> 上位文档：`doce/BookEditor-v0.1.0-整合项目文档.md`（事实入口）；参考 `BookEditor-v0.2.6-翻页按钮显隐优化落地说明文档.md`（本版沿用其数据契约/验收表格式）

## 1. 范围

**目标**：用户从文件管理器（资源管理器）把文件拖入应用窗口任意位置，若文件属于本工具支持的类型（EPUB / PDF / TXT），则直接打开（替换当前书，沿用既有「打开即恢复位置」语义）；若类型不支持，给出与「对话框打开不支持文件」完全一致的拒绝反馈，不加载、不崩溃。

**纳入**：
- 窗口级拖放监听（整个客户区，不仅限于工具栏/书架按钮）。
- 拖入文件的类型校验，仅放行 `epub/pdf/txt`。
- 拖入时复用既有 `handleOpen` 打开链路（含位置恢复、书架条目更新、加载遮罩、标题更新、错误条）。
- 多文件拖入的明确策略（仅打开第一个，忽略其余并提示）。

**不纳入（本期不做，留待后续）**：
- 拖入高亮/拖拽落点视觉反馈（见 D54）。
- 文件夹拖入（仅放行普通文件；目录落入走既有 `READ_FAILED` 兜底）。
- 多书标签/分屏同时打开（仍单本替换）。
- 拖入图片/字体等素材导入（非图书类型）。

## 2. 现状梳理（据 code 实测）

- 支持类型唯一真相在 Go 侧 `app.go` `openBookAt`：`switch ext { case "epub","pdf","txt": default: UNSUPPORTED_FORMAT }`（app.go:77-82）。前端无对应常量。
- 打开统一入口 `handleOpen(path?)`（App.tsx:203）：`flushCurrent()` → `OpenBookPath(path)` 或 `OpenBook()` → 成功 `setBook` + 书架 `savePosition` + 标题；失败 `setError(toAppError(e))`（`UNSUPPORTED_FORMAT`/`FILE_TOO_LARGE`/`FILE_NOT_FOUND` 等已由 ErrorBar 接管，App.tsx:249-254）。
- Wails v2 拖放为前端驱动：`window.runtime.OnFileDrop(cb, useDropTarget)` / `OnFileDropOff()`（已生成于 `frontend/wailsjs/runtime/runtime.{d.ts,js}`）。**经 Wails v2.16.0 源码核实（`internal/frontend/runtime/desktop/draganddrop.js`）**：`useDropTarget=true` 并非「整窗接管」，而是「仅当落点元素的计算样式含 `--wails-drop-target: drop` 时才回调」；且无论何值，路径解析均受 Go 侧 `DragAndDrop.EnableFileDrop` 门控（未开启时 Go 直接丢弃 `file:drop:` 消息，拖放整体失效）。
- 本应用为单主窗口、单本书模型，拖放目标应为整窗，与 `useDropTarget=true` 天然契合。

## 3. 方案设计

### 3.1 注册与注销
在 `App` 组件挂载期一次性注册，卸载期注销，避免重复监听/泄漏：

```ts
useEffect(() => {
  OnFileDrop((_x: number, _y: number, paths: string[]) => {
    void handleDrop(paths);
  }, false);           // useDropTarget=false：跳过 --wails-drop-target 元素检查，整窗可落
  return () => OnFileDropOff();
}, [handleDrop]);
```

`handleDrop` 依赖 `handleOpen`/`loading`，用 `useCallback` 包裹保持引用稳定（与既有 `handleOpen` 同风格）。

### 3.2 落点处理（handleDrop）
```
1. 若 loading 为 true（正在打开另一本）→ 直接忽略，避免竞态。
2. 取 paths[0]；paths.length>1 → 记一条「仅打开第一个，多余文件已忽略」轻提示（app-toast）。
3. 扩展名校验（见 §4 单源策略）：
   - 不支持 → 直接 setError(toAppError("UNSUPPORTED_FORMAT: 暂不支持 .xxx 格式"))，
     不走 loading/busy 闪烁，反馈与对话框打开不支持文件完全一致。
   - 支持   → handleOpen(paths[0])（复用 flushCurrent + 加载遮罩 + 标题 + 错误条）。
```

> 不预先 `setLoading` 再报错：类型不支持是「用户操作即时拒绝」，用 ErrorBar 直出更干净；只有真正进入打开流程才显示 busy 遮罩。

### 3.3 与既有打开链路的咬合
- 替换当前书：`handleOpen` 内部 `flushCurrent()` 已落当前书位置，再 `setBook` 替换，无需额外处理。
- 从书架态拖入（当前无书）：`handleOpen` 直接 `setBook`，正常打开。
- 设置面板打开时拖入：建议忽略（设置面板为模态语义），在 `handleDrop` 开头判 `settingsOpen` 则 return（细化项，可在实现时加；若不加则落到底层仍能打开，不致命）。

## 4. 数据契约与单源策略

**支持扩展名**当前是 Go 内联 `"epub","pdf","txt"`。为避免前后端双份漂移，二选一：

- **方案 A（推荐）**：新增 Go 绑定 `SupportedExts() []string`，前端 `OnFileDrop` 前先 `await SupportedExts()` 取白名单做校验；Go `openBookAt` 仍为真校验守门。单源、零漂移。代价：多一个绑定 + 一次异步。
- **方案 B（轻量）**：前端新增常量 `SUPPORTED_EXTS = ["epub","pdf","txt"]`，注释强约束「必须与 app.go openBookAt 的 switch 保持一致」；不新增绑定。代价：需人工同步。

本方案默认 **方案 A**（单源），实现若求快可降级为 B。两种情况下，最终真校验永远在 Go `openBookAt`（前端校验仅用于「即时拒绝、不闪 loading」）。

## 5. 逐文件实现（已实施，2026-10-22）

| 文件 | 改动 |
|---|---|
| `app.go` | 新增绑定 `func (a *App) SupportedExts() []string { return []string{"epub","pdf","txt"} }`（方案 A 单源）；`Bind` 已含 `app`，`main.go` 无需改。 |
| `frontend/wailsjs/go/main/App.{d.ts,js}` | `wails build` 重新生成，含 `SupportedExts()`（落地时先行手补以保证 tsc 通过）。 |
| `frontend/src/utils/dropOpen.ts`（新增） | 纯函数 `extOf(name)` / `isSupportedExt(name, allowed)`，供单测与 `handleDrop` 复用。 |
| `frontend/src/utils/__tests__/dropOpen.test.ts`（新增） | `extOf` / `isSupportedExt` 单测（5 例，114/114 全集内）。 |
| `frontend/src/App.tsx` | import `OnFileDrop, OnFileDropOff, SupportedExts` + `isSupportedExt, extOf`；新增 `showDropHint`（复用 `.app-toast`，2.6s 自消）；新增 `handleDrop`（取 paths[0]，loading 中忽略、多文件轻提示、白名单外即时 `setError(UNSUPPORTED_FORMAT)`、白名单内复用 `handleOpen`）；`useEffect` 挂载 `OnFileDrop(cb, true)` / 卸载 `OnFileDropOff()`；JSX 渲染 `dropHint` 轻提示。 |
| `frontend/src/styles.css` | 本期不加拖入高亮（见 D54）；`.app-toast` 既有样式直接复用。 |

> `main.go` 无需改动：Wails v2 拖放为前端驱动，无 Go 侧 `OnFileDrop` 选项。

## 6. 验收映射（A71–A74）

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A71 | 拖入 .epub/.pdf/.txt 于窗口任意位置 → 打开该书（替换当前） | `isSupportedExt` 单测 + 手动真机 | 代码落地，待真机 |
| A72 | 拖入不支持类型（.mobi/.zip/.png）→ ErrorBar 显示「暂不支持 .x 格式」，不加载不崩溃 | 手动真机 | 代码落地，待真机 |
| A73 | 拖入多个文件 → 仅打开第一个，其余忽略并轻提示 | 手动真机 | 代码落地，待真机 |
| A74 | 拖入时若正在加载另一本 → 忽略，无竞态/无重复打开 | 手动真机（快速连拖） | 代码落地，待真机 |

> 自动化说明：OS 级拖放（SendInput 模拟 CF_HDROP）在 e2e 中复杂且易碎，本期**不纳入** `verify_*.py` 自动门禁；以「`isSupportedExt` 单测 + 手动真机」覆盖。若后续需要，可于 `driver.py` 增 `drag_files()` 封装（最佳努力）。

## 7. 偏差与风险（已落实验收）

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D54 | 拖入时显示自定义高亮 | **修订**：`useDropTarget` 最终改为 `false`（回调不再经 `--wails-drop-target` 元素检查，任何位置落下都触发）；整窗即放置目标，无自绘高亮（系统复制光标） | 初版误以为 `useDropTarget=true` 是「整窗接管」开关；实为「仅回调落在带 CSS 标记元素上的放置」，且不设置标记时行为不变 |
| D55 | 支持类型单一真相 | **已消解（方案 A）**：新增 Go 绑定 `SupportedExts()`，前端 `handleDrop` 异步取白名单校验，真守门仍在 Go `openBookAt` | 前后端同源、零漂移 |
| D56 | 前端 `OnFileDrop` 即可启用拖放 | **真机反馈修复（拖入变下载）**：Wails v2 还需 Go 侧 `options.DragAndDrop{EnableFileDrop: true}`，否则 `window.wails.flags.enableWailsDragAndDrop` 恒为 false，`file:drop:` 消息被 Go 丢弃、`wails:file-drop` 事件不存在，WebView2 默认行为把文件当下载处理 | `main.go` 已加 `DragAndDrop` 配置；前端另加自兜底 `dragover/drop` preventDefault（拦截 `types` 含 `Files` 的外部拖放），即使 Wails 监听缺席也杜绝导航/下载 |
| D57 | 打开文件快捷键 | **真机反馈修复**：原实现无 Ctrl+O 绑定，WebView2 默认加速键接管并弹出浏览器级「打开文件」（文件被载入 webview，行为错误）；现已前端拦截 Ctrl/Cmd+O → `handleOpen()`，欢迎页可用，设置面板打开时不劫键 | Wails v2 未暴露 `AreBrowserAcceleratorKeysEnabled`，JS 侧 preventDefault 为唯一手段 |
| D58 | 书架三列等宽（v0.2.1 既有缺陷，随本轮真机反馈修复） | `.shelf-grid` 由 `repeat(3, 1fr)` 改 `repeat(3, minmax(0, 1fr))`，`.shelf-card` 补 `min-width: 0`；窄窗两列断点同步 | 裸 `1fr` 轨道最小尺寸为 `auto`，长书名（nowrap）把内容最小宽度传导给轨道 → 首列被撑宽、三列不等宽 |

## 8. 实施顺序建议

1. `app.go` 加 `SupportedExts()`（方案 A）/ 或前端常量（方案 B）。
2. 新增 `dropOpen.ts` 的 `isSupportedExt` + 单测。
3. `App.tsx` 接 `OnFileDrop`/`OnFileDropOff` + `handleDrop`。
4. `tsc --noEmit` + `vitest` 跑绿；`wails build`。
5. 手动真机按 A71–A74 验收；回填验收表与偏差 D54/D55。

## 9. 不在本轮（后续增强候选）

- 拖入高亮/落点预览（D54 解法延伸）。
- 拖入目录 → 自动挑其中首个支持文件打开。
- 多文件分标签/书架批量入架（非即时打开）。
- 拖入图片/字体作为当前书素材（需产品定义）。
