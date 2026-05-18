# GenCon Map

A shareable Gen Con Indy schedule paired with an interactive Leaflet venue map, designed for at-the-con use — pull it up on your phone in the convention center to see what's next and where it is. No frameworks, no build step, no backend: just a single HTML page that loads its schedule and venues from JSON.

## Stack

- **Frontend:** Vanilla HTML/CSS/JS — single `index.html`, no framework, no build step
- **Map:** [Leaflet](https://leafletjs.com/) 1.9.4 from the unpkg CDN, OpenStreetMap tiles
- **Data:** Static JSON under `data/YYYY/` — `events.json` and `venues.json`
- **Hosting:** AWS Amplify — GitHub-connected, auto-deploys on push to `main`
- **DNS:** Cloudflare — CNAME to the Amplify-generated domain
- **Repo:** https://github.com/skoz50/gencon-map

## Local Dev

Serve over HTTP — opening `index.html` via `file://` breaks the `fetch()` calls.

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Run from the repo root.

## Deploy

Push to `main` — Amplify auto-deploys to **gencon.skoz.org** (~1 min build).

```bash
git add . && git commit -m "describe your change" && git push origin main
```

## Year-over-Year

Each convention year gets its own dataset directory: `data/YYYY/events.json` and `data/YYYY/venues.json`. The active year is set by the `YEAR` constant in `index.html`. Past years stay in the repo as an archive.

## Dev Tools

**📍 Pick coords** (🧪 panel toggle): when enabled, every map click logs the clicked `{ lat, lng }` to the console for easy copy-paste into `venues.json`'s rooms scaffold. It ships permanently as a dev tool — the user uses it to fill in per-room pin overrides over time. The tool is hidden on mobile alongside the rest of the 🧪 panel.

## License

MIT — see [LICENSE](LICENSE).
