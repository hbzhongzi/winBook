# -*- coding: utf-8 -*-
"""绘制 BookEditor 应用图标：品牌蓝圆角底 + 白色打开的书本。

输出：
- build/appicon.png       512x512（Wails 图标源）
- build/windows/icon.ico  多尺寸 16/24/32/48/64/128/256
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 1024          # 绘制分辨率
OUT_PNG = 512        # appicon.png 输出分辨率

# ---------- 工具 ----------

def cubic(p0, p1, p2, p3, n=48):
    """三次贝塞尔采样点列。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def rounded_rect_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def vgrad(size, top, bottom):
    """垂直渐变。"""
    g = Image.new("RGB", (1, size))
    d = ImageDraw.Draw(g)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.point((0, y), fill=c)
    return g.resize((size, size))


# ---------- 画布 ----------
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

# 1) 圆角底：品牌蓝垂直渐变 #3B82F6 -> #1D4ED8
radius = round(SIZE * 0.2237)  # iOS squircle 比例
bg = vgrad(SIZE, (59, 130, 246), (29, 78, 216)).convert("RGBA")
bg.putalpha(rounded_rect_mask(SIZE, radius))
img.alpha_composite(bg)

# 2) 左上柔光（限制在圆角内，增加层次）
hl = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(hl)
hd.ellipse([-SIZE * 0.35, -SIZE * 0.45, SIZE * 0.75, SIZE * 0.65],
           fill=(255, 255, 255, 46))
hl = hl.filter(ImageFilter.GaussianBlur(90))
hl.putalpha(Image.composite(hl.getchannel("A"), Image.new("L", (SIZE, SIZE), 0),
                            rounded_rect_mask(SIZE, radius)))
img.alpha_composite(hl)

# 3) 白色打开的书本
# 几何（1024 画布）：书心 x=512，顶脊 (512,352)，底脊 (512,672)，
# 上外角 (240,292)/(784,292)，下外角 (224,588)/(800,588)
cx = 512
left_page = []
left_page += cubic((cx, 352), (430, 300), (330, 288), (240, 292))   # 顶边
left_page += cubic((240, 292), (216, 400), (214, 480), (224, 588))  # 外沿
left_page += cubic((224, 588), (330, 640), (430, 664), (cx, 672))   # 底边
right_page = [(SIZE - x, y) for (x, y) in left_page]                # 镜像

book = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bd = ImageDraw.Draw(book)
bd.polygon(left_page + right_page, fill=(255, 255, 255, 255))
img.alpha_composite(book)

# 4) 书页文字线（品牌蓝，圆头）
lines = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ld = ImageDraw.Draw(lines)
BLUE = (37, 99, 235, 255)


def hline(x1, y1, x2, y2, w):
    ld.line([(x1, y1), (x2, y2)], fill=BLUE, width=w)
    r = w / 2
    for (x, y) in [(x1, y1), (x2, y2)]:
        ld.ellipse([x - r, y - r, x + r, y + r], fill=BLUE)


# 左页三行（向右下微微倾斜，跟随页形）
hline(286, 392, 466, 372, 15)
hline(278, 452, 470, 430, 15)
hline(270, 512, 474, 488, 15)
# 右页三行（镜像）
hline(558, 372, 738, 392, 15)
hline(554, 430, 746, 452, 15)
hline(550, 488, 754, 512, 15)
img.alpha_composite(lines)

# 5) 书芯中缝（淡阴影线，强化"打开"感）
seam = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(seam)
sd.line([(cx, 360), (cx, 664)], fill=(37, 99, 235, 60), width=6)
img.alpha_composite(seam)

# ---------- 输出 ----------
build = os.path.join(PROJ, "build")
os.makedirs(build, exist_ok=True)
png_path = os.path.join(build, "appicon.png")
img.resize((OUT_PNG, OUT_PNG), Image.LANCZOS).save(png_path)
print("written:", png_path)

ico_path = os.path.join(build, "windows", "icon.ico")
os.makedirs(os.path.dirname(ico_path), exist_ok=True)
img.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                          (64, 64), (128, 128), (256, 256)])
print("written:", ico_path)

# 预览小图（16/32/48 拼一张，检查小尺寸可读性）
preview = Image.new("RGBA", (16 + 32 + 48 + 32, 64), (255, 255, 255, 255))
x = 0
for s in (16, 32, 48):
    preview.alpha_composite(img.resize((s, s), Image.LANCZOS), (x, 0))
    x += s + 8
preview.convert("RGB").save(os.path.join(build, "icon-preview.png"))
print("written:", os.path.join(build, "icon-preview.png"))
