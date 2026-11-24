# 词典 API 对接落地可行性分析

> 版本：v1.0 ｜ 日期：2026-11-23 ｜ 范围：winBook 划词查词（主场景）+ TapTranslate 取词查词（延伸场景）
> 性质：决策文档，不含代码实现。文中价格/条款为公开资料检索结果，签约前须以服务商官方报价与合同为准。

---

## 0. 结论先行

**推荐：本地词库为主 + 云端做增量，不要直接上有道词典 API 当主链路。**

| 结论 | 说明 |
|---|---|
| ✅ 首选 | **ECDICT 本地词库**（MIT 许可、76 万基础词条、零调用费、离线可用）。它不是"API"，但对本项目的桌面形态反而比云 API 更合适：划词即显、无网络依赖、密钥不外泄 |
| ✅ 补充 | **Free Dictionary API**（免费、无需 key）补英文音标/发音/英英释义；**现有百度/腾讯翻译**补句子级翻译（已集成，无需新建链路） |
| ⚠️ 有条件 | **Oxford Dictionaries API**：权威、35 语种，但需付费计划，Sandbox 仅 500 次且限首字母 A |
| ❌ 不建议 | **有道词典 API**：不自助开通（需电话/邮件商务洽谈）、仅包年、发音另计费，且明文**严禁缓存**并声明技术巡查——与本地桌面软件"存结果、离线复现"的使用方式直接冲突 |
| ❌ 不适配 | **百度/腾讯机器翻译**：是翻译不是词典，拿不到音标、词性、释义、同反义词等结构化字段；只能做整句兜底 |

一句话选型：**单词查释义 → ECDICT；英文发音例句 → Free Dictionary API；整句/长文本 → 复用现有百度腾讯；商业级权威数据 → Oxford（付费）或有道（包年+禁缓存）。**

---

## 1. 需求界定与关键假设

### 1.1 "词典"的三种含义（必须先分清，选错方向会返工）

| 类型 | 输入 | 输出 | 现有链路能否满足 |
|---|---|---|---|
| A. 词典查词 | 单个词/短语（≤ 5 词） | 音标、词性、多条释义、例句、同反义词、词形变化 | ❌ 现有 MT 返回的是整句译文，无结构化字段 |
| B. 机器翻译 | 句子/段落 | 一段译文 | ✅ TapTranslate 已有百度主 + 腾讯备 |
| C. 术语/术语库 | 固定词表 | 自定义对照 | ⚠️ 需平台侧术语库能力，本期不涉及 |

本文档聚焦 **A（词典查词）**，B 仅作为兜底复用。

### 1.2 两个落地场景

| 场景 | 项目 | 触发方式 | 现状 |
|---|---|---|---|
| 场景一（主） | winBook 阅读器 | 鼠标划选文本 → 划词工具条加"查词" | `MarkToolbar.tsx` 已有选区保活机制（`onMouseDown` 阻止默认），EPUB/TXT 选区链路已通 |
| 场景二（延伸） | TapTranslate 取词翻译 | 截图 OCR → 取词 → 结果卡 | `internal/translate` 已有 `Translator` 接口与 fallback 链，但只返回字符串 |

### 1.3 关键假设（需你确认）

1. 句首 "pubg" 按误输入处理，未纳入需求。
2. 目标是**本地桌面软件**（非 SaaS），词库数据可落盘、可离线。
3. 个人/小团队使用规模，非对外分发的商业产品；若后续要商业化分发，需重审词库数据来源授权（见 §7.2）。
4. 查词结果**仅在本地展示**，不上传用户阅读内容；这要求词库本地化或调用时只发单词（不发上下文）。

---

## 2. 候选方案全景对比

| 方案 | 授权/费用 | 中文释义 | 英英释义 | 音标/发音 | 例句 | 词形变化 | 离线 | 缓存 | 接入成本 |
|---|---|---|---|---|---|---|---|---|---|
| **ECDICT 本地库** | MIT，0 元 | ✅ | ✅（`definition`） | 音标 ✅；音频❌（字段待添加） | ❌（字段待添加） | ✅（`exchange`+lemma） | ✅ | 随意 | 中（需打包数据+查询层） |
| **Free Dictionary API** | 免费无 key | ❌ | ✅ | ✅（gstatic 音频） | ✅ | 部分 | ❌ | 无明文禁止 | 低（1 个 HTTP GET） |
| **有道词典 API** | 包年，需商务开通，报价不公开 | ✅ | ✅ | ✅（发音另接 TTS 计费） | ✅ | ✅（`wordFormats`） | ❌ | **明令禁止** | 高（商务流程+签名+审计风险） |
| **有道文本翻译** | 48 元/百万字符；资源包 38.4 元/百万 | ✅（整句） | ❌ | ❌ | ❌ | ❌ | ❌ | 未明禁 | 低（已有类似链路） |
| **Oxford API** | Sandbox 500 次；付费计划报价制；研究许可免费 3 个月（需机构证明） | ⚠️ 双语数据集需确认 | ✅ 权威 | ✅ | ✅ | ✅（Inflections） | ❌ | 需看合同 | 中高 |
| **Wiktionary API** | 免费，CC BY-SA 类 | ⚠️ 多语言但质量参差 | ✅ | ✅ | ✅ | ⚠️ | ❌ | 需遵守署名/ShareAlike | 中 |
| **Merriam-Webster / Wordnik / Collins** | 需 key，多为订阅制（Wordnik 约 10 美元/月档） | ❌ 英文为主 | ✅ | ✅ | ✅ | ✅ | ❌ | 需看合同 | 中 |
| **百度 / 腾讯 TMT（已有）** | 免费额度 + 按量 | ✅（整句） | ❌ | ❌ | ❌ | ❌ | ❌ | 未明禁 | ✅ 已集成 |

> 数据来源：各服务商官方文档与 2026 年公开目录检索，详见文末参考。价格与条款随时可能变化，落地前复核。

---

## 3. 关键约束与"一票否决"项

这几条直接决定选型，不是体验问题：

### 3.1 有道词典 API 的缓存禁令（决定性）

官方原文：

> "我们返回给您的数据严禁缓存、再利用与转卖，我们将通过技术手段巡查您是否有缓存数据等违规行为，若存在违规行为您需要承担相应的法律责任。"

对桌面阅读器的影响：

- 划词查词若不缓存，每次滚动/重开都要重新联网请求，体验差且浪费额度；
- 桌面软件一旦做本地结果缓存（哪怕只是内存 LRU），即落入"缓存"字面范围；
- 密钥需随 exe 分发，存在逆向提取与盗用风险；
- 服务不自助开通，需电话 010-8255-8901 或邮件 AIcloud_Business@corp.youdao.com 商务洽谈，个人项目落地周期不可控。

**结论：作为个人/小团队桌面工具，有道词典 API 不具备落地条件。**

### 3.2 网络依赖与本机实际网络状态

此前推送远程时已确认：本机 `github.com` CONNECT 被代理拒绝（502）、DNS 被污染到 `57.155.223.240`，SSH 22 端口连到的也不是真 GitHub。虽然国内 API（百度/腾讯/有道）不走 GitHub 线路，但**任何云端词典都会引入网络失败态**。本地词库能把"查词"这个高频轻操作从网络依赖中摘出来，是架构上的实质收益。

### 3.3 数据完整性的诚实边界

ECDICT README 明确列出：

- `detail`（json 扩展信息，字典形式保存例句）—— **待添加**
- `audio`（读音音频 url）—— **待添加**

也就是说 ECDICT **不能承诺例句和发音**。若产品需要这两项，必须叠加 Free Dictionary API（英文）或自有音频方案，这一点在需求评审时就要讲清楚，不能拿"76 万词条"掩盖字段缺失。

### 3.4 桌面端密钥管理

任何云 API 的密钥写进前端 bundle 都是公开信息。若必须用云服务，HTTP 调用应放在 Go 后端（`app.go` 或其他 internal 包），密钥存本机配置文件并模糊化，且明确"用户自备 key"的产品口径。winBook 目前 `app.go` 只有 5 个方法（`OpenBook` / `OpenBookPath` / `SupportedExts` / `DiagLogPath` / `WriteDiagLog`），没有任何网络层，属于净新增模块。

---

## 4. 场景一：winBook 划词查词落地方案

### 4.1 架构

```
划选文本（EPUB iframe / TXT window）
        │  选区保活：MarkToolbar onMouseDown preventDefault（已有）
        ▼
MarkToolbar 新增「查词」按钮  →  调用 onLookup(selectedText)
        ▼
App / Viewer 状态：lookupWord → 弹查词卡（非模态，靠近选区，自动翻转）
        ▼
Go 后端 Dictionary.Lookup(word) → Entry{word, phonetic, pos[], definitions[], tags[], source}
        ├─ ECDICT 本地查询（主）
        └─ Free Dictionary API（可选，仅英文，补音频/英英）
```

### 4.2 现成接入点（已核对源码）

| 文件 | 位置 | 用途 |
|---|---|---|
| `frontend/src/components/MarkToolbar.tsx` | Props `onCopy`、`mode="new"` 分支 | 在"复制"旁加"查词"按钮，复用同一选区；`existing` 态建议也保留（改色时同样可查） |
| `frontend/src/components/EpubViewer.tsx` | L573/L581/L741 `doc.defaultView?.getSelection()`、`L2532 <MarkToolbar>` | EPUB 选区来自 iframe，查词需传 `sel.toString()` 而非宿主 window 选区 |
| `frontend/src/components/TextViewer.tsx` | L132/L286/L558/L616 | TXT 选区来自 `window.getSelection()`，接入方式相同 |
| `frontend/src/utils/settings.ts` | `Settings` 类型（L67）、默认值（L152）、normalize（L239） | 新增 `dictionaryEnabled` / `dictionaryOfflineOnly` / `dictionaryOnlineEnrich`；走既有 normalize 迁移口径，旧配置不丢 |
| `app.go` | 现有 5 个方法之后 | 新增 `LookupWord(word string) (*DictionaryEntry, error)`，Wails 绑定自动生成 |

### 4.3 PDF 场景的缺口（如实说明）

PDF 目前**没有文本选区链路**：`PdfInkCanvas` 透明画布覆盖在页面上，交互落在 pointer 事件上，`PdfViewer` 里也搜不到 `getSelection`。因此"PDF 划词查词"不是加个按钮就能完成，需二选一：

- **方案 P1（推荐先不做）**：明确本期不支持 PDF 查词，UI 上不误导；
- **方案 P2（后续）**：用 pdf.js 的 `getTextContent()` 做文本层拾取，与透明画布的 pointer-events 分层处理，属于独立子任务，工作量和风险都明显高于 EPUB/TXT。

### 4.4 数据打包策略

| 项 | 建议 |
|---|---|
| 数据源 | ECDICT 基础版 `ecdict.csv`（约 76 万词条）或完整 `stardict.7z` |
| 转换 | 导入 SQLite，保留 `word/phonetic/translation/definition/pos/tag/exchange/bnc/frq/sw` |
| Go 驱动 | `modernc.org/sqlite`（纯 Go，免 cgo，便于 Wails 打包） |
| 包体控制 | 首版只打核心词表（建议 2–5 万高频/CET 标注词），完整包做可选下载；避免把 200MB+ 全量库塞进安装包 |
| 查词策略 | 精确匹配 → `exchange` 反查词形 → `sw` 模糊匹配 → 未命中回落在线 MT |

### 4.5 交互验收要点

- 划词后工具条出现"查词"，点击后正文选区不丢（沿用 `preventDefault`）；
- 查词卡靠近选区、空间不足自动翻转，不遮挡正在读的行；
- 离线状态下本地查词仍可用，且无网络报错；
- 在线增强失败时静默降级到本地结果，不弹错误打断阅读；
- 查词结果不写入标记系统，不与高亮/感悟数据混在一起。

---

## 5. 场景二：TapTranslate 取词查词落地方案

### 5.1 现有接口的不适配点

`internal/translate/translator.go` 的契约是：

```go
type Translator interface {
    Name() string
    Translate(ctx context.Context, text, from, to string) (string, error)
}
```

它只返回一段字符串。词典需要的是结构化条目（音标/词性/多条释义/例句），**硬塞进 `Translator` 会把结构化数据拍扁成文本，后续无法做卡片排版**。因此不要复用该接口。

### 5.2 建议做法：并行新增 `Dictionary` 接口

```go
// internal/dictionary/dictionary.go（建议新增）
type Entry struct {
    Word        string
    Phonetic    string
    Pos         []string
    Definitions []string
    Tags        []string
    Examples    []string
    Source      string // "ecdict" | "freedict" | ...
}

type Dictionary interface {
    Name() string
    Lookup(ctx context.Context, word string, from string) (*Entry, error)
}
```

- 本地 ECDICT 作为第一个实现，放在 `internal/dictionary/ecdict.go`；
- 配置侧（`internal/config/config.go`）新增 `DictionaryEnabled bool`、`DictionaryDataPath string`，沿用便携模式（exe 同级 `config.json`）；
- 主流程：OCR（`internal/ocr`）拿到文本 → 判定是否单词/短语 → 走 `Dictionary` → 有结构化结果就渲染词条卡；否则回落到现有 `TranslateWithFallback` 走整句翻译；
- **不要在 key 缺失时禁用整个工具**：沿用现有 `ErrNotConfigured` 语义，词典未配置时静默跳过即可。

### 5.3 场景优先级

TapTranslate 是"取词翻译"，用户主要诉求是快。本地词库命中率高、零延迟，恰好契合；云端查词只在本地未命中时兜底。建议顺序：**先本地 ECDICT → 再可选在线增强**。

---

## 6. 推荐技术架构（统一层）

两个项目虽然技术栈不同（winBook = Wails v2 + React 19；TapTranslate = Wails v3 + Go 1.26），但可以用同一套思路，代码不必共享：

```
[输入] 划选文本 / OCR 文本
   │
   ├─ 归一化：lower、strip 标点、词形还原（ECDICT exchange / lemma）
   ▼
DictionaryResolver（统一入口）
   ├─ 1st  本地 ECDICT     ← 默认启用，离线，零成本
   ├─ 2nd  Free Dictionary ← 仅英文，补 audio / 英英释义（可选）
   └─ 3rd  现有 MT          ← 未命中或长文本，整句兜底
   ▼
Entry（统一结构）→ UI 卡片
```

设计原则：

1. **本地优先**：高频短查询不碰网络；
2. **分层降级**：任何一层失败都静默回落到下一层，不打断用户；
3. **来源标注**：UI 显示数据来源，避免把英英释义当中文译义；
4. **不混数据**：查词结果与标记/高亮/感悟数据分离存储；
5. **可关可配**：设置里能关掉在线增强（隐私/流量考量）。

---

## 7. 成本与合规

### 7.1 成本估算（个人使用规模）

| 项 | 一次性 | 持续 | 备注 |
|---|---|---|---|
| ECDICT 集成 | 2–5 人日 | 0 元 | 数据导入 + 查询层 + UI |
| Free Dictionary API | 0.5 人日 | 0 元 | 无 SLA，不可作为唯一来源 |
| 百度/腾讯 MT（复用） | 0 | 免费额度内基本 0 | 已有链路，无需新建 |
| Oxford 付费计划 | 0.5 人日 | 报价制 | 需商务询价 |
| 有道词典 API | — | 包年 + TTS 另计 | 需商务开通；禁缓存 |

> 这里的"人日"是量级估计，不是承诺工期；实际取决于是否做 PDF 文本层、卡片 UI 精细度与打包策略。

### 7.2 合规风险登记册

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 有道数据禁止缓存 | 🔴 高 | 已有明文条款与巡查声明 | 不采用有道词典 API 作为主链路 |
| ECDICT 数据来源谱系 | 🟡 中 | README 显示数据由多个开源词库（cdict、EDictAZ 等）汇合而成，MIT 覆盖代码，底层词条来源未逐一列明 | 个人使用风险低；若商业化分发，保留 LICENSE 与来源说明，必要时法律复核 |
| ECDICT 例句/音频缺失 | 🟡 中 | README 标注"待添加" | 需求阶段明确不承诺；用 Free Dictionary API 补英文 |
| 云端 key 随 exe 分发 | 🟡 中 | 逆向可提取 | 用户自备 key；放 Go 后端；配置文件脱敏 |
| 用户阅读内容外传 | 🟠 中高 | 若调用 MT 时传整段上下文，等于上传阅读内容 | 只发单词；在线增强默认关闭或需显式开启 |
| 免费 API 无 SLA | 🟢 低 | 限流/宕机不可控 | 只做增强，不做主链路 |

---

## 8. 里程碑与验收口径（DoD）

| 阶段 | 交付 | 验收 |
|---|---|---|
| M1 数据层 | ECDICT 导入 SQLite、Go 查询函数、纯函数测试（精确/词形/模糊/未命中） | 测试全绿；1 万词样本查询 P95 < 50ms |
| M2 winBook 接入 | MarkToolbar 查词按钮 + 查词卡 + 设置项 + `app.go` 绑定 | EPUB/TXT 划词可查；离线可用；不污染标记数据 |
| M3 TapTranslate 接入 | `internal/dictionary` 包 + 配置 + 词条卡渲染 | OCR 取词后出结构化词条；未配置时静默跳过 |
| M4 在线增强（可选） | Free Dictionary API 适配器 | 英文单词能补出发音/英英；失败静默降级 |
| M5 PDF 查词（可选） | pdf.js 文本层拾取 + pointer 分层 | 双栏/缩放下拾取位置正确；与画笔不冲突 |

每个阶段结束按项目既有惯例回填文档与 devlog，并如实记录设计偏差；未完成的阶段不得标为通过。

---

## 9. 待你确认的问题

1. 查词结果是否要**存入生词本/历史**（会影响数据模型，本期默认不存）。
2. 是否需要**发音朗读**：若需要，ECDICT 无音频，得接受"在线才发音"或另找音频源。
3. 是否需要**中文词语**反查英文（ECDICT 主要是英→中；中→英需另配词库或走 MT）。
4. PDF 查词是否列入本期（建议不列，见 §4.3）。
5. 是否要商业化分发（决定 §7.2 的词库来源合规复核深度）。

---

## 参考来源（2026-11-23 检索）

- 有道词典 API 官方文档：<https://ai.youdao.com/DOCSIRMA/html/dictionary/api/ydcd/index.html>（开通方式、禁缓存条款、字段、错误码）
- 有道文本翻译：<https://ai.youdao.com/new/product-fanyi-text.s>（48 元/百万字符、词典服务包年、发音另计费）
- ECDICT 仓库与 LICENSE：<https://github.com/skywind3000/ECDICT>（MIT、76 万词条、字段说明、待添加字段）
- Free Dictionary API：<https://dictionaryapi.dev/>（端点、字段、免费声明）
- Oxford Dictionaries API FAQ / 产品页：<https://developer.oxforddictionaries.com/faq>、<https://languages.oup.com/products/oxford-dictionaries-api/>（Sandbox 500 次、付费计划、研究许可）
- 公开 API 目录（词典类）：<https://publicapis.lol/categories/dictionaries>
- 腾讯云 TMT / 百度翻译：腾讯云官方 API 文档、百度翻译开放平台（翻译非词典的字段差异）
