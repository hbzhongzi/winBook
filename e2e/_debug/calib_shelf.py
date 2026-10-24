"""校准脚本：打开书 → 滚动 → 回书架 → 截图，人工读取卡片/按钮坐标。"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, window_text

SHELF_BTN = (1207, 26)  # 估算：齿轮(1241,26) 左移 34（30 宽 + 4 margin）


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    ok = D.open_file(app, "12.epub")
    log(f"calib: open -> {ok}, title={window_text(app.hwnd)!r}")
    sleep(6000)

    # 滚动几下产生阅读位置
    r = app.rect()
    cx, cy = r[0] + 640, r[1] + 400
    D_force = __import__("ctypes").windll.user32
    D_force.SetCursorPos(cx, cy)
    sleep(300)
    for _ in range(6):
        D_force.mouse_event(0x0800, 0, 0, -120, 0)  # 向上滚（读前半本）
        sleep(150)
    sleep(4200)  # 等 3s 节流上报

    # 点书架按钮（坐标基于当前最新窗口 rect，避免窗口位移后落点漂移）
    r = app.rect()
    sx = r[0] + 1 + 1199
    sy = r[1] + 31 + 26
    log(f"calib: fresh rect={r}, shelf screen=({sx},{sy})")
    from driver import click_screen
    click_screen(sx, sy)
    sleep(1200)
    log(f"calib: after shelf click, title={window_text(app.hwnd)!r}")
    shot("calib-shelf", bbox=app.rect())

    # 再截一张全屏备用
    from PIL import ImageGrab
    ImageGrab.grab().save("e2e/shots/calib-fullscreen.png")
    log("calib: done")
    D.flush_log()


if __name__ == "__main__":
    main()
