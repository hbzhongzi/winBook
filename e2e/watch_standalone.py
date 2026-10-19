# -*- coding: utf-8 -*-
"""纯观察：启动 exe，30s 内只读进程/窗口状态，不做任何输入。
用于判断应用是否自行崩溃（与驱动输入无关）。"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ctypes
from driver import (App, find_windows_by_pid, log, sleep, user32, window_rect,
                    window_text, kernel32)

app = App()
for i in range(60):
    poll = app.proc.poll()
    win = user32.IsWindow(app.hwnd)
    rect = window_rect(app.hwnd) if win else None
    log(f"t+{i*0.5:.1f}s poll={poll} isWindow={win} rect={rect} title={window_text(app.hwnd)!r}")
    if poll is not None:
        log(f"!!! 进程自行退出，exit code={poll}")
        break
    sleep(500)
else:
    log("30s 观察期结束，进程仍存活")
    app.close()
    sleep(1500)
    log(f"close 后 poll={app.proc.poll()}")
from driver import flush_log
flush_log()
