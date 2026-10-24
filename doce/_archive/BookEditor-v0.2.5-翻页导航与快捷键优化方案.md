# BookEditor v0.2.5 翻页导航与快捷键优化方案

| 项 | 内容 |
|---|---|
| 版本 | v0.2.5（方案 v2：纳入「快捷键自定义」需求） |
| 状态 | **已实施（2026-10-21）**：F21/F22/F24 全量落地，门禁五项全绿；冒烟 7/7、翻页导航验证 7/7 真机通过；TXT/PDF 快捷键与录制交互真机待验。实施口径与偏差（D45–D50）见《BookEditor-v0.2.5-翻页导航与快捷键优化落地说明文档》 |
| 触发 | 用户 2026-10-21 反馈：① 横向翻页按钮悬浮正文上「会掩盖文案」（附截图）；② 翻页模式缺少可用快捷键；③ 快捷键需在设置内支持自定义 |
| 依据 | 截图实证 + 源码定位（`styles.css` / `EpubViewer.tsx` / `TextViewer.tsx` / `PdfViewer.tsx` / `settings.ts` / `SettingsPanel.tsx`） |
| 影响面 | 翻页模式交互层 + 滚动模式快捷键统一 + 设置数据模型（v4）与设置面板新分类；**不触碰位置采集/恢复主链路** |
| 数据契约 | `Settings` 新增 `hotkeys`（settings v3→v4 迁移，缺省补默认，存量零回归）；`ReadingPosition` 不变 |

---

## 1. 问题定位（代码实证）

### 1.1 翻页按钮掩盖文案

截图所示 `‹ ›` 双按钮为 EPUB 翻页模式导航（`EpubViewer.tsx:1084-1097`）。三格式翻页导航实现不一致：

| 格式 | 容器 | 定位方式 | 是否遮挡正文 |
|---|---|---|---|
| EPUB 翻页 | `.epub-pager`（`styles.css:951-959`） | `position:absolute; bottom:18px; left:50%; translateX(-50%)`，悬浮正文区 | **是**：白底 + `--page-shadow` 盖住正文末行 |
| TXT 翻页 | `.txt-pager`（`styles.css:983-993`） | `position:absolute; bottom:16px; left:50%`，药丸背景 | **是**：同款遮挡 |
| PDF 单页 | `.pdf-controls`（`PdfViewer.tsx:391-412`） | 正常文档流（canvas 区下方） | 否 |

附加问题：按钮沿用 `.pg-btn` 基础样式（`styles.css:222-231`，`padding:6px 14px`），触达区约 34×30px。

### 1.2 快捷键不可用

| 格式/模式 | 现有键位 | 绑定对象 | 实际问题 |
|---|---|---|---|
| EPUB 翻页 | ←/→/PageUp/PageDown/空格（`EpubViewer.tsx:779-789`） | `stage`（`tabIndex=0`，:787） | ① 焦点不在正文区时**完全失效**；② 焦点在 iframe 内文档时事件不跨 frame 冒泡，**点击正文后失效** |
| TXT 翻页 | ↓/PageDown/空格/↑/PageUp（`TextViewer.tsx:108-116`） | `root`（`tabIndex=0`，:117） | 同款焦点依赖 |
| PDF 单页 | **无** | — | 翻页只能点按钮 |
| PDF 滚动 | **无** | — | 滚动只能滚轮 |
| EPUB 滚动 | PageDown/Home/End（`EpubViewer.tsx:313-344`） | `stage`（`tabIndex=0`，:656） | 同款焦点依赖 |

根因：键盘监听挂在「需先获得焦点的容器」而非 window；WebView2 iframe 独立文档，内部 keydown 不冒泡到宿主。既有全局层无键盘处理（`App.tsx` 无 window keydown；Esc 仅 `SettingsPanel.tsx:143` 关面板），正好统一收口。

---

## 2. 优化目标

- O1：翻页导航**不遮挡正文**，三格式视觉语言统一。
- O2：快捷键**全局可用**——焦点在正文区外、正文内（iframe）、刚打开未点击，均生效。
- O3：PDF 补齐翻页/滚动快捷键。
- O4：快捷键不劫持输入场景（设置面板、未来搜索框等）。
- O5：快捷键可在设置面板**自定义**（录制式绑定、冲突检测、恢复默认），保存后生效。
- O6：零位置链路变更；数据迁移存量零回归。

---

## 3. 方案设计

### F21 翻页导航重构（EPUB/TXT）：悬浮贴底 + 自动隐藏

采用阅读类软件主流范式（闲置隐藏、交互复现）：

1. **贴底悬浮**：保持 absolute，按钮组收窄贴底居中（`bottom:10px`）；
2. **自动隐藏**：鼠标在正文区移动 / 点击翻页按钮 / 键盘翻页 / 章节切换 → 淡入；2500ms 无交互 → 淡出（opacity + visibility 过渡，隐藏态 `visibility:hidden`，防看不见的按钮被 Tab 聚焦或误点）；hover 按钮组本身取消隐藏计时；
3. **触达升级**：40×40（≥36px 触达），半透明底 + 1px 边框，四主题令牌化；
4. **PDF 保持流内控件**（本就不遮挡），仅视觉统一（圆角/尺寸），不加自动隐藏——页脚 `— 3 —` 与控件同在底部信息区，需常驻。

### F22 快捷键体系统一（window 级收口 + 自定义键位）

**单一事实源**：各 Viewer 现有 stage/root 级 keydown **移除**（`EpubViewer.tsx:779-789`、`TextViewer.tsx:108-116`、滚动分支 `EpubViewer.tsx:313` 的翻页部分），改由 window 级统一监听派发，杜绝「stage + window 双触发翻两页」。

**iframe 内键盘注入**（EPUB 翻页模式）：复用官方注入点 `rendition.hooks.content.register`（`EpubViewer.tsx:526`，与 `applyReadingStyle` 同通道），向章节文档注入转发器：iframe 内 keydown → `parent.postMessage({type:"reader-hotkey", key})` → 宿主消费。iframe 为 blob: 同源，`contentDocument` 访问已有先例（`bindStageInteraction`，`EpubViewer.tsx:200-213`）。

**键位解析（自定义核心）**：新建 `utils/readerHotkeys.ts`：

```ts
export type HotkeyAction = "prev" | "next" | "home" | "end";
export type HotkeyMap = Record<HotkeyAction, string[]>;   // KeyboardEvent.key 值数组
export const DEFAULT_HOTKEYS: HotkeyMap = {
  prev: ["ArrowLeft", "PageUp", "ArrowUp"],
  next: ["ArrowRight", "PageDown", " ", "ArrowDown"],
  home: ["Home"],
  end:  ["End"],
};
/** 反查：当前按下的键属于哪个动作；修饰键组合由调用方先行拦截，本函数只看 key */
export function resolveHotkeyAction(key: string, map: HotkeyMap): HotkeyAction | null;
```

**默认键位表**（可自定义，下同）：

| 操作 | 默认键 | EPUB 翻页 | TXT 翻页 | PDF 单页 | PDF 滚动 | EPUB 滚动 |
|---|---|---|---|---|---|---|
| 上一页/上一屏 | `←` `PageUp` `↑` | rendition.prev | page-1 | current-1 | 滚动一屏 | 滚动一屏 |
| 下一页/下一屏 | `→` `PageDown` `空格` `↓` | rendition.next | page+1 | current+1 | 滚动一屏 | 滚动一屏 |
| 首页 | `Home` | 首章 | page 0 | current 1 | 容器置顶 | 章节置顶 |
| 末页 | `End` | 末章 | 末页 | current max | 容器置底 | 章节置底 |

滚动幅度：`scrollBy({top: clientHeight*0.9})`（与既有 epubjs 行为对齐，不用 smooth，避免与位置采集竞争）。

**派发挂点**：`App.tsx` window 级 effect，按当前 `book.format` × `readerMode` 派发到 Viewer 命令接口（复用 `pagerRef`/`setCurrent`/滚动容器 ref 通道；配置从 `settings.hotkeys` 实时读取——订阅机制保证自定义保存后即时生效）。

### F24 快捷键自定义（设置面板新分类「快捷键」）

**数据模型（settings v4）**：

```ts
export type Settings = { /* v3 十字段原样 */ hotkeys: HotkeyMap };
```

- `STORAGE_KEY` 升 `bookeditor.settings.v4`；新增 `LEGACY_V3_KEY`，加载链 v4→v3→v2→v1；
- `normalizeSettings`：`hotkeys` 缺省 → `DEFAULT_HOTKEYS`；逐动作校验为「非空字符串数组」，过滤纯修饰键（`Shift/Control/Alt/Meta`）、去重、限制每动作 ≤4 键；
- **冲突消解**（防同一键双触发）：存储态若同键出现在多动作，按 canonical 顺序 `prev→next→home→end` 先到先得，后到者剔除该键——确定性、可单测；UI 层从源头阻止冲突（见下）；
- 自定义键序列化即 `KeyboardEvent.key` 原值（`" "`/`"ArrowLeft"`/`"a"`…），迁移与校验对称。

**面板 UI**（新 nav 分类「快捷键」，与既有三分类同款图标+草稿态模式）：

- 每个动作一行：动作名 + 已绑定键 chips（`×` 可删）+ 「+ 绑定」按钮；
- **录制式绑定**：点「+ 绑定」→ 该按钮变「请按下按键…」→ window 捕获下一次 keydown（`preventDefault` 防穿透）→ 规范化（`Spacebar`→`" "`、忽略纯修饰键、忽略 Esc=取消）→ 校验：
  - 已被本动作绑定 → 忽略；
  - 已被其他动作占用 → 行内红字「已被「下一页」占用」，不写入；
  - 合法 → 加入 chips（草稿态）；
- 卡片级「恢复默认」；`set-note` 说明「保存后生效；阅读中实时生效的是已保存配置」；
- 面板打开时 window 翻页派发整体禁用（豁免条件天然覆盖录制场景）。

**运行时整合**：F22 的 dispatcher 从 `resolveHotkeyAction(ev.key, settings.hotkeys)` 取动作；自定义保存 → 订阅广播 → dispatcher 即时用新键位（无需重开）。

---

## 4. 实现要点与风险

| # | 要点/风险 | 对策 |
|---|---|---|
| R1 | window + stage 双监听翻两页 | 移除 Viewer 内旧监听，window 单一事实源 |
| R2 | iframe 内焦点按键不冒泡 | `hooks.content` 注入 postMessage 转发器，随章节重建天然重注 |
| R3 | 隐藏按钮被 Tab 聚焦成「看不见的点」 | 隐藏态 `visibility:hidden`（transition 300ms） |
| R4 | 自动隐藏误伤（翻页中隐藏） | 任何翻页命令执行即复现按钮并重置计时 |
| R5 | 与设置面板/输入冲突 | 豁免：`input/textarea/select/[contenteditable]` 目标、面板打开、修饰键组合（Ctrl+A/C 保留不动） |
| R6 | 录制模式吞键 | 录制态 window capture + `preventDefault`；Esc 取消；单键上限 4 |
| R7 | 自定义键位与内置语义撞键（如把 `a` 绑给翻页） | 允许（用户显式意图优先），但单字符键仅限无修饰键按下时生效，与 Ctrl+A/C 不撞 |
| R8 | 存储态键位冲突（手改 localStorage） | normalize 按 canonical 顺序消解 + 单测固化 |
| R9 | settings v4 迁移失败 | 沿用 v3→v2→v1 同款链式回落；单测覆盖「v3 存量无 hotkeys → 默认键位、其余字段保真」 |

---

## 5. 验收项

| 编号 | 标准 | 对应 |
|---|---|---|
| A60 | EPUB/TXT 翻页按钮不遮挡正文（真书截图人工确认） | F21 |
| A61 | 按钮 2.5s 闲置自动隐藏；鼠标移动/翻页/hover 复现 | F21 |
| A62 | EPUB 翻页：刚打开未点击正文时默认键即生效 | F22 |
| A63 | EPUB 翻页：焦点在正文（iframe）内时默认键仍生效 | F22 R2 |
| A64 | TXT 翻页：默认全键位生效（↑/↓/PageUp/PageDown/空格/Home/End） | F22 |
| A65 | PDF 单页：默认键翻页正确 | F22 |
| A66 | PDF 滚动：PageDown/空格滚一屏、Home/End 顶/底 | F22 |
| A67 | 设置面板打开时翻页键不穿透；Ctrl+A/C 不受影响 | F22 |
| A68 | 设置面板「快捷键」分类：录制绑定/删除/冲突提示/恢复默认均可用 | F24 |
| A69 | 自定义键位保存后阅读中即时生效（无需重开） | F24 |
| A70 | 自定义键位跨重启保持 | F24 |
| A71 | settings v4 迁移：v3 存量其余字段保真、hotkeys 补默认；v4 键位读回一致 | F24 |
| A72 | 单测：`normalizeSettings` hotkeys 校验/冲突消解/迁移 + `resolveHotkeyAction` 映射 | T1 |
| A73 | `tsc`/`vitest`/`vite build`/`go test`/`wails build` 全绿，既有 86 项无回归 | T6 |

---

## 6. 任务拆分

- **T1 数据模型 + 键位纯函数**：`utils/readerHotkeys.ts`（类型/默认/`resolveHotkeyAction`/normalize helpers）；`settings.ts` 升 v4（`hotkeys` 字段、v3 迁移链、冲突消解）；单测（settings + readerHotkeys 两组）。
- **T2 window 派发层 + iframe 注入**：`App.tsx` window effect（豁免 + 按 format×mode 派发）；三 Viewer 暴露命令接口并移除 stage/root 旧监听；`EpubViewer` `hooks.content` 注入 postMessage 转发器。
- **T3 翻页导航视觉重构**：`styles.css` 重写 `.epub-pager`/`.txt-pager`（悬浮贴底、自动隐藏、40×40、令牌化）；JSX 微调（aria 保留）。
- **T4 PDF 快捷键补齐**：`PdfViewer` 暴露 prev/next/home/end/scrollBy，纳入统一键位表。
- **T5 设置面板「快捷键」分类**：新 nav 项 + 录制式卡片 + 冲突检测 + 恢复默认 + 令牌化样式。
- **T6 回归与文档**：门禁五项 + `smoke_settings.py` 复核（新增 nav 项影响 Tab 路径，须实测或补注记）+ 本方案回填 + 落地说明 + 整合文档回填（偏差自 D45 起）。

## 7. 不在本版范围

- F25 点击左右半屏翻页（与 iframe 链接点击有纠缠，单独排期）；
- 快捷键方案导入导出（依赖本版键位模型稳定后）；
- PDF 缩放记忆（F18，P1 未启动项，与本文正交）。

---

## 8. 实施结果回填（2026-10-21）

| 任务 | 结果 |
|---|---|
| T1 数据模型 + 键位纯函数 | ✅ `readerHotkeys.ts` + settings v4；单测 readerHotkeys 16 项 + settings v4 组 7 项 |
| T2 window 派发层 + iframe 注入 | ✅ `App.tsx` 派发 effect + `readerCommands.ts` 注册表 + 三 Viewer 命令注册 + EPUB 双转发器（keydown/mousemove，后者为 D50 修正） |
| T3 翻页导航视觉重构 | ✅ `.epub-pager`/`.txt-pager` 重写；`verify_pager.py` 7/7 真机通过（A60/A61/A62/A63） |
| T4 PDF 快捷键补齐 | ✅ 单页/滚动两模式命令映射（A65/A66 代码 ✅，真机待验） |
| T5 设置面板「快捷键」分类 | ✅ 录制式绑定 + 冲突检测 + 恢复默认；分类可达性经 `sm-01b` 截图实证 |
| T6 回归与文档 | ✅ 门禁五项全绿（vitest 109/109）；`smoke_settings.py` 7/7；本回填 + 落地说明 + 整合文档回填（D45–D50） |

**偏离方案的点（均已记录偏差，详见落地说明 §9）**：D45 对话框固定 600px（测试暴露的布局缺陷）；D46 滚动步进区分方向键/翻页键；D47–D49 smoke 方法论坐标化重构、A21 去恒真化、前台哨兵；D50 iframe mousemove 转发器（`verify_pager.py` 实测发现的 F21 缺陷）。
