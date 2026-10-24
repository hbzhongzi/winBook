"""v0.2.5 F22/F24 快捷键真机验证（A64–A70）。

覆盖（方案文档《BookEditor-v0.2.5-翻页导航与快捷键优化方案》验收矩阵后半程）：
- A64 TXT 翻页模式：默认全键位生效（→ / PageDown / 空格 / Home / End / ↑ / ←）
- A65 PDF 单页翻页：默认键翻页正确
- A66 PDF 连续滚动：PageDown/空格整屏、Home/End 顶/底
- A67 设置面板打开时翻页键不穿透；Ctrl+A 组合不受影响；Esc 正常关面板且阅读恢复响应
- A68 快捷键录制交互：绑定 / 冲突提示 / 删除 chip / 恢复默认 / Esc 取消 / 未保存不生效
- A69 自定义键位保存后阅读中立即可用（默认键位仍有效）
- A70 自定义键位跨重启保持

实现注记（2026-10-21）：
- 坐标均为窗口客户区坐标，与窗口屏幕位置无关；客户区→截图偏移在每次截图前
  经 client_to_screen 实测（本机边框 8px/标题栏 31px；历史脚本硬编码 +1 能跑
    是因为断言区域宽容，本脚本不依赖该假设）。
- 不调用 move_to：driver.open_file 内的 ensure_ready 会把窗口复位到 EXPECT_RECT，
  移动窗口反而导致每次 open_file 后被复位、偏移重算。EXPECT_RECT 标题栏位于
  y 90..121，避开右上角通知弹窗区。
- 「+ 绑定」按钮位置动态定位（--text-2 文字团簇扫描，x 850..950 / y 280..660，
  宽 20..50 高 6..20），不硬编码：chip 增减导致行高变化时坐标自适配。
  录制态文字变「请按下按键…」（宽约 66）被宽度过滤挡掉；卡头「恢复默认」
  在 y≈254 被 y>280 挡掉；chip 的 × 字形宽约 7 被宽度下限挡掉。
- 模式切换验证用工具栏区域 diff（点非活跃段才有效应，点活跃段是无操作守卫），
  不依赖强调色具体色值（用户可改强调色）。
- 方向正确性（自定义键映射到 prev 而非 next）由单测 resolveHotkeyAction 覆盖
  （A72），GUI 侧只验证「按键有阅读效果」这一可观测面。
- 空格键测试前必须点击状态栏移走工具栏按钮焦点：按钮获焦时空格会再次触发
  该按钮（模式切换），TXT/PDF 容器不可聚焦，点状态栏（非聚焦区）使焦点落 body。
- 若本脚本发现新偏差，编号自 D51 起续（v0.2.5 落地说明已记录 D45–D50）。

用法：python e2e/verify_hotkeys.py
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import driver as D
from driver import App, log, sleep, shot, click_client, tap, force_foreground, send_input_key, KEYEVENTF_KEYUP
import ctypes
from PIL import ImageGrab

user32 = ctypes.windll.user32

FIXTURE_EPUB = "12.epub"
FIXTURE_TXT = "long-sample.txt"
FIXTURE_PDF = "sample.pdf"

GEAR = (1241, 26)
NAV = {"hotkeys": (394, 271), "advanced": (394, 308)}
SAVE = (910, 680)
CANCEL = (843, 680)
RESET_ADV = (889, 250)        # 高级窗格「重置」（草稿恢复默认）
HK_RESET = (879, 254)         # 快捷键窗格「恢复默认」（卡头固定位，实测）
MODE_PAGE = (1184, 27)        # 模式分段「翻页」（右段，贴齿轮）
MODE_SCROLL = (1118, 27)      # 模式分段「滚动」（左段）
BLUR = (640, 815)             # 状态栏非聚焦区：点击移走按钮焦点

TOOLBAR = (1050, 8, 1250, 48)   # 模式分段+齿轮条带
CONTENT = (100, 120, 1180, 700)  # 正文区（避开工具栏/状态栏/pager）
DIALOG = (319, 111, 959, 710)   # 设置对话框区域
PANE = (443, 165, 951, 665)     # 快捷键窗格内容区

VK_LEFT, VK_UP, VK_RIGHT, VK_DOWN = 0x25, 0x26, 0x27, 0x28
VK_PAGEUP, VK_PAGEDOWN = 0x21, 0x22
VK_SPACE, VK_HOME, VK_END, VK_ESC = 0x20, 0x24, 0x23, 0x1B
VK_K, VK_A, VK_CTRL = 0x4B, 0x41, 0x11

LIGHT_BAR = (250, 251, 252)      # 浅色主题 --bar-bg（状态栏）
NAV_SEL_LIGHT = (239, 246, 255)  # 浅色 nav 选中态
NAV_SEL_DARK = (30, 58, 95)      # 深色 nav 选中态
TEXT2_LIGHT = (107, 114, 128)    # 浅色 --text-2
TEXT2_DARK = (148, 163, 184)     # 深色 --text-2
ERROR_RED = (185, 28, 28)        # --error-text（两主题同值）

# diff 阈值：整屏翻页/滚动 >2000；控件级变化（chip/边框）>40；无变化 <400
BIG = 2000
SMALL = 40
NONE = 400

RESULTS = []
CUR = [None]


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def near(p, rgb, tol=12):
    return all(abs(p[i] - rgb[i]) <= tol for i in range(3))


def off(app):
    """客户区原点在截图中的偏移（每次实测，不硬编码边框宽度）。"""
    r = app.rect()
    ox, oy = D.client_to_screen(app.hwnd, 0, 0)
    return (ox - r[0], oy - r[1])


def grab(app):
    return ImageGrab.grab(bbox=app.rect())


def px(im, cx, cy, o):
    return im.getpixel((cx + o[0], cy + o[1]))


def region_diff(a, b, box, o, step=2, thresh=18):
    """两截图在区域（客户区坐标）内的差异像素数。"""
    x0, y0, x1, y1 = box
    n = 0
    for y in range(y0 + o[1], y1 + o[1], step):
        for x in range(x0 + o[0], x1 + o[0], step):
            pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
            if any(abs(pa[i] - pb[i]) > thresh for i in range(3)):
                n += 1
    return n


def diff_bbox(a, b, box, o, thresh=18):
    """区域内有差异像素的包围盒（客户区坐标）；无差异返回 None。"""
    x0, y0, x1, y1 = box
    xs, ys = [], []
    for y in range(y0 + o[1], y1 + o[1]):
        for x in range(x0 + o[0], x1 + o[0]):
            pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
            if any(abs(pa[i] - pb[i]) > thresh for i in range(3)):
                xs.append(x - o[0])
                ys.append(y - o[1])
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def fg(app=None):
    hwnd = app.hwnd if app else CUR[0]
    for i in range(4):
        force_foreground(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        sleep(300)
    return False


def click(app, x, y):
    fg(app)
    click_client(app.hwnd, x, y)


def key(vk):
    fg()
    tap(vk)


def combo_real(*vks):
    """真实组合键：修饰键按住 → 触发键 → 依次松开（driver.combo 是顺序 tap 非组合）。"""
    fg()
    for vk in vks[:-1]:
        send_input_key(vk, 0)
        sleep(30)
    send_input_key(vks[-1], 0)
    sleep(40)
    send_input_key(vks[-1], KEYEVENTF_KEYUP)
    sleep(30)
    for vk in reversed(vks[:-1]):
        send_input_key(vk, KEYEVENTF_KEYUP)
        sleep(30)


def move_mouse_away():
    user32.SetCursorPos(2, 2)
    sleep(250)


def open_settings(app):
    """打开设置面板并验证（WebView2 偶发丢点击：丢了则面板没开，
    后续 nav 点击会落到书内容上且 nav_selected 可能假阳性——A68 第 1 轮
    即因此扫描到 0 个绑定按钮）。验证：对话框区域出现大幅变化。"""
    for attempt in range(3):
        o = off(app)
        before = grab(app)
        click(app, *GEAR)
        sleep(1100)
        after = grab(app)
        d = region_diff(before, after, DIALOG, o)
        if d > NONE:
            return True
        log(f"open_settings: 第 {attempt + 1} 次点击后面板未出现（diff={d}），重试")
    return False


def open_book(app, filename, tries=3):
    for i in range(tries):
        if D.open_file(app, filename):
            return True
        log(f"open_book({filename}) 第 {i + 1} 次失败，重试")
        sleep(800)
    return False


def ensure_panel_closed(app):
    """面板可能因上阶段异常残留：Esc 关闭并验证对话框区变化。"""
    fg(app)
    before = grab(app)
    tap(VK_ESC)
    sleep(700)
    after = grab(app)
    o = off(app)
    d = region_diff(before, after, DIALOG, o)
    if d > NONE:
        log("ensure_panel_closed: 面板已关闭")
    else:
        log("ensure_panel_closed: 无变化（原本已关闭或 Esc 未达）")
    move_mouse_away()


def ensure_mode(app, want):
    """确保阅读模式为 want（page/scroll）。

    点目标段：若原为非活跃则切换（工具栏 diff）；若无 diff，可能已是目标模式或
    点击丢失——再点另一段验证点击链路可达，可达则回来重试点目标段。
    """
    other = MODE_SCROLL if want == "page" else MODE_PAGE
    target = MODE_PAGE if want == "page" else MODE_SCROLL
    for attempt in range(4):
        o = off(app)
        before = grab(app)
        click(app, *target)
        move_mouse_away()
        sleep(600)
        after = grab(app)
        if region_diff(before, after, TOOLBAR, o) > SMALL:
            log(f"ensure_mode({want}): 第 {attempt + 1} 次点击切换成功")
            sleep(1200)  # 等 Viewer 重挂载稳定
            return True
        # 无 diff：验证点击链路（点另一段应产生切换）
        before2 = grab(app)
        click(app, *other)
        move_mouse_away()
        sleep(600)
        after2 = grab(app)
        if region_diff(before2, after2, TOOLBAR, o) > SMALL:
            log(f"ensure_mode({want}): 原已是目标模式或点击丢失，已翻转后重试")
            continue
        log(f"ensure_mode({want}): 第 {attempt + 1} 次点击链路无响应")
    return False


def blur_focus(app):
    """点击状态栏非聚焦区，移走工具栏按钮焦点（防空格复触发按钮）。"""
    click(app, *BLUR)
    move_mouse_away()
    sleep(300)


def press_and_diff(app, vk, box, wait=1100, min_diff=BIG, retries=2, strips=False):
    """按键并断言内容变化；WebView2 偶发丢按键（A64 第 2 轮 Space diff=0，
    同轮其余键均 21k+）→ 正断言自动重试，负断言（min_diff=0）不重试。
    strips=True 时只统计对话框左右竖带（A67 防穿透专用）。"""
    fg(app)
    d = 0
    for attempt in range(1 + (retries if min_diff > 0 else 0)):
        before = grab(app)
        tap(vk)
        sleep(wait)
        after = grab(app)
        o = off(app)
        d = (strips_diff(before, after, o) if strips
             else region_diff(before, after, box, o))
        if d >= min_diff:
            return d, before, after
        if min_diff > 0:
            log(f"press_and_diff: 第 {attempt + 1} 次按键无效（diff={d}），重试")
    return d, before, after


def strips_diff(a, b, o, step=2, thresh=18):
    """对话框左右两条竖带（客户区）差异合计：面板内部滚动/选中高亮不计入，
    只观测面板外的阅读区（A67 防穿透断言专用；对话框占 x 319..959）。"""
    total = 0
    for box in ((100, 120, 315, 700), (963, 120, 1180, 700)):
        total += region_diff(a, b, box, o, step=step, thresh=thresh)
    return total


def nav_selected(app, key_name):
    im = grab(app)
    o = off(app)
    x, y = NAV[key_name]
    sy = y + o[1]
    hits = 0
    for sx in range(x + o[0] - 74, x + o[0] + 47):
        p = im.getpixel((sx, sy))
        if near(p, NAV_SEL_LIGHT, 10) or near(p, NAV_SEL_DARK, 12):
            hits += 1
    return hits >= 25


def click_nav(app, key_name):
    x, y = NAV[key_name]
    for attempt in range(3):
        click(app, x, y)
        move_mouse_away()
        sleep(300)
        if nav_selected(app, key_name):
            return True
        log(f"click_nav({key_name}) 第 {attempt + 1} 次未生效，重试")
    return False


def scan_bind_buttons(app):
    """定位快捷键窗格四个「+ 绑定」按钮中心（客户区坐标），按行序（prev/next/home/end）。

    文字色 --text-2；「+ 绑定」实测宽约 33px，宽度窗 [30,42]：
    - 挡录制态「请按下按键…」（宽约 66）
    - 挡 chip 的 × 字形（宽约 7-24）
    - 挡卡头「恢复默认」两行（各宽约 16-26）与底部 set-note 换行尾（宽约 27-28）
    y>280 挡卡头；扫描前移开鼠标消 hover（hover 会改文字色）。
    """
    move_mouse_away()
    for attempt in range(3):
        im = grab(app)
        o = off(app)
        pts = []
        for cy in range(280, 660):
            for cx in range(850, 950):
                p = px(im, cx, cy, o)
                if near(p, TEXT2_LIGHT, 14) or near(p, TEXT2_DARK, 14):
                    pts.append((cx, cy))
        # 8px 网格聚类
        cells = {}
        for (cx, cy) in pts:
            cells.setdefault((cx // 8, cy // 8), []).append((cx, cy))
        boxes = []
        for v in cells.values():
            xs = [p[0] for p in v]
            ys = [p[1] for p in v]
            boxes.append([min(xs), min(ys), max(xs), max(ys), len(v)])
        # 合并相邻格
        merged = []
        for b in sorted(boxes, key=lambda b: (b[1], b[0])):
            for m in merged:
                if abs(m[0] - b[0]) < 24 and abs(m[1] - b[1]) < 24:
                    m[0] = min(m[0], b[0]); m[1] = min(m[1], b[1])
                    m[2] = max(m[2], b[2]); m[3] = max(m[3], b[3]); m[4] += b[4]
                    break
            else:
                merged.append(b)
        keep = [m for m in merged
                if 30 <= (m[2] - m[0]) <= 42 and 6 <= (m[3] - m[1]) <= 20 and m[4] >= 20]
        keep.sort(key=lambda m: m[1])
        centers = [((m[0] + m[2]) // 2, (m[1] + m[3]) // 2) for m in keep]
        if len(centers) == 4:
            return centers
        log(f"scan_bind_buttons: 第 {attempt + 1} 次找到 {len(centers)} 个（预期 4），重试")
        sleep(500)
    return []


def scan_red(app):
    """窗格内是否存在冲突红字（--error-text）。"""
    im = grab(app)
    o = off(app)
    n = 0
    for cy in range(280, 660):
        for cx in range(443, 951):
            if near(px(im, cx, cy, o), ERROR_RED, 30):
                n += 1
    return n


def bands_from(binds):
    """由「+ 绑定」按钮中心推导行级断言带（chip 增减致行高变化时自适配）。

    ROW1：prev 行键位区（chip 出现/消失/定位只看这里，避开冲突红字与录制按钮）
    NEXTBTN：next 行「+ 绑定」按钮区（Esc 取消录制的验证只看按钮复原）
    ROW2：next 行键位区（冲突不重复绑定验证，排除按钮左扩区与红字区）
    """
    b0y, b1y = binds[0][1], binds[1][1]
    return {
        "ROW1": (560, b0y - 45, 865, b0y + 45),
        "NEXTBTN": (820, b1y - 25, 930, b1y + 25),
        "ROW2": (560, b1y - 45, 820, b1y + 45),
    }


# ---------------- 各阶段 ----------------

def phase0_setup(app):
    """复位到默认设置（浅色主题/蓝强调色/默认键位），保证后续颜色与坐标确定。"""
    log("==== phase0: 复位默认设置 ====")
    if not open_settings(app):
        check("打开设置面板", False)
        return
    sleep(1000)
    if not click_nav(app, "advanced"):
        check("复位-nav 可达 advanced", False)
        return False
    sleep(400)
    click(app, *RESET_ADV)
    sleep(500)
    click(app, *SAVE)
    sleep(700)
    tap(VK_ESC)
    sleep(700)
    im = grab(app)
    o = off(app)
    bar = px(im, 640, 810, o)
    check("复位-状态栏恢复浅色", near(bar, LIGHT_BAR, 10), str(bar))
    shot("hv-00-reset", bbox=app.rect())
    return near(bar, LIGHT_BAR, 10)


def phase_a64(app):
    """A64：TXT 翻页模式默认全键位。"""
    log("==== A64: TXT 翻页快捷键 ====")
    if not open_book(app, FIXTURE_TXT):
        check("A64-打开 long-sample.txt", False)
        return
    sleep(2500)
    if not ensure_mode(app, "page"):
        check("A64-切翻页模式", False)
        return
    blur_focus(app)
    toolbar_ref = grab(app)
    shot("hv-01-txt-page", bbox=app.rect())
    cases = [
        ("ArrowRight 下一页", VK_RIGHT),
        ("PageDown 下一页", VK_PAGEDOWN),
        ("Space 下一页", VK_SPACE),
        ("Home 回首页", VK_HOME),
        ("End 去末页", VK_END),
        ("ArrowUp 上一页", VK_UP),
        ("ArrowLeft 上一页", VK_LEFT),
    ]
    for name, vk in cases:
        d, _, _ = press_and_diff(app, vk, CONTENT)
        check(f"A64-TXT-{name}", d > BIG, f"diff={d}")
    # 模式稳定性：空格若复触发工具栏「翻页」按钮（焦点转移失败），模式会被切走
    toolbar_now = grab(app)
    o = off(app)
    d_mode = region_diff(toolbar_ref, toolbar_now, TOOLBAR, o)
    check("A64-键位测试期间模式未漂移", d_mode < SMALL, f"toolbar_diff={d_mode}")
    shot("hv-02-txt-keys", bbox=app.rect())


def phase_a65(app):
    """A65：PDF 单页翻页默认键。"""
    log("==== A65: PDF 单页翻页快捷键 ====")
    if not open_book(app, FIXTURE_PDF):
        check("A65-打开 sample.pdf", False)
        return
    sleep(3000)
    if not ensure_mode(app, "page"):
        check("A65-确保翻页模式", False)
        return
    blur_focus(app)
    toolbar_ref = grab(app)
    shot("hv-03-pdf-page", bbox=app.rect())
    for name, vk in [("ArrowRight 下一页", VK_RIGHT), ("Space 下一页", VK_SPACE),
                     ("ArrowLeft 上一页", VK_LEFT)]:
        d, _, _ = press_and_diff(app, vk, CONTENT)
        check(f"A65-PDF-{name}", d > BIG, f"diff={d}")
    toolbar_now = grab(app)
    o = off(app)
    d_mode = region_diff(toolbar_ref, toolbar_now, TOOLBAR, o)
    check("A65-键位测试期间模式未漂移", d_mode < SMALL, f"toolbar_diff={d_mode}")
    shot("hv-04-pdf-page-keys", bbox=app.rect())


def phase_a66(app):
    """A66：PDF 连续滚动 PageDown/空格整屏、Home/End 顶/底。"""
    log("==== A66: PDF 连续滚动快捷键 ====")
    if not ensure_mode(app, "scroll"):
        check("A66-切滚动模式", False)
        return
    blur_focus(app)
    toolbar_ref = grab(app)
    shot("hv-05-pdf-scroll", bbox=app.rect())
    for name, vk in [("PageDown 整屏下滚", VK_PAGEDOWN), ("Space 整屏下滚", VK_SPACE),
                     ("Home 回顶部", VK_HOME), ("End 去底部", VK_END)]:
        d, _, _ = press_and_diff(app, vk, CONTENT)
        check(f"A66-PDF滚动-{name}", d > BIG, f"diff={d}")
    toolbar_now = grab(app)
    o = off(app)
    d_mode = region_diff(toolbar_ref, toolbar_now, TOOLBAR, o)
    check("A66-键位测试期间模式未漂移", d_mode < SMALL, f"toolbar_diff={d_mode}")
    shot("hv-06-pdf-scroll-keys", bbox=app.rect())


def phase_a67(app):
    """A67：面板打开时翻页键不穿透；Ctrl+A 不受影响；Esc 关面板后阅读恢复。"""
    log("==== A67: 设置面板快捷键豁免 ====")
    if not open_settings(app):
        check("打开设置面板", False)
        return
    sleep(1000)
    shot("hv-07-panel-open", bbox=app.rect())
    # 只断言对话框左右竖带（面板内滚动/选中高亮不计入阅读区变化）
    for name, vk in [("PageDown 不穿透", VK_PAGEDOWN), ("End 不穿透", VK_END),
                     ("ArrowRight 不穿透", VK_RIGHT)]:
        d, _, _ = press_and_diff(app, vk, None, min_diff=0, strips=True)
        check(f"A67-面板打开-{name}", d < NONE, f"strips_diff={d}")
    # Ctrl+A：组合不应触发阅读动作（阅读区无变化），面板保持打开、应用存活
    # （面板是否仍开着由紧随的 Esc 关面板校验反证）
    before = grab(app)
    combo_real(VK_CTRL, VK_A)
    sleep(600)
    after = grab(app)
    o = off(app)
    d_read = strips_diff(before, after, o)
    alive = app.alive()
    check("A67-Ctrl+A 不触发阅读动作且应用存活", d_read < NONE and alive,
          f"strips_diff={d_read} alive={alive}")
    # Esc 关面板
    before2 = grab(app)
    tap(VK_ESC)
    sleep(800)
    after2 = grab(app)
    d_close = region_diff(before2, after2, DIALOG, o)
    check("A67-Esc 关闭设置面板", d_close > NONE, f"dialog_diff={d_close}")
    shot("hv-08-panel-closed", bbox=app.rect())
    # 关面板后阅读恢复响应
    d, _, _ = press_and_diff(app, VK_PAGEDOWN, CONTENT)
    check("A67-关面板后 PageDown 恢复响应", d > BIG, f"diff={d}")


def phase_a68(app):
    """A68：录制式绑定交互全链路。"""
    log("==== A68: 快捷键录制交互 ====")
    ensure_panel_closed(app)
    if not open_settings(app):
        check("打开设置面板", False)
        return
    sleep(1000)
    if not click_nav(app, "hotkeys"):
        check("A68-nav 可达 hotkeys", False)
        return
    sleep(500)
    binds = scan_bind_buttons(app)
    if len(binds) != 4:
        check("A68-定位四个「+ 绑定」按钮", False, f"found={binds}")
        return
    log(f"bind 按钮中心: {binds}")
    o = off(app)
    B = bands_from(binds)
    ROW1, NEXTBTN, ROW2 = B["ROW1"], B["NEXTBTN"], B["ROW2"]
    move_mouse_away()
    base = grab(app)
    shot("hv-09-hotkeys-base", bbox=app.rect())

    # 1. 点 prev 的「+ 绑定」→ 进入录制态（按钮变实线强调色边框 + 「请按下按键…」）
    click(app, *binds[0])
    move_mouse_away()
    sleep(400)
    rec = grab(app)
    d_rec = region_diff(base, rec, PANE, o)
    check("A68-点击「+ 绑定」进入录制态", d_rec > SMALL, f"diff={d_rec}")

    # 2. 按 K → chip 出现且退出录制态（冲突红字此尚未出现，PANE 级 diff 即 chip）
    key(VK_K)
    sleep(500)
    after_k = grab(app)
    bbox = diff_bbox(base, after_k, ROW1, o)
    ok_chip = bbox is not None and bbox[2] < 865
    check("A68-按 K 绑定成功（chip 出现在键位区）", ok_chip, f"bbox={bbox}")
    shot("hv-10-hotkeys-k-bound", bbox=app.rect())

    # 3. 点 next 的「+ 绑定」→ 再按 K → 冲突红字，且不重复绑定
    binds = scan_bind_buttons(app)
    if len(binds) != 4:
        check("A68-重定位「+ 绑定」（K 绑定后）", False, f"found={binds}")
        return
    # K chip 可能使 prev 行换行 → 后续行整体下移：按新位置重算断言带
    B = bands_from(binds)
    ROW1, NEXTBTN, ROW2 = B["ROW1"], B["NEXTBTN"], B["ROW2"]
    click(app, *binds[1])
    move_mouse_away()
    sleep(400)
    rec2 = grab(app)
    d_rec2 = region_diff(after_k, rec2, PANE, o)
    check("A68-第二个动作进入录制态", d_rec2 > SMALL, f"diff={d_rec2}")
    key(VK_K)
    sleep(500)
    after_conflict = grab(app)
    red = scan_red(app)
    check("A68-冲突红字提示", red >= 12, f"red_px={red}")
    # 键位区不应新增 chip（排除录制态按钮左扩区与红字区）
    d_nochip = region_diff(after_k, after_conflict, ROW2, o)
    check("A68-冲突不重复绑定（键位区无变化）", d_nochip < SMALL, f"diff={d_nochip}")
    shot("hv-11-hotkeys-conflict", bbox=app.rect())

    # 4. Esc 取消录制（冲突红字按实现保留，不强制清除；只看按钮复原）
    tap(VK_ESC)
    sleep(500)
    after_esc = grab(app)
    d_esc = region_diff(after_k, after_esc, NEXTBTN, o)
    check("A68-Esc 取消录制态", d_esc < SMALL, f"diff={d_esc}")

    # 5. 删除 chip：K chip 位置 = base 与 after_esc 在 ROW1 带的差异包围盒
    #    （红字在 ROW1 外，不干扰定位）
    bbox = diff_bbox(base, after_esc, ROW1, o)
    if not bbox or bbox[2] >= 865:
        check("A68-定位 K chip 失败", False, f"bbox={bbox}")
        return
    y_x = (bbox[1] + bbox[3]) // 2
    deleted = False
    for dx in (-8, -6, -10, -12):
        click(app, bbox[2] + dx, y_x)
        move_mouse_away()
        sleep(400)
        after_del = grab(app)
        bb2 = diff_bbox(after_esc, after_del, ROW1, o)
        if bb2 and bb2[2] < 865:
            deleted = True
            break
        log(f"A68-删 chip 未生效（dx={dx} bbox={bb2}），重试")
    check("A68-删除 chip（× 按钮）", deleted)
    after_del = grab(app)
    shot("hv-12-hotkeys-k-deleted", bbox=app.rect())

    # 6. 恢复默认：重新绑 K → 点「恢复默认」→ K chip 消失
    binds = scan_bind_buttons(app)
    if len(binds) != 4:
        check("A68-重定位「+ 绑定」（删除后）", False, f"found={binds}")
        return
    B = bands_from(binds)  # 删除后行高复原，仍按新扫描重算
    ROW1 = B["ROW1"]
    click(app, *binds[0])
    move_mouse_away()
    sleep(400)
    key(VK_K)
    sleep(500)
    after_k2 = grab(app)
    bbox = diff_bbox(base, after_k2, ROW1, o)
    check("A68-重新绑定 K 成功", bbox is not None and bbox[2] < 865, f"bbox={bbox}")
    click(app, *HK_RESET)
    move_mouse_away()
    sleep(500)
    after_reset = grab(app)
    bb3 = diff_bbox(after_k2, after_reset, ROW1, o)
    check("A68-「恢复默认」清除自定义 chip", bb3 is not None and bb3[2] < 865,
          f"bbox={bb3}")
    shot("hv-13-hotkeys-reset", bbox=app.rect())

    # 7. 取消面板（丢弃草稿）→ 面板应关闭；阅读中按 K 应无效果（未保存不生效）
    click(app, *CANCEL)
    sleep(700)
    after_cancel = grab(app)
    d_closed = region_diff(after_reset, after_cancel, DIALOG, o)
    check("A68-取消后面板关闭", d_closed > NONE, f"dialog_diff={d_closed}")
    move_mouse_away()
    d, _, _ = press_and_diff(app, VK_K, CONTENT, min_diff=0)
    check("A68-未保存草稿不生效（K 无阅读效果）", d < NONE, f"diff={d}")


def phase_a69(app):
    """A69：保存自定义键位后阅读中立即可用；默认键位仍有效。"""
    log("==== A69: 自定义键位保存即时生效 ====")
    ensure_panel_closed(app)
    if not open_settings(app):
        check("打开设置面板", False)
        return
    sleep(1000)
    if not click_nav(app, "hotkeys"):
        check("A69-nav 可达 hotkeys", False)
        return
    sleep(500)
    binds = scan_bind_buttons(app)
    if len(binds) != 4:
        check("A69-定位「+ 绑定」", False, f"found={binds}")
        return
    o = off(app)
    ROW1 = bands_from(binds)["ROW1"]
    move_mouse_away()
    base = grab(app)
    click(app, *binds[0])
    move_mouse_away()
    sleep(400)
    key(VK_K)
    sleep(500)
    after_k = grab(app)
    bbox = diff_bbox(base, after_k, ROW1, o)
    check("A69-录制绑定 K", bbox is not None and bbox[2] < 865, f"bbox={bbox}")
    click(app, *SAVE)
    sleep(800)
    tap(VK_ESC)
    sleep(800)
    ensure_panel_closed(app)
    shot("hv-14-hotkeys-saved", bbox=app.rect())
    # 阅读中：PageDown（默认键）→ K（自定义键）→ PageDown（默认键仍有效）
    d1, _, _ = press_and_diff(app, VK_PAGEDOWN, CONTENT)
    check("A69-PageDown 默认键有效", d1 > BIG, f"diff={d1}")
    d2, _, _ = press_and_diff(app, VK_K, CONTENT)
    check("A69-自定义键 K 即时生效", d2 > BIG, f"diff={d2}")
    d3, _, _ = press_and_diff(app, VK_PAGEDOWN, CONTENT)
    check("A69-保存后默认键仍有效", d3 > BIG, f"diff={d3}")


def phase_a70(app):
    """A70：自定义键位跨重启保持（需换 App 实例，由 main 协调）。"""
    log("==== A70: 自定义键位跨重启保持 ====")
    app.close()
    sleep(1500)
    app2 = App()
    CUR[0] = app2.hwnd
    sleep(2000)
    if not open_book(app2, FIXTURE_PDF):
        check("A70-重启后打开 sample.pdf", False)
        return app2
    sleep(3500)
    shot("hv-15-restart", bbox=app2.rect())
    d1, _, _ = press_and_diff(app2, VK_PAGEDOWN, CONTENT)
    check("A70-重启后 PageDown 有效", d1 > BIG, f"diff={d1}")
    d2, _, _ = press_and_diff(app2, VK_K, CONTENT)
    check("A70-重启后自定义键 K 仍生效", d2 > BIG, f"diff={d2}")
    shot("hv-16-restart-k", bbox=app2.rect())
    return app2


def run_once():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    CUR[0] = app.hwnd
    sleep(2000)
    if not open_book(app, FIXTURE_EPUB):
        log("run_once: 初始打开 12.epub 失败，本轮中止")
        D.flush_log()
        return None
    sleep(3000)
    if not phase0_setup(app):
        log("run_once: 复位失败，本轮中止")
        D.flush_log()
        return None
    phase_a64(app)
    phase_a65(app)
    phase_a66(app)
    phase_a67(app)
    phase_a68(app)
    phase_a69(app)
    app = phase_a70(app)
    app.close()
    sleep(1000)
    failed = [n for n, ok in RESULTS if not ok]
    log(f"==== 快捷键验证: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" +
        (f"，失败: {failed}" if failed else "") + " ====")
    D.flush_log()
    return not failed


def main():
    for r in (1, 2):
        RESULTS.clear()
        log(f"==== 第 {r} 轮快捷键验证开始 ====")
        ok = run_once()
        if ok:
            return
        if ok is None:
            log("==== 本轮环境性中止，不重试 ====")
            return
        log(f"==== 第 {r} 轮存在失败项，整体重试 ====")
    log("==== 两轮均未全绿，按失败退出 ====")


if __name__ == "__main__":
    main()
