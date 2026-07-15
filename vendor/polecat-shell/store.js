// -----------------------------------------------------------------------
// store.js — Polecat Shell: local-first, versioned document store (factory).
//
// Distilled from AutoSelector's versioned workspace document (ordered,
// additive MIGRATIONS + snapshot-based labelled undo/redo) and JobTracker's
// Emitter pattern. This is a FACTORY, not a singleton, and carries zero
// domain logic — each app calls createStore() with its own storageKey,
// schema version, migrations map and seed, and layers its domain methods on
// top of mutate().
//
// Forward-compatibility contract (the reason this module exists):
//   • The document carries `schemaVersion` (an int). Every load runs
//     migrate(), which upgrades an older document IN PLACE and never deletes
//     unknown keys — so a newer build's data survives a rollback to an older
//     deploy as long as the core keys keep their meaning.
//   • `migrations[n]` upgrades a document FROM version n to n+1. Keep each
//     step tiny and additive.
//   • Keys added to the seed later are backfilled on every load (top level),
//     so purely-additive shape changes don't even need a migration.
// -----------------------------------------------------------------------

// Tiny event emitter (JobTracker pattern). Exported because apps often want
// the same shape for their own view-level buses.
export class Emitter{
  constructor(){ this._l = {}; }
  on(ev, fn){ (this._l[ev] ||= []).push(fn); return ()=>this.off(ev, fn); }
  off(ev, fn){ this._l[ev] = (this._l[ev] || []).filter(f=>f !== fn); }
  emit(ev, ...a){ (this._l[ev] || []).forEach(f=>{ try{ f(...a); }catch(e){ console.error(e); } }); }
}

// Documents are JSON-persisted, so a JSON round-trip is a faithful clone;
// structuredClone is just the faster path where available.
function clone(v){
  try{ return structuredClone(v); }
  catch{ return JSON.parse(JSON.stringify(v)); }
}

/**
 * createStore({ storageKey, schemaVersion, migrations, seed, maxUndo }) →
 * { get, mutate(label, fn), undo, redo, canUndo, canRedo, on, off, export, import }
 *
 * - storageKey     required — apps keep their historical keys.
 * - schemaVersion  the version this build writes (default 1).
 * - migrations     { n: (doc)=>{} } — upgrades n → n+1 (additive only).
 * - seed           object or () => object — a fresh blank document.
 * - maxUndo        undo stack depth (default 100).
 *
 * Events (on/off): 'change' {label}, 'undo' label, 'redo' label,
 * 'persist-error' error (localStorage quota / privacy mode — the app keeps
 * working in memory; surface a toast so the user knows saves aren't landing).
 */
export function createStore({ storageKey, schemaVersion = 1, migrations = {}, seed, maxUndo = 100 } = {}){
  if(!storageKey) throw new Error('createStore: storageKey is required');
  const emitter = new Emitter();

  function blank(){
    const d = clone(typeof seed === 'function' ? seed() : (seed ?? {}));
    if(typeof d.schemaVersion !== 'number') d.schemaVersion = schemaVersion;
    return d;
  }

  // Upgrade any older document in place. Never drops unknown keys (rollback
  // safety), and treats a document from a NEWER build as already-migrated.
  function migrate(d){
    if(!d || typeof d !== 'object' || Array.isArray(d)) return blank();
    if(typeof d.schemaVersion !== 'number') d.schemaVersion = 1;
    while(d.schemaVersion < schemaVersion && typeof migrations[d.schemaVersion] === 'function'){
      const from = d.schemaVersion;
      migrations[from](d);
      // A migration that forgets to bump would loop forever — advance for it.
      if(d.schemaVersion === from) d.schemaVersion = from + 1;
    }
    // Any remaining gap has no migration — the additive backfill below IS the
    // upgrade for purely-additive versions, so stamp the current version.
    if(d.schemaVersion < schemaVersion) d.schemaVersion = schemaVersion;
    // Backfill top-level keys added to the seed since this doc was written
    // (safe on every load; never overwrites existing data).
    const b = blank();
    for(const k of Object.keys(b)) if(!(k in d)) d[k] = clone(b[k]);
    return d;
  }

  function load(){
    try{ return migrate(JSON.parse(localStorage.getItem(storageKey) || 'null')) || blank(); }
    catch{ return blank(); }
  }
  function persist(){
    try{ localStorage.setItem(storageKey, JSON.stringify(doc)); }
    catch(e){ console.warn('store persist failed (quota?)', e); emitter.emit('persist-error', e); }
  }

  let doc = load();

  // ---- undo / redo --------------------------------------------------------
  // Snapshot-based: before every mutation we push a labelled JSON snapshot of
  // the whole document. Cheap because shell-store documents are user-state,
  // not bulk catalogs — keep big static data OUT of the store.
  const undoStack = [];   // [{ label, at, doc:jsonString }]
  const redoStack = [];

  function mutate(label, fn){
    const before = JSON.stringify(doc);
    try{
      fn(doc);            // fn mutates the live doc; the snapshot makes it safe
    }catch(e){
      doc = JSON.parse(before);   // a throwing mutation must not half-apply
      throw e;
    }
    undoStack.push({ label, at: Date.now(), doc: before });
    if(undoStack.length > maxUndo) undoStack.shift();
    redoStack.length = 0;         // a new edit invalidates the redo branch
    persist();
    emitter.emit('change', { label });
    return doc;
  }

  // Snapshots are re-migrated on restore: an undo across a deploy boundary
  // could otherwise resurrect a pre-migration shape.
  function undo(){
    const s = undoStack.pop(); if(!s) return null;
    redoStack.push({ label: s.label, at: Date.now(), doc: JSON.stringify(doc) });
    doc = migrate(JSON.parse(s.doc));
    persist();
    emitter.emit('change', { label: s.label });
    emitter.emit('undo', s.label);
    return s.label;
  }
  function redo(){
    const s = redoStack.pop(); if(!s) return null;
    undoStack.push({ label: s.label, at: Date.now(), doc: JSON.stringify(doc) });
    doc = migrate(JSON.parse(s.doc));
    persist();
    emitter.emit('change', { label: s.label });
    emitter.emit('redo', s.label);
    return s.label;
  }

  return {
    // Read access to the live document. Treat it as read-only — all writes
    // must go through mutate() so they're persisted, undoable and announced.
    get(){ return doc; },

    mutate, undo, redo,
    canUndo(){ return undoStack.length > 0; },
    canRedo(){ return redoStack.length > 0; },

    on: (ev, fn)=>emitter.on(ev, fn),
    off: (ev, fn)=>emitter.off(ev, fn),

    // JSON round-trip. Export wraps the document with provenance; import
    // accepts either that wrapper or a bare document, migrates whatever
    // schema it carries, and is itself undoable.
    export(){
      return JSON.stringify({ schemaVersion: doc.schemaVersion, exportedAt: new Date().toISOString(), data: doc }, null, 2);
    },
    import(text){
      const parsed = JSON.parse(text);                       // throws on garbage — caller toasts
      const incoming = (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object')
        ? parsed.data : parsed;
      return mutate('Import data', ()=>{ doc = migrate(clone(incoming)); });
    },
  };
}
