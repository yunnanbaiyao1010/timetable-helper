
# -*- coding: utf-8 -*-
"""课表助手 · 桌面小组件视觉稿"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 2
BOLD = "C:/Windows/Fonts/msyhbd.ttc"
REG  = "C:/Windows/Fonts/msyh.ttc"
_cache = {}
def P(v): return int(round(v * S))
def f(size, bold=True):
    k = (round(size, 1), bold)
    if k not in _cache:
        _cache[k] = ImageFont.truetype(BOLD if bold else REG, max(1, P(size)))
    return _cache[k]

def make_bg(w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    t = np.clip(u * 0.55 + v * 0.45, 0, 1)
    c1 = np.array([238, 242, 248], np.float32)
    c2 = np.array([246, 241, 236], np.float32)
    c3 = np.array([234, 240, 246], np.float32)
    base = np.where((t < 0.5)[..., None],
                    c1 + (c2 - c1) * (t[..., None] / 0.5),
                    c2 + (c3 - c2) * ((t[..., None] - 0.5) / 0.5))
    for (cx, cy), r, col, k in [((0.12, 0.06), 0.42, (150, 180, 255), 0.55),
                                ((0.92, 0.26), 0.38, (255, 196, 150), 0.42),
                                ((0.46, 0.96), 0.40, (168, 226, 214), 0.42)]:
        dd = np.sqrt((u - cx) ** 2 + (v - cy) ** 2)
        m = np.exp(-(dd / r) ** 2) * k
        base = base * (1 - m[..., None]) + np.array(col, np.float32) * m[..., None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

def phone_bg(w, h):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    t = np.clip(u * 0.35 + v * 0.65, 0, 1)
    c1 = np.array([92, 128, 208], np.float32)
    c2 = np.array([164, 146, 214], np.float32)
    base = c1 + (c2 - c1) * t[..., None]
    for (cx, cy), r, col, k in [((0.2, 0.8), 0.5, (255, 198, 168), 0.5),
                                ((0.85, 0.25), 0.45, (120, 190, 235), 0.55),
                                ((0.6, 1.0), 0.4, (140, 220, 210), 0.35)]:
        dd = np.sqrt((u - cx) ** 2 + (v - cy) ** 2)
        m = np.exp(-(dd / r) ** 2) * k
        base = base * (1 - m[..., None]) + np.array(col, np.float32) * m[..., None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

def shadow(surf, box, radius, blur=20, alpha=74, dy=16, color=(30, 45, 70)):
    x0, y0, x1, y1 = [P(v) for v in box]
    sh = Image.new("L", surf.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + P(dy), x1, y1 + P(dy)),
                                         radius=P(radius), fill=alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(P(blur)))
    layer = Image.new("RGBA", surf.size, color + (0,))
    layer.putalpha(sh)
    surf.alpha_composite(layer)

def card(surf, box, radius=34):
    shadow(surf, box, radius)
    x0, y0, x1, y1 = [P(v) for v in box]
    body = Image.new("RGBA", surf.size, (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle((x0, y0, x1, y1), radius=P(radius),
                                           fill=(255, 255, 255, 241))
    surf.alpha_composite(body)

def grad_layer(surf):
    w, h = surf.size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip((xx / w) * 0.32 + (yy / h) * 0.68, 0, 1)
    c1 = np.array([56, 72, 98], np.float32)
    c2 = np.array([124, 92, 230], np.float32)
    g = np.stack([c1[i] + (c2[i] - c1[i]) * t for i in range(3)], -1)
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

# ============ A 款（可缩放，供对比图和手机图复用） ============
def widget_a(surf, x, y, w, h, k=1.0, show_footer=True):
    d = ImageDraw.Draw(surf)
    card(surf, (x, y, x + w, y + h), 34 * k)
    G = grad_layer(surf)

    def T(px, py, s, fs, color, bold=True, anchor="lt"):
        d.text((P(x + px), P(y + py)), s, font=f(fs * k, bold), fill=color, anchor=anchor)

    def H(x0, x1, ly, color, th=1.3):
        d.rectangle((P(x + x0), P(y + ly), P(x + x1), P(y + ly + th * k)), fill=color)

    T(38, 28, "11月19日 周四", 36, (27, 36, 50))
    T(w - 38, 38, "第 12 周", 24, (147, 160, 179), False, "rt")
    H(38, w - 38, 92, (240, 243, 248), 1.1)

    def row(ly, ts, dim, bar, title, extra, sub, subc):
        tcol = (170, 181, 198) if dim else (27, 36, 50)
        T(38 + 104, ly + 2, ts, 36, tcol, True, "rt")
        bx = 38 + 104 + 22
        d.rounded_rectangle((P(x + bx), P(y + ly - 2), P(x + bx + 7 * k), P(y + ly + 58 * k)),
                            radius=P(3.5 * k), fill=bar)
        tx = bx + 7 * k + 24
        T(tx, ly, title, 34, (27, 36, 50))
        if extra:
            tw = f(34 * k).getbbox(title)[2] / S
            T(tx + tw + 12, ly + 11, extra, 22, (182, 191, 204), False)
        T(tx, ly + 48, sub, 24, subc, False)

    row(122, "14:00", False, (139, 110, 243), "AI大模型应用开发", "",
        "仁爱214 · 严新巧 · 至 17:40", (139, 150, 168))
    H(176, w - 38, 208, (238, 241, 246), 1.1)
    row(238, "15:00", True, (255, 160, 60), "课业汇报", "· 待办",
        "距截止 3 小时 49 分", (232, 134, 42))

    if show_footer:
        H(38, w - 38, h - 74, (240, 243, 248), 1.1)
        T(38, h - 56, "今天 1 门课 · 3 件待办 · 下次提醒 14:00", 22, (166, 176, 192), False)

def grad_text(surf, xy, s, font, anchor="lt"):
    mask = Image.new("L", surf.size, 0)
    ImageDraw.Draw(mask).text((P(xy[0]), P(xy[1])), s, font=font, fill=255, anchor=anchor)
    surf.paste(grad_layer(surf), (0, 0), mask)

# ================= 图 1：三款对比 =================
CW, CH = 1500, 1180
img = make_bg(P(CW), P(CH))
d = ImageDraw.Draw(img)

def T(px, py, s, fs, color, bold=True, anchor="lt"):
    d.text((P(px), P(py)), s, font=f(fs, bold), fill=color, anchor=anchor)
def wof(s, fs, bold=True):
    return f(fs, bold).getbbox(s)[2] / S
def badge(x, y, s, fs, fg, bg, anchor="l", padx=15, pady=7):
    wd = wof(s, fs)
    hh = P(21 + pady * 2)
    px, py = P(x), P(y)
    left = px if anchor == "l" else px - P(wd) - P(padx) * 2
    top = py - hh / 2
    d.rounded_rectangle((left, top, left + P(wd) + P(padx) * 2, top + hh), radius=hh / 2, fill=bg)
    d.text((left + P(padx), py), s, font=f(fs), fill=fg, anchor="lm")

T(62, 40, "课表助手 · 桌面小组件视觉稿", 22, (139, 150, 168), False)
T(62, 92, "A 款 时间轴", 22, (65, 96, 127))
T(62 + wof("A 款 时间轴", 22) + 14, 92, "4×2 · 信息最全", 22, (139, 150, 168), False)
T(994, 92, "C 款 方形", 22, (65, 96, 127))
T(994 + wof("C 款 方形", 22) + 14, 92, "2×2 · 最省位", 22, (139, 150, 168), False)

widget_a(img, 62, 128, 880, 452, 1.0)

# C 卡
CX, CY, CWD, CHT = 994, 128, 452, 452
card(img, (CX, CY, CX + CWD, CY + CHT), 34)
T(CX + 32, CY + 32, "周四 11/19", 26, (65, 96, 127))
badge(CX + CWD - 30, CY + 46, "待办 3", 20, (232, 134, 42), (255, 243, 226), "r")
grad_text(img, (CX + 30, CY + 156), "14:00", f(88))
T(CX + 32, CY + CHT - 160, "AI大模型应用开发", 32, (27, 36, 50))
T(CX + 32, CY + CHT - 114, "仁爱214 · 严新巧", 23, (139, 150, 168), False)

T(62, 616, "B 款 聚焦下一节", 22, (65, 96, 127))
T(62 + wof("B 款 聚焦下一节", 22) + 14, 616, "4×2 · 最醒目", 22, (139, 150, 168), False)

BX, BY, BW, BH = 62, 648, 880, 452
card(img, (BX, BY, BX + BW, BY + BH), 34)
T(BX + 40, BY + 30, "下一节", 25, (65, 96, 127))
badge(BX + 40 + wof("下一节", 25) + 18, BY + 45, "2 小时 49 分后", 21, (74, 108, 240), (238, 243, 255))
grad_text(img, (BX + 38, BY + 140), "14:00", f(104))
T(BX + 38 + 296 + 34, BY + 150, "AI大模型应用开发", 40, (27, 36, 50))
T(BX + 38 + 296 + 34, BY + 212, "仁爱214 · 严新巧", 25, (139, 150, 168), False)

px0, px1, py = P(BX + 40), P(BX + BW - 40), P(BY + 330)
fh = P(9)
d.rounded_rectangle((px0, py, px1, py + fh), radius=fh / 2, fill=(237, 240, 246))
fill_w = int((px1 - px0) * 0.44)
_a = np.linspace(0, 1, max(fill_w, 2))[:, None]
_c = np.array([139, 110, 243], np.float32) * (1 - _a) + np.array([111, 143, 245], np.float32) * _a
bar = Image.fromarray(np.repeat(np.clip(_c, 0, 255).astype(np.uint8)[None, :, :], fh, 0), "RGB").convert("RGBA")
mask = Image.new("L", (fill_w, fh), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, fill_w - 1, fh - 1), radius=fh / 2, fill=255)
img.paste(bar, (px0, py), mask)

img.convert("RGB").save("D:/开发项目/课表助手-app/design/widget-variants.png", "PNG")
print("variants ok")

# ================= 图 2：放在桌面上的实景 =================
CW2, CH2 = 1500, 2300
canvas = make_bg(P(CW2), P(CH2))
# 手机外框
PX, PY, PW, PH = 214, 100, 1072, 2100
shadow(canvas, (PX, PY, PX + PW, PY + PH), 62, blur=30, alpha=110, dy=22)
mask = Image.new("L", canvas.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((P(PX), P(PY), P(PX + PW), P(PY + PH)), radius=P(62), fill=255)

screen = phone_bg(P(PW), P(PH))
sd = ImageDraw.Draw(screen)

def ST(px, py, s, fs, color, bold=True, anchor="lt"):
    sd.text((P(px), P(py)), s, font=f(fs, bold), fill=color, anchor=anchor)

# 状态栏
ST(46, 26, "11:21", 34, (255, 255, 255))
sig_w = 34
for i, hh in enumerate([8, 12, 16, 20]):
    sd.rounded_rectangle((P(PW - 250 + i * 11), P(48 - hh / 2), P(PW - 250 + i * 11 + 6), P(48 + hh / 2)),
                         radius=P(1.5), fill=(255, 255, 255))
sd.rounded_rectangle((P(PW - 200), P(36), P(PW - 150), P(60)), radius=P(5), fill=None,
                     outline=(255, 255, 255, 200), width=P(2))
sd.rounded_rectangle((P(PW - 197), P(39), P(PW - 160), P(57)), radius=P(3), fill=(255, 255, 255))
sd.rounded_rectangle((P(PW - 146), P(44), P(PW - 142), P(52)), radius=P(2), fill=(255, 255, 255))
sd.ellipse((P(PW / 2 - 9), P(30), P(PW / 2 + 9), P(48)), fill=(15, 18, 24))

# 小组件
widget_a(screen, 48, 118, 976, 470, 1.11, show_footer=True)

# 图标网格
icons = [("微信", (78, 190, 96), "微"), ("相机", (92, 110, 200), "相"), ("相册", (240, 150, 90), "册"),
         ("日历", (232, 96, 96), "19"), ("时钟", (60, 62, 72), "钟"), ("天气", (86, 150, 220), "天"),
         ("设置", (120, 128, 140), "设"), ("音乐", (228, 88, 120), "音"),
         ("浏览器", (74, 170, 160), "浏"), ("计算器", (64, 84, 140), "算"), ("备忘录", (238, 190, 72), "记"),
         ("文件", (90, 176, 200), "件"), ("支付宝", (70, 132, 232), "支"), ("淘宝", (240, 108, 60), "淘"),
         ("地图", (86, 178, 120), "图"), ("录音", (150, 110, 224), "录")]
IC, TOP, COLGAP, ROWGAP = 128, 620, 283, 295
for i, (name, col, mark) in enumerate(icons):
    r_, c_ = divmod(i, 4)
    ix = 48 + c_ * COLGAP
    iy = TOP + r_ * ROWGAP
    sd.rounded_rectangle((P(ix), P(iy), P(ix + IC), P(iy + IC)), radius=P(30), fill=col)
    if mark:
        ST(ix + IC / 2, iy + IC / 2 - 22, mark, 40 if len(mark) < 3 else 34, (255, 255, 255), True, "mt")
    else:
        sd.ellipse((P(ix + 34), P(iy + 34), P(ix + IC - 34), P(iy + IC - 34)),
                   outline=(255, 255, 255, 235), width=P(5))
    sd.text((P(ix + IC / 2), P(iy + IC + 14)), name, font=f(24, False), fill=(255, 255, 255), anchor="mt")

# 底部 dock 一条
dy0 = PH - 200
sd.rounded_rectangle((P(48), P(dy0), P(PW - 48), P(dy0 + 170)), radius=P(46),
                     fill=(255, 255, 255, 62))
for i, col in enumerate([(78, 190, 96), (240, 150, 90), (232, 96, 96), (92, 110, 200)]):
    ix = 149 + i * 219
    sd.rounded_rectangle((P(ix), P(dy0 + 26), P(ix + 118), P(dy0 + 144)), radius=P(28), fill=col)

mask_crop = mask.crop((P(PX), P(PY), P(PX) + P(PW), P(PY) + P(PH)))
canvas.paste(screen, (P(PX), P(PY)), mask_crop)
canvas.convert("RGB").save("D:/开发项目/课表助手-app/design/widget-desktop.png", "PNG")
print("desktop ok")
