// -----------------------------------------------------------------------
// shell.js — the app frame: left rail + top bar + main view + right panel
// + app switcher. Merged from the fleet's rails (jobtracker/manager: the
// declarative SECTIONS with group separators + admin/simple flags; relay:
// drag-to-resize + double-click snap) behind one parameterized API.
//
// Dependency-free on purpose: shell.js is the first module an app adopts,
// so it must not drag ui.js/icons.js in with it — tiny helpers are inlined.
// Styling lives in shell.css (ps- prefixed classes); tokens in tokens.css.
// -----------------------------------------------------------------------

// Tiny DOM builder (same shape as ui.js el(), inlined to stay dep-free).
function h(tag, props={}, children){
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
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Inline chrome glyphs (24×24, currentColor — the shell can't import icons.js).
const GLYPH = {
  chevron: '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  menu:    '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  waffle:  '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>',
  close:   '<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const MODE_RANK = { simple:0, standard:1, expert:2 };
const MINW = 190, MAXW = 340;
const MOBILE = '(max-width: 860px)';   // keep in sync with shell.css drawer breakpoint

// ---- initShell --------------------------------------------------------------
// Builds the layout into `mount` (default document.body): rail + backdrop +
// (topbar + main). Sections: { key, label, icon, minMode?, admin? } items and
// { group } separators. `icon` is an inline-SVG string (caller uses icons.js).
export function initShell({
  app = {}, sections = [], onNav = ()=>{},
  isAdmin, uiMode,
  rail: railOpts = {}, topbar: topbarOpts = {},
  mount = document.body,
} = {}){
  const K = railOpts.storageKey || 'ps.rail';
  const resizable = railOpts.resizable !== false;
  const admin = typeof isAdmin==='function' ? !!isAdmin() : !!isAdmin;
  const mode = (typeof uiMode==='function' ? uiMode() : uiMode) || 'expert';
  const modeRank = MODE_RANK[mode] ?? MODE_RANK.expert;

  mount.classList.add('ps-shell');
  const rail = h('aside',{class:'ps-rail', 'data-app':app.id||''});
  const backdrop = h('div',{class:'ps-rail-backdrop'});
  const topbar = h('header',{class:'ps-topbar'});
  const view = h('div',{class:'ps-view'});
  const main = h('div',{class:'ps-main'}, [topbar, view]);
  mount.append(rail, backdrop, main);

  // -- persisted open/width -----------------------------------------------
  // Desktop: persisted, default expanded. Mobile: the rail is an overlay
  // drawer, so it ALWAYS boots closed — a persisted desktop "open" must
  // never cover a phone's content on load.
  const open0 = window.matchMedia(MOBILE).matches ? false
    : localStorage.getItem(K+'.open') !== '0';
  const clampW = w => Math.max(MINW, Math.min(MAXW, w||232));
  const w0 = clampW(parseInt(localStorage.getItem(K+'.width')||'232',10));
  document.documentElement.style.setProperty('--rail-w-open', w0+'px');
  rail.classList.toggle('open', open0);

  function setOpen(v, persist=true){
    rail.classList.toggle('open', v);
    rail.querySelector('.ps-rail-toggle')?.setAttribute('aria-expanded', String(v));
    if(persist) localStorage.setItem(K+'.open', v?'1':'0');
  }
  // The boot rule must also hold mid-session: when the viewport crosses INTO
  // drawer range (window shrink / phone rotation), a desktop "open" rail
  // would otherwise pop the drawer over the content. Close it without
  // persisting, so the desktop preference survives the round trip.
  // (Found by relay's shell migration — its smoke suite shrinks to 390px.)
  window.matchMedia(MOBILE).addEventListener?.('change', (e)=>{
    if(e.matches && rail.classList.contains('open')) setOpen(false, false);
  });
  // Navigating from the mobile drawer closes it — without persisting, so the
  // desktop rail state survives a phone session.
  function nav(key){
    if(window.matchMedia(MOBILE).matches) setOpen(false, false);
    onNav(key);
  }

  // -- rail: brand + sections ----------------------------------------------
  const visible = sections.filter(s => s.group ||
    ((!s.admin || admin) && modeRank >= (MODE_RANK[s.minMode] ?? 0)));
  const firstKey = visible.find(s=>s.key)?.key;
  rail.append(h('button',{class:'ps-rail-brand', title:esc(app.name||''),
    html:`<span class="ps-rail-logo">${app.wordmark || `<b>${esc((app.name||'?')[0])}</b>`}</span>`+
         `<span class="bt"><b>${esc(app.name||'')}</b><small>polecat.live</small></span>`,
    onclick:()=>{ if(firstKey) nav(firstKey); }}));

  const scroll = h('div',{class:'ps-rail-scroll'});
  let pendingGroup = null;   // group labels append lazily — an all-filtered group leaves no orphan header
  visible.forEach(s=>{
    if(s.group){ pendingGroup = s.group; return; }
    if(pendingGroup){ scroll.append(h('div',{class:'ps-rail-group', text:pendingGroup})); pendingGroup=null; }
    scroll.append(h('button',{class:'ps-rail-item', 'data-sec':s.key, title:esc(s.label),
      html:`${s.icon||''}<span class="lbl">${esc(s.label)}</span><span class="badge" hidden></span>`,
      onclick:()=>nav(s.key)}));
  });
  rail.append(scroll);

  const toggle = h('button',{class:'ps-rail-toggle', title:'Collapse / expand navigation',
    'aria-expanded':String(open0), html:GLYPH.chevron,
    onclick:()=>setOpen(!rail.classList.contains('open'))});
  rail.append(toggle);
  if(resizable){
    const handle = h('div',{class:'ps-rail-resize', title:'Drag to resize'});
    rail.append(handle);
    wireResize(rail, handle, K, clampW, setOpen);
  }
  backdrop.addEventListener('click', ()=>setOpen(false, false));

  // -- topbar: hamburger + slot arrays of nodes (or node-returning builders) --
  const slot = nodes => (nodes||[]).map(n => typeof n==='function' ? n() : n);
  topbar.append(
    h('button',{class:'btn icon ghost ps-topbar-menu', 'aria-label':'Open navigation',
      html:GLYPH.menu, onclick:()=>setOpen(true, false)}),
    h('div',{class:'ps-tb-left'},   slot(topbarOpts.left)),
    h('div',{class:'ps-tb-center'}, slot(topbarOpts.center)),
    h('div',{class:'ps-tb-right'},  slot(topbarOpts.right)),
  );

  return {
    setActive:(key)=>rail.querySelectorAll('.ps-rail-item').forEach(n=>n.classList.toggle('active', n.dataset.sec===key)),
    // tone (optional) themes the badge — 'danger' ships in shell.css; apps
    // may style their own `tone-<name>` classes. Omitted = the default accent.
    setBadge:(key,n,tone)=>{
      const b = rail.querySelector(`.ps-rail-item[data-sec="${key}"] .badge`); if(!b) return;
      [...b.classList].filter(c=>c.startsWith('tone-')).forEach(c=>b.classList.remove(c));
      if(tone) b.classList.add('tone-'+tone);
      if(n>0){ b.textContent = n>99?'99+':String(n); b.hidden=false; } else b.hidden=true;
    },
    setOpen:(v)=>setOpen(v),
    els:{ root:mount, rail, topbar, main:view },
  };
}

// Drag-to-resize from the rail's right edge; double-click snaps open/closed.
function wireResize(rail, handle, K, clampW, setOpen){
  let startX=0, startW=0, active=false;
  const onMove=(e)=>{
    if(!active) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const w = clampW(startW + (x-startX));
    document.documentElement.style.setProperty('--rail-w-open', w+'px');
    if(!rail.classList.contains('open')) setOpen(true);
  };
  const onUp=()=>{
    if(!active) return;
    active=false; rail.classList.remove('dragging');
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w-open'),10);
    localStorage.setItem(K+'.width', clampW(w));
    document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp);
    document.removeEventListener('touchmove',onMove); document.removeEventListener('touchend',onUp);
  };
  const onDown=(e)=>{
    active=true; rail.classList.add('dragging');
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rail-w-open'),10)||232;
    document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    document.addEventListener('touchmove',onMove,{passive:false}); document.addEventListener('touchend',onUp);
    e.preventDefault();
  };
  handle.addEventListener('mousedown', onDown);
  handle.addEventListener('touchstart', onDown, {passive:false});
  handle.addEventListener('dblclick', ()=>setOpen(!rail.classList.contains('open')));
}

// ---- rightPanel --------------------------------------------------------------
// Slide-in panel from the right (What's-New, notifications, change log).
// One at a time: opening a second closes the first. Escape closes (unless a
// modal is stacked on top — the modal owns Escape then); focus is trapped
// lightly and returned to the opener on close.
let _rpanel = null;
export function rightPanel({ title='', body, onClose } = {}){
  if(_rpanel) _rpanel.close();
  const trigger = document.activeElement;
  const back  = h('div',{class:'ps-rpanel-back'});
  const panel = h('aside',{class:'ps-rpanel', role:'dialog', 'aria-modal':'true',
    'aria-label':title||'Panel', tabindex:'-1'});
  panel.append(
    h('div',{class:'ps-rpanel-head'},[
      h('h2',{text:title}),
      h('button',{class:'btn icon ghost', 'aria-label':'Close panel', html:GLYPH.close, onclick:()=>close()}),
    ]),
    h('div',{class:'ps-rpanel-body'}, Array.isArray(body)?body:(body?[body]:[])),
  );
  document.body.append(back, panel);
  requestAnimationFrame(()=>{
    back.classList.add('in'); panel.classList.add('in');
    (panel.querySelector(FOCUSABLE)||panel).focus();
  });
  let closed = false;
  function close(){
    if(closed) return; closed = true;
    back.classList.remove('in'); panel.classList.remove('in');
    setTimeout(()=>{ back.remove(); panel.remove(); }, 240);
    document.removeEventListener('keydown', onKey);
    if(_rpanel && _rpanel.close===close) _rpanel = null;
    onClose && onClose();
    if(trigger && document.contains(trigger) && typeof trigger.focus==='function') trigger.focus();
  }
  function onKey(e){
    if(document.querySelector('.modal-back')) return;   // a dialog is on top
    if(e.key==='Escape'){ close(); return; }
    if(e.key!=='Tab') return;
    const f=[...panel.querySelectorAll(FOCUSABLE)];
    if(!f.length){ e.preventDefault(); return; }
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    else if(!panel.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e=>{ if(e.target===back) close(); });
  _rpanel = { close };
  return { close, el: panel };
}

// ---- appSwitcher ---------------------------------------------------------------
// A topbar button that opens the waffle grid of fleet apps. `catalog` is a
// list of { name, icon, url, status, accent? } (catalog.js FLEET works as-is);
// `icon` may be an inline-SVG string or a single character — anything else
// (e.g. an icons.js name the caller didn't resolve) falls back to the app's
// initial. 'soon' entries render disabled; `current` (id or name) highlights.
export function appSwitcher(catalog = [], { current } = {}){
  const btn = h('button',{class:'btn icon ghost ps-waffle-btn', 'aria-label':'Switch app',
    'aria-haspopup':'true', 'aria-expanded':'false', title:'Polecat apps', html:GLYPH.waffle});
  let pop = null;

  function tileIcon(a){
    const ic = a.icon || '';
    if(/^\s*</.test(ic)) return ic;                              // inline SVG
    if([...ic].length===1 || (ic.length<=3 && !/^[a-z-]+$/i.test(ic))) return esc(ic);   // char / emoji
    return esc((a.name||'?')[0]);                                // unresolved name → initial
  }
  function close(refocus=true){
    if(!pop) return;
    pop.remove(); pop = null;
    btn.setAttribute('aria-expanded','false');
    document.removeEventListener('mousedown', onOut);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', place);
    if(refocus) btn.focus();
  }
  function onOut(e){ if(pop && !pop.contains(e.target) && !btn.contains(e.target)) close(false); }
  function onKey(e){ if(e.key==='Escape') close(); }
  function place(){
    if(!pop) return;
    const r = btn.getBoundingClientRect();
    pop.style.top  = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
  }
  function open(){
    pop = h('div',{class:'ps-waffle-pop', role:'menu', 'aria-label':'Polecat apps'});
    pop.append(h('div',{class:'ps-waffle-title', text:'Polecat apps'}));
    const grid = h('div',{class:'ps-waffle-grid'});
    catalog.forEach(a=>{
      const cur  = current!=null && (a.id===current || a.name===current);
      const soon = a.status==='soon';
      const cls  = 'ps-waffle-item' + (cur?' current':'') + (soon?' soon':'');
      const inner = [
        h('span',{class:'ps-waffle-ic', style:a.accent?`--w-accent:${a.accent}`:'', html:tileIcon(a)}),
        h('span',{class:'ps-waffle-name', text:a.name}),
      ];
      if(soon) inner.push(h('span',{class:'chip', text:'soon'}));
      else if(a.status==='beta') inner.push(h('span',{class:'chip', text:'beta'}));
      grid.append(soon
        ? h('span',{class:cls, 'aria-disabled':'true'}, inner)
        : h('a',{class:cls, href:a.url, 'aria-current':cur?'page':null,
            onclick:()=>close(false)}, inner));
    });
    pop.append(grid);
    document.body.append(pop);
    place();
    btn.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>(pop.querySelector(FOCUSABLE)||pop).focus());
    setTimeout(()=>{ document.addEventListener('mousedown', onOut); document.addEventListener('keydown', onKey); }, 0);
    window.addEventListener('resize', place);
  }
  btn.addEventListener('click', ()=> pop ? close() : open());
  return btn;
}
