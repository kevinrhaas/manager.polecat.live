// schedule.js — Manager's mirror of the platform's canonical focus-lane
// schedule evaluator (polecat-platform/.github/steward/schedule.mjs). The
// platform file is the authority the hourly scheduler actually runs; this
// copy powers Fleet Ops' next-run previews. KEEP THE TWO IN SYNC — they are
// deliberately tiny.
//
// Lane fields (focus.json, all optional beyond `enabled`):
//   enabled     bool — master switch.
//   everyHours  int ≥1 — cadence (1 = hourly, 2 = every other hour…).
//   offset      int — which hours the cadence lands on
//               (hourUTC % everyHours === offset).
//   window      [startUTC, endUTC) hour window; wraps midnight when
//               start > end (e.g. [22, 6]).
//   startAt     ISO — the lane sleeps until this moment.
//   until       ISO — the lane expires at this moment.
//   slices      int 1..5 (default 1) — how many independent improve runs to
//               dispatch each time the lane fires. Doesn't affect WHEN a lane
//               runs (isDueAt/nextRunAt ignore it) — only how many units it
//               kicks off that hour.

export const TICK_MINUTE = 3;   // steward-focus.yml runs at :03 UTC

// Slices per fired tick (default 1, clamped 1..5). Mirrors platform slicesOf.
export function slicesOf(lane){
  const n = Math.floor(Number(lane && lane.slices) || 1);
  return Math.max(1, Math.min(5, n));
}

export function isDueAt(lane, date){
  if(!lane || !lane.enabled) return false;
  if(lane.startAt && date < new Date(lane.startAt)) return false;
  if(lane.until && date >= new Date(lane.until)) return false;
  const every = Math.max(1, lane.everyHours || 1);
  const offset = ((lane.offset || 0) % every + every) % every;
  const hour = date.getUTCHours();
  if(hour % every !== offset) return false;
  const w = lane.window;
  if(Array.isArray(w) && w.length === 2 && w[0] !== w[1]){
    const inWin = w[0] < w[1] ? (hour >= w[0] && hour < w[1]) : (hour >= w[0] || hour < w[1]);
    if(!inWin) return false;
  }
  return true;
}

// The next tick (hh:TICK_MINUTE UTC) at which the lane fires, or null.
export function nextRunAt(lane, from = new Date(), tickMinute = TICK_MINUTE){
  if(!lane || !lane.enabled) return null;
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(),
    from.getUTCDate(), from.getUTCHours(), tickMinute, 0, 0));
  if(first <= from) first.setUTCHours(first.getUTCHours() + 1);
  for(let i = 0; i < 14 * 24; i++){
    const t = new Date(first.getTime() + i * 3600000);
    if(lane.until && t >= new Date(lane.until)) return null;
    if(isDueAt(lane, t)) return t;
  }
  return null;
}

// ---- display helpers (Manager-only, not in the platform copy) --------------

// 'YYYY-MM-DDTHH:MM' (local) for <input type="datetime-local">, or ''.
export function isoToLocalInput(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function localInputToIso(v){
  if(!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toISOString();
}

// Label a UTC hour in the viewer's local clock ("9 PM" for utcHour 2, CDT).
export function utcHourLabel(utcHour){
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric' });
}
