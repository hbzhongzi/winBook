# BookEditor e2e（GUI 端到端测试）

对 `build/bin/book-editor.exe` 做真实窗口交互验收，覆盖落地说明文档第 8 章矩阵 A01–A18。

## 组成

| 文件 | 作用 |
|---|---|
| `make_fixtures.py` | 生成验收样本（TXT 三种编码/空文件、3 页 PDF、带目录与无目录 EPUB、mobi/azw3 假文件、损坏 PDF/EPUB、100MB 边界稀疏文件、30MB 性能样本） |
| `validate_fixtures.py` | 样本结构校验（PDF xref/页数、EPUB zip 结构与 nav、编码与字节数） |
| `validate_pdf.mjs` | Node + pdfjs-dist 打开样本校验（需 Node ≥23 或 Chromium 环境，本机 Node 22 缺 `Promise.try` 时不可用） |
| `check_epubjs.cjs` | 复现 epubjs 0.3.93 对损坏数据挂起的根因实验（Node + 最小 DOM 垫片） |
| `driver.py` | GUI 自动化驱动：窗口定位/前台化/就绪门/像素扫描控件/文件对话框 UIA 级子窗口操作/截图 |
| `attach_dev.py` | 附加到 `wails dev` 实例执行打开流程（配合 dev 控制台检查） |

## 运行

```bash
# 1. 生成并校验样本
python e2e/make_fixtures.py
python e2e/validate_fixtures.py

# 2. 确保 build/bin/book-editor.exe 为最新（wails build）

# 3. 执行场景（每个场景独立启动应用实例）
python e2e/driver.py run txt      # A01/A05/A06/A09/A14
python e2e/driver.py run pdf      # A04（翻页/钳制）
python e2e/driver.py run epub     # A03/A18 + 无目录降级
python e2e/driver.py run errors   # A07/A08/A10/A11/A12/A13 + 叠加态
python e2e/driver.py run perf     # A17 内存基线
python e2e/driver.py run epub10x  # M3 Gate #3 反复打开内存平稳

# 4. dev 控制台检查：另开终端 wails dev，然后
python e2e/attach_dev.py
```

## 输出

- 截图：`e2e/shots/*.png`（验收证据，对应开发规划文档 10.3 各行）
- 日志：`e2e/run.log`

## 环境注意

- 驱动用「像素扫描定位控件」而非硬编码坐标：WebView2 渲染位置曾出现漂移（与窗口最大化/恢复动画相关），扫描可自适应。
- 若 IDE 抢前台导致点击失效，驱动的就绪门（前台校验 + 窗口复位 + 按钮像素检测）会自动重试。
- 对话框过滤切换：`.mobi/.azw3` 需先切到"所有文件"过滤器（driver 的 `switch_filter`）。
- `e2e/fixtures/`（含 100MB+ 稀疏文件）与 `e2e/shots/` 不入库，按需重新生成。
