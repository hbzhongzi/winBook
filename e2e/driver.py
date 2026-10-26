# -*- coding: utf-8 -*-
"""BookEditor GUI 端到端驱动（Windows）。

机制：
- ctypes 调 user32：窗口查找/前台化/客户区坐标换算/鼠标点击/SendInput 键入/子窗口枚举
- PIL ImageGrab 截图
- 截图与日志输出到 e2e/shots/、e2e/run.log

用法：python e2e/driver.py probe            # 探针：启动并打印窗口/对话框结构
      python e2e/driver.py open <file> [filter]  # 单步：打开指定样本并截图
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
EXE = os.path.join(PROJ, "build", "bin", "book-editor.exe")
FIX = os.path.join(HERE, "fixtures")
SHOTS = os.path.join(HERE, "shots")
os.makedirs(SHOTS, exist_ok=True)

# ---------------- Win32 ----------------
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)

WM_CLOSE = 0x0010
WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
SW_RESTORE = 0x9
GWL_STYLE = -16
GW_OWNER = 4
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B
VK_CONTROL = 0x11
VK_SHIFT = 0x10
VK_MENU = 0x12
VK_LWIN = 0x5B
VK_TAB = 0x09


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long), ("mouseData", ctypes.c_uint),
                ("dwFlags", ctypes.c_uint), ("time", ctypes.c_uint), ("dwExtraInfo", ctypes.c_void_p)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort), ("dwFlags", ctypes.c_uint),
                ("time", ctypes.c_uint), ("dwExtraInfo", ctypes.c_void_p)]


class INPUT_I(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint), ("_", INPUT_I)]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

user32.FindWindowW.restype = wt.HWND
user32.FindWindowW.argtypes = [wt.LPCWSTR, wt.LPCWSTR]
user32.EnumWindows.restype = ctypes.c_bool
user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
user32.EnumChildWindows.restype = ctypes.c_bool
user32.EnumChildWindows.argtypes = [wt.HWND, WNDENUMPROC, wt.LPARAM]
user32.GetWindowThreadProcessId.restype = ctypes.c_ulong
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(ctypes.c_ulong)]
user32.GetWindowRect.restype = ctypes.c_bool
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(RECT)]
user32.GetClientRect.restype = ctypes.c_bool
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(RECT)]
user32.ClientToScreen.restype = ctypes.c_bool
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(POINT)]
user32.SetForegroundWindow.restype = ctypes.c_bool
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.ShowWindow.restype = ctypes.c_bool
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.BringWindowToTop.restype = ctypes.c_bool
user32.BringWindowToTop.argtypes = [wt.HWND]
user32.IsWindowVisible.restype = ctypes.c_bool
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.GetClassNameW.restype = ctypes.c_int
user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetForegroundWindow.restype = wt.HWND
kernel32.GetCurrentThreadId.restype = ctypes.c_ulong
kernel32.GetCurrentThreadId.argtypes = []
user32.AttachThreadInput.restype = ctypes.c_bool
user32.AttachThreadInput.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_bool]
user32.SetCursorPos.restype = ctypes.c_bool
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.mouse_event.restype = None
user32.mouse_event.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p]
user32.SendInput.restype = ctypes.c_uint
user32.SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(INPUT), ctypes.c_int]
user32.PostMessageW.restype = ctypes.c_bool
user32.PostMessageW.argtypes = [wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM]
user32.GetDpiForWindow.restype = ctypes.c_uint
user32.GetDpiForWindow.argtypes = [wt.HWND]
user32.IsWindow.restype = ctypes.c_bool
user32.IsWindow.argtypes = [wt.HWND]
user32.WindowFromPoint.restype = wt.HWND
user32.WindowFromPoint.argtypes = [POINT]
user32.SetWindowPos.restype = ctypes.c_bool
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]

LOG_LINES = []


def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line)
    LOG_LINES.append(line)


def flush_log():
    with open(os.path.join(HERE, "run.log"), "a", encoding="utf-8") as f:
        f.write("\n".join(LOG_LINES) + "\n")
    LOG_LINES.clear()


def sleep(ms):
    time.sleep(ms / 1000.0)


# ---------------- 窗口查找 ----------------
def find_windows_by_pid(pid):
    found = []

    def cb(hwnd, _):
        p = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return found


def find_dialog(title="选择图书"):
    h = user32.FindWindowW("#32770", title)
    return h or None


def window_text(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    if n == 0:
        return ""
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def window_class(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def window_rect(hwnd):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def child_rects(hwnd):
    out = []

    def cb(child, _):
        r = RECT()
        user32.GetWindowRect(child, ctypes.byref(r))
        out.append({
            "hwnd": child,
            "class": window_class(child),
            "text": window_text(child),
            "rect": (r.left, r.top, r.right, r.bottom),
        })
        return True

    user32.EnumChildWindows(hwnd, WNDENUMPROC(cb), 0)
    return out


def force_foreground(hwnd):
    """激活窗口到前台（纯激活，不改变窗口位置/大小）。"""
    if user32.GetForegroundWindow() == hwnd:
        return
    # 合成输入：使本进程获得设置前台窗口的权限
    dummy = INPUT(type=INPUT_MOUSE)
    dummy._.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=0x0001, time=0, dwExtraInfo=None)  # MOUSEEVENTF_MOVE
    user32.SendInput(1, ctypes.byref(dummy), ctypes.sizeof(INPUT))
    sleep(50)
    fg = user32.GetForegroundWindow()
    fg_thread = user32.GetWindowThreadProcessId(fg, None)
    cur = kernel32.GetCurrentThreadId()
    tgt = user32.GetWindowThreadProcessId(hwnd, None)
    user32.AttachThreadInput(cur, tgt, True)
    user32.AttachThreadInput(cur, fg_thread, True)
    user32.BringWindowToTop(hwnd)
    ok = user32.SetForegroundWindow(hwnd)
    user32.AttachThreadInput(cur, fg_thread, False)
    user32.AttachThreadInput(cur, tgt, False)
    sleep(80)
    log(f"force_foreground ok={ok} same={user32.GetForegroundWindow() == hwnd}")


def client_to_screen(hwnd, cx, cy):
    p = POINT(cx, cy)
    user32.ClientToScreen(hwnd, ctypes.byref(p))
    return (p.x, p.y)


def click_screen(x, y):
    user32.SetCursorPos(x, y)
    sleep(80)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, None)
    sleep(50)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, None)


def click_client(hwnd, cx, cy):
    x, y = client_to_screen(hwnd, cx, cy)
    log(f"click client({cx},{cy}) -> screen({x},{y})")
    click_screen(x, y)


def send_input_key(vk, flags=0):
    inp = INPUT(type=INPUT_KEYBOARD)
    inp._.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=flags)
    user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def tap(vk):
    send_input_key(vk, 0)
    sleep(30)
    send_input_key(vk, KEYEVENTF_KEYUP)
    sleep(30)


def combo(tap_keys):
    """按顺序点击组合键，如 ('control', 'a')。"""
    for k in tap_keys:
        if k == "control":
            tap(VK_CONTROL)
        elif k == "a":
            tap(0x41)
        else:
            raise ValueError(k)


def type_text(s):
    """SendInput Unicode 逐字符输入（不依赖键盘布局）。"""
    for ch in s:
        inp = INPUT(type=INPUT_KEYBOARD)
        inp._.ki = KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=KEYEVENTF_UNICODE)
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
        sleep(5)
        inp2 = INPUT(type=INPUT_KEYBOARD)
        inp2._.ki = KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
        user32.SendInput(1, ctypes.byref(inp2), ctypes.sizeof(INPUT))
        sleep(5)


def set_clipboard_text(text):
    """把文本写入剪贴板（用于绕过 IME 粘贴）。成功返回 True。"""
    try:
        import win32clipboard  # type: ignore
    except ImportError:
        return False
    try:
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        finally:
            win32clipboard.CloseClipboard()
        return True
    except Exception:
        return False


def shot(name, bbox=None):
    from PIL import ImageGrab
    if bbox is None:
        # 主屏全图
        bbox = (0, 0, 1920, 1080)
    path = os.path.join(SHOTS, name + ".png")
    ImageGrab.grab(bbox=bbox).save(path)
    log(f"shot {name}.png bbox={bbox}")
    return path


def process_memory_mb(pid):
    h = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        return None

    class PMC(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_uint), ("PageFaultCount", ctypes.c_uint),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

    pmc = PMC()
    pmc.cb = ctypes.sizeof(PMC)
    ok = psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb)
    kernel32.CloseHandle(h)
    if not ok:
        return None
    return pmc.WorkingSetSize / 1024 / 1024


# ---------------- 应用控制 ----------------
class App:
    def __init__(self, exe=EXE):
        self.proc = subprocess.Popen([exe], cwd=os.path.dirname(exe))
        self.pid = self.proc.pid
        self.hwnd = None
        for _ in range(50):
            sleep(200)
            ws = find_windows_by_pid(self.pid)
            if ws:
                self.hwnd = ws[0]
                break
        if not self.hwnd:
            raise RuntimeError("app window not found")
        log(f"app pid={self.pid} hwnd={self.hwnd} class={window_class(self.hwnd)} text={window_text(self.hwnd)!r}")
        cx = user32.GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
        cy = user32.GetSystemMetrics(79)  # SM_CYVIRTUALSCREEN
        vx = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
        vy = user32.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
        log(f"virtual screen: ({vx},{vy}) {cx}x{cy}; window rect={window_rect(self.hwnd)} dpi={user32.GetDpiForWindow(self.hwnd)}")
        force_foreground(self.hwnd)
        sleep(500)

    def rect(self):
        return window_rect(self.hwnd)

    def client_size(self):
        """客户区宽高（供按窗口尺寸推算弹窗内元素坐标，如 v0.2.8 管理对话框）。"""
        r = RECT()
        user32.GetClientRect(self.hwnd, ctypes.byref(r))
        return (r.right, r.bottom)

    def move_to(self, x, y):
        """把窗口移到屏幕指定位置（避开右上角通知弹窗区，防其盖住工具栏按钮）。"""
        r = window_rect(self.hwnd)
        w, h = r[2] - r[0], r[3] - r[1]
        ok = user32.SetWindowPos(self.hwnd, 0, x, y, w, h, 0x0004)  # SWP_NOZORDER
        sleep(300)
        log(f"move_window -> ({x},{y}) ok={bool(ok)} rect={window_rect(self.hwnd)}")
        return window_rect(self.hwnd)

    def resize_to(self, w, h):
        """把客户区尺寸设为 w×h（v0.2.9 A84：验证窄窗下的适配回落）。

        SetWindowPos 按窗口矩形计量，需先补回标题栏/边框厚度。
        窗口有最小尺寸限制（main.go 900×600），小于下限时以系统限制为准。
        """
        r = window_rect(self.hwnd)
        cw, ch = self.client_size()
        ww = w + (r[2] - r[0]) - cw
        wh = h + (r[3] - r[1]) - ch
        ok = user32.SetWindowPos(self.hwnd, 0, 0, 0, ww, wh, 0x0002 | 0x0004)  # SWP_NOMOVE|SWP_NOZORDER
        sleep(400)
        got = self.client_size()
        log(f"resize_to -> ({w}x{h}) ok={bool(ok)} client={got}")
        return got

    def dpi(self):
        try:
            return user32.GetDpiForWindow(self.hwnd)
        except Exception:
            return 96

    def memory_mb(self):
        return process_memory_mb(self.pid)

    def alive(self):
        return self.proc.poll() is None and user32.IsWindow(self.hwnd)

    def close(self):
        user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)


def dump_dialog(dlg):
    kids = child_rects(dlg)
    log(f"dialog hwnd={dlg} children={len(kids)}")
    for k in kids:
        log(f"  child class={k['class']!r:22s} text={k['text']!r:28s} rect={k['rect']}")
    return kids


def probe():
    app = App()
    r = app.rect()
    origin = client_to_screen(app.hwnd, 0, 0)
    log(f"window rect={r} client-origin={origin} inset=({origin[0]-r[0]},{origin[1]-r[1]}) dpi={app.dpi()}")
    sleep(1500)
    shot("probe-01-empty", bbox=r)
    log(f"memory empty: {app.memory_mb():.1f} MB")
    # 打开对话框探针：窗口坐标 (147,58) 即「打开图书」按钮中心
    click_screen(r[0] + 147, r[1] + 58)
    dlg = None
    for _ in range(25):
        sleep(200)
        dlg = find_dialog()
        if dlg:
            break
    if not dlg:
        log("DIALOG NOT FOUND")
        app.close()
        flush_log()
        return
    dump_dialog(dlg)
    shot("probe-02-dialog", bbox=window_rect(dlg))
    # 取消
    tap(VK_ESCAPE)
    sleep(500)
    app.close()
    sleep(1500)
    log(f"alive after close: {app.alive()}")
    flush_log()


# ---------------- 场景框架 ----------------
# 「打开图书」按钮通过像素扫描定位（当前强调色），不硬编码坐标：
# 环境中曾出现窗口恢复动画/半透明帧导致颜色与坐标漂移，扫描自适应。
# 强调色可在设置中更改（v0.2.0 起持久化），驱动需识别全部 6 色，否则重启后
# 非默认强调色会导致按钮定位失败（实测：绿色强调色重启后扫不到品牌蓝）。
BRAND_BLUE = (37, 99, 235)
ACCENT_COLORS = [
    BRAND_BLUE,      # 蓝（默认）
    (79, 70, 229),   # 靛蓝
    (5, 150, 105),   # 绿
    (217, 119, 6),   # 琥珀
    (225, 29, 72),   # 玫红
    (8, 145, 178),   # 青
]


def find_open_button(app):
    """在工具栏条带中像素扫描「打开图书」按钮（任意强调色），返回屏幕坐标中心。"""
    from PIL import ImageGrab
    r = app.rect()
    bbox = (r[0], r[1] + 32, r[0] + 500, r[1] + 100)
    im = ImageGrab.grab(bbox=bbox)
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            p = im.getpixel((x, y))
            for c in ACCENT_COLORS:
                if (abs(p[0] - c[0]) < 20 and abs(p[1] - c[1]) < 20
                        and abs(p[2] - c[2]) < 20):
                    xs.append(x)
                    ys.append(y)
                    break
    if not xs:
        return None
    return (r[0] + (min(xs) + max(xs)) // 2, r[1] + 32 + (min(ys) + max(ys)) // 2)


def wait_dialog(timeout_ms=10000):
    for _ in range(timeout_ms // 100):
        sleep(100)
        dlg = find_dialog()
        if dlg:
            return dlg
    return None


def wait_dialog_gone(timeout_ms=15000):
    for _ in range(timeout_ms // 100):
        sleep(100)
        if not find_dialog():
            return True
    return False


def pixel_at(x, y):
    """截取单像素颜色（前端就绪检测用）。"""
    from PIL import ImageGrab
    try:
        return ImageGrab.grab(bbox=(x, y, x + 1, y + 1)).getpixel((0, 0))
    except Exception:
        return None


user32.IsIconic.restype = ctypes.c_bool
user32.IsIconic.argtypes = [wt.HWND]


# 应用窗口期望位置（与 main.go 的 1280×860 + 屏幕居中一致；异常时由驱动显式复位）
EXPECT_RECT = (320, 90, 1600, 950)


def ensure_ready(app, timeout_ms=25000):
    """确保应用窗口可交互：未最小化、位置尺寸符合预期、在前台、前端已加载。

    环境中其他程序（IDE）会抢前台并偶发移动/最小化窗口，故就绪门显式复位窗口位置，
    与验收无关（窗口位置不属于验收标准）。
    """
    deadline = time.time() + timeout_ms / 1000
    last = {}
    while time.time() < deadline:
        if user32.IsIconic(app.hwnd):
            log("ensure_ready: 窗口已最小化，执行 SW_RESTORE")
            user32.ShowWindow(app.hwnd, SW_RESTORE)
            sleep(600)
            continue
        r = app.rect()
        if r != EXPECT_RECT:
            log(f"ensure_ready: 窗口 rect={r} 非预期，复位到 {EXPECT_RECT}")
            user32.SetWindowPos(app.hwnd, 0, EXPECT_RECT[0], EXPECT_RECT[1],
                                EXPECT_RECT[2] - EXPECT_RECT[0], EXPECT_RECT[3] - EXPECT_RECT[1],
                                0x0040)  # SWP_SHOWWINDOW
            sleep(400)
            continue
        force_foreground(app.hwnd)
        btn = find_open_button(app)
        last = {"fg_ok": user32.GetForegroundWindow() == app.hwnd, "btn": btn}
        if btn and last["fg_ok"]:
            return True
        sleep(400)
    log(f"ensure_ready 超时: {last}")
    return False


def open_file(app, filename, switch_filter=False, shot_prefix=None):
    """点击「打开图书」→ 对话框输入路径 → 回车。返回是否成功关闭对话框。"""
    if not ensure_ready(app):
        log(f"open_file({filename}): 应用未就绪，仍尝试点击")
    sleep(500)  # 就绪后稍作稳定，避免点击落在 hydration 瞬间
    dlg = None
    for attempt in range(3):
        btn = find_open_button(app)
        if not btn:
            log(f"open_file({filename}): 未定位到「打开图书」按钮")
            force_foreground(app.hwnd)
            sleep(500)
            continue
        force_foreground(app.hwnd)
        click_screen(*btn)
        dlg = wait_dialog(3000)
        if dlg:
            break
        log(f"open_file({filename}): 第 {attempt + 1} 次点击未弹出对话框，重试")
        force_foreground(app.hwnd)
        sleep(500)
    if not dlg:
        log(f"open_file({filename}): 对话框未出现")
        return False
    kids = child_rects(dlg)
    edit = next((k for k in kids if k["class"] == "Edit" and k["rect"][1] > 500), None)
    combo = next((k for k in kids if k["class"] == "ComboBox" and k["rect"][1] > 500), None)
    if not edit:
        log(f"open_file({filename}): 未找到文件名输入框")
        return False
    log(f"open_file({filename}): edit={edit['rect']} combo={combo['rect'] if combo else None}")
    if switch_filter and combo:
        c = ((combo["rect"][0] + combo["rect"][2]) // 2, (combo["rect"][1] + combo["rect"][3]) // 2)
        click_screen(*c)
        sleep(400)
        if shot_prefix:
            shot(shot_prefix + "-filter", bbox=window_rect(dlg))
        tap(0x28)  # VK_DOWN → 「所有文件 (*.*)」
        tap(VK_RETURN)
        sleep(400)
    e = ((edit["rect"][0] + edit["rect"][2]) // 2, (edit["rect"][1] + edit["rect"][3]) // 2)
    log(f"open_file({filename}): 点击输入框 {e}")
    click_screen(*e)
    sleep(300)
    full = os.path.join(FIX, filename)
    # 优先用 SetWindowText 直接写文件名控件：
    # - 剪贴板粘贴会被对话框的自动补全/历史记录干扰（实测打开的是上次文件）
    # - 逐字符 SendInput 会被搜狗输入法吞掉
    # SetWindowText 走 Win32 消息通道，不经过 IME，最稳定。
    buf = ctypes.create_unicode_buffer(full)
    # SendMessageW 未声明 argtypes 时指针参数会被当成 32 位 int 溢出，需先声明
    user32.SendMessageW.argtypes = [
        ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_wchar_p
    ]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW(edit["hwnd"], 0x000C, 0, full)  # WM_SETTEXT
    sleep(250)
    set_clipboard_text(full)  # 供后续可能的 Ctrl+V 兜底
    sleep(200)
    log(f"open_file({filename}): 已设置路径，回车")
    tap(VK_RETURN)
    if not wait_dialog_gone():
        log(f"open_file({filename}): 对话框未关闭（可能路径被拒）")
        return False
    sleep(400)
    title = window_text(app.hwnd)
    if title != f"BookEditor — {filename}":
        log(f"open_file({filename}): 标题不匹配（实际={title!r}）")
        return False
    log(f"open_file({filename}): 对话框已关闭，窗口标题={title!r}")
    return True


SCENARIOS = {}


def scenario(name):
    def deco(fn):
        SCENARIOS[name] = fn
        return fn
    return deco


@scenario("txt")
def sc_txt():
    app = App()
    sleep(1500)
    shot("01-empty", bbox=app.rect())
    log(f"A01 空态窗口标题={window_text(app.hwnd)!r} 内存={app.memory_mb():.1f}MB")
    cases = [
        ("sample-utf8.txt", "03-txt-utf8"),
        ("sample-gbk.txt", "04-txt-gbk"),
        ("sample-bom.txt", "05-txt-bom"),
        ("sample-empty.txt", "06-txt-empty"),
    ]
    for fn, shotname in cases:
        ok = open_file(app, fn)
        sleep(1800)
        shot(shotname, bbox=app.rect())
        log(f"{fn}: 对话框关闭={ok} 窗口标题={window_text(app.hwnd)!r} 窗口={app.rect()} 内存={app.memory_mb():.1f}MB")
    # A09 取消静默：有书打开时取消，不应出现错误条
    btn = find_open_button(app)
    log(f"A09 按钮定位={btn}")
    click_screen(*btn)
    dlg = wait_dialog()
    log(f"A09 取消前对话框={bool(dlg)}")
    tap(VK_ESCAPE)
    sleep(800)
    shot("07-cancel-silent", bbox=app.rect())
    log(f"A09 取消后窗口标题={window_text(app.hwnd)!r} 窗口={app.rect()}")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


def find_pdf_buttons(app):
    """在 PDF 控制条中定位「可用」翻页按钮（完整边框 #d8dee7；禁用按钮透明度 45% 边框被冲淡）。

    返回按 x 升序的屏幕坐标中心列表：第 1 页只有 [下一页]；
    中间页有 [上一页, 下一页]；末页只有 [上一页]。
    """
    from PIL import ImageGrab
    r = app.rect()
    # 控制条：窗口 y 771..823；按钮：y 782..812，中心 y 797
    im = ImageGrab.grab(bbox=(r[0], r[1] + 760, r[0] + 500, r[1] + 830))

    def border_runs(dy):
        runs = []
        in_run = False
        for x in range(im.width):
            p = im.getpixel((x, dy))
            if abs(p[0] - 216) < 12 and abs(p[1] - 222) < 12 and abs(p[2] - 231) < 12:
                if not in_run:
                    start = x
                    in_run = True
            else:
                if in_run and x - start > 3:
                    runs.append((start, x - 1))
                in_run = False
        return runs

    top = border_runs(782 - 760)
    bot = border_runs(812 - 760)
    btns = []
    for (a, b) in top:
        for (c, d) in bot:
            if abs(a - c) < 3 and abs(b - d) < 3:
                btns.append((r[0] + (a + b) // 2, r[1] + 797))
    return btns


@scenario("pdf")
def sc_pdf():
    app = App()
    sleep(1500)
    ok = open_file(app, "sample.pdf")
    sleep(3500)
    shot("10-pdf-page1", bbox=app.rect())
    log(f"A04 PDF 打开={ok} 标题={window_text(app.hwnd)!r} 内存={app.memory_mb():.1f}MB")
    btns = find_pdf_buttons(app)
    log(f"第 1 页可用按钮={btns}（预期 1 个：下一页；上一页禁用）")
    assert len(btns) == 1, f"第 1 页应只有「下一页」可用，实际 {btns}"
    click_screen(*btns[0])
    sleep(1800)
    shot("11-pdf-page2", bbox=app.rect())
    btns2 = find_pdf_buttons(app)
    log(f"第 2 页可用按钮={btns2}（预期 2 个）")
    assert len(btns2) == 2, f"第 2 页应有两个可用按钮，实际 {btns2}"
    next_x = btns2[1][0]  # 记住「下一页」的 x，用于末页禁用点击测试
    click_screen(*btns2[1])
    sleep(1800)
    shot("12-pdf-page3", bbox=app.rect())
    btns3 = find_pdf_buttons(app)
    log(f"第 3 页可用按钮={btns3}（预期 1 个：上一页；下一页禁用）")
    assert len(btns3) == 1, f"末页应只有「上一页」可用，实际 {btns3}"
    # 边界钳制：点击已禁用的「下一页」位置（复用第 2 页坐标），页面不应变化
    r = app.rect()
    click_screen(next_x, r[1] + 797)
    sleep(1200)
    shot("13-pdf-page3-clamp", bbox=app.rect())
    # 上一页回到第 2 页
    click_screen(*btns3[0])
    sleep(1800)
    shot("14-pdf-back-page2", bbox=app.rect())
    log(f"内存={app.memory_mb():.1f}MB 窗口={app.rect()}")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


def find_toc_items(app):
    """定位 EPUB 目录项：以 active 项背景 #eff6ff 为锚，项高约 33px 等距推算。

    返回屏幕坐标中心列表：[当前 active 项, 下一项]（侧边栏无 active 背景时返回 []）。
    """
    from PIL import ImageGrab
    r = app.rect()
    im = ImageGrab.grab(bbox=(r[0], r[1] + 83, r[0] + 224, r[1] + 500))
    active_rows = []
    for y in range(im.height):
        cnt = 0
        for x in range(0, im.width, 3):
            p = im.getpixel((x, y))
            if abs(p[0] - 239) < 6 and abs(p[1] - 246) < 6 and abs(p[2] - 255) < 6:
                cnt += 1
        if cnt > 30:
            active_rows.append(y)
    if not active_rows:
        return []
    item_h = 33
    first_center = (min(active_rows) + max(active_rows)) // 2
    return [
        (r[0] + 112, r[1] + 83 + first_center),
        (r[0] + 112, r[1] + 83 + first_center + item_h),
    ]


@scenario("epub")
def sc_epub():
    app = App()
    sleep(1500)
    ok = open_file(app, "sample.epub")
    sleep(5000)
    shot("20-epub-ch1", bbox=app.rect())
    log(f"A03/A18 EPUB 打开={ok} 标题={window_text(app.hwnd)!r} 内存={app.memory_mb():.1f}MB")
    toc = find_toc_items(app)
    log(f"目录项定位={toc}")
    assert len(toc) >= 2, f"应至少定位到 2 个目录项，实际 {toc}"
    click_screen(*toc[1])
    sleep(2500)
    shot("21-epub-ch2", bbox=app.rect())
    log(f"A18 目录跳转后 内存={app.memory_mb():.1f}MB")
    # 无目录 EPUB：侧边栏应降级隐藏
    ok2 = open_file(app, "sample-notoc.epub")
    sleep(4000)
    shot("22-epub-notoc", bbox=app.rect())
    toc2 = find_toc_items(app)
    log(f"无目录 EPUB 打开={ok2} 目录项={toc2}（预期空）")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


@scenario("errors")
def sc_errors():
    app = App()
    sleep(1500)
    ok = open_file(app, "sample-utf8.txt")
    sleep(1500)
    shot("30-base-txt", bbox=app.rect())
    log(f"错误前置：已打开 TXT={ok}")
    # A07/A08：mobi / azw3（需切「所有文件」过滤器）
    for fn, shotname in [("sample.mobi", "31-mobi-reject"), ("sample.azw3", "32-azw3-reject")]:
        ok = open_file(app, fn, switch_filter=True, shot_prefix=shotname)
        sleep(1500)
        shot(shotname, bbox=app.rect())
        log(f"{fn}: 对话框关闭={ok} 标题={window_text(app.hwnd)!r}")
    # A10：>100MB
    ok = open_file(app, "over-100mb.pdf")
    sleep(1500)
    shot("33-too-large", bbox=app.rect())
    log(f"over-100mb.pdf: 对话框关闭={ok}")
    # A12：损坏 PDF
    ok = open_file(app, "broken.pdf")
    sleep(2500)
    shot("34-broken-pdf", bbox=app.rect())
    log(f"broken.pdf: 对话框关闭={ok}")
    # A13：损坏 EPUB（epubjs 挂起 → 10s 超时后应显示解析失败）
    ok = open_file(app, "broken.epub")
    sleep(13000)
    shot("35-broken-epub", bbox=app.rect())
    log(f"broken.epub: 对话框关闭={ok}")
    # A11：恰好 100MB（不放 FILE_TOO_LARGE；进入解析后失败）
    log("exact-100mb 开始（大数据传输，等待 50s）")
    t0 = time.time()
    ok = open_file(app, "exact-100mb.pdf")
    log(f"exact-100mb.pdf 对话框关闭={ok} 耗时={time.time()-t0:.1f}s")
    sleep(45000)
    shot("36-exact-100mb", bbox=app.rect())
    log(f"exact-100mb 后 内存={app.memory_mb():.1f}MB")
    app.close()
    sleep(2000)
    log(f"进程存活={app.alive()}")
    flush_log()


@scenario("perf")
def sc_perf():
    app = App()
    sleep(1500)
    mem0 = app.memory_mb()
    log(f"A17 打开前内存={mem0:.1f}MB")
    t0 = time.time()
    ok = open_file(app, "perf-30mb.pdf")
    log(f"对话框关闭={ok} 耗时={time.time()-t0:.1f}s")
    sleep(6000)
    mem1 = app.memory_mb()
    shot("40-perf-30mb", bbox=app.rect())
    log(f"A17 打开后内存={mem1:.1f}MB（增量 {mem1-mem0:+.1f}MB）")
    app.close()
    sleep(2000)
    log(f"进程存活={app.alive()}")
    flush_log()


def debug_click_probe():
    app = App()
    sleep(2500)
    r = app.rect()
    shot("debug-state", bbox=r)
    px = pixel_at(r[0] + UI_OPEN_BTN[0], r[1] + UI_OPEN_BTN[1])
    log(f"rect={r} px@button={px} fg_same={user32.GetForegroundWindow() == app.hwnd}")
    app.close()
    sleep(1000)
    log(f"alive={app.alive()}")
    flush_log()


def watch_probe():
    app = App()
    for i in range(30):
        force_foreground(app.hwnd)
        r = app.rect()
        fg = user32.GetForegroundWindow()
        log(f"t+{i*0.4:.2f}s rect={r} iconic={user32.IsIconic(app.hwnd)} fg={fg} same={fg == app.hwnd} mem={app.memory_mb():.1f}")
        sleep(400)
    app.close()
    sleep(1000)
    log(f"alive={app.alive()}")
    flush_log()


@scenario("pdfclick")
def sc_pdfclick():
    """对照实验：单次点击「下一页」，分时段截图，确认是否一次点击翻两页。"""
    app = App()
    sleep(1500)
    ok = open_file(app, "sample.pdf")
    sleep(3500)
    shot("50-pdfclick-p1", bbox=app.rect())
    btns = find_pdf_buttons(app)
    log(f"p1 按钮={btns}")
    click_screen(*btns[0])
    sleep(700)
    shot("51-pdfclick-after700ms", bbox=app.rect())
    sleep(1500)
    shot("52-pdfclick-after2200ms", bbox=app.rect())
    btns2 = find_pdf_buttons(app)
    log(f"点击一次后按钮={btns2}")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


@scenario("epubopen")
def sc_epubopen():
    """打开 EPUB 并截图（用于测量目录项位置）。"""
    app = App()
    sleep(1500)
    ok = open_file(app, "sample.epub")
    sleep(5000)
    shot("20-epub-ch1", bbox=app.rect())
    log(f"EPUB 打开={ok} 标题={window_text(app.hwnd)!r} 内存={app.memory_mb():.1f}MB")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


@scenario("epub10x")
def sc_epub10x():
    """M3 Gate #3：反复打开 EPUB 10 次，内存曲线应平稳无累积。"""
    app = App()
    sleep(1500)
    mems = []
    for i in range(10):
        ok = open_file(app, "sample.epub")
        sleep(4000)
        m = app.memory_mb()
        mems.append(m)
        log(f"第 {i + 1} 次打开: ok={ok} 标题={window_text(app.hwnd)!r} 内存={m:.1f}MB")
    log(f"内存序列: {['%.0f' % m for m in mems]}（末次/首次={mems[-1] / mems[0]:.2f}）")
    shot("60-epub-10x-final", bbox=app.rect())
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


@scenario("epubrepro")
def sc_epubrepro():
    """逐个打开真实结构模拟样本，截图定位「目录正常但正文空白」的复现体。"""
    app = App()
    sleep(1500)
    cases = [
        "r1-cover-image-broken.epub",
        "r2-img-first-broken.epub",
        "r3-gbk-decl.epub",
        "r4-encoded-names.epub",
        "r5-vertical.epub",
        "r6-obfuscated-font.epub",
        "r7-epub3-full.epub",
    ]
    for i, fn in enumerate(cases):
        tag = fn.split("-")[0]
        ok = open_file(app, fn)
        sleep(7000)
        shot(f"70-{tag}-{fn.replace('.epub', '')}", bbox=app.rect())
        log(f"{fn}: 对话框关闭={ok} 标题={window_text(app.hwnd)!r} 内存={app.memory_mb():.1f}MB")
    app.close()
    sleep(1500)
    log(f"进程存活={app.alive()}")
    flush_log()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "probe"
    try:
        if cmd == "probe":
            probe()
        elif cmd == "debugclick":
            debug_click_probe()
        elif cmd == "watch":
            watch_probe()
        elif cmd == "run":
            name = sys.argv[2]
            SCENARIOS[name]()
        else:
            print("unknown cmd:", cmd)
    except Exception as e:
        import traceback
        log(f"场景异常: {e}")
        log(traceback.format_exc())
        raise
    finally:
        flush_log()
