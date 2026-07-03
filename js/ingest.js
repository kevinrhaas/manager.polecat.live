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
// commas, quote bare keys, and requote single-quoted strings.
function jsLiteralToJSON(lit){
  let out = lit
    .replace(/\/\/[^\n]*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
    .replace(/'((?:\\.|[^'\\])*)'/g, (_, s) => '"' + s.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
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
