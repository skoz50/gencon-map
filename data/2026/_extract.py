"""Extract vendor index + sponsors from 2026 Gen Con exhibit map PDF."""
import pdfplumber
import re
import json
from datetime import date

PDF_PATH = r'data/2026/source/2026.exhibithallmap.pdf'
OUT_PATH = r'data/2026/vendors.json'

# Alphabetical listing box: (27.45, 466.019) to (1138.441, 775.369).
# Column left edges nudged 2px left of each column's observed word-start
# minimum — cropping exactly at the min clips the first glyph of names that
# start flush left (pdfplumber drops chars that aren't fully inside the box).
LISTING_TOP = 466
LISTING_BOTTOM = 775
col_edges = [32, 110, 189, 268, 347, 426, 505, 584, 663, 742, 821, 900, 978, 1057, 1132]

BOOTH_NUM = re.compile(r'\d{3,4}')
SKIP_LINES = {
    'EXHIBIT', 'HALL', 'ENTRANCE', 'EXHIBIT HALL ENTRANCE', 'EXHIBIT HALL EN', 'RANCE',
}


def clean_line(s):
    # Normalize apostrophes/quote glyphs to ASCII apostrophe for searchability.
    # U+FFFD appears in some rows where pdfplumber couldn't decode the original
    # apostrophe glyph; accented characters (e.g. e in Pokemon) are preserved.
    return s.replace('�', "'").replace('’', "'").replace('‘', "'").rstrip()


def has_terminal_booth(line):
    return bool(re.search(r'\d{3,4}\s*$', line.rstrip()))


def ends_with_comma(line):
    return line.rstrip().endswith(',')


def is_pure_booth_continuation(line):
    s = line.strip()
    return bool(s) and bool(re.match(r'^[\d,\s]+$', s)) and bool(re.search(r'\d', s))


def parse_entry(text):
    parts = re.split(r'\.{2,}', text, maxsplit=1)
    if len(parts) == 2:
        name = parts[0].strip()
        rest = parts[1].strip()
    else:
        m2 = re.search(r'\d{3,4}', text)
        if m2:
            name = text[:m2.start()].rstrip(' ,').strip()
            rest = text[m2.start():]
        else:
            name = text.strip()
            rest = ''
    booths = BOOTH_NUM.findall(rest)
    name = re.sub(r'\s+', ' ', name).strip()
    return name, booths


def parse_column(lines):
    entries = []
    buffer = []
    for raw in lines:
        line = clean_line(raw)
        if not line.strip() or line.strip() in SKIP_LINES:
            continue
        if is_pure_booth_continuation(line) and not buffer:
            continue
        buffer.append(line.strip())
        if has_terminal_booth(line) and not ends_with_comma(line):
            name, booths = parse_entry(' '.join(buffer))
            if name and booths:
                entries.append((name, booths))
            buffer = []
        elif is_pure_booth_continuation(line) and not ends_with_comma(line):
            name, booths = parse_entry(' '.join(buffer))
            if name and booths:
                entries.append((name, booths))
            buffer = []
    if buffer:
        name, booths = parse_entry(' '.join(buffer))
        if name and booths:
            entries.append((name, booths))
    return entries


# Two rows in this PDF have an inline vendor logo image that scrambles
# character order within the cell, breaking parse_entry beyond what regex
# cleanup can recover. Ground truth cross-checked against the raw
# page.extract_text() dump for those rows. Fix in place rather than skip, so
# a fresh run doesn't silently drop or mis-book these vendors.
KNOWN_CORRECTIONS = {
    'izommbpie-osurrvtivaal-ninftec-itinon-f': {
        'name': 'Zombie: Survival Infection', 'booths': ['2659'],
    },
}
KNOWN_MISSING = [
    # Dropped entirely: parse_entry found no 3-4 digit run in the garbled
    # text, so the `if name and booths` filter silently discarded it.
    {'name': 'Bad Crow Games', 'booths': ['2858'], 'after_id': 'bad-cat-media'},
]


def apply_known_corrections(vendors):
    for v in vendors:
        fix = KNOWN_CORRECTIONS.get(v['id'])
        if fix:
            v['id'] = make_id(fix['name'])
            v['name'] = fix['name']
            v['booths'] = fix['booths']
    ids = {v['id'] for v in vendors}
    for missing in KNOWN_MISSING:
        new_id = make_id(missing['name'])
        if new_id in ids:
            continue
        idx = next((i for i, v in enumerate(vendors) if v['id'] == missing['after_id']), len(vendors))
        vendors.insert(idx, {'id': new_id, 'name': missing['name'], 'booths': missing['booths']})


def make_id(name):
    s = name.lower()
    s = re.sub(r"['’]", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


# Co-sponsor / off-hall table sits above the alphabetical listing box, roughly
# (740, 85) to (1152, 200) — three name/location pairs are crammed per raw
# line, so we scan for known location tokens rather than splitting on columns.
LOC_RE = re.compile(
    r'(ICC\s+Sagamore\s+\d+(?:-\d+)?'
    r'|ICC\s+Halls?[,\s]+[A-Z](?:\s*&\s*[A-Z])?'
    r'|ICC\s+Hall\s+[A-Z]'
    r'|ICC\s+\d{3}(?:\s*&\s*\d{3})?'
    r'|Stadium\s+Field'
    r'|Stadium(?:,\s*West\s+Club\s+Lounge)?'
    r'|West\s+Club\s+Lounge'
    r'|Wabash\s+Concourse'
    r'|Booth\s*#\d+)'
)


def parse_sponsors(page):
    box = page.within_bbox((740, 85, 1152, 200))
    text = box.extract_text(layout=False) or ''
    off_hall = []
    current = None
    for raw in text.split('\n'):
        line = clean_line(raw)
        s = line.strip()
        if not s or 'Co-Sponsors' in s or 'Sponsor Locations' in s:
            continue
        pos = 0
        for m in LOC_RE.finditer(s):
            name = s[pos:m.start()]
            name = re.sub(r'\.{2,}', '', name).strip(' ,.')
            loc = re.sub(r'\s+', ' ', m.group(1)).strip()
            if name:
                current = {'name': name, 'locations': [loc]}
                off_hall.append(current)
            elif current is not None:
                # Bare comma/whitespace before this match — another location
                # for the sponsor a line/entry above (e.g. "Asmodee ...ICC
                # 233, ICC Hall E" wraps its 2nd+ location onto its own match).
                current['locations'].append(loc)
            pos = m.end()
    return off_hall


def main():
    pdf = pdfplumber.open(PDF_PATH)
    page = pdf.pages[0]

    columns_lines = []
    for i in range(len(col_edges) - 1):
        # +3 on the right: within_bbox drops any glyph not fully inside the
        # box, and some rows' trailing booth digit sits close enough to the
        # nominal column boundary to get clipped otherwise (e.g. "2461" -> "246").
        right = col_edges[i + 1] + 3
        cropped = page.within_bbox((col_edges[i], LISTING_TOP, right, LISTING_BOTTOM))
        columns_lines.append((cropped.extract_text(layout=False) or '').split('\n'))

    all_entries = []
    for lines in columns_lines:
        all_entries.extend(parse_column(lines))

    seen_ids = {}
    vendors = []
    for name, booths in all_entries:
        base_id = make_id(name) or 'unnamed'
        new_id = base_id
        n = 2
        while new_id in seen_ids:
            new_id = f'{base_id}-{n}'
            n += 1
        seen_ids[new_id] = True
        vendors.append({'id': new_id, 'name': name, 'booths': booths})

    apply_known_corrections(vendors)

    off_hall = parse_sponsors(page)

    output = {
        'year': 2026,
        'source': 'GenCon 2026 official exhibit hall map (Indianapolis Convention Center)',
        'extracted': date.today().isoformat(),
        'vendors': vendors,
        'off_hall_sponsors': off_hall,
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Validation
    print(f'Vendors: {len(vendors)}')
    print(f'Off-hall sponsors: {len(off_hall)}')
    ids = [v['id'] for v in vendors]
    print(f'Unique IDs: {len(set(ids))} (must equal {len(vendors)})')
    empty = [v for v in vendors if not v['booths']]
    print(f'Empty booths: {len(empty)}')
    for v in empty:
        print(f'  MISSING BOOTH: {v}')
    multi = [v for v in vendors if len(v['booths']) > 1]
    print(f'Multi-booth vendors: {len(multi)}')

    print('\nSpot-check known vendors:')
    for nm in ['Brotherwise Games, LLC', 'Q-Workshop', 'Asmodee', 'Paizo', 'Wizards of the Coast']:
        match = next((v for v in vendors if v['name'] == nm), None)
        print(f'  {nm!r}: {match}')

    print('\nAll off-hall sponsors:')
    for s in off_hall:
        print(f'  {s}')

    pdf.close()


if __name__ == '__main__':
    main()
