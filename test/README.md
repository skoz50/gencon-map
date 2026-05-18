# `test/` — GenCon Map verification harness

Persistent test scripts so each CC session **invokes** these instead of
rebuilding ad-hoc Chrome-headless scripts and Node time stubs every pass.
They encode patterns that were hard-won across earlier sessions (true-viewport
CDP emulation, TZ-drift detection, run-ID-keyed artifacts).

## TL;DR

| Script | What it does |
|---|---|
| `serve.mjs` | Minimal static server for the repo root. No dependencies. |
| `viewport.mjs` | Headless Chrome (Puppeteer) at a **true** device viewport — screenshots, visibility assertions, in-page JS eval. |
| `time-logic.mjs` | Node-only harness for `js/time.js` against the 🧪-panel presets. No browser. |

## Setup

- **Node 20+** (developed on Node 25). `package.json` has `"type": "module"`.
- `time-logic.mjs` and `serve.mjs` need **nothing** beyond Node.
- `viewport.mjs` needs **Puppeteer**:

  ```sh
  npm install        # installs devDependencies, incl. Puppeteer
  ```

  Puppeteer downloads its own Chromium build (**~150–200 MB**, one time, into
  an OS cache outside the repo). `viewport.mjs` never auto-installs — if
  Puppeteer is missing it prints this command and exits non-zero.

## Common workflows

**"I changed time logic — verify no drift"**

```sh
node test/time-logic.mjs
```

**"I changed CSS — verify mobile/desktop layouts"**

```sh
node test/serve.mjs                                          # terminal 1
node test/viewport.mjs --width 375  --url http://localhost:8080 --label phone
node test/viewport.mjs --width 1280 --url http://localhost:8080 --label desktop
```

Or let `viewport.mjs` run the server itself:

```sh
node test/viewport.mjs --width 375 --serve --label phone
```

**"I'm about to push — full pre-push check"**

```sh
node test/time-logic.mjs
node test/viewport.mjs --width 375  --serve --check .test-panel --hidden --label phone
node test/viewport.mjs --width 1280 --serve --check .test-panel          --label desktop
```

…then a live-browser eyeball on the desktop dev box (`node test/serve.mjs`,
open `http://localhost:8080`).

## `serve.mjs`

```sh
node test/serve.mjs        # repo root on :8080
node test/serve.mjs 9090   # repo root on :9090
```

Serves the repo root (so `index.html`, `data/`, `js/` resolve), logs each
request, shuts down cleanly on Ctrl-C. `.js` is served as `text/javascript`
so the browser accepts `js/time.js` as an ES module.

## `viewport.mjs`

```
--url <url>        site to load (default http://localhost:8080)
--serve            start the bundled server and load from it
--port <n>         port for --serve (default 8080)
--width <n>        viewport width  (default 1280)
--height <n>       viewport height (default 900)
--dpr <n>          device pixel ratio (default 1)
--tz <zone>        force a time zone, e.g. America/Los_Angeles
--check <selector> wait for this selector (default body)
--hidden           assert --check selector is present but NOT visible
--label <name>     save a full-page screenshot for this run
--exec <expr>      run a JS expression in page context BEFORE the --check
                   assertion (waits for .event-card first, so schedule data
                   is in); e.g. click a 🧪 preset to drive the Now/Next card
--no-overflow      assert no horizontal overflow (scrollWidth <= clientWidth)
--eval <expr>      run a JS expression in page context AFTER the check; print
                   the result
```

`--exec` drives the page's own 🧪-preset handlers, which fire even when the
panel is `display:none` (mobile) — so the Now/Next card can be exercised at
any viewport. Example: assert the walking-time line renders at 375px:

```sh
node test/viewport.mjs --width 375 --serve --no-overflow --check .now-next-walk \
  --exec "[...document.querySelectorAll('.test-panel__preset')].find(b => b.textContent.includes('sprint')).click()"
```

Diagnostics print to **stderr**; an `--eval` result prints to **stdout**, so
`--eval` output can be redirected to a file. Exits non-zero on any assertion
failure.

### Run artifacts

Each invocation gets a timestamp `runId` (e.g. `20260518-074233`):

```
test/.tmp/<runId>/profile/      throwaway Chrome user-data-dir (removed on exit)
test/.tmp/<runId>/chrome.log    Chrome stdio
test/.tmp/<runId>/http.log      bundled server log (only with --serve)
test/screenshots/<runId>/<width>-<label>.png
```

`test/.tmp/` and `test/screenshots/` are **gitignored** — run output, not
source. Screenshots are kept after the run for inspection; the Chrome profile
dir is deleted on exit (success and failure alike).

## `time-logic.mjs`

```sh
node test/time-logic.mjs            # all scenarios
node test/time-logic.mjs saturday   # only scenarios whose name matches
```

Imports `js/time.js` directly and checks `computeNowNext` / `formatDuration` /
`parseEventLocal` against pre-registered preset moments, printing a pass/fail
table and exiting non-zero on failure.

### Adding a new preset

The 🧪 panel's `TEST_PRESETS` array in `index.html` is the **source of truth**
for interesting moments. When you add a preset there:

1. Add a matching entry to the `SCENARIOS` array in `time-logic.mjs` — an
   `iso` instant plus the expected `current` / `next` event IDs and the
   `countdown` string (set a field to `null` when there is no current/next).
2. Run `node test/time-logic.mjs` and confirm it passes.

Keep the two lists in sync — that is the whole point of mirroring them.

## Known viewport-testing gotchas

- **Never use Chrome `--window-size` for mobile viewport testing.** It floors
  the *layout* viewport at 500px, so a `--screenshot` at 375px renders a 500px
  layout cropped to 375px — showing **false** text-clipping. `viewport.mjs`
  uses Puppeteer's `page.setViewport()` (CDP `Emulation.setDeviceMetricsOverride`)
  for a true device viewport. This was documented in the vault change log —
  `[[GenCon Map - Change Log]]`, 2026-05-17 mobile responsive pass.
- **TZ bugs hide on a US-Eastern host.** Event times are meant to render in the
  event's own zone. Force a contrasting zone (`--tz America/Los_Angeles`) to
  catch browser-TZ leakage; `time-logic.mjs`'s `tz-drift` scenario does the
  Node-side equivalent.
- **ES modules need an http origin.** `js/time.js` will not import under
  `file://` — always go through `serve.mjs`.

## Extending the harness

If a verification need is not covered, **extend these scripts** rather than
writing a one-off: add a scenario to `time-logic.mjs`, add a flag to
`viewport.mjs`. The harness should accrete — more useful each pass, not less.
