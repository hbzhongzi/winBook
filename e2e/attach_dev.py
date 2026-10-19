# -*- coding: utf-8 -*-
"""附加到 wails dev 实例执行打开流程（用于控制台输出检查）。

不启动新进程，按窗口类/标题查找正在运行的 dev 实例。
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from driver import (App, find_windows_by_pid, log, sleep, user32, window_class,
                    window_text, window_rect, flush_log, open_file, find_dialog,
                    wait_dialog, tap, VK_ESCAPE)


def find_dev_window(timeout_ms=60000):
    """查找 wailsWindow 类的 BookEditor 窗口（dev 实例）。"""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        found = []

        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd) and window_class(hwnd) == "wailsWindow":
                t = window_text(hwnd)
                if "BookEditor" in t:
                    found.append(hwnd)
            return True

        user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)(cb), 0)
        if found:
            return found[0]
        sleep(500)
    return None


hwnd = find_dev_window()
if not hwnd:
    log("未找到 dev 实例窗口")
    flush_log()
    sys.exit(1)

log(f"dev 实例 hwnd={hwnd} rect={window_rect(hwnd)} title={window_text(hwnd)!r}")


class DevApp:
    """复用 driver.App 的交互能力，但不拥有进程。"""

    def __init__(self, hwnd):
        self.hwnd = hwnd
        self.pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(self.pid))
        self.pid = self.pid.value

    def rect(self):
        return window_rect(self.hwnd)

    def memory_mb(self):
        return None

    def alive(self):
        return user32.IsWindow(self.hwnd)

    def close(self):
        pass  # dev 实例不关


app = DevApp(hwnd)
sleep(2000)
fixture = sys.argv[1] if len(sys.argv) > 1 else "sample.epub"
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 1
for i in range(rounds):
    ok = open_file(app, fixture)
    sleep(6000)
    log(f"[{i + 1}/{rounds}] dev 打开={ok} 标题={window_text(app.hwnd)!r}")
flush_log()
