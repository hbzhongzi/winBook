# Winbook

Winbook 是一款基于 Wails、React 和 TypeScript 构建的 Windows 桌面图书阅读器，支持 EPUB、PDF 与 TXT。项目将 Go 用作桌面与本地文件访问层，阅读界面由 WebView2 中的 React 应用提供。

## 功能

- 打开 EPUB、PDF、TXT 文件，也可以将支持的文件拖入应用窗口。
- 通过书架管理最近阅读的图书，支持继续阅读、分类、自定义分类和清理记录。
- 记忆阅读进度；重新打开图书或切换阅读模式时尽可能恢复阅读位置。
- 支持纵向滚动和横向翻页。EPUB 滚动模式按需加载并回收章节，可在设置中调整预加载章节数。
- 提供阅读主题、强调色、字号、字体、行距、页边距和可自定义快捷键。
- 文件大小限制为 100 MiB；TXT 支持 UTF-8 与 GBK 解码。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 桌面应用 | Go、Wails v2、WebView2 |
| 前端 | React、TypeScript、Vite |
| EPUB | epub.js |
| PDF | pdfjs-dist |
| 本地持久化 | 浏览器 localStorage（设置、书架、分类与阅读位置） |

## 项目结构

```text
.
├── app.go                    # 文件选择、格式及大小校验、文件读取与 TXT 解码
├── main.go                   # Wails 应用入口、窗口配置、拖放和退出前保存
├── app_test.go               # Go 后端测试
├── frontend/
│   ├── src/App.tsx            # 应用状态、打开流程、书架与阅读位置协调
│   ├── src/components/        # TXT/PDF/EPUB 阅读器、工具栏、设置和书架管理
│   ├── src/utils/             # 阅读设置、书架、分类、快捷键及章节窗口逻辑
│   └── package.json           # 前端脚本和依赖
├── e2e/                      # GUI 验收脚本、测试样本生成及验证工具
├── build/                    # Wails 配置、图标和 Windows 构建产物目录
└── doce/                     # 项目设计、落地说明与历史文档
```

## 环境要求

- Windows 10/11 x64
- Go 1.25 或兼容版本（以 `go.mod` 为准）
- Node.js 与 npm
- Wails CLI v2
- WebView2 Runtime（通常已随 Windows 或 Edge 安装）

## 开发运行

在项目根目录执行：

```powershell
wails dev
```

也可以单独运行前端开发服务器（它不包含 Wails 的 Go 文件对话框和桌面桥接）：

```powershell
cd frontend
npm install
npm run dev
```

## 测试与构建

前端单元测试：

```powershell
cd frontend
npm test
```

前端类型检查和生产构建：

```powershell
cd frontend
npm run build
```

Go 测试和 Windows x64 桌面程序构建（在项目根目录执行）：

```powershell
go test ./...
wails build -platform windows/amd64
```

Windows 可执行文件通常生成在 `build/bin/book-editor.exe`。更完整的 GUI 验收说明见 [`e2e/README.md`](e2e/README.md)；它依赖 Windows 桌面会话及测试环境。

## 使用说明

启动后可通过工具栏打开图书或进入书架。设置面板用于切换阅读模式、外观与快捷键；EPUB 目录可用于跳转章节，滚动阅读时目录高亮会跟随正文更新。书架和偏好设置保存在当前 Windows 用户的应用 WebView 本地存储中，不会自动同步到其他设备。

当前支持的图书格式为 `.epub`、`.pdf` 和 `.txt`。受 DRM 保护或损坏的 EPUB/PDF 可能无法解析；单文件大小超过 100 MiB 时会被拒绝。

## 文档

- [整合项目文档](doce/BookEditor-v0.1.0-整合项目文档.md)
- [项目文档目录](doce/)
- [GUI 端到端测试说明](e2e/README.md)
