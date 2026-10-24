# BookEditor v0.2.5 翻页导航与快捷键优化落地说明文档

| 项 | 内容 |
|---|---|
| 版本 | v0.2.5（F21/F22/F24 已实施；v0.2.5c 含对话框布局修正、smoke 方法论重构、F21 转发器修复） |
| 状态 | 自动化门禁全绿；设置面板冒烟 7/7、翻页导航验证 7/7 真机通过；TXT/PDF 快捷键与录制交互真机待验 |
| 方案依据 | `doce/_archive/BookEditor-v0.2.5-翻页导航与快捷键优化方案.md`（已归档） |
| 上游 | v0.2.4（settings v3）、v0.2.3（翻页位置）、v0.2.2（阅读模式）、v0.2.1（位置记忆）、v0.2.0（个性化 P0） |

---

## 1. 本轮范围

- **F21 翻页导航重构**（EPUB/TXT）：悬浮贴底 + 2.5s 闲置自动隐藏 + hover/交互复现 + 40×40 触达 + 四主题令牌化；PDF 保持流内控件仅视觉统一（不加自动隐藏，页脚页码需常驻）。
- **F22 快捷键体系 window 级收口**：`readerHotkeys.ts` 纯函数键位模型 + `readerCommands.ts` 命令注册表 + `App.tsx` window 派发（四重豁免）+ EPUB iframe 内键盘 postMessage 转发 + PDF 单页/滚动两模式映射。
- **F24 快捷键自定义**：settings v4 数据模型 + 设置面板新 nav 分类「快捷键」+ 录制式绑定 + 冲突检测 + 恢复默认 + 草稿态保存生效。
- **v0.2.5c 附带修正**（T6 实测暴露，详见 §9 偏差记录）：对话框固定高度 600px（D45）、`smoke_settings.py` 坐标化重构（D47–D49）、F21 iframe mousemove 转发器（D50）。

## 2. 数据契约（settings v4）

```ts
export type HotkeyAction = "prev" | "next" | "home" | "end";
export type HotkeyMap = Record<HotkeyAction, string[]>;   // KeyboardEvent.key 值数组
export type Settings = { /* v3 十字段原样 */ hotkeys: HotkeyMap };
```

- 存储键升 `bookeditor.settings.v4`；新增 `LEGACY_V3_KEY`，加载链 **v4→v3→v2→v1**（v3 及以前只读保留，不删键）。
- `DEFAULT_HOTKEYS`：`prev=[ArrowLeft,PageUp,ArrowUp]`、`next=[ArrowRight,PageDown," ",ArrowDown]`、`home=[Home]`、`end=[End]`。
- `normalizeHotkeyMap` 四步：① 逐动作过滤非法键（非字符串/空串/超长 24/纯修饰与锁定键）、去重、截断至每动作 ≤4；② 跨动作冲突按 canonical 顺序 `prev→next→home→end` 先到先得，后到者剔除该键（存储态被手改出双绑时保证确定性与单触发）；③ 动作键位为空时回落默认（防「变砖」）；④ `Spacebar` 归一化为 `" "`（旧 Chrome 兼容）。
- **`ReadingPosition` 零改动**：键位配置不进位置模型，v0.2.3 契约不变。

## 3. 逐文件实现

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/readerHotkeys.ts` | **新建**。类型/`HOTKEY_ACTIONS`/`HOTKEY_ACTION_LABELS`/`DEFAULT_HOTKEYS`/`MAX_KEYS_PER_ACTION` + 纯函数 `normalizeHotkeyKey`/`resolveHotkeyAction`/`cloneHotkeyMap`/`normalizeHotkeyMap`/`hotkeyKeyLabel`。无 DOM/React 依赖，单测直覆 |
| `frontend/src/utils/settings.ts` | 升 v4：`hotkeys` 字段 + `STORAGE_KEY` v4 + `LEGACY_V3_KEY` + `migrateFromV3/V2/V1` 链 + `normalizeSettings` 增 hotkeys 规范化 + `DEFAULT_SETTINGS` 补 `cloneHotkeyMap(DEFAULT_HOTKEYS)` |
| `frontend/src/utils/readerCommands.ts` | **新建**。单一槽位命令注册表：`setReaderCommandHandler`/`dispatchReaderCommand`（异常吞掉按未消费）；`scrollStepFor`（方向键微滚/翻页键整屏，D46）；v0.2.5c 增 `setPagerShowHandler`/`notifyPagerActivity`（D50） |
| `frontend/src/App.tsx | window 级派发 effect：`keydown` 四重豁免（无书/面板打开/修饰键组合/输入类目标）→ `resolveHotkeyAction(key, settings.hotkeys)` → `dispatchReaderCommand`；`message` 事件消费 iframe 转发的 `__readerHotkey` 与 `__readerPager`（D50）。键位读 `settingsMirrorRef` 实时值，自定义保存即时生效 |
| `frontend/src/components/EpubViewer.tsx` | 注册阅读命令（翻页：prev/next 交 epubjs、home/end 跳目录首/末章；滚动：微滚/整屏/顶/底）；`relocated` 与键盘翻页均调 `showPager()`（R4）；`hooks.content` 注入 keydown + mousemove 两个转发器（WeakSet 防重复）；**移除** stage 级旧键盘监听；v0.2.5c 注册 `setPagerShowHandler(showPager)` |
| `frontend/src/components/TextViewer.tsx` | 注册阅读命令（翻页映射页码、滚动映射容器滚动）；**移除** root 级旧键盘监听 |
| `frontend/src/components/PdfViewer.tsx` | 注册阅读命令：单页模式 prev/next/home/end 映射页码（钳制 1..pageCount），滚动模式映射滚动容器（F22 O3 补齐） |
| `frontend/src/styles.css` | 重写 `.epub-pager`/`.txt-pager`（absolute 贴底 `bottom:10px`、`opacity+visibility` 0.3s 过渡、`.show`/`:hover` 复现、40×40、`--page-shadow`+0.92 透明度、令牌化）；新增 `.hk-row`/`.hk-chip`/`.hk-chip-x`/`.hk-bind`/`.hk-conflict` 快捷键面板样式；v0.2.5c `.settings-dialog { height: 600px }`（D45） |
| `frontend/src/components/SettingsPanel.tsx | 新 nav 分类「快捷键」：动作行（chips + ×删 + 「+ 绑定」）、录制态 window capture 拦截（`preventDefault`+`stopPropagation`，Esc 取消，纯修饰/组合键忽略，Tab 保留焦点导航）、三类冲突行内提示（他动作占用/本动作已绑/超 4 键）、卡片级「恢复默认」；草稿态保存生效 |

**iframe 双转发器**（同一注入点，`isPage` 时生效）：keydown → `{__readerHotkey,key}`；mousemove → 节流 120ms → `{__readerPager}`。监听器函数创建于宿主域，回调内 `window` 即宿主 window，`window.postMessage` 的消息事件落在宿主 `App.tsx` 的 message 监听（A63 实测证实）。

## 4. 键位表与派发链路

**默认键位表**（可自定义）：

| 操作 | 默认键 | EPUB 翻页 | TXT 翻页 | PDF 单页 | PDF 滚动 | EPUB 滚动 |
|---|---|---|---|---|---|---|
| 上一页/上一屏 | `←` `PageUp` `↑` | rendition.prev | page-1 | current-1 | 微滚 80px | 微滚 80px |
| 下一页/下一屏 | `→` `PageDown` `空格` `↓` | rendition.next | page+1 | current+1 | 整屏 90% | 整屏 90% |
| 首页 | `Home` | 目录首章 | 第 1 页 | 第 1 页 | 容器置顶 | 容器置顶 |
| 末页 | `End` | 目录末章 | 末页 | 末页 | 容器置底 | 容器置底 |

**派发链路**（单一事实源）：

```
[宿主 window keydown] --豁免四连--> resolveHotkeyAction --> dispatchReaderCommand --> Viewer 处理器
[iframe 内 keydown]   --注入转发器--> postMessage{__readerHotkey} ──┘
[iframe 内 mousemove] --节流转发--> postMessage{__readerPager} --> notifyPagerActivity --> showPager（D50）
```

- 豁免：无书（欢迎页）、设置面板打开、`Ctrl/Meta/Alt` 组合键（保留 Ctrl+A/C）、`INPUT/TEXTAREA/SELECT/[contenteditable]` 目标。
- 处理器返回 `true` 才 `preventDefault`；未命中键位不拦截，浏览器默认行为不受影响。
- 面板打开时翻页派发整体禁用（豁免条件天然覆盖录制场景，R5/R6）。

## 5. 与位置系统的正交性验证

| 场景 | 机制 | 结论 |
|---|---|---|
| 快捷键翻页（EPUB 翻页） | 命令走 `pagerRef.prev/next`（rendition 通道），位置采集仍是 `relocated` → 章节级 CFI | 位置链路零改动 |
| home/end（EPUB 翻页） | 跳目录首/末章，章节级口径（同 D32） | 与既有恢复粒度一致 |
| 快捷键翻页（TXT/PDF） | 走既有 `setCurrent`/滚动容器，位置采集不变 | 零改动 |
| hotkeys 设置变更 | 纯 settings 字段，不进位置模型、不进 `state-host` key，不触发 Viewer 重挂载 | 不破坏 M8 瞬态保护 |
| settings v4 迁移 | v3 存量十字段原值搬移 + hotkeys 补默认；单测覆盖「v3 存量保真/读回一致」 | 存量零回归（A71） |

## 6. 验收映射

| 编号 | 标准 | 结果 |
|---|---|---|
| A60 | 翻页按钮不遮挡正文 | ✅ 真机：`pv-03` 截图按钮位于正文底部余白区；贴底像素实证（组顶边客户区 y=742，窗口客户高 828） |
| A61 | 2.5s 闲置自动隐藏；移动/翻页/hover 复现 | ✅ 真机 7/7：复现 diff=76、隐藏 diff=76、两次隐藏一致 diff=0、点击按钮生效 diff=39837（深色主题按钮底色与正文同令牌，差异来自边框+字形，阈值口径见脚本注记） |
| A62 | EPUB 翻页：刚打开未点击正文时默认键即生效 | ✅ 真机：焦点在工具栏按钮，ArrowRight 翻页 diff=40767 |
| A63 | EPUB 翻页：焦点在正文（iframe）内时默认键仍生效 | ✅ 真机：点击正文后 ArrowRight diff=37294（postMessage 转发器实测） |
| A64 | TXT 翻页全键位生效 | 代码 ✅ / 真机待验 |
| A65 | PDF 单页默认键翻页正确 | 代码 ✅ / 真机待验 |
| A66 | PDF 滚动 PageDown/空格/Home/End | 代码 ✅ / 真机待验 |
| A67 | 面板打开时翻页键不穿透；Ctrl+A/C 不受影响 | 代码 ✅（四重豁免）/ 真机待验 |
| A68 | 「快捷键」分类：录制绑定/删除/冲突提示/恢复默认 | 代码 ✅；分类可达性与渲染经 `sm-01b` 截图实证；录制交互真机待验 |
| A69 | 自定义键位保存后阅读中即时生效 | 代码 ✅（settings 订阅 → mirror ref 实时读）/ 真机待验 |
| A70 | 自定义键位跨重启保持 | 代码 ✅（v4 持久化）/ 真机待验 |
| A71 | settings v4 迁移：v3 存量保真、hotkeys 补默认、读回一致 | ✅ 单测 7 项 |
| A72 | 单测：hotkeys 校验/冲突消解/迁移 + resolveHotkeyAction 映射 | ✅ readerHotkeys 16 项 + settings v4 7 项 |
| A73 | 门禁五项全绿，既有 86 项无回归 | ✅ 109/109（86 既有 + 23 新增）；tsc/vitest/go test/vite build/wails build 全绿 |

**自动化门禁（2026-10-21 本轮实测）**：`tsc --noEmit` PASS、`vitest` **109/109**（7 文件）、`go test` PASS、`wails build` PASS（`build/bin/book-editor.exe`，13.00 MB，19:32 构建）。
**测试增量明细**：`readerHotkeys.test.ts` 新建 16 项（resolve 4 / normalizeKey 4 / normalizeMap 6 / clone+label 2）；`settings.test.ts` 30→37 项（新增「settings v4（v0.2.5 快捷键自定义）」组 7 项：默认一致/v3 迁移保真/保存读回/过滤去重上限/跨动作冲突/空动作回落/混合互不干扰）。

**e2e 新增**：`e2e/verify_pager.py`（翻页导航 7 断言，F21/F22 真机覆盖）；`e2e/smoke_settings.py` 重构后 7/7（A19/A20/A21 + 复位链路 + 基线 + 快捷键 nav 可达）。

## 7. e2e：smoke 重构与坐标标定（v0.2.5c）

**方法论重构（D47）**：v0.2.0–v0.2.5b 用 Tab/Enter 键盘导航驱动设置面板。实证缺陷：① WebView2 对连续快按 Tab/点击存在随机丢事件竞态（标定实验 c5/c6 复现，单次丢失率约 1/4），Tab 计数路径整体错位；② 鼠标悬停 nav 列使整列染色，干扰选中态像素检测。现方案：**坐标点击 + 选中态像素验证 + 丢点击重试（≤3 次）+ 整轮重试兜底**。

**600px 定高使坐标两维零漂移（D45）**：calib8/calib9 实测——对话框固定后客户区 y 111..710 恒定，nav（197/234/271/308，pitch 37）、主题卡（浅 523/深 639/护眼 755/羊皮 870 × y260）、色板（6 颗 y415）、滑块（y563）、footer（取消 843/保存 910 × y680）、重置（889,250）在「浅色/深色 × 四窗格」八种组合下完全一致；此前 auto 高度下深色主题 nav 实测低 30–70px。

**断言去恒真化（D48）**：v0.2.0 的「工具栏扫绿/蓝」恒真（「打开图书」图标着色强调色，localStorage 残留色恰为绿，扫啥中都）。A21 改采样面板内「保存」主按钮中心色：复位恢复默认蓝 → 切绿 → 保存后变绿（实测 (5,150,105)），真正验证强调色保存链路；重启后再开面板验绿（跨重启持久化）。

**前台保障（D49）**：本机 Navicat 等第三方窗口会抢前台（sm-02 曾截到 Navicat 登录界面，A19/A20 假阴性）；右上角通知弹窗会盖齿轮按钮区。对策：`fg()` 哨兵（force_foreground + `GetForegroundWindow==hwnd` 验证 + 重试）+ `open_file` 后 `move_to(40,60)` 避让 + 采样前 `SetCursorPos(2,2)` 消 hover。

## 8. 已知风险与待真机验证

- **A64–A67 真机未跑**：TXT/PDF 快捷键与「面板打开不穿透/Ctrl+A/C」仅代码与单测层面验证，需补 `verify_*.py` 或人工走查。
- **A68–A70 录制交互真机未验**：录制式绑定、冲突提示、保存后即时生效、跨重启保持均经单测 + 渲染截图覆盖，交互流程待人工。
- **iframe mousemove 节流 120ms**：连续移动时每 120ms 一条 postMessage；低性能机上的消息量未测（当前实测无体感问题）。
- **隐藏态 300ms 过渡期**：`visibility` 过渡期间按钮理论上可被点击（既有取舍，过渡极短）。
- **单字符键绑定**（如把 `a` 绑给翻页）：允许（用户显式意图优先，R7），与未来搜索框的交互需在搜索功能落地时复核。
- **书籍自带键盘处理**：iframe 转发器 `preventDefault` 后书籍自身的按键处理（如自带导航）不再触发（阅读器优先口径）。

## 9. 偏差记录

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D45 | 方案未预见对话框高度问题 | `.modal` 高度 auto + 遮罩垂直居中 → 控件坐标随「主题 × 窗格」漂移（smoke 坐标点击不可复现；深色主题 nav 实测低 30–70px）。修产品代码：`.settings-dialog { height: 600px }` 固定高（内容最高窗格 ≈590 内，超高由 `.settings-panes` 内部滚动消化，`max-height` 小屏保护保留） | v0.2.5c；测试暴露的布局缺陷，修复后 e2e 坐标两维零漂移 |
| D46 | 滚动幅度一律 `clientHeight*0.9` | 区分：方向键微滚 `min(80, 12%viewport)`、翻页键/空格整屏 90%（`readerCommands.scrollStepFor`，传入触发键名） | 避免改变存量滚动模式微操习惯；编号在实现期已写入 4 处代码注释（readerCommands/EpubViewer/PdfViewer/TextViewer），本表沿用 |
| D47 | T6 口径「smoke 复核（新 nav 项影响 Tab 路径，须实测或补注记）」 | 方法论重构：Tab/Enter → 坐标点击 + nav 选中态像素验证 + 丢点击重试 + 整轮重试 | WebView2 连续快按丢事件实证（单次丢失率约 1/4）+ 悬停染色干扰检测 |
| D48 | 未涉及（v0.2.0 遗产断言） | A21 由「工具栏扫绿/蓝」改为「保存」主按钮中心色采样 | 原断言恒真（图标着色强调色 + 残留色巧合），改后验证真链路 |
| D49 | 未涉及（环境问题） | `fg()` 前台哨兵 + `move_to(40,60)` 避让通知弹窗 + 采样前移开鼠标 | Navicat 抢前台导致假阴性（sm-02 截到 Navicat 登录界面） |
| D50 | F21 设计未预见 iframe 覆盖问题 | iframe 覆盖整个内容区 → 宿主 container 的 mousemove 收不到 iframe 内事件 → 自动隐藏后鼠标无法复现导航。修复：经 `hooks.content` 向 iframe 注入节流 120ms 的 mousemove 转发器（`{__readerPager}`）+ `readerCommands` 增 `setPagerShowHandler`/`notifyPagerActivity` 槽位 + App 消息处理器接入 | v0.2.5c；由 `verify_pager.py` 实测发现（修复前复现 diff=0，修复后 diff=76 稳定）；产品代码改动 |

## 10. 文件改动清单

```
frontend/src/utils/readerHotkeys.ts                # 新建：键位模型 + 纯函数（F22/F24）
frontend/src/utils/readerCommands.ts               # 新建：命令注册表 + scrollStepFor + pager 槽位（D50）
frontend/src/utils/settings.ts                     # v4 模型 + 迁移链 + normalize
frontend/src/App.tsx                               # window 派发 effect + message 双转发消费
frontend/src/components/EpubViewer.tsx             # 命令注册 + 移除 stage 监听 + 双转发器注入 + pager 槽位
frontend/src/components/TextViewer.tsx             # 命令注册 + 移除 root 监听
frontend/src/components/PdfViewer.tsx              # 命令注册（单页/滚动两模式）
frontend/src/components/SettingsPanel.tsx          # 快捷键分类 + 录制式绑定 + 冲突检测
frontend/src/styles.css                            # pager 重写 + 快捷键面板样式 + settings-dialog 600px（D45）
frontend/src/utils/__tests__/readerHotkeys.test.ts # 新建 16 项
frontend/src/utils/__tests__/settings.test.ts      # +7 项（v4 组）
e2e/smoke_settings.py                              # 坐标化重构（D47–D49）+ 快捷键 nav 覆盖
e2e/verify_pager.py                                # 新建：F21/F22 真机验证 7 断言（发现 D50）
```
