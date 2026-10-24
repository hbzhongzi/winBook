"""A68 scan_bind_buttons 失败诊断探针。

复位默认（浅色）→ 开面板 → nav 快捷键 → 在预期「+ 绑定」文字区域取像素颜色，
并跑一遍扫描聚类逻辑打印中间量，定位「找到 0 个」的原因。
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, force_foreground
import ctypes

user32 = ctypes.windll.user32

GEAR = (1241, 26)
NAV_HK = (394, 271)
SAVE = (910, 680)
RESET_ADV = (889, 250)
NAV_ADV = (394, 308)

TEXT2_LIGHT = (107, 114, 128)
TEXT2_DARK = (148, 163, 184)


def near(p, rgb, tol=12):
    return all(abs(p[i] - rgb[i]) <= tol for i in range(3))


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
    sleep(250)


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    D.open_file(app, "12.epub")
    fg(app)
    sleep(2500)

    # 复位默认（浅色）
    click(app, *GEAR)
    sleep(1000)
    click(app, *NAV_ADV)
    sleep(500)
    click(app, *RESET_ADV)
    sleep(500)
    click(app, *SAVE)
    sleep(700)
    from driver import tap, VK_ESCAPE
    tap(VK_ESCAPE)
    sleep(700)

    # 开面板 → 快捷键窗格
    click(app, *GEAR)
    sleep(1200)
    click(app, *NAV_HK)
    move_mouse_away()
    sleep(600)
    shot("dbg-hk-pane", bbox=app.rect())

    r = app.rect()
    ox, oy = D.client_to_screen(app.hwnd, 0, 0)
    off = (ox - r[0], oy - r[1])
    log(f"window rect={r} off={off}")

    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=app.rect())
    # 预期文字中心（客户区）：prev(885,312) next(885,389) home(885,436) end(885,483)
    for name, (cx, cy) in [("prev", (885, 312)), ("next", (885, 389)),
                           ("home", (885, 436)), ("end", (885, 483))]:
        sx, sy = cx + off[0], cy + off[1]
        log(f"{name}: client({cx},{cy}) -> screenshot({sx},{sy}) px={im.getpixel((sx, sy))}")
    # 文字带横向取样（y=312 行，x 860..910）
    row = []
    for sx in range(860 + off[0], 912 + off[0]):
        row.append(im.getpixel((sx, 312 + off[1])))
    log(f"prev 行 x860..911: {row}")
    # 扫 text-2 命中数
    hits = 0
    for cy in range(280, 660):
        for cx in range(850, 950):
            p = im.getpixel((cx + off[0], cy + off[1]))
            if near(p, TEXT2_LIGHT, 14) or near(p, TEXT2_DARK, 14):
                hits += 1
    log(f"text-2 命中像素总数: {hits}")
    app.close()
    sleep(1000)
    D.flush_log()


if __name__ == "__main__":
    main()
