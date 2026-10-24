# BookEditor v0.2.4 用户体验个性化落地说明文档

| 项 | 内容 |
|---|---|
| 版本 | v0.2.4（P0 版式三件套已实施；P1/P2 待排期） |
| 状态 | 自动化门禁全绿；真机交互待真实 Windows 桌面验证 |
| 方案依据 | `doce/_archive/BookEditor-v0.2.4-用户体验个性化更新方案.md`（已归档） |
| 上游 | v0.2.0（个性化 P0）、v0.2.1（位置记忆）、v0.2.2（阅读模式）、v0.2.3（翻页位置优化） |

---

## 1. 本轮范围

- **F12 行距**（`lineHeight` 1.4–2.2，步进 0.05，默认 1.75）
- **F13 正文字体**（`fontFamily`：system/宋体/楷体，默认 system）
- **F14 正文页边距**（`contentMargin` 0–80 px，默认 0）
- 附带：构建 vendor chunk 拆分（D42，方案 §2.1）

P1（F15 翻页动画 / F16 进度显示 / F17 TOC 宽度记忆 / F18 PDF 缩放记忆）与 P2（F19/F20）**未启动**。

## 2. 数据契约（settings v3）

```ts
export type FontFamily = "system" | "song" | "kai";
export type Settings = {
  epubPreloadCount: number;   // 既有
  theme: ThemeName;           // 既有
  accent: string;             // 既有
  fontSize: number;           // 既有
  readerMode: ReaderMode;     // 既有
  lineHeight: number;         // 新增：1.4–2.2，默认 1.75
  fontFamily: FontFamily;     // 新增：默认 "system"
  contentMargin: number;      // 新增：0–80 px，默认 0
};
```

- 存储键 `bookeditor.settings.v3`；**v2 全量迁移**（六字段原值搬移）+ v1（仅 `epubPreloadCount`）只读保留；三级链 v3→v2→v1→默认。
- 校验：行距 clamp + 0.05 步进对齐（整数步进计数 + 两位小数修正，见 D44）；字体白名单；边距整数 clamp。非法值静默回落默认。
- `ReadingPosition` **零改动**：排版参数不进位置模型（v0.2.3 契约不变）。

## 3. 逐文件实现

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/settings.ts` | 三字段 + 常量（MIN/MAX/STEP/DEFAULT）+ `FONT_FAMILY_LABELS`（面板名）/ `FONT_FAMILY_STACKS`（CSS 栈）；三个 normalize 函数；`DEFAULT_SETTINGS` 补默认；键升 v3 + `migrateFromV2` 全量迁移 |
| `frontend/src/utils/readingTheme.ts` | `readingStyleText` 注入行距/字体栈/页边距（EPUB iframe 通道，`!important`，margin=0 不注入 padding）；`applyAppTheme` 增三个 CSS 变量（`--reading-line-height` / `--reading-font-family` / `--reading-content-margin`） |
| `frontend/src/styles.css` | `:root` 补两变量默认值；`.txt-viewer`（滚动）与 `.txt-filmstrip`（翻页）消费 `line-height: var(--reading-line-height)` 与 `padding-left/right: calc(基础 + var(--reading-content-margin))` |
| `frontend/src/components/SettingsPanel.tsx` | 「阅读体验」窗格新增三张 set-card：行距滑杆（实时预览）、字体三选分段器（复用 `.mode-seg-block`/`.mode-opt`，按钮按字体栈渲染）、页边距滑杆（预览含 padding 效果） |
| `frontend/src/components/TextViewer.tsx` | **零改动**：`ResizeObserver` 已监听容器与正文，行距/边距变化天然触发 `recompute()` 重算 `totalPages` 并钳制 `page` |
| `frontend/src/components/EpubViewer.tsx` | **零改动**：`subscribeSettings → reinjectReading()` 已对已加载 iframe 重注；新章节经 `hooks.content` 自动带上 |
| `frontend/vite.config.ts` | `manualChunks` 三拆（D42） |

**注入通道复用**（本轮无新增通道）：EPUB = iframe 文档动态 CSS（`hooks.content` + 设置变更重注）；TXT = 宿主 CSS 变量。设置订阅广播 → 不重开图书即时生效，与 v0.2.0 以来机制一致。

## 4. 与位置系统的正交性验证

| 场景 | 机制 | 结论 |
|---|---|---|
| 行距/边距变化 → TXT 翻页 | `recompute()` 由 ResizeObserver 触发；`page` 钳制；位置以 `anchor`（字符偏移）为准 | 排版无关，位置不丢 |
| 行距/边距变化 → EPUB 滚动 | CFI 指向内容位置；`ratio` 为章内比例，现有自校正循环吸收章节高度漂移 | 排版无关，位置不丢 |
| 字体/边距变化 → EPUB 翻页 | CFI 在 paginated flow 下按内容定位 | 排版无关 |
| 排版设置变更 | 纯 CSS 级，不进 `state-host` key，不触发 Viewer 重挂载 | 不破坏 M8 瞬态保护 |

## 5. 验收映射

| 编号 | 标准 | 结果 |
|---|---|---|
| A51 | 行距三格式即时生效、TXT 翻页重算、位置不丢 | 代码 ✅ / 真机待验 |
| A52 | 字体三格式生效、默认 system 零回归 | 代码 ✅ / 真机待验 |
| A53 | 页边距生效、EPUB 位置保持 | 代码 ✅ / 真机待验 |
| A58 | settings v3 迁移与降级单测全绿 | ✅ 86/86 |
| A59 | chunk 拆分后构建通过 | ✅ exe 13.6 MB |

**自动化门禁（2026-10-21 本轮实测）**：`tsc --noEmit` PASS、`vitest` **86/86**（72 既有 + 14 新增：settings 10 / readingTheme 4）、`vite build` PASS、`go test` PASS、`wails build` PASS（`build/bin/book-editor.exe`，13.6 MB）。

**测试增量明细**：
- `settings.test.ts` 20→30 项：v2 全量迁移保真、v3 优先链、行距 clamp/步进/NaN、字体白名单、边距 clamp、混合互不干扰、`normalizeSettings` 直校。
- `readingTheme.test.ts` 5→9 项：注入含行距/字体/边距、margin=0 无 padding、楷体/system 栈切换、版式 CSS 变量。

**e2e 影响评估**：`e2e/smoke_settings.py` 的 Tab 路径只经过 nav 导航与外观窗格（均未改），阅读体验窗格新增控件不影响其落点（已在脚本头补 v0.2.4 注记）；`e2e/verify_mode.py` 的 `page-resume` 顺带覆盖 A51 的「翻页位置不丢」维度。

## 6. 已知风险与待真机验证

- **A51–A53 真机表现未验**：无头环境仅交付代码与单测。需在真实 Windows 桌面人工确认：三格式注入视觉效果、TXT 翻页重算后的页数正确性、EPUB 滚动位置漂移在可接受范围（D32 口径）。
- **宋体/楷体依赖系统字体**：未安装时回落相似字体（面板 note 已说明），不做字体打包。
- **书籍自带 CSS 优先级**：EPUB 注入用 `!important`（既有取舍）；书籍对具体元素设了 `line-height` 的不受影响（既有局限，v0.1.0 落地文档第 9 章）。
- **TXT 默认行距口径统一**：滚动原 1.8 / 翻页原 1.7 → 统一 1.75（D43，两模式原本不一致，统一后跨模式观感一致）。

## 7. 偏差记录

| 编号 | 内容 | 处理 |
|---|---|---|
| D42 | 构建单 chunk 1,070 kB 超 500 kB 警告（首屏 gzip 328.9 kB 全阻塞） | `manualChunks` 三拆：app 265.8 / react 11.9 / epubjs 351.4 / pdfjs 436.4 kB；首屏 gzip 83.7 kB；vitest 复跑无回归 |
| D43 | TXT 默认行距由滚动 1.8 / 翻页 1.7 统一为 1.75 | 主动统一（两模式原不一致）；作为 v3 默认值，用户可调 |
| D44 | 行距 0.05 步进浮点误差：`Math.round(1.4/0.05)*0.05 = 1.4000000000000001` | 改整数步进计数 + `Math.round(x*100)/100` 两位小数修正；单测覆盖 1.82→1.8 / 1.83→1.85 |

## 8. 文件改动清单

```
frontend/src/utils/settings.ts                    # v3 模型 + 迁移链
frontend/src/utils/readingTheme.ts                # 注入 + CSS 变量
frontend/src/styles.css                           # 变量默认 + TXT 消费
frontend/src/components/SettingsPanel.tsx         # 三控件 + v3 文案
frontend/src/utils/library.ts                     # 注释口径 v2→v3
frontend/src/utils/__tests__/settings.test.ts     # +10 项
frontend/src/utils/__tests__/readingTheme.test.ts # +4 项
frontend/vite.config.ts                           # manualChunks（D42）
e2e/smoke_settings.py                             # v0.2.4 注记（路径不受影响）
```
