// Admin — unlock with the admin token, then mint invite links to share.
// Everything is local + client-side (see access.js). No server.
import { Access } from '../access.js';
import { el, escapeHtml, toast, ago, fmtCT, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

export function renderAdmin(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  wrap.append(el('div',{class:'section-title', style:'margin-top:0', html:`<span style="color:var(--brand-b);display:inline-flex">${icon('shield')}</span><h2>Admin</h2>`}));

  if(!Access.isAdmin()){
    const card=el('div',{class:'card', style:'max-width:560px'});
    card.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:14px">Unlock admin</h2></div>
      <p class="muted tiny">Paste your admin token to unlock invite management. The token is your private key — it’s stored only in this browser and never leaves your device.</p>`;
    const ta=el('textarea',{class:'input mono', rows:'3', placeholder:'Paste admin token…', spellcheck:'false'});
    const btn=el('button',{class:'btn primary', style:'margin-top:6px', html:`${icon('key')} Unlock`, onclick:async()=>{
      btn.disabled=true;
      const ok=await Access.unlockAdmin(ta.value);
      btn.disabled=false;
      if(ok){ toast('Admin unlocked',{kind:'ok'}); ctx.refresh(); }
      else toast('Invalid admin token',{kind:'err'});
    }});
    const f=el('div',{class:'field'}); f.append(el('label',{text:'Admin token'}), ta);
    card.append(f, btn);
    wrap.append(card); root.append(wrap); return;
  }

  // unlocked
  const head=el('div',{class:'card', style:'display:flex;align-items:center;gap:12px;flex-wrap:wrap'});
  head.innerHTML=`<span class="status s-live"><span class="dot"></span>Admin unlocked</span>
    <span class="muted tiny" style="flex:1;min-width:120px">You can mint invite links below.</span>`;
  head.append(el('button',{class:'btn sm', html:`${icon('lock')} Lock`, onclick:()=>{ Access.lockAdmin(); toast('Admin locked',{kind:'ok'}); ctx.refresh(); }}));
  wrap.append(head);

  // mint
  const mint=el('div',{class:'card', style:'margin-top:16px'});
  mint.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:14px">Create an invite</h2></div>
    <p class="muted tiny">Generates a signed, unforgeable invite link. Send it to someone — opening it unlocks the app for them. No server checks it.</p>`;
  const label=el('input',{class:'input', placeholder:'Who is this for? (e.g. Grace)'});
  const exp=el('select',{class:'input'});
  [['7','7 days'],['30','30 days'],['90','90 days'],['0','Never expires']].forEach(([v,t])=>exp.append(el('option',{value:v,text:t})));
  const lf=el('div',{class:'field', style:'flex:1'}); lf.append(el('label',{text:'Label'}), label);
  const ef=el('div',{class:'field'}); ef.append(el('label',{text:'Expires'}), exp);
  const row=el('div',{style:'display:flex;gap:14px;flex-wrap:wrap'}); row.append(lf, ef);
  const gen=el('button',{class:'btn primary', html:`${icon('plus')} Generate invite link`, onclick:async()=>{
    try{ await Access.mintInvite({ label:label.value.trim(), days:parseInt(exp.value,10) });
      label.value=''; toast('Invite created',{kind:'ok'}); renderAdmin(root,ctx); }
    catch(e){ toast('Could not create',{body:e.message,kind:'err'}); }
  }});
  mint.append(row, gen);
  wrap.append(mint);

  // revocation helper
  if(Access.blocklist().length){
    const rev=el('div',{class:'card', style:'margin-top:16px'});
    rev.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:14px">Revoked invites</h2></div>
      <p class="muted tiny">Revoked invites are blocked instantly on this device. To block them for <b>everyone</b>, paste the list into <span class="kbd">js/revoked.js</span> and redeploy.</p>`;
    const code=el('textarea',{class:'input mono', rows:'2', readonly:'', spellcheck:'false',
      value:`export const REVOKED = ${JSON.stringify(Access.blocklist())};`});
    rev.append(code, el('button',{class:'btn sm', style:'margin-top:8px', html:`${icon('copy')} Copy blocklist`,
      onclick:()=>navigator.clipboard?.writeText(code.value).then(()=>toast('Blocklist copied',{kind:'ok'}))}));
    wrap.append(rev);
  }

  // minted list
  const list=Access.minted();
  wrap.append(el('div',{class:'section-title', html:`<h2>Invites you’ve created (${list.length})</h2>`}));
  if(!list.length){
    wrap.append(el('div',{class:'card muted', text:'No invites yet. Create one above to share.'}));
  }else{
    const g=el('div',{class:'grid', style:'gap:10px'});
    list.forEach(inv=>g.append(inviteRow(inv, root, ctx)));
    wrap.append(g);
  }
  root.append(wrap);
}

function inviteRow(inv, root, ctx){
  const revoked = inv.jti && Access.isRevoked(inv.jti);
  const c=el('div',{class:'card invite-row', style:revoked?'opacity:.6':''});
  const expTxt = inv.exp ? `expires ${new Date(inv.exp).toLocaleDateString()}` : 'never expires';
  const tags=[inv.jti?`id ${inv.jti}`:'', expTxt, revoked?'REVOKED':''].filter(Boolean).join(' · ');
  c.innerHTML=`<div style="flex:1;min-width:0">
    <b>${escapeHtml(inv.label||'Untitled invite')}</b>
    <div class="muted tiny">created ${ago(inv.iat)} · ${tags}</div></div>`;
  const btns=el('div',{class:'invite-actions'});
  btns.append(el('button',{class:'btn sm', html:`${icon('copy')} Copy link`, onclick:()=>navigator.clipboard?.writeText(inv.link).then(()=>toast('Invite link copied',{kind:'ok'}))}));
  if(inv.jti && !revoked){
    btns.append(el('button',{class:'btn sm danger', html:`${icon('shield')} Revoke`, onclick:async()=>{
      if(await confirmDialog('Revoke invite','Blocks this invite instantly on this device. To block it everywhere, copy the blocklist into js/revoked.js and redeploy.',{danger:true,okLabel:'Revoke'})){
        Access.revoke(inv.jti); toast('Invite revoked',{kind:'ok'}); renderAdmin(root,ctx); } }}));
  }
  btns.append(el('button',{class:'btn ghost icon sm', html:icon('trash'), title:'Remove from list', 'aria-label':'Remove from list', onclick:async()=>{
    if(await confirmDialog('Remove invite','This only removes it from your local list; the link keeps working unless revoked or expired.',{danger:true,okLabel:'Remove'})){
      Access.forget(inv.iat); renderAdmin(root,ctx); } }}));
  c.append(btns);
  return c;
}
