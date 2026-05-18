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

// venues.json carries the walking_times pairs computeNowNext now consults.
const venues = JSON.parse(
  fs.readFileSync(new URL('../data/2026/venues.json', import.meta.url))
).venues;

// Each scenario: an override instant + the expected current/next event IDs
// and the Now/Next countdown string. `current`/`next` of null means none.
// `walkTime`, when present, is the expected computeNowNext walkTime object
// ({ minutes, note }) or null; scenarios without the field skip that check.
const SCENARIOS = [
  { name: 'thu-mid-dark-redwood', iso: '2026-07-30T16:00:00-04:00',
    current: 'dark-redwood',    next: 'monster-unbound', countdown: '60 min',
    walkTime: { minutes: 5, note: null } },
  { name: 'thu-end-monster',     iso: '2026-07-30T21:45:00-04:00',
    current: 'monster-unbound', next: 'haunted-manor',   countdown: '4 min',
    walkTime: null },
  { name: 'saturday-sprint',     iso: '2026-08-01T15:55:00-04:00',
    current: 'alas-poor-will',  next: 'vip-mtg-hobbit',  countdown: '5 min',
    walkTime: { minutes: 5, note: null } },
  { name: 'sat-mid-sorcery',     iso: '2026-08-01T23:30:00-04:00',
    current: 'sorcery-casual',  next: 'verhey-unknown',  countdown: '30 min',
    walkTime: { minutes: 10, note: null } },
  { name: 'sunday-overlap',      iso: '2026-08-02T11:45:00-04:00',
    current: 'verhey-unknown',  next: 'mega-draft-mb2',  countdown: '1h 15m',
    walkTime: null },
  { name: 'after-last-event',    iso: '2026-08-03T14:00:00-04:00',
    current: null,              next: null,              countdown: null,
    walkTime: null },
  // ---- Walking-time scenarios ---------------------------------------------
  // Walk-required, with note: mid sorcery-team-sealed (ICC) the next event is
  // alas-poor-will (JW) — the only current->next pair the 2026 schedule gives
  // across the ICC<->JW skywalk. Asserts the "via skywalk" note flows through.
  { name: 'walk-skywalk',        iso: '2026-07-31T22:00:00-04:00',
    current: 'sorcery-team-sealed', next: 'alas-poor-will', countdown: '2h',
    walkTime: { minutes: 5, note: 'via skywalk' } },
  // Same-venue: mid riftbound-l2p (ICC) the next event sorcery-team-sealed is
  // also ICC — no walk line.
  { name: 'walk-same-venue',     iso: '2026-07-31T15:30:00-04:00',
    current: 'riftbound-l2p',   next: 'sorcery-team-sealed', countdown: '30 min',
    walkTime: null },
  // No current: before Thursday's first event — next exists, but with no
  // current there is nothing to walk *from*, so walkTime is null.
  { name: 'walk-no-current',     iso: '2026-07-30T10:00:00-04:00',
    current: null,              next: 'dark-redwood',    countdown: '5h',
    walkTime: null }
];

const idOf = e => (e ? e.id : null);

// Stringify a walkTime object (or null) for stable compare + reporting.
const walkStr = w => (w ? `${w.minutes}/${w.note}` : 'null');

function runScenario(s) {
  const now = new Date(s.iso);
  const { current, next, walkTime } = computeNowNext(events, now, venues);
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
  // walkTime checked only when the scenario declares an expectation.
  if ('walkTime' in s && walkStr(walkTime) !== walkStr(s.walkTime)) {
    fails.push(`walkTime ${walkStr(walkTime)} != ${walkStr(s.walkTime)}`);
  }
  return {
    name: s.name, ok: fails.length === 0, detail: fails.join('; '),
    got: `current=${idOf(current)} next=${idOf(next)} countdown=${countdown}` +
         ` walkTime=${walkStr(walkTime)}`
  };
}

// Live: no override — assert only that the call returns without throwing.
function runLive() {
  try {
    computeNowNext(events, new Date(), venues);
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

// Room coverage — informational only, never a pass/fail gate. Iterates every
// event and looks up its (venue_id, room) pair in the venue's rooms map.
// Surfaces which events still fall back to the bare room name because their
// rooms-map entry has null floor/wing (or no entry at all). Coverage fills in
// as the human edits venues.json; this just reports the current drift.
function reportRoomCoverage() {
  const venueById = new Map(venues.map(v => [v.id, v]));
  let withData = 0;
  const missing = new Map(); // room name -> count of events lacking room data
  for (const e of events) {
    const venue = venueById.get(e.venue_id);
    const rd = venue && venue.rooms ? venue.rooms[e.room] : null;
    if (rd && rd.floor != null && rd.wing != null) {
      withData++;
    } else {
      missing.set(e.room, (missing.get(e.room) || 0) + 1);
    }
  }

  console.log('  ─── Room coverage ───');
  console.log(`  ${events.length} events total`);
  console.log(`  ${withData} events have room-map data (floor + wing both non-null)`);
  console.log(`  ${events.length - withData} events fall back to bare room name`);
  if (missing.size > 0) {
    console.log('\n  Missing room data:');
    for (const [room, count] of missing) {
      console.log(`  - "${room}" (used by ${count} event${count === 1 ? '' : 's'})`);
    }
  }
  console.log('');
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

  // Coverage is a whole-dataset report; skip it on a filtered run, which is
  // a focused subset. Exit code is unchanged by it either way.
  if (!filter) reportRoomCoverage();
  return fail;
}

// Importable as a module without auto-running; a direct CLI invocation runs
// all scenarios (or those matching the substring argument).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.argv[2] || null) ? 1 : 0);
}
