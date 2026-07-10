// -----------------------------------------------------------------------
// crypto.js — at-rest encryption for secret values, keyed by a passphrase.
//
// Used to encrypt the credentials vault BEFORE it's written to a remote data
// source, so secrets never sit in plaintext in the remote database. This is
// zero-knowledge: the passphrase and the plaintext never leave the browser —
// the remote only ever holds AES-256-GCM ciphertext + a (non-secret) salt, so
// a leaked database dump reveals nothing without the passphrase.
//
// Standard WebCrypto, no dependencies. PBKDF2(SHA-256) stretches the
// passphrase into an AES-GCM key; each value gets its own random 96-bit IV.
// -----------------------------------------------------------------------

const PBKDF2_ITERS = 150000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function cryptoAvailable(){ return !!(globalThis.crypto && crypto.subtle && crypto.getRandomValues); }

function b64(buf){ let s=''; const b=new Uint8Array(buf); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
function unb64(s){ const bin=atob(s); const b=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) b[i]=bin.charCodeAt(i); return b; }

// A fresh random salt (base64) — public, stored alongside the ciphertext so
// any browser with the passphrase can re-derive the same key.
export function newSalt(){ return b64(crypto.getRandomValues(new Uint8Array(16))); }

export async function deriveKey(passphrase, saltB64, iters=PBKDF2_ITERS){
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:unb64(saltB64), iterations:iters, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}

// { __enc:1, iv, ct } — a self-describing ciphertext envelope for one string.
export async function encryptStr(key, plain){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(String(plain)));
  return { __enc:1, iv:b64(iv), ct:b64(ct) };
}

export async function decryptStr(key, env){
  const pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:unb64(env.iv) }, key, unb64(env.ct));
  return dec.decode(pt);
}

export function isEnvelope(v){ return !!(v && typeof v==='object' && v.__enc===1 && typeof v.ct==='string' && typeof v.iv==='string'); }

// Verify a passphrase against a known envelope (used when unlocking on another
// browser) — returns the decrypted plaintext, or throws if the key is wrong.
export async function verifyKey(key, env){ return decryptStr(key, env); }
