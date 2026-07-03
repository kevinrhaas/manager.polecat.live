// Notification center — a topbar bell that surfaces Store.needsAttentionActive()
// from anywhere in the app, not just the dashboard. It renders the exact same
// rows as the dashboard's "Needs attention" callout (attentionRow, imported
// from home.js) so the badge count, the popover list, and the dashboard
// callout can never drift out of sync with each other. Dismissed items drop
// out of the "active" set but stay one click away via the footer's "N
// dismissed" link (openDismissedModal, also from home.js).
import { Store } from '../store.js';
import { el } from '../ui.js';
import { icon } from '../icons.js';
import { attentionRow, openDismissedModal } from './home.js';

let btn=null, pop=null, cleanup=null, ctxFor=null; // ctxFor: the ctx the open popover was built with

export function buildNotifBell(ctx){
  btn = el('button',{class:'btn icon ghost notif-btn', title:'Notifications', 'aria-label':'Notifications',
    html:`${icon('bell')}<span class="badge" hidden></span>`,
    onclick:(e)=>{ e.stopPropagation(); pop ? closePanel() : openPanel(ctx); }});
  refreshNotifBadge();
  return btn;
}

export function refreshNotifBadge(){
  if(!btn) return;
  const n=Store.needsAttentionActive().length;
  const badge=btn.querySelector('.badge');
  if(n>0){ badge.textContent = n>99?'99+':String(n); badge.hidden=false; }
  else badge.hidden=true;
  if(pop){
    renderList(pop.querySelector('.notif-pop-body'), ctxFor);
    renderFoot(pop.querySelector('.notif-pop-foot'), ctxFor);
  }
}

function renderFoot(foot, ctx){
  if(!foot) return;
  foot.innerHTML='';
  const dismissedCount=Store.dismissedAttention().length;
  if(dismissedCount) foot.append(el('button',{class:'btn sm ghost', html:`${icon('eyeOff')} ${dismissedCount} dismissed`, onclick:()=>openDismissedModal(ctx)}));
  foot.append(el('button',{class:'btn sm', html:`${icon('grid')} Open dashboard`, onclick:()=>{ closePanel(); ctx.go('home'); }}));
}

function openPanel(ctx){
  ctxFor=ctx;
  pop=el('div',{class:'notif-pop'});
  const head=el('div',{class:'notif-pop-head'});
  head.innerHTML=`<span style="color:var(--danger);display:inline-flex">${icon('bell')}</span><h3>Notifications</h3>`;
  head.append(el('span',{class:'sp'}));
  const body=el('div',{class:'notif-pop-body'});
  head.append(el('button',{class:'btn ghost icon sm', title:'Close', 'aria-label':'Close', html:icon('x'), onclick:()=>closePanel()}));
  pop.append(head, body);
  const foot=el('div',{class:'notif-pop-foot'});
  pop.append(foot);
  document.body.append(pop);
  positionPanel();
  renderList(body, ctx);
  renderFoot(foot, ctx);
  requestAnimationFrame(()=>pop.classList.add('show'));

  const onDoc=(e)=>{ if(pop && !pop.contains(e.target) && e.target!==btn && !btn.contains(e.target)) closePanel(); };
  const onEsc=(e)=>{ if(e.key==='Escape') closePanel(); };
  const onResize=()=>positionPanel();
  document.addEventListener('mousedown', onDoc);
  document.addEventListener('keydown', onEsc);
  window.addEventListener('resize', onResize);
  cleanup=()=>{
    document.removeEventListener('mousedown', onDoc);
    document.removeEventListener('keydown', onEsc);
    window.removeEventListener('resize', onResize);
  };
}

// Anchor the popover's right edge under the bell, but clamp its left edge to
// the viewport — on mobile the bell isn't the rightmost topbar button (theme
// + add-project sit further right), so a naive right-align can push the box
// off-screen to the left.
function positionPanel(){
  if(!pop || !btn) return;
  const r=btn.getBoundingClientRect();
  const w=pop.getBoundingClientRect().width || 380;
  const left=Math.max(12, Math.min(r.right-w, window.innerWidth-w-12));
  pop.style.left = Math.round(left)+'px';
  pop.style.top = Math.round(r.bottom+8)+'px';
}

function renderList(body, ctx){
  if(!body) return;
  body.innerHTML='';
  const attn=Store.needsAttentionActive();
  if(!attn.length){
    body.append(el('div',{class:'notif-pop-empty', html:`${icon('check')}<span>All clear — nothing needs attention.</span>`}));
    return;
  }
  // close the popover before any navigation the row triggers (project link,
  // "Open", or the redirect-to-home a retry does once it resolves)
  const closingCtx = { ...ctx, go:(...a)=>{ closePanel(); ctx.go(...a); } };
  attn.forEach(a=>body.append(attentionRow(a, closingCtx)));
}

function closePanel(){
  if(!pop) return;
  pop.classList.remove('show');
  cleanup?.(); cleanup=null;
  const dying=pop; pop=null; ctxFor=null;
  setTimeout(()=>dying.remove(), 160);
}
