// -----------------------------------------------------------------------
// sources/supabase.js — Supabase (Postgres + PostgREST).
//
// Supabase's browser-facing API is PostgREST, which does DATA (select /
// insert / upsert / delete) but NOT schema DDL — you can't CREATE TABLE with
// an anon key. So this adapter splits the difference the honest way:
//   • provisioning is a ONE-TIME "paste this SQL into the Supabase SQL editor"
//     step (browserProvision:false → provision() returns the script), and
//   • everything after that — probe, load, save, drop — is native browser REST.
//
// This is a working scaffold: the data plane is real; it wants a live project
// + anon key to validate end to end (which this build environment can't do).
// -----------------------------------------------------------------------

import { provisionDDL, metaRows, META_TABLE, APP_ID, SCHEMA_VERSION,
         emptySnapshot, TABLE_NAMES } from './schema.js';
import { snapshotToRows, cellsToRow } from './base.js';

function restBase(cfg){
  let u = (cfg.url||'').trim().replace(/\/+$/,'');
  if(!u) throw new Error('Project URL is required');
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u + '/rest/v1';
}
function headers(cfg, extra){
  const key = (cfg.key||'').trim();
  return { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', ...extra };
}
async function rest(cfg, path, opts={}){
  let res;
  try{ res = await fetch(restBase(cfg)+path, { ...opts, headers: headers(cfg, opts.headers) }); }
  catch(e){ throw new Error('Could not reach Supabase (network or CORS): '+e.message); }
  if(res.status===401 || res.status===403) throw new Error('Supabase rejected the API key (401/403)');
  return res;
}

export const supabaseSource = {
  id:'supabase',
  label:'Supabase',
  blurb:'Postgres with a REST API. Data reads/writes run from the browser; first-time setup is a one-time SQL script you paste into Supabase.',
  icon:'db',
  accent:'#3ecf8e',
  browserProvision:false,
  fields:[
    { key:'url', label:'Project URL', placeholder:'https://YOUR-REF.supabase.co', type:'text',
      hint:'Settings → API → Project URL.' },
    { key:'key', label:'anon public key', placeholder:'eyJ… (anon public)', type:'password',
      hint:'Settings → API → Project API keys → anon public. Row-Level Security governs what it can touch.' },
  ],
  docsUrl:'https://supabase.com/docs/guides/api',

  async test(cfg){
    try{ await rest(cfg, `/${META_TABLE}?select=key&limit=1`); return { ok:true }; }
    catch(e){ return { ok:false, error:e.message }; }
  },

  async probe(cfg){
    // PostgREST can't enumerate tables with an anon key, so we probe our marker
    // directly: present + app row → ours; absent → treat as not-yet-provisioned.
    let res;
    try{ res = await rest(cfg, `/${META_TABLE}?select=key,value`); }
    catch(e){ return { state:'empty', note:e.message }; }
    if(res.status===404 || res.status===400) return { state:'empty' };   // relation missing
    if(!res.ok) return { state:'empty', note:`HTTP ${res.status}` };
    const meta = await res.json().catch(()=>[]);
    const app = meta.find?.(m=>m.key==='app')?.value;
    const schemaVersion = Number(meta.find?.(m=>m.key==='schema_version')?.value) || null;
    const tables = [];
    for(const t of TABLE_NAMES){
      try{
        const r = await rest(cfg, `/${t}?select=id`, { headers:{ Prefer:'count=exact', Range:'0-0' } });
        const cr = r.headers.get('content-range');            // "0-0/123"
        tables.push({ name:t, count: cr ? Number(cr.split('/')[1])||0 : 0 });
      }catch{ tables.push({ name:t, count:0 }); }
    }
    return { state:'polecat', app, schemaVersion, tables };
  },

  // Can't DDL from the browser — hand back a ready-to-paste bootstrap. The
  // caller shows it with a "I've run it" button that re-probes.
  async provision(cfg, snapshot){
    const meta = metaRows(snapshot);
    const sql = [
      '-- Polecat workspace bootstrap — run once in Supabase → SQL editor.',
      ...provisionDDL().map(s=>s+';'),
      ...meta.map(m=>`INSERT INTO "${META_TABLE}"(key,value) VALUES(${sqlLit(m.key)}, ${sqlLit(m.value)}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;`),
      '',
      '-- Then enable Row-Level Security policies appropriate to your project',
      '-- before exposing the anon key beyond your own use.',
    ].join('\n');
    return { ok:false, manual:true, sql };
  },

  async summarize(cfg){ return this.probe(cfg); },

  async drop(cfg){
    // No DDL over REST — deleting the DATA is the browser-reachable "reset".
    try{
      for(const t of TABLE_NAMES) await rest(cfg, `/${t}?id=not.is.null`, { method:'DELETE' });
      return { ok:true, dataOnly:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },

  async load(cfg){
    const snap = emptySnapshot();
    for(const t of TABLE_NAMES){
      try{
        const r = await rest(cfg, `/${t}?select=data`);
        if(r.ok){ const rows = await r.json(); snap.tables[t] = rows.map(x=>cellsToRow(typeof x.data==='string'?x.data:JSON.stringify(x.data))).filter(Boolean); }
      }catch{}
    }
    try{
      const r = await rest(cfg, `/${META_TABLE}?select=key,value`);
      if(r.ok){ const meta = await r.json();
        meta.forEach(m=>{ if(m.key==='settings'){ try{ snap.settings=JSON.parse(m.value); }catch{} } if(m.key==='meta'){ try{ snap.meta=JSON.parse(m.value); }catch{} } }); }
    }catch{}
    return snap;
  },

  async save(cfg, snapshot){
    try{
      const byTable = snapshotToRows(snapshot);
      for(const t of TABLE_NAMES){
        // replace-all: clear then bulk upsert (metadata-sized, so this is fine)
        await rest(cfg, `/${t}?id=not.is.null`, { method:'DELETE' });
        const rows = byTable[t].map(({ id, cols, data })=>({ id, ...cols, data }));
        if(rows.length){
          await rest(cfg, `/${t}`, { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify(rows) });
        }
      }
      const meta = metaRows(snapshot).map(m=>({ key:m.key, value:m.value }));
      await rest(cfg, `/${META_TABLE}`, { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' }, body: JSON.stringify(meta) });
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },
};

function sqlLit(s){ return `'${String(s).replace(/'/g,"''")}'`; }
