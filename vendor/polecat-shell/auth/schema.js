// -----------------------------------------------------------------------
// auth/schema.js — the backend-agnostic description of identity for the
// Polecat suite, mirroring the DataSource adapter pattern (manager
// js/sources/schema.js): one small contract, many drop-in adapters, so
// "bring your own backend" is a first-class path, not a fork.
//
// An auth adapter is a plain object:
//
//   {
//     id:       'supabase',            // unique, lowercase
//     label:    'Supabase',            // human name for settings UI
//     caps: {
//       oauth:  ['google','apple'],    // providers signInWithOAuth accepts
//       email:  true,                  // magic-link / OTP email sign-in
//     },
//     async init(cfg)                  // one-time setup; cfg is adapter-
//                                      //   specific (urls, keys) and always
//                                      //   injected by the app, never baked in
//     async getUser()                  // -> { id, email, name?, avatarUrl? } | null
//     onAuthChange(cb)                 // cb(user|null) on every transition;
//                                      //   returns an unsubscribe fn
//     async signInWithOAuth(provider)  // 'google' | 'apple' | …
//     async signInWithEmail(email)     // sends the link/code; resolve = sent
//     async signOut()
//   }
//
// Adapters NEVER throw for "not signed in" — that state is `null`. They throw
// only for real failures (bad config, network), and callers surface those via
// ui.js toast(). Everything works logged-out; auth only ever ADDS capability.
// -----------------------------------------------------------------------

export const AUTH_SCHEMA_VERSION = 1;

const REGISTRY = new Map();

// Idempotent by id, same as Studio.registerSource — safe to call from both an
// app and a vendored default without double-registering.
export function registerAuthSource(adapter){
  if(!adapter || !adapter.id) throw new Error('auth adapter needs an id');
  if(!REGISTRY.has(adapter.id)) REGISTRY.set(adapter.id, adapter);
  return REGISTRY.get(adapter.id);
}

export function authSources(){ return [...REGISTRY.values()]; }
export function authSource(id){ return REGISTRY.get(id) || null; }

// The active adapter for this app. Defaults to whatever registered first
// (apps ship auth/null.js registered as 'none'), switchable from settings.
let active = null;
export function setActiveAuth(id){
  const a = authSource(id);
  if(!a) throw new Error(`unknown auth adapter: ${id}`);
  active = a;
  return a;
}
export function activeAuth(){
  return active || authSources()[0] || null;
}
