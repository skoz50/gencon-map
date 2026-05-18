#!/usr/bin/env node
// test/time-logic.mjs — Node-only harness for js/time.js.
//
// Exercises the pure time logic against the 🧪-panel preset moments plus a
// host-TZ-independent parse check. No browser, no DOM — just the module.
//
//   node test/time-logic.mjs            # run all scenarios
//   node test/time-logic.mjs saturday   # run only scenarios matching substring
//
// The SCENARIOS list mirrors index.html's TEST_PRESETS array — that array is
// the source of truth for "which moments are interesting". When you add a
// preset there, add the matching scenario here (see test/README.md).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEventLocal, computeNowNext, formatDuration } from '../js/time.js';

const events = JSON.parse(
  fs.readFileSync(new URL('../data/2026/events.json', import.meta.url))
).events;

// Each scenario: an override instant + the expected current/next event IDs
// and the Now/Next countdown string. `current`/`next` of null means none.
const SCENARIOS = [
  { name: 'thu-mid-dark-redwood', iso: '2026-07-30T16:00:00-04:00',
    current: 'dark-redwood',    next: 'monster-unbound', countdown: '60 min' },
  { name: 'thu-end-monster',     iso: '2026-07-30T21:45:00-04:00',
    current: 'monster-unbound', next: 'haunted-manor',   countdown: '4 min' },
  { name: 'saturday-sprint',     iso: '2026-08-01T15:55:00-04:00',
    current: 'alas-poor-will',  next: 'vip-mtg-hobbit',  countdown: '5 min' },
  { name: 'sat-mid-sorcery',     iso: '2026-08-01T23:30:00-04:00',
    current: 'sorcery-casual',  next: 'verhey-unknown',  countdown: '30 min' },
  { name: 'sunday-overlap',      iso: '2026-08-02T11:45:00-04:00',
    current: 'verhey-unknown',  next: 'mega-draft-mb2',  countdown: '1h 15m' },
  { name: 'after-last-event',    iso: '2026-08-03T14:00:00-04:00',
    current: null,              next: null,              countdown: null }
];

const idOf = e => (e ? e.id : null);

function runScenario(s) {
  const now = new Date(s.iso);
  const { current, next } = computeNowNext(events, now);
  // Countdown mirrors the Now/Next card: time left on the current event,
  // else time until the next one.
  let countdown = null;
  if (current) countdown = formatDuration(new Date(current.end) - now);
  else if (next) countdown = formatDuration(new Date(next.start) - now);

  const fails = [];
  if (idOf(current) !== s.current) fails.push(`current ${idOf(current)} != ${s.current}`);
  if (idOf(next) !== s.next) fails.push(`next ${idOf(next)} != ${s.next}`);
  if (s.countdown !== null && countdown !== s.countdown) {
    fails.push(`countdown "${countdown}" != "${s.countdown}"`);
  }
  return {
    name: s.name, ok: fails.length === 0, detail: fails.join('; '),
    got: `current=${idOf(current)} next=${idOf(next)} countdown=${countdown}`
  };
}

// Live: no override — assert only that the call returns without throwing.
function runLive() {
  try {
    computeNowNext(events, new Date());
    return { name: 'live-no-throw', ok: true, detail: '', got: 'computeNowNext(now) ok' };
  } catch (e) {
    return { name: 'live-no-throw', ok: false, detail: e.message, got: 'threw' };
  }
}

// TZ drift: parse must yield event-local parts whatever the host TZ is.
function runTzDrift() {
  const p = parseEventLocal('2026-07-30T15:00:00-04:00');
  const fails = [];
  if (p.hour !== 15) fails.push(`hour ${p.hour} != 15`);
  if (p.offsetMinutes !== -240) fails.push(`offsetMinutes ${p.offsetMinutes} != -240`);
  const hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    name: 'tz-drift', ok: fails.length === 0, detail: fails.join('; '),
    got: `hour=${p.hour} offsetMinutes=${p.offsetMinutes} (host TZ ${hostTz})`
  };
}

export function run(filter = null) {
  let results = [runLive(), ...SCENARIOS.map(runScenario), runTzDrift()];
  if (filter) results = results.filter(r => r.name.includes(filter));

  console.log('\n  time-logic.mjs — js/time.js preset harness\n');
  let pass = 0, fail = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (!r.ok) console.log(`        ${r.detail}  [got: ${r.got}]`);
    r.ok ? pass++ : fail++;
  }
  if (results.length === 0) console.log(`  (no scenarios matched "${filter}")`);
  console.log(`\n  ${pass} passed, ${fail} failed${filter ? ` (filter: "${filter}")` : ''}\n`);
  return fail;
}

// Importable as a module without auto-running; a direct CLI invocation runs
// all scenarios (or those matching the substring argument).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv[2] || null) ? 1 : 0);
}
