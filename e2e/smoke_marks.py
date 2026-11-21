"""标记记录模块 GUI 冒烟（v0.3.0）。

对应落地说明文档 6.x 冒烟步骤与第 7 章验收（F31–F38）：
  sm-marks-00 复位基线：设置「恢复默认 + 保存」→ 浅色主题（像素断言），
                保证后续颜色断言的主题确定性
  sm-marks-01 划词落库：TXT 拖拽选词 → 工具条出现（色点扫描定位）→
                点黄色点 → 正文出现 #fef08a 高亮（像素扫描断言）
  sm-marks-02 Ctrl+M 面板：和弦键开面板 → 面板左边框列扫描 + 面板内
                黄色色点（cdot）扫描，双重断言
  sm-marks-03 写想法：点面板「＋」→ 模态遮罩变暗（像素断言）→ 输入感悟
                → Enter 保存 → 遮罩复原 + 底部 toast 变深（像素断言）
  sm-marks-04 跳转闪烁：点面板条目正文 → 高亮处出现蓝色闪烁环
                （"偏蓝"像素判据，非精确色，抗抗锯齿）
  sm-marks-05 删除：悬停条目 → 「⋯」按钮（text-3 像素扫描 + 坐标兜底）
                → 菜单「删除」（error-text 红字扫描定位）→ 高亮消失
                （#fef08a 扫描归零）+ toast
  sm-marks-06 Esc/再开：Esc 关面板（边框列归零）→ Ctrl+M 再开（边框列复现）
  sm-marks-07 总开关：设置「标记记录」窗格 → 关 markEnabled → 保存 →
                再划词不弹工具条（色点扫描为空）→ 重新打开保存（收尾复原）
  sm-marks-09 书架联动（A91/D70）：补一条高亮标记 → 回书架 → 移除全部
                TXT 卡（绿封面扫描定位，含样本）→ 重开同一 path →
                高亮不复现（marks 已随 removeEntry 清除）

方法论（沿用 smoke_settings/smoke_shelf 口径）：
- 一律坐标点击 + 像素采样断言 + 截图留证；无 DOM/OCR，不靠肉眼
- 标记相关交互尽量"去坐标化"：色点/删除项/⋯ 按钮用颜色扫描定位后点击，
  仅「＋ 写想法」等无颜色特征的控件用固定坐标（附重试）
- 前台哨兵 fg()：每次点击/按键/截图前 force_foreground 并验证
- 丢点击自动重试（≤3 次）+ 整轮流程重试兜底（2 轮）
- 样本文件按轮次复制为唯一名（smoke-marks-<轮次>.txt）：标记按书 path
  主键管理，唯一 path 保证"初始零标记"的确定性基线（不依赖清库 UI）
- 步骤 9 移除书架上**全部 TXT 卡**（绿封面无法按书名区分，只能整类移除）：
  冒烟环境可接受（smoke_shelf 起始即清空书架，各 verify 脚本自建状态），
  不影响同一轮内断言（样本必在其中，最终以"重开后高亮不复现"为准）

颜色基准（styles.css 令牌，浅色主题）：
  HL_YELLOW  (254,240,138) --hl-yellow     TXT 高亮底（.mark-hl-yellow）
  DOT_YELLOW (250,204,21)  --dot-yellow    工具条/面板色点（.dot-yellow/.cdot-yellow）
  DANGER_RED (185,28,28)   --error-text    「删除」菜单项文字
  TOAST_DARK (20,28,40)    .app-toast 底 rgba(17,24,39,.92)
  BORDER     (216,222,231) --border        面板左边框（浅色主题）
  TEXT3      (148,163,184) --text-3        「⋯」按钮字形
  LIGHT_BAR  (250,251,252) --bar-bg        浅色状态栏（复位验证）
  TXT 封面绿 渐变 #34d399→#047857（.shelf-cover.c-txt）：步骤 9 扫描判据
    （依赖步骤 0 复位：强调色恢复默认蓝，欢迎页实心绿块仅 TXT 封面；
      徽标/文字被"列密度≥30 且行跨度≥40"结构判据滤掉）
  遮罩变暗判据：白底内容区经 rgba(15,23,42,.38) 覆罩后 ≈ (164,166,170)，
  用"亮度 < 230"粗判（文本暗像素亦满足，故采样点选正文空白区）

坐标（客户区；2026-10-21 标定，v0.3.0 起 nav 新增「标记记录」项）：
  GEAR (1241,26)；nav x=394：reading 197 / appearance 234 / marks 271 /
    hotkeys 308 / advanced 345（pitch 37）；RESET (889,250)；SAVE (910,680)
  书架钮 (1199,26)（smoke_shelf 实测）；TXT 卡移除 ✕ = 绿封面质心
    +190x -21y（smoke_shelf 卡片网格校准，全格式同款网格）
  面板几何按客户区宽度动态推导：面板宽 340 → 左边框列 x = cw-340；
    「＋ 写想法」= (cw-96, 78)；条目 ⋯ ≈ (cw-20, 272)（兜底坐标）
  TXT 选词：第三行 y=140，x 100→420（sample-utf8.txt 第一段 16 字）
"""
import ctypes
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, "e2e")
import driver as D
from driver import (App, log, sleep, shot, click_client, tap, force_foreground,
                    window_text,
                    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
                    VK_CONTROL, VK_ESCAPE, KEYEVENTF_KEYUP)

user32 = ctypes.windll.user32

FIXTURE_SRC = "sample-utf8.txt"
VK_M = 0x4D

GEAR = (1241, 26)
NAV = {"reading": (394, 197), "appearance": (394, 234), "marks": (394, 271),
       "hotkeys": (394, 308), "advanced": (394, 345)}
RESET = (889, 250)
SAVE = (910, 680)
SHELF_BTN = (1199, 26)  # 工具栏书架按钮（smoke_shelf 实测）
WHEEL = 0x0800          # mouse_event 滚轮事件（smoke_shelf 同款）
PANEL_W = 340

# 像素断言基准色（styles.css 令牌，浅色主题）
HL_YELLOW = (254, 240, 138)
DOT_YELLOW = (250, 204, 21)
DANGER_RED = (185, 28, 28)
TOAST_DARK = (20, 28, 40)
BORDER = (216, 222, 231)
TEXT3 = (148, 163, 184)
LIGHT_BAR = (250, 251, 252)

RESULTS = []
CUR = [None]  # 当前 app hwnd（key/fg 无参时取当前）


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


# ---------- 基础交互（与 smoke_settings 同范式） ----------

def grab(app):
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=app.rect())


def px(im, cx, cy):
    """客户端坐标 → 截图像素（窗口 rect 左上为原点，+1 边框 +31 标题栏）。"""
    return im.getpixel((cx + 1, cy + 31))


def near(p, rgb, tol=12):
    return all(abs(p[i] - rgb[i]) <= tol for i in range(3))


def fg(app=None):
    """前台哨兵：强制激活并验证；第三方窗口（Navicat/通知弹窗）抢焦点时重试。"""
    hwnd = app.hwnd if app else CUR[0]
    for i in range(4):
        force_foreground(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        log(f"fg: 第 {i + 1} 次前台验证失败，重试")
        sleep(300)
    log("fg: 前台保障失败（疑似窗口被完全遮挡或最小化）")
    return False


def move_mouse_away():
    """鼠标移出窗口（屏幕左上角），消除 hover 干扰。"""
    user32.SetCursorPos(2, 2)
    sleep(250)


def click(app, x, y):
    fg(app)
    click_client(app.hwnd, x, y)


def key(vk):
    fg()
    tap(vk)


def shot_fg(app, name):
    fg(app)
    shot(name, bbox=app.rect())


def chord_ctrl_m():
    """Ctrl+M 真和弦（按下 Control → 点按 M → 松开 Control）。

    driver.combo 是顺序 tap（Ctrl 抬起后再按 M），不构成组合键，此处自实现。
    """
    fg()
    user32.keybd_event(VK_CONTROL, 0, 0, None)
    sleep(40)
    user32.keybd_event(VK_M, 0, 0, None)
    sleep(40)
    user32.keybd_event(VK_M, 0, KEYEVENTF_KEYUP, None)
    sleep(40)
    user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, None)
    sleep(120)


def screen_at(app, cx, cy):
    """客户端坐标 → 屏幕坐标（每次现取窗口 rect，防窗口位移）。"""
    r = app.rect()
    return (r[0] + 1 + cx, r[1] + 31 + cy)


def drag_select(app, x1, y1, x2, y2, steps=10):
    """拖拽选词（TXT 宿主 mouseup 读 window.getSelection，≥8 字符弹工具条）。"""
    fg(app)
    sx, sy = screen_at(app, x1, y1)
    user32.SetCursorPos(sx, sy)
    sleep(150)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, None)
    sleep(80)
    for i in range(1, steps + 1):
        mx = sx + (screen_at(app, x2, y2)[0] - sx) * i // steps
        my = sy + (screen_at(app, x2, y2)[1] - sy) * i // steps
        user32.SetCursorPos(mx, my)
        sleep(40)
    sleep(120)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, None)
    sleep(250)


# ---------- 像素扫描 ----------

def find_color(app, rgb, x0, y0, x1, y1, tol=12, min_hits=1):
    """客户区矩形内扫描指定颜色，返回命中簇的质心（客户区坐标）；无则 None。

    取所有命中点的算术质心：色点为 20px 圆钮，质心稳定落在钮内，
    比"首个命中点"更抗边缘抗锯齿。
    """
    im = grab(app)
    xs, ys, n = 0, 0, 0
    for sy in range(y0 + 31, y1 + 31):
        for sx in range(x0 + 1, x1 + 1):
            if near(im.getpixel((sx, sy)), rgb, tol):
                xs += sx
                ys += sy
                n += 1
    if n < min_hits:
        return None
    return (round(xs / n) - 1, round(ys / n) - 31, n)


def count_color(app, rgb, x0, y0, x1, y1, tol=12):
    im = grab(app)
    n = 0
    for sy in range(y0 + 31, y1 + 31):
        for sx in range(x0 + 1, x1 + 1):
            if near(im.getpixel((sx, sy)), rgb, tol):
                n += 1
    return n


def count_bluish(app, cx, cy, radius=60):
    """以 (cx,cy) 为中心的正方形内统计"偏蓝"像素（b-r>40 且 b>120）。

    闪烁环为 rgba(37,99,235,.55→0) 覆白，与白底/深色文字（r≈g≈b）可辨；
    不依赖精确色值，抗动画中间帧与抗锯齿。
    """
    im = grab(app)
    n = 0
    for sy in range(cy - radius + 31, cy + radius + 31):
        for sx in range(cx - radius + 1, cx + radius + 1):
            if sx < 0 or sy < 0 or sx >= im.width or sy >= im.height:
                continue
            p = im.getpixel((sx, sy))
            if p[2] - p[0] > 40 and p[2] > 120:
                n += 1
    return n


def panel_left(app):
    """标记面板左边框的客户区 x（面板宽 340，贴右缘）。"""
    cw, _ = app.client_size()
    return cw - PANEL_W


def marks_switch_xy(app):
    """设置「标记记录」窗格第一个 set-card 的 markEnabled 开关中心。

    对话框 640×600 客户区居中；panes 右padding 20 + 卡片 padding 16 +
    开关宽 38 → 开关中心 x = 对话框左 + 584；开关 align-items:flex-start
    贴 head 顶 → y = 对话框顶 + (head 48 + panes padding 16 + pane-title
    18+12 + 卡片 padding 14 + 开关半高 11) ≈ +120。
    """
    cw, ch = app.client_size()
    return ((cw - 640) // 2 + 584, (ch - 600) // 2 + 120)


def second_item_xy(app):
    """面板列表第 2 条（高亮标记；「想法」组置顶故其为第 2 条）的正文点击位。

    chips 行在 312px 工具区内可能折为两行（6 枚 chip ≈317px），条目 y
    随之浮动约 +23px；取 (cw-170, 350) 对折行/不折行两种布局均落在
    第 2 条 body 内（body 占条目大部分高度）。
    """
    cw, _ = app.client_size()
    return (cw - 170, 350)


def panel_open(app):
    """面板左边框列扫描：整列近 --border 像素 ≥150 视为打开（TXT 正文区无竖线）。"""
    x0 = panel_left(app) - 2
    _, ch = app.client_size()
    return count_color(app, BORDER, x0, 40, x0 + 4, ch - 40, tol=10) >= 150


def reading_region(app):
    """正文扫描区（客户区）：工具栏以下、状态栏以上、面板以左。"""
    cw, ch = app.client_size()
    return (40, 60, panel_left(app) - 20, ch - 60)


def reset_settings_default(app):
    """设置面板：高级 → 重置（草稿）→ 保存 → Esc；返回状态栏是否恢复浅色。"""
    click(app, *GEAR)
    sleep(1000)
    click(app, *NAV["advanced"])
    sleep(500)
    click(app, *RESET)
    sleep(500)
    click(app, *SAVE)
    sleep(600)
    key(VK_ESCAPE)
    sleep(600)
    im = grab(app)
    _, ch = app.client_size()
    bar = px(im, 640, ch - 18)
    return near(bar, LIGHT_BAR, 10)


def make_unique_fixture(round_no):
    """按轮次复制唯一名样本（path 主键 → 初始零标记的确定性基线）。"""
    dst = f"smoke-marks-r{round_no}.txt"
    shutil.copy(os.path.join(D.FIX, FIXTURE_SRC), os.path.join(D.FIX, dst))
    return dst


def open_fixture(app, filename):
    ok = False
    for i in range(3):
        ok = D.open_file(app, filename)
        if ok:
            break
        log(f"sm-marks: 第 {i + 1} 次 open_file 失败，重试")
    fg(app)
    app.move_to(40, 60)
    return ok


# ---------- 步骤 9（A91 书架联动）：欢迎页 TXT 卡定位与移除 ----------

def is_cover_green(p):
    """TXT 卡片封面渐变（#34d399→#047857）命中判据。

    依赖步骤 0 复位：强调色恢复默认（蓝），欢迎页可见区域内实心绿块
    仅 TXT 封面（进度条/徽标走强调色或浅色底，均被判据排除）。
    """
    r, g, b = p[0], p[1], p[2]
    return g >= 100 and r < 160 and b < 200 and g - r > 50 and g - b > 30


def find_green_covers(app):
    """扫描欢迎页书架区 TXT 绿封面（42x56 实心渐变块）中心（客户区坐标）。

    结构判据沿用 smoke_shelf.find_covers：按列密度（>=30 px/列）分组，
    宽>=30 且行跨度>=40 才认定（滤掉徽标文字等稀疏绿像素）。
    """
    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=app.rect())
    px = im.load()
    cols = {}
    for x in range(150, 1130):
        n = sum(1 for y in range(91, 551) if is_cover_green(px[x, y]))
        if n >= 30:
            cols[x] = n
    covers = []
    group = []
    for x in sorted(cols):
        if group and x - group[-1] > 3:
            if len(group) >= 30:
                covers.append(group)
            group = []
        group.append(x)
    if len(group) >= 30:
        covers.append(group)
    out = []
    for g in covers:
        ys = [y for x in g for y in range(91, 551) if is_cover_green(px[x, y])]
        if max(ys) - min(ys) >= 40:
            out.append(((g[0] + g[-1]) // 2 - 1, (min(ys) + max(ys)) // 2 - 31))
    return out


def wheel_down(notches, app, cx=640, cy=400):
    """在客户端 (cx,cy) 处向下滚轮（欢迎页书架区翻页，smoke_shelf 同款）。"""
    x, y = screen_at(app, cx, cy)
    user32.SetCursorPos(x, y)
    sleep(300)
    for _ in range(notches):
        user32.mouse_event(WHEEL, 0, 0, -120, 0)
        sleep(140)


def remove_all_txt_cards(app):
    """移除欢迎页全部 TXT 卡（悬停 ✕ → 点击），带滚轮翻页兜底。

    返回移除张数。副作用：其他 TXT 书记录一并移除（绿封面无法按书名
    区分，只能整类移除；冒烟环境可接受，见模块 docstring）。
    """
    removed = 0
    idle = 0
    for _ in range(12):
        covers = find_green_covers(app)
        if covers:
            idle = 0
            cx, cy = covers[0]
            user32.SetCursorPos(*screen_at(app, cx + 190, cy - 21))
            sleep(400)
            click(app, cx + 190, cy - 21)
            sleep(1000)
            removed += 1
        else:
            idle += 1
            if idle >= 2:
                break
            wheel_down(3, app)
            sleep(600)
    return removed


def run_once(round_no):
    """完整冒烟流程；返回是否全部断言通过（供 main 决定是否整轮重试）。"""
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"],
                   capture_output=True)
    sleep(800)

    fixture = make_unique_fixture(round_no)
    log(f"==== 第 {round_no} 轮：样本 {fixture} ====")

    app = App()
    CUR[0] = app.hwnd
    sleep(2000)

    # 0. 复位默认设置（主题/强调色/标记开关跨重启持久化，残留值会让
    #    颜色断言的主题基线不确定；顺带覆盖「恢复默认 + 保存」链路）
    ok = reset_settings_default(app)
    check("sm-marks-00-复位默认(状态栏浅色)", ok)
    shot_fg(app, f"sm-marks-{round_no}-00-reset")

    # 1. 打开样本（唯一 path → 零标记基线）
    if not open_fixture(app, fixture):
        check("sm-marks-01-打开样本", False, "open_file 失败，中止本轮")
        app.close()
        return False
    sleep(3000)
    shot_fg(app, f"sm-marks-{round_no}-01-book")

    rx0, ry0, rx1, ry1 = reading_region(app)
    base = count_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10)
    check("sm-marks-01b-基线无高亮", base == 0, f"hits={base}")

    # 2. 划词 → 工具条 → 点黄色点 → 高亮落库
    marked = False
    for attempt in range(3):
        drag_select(app, 100, 140, 420, 140)
        sleep(500)
        dot = find_color(app, DOT_YELLOW, 40, 60, panel_left(app) - 40, 320, tol=14)
        if dot:
            dx, dy, n = dot
            log(f"sm-marks-02: 黄色色点质心 ({dx},{dy}) hits={n}")
            click(app, dx, dy)
            sleep(700)
            hits = count_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10)
            if hits > 0:
                marked = True
                break
            log(f"sm-marks-02: 第 {attempt + 1} 次点击后未见高亮，重试")
        else:
            log(f"sm-marks-02: 第 {attempt + 1} 次未扫到色点（选词可能失败），重试")
    check("sm-marks-02-划词落库(高亮渲染)", marked,
          "" if marked else "色点未出现或点击后无 #fef08a")
    shot_fg(app, f"sm-marks-{round_no}-02-highlight")
    if not marked:
        app.close()
        return False

    # 3. Ctrl+M 打开面板（边框列 + 面板内黄色色点双重断言）
    chord_ctrl_m()
    sleep(900)
    opened = panel_open(app)
    check("sm-marks-03-Ctrl+M 打开面板(边框)", opened)
    cdot = find_color(app, DOT_YELLOW, panel_left(app) + 10, 90,
                      panel_left(app) + PANEL_W - 10, 240, tol=14)
    check("sm-marks-03b-面板色点 chips", cdot is not None,
          f"cdot={cdot}")
    shot_fg(app, f"sm-marks-{round_no}-03-panel")
    if not opened:
        app.close()
        return False

    # 4. 「＋ 写想法」：模态遮罩变暗 → 输入 → Enter 保存 → 遮罩复原 + toast
    cw, ch = app.client_size()
    idea_btn = (cw - 96, 78)
    saved = False
    for attempt in range(3):
        click(app, *idea_btn)
        sleep(700)
        # 遮罩变暗判据：正文空白区三点中 ≥2 点亮度 < 230
        dim = sum(1 for p in ((600, 420), (300, 520), (800, 640))
                  if sum(px(grab(app), *p)) / 3 < 230)
        if dim < 2:
            log(f"sm-marks-04: 第 {attempt + 1} 次点击「＋」后模态未开，重试")
            continue
        D.type_text(f"冒烟测试感悟 r{round_no}")
        sleep(300)
        tap(0x0D)  # Enter 保存（MarkNoteEditor：Enter 直接保存）
        sleep(800)
        bright = sum(1 for p in ((600, 420), (300, 520), (800, 640))
                     if sum(px(grab(app), *p)) / 3 > 240)
        toast = count_color(app, TOAST_DARK, 520, ch - 100, 760, ch - 55, tol=18)
        if bright >= 2 and toast > 50:
            saved = True
            break
        log(f"sm-marks-04: 第 {attempt + 1} 次保存校验未过"
            f"（bright={bright} toast={toast}），重试")
    check("sm-marks-04-写想法保存(遮罩复原+toast)", saved)
    shot_fg(app, f"sm-marks-{round_no}-04-idea")
    if not saved:
        app.close()
        return False

    # 5. 跳转闪烁：点第二条目（高亮标记，想法组置顶故其为第 2 条）正文 →
    #    高亮处出现偏蓝闪烁环（1.6s 窗口内轮询）
    ix, iy = second_item_xy(app)
    jumped = False
    for attempt in range(3):
        click(app, ix, iy)
        deadline = time.time() + 2.0
        while time.time() < deadline:
            c = find_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10)
            if c and count_bluish(app, c[0], c[1], 60) >= 3:
                jumped = True
                break
            sleep(120)
        if jumped:
            break
        log(f"sm-marks-05: 第 {attempt + 1} 次未见闪烁环，重试")
    check("sm-marks-05-面板跳转(高亮闪烁)", jumped)
    shot_fg(app, f"sm-marks-{round_no}-05-jump")

    # 6. 删除：悬停第二条目 → 「⋯」（text-3 像素扫描 + 坐标兜底）→「删除」（红字扫描）。
    #    扫描列 x∈[cw-42,cw-4] 内只有 ⋯ 字形是 text-3 色（meta/计数在条目左侧），
    #    y 窗口 280..430 覆盖 chips 折行/不折行两种布局下第 2 条的位置。
    deleted = False
    for attempt in range(3):
        sx, sy = screen_at(app, ix, iy)
        user32.SetCursorPos(sx, sy)
        sleep(400)
        more = find_color(app, TEXT3, cw - 42, 280, cw - 4, 430, tol=30)
        if more:
            click(app, more[0], more[1])
        else:
            log("sm-marks-06: 未扫到 ⋯，用兜底坐标点击")
            click(app, cw - 20, iy + 8)
        sleep(500)
        danger = find_color(app, DANGER_RED, cw - 280, 360, cw - 10, 540, tol=25)
        if not danger:
            log(f"sm-marks-06: 第 {attempt + 1} 次菜单未开（无红字），重试")
            continue
        click(app, danger[0], danger[1])
        sleep(800)
        left = count_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10)
        if left == 0:
            deleted = True
            break
        log(f"sm-marks-06: 第 {attempt + 1} 次删除后仍有高亮（hits={left}），重试")
    check("sm-marks-06-删除条目(高亮消失)", deleted)
    shot_fg(app, f"sm-marks-{round_no}-06-deleted")

    # 7. Esc 关面板 → Ctrl+M 再开（开关幂等）
    key(VK_ESCAPE)
    sleep(700)
    closed = not panel_open(app)
    check("sm-marks-07-Esc 关闭面板", closed)
    chord_ctrl_m()
    sleep(900)
    reopened = panel_open(app)
    check("sm-marks-07b-Ctrl+M 再开面板", reopened)
    shot_fg(app, f"sm-marks-{round_no}-07-toggle")
    if not (closed and reopened):
        app.close()
        return False

    # 8. 总开关：设置「标记记录」→ 关 markEnabled → 保存 → 划词不弹工具条；
    #    再打开保存收尾（防跨轮残留：第 2 轮开始时亦有复位步骤兜底）
    sw_x, sw_y = marks_switch_xy(app)
    click(app, *GEAR)
    sleep(1000)
    click(app, *NAV["marks"])
    sleep(600)
    click(app, sw_x, sw_y)
    sleep(500)
    click(app, *SAVE)
    sleep(700)
    key(VK_ESCAPE)
    sleep(700)
    shot_fg(app, f"sm-marks-{round_no}-08-marks-off")

    no_toolbar = False
    for attempt in range(3):
        drag_select(app, 100, 140, 420, 140)
        sleep(600)
        dot = find_color(app, DOT_YELLOW, 40, 60, panel_left(app) - 40, 320, tol=14)
        if dot is None:
            no_toolbar = True
            break
        log(f"sm-marks-08: 第 {attempt + 1} 次仍扫到色点，重试")
    check("sm-marks-08-总开关关闭(不弹工具条)", no_toolbar)

    # 收尾：重新打开 markEnabled 并保存（SettingsPanel 草稿初值即当前设置）
    click(app, *GEAR)
    sleep(1000)
    click(app, *NAV["marks"])
    sleep(600)
    click(app, sw_x, sw_y)
    sleep(500)
    click(app, *SAVE)
    sleep(700)
    key(VK_ESCAPE)
    sleep(700)

    # 9. 书架联动（A91 / D70）：补一条高亮标记 → 回书架移除该书（TXT 绿封面
    #    整类移除，样本必在其中）→ 重开同一 path → 高亮不复现（marks 已随
    #    removeEntry 清除；若未清除，同 path 重开高亮会复现而被抓到）
    hl_ok = False
    for attempt in range(3):
        drag_select(app, 100, 140, 420, 140)
        sleep(500)
        dot = find_color(app, DOT_YELLOW, 40, 60, panel_left(app) - 40, 320, tol=14)
        if not dot:
            log(f"sm-marks-09: 第 {attempt + 1} 次未扫到色点，重试")
            continue
        click(app, dot[0], dot[1])
        sleep(700)
        if count_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10) > 0:
            hl_ok = True
            break
        log(f"sm-marks-09: 第 {attempt + 1} 次点击后无高亮，重试")
    check("sm-marks-09a-补高亮标记(联动前置)", hl_ok)
    shot_fg(app, f"sm-marks-{round_no}-09a-relight")
    if not hl_ok:
        app.close()
        return False

    app.move_to(40, 60)   # 移窗避开右上角通知弹窗（smoke_shelf 同款教训）
    at_shelf = False
    for attempt in range(3):
        click(app, *SHELF_BTN)
        sleep(1200)
        if window_text(app.hwnd) == "BookEditor":
            at_shelf = True
            break
        log(f"sm-marks-09: 第 {attempt + 1} 次回书架未生效，重试")
    check("sm-marks-09b-回书架", at_shelf)
    if not at_shelf:
        app.close()
        return False

    removed = remove_all_txt_cards(app)
    check("sm-marks-09c-移除TXT卡片(含样本)", removed >= 1, f"removed={removed}")
    shot_fg(app, f"sm-marks-{round_no}-09c-removed")

    if not open_fixture(app, fixture):
        check("sm-marks-09d-重开样本", False, "open_file 失败")
        app.close()
        return False
    sleep(3000)
    left = count_color(app, HL_YELLOW, rx0, ry0, rx1, ry1, tol=10)
    check("sm-marks-09d-书架移除后标记联动清除(A91)", left == 0, f"hits={left}")
    shot_fg(app, f"sm-marks-{round_no}-09d-relclean")

    app.close()
    failed = [n for n, ok in RESULTS if not ok]
    log(f"==== 第 {round_no} 轮结果: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" +
        (f"，失败: {failed}" if failed else "") + " ====")
    D.flush_log()
    return not failed


def main():
    for round_no in (1, 2):
        RESULTS.clear()
        log(f"==== 第 {round_no} 轮冒烟开始 ====")
        if run_once(round_no):
            return
        log(f"==== 第 {round_no} 轮存在失败项，整体重试 ====")
    log("==== 两轮均未全绿，按失败退出 ====")


if __name__ == "__main__":
    main()
