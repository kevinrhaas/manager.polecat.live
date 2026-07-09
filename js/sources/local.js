// -----------------------------------------------------------------------
// sources/local.js — the default DataSource: this browser's localStorage.
//
// It is a first-class adapter like any other (so the rail can say "Local"
// with the same machinery it uses for a remote), but it is special in one
// way: the Store ALREADY persists the working copy to this same key on every
// mutation, so when Local is the active source, sync.js does no write-through
// — Local.save() is a no-op and the Store's own _save() is the durable write.
// -----------------------------------------------------------------------

import { emptySnapshot, APP_ID, SCHEMA_VERSION, TABLE_NAMES } from './schema.js';

// The Store's working-copy key (kept in sync with store.js LS_KEY).
const LS_KEY = 'manager.workspace.v1';

function readDb(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }catch{ return null; }
}

// Convert the Store's id-keyed _db into a portable snapshot.
function dbToSnapshot(db){
  if(!db || !db.projects) return null;
  const snap = emptySnapshot();
  TABLE_NAMES.forEach(t=>{ snap.tables[t] = Object.values(db[t]||{}); });
  snap.settings = db.settings || {};
  snap.meta = db.meta || {};
  return snap;
}

export const localSource = {
  id:'local',
  label:'Local (this browser)',
  blurb:'Data lives in this browser only. Fast, private, no setup — but it doesn’t travel to other devices.',
  icon:'db',
  accent:'var(--brand-b)',
  browserProvision:true,
  local:true,
  fields:[],
  docsUrl:'',

  async test(){ return { ok:true }; },

  async probe(){
    const db = readDb();
    const snap = dbToSnapshot(db);
    const tables = snap ? TABLE_NAMES.map(t=>({ name:t, count:snap.tables[t].length })) : [];
    return { state: snap ? 'polecat' : 'empty', app:APP_ID, schemaVersion:SCHEMA_VERSION, tables };
  },

  async provision(){ return { ok:true }; },      // Store seeds itself on first load
  async summarize(){ return this.probe(); },
  async drop(){ try{ localStorage.removeItem(LS_KEY); }catch{} return { ok:true }; },

  async load(){ return dbToSnapshot(readDb()) || emptySnapshot(); },
  async save(){ return { ok:true }; },           // Store._save() is the real write
};
