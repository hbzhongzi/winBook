# BookEditor v0.2.0 个性化功能落地方案

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1（P0 已落地，回填状态） |
| 更新日期 | 2026-10-20 |
| 设计基线 | `doce/BookEditor-前端界面示例.html`（设置面板个性化重构版） |
| 关联文档 | `doce/BookEditor-v0.1.0-整合项目文档.md`、`doce/BookEditor-v0.2.0-个性化功能落地说明文档.md` |
| 状态 | P0 已落地（2026-10-20：单测 43/43、GUI 冒烟 6/6）；P1/P2 待排期 |

## 1. 背景与目标

v0.1.0 已落地第一项设置「EPUB 预加载章节数」（`frontend/src/utils/settings.ts` + `SettingsPanel.tsx`，持久化于 `bookeditor.settings.v1`）。当前设置面板为单列表单，用户反馈需要更完整的个性化设计。

本方案以重新设计的前端界面示例（HTML）为设计基线，分阶段把个性化能力落入真实工程。目标约束：

- 全部设置本地持久化，不上传、不联网；
- 每项设置可单独关闭/回退，不允许"改了关不掉"；
- P0 功能必须有单元测试与真书回归，不允许只做 UI 壳子。

## 2. 设计基线：设置面板结构

更新后的示例 HTML 将设置面板重构为「双栏 + 三分类」：

| 区域 | 内容 | 交互 |
|---|---|---|
| 左栏 | 阅读体验 / 界面外观 / 高级 | 点击切换右栏 |
| 阅读体验 | 章节预加载（步进器 + 快捷档位 + 窗口预览图 + 内存预估）；阅读位置记忆（v0.2 标记，禁用态） | 步进/点选即时刷新预览 |
| 界面外观 | 主题卡片（浅色/深色/护眼/羊皮纸）、强调色 6 色板、正文字号滑块（13–20px，带实时预览） | 选中态即时可见；色板切换即时改变面板强调色 |
| 高级 | 恢复默认、版本、存储位置、数据收集说明 | 重置恢复全部默认 |
| 底部 | 取消 / 保存 + 保存后轻提示 | Esc、点遮罩、点 × 均可取消 |

组件映射（HTML → 真实工程）：

| HTML 元素 | 真实组件 |
|---|---|
| `.settings-dialog` 整体 | `SettingsPanel.tsx` |
| `.win-preview` 窗口预览图 | `chapterWindow.ts` 暴露当前窗口章节列表后渲染 |
| `.theme-card` 主题卡片 | `SettingsPanel` + `styles.css` 的 `data-theme` 分支 |
| `.swatch` 色板 | `SettingsPanel` + App 层设置 `--accent` |
| `#fontSize` 滑块 | `SettingsPanel` + Viewer 应用 |

## 3. 功能清单与优先级

### P0（v0.2.0 首个迭代，对应 HTML 全部可交互项）

| 编号 | 功能 | 生效范围 | 默认值 |
|---|---|---|---|
| F1 | 章节预加载增强：快捷档位（0/1/2/3/5）、章节窗口预览图、内存预估文案 | EPUB | 2（不变） |
| F2 | 阅读主题：浅色 / 深色 / 护眼 / 羊皮纸 | EPUB、TXT 正文 + 应用框架 | 浅色 |
| F3 | 界面强调色：6 色（蓝/靛/绿/琥珀/玫红/青） | 应用框架（按钮、目录高亮、选中态） | 蓝 #2563eb |
| F4 | 正文字号：13–20px | EPUB、TXT 正文 | 14px |

### P1（v0.2.x）

| 编号 | 功能 | 说明 |
|---|---|---|
| F5 | 阅读位置记忆 | EPUB 存 CFI、TXT 存 scrollTop、PDF 存页码；再次打开恢复。HTML 中已用「v0.2」标记占位。**已展开为独立方案：`doce/BookEditor-v0.2.1-书架与阅读位置记忆落地方案.md`（含书架记录；位置单位以该文档为准——EPUB 用章节内比例而非 CFI）** |
| F6 | 正文字体 | 系统 / 宋体 / 楷体，作用于 EPUB、TXT |
| F7 | 目录侧栏宽度记忆与显隐 | EPUB 专用 |
| F11 | 阅读模式切换：横向翻页 ⇄ 纵向滚动（三格式统一受控的个性化设置） | 全局。**已展开为独立方案：`doce/BookEditor-v0.2.2-阅读模式切换落地方案.md`** |

### P2（v0.3+）

| 编号 | 功能 | 说明 |
|---|---|---|
| F8 | PDF 默认缩放与外围背景色记忆 | PDF 专用 |
| F9 | 键盘快捷键自定义 | 全局 |
| F10 | 设置导入 / 导出 | 全局 |

## 4. 技术方案

### 4.1 设置数据模型 v2

`settings.ts` 的 `Settings` 扩展为：

```ts
export type Settings = {
  epubPreloadCount: number;   // 0–10，默认 2（v1 已有）
  theme: "light" | "dark" | "eye" | "sepia";  // 默认 light
  accent: string;             // 十六进制色值，白名单 6 色，默认 #2563eb
  fontSize: number;           // 13–20，默认 14
  // P1 预留
  fontFamily?: "system" | "song" | "kai";
  rememberPosition?: boolean;
  tocSidebarWidth?: number;
};
```

- 存储键升级为 `bookeditor.settings.v2`；`loadSettings()` 读取时若 v2 不存在则尝试迁移 v1 的 `epubPreloadCount`，其余取默认值。v1 键只读保留，不删除。
- 每个字段独立校验：枚举走白名单，数值走 clamp，非法值静默回退默认（与现有 `clamp()` 行为一致）。
- `saveSettings()` 广播全量 `Settings` 的订阅机制不变，新增字段自动获得"即时生效"通道。
- 单测补齐：迁移、白名单拒绝、损坏 JSON、每字段边界。

### 4.2 主题与 CSS 变量架构

令牌分两层，全部定义在 `frontend/src/styles.css`：

- 框架层：`--accent` / `--accent-hover` / `--bg` / `--window-bg` / `--text` / `--border` 等（现有变量沿用）。
- 阅读层（新增）：`--reading-bg` / `--reading-text` / `--reading-text-2` / `--reading-border` / `--reading-line`。

挂载方式：

```css
:root[data-theme="dark"] {
  --reading-bg: #1f2937; --reading-text: #e5e7eb; ...
}
```

- 应用启动与设置变更时，由 App 层执行 `document.documentElement.dataset.theme = settings.theme` 并设置 `--accent` / `--accent-hover`（与 HTML 示例中色板切换的实现同思路，挂在 `:root` 而非对话框）。
- 需要盘点的硬编码位置：`.txt-viewer`（`#374151`）、`.pdf-canvas-area`（`#eef1f5`）、`.epub-content`（无背景）、`.toc-item` 颜色等，统一改为阅读层/框架层令牌。深色主题下 PDF 画布外围背景跟随框架层，画布内容保持原样（预期行为，见风险节）。

### 4.3 EPUB 内容注入（关键路径）

epubjs 的 iframe 是独立文档，宿主的 CSS 变量不会渗入。采用官方 `hooks.content` 注入（`EpubViewer.tsx` 已有该钩子的使用先例）：

1. `rendition.hooks.content.register(fn)`，每次新章节文档加载后触发；
2. 在 `contents.documentElement` 上设置 `data-theme`，并追加一段物化样式的 `<style>`：**跨文档 CSS 变量不继承，必须把主题令牌解析成具体值写入**；
3. 字号、字体同样经该 `<style>` 作用于 `body`；
4. 注入文本按当前设置拼装后缓存，避免每章重复字符串拼接。

层叠取舍：书籍自带 CSS 与用户主题冲突时，用户显式意图优先——注入样式置于文档 `<head>` 末尾并对 `body` 颜色使用 `!important`。这是有意为之的优先级决策，记入偏差而非缺陷。

### 4.4 各格式适配矩阵

| 设置 | EPUB | TXT | PDF |
|---|---|---|---|
| F1 预加载 | ✔ | — | — |
| F2 主题 | ✔（hooks 注入） | ✔（直接 CSS） | 仅外围背景 |
| F3 强调色 | ✔ | ✔ | ✔（框架层） |
| F4 字号 | ✔（hooks 注入） | ✔ | —（PDF 用缩放） |
| F5 位置记忆 | ✔（CFI） | ✔（scrollTop） | ✔（页码） |

### 4.5 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/settings.ts` | v2 模型、v1→v2 迁移、新字段校验、单测扩展 |
| `frontend/src/components/SettingsPanel.tsx` | 双栏分类、步进器 + 快捷档位、主题卡片、色板、字号滑块、窗口预览、恢复默认 |
| `frontend/src/App.tsx` | 托管 `settings` 状态；`theme`/`accent` 应用到 `documentElement`；订阅转发给 Viewer |
| `frontend/src/components/BookViewer.tsx` | 透传 `settings` 到各 Viewer |
| `frontend/src/components/TextViewer.tsx` | 应用阅读层背景/文字色/字号/字体 |
| `frontend/src/components/EpubViewer.tsx` | 应用阅读层注入（主题/字号/字体）；暴露窗口章节列表供预览图 |
| `frontend/src/utils/chapterWindow.ts` | 新增 `getWindowSections()`（只读快照，供预览图） |
| `frontend/src/styles.css` | 阅读层令牌、`data-theme` 分支、硬编码色盘点改造 |

## 5. 任务拆分与完成定义

| 任务 | 内容 | DoD |
|---|---|---|
| T1 | 设置模型 v2 + 迁移 | 单测覆盖迁移/白名单/边界；`npm test` 通过 |
| T2 | 主题令牌 + 框架层切换 | TXT 四种主题截图正确；强调色切换框架层全部跟随 |
| T3 | EPUB hooks 注入 | 真书《关键对话》四种主题、字号 13/17/20 截图正确；书籍自带样式冲突处按 4.3 取舍记录 |
| T4 | 强调色 | 6 色逐一回归按钮/目录高亮/选中态 |
| T5 | 设置面板重构 | 与 HTML 示例结构一致；Esc/遮罩/取消不落库；保存后 toast；重置恢复默认 |
| T6 | 阅读位置记忆（P1） | 打开→滚动→关闭→重开恢复；CFI 失效时降级到章节首 |
| T7 | 回归与文档回写 | 全场景 e2e（txt/pdf/epub/errors）+ 单测；整合文档新增个性化章节与验收项 |

## 6. 验收标准（新增）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A19 | 主题切换 | EPUB/TXT 立即变色，无需重开图书 |
| A20 | 主题持久化 | 关闭重开应用后主题保持 |
| A21 | 强调色 | 框架层所有强调元素跟随，无遗漏硬编码 |
| A22 | 字号 | EPUB/TXT 生效； clamping 边界不崩 |
| A23 | 预加载档位 | 0/1/2/3/5 点选后窗口章节数与预览图一致 |
| A24 | 设置取消 | 取消后重新打开面板显示旧值 |
| A25 | 恢复默认 | 一键回默认并立即生效 |
| A26 | 迁移 | 装有 v1 设置的机器升级后预加载值保留 |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 书籍 CSS 覆盖主题注入 | 主题"看起来没生效" | 4.3 的 `!important` 取舍 + 真书四主题截图验收 |
| 深色主题下彩色封面/插图突兀 | 观感下降 | 默认不处理图片元素，记入已知取舍；后续可加"图片反色"开关（P2） |
| 注入影响章节加载性能 | 翻页卡顿 | 注入文本按设置缓存；每文档仅一次 |
| 设置升级丢字段 | 用户设置丢失 | v2 迁移 + 未知字段忽略而非抛错 |
| PDF 画布内容颜色不可改 | 主题不完整 | 仅声明"PDF 改外围背景"，文档预期内 |

## 8. 当前实现状态与偏差（如实记录）

> 本章为方案评审时的基线快照。P0 已于 2026-10-20 落地，落地后的真实偏差以 `doce/BookEditor-v0.2.0-个性化功能落地说明文档.md` 第 9 章（D20–D24）与整合文档 8.4 验证状态为准。

- ~~`settings.ts` 当前为 v1（仅 `epubPreloadCount`，56 行），`SettingsPanel.tsx` 为单列表单（79 行）；本方案 T1/T5 即对这两处的升级。~~ **已落地**：`settings.ts` 重写为 v2 四字段 + 迁移 + 白名单校验，`SettingsPanel.tsx` 重构为双栏三分类。
- ~~`EpubViewer.tsx` 当前仍带调试插桩（`onSyncState` 把窗口状态输出到状态栏、`evictOutside` 的诊断回调），章节窗口化在真书回归中尚未完全稳定（多轮滚动后存在卡死现象，定位中）。个性化功能应在窗口化稳定、插桩移除后合入，避免叠加回归面。~~ **部分解决**：插桩已按 D24 改为 DEV 门控（`wails dev` 保留诊断、`wails build` 零调试输出）；**章节窗口化滚动卡死缺陷仍未修复**，单独跟踪，见落地说明文档第 11 章。
- HTML 示例中「阅读位置记忆」标记为 v0.2，对本方案即 F5/T6；如迭代排期变化，以本文档为准并同步更新 HTML 标记。**实际**：P0 面板中以禁用开关 + v0.2 路线图标签占位，F5 随 P1 排期。
