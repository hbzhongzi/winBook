# BookEditor v0.2.6 翻页按钮显隐优化落地说明

> 版本：v0.2.6　时间：2026-10-22　来源：用户反馈「翻页按钮自动隐藏逻辑需优化（移向按钮途中被隐藏）」
> 上位文档：`doce/BookEditor-v0.1.0-整合项目文档.md`（事实入口）

## 1. 本轮范围

- 翻页按钮（`.txt-pager` / `.epub-pager`）显隐状态机优化：把「悬停」升为一级状态，消除「鼠标移向按钮途中按钮自动隐藏、需再动一下才能唤回」的痛点。
- 抽离共享 hook `usePagerVisibility`，消除 TextViewer / EpubViewer 两份重复 timer 实现（此前 D50 即因只改一边踩坑）。
- 单页（TXT 翻页模式 `totalPages<=1`）整组不渲染，消除「两个灰按钮挂白书」噪音。
- 顺带收口 v0.2.5 验收期发现的两个 PDF 产品 bug（D51/D52），与本轮同构建。

## 2. 数据契约

无新增持久化字段。仅前端交互状态（hook 内部 `visible` 布尔 + `pagerElRef` 指向按钮组 DOM）。

常量（`usePagerVisibility.ts`）：
- `PAGER_IDLE_HIDE_MS = 2500`：最后一次「非悬停」交互后闲置淡出（与原 F21 一致）。
- 命中测试：容器 `mousemove` 中若 `e.target` 落在 `pagerElRef` 按钮组内（含子孙）即判定悬停、暂停隐藏计时；**不依赖 `mouseenter`/`mouseleave`**。

> 设计演进（见 D53）：初版用 `onMouseEnter`/`onMouseLeave` 判定悬停，真机 A64 失败——WebView2 对 `SetCursorPos` 合成输入不派发 enter/leave 事件，悬停态永不触发。改为容器 `mousemove` 命中测试后，悬停判据重新可靠。

## 3. 逐文件实现

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/usePagerVisibility.ts` | **新增**。命中测试状态机：`show(e?)`（任意交互复现；传入 MouseEvent 且 `e.target` 落在按钮组 DOM 内 → 悬停态暂停隐藏、不启动计时；否则启动 `PAGER_IDLE_HIDE_MS` 闲置计时）、`setPagerEl`（ref 回调，登记按钮组 DOM 供命中测试）、卸载清理。 |
| `frontend/src/components/TextViewer.tsx` | 删除内联 `[pagerVisible,setPagerVisible]` + `pagerHideTimer` + `useEffect` 清理；改用 `usePagerVisibility()`；`mousemove` 监听从 `pageRef`（正文区，与 pager 为兄弟节点、收不到 pager 事件）上移到 `sectionRef`（二者共同祖先，命中测试才能覆盖按钮组）；pager `div` 加 `ref={pager.setPagerEl}`（替换 `onMouseEnter/onMouseLeave`）；`totalPages>1` 时才渲染 pager。清理无用 `useCallback` import。 |
| `frontend/src/components/EpubViewer.tsx` | 同上；`mousemove` 监听从 `containerRef` 上移到 `sectionRef`（pager 为 container 兄弟节点）；pager `div` 改 `ref={pager.setPagerEl}`；iframe 内 `postMessage` 转发链路（`__readerPager` → `setPagerShowHandler`）保留，handler 指向 `pager.show`。 |
| `frontend/src/styles.css` | 删除 `.txt-pager:hover` / `.epub-pager:hover` 兜底规则；显隐完全由 `.show` 类（JS 状态机）控制。 |

## 4. 验收映射

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A60 | 按钮组贴底悬浮不遮挡正文 | `verify_pager.py` 像素实证 | 既有通过 |
| A61 | 2.5s 闲置自动隐藏 / 鼠标移动复现 / 点击生效 | `verify_pager.py` | 既有通过 |
| A62 | window 级 ArrowRight 翻页（焦点在正文外） | `verify_pager.py` | 既有通过 |
| A63 | iframe 内焦点 ArrowRight 经转发仍生效 | `verify_pager.py` | 既有通过 |
| **A64** | **悬停按钮组并停留 >2.5s 不自动隐藏** | `verify_pager.py` 新增 | 待重跑（命中测试重构后） |
| **A65** | **移出按钮组后恢复 2.5s 闲置计时隐藏** | `verify_pager.py` 新增 | 待重跑（命中测试重构后） |
| A64–A70 | TXT/PDF 快捷键、面板豁免、录制交互 | `verify_hotkeys.py`（D51/D52 修复后重跑） | 待真机 |

> A64/A65 真机轨迹：初版（enter/leave）run2 结果 A65 PASS（diff=73）、A64 FAIL（diff=143）；重构为 `section` 命中测试后需重跑确认 A64 转绿。

## 5. 偏差记录

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D51 | 滚动模式 `onReady` 应触发 | PDF 滚动模式 `renderScrollPage` 的 `finally` 从未调用 `fireReady` → 加载遮罩 10s 不消失、吞点击，A65/A66 模式点击无响应 | 补 `finally: fireReady()`；`load` effect catch 内也 `fireReady()` |
| D52 | 滚动虚拟化渲染守卫 | 旧守卫 `canvas.width===0 && canvas.height===0` 恒假（新挂载 canvas 默认 300×150）→ `renderScrollPage` 从不被调用 → 整页空白（A66 全白） | 改以 `renderedRef`（`Set<number>`）判据：未渲染才调用；释放循环 `renderedRef.delete(i)` + `clearScrollPage`；`load` effect 内 `renderedRef.clear()` |
| D53 | 悬停用 `onMouseEnter`/`onMouseLeave` 判定 | 真机 A64 FAIL：WebView2 对 `SetCursorPos` 合成输入不派发 `mouseenter`/`mouseleave`，悬停态永不触发、移入按钮组后 2.5s 仍被隐藏 | 废弃 enter/leave，改为容器 `mousemove` 命中测试（`pagerElRef.contains(e.target)` 即悬停暂停计时）；监听元素上移到 `section`（pager 与正文区为兄弟，监听挂在非祖先节点收不到按钮组事件） |

> D51/D52 源于 v0.2.5 `verify_hotkeys` 真机（15/28 失败）暴露，与本轮翻页显隐优化同一次构建收口。D53 为翻页显隐优化自身设计修订。

## 6. 已知风险与待真机验证

- A64/A65 经 `verify_pager.py` 覆盖，已在命中测试重构后待本机真机重跑确认。
- A64–A70 依赖 `verify_hotkeys.py` 在 D51/D52 修复后全量重跑（含首轮失败内置重试）。
- 单页不渲染（P2）改变「按钮恒在布局」现状；仅 TXT 翻页模式生效，EPUB 仍按章节持续展示 pager。

## 7. 文件改动清单

新增：`frontend/src/utils/usePagerVisibility.ts`、`doce/BookEditor-v0.2.6-翻页按钮显隐优化落地说明文档.md`
修改：`frontend/src/components/TextViewer.tsx`、`frontend/src/components/EpubViewer.tsx`、`frontend/src/styles.css`
诊断脚本整理：`e2e/` 一次性 `probe_*/dbg_*/calib_*/scroll_*/wheel_*` 移入 `e2e/_debug/`（见整合文档 §11）。
