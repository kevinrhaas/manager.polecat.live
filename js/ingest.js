// ingest.js — live "what's new" ingestion.
//
// Every project in this fleet publishes its changelog the same way Manager
// does (see js/changelog.js): a static ES module exporting
// `export const CHANGELOG = [{v,title,kind,ts,items}, …]`. This module pulls
// that file from a project's deployed site and turns it into release rows —
// WITHOUT ever executing the remote file. The array literal is extracted from
// the raw text and converted to strict JSON, so a malformed or even hostile
// remote file can only fail to parse, never run code in this app.
//
// Fetching a different origin's static file is subject to CORS, and most
// sites (including GitHub Pages, by default) don't send the headers that
// would allow it — so failures here are expected and handled gracefully by
// the caller, which offers a paste-to-import fallback.

import { Store, AUTO_SYNC_FAIL_THRESHOLD, DEFAULT_AUTO_SYNC_BACKOFF_CAP } from './store.js';
export { AUTO_SYNC_FAIL_THRESHOLD };

export function guessChangelogUrl(site){
  if(!site) return '';
  return site.replace(/\/+$/,'') + '/js/changelog.js';
}

// Find the `[ … ]` array literal following `NAME = `, respecting nested
// brackets and quoted strings so we grab exactly the array (not past it).
function extractArrayLiteral(src, varName){
  const m = src.match(new RegExp(varName + '\\s*=\\s*\\['));
  if(!m) return null;
  const start = m.index + m[0].length - 1; // index of the opening [
  let depth = 0, inStr = null, esc = false;
  for(let i = start; i < src.length; i++){
    const c = src[i];
    if(inStr){
      if(esc) esc = false;
      else if(c === '\\') esc = true;
      else if(c === inStr) inStr = null;
      continue;
    }
    if(c === '"' || c === "'" || c === '`'){ inStr = c; continue; }
    if(c === '[') depth++;
    else if(c === ']'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// Best-effort JS-object-literal → strict JSON: strip comments, drop trailing
// commas, quote bare keys, and requote every string to JSON's `"…"` form.
// Walks the text once, tracking whether we're inside a string, rather than
// two independent blind regexes (strip comments, then requote '…') — those
// had no idea what was already inside a string, so a `"…it's…"` double-quoted
// value anywhere in the object made the *later* regex treat that lone
// apostrophe as the start of a new single-quoted span and mangle everything
// up to the next one it found. Every project publishes its changelog the same
// way Manager does, so this only needs to run once here to protect every sync.
//
// The trailing-comma trim and bare-key-quoting regexes must ALSO stay off the
// inside of string values, for the same reason. A title like
// `**, quietly:**` contains a comma-word-colon run that looks exactly like an
// unquoted object key; run the key regex over the whole converted string and
// it rewrites that to `, "quietly":` *inside the title*, injecting unescaped
// quotes and corrupting the JSON. So structural text and string literals are
// kept apart: string literals are copied through verbatim (already re-quoted
// to JSON form), and the two regexes only ever transform the structural runs
// between them — where real keys and trailing commas actually live.
function jsLiteralToJSON(lit){
  let out = '', struct = '', i = 0;
  const n = lit.length;
  const esc = (ch) => ch === '"' ? '\\"' : ch;
  const flush = () => {
    if(!struct) return;
    out += struct
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    struct = '';
  };
  while(i < n){
    const c = lit[i];
    if(c === '/' && lit[i+1] === '/'){ while(i < n && lit[i] !== '\n') i++; continue; }
    if(c === "'" || c === '"'){
      flush();
      const quote = c; i++; let s = '"';
      while(i < n){
        const ch = lit[i];
        if(ch === '\\' && i+1 < n){
          const next = lit[i+1];
          if(next === '\\') s += '\\\\';
          else if('ntrbf'.includes(next)) s += '\\' + next;
          else s += esc(next);
          i += 2; continue;
        }
        if(ch === quote){ i++; break; }
        s += esc(ch); i++;
      }
      out += s + '"'; continue;
    }
    struct += c; i++;
  }
  flush();
  return JSON.parse(out);
}

export function parseChangelogSource(text){
  const lit = extractArrayLiteral(text, 'CHANGELOG');
  if(!lit) throw new Error('No CHANGELOG array found in that file');
  let arr;
  try{ arr = jsLiteralToJSON(lit); }
  catch{ throw new Error('Found a CHANGELOG array but couldn’t parse its contents'); }
  if(!Array.isArray(arr)) throw new Error('CHANGELOG is not an array');
  return arr
    .map(e => ({
      v: Number(e.v) || 0,
      title: String(e.title || '').trim().slice(0, 200),
      kind: ['feature', 'polish', 'fix'].includes(e.kind) ? e.kind : 'feature',
      ts: e.ts && !isNaN(new Date(e.ts)) ? new Date(e.ts).toISOString() : new Date().toISOString(),
      items: Array.isArray(e.items) ? e.items.map(String).slice(0, 20) : [],
    }))
    .filter(e => e.v > 0 && e.title);
}

export async function fetchChangelog(url){
  let res;
  try{ res = await fetch(url, { mode: 'cors', cache: 'no-store' }); }
  catch{ throw new Error('network or CORS error'); }
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseChangelogSource(text);
}

// Sync one project against its (explicit or guessed) changelog URL and write
// straight into the releases table — used by both the per-project Sync
// button and the dashboard's fleet-wide "Sync all". Never throws: failures
// and "nothing to sync" both come back as a result the caller can render.
export async function syncProject(p){
  const url = p.changelogUrl || guessChangelogUrl(p.site);
  if(!url) return { status:'skipped', reason:'no site or changelog URL' };
  try{
    const entries = await fetchChangelog(url);
    const { added, updated } = Store.syncReleases(p.id, entries, url);
    return { status:'ok', added, updated, url };
  }catch(e){
    return { status:'error', message:e.message||'sync failed' };
  }
}

// Force sync: same fetch, but a full reconcile (see Store.forceSyncReleases) —
// overwrites drifted/edited rows unconditionally and removes synced releases
// no longer published upstream. Used by the project page's "Force sync" and
// the dashboard's "Force sync all", both behind an explicit confirm.
export async function forceSyncProject(p){
  const url = p.changelogUrl || guessChangelogUrl(p.site);
  if(!url) return { status:'skipped', reason:'no site or changelog URL' };
  try{
    const entries = await fetchChangelog(url);
    const { added, updated, removed } = Store.forceSyncReleases(p.id, entries, url);
    return { status:'ok', added, updated, removed, url };
  }catch(e){
    return { status:'error', message:e.message||'force sync failed' };
  }
}

// Auto-sync: quietly re-pull every opted-in project whose interval has
// elapsed (or that has never been auto-synced). Opt-in is two-layered — a
// global switch (Settings → Auto-sync) plus a per-project toggle (a
// project's health panel) — so nothing runs unless both agree. Every
// attempted project's `lastAutoSyncAt` is stamped whether it succeeds or
// fails, so an unreachable source is retried on the next interval rather than
// on every app open. Returns null when there's nothing due (including when
// the feature is off), so callers can stay silent.
// The interval is stored in MINUTES (`intervalMinutes`); older workspaces that
// only have `intervalHours` are read transparently. Default 360 min (6 h).
export function autoSyncMinutes(cfg){
  cfg = cfg || Store.settings().autoSync || {};
  return Math.max(1, cfg.intervalMinutes ?? (cfg.intervalHours != null ? cfg.intervalHours * 60 : 360));
}

// A project whose auto-sync keeps failing (CORS, 404, dead site) is retried
// less often the more times in a row it fails — doubling the wait each
// failure, capped at `cap` times the normal interval — instead of hammering
// an unreachable source on every tick forever. Any success resets the streak
// and normal cadence resumes immediately. Once a streak reaches
// AUTO_SYNC_FAIL_THRESHOLD consecutive failures it's surfaced in the UI as
// "failing", not just retried. (Both AUTO_SYNC_FAIL_THRESHOLD and the cap's
// tunable fleet default now live in store.js — see there.)
export function autoSyncBackoffMultiplier(failCount, cap = DEFAULT_AUTO_SYNC_BACKOFF_CAP){
  return failCount > 0 ? Math.min(2 ** failCount, cap) : 1;
}

// Sync one project and record the outcome onto its fail streak — resets
// autoSyncFailCount/autoSyncLastError on success, increments and stores the
// reason on failure. `lastAutoSyncAt` is stamped either way so a dead source
// is scheduled by the backoff above rather than retried every tick. Shared by
// the background auto-sync loop and the "Retry now" action a failing project
// shows in its health panel.
export async function attemptAutoSync(p){
  const res = await syncProject(p);
  if(res.status==='ok'){
    Store.updateProject(p.id, { lastAutoSyncAt:Date.now(), autoSyncFailCount:0, autoSyncLastError:'' }, { silent:true });
  }else if(res.status==='error'){
    Store.updateProject(p.id, { lastAutoSyncAt:Date.now(), autoSyncFailCount:(p.autoSyncFailCount||0)+1, autoSyncLastError:res.message||'sync failed' }, { silent:true });
  }
  return res;
}

// Background refresh for the Projects library: a quiet "check for new updates"
// that runs when you open the library, so you don't have to hit "Sync all"
// every visit. Unlike runAutoSync (opt-in, per-project, interval-gated), this
// pulls EVERY connected project — but throttled to once per REFRESH_THROTTLE_MS
// so rapid navigation doesn't hammer the network, and silent (no toasts): a
// project that actually gains releases is flagged NEW (Store.markProjectUpdated)
// for a transient badge on its row; failures just don't flag anything.
const REFRESH_THROTTLE_MS = 90000;   // at most once every 90s
let _lastBgRefresh = 0, _bgRefreshing = false;
// Whether a call right now would actually do work (not in-flight, not throttled,
// not under automation, and there's something to sync) — lets the library show
// a "checking…" indicator ONLY when a refresh is really about to run.
export function bgRefreshWillRun(){
  if(_bgRefreshing) return false;
  if(typeof navigator !== 'undefined' && navigator.webdriver) return false;
  if(Date.now() - _lastBgRefresh < REFRESH_THROTTLE_MS) return false;
  return Store.projects().some(p => p.site || p.changelogUrl);
}
export async function backgroundRefreshProjects({ force = false } = {}){
  if(_bgRefreshing) return null;
  // Don't fan out real network syncs under browser automation (Playwright sets
  // navigator.webdriver) — the smoke suite drives the library repeatedly and
  // must not depend on reaching every project's external changelog host. The
  // NEW-marker logic is exercised directly in the suite instead.
  if(typeof navigator !== 'undefined' && navigator.webdriver && !force) return null;
  if(!force && Date.now() - _lastBgRefresh < REFRESH_THROTTLE_MS) return null;
  const targets = Store.projects().filter(p => p.site || p.changelogUrl);
  if(!targets.length){ _lastBgRefresh = Date.now(); return null; }
  _bgRefreshing = true; _lastBgRefresh = Date.now();
  try{
    let flagged = 0, ok = 0;
    // One batch around the whole sweep: the per-project writes below each emit
    // 'releases'/'projects', which reactively repaint the library — batching
    // defers those to a single paint at the end instead of one flash per
    // project (and collapses the write-through sync to a single push).
    await Store.batch(async () => {
      for(const p of targets){
        const res = await syncProject(p);
        if(res.status === 'ok'){ ok++; if(res.added > 0){ Store.markProjectUpdated(p.id); flagged++; } }
      }
    });
    return { attempted: targets.length, ok, flagged, ran: true };
  } finally {
    _bgRefreshing = false;
  }
}

// A module-level in-flight guard so overlapping ticks (frequent intervals +
// slow networks) can never stack up. If a run is already going, we skip.
let _autoSyncing = false;
export async function runAutoSync(){
  if(_autoSyncing) return null;                 // never overlap — run safe
  const cfg = Store.settings().autoSync;
  if(!cfg?.enabled) return null;
  const dueMs = autoSyncMinutes(cfg) * 60000;
  const due = Store.projects().filter(p => {
    if(!p.autoSync || !(p.site || p.changelogUrl)) return false;
    const wait = dueMs * autoSyncBackoffMultiplier(p.autoSyncFailCount||0, Store.autoSyncBackoffCapFor(p.id));
    return (Date.now() - (p.lastAutoSyncAt || 0)) >= wait;
  });
  if(!due.length) return null;

  _autoSyncing = true;
  try{
    let ok=0, failed=0, added=0, updated=0;
    for(const p of due){
      const res = await attemptAutoSync(p);
      if(res.status==='ok'){ ok++; added+=res.added; updated+=res.updated; }
      else if(res.status==='error') failed++;
    }
    if(added || updated){
      Store.logRun({ mode:'auto-sync', note:`Auto-sync — ${added} new, ${updated} updated across ${ok} project${ok===1?'':'s'}` });
    }
    return { attempted:due.length, ok, failed, added, updated };
  } finally {
    _autoSyncing = false;
  }
}
