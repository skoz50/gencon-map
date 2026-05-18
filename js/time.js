// js/time.js — pure time-handling utilities for GenCon Map.
//
// Everything here is pure time math with no DOM access. Two ideas drive it:
//
//  1. Event times render in the event's *own* TZ. The offset embedded in the
//     ISO string ("...-04:00") is the source of truth, so a reader in any
//     time zone sees the same Eastern times printed on their Gen Con badge —
//     the browser's TZ never enters into it.
//  2. The Now/Next feature's notion of "now" funnels through getNow() so the
//     🧪 test panel can override it (setNowOverride) without touching clocks.
//
// Imported by index.html as an ES module and by test/time-logic.mjs in Node.

// ---- ISO parsing ----------------------------------------------------------

// Parse an ISO 8601 string like "2026-07-30T15:00:00-04:00" into its
// event-local calendar parts plus the absolute instant:
//   { year, month, day, hour, minute, offsetMinutes, utcMs }
// year…minute are in the event's local TZ; offsetMinutes is that zone's
// offset from UTC (EDT -> -240); utcMs is the absolute instant in epoch ms.
export function parseEventLocal(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Bad ISO: ${iso}`);
  const offsetMinutes = (m[7].startsWith('-') ? -1 : 1) * (Math.abs(+m[7]) * 60 + +m[8]);
  const year = +m[1], month = +m[2], day = +m[3];
  const hour = +m[4], minute = +m[5], second = +m[6];
  // Date.UTC treats the parts as UTC wall time; subtracting the zone offset
  // recovers the true instant the event-local wall time corresponds to.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60000;
  return { year, month, day, hour, minute, offsetMinutes, utcMs };
}

// ---- Clock + span formatting ----------------------------------------------

// Format parsed time parts as a 12-hour clock string, e.g. "3:00 PM".
function formatClock({ hour, minute }) {
  const hr12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${hr12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// Format an event's time span in the event's own TZ. With both bounds:
// "3:00 PM – 5:00 PM"; with only a start: "3:00 PM".
export function formatEventTime(isoStart, isoEnd) {
  const start = formatClock(parseEventLocal(isoStart));
  if (!isoEnd) return start;
  return `${start} – ${formatClock(parseEventLocal(isoEnd))}`;
}

// ---- Day grouping ---------------------------------------------------------

// Offset-aware day key ("2026-07-30") for grouping events by their local
// calendar date — a late-Eastern event never drifts onto the browser's
// adjacent calendar day.
export function eventLocalDayKey(iso) {
  const { year, month, day } = parseEventLocal(iso);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Day-group header ("Thu, Jul 30") from a "YYYY-MM-DD" day key. Builds a
// UTC-midnight Date and formats in UTC so the weekday matches the key's
// calendar date regardless of the browser's TZ.
export function formatDayHeader(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'
  });
}

// ---- "Now" — overridable current time -------------------------------------

// null = live time. The 🧪 test panel sets this via setNowOverride() so the
// Now/Next feature can be exercised outside the trip window.
let nowOverride = null;

// The current time the Now/Next feature should reason about: the override
// when one is set, otherwise the live clock.
export function getNow() {
  return nowOverride ?? new Date();
}

// Set (a Date) or clear (null) the time override.
export function setNowOverride(date) {
  nowOverride = date;
}

// The raw override value (Date or null) — lets the 🧪 panel report whether
// it is showing live or overridden time.
export function getNowOverride() {
  return nowOverride;
}

// ---- Now / Next compute ---------------------------------------------------

// Format a positive duration (ms):
//   <= 60 min  -> "12 min"
//   < 24 hr    -> "2h 15m"  (minutes omitted when zero: "3h")
//   >= 24 hr   -> "1d 4h"   (hours omitted when zero: "2d")
export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin <= 60) return `${totalMin} min`;
  const totalHr = Math.floor(totalMin / 60);
  if (totalHr < 24) {
    const m = totalMin % 60;
    return m === 0 ? `${totalHr}h` : `${totalHr}h ${m}m`;
  }
  const d = Math.floor(totalHr / 24);
  const h = totalHr % 24;
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

// From a list of events and a "now" instant, find the event currently in
// progress (now within [start, end)) and the soonest upcoming one. Either
// may be null. Pure — the caller renders; this just picks. Trip-window
// gating stays with the caller (index.html's TRIP_START / TRIP_END).
//
// `venues` (the venues.json array, optional) feeds the walking-time lookup:
// when a current and a next event sit at *different* venues, walkTime carries
// the pre-computed minutes (and an optional note) from venues[current].
// walking_times[next]. A missing pair, a same-venue pair, or no current event
// all yield walkTime: null — a data gap, not a bug, so no warning.
export function computeNowNext(events, now, venues = []) {
  let current = null;
  let next = null;
  events.forEach(e => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    if (now >= start && now < end) current = e;
    if (start > now && (next === null || start < new Date(next.start))) next = e;
  });

  // Walking time applies only current -> next, and only across venues.
  let walkTime = null;
  if (current && next && current.venue_id !== next.venue_id) {
    const from = venues.find(v => v.id === current.venue_id);
    const walkData = from && from.walking_times
      ? from.walking_times[next.venue_id]
      : undefined;
    // Entry shape is mixed: a bare number of minutes, or { minutes, note }.
    if (walkData != null) {
      walkTime = {
        minutes: typeof walkData === 'number' ? walkData : walkData.minutes,
        note: typeof walkData === 'object' ? (walkData.note ?? null) : null
      };
    }
  }

  return { current, next, walkTime };
}
