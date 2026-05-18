# GenCon Map — Claude Code Context

## Project Overview
A shareable **Gen Con Indy schedule + interactive venue map**, deployed at **gencon.skoz.org**.
Designed for at-the-con use: pull it up on your phone to see what's next and where it is.
Single HTML page that loads its schedule and venues from static JSON. No frameworks, no backend, no build step.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS — `index.html` with an inline `<script type="module">`; pure time logic extracted to `js/time.js` (ES module). No framework.
- **Styles:** `style.css` — minimal, mobile-first, no framework
- **Map:** [Leaflet](https://leafletjs.com/) 1.9.4 from the **unpkg CDN**, OpenStreetMap tiles. The Leaflet CDN import is the one external dependency — everything else is self-hosted.
- **Data:** Static JSON under `data/YYYY/` — `events.json` and `venues.json`, fetched on page load
- **Hosting:** AWS Amplify — GitHub-connected, auto-deploys on push to `main`
- **DNS:** Cloudflare — CNAME pointing to the Amplify-generated domain
- **Repo:** https://github.com/skoz50/gencon-map
- **Status:** 🟡 v0 scaffolding — empty 2026 dataset, no real event data yet

## File Structure
```
gencon-map/
├── CLAUDE.md          ← you are here
├── LICENSE            ← MIT (GenCon Map Contributors)
├── README.md          ← public-facing project description
├── .gitignore
├── package.json       ← dev tooling only (test harness); no build step
├── index.html         ← single-page shell: header, schedule, map, fetch-on-load
├── style.css          ← mobile-first layout (stacked narrow, side-by-side wide)
├── js/
│   └── time.js        ← pure time logic (ES module, imported by index.html)
├── test/              ← verification harness — see test/README.md
│   ├── serve.mjs         ← static server
│   ├── viewport.mjs      ← headless-Chrome viewport checks (Puppeteer)
│   └── time-logic.mjs    ← Node harness for js/time.js
└── data/
    └── 2026/
        ├── events.json   ← { "events": [] } — schedule entries
        └── venues.json   ← { "venues": [] } — map markers
```

## How It Works
- `index.html` initializes a Leaflet map centered on downtown Indianapolis (`39.7639, -86.1639`, zoom 16).
- On load it `fetch()`es `data/2026/events.json` and `data/2026/venues.json` in parallel.
- `renderVenues()` drops a marker per venue with a popup (name + description).
- `renderEvents()` builds event cards grouped by day; empty data shows an empty-state message.
- The active year is the `YEAR` constant near the top of the inline script.

## Data Shapes
**`events.json`** — each event: `{ "title", "day", "start", "end", "venue", "description" }`
**`venues.json`** — each venue: `{ "name", "lat", "lng", "description" }`
(Venues need numeric `lat`/`lng` or the marker is skipped.)

## Coding Conventions
- **No frameworks, no build step, no runtime dependencies.** Vanilla only. Leaflet comes from the CDN; the site ships exactly what's in the repo. `package.json` exists solely for the `test/` dev harness (Puppeteer) — it is *not* a build step and adds nothing to the deployed site.
- **JS lives in `index.html`'s inline `<script type="module">`**, except **pure time logic**, which lives in `js/time.js` and is imported. Keep DOM/render/map code inline; only side-effect-free time helpers belong in `js/time.js`. Do not split further without reason.
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

See `test/README.md` for the full reference and known gotchas (notably: never use Chrome `--window-size` for mobile viewport testing; use Puppeteer's `setViewport` + CDP `Emulation.setDeviceMetricsOverride` — `viewport.mjs` already does this).

If a verification need isn't covered by the existing harnesses, **extend them** rather than building a one-off. Add a preset to `time-logic.mjs`, add a flag to `viewport.mjs`. The point of `test/` is that it accretes — the harness gets more useful with each pass, not less.

## Backlog

### v1 Features
- [ ] Event-card → map pan (click a card, map flies to its venue)
- [ ] Current-event highlight (show what's happening now based on wall-clock time)
- [ ] Walking-time estimates between venues
- [ ] Filter/search the schedule

### Data
- [ ] Populate `data/2026/events.json` from the trip note
- [ ] Verify real lat/lng for each venue in `data/2026/venues.json`

### Infrastructure
- [ ] AWS Amplify hookup (connect repo, branch `main`, no build command, output `/`)
- [ ] Cloudflare DNS — CNAME for `gencon.skoz.org` → Amplify domain

## Owner
Brandon (skoz) — gencon.skoz.org
Related project: stopthepwnage.com (same vanilla / Amplify + Cloudflare stack)
