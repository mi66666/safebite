#!/usr/bin/env python
"""生成 PWA 图标（192 / 512 / maskable 512）。

设计：绿色圆角方块 + 白色盾牌 + 一个"被咬掉一口"的缺口（呼应 SafeBite）。
maskable 版本把主体缩到 60% 安全区内，避免被 Android 圆形遮罩裁掉。
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

GREEN = (31, 122, 77, 255)
DARK_GREEN = (11, 61, 38, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(size: int, maskable: bool = False) -> Image.Image:
    ss = 4  # 超采样，边缘更平滑
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = 0 if maskable else int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=GREEN)

    # 主体安全区
    scale = 0.60 if maskable else 0.72
    w = S * scale
    cx, cy = S / 2, S / 2

    # 盾牌轮廓（简单多边形）
    top = cy - w * 0.52
    bottom = cy + w * 0.55
    left = cx - w * 0.42
    right = cx + w * 0.42
    shield = [
        (cx, top),
        (right, top + w * 0.16),
        (right, cy + w * 0.02),
        (cx, bottom),
        (left, cy + w * 0.02),
        (left, top + w * 0.16),
    ]
    d.polygon(shield, fill=WHITE)

    # 盾牌内画一个"缺口"（咬痕）：用绿色圆盖住右下角
    bite_r = w * 0.30
    d.ellipse(
        [right - bite_r * 1.55, cy + w * 0.05, right + bite_r * 0.45, cy + w * 0.05 + bite_r * 2],
        fill=GREEN,
    )

    # 对勾
    lw = max(int(S * 0.055), 2)
    d.line(
        [(cx - w * 0.20, cy + w * 0.02), (cx - w * 0.02, cy + w * 0.20), (cx + w * 0.26, cy - w * 0.20)],
        fill=DARK_GREEN,
        width=lw,
        joint='curve',
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    targets = [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('icon-maskable-512.png', 512, True),
        ('apple-touch-icon.png', 180, True),
    ]
    for name, size, maskable in targets:
        img = draw_icon(size, maskable=maskable)
        path = OUT / name
        img.save(path, 'PNG', optimize=True)
        print(f'[ok] {path.name} {size}x{size} {path.stat().st_size / 1024:.1f} KB')


if __name__ == '__main__':
    main()
