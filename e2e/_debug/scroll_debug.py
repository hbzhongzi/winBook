# -*- coding: utf-8 -*-
"""滚动归属诊断：滚轮前/滚轮后各截一张，读取应用内 DEBUG 面板数值。

用法：python e2e/scroll_debug.py [文件名] [格数]
"""
import ctypes
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import driver as D
from driver import App, log, sleep, shot, flush_log, user32

user32.SetCursorPos = user32.SetCursorPos
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120


def wheel(notches):
    for _ in range(abs(notches)):
        delta = WHEEL_DELTA if notches > 0 else -WHEEL_DELTA
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        sleep(100)


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    notches = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    app = App()
    sleep(2000)
    ok = D.open_file(app, fixture)
    log(f"sd: open_file({fixture}) -> {ok}")
    sleep(5000)
    L, T, R, B = app.rect()
    cx, cy = (L + R) // 2, (T + B) // 2
    shot("sd-00-before", bbox=app.rect())
    user32.SetCursorPos(cx, cy)
    sleep(300)
    wheel(notches)
    sleep(1200)
    shot("sd-01-after", bbox=app.rect())
    log("sd: 截图完成 sd-00-before / sd-01-after")
    app.close()
    sleep(1200)
    flush_log()


if __name__ == "__main__":
    main()
