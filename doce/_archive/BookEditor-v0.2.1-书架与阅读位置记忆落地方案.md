# BookEditor v0.2.1 书架与阅读位置记忆落地方案

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 更新日期 | 2026-10-20 |
| 上位文档 | `doce/BookEditor-v0.2.0-个性化功能落地方案.md`（P1 之 F5 的展开） |
| 设计基线 | `doce/BookEditor-前端界面示例.html`（书架部分已随设计更新） |
| 关联文档 | `doce/BookEditor-v0.1.0-整合项目文档.md`、`doce/BookEditor-v0.2.0-个性化功能落地说明文档.md`、`doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md` |
| 本版范围 | G1 书架（最近阅读记录）、G2 退出位置记忆、G3 打开时位置恢复 |
| 状态 | 已实施（smoke_shelf 13/13 + A27–A31 验证通过；A29 按 2026-10-20 用户确认改章节级口径，见落地说明文档 D32） |

## 1. 背景与目标

v0.2.0 P0（阅读主题、强调色、正文字号、预加载增强）已落地并通过冒烟。其方案中的 P1 功能 F5「阅读位置记忆」目前以设置面板里的禁用开关占位；整合文档 1.2 亦把「书架、最近阅读记录和阅读进度持久化」列在范围外。

用户提出新需求：**增加书架记录，能够记录退出时的阅读位置**。本方案将其展开为可实施的迭代。

目标约束（沿用个性化功能既定原则）：

- 全部数据本地持久化，不上传、不联网；
- 每本书独立记录，重复打开同一本书不产生重复条目；
- 从书架点一下就能续读，不需要再走文件选择框；
- 不允许破坏现有 EPUB 连续滚动 + 章节窗口化渲染（该模块有未修复缺陷，见第 7 章风险）。

## 2. 功能清单

| 编号 | 功能 | 生效范围 | 说明 |
|---|---|---|---|
| G1 | 书架（最近阅读） | 全局 | 记录打开过的每本书；欢迎页展示卡片列表，点击续读、可移除、可清空 |
| G2 | 退出位置记忆 | EPUB / PDF / TXT | 阅读位置定时快照 + 退出/切书时落库 |
| G3 | 打开恢复 | EPUB / PDF / TXT | 从书架打开时恢复到退出时的位置 |
| G4 | 目录侧栏记忆（可选） | EPUB | 侧栏展开/收起状态持久化，即 v0.2.0 方案的 F7，成本极低，顺手做 |

## 3. 数据模型

### 3.1 存储契约

新增 localStorage 键 `bookeditor.library.v1`（与 `bookeditor.settings.v2` 同级，风格一致）：

```json
{
  "version": 1,
  "entries": [ /* LibraryEntry[]，按 lastOpen 倒序 */ ]
}
```

选型理由见 4.1。多实例场景经 `storage` 事件同步（与设置的订阅机制同思路）。

### 3.2 条目结构

```ts
type LibraryEntry = {
  path: string;      // 绝对路径，主键
  name: string;      // 文件名（展示）
  format: "epub" | "pdf" | "txt";
  size: number;      // 打开时的大小，用于变更检测
  mtime: number;     // 打开时的修改时间（unix 秒），Go 侧增补
  lastOpen: number;  // 上次打开时间戳（unix 秒），排序依据
  position: ReadingPosition | null;
  progress: number;  // 0..1，展示用（EPUB 为约值）
};
```

淘汰规则：上限 50 条，超出淘汰 `lastOpen` 最旧的条目；`entries` 为空时删除整个键。

### 3.3 位置结构（三格式）

```ts
type ReadingPosition =
  | { kind: "epub"; tocIndex: number; href: string; sectionIndex: number; ratio: number }
  | { kind: "pdf"; page: number }
  | { kind: "txt"; ratio: number };
```

**EPUB 的 `ratio` 是「章节内比例」，不是全流比例**——原因见 4.3。`tocIndex` 仅用于恢复后同步侧栏高亮与进度展示。

### 3.4 校验规则

- 读取时逐字段校验：`format` 白名单、数值非有限数回落 null、`ratio` 钳制到 [0,1]；结构损坏整体回落空书架（与 settings v2 的「非法静默回落」一致）。
- 恢复时按打开时拿到的实际数据二次钳制：PDF 页码 > `pageCount` 时取末页；EPUB `tocIndex` 越界取首章；`sectionIndex` 找不到对应 view 时退化为「滚到目标章顶部」。
- `size`/`mtime` 与当前文件不一致：仍然打开（文件被替换是常态），位置沿用但按上述规则钳制，打开成功后条目信息刷新。

## 4. 技术方案

### 4.1 存储选型：localStorage（推荐）

| 维度 | localStorage（推荐） | Go 侧 JSON 文件 |
|---|---|---|
| 改动面 | 纯前端，零新增绑定 | 需新增读/写/清空三个绑定 + 前端加载态 |
| 退出时序 | 同步写入，`beforeunload` 内可可靠落库 | 异步绑定，退出时来不及等待 |
| 与现状一致性 | 与 settings v2 同机制、同风格 | 引入第二种持久化通道 |
| 缺点 | 随 WebView 配置文件走，用户清浏览器数据会丢（设置同样受影响，属已接受行为） | 文件路径/权限/并发写需要处理 |

结论：用 localStorage。Go 侧文件留待「设置导入导出（F10）」或跨设备需求时再评估。

### 4.2 Go 侧改动（两处，都很小）

1. **新增 `OpenBookPath(path string) (*BookData, error)`**：把现有 `OpenBook` 的文件读取/校验逻辑抽成内部函数 `openBookAt(path)`，对话框版与书架版共用。错误契约不变（`CODE: message` 前缀），书架点到失效文件时走同一条错误条路径。
2. **`BookData` 增补 `ModTime int64`**（json `modTime`，unix 秒）：用于书架条目变更检测。`OpenBook` 路径一并返回，不影响现有前端字段。

### 4.3 位置采集

| 格式 | 采集点 | 单位 | 落地方式 |
|---|---|---|---|
| TXT | `.txt-scroll` 滚动（~~节流 3s~~ **实现为 debounce 3s**，见第 9 章 D32） | 全容器比例 `scrollTop/(scrollHeight-clientHeight)` | 容器唯一，比例稳定 |
| PDF | 翻页回调（`setCurrent` 处） | 页码 | 精确值 |
| EPUB | 滚动（~~节流 3s~~ **实现为 debounce 3s**）+ 可见章节变化 | **章节内比例** `(stage.scrollTop - view.bounds().top)/view.bounds().height` + `sectionIndex` | 见下 |

EPUB 为什么必须用「章节内比例」：章节窗口化下 stage 里只有 `[c-pre, c+pre]` 个章节的 iframe，**全流比例会随窗口大小变化而漂移**（预加载数改变、窗口补齐/回收都会改 `scrollHeight`）；而「相对目标章节自身的比例」与窗口构成无关，恢复时只要把该章 display 出来就能精确定位。具体做法：`chapterWindow.ts` 的 `WindowManager` 增加 `getAnchor(): { sectionIndex: number; ratio: number } | null`（内部已有可见 view 计算，顺带导出），`EpubViewer` 在节流回调里取它上报。

进度展示：EPUB 用 `tocIndex / toc.length`（约值，UI 标注「约」）；PDF 用 `page / pageCount`；TXT 用容器比例。

### 4.4 恢复流程

统一入口：App 持有 `resumePosition`（打开成功后的一次性初始位置），随 Viewer props 下发。

- **TXT**：`TextViewer` 挂载后（布局完成）把容器滚到 `ratio * (scrollHeight - clientHeight)`。
- **PDF**：文档加载完、`pageCount` 就绪后 `renderPage(clamp(page))`，复用现有翻页 effect 的触发方式（初始 `current` 直接取恢复值即可，零新逻辑）。
- **EPUB**（唯一有竞义的一段）：初始 `display()` 与空白自检流程结束后，若带恢复位且 `href` 非空——`await rendition.display(href)` → 等 stage 滚动高度稳定（轮询 `scrollHeight` 连续两帧不变，上限 1.5s）→ `stage.scrollTop = viewTop + ratio * viewHeight`（view 由 `manager.views` 按 `sectionIndex` 查找）→ **自校正循环（读回锚点与目标比较，差值按当前章节高度折算 scrollTop 修正，最多 2 次，实现新增，见 D32）** → `wm.sync()` 补齐窗口。侧栏高亮取恢复的 `tocIndex`。
  - 若恢复位为 null（首次打开）：走现有「目录首章」逻辑，不变。
  - `display(href)` 失败/超时：吞掉，停在首章（不让恢复失败升级成打开失败）。

### 4.5 退出与切换时序

三个落库点，都走同一个节流写入（`library.ts` 内部 3s 合并）：

1. **定时快照**：阅读中节流上报（采集点见 4.3）；
2. **窗口关闭**：`window.beforeunload` 里同步 flush 最新位置（localStorage 同步写，来得及；WebView2 关闭时该事件通常触发，但不保证）；
3. **切书 / 回书架**：`handleOpen` 与新的「书架」动作在执行前先 flush 当前书位置，再卸载 Viewer。

如实说明：`taskkill` 或进程崩溃时 2/3 都不触发，最多丢失一个节流周期（3s）的进度——这是本地工具可接受的取舍，比引入 Go 侧异步写入更简单可靠。

> **实施期变更（2026-10-21，落地文档 D33–D35）**：记录时机按用户口径收敛为**离场节点**——退出软件 / 点击书架 / 切书三处同步取实时位置写库，阅读中不周期性写库（本节「定时快照」已废弃）。根因：debounce 缓存在持续滚动（每次滚动重置定时器）或停止不足 3s 即离场时为空，「直接退出/点书架记录不更新」。「窗口关闭」改由 Go `main.go` 的 `OnBeforeClose` 拦截 WM_CLOSE（flush-request/flush-done 握手，600ms 超时），`beforeunload` 降级为 best-effort 兜底；Viewer 侧 scroll debounce 上报移除，改为同步 getter（`getterRef`）。本章其余设计（UI、数据契约、恢复路径）不变。

### 4.6 书架 UI

**欢迎页（空态）扩展**——保留现有欢迎区，下方新增「继续阅读」区（书架为空时整区隐藏）：

```
继续阅读                    清空
┌──────────┐ ┌──────────┐ ┌──────────┐
│ [EPUB 封面位] │ [PDF]      │ [TXT]      │   ← 格式色块 + 书名首字（P2 再考虑取真封面）
│ 关键对话.epub │ sample.pdf │ notes.txt  │
│ [EPUB] 约 42%  │ [PDF] 3/120 │ [TXT] 61%   │
│ 昨天 21:14    │ 3 天前      │ 上周        │
└──────────┘ └──────────┘ └──────────┘
  点击卡片续读；悬停显示 × 移除
```

**工具栏**：新增「书架」按钮（书本图标），点击后 flush 当前书位置并返回欢迎页（`setBook(null)`，标题复位为 `BookEditor`）。打开图书后也可以随时回书架。

**设置面板 · 高级页**：新增「书架记录」行——显示当前条数 + 「清空」按钮（点击后面板内确认态二次确认，不引入系统 confirm）。

**HTML 示例**：随实施更新 `BookEditor-前端界面示例.html`，补欢迎页书架区与工具栏书架按钮的设计稿（保持「设计基线先行」的惯例）。

### 4.7 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/library.ts` | 新建：条目读写、去重、淘汰、校验、storage 订阅、节流 flush |
| `frontend/src/utils/__tests__/library.test.ts` | 新建：单测（见 T1） |
| `app.go` / `main.go` | 抽 `openBookAt`，新增 `OpenBookPath`；`BookData` 增 `ModTime` |
| `frontend/src/wailsjs/` | 重新生成绑定（wails build 自动） |
| `frontend/src/App.tsx` | 书架状态、`handleShelf`、`resumePosition` 下发、退出 flush |
| `frontend/src/components/Toolbar.tsx` | 「书架」按钮 |
| `frontend/src/components/BookViewer.tsx` | 欢迎页书架区；`resumePosition` 透传 |
| `frontend/src/components/EpubViewer.tsx` | 位置上报 + 恢复逻辑（4.4） |
| `frontend/src/components/PdfViewer.tsx` | 页码上报 + 初始页码取恢复值 |
| `frontend/src/components/TextViewer.tsx` | 滚动上报 + 恢复滚动（加 ref，仍是纯展示组件） |
| `frontend/src/utils/chapterWindow.ts` | `WindowManager` 增加 `getAnchor()` |
| `frontend/src/components/SettingsPanel.tsx` | 高级页「书架记录」行 |
| `frontend/src/styles.css` | 书架区样式（复用现有令牌，四主题自适应） |
| `e2e/smoke_shelf.py` | 新建：书架冒烟（见 T7） |
| `doce/BookEditor-前端界面示例.html` | 书架设计稿 |

## 5. 任务拆分与完成定义

| 顺序 | 任务 | DoD |
|---|---|---|
| T1 | `library.ts` 数据层 + 单测 | 读写回、去重（同 path 只更新）、上限淘汰、损坏 JSON 回落空书架、storage 事件同步、节流合并，用例全绿 |
| T2 | Go 侧 `OpenBookPath` + `ModTime` | `go test ./...` 通过；对话框打开行为无回归（A01–A18 不破） |
| T3 | 位置采集（三格式 + `getAnchor`） | 真书滚动/翻页/文本滚动均能产生合法 position；节流生效（无高频写） |
| T4 | 恢复流程（三格式） | EPUB 恢复后落在同一章且章节内位置接近；PDF 落在退出页码；TXT 位置接近 |
| T5 | 退出/切书 flush | beforeunload 与切书两条路径均落库；taskkill 场景丢失 ≤3s |
| T6 | 书架 UI + HTML 示例 | 欢迎页书架区、工具栏书架按钮、高级页清空；与设计基线一致 |
| T7 | 全量测试 + 冒烟 + 文档回写 | 单测全绿、tsc/build 通过、`smoke_shelf.py` 通过、整合文档与方案状态回写 |

## 6. 验收标准（新增）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A27 | 书架记录 | 打开图书后欢迎页书架出现该记录（名称/格式/进度/时间），重启后仍在 |
| A28 | 去重 | 重复打开同一本书只更新原条目，不新增 |
| A29 | EPUB 位置记忆 | 滚到书中部退出，从书架重开落在同一章（2026-10-20 用户确认章节级口径：不需要精准定位，章节内位置按比例最佳努力恢复） |
| A30 | PDF 位置记忆 | 翻到第 N 页退出，重开落在第 N 页 |
| A31 | TXT 位置记忆 | 滚到中部退出，重开位置接近 |
| A32 | 书架续读 | 点击卡片直接打开该书，不弹文件选择框 |
| A33 | 失效文件 | 删除文件后点击条目：错误条提示，不崩溃，条目保留可移除 |
| A34 | 清空 | 高级页清空后书架区隐藏，重启不恢复 |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **EPUB 章节窗口化滚动卡死缺陷未修**（见 v0.2.0 落地文档第 11 章） | 位置恢复的 `display + 滚动` 是新的回归面，可能诱发或叠加该缺陷 | 恢复逻辑只走已有的 `jump()` 同款 display 路径 + `wm.sync()`；T4 必须做真书多轮滚动回归；若卡死复现，优先修窗口化再谈位置恢复，不带着缺陷叠加功能 |
| EPUB 恢复时机竞态 | iframe 高度未稳时按比例滚动会偏 | 「滚动高度稳定」轮询 + 最多 1.5s 上限；~~稳定后应用一次，不再二次校正（避免与窗口化 scrollTop 补偿打架）~~ **实现修正：稳定后应用一次 + 自校正循环（读回锚点与目标比较修正，最多 2 次）；实测单次映射有系统偏差，自校正有效吸收，未与窗口化补偿打架（D32）** |
| `beforeunload` 不触发 | 退出位置丢失 | 3s 节流快照兜底；如实写入文档，不伪装成「退出必然保存」 |
| 字号/主题变更导致重排 | 绝对像素位置失效 | 全程用比例不用像素（EPUB 章节内比例、TXT 容器比例） |
| 文件被替换/移动 | 位置越界或打开失败 | `size`/`mtime` 检测 + 恢复时钳制 + 错误条（A33） |
| 多实例并发写 | 条目互相覆盖 | storage 事件同步；本地单用户工具，最后写入者胜，可接受 |
| localStorage 被清理 | 书架与设置一起丢失 | 与 settings v2 同命运，属已接受行为；文档注明 |

## 8. 不在本版

- 真封面缩略图（需解包 EPUB 取封面资源，留 P2）；
- 阅读统计（时长、读完标记）；
- 侧栏宽度记忆（G4 只做显隐；宽度记忆随 F7 剩余部分）；
- 书架排序自定义、置顶；
- 云同步与多设备。

## 9. 实现偏差记录（实施后回填）

| 编号 | 方案原文 | 实现 | 原因 |
|---|---|---|---|
| D32 | EPUB「落在同一章、章节内位置接近」；上报「滚动节流 3s」；恢复「稳定后应用一次，不再二次校正」 | 上报改 **debounce 3s**（滚动停止后）；恢复加**自校正循环**（读回锚点修正，最多 2 次）；EPUB 验收口径经 2026-10-20 用户确认改为**章节级**（不需要精准定位，定位到对应章节即可），章内漂移约 369px 记录在案 | 节流在连续滚动末尾丢最后一段，实测恢复位置系统性早于视觉位置；自校正用于吸收 display 重建的几何差；章内漂移源于书内图片（`max-width:99%`）异步加载的几何差异，用户确认章节级即满足需求 |
