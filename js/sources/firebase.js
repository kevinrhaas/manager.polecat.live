// -----------------------------------------------------------------------
// sources/firebase.js — Firebase (Cloud Firestore, REST).
//
// Firestore is schemaless: "objects" are collections, created implicitly on
// first write, so browserProvision is true and provision() just stamps the
// marker document. Each workspace table maps to a collection; each row is a
// document keyed by its id, storing the whole row as a single JSON `data`
// field (so arbitrary nested row shapes survive without mapping every field
// to a Firestore typed value).
//
// A working scaffold: reads/writes are real Firestore REST. It needs a live
// project + security rules that permit the access (or, later, an auth token
// once Polecat grows users) to validate end to end — which this environment
// can't do.
// -----------------------------------------------------------------------

import { APP_ID, SCHEMA_VERSION, META_TABLE, emptySnapshot, TABLE_NAMES } from './schema.js';
import { cellsToRow } from './base.js';

function docBase(cfg){
  const pid = (cfg.projectId||'').trim();
  if(!pid) throw new Error('Project ID is required');
  return `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
}
const keyParam = (cfg)=> cfg.apiKey ? `?key=${encodeURIComponent(cfg.apiKey.trim())}` : '';

async function fs(cfg, path, opts={}){
  let res;
  try{ res = await fetch(docBase(cfg)+path+keyParam(cfg), { ...opts, headers:{ 'Content-Type':'application/json', ...(opts.headers||{}) } }); }
  catch(e){ throw new Error('Could not reach Firestore (network or CORS): '+e.message); }
  if(res.status===401 || res.status===403) throw new Error('Firestore denied access (401/403) — check the API key and security rules');
  return res;
}

async function listCollectionIds(cfg){
  try{
    const res = await fetch(docBase(cfg)+':listCollectionIds'+keyParam(cfg), { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
    if(!res.ok) return [];
    const j = await res.json(); return j.collectionIds||[];
  }catch{ return []; }
}

// row <-> Firestore document (single stringValue field `data`)
const toDoc = (row)=>({ fields:{ data:{ stringValue: JSON.stringify(row) } } });
const fromDoc = (doc)=> cellsToRow(doc?.fields?.data?.stringValue || '');

async function readCollection(cfg, name){
  const out = [];
  let pageToken = '';
  do{
    const res = await fs(cfg, `/${name}?pageSize=300${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`);
    if(res.status===404) break;
    if(!res.ok) break;
    const j = await res.json();
    (j.documents||[]).forEach(d=>{ const r = fromDoc(d); if(r) out.push(r); });
    pageToken = j.nextPageToken || '';
  }while(pageToken);
  return out;
}

async function writeDoc(cfg, coll, id, body){
  return fs(cfg, `/${coll}/${encodeURIComponent(id)}`, { method:'PATCH', body: JSON.stringify(body) });
}

export const firebaseSource = {
  id:'firebase',
  label:'Firebase',
  blurb:'Cloud Firestore document store. Schemaless — collections appear on first write. Reads/writes run from the browser under your security rules.',
  icon:'db',
  accent:'#ffca28',
  browserProvision:true,
  fields:[
    { key:'projectId', label:'Project ID', placeholder:'your-firebase-project', type:'text',
      hint:'Firebase console → Project settings → Project ID.' },
    { key:'apiKey', label:'Web API key', placeholder:'AIza… (optional if rules are open)', type:'password',
      hint:'Project settings → General → Web API key. Access is governed by your Firestore security rules.' },
  ],
  docsUrl:'https://firebase.google.com/docs/firestore/use-rest-api',

  async test(cfg){
    try{ await fs(cfg, `/${META_TABLE}/app`); return { ok:true }; }
    catch(e){ return { ok:false, error:e.message }; }
  },

  async probe(cfg){
    let markerOk=false, app=null, schemaVersion=null;
    try{
      const res = await fs(cfg, `/${META_TABLE}/app`);
      if(res.ok){ const d = await res.json(); const r = fromDoc(d); if(r){ markerOk=true; app=r.app; schemaVersion=r.schemaVersion; } }
    }catch{}
    const colls = await listCollectionIds(cfg);
    if(markerOk){
      const tables = [];
      for(const t of TABLE_NAMES){ tables.push({ name:t, count: colls.includes(t) ? (await readCollection(cfg,t)).length : 0 }); }
      return { state:'polecat', app, schemaVersion, tables };
    }
    if(!colls.length) return { state:'empty', tables:[] };
    return { state:'foreign', tables: colls.map(name=>({ name, count:0 })) };
  },

  async provision(cfg, snapshot){
    try{
      await writeDoc(cfg, META_TABLE, 'app', toDoc({ app:APP_ID, schemaVersion:SCHEMA_VERSION }));
      await writeDoc(cfg, META_TABLE, 'settings', toDoc({ settings:snapshot?.settings||{} }));
      await writeDoc(cfg, META_TABLE, 'meta', toDoc({ meta:snapshot?.meta||{} }));
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },

  async summarize(cfg){ return this.probe(cfg); },

  async drop(cfg){
    try{
      const colls = await listCollectionIds(cfg);
      for(const c of colls){
        const docs = await readCollection(cfg, c);
        for(const r of docs) await fs(cfg, `/${c}/${encodeURIComponent(r.id)}`, { method:'DELETE' });
        // also nuke non-row docs in the marker collection
        if(c===META_TABLE) for(const k of ['app','settings','meta']) await fs(cfg, `/${META_TABLE}/${k}`, { method:'DELETE' });
      }
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },

  async load(cfg){
    const snap = emptySnapshot();
    for(const t of TABLE_NAMES){ snap.tables[t] = await readCollection(cfg, t); }
    try{
      const sres = await fs(cfg, `/${META_TABLE}/settings`); if(sres.ok){ const r = fromDoc(await sres.json()); if(r?.settings) snap.settings = r.settings; }
      const mres = await fs(cfg, `/${META_TABLE}/meta`);     if(mres.ok){ const r = fromDoc(await mres.json()); if(r?.meta) snap.meta = r.meta; }
    }catch{}
    return snap;
  },

  async save(cfg, snapshot){
    try{
      for(const t of TABLE_NAMES){
        const rows = snapshot.tables[t]||[];
        // upsert current rows; then delete any doc no longer present
        const keep = new Set(rows.map(r=>r.id));
        for(const r of rows) await writeDoc(cfg, t, r.id, toDoc(r));
        const existing = await readCollection(cfg, t);
        for(const r of existing) if(!keep.has(r.id)) await fs(cfg, `/${t}/${encodeURIComponent(r.id)}`, { method:'DELETE' });
      }
      await writeDoc(cfg, META_TABLE, 'settings', toDoc({ settings:snapshot.settings||{} }));
      await writeDoc(cfg, META_TABLE, 'meta', toDoc({ meta:snapshot.meta||{} }));
      return { ok:true };
    }catch(e){ return { ok:false, error:e.message }; }
  },
};
