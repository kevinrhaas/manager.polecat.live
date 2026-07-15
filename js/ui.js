// Stateless DOM + UX helpers (toasts, modals, formatting).
//
// Migrated onto the vendored Polecat Shell: the primitives that are
// behavior-identical ($, el, escapeHtml, uuid) re-export from
// vendor/polecat-shell/ui.js — one fleet implementation, not eight. What
// stays app-local is Manager-specific: helpers the shell doesn't ship
// (trapFocus, mdToHtml, sparkline, drag-reorder…), Manager's brand-arc
// avatarColor, debounce with the autosave-tuned 700ms default, and the
// toast/modal/confirmDialog trio, which every view calls with Manager's
// historical signatures (candidates for shell v2 adoption).
import { icon } from './icons.js';

export { $, el, escapeHtml, uuid } from '../vendor/polecat-shell/ui.js';
import { $, el, escapeHtml, uuid } from '../vendor/polecat-shell/ui.js';

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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Confines Tab/Shift+Tab to `container` (a modal/sheet/popover) and restores
// focus to whatever had it before the surface opened once `release()` runs —
// without this, a keyboard user can Tab straight through an "on top" overlay
// into the page behind it, and loses their place entirely once it closes.
// `skip` optionally excludes an element (e.g. a header close button) from
// being the *initial* focus target, so a modal with a text field focuses the
// field first rather than the X in the corner.
export function trapFocus(container, { skip }={}){
  const prev = document.activeElement;
  function focusables(){ return [...container.querySelectorAll(FOCUSABLE)].filter(el=>el.offsetParent!==null); }
  const initial = focusables().find(el=>el!==skip) || focusables()[0] || container;
  if(initial===container) container.tabIndex = -1;
  requestAnimationFrame(()=>initial.focus());
  function onKeydown(e){
    if(e.key!=='Tab') return;
    const items = focusables();
    if(!items.length) return;
    const first = items[0], last = items[items.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKeydown);
  return function release(){
    container.removeEventListener('keydown', onKeydown);
    if(prev && document.contains(prev) && typeof prev.focus==='function') prev.focus();
  };
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

// Delays calling `fn` until `ms` has passed with no further calls — the
// autosave pattern (type, pause, save) used by the notes scratchpad.
export function debounce(fn, ms=700){
  let t;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

// ---- tiny Markdown → HTML (notes scratchpad preview) ----------------------
// Deliberately small: headings, bold/italic, inline code, fenced code blocks,
// links, block quotes, ordered/unordered lists, and paragraphs. Escapes HTML
// first so pasted markup is always rendered as text, never executed.
export function mdToHtml(src){
  const text = String(src||'').replace(/\r\n/g,'\n');
  if(!text.trim()) return '';
  const inline = s=>escapeHtml(s)
    .replace(/`([^`]+)`/g,(m,c)=>`<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = text.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol' | null — the list currently open in `out`
  const closeList = ()=>{ if(list){ out.push(`</${list}>`); list=null; } };
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(/^```/.test(line)){
      closeList();
      const code=[]; i++;
      while(i<lines.length && !/^```/.test(lines[i])){ code.push(lines[i]); i++; }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if(h){ closeList(); const lvl=Math.min(h[1].length+2,6); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if(ul){ if(list!=='ul'){ closeList(); out.push('<ul>'); list='ul'; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if(ol){ if(list!=='ol'){ closeList(); out.push('<ol>'); list='ol'; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    const bq = line.match(/^>\s?(.*)$/);
    if(bq){ closeList(); out.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue; }
    if(!line.trim()){ closeList(); continue; }
    closeList();
    const para=[line];
    while(i+1<lines.length && lines[i+1].trim() && !/^(#{1,4})\s|^[-*]\s|^\d+\.\s|^>\s?|^```/.test(lines[i+1])){ i++; para.push(lines[i]); }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  closeList();
  return out.join('\n');
}

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
  const titleId = 'modal-title-'+uuid();
  const m = el('div',{class:'modal'+(wide?' wide':''), role:'dialog', 'aria-modal':'true', 'aria-labelledby':titleId});
  const head = el('div',{class:'modal-head', html:
    `${ic?`<span style="color:var(--brand-b)">${icon(ic)}</span>`:''}<h3 id="${titleId}">${escapeHtml(title)}</h3>`});
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
  const releaseFocus = trapFocus(m, { skip:close });
  function hide(){overlay.classList.remove('show');setTimeout(()=>overlay.remove(),220);document.removeEventListener('keydown',esc);releaseFocus()}
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

// ---- reorderable-list helpers -------------------------------------------
// Shared by every "drag a grip, or use the up/down arrows" reorder UI
// (Settings' custom-field list, the library's saved-views reorder modal):
// native HTML5 drag-and-drop delegated on the list container, so it survives
// a full rebuild of the rows on every change, plus a pure helper for the
// arrow buttons' neighbor-swap.

// Wires drag-and-drop reordering for a vertical list of rows. Dragging only
// starts from a row's `gripSelector` handle (the row itself isn't
// draggable), so clicking any other control in the row is never mistaken for
// a drag start. While dragging, the row reflows live in the DOM as it passes
// over neighbors; on drop (or a dragend with no valid drop) `onReorder` is
// called once with the row order exactly as it now sits in the DOM.
export function wireDragReorder(container, rowSelector, gripSelector, onReorder){
  let draggingId=null;
  container.addEventListener('dragstart', (e)=>{
    const grip=e.target.closest(gripSelector);
    const row=e.target.closest(rowSelector);
    if(!grip || !row){ e.preventDefault(); return; }
    draggingId=row.dataset.id;
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain', draggingId);
    requestAnimationFrame(()=>row.classList.add('dragging'));
  });
  container.addEventListener('dragover', (e)=>{
    if(!draggingId) return;
    e.preventDefault();
    const over=e.target.closest(rowSelector);
    const dragging=container.querySelector(rowSelector+'.dragging');
    if(!over || !dragging || over===dragging) return;
    const before = e.clientY < over.getBoundingClientRect().top + over.offsetHeight/2;
    container.insertBefore(dragging, before ? over : over.nextSibling);
  });
  container.addEventListener('drop', (e)=>{ e.preventDefault(); });
  container.addEventListener('dragend', ()=>{
    const dragging=container.querySelector(rowSelector+'.dragging');
    if(dragging) dragging.classList.remove('dragging');
    if(draggingId){
      const ids=[...container.querySelectorAll(rowSelector)].map(r=>r.dataset.id);
      draggingId=null;
      onReorder(ids);
    }
  });
}

// The up/down-arrow alternative to dragging: swap `id` with its immediate
// neighbor in `ids`. Returns the new ordered array, or null if the move is
// out of bounds (already first/last) — native drag has patchy touch support
// on real mobile browsers, so this is the mobile-safe reorder path.
export function swapNeighbor(ids, id, dir){
  const i=ids.indexOf(id), j=i+dir;
  if(i<0 || j<0 || j>=ids.length) return null;
  const next=[...ids];
  [next[i], next[j]]=[next[j], next[i]];
  return next;
}
