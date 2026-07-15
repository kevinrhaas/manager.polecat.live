// -----------------------------------------------------------------------
// access.js — invite-only gate (serverless, tamper-resistant).
//
// ⚠ CLIENT-SIDE UX GATING ONLY — THIS IS **NOT** A SECURITY BOUNDARY. The
// app's files remain publicly served; anyone can read the source and strip
// the gate. It stops casual access and provides a clean invite flow, which
// is exactly what an "invite-only preview" needs. Real protection is
// Cloudflare Access (see docs/DOMAINS.md) — never describe this as security.
//
// How it works: the app is public source, so a shared secret would be
// forgeable. Instead we use asymmetric signatures: the PUBLIC key is passed
// in by the app (anyone can VERIFY an invite), while the PRIVATE key is the
// admin token (only the admin can MINT invites). Invites are ECDSA-P256
// signed tokens, shared as links (…?invite=<token>). Nothing is checked
// against a server. Ported from Manager's access.js, parameterized for the
// fleet: each app supplies its own key pair, storage-key prefix, and
// build-time revocation list.
//
//   const Access = createAccess({
//     prefix: 'manager',            // storage keys: <prefix>.access / .adminkey / .invites / .revoked
//     publicKey: '<spki b64>',      // ECDSA P-256 public key
//     revoked: REVOKED,             // build-time jti blocklist (app's revoked.js)
//     linkBase,                     // optional invite-link base URL (default: current page)
//   });
//   const { granted } = await Access.init();   // consumes ?invite= from the URL
// -----------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- base64 / base64url ------------------------------------------------
function b64ToBuf(b64){ const s=atob(b64); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i); return u.buffer; }
function bufToB64(buf){ const u=new Uint8Array(buf); let s=''; for(const b of u) s+=String.fromCharCode(b); return btoa(s); }
function b64url(b64){ return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unb64url(u){ u=u.replace(/-/g,'+').replace(/_/g,'/'); while(u.length%4) u+='='; return u; }

async function importPriv(pkcs8b64){
  return crypto.subtle.importKey('pkcs8', b64ToBuf(pkcs8b64.trim()),
    { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
}

export function createAccess({ prefix, publicKey, revoked=[], linkBase }={}){
  if(!prefix) throw new Error('createAccess: prefix is required');
  if(!publicKey) throw new Error('createAccess: publicKey is required');

  const A_KEY   = `${prefix}.access`;    // { grantedAt, via, label }
  const ADM_KEY = `${prefix}.adminkey`;  // admin private key (pkcs8 b64), admin device only
  const INV_KEY = `${prefix}.invites`;   // locally-kept list of minted invites
  const REV_KEY = `${prefix}.revoked`;   // locally-revoked jti list (instant, this device)

  // ---- key import (cached) ----------------------------------------------
  let _pub=null;
  async function pub(){ return _pub ||= crypto.subtle.importKey('spki', b64ToBuf(publicKey),
    { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']); }

  return {
    // ---- state -----------------------------------------------------------
    isGranted(){ try{ return !!JSON.parse(localStorage.getItem(A_KEY)||'null'); }catch{ return false; } },
    grant(via, label){ try{ localStorage.setItem(A_KEY, JSON.stringify({ grantedAt:Date.now(), via, label:label||'' })); }catch{} },
    info(){ try{ return JSON.parse(localStorage.getItem(A_KEY)||'null'); }catch{ return null; } },
    revokeSelf(){ localStorage.removeItem(A_KEY); },

    isAdmin(){ return !!localStorage.getItem(ADM_KEY); },
    lockAdmin(){ localStorage.removeItem(ADM_KEY); },

    // ---- invite verification --------------------------------------------
    async verifyInvite(code){
      try{
        const [p, s] = String(code).trim().split('.');
        if(!p || !s) return { ok:false, reason:'malformed' };
        const okSig = await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' },
          await pub(), b64ToBuf(unb64url(s)), enc.encode(p));
        if(!okSig) return { ok:false, reason:'bad signature' };
        const payload = JSON.parse(dec.decode(b64ToBuf(unb64url(p))));
        if(payload.exp && Date.now() > payload.exp) return { ok:false, reason:'expired', payload };
        if(payload.jti && this.isRevoked(payload.jti)) return { ok:false, reason:'revoked', payload };
        return { ok:true, payload };
      }catch(e){ return { ok:false, reason:'invalid' }; }
    },

    // ---- revocation ------------------------------------------------------
    localRevoked(){ try{ return JSON.parse(localStorage.getItem(REV_KEY)||'[]'); }catch{ return []; } },
    isRevoked(jti){ return revoked.includes(jti) || this.localRevoked().includes(jti); },
    revoke(jti){ const l=new Set(this.localRevoked()); l.add(jti); try{ localStorage.setItem(REV_KEY, JSON.stringify([...l])); }catch{}
      const inv=this.minted().map(x=>x.jti===jti?{...x,revoked:true}:x); try{ localStorage.setItem(INV_KEY, JSON.stringify(inv)); }catch{} },
    blocklist(){ return [...new Set([...revoked, ...this.localRevoked()])]; },

    // Is this string the admin private key that matches our public key?
    // (Sign a throwaway message with it, verify with the public key — the
    // message content itself never matters.)
    async verifyAdminToken(token){
      try{
        const priv = await importPriv(token);
        const msg = enc.encode(`${prefix}-admin-check`);
        const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, priv, msg);
        return crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, await pub(), sig, msg);
      }catch{ return false; }
    },
    async unlockAdmin(token){
      if(!await this.verifyAdminToken(token)) return false;
      try{ localStorage.setItem(ADM_KEY, token.trim()); }catch{}
      this.grant('admin', 'Admin');
      return true;
    },

    // ---- invite minting (admin only) ------------------------------------
    async mintInvite({ label='', days=0 }={}){
      const token = localStorage.getItem(ADM_KEY);
      if(!token) throw new Error('Admin is locked');
      const priv = await importPriv(token);
      const iat = Date.now();
      const exp = days>0 ? iat + days*86400000 : 0;
      const jti = bufToB64(crypto.getRandomValues(new Uint8Array(6)).buffer).replace(/[^a-zA-Z0-9]/g,'').slice(0,8);
      const body = { v:1, label, iat, exp, jti };
      const p = b64url(bufToB64(enc.encode(JSON.stringify(body))));
      const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, priv, enc.encode(p));
      const code = p + '.' + b64url(bufToB64(sig));
      const base = linkBase || (location.origin + location.pathname);
      const link = `${base}${base.includes('?')?'&':'?'}invite=${encodeURIComponent(code)}`;
      this._remember({ label, iat, exp, jti, code, link });
      return { code, link, iat, exp, label, jti };
    },
    minted(){ try{ return JSON.parse(localStorage.getItem(INV_KEY)||'[]'); }catch{ return []; } },
    _remember(rec){ const l=this.minted(); l.unshift(rec); try{ localStorage.setItem(INV_KEY, JSON.stringify(l.slice(0,50))); }catch{} },
    forget(iat){ try{ localStorage.setItem(INV_KEY, JSON.stringify(this.minted().filter(x=>x.iat!==iat))); }catch{} },

    // ---- boot: consume ?invite= from the URL, then report status --------
    async init(){
      const params = new URLSearchParams(location.search);
      const invite = params.get('invite');
      if(invite){
        const r = await this.verifyInvite(invite);
        if(r.ok) this.grant('invite', r.payload.label||'');
        params.delete('invite');
        const clean = location.pathname + (params.toString()?`?${params}`:'') + location.hash;
        history.replaceState(null, '', clean);
        if(!r.ok) return { granted:this.isGranted(), inviteError:r.reason };
      }
      return { granted:this.isGranted() };
    },
  };
}
