# GenCon Map

A shareable Gen Con Indy companion site, designed for at-the-con use — pull it up on your phone in the convention center to see what's next, where it is, and what you're looking for on the exhibit hall floor. No frameworks, no build step, no backend: static HTML pages that load their data from JSON.

Live at **[gencon.skoz.org](https://gencon.skoz.org)**.

## Pages

| Path | What it is |
|---|---|
| `/` | Schedule + interactive venue map. Event cards grouped by day, Leaflet map of downtown Indianapolis venues. |
| `/vendors/` | Exhibit hall floor plan with pinned vendor favorites. Tap a pin or a favorites card to select it; the two stay in sync. |
| `/td/` | Searchable True Dungeon token list — two owners' collections, with filters for owner, slot, classification, character class and rarity, plus a rarity sort and a slot-reference chart. |

Each page is standalone and shares only the nav and `style.css`.

## Stack

- **Frontend:** Vanilla HTML/CSS/JS. Each page is a single `index.html` with an inline `<script type="module">`. The one extracted module is `js/time.js` (pure time logic, imported by the schedule page).
- **Map:** [Leaflet](https://leafletjs.com/) 1.9.4 from the unpkg CDN with OpenStreetMap tiles — **on the schedule page only**. The vendor floor plan is an inline SVG with no map library, and `/td/` has no map at all. Leaflet is the site's only external runtime dependency; everything else is self-hosted.
- **Styles:** `style.css` — mobile-first, no CSS framework.
- **Data:** Static JSON under `data/YYYY/`, fetched on page load.
- **Hosting:** AWS Amplify — GitHub-connected, auto-deploys on push to `main`.
- **DNS:** Cloudflare — CNAME to the Amplify-generated domain.

`package.json` exists **only** for the `test/` dev harness (Puppeteer). It is not a build step and contributes nothing to the deployed site — what ships is exactly what's in the repo.

## Data

Everything lives under `data/YYYY/`:

| File | Feeds |
|---|---|
| `events.json` | schedule cards on `/` |
| `venues.json` | Leaflet markers on `/` |
| `vendors.json` | full exhibit-hall vendor index, extracted from Gen Con's published map PDF |
| `vendor-favorites.json` | the subset actually pinned on `/vendors/` |
| `td-tokens.json` | token records for `/td/` |
| `floor-plans/*.svg` | exhibit hall floor plan |

Token art for `/td/` lives in `td/images/` (full size) and `td/images/thumbs/` (240×240 WebP).

Scripts prefixed with `_` are build-time tooling, committed for reproducibility and never loaded by the site: `data/YYYY/_extract.py` (vendor index from the map PDF), `data/YYYY/_svg_floorplan.py`, and the `td/_*.mjs` / `_*.py` scrape → match → merge → thumbnail pipeline.

`vendors.json` is the complete extracted catalog; `/vendors/` deliberately ships favorites-only, with catalog browsing and search out of scope.

## Local Dev

Serve over HTTP. Opening a page via `file://` breaks both the `fetch()` calls **and** the `js/time.js` module import.

```bash
npm install          # only needed for the test harness
npm run serve        # node test/serve.mjs — repo root on http://localhost:8080
```

`test/serve.mjs` has no dependencies of its own, so it runs without `npm install` if you only need the server.

## Verification

`test/` holds the persistent verification harness — see [test/README.md](test/README.md).

```bash
npm run test:time                       # pure time logic
npm run test:viewport -- --width 375    # true-viewport headless Chrome
npm run test:viewport -- --width 1280
```

`viewport.mjs` uses Puppeteer's `setViewport` plus CDP device-metrics emulation rather than Chrome's `--window-size`, which does not produce a true mobile viewport. Extend these scripts rather than writing one-off checks.

## Deploy

Push to `main` — Amplify auto-deploys to **gencon.skoz.org** (~1 min build).

```bash
git add . && git commit -m "describe your change" && git push origin main
```

## Year-over-Year

Each convention year gets its own dataset directory under `data/YYYY/`. The active year is the `YEAR` constant near the top of each page's inline script (`index.html`, `vendors/index.html`, `td/index.html`). Past years stay in the repo as an archive — year datasets are append-only.

## Dev Tools

**📍 Pick coords** (in the 🧪 panel on `/`): when enabled, every map click logs the clicked `{ lat, lng }` to the console for copy-paste into `venues.json`. It ships permanently as a dev tool for filling in venue and per-room pins over time, and is hidden on mobile along with the rest of the 🧪 panel.

## Attribution

- Token data and images on `/td/` come from **[tokendb.com](https://tokendb.com)**. Each token links back to its source page.
- The slot-reference chart on `/td/` is True Dungeon's Character Equipping Mat, courtesy of **[truedungeon.com](https://truedungeon.com/welcome)**.
- Map tiles on `/` are **OpenStreetMap**.

This is a personal, non-commercial project and is not affiliated with Gen Con, True Dungeon, or tokendb.

## License

MIT — see [LICENSE](LICENSE).
