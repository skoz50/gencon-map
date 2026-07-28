"""Find normalized pin coordinates for an exhibit-hall booth.

Build-time tooling (see CLAUDE.md) — never loaded by the site. Reads the local
`data/2026/source/2026.exhibithallmap.pdf`, which is gitignored, so this only
runs on a box that has the source PDF.

WHY THIS EXISTS
---------------
`/vendors/` pins are normalized 0-1 page fractions in `vendor-favorites.json`.
They used to be captured by hand with the 📍 Pick-coords dev tool, removed in
`7d379dd`. This replaces that workflow for adding new favorites.

The obvious approach — read booth numbers as text and look one up — does NOT
work on the 2026 map, and two separate sessions have burned time rediscovering
that. Recording the dead ends so a third doesn't:

  * `page.chars` has **zero** digits in the floor-plan area. The booth numbers
    are vector outlines, not text. (`data/2019-prototype/_floor_spike.py` works
    precisely because the *2019* PDF does keep them as text — that approach
    does not transfer to 2026.)
  * The exported SVG carries `data-text` on its glyphs, but only for the
    alphabetical listing — 75 digit glyphs in the whole floor-plan region,
    against the thousands a lookup would need.
  * Clustering the digit outlines by shape to decode them is not reliable: the
    same digit varies in path point count (`0` renders as both 110 and 118
    points, `6` as 146/156/158, `8` as 184/186). A decoder on that footing
    mislabels booths *silently*, which is worse than no decoder — it would put
    a pin on a confidently wrong booth.

What IS solid is the booth geometry. Cell outlines survive as vector curves, so
once you know roughly where a booth is, its cell can be found exactly and its
centre taken. Calibration against the two hand-picked pins that predate this
tool confirms centre-of-cell is the convention they follow: Warhammer #2411
lands 0.0036 from its cell centre, Artovision #2641 within 0.008.

So the human still identifies the booth (which honours the standing "CC does
not guess coords" rule in the change log); the mechanical parts — locating the
cell, computing the centre, proving the pin lands right — are automated.

WORKFLOW
--------
    # 1. Render a labelled grid over a region to find the booth by eye.
    #    Args are PDF points; the whole page is 0 0 1170 801.
    python data/2026/_booth_coords.py grid 195 140 340 480

    # 2. Read the booth's approximate normalized x/y off that grid, then snap
    #    to the exact centre of the cell containing it.
    python data/2026/_booth_coords.py snap 0.2067 0.2890

    # 3. Paste into vendor-favorites.json, then prove every pin sits on the
    #    booth it claims. This step is not optional — it is the whole check.
    python data/2026/_booth_coords.py verify

Renders land in `test/screenshots/booth-coords/` (gitignored).

A vendor holding several booths needs one entry per booth with a DISTINCT id
(`ultra-pro-701`, `ultra-pro-2401`) — `vendor-favorites.json` has a singular
`booth`, and `/vendors/` keys `pinsById`/`cardsById` by id, so a shared id
silently overwrites the first pin and breaks pin<->card selection.
"""
import json
import os
import sys

import fitz

PDF_PATH = r'data/2026/source/2026.exhibithallmap.pdf'
FAVORITES = r'data/2026/vendor-favorites.json'
OUT_DIR = r'test/screenshots/booth-coords'
PAGE_W, PAGE_H = 1170.0, 801.0

# A booth cell is roughly 24pt on its short side; the bounds below keep aisle
# rules and hall-sized outlines from being mistaken for one.
MIN_SIDE, MAX_SIDE = 5.0, 200.0


def _page():
    if not os.path.exists(PDF_PATH):
        sys.exit(f'{PDF_PATH} not found — it is gitignored; restore it locally first.')
    return fitz.open(PDF_PATH)[0]


def _outdir():
    os.makedirs(OUT_DIR, exist_ok=True)
    return OUT_DIR


def _cells(page):
    """Booth-sized closed outlines, as (x0, y0, x1, y1) in PDF points."""
    out = []
    for d in page.get_drawings():
        r = d['rect']
        if MIN_SIDE < r.width < MAX_SIDE and MIN_SIDE < r.height < MAX_SIDE:
            out.append((r.x0, r.y0, r.x1, r.y1))
    return out


def cmd_grid(x0, y0, x1, y1, dpi=300):
    """Render a region with a normalized-coordinate grid drawn over it."""
    x0, y0, x1, y1 = float(x0), float(y0), float(x1), float(y1)
    dpi = int(dpi)
    page = _page()

    step_x, step_y = PAGE_W * 0.01, PAGE_H * 0.01
    shape = page.new_shape()
    for i in range(int(x0 / step_x), int(x1 / step_x) + 1):
        shape.draw_line(fitz.Point(i * step_x, y0), fitz.Point(i * step_x, y1))
        shape.finish(color=(1, 0, 0) if i % 5 == 0 else (0, .6, 1),
                     width=.7 if i % 5 == 0 else .25)
    for j in range(int(y0 / step_y), int(y1 / step_y) + 1):
        shape.draw_line(fitz.Point(x0, j * step_y), fitz.Point(x1, j * step_y))
        shape.finish(color=(1, 0, 0) if j % 5 == 0 else (0, .6, 1),
                     width=.7 if j % 5 == 0 else .25)
    shape.commit()

    for i in range(int(x0 / step_x), int(x1 / step_x) + 1):
        if i % 5 == 0:
            page.insert_text(fitz.Point(i * step_x + 1, y0 + 7),
                             f'{i / 100:.2f}', fontsize=5, color=(1, 0, 0))
    for j in range(int(y0 / step_y), int(y1 / step_y) + 1):
        if j % 5 == 0:
            page.insert_text(fitz.Point(x0 + 1, j * step_y - 1),
                             f'{j / 100:.2f}', fontsize=5, color=(1, 0, 0))

    path = f'{_outdir()}/grid.png'
    page.get_pixmap(clip=fitz.Rect(x0, y0, x1, y1), dpi=dpi).save(path)
    print(f'wrote {path}')
    print(f'  region: pdf ({x0},{y0})-({x1},{y1})')
    print(f'  normalized: x {x0 / PAGE_W:.4f}-{x1 / PAGE_W:.4f}  '
          f'y {y0 / PAGE_H:.4f}-{y1 / PAGE_H:.4f}')
    print('  read the booth\'s approximate x/y off the red 0.05 gridlines, '
          'then run: snap <x> <y>')


def cmd_snap(nx, ny):
    """Snap an approximate normalized point to the centre of its booth cell."""
    nx, ny = float(nx), float(ny)
    px, py = nx * PAGE_W, ny * PAGE_H
    hits = [c for c in _cells(_page())
            if c[0] - 1 <= px <= c[2] + 1 and c[1] - 1 <= py <= c[3] + 1]
    if not hits:
        sys.exit(f'no booth cell contains ({nx}, {ny}) — re-read it off `grid`.')
    hits.sort(key=lambda c: (c[2] - c[0]) * (c[3] - c[1]))
    x0, y0, x1, y1 = hits[0]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    print(f'cell: ({x0:.1f},{y0:.1f})-({x1:.1f},{y1:.1f})  '
          f'{x1 - x0:.1f} x {y1 - y0:.1f} pt')
    if len(hits) > 1:
        print(f'      ({len(hits) - 1} larger cell(s) also contain this point; '
              f'smallest used)')
    print(f'  "x": {cx / PAGE_W:.4f}, "y": {cy / PAGE_H:.4f}')
    print('  now add to vendor-favorites.json and run: verify')


def cmd_verify():
    """Draw every favorites pin on the map and crop around each, to eyeball."""
    page = _page()
    with open(FAVORITES, encoding='utf-8') as f:
        vendors = json.load(f)['vendors']

    pins = [v for v in vendors
            if isinstance(v.get('x'), (int, float))
            and isinstance(v.get('y'), (int, float))]
    for v in pins:
        c = fitz.Point(v['x'] * PAGE_W, v['y'] * PAGE_H)
        page.draw_circle(c, 7, color=(1, 0, 0), width=1.4)
        page.draw_circle(c, 2, color=(1, 0, 0), fill=(1, 0, 0))

    d = _outdir()
    for v in pins:
        cx, cy = v['x'] * PAGE_W, v['y'] * PAGE_H
        clip = fitz.Rect(cx - 55, cy - 40, cx + 55, cy + 40)
        path = f'{d}/pin-{v["booth"]}-{v["id"]}.png'
        page.get_pixmap(clip=clip, dpi=420).save(path)
        print(f'  {v["booth"]:>5}  {v["name"]}  -> {path}')

    skipped = len(vendors) - len(pins)
    print(f'\n{len(pins)} pin(s) rendered in {d}'
          + (f'; {skipped} skipped (non-numeric x/y)' if skipped else ''))
    print('LOOK AT EACH ONE: the dot must sit inside the cell printed with that '
          'booth number. Counts and JSON validity cannot catch a right-shaped '
          'pin on the wrong booth.')


COMMANDS = {'grid': cmd_grid, 'snap': cmd_snap, 'verify': cmd_verify}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    try:
        COMMANDS[sys.argv[1]](*sys.argv[2:])
    except TypeError:
        sys.exit(f'bad arguments for `{sys.argv[1]}` — see:\n{__doc__}')


if __name__ == '__main__':
    main()
