"""Convert the 2026 exhibit-map PDF's floor plan into a scalable SVG.

The PDF's floor-plan grid (booth outlines + the ~4,866 booth-number labels)
is genuine vector data, so it renders crisply at any zoom -- unlike the
JPEG snapshot this replaces, which pixelates once the page's pan/zoom
controller scales past its native resolution.

Embedded vendor-logo images are stripped, not kept: PyMuPDF's SVG export
flattens their soft-masks/alpha into plain PNG/JPEG, and the resulting
mask/image pairing renders with a solid black box over part of the logo in
real browsers (confirmed via a Puppeteer/Chrome screenshot, not just this
script's own render) -- a defect, not a style choice. Stripping the <image>
tags entirely (rather than trying to fix the mask) leaves a clean blank
booth cell with the number still crisp, and incidentally cuts gzip size
roughly in half (~1.25MB -> ~700KB).
"""
import re
import fitz

PDF_PATH = r'data/2026/source/2026.exhibithallmap.pdf'
OUT_PATH = r'data/2026/floor-plans/icc-exhibit-hall.svg'

IMAGE_TAG = re.compile(r'<image\b[^>]*?/>', re.DOTALL)


def main():
    doc = fitz.open(PDF_PATH)
    svg = doc[0].get_svg_image()
    doc.close()

    before = len(svg)
    svg, n = IMAGE_TAG.subn('', svg)
    after = len(svg)

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write(svg)

    print(f'Stripped {n} <image> tags ({before - after:,} chars, '
          f'{(before - after) / before * 100:.1f}%)')
    print(f'Wrote {OUT_PATH} ({after:,} chars)')


if __name__ == '__main__':
    main()
