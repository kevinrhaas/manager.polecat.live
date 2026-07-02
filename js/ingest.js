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

import { Store } from './store.js';

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
