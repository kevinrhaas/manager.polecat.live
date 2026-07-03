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
//
// Plus `settings` (app preferences) and a bounded `history` stack for undo.
// -----------------------------------------------------------------------

import { uuid, slugify } from './ui.js';

const LS_KEY   = 'manager.workspace.v1';
const HIST_KEY = 'manager.history.v1';
const TABLES   = ['projects', 'releases', 'credentials', 'runs', 'fieldDefs', 'dismissals'];
const HIST_MAX = 40;

export const STATUSES = {
  live:     { label:'Live',     cls:'s-live' },
  active:   { label:'Active',   cls:'s-active' },
  building: { label:'Building', cls:'s-building' },
  paused:   { label:'Paused',   cls:'s-paused' },
  idea:     { label:'Idea',     cls:'s-idea' },
  archived: { label:'Archived', cls:'s-archived' },
};

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
  autoSync: { enabled:false, intervalHours:6 },
  healthWeights: { ...DEFAULT_HEALTH_WEIGHTS },
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
  _loadHistory(){ try{ return JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); }catch{ return []; } }
  _saveHistory(){ try{ localStorage.setItem(HIST_KEY, JSON.stringify(this._history.slice(-HIST_MAX))); }catch{} }

  // ---- events ------------------------------------------------------------
  on(evt, fn){ (this._listeners[evt]||=[]).push(fn); return ()=>{ this._listeners[evt]=this._listeners[evt].filter(f=>f!==fn); }; }
  emit(evt, payload){ (this._listeners[evt]||[]).forEach(f=>{ try{ f(payload); }catch(e){ console.error(e); } }); (this._listeners['*']||[]).forEach(f=>f(evt,payload)); }

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
  remove(table, id, { silent=false, label='Delete' }={}){
    const prev = this._db[table][id];
    if(!prev) return;
    delete this._db[table][id];
    // cascade: deleting a project removes its releases + scoped credentials + dismissals
    const cascade = [];
    if(table==='projects'){
      for(const t of ['releases','credentials','dismissals']){
        for(const r of Object.values(this._db[t])){
          if(r.projectId===id || r.scope===id){ cascade.push({ table:t, row:r }); delete this._db[t][r.id]; }
        }
      }
    }
    if(!silent) this._pushHistory({ table, id, prev, cascade, label });
    this._save();
    this.emit('change', { table, id });
    this.emit(table, { id });
  }

  // ---- history / undo ----------------------------------------------------
  _pushHistory(op){ this._history.push({ ...op, at:Date.now() }); if(this._history.length>HIST_MAX) this._history=this._history.slice(-HIST_MAX); this._saveHistory(); this.emit('history'); }
  canUndo(){ return this._history.length>0; }
  lastLabel(){ const o=this._history[this._history.length-1]; return o?o.label:''; }
  undo(){
    const op = this._history.pop();
    if(!op) return null;
    this._saveHistory();
    // reverse: restore prev (or delete if there was none)
    if(op.prev) this._db[op.table][op.id] = op.prev;
    else delete this._db[op.table][op.id];
    (op.cascade||[]).forEach(c=>{ this._db[c.table][c.row.id]=c.row; });
    this._save();
    this.emit('change', { table:op.table, id:op.id });
    this.emit(op.table, { id:op.id });
    this.emit('history');
    return op;
  }

  // ---- settings ----------------------------------------------------------
  settings(){ return this._db.settings; }
  setSetting(key, val){ this._db.settings[key]=val; this._save(); this.emit('settings', { key }); }

  // ---- projects ----------------------------------------------------------
  projects(){ return this.all('projects'); }
  project(id){ return this.get('projects', id); }
  projectBySlug(slug){ return this.projects().find(p=>p.slug===slug) || null; }
  addProject(data){
    const slug = data.slug || slugify(data.name||'project');
    const row = { id:slug, slug, status:'idea', tags:[], icon:'grid', pinned:false, fields:{},
      name:'', repo:'', site:'', sessionUrl:'', description:'', assessment:'', cadence:'',
      autoSync:false, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:'', ...data };
    row.id = row.slug = data.slug || slugify(row.name||slug);
    return this.put('projects', row, { label:'Add project' });
  }
  updateProject(id, patch, opts={}){ const p=this.project(id); if(!p) return; return this.put('projects', { ...p, ...patch }, { label:'Edit project', ...opts }); }
  togglePin(id){ const p=this.project(id); if(!p) return; return this.put('projects', { ...p, pinned:!p.pinned }, { silent:true }); }

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

  // ---- releases (per-project "what's new") -------------------------------
  releasesFor(projectId){ return this.all('releases').filter(r=>r.projectId===projectId).sort((a,b)=>(b.v||0)-(a.v||0)); }
  latestRelease(projectId){ return this.releasesFor(projectId)[0] || null; }
  addRelease(projectId, data, opts={}){
    const v = data.v ?? ((this.latestRelease(projectId)?.v||0)+1);
    return this.put('releases', { projectId, v, title:'', kind:'feature', items:[], ts:new Date().toISOString(), ...data, v }, { label:'Add release', ...opts });
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
    this.updateProject(projectId, { changelogUrl:sourceUrl, lastSyncAt:Date.now() }, { silent:true });
    return { added, updated };
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
    this.updateProject(projectId, { changelogUrl:sourceUrl, lastSyncAt:Date.now() }, { silent:true });
    return { added, updated, removed };
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

  // ---- fleet health (recency + release velocity + status), 0-100 --------
  healthScore(projectId){
    const p = this.project(projectId);
    if(!p) return 0;
    const w = this.healthWeights();
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

  // A project "needs attention" when its health score has slipped into the
  // bottom two bands (Slowing/Stale) or its auto-sync is failing outright.
  // One shared definition so the dashboard callout and the library's saved
  // view always agree on exactly the same set of projects, sorted worst-off
  // first. Each reason is `{ kind:'health'|'sync', text }` so callers can
  // render the right chip style without recomputing the logic themselves.
  needsAttention(){
    return this.projects().map(p=>{
      const score = this.healthScore(p.id);
      const band = healthBand(score);
      const reasons = [];
      if(band.label==='Slowing' || band.label==='Stale') reasons.push({ kind:'health', text:`${band.label} · ${score}/100` });
      if(p.autoSync && (p.autoSyncFailCount||0)>=AUTO_SYNC_FAIL_THRESHOLD) reasons.push({ kind:'sync', text:`Auto-sync failing ×${p.autoSyncFailCount}` });
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
  importJSON(text){
    const parsed = JSON.parse(text);
    if(!parsed || !parsed.projects) throw new Error('Not a Manager workspace');
    parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings||{}) };
    TABLES.forEach(t=>parsed[t]=parsed[t]||{});
    this._db = parsed; this._save();
    this.emit('change', {}); TABLES.forEach(t=>this.emit(t,{}));
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
      status:'building', icon:'gauge', pinned:true, cadence:'GitHub Action · hourly',
      tags:['console','tooling','static'],
      description:'Mission control for the fleet — the app you are looking at.',
      assessment:'Mission control for the whole fleet — this very console. Freshly launched (v1) and set to self-improve hourly.' },
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
  // Relay — real, recent changelog entries (verified from its js/changelog.js).
  rel('relay', 16, 'Landing page: sync locations', '2026-07-02T13:28:08.306Z', [
    'The front page now shows off "bring your own backup" — sync to a local folder, S3-compatible storage, or WebDAV.',
  ], 'feature');
  rel('relay', 15, 'Sync locations: WebDAV', '2026-07-02T13:15:04Z', [
    'Settings → Advanced → "Sync locations" now has a WebDAV option — Nextcloud, ownCloud, or any self-hosted server.',
    'Enter a server URL, username, and app password; Relay keeps a live snapshot there.',
  ], 'feature');
  rel('relay', 14, 'Sync locations: S3-compatible storage', '2026-07-02T12:38:11Z', [
    'An S3-compatible option — Cloudflare R2, Backblaze B2, AWS S3, MinIO, or anything that speaks the S3 API.',
    'Relay signs requests itself (no SDK, no server) and keeps a live snapshot in the bucket.',
  ], 'feature');

  // First cadence entry: this launch counts as feature run #1.
  const rid = uuid();
  db.runs[rid] = { id:rid, projectId:'manager', mode:'feature', note:'v1 — Mission Control launch', ts:now, createdAt:now, updatedAt:now };
}
