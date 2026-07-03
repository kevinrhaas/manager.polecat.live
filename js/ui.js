// Stateless DOM + UX helpers (toasts, modals, formatting).
import { icon } from './icons.js';

export const $  = (s, r=document) => r.querySelector(s);

export function el(tag, attrs={}, children){
  const n = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==='class') n.className=v;
    else if(k==='html') n.innerHTML=v;
    else if(k==='text') n.textContent=v;
    else if(k.startsWith('on') && typeof v==='function') n.addEventListener(k.slice(2),v);
    else if(v!=null&&v!==false) n.setAttribute(k, v===true?'':v);
  }
  if(children!=null){
    (Array.isArray(children)?children:[children]).forEach(c=>{
      if(c==null) return;
      n.append(c.nodeType?c:document.createTextNode(c));
    });
  }
  return n;
}

// A non-button element (card, tile, table row) that acts like a button —
// wires it up for keyboard users: focusable, announced as a button, and
// activatable with Enter/Space, without hijacking Enter/Space presses meant
// for a nested real button/link/input the row happens to contain.
export function makeRowClickable(node, fn, label){
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  if(label) node.setAttribute('aria-label', label);
  node.addEventListener('keydown', (e)=>{
    if(e.target !== node) return;
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fn(e); }
  });
  return node;
}

export function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---- deterministic color from a string (avatars / dots) ------------------
export function hue(str){
  let h=0; for(let i=0;i<String(str).length;i++) h=(h*31+str.charCodeAt(i))>>>0;
  return h%360;
}
// Bias toward the Mission-Control cyan→indigo→violet arc (160–300°) so avatars
// feel on-brand while staying distinct.
export function avatarColor(id){
  const base = 160 + (hue(id) % 150);
  return `linear-gradient(135deg,hsl(${base} 78% 62%),hsl(${(base+40)%360} 70% 52%))`;
}

// ---- time --------------------------------------------------------------
export function ago(ts){
  if(!ts) return '—';
  const s=Math.max(0,(Date.now()-ts)/1000);
  if(s<45) return 'just now';
  if(s<90) return '1 min ago';
  if(s<3600) return `${Math.round(s/60)} min ago`;
  if(s<5400) return '1 hr ago';
  if(s<86400) return `${Math.round(s/3600)} hr ago`;
  if(s<172800) return 'yesterday';
  return `${Math.round(s/86400)} d ago`;
}
// Central-Time formatter (the house time zone). Accepts ms epoch or ISO string.
export function fmtCT(ts, {withTime=true}={}){
  if(!ts) return '—';
  const d = typeof ts==='number' ? new Date(ts) : new Date(ts);
  if(isNaN(d)) return '—';
  try{
    const opts = { timeZone:'America/Chicago', month:'short', day:'numeric', year:'numeric' };
    if(withTime){ opts.hour='numeric'; opts.minute='2-digit'; }
    return d.toLocaleString('en-US', opts) + ' CT';
  }catch{ return d.toISOString(); }
}
export function uuid(){
  if(crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16);
  });
}
// ---- tiny inline bar-chart (release-velocity trend) ---------------------
export function sparkline(data, { width=64, height=20, color='var(--brand-b)', gap=2 }={}){
  const n = data.length || 1;
  const max = Math.max(1, ...data);
  const bw = Math.max(1.5, (width - gap*(n-1)) / n);
  const bars = data.map((v,i)=>{
    const h = Math.max(2, Math.round((v/max)*height));
    const x = (bw+gap)*i;
    return `<rect x="${x.toFixed(2)}" y="${height-h}" width="${bw.toFixed(2)}" height="${h}" rx="1"></rect>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="fill:${color}" aria-hidden="true">${bars}</svg>`;
}
export function slugify(s){ return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

// ---- toasts ------------------------------------------------------------
export function toast(title, {body='', kind='info', ms=3800, action}={}){
  const host = $('#toasts') || document.body.appendChild(el('div',{id:'toasts'}));
  const ic = {ok:'check',err:'x',info:'info',warn:'info'}[kind]||'info';
  const t = el('div',{class:`toast ${kind}`, html:
    `<span class="ic">${icon(ic)}</span><div style="flex:1"><b>${escapeHtml(title)}</b>${body?`<p>${escapeHtml(body)}</p>`:''}</div>`});
  const kill=()=>{clearTimeout(to);t.classList.remove('show');setTimeout(()=>t.remove(),320)};
  if(action){
    const a=el('div',{class:'undo', text:action.label||'Undo', onclick:(e)=>{ e.stopPropagation(); action.fn(); kill(); }});
    t.querySelector('div').append(a);
  }
  host.append(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  const to=setTimeout(kill,ms);
  t.addEventListener('click',kill);
  return kill;
}

// ---- modal -------------------------------------------------------------
export function modal({title='', body, foot, wide=false, icon:ic}={}){
  const overlay = el('div',{class:'overlay'});
  const m = el('div',{class:'modal'+(wide?' wide':'')});
  const head = el('div',{class:'modal-head', html:
    `${ic?`<span style="color:var(--brand-b)">${icon(ic)}</span>`:''}<h3>${escapeHtml(title)}</h3>`});
  const close = el('button',{class:'btn ghost icon', title:'Close', 'aria-label':'Close', html:icon('x'), onclick:()=>hide()});
  head.append(close);
  const bodyEl = el('div',{class:'modal-body'});
  if(typeof body==='string') bodyEl.innerHTML=body; else if(body) bodyEl.append(body);
  m.append(head, bodyEl);
  if(foot){ const f=el('div',{class:'modal-foot'}); (Array.isArray(foot)?foot:[foot]).forEach(b=>b&&f.append(b)); m.append(f); }
  overlay.append(m);
  overlay.addEventListener('mousedown',e=>{if(e.target===overlay) hide()});
  document.body.append(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));
  function hide(){overlay.classList.remove('show');setTimeout(()=>overlay.remove(),220);document.removeEventListener('keydown',esc)}
  function esc(e){if(e.key==='Escape') hide()}
  document.addEventListener('keydown',esc);
  return {overlay, body:bodyEl, hide};
}

export function confirmDialog(title, message, {danger=false, okLabel='Confirm'}={}){
  return new Promise(res=>{
    const ok = el('button',{class:'btn '+(danger?'danger':'primary'), text:okLabel});
    const cancel = el('button',{class:'btn', text:'Cancel'});
    const {hide} = modal({title, body:`<p class="muted">${escapeHtml(message)}</p>`, foot:[cancel, ok]});
    ok.onclick=()=>{hide();res(true)}; cancel.onclick=()=>{hide();res(false)};
  });
}
