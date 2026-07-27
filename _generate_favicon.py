#!/usr/bin/env python3
"""Generate apple-touch-icon.png from the same die design as favicon.svg.

Build-time script, committed for reproducibility like _generate_thumbnails.py
and _svg_floorplan.py. Not loaded by the site. Re-run only if the mark changes:

    python _generate_favicon.py

Why a raster at all, when favicon.svg covers browsers: iOS will not use an SVG
for an Add-to-Home-Screen icon, and this site's whole premise is being pulled
up on a phone at the convention. Without it iOS screenshots the page instead.

Two deliberate differences from favicon.svg:

  * No rounded corners. iOS applies its own corner mask; drawing ours too
    would double-round and leave pale notches at the corners.
  * No transparency. Alpha in an apple-touch-icon renders black on some iOS
    versions, so the background is painted opaque.
"""
from PIL import Image, ImageDraw

SIZE = 180
SS = 4                      # supersample factor — keeps the pips smooth
SLATE = (44, 62, 80)        # #2c3e50, the site header colour
WHITE = (255, 255, 255)

# Pip geometry in the SVG's 64-unit viewBox, scaled up here.
PIPS = [(18, 18), (46, 18), (32, 32), (18, 46), (46, 46)]
PIP_R = 7.5
VIEWBOX = 64


def main() -> None:
    px = SIZE * SS
    scale = px / VIEWBOX

    img = Image.new("RGB", (px, px), SLATE)   # RGB, not RGBA — opaque on purpose
    draw = ImageDraw.Draw(img)

    r = PIP_R * scale
    for cx, cy in PIPS:
        x, y = cx * scale, cy * scale
        draw.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save("apple-touch-icon.png", optimize=True)

    print(f"wrote apple-touch-icon.png  {SIZE}x{SIZE}")


if __name__ == "__main__":
    main()
