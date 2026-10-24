# BookEditor v0.2.0 个性化功能落地说明文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1（补实测结果与冒烟基础设施修复记录） |
| 更新日期 | 2026-10-20 |
| 上位文档 | `doce/_archive/BookEditor-v0.2.0-个性化功能落地方案.md`（方案，已归档） |
| 设计基线 | `doce/BookEditor-前端界面示例.html`（设置面板重构版） |
| 关联文档 | `doce/BookEditor-v0.1.0-整合项目文档.md` |
| 本版范围 | 方案 P0：F1 预加载增强、F2 阅读主题、F3 强调色、F4 正文字号 |
| 状态 | P0 已落地（单测 43/43、tsc、wails build、GUI 冒烟 6/6 均于 2026-10-20 实测通过） |

## 1. 范围

### 1.1 本版实现（P0）

| 编号 | 功能 | 生效范围 | 默认值 |
|---|---|---|---|
| F1 | 章节预加载增强：快捷档位、章节窗口预览图、内存预估 | EPUB | 2 章（不变） |
| F2 | 阅读主题：浅色 / 深色 / 护眼 / 羊皮纸 | EPUB、TXT 正文 + 应用框架 | 浅色 |
| F3 | 界面强调色：6 色 | 应用框架（按钮、目录高亮、选中态） | 蓝 #2563eb |
| F4 | 正文字号：13–20 px | EPUB、TXT 正文 | 14 px |

### 1.2 不在本版

- F5 阅读位置记忆、F6 正文字体、F7 侧栏记忆（P1）；F8–F10（P2）。HTML 示例中「阅读位置记忆」以 v0.2 路线图标记 + 禁用开关占位，本版只做占位不做行为。**（2026-10-20 更新：F5 已由 v0.2.1 落地，设置面板的禁用开关替换为「书架记录」二态确认清空行，见 v0.2.1 系列文档。）**
- PDF 画布内容着色（PDF 仅外围背景跟随主题，文档页保持白色，属预期）。

## 2. 交付物清单

| 类型 | 文件 | 改动 |
|---|---|---|
| 数据层 | `frontend/src/utils/settings.ts` | 重写为 v2：新增 `theme` / `accent` / `fontSize`，v1→v2 迁移，逐字段校验，新增 `resetSettings()` |
| 数据层 | `frontend/src/utils/readingTheme.ts` | 新建：主题令牌、阅读注入样式文本、注入与应用函数 |
| 测试 | `frontend/src/utils/__tests__/settings.test.ts` | 扩展 v2 用例 |
| 测试 | `frontend/src/utils/__tests__/readingTheme.test.ts` | 新建 |
| 样式 | `frontend/src/styles.css` | 新增框架层/阅读层令牌与四个 `data-theme` 分支；硬编码色替换为令牌 |
| 应用层 | `frontend/src/App.tsx` | `theme` / `accent` 应用到 `documentElement` |
| UI | `frontend/src/components/SettingsPanel.tsx` | 按设计基线重构：双栏三分类 + 窗口预览图 |
| 阅读器 | `frontend/src/components/EpubViewer.tsx` | `hooks.content` 注入阅读样式；设置变更重注；调试插桩 DEV 门控 |
| 阅读器 | `frontend/src/components/TextViewer.tsx` / `PdfViewer.tsx` | **无代码改动**（经 CSS 令牌生效，见 6.4） |

## 3. 数据契约

### 3.1 Settings v2

```ts
type ThemeName = "light" | "dark" | "eye" | "sepia";
type Settings = {
  epubPreloadCount: number;              // 0–10，默认 2
  theme: ThemeName;                      // 默认 "light"
  accent: string;                        // 白名单十六进制，默认 "#2563eb"
  fontSize: number;                      // 13–20，默认 14
};
```

存储键：`bookeditor.settings.v2`。旧键 `bookeditor.settings.v1` **只读迁移、不删除**。

### 3.2 迁移规则

`loadSettings()`：先读 v2；不存在或损坏时读 v1 并迁移 `epubPreloadCount`，其余字段取默认；两者都不可用回落 `DEFAULT_SETTINGS`。

### 3.3 字段校验

| 字段 | 规则 | 非法值处理 |
|---|---|---|
| `epubPreloadCount` | `Math.round` 后 clamp 到 [0,10]；NaN → 默认 | 回落默认 |
| `theme` | 白名单四值 | 回落 `light` |
| `accent` | 白名单 6 个十六进制（见 3.4） | 回落 `#2563eb` |
| `fontSize` | `Math.round` 后 clamp 到 [13,20]；NaN → 默认 | 回落默认 |

`saveSettings(next: Partial<Settings>)`：与当前生效值合并后逐字段校验、持久化、广播全量 `Settings`。订阅机制（`subscribeSettings`）语义不变。

### 3.4 强调色白名单

| 名称 | 值 | hover |
|---|---|---|
| 蓝（默认） | `#2563eb` | `#1d4ed8` |
| 靛蓝 | `#4f46e5` | `#4338ca` |
| 绿 | `#059669` | `#047857` |
| 琥珀 | `#d97706` | `#b45309` |
| 玫红 | `#e11d48` | `#be123c` |
| 青 | `#0891b2` | `#0e7490` |

## 4. 主题与 CSS 令牌

### 4.1 分层

- **框架层**（应用外壳）：`--bg` / `--border` / `--border-soft` / `--text` / `--text-2` / `--text-3` / `--sidebar-bg` / `--active-bg` / `--app-bg` / `--bar-bg` / `--surface-bg` / `--accent` / `--accent-hover`。
- **阅读层**（TXT 与 EPUB 正文区域）：`--reading-bg` / `--reading-text` / `--reading-text-2` / `--reading-border` / `--reading-font-size` / `--reading-font-family`。

### 4.2 四主题取值

| 令牌 | 浅色（默认） | 深色 | 护眼 | 羊皮纸 |
|---|---|---|---|---|
| `--reading-bg` | `#ffffff` | `#1e293b` | `#e8eedd` | `#f4ecd8` |
| `--reading-text` | `#374151` | `#cbd5e1` | `#3d4a33` | `#5b4632` |
| `--reading-text-2` | `#6b7280` | `#94a3b8` | `#6b7a5e` | `#8a7458` |
| `--reading-border` | `#e5e9f0` | `#334155` | `#c9d6b8` | `#ddcbab` |
| 框架层 | 现值 | 深色系覆盖（`--bg:#0f172a`、`--text:#e2e8f0`、`--sidebar-bg:#111827`、`--active-bg:#1e3a5f` 等） | 同浅色 | 同浅色 |

深色主题只覆盖中性框架令牌与阅读层，**不定义 `--accent`**（强调色由用户设置独立控制，inline 于 `documentElement`）。

### 4.3 挂载方式

```ts
document.documentElement.dataset.theme = settings.theme;        // 触发 :root[data-theme=...] 分支
document.documentElement.style.setProperty("--accent", settings.accent);
document.documentElement.style.setProperty("--accent-hover", hoverOf(settings.accent));
document.documentElement.style.setProperty("--reading-font-size", settings.fontSize + "px");
```

### 4.4 硬编码色替换

`styles.css` 中以下硬编码色改为令牌：`.app` 背景 → `--app-bg`；`.statusbar` / `.pdf-controls` 背景 → `--bar-bg`；`.modal` 背景 → `--surface-bg`；`.txt-viewer` 颜色 → `--reading-text`、字号 → `--reading-font-size`、行内字体 → `--reading-font-family`；`.toc-item` 文字 → `--text`；`.epub-content` 背景 → `--reading-bg`；`.welcome .welcome-title` 颜色 → `--text-2`。`.pdf-page`（文档页）保持 `#fff` 不动。

## 5. UI 结构映射（HTML 示例 → 组件）

| HTML 示例 | 组件实现 | 类名 |
|---|---|---|
| `.modal-backdrop` / `.settings-dialog` | `SettingsPanel` 根（沿用 `.modal-mask` / `.modal`，宽度 380 → 640） | `.modal` |
| `.settings-nav` 三分类 | 面板内 `pane` state：`reading` / `appearance` / `advanced` | `.settings-nav-item` |
| 步进器 + 快捷档位 | `epubPreloadCount` 草稿态；档位 0/1/2/3/5 | `.step-btn` / `.chip` |
| `.win-preview` 预览图 | `WindowPreview` 子组件：窗口外 · 向前 N · 当前 · 向后 N · 窗口外 | `.wp-block` 等 |
| 内存预估 | `2N+1` 章 × 6 MB 估算文案 | `.set-note` |
| `.theme-card` ×4 | 主题单选卡（迷你预览条） | `.theme-card` |
| `.swatch` ×6 | 强调色单选（选中即时改面板 `--accent`） | `.swatch` |
| 字号滑块 + 预览 | range 13–20 + 示例段落实时字号 | `.font-row` / `.font-preview` |
| 「阅读位置记忆」v0.2 | 禁用开关 + 路线图标记，无行为 | `.set-card-teased` / `.tag-roadmap` |
| 恢复默认 | `resetSettings()` 写入草稿 | `.btn-danger` |
| 保存 toast | **适配**：保存后面板不关闭，底部提示区显示「已保存」1.8s（模态面板保存即关闭会打断连续调整；实现与 HTML 的差异记入第 9 章） | `.settings-hint` |

## 6. 实现细节

### 6.1 `settings.ts`（v2）

- `DEFAULT_SETTINGS`、`PRELOAD_MIN/MAX/DEFAULT`、`THEMES`、`ACCENTS`（含 hover）、`FONT_MIN/MAX/DEFAULT` 全部导出供 UI 与测试使用。
- `normalize(raw: Partial<Settings>): Settings` 纯函数，逐字段按 3.3 校验；`loadSettings` / `saveSettings` 共用。
- `resetSettings(): Settings` = 写默认值并广播。

### 6.2 `readingTheme.ts`（新建）

| 导出 | 职责 |
|---|---|
| `readingTokens(theme)` | 返回阅读层四令牌具体值（供 EPUB 注入物化） |
| `readingStyleText(settings)` | 生成注入 `<style>` 文本：`body` 背景/文字色 `!important`、`font-size` `!important`、`color-scheme` |
| `applyReadingStyle(doc, settings)` | 在文档内按固定 id 创建/更新 `<style>`（幂等，重复调用只改 textContent） |
| `applyAppTheme(settings)` | 按 4.3 设置 `documentElement` 的 dataset 与 CSS 变量 |

注入样式选择器以 `body` 为主并对颜色用 `!important`：书籍自带 CSS 与用户主题冲突时用户意图优先（已知取舍，见第 9 章）。

### 6.3 `App.tsx`

```tsx
useEffect(() => { applyAppTheme(settings); }, [settings]);
```

`onChange={(s) => setSettings(saveSettings(s))}` 语义不变。

### 6.4 `BookViewer` / `TextViewer` / `PdfViewer`

无需代码改动：TXT 阅读区样式全部来自 `--reading-*` 令牌；PDF 仅 `.pdf-canvas-area`（已是 `var(--bg)`）跟随框架层。`BookViewer` 继续向 `EpubViewer` 透传 `settings`（已就绪）。

### 6.5 `EpubViewer.tsx`

1. 现有 `hooks.content.register`（禁用内层滚动）与阅读注入合并为一次注册：`overflow:hidden` + `applyReadingStyle(contents.document, settingsRef.current)`。
2. 新增 `settingsRef`（theme / accent / fontSize / epubPreloadCount 同镜），`subscribeSettings` 回调中除 `preloadRef` 外更新 `settingsRef`，并调用 `reinjectReadingStyles()`：遍历 `manager.views.all()` 的各 iframe 文档重新注入（已加载章节即时换主题）。
3. 调试插桩处置：`onSyncState` 写 `document.body.dataset.dbgWin` 的行为改为 `import.meta.env.DEV` 门控——`wails dev` 保留诊断输出，`wails build` 产物不写任何调试数据。`chapterWindow.ts` 的 `onSyncState` 回调参数保留（窗口状态观测点），不属用户可见缺陷。

### 6.6 `SettingsPanel.tsx` 交互约定

- 草稿态：打开时深拷贝当前 settings；所有控件只改草稿。
- 「保存」→ `onChange(draft)` + 底部提示「已保存」1.8s，面板不关闭。
- 「取消」/ Esc / 点遮罩 → `onClose()`，不落库。
- 「重置」→ 草稿 = `resetSettings()` 的返回值？否——重置只改草稿并同步提示，与保存一样需用户确认后落库（避免误触立即改写持久化）。
- 预加载预览图与档位联动规则与 HTML 示例一致；越界不可能发生（控件本身约束在 [0,10] / [13,20]）。

## 7. 测试计划

### 7.1 单元测试（vitest）

`settings.test.ts` 扩展：v2 默认值、v1→v2 迁移（预加载值保留）、theme 白名单、accent 白名单、fontSize clamp/四舍五入/NaN、损坏 JSON、部分字段合并保存、订阅广播、`resetSettings`。

`readingTheme.test.ts` 新建：四主题令牌非空且互异、`readingStyleText` 含字号与主题色、`applyReadingStyle` 幂等（同 id 只建一个 style、二次调用更新文本）、`applyAppTheme` 设置 dataset 与 CSS 变量、非法 accent 的 hover 回落。

### 7.2 构建与类型

`npx tsc --noEmit`、`npm test`、`npm run build`、`wails build` 全绿。

### 7.3 GUI 冒烟（driver）

`e2e/smoke_settings.py`（2026-10-20 实测，**6/6 通过**）。流程：打开真书 12.epub → 重置默认（高级 → 重置 → 保存，保证基线不受上次运行的持久化强调色干扰）→ 齿轮打开设置 → 键盘导航依次：界面外观 → 深色主题卡 → 绿色板 → 字号 End（20px）→ 保存 → Esc → 重启复测。验证用像素断言而非肉眼：状态栏采样（浅色 `#fafbfc` / 深色 `#111827`）、工具栏强调色扫描（默认蓝 `#2563eb` / 绿 `#059669`），截图归档 `e2e/shots/sm-*.png`。

实测确认：A19（保存后状态栏与 EPUB 正文均为深色，跨文档注入生效）、A20（重启后主题与强调色保持，双断言通过）、A21（强调色全局跟随）、A22（字号 20px）、A25（重置后基线恢复浅色+蓝）。A23/A24/A26 未纳入冒烟断言，状态见整合文档 8.4 说明。

冒烟基础设施修复记录（属测试驱动问题，非产品偏差）：

- 驱动 `find_open_button` 原先只扫品牌蓝 `#2563eb`。强调色可持久化后，非默认色重启会导致按钮定位失败（实测靛蓝、绿均复现，表现为 reopen 打不开文件）。已改为扫描全部 6 个强调色。
- 对话框 Tab 序列按 DOM 顺序为 close → 阅读体验 → 界面外观 → 高级 → 窗格控件（导航栏渲染在窗格之前）。早期脚本按「导航后直接进窗格」推算，`tab(2)` 实际落在默认已选的浅色卡上，Enter 后无可见变化，一度误判为 Enter 激活失败；按 DOM 顺序重算后深色卡（Tab×3）、绿色板（Tab×5）均一次命中。

## 8. 验收标准（新增）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A19 | 主题切换 | EPUB/TXT 立即变色，无需重开图书；EPUB 已加载章节同步换肤 |
| A20 | 主题持久化 | 关闭重开应用后主题保持 |
| A21 | 强调色 | 按钮、目录高亮、选中态全部跟随，无遗漏硬编码 |
| A22 | 字号 | EPUB/TXT 生效；13/20 边界不破版 |
| A23 | 预加载档位 | 0/1/2/3/5 点选后预览图与窗口章节数一致 |
| A24 | 设置取消 | 取消后重开面板显示旧值 |
| A25 | 恢复默认 | 一键回默认，保存后生效 |
| A26 | 迁移 | 装有 v1 设置的机器升级后预加载值保留 |

## 9. 已知取舍与偏差记录

| 编号 | 内容 |
|---|---|
| D20 | 保存提示用面板内「已保存」文案替代 HTML 的全局 toast：模态面板保存即关闭会打断连续调整，保留面板更符合设置类界面的常规交互；HTML 示例同步保留 toast 作为页面级演示 |
| D21 | 书籍 CSS 与主题冲突时注入样式用 `!important` 覆盖：用户显式设置的阅读意图优先于书籍默认样式；不接受 !important 的书籍元素属已知局限 |
| D22 | 深色主题不处理书籍内图片/封面反色：封面突兀问题留待 P2「图片反色」开关 |
| D23 | PDF 仅外围背景跟随主题，画布内容保持原样：pdf.js 画布像素不可换色，属预期 |
| D24 | `onSyncState` 调试输出改为 DEV 门控而非删除：保留 `wails dev` 的诊断能力，生产构建零调试输出 |

## 10. 任务顺序与完成定义

| 顺序 | 任务 | DoD |
|---|---|---|
| 1 | `settings.ts` v2 + 单测 | 迁移/白名单/边界用例全绿 |
| 2 | `readingTheme.ts` + 单测 | 幂等注入与令牌用例全绿 |
| 3 | `styles.css` 令牌 + `App.tsx` 应用 | TXT 四主题肉眼正确；强调色框架层全跟随 |
| 4 | `EpubViewer` 注入 + 插桩门控 | 真书四主题截图正确；生产构建无 dbgWin 写入 |
| 5 | `SettingsPanel` 重构 | 与设计基线结构一致；取消/保存/重置语义符合 6.6 |
| 6 | 全量测试 + 构建 + GUI 冒烟 | 第 7 章全绿；冒烟截图归档 |
| 7 | 文档回写 | 整合文档 5.5/8.1/验收矩阵/9.2 更新；方案文档状态更新 |

任务状态（2026-10-20）：任务 1–7 全部完成。任务 6 实测：vitest 43/43、`tsc --noEmit` 通过、`wails build` 产出 13.5 MB exe、GUI 冒烟 6/6（见 7.3）。任务 7 完成：整合文档 5.5 重写为 Settings v2、8.1 补 readingTheme、8.4 补 A19–A26 及验证状态、9.2 更新进度；方案文档状态同步更新。

## 11. 遗留问题（不在本版解决）

- **EPUB 章节窗口化滚动卡死**：真书多轮滚动后出现卡住（历史定位：窗口补齐/回收与 scrollTop 补偿的竞态）。本版只做 DEV 门控不改逻辑；该缺陷单独跟踪，修复前个性化功能不叠加回归面。当前 `chapterWindow.ts` / `EpubViewer.tsx` 中的诊断回调即为此问题保留。
- F6、F8–F10 按方案 P1/P2 排期。**F5 阅读位置记忆已由 v0.2.1 落地**（书架 + 位置记忆，见 `doce/BookEditor-v0.2.1-书架与阅读位置记忆落地说明文档.md`）。
