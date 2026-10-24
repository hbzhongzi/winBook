"""焦点诊断：打开设置 → 界面外观，然后每按一次 Tab 截一次图，
通过焦点环观察真实 Tab 落点（不猜坐标）。"""
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, tap

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
GEAR = (1241, 26)
VK_TAB = 0x09
VK_RETURN = 0x0D

app = App()
sleep(2000)
D.open_file(app, FIXTURE)
sleep(6000)

click_client(app.hwnd, *GEAR)
sleep(900)
shot("dbg-00-open", bbox=app.rect())

# Tab x3 + Enter → 界面外观
for _ in range(3):
    tap(VK_TAB)
    sleep(150)
tap(VK_RETURN)
sleep(700)
shot("dbg-01-appearance", bbox=app.rect())

# 之后每按一次 Tab 截一次图
for i in range(1, 9):
    tap(VK_TAB)
    sleep(400)
    shot(f"dbg-tab{i:02d}", bbox=app.rect())
    log(f"dbg: tab{i} done")

app.close()
