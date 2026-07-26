#!/usr/bin/env python3
"""Generate grid thumbnails for the /td/ token images.

Build-time tool, same category as data/2026/_svg_floorplan.py — not a runtime
dependency. Re-run it when the full-size images under td/images/ change.

    python td/_generate_thumbnails.py            # write thumbs + update thumb_path
    python td/_generate_thumbnails.py --dry-run  # report sizes, write nothing
    python td/_generate_thumbnails.py --force    # re-encode even if up to date

Format is WebP, not JPEG. 97 of the 142 source images carry real transparency,
and the /td/ page uses several different background colors (#fff cards on a
#f4f4f2 body, plus tinted sections) — flattening onto any single color would
bake a visible square halo behind the round token art wherever that guess was
wrong. WebP keeps the alpha channel and is smaller than JPEG at equal quality,
and Pillow encodes it natively, so it costs no extra dependency.

Sizing: measured across all 142 images, the configs that fit both budgets
(every file under 20 KiB, total under 3 MiB) were 200px q80 (1.83 MiB),
220px q80 (2.11 MiB) and 240px q75 (2.09 MiB); 240px q80 and 300px q75 both
blew the per-file ceiling. 240px q75 wins because it costs the same bytes as
220px q80 while carrying more pixels — enough to render crisply up to ~120
CSS px on a 2x phone display, which leaves room for whatever card size the
page settles on. Sources are only 300x300 to begin with, so thumbnails are
downscaled, never upscaled; the full-size originals stay untouched for a
later detail view.
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC_DIR = os.path.join(HERE, "images")
OUT_DIR = os.path.join(SRC_DIR, "thumbs")
DATA_FILE = os.path.join(REPO, "data", "2026", "td-tokens.json")

THUMB_PX = 240        # square; see "Sizing" in the module docstring
QUALITY = 75          # WebP quality
METHOD = 6            # slowest/best WebP compression search
SIZE_BUDGET = 20 * 1024   # per-file target, flagged if exceeded


def load_for_thumbnail(path):
    """Open an image as RGB/RGBA, normalizing the odd modes in this set.

    10 of the sources are CMYK JPEGs, which browsers render with inverted
    colors if passed through; palette images need alpha promoted explicitly.
    """
    im = Image.open(path)
    if im.mode == "CMYK":
        return im.convert("RGB")
    if im.mode == "P":
        return im.convert("RGBA")
    if im.mode in ("RGBA", "LA", "RGB"):
        return im.convert("RGBA") if im.mode == "LA" else im
    return im.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--force", action="store_true", help="re-encode even if the thumb is newer than its source")
    args = ap.parse_args()

    if not os.path.isdir(SRC_DIR):
        sys.exit(f"missing source directory: {SRC_DIR}")
    if not args.dry_run:
        os.makedirs(OUT_DIR, exist_ok=True)

    sources = sorted(
        f for f in os.listdir(SRC_DIR)
        if os.path.isfile(os.path.join(SRC_DIR, f)) and not f.startswith(".")
    )

    written, skipped, oversized = 0, 0, []
    src_bytes, thumb_bytes = 0, 0
    by_slug = {}

    for fname in sources:
        src = os.path.join(SRC_DIR, fname)
        slug = os.path.splitext(fname)[0]
        dest = os.path.join(OUT_DIR, f"{slug}.webp")
        src_bytes += os.path.getsize(src)

        fresh = (
            os.path.exists(dest)
            and os.path.getmtime(dest) >= os.path.getmtime(src)
            and not args.force
        )
        if fresh and not args.dry_run:
            skipped += 1
            thumb_bytes += os.path.getsize(dest)
            by_slug[slug] = f"images/thumbs/{slug}.webp"
            continue

        im = load_for_thumbnail(src)
        if im.size[0] > THUMB_PX:
            im = im.resize((THUMB_PX, THUMB_PX), Image.LANCZOS)

        if args.dry_run:
            import io
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=QUALITY, method=METHOD)
            size = len(buf.getvalue())
        else:
            im.save(dest, "WEBP", quality=QUALITY, method=METHOD)
            size = os.path.getsize(dest)
            written += 1

        thumb_bytes += size
        by_slug[slug] = f"images/thumbs/{slug}.webp"
        if size > SIZE_BUDGET:
            oversized.append((f"{slug}.webp", size))

    print(f"thumbnails: {written} written, {skipped} already current, {len(sources)} total")
    print(f"  {THUMB_PX}x{THUMB_PX} WebP q{QUALITY}")
    print(f"  full-size : {src_bytes / 1024 / 1024:6.2f} MiB")
    print(f"  thumbs    : {thumb_bytes / 1024 / 1024:6.2f} MiB "
          f"({thumb_bytes / src_bytes * 100:.1f}% of full-size, "
          f"avg {thumb_bytes / len(sources) / 1024:.1f} KiB)")
    if oversized:
        print(f"  over {SIZE_BUDGET // 1024} KiB: {len(oversized)}")
        for name, size in sorted(oversized, key=lambda x: -x[1]):
            print(f"    {name}  {size / 1024:.1f} KiB")
    else:
        print(f"  over {SIZE_BUDGET // 1024} KiB: none")

    # Add thumb_path alongside the existing image_path. Nothing else in the
    # token records is touched.
    if args.dry_run:
        print("\n--dry-run: td-tokens.json not modified")
        return

    with open(DATA_FILE, encoding="utf-8") as fh:
        data = json.load(fh)

    updated, missing = 0, []
    for token in data["tokens"]:
        slug = token.get("tokendb_slug")
        thumb = by_slug.get(slug)
        if thumb:
            token["thumb_path"] = thumb
            updated += 1
        else:
            missing.append(token.get("name"))

    with open(DATA_FILE, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"\nthumb_path set on {updated}/{len(data['tokens'])} tokens")
    if missing:
        print(f"  NO THUMBNAIL FOR: {', '.join(missing)}")


if __name__ == "__main__":
    main()
