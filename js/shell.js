// shell.js — the collapsible, animated, drag-to-resize "rail" navigation.
import { el, escapeHtml } from './ui.js';
import { icon } from './icons.js';

const escapeLbl = (s)=>escapeHtml(String(s||''));

const K_OPEN = 'manager.rail.open';
const K_WIDTH = 'manager.rail.width';
const MINW = 190, MAXW = 340;

// `simple:true` items stay visible in Simple mode; the rest hide there.
export const SECTIONS = [
  { group:'Fleet' },
  { key:'home',        label:'Dashboard',   icon:'home',     simple:true },
  { key:'projects',    label:'Projects',    icon:'grid',     simple:true },
  { key:'releases',    label:'Releases',    icon:'sparkle',  simple:true },
  { key:'activity',    label:'Activity',    icon:'activity' },
  { group:'Setup' },
  { key:'credentials', label:'Credentials', icon:'key' },
  { key:'docs',        label:'Docs',        icon:'book',     simple:true },
  { group:'System' },
  { key:'admin',       label:'Admin',       icon:'shield',   admin:true },
  { key:'settings',    label:'Settings',    icon:'settings', simple:true },
];

export function buildRail(rail, { onNav, isAdmin=false, simple=false }){
  const open0 = localStorage.getItem(K_OPEN)==='1';
  const w = clampW(parseInt(localStorage.getItem(K_WIDTH)||'240',10));
  document.documentElement.style.setProperty('--rail-w-open', w+'px');
  rail.classList.toggle('open', open0);

  rail.innerHTML='';
  const brand=el('button',{class:'rail-brand', title:'Manager — dashboard',
    html:`<img src="/assets/logo.svg" alt=""/><span class="bt"><b>Manager</b><small>polecat.live</small></span>`,
    onclick:()=>onNav('home')});
  rail.append(brand);

  const scroll=el('div',{class:'rail-scroll'});
  SECTIONS.forEach(s=>{
    if(s.group){ scroll.append(el('div',{class:'rail-sec-label', text:s.group})); return; }
    if(s.admin && !isAdmin) return;         // Admin only when unlocked
    if(simple && !s.simple) return;         // Simple mode trims advanced sections
    const item=el('button',{class:'rail-item', 'data-sec':s.key, title:s.label,
      html:`${icon(s.icon)}<span class="lbl">${s.label}</span><span class="badge" hidden></span>`,
      onclick:()=>onNav(s.key)});
    scroll.append(item);
  });
  rail.append(scroll);

  // data-source indicator — shows where the workspace lives (Local / a
  // connected database) with a live status dot; click jumps to Admin → Data
  // source. Updated via setSource() from the app's sync subscription.
  const source=el('button',{class:'rail-source', title:'Data source', 'data-status':'local',
    html:`<span class="rail-src-dot"></span><span class="rail-src-txt"><b>Local</b><small>this browser</small></span>`,
    onclick:()=>onNav('admin')});
  rail.append(source);

  const toggle=el('button',{class:'rail-toggle', title:'Toggle navigation', 'aria-expanded':String(open0),
    html:icon('chevron'), onclick:()=>setOpen(rail, !rail.classList.contains('open'))});
  const resize=el('div',{class:'rail-resize', title:'Drag to resize'});
  rail.append(toggle, resize);

  wireResize(rail, resize);
  return {
    setActive:(key)=>rail.querySelectorAll('.rail-item').forEach(n=>n.classList.toggle('active', n.dataset.sec===key)),
    setSource:(st)=>{
      const dotColor = st.source?.accent || 'var(--brand-b)';
      source.dataset.status = st.status;
      source.title = st.isRemote ? `Data source: ${st.label} (${st.status})` : 'Data source: Local (this browser)';
      source.style.setProperty('--src-dot', dotColor);
      const sub = st.isRemote ? (st.status==='error'?'sync error':(st.status==='syncing'?'syncing…':'connected')) : 'this browser';
      source.querySelector('.rail-src-txt').innerHTML=`<b>${escapeLbl(st.label)}</b><small>${sub}</small>`;
    },
    setBadge:(key,n,tone)=>{
      const b=rail.querySelector(`.rail-item[data-sec="${key}"] .badge`); if(!b) return;
      b.classList.toggle('tone-danger', tone==='danger');
      if(n>0){ b.textContent=n>99?'99+':String(n); b.hidden=false; } else b.hidden=true;
    },
    setOpen:(v)=>setOpen(rail,v),
  };
}

function setOpen(rail, v){
  rail.classList.toggle('open', v);
  rail.querySelector('.rail-toggle')?.setAttribute('aria-expanded', String(v));
  localStorage.setItem(K_OPEN, v?'1':'0');
}
function clampW(w){ return Math.max(MINW, Math.min(MAXW, w||240)); }

function wireResize(rail, handle){
  let startX=0, startW=0, active=false;
  const onMove=(e)=>{
    if(!active) return;
    const x = e.touches?e.touches[0].clientX:e.clientX;
    const w = clampW(startW + (x-startX));
    document.documentElement.style.setProperty('--rail-w-open', w+'px');
    if(!rail.classList.contains('open')) setOpen(rail,true);
  };
  const onUp=()=>{
    if(!active) return;
    active=false; rail.classList.remove('dragging');
    const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w-open'),10);
    localStorage.setItem(K_WIDTH, clampW(w));
    document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp);
    document.removeEventListener('touchmove',onMove); document.removeEventListener('touchend',onUp);
  };
  const onDown=(e)=>{
    active=true; rail.classList.add('dragging');
    startX = e.touches?e.touches[0].clientX:e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w-open'),10)||240;
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    document.addEventListener('touchmove',onMove,{passive:false}); document.addEventListener('touchend',onUp);
    e.preventDefault();
  };
  handle.addEventListener('mousedown',onDown);
  handle.addEventListener('touchstart',onDown,{passive:false});
  handle.addEventListener('dblclick',()=>setOpen(rail,!rail.classList.contains('open')));
}
