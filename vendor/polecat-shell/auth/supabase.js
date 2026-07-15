// -----------------------------------------------------------------------
// auth/supabase.js — the first real auth adapter. Supabase because it is
// open-source and self-hostable (the GPL bring-your-own-backend promise),
// ships Google/Apple/email OAuth out of the box, and is Postgres — the same
// substrate the analytics engine and the manager/analytics DataSource
// adapters already speak.
//
// The client library loads lazily from CDN ESM at init() so the fleet's
// no-build, no-dependency rule holds until the moment an app actually turns
// accounts on. Config ({ url, anonKey }) is ALWAYS injected by the app —
// pointing at Polecat's hosted project or at your own self-hosted Supabase
// is the same one-line change.
//
// Status: wired but dormant — no app calls init() until the Supabase phase
// (see ROADMAP.md). The null adapter stays the default.
// -----------------------------------------------------------------------

import { registerAuthSource } from './schema.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';

let client = null;

function user(sessionUser){
  if(!sessionUser) return null;
  const m = sessionUser.user_metadata || {};
  return {
    id: sessionUser.id,
    email: sessionUser.email || null,
    name: m.full_name || m.name || null,
    avatarUrl: m.avatar_url || null,
  };
}

export const supabaseAuth = registerAuthSource({
  id: 'supabase',
  label: 'Supabase',
  caps: { oauth: ['google', 'apple'], email: true },

  async init(cfg){
    if(!cfg || !cfg.url || !cfg.anonKey) throw new Error('supabase auth needs { url, anonKey }');
    const { createClient } = await import(/* lazily, only when enabled */ SUPABASE_ESM);
    client = createClient(cfg.url, cfg.anonKey);
  },

  async getUser(){
    if(!client) return null;
    const { data } = await client.auth.getSession();
    return user(data?.session?.user);
  },

  onAuthChange(cb){
    if(!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_evt, session) => cb(user(session?.user)));
    return () => data.subscription.unsubscribe();
  },

  async signInWithOAuth(provider){
    if(!client) throw new Error('supabase auth not initialised');
    // redirectTo defaults to the current page so each app returns to itself.
    const { error } = await client.auth.signInWithOAuth({
      provider, options: { redirectTo: location.origin + location.pathname },
    });
    if(error) throw error;
  },

  async signInWithEmail(email){
    if(!client) throw new Error('supabase auth not initialised');
    const { error } = await client.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if(error) throw error;
  },

  async signOut(){
    if(!client) return;
    await client.auth.signOut();
  },
});
