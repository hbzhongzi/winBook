# BookEditor v0.2.9 — PDF 显示优化开发方案

> 状态：**已实施（code 落地，A83–A95 真机待验）**；并于 2026-10-26 追加 **D71 hotfix**（修复「二次打开/横屏报『PDF 解析失败』、竖屏滚动正常」），见 §6 D71 与 `frontend/src/components/PdfViewer.tsx` 的 `renderTasksRef`/`renderOnCanvas`。本文所有现状结论均来自 2026-10-24 对 `main.go` / `PdfViewer.tsx` / `styles.css` / `StatusBar.tsx` 的实读核对，数值按默认窗口 1280×860（`main.go:39-40`）推算并经脚本复算。
> 视觉基线：`doce/BookEditor-前端界面示例-v0.2.9-PDF显示优化.html`（可交互，含「½ 比例前后对比 / 五态适配实时演算 / 四处缩放入口 / 设置面板同步 / DPR 位图读数」）。
> 触发：用户真机截图反馈「PDF 的显示需要优化」——《微信小程序运营与推广完全自学手册》第 4 页（内容简介 / CIP 页），正文为窄条居中、左右大量空白、页面底部被裁。

---

## 1. 现状与根因（代码实测）

### 1.1 截图现象的数值解释

| 量 | 数值 | 说明 |
|---|---|---|
| 窗口 | 1280 × 860 | `main.go:39-40`（最小 900×600） |
| 工具栏 + 状态栏 + PDF 控制条 | ≈ 137 px | 53 + 31 + 53（`styles.css:84/502/213` 三条 padding+内容推算） |
| `.pdf-canvas-area` 内盒 | ≈ 1236 × 679 | 宽 1280−44；高 860−137=723，再减上下 `padding:22px`×2（`styles.css:191`）= 679 |
| A4 页面（PDF pt = CSS px @72dpi） | 595.28 × 841.89 | 典型中文书版式 |
| **当前渲染尺寸（`SCALE=1.2`）** | **714.3 × 1010.3** | `PdfViewer.tsx:16`、`:263` |
| 横向余量 | 714 < 1236 → **左右各 ≈261 px 空白** | 即截图"内容窄条居中" |
| 纵向溢出 | 1010 > 679 → **底部 331 px 被裁** | 即截图页码 4 内容顶到视口下边 |

**根因一句话：`SCALE = 1.2` 是写死常量（`PdfViewer.tsx:16`），单页/滚动两模式共用，与窗口尺寸、页面尺寸、设备 DPR 三者完全无关。**

### 1.2 逐项缺陷清单（均已核实）

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| G1 | 缩放常量写死 1.2 | `PdfViewer.tsx:16` | 任何窗口/页面组合都不适配；截图窄条+裁底 |
| G2 | 缩放完全不可调 | `PdfViewer.tsx:470` `<span className="zoom-chip">缩放 120%</span>` 是**只读 chip**，无 +/-、无档位、无 Ctrl+滚轮 | 字小无法自救；状态栏文案 `StatusBar.tsx:21` 亦为写死文本 |
| G3 | 无「适宽/适高/双页」概念 | 两模式都只认 `SCALE` | 宽窗下 A4 只能"窄条"或"溢出"，无第三条路 |
| G4 | canvas 按 CSS 像素渲染，未乘 `devicePixelRatio`（全仓无 `devicePixelRatio` 引用） | `:171-172`、`:264-265` | Windows 125%/150%/200% 缩放下全部发虚；任何放大都是位图拉伸 |
| G5 | 滚动模式槽宽硬编码 `min(720px, 92%)` | `styles.css:1169` | 视口 >720px 时 canvas 被 CSS 拉宽（714→槽宽）→ 模糊；<720px 时被压窄 → 字小。与 G1 叠加出"双重不确定缩放" |
| G6 | 单页模式无页面缓存 | `renderPage`（`:255-270`）每次 `pdf.getPage()` 重新取页 | 连续翻页重复解析，翻页有可感延迟 |
| G7 | 滚动模式 `pageCacheRef` 无上限 | `:159-167` | 262 页书全量缓存 `PDFPageProxy`，内存持续增长（截图这本 43.6 MB） |
| G8 | 渲染前占位尺寸错误 | canvas 默认 300×150 → 渲染后 714×1010 | 首渲与翻页时布局跳动 |
| G9 | 单页模式页面顶部对齐 | `styles.css:194` `align-items: flex-start` | 适高模式下页面贴顶、下方大片空白，不居中 |
| G10 | 无目录（outline） | 全仓无 `getOutline` | 262 页技术书只能一页页翻，无书签导航 |
| G11 | 无页码跳转 | `PdfViewer.tsx:459-461` 纯文本 `4 / 262` | 无法直达 |
| G12 | 无文本重排 | 全仓无 `getTextContent` | 位图渲染决定了"纸有多大字多小"，是截图痛点的终极根因 |
| G13 | 暗色主题下白页刺眼 | `styles.css:198` `background:#fff` 固定 | canvas 是白底位图，主题切换对它无效 |

---

## 2. 优化目标（按优先级）

### P0 — 直接解决截图问题

| 编号 | 目标 | 对应缺陷 |
|---|---|---|
| **O1** | **缩放三态 + 自适应**：`auto`（按容器/页面宽高比自动取「适宽」与「适高」中更大者）/ `width`（适宽）/ `height`（适高）/ `spread`（双页并排）/ `custom`（自定义档位） | G1 G3 |
| **O2** | **缩放可调且默认自适应**：控制条把只读 chip 换成 `－ 100% ＋`，点击弹出档位菜单；支持 Ctrl+滚轮；写入 settings 持久化 | G2 |
| **O3** | **DPR 清晰渲染**：`canvas.width = 显示宽 × min(devicePixelRatio, 2)`，CSS 宽不变；释放/重算时同步 | G4 |

### P1 — 阅读体验与性能

| 编号 | 目标 | 对应缺陷 |
|---|---|---|
| O4 | 滚动模式去掉 720px 硬编码，按容器宽精确适配（适宽时 canvas 宽 = 容器宽） | G5 |
| O5 | 适高/双页模式页面垂直居中；适宽模式顶部对齐 | G9 |
| O6 | 单页模式接入页面缓存 + 邻页预渲染（翻页即时） | G6 |
| O7 | `pageCacheRef` 改 LRU（上限 24 页） | G7 |
| O8 | 渲染前按目标 scale 预设 canvas 尺寸，消除布局抖动 | G8 |
| O9 | 状态栏缩放文案改为动态（反映实际 fit 模式与百分比） | G2 |

### P2 — 能力扩展（建议独立版本，不进 v0.2.9 一次做完）

| 编号 | 目标 | 对应缺陷 |
|---|---|---|
| O10 | 目录侧栏：`pdf.getOutline()` 渲染书签树，复用 EPUB 目录侧栏样式与键盘路径 | G10 |
| O11 | 页码跳转：点 `4 / 262` 变输入框，回车直达 | G11 |
| O12 | **文本重排模式**：`page.getTextContent()` → HTML 流式重排，字号/字体/行距/页边距/主题全部跟随现有 settings。这是把 PDF 拉到 TXT/EPUB 同级阅读体验的唯一根治手段 | G12 G13 |
| O13 | 暗色模式 PDF 页面垫色/滤镜（位图限制下效果有限，与 O12 配套才有质变） | G13 |

---

## 3. 关键设计决策

### 3.1 `auto` 的判定式（O1 核心）

设容器内盒 `cw × ch`，页面 `pw × ph`：

- 适宽倍率 `sw = cw / pw`；适高倍率 `sh = ch / ph`
- **`auto` = `sw > sh ? width : height`**（等价于容器宽高比 > 页面宽高比时适宽）
- 双页倍率 `sp = min(cw / (2·pw), ch / ph)`，仅用户显式选择时使用（`auto` 永不选它）

按 §1.1 数值验算（容器内盒 1236×679，A4 竖版）：

| 模式 | 倍率 | 渲染尺寸 | 判定 |
|---|---|---|---|
| 当前写死 | 1.20 | 714 × 1010 | 左右各空 261px，底部裁 331px（截图现状） |
| `height` 适高 | 0.81 | 480 × 679 | 整页可见但字更小（≈8.5px） |
| `width` 适宽 | **2.08** | **1236 × 1748** | 字≈22px，一眼一行；页内需滚动约 2.6 屏 |
| `spread` 双页 | 0.81 | 480 × 679（单页；两页总宽 974 含 14px 间距） | 宽窗利用充分，字小，适合版式/图册 |

**结论：对文字型 PDF，`auto`（→适宽 2.08×）是唯一同时解决"字小"与"空白"的选择；代价是页内需要纵向滚动。** 因此：

- **默认值改为 `auto`**，`readerMode=scroll` 与 `page` 两模式一致（现状写死 1.2 的默认值作废，记 D65）。
- `height` / `spread` 保留为显式选项，服务"看图/看版式/要纸感"的场景。
- 翻页模式 + 适高时，翻页动作与页内滚动不冲突（页高 ≤ 容器高，无页内滚动）。

**已知边界（已实算，写入示例 HTML 的翻转演示）**
- 竖版 A4 在 1280×860 窗下 `sw=208%` vs `sh=81%`，判适宽；把内容区内盒宽度拖到 **<480px** 才翻转为适高（81%）。翻转条件 `cw > pw×ch/ph = 595.28×679/841.89 ≈ 480.1`（D70：此前文档/记忆误算为 492px，已按实算修正；窗口最小 900px → 内盒 856px，真机不可达，由单测 cw=481/480 两例覆盖）。
- 16:9 横版页（960×540）在同窗下 `sw=129%` vs `sh=126%`，**仍判适宽**（仅差 3%，属近似平局），渲染 1236×695 → 底部溢出 16px。页面宽高比 > 容器宽高比（1236/679 = **1.82**）时才稳定判适高。
- 上述近似平局场景会有一个方向上的少量溢出（十至几十 px），这是 `argmax` 规则的固有代价，接受并记录（见 §6 D66 与风险 4）。

### 3.2 与 `readerMode` 的关系（不重构）

`readerMode`（`scroll`/`page`）继续只表达"页与页之间怎么接"，缩放适配是**正交**的新维度：

| readerMode | 推荐 fit | 行为 |
|---|---|---|
| `scroll` 连续滚动 | `width` | 页间无缝、字号最大化，最接近"流式阅读" |
| `page` 单页翻页 | `auto`（宽窗→width） | 页内滚动到底后翻页；切 `height` 则整页可见 |

不在 v0.2.9 引入"重排"为第三种 `readerMode`——那会污染 EPUB/TXT 的共享字段。重排（O12）单列为 `pdfView: "image" | "reflow"`，留待 P2 独立版本。

### 3.3 数据契约

**settings（`bookeditor.settings.v4`，`settings.ts:90`）新增三字段**，`normalizeSettings` 对缺字段回落默认 → 旧配置向后兼容，**存储键 version 不变**：

| 字段 | 类型 | 默认 | 约束 |
|---|---|---|---|
| `pdfFit` | `"auto" \| "width" \| "height" \| "spread" \| "custom"` | `"auto"` | 白名单归一化，非法值回落 `auto` |
| `pdfZoom` | `number` | `100` | clamp 50–400，仅 `pdfFit="custom"` 生效 |
| `pdfDpr` | `boolean` | `true` | 关时倍率锁 1（低端机/省内存逃生门） |

**位置记录不变**：`PositionReport` 仍为 `{kind:"pdf", page, pageCount, mode}`（`PdfViewer.tsx:380`），`bookeditor.library.v1` 不动，**书架进度跨版本无损**。双页模式下 `current` 记录左页码，翻页步进 2，语义向后兼容。

**Go 侧零改动**：缩放/适配全在前端，`app.go` / `main.go` 不碰。

### 3.4 缩放解析链路（单一真相）

```
容器尺寸(ResizeObserver) + 页面尺寸(page.getViewport) + settings.pdfFit/pdfZoom
        ↓
  resolvePdfScale(fit, zoom, cw, ch, pw, ph) → { scale, cssW, cssH, dpr }   ← 纯函数，可单测
        ↓
  canvas.width = cssW * dpr; canvas.style.width = cssW + "px"                ← O3
```

`resolvePdfScale` 放 `frontend/src/utils/pdfScale.ts`，纯函数、零 DOM 依赖，**单测覆盖全部模式 × 边界（极窄窗、超宽页、横页 PDF、双页回落单页）**。

---

## 4. 逐文件实现（实施记录）

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/pdfScale.ts`（新增） | 纯函数层：`PdfFit` 五态 + `FIT_LABELS`、`resolvePdfScale(fit, zoom, cw, ch, pw, ph, dprEnabled)`（auto 判定 `sw > sh ? width : height`，返回 `{fit, scale, cssW, cssH, dpr, bmpW, bmpH, sw, sh, sp}`）、`clampPdfZoom` / `nudgeZoom` / `normalizePdfFit` / `currentDpr`、双页三件套 `spreadStep` / `spreadLeftPage` / `spreadLeftMax` / `clampSpreadLeft`、档位菜单辅助 `fitRatio`、回调类型 `PdfViewHandlers`。零 DOM 依赖 |
| `frontend/src/utils/__tests__/pdfScale.test.ts`（新增） | **24 例**（要求 ≥12）：五模式 × 边界（窄窗翻转点 480/481、16:9 近似平局、双页回落、zoom 钳制、dpr 开关与上限、零尺寸守卫、双页钳制） |
| `frontend/src/components/PdfViewer.tsx` | **主改**：删 `SCALE = 1.2`；新增 `ResizeObserver` 量容器内盒（page 模式量 `.pdf-canvas-area` 扣 44，scroll 模式量 `.pdf-scroll`；RO 变化守卫防循环）；`drawInto()` 统一「量容器 → resolve → 预设 canvas 尺寸（O8）→ DPR 位图（O3）→ render（viewport scale = scale×dpr）」；单页/双页两路共用；`getPageCached` LRU（上限 24）+ 邻页预取（O6/O7）；双页第二 canvas 与 `current` 步进 2、`initialPage` 摊开钳制；Ctrl+滚轮；控制条 chip 档位菜单（五方式附实际倍率 + 倍率预设）；页码跳转输入框；`onScaleReport` 上报实际倍率；方向键页内滚动优先（适高时无页内滚动，适宽时滚到底才翻页） |
| `frontend/src/utils/settings.ts` | 新增 `pdfFit`/`pdfZoom`/`pdfDpr` 类型、默认值（auto/100/true）、normalize 白名单；**存储键仍 `bookeditor.settings.v4`、version 不变**（D67） |
| `frontend/src/utils/__tests__/settings.test.ts` | 补 **7 例**：默认值、旧配置回落、非法值归一、合法值保留、合并语义、订阅广播、reset 复位 |
| `frontend/src/components/SettingsPanel.tsx` | 「阅读体验」窗格新增 PDF 卡片：适配方式五选（分段控件）、自定义倍率滑杆（仅 custom 可用，其余态 `.row-off` 置灰）、高清渲染开关；文案注明「四个入口写同一状态」 |
| `frontend/src/components/StatusBar.tsx` | `defaultDetail` 的 PDF 分支改为「单页翻页 · 缩放：自适应」；新增 `pdfDetail`  prop，App 上报后显示 `单页翻页 · 适宽 208% · 高清渲染开` |
| `frontend/src/components/Toolbar.tsx` | 模式段右侧新增 PDF 缩放组 `－ 208% ＋`（仅 PDF 阅读中显示；数值取 PdfViewer 上报的实际倍率） |
| `frontend/src/App.tsx` | 新增 `pdfScale` 态与 `handleScaleReport` / `handleZoomNudge` / `pdfView`（四个入口统一走 `handleSettingsChange`，切「自定义」时继承当前实际倍率）；换书/回书架作废上报；`pdfDetail` 生成；`BookViewer` 透传 |
| `frontend/src/components/BookViewer.tsx` | `PdfViewer` 增传 `settings` 与 `pdfView` |
| `frontend/src/styles.css` | `.pdf-canvas-area` 增 `scrollbar-gutter: stable`（防滚动条出现/消失导致内盒宽振荡）与 `[data-fit="center"]` 垂直居中；`.pdf-page[data-spread="1"]` 双页 flex + 14px 间距；`.zoom-chip`（只读）→ `.zoom-chip-btn` + `.zoom-menu` 档位菜单；`.pg-jump` 页码跳转；`.zoom-seg` 工具栏组；删 `.pdf-page-slot` 的 `min(720px,92%)` 硬编码；设置面板 `.set-card-row`/`.zoom-range` 等 |
| `e2e/driver.py` | `App.resize_to(w, h)`：按客户区尺寸设窗口（A84 最小窗验证用） |
| `e2e/verify_pdf_fit.py`（新增） | A83/A84/A87/A88/A89/A91 自动化：近白像素横向扫描自标定页面实际渲染宽（不依赖固定坐标）、双页双白段检测、Ctrl+滚轮倍率变化、重启宽度复现、滚动模式铺满；chip/菜单/模式段坐标为标定常量（窗口几何变化时微调） |

---

## 5. 验收映射（A83–A95）

| 编号 | 项 | 验证方式 | 状态 |
|---|---|---|---|
| A83 | 默认 `auto`：1280×860 窗口开 A4 PDF → 判适宽 208%、页面铺满内容区宽度、无左右空白条 | `verify_pdf_fit.py` 宽度像素断言 | 代码已落地，待真机 |
| A84 | 同一本书窗口拉到 900×600（最窄）→ `auto` 仍判适宽（约 144%），页面仍铺满宽度；此时若要整页可见需手动切「适高」（0.50×） | `verify_pdf_fit.py`（`App.resize_to`） | 代码已落地，待真机 |
| A85 | 内容区宽度拖到 <480px → `auto` 翻转为适高（81%），整页可见不裁切（竖版 A4 的翻转点，已在示例 HTML 中可交互复现） | `pdfScale.test.ts`（cw=481/480 两例） | **单测已覆盖**（窗口最小 900px → 内盒 856px > 480px，真机无法触发，见 D70） |
| A86 | 宽幅页面（宽高比 >1.82，如 2:1 横版幻灯片）→ `auto` 稳定判适高，整页可见不横向溢出；16:9 常规幻灯片在默认窗下判适宽 129%（底部仅溢出 16px，近似平局，见 §3.1 边界） | `pdfScale.test.ts`（16:9 一例 + 判定式） | **单测已覆盖**，真机目视待补 |
| A87 | 切「适高」→ 整页可见、垂直居中；切「双页」→ 两页并排、`current` 步进 2、页码显示 `4 / 262` | `verify_pdf_fit.py`（双白段检测 + 指示器 diff）；适高居中目视 | 代码已落地，待真机 |
| A88 | 缩放调节：`－`/`＋`/档位菜单/Ctrl+滚轮 四途径生效，倍率钳制 50–400% | 单测（`clampPdfZoom`/`nudgeZoom`）+ `verify_pdf_fit.py`（Ctrl+滚轮宽变 + 工具栏读数 diff） | 代码已落地，待真机 |
| A89 | 倍率写入 settings，重启应用后保持 | `verify_pdf_fit.py`（重启宽度复现） | 代码已落地，待真机 |
| A90 | DPR：125% 与 200% 系统缩放下文字边缘清晰（与关闭开关对比） | 真机目视 + canvas.width 断言 | 代码已落地，待真机（脚本无法读 DOM，留目视） |
| A91 | 连续滚动模式：视口 1000px 宽时 canvas 精确铺满、无拉伸模糊 | `verify_pdf_fit.py`（滚动模式铺满断言） | 代码已落地，待真机 |
| A92 | 翻页流畅：连续 10 次「下一页」无可见白屏/重解析延迟 | 真机计时 | 代码已落地，待真机 |
| A93 | 内存：262 页书滚动全程 RSS 增长平缓（LRU 生效） | 真机任务管理器（`fixtures/23.pdf`） | 代码已落地，待真机 |
| A94 | 布局稳定：首渲与翻页时 `.pdf-canvas-area` 无跳动 | 真机（RO 守卫 + 尺寸预设已在代码层保证） | 代码已落地，待真机 |
| A95 | 回归：进度保存/恢复仍按页码精确（含双页模式重启） | `verify_positions.py` | 代码已落地，待真机 |

**自动化边界**：`pdfScale.ts` 纯函数走 vitest（**24 例**，超过 ≥12 要求）；A83/A84/A87/A88/A89/A91 由新增 `e2e/verify_pdf_fit.py` 覆盖（自标定像素断言，chip/菜单/模式段坐标为标定常量）；A90/A92/A93/A94 依赖真机目视/计时，不强行自动化。

---

## 6. 偏差与风险（实施后回填）

| 编号 | 方案口径 | 实际处理 | 原因/影响 |
|---|---|---|---|
| D65 | 默认缩放 1.2 | **作废**，改 `auto` 自适应 | 与《BookEditor-Windows 初版项目说明文档》6.3「默认 1.2」冲突，属用户明确要求优化。验收通过后须回写原文档（见 §8） |
| D66 | 适宽模式一页整读 | 页内需纵向滚动（A4 在默认窗下约 2.6 屏/页） | 纸面比例与宽窗的固有矛盾；接受，`height`/`spread` 作为显式替代。另：`argmax` 判定在近似平局时有一个方向上的少量溢出（十至几十 px，如 16:9 页底溢 16px），已实测并写入 §3.1 边界 |
| D67 | 缩放持久化到 settings | 存储键仍 `bookeditor.settings.v4`、version 不变 | normalize 对旧配置回落默认，无需迁移；与 v0.2.8 `cat?` 沿用 v1 同法 |
| D68 | DPR 提升清晰度 | 位图内存 ×dpr² | 上限锁 2 + `pdfDpr` 开关；43.6MB 大书在 200% 缩放下需实测（A92/A93） |
| D69 | 目录/跳页/重排（O10/O12/O13） | **不在本期** | 工作量与风险独立，建议 v0.3.0 单独立项 |
| D70 | A85 翻转点真机验证 / O11 页码跳转 | ① 翻转点真机不可达：窗口最小 900px → 内盒 856px > 翻转点 480px，A85 由单测（cw=481/480）覆盖并同步示例 HTML 交互；另修正此前文档/记忆中的误算值 492px → **480px**（`cw > pw×ch/ph = 595.28×679/841.89 ≈ 480.1`）。② O11（页码跳转）方案列为 P2，但视觉基线 HTML 已含该交互、实现成本低（一个输入框 + 钳制），**本期提前落地**；越界为静默钳制（指示器即时反映），未引入全局 toast 通道 | ① 不影响功能正确性，仅验收方式改为单测 + 示例 HTML 交互复现；② 提前实施需在 v0.3.0 立项说明中标注「已随 v0.2.9 完成」，避免重复建设 |
| D71 | v0.2.9 上线后反馈：PDF「首次文件夹打开可加载、书架快捷再打开报『PDF 解析失败』；横屏(单页/双页)出现损耗、竖屏滚动正常」 | **已修复（hotfix，未另立版本号，随下一构建生效）**：根因非 worker 竞争，而是 pdfjs 全局静态集 `InternalRenderTask.#canvasInUse`——同一 `<canvas>` 上有未结束 `render()` 时再次调用会**同步抛** `Cannot use the same canvas during multiple render() operations`。旧实现仅用单一 `renderTaskRef` 且卸载只调 `pdf.cleanup()`，二次打开/翻页/切适配时上一帧渲染仍占用 canvas → 单页 `renderPage` 把该异常 `setFailed` 表面成「解析失败」，而连续滚动 `renderScrollPage` 用 `catch {}` 静默吞掉 → 形成「横屏坏、竖屏好」的观感。修复：① 按 canvas 维度登记在飞渲染任务（`renderTasksRef: Map<canvas, RenderTask>`）；② 新增 `renderOnCanvas`——重渲前先 `cancel` 并 `await` 同 canvas 的上一任务落定（释放 `#canvasInUse`）再渲染，两模式共用，仅「非取消类」异常上抛；③ 卸载保留 `pdf.cleanup()`（复用 worker，避免反复销毁/重建 worker 的竞态混淆源），废弃原先误入的 `pendingTeardown`/`loadingTask.destroy()` 串行锁 | 依赖 `tsc`/`vitest 165` 全绿验证；`wails build` 需在本机执行（沙箱无 Go/Wails）。本机验收要点：同一 PDF 文件夹打开→关闭→书架再打开连点多次、单页↔双页(`spread`)切换、单页↔滚动切换，均不应再弹「解析失败」 |
| D72 | v0.2.9 上线后反馈：**PDF 分类后重新打开分类消失**（其他格式经用户观察暂未复现，根因代码上三格式同受影响） | **已修复（hotfix，随下一构建生效）**：根因在打开流程 `library.savePosition`——它用 `upsertEntry` 以**全新对象**重写条目，只填打开相关标量（name/size/mtime/format/lastOpen/position/progress），未带上旧条目的 `cat`，而 `upsertEntry` 会先 `filter` 掉旧条目再 push 新条目 → 旧分类被丢弃。表现即「分类后重开分类丢失」。为何最先在 PDF 暴露：`PdfViewer` 不调用 `reportPosition`（该 API 以 `…entries[idx]` 展开可保留 cat），故 PDF 重开后无任何环节回填分类；EPUB/TXT 虽调 `reportPosition` 但彼时 `entries[idx]` 已被 savePosition 清空 cat，故本质三格式同损，仅 PDF 最高频被观察到。修复：`savePosition` 改为**合并旧条目**（`{ ...prev, …覆盖标量 }`），仅覆盖打开相关字段、其余（含 `cat`）继承旧值；首次打开（无旧条目）不写脏 `cat`。回归单测：`library.test.ts` 新增「savePosition 保留既有分类」「首次打开不写脏 cat」两例（167/167 全绿） | 属 `library.ts` 数据层缺陷（自 v0.2.1 `savePosition` 落地即存在，v0.2.8 分类功能使其显化）。修复后三格式统一保留分类；本机验收：归类某 PDF/EPUB/TXT → 关闭 → 书架重开，分类应保持。注意：本修复与 D71 同属 v0.2.9 维护期 hotfix，均待下一 `wails build` 生效 |

**已知风险（实施情况）**
1. **ResizeObserver 循环**：已按方案实现「仅容器自身尺寸变化才重算」守卫；另加 `scrollbar-gutter: stable` 双保险，避免滚动条出现/消失引起的内盒宽振荡。
2. **翻页模式 + 适宽的滚动/翻页边界**：已在 `setReaderCommandHandler` 的 `next/prev` 分支加「方向键 + 本页高于视口 + 未到边」时先滚页内，`ArrowUp/ArrowDown` 专属（PageUp/PageDown/空格仍直接翻页，贴近原生阅读器）；翻页后 `scrollTop = 0`。
3. **双页模式的 `initialPage` 恢复**：`spreadLeftPage`（奇数→自身、偶数→前一页）+ `spreadLeftMax` + `clampSpreadLeft` 三个纯函数已入单测（含 262/263 页奇偶总页数、越界、0 等边界）。
4. **横页/异尺寸 PDF**：实现取「逐页 viewport 判定」（每页各自 resolve），而非以首页定档——同文档内页面尺寸不一（如插图页）时每页独立适配，倍率可能随翻页轻微变化（接受，属本条风险的显式选择）；`widthsRef` 逐页记录真实宽度供滚动槽位使用。
5. **base64 全量载入**：存量设计，本期未触碰；重排模式（O12）落地时应一并评估改 Go 侧临时文件 + URL 加载。

---

## 7. 任务拆解（T1–T9，实施记录）

| 编号 | 内容 | 守门 | 状态 |
|---|---|---|---|
| T1 | `utils/pdfScale.ts` 纯函数 + ≥12 例单测 | vitest | **完成**（24 例） |
| T2 | `settings.ts` 三字段 + normalize + 单测补例 | vitest | **完成**（44 例，+7） |
| T3 | `PdfViewer.tsx` 单页模式：删 `SCALE`、接 `resolvePdfScale`、DPR、尺寸预设、垂直居中 | tsc | **完成** |
| T4 | `PdfViewer.tsx` 滚动模式：去 720px 硬编码、容器宽精确适配、LRU | tsc | **完成** |
| T5 | `PdfViewer.tsx` 双页模式：第二 canvas + 步进 2 + `initialPage` 钳制单测 | vitest | **完成**（钳制三函数 6 例） |
| T6 | 单页模式页面缓存 + 邻页预渲染 | 真机 A91/A92 | 代码完成，待真机 |
| T7 | `Toolbar.tsx` / `StatusBar.tsx` / `SettingsPanel.tsx` 控件与动态文案 | tsc | **完成** |
| T8 | `styles.css`：`data-fit` 对齐、去硬编码、chip 可交互、档位菜单 | 真机 | **完成** |
| T9 | `verify_pdf_fit.py` 新增 + 全量回归 | 全绿 | 脚本完成；`tsc`/`vitest 165`/`wails build` 已过，真机待跑 |

**DoD**：`tsc --noEmit` PASS、`vitest run` 全绿（基线 134 → **165**）、`wails build` 成功（`build/bin/book-editor.exe`）、A83–A95 真机通过、本文 §5 状态列回填、整合文档 §2/§11/§12 补 v0.2.9 行与 D65–D70。

---

## 8. 与原说明文档的冲突处理

《BookEditor-Windows 初版项目说明文档》6.3 载明「PDF 默认缩放比例 1.2」。本期将其改为 `auto` 自适应（D65）。按项目既有约定（v0.2.5 起「完成后回写原文档」），v0.2.9 落地并验收通过后，须回写该节为「默认自适应（auto：按容器与页面宽高比取适宽/适高中较大者），并提供适宽/适高/双页/自定义四态显式切换」，并在整合文档偏差索引登记 D65。
