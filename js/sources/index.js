// -----------------------------------------------------------------------
// sources/index.js — the DataSource registry.
//
// One place that knows every backend. Adding a new one (PlanetScale, Neon,
// D1, Mongo, …) is: write an adapter to the sources/base.js contract and add
// it to SOURCES. Everything else — the picker, the connect flow, the rail
// indicator, sync.js — is generic over this list.
// -----------------------------------------------------------------------

import { localSource }    from './local.js';
import { tursoSource }    from './turso.js';
import { supabaseSource } from './supabase.js';
import { firebaseSource } from './firebase.js';

// Order = order shown in the picker. Local first (the default), then remotes.
export const SOURCES = [ localSource, tursoSource, supabaseSource, firebaseSource ];

// Just the connectable remotes (Local is the always-present fallback).
export const REMOTE_SOURCES = SOURCES.filter(s=>!s.local);

export function sourceById(id){ return SOURCES.find(s=>s.id===id) || null; }

export { localSource };
