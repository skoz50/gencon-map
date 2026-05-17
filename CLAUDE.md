# GenCon Map — Claude Code Context

## Project Overview
A shareable **Gen Con Indy schedule + interactive venue map**, deployed at **gencon.skoz.org**.
Designed for at-the-con use: pull it up on your phone to see what's next and where it is.
Single HTML page that loads its schedule and venues from static JSON. No frameworks, no backend, no build step.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS — single `index.html`, all JS inline in a `<script>` block
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
├── index.html         ← single-page shell: header, schedule, map, fetch-on-load
├── style.css          ← mobile-first layout (stacked narrow, side-by-side wide)
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
- **No frameworks, no build step, no package.json.** Vanilla only. Leaflet comes from the CDN; nothing else is added as a dependency.
- **All JS inline** in `index.html`'s `<script>` block — do not split into separate files.
- **Mobile-first.** The site must work on a phone in a convention center. Schedule stacks above the map on narrow viewports; side-by-side at ≥768px.
- **Always serve via localhost, never `file://`.** The `fetch()` calls for the JSON datasets fail under `file://`. Run `python3 -m http.server 8000` from the repo root.
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
