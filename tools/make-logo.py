"""生成「机器视觉智能选型助手」logo（PNG）。

图标：深蓝圆角底 + 白色镜头光圈（6 叶）+ 海康红状态点 + 右下角标定棋盘角。
输出：1024 / 512 / 144 三种尺寸，外加横版字标。
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "logo")
NAVY_TOP = (11, 18, 32)
NAVY_BOT = (29, 78, 216)
WHITE = (255, 255, 255)
RED = (230, 0, 18)
INK = (15, 23, 42)
MUTED = (100, 116, 139)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(size, top, bot):
    w, h = size
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bot, y / max(1, h - 1)))
    return img


def icon(size, pad_ratio=0.0):
    S = size * 4  # 4x 超采样
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 圆角底
    radius = int(S * 0.225)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    bg = gradient((S, S), NAVY_TOP, NAVY_BOT).convert("RGBA")
    img.paste(bg, (0, 0), mask)

    # 右上角柔光
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([int(S * 0.42), int(-S * 0.28), int(S * 1.12), int(S * 0.42)], fill=(56, 189, 248, 46))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(S * 0.07)))

    d = ImageDraw.Draw(img)
    cx = cy = S // 2
    R = int(S * 0.315)          # 光圈外圈半径
    ring_w = int(S * 0.052)     # 外圈线宽
    hole_r = int(S * 0.150)     # 光圈孔半径

    # 镜头外圈
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=WHITE + (242,), width=ring_w)

    # 光圈叶片：6 条边 + 外扩线
    import math
    verts = []
    for k in range(6):
        a = math.radians(90 + k * 60 + 12)
        verts.append((cx + hole_r * math.cos(a), cy - hole_r * math.sin(a)))

    # 叶片区（孔到内圈之间的深色，制造"叶片"层次）
    blade = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blade)
    bd.polygon(verts, fill=(9, 14, 26, 255))
    # 每片叶片的边缘线，从孔顶点向外偏移
    for k, (vx, vy) in enumerate(verts):
        a = math.radians(90 + k * 60 + 12 + 42)
        ex = cx + (R - ring_w * 0.6) * math.cos(a)
        ey = cy - (R - ring_w * 0.6) * math.sin(a)
        bd.line([(vx, vy), (ex, ey)], fill=WHITE + (210,), width=int(S * 0.018))
    img.alpha_composite(blade)

    # 玻璃淡蓝反光
    d = ImageDraw.Draw(img)
    d.ellipse([cx - hole_r * 0.62, cy - hole_r * 0.62, cx + hole_r * 0.62, cy + hole_r * 0.62],
              fill=(59, 130, 246, 62))
    d.arc([cx - hole_r * 0.9, cy - hole_r * 0.9, cx + hole_r * 0.9, cy + hole_r * 0.9],
          start=205, end=320, fill=(255, 255, 255, 150), width=int(S * 0.012))

    # 海康红状态点（右上，压在光圈外圈上）
    dot_r = int(S * 0.052)
    ang = math.radians(45)
    dx, dy = cx + R * 0.94 * math.cos(ang), cy - R * 0.94 * math.sin(ang)
    d.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=RED, outline=NAVY_TOP + (255,), width=int(S * 0.012))

    # 右下角标定棋盘（3x3，低透明度）
    cell = int(S * 0.048)
    bx, by = int(S * 0.715), int(S * 0.715)
    for r in range(3):
        for c in range(3):
            if (r + c) % 2 == 0:
                d.rounded_rectangle(
                    [bx + c * cell, by + r * cell, bx + (c + 1) * cell - 3, by + (r + 1) * cell - 3],
                    radius=int(cell * 0.22), fill=(255, 255, 255, 120))

    # 用圆角遮罩裁掉溢出的高光，保证边缘干净
    alpha = Image.composite(img.getchannel("A"), Image.new("L", (S, S), 0), mask)
    img.putalpha(alpha)
    return img.resize((size, size), Image.LANCZOS)


def wordmark(w=1400, h=380):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ic = icon(int(h * 0.78))
    img.alpha_composite(ic, (int(h * 0.05), (h - ic.height) // 2))

    bold = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", int(h * 0.235))
    light = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", int(h * 0.115))
    d = ImageDraw.Draw(img)
    x = ic.width + int(h * 0.16)
    d.text((x, int(h * 0.245)), "机器视觉智能选型助手", font=bold, fill=INK + (255,), anchor="lm")
    d.text((x, int(h * 0.545)), "输入需求 → 相机 / 镜头 / 光源 一键选型", font=light, fill=MUTED + (255,), anchor="lm")
    d.rounded_rectangle([x, int(h * 0.70), x + int(h * 0.16), int(h * 0.775)], radius=int(h * 0.02), fill=RED)
    d.text((x + int(h * 0.20), int(h * 0.738)), "海康机器人型号库", font=light, fill=MUTED + (255,), anchor="lm")
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (1024, 512, 144):
        p = os.path.join(OUT, f"logo-{size}.png")
        icon(size).save(p)
        print("saved", p)
    wm = wordmark()
    p = os.path.join(OUT, "logo-wordmark.png")
    wm.save(p)
    print("saved", p)


if __name__ == "__main__":
    main()
