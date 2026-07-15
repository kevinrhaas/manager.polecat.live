// -----------------------------------------------------------------------
// ui.js — Polecat Shell DOM toolkit + feedback primitives.
//
// No framework, no build step. `el()` builds elements from a props object,
// plus a small set of primitives (toast, modal, sheet, popover, confirm)
// and formatting helpers shared across the fleet. Everything here is pure
// and side-effect free except the toast/modal mounts, which append to
// well-known root nodes. Ported from JobTracker's js/ui.js (class names kept
// verbatim — the shell CSS is the matching port), plus sheet() from Relay.
// -----------------------------------------------------------------------

export const $  = (sel, root=document) => root.querySelector(sel);
export const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

// Build a DOM node. props may include: class, text, html, style, data-*,
// aria-*, on* event handlers (onclick, oninput…), and any other attribute.
export function el(tag, props={}, children){
  const node = document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v==null || v===false) continue;
    if(k==='class') node.className = v;
    else if(k==='text') node.textContent = v;
    else if(k==='html') node.innerHTML = v;
    else if(k==='style') node.style.cssText = v;
    else if(k.startsWith('on') && typeof v==='function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  if(children){ (Array.isArray(children)?children:[children]).forEach(c=>{ if(c!=null) node.append(c); }); }
  return node;
}

// A labelled form field wrapper: <div.field><label/><control/><hint?/></div>
export function field(label, control, hint){
  const f = el('div',{class:'field'});
  if(label) f.append(el('label',{text:label}));
  f.append(control);
  if(hint) f.append(el('div',{class:'hint', text:hint}));
  return f;
}

export function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// RFC4122-ish v4 uuid using crypto when available.
export function uuid(){
  if(crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    const v = c==='x'? r : (r&0x3)|0x8; return v.toString(16);
  });
}

// ---- toasts -------------------------------------------------------------
export function toast(title, {body='', kind='info', ms=3200}={}){
  const root = $('#toasts') || document.body;
  const t = el('div',{class:`toast ${kind}`, role:'status', 'aria-live':'polite'});
  t.append(el('div',{class:'toast-title', text:title}));
  if(body) t.append(el('div',{class:'toast-body', text:body}));
  root.append(t);
  requestAnimationFrame(()=>t.classList.add('in'));
  const kill = ()=>{ t.classList.remove('in'); setTimeout(()=>t.remove(), 260); };
  t.addEventListener('click', kill);
  if(ms) setTimeout(kill, ms);
  return kill;
}

// Selector for elements a keyboard user can land on, used by the dialog
// focus traps below.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modals and sheets share one dialog stack: only the TOPMOST overlay reacts
// to Escape/Tab (a confirm over a sheet must not close the sheet too).
const DIALOG_BACKS = '.modal-back, .sheet-back';

// ---- modal --------------------------------------------------------------
// Returns { root, hide }. Body/foot are DOM nodes or arrays of nodes.
// Traps Tab focus inside the dialog while open (WAI-ARIA dialog pattern) and
// restores focus to whatever triggered it on close.
export function modal({ title, icon:iconHtml='', body, foot, wide=false, onClose }={}){
  const trigger = document.activeElement;
  const back = el('div',{class:'modal-back'});
  const box  = el('div',{class:'modal'+(wide?' wide':''), role:'dialog', 'aria-modal':'true', 'aria-label':title||'Dialog', tabindex:'-1'});
  const head = el('div',{class:'modal-head'});
  head.append(el('div',{class:'modal-title', html:`${iconHtml||''}<span>${escapeHtml(title||'')}</span>`}));
  const x = el('button',{class:'btn icon ghost', 'aria-label':'Close', html:'&times;', onclick:()=>hide()});
  head.append(x);
  const content = el('div',{class:'modal-body'});
  if(body) (Array.isArray(body)?body:[body]).forEach(b=>content.append(b));
  box.append(head, content);
  if(foot){ const f=el('div',{class:'modal-foot'}); (Array.isArray(foot)?foot:[foot]).forEach(b=>f.append(b)); box.append(f); }
  back.append(box);
  (document.body).append(back);
  requestAnimationFrame(()=>{
    back.classList.add('in');
    const first = box.querySelector(FOCUSABLE);
    (first||box).focus();
  });
  let closed = false;
  function hide(){
    if(closed) return; closed = true;
    back.classList.remove('in'); setTimeout(()=>back.remove(),200); onClose&&onClose();
    document.removeEventListener('keydown', onKey);
    // Return focus to whatever opened this dialog, if it's still around —
    // otherwise the browser silently drops focus to <body>.
    if(trigger && document.contains(trigger) && typeof trigger.focus==='function') trigger.focus();
  }
  function onKey(e){
    // When dialogs stack (e.g. a confirm on top of an editor), only the
    // topmost should react — otherwise Escape would close every layer at
    // once and the Tab trap below would fight over focus.
    const stack = $$(DIALOG_BACKS);
    if(stack[stack.length-1] !== back) return;
    if(e.key==='Escape'){ hide(); return; }
    if(e.key!=='Tab') return;
    const focusable = $$(FOCUSABLE, box);
    if(!focusable.length){ e.preventDefault(); return; }
    const firstEl = focusable[0], lastEl = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement===firstEl){ e.preventDefault(); lastEl.focus(); }
    else if(!e.shiftKey && document.activeElement===lastEl){ e.preventDefault(); firstEl.focus(); }
    else if(!box.contains(document.activeElement)){ e.preventDefault(); firstEl.focus(); }
  }
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e=>{ if(e.target===back) hide(); });
  return { root:box, back, hide };
}

// ---- sheet ----------------------------------------------------------------
// Slide-in side panel (record editors, What's-New) — modal()'s tall sibling.
// Ported from Relay's ui.js sheet(); class names ADAPTED to this file's
// modal-family naming (Relay used overlay/.show): the backdrop is
// `.sheet-back` (cf. `.modal-back`), the panel `.sheet` with `.sheet-head` >
// `.sheet-title`, `.sheet-body`, `.sheet-foot`, and the shown-state class is
// `.in` like every other overlay here. The panel RIDES the modal classes
// (`modal-back sheet-back` / `modal sheet`) so shell.css styles one dialog
// family; `data-side="left"|"bottom"` picks the edge (default slides in from
// the right). Same focus-trap / Escape / stacking behavior as modal().
export function sheet({ title, icon:iconHtml='', body, foot, side='right', onClose }={}){
  const trigger = document.activeElement;
  const back = el('div',{class:'modal-back sheet-back'});
  const box  = el('div',{class:'modal sheet', 'data-side':side, role:'dialog', 'aria-modal':'true', 'aria-label':title||'Panel', tabindex:'-1'});
  const head = el('div',{class:'sheet-head'});
  head.append(el('div',{class:'sheet-title', html:`${iconHtml||''}<span>${escapeHtml(title||'')}</span>`}));
  head.append(el('button',{class:'btn icon ghost', 'aria-label':'Close', html:'&times;', onclick:()=>hide()}));
  const content = el('div',{class:'sheet-body'});
  if(body) (Array.isArray(body)?body:[body]).forEach(b=>content.append(b));
  box.append(head, content);
  if(foot){ const f=el('div',{class:'sheet-foot'}); (Array.isArray(foot)?foot:[foot]).forEach(b=>f.append(b)); box.append(f); }
  back.append(box);
  document.body.append(back);
  requestAnimationFrame(()=>{
    back.classList.add('in');
    const first = box.querySelector(FOCUSABLE);
    (first||box).focus();
  });
  let closed = false;
  function hide(){
    if(closed) return; closed = true;
    // 240ms matches the slide-out transition (slightly longer than modal's fade).
    back.classList.remove('in'); setTimeout(()=>back.remove(),240); onClose&&onClose();
    document.removeEventListener('keydown', onKey);
    if(trigger && document.contains(trigger) && typeof trigger.focus==='function') trigger.focus();
  }
  function onKey(e){
    const stack = $$(DIALOG_BACKS);
    if(stack[stack.length-1] !== back) return;
    if(e.key==='Escape'){ hide(); return; }
    if(e.key!=='Tab') return;
    const focusable = $$(FOCUSABLE, box);
    if(!focusable.length){ e.preventDefault(); return; }
    const firstEl = focusable[0], lastEl = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement===firstEl){ e.preventDefault(); lastEl.focus(); }
    else if(!e.shiftKey && document.activeElement===lastEl){ e.preventDefault(); firstEl.focus(); }
    else if(!box.contains(document.activeElement)){ e.preventDefault(); firstEl.focus(); }
  }
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e=>{ if(e.target===back) hide(); });
  return { root:box, back, body:content, hide };
}

// ---- anchored popover -----------------------------------------------------
// Shared plumbing for the lightweight dropdown/menu panels anchored to a
// button (filter checklists, notification feeds, export menus) — as
// opposed to modal()'s full backdrop dialog. Positions the panel, closes on
// outside click / Escape, keeps Tab cycling inside while open, and returns
// focus to the anchor on close, matching modal()'s focus hygiene.
export function anchoredPopover(anchor, panel, { position, onClose }={}){
  document.body.append(panel);
  if(!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex','-1');
  const place = position || (()=>{
    const r = anchor.getBoundingClientRect();
    panel.style.top  = (r.bottom + 6) + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 12)) + 'px';
  });
  place();
  requestAnimationFrame(()=>{ const first = panel.querySelector(FOCUSABLE); (first||panel).focus(); });
  let closed = false;
  function close(){
    if(closed) return; closed = true;
    panel.remove();
    document.removeEventListener('mousedown', onOut);
    document.removeEventListener('keydown', onKey);
    if(position) window.removeEventListener('resize', place);
    onClose && onClose();
    if(anchor && document.contains(anchor) && typeof anchor.focus==='function') anchor.focus();
  }
  function onOut(e){ if(!panel.contains(e.target) && e.target!==anchor && !(anchor.contains && anchor.contains(e.target))) close(); }
  function onKey(e){
    if(e.key==='Escape'){ close(); return; }
    if(e.key!=='Tab') return;
    const focusable = $$(FOCUSABLE, panel);
    if(!focusable.length){ e.preventDefault(); return; }
    const firstEl = focusable[0], lastEl = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement===firstEl){ e.preventDefault(); lastEl.focus(); }
    else if(!e.shiftKey && document.activeElement===lastEl){ e.preventDefault(); firstEl.focus(); }
    else if(!panel.contains(document.activeElement)){ e.preventDefault(); firstEl.focus(); }
  }
  if(position) window.addEventListener('resize', place);
  setTimeout(()=>{ document.addEventListener('mousedown', onOut); document.addEventListener('keydown', onKey); }, 0);
  return { panel, close };
}

// Promise-based confirm dialog.
export function confirmDialog({ title='Are you sure?', message='', okText='Confirm', danger=false }={}){
  return new Promise(resolve=>{
    const body = el('p',{class:'muted', text:message});
    const { hide } = modal({ title, body,
      foot:[
        el('button',{class:'btn', text:'Cancel', onclick:()=>{ hide(); resolve(false); }}),
        el('button',{class:'btn '+(danger?'danger':'primary'), text:okText, onclick:()=>{ hide(); resolve(true); }}),
      ]});
  });
}

// Promise-based single-line/multiline text prompt — a themed replacement for
// window.prompt() (which ignores the app's theme, blocks the tab, and reads
// oddly on mobile). Resolves the trimmed value, or null if canceled.
export function promptDialog({ title='', message='', label='', placeholder='', okText='Save', multiline=true }={}){
  return new Promise(resolve=>{
    const ctrl = multiline
      ? el('textarea',{class:'input', rows:'3', placeholder})
      : el('input',{class:'input', type:'text', placeholder});
    const body = [];
    if(message) body.push(el('p',{class:'muted', text:message}));
    body.push(field(label, ctrl));
    let done = false;
    const finish = v=>{ if(done) return; done=true; hide(); resolve(v); };
    const { hide } = modal({ title, body,
      foot:[
        el('button',{class:'btn', text:'Cancel', onclick:()=>finish(null)}),
        el('button',{class:'btn primary', text:okText, onclick:()=>finish(ctrl.value.trim())}),
      ],
      onClose:()=>finish(null) });
    ctrl.addEventListener('keydown', e=>{
      if(e.key==='Enter' && (!multiline || e.metaKey || e.ctrlKey)){ e.preventDefault(); finish(ctrl.value.trim()); }
    });
    requestAnimationFrame(()=>ctrl.focus());
  });
}

// ---- confetti celebration -------------------------------------------------
// A lightweight, dependency-free confetti burst for delightful moments (e.g.
// marking a job complete). Skips entirely when the OS or in-app "reduce
// motion" preference is set — html[data-reduce-motion] is toggled by the
// shell's theme/settings modules.
const CONFETTI_COLORS = ['var(--brand)','var(--brand-2)','var(--accent)','var(--accent-2)','var(--success)','var(--warning)'];
export function celebrate(n=42){
  const reduced = document.documentElement.getAttribute('data-reduce-motion')==='1' ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(reduced) return;
  const root = el('div',{class:'confetti-root', 'aria-hidden':'true'});
  document.body.append(root);
  for(let i=0;i<n;i++){
    const dur = 1.3 + Math.random()*0.9;
    const piece = el('div',{class:'confetti-piece', style:`
      left:${Math.random()*100}%;
      background:${CONFETTI_COLORS[i%CONFETTI_COLORS.length]};
      width:${5+Math.random()*5}px; height:${8+Math.random()*7}px;
      animation-duration:${dur}s; animation-delay:${(Math.random()*0.3).toFixed(2)}s;
      --drift:${Math.round((Math.random()*2-1)*90)}px; --rot:${Math.round((Math.random()*2-1)*720)}deg;`});
    root.append(piece);
  }
  setTimeout(()=>root.remove(), 2600);
}

// ---- deterministic color for an id/string ------------------------------
export function avatarColor(str){
  let h=0; str=String(str||''); for(let i=0;i<str.length;i++) h=(h*31 + str.charCodeAt(i))>>>0;
  const hue=h%360; return `hsl(${hue} 55% 45%)`;
}
export function initials(name){
  return String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';
}

// ---- Central Time formatting -------------------------------------------
// All timestamps display in Central Time (CT) per fleet requirements.
const CT = 'America/Chicago';
export function fmtDate(d){
  if(!d) return '';
  const dt = (d instanceof Date)? d : new Date(d);
  if(isNaN(dt)) return String(d);
  return dt.toLocaleDateString('en-US',{ timeZone:CT, month:'short', day:'numeric', year:'numeric' });
}
export function fmtDateTime(d){
  if(!d) return '';
  const dt = (d instanceof Date)? d : new Date(d);
  if(isNaN(dt)) return String(d);
  return dt.toLocaleString('en-US',{ timeZone:CT, month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) + ' CT';
}
// "3 days ago" / "in 2 days" relative label
export function relTime(d){
  if(!d) return '';
  const dt=(d instanceof Date)?d:new Date(d); if(isNaN(dt)) return '';
  const diff = dt.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units=[['year',31536e6],['month',2592e6],['week',6048e5],['day',864e5],['hour',36e5],['minute',6e4]];
  for(const [u,ms] of units){ if(abs>=ms){ const n=Math.round(diff/ms);
    return new Intl.RelativeTimeFormat('en',{numeric:'auto'}).format(n,u); } }
  return 'just now';
}
// YYYY-MM-DD for <input type=date>
export function isoDate(d){
  if(!d) return '';
  const dt=(d instanceof Date)?d:new Date(d); if(isNaN(dt)) return '';
  return dt.toISOString().slice(0,10);
}

// Clipboard helper with toast feedback.
export async function copy(text, label='Copied'){
  try{ await navigator.clipboard.writeText(text); toast(label,{kind:'ok'}); }
  catch{ // fallback
    const ta=el('textarea',{style:'position:fixed;opacity:0'}); ta.value=text; document.body.append(ta);
    ta.select(); try{ document.execCommand('copy'); toast(label,{kind:'ok'}); }catch{ toast('Copy failed',{kind:'err'}); }
    ta.remove();
  }
}

// Trigger a client-side file download from a string or Blob.
export function download(filename, content, mime='text/plain'){
  const blob = content instanceof Blob ? content : new Blob([content],{type:mime});
  const url = URL.createObjectURL(blob);
  const a = el('a',{href:url, download:filename});
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

// Debounce a function.
export function debounce(fn, ms=200){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}
