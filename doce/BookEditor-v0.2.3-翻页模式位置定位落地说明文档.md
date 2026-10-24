# BookEditor v0.2.3 翻页模式位置定位优化 · 落地说明

| 项 | 内容 |
|---|---|
| 版本 | v0.2.3 |
| 日期 | 2026-10-21 |
| 依赖 | v0.2.2 阅读模式切换（横向翻页 ⇄ 纵向滚动）已落地 |
| 方案依据 | `doce/_archive/BookEditor-v0.2.3-翻页模式位置定位优化方案.md`（已归档） |
| 状态 | 代码/单测/构建门禁全绿；真机交互与真书表现待真实 Windows 桌面验证 |

## 1. 范围与动机

v0.2.2 的位置系统按**滚动模式**设计，翻页模式是后续叠加的二级分支，存在「能用但没适配」的缺口（方案 G1–G4）：

- **G1** EPUB 翻页丢失章内所在页（退出/切换后回到章节首）；
- **G2** `ReadingPosition` 无模式维度 → 跨模式恢复有损；
- **G3** TXT 翻页位置依赖 `totalPages`/字号 → 字号变化漂移；
- **G4** 会话内滚动⇄翻页切换掉到章首。

本版本为 EPUB 增加 **CFI** 精确锚点、为 TXT 增加**字号无关的字符锚点 `anchor`**、三格式统一补 `mode` 落库，使翻页模式的位置定位与滚动模式同权。

## 2. 数据契约变更（`library.ts`）

`ReadingPosition` 扩展均为**可选字段**，旧数据缺失时降级，行为等同 v0.2.2：

```ts
| { kind: "epub"; tocIndex; href; sectionIndex; ratio; cfi?: string; mode?: ReaderMode }
| { kind: "pdf"; page; pageCount; mode?: ReaderMode }
| { kind: "txt"; ratio; anchor?: number; mode?: ReaderMode }
```

`normalizePosition` 新增校验：
- `cfi`：字符串非空才保留，否则丢弃（不阻断解析）；
- `anchor`：有限数且 ≥0 才保留，越界钳制 `[0, 1e9]`；
- `mode`：仅 `"scroll"|"page"` 合法，否则丢弃。

> 兼容性：旧存储无 `cfi/anchor/mode`，解析后这些字段为 `undefined`，恢复走 `href+ratio` 降级分支（A49）。

## 3. 逐文件实现

### 3.1 `library.ts`（P2 数据层）
- 导入 `ReaderMode`，扩展 `ReadingPosition` 三分支；
- `normalizePosition` 三分支校验/携带新字段，缺失即降级。

### 3.2 `EpubViewer.tsx`（P1，O1/O2/O4）
- 新增 `currentCfiRef`；滚动分支与翻页分支的 `relocated` 监听均记录 `currentCfiRef`；
- 两模式 `collectPosition` 均写入 `cfi` + `mode`；
- `applyResume` **CFI 优先**：
  - 翻页模式 `rendition.display(r.cfi)`（精确章内页），缺 CFI 降级 `display(r.href)`；
  - 滚动模式 `rendition.display(r.cfi)`（paginated/scrolled 下均精确，天然跨模式），CFI 失败回退 `href`+章内 ratio 数学；有 CFI 时跳过原 `href+ratio` 校正（避免扰动精确还原）。

### 3.3 `TextViewer.tsx`（P3，O3）
- `collectPosition` 两模式均计算 `anchor = round(ratio * text.length)`（字号无关的字符偏移）+ `mode`；
- 恢复优先用 `anchor` 反算：`ratio = anchor / text.length`，再映射页码/滚动比例；缺 `anchor` 回退 `ratio`。
- 字号变化经 `recompute()` 重算 `totalPages`，但 `anchor` 为字符偏移，故定位字符点稳定（不漂移）。

### 3.4 `PdfViewer.tsx`（P4，O4）
- `collectPosition` 写入 `mode: isScroll ? "scroll" : "page"`（仅元数据，页码恢复逻辑不变）；
- PDF 页码对两模式语义一致，恢复保持 v0.2.2 现状（A48）。

### 3.5 `e2e/verify_mode.py`
- 新增 `run_page_resume` 与 `page-resume` 子命令：切翻页→翻 3 页→退出→重开→状态栏签名比对（A43/A45/A48）；
- 顶部 docstring 增补 A43–A48 说明与 `page-resume` 用法。

## 4. 验收映射（A43–A50）

| 编号 | 标准 | 结果 |
|---|---|---|
| A43 | EPUB 翻页退出重开落到章内同页（CFI） | ✅ 已落地，真机待验 |
| A44 | EPUB 滚动⇄翻页切换落到最近阅读点（±1 页） | ✅ CFI 优先 + M8，真机待验 |
| A45 | EPUB 跨模式重开无损（CFI 优先） | ✅ 已落地，真机待验 |
| A46 | TXT 翻页位置与字号解耦 | ✅ `anchor` 反算，真机待验 |
| A47 | TXT 跨模式恢复一致 | ✅ 两模式上报 `anchor`，真机待验 |
| A48 | PDF 翻页正确 + `mode` 落库 | ✅ 已落地 |
| A49 | 旧版位置降级恢复不报错 | ✅ 单测覆盖 |
| A50 | `tsc`/`vitest`/`build`/`go test`/`wails build` 全绿 | ✅ 全绿 |

## 5. 偏差记录（D40–D41）

- **D40**：`EpubViewer.applyResume` 翻页分支原引用 `matchTarget`，但该常量定义在 `else { ... }` 翻页块内、作用域不可见，触发 TS2304。改为用记录的 `tocIndex` 近似高亮——CFI 已精确还原内容位置，章节高亮用 `tocIndex` 足够且准确，无需 `matchTarget`。
- **D41**：`library.ts` 复用 `settings.ts` 的 `ReaderMode` 类型（`import type`），单向依赖无循环，无需结构调整。

## 6. 测试与构建

- `frontend` 单元测试：**72 项全部通过**（原 68 + 新增 `library.test.ts` 4 项：cfi/anchor/mode 规范与降级）；
- 类型检查 `tsc --noEmit` ✅；生产构建 `vite build` ✅；Go 测试 `go test` ✅；桌面构建 `wails build` ✅（`build/bin/book-editor.exe`，约 13.0 MB）。

## 7. 已知风险与待真机验证

- **epubjs CFI 在 paginated/scrolled 互通性**：`display(cfi)` 两种 flow 均支持（CFI 指向内容位置，与渲染方式无关）；极个别损坏书若还原偏章首，走 `href+ratio` 降级（A49 兜底）。需在真机用真实 EPUB 验证 A43/A44/A45。
- **TXT `anchor` 比例法精度**：依赖 `text.length/totalPages` 均匀假设，极端不等长段落偏差 < 1 页，配合滚动 `ratio` 兜底足够（O3 允许 ±1 屏）。A46 需在真机改字号验证。
- **e2e 坐标敏感**：`verify_mode.py` 与 `page-resume` 子命令均依赖可见窗口与默认皮肤坐标，本无头环境仅交付脚本未实跑。
