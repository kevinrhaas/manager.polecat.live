// -----------------------------------------------------------------------
// sources/turso.js — Turso (libSQL / SQLite over HTTP).
//
// The reference REMOTE adapter. Turso exposes a plain HTTP endpoint
// (`/v2/pipeline`) that accepts arbitrary SQL — DDL included — authenticated
// with a bearer token, so the whole flow the user asked for works entirely
// from a static browser page with no server and no build step:
//   probe → empty? provision (CREATE everything) → push local up → connected
//   probe → ours?  load it → adopt as source of truth
//   probe → foreign? warn; or summarise + offer to drop
//
// All writes go through one batched pipeline request, so a full workspace
// push is a single round trip.
// -----------------------------------------------------------------------

import { provisionDDL, metaRows, META_TABLE, APP_ID, SCHEMA_VERSION,
         emptySnapshot, TABLE_NAMES } from './schema.js';
import { snapshotToRows, cellsToRow } from './base.js';

// Normalise a user-entered URL to the HTTP pipeline endpoint. Turso DB URLs
// are often given as `libsql://name-org.turso.io` — the HTTP API is the same
// host over https.
function pipelineUrl(rawUrl){
  let u = (rawUrl||'').trim();
  if(!u) throw new Error('Database URL is required');
  u = u.replace(/^libsql:\/\//i, 'https://').replace(/\/+$/,'');
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u + '/v2/pipeline';
}

// Run a batch of SQL statements in one pipeline request. Each stmt is
// `{ sql }` or `{ sql, args:[{type,value}] }`. Returns the array of results
// (one per statement) or throws with a useful message.
async function pipeline(cfg, statements){
  const body = {
    requests: [
      ...statements.map(s=>({ type:'execute', stmt: s })),
      { type:'close' },
    ],
  };
  let res;
  try{
    res = await fetch(pipelineUrl(cfg.url), {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${(cfg.token||'').trim()}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
  }catch(e){ throw new Error('Could not reach Turso (network or CORS): '+e.message); }
  if(res.status===401 || res.status===403) throw new Error('Turso rejected the auth token (401/403)');
  if(!res.ok) throw new Error(`Turso HTTP ${res.status}`);
  const json = await res.json();
  const results = (json.results||[]);
  // The pipeline reports per-statement errors inline rather than as HTTP codes.
  const failed = results.find(r=>r.type==='error');
  if(failed) throw new Error('Turso SQL error: '+(failed.error?.message||'unknown'));
  return results.map(r=>r.response?.result).filter(Boolean);
}

// A single-statement convenience returning the decoded rows (arrays of cell
// values) + column names.
async function query(cfg, sql, args){
  const [result] = await pipeline(cfg, [ args ? { sql, args } : { sql } ]);
  if(!result) return { cols:[], rows:[] };
  const cols = (result.cols||[]).map(c=>c.name);
  const rows = (result.rows||[]).map(r=>r.map(cell=>cell?.value ?? null));
  return { cols, rows };
}

const arg = (v)=> v==null ? { type:'null' } :
  typeof v==='number' ? { type: Number.isInteger(v)?'integer':'float', value: String(v) } :
  { type:'text', value: String(v) };

async function listTables(cfg){
  const { rows } = await query(cfg, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%'`);
  return rows.map(r=>r[0]);
}

async function countRows(cfg, table){
  try{ const { rows } = await query(cfg, `SELECT COUNT(*) FROM "${table}"`); return Number(rows[0]?.[0]||0); }
  catch{ return 0; }
}

export const tursoSource = {
  id:'turso',
  label:'Turso',
  blurb:'SQLite over HTTP. Creates every object itself from the browser — the smoothest "connect to an empty database and go" experience.',
  icon:'db',
  accent:'#4ff8b0',
  browserProvision:true,
  fields:[
    { key:'url',   label:'Database URL', placeholder:'libsql://your-db-org.turso.io', type:'text',
      hint:'From the Turso dashboard or `turso db show <name> --url`.' },
    { key:'token', label:'Auth token',   placeholder:'eyJ… (a database auth token)', type:'password',
      hint:'`turso db tokens create <name>` — a token scoped to this one database.' },
  ],
  docsUrl:'https://docs.turso.tech/sdk/http/reference',

  async test(cfg){
    try{ await query(cfg, 'SELECT 1'); return { ok:true }; }
    catch(e){ return { ok:false, error:e.message }; }
  },

  async probe(cfg){
    const names = await listTables(cfg);
    const hasMeta = names.includes(META_TABLE);
    if(hasMeta){
      let app=null, schemaVersion=null;
      try{
        const { rows } = await query(cfg, `SELECT key, value FROM "${META_TABLE}" WHERE key IN ('app','schema_version')`);
        rows.forEach(([k,v])=>{ if(k==='app') app=v; if(k==='schema_version') schemaVersion=Number(v); });
      }catch{}
      const tables = [];
      for(const t of TABLE_NAMES) if(names.includes(t)) tables.push({ name:t, count: await countRows(cfg, t) });
      return { state:'polecat', app, schemaVersion, tables };
    }
    if(names.length===0) return { state:'empty', tables:[] };
    // has tables, but none of them ours → a database in use for something else
    const tables = [];
    for(const t of names) tables.push({ name:t, count: await countRows(cfg, t) });
    return { state:'foreign', tables };
  },

  async provision(cfg, snapshot){
    try{
      await pipeline(cfg, provisionDDL().map(sql=>({ sql })));
      // stamp identity
      const meta = metaRows(snapshot);
      await pipeline(cfg, meta.map(m=>({ sql:`INSERT OR REPLACE INTO "${META_TABLE}"(key,value) VALUES(?,?)`, args:[arg(m.key), arg(m.value)] })));
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },

  async summarize(cfg){ return this.probe(cfg); },

  async drop(cfg){
    try{
      const names = await listTables(cfg);
      if(names.length) await pipeline(cfg, names.map(n=>({ sql:`DROP TABLE IF EXISTS "${n}"` })));
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },

  async load(cfg){
    const snap = emptySnapshot();
    for(const t of TABLE_NAMES){
      try{
        const { rows } = await query(cfg, `SELECT data FROM "${t}"`);
        snap.tables[t] = rows.map(r=>cellsToRow(r[0])).filter(Boolean);
      }catch{ /* table missing — leave empty */ }
    }
    try{
      const { rows } = await query(cfg, `SELECT key,value FROM "${META_TABLE}"`);
      rows.forEach(([k,v])=>{ if(k==='settings'){ try{ snap.settings=JSON.parse(v); }catch{} } if(k==='meta'){ try{ snap.meta=JSON.parse(v); }catch{} } });
    }catch{}
    return snap;
  },

  // Full write-through: replace every table's contents with the snapshot in
  // one batched pipeline. Simple + robust for a metadata-sized workspace
  // (hundreds of rows) — no per-row diffing to get subtly wrong across
  // backends. DELETE-then-INSERT inside the same batch is atomic on Turso.
  async save(cfg, snapshot){
    try{
      const byTable = snapshotToRows(snapshot);
      const stmts = [];
      for(const t of TABLE_NAMES){
        stmts.push({ sql:`DELETE FROM "${t}"` });
        for(const { id, cols, data } of byTable[t]){
          const keys = Object.keys(cols);
          const colList = ['id', ...keys.map(k=>`"${k}"`), 'data'].join(',');
          const ph = ['?', ...keys.map(()=>'?'), '?'].join(',');
          const args = [arg(id), ...keys.map(k=>arg(cols[k])), arg(data)];
          stmts.push({ sql:`INSERT INTO "${t}"(${colList}) VALUES(${ph})`, args });
        }
      }
      const meta = metaRows(snapshot);
      meta.forEach(m=>stmts.push({ sql:`INSERT OR REPLACE INTO "${META_TABLE}"(key,value) VALUES(?,?)`, args:[arg(m.key), arg(m.value)] }));
      await pipeline(cfg, stmts);
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },
};
