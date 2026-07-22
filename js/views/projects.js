// Projects library — the source of truth for the fleet. Filter, sort, search,
// pin, edit, and add rich metadata (including your own custom fields).
import { Store, STATUSES, statusPill } from '../store.js';
import { el, escapeHtml, toast, modal, confirmDialog, fmtCT, avatarColor, slugify, makeRowClickable, wireDragReorder, swapNeighbor } from '../ui.js';
import { icon } from '../icons.js';
import { editFieldDef } from './settings.js';
import { openSyncAll } from './home.js';
import { backgroundRefreshProjects, bgRefreshWillRun } from '../ingest.js';

const VIEW_KEY = 'manager.lib.view';   // { q, status, sort, dir, field, fieldValue, fieldMin, fieldMax }
const DEFAULT_STATE = { q:'', status:'all', sort:'activity', dir:'desc', field:'', fieldValue:'', fieldMin:'', fieldMax:'' };

// Bulk-select checkbox state for the library table. Module-level (not
// per-render) so it survives the view's own internal re-renders (search,
// sort, filter chips) instead of silently clearing on every keystroke;
// pruned against live projects on every render so a deleted/undone row can
// never linger in a stale selection.
const selected = new Set();

function state(){ try{ return { ...DEFAULT_STATE, ...(JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')) }; }catch{ return { ...DEFAULT_STATE }; } }
function saveState(s){ try{ localStorage.setItem(VIEW_KEY, JSON.stringify(s)); }catch{} }

// Set by setLibraryFilter() right before an explicit navigation into
// Projects (e.g. a dashboard stat tile) so that navigation's filter isn't
// immediately clobbered by the default-saved-view reapplication below.
let suppressDefaultView = false;

// If a saved view is marked default, applying it here — right before the
// library actually renders — makes it "open automatically the next time the
// library loads", instead of always falling back to whatever `manager.lib.view`
// last held. Called once from app.js's go() on a fresh navigation into
// Projects, never from a reactive re-render while already there, so it can't
// yank the user's active filter out from under them mid-visit (same guard
// shape as markReleasesSeen() in js/views/releases.js).
export function applyDefaultSavedView(){
  if(suppressDefaultView){ suppressDefaultView=false; return; }
  const def = Store.defaultSavedView();
  if(!def) return;
  const cur=state();
  saveState({ ...cur, status:def.state.status, sort:def.state.sort, dir:def.state.dir,
    field:def.state.field||'', fieldValue:def.state.fieldValue||'', fieldMin:def.state.fieldMin||'', fieldMax:def.state.fieldMax||'' });
}

// Sets the library's free-text search box ahead of a navigation into
// Projects — used by Settings' "Tags" manager so clicking a tag's "View
// projects" action lands on a library already filtered to it, the same way
// the search box already matches against every project's tags (see the `q`
// filter below) with zero new filtering logic needed.
export function setLibrarySearch(q){
  saveState({ ...state(), q });
}

// Sets any combination of the library's filter/sort state ahead of an
// explicit navigation into Projects — used by the dashboard's stat tiles
// (Live now, Fleet health, …) so each one lands on the library already
// scoped to what it's summarizing, same idea as setLibrarySearch() above but
// for status/sort rather than free text. Suppresses the next
// applyDefaultSavedView() so a configured default view doesn't immediately
// overwrite the filter the user just clicked through for.
export function setLibraryFilter(partial){
  saveState({ ...state(), ...partial });
  suppressDefaultView = true;
}

const SAVED_VIEWS = [
  { id:'all',       label:'All',             icon:'grid',    apply:s=>({...s,status:'all'}) },
  { id:'live',      label:'Live only',       icon:'globe',   apply:s=>({...s,status:'live',sort:'activity',dir:'desc'}) },
  { id:'recent',    label:'Recently active', icon:'clock',   apply:s=>({...s,status:'all',sort:'activity',dir:'desc'}) },
  { id:'pinned',    label:'Pinned',          icon:'pin',     apply:s=>({...s,status:'pinned'}) },
  { id:'attention', label:'Needs attention', icon:'warning', apply:s=>({...s,status:'attention'}) },
];

// A user-saved view is "on" (highlighted) when the live filter state matches
// every dimension it captured — status, sort, direction, and any custom-field
// filter (search text isn't part of a saved view, same as the built-ins above).
function customViewMatches(v, s){
  const vs=v.state||{};
  return s.status===vs.status && s.sort===vs.sort && s.dir===vs.dir &&
    (s.field||'')===(vs.field||'') && (s.fieldValue||'')===(vs.fieldValue||'') &&
    (s.fieldMin||'')===(vs.fieldMin||'') && (s.fieldMax||'')===(vs.fieldMax||'');
}

// "Save view": name the current status/sort/field filter and it joins the
// saved-views strip as its own chip, right alongside the built-in ones.
function openSaveViewPrompt(s, ctx){
  const input=el('input',{class:'input', placeholder:'e.g. Building, by version', autocomplete:'off', maxlength:'40'});
  const body=el('div',{class:'field'});
  body.append(el('label',{text:'Name this view'}), input,
    el('span',{class:'tiny muted', text:'Saves the current status, sort, and field filter as a one-click chip.'}));
  const save=el('button',{class:'btn primary', text:'Save view', onclick:()=>{
    const label=input.value.trim();
    if(!label){ input.focus(); return; }
    hide();
    Store.addSavedView({ label, icon:'star', state:{ status:s.status, sort:s.sort, dir:s.dir, field:s.field||'', fieldValue:s.fieldValue||'', fieldMin:s.fieldMin||'', fieldMax:s.fieldMax||'' } });
    toast(`Saved view "${label}"`,{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}});
    ctx.refresh();
  }});
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); save.click(); } });
  const {hide}=modal({ title:'Save current view', icon:icon('star'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), save] });
  setTimeout(()=>input.focus(),50);
}

// "Reorder saved views": the saved-views strip's own pills have no room for
// a grip + up/down arrows of their own (a chip is a compact horizontal
// pill, not a list row) — so reordering which one shows up first happens in
// a small modal instead, reusing the exact grip/arrow row shape Settings'
// custom-field list already established (`.field-row`), just against
// Store.reorderSavedViews() instead of reorderFieldDefs().
function openReorderSavedViews(ctx){
  const list=el('div',{class:'field-defs-list', style:'display:flex;flex-direction:column;gap:8px'});
  const render=()=>{
    list.innerHTML='';
    const views=Store.savedViews();
    views.forEach((v,i)=>list.append(savedViewRow(v, render, i, views.length)));
  };
  render();
  wireDragReorder(list, '.field-row', '.field-row-grip', (ids)=>{
    if(Store.reorderSavedViews(ids)){ toast('Saved-view order updated',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); render(); }
  });
  const {hide}=modal({ title:'Reorder saved views', icon:icon('sliders'), body:list,
    foot:[el('button',{class:'btn primary', text:'Done', onclick:()=>{ hide(); ctx.refresh(); }})] });
}

function savedViewRow(v, onChange, index, total){
  const row=el('div',{class:'card field-row'+(v.isDefault?' is-default-view':''), 'data-id':v.id});
  row.innerHTML=`<span class="field-row-grip" draggable="true" title="Drag to reorder" aria-hidden="true">${icon('grip')}</span>
    <span class="qicon" style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand-b),var(--consensus));color:#05121a">${icon(v.icon||'star')}</span>`;
  const mid=el('div',{class:'field-row-mid'});
  mid.innerHTML=`<b>${escapeHtml(v.label)}</b>${v.isDefault?` <span class="tiny muted">— opens automatically</span>`:''}`;
  row.append(mid);
  const actions=el('div',{class:'field-row-actions'});
  actions.append(el('button',{class:'btn ghost icon sm default-view-btn'+(v.isDefault?' on':''),
    title: v.isDefault?'Stop opening this view automatically':'Open this view automatically when the library loads',
    'aria-label': v.isDefault?`Unset "${v.label}" as the default view`:`Set "${v.label}" as the default view`,
    html:icon('pin'), onclick:()=>toggleDefaultSavedView(v, onChange)}));
  actions.append(el('button',{class:'btn ghost icon sm', title:'Move up', 'aria-label':`Move ${v.label} up`, html:icon('chevronUp'), disabled: index===0, onclick:()=>moveSavedView(v.id, -1, onChange)}));
  actions.append(el('button',{class:'btn ghost icon sm', title:'Move down', 'aria-label':`Move ${v.label} down`, html:icon('chevronDown'), disabled: index===total-1, onclick:()=>moveSavedView(v.id, 1, onChange)}));
  row.append(actions);
  return row;
}

function moveSavedView(id, dir, onChange){
  const ids = swapNeighbor(Store.savedViews().map(v=>v.id), id, dir);
  if(!ids) return;
  if(Store.reorderSavedViews(ids)) toast('Saved-view order updated',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}});
  onChange();
}

// Marking a view "default" means it's applied automatically the next time
// the library loads (see applyDefaultSavedView(), called from app.js on
// navigation into Projects) instead of always falling back to whatever
// `manager.lib.view` last held. Clicking the pin on the view that's already
// default turns it back off; clicking it on any other view moves the flag
// over (Store.setDefaultSavedView() clears every other row in one step).
function toggleDefaultSavedView(v, onChange){
  const turningOn = !v.isDefault;
  if(Store.setDefaultSavedView(turningOn ? v.id : null)){
    toast(turningOn ? `"${v.label}" opens automatically now` : `"${v.label}" is no longer the default view`,
      {kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}});
  }
  onChange();
}

// A Number-type custom field gets a dual-handle range slider instead of the
// "contains" text box every other type uses — exact/contains matching makes
// no sense for a score or a headcount, only "between X and Y" does. Built as
// two overlapping native <input type=range> tracks (the standard vanilla
// dual-slider trick: both transparent and full-width, pointer-events limited
// to their thumbs via CSS) rather than a single custom-drawn widget, so
// keyboard/touch/focus-ring behavior all come free from the browser.
// Bounds are the field's real min/max across the fleet today, not a fixed
// 0–100 — a "budget" field in the thousands and a "score" field 0–10 both
// get a slider whose full travel actually means something.
function buildRangeFilter(def, s, fieldSel, rerenderList){
  const raw = Store.projects().map(p=>p.fields?.[def.key]).filter(v=>v!=null && v!=='');
  const nums = raw.map(Number).filter(n=>!Number.isNaN(n));
  const lo = nums.length ? Math.min(...nums) : 0;
  let hi = nums.length ? Math.max(...nums) : 100;
  if(hi<=lo) hi = lo+1; // avoid a zero-width slider when every value is identical (or there's no data yet)
  const span = hi-lo;
  const step = span<=20 ? 1 : Math.max(1, Math.round(span/100));

  const clamp=v=>Math.min(Math.max(v, lo), hi);
  let curMin = clamp(s.fieldMin!==''&&s.fieldMin!=null ? Number(s.fieldMin) : lo);
  let curMax = clamp(s.fieldMax!==''&&s.fieldMax!=null ? Number(s.fieldMax) : hi);
  if(curMin>curMax) curMin=curMax;

  const box=el('div',{class:'range-filter'});
  const body=el('div',{class:'range-filter-body'});
  const readout=el('span',{class:'tiny mono range-filter-readout'});
  const track=el('div',{class:'range-filter-track'});
  const base=el('div',{class:'range-filter-base'});
  const fill=el('div',{class:'range-filter-fill'});
  const minSlider=el('input',{type:'range', class:'range-filter-min', min:String(lo), max:String(hi), step:String(step), value:String(curMin), 'aria-label':`Minimum ${def.label}`});
  const maxSlider=el('input',{type:'range', class:'range-filter-max', min:String(lo), max:String(hi), step:String(step), value:String(curMax), 'aria-label':`Maximum ${def.label}`});
  track.append(base, fill, minSlider, maxSlider);
  const clearBtn=el('button',{class:'btn ghost icon sm range-filter-clear', type:'button', title:'Reset range', 'aria-label':'Reset range filter', html:icon('x')});
  body.append(readout, track);
  box.append(body, clearBtn);

  const updateVisual=()=>{
    readout.textContent = `${minSlider.value} – ${maxSlider.value}`;
    const pctMin=((Number(minSlider.value)-lo)/span)*100;
    const pctMax=((Number(maxSlider.value)-lo)/span)*100;
    fill.style.left=pctMin+'%';
    fill.style.width=Math.max(0,pctMax-pctMin)+'%';
  };
  const commit=()=>{ const ns={...state(), field:fieldSel.value, fieldMin:minSlider.value, fieldMax:maxSlider.value}; saveState(ns); rerenderList(); };
  updateVisual();

  minSlider.addEventListener('input',()=>{
    if(Number(minSlider.value)>Number(maxSlider.value)) minSlider.value=maxSlider.value;
    updateVisual(); commit();
  });
  maxSlider.addEventListener('input',()=>{
    if(Number(maxSlider.value)<Number(minSlider.value)) maxSlider.value=minSlider.value;
    updateVisual(); commit();
  });
  clearBtn.addEventListener('click',()=>{
    minSlider.value=String(lo); maxSlider.value=String(hi);
    updateVisual();
    const ns={...state(), field:fieldSel.value, fieldMin:'', fieldMax:''};
    saveState(ns); rerenderList();
  });
  return box;
}

export function renderProjects(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const s=state();

  // header + add
  const head=el('div',{class:'section-title'});
  head.innerHTML=`<h2>Projects</h2>`;
  head.append(el('span',{class:'sp'}));
  head.append(el('button',{class:'btn sm', html:`${icon('refresh')} Sync all`, title:'Pull real changelogs for every connected project now', onclick:()=>openSyncAll(ctx)}));
  head.append(el('button',{class:'btn primary sm', html:`${icon('plus')} Add project`, onclick:()=>openProjectEditor(null, ctx)}));
  wrap.append(head);

  // saved views — the fixed built-in set, plus any the user has saved
  const views=el('div',{class:'saved-views'});
  SAVED_VIEWS.forEach(v=>{
    const on = (v.id==='pinned'&&s.status==='pinned') || (v.id==='live'&&s.status==='live') ||
      (v.id==='attention'&&s.status==='attention') ||
      (v.id==='all'&&s.status==='all'&&s.sort!=='activity') || (v.id==='recent'&&s.status==='all'&&s.sort==='activity');
    views.append(el('button',{class:'filter-chip'+(on?' on':''), html:`${icon(v.icon)} ${v.label}`,
      onclick:()=>{ const ns=v.apply(state()); saveState(ns); renderProjects(root,ctx); }}));
  });
  Store.savedViews().forEach(v=>{
    const on = customViewMatches(v, s);
    const chip=el('span',{class:'filter-chip-custom'+(on?' on':'')+(v.isDefault?' is-default-view':'')});
    const badge=v.isDefault?`<span class="fc-default-badge" title="Opens automatically when the library loads">${icon('pin')}</span>`:'';
    chip.append(el('button',{class:'fc-apply', type:'button', html:`${badge}${icon(v.icon||'star')} ${escapeHtml(v.label)}`, title:`Apply saved view "${v.label}"`,
      onclick:()=>{ const ns={ ...state(), status:v.state.status, sort:v.state.sort, dir:v.state.dir, field:v.state.field||'', fieldValue:v.state.fieldValue||'', fieldMin:v.state.fieldMin||'', fieldMax:v.state.fieldMax||'' }; saveState(ns); renderProjects(root,ctx); }}));
    chip.append(el('button',{class:'fc-del', type:'button', title:`Delete saved view "${v.label}"`, 'aria-label':`Delete saved view "${v.label}"`, html:icon('x'),
      onclick:()=>{
        Store.removeSavedView(v.id);
        toast(`Deleted "${v.label}"`,{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}});
        ctx.refresh();
      }}));
    views.append(chip);
  });
  views.append(el('button',{class:'filter-chip filter-chip-add', title:'Save the current status/sort/field filter as a named view',
    html:`${icon('plus')} Save view`, onclick:()=>openSaveViewPrompt(state(), ctx)}));
  if(Store.savedViews().length>1){
    views.append(el('button',{class:'btn ghost icon sm', title:'Reorder saved views', 'aria-label':'Reorder saved views',
      html:icon('sliders'), onclick:()=>openReorderSavedViews(ctx)}));
  }
  wrap.append(views);

  // toolbar: search + status filter + sort
  const bar=el('div',{class:'toolbar'});
  const search=el('div',{class:'search'});
  const input=el('input',{class:'input', placeholder:'Search projects, repos, tags…', value:s.q});
  search.append(el('span',{html:icon('search')}), input);
  input.addEventListener('input',()=>{ const ns={...state(),q:input.value}; saveState(ns); rerenderList(); });

  const statusSel=el('select',{class:'input', style:'max-width:150px'});
  statusSel.append(el('option',{value:'all',text:'All statuses'}));
  Object.entries(STATUSES).forEach(([k,v])=>statusSel.append(el('option',{value:k,text:v.label,selected:s.status===k})));
  statusSel.value = (s.status==='pinned'||s.status==='attention'?'all':s.status);
  statusSel.addEventListener('change',()=>{ const ns={...state(),status:statusSel.value}; saveState(ns); renderProjects(root,ctx); });

  const sortSel=el('select',{class:'input', style:'max-width:170px'});
  const fieldSorts=Store.fieldDefs().filter(d=>d.type==='number'||d.type==='date').map(d=>[`field:${d.key}`, d.label]);
  [['activity','Last activity'],['name','Name'],['status','Status'],['version','Latest version'],['health','Health score'],...fieldSorts].forEach(([v,t])=>
    sortSel.append(el('option',{value:v,text:'Sort: '+t,selected:s.sort===v})));
  sortSel.addEventListener('change',()=>{ const ns={...state(),sort:sortSel.value}; saveState(ns); rerenderList(); });
  const dirBtn=el('button',{class:'btn icon', title:'Toggle direction', 'aria-label':'Toggle sort direction',
    html:icon('sort'), onclick:()=>{ const cur=state(); const ns={...cur,dir:cur.dir==='desc'?'asc':'desc'}; saveState(ns); rerenderList(); }});

  bar.append(search, statusSel, sortSel, dirBtn);

  // custom-field filter — only shows once at least one field is defined
  const defs=Store.fieldDefs();
  if(defs.length){
    const fieldSel=el('select',{class:'input field-filter', style:'max-width:150px'});
    fieldSel.append(el('option',{value:'', text:'Any field'}));
    defs.forEach(d=>fieldSel.append(el('option',{value:d.key, text:d.label})));
    fieldSel.value = s.field||'';
    const valWrap=el('span');
    const renderValControl=()=>{
      valWrap.innerHTML='';
      const d=defs.find(x=>x.key===fieldSel.value);
      if(!d) return;
      if(d.type==='select'){
        const sel=el('select',{class:'input field-filter-value', style:'max-width:150px'});
        sel.append(el('option',{value:'', text:'Any value'}));
        (d.options||[]).forEach(o=>sel.append(el('option',{value:o, text:o})));
        sel.value = s.fieldValue||'';
        sel.addEventListener('change',()=>{ const ns={...state(),field:fieldSel.value,fieldValue:sel.value}; saveState(ns); rerenderList(); });
        valWrap.append(sel);
      }else if(d.type==='number'){
        valWrap.append(buildRangeFilter(d, s, fieldSel, rerenderList));
      }else{
        const inp=el('input',{class:'input field-filter-value', style:'max-width:150px', placeholder:'contains…', value:s.fieldValue||''});
        inp.addEventListener('input',()=>{ const ns={...state(),field:fieldSel.value,fieldValue:inp.value}; saveState(ns); rerenderList(); });
        valWrap.append(inp);
      }
    };
    renderValControl();
    fieldSel.addEventListener('change',()=>{ const ns={...state(),field:fieldSel.value,fieldValue:'',fieldMin:'',fieldMax:''}; saveState(ns); renderValControl(); rerenderList(); });
    bar.append(fieldSel, valWrap);
  }
  wrap.append(bar);

  const bulkHost=el('div',{id:'libBulk'});
  wrap.append(bulkHost);
  const listHost=el('div',{id:'libList'});
  wrap.append(listHost);
  root.append(wrap);

  function renderBulk(){
    bulkHost.innerHTML='';
    if(selected.size) bulkHost.append(buildBulkBar(ctx));
  }
  function rerenderList(){
    for(const id of [...selected]) if(!Store.project(id)) selected.delete(id);
    listHost.innerHTML=''; listHost.append(buildList(ctx, renderBulk));
    renderBulk();
  }
  rerenderList();

  // Quietly check every connected project for new releases when the library
  // opens (throttled + silent — see ingest.backgroundRefreshProjects), so you
  // don't have to hit "Sync all" each visit. The refresh batches its writes, so
  // fresh data lands in ONE repaint (not a flash per project); a small
  // "checking…" note shows while it runs, only when a refresh will actually go.
  let checking = null;
  if(bgRefreshWillRun()){
    checking = el('span', { class: 'lib-checking tiny muted', html: `${icon('refresh')} Checking for updates…` });
    head.append(checking);
  }
  backgroundRefreshProjects().then(res => {
    if(checking) checking.remove();
    if(res && res.flagged > 0) rerenderList();   // safety net if the reactive repaint didn't cover it
  }).catch(()=>{ if(checking) checking.remove(); });
}

// The bulk-action bar shown above the table once at least one row is
// checked — add a tag, set a status, or archive every selected project in
// one shot. Every action clears the selection FIRST, then mutates the
// store, then calls ctx.refresh(): a store mutation fires Store's own
// reactive re-render synchronously (see app.js's `Store.on('*', ...)`),
// which would repaint this exact view mid-mutation — clearing first means
// that repaint already shows the correct, deselected state instead of a
// stale bulkHost/listHost closure trying (and failing) to patch DOM nodes
// the reactive render already replaced. The trailing ctx.refresh() is what
// actually repaints for the harmless no-op case (e.g. "archive" when every
// selected project is already archived), where bulkUpdate makes no change
// and so fires no reactive render at all.
function buildBulkBar(ctx){
  const ids=[...selected];
  const bar=el('div',{class:'bulkbar'});
  bar.append(el('span',{class:'bulkbar-count', text:`${ids.length} selected`}));
  bar.append(el('button',{class:'btn sm', html:`${icon('tag')} Add tag`, onclick:()=>openBulkTagPrompt(ctx, ids)}));
  bar.append(el('button',{class:'btn sm', html:`${icon('tag')} Remove tag`, onclick:()=>openBulkRemoveTagPrompt(ctx, ids)}));
  const statusSel=el('select',{class:'input', style:'max-width:160px', 'aria-label':'Set status for selected projects'});
  statusSel.append(el('option',{value:'', text:'Set status…'}));
  Object.entries(STATUSES).forEach(([k,st])=>statusSel.append(el('option',{value:k,text:st.label})));
  statusSel.addEventListener('change',()=>{
    if(!statusSel.value) return;
    const label=STATUSES[statusSel.value].label;
    selected.clear();
    const n=Store.bulkSetStatus(ids, statusSel.value);
    toast(n?`${n===1?'1 project':n+' projects'} set to ${label}`:'Already set',{kind:n?'ok':'info', action:n?{label:'Undo', fn:()=>Store.undo()}:undefined});
    ctx.refresh();
  });
  bar.append(statusSel);
  bar.append(el('button',{class:'btn sm', title:'Set status to Archived', html:`${icon('archive')} Archive`, onclick:()=>{
    selected.clear();
    const n=Store.bulkArchive(ids);
    toast(n?`${n===1?'1 project':n+' projects'} archived`:'Already archived',{kind:n?'ok':'info', action:n?{label:'Undo', fn:()=>Store.undo()}:undefined});
    ctx.refresh();
  }}));
  bar.append(el('button',{class:'btn danger sm', title:'Delete every selected project', html:`${icon('trash')} Delete`, onclick:()=>openBulkDeleteConfirm(ctx, ids)}));
  bar.append(el('span',{class:'sp'}));
  bar.append(el('button',{class:'btn ghost icon sm', title:'Clear selection', 'aria-label':'Clear selection', html:icon('x'), onclick:()=>{ selected.clear(); ctx.refresh(); }}));
  return bar;
}

function openBulkTagPrompt(ctx, ids){
  const input=el('input',{class:'input', placeholder:'e.g. needs-review', autocomplete:'off'});
  const body=el('div',{class:'field'});
  body.append(el('label',{text:`Add a tag to ${ids.length} project${ids.length===1?'':'s'}`}), input);
  const add=el('button',{class:'btn primary', text:'Add tag', onclick:()=>{
    const t=input.value.trim();
    if(!t){ input.focus(); return; }
    hide();
    selected.clear();
    const n=Store.bulkAddTag(ids, t);
    toast(n?`Tagged ${n===1?'1 project':n+' projects'} "${t}"`:'Every selected project already has that tag',{kind:n?'ok':'info', action:n?{label:'Undo', fn:()=>Store.undo()}:undefined});
    ctx.refresh();
  }});
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); add.click(); } });
  const {hide}=modal({ title:'Add tag', icon:icon('tag'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), add] });
  setTimeout(()=>input.focus(),50);
}

// Unlike Add tag (a bare text input — any spelling is valid, since it's
// creating a tag), Remove tag offers only tags that could actually apply to
// this selection: the union of tags already on the checked projects, not the
// whole fleet's tag vocabulary. A select (not a datalist) so there's no way
// to "remove" a typo that never matched anything.
function openBulkRemoveTagPrompt(ctx, ids){
  const tags=[...new Set(ids.flatMap(id=>Store.project(id)?.tags||[]))].sort((a,b)=>a.localeCompare(b));
  if(!tags.length){ toast('None of the selected projects have any tags',{kind:'info'}); return; }
  const sel=el('select',{class:'input'});
  tags.forEach(t=>sel.append(el('option',{value:t, text:t})));
  const body=el('div',{class:'field'});
  body.append(el('label',{text:`Remove a tag from ${ids.length} project${ids.length===1?'':'s'}`}), sel);
  const remove=el('button',{class:'btn danger', text:'Remove tag', onclick:()=>{
    const t=sel.value;
    hide();
    selected.clear();
    const n=Store.bulkRemoveTag(ids, t);
    toast(n?`Removed "${t}" from ${n===1?'1 project':n+' projects'}`:'Already gone',{kind:n?'ok':'info', action:n?{label:'Undo', fn:()=>Store.undo()}:undefined});
    ctx.refresh();
  }});
  const {hide}=modal({ title:'Remove tag', icon:icon('tag'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), remove] });
}

// Bulk delete needs its own explicit confirm — unlike tag/status/archive
// (all easily reversible via a status or tag change even without Undo),
// this removes rows outright, so it gets the same "are you sure" as a
// single project's Delete button, just scoped to the whole selection.
async function openBulkDeleteConfirm(ctx, ids){
  const names = ids.map(id=>Store.project(id)?.name).filter(Boolean);
  const ok = await confirmDialog({ title:`Delete ${ids.length} project${ids.length===1?'':'s'}`, message:`Remove ${names.slice(0,3).map(n=>`"${n}"`).join(', ')}${names.length>3?`, and ${names.length-3} more`:''} and their releases from Manager? You can undo this.`, danger:true, okText:'Delete' });
  if(!ok) return;
  selected.clear();
  const n=Store.bulkRemove('projects', ids);
  toast(n?`${n===1?'1 project':n+' projects'} deleted`:'Already gone',{kind:n?'ok':'info', action:n?{label:'Undo', fn:()=>Store.undo()}:undefined});
  ctx.refresh();
}

function buildList(ctx, renderBulk){
  const s=state();
  let rows=Store.projects();
  const q=s.q.trim().toLowerCase();
  if(q) rows=rows.filter(p=>[p.name,p.repo,p.site,p.assessment,(p.tags||[]).join(' ')].join(' ').toLowerCase().includes(q));
  if(s.status==='pinned') rows=rows.filter(p=>p.pinned);
  else if(s.status==='attention'){
    const ids=new Set(Store.needsAttention().map(a=>a.project.id));
    rows=rows.filter(p=>ids.has(p.id));
  }
  else if(s.status!=='all') rows=rows.filter(p=>p.status===s.status);
  if(s.field){
    const def=Store.fieldDefs().find(d=>d.key===s.field);
    if(def?.type==='number' && (s.fieldMin!=='' || s.fieldMax!=='')){
      const lo = s.fieldMin!==''? Number(s.fieldMin) : -Infinity;
      const hi = s.fieldMax!==''? Number(s.fieldMax) : Infinity;
      rows=rows.filter(p=>{
        const val=(p.fields||{})[s.field];
        if(val==null||val==='') return false;
        const n=Number(val);
        return !Number.isNaN(n) && n>=lo && n<=hi;
      });
    }else{
      rows=rows.filter(p=>{
        const val=(p.fields||{})[s.field];
        if(!s.fieldValue) return val!=null && val!=='';
        if(def?.type==='select') return val===s.fieldValue;
        return String(val||'').toLowerCase().includes(s.fieldValue.toLowerCase());
      });
    }
  }

  const dir = s.dir==='asc'?1:-1;
  rows.sort((a,b)=>{
    let r=0;
    if(s.sort==='name') r=a.name.localeCompare(b.name);
    else if(s.sort==='status') r=a.status.localeCompare(b.status);
    else if(s.sort==='version') r=((Store.latestRelease(a.id)?.v)||0)-((Store.latestRelease(b.id)?.v)||0);
    else if(s.sort==='health') r=Store.healthScore(a.id)-Store.healthScore(b.id);
    else if(s.sort.startsWith('field:')){
      const key=s.sort.slice(6);
      const def=Store.fieldDefs().find(d=>d.key===key);
      r = fieldSortValue(def,a.fields?.[key]) - fieldSortValue(def,b.fields?.[key]);
    }
    else r=Store.lastActivity(a.id)-Store.lastActivity(b.id);
    return r*dir;
  });
  // pinned float to top regardless (stable)
  rows.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));

  if(!rows.length){
    return el('div',{class:'card empty', html:`${icon('grid')}<div>No projects match. <a class="link" id="clearF">Clear filters</a> or add one.</div>`,
      onclick:(e)=>{ if(e.target.id==='clearF'){ saveState({...DEFAULT_STATE}); const root=document.getElementById('view'); renderProjects(root,ctx); } }});
  }

  const box=el('div',{class:'lib-table'});
  const table=el('table',{class:'data'});
  const cols=[['','pin'],['Project','name'],['Status','status'],['Latest','version'],['Updated','activity'],['Tags','tags'],['',' ']];
  const thead=el('tr');
  const selAll=el('input',{type:'checkbox', class:'lib-sel', 'aria-label':'Select all visible projects'});
  const updateSelAll=()=>{
    selAll.checked = rows.length>0 && rows.every(p=>selected.has(p.id));
    selAll.indeterminate = !selAll.checked && rows.some(p=>selected.has(p.id));
  };
  updateSelAll();
  selAll.addEventListener('change',()=>{
    rows.forEach(p=>{ if(selAll.checked) selected.add(p.id); else selected.delete(p.id); });
    tb.querySelectorAll('input.lib-sel[data-pid]').forEach(cb=>{ cb.checked=selAll.checked; });
    renderBulk();
  });
  thead.append(el('th',{class:'lib-sel-th'},selAll));
  cols.forEach(([label,key])=>{
    const th=el('th',{class:s.sort===key?'sorted':''});
    th.innerHTML=`${escapeHtml(label)}${['name','status','version','activity'].includes(key)?` <span class="caret">${s.dir==='asc'?'▲':'▼'}</span>`:''}`;
    if(['name','status','version','activity'].includes(key)){
      const sortBy=()=>{ const cur=state(); saveState({...cur,sort:key,dir:cur.sort===key&&cur.dir==='desc'?'asc':'desc'}); const root=document.getElementById('view'); renderProjects(root,ctx); };
      th.onclick=sortBy;
      makeRowClickable(th, sortBy, `Sort by ${label}`);
    }
    thead.append(th);
  });
  table.append(el('thead',{},thead));
  const tb=el('tbody');
  const onRowToggle=()=>{ updateSelAll(); renderBulk(); };
  rows.forEach(p=>tb.append(projectRow(p, ctx, onRowToggle)));
  table.append(tb);
  box.append(table);
  const updateScrollHints=()=>{
    box.classList.toggle('can-scroll-l', box.scrollLeft>1);
    box.classList.toggle('can-scroll-r', box.scrollLeft+box.clientWidth<box.scrollWidth-1);
  };
  box.addEventListener('scroll', updateScrollHints, {passive:true});
  new ResizeObserver(updateScrollHints).observe(box);
  return box;
}

// Numeric key for sorting a typed field value; missing/unparsable values sort last.
function fieldSortValue(def, val){
  if(val==null || val==='') return -Infinity;
  if(def?.type==='date'){ const t=Date.parse(val); return isNaN(t)?-Infinity:t; }
  const n=parseFloat(val); return isNaN(n)?-Infinity:n;
}

function projectRow(p, ctx, onSelectionChange){
  const rel=Store.latestRelease(p.id);
  const st=STATUSES[p.status]||STATUSES.idea;
  const tr=el('tr',{onclick:(e)=>{ if(e.target.closest('.rowbtn')||e.target.closest('.lib-sel-td')) return; ctx.go('project',{id:p.id}); }});
  makeRowClickable(tr, ()=>ctx.go('project',{id:p.id}), `Open ${p.name}`);
  // select
  const selTd=el('td',{class:'lib-sel-td'});
  const cb=el('input',{type:'checkbox', class:'lib-sel', 'data-pid':p.id, checked:selected.has(p.id), 'aria-label':`Select ${p.name}`});
  cb.addEventListener('change',()=>{ if(cb.checked) selected.add(p.id); else selected.delete(p.id); onSelectionChange(); });
  selTd.append(cb);
  // pin
  const pinTd=el('td');
  pinTd.append(el('button',{class:'pin-btn rowbtn'+(p.pinned?' on':''), title:p.pinned?'Unpin':'Pin', 'aria-label':p.pinned?'Unpin project':'Pin project',
    html:icon('pin'), onclick:(e)=>{ e.stopPropagation(); Store.togglePin(p.id); tr.closest('table')&&ctx.go('projects'); }}));
  // name (+ a transient NEW badge when a background refresh pulled new releases)
  const nameTd=el('td');
  const newBadge=Store.projectHasNewUpdates(p.id)
    ? `<span class="lib-new" title="New releases since you last opened this project">NEW</span>` : '';
  nameTd.innerHTML=`<div style="display:flex;align-items:center;gap:10px">
    <span class="tavatar" style="width:30px;height:30px;font-size:13px;border-radius:8px;background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
    <div style="min-width:0"><div style="display:flex;align-items:center;gap:7px"><b>${escapeHtml(p.name)}</b>${newBadge}</div><div class="tiny mono muted" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.repo||'')}</div></div></div>`;
  // status
  const stTd=el('td',{html:statusPill(p.status)});
  // version + when that version shipped (CT)
  const vTd=el('td',{class:'mono', html: rel
    ? `<span class="vchip">v${rel.v}</span><div class="tiny muted" style="margin-top:4px;font-family:var(--font)">${escapeHtml(fmtCT(rel.ts))}</div>`
    : '<span class="muted">—</span>'});
  // updated
  const upTd=el('td',{class:'tiny muted', text:fmtCT(Store.lastActivity(p.id))});
  // tags
  const tagTd=el('td',{html:(p.tags||[]).slice(0,3).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')||'<span class="muted">—</span>'});
  // actions
  const actTd=el('td');
  actTd.append(el('button',{class:'btn ghost icon sm rowbtn', title:'Edit', 'aria-label':'Edit project', html:icon('edit'),
    onclick:(e)=>{ e.stopPropagation(); openProjectEditor(p.id, ctx); }}));
  tr.append(selTd,pinTd,nameTd,stTd,vTd,upTd,tagTd,actTd);
  return tr;
}

// "Promote to field" helpers — turn a legacy free-form key into a sensible
// starting guess for a real field def, so the modal opens prefilled rather
// than blank. Best-effort only; the user can always change name/type before
// saving.
function humanizeKey(k){
  return String(k).replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g, c=>c.toUpperCase()) || k;
}
function inferFieldType(value){
  const s=String(value ?? '').trim();
  if(/^https?:\/\//i.test(s)) return 'url';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))) return 'date';
  if(s!=='' && !isNaN(Number(s))) return 'number';
  return 'text';
}

// -------------------------------------------------------------------------
// Shared project editor (add + edit). Used from the library, dashboard, and
// project detail. `id=null` creates a new project.
// -------------------------------------------------------------------------
export function openProjectEditor(id, ctx){
  const p = id ? Store.project(id) : null;
  const isNew = !p;
  const v = p || { name:'', repo:'', site:'', sessionUrl:'', status:'idea', icon:'grid', tags:[], assessment:'', cadence:'', fields:{} };

  const f=(label, node, hint)=>{ const w=el('div',{class:'field'}); w.append(el('label',{text:label}), node); if(hint) w.append(el('span',{class:'tiny muted', text:hint})); return w; };
  const name=el('input',{class:'input', placeholder:'Relay', value:v.name});
  const repo=el('input',{class:'input mono', placeholder:'kevinrhaas/relay.polecat.live', value:v.repo});
  const site=el('input',{class:'input mono', placeholder:'https://relay.polecat.live', value:v.site});
  const changelogUrl=el('input',{class:'input mono', placeholder:'auto: <site>/js/changelog.js', value:v.changelogUrl||''});
  const session=el('input',{class:'input mono', placeholder:'https://claude.ai/code/session_…', value:v.sessionUrl});
  const status=el('select',{class:'input'});
  Object.entries(STATUSES).forEach(([k,st])=>status.append(el('option',{value:k,text:st.label,selected:v.status===k})));
  const cadence=el('input',{class:'input', placeholder:'GitHub Action · hourly', value:v.cadence});
  const tags=el('input',{class:'input', placeholder:'ai, static, arcade', value:(v.tags||[]).join(', ')});
  const assessment=el('textarea',{class:'input', rows:'3', placeholder:'A short, honest read on where this project is.', value:v.assessment});

  // icon picker
  const iconChoices=['grid','gauge','chat','play','compass','bolt','layers','globe','db','rocket','terminal','star'];
  let chosenIcon=v.icon||'grid';
  const picker=el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'});
  iconChoices.forEach(ic=>{
    const b=el('button',{class:'btn icon'+(ic===chosenIcon?' primary':''), title:ic, 'aria-label':ic+' icon', html:icon(ic),
      onclick:()=>{ chosenIcon=ic; [...picker.children].forEach(x=>x.classList.remove('primary')); b.classList.add('primary'); }});
    picker.append(b);
  });

  // custom fields editor — one typed row per field defined in Settings, plus
  // any legacy free-form keys from before the schema existed (kept, editable).
  const customWrap=el('div');
  const custom = { ...(v.fields||{}) };
  const renderCustom=()=>{
    customWrap.innerHTML='';
    const defs=Store.fieldDefs();
    if(!defs.length){
      customWrap.append(el('div',{class:'tiny muted', style:'margin-bottom:8px', text:'No custom fields defined yet — add one below.'}));
    }
    defs.forEach(d=>{
      const row=el('div',{style:'display:flex;gap:8px;margin-bottom:8px;align-items:center'});
      const label=el('span',{class:'tiny muted', style:'flex:0 0 34%', text:d.label});
      let input;
      if(d.type==='select'){
        input=el('select',{class:'input', style:'flex:1', 'data-field':d.key});
        input.append(el('option',{value:'', text:'—'}));
        (d.options||[]).forEach(o=>input.append(el('option',{value:o, text:o})));
        input.value = custom[d.key]||'';
        input.addEventListener('change',()=>{ if(input.value) custom[d.key]=input.value; else delete custom[d.key]; });
      }else{
        const type = d.type==='number'?'number':d.type==='date'?'date':d.type==='url'?'url':'text';
        input=el('input',{class:'input'+(d.type==='url'?' mono':''), style:'flex:1', type, 'data-field':d.key, value:custom[d.key]??'', placeholder:d.label});
        input.addEventListener('input',()=>{ if(String(input.value).trim()) custom[d.key]=input.value; else delete custom[d.key]; });
      }
      row.append(label,input); customWrap.append(row);
    });
    const defKeys=new Set(defs.map(d=>d.key));
    Object.keys(custom).filter(k=>!defKeys.has(k)).forEach(k=>{
      const row=el('div',{style:'display:flex;gap:8px;margin-bottom:8px;align-items:center'});
      const kk=el('input',{class:'input', style:'flex:0 0 34%', value:k, placeholder:'Field'});
      const vv=el('input',{class:'input', style:'flex:1', value:custom[k], placeholder:'Value'});
      const promote=el('button',{class:'btn ghost icon sm', title:'Promote to field', 'aria-label':'Promote to typed field', html:icon('upload'),
        onclick:()=>{
          const key=kk.value.trim()||k, value=vv.value;
          editFieldDef(null, renderCustom, {
            title:'Promote to field', saveLabel:'Promote',
            note:`Turns "${key}" into a real field in the fleet-wide schema — typed, and available on every project. This project's current value carries over.`,
            prefill:{ label:humanizeKey(key), type:inferFieldType(value) },
            onAdded:(def)=>{ delete custom[k]; custom[def.key]=value; renderCustom(); },
          });
        }});
      const del=el('button',{class:'btn ghost icon sm', title:'Remove field', 'aria-label':'Remove field', html:icon('trash'),
        onclick:()=>{ delete custom[k]; renderCustom(); }});
      kk.addEventListener('change',()=>{ const nv=vv.value; delete custom[k]; if(kk.value.trim()) custom[kk.value.trim()]=nv; renderCustom(); });
      vv.addEventListener('input',()=>{ custom[k]=vv.value; });
      row.append(kk,vv,promote,del); customWrap.append(row);
    });
    customWrap.append(el('button',{class:'btn sm', html:`${icon('plus')} New field type`, title:'Define a new typed field — appears here and on every project', onclick:()=>editFieldDef(null, renderCustom)}));
  };
  renderCustom();

  const body=el('div');
  const twoCol=(a,b)=>{ const r=el('div',{style:'display:flex;gap:14px;flex-wrap:wrap'}); a.style.flex='1'; b.style.flex='1'; a.style.minWidth='180px'; b.style.minWidth='180px'; r.append(a,b); return r; };
  body.append(
    f('Name', name),
    twoCol(f('Repository', repo, 'owner/name on GitHub'), f('Live site', site, 'blank if none')),
    f('Changelog URL', changelogUrl, 'Where "Sync" pulls real releases from — leave blank to guess from the live site.'),
    f('Claude Code session', session, 'The session you drive most of this work from — opens in a new tab.'),
    twoCol(f('Status', status), f('Cadence', cadence, 'how it self-improves')),
    f('Tags', tags, 'comma-separated'),
    f('Assessment', assessment),
    f('Icon', picker),
    el('div',{class:'divider'}),
    el('div',{class:'field'}, [el('label',{text:'Custom fields'}), el('span',{class:'tiny muted', text:'Typed and shared across the fleet — surfaced on the project page and in the library’s filters and sort.'}), customWrap]),
  );

  const save=el('button',{class:'btn primary', text:isNew?'Create project':'Save changes', onclick:()=>{
    const nm=name.value.trim(); if(!nm){ name.focus(); return; }
    const data={ name:nm, repo:repo.value.trim(), site:site.value.trim(), changelogUrl:changelogUrl.value.trim(), sessionUrl:session.value.trim(),
      status:status.value, icon:chosenIcon, cadence:cadence.value.trim(),
      tags:tags.value.split(',').map(t=>t.trim()).filter(Boolean),
      assessment:assessment.value.trim(), fields:custom };
    if(isNew){ const created=Store.addProject(data); hide(); toast('Project added',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:created.id}); }
    else { Store.updateProject(id, data); hide(); toast('Project saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.refresh(); }
  }});
  const foot=[ el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}) ];
  if(!isNew) foot.unshift(el('button',{class:'btn danger', html:`${icon('trash')} Delete`, onclick:async()=>{
    if(await confirmDialog({ title:'Delete project', message:`Remove "${v.name}" and its releases from Manager? You can undo this.`, danger:true, okText:'Delete' })){
      Store.remove('projects', id); hide(); toast('Project deleted',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('projects');
    }
  }}));
  foot.push(save);
  const {hide}=modal({ title:isNew?'Add project':'Edit project', icon:icon(isNew?'plus':'edit'), body, foot, wide:true });
  setTimeout(()=>name.focus(),50);
}
