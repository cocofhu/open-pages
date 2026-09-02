#!/usr/bin/env python3
"""Regenerate desktop icon assets from the vector mark in apps/web/public/favicon.svg.

Run with Pillow installed:  python3 scripts/generate-icons.py

macOS is the odd one out: the Dock lays icons out on a fixed grid and expects the
artwork to occupy 824/1024 of the canvas, so a full-bleed mark renders noticeably
larger than every well-behaved app. Windows and Linux draw the icon as-is, where
the same padding would instead look too small. So only the .icns gets inset.
"""

import struct
from pathlib import Path

from PIL import Image, ImageDraw

ICONS_DIR = Path(__file__).resolve().parent.parent / "apps/desktop/src-tauri/icons"

BACKDROP = (44, 42, 38, 255)
INK = (247, 244, 239, 255)

# Geometry in the 64-unit space of favicon.svg.
CORNER_RADIUS = 14 / 64
BARS = [(18 / 64, 20 / 64, 28 / 64, 4 / 64), (18 / 64, 30 / 64, 20 / 64, 4 / 64), (18 / 64, 40 / 64, 24 / 64, 4 / 64)]

# Apple's icon grid: an 824x824 body centred on a 1024x1024 canvas.
MACOS_BODY_RATIO = 824 / 1024

SUPERSAMPLE = 4

ICNS_TYPES = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
]

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

PNG_TARGETS = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}


def render_mark(size: int) -> Image.Image:
    """Draw the mark filling the whole canvas, supersampled for clean edges."""
    hi = size * SUPERSAMPLE
    image = Image.new("RGBA", (hi, hi), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([0, 0, hi - 1, hi - 1], radius=CORNER_RADIUS * hi, fill=BACKDROP)
    for x, y, width, height in BARS:
        draw.rectangle([x * hi, y * hi, (x + width) * hi - 1, (y + height) * hi - 1], fill=INK)
    return image.resize((size, size), Image.LANCZOS)


def render_inset(size: int) -> Image.Image:
    """Mark inset on the Apple grid, so macOS renders it at the same visual size as other apps."""
    body = round(size * MACOS_BODY_RATIO)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = (size - body) // 2
    canvas.paste(render_mark(body), (offset, offset))
    return canvas


def write_icns(path: Path) -> None:
    from io import BytesIO

    entries = []
    for type_code, size in ICNS_TYPES:
        buffer = BytesIO()
        render_inset(size).save(buffer, format="PNG", optimize=True, compress_level=9)
        payload = buffer.getvalue()
        entries.append(type_code + struct.pack(">I", len(payload) + 8) + payload)

    body = b"".join(entries)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    for name, size in PNG_TARGETS.items():
        render_mark(size).save(ICONS_DIR / name, optimize=True, compress_level=9)

    largest = render_mark(256)
    largest.save(ICONS_DIR / "icon.ico", sizes=[(s, s) for s in ICO_SIZES])

    write_icns(ICONS_DIR / "icon.icns")
    print(f"regenerated desktop icons in {ICONS_DIR}")


if __name__ == "__main__":
    main()
