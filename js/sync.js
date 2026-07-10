// -----------------------------------------------------------------------
// sync.js — the data-source connection manager + write-through mirror.
//
// This is the glue between the Store (a synchronous, in-memory, localStorage-
// backed workspace) and a pluggable remote DataSource. The model is a
// WRITE-THROUGH MIRROR:
//   • the working copy the app reads/writes is ALWAYS local + synchronous
//     (so no view ever has to become async), and
//   • when a remote is connected, every mutation is mirrored up to it on a
//     short debounce, and reconnecting from another browser pulls it back.
//
// The active connection (source id + its credentials) lives in localStorage —
// a static app has nowhere else to keep it. That is called out in the UI.
//
// Nothing here is Manager-specific beyond the Store import; the connection
// state machine + write-through is exactly what other Polecat apps adopting
// this layer will reuse.
// -----------------------------------------------------------------------

import { Store } from './store.js';
import { sourceById, localSource } from './sources/index.js';

const CONN_KEY = 'manager.datasource.v1';
const DEBOUNCE_MS = 1200;

// status: 'local'      — no remote; the Store's own localStorage is it
//         'connecting' — loading/adopting a remote right now
//         'connected'  — mirrored and idle
//         'syncing'    — a write-through push is in flight
//         'error'      — last push/load failed (still usable locally)
const state = {
  sourceId:'local', label:'Local', status:'local',
  lastError:'', lastPushAt:0, cfg:null,
};

let _suspend = false;          // guard: ignore Store changes we caused ourselves
let _timer = null;
let _inflight = false;
let _dirty = false;
const listeners = new Set();

function emit(){ listeners.forEach(fn=>{ try{ fn(publicState()); }catch(e){ console.error(e); } }); }
export function onSync(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }

export function syncState(){ return publicState(); }
// The active connection's credentials, for pre-filling the edit form. Kept out
// of syncState() (which feeds the rail) so secrets aren't sprayed everywhere.
export function currentConfig(){ return state.cfg ? { ...state.cfg } : null; }
function publicState(){
  const src = sourceById(state.sourceId) || localSource;
  return { sourceId:state.sourceId, label:src.label, source:src,
    status:state.status, isRemote:!src.local, lastError:state.lastError, lastPushAt:state.lastPushAt };
}

function setStatus(status, err=''){ state.status=status; state.lastError=err; emit(); }

// ---- persisted connection ----------------------------------------------
function saveConn(){
  try{
    if(state.sourceId==='local') localStorage.removeItem(CONN_KEY);
    else localStorage.setItem(CONN_KEY, JSON.stringify({ sourceId:state.sourceId, cfg:state.cfg, at:Date.now() }));
  }catch{}
}
function loadConn(){
  try{ return JSON.parse(localStorage.getItem(CONN_KEY)||'null'); }catch{ return null; }
}

// ---- write-through -------------------------------------------------------
function schedulePush(){
  if(state.sourceId==='local') return;          // local needs no mirror
  _dirty = true;
  clearTimeout(_timer);
  _timer = setTimeout(flushPush, DEBOUNCE_MS);
}

async function flushPush(){
  if(state.sourceId==='local' || _inflight || !_dirty) return;
  const src = sourceById(state.sourceId);
  if(!src) return;
  _inflight = true; _dirty = false;
  setStatus('syncing');
  try{
    const res = await src.save(state.cfg, Store.snapshot());
    if(res && res.ok===false) throw new Error(res.error||'write failed');
    state.lastPushAt = Date.now();
    setStatus('connected');
  }catch(e){
    _dirty = true;                              // keep it pending for a retry
    setStatus('error', e.message||'sync failed');
  }finally{
    _inflight = false;
    if(_dirty && state.status!=='error') schedulePush();
  }
}

// Force an immediate flush of any pending write (used before the app closes).
export async function pushNow(){ clearTimeout(_timer); await flushPush(); }

// Pull the remote's current contents and adopt them, replacing the working
// copy. This is the ONLY thing automation doesn't already do: writes mirror up
// automatically, but there's no live subscription, so a change made from
// another browser/device isn't seen until you refresh. Flushes any pending
// local write first so a just-made edit isn't lost to the incoming snapshot.
export async function pullNow(){
  if(state.sourceId==='local') return publicState();
  const src = sourceById(state.sourceId); if(!src) return publicState();
  await pushNow();
  setStatus('connecting');
  _suspend = true;
  try{
    const snap = await src.load(state.cfg);
    Store.replaceAll(snap);
    setStatus('connected');
  }catch(e){ setStatus('error', e.message||'refresh failed'); }
  finally{ _suspend = false; }
  return publicState();
}

// Update the credentials of the CURRENT connection in place (edit source),
// re-loading from the remote with the new config and persisting it.
export async function updateConnection(cfg){
  if(state.sourceId==='local') return publicState();
  return connectAdopt(state.sourceId, cfg);
}

// ---- connect / disconnect ------------------------------------------------
// Adopt an EXISTING Polecat workspace on a remote: pull it down and make it
// the working copy. From here on, local mutations mirror back up to it.
export async function connectAdopt(sourceId, cfg){
  const src = sourceById(sourceId); if(!src) throw new Error('unknown source');
  setStatus('connecting');
  _suspend = true;
  try{
    const snap = await src.load(cfg);
    Store.replaceAll(snap);
  } finally { _suspend = false; }
  state.sourceId=sourceId; state.cfg=cfg; saveConn();
  setStatus('connected');
  return publicState();
}

// Connect to an EMPTY (freshly provisioned) remote by pushing the current
// local workspace up as its initial contents.
export async function connectPush(sourceId, cfg){
  const src = sourceById(sourceId); if(!src) throw new Error('unknown source');
  setStatus('connecting');
  state.sourceId=sourceId; state.cfg=cfg;
  try{
    const res = await src.save(cfg, Store.snapshot());
    if(res && res.ok===false) throw new Error(res.error||'initial push failed');
    state.lastPushAt=Date.now(); saveConn(); setStatus('connected');
  }catch(e){
    state.sourceId='local'; state.cfg=null;     // roll back on failure
    setStatus('error', e.message); throw e;
  }
  return publicState();
}

// Detach from the remote and go back to local-only. The current working copy
// stays exactly as it is (you keep a local copy of whatever was loaded) — we
// simply stop mirroring.
export function disconnect(){
  clearTimeout(_timer);
  state.sourceId='local'; state.cfg=null; state.lastError=''; state.lastPushAt=0;
  saveConn();
  setStatus('local');
  return publicState();
}

// ---- boot ----------------------------------------------------------------
// Called once after the Store is ready. Restores a saved remote connection by
// pulling it fresh (the remote is the source of truth), and starts the
// write-through subscription. On any failure we stay usable on the local
// working copy and surface the error.
export async function initSync(){
  // mirror every Store mutation up to the active remote
  Store.on('change', ()=>{ if(!_suspend) schedulePush(); });

  const conn = loadConn();
  if(!conn || !conn.sourceId || conn.sourceId==='local'){ setStatus('local'); return publicState(); }
  const src = sourceById(conn.sourceId);
  if(!src){ setStatus('local'); return publicState(); }

  state.sourceId=conn.sourceId; state.cfg=conn.cfg;
  setStatus('connecting');
  _suspend = true;
  try{
    const snap = await src.load(conn.cfg);
    Store.replaceAll(snap);
    setStatus('connected');
  }catch(e){
    // couldn't reach the remote — keep the mirrored local copy, flag it
    setStatus('error', (e.message||'could not reach source')+' — working from the local mirror');
  } finally { _suspend = false; }
  return publicState();
}
