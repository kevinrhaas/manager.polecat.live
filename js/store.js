// -----------------------------------------------------------------------
// store.js — the relational data layer.
//
// Everything is modeled as SQLite-shaped tables: each table is a map of
// id -> row, and every row carries an `updatedAt`. That means this whole
// module can be swapped for a real SQLite/IndexedDB backend later without
// changing a single view. For now it persists to one localStorage blob.
//
// Tables:
//   projects     the fleet — one row per managed repo/site
//   releases     per-project "what's new" entries (a project's changelog)
//   credentials  shared (scope 'global') or per-project config/secrets
//   runs         the self-improvement cadence log (feature / sweep / …)
//   fieldDefs    the fleet-wide schema for custom project metadata fields
//   savedViews   user-defined library filter+sort combos, shown as chips
//
// Plus `settings` (app preferences) and a bounded `history` stack for undo.
// -----------------------------------------------------------------------

import { uuid, slugify } from './ui.js';

const LS_KEY   = 'manager.workspace.v1';
const HIST_KEY = 'manager.history.v1';
const TABLES   = ['projects', 'releases', 'credentials', 'runs', 'fieldDefs', 'savedViews', 'dismissals'];
// Tables a merge import (see mergeImport() below) will add new rows to —
// everything except `dismissals`, which is local per-browser notification
// state that doesn't mean anything ported from someone else's workspace.
const MERGE_TABLES = TABLES.filter(t=>t!=='dismissals');
const HIST_MAX = 40;

// A JSON.stringify with object keys sorted, so two rows with identical
// content built in a different key order (spread-construction order isn't
// guaranteed to match across browsers/versions) compare equal — used by
// Store._rowsDiffer() to decide whether a merge-import row actually changed.
function stableStringify(v){
  if(Array.isArray(v)) return '['+v.map(stableStringify).join(',')+']';
  if(v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}';
  return JSON.stringify(v);
}

// A project's status is an editorial signal you set — it is NOT changed by
// syncing (sync only pulls releases / "what's new"). The `desc` shows as a
// hover tooltip so the difference between statuses is always explained.
export const STATUSES = {
  live:     { label:'Live',     cls:'s-live',     desc:'Shipping to production — deployed and in active use.' },
  active:   { label:'Active',   cls:'s-active',   desc:'Actively worked on, but not a single deployed site (e.g. a workspace or multi-project repo).' },
  building: { label:'Building', cls:'s-building', desc:'In active development toward its first or next launch — not fully live yet.' },
  paused:   { label:'Paused',   cls:'s-paused',   desc:'On hold — no active work right now, but not retired.' },
  idea:     { label:'Idea',     cls:'s-idea',     desc:'A concept you haven’t started building yet.' },
  archived: { label:'Archived', cls:'s-archived', desc:'Retired — kept for reference, no longer worked on.' },
};

// Render a status pill with a hover tooltip explaining what the status means.
// Used everywhere a status is shown so they stay identical and self-documenting.
export function statusPill(status){
  const st = STATUSES[status] || STATUSES.idea;
  return `<span class="status ${st.cls}" title="${st.label} — ${st.desc}" tabindex="0" aria-label="Status: ${st.label}. ${st.desc}"><span class="dot"></span>${st.label}</span>`;
}

// Fleet health bands — a project's healthScore() (0-100) maps to exactly one
// of these, highest floor first. Shared between the dashboard tiles, the
// fleet-wide aggregate, and the project detail health panel so the label,
// color, and badge class always agree.
export const HEALTH_BANDS = [
  { min:80, label:'Thriving', cls:'h-great', color:'var(--success)' },
  { min:60, label:'Healthy',  cls:'h-good',  color:'var(--brand-b)' },
  { min:35, label:'Steady',   cls:'h-fair',  color:'var(--warning)' },
  { min:15, label:'Slowing',  cls:'h-weak',  color:'var(--danger)' },
  { min:0,  label:'Stale',    cls:'h-stale', color:'var(--text-3)' },
];
export function healthBand(score){ return HEALTH_BANDS.find(b=>score>=b.min) || HEALTH_BANDS[HEALTH_BANDS.length-1]; }

// Once a project's auto-sync fails this many times in a row it counts as
// "failing" rather than merely retrying — surfaced in the UI (health panel,
// dashboard tile, Settings roll-up, and needsAttention() below) instead of
// silently backing off forever. Defined here (not ingest.js) so this table's
// own health rollup and the ingestion module share one definition; ingest.js
// re-exports it for backward-compatible imports.
export const AUTO_SYNC_FAIL_THRESHOLD = 2;

// "Needs attention" thresholds — the two cutoffs behind Store.needsAttention():
// how low a health score has to sink, and how many auto-sync failures in a
// row, before a project is flagged. Tunable from Settings → "Needs attention"
// (same spirit as DEFAULT_HEALTH_WEIGHTS above); ship defaults reproduce the
// original fixed behavior exactly (Slowing/Stale = below the Steady band's
// floor of 35, and the auto-sync fail threshold just above).
export const DEFAULT_ATTENTION_THRESHOLDS = { healthMax: 35, autoSyncFails: AUTO_SYNC_FAIL_THRESHOLD };

// Auto-sync failure backoff cap — a project whose auto-sync keeps failing is
// retried less often each consecutive failure (doubling the wait), up to this
// many times the normal interval. Defined here (not ingest.js, which owns the
// doubling math itself) so it's tunable the same way as the thresholds above:
// fleet-wide from Settings → Auto-sync, with a per-project override for a
// source that's deliberately flakier or steadier than the fleet norm.
export const DEFAULT_AUTO_SYNC_BACKOFF_CAP = 8;

// A project's free-form "notes" scratchpad (Markdown) keeps this many prior
// versions in its revision trail (`notesHistory`, newest first) — capped so
// journaling paragraphs of context over months doesn't grow the row forever.
export const NOTES_HISTORY_MAX = 20;

// Typed custom-field schema (`fieldDefs` table) — a project's free-form
// `fields` map is keyed by a def's `key`, but the def gives it a real type so
// it can render, filter, and sort correctly instead of always being text.
export const FIELD_TYPES = {
  text:   { label:'Text' },
  number: { label:'Number' },
  url:    { label:'URL' },
  date:   { label:'Date' },
  select: { label:'Select' },
};

// Fleet health weighting — relative importance of each dimension in
// healthScore(). These are ratios, not fixed point caps: whatever a user sets
// them to, they're renormalized so the three always add up to 100 possible
// points. Ship defaults reproduce the original fixed weighting exactly
// (40 / 40 / 20 — recency and velocity equally important, status a tiebreaker).
export const DEFAULT_HEALTH_WEIGHTS = { recency:40, velocity:40, status:20 };

const DEFAULT_SETTINGS = {
  simpleMode: false,
  tourDone: false,
  wnTracked: { version:true, date:true, kind:true, items:true },
  wnSort: 'newest',
  autoSync: { enabled:false, intervalHours:6, backoffCap: DEFAULT_AUTO_SYNC_BACKOFF_CAP },
  // Derive a project's status from its release activity every time it syncs.
  // liveDays: newest release this recent → Live (has site) / Active (no site).
  // staleDays: newest release older than this → Paused. In-between = unchanged.
  autoStatus: { enabled:true, liveDays:45, staleDays:180 },
  healthWeights: { ...DEFAULT_HEALTH_WEIGHTS },
  attentionThresholds: { ...DEFAULT_ATTENTION_THRESHOLDS },
};

// ---- reactive core -------------------------------------------------------
export const Store = new (class {
  constructor(){
    this._listeners = {};
    this._db = this._load();
    this._history = this._loadHistory();
  }

  // ---- persistence -------------------------------------------------------
  _blank(){
    const db = { settings:{...DEFAULT_SETTINGS}, meta:{ seededAt:0 } };
    TABLES.forEach(t=>db[t]={});
    return db;
  }
  _load(){
    try{
      const raw = JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(raw && raw.projects){
        raw.settings = { ...DEFAULT_SETTINGS, ...(raw.settings||{}) };
        TABLES.forEach(t=>raw[t]=raw[t]||{});
        raw.meta = raw.meta||{};
        return raw;
      }
    }catch{}
    const db = this._blank();
    seed(db);
    try{ localStorage.setItem(LS_KEY, JSON.stringify(db)); }catch{}
    return db;
  }
  _save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(this._db)); }catch{} }
  // Older persisted ops predate `hid` (added for the "Recently deleted" tray,
  // which needs to address one op among many stably — an array index shifts
  // under it the moment anything else pushes/pops history). Backfilled once
  // on load rather than migrated in place, since it only needs to be unique
  // for the life of this session.
  _loadHistory(){ try{ const h=JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); h.forEach(op=>{ if(!op.hid) op.hid=uuid(); }); return h; }catch{ return []; } }
  _saveHistory(){ try{ localStorage.setItem(HIST_KEY, JSON.stringify(this._history.slice(-HIST_MAX))); }catch{} }

  // ---- events ------------------------------------------------------------
  on(evt, fn){ (this._listeners[evt]||=[]).push(fn); return ()=>{ this._listeners[evt]=this._listeners[evt].filter(f=>f!==fn); }; }
  emit(evt, payload){
    // Inside a batch(), coalesce: record the event but don't dispatch yet, so a
    // bulk operation (e.g. the Projects background refresh writing releases for
    // every project) doesn't repaint reactive views once PER write across its
    // awaits — which paints a flash each time. batch() replays each distinct
    // event once at the end, synchronously, so the browser paints just once.
    if(this._batching){ this._batchEvents.add(evt); return; }
    (this._listeners[evt]||[]).forEach(f=>{ try{ f(payload); }catch(e){ console.error(e); } });
    (this._listeners['*']||[]).forEach(f=>f(evt,payload));
  }
  // Run fn (sync or async) with reactive re-renders deferred until it settles.
  // Writes still persist immediately; only listener dispatch is held. Nesting
  // is reference-counted so an inner batch doesn't flush early.
  async batch(fn){
    const outer = this._batching;
    if(!outer){ this._batching = true; this._batchEvents = new Set(); }
    try{ return await fn(); }
    finally{
      if(!outer){
        this._batching = false;
        const evts = this._batchEvents; this._batchEvents = null;
        evts.forEach(evt => {
          (this._listeners[evt]||[]).forEach(f=>{ try{ f({ batched:true }); }catch(e){ console.error(e); } });
          (this._listeners['*']||[]).forEach(f=>f(evt, { batched:true }));
        });
      }
    }
  }

  // ---- generic table ops -------------------------------------------------
  all(table){ return Object.values(this._db[table]||{}); }
  get(table, id){ return (this._db[table]||{})[id] || null; }

  // Upsert a row. Records an inverse op for undo unless {silent}. Returns the row.
  put(table, row, { silent=false, label='' }={}){
    if(!row.id) row.id = uuid();
    const prev = this._db[table][row.id] || null;
    row.updatedAt = Date.now();
    if(!row.createdAt) row.createdAt = prev?.createdAt || row.updatedAt;
    this._db[table][row.id] = row;
    if(!silent) this._pushHistory({ table, id:row.id, prev, label: label || (prev?'Edit':'Add') });
    this._save();
    this.emit('change', { table, id:row.id });
    this.emit(table, { id:row.id });
    return row;
  }
  // Apply `patchFn` to many rows at once, recorded as ONE undo step (not one
  // per row) so a single "Undo" reverts every row together. `patchFn(row)`
  // returns the patched row, or a falsy value to leave that row untouched
  // (e.g. it already has the tag being bulk-added) — untouched rows are
  // skipped entirely, including from the undo record. Returns the count of
  // rows actually changed; pushes no history (and fires no events) if none were.
  bulkUpdate(table, ids, patchFn, { label='Bulk edit' }={}){
    const items=[];
    ids.forEach(id=>{
      const prev=this._db[table][id];
      if(!prev) return;
      const next=patchFn(prev);
      if(!next) return;
      next.id=id;
      next.updatedAt=Date.now();
      next.createdAt=prev.createdAt||next.updatedAt;
      this._db[table][id]=next;
      items.push({ id, prev });
    });
    if(!items.length) return 0;
    this._pushHistory({ table, items, label });
    this._save();
    items.forEach(({id})=>{ this.emit('change',{table,id}); this.emit(table,{id}); });
    return items.length;
  }
  // Cascade helper for deleting a project: also removes its releases, scoped
  // credentials, and dismissals. Returns the removed rows so the caller can
  // both delete them and record them for undo.
  _cascadeFor(table, id){
    const cascade = [];
    if(table==='projects'){
      for(const t of ['releases','credentials','dismissals']){
        for(const r of Object.values(this._db[t])){
          if(r.projectId===id || r.scope===id){ cascade.push({ table:t, row:r }); delete this._db[t][r.id]; }
        }
      }
    }
    return cascade;
  }
  remove(table, id, { silent=false, label='Delete' }={}){
    const prev = this._db[table][id];
    if(!prev) return;
    delete this._db[table][id];
    const cascade = this._cascadeFor(table, id);
    if(!silent) this._pushHistory({ table, id, prev, cascade, label });
    this._save();
    this.emit('change', { table, id });
    this.emit(table, { id });
  }
  // Delete many rows at once, recorded as ONE undo step — mirrors
  // bulkUpdate()'s single-history-entry shape, but each item also carries its
  // own cascade (bulkUpdate's patch-based items have no cascade of their own,
  // since patching a row never deletes related rows). Returns the count of
  // rows actually removed.
  bulkRemove(table, ids){
    const items=[];
    ids.forEach(id=>{
      const prev=this._db[table][id];
      if(!prev) return;
      delete this._db[table][id];
      const cascade=this._cascadeFor(table, id);
      items.push({ id, prev, cascade });
    });
    if(!items.length) return 0;
    this._pushHistory({ table, items, label:'Delete' });
    this._save();
    items.forEach(({id})=>{ this.emit('change',{table,id}); this.emit(table,{id}); });
    return items.length;
  }

  // ---- history / undo ----------------------------------------------------
  _pushHistory(op){ this._history.push({ ...op, at:Date.now(), hid:uuid() }); if(this._history.length>HIST_MAX) this._history=this._history.slice(-HIST_MAX); this._saveHistory(); this.emit('history'); }
  canUndo(){ return this._history.length>0; }
  lastLabel(){ const o=this._history[this._history.length-1]; return o?o.label:''; }
  undo(){
    const op = this._history.pop();
    if(!op) return null;
    this._saveHistory();
    // reverse: restore prev (or delete if there was none) for every row the
    // op touched — `items` (bulk ops, see bulkUpdate/bulkRemove), `tables`
    // (a merge import spanning several tables at once, see mergeImport()),
    // or the single id/prev/cascade shape every other op uses. Cascade rows
    // (a deleted row's releases/credentials/dismissals) restore alongside
    // their owning row, whether the cascade lives on the op itself (single
    // remove) or per-item (bulkRemove).
    const perTable = op.tables || { [op.table]: op.items || [{ id:op.id, prev:op.prev, cascade:op.cascade }] };
    Object.entries(perTable).forEach(([table, rows])=>{
      rows.forEach(({id,prev,cascade})=>{
        if(prev) this._db[table][id] = prev;
        else delete this._db[table][id];
        (cascade||[]).forEach(c=>{ this._db[c.table][c.row.id]=c.row; });
      });
      rows.forEach(({id})=>{ this.emit('change', { table, id }); this.emit(table, { id }); });
    });
    this.emit('history');
    return op;
  }
  // "Recently deleted" tray — undo only ever reverses the *most recent* op,
  // so a project deleted a few actions ago is only reachable by undoing
  // everything after it too. This scans the same history stack (nothing new
  // to persist) for delete-shaped ops on `projects` — a single remove()
  // (`{id,prev,cascade}`) or a bulkRemove() (`{items:[{id,prev,cascade}]}`),
  // both tagged with the 'Delete' label those two call sites already share —
  // and flattens them into one list, newest first.
  recentlyDeletedProjects(){
    const out=[];
    this._history.forEach(op=>{
      if(op.table!=='projects' || op.label!=='Delete') return;
      if(op.items) op.items.forEach(it=>{ if(it.prev) out.push({ hid:op.hid, id:it.id, project:it.prev, cascade:it.cascade, at:op.at }); });
      else if(op.prev) out.push({ hid:op.hid, id:op.id, project:op.prev, cascade:op.cascade, at:op.at });
    });
    return out.sort((a,b)=>b.at-a.at);
  }
  // Restores one project out of a delete op, addressed by the op's `hid` (see
  // `_pushHistory`) plus the project id — not an array index, since deleting
  // one row out of a batched bulk-delete op must leave the rest of that
  // batch's undo record intact for its own remaining rows. Removes just the
  // matched entry (and the whole op if that was its last row) rather than
  // reversing the op wholesale, so restoring one project from a 3-project
  // bulk delete doesn't also resurrect the other two.
  restoreDeletedProject(hid, id){
    const op = this._history.find(o=>o.hid===hid);
    if(!op) return null;
    let restored=null, cascade=[];
    if(op.items){
      const i=op.items.findIndex(it=>it.id===id);
      if(i<0) return null;
      restored=op.items[i].prev; cascade=op.items[i].cascade||[];
      op.items.splice(i,1);
      if(!op.items.length) this._history=this._history.filter(o=>o!==op);
    }else if(op.id===id && op.prev){
      restored=op.prev; cascade=op.cascade||[];
      this._history=this._history.filter(o=>o!==op);
    }
    if(!restored) return null;
    this._db.projects[restored.id]=restored;
    const touched=new Set(['projects']);
    cascade.forEach(c=>{ this._db[c.table][c.row.id]=c.row; touched.add(c.table); });
    this._saveHistory(); this._save();
    touched.forEach(t=>this.emit(t,{}));
    this.emit('change',{table:'projects', id:restored.id});
    this.emit('history');
    return restored;
  }

  // ---- settings ----------------------------------------------------------
  settings(){ return this._db.settings; }
  setSetting(key, val){ this._db.settings[key]=val; this._save(); this.emit('settings', { key }); }

  // ---- data-source bridge ------------------------------------------------
  // A portable, backend-neutral view of the whole workspace — the unit that
  // sync.js pushes to (and pulls from) a remote DataSource. Deliberately the
  // same shape sources/schema.js's emptySnapshot() defines, so an adapter
  // never needs to import the Store. Rows are plain arrays (not id-keyed).
  snapshot(){
    const tables={};
    TABLES.forEach(t=>{ tables[t]=Object.values(this._db[t]||{}); });
    return { app:'manager', schemaVersion:1, tables,
      settings:{ ...this._db.settings }, meta:{ ...this._db.meta } };
  }
  // Adopt a whole workspace loaded from a remote source, replacing the live
  // working copy. Re-keys each table's row array by id, merges settings over
  // the current defaults, persists locally (the working copy always mirrors
  // the active source), clears undo history (an undo across a source switch
  // is meaningless), and fires a broad change so every open view re-renders.
  replaceAll(snapshot){
    const db=this._blank();
    TABLES.forEach(t=>{ (snapshot.tables?.[t]||[]).forEach(r=>{ if(r&&r.id) db[t][r.id]=r; }); });
    db.settings={ ...DEFAULT_SETTINGS, ...(snapshot.settings||{}) };
    db.meta={ ...(snapshot.meta||{}) };
    this._db=db;
    this._history=[]; this._saveHistory();
    this._save();
    this.emit('change', { table:'*' });
    this.emit('replaced', {});
  }

  // ---- projects ----------------------------------------------------------
  projects(){ return this.all('projects'); }
  project(id){ return this.get('projects', id); }
  projectBySlug(slug){ return this.projects().find(p=>p.slug===slug) || null; }
  addProject(data){
    const slug = data.slug || slugify(data.name||'project');
    const row = { id:slug, slug, status:'idea', tags:[], icon:'grid', pinned:false, fields:{},
      name:'', repo:'', site:'', sessionUrl:'', description:'', assessment:'', cadence:'',
      autoSync:false, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:'',
      statusLocked:false, statusAuto:false, notes:'', notesHistory:[], ...data };
    row.id = row.slug = data.slug || slugify(row.name||slug);
    return this.put('projects', row, { label:'Add project' });
  }
  updateProject(id, patch, opts={}){ const p=this.project(id); if(!p) return; return this.put('projects', { ...p, ...patch }, { label:'Edit project', ...opts }); }
  togglePin(id){ const p=this.project(id); if(!p) return; return this.put('projects', { ...p, pinned:!p.pinned }, { silent:true }); }

  // ---- bulk actions (projects library multi-select) ----------------------
  // Every one of these is a single undo step covering the whole selection —
  // see bulkUpdate() above.
  bulkSetStatus(ids, status){
    const label=STATUSES[status]?.label||status;
    return this.bulkUpdate('projects', ids, p=>p.status===status?null:{ ...p, status }, { label:`Set status: ${label}` });
  }
  bulkArchive(ids){ return this.bulkSetStatus(ids, 'archived'); }
  // Skips (leaves untouched) any project that already carries the tag, so
  // undo only reverts the projects that actually gained it.
  bulkAddTag(ids, tag){
    const t=String(tag||'').trim();
    if(!t) return 0;
    return this.bulkUpdate('projects', ids, p=>{
      const tags=p.tags||[];
      return tags.includes(t) ? null : { ...p, tags:[...tags, t] };
    }, { label:`Add tag "${t}"` });
  }
  // Mirrors bulkAddTag() exactly: same bulkUpdate() grouped-undo plumbing,
  // same "skip a row that doesn't have the tag" no-op rule, so undo never
  // "reverts" a project that never carried it.
  bulkRemoveTag(ids, tag){
    const t=String(tag||'').trim();
    if(!t) return 0;
    return this.bulkUpdate('projects', ids, p=>{
      const tags=p.tags||[];
      return tags.includes(t) ? { ...p, tags:tags.filter(x=>x!==t) } : null;
    }, { label:`Remove tag "${t}"` });
  }
  // Every distinct tag in use across the whole fleet, with how many projects
  // carry it — the fleet-wide vocabulary behind Settings' "Tags" manager,
  // sorted most-used first (ties broken alphabetically) so the tags someone's
  // most likely to want to rename or clean up surface at the top.
  allTags(){
    const counts={};
    this.projects().forEach(p=>(p.tags||[]).forEach(t=>{ counts[t]=(counts[t]||0)+1; }));
    return Object.entries(counts).map(([tag,count])=>({tag,count}))
      .sort((a,b)=>b.count-a.count || a.tag.localeCompare(b.tag));
  }
  // Renames a tag across every project that carries it, in one grouped undo
  // step (same bulkUpdate() plumbing as bulkAddTag/bulkRemoveTag above).
  // Renaming to a tag that already exists on a project merges the two
  // (deduped via Set) rather than leaving a project with the same tag twice.
  renameTag(from, to){
    const f=String(from||'').trim(), t=String(to||'').trim();
    if(!f || !t || f===t) return 0;
    return this.bulkUpdate('projects', this.projects().map(p=>p.id), p=>{
      const tags=p.tags||[];
      if(!tags.includes(f)) return null;
      return { ...p, tags:[...new Set(tags.map(x=>x===f?t:x))] };
    }, { label:`Rename tag "${f}" → "${t}"` });
  }

  // ---- custom field definitions (typed project-metadata schema) ---------
  fieldDefs(){ return this.all('fieldDefs').sort((a,b)=>(a.order||0)-(b.order||0)); }
  fieldDef(id){ return this.get('fieldDefs', id); }
  addFieldDef(data){
    const key = slugify(data.label||'field');
    if(!key) throw new Error('Give the field a name.');
    if(this.fieldDefs().some(f=>f.key===key)) throw new Error('A field with that name already exists.');
    const order = this.fieldDefs().length;
    return this.put('fieldDefs', { type:'text', options:[], order, ...data, key }, { label:'Add field' });
  }
  updateFieldDef(id, patch){ const f=this.fieldDef(id); if(!f) return; return this.put('fieldDefs', { ...f, ...patch }, { label:'Edit field' }); }
  removeFieldDef(id, opts={}){ return this.remove('fieldDefs', id, { label:'Remove field', ...opts }); }
  // Re-sequence every field def to a new display order — `orderedIds` is
  // every fieldDefs id, in the order they should now appear everywhere
  // fieldDefs() is read (Settings' schema list, the project editor/detail
  // page, and the library's field filter/sort dropdowns). One grouped undo
  // step via bulkUpdate, same as any other batch edit — dragging one row is
  // a single action, not N. Rows whose order doesn't actually change are
  // skipped (bulkUpdate's own no-op rule), so a no-op drag pushes no history.
  reorderFieldDefs(orderedIds){
    return this.bulkUpdate('fieldDefs', orderedIds, (f)=>{
      const order = orderedIds.indexOf(f.id);
      return order===f.order ? null : { ...f, order };
    }, { label:'Reorder fields' });
  }

  // ---- saved views (user-defined library filter+sort combos) -------------
  // The built-in views (All/Live/Recent/Pinned/Needs attention) are a fixed
  // set defined in js/views/projects.js; these are ones a user has saved
  // themselves — a name plus the exact `state` (status/sort/dir/field/
  // fieldValue) the library was showing at save time — so a filter someone
  // reaches for often gets its own one-click chip instead of being rebuilt
  // by hand every time.
  savedViews(){ return this.all('savedViews').sort((a,b)=>(a.order??0)-(b.order??0)); }
  savedView(id){ return this.get('savedViews', id); }
  addSavedView(data){
    const order = this.savedViews().length;
    return this.put('savedViews', { label:'', icon:'star', state:{}, order, isDefault:false, ...data }, { label:'Save view' });
  }
  removeSavedView(id, opts={}){ return this.remove('savedViews', id, { label:'Delete saved view', ...opts }); }
  // Re-sequence saved views to a new display order — same shape as
  // reorderFieldDefs() (one grouped undo via bulkUpdate, no-op rows skipped),
  // just for the savedViews table, so which chip shows up first in the
  // library's saved-views strip is user-controllable.
  reorderSavedViews(orderedIds){
    return this.bulkUpdate('savedViews', orderedIds, (v)=>{
      const order = orderedIds.indexOf(v.id);
      return order===v.order ? null : { ...v, order };
    }, { label:'Reorder saved views' });
  }
  // The one saved view (if any) that should open automatically the next time
  // the library loads, instead of always falling back to whatever
  // `manager.lib.view` last held.
  defaultSavedView(){ return this.savedViews().find(v=>v.isDefault) || null; }
  // Mark `id` as the default saved view, clearing the flag off every other
  // one — at most one view can be default at a time. Pass `null` to just
  // clear whichever view currently holds it (a toggle-off). One grouped
  // undo step via bulkUpdate, same pattern as reorderSavedViews(); rows
  // whose flag doesn't actually change are skipped, so toggling the same
  // view on twice in a row (a no-op) pushes no history.
  setDefaultSavedView(id){
    return this.bulkUpdate('savedViews', this.savedViews().map(v=>v.id), (v)=>{
      const want = v.id===id;
      return (v.isDefault||false)===want ? null : { ...v, isDefault:want };
    }, { label:'Set default view' });
  }

  // ---- releases (per-project "what's new") -------------------------------
  releasesFor(projectId){ return this.all('releases').filter(r=>r.projectId===projectId).sort((a,b)=>(b.v||0)-(a.v||0)); }
  latestRelease(projectId){ return this.releasesFor(projectId)[0] || null; }
  addRelease(projectId, data, opts={}){
    const v = data.v ?? ((this.latestRelease(projectId)?.v||0)+1);
    return this.put('releases', { projectId, v, title:'', kind:'feature', items:[], ts:new Date().toISOString(), ...data, v }, { label:'Add release', ...opts });
  }

  // ---- milestones + recommended release point ---------------------------
  // Mark/unmark a release as a milestone — a deliberate "this is a real
  // release point" marker (optionally labelled, e.g. "1.0", "Public beta").
  setMilestone(releaseId, on, label=''){
    const r=this.get('releases', releaseId); if(!r) return;
    return this.put('releases', { ...r, milestone:!!on, milestoneLabel:on?(label||r.milestoneLabel||''):'' }, { label:on?'Mark milestone':'Unmark milestone' });
  }
  milestonesFor(projectId){ return this.releasesFor(projectId).filter(r=>r.milestone); }
  allMilestones(){ return this.all('releases').filter(r=>r.milestone && this.project(r.projectId)); }

  // Dismissed recommendations — versions the user waved off on a project's
  // "Recommended release point" nudge. Persisted per project so the SAME
  // suggestion never reappears, while a fresh recommendation (a different,
  // later version) still surfaces. Marking a release as a milestone also
  // removes it from recommendation (recommendedMilestone skips milestones), so
  // both "mark it" and "dismiss it" make the card go away for good.
  dismissedRecs(projectId){ return (this.settings().recDismissed || {})[projectId] || []; }
  dismissRecommendation(projectId, v){
    const all = { ...(this.settings().recDismissed || {}) };
    const set = new Set(all[projectId] || []); set.add(v);
    all[projectId] = [...set];
    this.setSetting('recDismissed', all);
  }

  // Transient "new updates" markers on the Projects library. When a background
  // refresh actually pulls new releases for a project, it stamps the project
  // here (settings.projectUnseen = { [id]: firstUnseenAt }). The library shows
  // a NEW badge on that row; opening the project clears it, and it decays on its
  // own after PROJECT_NEW_DECAY_DAYS so a never-opened row doesn't stay NEW
  // forever (PROJECT_NEW_DECAY_DAYS = 10). Stored in settings (not on the
  // project row) so it never touches project data or the undo history.
  markProjectUpdated(projectId){
    const all = { ...(this.settings().projectUnseen || {}) };
    if(all[projectId]) return;                 // keep the FIRST unseen time (decay anchors to it)
    all[projectId] = Date.now();
    this.setSetting('projectUnseen', all);
  }
  clearProjectUnseen(projectId){
    const all = { ...(this.settings().projectUnseen || {}) };
    if(all[projectId] == null) return;
    delete all[projectId];
    this.setSetting('projectUnseen', all);
  }
  projectHasNewUpdates(projectId){
    const at = (this.settings().projectUnseen || {})[projectId];
    if(!at) return false;
    const fresh = (Date.now() - at) < 10 * 86400000;                 // PROJECT_NEW_DECAY_DAYS
    if(!fresh){ this.clearProjectUnseen(projectId); return false; }   // self-prune stale markers
    return true;
  }

  // Recommend the release that reads as the best recent "stable stopping
  // point": the moment a burst of feature work settled into polish/fixes and
  // then paused. A pure heuristic over (kind, version, ts) — no network, no
  // stored state. Returns { release, score(0..10), reasons[] } or null when a
  // project is still mid-churn or too new to call one.
  recommendedMilestone(projectId){
    const rel = this.releasesFor(projectId);                 // newest-first
    if(rel.length < 2) return null;
    const asc = rel.slice().sort((a,b)=>(a.v||0)-(b.v||0));   // oldest-first
    const now = Date.now();
    const isFeat = r => (r.kind||'feature')==='feature';
    // Never re-nominate a release the user already resolved: one they've marked
    // as a milestone (accepted) or explicitly dismissed. A fresh, later stable
    // point still surfaces.
    const dismissed = new Set(this.dismissedRecs(projectId));
    let best=null;
    asc.forEach((r,i)=>{
      const next = asc[i+1];
      const gapDays = ((next? +new Date(next.ts) : now) - +new Date(r.ts))/86400000;
      let tail=0; for(let j=i; j>=0 && !isFeat(asc[j]); j--) tail++;          // polish/fix run ending here
      let feats=0; for(let j=i-tail; j>=0 && isFeat(asc[j]); j--) feats++;     // feature run before that tail
      const ageDays = (now - +new Date(r.ts))/86400000;
      const round = (r.v%10===0)?2 : (r.v%5===0)?1 : 0;
      const recency = Math.max(0, 1 - ageDays/180);
      const gapScore = Math.min(Math.max(gapDays,0), 30)/30;
      // a candidate needs SOME "it settled / paused / round" signal — a project
      // that just ships features non-stop has no natural stopping point yet.
      const candidate = tail>=1 || gapDays>=5 || round>0;
      const score = gapScore*3 + Math.min(tail,4)*1.5 + Math.min(feats,6)*0.9 + round*1.2 + recency*3;
      const reasons=[];
      if(feats>=2) reasons.push(`${feats} features shipped, then ${tail||'no'} polish/fix release${tail===1?'':'s'}`);
      else if(tail>=2) reasons.push(`${tail} polish/fix releases with no new features`);
      if(gapDays>=5) reasons.push(`${Math.round(gapDays)} quiet day${Math.round(gapDays)===1?'':'s'} ${next?'before the next release':'since'}`);
      if(round) reasons.push(`round version v${r.v}`);
      const eligible = candidate && !r.milestone && !dismissed.has(r.v);
      if(eligible && (!best || score>best.score)) best={ release:r, score, reasons, ageDays };
    });
    if(!best || best.score < 4.5 || best.ageDays > 120) return null;   // notable + still relevant
    return { release:best.release, score:Math.min(10, Math.round(best.score*10)/10), reasons:best.reasons.slice(0,3) };
  }
  // Reconcile a project's releases with a fetched/pasted changelog: add rows
  // for versions we don't have, overwrite rows for versions whose content
  // changed. Silent (no undo entry per row) — nothing is written until the
  // caller has already shown the user a preview and they've confirmed.
  syncReleases(projectId, entries, sourceUrl){
    const existing = new Map(this.releasesFor(projectId).map(r=>[r.v, r]));
    let added=0, updated=0;
    entries.forEach(e=>{
      const prev = existing.get(e.v);
      if(prev){
        if(prev.title===e.title && JSON.stringify(prev.items)===JSON.stringify(e.items)) return;
        this.put('releases', { ...prev, title:e.title, kind:e.kind, ts:e.ts, items:e.items, source:'sync', sourceUrl }, { silent:true });
        updated++;
      }else{
        this.addRelease(projectId, { ...e, source:'sync', sourceUrl }, { silent:true });
        added++;
      }
    });
    return this._finishSync(projectId, sourceUrl, { added, updated });
  }

  // Derive a status from release activity after a sync. Returns the new status
  // (or null to leave it). Skips projects the user has Locked, and the
  // "declared" states Idea/Archived — those are never auto-changed.
  deriveSyncStatus(projectId){
    const cfg = this.settings().autoStatus;
    if(!cfg || cfg.enabled===false) return null;
    const p = this.project(projectId);
    if(!p || p.statusLocked) return null;
    if(p.status==='archived') return null;   // retired on purpose — never auto-revive; Idea DOES promote on real releases
    const r = this.latestRelease(projectId);
    if(!r || !r.ts) return null;
    const ageDays = (Date.now() - +new Date(r.ts)) / 86400000;
    const liveDays = cfg.liveDays ?? 45;
    const staleDays = cfg.staleDays ?? 180;
    let to = null;
    if(ageDays <= liveDays) to = p.site ? 'live' : 'active';
    else if(ageDays > staleDays) to = 'paused';
    else return null;                        // in-between window: leave as-is
    return to !== p.status ? to : null;
  }
  // Shared tail for both sync paths: stamp the source + time, and apply
  // auto-status (returning what changed so the caller can surface it).
  _finishSync(projectId, sourceUrl, result){
    const patch = { changelogUrl:sourceUrl, lastSyncAt:Date.now() };
    const to = this.deriveSyncStatus(projectId);
    let statusChange = null;
    if(to){ statusChange = { from:this.project(projectId).status, to }; patch.status = to; patch.statusAuto = true; patch.statusAutoAt = Date.now(); }
    this.updateProject(projectId, patch, { silent:true });
    return { ...result, statusChange };
  }
  // Force sync: a full reconcile, not just additive. Every version the source
  // publishes is written verbatim (even if a synced row was edited locally
  // afterward — the source wins), and any previously-synced release no longer
  // present upstream is removed. Releases added by hand (source !== 'sync')
  // are never touched, even if their version number collides.
  forceSyncReleases(projectId, entries, sourceUrl){
    const existing = new Map(this.releasesFor(projectId).map(r=>[r.v, r]));
    const upstreamVs = new Set(entries.map(e=>e.v));
    let added=0, updated=0, removed=0;
    entries.forEach(e=>{
      const prev = existing.get(e.v);
      if(prev){
        const changed = prev.title!==e.title || prev.kind!==e.kind || prev.ts!==e.ts || JSON.stringify(prev.items)!==JSON.stringify(e.items);
        this.put('releases', { ...prev, title:e.title, kind:e.kind, ts:e.ts, items:e.items, source:'sync', sourceUrl }, { silent:true });
        if(changed) updated++;
      }else{
        this.addRelease(projectId, { ...e, source:'sync', sourceUrl }, { silent:true });
        added++;
      }
    });
    existing.forEach((r,v)=>{
      if(r.source==='sync' && !upstreamVs.has(v)){ this.remove('releases', r.id, { silent:true }); removed++; }
    });
    return this._finishSync(projectId, sourceUrl, { added, updated, removed });
  }
  // The "last updated" signal for a project = its newest release, else its own updatedAt.
  lastActivity(projectId){
    const r = this.latestRelease(projectId);
    const p = this.project(projectId);
    const rt = r?.ts ? +new Date(r.ts) : 0;
    return Math.max(rt||0, p?.updatedAt||0) || (p?.updatedAt||0);
  }

  // ---- fleet health weighting (tunable, Settings → Fleet health) ---------
  // Returns the three dimensions' point caps, renormalized to sum to 100 no
  // matter what a user dials them to — so "50/30/20" and "5/3/2" behave the same.
  healthWeights(){
    const raw = { ...DEFAULT_HEALTH_WEIGHTS, ...(this.settings().healthWeights||{}) };
    const total = (raw.recency||0)+(raw.velocity||0)+(raw.status||0);
    if(!total) return { ...DEFAULT_HEALTH_WEIGHTS };
    const scale = 100/total;
    return { recency:raw.recency*scale, velocity:raw.velocity*scale, status:raw.status*scale };
  }
  setHealthWeights(patch){ this.setSetting('healthWeights', { ...this.settings().healthWeights, ...patch }); }

  // ---- per-project fleet-health weighting override -----------------------
  // Almost every project should just ride the fleet-wide weights above, but
  // the rare project on a deliberately different cadence (e.g. one someone
  // wants scored mostly on status, or that's intentionally slow-shipping and
  // shouldn't be marked down for recency) can override just its own three
  // dimensions. Stored on the project row as `healthWeightsOverride`:
  // absent/`enabled:false` means "use the fleet weights"; the dialed-in
  // numbers persist even while disabled, so re-enabling restores them instead
  // of resetting to the fleet default.
  projectHealthWeightsOverride(projectId){
    const p = this.project(projectId);
    return p?.healthWeightsOverride || { enabled:false, ...DEFAULT_HEALTH_WEIGHTS };
  }
  // The weights actually used to score this project — its own override when
  // enabled (renormalized to 100, same rule as the fleet-wide weights), else
  // whatever the fleet is currently set to.
  healthWeightsFor(projectId){
    const ov = this.projectHealthWeightsOverride(projectId);
    if(!ov.enabled) return this.healthWeights();
    const raw = { recency:ov.recency??DEFAULT_HEALTH_WEIGHTS.recency, velocity:ov.velocity??DEFAULT_HEALTH_WEIGHTS.velocity, status:ov.status??DEFAULT_HEALTH_WEIGHTS.status };
    const total = raw.recency+raw.velocity+raw.status;
    if(!total) return this.healthWeights();
    const scale = 100/total;
    return { recency:raw.recency*scale, velocity:raw.velocity*scale, status:raw.status*scale };
  }
  setProjectHealthWeights(projectId, patch){
    const cur = this.projectHealthWeightsOverride(projectId);
    this.updateProject(projectId, { healthWeightsOverride:{ ...cur, ...patch } }, { silent:true });
  }

  // ---- "needs attention" thresholds (tunable, Settings → Needs attention) --
  attentionThresholds(){ return { ...DEFAULT_ATTENTION_THRESHOLDS, ...(this.settings().attentionThresholds||{}) }; }
  setAttentionThresholds(patch){ this.setSetting('attentionThresholds', { ...this.settings().attentionThresholds, ...patch }); }

  // ---- per-project "needs attention" threshold override ------------------
  // Same escape hatch as the health-weighting override above, for the other
  // half of what decides a project is flagged: the fleet-wide cutoffs behind
  // needsAttention() are usually right, but a project on a deliberately
  // different cadence (e.g. one that's expected to ship rarely, or a
  // "manual cadence" project that should never be flagged just for being
  // slow) can dial in its own health-score cutoff and auto-sync fail count.
  // Stored on the project row as `attentionThresholdsOverride`; disabled (the
  // default) means "use the live fleet-wide thresholds", and the dialed-in
  // numbers persist even while disabled so re-enabling restores them instead
  // of resetting to the shipped default.
  projectAttentionThresholdsOverride(projectId){
    const p = this.project(projectId);
    return p?.attentionThresholdsOverride || { enabled:false, ...DEFAULT_ATTENTION_THRESHOLDS };
  }
  // The thresholds actually used to flag this project — its own override
  // when enabled, else whatever the fleet is currently set to.
  attentionThresholdsFor(projectId){
    const ov = this.projectAttentionThresholdsOverride(projectId);
    if(!ov.enabled) return this.attentionThresholds();
    return {
      healthMax: ov.healthMax ?? DEFAULT_ATTENTION_THRESHOLDS.healthMax,
      autoSyncFails: ov.autoSyncFails ?? DEFAULT_ATTENTION_THRESHOLDS.autoSyncFails,
    };
  }
  setProjectAttentionThresholds(projectId, patch){
    const cur = this.projectAttentionThresholdsOverride(projectId);
    this.updateProject(projectId, { attentionThresholdsOverride:{ ...cur, ...patch } }, { silent:true });
  }

  // ---- auto-sync failure backoff cap (tunable, Settings → Auto-sync) -----
  // How many times slower a repeatedly-failing project's auto-sync can be
  // retried, at most (ingest.js does the doubling; this just caps it).
  autoSyncBackoffCap(){ return this.settings().autoSync?.backoffCap ?? DEFAULT_AUTO_SYNC_BACKOFF_CAP; }
  setAutoSyncBackoffCap(v){ this.setSetting('autoSync', { ...this.settings().autoSync, backoffCap:v }); }

  // ---- per-project auto-sync backoff cap override -------------------------
  // Same escape hatch as the two overrides above: a project on a source
  // that's deliberately flakier (retry sooner, don't back off as hard) or
  // steadier (back off harder, don't hammer it) than the fleet norm can dial
  // in its own cap. Stored on the project row as `autoSyncBackoffCapOverride`;
  // disabled (the default) means "use the live fleet-wide cap", and the
  // dialed-in number persists even while disabled.
  projectAutoSyncBackoffCapOverride(projectId){
    const p = this.project(projectId);
    return p?.autoSyncBackoffCapOverride || { enabled:false, backoffCap:DEFAULT_AUTO_SYNC_BACKOFF_CAP };
  }
  // The cap actually used for this project's backoff — its own override when
  // enabled, else whatever the fleet is currently set to.
  autoSyncBackoffCapFor(projectId){
    const ov = this.projectAutoSyncBackoffCapOverride(projectId);
    return ov.enabled ? (ov.backoffCap ?? DEFAULT_AUTO_SYNC_BACKOFF_CAP) : this.autoSyncBackoffCap();
  }
  setProjectAutoSyncBackoffCap(projectId, patch){
    const cur = this.projectAutoSyncBackoffCapOverride(projectId);
    this.updateProject(projectId, { autoSyncBackoffCapOverride:{ ...cur, ...patch } }, { silent:true });
  }

  // ---- per-project notes scratchpad (Markdown, autosaved) ----------------
  // Free-form working context — "why this is paused", "next thing to try", a
  // link to a design doc — that doesn't belong in the curated `description`/
  // `assessment` blurbs. Autosaves on pause (debounced in the view) rather
  // than an explicit Save button, so this deliberately bypasses put(): it
  // neither bumps the project's `updatedAt` (typing notes isn't "shipping
  // activity" the way a release is, and updatedAt feeds recency/health) nor
  // emits a reactive `projects` event, which would re-render the whole
  // project page mid-keystroke and steal the textarea's focus/cursor. Every
  // save keeps the text it's about to overwrite as a capped revision
  // snapshot (`notesHistory`, newest first) — cheap undo-style safety for a
  // text box people will type paragraphs into, no new Store table needed.
  // Returns true if anything was actually saved (false if `text` is
  // unchanged from the live value, so callers can skip a "Saved" flash).
  saveProjectNotes(id, text){
    const p = this.project(id);
    if(!p || (p.notes||'')===text) return false;
    if(p.notes) p.notesHistory = [{ ts:Date.now(), text:p.notes }, ...(p.notesHistory||[])].slice(0, NOTES_HISTORY_MAX);
    p.notes = text;
    this._save();
    return true;
  }
  notesHistoryFor(id){ return this.project(id)?.notesHistory || []; }
  // Restoring a snapshot IS a deliberate, explicit click (not autosave), so —
  // unlike saveProjectNotes() above — it goes through the normal put() path:
  // it bumps updatedAt and re-renders the page, same as any other edit. What
  // was live just before the restore is itself kept as a fresh snapshot, so
  // restoring an older version is never a dead end.
  restoreProjectNotes(id, ts){
    const p = this.project(id);
    const snap = (p?.notesHistory||[]).find(h=>h.ts===ts);
    if(!p || !snap) return;
    const history = [{ ts:Date.now(), text:p.notes||'' }, ...p.notesHistory.filter(h=>h.ts!==ts)].slice(0, NOTES_HISTORY_MAX);
    this.updateProject(id, { notes:snap.text, notesHistory:history }, { silent:true });
  }

  // ---- fleet health (recency + release velocity + status), 0-100 --------
  healthScore(projectId){
    const p = this.project(projectId);
    if(!p) return 0;
    const w = this.healthWeightsFor(projectId);
    const now = Date.now();
    const days = this.lastActivity(projectId) ? (now-this.lastActivity(projectId))/86400000 : Infinity;
    const recencyFrac = days<=3?1 : days<=14?0.8 : days<=30?0.6 : days<=90?0.3 : days<=180?0.1 : 0;
    const rels90 = this.all('releases').filter(r=>r.projectId===projectId && r.ts && (now-(+new Date(r.ts)))<90*86400000).length;
    const velocityFrac = Math.min(rels90/5, 1); // 5 releases in 90d maxes it out
    const statusFrac = ({ live:1, active:0.9, building:0.7, idea:0.3, paused:0.2, archived:0 })[p.status] ?? 0.4;
    const score = recencyFrac*w.recency + velocityFrac*w.velocity + statusFrac*w.status;
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  // Weekly release counts for the last `weeks` weeks, oldest first — the
  // series behind the per-project release-velocity sparkline.
  releaseVelocity(projectId, weeks=10){
    const now = Date.now();
    const buckets = new Array(weeks).fill(0);
    this.releasesFor(projectId).forEach(r=>{
      if(!r.ts) return;
      const diff = now - (+new Date(r.ts));
      if(!(diff>=0)) return;
      const idx = weeks-1-Math.floor(diff/(7*86400000));
      if(idx>=0 && idx<weeks) buckets[idx]++;
    });
    return buckets;
  }

  // A project "needs attention" when its health score has sunk below the
  // tunable `healthMax` cutoff (Settings → Needs attention; defaults to the
  // Steady band's floor, i.e. Slowing/Stale) or its auto-sync has failed at
  // least `autoSyncFails` times in a row — both read per-project via
  // attentionThresholdsFor(), which falls back to the live fleet-wide
  // thresholds unless that project has its own override enabled. One shared
  // definition so the dashboard callout and the library's saved view always
  // agree on exactly the same set of projects, sorted worst-off first. Each
  // reason is `{ kind:'health'|'sync', text }` so callers can render the
  // right chip style without recomputing the logic themselves.
  // ---- steward signals (in-memory overlay, never persisted) ---------------
  // Red steward PRs and open sweep-finding issues per repo, fetched from the
  // GitHub API by js/steward-signals.js. Held OUTSIDE the persisted workspace
  // on purpose: it's derived remote state that must go stale-and-refetch, not
  // sync between browsers. Feeding it through needsAttention() means the
  // bell, rail badge, dashboard callout, and per-signature dismissals all
  // pick it up with zero extra wiring.
  setStewardSignals(map){
    this._stewardSignals = map || null;
    this.emit('change', { table:'steward' });
    this.emit('projects', {});
  }
  stewardSignalsFor(repo){ return (this._stewardSignals && repo) ? this._stewardSignals[repo] : null; }

  needsAttention(){
    return this.projects().map(p=>{
      const t = this.attentionThresholdsFor(p.id);
      const score = this.healthScore(p.id);
      const band = healthBand(score);
      const reasons = [];
      if(score < t.healthMax) reasons.push({ kind:'health', text:`${band.label} · ${score}/100` });
      if(p.autoSync && (p.autoSyncFailCount||0)>=t.autoSyncFails) reasons.push({ kind:'sync', text:`Auto-sync failing ×${p.autoSyncFailCount}` });
      const sig = this.stewardSignalsFor(p.repo);
      if(sig?.redPRs) reasons.push({ kind:'steward', text:`${sig.redPRs} red steward PR${sig.redPRs===1?'':'s'}` });
      if(sig?.sweepIssues) reasons.push({ kind:'sweep', text:`${sig.sweepIssues} sweep finding${sig.sweepIssues===1?'':'s'}` });
      return reasons.length ? { project:p, score, band, reasons } : null;
    }).filter(Boolean).sort((a,b)=>a.score-b.score);
  }

  // ---- per-item dismissal ("mark as read"), independent of the condition --
  // A dismissal is scoped to the exact reasons it was raised for (its
  // "signature"), not just the project id — so acknowledging a project
  // that's merely Slowing doesn't silently swallow a *new* problem (e.g. its
  // auto-sync starting to fail) that shows up later: the signature changes,
  // the old dismissal stops matching, and the row comes back. That's what
  // lets someone say "I've seen this, stop pinging me" for a known, ongoing
  // issue without it needing to be fixed first — dismissal is independent of
  // the underlying condition, but a genuinely new or worsened one still gets
  // through.
  _attnSignature(a){ return a.reasons.map(r=>`${r.kind}:${r.text}`).join('|'); }
  isAttentionDismissed(a){
    const d = this.get('dismissals', a.project.id);
    return !!d && d.signature===this._attnSignature(a);
  }
  dismissAttention(a){
    this.put('dismissals', { id:a.project.id, projectId:a.project.id, signature:this._attnSignature(a), dismissedAt:Date.now() }, { silent:true });
  }
  undismissAttention(projectId){ this.remove('dismissals', projectId, { silent:true }); }
  // The set passive/ambient surfaces (bell, rail badge, dashboard callout)
  // should treat as "hot" — needsAttention() minus anything dismissed at its
  // current signature. needsAttention() itself stays the full, undismissed-
  // agnostic picture for anything that wants it (e.g. the library's "Needs
  // attention" saved view — a deliberate query, not a passive notification).
  needsAttentionActive(){ return this.needsAttention().filter(a=>!this.isAttentionDismissed(a)); }
  dismissedAttention(){ return this.needsAttention().filter(a=>this.isAttentionDismissed(a)); }

  // ---- credentials -------------------------------------------------------
  credentials(scope){ const all=this.all('credentials'); return scope?all.filter(c=>c.scope===scope):all; }
  addCredential(data){ return this.put('credentials', { scope:'global', name:'', key:'', value:'', note:'', ...data }, { label:'Add credential' }); }

  // ---- runs (cadence log) ------------------------------------------------
  runs(){ return this.all('runs').sort((a,b)=>(b.ts||0)-(a.ts||0)); }
  logRun(data){ return this.put('runs', { mode:'feature', note:'', projectId:'', ts:Date.now(), ...data }, { label:'Log run' }); }
  featureCount(){ return this.all('runs').filter(r=>r.mode==='feature').length; }

  // ---- import / export / reset ------------------------------------------
  exportJSON(){ return JSON.stringify(this._db, null, 2); }
  // Parses + validates a workspace JSON blob without touching the live store —
  // shared by previewImport() (a dry-run count for the confirm dialog) and
  // importJSON() itself, so both agree on exactly what counts as a valid file.
  _parseWorkspace(text){
    let parsed;
    try{ parsed = JSON.parse(text); }catch{ throw new Error('That file isn’t valid JSON.'); }
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed) || !parsed.projects || typeof parsed.projects!=='object' || Array.isArray(parsed.projects)){
      throw new Error('That file doesn’t look like a Manager workspace export.');
    }
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings||{}) };
    TABLES.forEach(t=>parsed[t]=(parsed[t]&&typeof parsed[t]==='object'&&!Array.isArray(parsed[t]))?parsed[t]:{});
    parsed.meta = parsed.meta||{};
    return parsed;
  }
  // A dry-run row count per table, for showing the user what a file contains
  // before they commit to replacing their current workspace with it.
  previewImport(text){
    const parsed = this._parseWorkspace(text);
    const counts = {};
    TABLES.forEach(t=>counts[t]=Object.keys(parsed[t]).length);
    return counts;
  }
  // Replaces the entire live workspace with the parsed file. Also clears the
  // undo history: an old op's `prev` snapshot belongs to the workspace that
  // existed before the import, so replaying it afterward would splice stale
  // rows from a different dataset back in — the same reason reset() below
  // clears it.
  importJSON(text){
    this._db = this._parseWorkspace(text);
    this._save();
    this._history = []; this._saveHistory();
    this.emit('change', {}); TABLES.forEach(t=>this.emit(t,{})); this.emit('history');
  }
  // True if two rows differ in anything but id/createdAt/updatedAt — the
  // bookkeeping fields that are expected to differ (or be irrelevant) even
  // when the row is otherwise "the same". Compares via a key-sorted
  // stringify rather than raw JSON.stringify so two objects built with the
  // same content in a different key order (e.g. spread-constructed on two
  // different machines) don't falsely register as different.
  _rowsDiffer(a, b){
    const strip = r => { const { id, createdAt, updatedAt, ...rest } = r; return rest; };
    return stableStringify(strip(a)) !== stableStringify(strip(b));
  }
  // A dry-run per-table {add, skip, update, remove, rows, updateRows,
  // removeRows} preview for a merge import: `add`/`rows` are rows in the
  // file whose id doesn't exist here yet (would be inserted); `update`/
  // `updateRows` are rows whose id DOES already exist here but whose content
  // differs from the file's version (only overwritten if the caller opts
  // into mergeImport's `applyUpdates`) — each entry is `{id, local,
  // incoming}` so a "review" UI can diff the two versions field by field;
  // `remove`/`removeRows` are rows that exist here but whose id is absent
  // from the file entirely (only deleted if the caller opts into
  // mergeImport's `applyRemoves` — a two-way-sync opt-in, since a plain
  // partial export legitimately omits rows without meaning "delete these");
  // `skip` is rows that already exist here and are identical to the file,
  // left out of every list since there's nothing to show or do. Excludes
  // `dismissals`: that table is local "have I already seen this" state
  // scoped to whichever browser raised it, and porting someone else's
  // doesn't mean anything here. Also returns the file's raw incoming
  // `projects` map so a caller can name a new release/credential's parent
  // project even when that project is itself new in the same file (and so
  // not yet in the live store to look up).
  previewMerge(text){
    const parsed = this._parseWorkspace(text);
    const tables = {};
    MERGE_TABLES.forEach(t=>{
      const local = this._db[t];
      const rows = [], updateRows = [];
      let skip = 0;
      const incomingIds = new Set(Object.keys(parsed[t]));
      Object.values(parsed[t]).forEach(row=>{
        const existing = local[row.id];
        if(!existing) rows.push(row);
        else if(this._rowsDiffer(existing, row)) updateRows.push({ id:row.id, local:existing, incoming:row });
        else skip++;
      });
      const removeRows = Object.values(local).filter(r=>!incomingIds.has(r.id));
      tables[t] = { add: rows.length, skip, update: updateRows.length, remove: removeRows.length, rows, updateRows, removeRows };
    });
    return { tables, projects: parsed.projects };
  }
  // Adds rows from `text` that don't already exist locally (by id) across
  // every MERGE_TABLES table, leaving every existing row completely
  // untouched by default — for combining a backup from one browser into
  // another instead of always wiping the current workspace (see
  // importJSON() for that replace mode). Passing `{applyUpdates:true}` also
  // opts into overwriting rows that exist in both places but differ (see
  // previewMerge()'s `updateRows`) — a row identical in both places is still
  // never touched either way. Passing `{applyRemoves:true}` also opts into
  // deleting local rows whose id is absent from the file entirely (see
  // previewMerge()'s `removeRows`) — a genuine two-way-sync opt-in, since by
  // default a partial export omitting a row never means "delete it"; a
  // removed project cascades its releases/credentials/dismissals exactly
  // like remove() does, via the same `_cascadeFor()` helper, so a project
  // dropped this way doesn't leave orphaned children behind. Recorded as one
  // undo step spanning every table it touched, via the same `{table, items}`
  // grouped shape bulkUpdate()/bulkRemove() use, generalized to
  // `{tables: {table: items}}` so a single Undo reverses every add, update,
  // and remove a merge made — however many tables it touched — in one
  // click; an updated row's `prev` is the full previous row (not null,
  // unlike a fresh add) so Undo puts back exactly what was overwritten, and
  // a removed row's `prev` (plus its `cascade`) lets Undo restore it exactly
  // like remove()'s undo does. Returns `{added, updated, removed}` counts.
  mergeImport(text, { applyUpdates=false, applyRemoves=false }={}){
    const parsed = this._parseWorkspace(text);
    const tables = {};
    let added=0, updated=0, removed=0;
    // Pass 1: every table's adds and updates, before any table's removes.
    // This has to fully finish first — if a project's cascade-remove (pass 2
    // below) ran interleaved with a sibling table's own add pass, a release
    // that's still present in the file but just got cascade-deleted because
    // its parent project was removed would look, to that sibling table's add
    // check, exactly like a legitimate new row (existing is now falsy) and
    // get silently re-inserted a moment after the cascade removed it.
    MERGE_TABLES.forEach(t=>{
      const local = this._db[t];
      const items = [];
      Object.values(parsed[t]).forEach(row=>{
        const existing = local[row.id];
        if(!existing){
          local[row.id] = row;
          items.push({ id:row.id, prev:null });
          added++;
        }else if(applyUpdates && this._rowsDiffer(existing, row)){
          items.push({ id:row.id, prev:existing });
          local[row.id] = row;
          updated++;
        }
      });
      if(items.length) tables[t]=items;
    });
    // Pass 2: removes, only once every add/update above has landed. A
    // project removed here cascades its releases/credentials/dismissals via
    // the same `_cascadeFor()` remove()/bulkRemove() use, so a cascaded row
    // simply vanishes from its own table's `Object.keys(local)` before this
    // loop reaches that table — never re-added (pass 1 is already done) and
    // never double-removed (it's no longer there to find).
    if(applyRemoves){
      MERGE_TABLES.forEach(t=>{
        const local = this._db[t];
        const incomingIds = new Set(Object.keys(parsed[t]));
        Object.keys(local).filter(id=>!incomingIds.has(id)).forEach(id=>{
          const prev = local[id];
          delete local[id];
          const cascade = this._cascadeFor(t, id);
          (tables[t] = tables[t] || []).push({ id, prev, cascade });
          removed++;
        });
      });
    }
    if(!added && !updated && !removed) return { added:0, updated:0, removed:0 };
    const labelParts=[]; if(updated) labelParts.push('updates'); if(removed) labelParts.push('removals');
    this._pushHistory({ tables, label: labelParts.length ? `Merge import (with ${labelParts.join(' & ')})` : 'Merge import' });
    this._save();
    Object.entries(tables).forEach(([table,items])=>{
      items.forEach(({id})=>{ this.emit('change',{table,id}); this.emit(table,{id}); });
    });
    return { added, updated, removed };
  }
  reset(){ localStorage.removeItem(LS_KEY); localStorage.removeItem(HIST_KEY); this._db=this._load(); this._history=[]; this.emit('change', {}); }
})();

// ---- seed ----------------------------------------------------------------
// The fleet we're actually connecting to — the six repos in scope, INCLUDING
// Manager itself. Assessments are qualitative summaries (editable); we never
// fabricate version numbers or ship times for other projects.
function seed(db){
  const now = Date.now();
  db.meta.seededAt = now;
  const P = [
    { id:'manager', name:'Manager', repo:'kevinrhaas/manager.polecat.live', site:'https://manager.polecat.live',
      status:'live', icon:'gauge', pinned:true, cadence:'GitHub Action · hourly',
      tags:['console','tooling','static'],
      description:'Mission control for the fleet — the app you are looking at.',
      assessment:'Mission control for the whole fleet — this very console, watching itself along with everyone else. Ships new features and polish on an hourly self-improve loop.' },
    { id:'relay', name:'Relay', repo:'kevinrhaas/relay.polecat.live', site:'https://relay.polecat.live',
      status:'live', icon:'chat', pinned:true, cadence:'GitHub Action · hourly',
      tags:['p2p','webrtc','static'],
      description:'Serverless, peer-to-peer collaborative tables + chat.',
      assessment:'Serverless, peer-to-peer collaborative tables and chat — data lives in the browser and syncs directly between trusted peers. Mature and shipping steadily (v16).' },
    { id:'games', name:'Games', repo:'kevinrhaas/games.polecat.live', site:'https://games.polecat.live',
      status:'live', icon:'play', pinned:false, cadence:'self-improve loop',
      tags:['games','arcade','static'],
      description:'A browser arcade of 8-bit games from public-domain stories.',
      assessment:'An ever-growing arcade of instantly-playable 8-bit games built from the world’s legendary public-domain stories. New legends added hourly.' },
    { id:'polecat', name:'Polecat', repo:'kevinrhaas/polecat', site:'https://polecat.live',
      status:'live', icon:'compass', pinned:false, cadence:'manual',
      tags:['ai','consensus','landing'],
      description:'"Ask once. Hear from everyone." The polecat.live front door.',
      assessment:'“Ask once, hear from everyone.” One prompt to many AI models, synthesized into a consensus answer — all in the browser with your own keys. This repo is the marketing front door.' },
    { id:'polecat-app', name:'Polecat App', repo:'kevinrhaas/polecat-app', site:'https://app.polecat.live',
      status:'live', icon:'bolt', pinned:false, cadence:'manual',
      tags:['ai','app'],
      description:'The Polecat application — multi-model consensus, free demo.',
      assessment:'The Polecat application itself: one prompt to every model, one synthesized answer, with a free no-key demo. Where the product actually lives.' },
    { id:'solution-engineering', name:'Solution Engineering', repo:'kevinrhaas/solution-engineering', site:'',
      status:'active', icon:'layers', pinned:false, cadence:'manual',
      tags:['workspace','analytics','ai'],
      description:'A mixed Pentaho solution-engineering workspace.',
      assessment:'A mixed engineering workspace: Pentaho solution-engineering assets, analytics and data-catalog content, AI/agentic experiments, demos, and automation. Many self-contained projects, not one deployed site.' },
  ];
  P.forEach(p=>{ db.projects[p.id] = { slug:p.id, sessionUrl:'', fields:{}, createdAt:now, updatedAt:now, ...p }; });

  const rel = (projectId, v, title, ts, items, kind='feature')=>{
    const id = uuid();
    db.releases[id] = { id, projectId, v, title, ts, items, kind, createdAt:now, updatedAt:now };
  };
  // Manager v1 — this build.
  rel('manager', 1, 'Mission Control launch', new Date(now).toISOString(), [
    'Dashboard of project tiles: status, last-updated (CT), latest version, an assessment, and links to the live site, what’s new, and your Claude Code session.',
    'Projects library with filter, sort, search, pin, and full metadata editing.',
    'Project detail with the complete what’s-new timeline, plus credentials, docs, a welcome tour, simple mode, history + undo, and an invite-only admin gate.',
  ], 'feature');
  // Relay — real changelog entries (verified from its js/changelog.js). Their
  // timestamps are anchored RELATIVE to seed time (a few hours/days back)
  // rather than frozen calendar dates, so the demo fleet always reads as
  // freshly active — "this week" / "last 7 days" / velocity never silently
  // empty out as real time marches past a hard-coded date. The moment the user
  // actually syncs Relay, these placeholders are replaced by its real history.
  const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
  rel('relay', 16, 'Landing page: sync locations', hoursAgo(5), [
    'The front page now shows off "bring your own backup" — sync to a local folder, S3-compatible storage, or WebDAV.',
  ], 'feature');
  rel('relay', 15, 'Sync locations: WebDAV', hoursAgo(28), [
    'Settings → Advanced → "Sync locations" now has a WebDAV option — Nextcloud, ownCloud, or any self-hosted server.',
    'Enter a server URL, username, and app password; Relay keeps a live snapshot there.',
  ], 'feature');
  rel('relay', 14, 'Sync locations: S3-compatible storage', hoursAgo(52), [
    'An S3-compatible option — Cloudflare R2, Backblaze B2, AWS S3, MinIO, or anything that speaks the S3 API.',
    'Relay signs requests itself (no SDK, no server) and keeps a live snapshot in the bucket.',
  ], 'feature');

  // First cadence entry: this launch counts as feature run #1.
  const rid = uuid();
  db.runs[rid] = { id:rid, projectId:'manager', mode:'feature', note:'v1 — Mission Control launch', ts:now, createdAt:now, updatedAt:now };
}
