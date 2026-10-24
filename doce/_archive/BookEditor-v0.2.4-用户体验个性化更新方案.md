# BookEditor v0.2.4 用户体验个性化更新方案

| 项 | 内容 |
|---|---|
| 主题 | 用户体验个性化：排版体感（行距/字体/页边距）→ 交互层（翻页动画/进度可见）→ 记忆补全（TOC 宽度/PDF 缩放） |
| 状态 | **P0（F12–F14 版式三件套）已实施（2026-10-21），自动化门禁全绿，真机待验**；P1/P2 待排期。实施口径见 `BookEditor-v0.2.4-用户体验个性化落地说明文档.md` |
| 依据 | 仓库源码实证、`BookEditor-v0.2.0-个性化功能落地方案.md`（F1–F11 清单）、`BookEditor-v0.1.0-整合项目文档.md` §9 |
| 上游 | v0.2.0 个性化 P0、v0.2.1 位置记忆、v0.2.2 阅读模式切换、v0.2.3 翻页位置定位优化均已落地 |

---

## 1. 背景

v0.2.0–v0.2.3 完成了个性化的「设置框架 + 主题/强调色/字号 + 位置记忆 + 阅读模式」主干，但**阅读体感层（行距、字体、页边距）与交互信息层（翻页动画、进度可见）仍是空白**：用户能改字号，却改不了行距；能翻页，但翻页是瞬移的；位置记得很准，但阅读时看不到进度。本方案补齐这一层，并收尾 v0.2.0 遗留的 F6/F7/F8 编号项。

## 2. 测试检查结论（2026-10-21 本轮实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 前端类型 | `tsc --noEmit` | PASS |
| 前端单测 | `vitest run` | **72/72 PASS**（6 文件：base64 4 / appError 9 / settings 20 / readingTheme 5 / library 22 / chapterWindow 12） |
| 前端构建 | `vite build` | PASS（含本轮优化，见下） |
| Go 单测 | `go test ./...` | PASS（cached） |
| 桌面构建 | `wails build` | 本轮未重跑——代码自 v0.2.3 后仅 `vite.config.ts` 构建配置变动，不触及 Go 与前端运行码；沿用上次产物 `build/bin/book-editor.exe`（13.0 MB）。**建议下次改运行码后重跑** |

### 2.1 本轮已实施的优化：构建 chunk 拆分

测试检查发现：生产构建单 chunk 1,070.08 kB（React + epubjs + pdfjs 打成一个包），超过 Vite 500 kB 警告线，首屏 gzip 328.87 kB 全部阻塞加载。

已实施 `vite.config.ts` `manualChunks` 拆分并复验：

| 产物 | 拆分前 | 拆分后 |
|---|---|---|
| app 代码 | 1,070.08 kB | 265.82 kB（gzip 83.74 kB） |
| react | （含在 app 包） | 11.88 kB（gzip 4.20 kB） |
| epubjs | （含在 app 包） | 351.36 kB（gzip 108.28 kB） |
| pdfjs | （含在 app 包） | 436.38 kB（gzip 131.03 kB） |
| pdf worker | 1,264 kB（独立资源） | 不变 |

效果：首屏只需 app + react（约 88 kB gzip），epubjs/pdfjs 按格式按需加载；500 kB 警告消除；`vitest` 复跑 72/72 无回归。记入落地说明偏差 D42。

## 3. 已落地个性化能力盘点（代码实证）

| 能力 | 字段/机制 | 注入通道 |
|---|---|---|
| 阅读主题 | `theme`：light/dark/eye/sepia（四主题 CSS 令牌） | 宿主 `data-theme` + EPUB `hooks.content` 逐文档重注 |
| 界面强调色 | `accent`：白名单 6 色 + `accentHover` | CSS 变量 |
| 正文字号 | `fontSize`：13–20 px，默认 14 | EPUB `hooks.content` CSS；TXT 容器类 |
| 阅读模式 | `readerMode`：scroll/page，默认 scroll | Viewer `mode` prop + `state-host` key |
| EPUB 预加载 | `epubPreloadCount`：0–10，默认 2 | 章节窗口化 |
| 位置记忆 | 离场节点 flush；EPUB CFI、PDF 页码、TXT anchor | `library.ts` |
| 即时生效 | 设置订阅广播（`subscribeSettings`） | 不重开图书即生效 |

存储：`bookeditor.settings.v2`（v1 只读迁移）；逐字段校验，非法静默回落。

## 4. 用户体验缺口（代码实证）

| 编号 | 缺口 | 证据 | 用户感知 |
|---|---|---|---|
| G1 | 无行距设置 | `settings.ts` 无 `lineHeight` 字段；正文注入只含字号 | 中文长段落默认行距偏挤，无法放松 |
| G2 | 无字体家族 | v0.2.0 方案 F6 未落地，`settings.ts` 无 `fontFamily` | 想要宋体/楷体正文的用户无选项 |
| G3 | 无页边距/正文宽度 | 无 `contentMargin`；宽屏下正文行过长 | 大屏阅读一行字太多，扫读累 |
| G4 | 翻页无过渡动画 | v0.2.2 TXT filmstrip 与 EPUB paginated 均为瞬移 | 翻页生硬，缺少「书感」 |
| G5 | 阅读进度不可见 | `StatusBar` 仅模式文案 + 章名；进度只在书架卡片有 | 阅读中不知道全书进度与剩余 |
| G6 | PDF 缩放硬编码 | `StatusBar.tsx` 文案「缩放：120%（默认 1.2）」为写死值 | 每次打开 PDF 都要手动调缩放 |
| G7 | TOC 侧栏宽度硬编码 | `styles.css` `.toc-sidebar { width: 150px }`，无记忆（v0.2.0 F7 未落地） | 每次重开侧栏宽度复位 |

## 5. 候选功能池与分级

### P0 — 阅读体感核心（建议本版本主体）

| 编号 | 功能 | 设计要点 | 对应缺口 |
|---|---|---|---|
| F12 | 行距 `lineHeight` | 1.4–2.2，步进 0.05，默认 1.75；EPUB/TXT 注入；改行距会改变页面几何，TXT 翻页 `totalPages` 需重算（复用现有 fontSize 重算触发源） | G1 |
| F13 | 正文字体 `fontFamily` | system/宋体/楷体，默认 system（存量零回归）；EPUB 经 `hooks.content` 注入 `font-family`；TXT 容器类切换 | G2 |
| F14 | 页边距 `contentMargin` | 0–80 px，默认 0（宽屏用户可调大）；EPUB 注入 body padding；TXT 容器 padding；不触碰 `state-host` key（CSS 级变更不重挂载） | G3 |

### P1 — 交互与信息层（可按需选做）

| 编号 | 功能 | 设计要点 | 对应缺口 |
|---|---|---|---|
| F15 | 翻页过渡动画 | TXT filmstrip 加 `transition: transform 180ms`（天然适配）；EPUB paginated 淡入 120ms；提供「关闭动画」降级项（低性能机器/无障碍） | G4 |
| F16 | 阅读进度显示 | 状态栏右侧「全书 62%」+ 细进度条；与位置采集同源（EPUB 用 `(tocIndex+1)/len` 已有值，TXT 用 anchor/text.length，PDF 用 page/pageCount）；两模式通用 | G5 |
| F17 | TOC 侧栏宽度记忆 | v0.2.0 F7：拖拽/双击分隔条调宽，写入 `settings.tocSidebarWidth`（min 120 / max 400），重启恢复 | G7 |
| F18 | PDF 默认缩放记忆 | v0.2.0 F8：当前缩放写库，下次打开 PDF 应用；`mode` 无关（两种渲染模式各自按缩放渲染） | G6 |

### P2 — 高级与工程（v0.3 候选）

| 编号 | 功能 | 说明 |
|---|---|---|
| F19 | 设置导入/导出（v0.2.0 F10） | JSON 全量导出/导入；依赖数据模型稳定后做 |
| F20 | 键盘快捷键自定义（v0.2.0 F9） | 翻页键盘（←/→/空格等）可重绑；对翻页模式收益明显 |
| — | EPUB 加载进度/取消 | 整合文档 §9.1：10s 固定超时误判大书 |

## 6. 数据模型演进（settings v3）

```ts
export type FontFamily = "system" | "song" | "kai";

export type Settings = {
  epubPreloadCount: number;   // 既有
  theme: ThemeName;           // 既有
  accent: string;             // 既有
  fontSize: number;           // 既有
  readerMode: ReaderMode;     // 既有
  // v3 新增
  lineHeight: number;         // 1.4–2.2，步进 0.05，默认 1.75
  fontFamily: FontFamily;     // 默认 "system"（存量零回归）
  contentMargin: number;      // 0–80 px，默认 0
};
```

- 存储键升级 `bookeditor.settings.v3`；v2 键全量迁移（六字段原值搬移）+ v1 只读保留；三级回退链：v3 → v2 → v1 → 默认。
- 每字段独立校验：枚举白名单、数值 clamp；非法静默回落默认（与现行行为一致）。
- 单测补齐（仿 settings.test.ts 现有迁移用例）：v3 迁移保真、缺字段回落、非法枚举/越界 clamp、与既有字段混合互不干扰。

## 7. 与位置系统的正交性（关键约束）

排版参数变更不得破坏 v0.2.1/v0.2.3 位置记忆：

- **EPUB**：CFI 指向内容位置，与排版无关 → 天然免疫；滚动模式 `ratio` 为章内比例，行距/边距变化后章节高度同比变化，现有自校正循环吸收（实测原机制对 369px 级漂移有效，D32 口径）。
- **TXT**：`anchor` 为字符偏移，与字号/行距无关 → 天然免疫；翻页 `totalPages` 随行距变化重算，`page` 钳制在 `[0, totalPages-1]`（现有 recompute 机制，扩展触发源即可）。
- **PDF**：缩放/页边距只影响渲染尺寸，页码模型不变。
- **不变量**：排版设置**不进** `state-host` key（CSS 级变更，不触发 Viewer 重挂载）；**不进** `ReadingPosition`（位置模型与排版正交，v0.2.3 契约不变）。

## 8. 验收标准

| 编号 | 标准 | 对应 | 结果 |
|---|---|---|---|
| A51 | 行距调整三格式即时生效，TXT 翻页总页数正确重算，位置不丢 | F12 | ☐ 代码已落地，真机待验 |
| A52 | 字体切换三格式生效；默认 system 下存量行为零回归 | F13 | ☐ 代码已落地，真机待验 |
| A53 | 页边距调整生效；EPUB 位置保持（自校正循环吸收） | F14 | ☐ 代码已落地，真机待验 |
| A54 | 翻页动画流畅（CSS transition，无 JS 逐帧）；关闭动画后行为同 v0.2.2 | F15 | 未启动（P1） |
| A55 | 进度显示与位置采集同源，两模式准确，EPUB 翻页模式显示章节级进度 | F16 | 未启动（P1） |
| A56 | TOC 侧栏宽度跨重启保持（钳制 120–400） | F17 | 未启动（P1） |
| A57 | PDF 缩放跨重启保持，两种渲染模式均正确 | F18 | 未启动（P1） |
| A58 | settings v3 迁移与降级单测全绿（v3→v2→v1→默认链） | §6 | ✅ 单测 86/86（v3 新增 14 项） |
| A59 | chunk 拆分后 `wails build` 通过、应用启动正常（首屏包体可观测） | §2.1 | ✅ 构建产物 13.6 MB（15:08） |

## 9. 实施路线建议

1. **P0 先行（F12→F13→F14）**：改动集中在 `settings.ts`（模型+校验+迁移单测）、三个 Viewer 的注入点（EPUB `hooks.content` / TXT 容器类）、`SettingsPanel` 分段控件、`styles.css` 令牌。不触碰位置采集/恢复主链路，风险最低、体感收益最大。
2. **P1 选做（F16→F17→F18→F15）**：F16 进度显示复用现有采集值，纯展示层；F17/F18 为「记忆」类，模式与 v0.2.1 一致；F15 动画最后做（需主观调参）。
3. **P2 排后**：F19/F20 依赖数据模型稳定；EPUB 加载进度为独立工程项。

## 10. 与既有文档的编号对齐

- F12–F18 为新编号；F6（字体）/F7（TOC 宽度）/F8（PDF 缩放）在本文档分别由 F13/F17/F18 承接，v0.2.0 方案状态行应回填「部分由 v0.2.4 承接」。
- 偏差编号自 **D42** 起连续编号（D35 跨版本冲突已在整合文档 §12 记录，不返工）。
- 验收编号自 A51 起（A50 为 v0.2.3 末项）。
