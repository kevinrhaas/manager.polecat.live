// -----------------------------------------------------------------------
// sources/schema.js — the backend-agnostic description of a Polecat
// workspace: which tables exist, which columns are worth promoting to real
// queryable columns (vs. living inside a `data` JSON blob), and the marker
// that lets any adapter recognise "this database is a Polecat metadata repo".
//
// This is the single source of truth every DataSource adapter (local, Turso,
// Supabase, Firebase, …) builds against, so a new backend is "map these
// tables onto your storage" and nothing more. It is deliberately free of any
// Store / DOM import so it can be reused by other Polecat apps unchanged.
// -----------------------------------------------------------------------

// Bump when the shape below changes in a way an older client couldn't read.
export const SCHEMA_VERSION = 1;

// The app that owns a workspace. Other Polecat apps will register their own
// id here when they adopt this layer; probe() uses it to tell "my repo" from
// "some other Polecat app's repo" from "a foreign database".
export const APP_ID = 'manager';

// The marker table every provisioned workspace carries. Its presence (and a
// matching `app` row) is how probe() classifies a database as a Polecat repo.
export const META_TABLE = 'polecat_meta';

// Entity tables that make up a workspace, in dependency order (parents first
// so a relational restore never violates a foreign-key-shaped expectation).
// `columns` are promoted to real, indexed DB columns for dashboards to query;
// every other field rides along in a `data` JSON column, so the schema never
// has to migrate when a row grows a new attribute. `id` + `data` are implicit.
export const WORKSPACE_TABLES = [
  { name:'projects',    columns:['name','status','updatedAt'] },
  { name:'releases',    columns:['projectId','v','kind','ts','milestone'] },
  { name:'credentials', columns:['scope','key','updatedAt'] },
  { name:'runs',        columns:['projectId','mode','ts'] },
  { name:'fieldDefs',   columns:['key','type','order'] },
  { name:'savedViews',  columns:['name','order'] },
  { name:'dismissals',  columns:['projectId','reason'] },
];

export const TABLE_NAMES = WORKSPACE_TABLES.map(t=>t.name);

// SQL column type for a promoted column (SQLite/Postgres compatible subset).
function sqlType(col){
  if(['v','order','updatedAt','ts'].includes(col)) return 'INTEGER';
  if(col==='milestone') return 'INTEGER';         // 0/1 — SQLite has no bool
  return 'TEXT';
}

// A promoted column's value, normalised for a scalar SQL cell. Timestamps are
// stored as epoch-ms integers; `ts` on releases/runs is an ISO string in the
// row, so we coerce it. Booleans → 0/1. Everything else → its scalar or null.
export function columnValue(table, col, row){
  const v = row[col];
  if(v == null) return null;
  if(col==='ts') { const t = +new Date(v); return isNaN(t) ? null : t; }
  if(col==='milestone') return v ? 1 : 0;
  if(typeof v === 'object') return null;          // never happens for promoted cols
  return v;
}

// DDL for one entity table — promoted columns + a JSON `data` catch-all.
export function tableDDL(table){
  const def = WORKSPACE_TABLES.find(t=>t.name===table);
  const cols = ['id TEXT PRIMARY KEY',
    ...def.columns.map(c=>`"${c}" ${sqlType(c)}`),
    'data TEXT'];
  return `CREATE TABLE IF NOT EXISTS "${table}" (${cols.join(', ')})`;
}

// DDL for the whole workspace: the marker table + every entity table. Returned
// as an ordered list of statements so an adapter can run them one by one (and
// so the "paste this SQL" fallback for backends that can't DDL from the
// browser, e.g. Supabase, is a single readable script).
export function provisionDDL(){
  return [
    `CREATE TABLE IF NOT EXISTS "${META_TABLE}" (key TEXT PRIMARY KEY, value TEXT)`,
    ...TABLE_NAMES.map(tableDDL),
  ];
}

// The rows written into polecat_meta at provision time — the identity of the
// workspace. `settings` and `meta` (app-level singletons, not entity rows)
// live here too so the whole workspace is captured relationally without a
// bespoke table each.
export function metaRows(snapshot){
  return [
    { key:'app',            value: APP_ID },
    { key:'schema_version', value: String(SCHEMA_VERSION) },
    { key:'settings',       value: JSON.stringify(snapshot?.settings || {}) },
    { key:'meta',           value: JSON.stringify(snapshot?.meta || {}) },
  ];
}

// ---- snapshot <-> workspace ---------------------------------------------
// A snapshot is the portable, adapter-neutral form of a whole workspace:
//   { app, schemaVersion, tables:{ projects:[…rows], … }, settings, meta }
// Store produces one to push; adapters return one from load(). Keeping the
// shape here (not in store.js) means adapters never import the Store.

export function emptySnapshot(){
  const tables = {}; TABLE_NAMES.forEach(t=>tables[t]=[]);
  return { app:APP_ID, schemaVersion:SCHEMA_VERSION, tables, settings:{}, meta:{} };
}

// True when a probe result / snapshot looks like THIS app's workspace (vs.
// another Polecat app or a foreign DB). Used by the connect flow.
export function isOwnApp(app){ return app === APP_ID; }
