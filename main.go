package main

import (
	"context"
	"embed"
	"log"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

// flushWaitMs：关闭时等前端同步 flush（阅读位置落库）的最长时间。
// localStorage 同步写仅毫秒级，600ms 是留足极端情况（大书架序列化）的余量。
const flushWaitMs = 600

func main() {
	app := NewApp()

	// 关闭拦截：退出前给前端一次同步 flush 的机会（修复「直接退出/点书架
	// 阅读记录不更新」——beforeunload 在 WebView2 销毁时不一定触发）。
	//
	// 实现要点：
	// 1. OnBeforeClose 返回 true 阻止本次关闭，等待放后台 goroutine——
	//    EventsEmit 的 ExecJS 经 PostMessage 派发到窗口消息队列，若在
	//    WM_CLOSE 的处理线程（消息循环）里阻塞等待，派发会被堵住形成
	//    死锁，flush-request 永远到不了前端（只能等超时）。
	// 2. flush 完成（或超时）后调 runtime.Quit；Quit 内部会再次进入
	//    OnBeforeClose，由 quitting 标志放行，不会自锁。
	var quitting bool

	err := wails.Run(&options.App{
		Title:            "BookEditor",
		Width:            1280,
		Height:           860,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// v0.2.7 拖拽打开（D56 修复）：必须显式开启 EnableFileDrop，否则
		// Go 侧直接丢弃 WebView2 的 file:drop 消息，前端 OnFileDrop 回调
		// 永不触发，落回 WebView2 默认行为（文件被当下载/导航处理）。
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
			// 全窗为放置目标：--wails-drop-target 标记不再依赖（回调侧
			// 已改用 useDropTarget=false），保留默认属性名便于后续局部化
			CSSDropProperty: "--wails-drop-target",
			CSSDropValue:    "drop",
		},
		OnStartup: app.startup,
		OnBeforeClose: func(ctx context.Context) bool {
			if quitting {
				return false // 退出流程中：放行，由 Quit 完成退出
			}
			quitting = true
			go func() {
				// 先注册监听再发请求，避免 flush-done 早于监听注册到达
				done := make(chan struct{})
				cancel := runtime.EventsOn(ctx, "app:flush-done", func(optionalData ...interface{}) {
					close(done)
				})
				runtime.EventsEmit(ctx, "app:flush-request")
				select {
				case <-done:
				case <-time.After(flushWaitMs * time.Millisecond):
				}
				cancel()
				runtime.Quit(ctx)
			}()
			return true // 本次关闭被接管：等 flush 后由 Quit 退出
		},
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
