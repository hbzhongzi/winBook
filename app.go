package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/simplifiedchinese"
)

// maxBookSize 初版文件大小上限：100MB（与原文档一致，严格大于才拒绝）
const maxBookSize = 100 * 1024 * 1024

// BookData 打开图书后返回给前端的数据结构（对应落地说明文档 5.1）
type BookData struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Format     string `json:"format"` // epub | pdf | txt
	Size       int64  `json:"size"`
	ModTime    int64  `json:"modTime"`        // 修改时间（unix 秒），书架条目变更检测用
	DataBase64 string `json:"dataBase64,omitempty"` // epub/pdf
	Text       string `json:"text,omitempty"`       // txt
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// OpenBook 弹出文件选择框并读取图书；用户取消返回 (nil, nil)。
// 错误以 "CODE: message" 前缀约定返回（落地说明文档 5.2）。
func (a *App) OpenBook() (*BookData, error) {
	selection, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择图书",
		Filters: []runtime.FileFilter{
			{DisplayName: "电子书 (*.epub;*.pdf;*.txt)", Pattern: "*.epub;*.pdf;*.txt"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("READ_FAILED: 打开文件对话框失败: %w", err)
	}
	if selection == "" {
		return nil, nil
	}
	return openBookAt(selection)
}

// OpenBookPath 直接读取指定路径的图书（书架「继续阅读」入口，不弹对话框）。
// 与 OpenBook 共用 openBookAt：格式判断、大小上限、错误契约完全一致。
func (a *App) OpenBookPath(path string) (*BookData, error) {
	if path == "" {
		return nil, fmt.Errorf("READ_FAILED: 路径为空")
	}
	return openBookAt(path)
}

// SupportedExts 返回本工具支持直接打开的图书扩展名（小写，不含点）。
// 单一真相：拖放前端校验与 openBookAt 的 switch 都以此为源，避免前后端双份漂移（v0.2.7 D55）。
func (a *App) SupportedExts() []string {
	return []string{"epub", "pdf", "txt"}
}

// openBookAt 读取并组装指定路径的图书数据。
func openBookAt(selection string) (*BookData, error) {
	// D1: 先判格式，不支持直接拒绝，不读取文件内容
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(selection), "."))
	switch ext {
	case "epub", "pdf", "txt":
	default:
		return nil, fmt.Errorf("UNSUPPORTED_FORMAT: 暂不支持 .%s 格式", ext)
	}

	info, err := os.Stat(selection)
	if err != nil {
		return nil, fmt.Errorf("FILE_NOT_FOUND: %w", err)
	}
	if info.Size() > maxBookSize {
		return nil, fmt.Errorf("FILE_TOO_LARGE: 文件超过 100MB 限制")
	}

	data, err := os.ReadFile(selection)
	if err != nil {
		return nil, fmt.Errorf("READ_FAILED: %w", err)
	}

	book := &BookData{
		Name:    filepath.Base(selection),
		Path:    selection,
		Format:  ext,
		Size:    info.Size(),
		ModTime: info.ModTime().Unix(),
	}
	switch ext {
	case "epub", "pdf":
		book.DataBase64 = base64.StdEncoding.EncodeToString(data)
	case "txt":
		book.Text = decodeText(data)
	}
	return book, nil
}

// decodeText TXT 解码链：合法 UTF-8 直接转字符串（去 BOM）；
// 否则尝试 GBK；仍失败按 UTF-8 替换非法字符。
func decodeText(data []byte) string {
	if utf8.Valid(data) {
		// D7: 去掉 UTF-8 BOM
		return strings.TrimPrefix(string(data), "\uFEFF")
	}
	if out, err := simplifiedchinese.GBK.NewDecoder().Bytes(data); err == nil {
		return string(out)
	}
	return strings.ToValidUTF8(string(data), "\uFFFD")
}
