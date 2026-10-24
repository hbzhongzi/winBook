"""PDF 连续滚动模式渲染探针（D51/D52 诊断）。

打开 sample.pdf（当前设置即 scroll 模式）→ 等遮罩超时 → 截图；
再滚轮下滚 → 截图；再滚轮上滚 → 截图。用于判定：
- 遮罩是否 10s 不消失（onReady 未触发）
- 首屏是否渲染（win/IO/渲染链路）
- 滚动后是否渲染（懒渲染链路）
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, tap, force_foreground
import ctypes

user32 = ctypes.windll.user32


def fg(app):
    for _ in range(4):
        force_foreground(app.hwnd)
        if user32.GetForegroundWindow() == app.hwnd:
            return True
        sleep(300)
    return False


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    D.open_file(app, "sample.pdf")
    fg(app)
    for t in (3, 6, 9, 12):
        sleep(3000)
        shot(f"pdfscroll-t{t}s", bbox=app.rect())
        log(f"t+{t}s 截图完成")
    # 滚轮下滚 3 次
    r = app.rect()
    sx, sy = r[0] + 700, r[1] + 400
    user32.SetCursorPos(sx, sy)
    sleep(300)
    for i in range(3):
        user32.mouse_event(0x0800, 0, 0, -480, None)  # MOUSEEVENTF_WHEEL 下滚
        sleep(600)
    sleep(1200)
    shot("pdfscroll-after-wheel-down", bbox=app.rect())
    # 滚轮上滚回顶部
    for i in range(5):
        user32.mouse_event(0x0800, 0, 0, 480, None)
        sleep(400)
    sleep(1200)
    shot("pdfscroll-after-wheel-up", bbox=app.rect())
    app.close()
    sleep(1000)
    D.flush_log()


if __name__ == "__main__":
    main()
