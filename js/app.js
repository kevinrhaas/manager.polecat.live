// app.js — main controller: boot, gate, routing, top bar, cross-view glue.
// The app frame (rail + topbar + view + right panel + app switcher) comes
// from the vendored Polecat Shell; Manager's rail furniture (the data-source
// indicator) and its sections/topbar content are wired here.
import { Store } from './store.js';
import { Access } from './access.js';
import { configure as configureTheme, applyTheme, toggleMode } from '../vendor/polecat-shell/theme.js';
import { initShell, appSwitcher } from '../vendor/polecat-shell/shell.js';
import { FLEET } from '../vendor/polecat-shell/catalog.js';
import { el, $, escapeHtml, toast, trapFocus } from './ui.js';
import { icon } from './icons.js';
import { renderHome } from './views/home.js';
import { renderProjects, openProjectEditor, applyDefaultSavedView } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderReleases, unreadReleasesCount, markReleasesSeen } from './views/releases.js';
import { renderActivity } from './views/activity.js';
import { renderCredentials } from './views/credentials.js';
import { renderDocs } from './views/docs.js';
import { renderAdmin } from './views/admin.js';
import { renderSettings } from './views/settings.js';
import { openWhatsNew, hasUnread } from './views/whatsnew.js';
import { buildNotifBell, refreshNotifBadge } from './views/notifications.js';
import { startTour, MANAGER_TOUR } from './tour.js';
import { runAutoSync, guessChangelogUrl } from './ingest.js';
import { CHANGELOG } from './changelog.js';
import { initSync, onSync, syncState, pushNow } from './sync.js';

const TITLES = { home:'Dashboard', projects:'Projects', project:'Project', releases:'Releases', activity:'Activity',
  credentials:'Credentials', docs:'Docs', admin:'Admin', settings:'Settings' };
const RENDERERS = { home:renderHome, projects:renderProjects, project:renderProject, releases:renderReleases, activity:renderActivity,
  credentials:renderCredentials, docs:renderDocs, admin:renderAdmin, settings:renderSettings };

// Rail sections (shell format): `minMode:'standard'` items hide in Simple
// mode; `admin` items appear only when the Admin area is unlocked.
const SECTIONS = [
  { group:'Fleet' },
  { key:'home',        label:'Dashboard',   icon:'home' },
  { key:'projects',    label:'Projects',    icon:'grid' },
  { key:'releases',    label:'Releases',    icon:'sparkle' },
  { key:'activity',    label:'Activity',    icon:'activity', minMode:'standard' },
  { group:'Setup' },
  { key:'credentials', label:'Credentials', icon:'key',      minMode:'standard' },
  { key:'docs',        label:'Docs',        icon:'book' },
  { group:'System' },
  { key:'admin',       label:'Admin',       icon:'shield',   admin:true },
  { key:'settings',    label:'Settings',    icon:'settings' },
];

// Manager keeps its historical theme key; bare legacy values ('dark' /
// 'light' / 'system') upgrade once to the shell's palette:mode format.
try{
  const legacyTheme = localStorage.getItem('manager.theme');
  if(legacyTheme && !legacyTheme.includes(':')) localStorage.setItem('manager.theme', 'manager:'+legacyTheme);
}catch{}
configureTheme({
  storageKey: 'manager.theme',
  defaultTheme: 'manager:dark',
  palettes: [{ key:'manager', label:'Mission Control', hint:'Cyan / indigo command console' }],
});

let shell=null, view, topTitle, wnBtn, themeBtn, undoBtn;
let currentSection='home', currentParams={};

async function boot(){
  applyTheme();
  const gate = await Access.init();
  if(!gate.granted){ renderGate(gate.inviteError); return; }

  syncOwnChangelog();

  buildShell();
  wireEvents();

  // data source: reflect the live connection in the rail, restore a saved
  // remote connection (pulls it fresh — the remote is the source of truth),
  // and re-render the current view once a remote load swaps the workspace.
  onSync((st)=>{ window.__rail?.setSource?.(st); });
  window.__rail?.setSource?.(syncState());
  Store.on('replaced', ()=>{ if(!document.querySelector('.overlay.show, .cmdk.show, .ps-rpanel.in, .tour-pop.show')) render(); });
  initSync().then(st=>{ window.__rail?.setSource?.(st); });
  // best-effort final flush so a pending mirror isn't lost on tab close
  window.addEventListener('pagehide', ()=>{ if(syncState().isRemote) pushNow(); });

  const initial=(location.hash.replace('#','')||'home');
  go(RENDERERS[initial]?initial:'home');

  // first-run welcome tour
  if(!Store.settings().tourDone){
    setTimeout(()=>ctx.startTour(), 650);
  }

  // quiet, opt-in changelog auto-sync — a background loop that honors each
  // project's interval (down to 1 minute). Safe by construction: runAutoSync
  // never overlaps itself (guarded in ingest.js), we skip while the tab is
  // hidden, and we only surface a toast when something actually changed.
  tickAutoSync();
  setInterval(tickAutoSync, 30000);   // wake every 30s; runAutoSync self-gates on per-project due-ness
}

// Manager publishes its own "what's new" the exact same way every other fleet
// project does — a `CHANGELOG` array in a deployed js/changelog.js — so its
// own dashboard tile and project page can read that same live source instead
// of a value someone has to remember to update by hand. This reconciles it
// into the releases table on every boot, straight from the already-imported
// module (no fetch, so no network/CORS round trip and no per-project "Sync"
// click required) via the same `syncReleases()` every other project's Sync
// button uses, so Manager behaves exactly like any other synced project —
// same "Synced …" timestamp, same auto-status, same sync-tag on its rows.
function syncOwnChangelog(){
  const manager = Store.project('manager');
  if(!manager) return;
  const entries = CHANGELOG.map(e => ({
    v: e.v, title: e.title, kind: e.kind || 'feature',
    ts: e.ts && !isNaN(new Date(e.ts)) ? new Date(e.ts).toISOString() : new Date().toISOString(),
    items: e.items || [],
  }));
  Store.syncReleases('manager', entries, guessChangelogUrl(manager.site));
}

function tickAutoSync(){
  if(document.hidden) return;          // don't poll a backgrounded tab
  runAutoSync().then(res=>{
    if(!res || (!res.added && !res.updated)) return;
    toast('Auto-synced the fleet', { kind:'ok', body:`${res.added} new, ${res.updated} updated across ${res.ok} project${res.ok===1?'':'s'}.` });
    // refresh the current view, but never yank the ground out from under an open dialog
    if(!document.querySelector('.overlay.show, .cmdk.show, .ps-rpanel.in, .tour-pop.show')) render();
  }).catch(()=>{});
}

const escapeLbl = (s)=>escapeHtml(String(s||''));

// Build (or rebuild — admin unlock, Simple-mode toggle) the whole app frame
// via the vendored shell, then re-attach Manager's rail furniture.
function buildShell(){
  const app=$('#app');
  app.innerHTML='';
  topTitle=el('h1',{text:TITLES[currentSection]||'Dashboard'});
  shell=initShell({
    app:{ id:'manager', name:'Manager', wordmark:'<img src="/assets/logo.svg" alt=""/>' },
    sections: SECTIONS.map(s=> s.group ? s : { ...s, icon:icon(s.icon) }),
    onNav:(s)=>go(s),
    isAdmin:()=>Access.isAdmin(),
    uiMode:()=>Store.settings().simpleMode ? 'simple' : 'expert',
    rail:{ storageKey:'manager.rail' },
    topbar:{ left:[topTitle], right:buildTopbarActions() },
    mount: app,
  });
  view=shell.els.main;
  view.id='view'; view.classList.add('view'); view.tabIndex=-1;

  // data-source indicator (Manager-specific rail furniture) — shows where
  // the workspace lives with a live status dot, pinned above the collapse
  // toggle; click jumps to Admin → Data source. Updated via setSource().
  const source=el('button',{class:'rail-source', title:'Data source', 'data-status':'local',
    html:`<span class="rail-src-dot"></span><span class="rail-src-txt"><b>Local</b><small>this browser</small></span>`,
    onclick:()=>go('admin')});
  shell.els.rail.insertBefore(source, shell.els.rail.querySelector('.ps-rail-toggle'));

  window.__rail = {
    setActive:(key)=>shell.setActive(key),
    setOpen:(v)=>shell.setOpen(v),
    // the shell's badge, plus Manager's danger tone for "needs attention"
    setBadge:(key,n,tone)=>{
      shell.setBadge(key,n);
      const b=shell.els.rail.querySelector(`.ps-rail-item[data-sec="${key}"] .badge`);
      if(b) b.classList.toggle('tone-danger', tone==='danger');
    },
    setSource:(st)=>{
      const dotColor = st.source?.accent || 'var(--brand)';
      source.dataset.status = st.status;
      source.title = st.isRemote ? `Data source: ${st.label} (${st.status})` : 'Data source: Local (this browser)';
      source.style.setProperty('--src-dot', dotColor);
      const sub = st.isRemote ? (st.status==='error'?'sync error':(st.status==='syncing'?'syncing…':'connected')) : 'this browser';
      source.querySelector('.rail-src-txt').innerHTML=`<b>${escapeLbl(st.label)}</b><small>${sub}</small>`;
    },
  };
  window.__rail.setActive(currentSection);
  window.__rail.setSource(syncState());
}

function buildTopbarActions(){
  const cmdBtn=el('button',{class:'btn sm hide-sm', html:`${icon('search')} <span class="kbd">⌘K</span>`, title:'Command palette',
    onclick:()=>openPalette()});
  const notifBtn=buildNotifBell(ctx);
  undoBtn=el('button',{class:'btn icon ghost hide-sm', title:'Undo (⌘Z)', 'aria-label':'Undo last change',
    html:icon('undo'), onclick:doUndo});
  wnBtn=el('button',{class:'btn icon ghost wn-btn', title:"What's new", 'aria-label':"What's new",
    html:icon('sparkle'), onclick:()=>{ openWhatsNew(); wnBtn.classList.remove('has-unread'); }});
  if(hasUnread()) wnBtn.classList.add('has-unread');
  themeBtn=el('button',{class:'btn icon ghost', title:'Toggle theme', 'aria-label':'Toggle theme',
    html:icon(isLight()?'moon':'sun'),
    onclick:()=>{ toggleMode(); syncTheme(); }});
  const waffle=appSwitcher(FLEET.map(a=>({ ...a, icon:icon(a.icon) })), { current:'manager' });
  const addBtn=el('button',{class:'btn sm primary', html:`${icon('plus')} <span class="hide-sm">Add project</span>`,
    onclick:()=>openProjectEditor(null, ctx)});
  return [cmdBtn, notifBtn, undoBtn, wnBtn, themeBtn, waffle, addBtn];
}
function isLight(){ return document.documentElement.getAttribute('data-theme')==='light'; }
function syncTheme(){ themeBtn.innerHTML=icon(isLight()?'moon':'sun'); }

// ---- routing -------------------------------------------------------------
function go(section, params={}){
  if(!RENDERERS[section]) section='home';
  currentSection=section; currentParams=params;
  location.hash = section==='project' && params.id ? `project/${params.id}` : section;
  topTitle.textContent = section==='project' && Store.project(params.id) ? Store.project(params.id).name : (TITLES[section]||'Manager');
  window.__rail.setActive(section);
  // below the shell's drawer breakpoint the rail overlays content — close it
  // on navigation (matches the shell's own rail-click behavior)
  if(window.matchMedia('(max-width: 860px)').matches) window.__rail.setOpen(false);
  // Apply the default saved view (if any) only on a fresh navigation into
  // Projects — never from the reactive re-render a Store change triggers
  // while the user is already there — so it can't yank an active filter out
  // from under them mid-visit. Same guard shape as markReleasesSeen() below.
  if(section==='projects') applyDefaultSavedView();
  render();
  // mark the fleet-wide release feed "read" only once the user has actually
  // landed on it — a live re-render triggered by an auto-sync elsewhere in
  // the app must not silently clear the "new since you looked" marker.
  if(section==='releases'){ markReleasesSeen(); refreshReleasesBadge(); }
}
function render(){
  view.scrollTop=0;
  RENDERERS[currentSection](view, ctx, currentParams);
  refreshUndo();
  refreshAttentionBadges();
  refreshReleasesBadge();
}
function refresh(){ buildShell(); render(); }
function refreshUndo(){ if(undoBtn) undoBtn.disabled = !Store.canUndo(); }
// the bell and the rail's Dashboard item both mirror Store.needsAttention() —
// keep them refreshing together so a slipping project never shows in one and
// not the other.
function refreshAttentionBadges(){
  refreshNotifBadge();
  window.__rail?.setBadge('home', Store.needsAttentionActive().length, 'danger');
}
function refreshReleasesBadge(){
  window.__rail?.setBadge('releases', unreadReleasesCount(), 'brand');
}

// context handed to every view
const ctx = {
  go, refresh, render,
  syncTheme,
  openWhatsNew: ()=>{ openWhatsNew(); wnBtn&&wnBtn.classList.remove('has-unread'); },
  startTour: ()=>startTour(MANAGER_TOUR, {
    onDone:()=>Store.setSetting('tourDone', true),
    setRailOpen:(v)=>window.__rail.setOpen(v),
  }),
};

function doUndo(){
  if(!Store.canUndo()){ toast('Nothing to undo',{kind:'info'}); return; }
  const op=Store.undo();
  toast('Undone: '+(op?.label||'change'),{kind:'ok'});
  render();
}

// ---- command palette (⌘K) ------------------------------------------------
function openPalette(){
  const overlay=el('div',{class:'cmdk'});
  const box=el('div',{class:'cmdk-box', role:'dialog', 'aria-modal':'true', 'aria-label':'Command palette'});
  const input=el('input',{class:'cmdk-in', placeholder:'Jump to a project, section, or action…', spellcheck:'false'});
  const list=el('div',{class:'cmdk-list'});
  box.append(input, list); overlay.append(box); document.body.append(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));

  const items=[];
  SECTIONS.filter(s=>s.key && (!s.admin||Access.isAdmin())).forEach(s=>items.push({ icon:s.icon, label:s.label, hint:'Section', run:()=>go(s.key) }));
  Store.projects().forEach(p=>items.push({ icon:p.icon||'grid', label:p.name, hint:'Project', run:()=>go('project',{id:p.id}) }));
  items.push({ icon:'plus', label:'Add project', hint:'Action', run:()=>openProjectEditor(null,ctx) });
  items.push({ icon:'sparkle', label:"What's new", hint:'Action', run:()=>ctx.openWhatsNew() });
  items.push({ icon:'play', label:'Start welcome tour', hint:'Action', run:()=>ctx.startTour() });
  items.push({ icon:'book', label:'Open docs', hint:'Action', run:()=>go('docs') });

  let sel=0, filtered=items;
  function render(){
    const q=input.value.trim().toLowerCase();
    filtered = q ? items.filter(i=>i.label.toLowerCase().includes(q)||i.hint.toLowerCase().includes(q)) : items;
    sel=Math.min(sel, Math.max(0,filtered.length-1));
    list.innerHTML='';
    filtered.slice(0,40).forEach((it,i)=>{
      const row=el('div',{class:'cmdk-item'+(i===sel?' sel':''), html:`${icon(it.icon)}<span>${escapeHtml(it.label)}</span><span class="hint">${escapeHtml(it.hint)}</span>`,
        onclick:()=>{ close(); it.run(); }});
      row.addEventListener('mouseenter',()=>{ sel=i; [...list.children].forEach((c,k)=>c.classList.toggle('sel',k===i)); });
      list.append(row);
    });
    if(!filtered.length) list.append(el('div',{class:'cmdk-item muted', text:'No matches'}));
  }
  render();
  input.addEventListener('input',render);
  input.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); sel=Math.min(sel+1,filtered.length-1); render(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); sel=Math.max(sel-1,0); render(); }
    else if(e.key==='Enter'){ e.preventDefault(); const it=filtered[sel]; if(it){ close(); it.run(); } }
    else if(e.key==='Escape'){ close(); }
  });
  overlay.addEventListener('mousedown',e=>{ if(e.target===overlay) close(); });
  const releaseFocus=trapFocus(box);
  function close(){ overlay.classList.remove('show'); setTimeout(()=>overlay.remove(),160); releaseFocus(); }
}

// ---- live glue -----------------------------------------------------------
function wireEvents(){
  Store.on('change', ()=>{ refreshUndo(); refreshAttentionBadges(); refreshReleasesBadge(); });
  Store.on('history', refreshUndo);
  // re-render when the data behind the current view changes
  const rerenderOn = { projects:['projects','releases','savedViews'], home:['projects','releases','runs','dismissals'],
    project:['projects','releases'], releases:['releases','projects'], activity:['runs'], credentials:['credentials'] };
  Store.on('*', (evt)=>{ if((rerenderOn[currentSection]||[]).includes(evt)) render(); });

  window.addEventListener('hashchange',()=>{
    const raw=location.hash.replace('#','');
    const [sec,id]=raw.split('/');
    if(sec && sec!==currentSection && RENDERERS[sec]) go(sec, id?{id}:{});
  });
  window.addEventListener('keydown',e=>{
    const mod=e.metaKey||e.ctrlKey;
    if(mod && e.key.toLowerCase()==='k'){ e.preventDefault(); openPalette(); }
    else if(mod && e.key.toLowerCase()==='z' && !e.shiftKey && !/input|textarea/i.test(e.target.tagName) && !e.target.isContentEditable){ e.preventDefault(); doUndo(); }
  });
}

// ---- invite-only gate ----------------------------------------------------
function renderGate(errMsg){
  const app=$('#app'); app.innerHTML='';
  const g=el('div',{class:'gate'});
  const card=el('div',{class:'gate-card'});
  card.innerHTML=`<img src="/assets/logo.svg" width="52" height="52" alt=""/>
    <h1>Manager — preview</h1>
    <p class="muted">Mission control for your fleet. This is an invite-only preview — paste an invite code or your admin token to continue, or open the invite link someone sent you.</p>`;
  const ta=el('textarea',{class:'input', rows:'3', placeholder:'Paste invite code or admin token…', spellcheck:'false'});
  const err=el('div',{class:'gate-err'+(errMsg?'':' hide'), text: errMsg?`That invite is ${errMsg}.`:''});
  const btn=el('button',{class:'btn primary', style:'width:100%', html:`${icon('shield')} Unlock`, onclick:enter});
  const back=el('a',{class:'link tiny', href:'/', text:'← Back to manager.polecat.live'});
  card.append(ta, err, btn, back);
  g.append(card); app.append(g);
  async function enter(){
    const v=ta.value.trim(); if(!v) return;
    btn.disabled=true; err.classList.add('hide');
    if(await Access.verifyAdminToken(v)){ await Access.unlockAdmin(v); location.reload(); return; }
    const r=await Access.verifyInvite(v);
    if(r.ok){ Access.grant('invite', r.payload.label||''); location.reload(); return; }
    btn.disabled=false; err.textContent = r.reason==='expired' ? 'That invite has expired.' : 'That code is not valid.';
    err.classList.remove('hide');
  }
  ta.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); enter(); } });
  setTimeout(()=>ta.focus(),50);
}

document.addEventListener('DOMContentLoaded', boot);
