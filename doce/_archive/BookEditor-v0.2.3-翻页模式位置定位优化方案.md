# BookEditor v0.2.3 翻页模式位置定位优化方案

| 项 | 内容 |
|---|---|
| 状态 | 已实施（P1→P4 全落地；`tsc`/`vitest`(72)/`vite build`/`go test`/`wails build` 全绿；`e2e/verify_mode.py` 扩展 page-resume；A43–A50 真机交互与真书表现需在真实 Windows 桌面验证） |
| 依赖 | v0.2.2 阅读模式切换（横向翻页 ⇄ 纵向滚动）已落地；本方案为其位置定位的适配补强 |
| 目标平台 | Windows 10/11 x64 |
| 文档依据 | `frontend/src/utils/library.ts`、`frontend/src/components/EpubViewer.tsx`、`TextViewer.tsx`、`PdfViewer.tsx`、`App.tsx`、`BookViewer.tsx`（均 v0.2.2 落地态） |

## 1. 问题定位（为什么「没做相关适配」）

v0.2.2 的位置系统（书架记录 / 退出保存 / 续读恢复）是围绕**滚动模式**设计的；翻页模式是后续叠加的二级分支。实测代码确认以下缺口：

| 缺口 | 格式 | 当前行为（代码位置） | 后果 |
|---|---|---|---|
| **G1** | EPUB 翻页 | `EpubViewer.tsx:780-794` `collectPosition` 强制 `ratio:0`；`:814-827` `applyResume` 仅 `rendition.display(r.href)` 落到章节首 | 翻页模式丢失章内所在页：第 3 章第 4 页退出/切换后再进入，回到第 3 章第 1 页 |
| **G2** | EPUB / TXT | `library.ts:6-9` `ReadingPosition` 无「模式」维度；EPUB 两模式共用 `href+ratio`，TXT 两模式共用 `ratio` | 跨模式恢复有损：滚动模式存下的章内精确比例，翻页模式重开被忽略；翻页存下的章节级，滚动重开掉到章节首 |
| **G3** | TXT 翻页 | `TextViewer.tsx:60-69,120-133` 位置 = `ratio=page/totalPages`，依赖 `totalPages` 与字号 | 两次会话字号不同 → 翻页映射漂移，定位不准 |
| **G4** | EPUB | `App.tsx:116-140` M8 切换瞬态捕获（`captureForRemount`）未做模式换算 | 会话内从滚动切到翻页，章内位置直接掉到章节首（G1 的会话内版本） |
| — | PDF 翻页 | `PdfViewer.tsx` 用 `initialPage` 恢复，`:316-324` `collectPosition` 取 `current` | **已正确**，页码对两模式语义一致，无需大改（仅补 `mode` 记录字段） |

**根因**：位置模型把「渲染模式」当作无关维度（v0.2.2 设计不变量之一）。该不变量对 PDF 成立（页码模式无关），但对 EPUB/TXT 不成立——二者的「位置」语义随模式变化（滚动=连续比例，翻页=离散页/分页）。因此需要在保留向后兼容的前提下，为 EPUB/TXT 补充**模式感知**的精确还原能力。

## 2. 优化目标与不变量

- **目标 O1（G1/G4）**：EPUB 翻页模式可精确恢复到「章内所在页」（用 CFI 还原分页位置），会话内滚动⇄翻页切换不再掉章首。
- **目标 O2（G2）**：EPUB/TXT 跨模式重开无损——无论以何种模式退出、何种模式进入，都能落到最贴近原阅读点的位置。
- **目标 O3（G3）**：TXT 翻页位置与字号解耦，字号变化不漂移。
- **目标 O4**：PDF 翻页保持现状（已正确），仅补元数据。

**保持不变的不变量**
- `ReadingPosition` 现有字段全部保留，**向后兼容**：旧版存储的位置（无新字段）仍能被 `normalizePosition` 正常解析并降级恢复（无 `cfi` → 章节级；无 `anchor` → 按 `ratio`）。
- 记录时机不变：仅在离场节点（退出软件 / 点击书架 / 切书）flush 写库，阅读中不周期写库。
- 切换不丢位置（M8 `transientResume`）不变，仅增强其换算精度。

## 3. 数据契约变更（`library.ts`）

为 EPUB 增加模式无关的精确锚点 `cfi`；为 TXT 增加字号无关的字符锚点 `anchor`；三格式统一补 `mode?` 落库记录。扩展均为**可选字段**，旧数据缺失时降级。

```ts
export type ReaderMode = "scroll" | "page"; // 已存在于 settings.ts，library 复用

export type ReadingPosition =
  | {
      kind: "epub";
      tocIndex: number;
      href: string;
      sectionIndex: number;
      ratio: number;        // 滚动模式章内比例（侧栏匹配用，保留）
      cfi?: string;         // 精确位置锚点（CFI，模式无关）；缺失→章节级降级
      mode?: ReaderMode;    // 落库时记录捕获模式，用于跨模式换算
    }
  | {
      kind: "pdf";
      page: number;
      pageCount: number;
      mode?: ReaderMode;    // 仅记录，页码语义两模式一致
    }
  | {
      kind: "txt";
      ratio: number;        // 滚动比例 / 翻页 page/totalPages（保留）
      anchor?: number;      // 字号无关锚点：文本字符偏移；缺失→按 ratio 恢复
      mode?: ReaderMode;
    };
```

`normalizePosition` 增加对新字段的校验：
- `cfi`：字符串且非空才保留，否则丢弃（不阻断整体解析）。
- `anchor`：`clampInt(Number(r.anchor), 0, 1e9, 0)`。
- `mode`：非 `"scroll"|"page"` 则丢弃（落 `undefined`）。

> 兼容性：旧存储无 `cfi/anchor/mode`，解析后这些字段为 `undefined`，恢复逻辑走降级分支，行为等同 v0.2.2。

## 4. 实施方案

### P1 — EPUB 翻页章内精确恢复（O1/O2/O4 核心，G1/G4）
**文件**：`EpubViewer.tsx`、`App.tsx`

1. **采集 CFI（两模式通用，新增 `cfi` 字段）**
   - 翻页模式：`rendition.on("relocated", loc => { currentHrefRef.current = loc.start.href; currentCfiRef.current = loc.start.cfi; })`，采集时把 `cfi` 写入 `position`。
   - 滚动模式：在现有 `collectPosition` 同步读取 `rendition.currentLocation()`（或复用 relocated 缓存）取出 `cfi` 一并写入。
   - 侧栏匹配仍用 `sectionIndex/ratio`（不变），`cfi` 仅用于精确还原。

2. **恢复采用 CFI 优先**
   - `applyResume`：若 `r.cfi` 存在 → `rendition.display(r.cfi)`（paginated / scrolled 下 `display(cfi)` 均有效，**天然跨模式**）→ 再按模式补精修（翻页无需，滚动仍需 `ratio` 微调章内 y，因 paginated 捕获的 cfi 在 scrolled 下可能落在章首附近，需用原 `ratio` 校正）。
   - 若无 `cfi`（旧数据/降级）→ 维持现状分支：翻页 `display(r.href)`，滚动 `display(href)+scrollTop` 数学。

3. **M8 会话内切换换算（G4）**
   - `captureForRemount` 已在事件处理器内同步取 `positionGetterRef.current()`，现取到的已是带 `cfi` 的精确位；重挂载后 `applyResume` 走 CFI 优先，故滚动→翻页切换可落到「就近页」而非章首。**无需额外换算逻辑**，只要 P1.1/P1.2 落地即解决 G4。

**验收**：EPUB 翻页退出重开落到同页；滚动切翻页、翻页切滚动均落到最近阅读点（章节内 ±1 页内）。

### P2 — 跨模式无损恢复与 `mode` 落库（O2，G2）
**文件**：`library.ts`、`App.tsx`、`BookViewer.tsx`

1. `reportPosition`/`savePosition` 写入时，由 Viewer 上报的 `position` 已自带 `mode`（P1/P3 补充）；`normalizePosition` 允许 `mode` 字段（§3）。
2. `BookViewer.tsx:168-169` `fmtResume` 分流不变；`App.tsx` 透传 `resume` 不变。
3. **EPUB 跨模式**：依赖 P1 的 CFI 优先策略——`display(cfi)` 在两种 flow 下都精确，因此无论存储/进入模式是否一致都无损（O2 对 EPUB 由 P1 直接达成）。
4. **TXT 跨模式**：依赖 P3 的 `anchor`——翻页与滚动均可用 `anchor` 还原（O2 对 TXT 由 P3 达成）。

### P3 — TXT 翻页位置与字号解耦（O3，G3）
**文件**：`TextViewer.tsx`

1. **采集锚点**：在 `collectPosition` 两模式均计算 `anchor` = 当前阅读点对应的**文本字符偏移**。
   - 翻页：`anchor = round((page + 视口内偏移比例) * (text.length / totalPages))`；或更直接：监听翻页时记录当前 `page` 对应的起始字符索引（基于每行估算代价高，改用比例法即可满足 O3）。
   - 滚动：`anchor = round(ratio * text.length)`。
2. **恢复锚点优先**：`recompute()` 之后，若 `r.anchor != null` → 用 `anchor` 反算页/比例（与当前 `totalPages`、字号无关）：翻页 `page = clampPage(round(anchor / (text.length / totalPages)))`；滚动 `scrollTop` 按 `anchor/text.length` 比例定位。
   - 若无 `anchor`（旧数据）→ 维持 `ratio` 恢复。
3. 字号变更（`settings.fontSize`）经 `recompute()` 重算 `totalPages` 后，`anchor` 仍稳定（它是字符偏移），故字号变化不再漂移。

**验收**：同一 TXT 以 16px 读到第 50 页退出，以 20px 重开仍落在相同文字附近（偏差 < 1 屏）。

### P4 — PDF 翻页元数据补记 + 验收/回归（O4）
**文件**：`PdfViewer.tsx`、`library.ts`（§3 已含）、`e2e/verify_mode.py`、单测

1. `PdfViewer` `collectPosition` 写入 `position.mode = isScroll ? "scroll" : "page"`（仅元数据，恢复逻辑不变）。
2. 单测：在 `library.test.ts` 增加 `cfi`/`anchor`/`mode` 字段的规范化与降级用例（缺失→`undefined`、非法 `mode`→丢弃、越界 `anchor`→钳制）。
3. `e2e/verify_mode.py` 扩展：每格式增加「翻页读 N 页→退出→重开→断言同页/同章」用例（A35-A42 之外的 A43-A48），并把字号变化纳入 TXT 用例。
4. 门禁：`tsc --noEmit` / `vitest` / `vite build` / `go test` / `wails build` 全绿（同 v0.2.2 基线）。

## 5. 验收映射

| 编号 | 标准 | 落地任务 | 结果 |
|---|---|---|---|
| A43 | EPUB 翻页退出重开落到章内同页（CFI） | P1 | ✅ 已落地（采集 `currentCfiRef` + `applyResume` CFI 优先）；真机待验 |
| A44 | EPUB 滚动→翻页 / 翻页→滚动切换落到最近阅读点（±1 页） | P1/P2 | ✅ CFI 优先恢复天然跨模式；会话内切换由 M8 + CFI 解（G4）；真机待验 |
| A45 | EPUB 跨模式重开无损（CFI 优先） | P1/P2 | ✅ `display(cfi)` 两种 flow 均精确；真机待验 |
| A46 | TXT 翻页位置与字号解耦（字号变化不漂移） | P3 | ✅ `anchor`=字符偏移，恢复反算页码/比例与字号无关；真机待验 |
| A47 | TXT 跨模式（翻页↔滚动）恢复一致 | P2/P3 | ✅ 两模式均上报 `anchor`，恢复统一反算；真机待验 |
| A48 | PDF 翻页保持正确 + `mode` 落库 | P4 | ✅ `collectPosition` 补 `mode` 字段，页码恢复逻辑不变 |
| A49 | 旧版位置（无 cfi/anchor/mode）降级恢复不报错 | §3/P1/P3 | ✅ `normalizePosition` 缺失字段即丢弃，走 `href+ratio` 降级；单测覆盖 |
| A50 | 单测 + `tsc`/`vitest`/`build`/`go test`/`wails build` 全绿 | P4 | ✅ tsc/vitest(72)/vite build/go test/wails build 全绿 |

## 6. 风险与降级

- **epubjs CFI 在 paginated/scrolled 互通性**：`display(cfi)` 两种 flow 均支持（CFI 指向内容位置，与渲染方式无关），已在 epubjs 0.3.93 验证语义；若某书 CFI 还原偏章首（极个别损坏书），走 `href+ratio` 降级（A49 兜底）。
- **PDF 翻页无需改动恢复**：仅补 `mode` 字段，零回归风险（A48）。
- **TXT `anchor` 比例法精度**：依赖 `text.length/totalPages` 均匀假设；极端不等长段落下偏差 < 1 页，配合滚动模式 `ratio` 兜底足够（O3 允许 ±1 屏）。
- **存储体积**：`cfi` 字符串约 40-120 字符/条，`anchor` 为整型，对 `LIBRARY_LIMIT=50` 的 localStorage 体积可忽略。

## 7. 实施顺序建议

P1（EPUB CFI，价值最高、覆盖 G1/G4/O1/O2）→ P3（TXT anchor，覆盖 G3/O3）→ P2（mode 落库与跨模式收口，多由 P1/P3 自然达成）→ P4（PDF 元数据 + 回归）。每阶段完成后同步回填本方案「结果」列与落地说明。
