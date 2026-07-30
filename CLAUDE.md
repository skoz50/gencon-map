# GenCon Map — Claude Code Context

## Project Overview
A shareable **Gen Con Indy companion site**, deployed at **gencon.skoz.org**.
Designed for at-the-con use: pull it up on your phone to see what's next, where it is, and what you're hunting for on the exhibit hall floor.
Three standalone static pages that load their data from JSON. No frameworks, no backend, no build step.

| Path | Page | Data it loads |
|---|---|---|
| `/` | Schedule + Leaflet venue map, now/next card, walking times | `events.json`, `venues.json` |
| `/vendors/` | Exhibit hall SVG floor plan with pinned vendor favorites | `vendor-favorites.json`, `floor-plans/*.svg` |
| `/td/` | Searchable True Dungeon token list, two owners | `td-tokens.json` |

The pages share only the nav and `style.css` — no shared script.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS — each page is an `index.html` with its own inline `<script type="module">`; pure time logic extracted to `js/time.js` (ES module, imported by the schedule page only). No framework.
- **Styles:** `style.css` — minimal, mobile-first, no framework. Shared by all three pages.
- **Map:** [Leaflet](https://leafletjs.com/) 1.9.4 from the **unpkg CDN**, OpenStreetMap tiles — **on `/` only.** `/vendors/` is an inline SVG floor plan with no map library; `/td/` has no map. The Leaflet CDN import is the one external runtime dependency — everything else is self-hosted.
- **Data:** Static JSON under `data/YYYY/`, fetched on page load
- **Hosting:** AWS Amplify — GitHub-connected, auto-deploys on push to `main`
- **DNS:** Cloudflare — CNAME pointing to the Amplify-generated domain
- **Repo:** https://github.com/skoz50/gencon-map
- **Status:** 🟢 live at gencon.skoz.org — 11 events / 3 venues, 583 extracted vendors (8 pinned), 181 TD tokens

## File Structure
```
gencon-map/
├── CLAUDE.md          ← you are here
├── LICENSE            ← MIT (GenCon Map Contributors)
├── README.md          ← public-facing project description
├── .gitignore
├── package.json       ← dev tooling only (test harness); no build step
├── index.html         ← schedule page: header, schedule, Leaflet map, 🧪 panel
├── style.css          ← mobile-first layout, shared by all three pages
├── favicon.svg        ← die mark; linked root-absolute from all three pages
├── apple-touch-icon.png  ← iOS home screen; generated, do not hand-edit
├── _generate_favicon.py  ← regenerates the PNG from the same geometry
├── js/
│   └── time.js        ← pure time logic (ES module, imported by index.html)
├── vendors/
│   └── index.html     ← exhibit hall floor plan + pinned vendor favorites
├── td/
│   ├── index.html     ← True Dungeon token list (filters, sort, detail dialog)
│   ├── images/           ← token art; thumbs/ holds 240×240 WebP
│   ├── match-overrides.json  ← human-confirmed name→slug resolutions
│   ├── match-report.json     ← matcher output; merge refuses to run if dirty
│   ├── _scrape_tokendb.mjs   ← build-time pipeline, not loaded by the site
│   ├── _match_tokendb.mjs
│   ├── _merge_tokendb.mjs
│   └── _generate_thumbnails.py
├── test/              ← verification harness — see test/README.md
│   ├── serve.mjs         ← static server (node: builtins only, no deps)
│   ├── viewport.mjs      ← headless-Chrome viewport checks (Puppeteer)
│   └── time-logic.mjs    ← Node harness for js/time.js
└── data/
    └── 2026/
        ├── events.json           ← schedule entries
        ├── venues.json           ← buildings, per-room pins, walking times
        ├── vendors.json          ← full extracted exhibit-hall index (583)
        ├── vendor-favorites.json ← the subset actually pinned on /vendors/
        ├── td-tokens.json        ← TD token records
        ├── floor-plans/          ← icc-exhibit-hall.svg
        ├── _extract.py           ← vendor index from Gen Con's map PDF
        ├── _svg_floorplan.py
        ├── _booth_coords.py      ← booth → pin coords, PDF backend (see "Adding a vendor pin")
        └── _booth_coords.mjs     ← same commands, SVG backend — works without the PDF
```

Gitignored local research inputs: `_scratch/` (photos feeding token ingest),
`data/YYYY/source/` (map PDFs), `td/tokendb-catalog.json` (7.1 MiB, 3,807
tokens) and `td/_tokendb_cache/` (~104 MiB raw HTML). The site ships only our
own subset.

## How It Works
- The active year is the `YEAR` constant near the top of **each** page's inline script — `index.html`, `vendors/index.html`, `td/index.html`. All three must be bumped together.
- **`/`** initializes a Leaflet map on downtown Indianapolis (`39.7639, -86.1639`, zoom 16), then `fetch()`es `events.json` + `venues.json` in parallel. Event cards group by day; clicking one pans the map to that event's room pin. A now/next card recomputes from wall-clock time and highlights the matching cards, including walking time to the next venue.
- **`/vendors/`** inlines the exhibit-hall SVG and pins the vendors in `vendor-favorites.json`. Pin clicks and favorites-card clicks select each other; only the card click pans/zooms.
- **`/td/`** fetches `td-tokens.json` and renders a filterable card grid (owner, slot, classification, character class, rarity, keepers-only, search) with a rarity sort and a detail dialog.

## Data Shapes

Read these off the JSON, not from memory — the shapes below are the real ones.

**`events.json`** — `{ "events": [...] }`, each:
`{ id, title, system, start, end, duration_hr, venue_id, room, gencon_url }`
`start`/`end` are **full ISO timestamps with an explicit offset** (`2026-07-30T15:00:00-04:00`) — there is no separate `day` field; the day is derived in `js/time.js`. `venue_id` is a foreign key into `venues.json`, and `room` keys into that venue's `rooms` map.

**`venues.json`** — `{ "venues": [...] }`, each:
`{ id, building, entrance, lat, lng, address, walking_times, rooms }`
The display name is **`building`**, not `name`. `rooms` maps a room label to `{ floor, wing, lat, lng }` for per-room pins. `walking_times` maps another venue's `id` to either a number of minutes or `{ minutes, note }`. Venues need numeric `lat`/`lng` or the marker is skipped.

**`vendor-favorites.json`** — `{ "vendors": [...] }`, each:
`{ id, name, booth, x, y }`
`x`/`y` are **normalized 0–1 coordinates** on the floor-plan SVG, not lat/lng — this page has no map projection. `booth` is a single string here.

**`vendors.json`** — `{ year, source, extracted, vendors: [...], off_hall_sponsors: [...] }`, each vendor:
`{ id, name, booths }`
Note `booths` is an **array** (a vendor can hold several) — different from the favorites file's singular `booth`, and it carries no `x`/`y`. This is the full extracted catalog and is **not loaded by any page**; `_extract.py` regenerates it from the map PDF.

**`td-tokens.json`** — `{ source, enrichedFrom, enrichedAt, tokens: [...] }`, each:
`{ name, category, owners, notes, why, slot, rarity, usable_by, years, source, classification, flavor, text_on_token, tokendb_url, tokendb_slug, tokendb_name, image_path, thumb_path }`
`owners` is a per-person map — `{ "skoz": { qty, keeper, keeperQty, tradeQty }, "nesamun": { qty } }`. Only `qty` is guaranteed; the keeper/trade split is optional and currently skoz-only. **`name` is the de-facto primary key of the whole token pipeline** and must stay unique — the matcher reports on it and the merge does `matchByName.get(t.name)`. `notes`/`why` are our curation; everything from `slot` onward is tokendb's, written through verbatim.

## Adding a vendor pin to `/vendors/`

**Use the `_booth_coords` tool. Do not re-derive this from scratch — two
sessions already have.**

There are two interchangeable backends, same commands and same output:

```bash
# SVG backend — prefer this. Reads the committed floor-plan SVG, so it needs
# no source PDF and no Python deps; only the Puppeteer devDependency.
node data/2026/_booth_coords.mjs grid 195 140 340 480   # find the booth by eye
node data/2026/_booth_coords.mjs snap 0.2067 0.2890     # -> exact cell centre
node data/2026/_booth_coords.mjs verify                 # prove every pin lands right

# PDF backend — same three commands, but requires the gitignored
# data/2026/source/2026.exhibithallmap.pdf plus PyMuPDF.
python data/2026/_booth_coords.py grid 195 140 340 480
```

Both read the same `0 0 1170 801` coordinate space (the SVG was exported from
that PDF), so they agree: the pins the PDF tool generated snap back
bit-identical under the SVG tool. **Reach for the `.mjs` first** — on a fresh
clone the PDF is absent, which is exactly what stalled the Dragonsteel add.

`grid` renders a region of the map with a labelled normalized-coordinate grid;
read the booth's rough x/y off it. `snap` turns that into the exact centre of
the booth's cell — **centre of cell is the convention**, not the number label
(the two hand-picked pins that predate the tool sit 0.0036 and 0.008 from their
cell centres). `verify` draws every pin in `vendor-favorites.json` and crops
around it. Renders go to `test/screenshots/booth-coords/` (gitignored).

**The `verify` eyeball is the actual check** — same lesson as `/td/` in the
Verification section. Counts and JSON validity pass just as happily with a pin
on the wrong booth.

Why the human stays in the loop: the change log records a standing **"CC does
not guess coords"** rule, and the 📍 Pick-coords dev tool that used to serve
this was removed in `7d379dd`. The tool automates the mechanical parts and
leaves booth identification to a person.

**Don't retry these — they're dead ends, documented at length in the script:**
booth numbers are vector outlines, so `page.chars` has *zero* digits in the
floor-plan area; the SVG's `data-text` only covers the alphabetical listing;
and decoding the digit outlines by shape is unreliable (the same digit varies
in point count), so it mislabels booths silently. `data/2019-prototype/_floor_spike.py`
looks like it solves this but does not — the *2019* PDF keeps booth numbers as
real text, and the 2026 one does not.

One entry per booth, each with a **distinct `id`** (`ultra-pro-701`,
`ultra-pro-2401`) — `vendor-favorites.json` has a singular `booth`, and
`/vendors/` keys `pinsById`/`cardsById` by id, so a shared id silently
overwrites the first pin and breaks pin↔card selection.

## Coding Conventions
- **No frameworks, no build step, no runtime dependencies.** Vanilla only. Leaflet comes from the CDN; the site ships exactly what's in the repo. `package.json` exists solely for the `test/` dev harness (Puppeteer) — it is *not* a build step and adds nothing to the deployed site.
- **JS lives in each page's inline `<script type="module">`**, except **pure time logic**, which lives in `js/time.js` and is imported by `index.html`. Keep DOM/render/map code inline; only side-effect-free time helpers belong in `js/time.js`. Do not split further, and do not introduce a shared script across pages, without reason.
- **Scripts prefixed with `_` are build-time tooling** (`data/YYYY/_extract.py`, `td/_*.mjs`, `td/_generate_thumbnails.py`). They are committed for reproducibility and never loaded by the site. Re-run them deliberately; don't wire them into page load.
- **Mobile-first.** The site must work on a phone in a convention center. Schedule stacks above the map on narrow viewports; side-by-side at ≥768px.
- **Always serve via localhost, never `file://`.** The `fetch()` calls for the JSON datasets *and* the `js/time.js` module import both fail under `file://`. Run `node test/serve.mjs` (serves the repo root on :8080).
- **Year datasets are append-only.** New convention years get a new `data/YYYY/` directory; past years stay as an archive.

## Deploy Process
```bash
# After any changes:
git add . && git commit -m "describe your change" && git push origin main
# Amplify auto-deploys on push to main — ~1 min build time
# Verify at gencon.skoz.org
```

After each push completes, log the change via the `vault-cc-inbox` skill — writes an entry to `_CC Inbox/GenCon Map - Change Log.md` in the Obsidian vault for later curator triage.

### Mac path
```bash
cd ~/ClaudeCode/gencon-map && claude
```

## Verification — use `test/` instead of rebuilding harnesses

Before pushing any change, run the relevant harnesses in `test/`. Do not rebuild ad-hoc Chrome-headless scripts or Node TZ test stubs each session — `test/` already has them, and they encode hard-won patterns (CDP viewport emulation, TZ drift detection, run-ID-keyed artifacts).

- Time-logic changes → `node test/time-logic.mjs`
- CSS / layout changes → `node test/serve.mjs` + `node test/viewport.mjs --width 375` + `--width 1280`
- Pre-push full check → all three, plus a live browser eyeball on the desktop dev box

`viewport.mjs` defaults to the schedule page and gates `--exec` on `.event-card`. For the other two pages pass an explicit URL **and** a settle selector, or it will wait on a card that never renders:

```bash
node test/viewport.mjs --width 375 --serve --url http://localhost:8080/td/ --wait-for .td-card --no-overflow
```

**The eyeball step is not ceremonial.** On 2026-07-26 every assertion passed — counts and DOM were correct — while `/td/` rendered "Trade 2" and "Has 1" for two different owners with nothing distinguishing them. Two states being *correct but visually indistinguishable* is not a testable invariant; that one only fails to a human looking at the grid.

See `test/README.md` for the full reference and known gotchas (notably: never use Chrome `--window-size` for mobile viewport testing; use Puppeteer's `setViewport` + CDP `Emulation.setDeviceMetricsOverride` — `viewport.mjs` already does this).

If a verification need isn't covered by the existing harnesses, **extend them** rather than building a one-off. Add a preset to `time-logic.mjs`, add a flag to `viewport.mjs`. The point of `test/` is that it accretes — the harness gets more useful with each pass, not less.

## Backlog

### Shipped
- [x] AWS Amplify hookup + Cloudflare DNS — live at gencon.skoz.org
- [x] Populate `data/2026/events.json`, real lat/lng + per-room pins in `venues.json`
- [x] Event-card → map pan (click a card, map pans to its room pin)
- [x] Current-event highlight + now/next card from wall-clock time
- [x] Walking-time estimates between venues (`walking_times` in `venues.json`)
- [x] Vendor floor plan with pinned favorites
- [x] TD token list: filters, rarity sort, slot legend, multi-owner support

### Open
- [ ] Filter/search the schedule on `/` — the only original v1 feature not built. `/td/` has a full filter surface that could be a model.
- [ ] `/vendors/` ships favorites-only by design; catalog browsing + search over all 583 vendors is deliberately out of scope until asked for.
- [ ] Watermark: every tokendb image carries a visible SAMPLE mark. Shipping as-is was a deliberate call — post-trip trigger to revisit is in `_design - TD token database`.

## Owner
Brandon (skoz) — gencon.skoz.org
Related project: stopthepwnage.com (same vanilla / Amplify + Cloudflare stack)
