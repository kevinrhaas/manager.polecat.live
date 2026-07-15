// -----------------------------------------------------------------------
// auth/null.js — the logged-out-first default adapter. Every Polecat app is
// fully useful without an account (local-first data); this adapter makes
// that the explicit baseline: getUser() is always null and sign-in points
// people at what accounts WILL add plus the bring-your-own-backend docs.
//
// Apps replace it by registering a real adapter (auth/supabase.js) and
// calling setActiveAuth('supabase') once configured.
// -----------------------------------------------------------------------

import { registerAuthSource } from './schema.js';

export const nullAuth = registerAuthSource({
  id: 'none',
  label: 'No account (local-first)',
  caps: { oauth: [], email: false },

  async init(){ /* nothing to set up */ },
  async getUser(){ return null; },
  onAuthChange(){ return () => {}; },   // never fires; unsubscribe is a no-op

  async signInWithOAuth(){
    throw new Error('Accounts are coming soon. Everything works without one — your data lives in this browser. Self-hosters: see docs/PLATFORM.md § Auth seam.');
  },
  async signInWithEmail(){
    throw new Error('Accounts are coming soon. Everything works without one — your data lives in this browser.');
  },
  async signOut(){ /* already signed out, always */ },
});
