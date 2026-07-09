// -----------------------------------------------------------------------
// sources/base.js — the DataSource contract every backend adapter implements,
// plus small helpers shared by the SQL-shaped adapters.
//
// A DataSource is a plain object (not a class, so it stays trivially
// serialisable and easy to reason about) exposing:
//
//   id          'local' | 'turso' | 'supabase' | 'firebase' | …
//   label       human name for the picker
//   blurb       one line describing the backend
//   icon        icon() name
//   accent      brand color for the card
//   browserProvision   can it CREATE the objects itself from the browser?
//                      (false → provision() returns a `sql` script to paste)
//   fields      [{ key, label, placeholder, type:'text'|'password', hint? }]
//               the connection inputs; their values become `cfg`
//   docsUrl     where to get those values
//
//   async test(cfg)      → { ok, error? }                 reachable + authed?
//   async probe(cfg)     → { state, app?, schemaVersion?, tables:[{name,count}] }
//                          state: 'empty' | 'polecat' | 'foreign'
//   async provision(cfg, snapshot) → { ok, error? }        create all objects
//                          (browserProvision:false → { ok:false, manual:true, sql })
//   async summarize(cfg) → { tables:[{name,count}], app?, schemaVersion? }
//   async drop(cfg)      → { ok, error? }                  destroy everything
//   async load(cfg)      → snapshot                        read whole workspace
//   async save(cfg, snapshot) → { ok, error? }             write whole workspace
//
// Every method is async and NEVER throws for an expected condition (bad
// creds, empty DB, foreign DB) — those come back in the result so the connect
// flow can branch on them. A thrown error means a genuine, unexpected fault.
// -----------------------------------------------------------------------

import { WORKSPACE_TABLES, columnValue, TABLE_NAMES } from './schema.js';

// Split a row into { cols:{promoted->cell}, data:JSON-of-the-rest } for a
// SQL-shaped store. The full row always survives in `data`, so nothing is
// ever lost to the promoted-column projection.
export function rowToCells(table, row){
  const def = WORKSPACE_TABLES.find(t=>t.name===table);
  const cols = {};
  def.columns.forEach(c=>{ cols[c] = columnValue(table, c, row); });
  return { id: row.id, cols, data: JSON.stringify(row) };
}

// Rebuild a row from a stored `data` blob (the promoted columns are a
// queryable projection, never the source of truth — `data` is).
export function cellsToRow(dataText){
  try{ const r = JSON.parse(dataText); return (r && r.id) ? r : null; }
  catch{ return null; }
}

// Turn a full snapshot into per-table lists of { id, cols, data } ready for an
// adapter to upsert. Adapters that are relational (Turso/Supabase) use this;
// document stores (Firebase) can just take snapshot.tables directly.
export function snapshotToRows(snapshot){
  const out = {};
  TABLE_NAMES.forEach(t=>{
    out[t] = (snapshot.tables[t]||[]).map(row=>rowToCells(t, row));
  });
  return out;
}

// A friendly, human summary line from a probe/summarize result.
export function describeContents(res){
  const tbls = (res.tables||[]).filter(t=>t.count>0);
  if(!tbls.length) return 'no rows yet';
  return tbls.map(t=>`${t.count} ${t.name}`).join(', ');
}
