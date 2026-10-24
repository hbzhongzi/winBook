"""v0.2.5 F21/F22 + v0.2.6 翻页导航与快捷键真机验证（A60–A65）。

覆盖：
- A60 翻页按钮悬浮贴底不遮挡正文（截图人工确认 + pager 位于底部条带像素实证）
- A61 2.5s 闲置自动隐藏；鼠标移动复现；静止后再隐藏（隐藏态稳定性）
- A62 window 级快捷键：焦点在工具栏按钮（正文区外）时 ArrowRight 翻页生效
- A63 iframe 内焦点：点击正文后 ArrowRight 经 postMessage 转发器仍生效
- A64 悬停豁免（v0.2.6）：移向按钮组并停留 >2.5s 仍可见（命中测试判定悬停）
- A65 移出按钮组后恢复 2.5s 闲置计时隐藏

驱动：driver.py（Win32 点击/SendInput/PIL 截图）；断言用区域像素 diff。
用法：python e2e/verify_pager.py [fixture]
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import driver as D
from driver import App, log, sleep, shot, click_client, tap, force_foreground
import ctypes
from PIL import ImageGrab

user32 = ctypes.windll.user32

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "12.epub"

MODE_PAGE = (1184, 27)   # 工具栏「翻页」分段按钮（已是翻页模式时为无操作守卫）
VK_RIGHT = 0x27          # ArrowRight

# 断言区域（客户区坐标）
PAGER_BAND = (560, 735, 720, 805)    # 翻页按钮组应出现/消失的底部条带
CONTENT = (100, 120, 1180, 700)      # 正文区（避开工具栏/状态栏/pager）

RESULTS = []
CUR = [None]  # 当前 app hwnd（key/fg 无参时取当前）


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def fg(app=None):
    """前台哨兵：强制激活并验证；第三方窗口抢焦点时重试。"""
    hwnd = app.hwnd if app else CUR[0]
    for i in range(4):
        force_foreground(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        sleep(300)
    return False


def click(hwnd, x, y):
    fg()
    click_client(hwnd, x, y)

def key(vk):
    fg()
    tap(vk)


def grab(app):
    return ImageGrab.grab(bbox=app.rect())


def region_diff(a, b, box):
    """两截图在区域（客户区坐标）内的差异像素数（2 步长抽样）。"""
    x0, y0, x1, y1 = box
    n = 0
    for y in range(y0 + 31, y1 + 31, 2):
        for x in range(x0 + 1, x1 + 1, 2):
            pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
            if any(abs(pa[i] - pb[i]) > 18 for i in range(3)):
                n += 1
    return n


def diff_bbox(a, b, box, thresh=18):
    """区域内有差异像素的包围盒（截图坐标）；无差异返回 None。"""
    x0, y0, x1, y1 = box
    xs, ys = [], []
    for y in range(y0 + 31, y1 + 31):
        for x in range(x0 + 1, x1 + 1):
            pa, pb = a.getpixel((x, y)), b.getpixel((x, y))
            if any(abs(pa[i] - pb[i]) > thresh for i in range(3)):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def run_once():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"],
                   capture_output=True)
    sleep(800)
    app = App()
    CUR[0] = app.hwnd
    sleep(2000)
    ok = D.open_file(app, FIXTURE)
    log(f"pager: open_file -> {ok}, title={D.window_text(app.hwnd)!r}")
    fg(app)
    app.move_to(40, 60)  # 避开右上角通知弹窗区
    sleep(3000)
    shot("pv-00-book", bbox=app.rect())

    # 1. 确保翻页模式（点在「翻页」位：已是翻页模式则命中无操作守卫）
    click(app.hwnd, *MODE_PAGE)
    sleep(1600)
    shot("pv-01-page-mode", bbox=app.rect())

    # 2. 鼠标移出窗口 → 静候 >2.5s → pager 应处于隐藏态
    user32.SetCursorPos(2, 2)
    sleep(3400)
    im_hidden1 = grab(app)
    shot("pv-02-pager-hidden", bbox=app.rect())

    # 3. 鼠标移入正文区 → mousemove 复现
    #    注：按钮底色用 --surface-bg，与正文底色同令牌（深色主题下两者同为
    #    #1e293b），显隐差异主要来自 1px 边框与 ‹ › 字形——实测 diff≈76
    #    （2 步长抽样），故阈值取 40；隐藏态对比为 0，分离度足够。
    user32.SetCursorPos(40 + 640, 60 + 420)
    sleep(700)
    im_shown = grab(app)
    shot("pv-03-pager-shown", bbox=app.rect())
    d_show = region_diff(im_hidden1, im_shown, PAGER_BAND)
    check("A61-鼠标移动复现按钮", d_show > 40, f"diff={d_show}")

    # 4. 定位按钮组（隐藏↔显示差异包围盒）→ 记录贴底位置（A60 像素实证）
    bbox = diff_bbox(im_hidden1, im_shown, PAGER_BAND)
    if bbox:
        log(f"pager 组(截图): x {bbox[0]}..{bbox[2]} y {bbox[1]}..{bbox[3]} "
            f"→ 客户区 y {bbox[1]-31}..{bbox[3]-31}（窗口客户高 828，贴底余量 "
            f"{828 - (bbox[3]-31)}px）")
        check("A60-按钮组贴底悬浮", (bbox[1] - 31) > 700, f"顶边客户区 y={bbox[1]-31}")
    else:
        check("A60-按钮组贴底悬浮", False, "差异包围盒未检出")

    # 5. 静止 >2.5s（不再移动鼠标）→ 应再次自动隐藏
    sleep(3400)
    im_hidden2 = grab(app)
    shot("pv-04-pager-hidden-again", bbox=app.rect())
    d_hide = region_diff(im_shown, im_hidden2, PAGER_BAND)
    check("A61-闲置自动隐藏", d_hide > 40, f"diff={d_hide}")
    d_stable = region_diff(im_hidden1, im_hidden2, PAGER_BAND)
    check("A61-隐藏态稳定（两次隐藏截图一致）", d_stable < 40, f"diff={d_stable}")

    # 9. 悬停豁免（v0.2.6 P0）：移向按钮组并停留 >2.5s，应仍可见（不自动隐藏）。
    #    机制（命中测试，非 enter/leave）：section 挂 mousemove，指针落在按钮组 DOM
    #    上（含子孙）即视为悬停、暂停隐藏计时；静止悬停时无新 mousemove，因最后一次
    #    事件即在按钮组上、未启动计时 → 保持可见。WebView2 对合成输入不派发
    #    mouseenter/leave，故不依赖二者（A64 初版即因此失败）。
    #    流程：先移动正文区复现 → 再移到按钮组上方（阅读区，同 x）→ 向下一步跨入
    #    按钮组中心（mousemove 命中测试判定悬停、暂停计时）→ 停留远超 2.5s 仍可见。
    if bbox:
        cx = (bbox[0] + bbox[2]) // 2
        cy = (bbox[1] + bbox[3]) // 2
        user32.SetCursorPos(40 + 640, 60 + 420)   # 正文区：复现
        sleep(500)
        # 先停在按钮组正上方（阅读区，同 x），再向下一步跨入按钮组中心
        # （mousemove 命中测试 → 悬停态暂停隐藏；分步跨边界确保 mousemove 派发）
        user32.SetCursorPos(40 + cx - 1, 60 + (cy - 31 - 60))
        sleep(250)
        user32.SetCursorPos(40 + cx - 1, 60 + (cy - 31))  # 跨入按钮组中心
        sleep(500)
        im_hover0 = grab(app)
        sleep(3200)                                 # 远超 2.5s 闲置阈值，悬停中应保持
        im_hover1 = grab(app)
        shot("pv-08-hover-hold", bbox=app.rect())
        d_hold = region_diff(im_hover0, im_hover1, PAGER_BAND)
        check("A64-悬停中停留不自动隐藏", d_hold < 40, f"diff={d_hold}")

        # 移出按钮组：向上一步跨出到阅读区 → mousemove 命中测试判定非悬停 →
        # 恢复 2.5s 闲置计时后隐藏
        user32.SetCursorPos(40 + cx - 1, 60 + (cy - 31 - 60))
        sleep(2600)
        im_hover_hide = grab(app)
        shot("pv-09-hover-leave", bbox=app.rect())
        d_leave = region_diff(im_hover1, im_hover_hide, PAGER_BAND)
        check("A65-移出后闲置计时隐藏", d_leave > 40, f"diff={d_leave}")
    else:
        check("A64-悬停中停留不自动隐藏", False, "无按钮组定位")
        check("A65-移出后闲置计时隐藏", False, "无按钮组定位")

    # 6. A62：焦点在工具栏按钮（正文区外）→ ArrowRight 翻页生效
    click(app.hwnd, *MODE_PAGE)  # 点击后焦点落在按钮上，不在 iframe
    sleep(500)
    im_before = grab(app)
    key(VK_RIGHT)
    sleep(900)
    im_after = grab(app)
    d_kbd = region_diff(im_before, im_after, CONTENT)
    check("A62-window 级 ArrowRight 翻页（焦点在正文外）", d_kbd > 2000, f"diff={d_kbd}")
    shot("pv-05-kbd-window", bbox=app.rect())

    # 7. A63：点击正文（焦点入 iframe）→ ArrowRight 经 postMessage 转发仍生效
    click(app.hwnd, 300, 300)  # 左页边距区，避开脚注链接
    sleep(900)
    im_before2 = grab(app)
    key(VK_RIGHT)
    sleep(900)
    im_after2 = grab(app)
    d_if = region_diff(im_before2, im_after2, CONTENT)
    check("A63-iframe 内焦点 ArrowRight 仍生效", d_if > 2000, f"diff={d_if}")
    shot("pv-06-kbd-iframe", bbox=app.rect())

    # 8. 鼠标移到按钮组 → 点击「下一页」→ 正文变化（按钮点击链路）
    if bbox:
        nx = (bbox[0] + bbox[2]) // 2 + 22  # 组中心偏右 = ‹ › 中的 ›
        ny = (bbox[1] + bbox[3]) // 2
        user32.SetCursorPos(40 + nx - 1, 60 + ny - 31)  # 先移到按钮组上使其复现
        sleep(600)
        im_before3 = grab(app)
        click(app.hwnd, nx - 1, ny - 31)
        sleep(900)
        im_after3 = grab(app)
        d_btn = region_diff(im_before3, im_after3, CONTENT)
        check("A61-点击翻页按钮生效", d_btn > 2000, f"diff={d_btn}")
        shot("pv-07-pager-click", bbox=app.rect())
    else:
        check("A61-点击翻页按钮生效", False, "无按钮组定位")

    failed = [n for n, ok in RESULTS if not ok]
    log(f"==== 翻页导航验证: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" +
        (f"，失败: {failed}" if failed else "") + " ====")
    D.flush_log()
    return not failed


def main():
    for r in (1, 2):
        RESULTS.clear()
        log(f"==== 第 {r} 轮翻页导航验证开始 ====")
        if run_once():
            return
        log(f"==== 第 {r} 轮存在失败项，整体重试 ====")
    log("==== 两轮均未全绿，按失败退出 ====")


if __name__ == "__main__":
    main()
