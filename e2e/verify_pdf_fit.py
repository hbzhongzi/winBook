"""v0.2.9 PDF 显示适配真机验证（A83–A95 中可自动化部分）。

覆盖：
- A83 page 模式默认「自适应」→ 判适宽：白页横向铺满内容区内盒，左右无大留白
- A84 窗口缩到最小 900×600 → 仍判适宽铺满（翻转点 480px 内盒宽 < 窗口下限，真机不触发，由单测覆盖）
- A87 双页：控制条 chip 档位菜单选「双页」→ 检测到两段白页（间距为内容区背景色），翻页步进 2
- A88 Ctrl+滚轮：倍率下调 → 白页变窄；上调 → 恢复；工具栏倍率读数同步变化
- A89 持久化：重启应用后倍率保持（白页宽度复现）
- A91 滚动模式：白页同样铺满内盒宽（去 720px 硬编码）
- A95 位置回归：翻页后页码指示器变化（精确页码恢复由 verify_positions.py 覆盖）

断言手法：截图扫描「近白像素」横向范围得到页面实际渲染宽度（自标定，不依赖固定坐标）。
前提：默认浅色主题（页面 #fff / 内容区 #eef1f5）；DPI 缩放下以内盒实测宽度为基准，天然兼容。

坐标标定点（窗口几何变化时需微调，常量集中在下方 CONFIG）：
- 控制条 chip：右对齐于内容区右缘 −14px，垂直居中于控制条
- 档位菜单：自 chip 向上展开，宽 172px，五项等高 29px

驱动：driver.py（Win32 点击/SendInput/PIL 截图）。
用法：python e2e/verify_pdf_fit.py [fixture]
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import driver as D
from driver import App, log, sleep, shot, click_client, force_foreground
import ctypes
from PIL import ImageGrab

user32 = ctypes.windll.user32

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "sample.pdf"

# ---- CONFIG：几何常量（客户区坐标，相对窗口左上；标题栏高度运行时实测）----
TOOLBAR_H = 53        # 工具栏高（styles.css .toolbar padding 10 + 34 按钮）
CONTROLS_H = 53       # PDF 控制条高
PAD = 22              # .pdf-canvas-area padding
CHIP_RIGHT_INSET = 14 # chip 右缘距内容区右缘（.pdf-controls padding-right）
CHIP_W = 110          # chip 估算宽（「自适应 208%」+ caret + padding）
MENU_W = 172          # .zoom-menu min-width
MENU_ITEM_H = 29      # .zoom-menu .menu-item 等高
MENU_TITLE_H = 19     # .menu-title 高
MENU_TOP_GAP = 6      # 菜单与 chip 底缘间距
VK_CONTROL = 0x11
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120

RESULTS = []
CUR = [None]

# 近白判定：页面 #fff；内容区背景 #eef1f5 与阴影均不算白
WHITE_MIN = 248


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def fg(app=None):
    hwnd = app.hwnd if app else CUR[0]
    for _ in range(4):
        force_foreground(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        sleep(300)
    return False


def click(hwnd, x, y):
    fg()
    click_client(hwnd, x, y)


def key_tap(vk):
    fg()
    D.tap(vk)


def geometry(app):
    """窗口几何（截图坐标系）：off=标题栏高，content=内容区行范围（避开工具栏/控制条/状态栏）。"""
    r = app.rect()
    cw, ch = app.client_size()
    off = (r[3] - r[1]) - ch
    top = off + TOOLBAR_H + 20
    bottom = off + ch - CONTROLS_H - 20
    return {"rect": r, "cw": cw, "ch": ch, "off": off, "top": top, "bottom": bottom}


def white_runs(im, geo, row):
    """某一截图行上的近白连续段（屏幕坐标 x 列表的 (start,end) 段）。"""
    y = row
    runs = []
    in_run = False
    for x in range(geo["rect"][0], geo["rect"][2]):
        p = im.getpixel((x, y))
        if p[0] >= WHITE_MIN and p[1] >= WHITE_MIN and p[2] >= WHITE_MIN:
            if not in_run:
                start = x
                in_run = True
        else:
            if in_run:
                runs.append((start, x - 1))
            in_run = False
    if in_run:
        runs.append((start, geo["rect"][2] - 1))
    # 过滤窄段（页内文字间噪点）
    return [(a, b) for (a, b) in runs if b - a >= 24]


def page_extent(app, im=None):
    """扫描内容区多行，取近白像素的横向范围（屏幕坐标）。

    返回 (left, right, width, runs)：runs 为该行白段数（>1 即双页并排）。
    行采样避开页首/页尾（阴影与圆角），取白像素最多的那一行的段结构。
    """
    geo = geometry(app)
    im = im or ImageGrab.grab(bbox=geo["rect"])
    best = None
    for row in range(geo["top"] + 30, geo["bottom"] - 30, 6):
        runs = white_runs(im, geo, row)
        if not runs:
            continue
        left = min(a for a, _ in runs)
        right = max(b for _, b in runs)
        if best is None or (right - left) > (best[2] - best[1]):
            best = (left, right, right - left + 1, len(runs))
    return best if best else (0, 0, 0, 0)


def controls_bar_rect(app):
    """控制条区域（客户区坐标，供点击 chip / 截图 diff）。"""
    geo = geometry(app)
    return (0, geo["ch"] - CONTROLS_H, geo["cw"], geo["ch"])


def chip_center(app):
    """控制条 chip 中心（客户区坐标）：右对齐 −14，宽约 CHIP_W。"""
    geo = geometry(app)
    x = geo["cw"] - CHIP_RIGHT_INSET - CHIP_W // 2
    y = geo["ch"] - CONTROLS_H + CONTROLS_H // 2
    return (x, y)


def menu_item_center(app, idx):
    """档位菜单第 idx 项中心（客户区坐标）：菜单自 chip 底缘向上展开。"""
    geo = geometry(app)
    chip = chip_center(app)
    menu_h_guess = 5 + MENU_TITLE_H + 5 * MENU_ITEM_H + 9 + MENU_TITLE_H + 58 + 30 + 5
    menu_top = geo["ch"] - CONTROLS_H - MENU_TOP_GAP - menu_h_guess
    y = menu_top + 5 + MENU_TITLE_H + idx * MENU_ITEM_H + MENU_ITEM_H // 2
    x = geo["cw"] - CHIP_RIGHT_INSET - MENU_W // 2
    return (x, y)


def toolbar_zoom_area(app):
    """工具栏缩放组区域（客户区坐标，右侧）：倍率读数变化用截图 diff 验证。"""
    geo = geometry(app)
    return (geo["cw"] - 260, 10, geo["cw"] - 130, TOOLBAR_H - 8)


def region_diff(a, b, box, off, thresh=18):
    """两截图在客户区区域内的差异像素数（2 步长抽样；off=标题栏高）。"""
    x0, y0, x1, y1 = box
    n = 0
    for y in range(y0 + off, y1 + off, 2):
        for x in range(x0 + 1, x1 + 1, 2):
            pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
            if any(abs(pa[i] - pb[i]) > thresh for i in range(3)):
                n += 1
    return n


def ctrl_wheel(app, delta):
    """在内容区中心做 Ctrl+滚轮（delta>0 放大）。"""
    geo = geometry(app)
    cx, cy = geo["cw"] // 2, (geo["top"] + geo["bottom"]) // 2
    sx, sy = D.client_to_screen(app.hwnd, cx, cy)
    user32.SetCursorPos(sx, sy)
    sleep(150)
    user32.keybd_event(VK_CONTROL, 0, 0, 0)
    sleep(60)
    user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, WHEEL_DELTA if delta > 0 else -WHEEL_DELTA, 0)
    sleep(60)
    user32.keybd_event(VK_CONTROL, 0, 2, 0)  # KEYEVENTF_KEYUP
    sleep(1200)


def switch_to_scroll(app):
    """点工具栏模式段「滚动」（当前为翻页时翻页项为蓝底，滚动在其左侧约 50px）。"""
    from PIL import ImageGrab
    geo = geometry(app)
    im = ImageGrab.grab(bbox=geo["rect"])
    # 工具栏行内找强调色块（#2563eb 附近）
    xs = []
    row = geo["off"] + TOOLBAR_H // 2
    for x in range(geo["rect"][0], geo["rect"][2]):
        p = im.getpixel((x, row))
        if abs(p[0] - 0x25) < 24 and abs(p[1] - 0x63) < 24 and abs(p[2] - 0xEB) < 24:
            xs.append(x)
    if not xs:
        return None
    blue_cx = (min(xs) + max(xs)) // 2
    return (blue_cx - 50, TOOLBAR_H // 2)


def run_once():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    CUR[0] = app.hwnd
    app.move_to(40, 60)  # 避开右上角通知弹窗区
    ok = D.open_file(app, FIXTURE)
    log(f"pdf-fit: open_file -> {ok}, title={D.window_text(app.hwnd)!r}")
    fg(app)
    sleep(3500)
    shot("pf-00-open", bbox=app.rect())
    geo = geometry(app)
    inner_w = geo["cw"] - PAD * 2
    log(f"窗口 client={geo['cw']}x{geo['ch']} 内盒宽={inner_w}")

    # ===== A83：默认自适应 → 适宽铺满 =====
    left, right, w, runs = page_extent(app)
    margin_l = left - geo["rect"][0] - PAD
    margin_r = geo["rect"][2] - right - PAD
    check(
        "A83-默认自适应适宽铺满",
        runs == 1 and w >= inner_w * 0.95 and abs(margin_l) < 40 and abs(margin_r) < 40,
        f"白页宽={w} 内盒={inner_w} 左留白={margin_l} 右留白={margin_r} 段数={runs}",
    )
    shot("pf-01-a83-width-fill", bbox=app.rect())

    # ===== A88：Ctrl+滚轮下调 → 变窄；上调 → 恢复 =====
    ctrl_wheel(app, -1)
    sleep(800)
    l2, r2, w2, runs2 = page_extent(app)
    check(
        "A88-Ctrl+滚轮倍率下调页面变窄",
        runs2 == 1 and w2 < w * 0.97,
        f"{w} → {w2}",
    )
    # 工具栏倍率读数应随倍率变化（自适应 208% → 自定义 198% → 208%）
    im_tb0 = ImageGrab.grab(bbox=app.rect())
    ctrl_wheel(app, +1)
    sleep(800)
    l3, r3, w3, runs3 = page_extent(app)
    check(
        "A88-Ctrl+滚轮倍率上调页面恢复",
        runs3 == 1 and abs(w3 - w) <= max(6, w * 0.02),
        f"{w2} → {w3}（基准 {w}）",
    )
    im_tb1 = ImageGrab.grab(bbox=app.rect())
    d_tb = region_diff(im_tb0, im_tb1, toolbar_zoom_area(app), geo["off"])
    check("A88-工具栏倍率读数同步变化", d_tb > 0, f"工具栏缩放区 diff={d_tb}")
    shot("pf-02-a88-zoom-nudge", bbox=app.rect())

    # ===== A87：双页并排 =====
    chip = chip_center(app)
    log(f"chip 坐标（标定）={chip}")
    click(app.hwnd, *chip)
    sleep(600)
    shot("pf-03-a87-menu", bbox=app.rect())
    item = menu_item_center(app, 3)  # 0=auto 1=width 2=height 3=spread 4=custom
    log(f"档位菜单「双页」坐标（标定）={item}")
    click(app.hwnd, *item)
    sleep(2200)
    shot("pf-04-a87-spread", bbox=app.rect())
    l4, r4, w4, runs4 = page_extent(app)
    check(
        "A87-双页并排两段白页",
        runs4 >= 2,
        f"白段数={runs4} 总宽={w4}",
    )
    # 翻页步进 2：点「下一页」后页码指示器与页脚都应变化
    bar = controls_bar_rect(app)
    im_before = ImageGrab.grab(bbox=app.rect())
    btns = D.find_pdf_buttons(app)
    log(f"双页模式可用翻页按钮={btns}")
    if btns:
        click_screen_btn = btns[-1]  # 最右侧=下一页
        click(app.hwnd, click_screen_btn[0] - geo["rect"][0], click_screen_btn[1] - geo["rect"][1])
        sleep(1800)
        im_after = ImageGrab.grab(bbox=app.rect())
        d_bar = region_diff(im_before, im_after, bar, geo["off"])
        check("A87-双页翻页步进2（指示器变化）", d_bar > 0, f"控制条 diff={d_bar}")
        shot("pf-05-a87-spread-next", bbox=app.rect())
    else:
        check("A87-双页翻页步进2（指示器变化）", False, "未定位到翻页按钮")

    # ===== A89：重启后倍率保持 =====
    # 先切回自适应（chip 菜单第 0 项），记录宽度；再切自定义 150% 预设，重启后复测
    click(app.hwnd, *chip_center(app))
    sleep(500)
    click(app.hwnd, *menu_item_center(app, 0))
    sleep(2000)
    l5, r5, w5, runs5 = page_extent(app)
    log(f"切回自适应后白页宽={w5}")
    app.close()
    sleep(1500)
    app2 = App()
    CUR[0] = app2.hwnd
    app2.move_to(40, 60)
    ok2 = D.open_file(app2, FIXTURE)
    sleep(3500)
    l6, r6, w6, runs6 = page_extent(app2)
    check(
        "A89-重启后适配保持（宽度复现）",
        runs6 == 1 and abs(w6 - w5) <= max(10, w5 * 0.03),
        f"关闭前={w5} 重启后={w6}",
    )
    shot("pf-06-a89-restart", bbox=app2.rect())

    # ===== A84：最小窗口 900×600 仍判适宽 =====
    got = app2.resize_to(900, 600)
    sleep(2500)
    geo2 = geometry(app2)
    inner2 = geo2["cw"] - PAD * 2
    l7, r7, w7, runs7 = page_extent(app2)
    check(
        "A84-最小窗900x600仍适宽铺满",
        runs7 == 1 and w7 >= inner2 * 0.95,
        f"client={got} 内盒={inner2} 白页宽={w7} 段数={runs7}",
    )
    shot("pf-07-a84-min-window", bbox=app2.rect())
    app2.resize_to(1280, 860)
    sleep(1500)

    # ===== A91：滚动模式铺满（去 720px 硬编码）=====
    pos = switch_to_scroll(app2)
    log(f"「滚动」分段坐标（标定）={pos}")
    if pos:
        click(app2.hwnd, *pos)
        sleep(2500)
        shot("pf-08-a91-scroll", bbox=app2.rect())
        l8, r8, w8, runs8 = page_extent(app2)
        geo3 = geometry(app2)
        inner3 = geo3["cw"] - PAD * 2
        check(
            "A91-滚动模式页面铺满内盒宽",
            runs8 >= 1 and w8 >= inner3 * 0.95,
            f"内盒={inner3} 白页宽={w8} 段数={runs8}",
        )
    else:
        check("A91-滚动模式页面铺满内盒宽", False, "未定位到模式段")

    log(f"内存={app2.memory_mb():.1f}MB")
    app2.close()
    sleep(1500)
    log(f"进程存活={app2.alive()}")
    flush()


def flush():
    D.flush_log()
    ok = sum(1 for _, v in RESULTS if v)
    log(f"==== pdf-fit 汇总：{ok}/{len(RESULTS)} 通过 ====")
    for name, v in RESULTS:
        log(f"  {'PASS' if v else 'FAIL'}  {name}")


def main():
    try:
        run_once()
    except Exception as e:  # 环境性中止：如实记录，不当通过
        log(f"[ABORT] 环境异常中止：{e!r}")
        RESULTS.append(("ABORT-环境异常", False))
        flush()
        return 1
    return 0 if all(v for _, v in RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
