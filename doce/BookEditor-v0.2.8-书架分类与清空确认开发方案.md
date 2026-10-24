# BookEditor v0.2.8 —— 书架分类与清空确认 开发方案

> 状态：**代码已落地，A75–A82 待真机验收**（2026-10-22）。
> 验证：`tsc --noEmit` PASS、`vitest` **134/134**（新增 categories 13 例 + library 7 例）、`wails build` 成功。
> 视觉基线见 `doce/BookEditor-前端界面示例-v0.2.8-书架分类与清空确认.html`（可交互，交互口径即本文口径）。
> 上游版本：v0.2.7（拖拽打开，A71–A74 待真机）。本版不改动阅读器渲染链路。
> 需求来源：用户 2026-10-22 真机反馈 —— ① 清空记录需二次确认；② 清空需支持自选图书；③ 图书可分类，用户可自定义分类，有初始分类模板，模板里没书时不显示。

---

## 1. 需求拆解与功能编号

| 编号 | 需求 | 本版口径 |
|---|---|---|
| **F25** | 清空记录二次确认 | 「清空」不再直接清空：先打开**管理对话框**，其中「清空全部…」再进入**二次确认面板** |
| **F26** | 清空支持自选图书 | 管理对话框面板一为**自选清除列表**（复选框 + 全选 + 「移除所选(N)」），可只删部分记录 |
| **F27** | 图书分类 | 每本图书可归入一个分类；卡片左下角标签 ▾ 打开「移至分类」菜单 |
| **F28** | 自定义分类 | 预设模板之外可新建分类；菜单内就地输入，回车即创建并移入 |
| **F29** | 初始分类模板 | 内置预设分类：小说 / 技术 / 资料 / 诗集 |
| **F30** | 空分类不显示 | 分类页签按「该书数量 > 0」过滤，含预设、自定义、「未分类」 |

---

## 2. 现状（据代码核实）

| 面 | 现状 | 影响 |
|---|---|---|
| 书架存储 | `frontend/src/utils/library.ts`，localStorage 键 `bookeditor.library.v1`，`{version:1, entries:LibraryEntry[]}`；`loadLibrary` 对 `version !== 1` 整体回落 `[]` | 新增**可选**字段可保持 `version:1`，旧数据向后兼容 |
| 条目模型 | `LibraryEntry = {path,name,format,size,mtime,lastOpen,position,progress}`，path 为主键 | 分类以可选 `cat?: string` 追加 |
| 清空 | `clearLibrary()` 全量清空；入口两处：书架头部「清空」（`BookViewer.tsx:92`）与设置高级页「书架记录」二态确认（`SettingsPanel.tsx:249`） | 高级页二态确认（D29）被更强对话框取代，**e2e 脚本需同步改写** |
| 单本移除 | `removeEntry(path)` + 卡片 ✕（`BookViewer.tsx:133`） | 保留；新增批量版 |
| 订阅 | `subscribeLibrary(fn)`（同页 listeners + `storage` 事件） | 分类变更走同一广播，书架/设置计数自动跟随 |
| 样式 | `.shelf-grid` 已改 `repeat(3, minmax(0,1fr))`（v0.2.7 D58） | 新分类行/标签/菜单沿用现有 CSS 令牌 |

---

## 3. 数据契约

### 3.1 书架条目扩展（`utils/library.ts`）

```ts
export type LibraryEntry = {
  path: string; name: string; format: BookFormat;
  size: number; mtime: number; lastOpen: number;
  position: ReadingPosition | null;
  progress: number;
  /** v0.2.8：分类名；缺省/空串 = 未分类。存分类名而非 id，删除分类时无需改写全部条目 */
  cat?: string;
};
```

- 存储键与 `version` **均不变**（`bookeditor.library.v1` / `1`）。`normalizeEntry` 增：
  `cat: typeof r.cat === "string" && r.cat.trim() ? r.cat.trim() : undefined`。
- 新增 API（**批量单次写盘、单次广播**，见 D59）：
  - `setEntryCategory(path: string, cat: string | undefined): LibraryEntry[]`
  - `setEntriesCategory(paths: string[], cat: string | undefined): LibraryEntry[]`
  - `removeEntries(paths: string[]): LibraryEntry[]`
  - `clearLibrary()` 保持语义；另需清分类引用 → 条目全删即无引用，无需额外处理。

### 3.2 分类清单（新增 `utils/categories.ts`）

```ts
export const PRESET_CATEGORIES = ["小说", "技术", "资料", "诗集"] as const;
export const UNCLASSIFIED = "未分类";
export const ALL_TAB = "全部";
export const CATS_KEY = "bookeditor.cats.v1";   // { version: 1, custom: string[] }
export const CAT_NAME_MAX = 12;
```

- **预设分类为代码常量，不落盘**（见 D61）。
- API：`loadCustomCategories()`、`addCategory(name): {ok:boolean; reason?:string}`、`removeCategory(name)`、`renameCategory(old,new)`、`subscribeCategories(fn)`。
- 名称校验：trim 后非空、长度 ≤ 12、不得与预设或已有自定义重名、不得为保留字 `未分类` / `全部`（见 D62）。
- 派生纯函数（可单测）：
  `visibleCategories(entries, custom): { name: string; count: number }[]`
  —— 顺序 `["未分类", ...PRESET, ...custom]`，仅保留 `count > 0`；「全部」由调用方单独渲染（恒显示，计数 = 总数）。

### 3.3 不变项

- Go 侧**零改动**：分类与清空均为纯前端 localStorage 数据，无新增绑定。
- `main.go`、`app.go`、`SupportedExts` 不受影响。

---

## 4. 交互口径（与 HTML 示例逐条对齐）

**管理对话框（ShelfManager）**
1. 入口：书架头部「清空」、设置高级页「书架记录」行「清空」→ 均打开同一对话框（App 层渲染）。
2. 面板一「自选清除」：逐条列出全部记录（封面首字母、书名、分类徽标、相对时间、进度），复选框 + 表头「全选」；底部信息「已选 N / M 条」，按钮「移除所选(N)」（N=0 时禁用）、「清空全部…」。
3. 面板二「二次确认」：文案「将删除全部 **M** 条阅读记录与对应阅读位置。」+ 「此操作不可恢复」；按钮「返回」/「确认清空」。
4. 取消路径：Esc、点击遮罩、「取消」——均不改动数据。
5. 移除所选**不再二次确认**（作用范围由勾选显式表达，等价单本 ✕ 的批量版）；仅「清空全部」需二次确认。

**分类**
6. 书架头部下方新增分类页签行：`全部 N` + 各非空分类 `名称 N` + 「＋ 新建分类」+ 提示文案「空分类自动隐藏 · 点击卡片左下角标签可归类」。
7. 点页签即过滤网格；`全部` 为默认。当前分类下无书时显示空态文案。
8. 卡片左下角标签显示当前分类名 + ▾；点击打开「移至分类」菜单：`未分类` + 全部预设 + 全部自定义（右侧显示各类计数，当前项打 ✓），底部「＋ 新建分类…」→ 菜单内就地输入，回车创建并移入该本。
9. 页签行的「＋ 新建分类」同样为就地输入；新建后若尚无图书，页签**不显示**（提示「已创建分类「X」（有图书后显示页签）」）。
10. 卡片 ✕ 单本移除保留，行为不变。

---

## 5. 逐文件实现

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/categories.ts` | **新增**：常量、`CATS_KEY` 读写 + 校验、增删改、`subscribeCategories`、`visibleCategories` 纯函数 |
| `frontend/src/utils/library.ts` | `LibraryEntry` 加 `cat?`；`normalizeEntry` 校验；新增 `setEntryCategory` / `setEntriesCategory` / `removeEntries`（批量） |
| `frontend/src/components/ShelfManager.tsx` | **新增**：管理对话框（面板一自选清除 / 面板二二次确认），受控于 `open` + `entries`，回吐 `onRemove(paths)` / `onClearAll()` |
| `frontend/src/components/BookViewer.tsx` | 书架：新增分类页签行（受控 `currentCat`）；卡片加分类标签 ▾ + 归类菜单；网格按 `currentCat` 过滤；「清空」改调 `onOpenManager` |
| `frontend/src/components/SettingsPanel.tsx` | 高级页「清空」改调 `onOpenManager`；**移除**二态确认状态机（`confirmClear` / `clearTimer` / `clearShelfBtnRef`）；`shelfFlash` 反馈保留 |
| `frontend/src/App.tsx` | 新增 `showShelfManager` state 与 `currentCat` state；`handleRemoveEntries(paths)`、`handleAssignCategory(path, cat)`、`handleClearAll`；渲染 `<ShelfManager>`；透传给 `BookViewer` 与 `SettingsPanel` |
| `frontend/src/styles.css` | 新增 `.cat-row/.cat-chip/.cat-chip.active/.cat-add/.cat-hint/.cat-tag/.cat-menu/.menu-item/.menu-sep/.menu-new/.cat-input`；对话框 `.clear-modal/.clear-item/.ci-*/.confirm-*`；复用 `.modal-mask` 与 `.btn-danger/.btn-danger-solid` |
| `frontend/src/utils/__tests__/categories.test.ts` | **新增**单测：重名拒绝、保留字拒绝、长度上限、空分类可见性派生、删除分类后计数 |
| `frontend/src/utils/__tests__/library.test.ts` | 补：`cat` 归一化（空串/超长/缺失）、`setEntriesCategory` 批量、`removeEntries` 批量、批量写盘只触发一次订阅 |

---

## 6. 验收映射（建议 A75–A82）

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A75 | 点书架「清空」→ 打开管理对话框并列出全部记录 | 手动真机 + 截图 | 代码已落地，待真机 |
| A76 | 勾选 2 条 →「移除所选(2)」→ 仅该 2 条消失，其余保留，计数同步 | 手动真机 | 代码已落地，待真机 |
| A77 | 「清空全部…」→ 二次确认面板显示条数 →「确认清空」→ 书架整区隐藏；「返回」不删 | 手动真机 | 代码已落地，待真机 |
| A78 | 取消路径（Esc / 遮罩 /「取消」）均不改动数据 | 手动真机 | 代码已落地，待真机 |
| A79 | 新建分类「哲学」→ 无书时页签不显示；移入 1 本后页签显示 | 手动真机 | 代码已落地，待真机 |
| A80 | 预设「诗集」无书 → 不显示；移入后显示 | 手动真机 / 单测（`visibleCategories`） | 代码已落地，待真机 |
| A81 | 点分类页签 → 网格仅显示该分类图书 | 手动真机 | 代码已落地，待真机 |
| A82 | 重启应用后分类归属与页签状态保持 | 手动真机 | 代码已落地，待真机 |

**自动化覆盖**
- 单测：`categories.test.ts` **13 例**（名称校验、预设只读、损坏数据过滤、空分类可见性派生）+ `library.test.ts` 补 **7 例**（`cat` 归一化、批量归类/移除单次广播、旧数据兼容）。合计 134/134 通过。
- e2e：按 D60 改写 `smoke_shelf.py` 的 `clear_shelf_via_settings`（改为打开对话框后按固定尺寸推算坐标点击「清空全部…」→「确认清空」，两击同一坐标）；`smoke_settings.py` 注释同步。**分类相关断言（A79–A82）尚未纳入 e2e 自动门禁**——分类页签/标签菜单为动态数量元素，坐标需真机标定后再补 `sm-shelf-08…11`。

---

## 7. 偏差与风险

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D59 | 批量操作逐条写盘 | 改为 `removeEntries` / `setEntriesCategory` **批量单次写盘 + 单次广播** | 逐条循环会 N 次 `JSON.stringify` 全量数组并触发 N 次订阅，书架重排闪烁；批量化后一次完成 |
| D60 | 设置高级页二态确认清空（D29） | 被管理对话框取代；`confirmClear` 状态机移除 | 对话框已提供更强确认（显式条数 + 二次确认面板）；**代价**：`smoke_shelf.py` sm-shelf-04 与 `smoke_settings.py` 的键盘/坐标步骤失效，须同步改写 |
| D61 | 预设分类可删除 | 预设为**只读模板**，不可删、不可改名；仅自定义分类可删 | 预设为初始模板，删除后无法恢复；与「有初始的分类模板」需求一致 |
| D62 | 分类名自由 | trim 后 1–12 字符；禁止与预设/已有重名；保留字「未分类」「全部」禁用 | 避免与页签语义冲突及 UI 溢出 |
| D63 | 删除自定义分类 | 其中图书**转入「未分类」**并需二次确认 | 直接删类会连带丢失归属信息；转入未分类为无损降级 |
| D64 | 分类存 id | 存**分类名字符串** | 分类量小（预设 4 + 自定义若干），存名免去映射表与 id 迁移；代价是改名需批量改写条目（`renameCategory` 内部处理） |

**风险**
- 分类数据仅存 localStorage：与书架同生命周期，清书架后自定义分类保留（合理，模板可复用）。
- 旧版本数据（无 `cat`）解析为「未分类」，页签在**有未分类书时**才显示——符合空分类隐藏口径。
- 对话框与设置面板可同时可见（从设置打开时）：`ShelfManager` 层级高于 `SettingsPanel`，Esc 优先关最上层。

---

## 8. 实施步骤

| 步骤 | 内容 | 完成判据 |
|---|---|---|
| 步骤 | 内容 | 完成判据 | 状态 |
|---|---|---|---|
| T1 | 视觉基线 HTML（`doce/BookEditor-前端界面示例-v0.2.8-书架分类与清空确认.html`） | 与本文 §4 口径一致，可交互 | ✅ 已产出（749 行，标签结构校验通过） |
| T2 | `utils/categories.ts` + 单测 | `categories.test.ts` 全绿 | ✅ 13/13 |
| T3 | `library.ts` 扩展（`cat?`、批量 API）+ 单测补例 | `library.test.ts` 全绿 | ✅ 29/29（+7 例） |
| T4 | `ShelfManager.tsx` 对话框 | tsc 通过 | ✅ |
| T5 | `BookViewer.tsx` 分类页签 + 卡片标签菜单 + 过滤 | 真机 A79–A81 | ✅ 代码落地（真机待验） |
| T6 | `SettingsPanel.tsx` 清空改入口 + 移除二态确认；`App.tsx` 接线 | 真机 A75–A78 | ✅ 代码落地（真机待验） |
| T7 | `styles.css` 新增样式（沿用 D58 的 `minmax(0,1fr)` 网格） | 三列等宽不回退 | ✅ 网格未改动 |
| T8 | e2e 脚本改写（D60）+ 真机验收回填 | `smoke_shelf.py` / `smoke_settings.py` 通过 | ⚠️ 脚本已改写，**真机未跑**；分类断言待标定 |

**DoD**：`tsc --noEmit` PASS ✅、`vitest run` 134/134 ✅、`wails build` 成功（13.6 MB）✅、A75–A82 真机通过 ⏳、本文 §6 状态列回填 ✅、整合文档 §2/§11/§12 补 v0.2.8 行与 D59–D64 ✅。

### 实施期补充说明（非偏差，记录以对齐 HTML 基线）

- **卡片底部留白**：HTML 基线中 `.shelf-card` 为 `padding:10px`，分类标签（`bottom:7px`）会与进度行重叠；实现改为 `padding:10px 10px 26px`，HTML 基线同步未改（基线以交互口径为准，像素细节以实现为准）。
- **对话框固定尺寸**：`.shelf-manager` 定为 `560×420`（同 `.settings-dialog` 做法），底部按钮 `min-width:120px` 右对齐——使 e2e 可按「居中 + 固定宽高」推算按钮坐标，规避 WebView2 连续按键丢事件（smoke 脚本已实证该竞态）。
- **`hidden` 强制生效**：面板容器为 flex，需 `.shelf-mgr-body[hidden]{display:none!important}`，否则 `display:flex` 覆盖 UA 的 `display:none`。
- **Esc 分层**：`ShelfManager` 在**捕获阶段**监听 Esc 并 `stopPropagation`，从设置面板打开时只关最上层。

---

## 9. 本期不做（后续候选）

- 拖入目录自动挑书、多标签/多分类（一本归多类）。
- 分类拖拽排序、分类图标/配色。
- 分类与书架的云同步（当前纯本机）。
- 管理对话框内的搜索/按格式筛选（条目达上限 50 条后再评估）。
