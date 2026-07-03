// app.js — main controller: boot, gate, routing, top bar, cross-view glue.
import { Store } from './store.js';
import { Access } from './access.js';
import { applyTheme, getThemePref, setTheme } from './theme.js';
import { buildRail, SECTIONS } from './shell.js';
import { el, $, escapeHtml, toast } from './ui.js';
import { icon } from './icons.js';
import { renderHome } from './views/home.js';
import { renderProjects, openProjectEditor } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderActivity } from './views/activity.js';
import { renderCredentials } from './views/credentials.js';
import { renderDocs } from './views/docs.js';
import { renderAdmin } from './views/admin.js';
import { renderSettings } from './views/settings.js';
import { openWhatsNew, hasUnread } from './views/whatsnew.js';
import { buildNotifBell, refreshNotifBadge } from './views/notifications.js';
import { startTour, MANAGER_TOUR } from './tour.js';
import { runAutoSync } from './ingest.js';

const TITLES = { home:'Dashboard', projects:'Projects', project:'Project', activity:'Activity',
  credentials:'Credentials', docs:'Docs', admin:'Admin', settings:'Settings' };
const RENDERERS = { home:renderHome, projects:renderProjects, project:renderProject, activity:renderActivity,
  credentials:renderCredentials, docs:renderDocs, admin:renderAdmin, settings:renderSettings };

let rail, view, topTitle, wnBtn, themeBtn, undoBtn;
let currentSection='home', currentParams={};

async function boot(){
  applyTheme();
  const gate = await Access.init();
  if(!gate.granted){ renderGate(gate.inviteError); return; }

  const app=$('#app');
  app.innerHTML='';
  rail=el('nav',{id:'rail','aria-label':'Navigation'});
  const main=el('div',{id:'main'});
  const topbar=buildTopbar();
  view=el('div',{class:'view', id:'view'});
  main.append(topbar, view);
  const backdrop=el('div',{class:'rail-backdrop', onclick:()=>window.__rail.setOpen(false)});
  app.append(rail, backdrop, main);

  rebuildRail();
  wireEvents();

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

function tickAutoSync(){
  if(document.hidden) return;          // don't poll a backgrounded tab
  runAutoSync().then(res=>{
    if(!res || (!res.added && !res.updated)) return;
    toast('Auto-synced the fleet', { kind:'ok', body:`${res.added} new, ${res.updated} updated across ${res.ok} project${res.ok===1?'':'s'}.` });
    // refresh the current view, but never yank the ground out from under an open dialog
    if(!document.querySelector('.overlay.show, .cmdk.show, .sheet-overlay.show, .tour-pop.show')) render();
  }).catch(()=>{});
}

function rebuildRail(){
  window.__rail = buildRail(rail, { onNav:(s)=>go(s), isAdmin:Access.isAdmin(), simple:Store.settings().simpleMode });
  window.__rail.setActive(currentSection);
}

function buildTopbar(){
  const bar=el('div',{class:'topbar'});
  const menuBtn=el('button',{class:'btn icon ghost topbar-menu', title:'Menu', 'aria-label':'Open navigation',
    html:icon('menu'), onclick:()=>window.__rail.setOpen(!rail.classList.contains('open'))});
  topTitle=el('h1',{text:'Dashboard'});
  bar.append(menuBtn, topTitle, el('span',{class:'sp'}));

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
    onclick:()=>{ setTheme(isLight()?'dark':'light'); syncTheme(); }});
  const addBtn=el('button',{class:'btn sm primary', html:`${icon('plus')} <span class="hide-sm">Add project</span>`,
    onclick:()=>openProjectEditor(null, ctx)});

  bar.append(cmdBtn, notifBtn, undoBtn, wnBtn, themeBtn, addBtn);
  return bar;
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
  if(window.innerWidth<=720) window.__rail.setOpen(false);
  render();
}
function render(){
  view.scrollTop=0;
  RENDERERS[currentSection](view, ctx, currentParams);
  refreshUndo();
  refreshNotifBadge();
}
function refresh(){ rebuildRail(); render(); }
function refreshUndo(){ if(undoBtn) undoBtn.disabled = !Store.canUndo(); }

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
  const box=el('div',{class:'cmdk-box'});
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
  function close(){ overlay.classList.remove('show'); setTimeout(()=>overlay.remove(),160); }
  setTimeout(()=>input.focus(),40);
}

// ---- live glue -----------------------------------------------------------
function wireEvents(){
  Store.on('change', ()=>{ refreshUndo(); refreshNotifBadge(); });
  Store.on('history', refreshUndo);
  // re-render when the data behind the current view changes
  const rerenderOn = { projects:['projects','releases'], home:['projects','releases','runs'],
    project:['projects','releases'], activity:['runs'], credentials:['credentials'] };
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
