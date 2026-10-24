# -*- coding: utf-8 -*-
"""真实书籍 12.epub（关键对话，1.8MB）打开流程观测。

多时间点截图 + 鼠标滚轮下探，确认：
1. 打开后首屏渲染结果（封面 / 正文 / 空白 / 错误提示）
2. 首屏下方是否存在可滚动内容（scrolled-doc 连续流）
用法：python e2e/run_realbook.py [文件名]
"""
import ctypes
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import driver as D
from driver import App, log, sleep, shot, window_text, flush_log, user32

user32.SetCursorPos = user32.SetCursorPos
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120


def wheel(notches, x=None, y=None):
    """在指定屏幕坐标处滚动鼠标滚轮（正数向下）。"""
    if x is not None and y is not None:
        user32.SetCursorPos(x, y)
        sleep(200)
    for _ in range(abs(notches)):
        delta = WHEEL_DELTA if notches > 0 else -WHEEL_DELTA
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        sleep(120)


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    app = App()
    sleep(2000)
    shot("rb-00-empty", bbox=app.rect())
    ok = D.open_file(app, fixture)
    log(f"realbook: open_file({fixture}) -> {ok}")
    # 多时间点观察首屏：封面/正文/空白/错误提示 的演变
    for i, wait in enumerate([1500, 2500, 4000, 5000]):
        sleep(wait)
        shot(f"rb-{i + 1:02d}-t{(i + 1) * 3}s", bbox=app.rect())
        log(f"realbook shot {i + 1}: alive={app.alive()} title={window_text(app.hwnd)!r} "
            f"mem={app.memory_mb():.1f}MB")
    # 内容区中心滚动下探：验证首屏下方是否有内容（排除"封面占满首屏+未滚动"误判）
    r = app.rect()
    cx = (r[0] + r[2]) // 2
    cy = (r[0 + 1] + r[3]) // 2
    wheel(6, cx, cy)
    sleep(1500)
    shot("rb-05-scrolled", bbox=app.rect())
    log(f"realbook scrolled: title={window_text(app.hwnd)!r}")
    # 再滚回顶部
    wheel(-6, cx, cy)
    sleep(800)
    app.close()
    sleep(1500)
    log(f"realbook: alive after close: {app.alive()}")
    flush_log()


if __name__ == "__main__":
    main()
