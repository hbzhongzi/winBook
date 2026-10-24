"""快捷键面板控件坐标标定（calib_hotkeys）。

打开设置 → nav「快捷键」→ 对对话框区域截图，供人工/像素测量：
- 「恢复默认」按钮
- 四个动作行（prev/next/home/end）的「+ 绑定」按钮
- 已有 chip 及其 × 移除按钮
- 冲突红字位置（录制时按下已占用键后出现）

用法：python e2e/calib_hotkeys.py
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, tap, force_foreground
import ctypes

user32 = ctypes.windll.user32

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "12.epub"

GEAR = (1241, 26)
NAV = {"reading": (394, 197), "appearance": (394, 234),
       "hotkeys": (394, 271), "advanced": (394, 308)}


def fg(app):
    for _ in range(4):
        force_foreground(app.hwnd)
        if user32.GetForegroundWindow() == app.hwnd:
            return True
        sleep(300)
    return False


def click(app, x, y):
    fg(app)
    click_client(app.hwnd, x, y)


def move_mouse_away():
    user32.SetCursorPos(2, 2)
    sleep(300)


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    D.open_file(app, FIXTURE)
    fg(app)
    app.move_to(40, 60)
    sleep(3000)

    click(app, *GEAR)
    sleep(1000)
    click(app, *NAV["hotkeys"])
    move_mouse_away()
    sleep(600)
    shot("calib-hk-01-pane", bbox=app.rect())

    # 触发一次录制态（点第一个动作行的「+ 绑定」附近：先盲点 pane 内常见位置，
    # 由截图确认；此处只用于产出「请按下按键…」态截图）
    # 四个动作行预估：pane 内容从客户区 y≈330 起，行距约 44px。
    # 首次盲点 (700, 380)，若未命中由截图判读。
    click(app, 700, 380)
    sleep(400)
    shot("calib-hk-02-after-click", bbox=app.rect())

    log("标定截图完成，请判读 calib-hk-01/02.png")
    app.close()
    sleep(1000)
    D.flush_log()


if __name__ == "__main__":
    main()
