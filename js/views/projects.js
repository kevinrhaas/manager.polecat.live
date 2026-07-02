// Projects library — the source of truth for the fleet. Filter, sort, search,
// pin, edit, and add rich metadata (including your own custom fields).
import { Store, STATUSES } from '../store.js';
import { el, escapeHtml, toast, modal, confirmDialog, fmtCT, avatarColor, slugify } from '../ui.js';
import { icon } from '../icons.js';

const VIEW_KEY = 'manager.lib.view';   // { q, status, sort, dir, saved }

function state(){ try{ return { q:'', status:'all', sort:'activity', dir:'desc', ...(JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')) }; }catch{ return { q:'', status:'all', sort:'activity', dir:'desc' }; } }
function saveState(s){ try{ localStorage.setItem(VIEW_KEY, JSON.stringify(s)); }catch{} }

const SAVED_VIEWS = [
  { id:'all',     label:'All',           icon:'grid',     apply:s=>({...s,status:'all'}) },
  { id:'live',    label:'Live only',     icon:'globe',    apply:s=>({...s,status:'live',sort:'activity',dir:'desc'}) },
  { id:'recent',  label:'Recently active',icon:'clock',   apply:s=>({...s,status:'all',sort:'activity',dir:'desc'}) },
  { id:'pinned',  label:'Pinned',        icon:'pin',      apply:s=>({...s,status:'pinned'}) },
];

export function renderProjects(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const s=state();

  // header + add
  const head=el('div',{class:'section-title'});
  head.innerHTML=`<h2>Projects</h2>`;
  head.append(el('span',{class:'sp'}));
  head.append(el('button',{class:'btn primary sm', html:`${icon('plus')} Add project`, onclick:()=>openProjectEditor(null, ctx)}));
  wrap.append(head);

  // saved views
  const views=el('div',{class:'saved-views'});
  SAVED_VIEWS.forEach(v=>{
    const on = (v.id==='pinned'&&s.status==='pinned') || (v.id==='live'&&s.status==='live') ||
      (v.id==='all'&&s.status==='all'&&s.sort!=='activity') || (v.id==='recent'&&s.status==='all'&&s.sort==='activity');
    views.append(el('button',{class:'filter-chip'+(on?' on':''), html:`${icon(v.icon)} ${v.label}`,
      onclick:()=>{ const ns=v.apply(state()); saveState(ns); renderProjects(root,ctx); }}));
  });
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
  statusSel.value = (s.status==='pinned'?'all':s.status);
  statusSel.addEventListener('change',()=>{ const ns={...state(),status:statusSel.value}; saveState(ns); renderProjects(root,ctx); });

  const sortSel=el('select',{class:'input', style:'max-width:170px'});
  [['activity','Last activity'],['name','Name'],['status','Status'],['version','Latest version']].forEach(([v,t])=>
    sortSel.append(el('option',{value:v,text:'Sort: '+t,selected:s.sort===v})));
  sortSel.addEventListener('change',()=>{ const ns={...state(),sort:sortSel.value}; saveState(ns); rerenderList(); });
  const dirBtn=el('button',{class:'btn icon', title:'Toggle direction', 'aria-label':'Toggle sort direction',
    html:icon('sort'), onclick:()=>{ const cur=state(); const ns={...cur,dir:cur.dir==='desc'?'asc':'desc'}; saveState(ns); rerenderList(); }});

  bar.append(search, statusSel, sortSel, dirBtn);
  wrap.append(bar);

  const listHost=el('div',{id:'libList'});
  wrap.append(listHost);
  root.append(wrap);

  function rerenderList(){ listHost.innerHTML=''; listHost.append(buildList(ctx)); }
  rerenderList();
}

function buildList(ctx){
  const s=state();
  let rows=Store.projects();
  const q=s.q.trim().toLowerCase();
  if(q) rows=rows.filter(p=>[p.name,p.repo,p.site,p.assessment,(p.tags||[]).join(' ')].join(' ').toLowerCase().includes(q));
  if(s.status==='pinned') rows=rows.filter(p=>p.pinned);
  else if(s.status!=='all') rows=rows.filter(p=>p.status===s.status);

  const dir = s.dir==='asc'?1:-1;
  rows.sort((a,b)=>{
    let r=0;
    if(s.sort==='name') r=a.name.localeCompare(b.name);
    else if(s.sort==='status') r=a.status.localeCompare(b.status);
    else if(s.sort==='version') r=((Store.latestRelease(a.id)?.v)||0)-((Store.latestRelease(b.id)?.v)||0);
    else r=Store.lastActivity(a.id)-Store.lastActivity(b.id);
    return r*dir;
  });
  // pinned float to top regardless (stable)
  rows.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));

  if(!rows.length){
    return el('div',{class:'card empty', html:`${icon('grid')}<div>No projects match. <a class="link" id="clearF">Clear filters</a> or add one.</div>`,
      onclick:(e)=>{ if(e.target.id==='clearF'){ saveState({q:'',status:'all',sort:'activity',dir:'desc'}); const root=document.getElementById('view'); renderProjects(root,ctx); } }});
  }

  const box=el('div',{class:'lib-table'});
  const table=el('table',{class:'data'});
  const cols=[['','pin'],['Project','name'],['Status','status'],['Latest','version'],['Updated','activity'],['Tags','tags'],['',' ']];
  const thead=el('tr');
  cols.forEach(([label,key])=>{
    const th=el('th',{class:s.sort===key?'sorted':''});
    th.innerHTML=`${escapeHtml(label)}${['name','status','version','activity'].includes(key)?` <span class="caret">${s.dir==='asc'?'▲':'▼'}</span>`:''}`;
    if(['name','status','version','activity'].includes(key)) th.onclick=()=>{ const cur=state(); saveState({...cur,sort:key,dir:cur.sort===key&&cur.dir==='desc'?'asc':'desc'}); const root=document.getElementById('view'); renderProjects(root,ctx); };
    thead.append(th);
  });
  table.append(el('thead',{},thead));
  const tb=el('tbody');
  rows.forEach(p=>tb.append(projectRow(p, ctx)));
  table.append(tb);
  box.append(table);
  return box;
}

function projectRow(p, ctx){
  const rel=Store.latestRelease(p.id);
  const st=STATUSES[p.status]||STATUSES.idea;
  const tr=el('tr',{onclick:(e)=>{ if(e.target.closest('.rowbtn')) return; ctx.go('project',{id:p.id}); }});
  // pin
  const pinTd=el('td');
  pinTd.append(el('button',{class:'pin-btn rowbtn'+(p.pinned?' on':''), title:p.pinned?'Unpin':'Pin', 'aria-label':p.pinned?'Unpin project':'Pin project',
    html:icon('pin'), onclick:(e)=>{ e.stopPropagation(); Store.togglePin(p.id); tr.closest('table')&&ctx.go('projects'); }}));
  // name
  const nameTd=el('td');
  nameTd.innerHTML=`<div style="display:flex;align-items:center;gap:10px">
    <span class="tavatar" style="width:30px;height:30px;font-size:13px;border-radius:8px;background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
    <div style="min-width:0"><b>${escapeHtml(p.name)}</b><div class="tiny mono muted" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.repo||'')}</div></div></div>`;
  // status
  const stTd=el('td',{html:`<span class="status ${st.cls}"><span class="dot"></span>${st.label}</span>`});
  // version
  const vTd=el('td',{class:'mono', html: rel?`<span class="vchip">v${rel.v}</span>`:'<span class="muted">—</span>'});
  // updated
  const upTd=el('td',{class:'tiny muted', text:fmtCT(Store.lastActivity(p.id))});
  // tags
  const tagTd=el('td',{html:(p.tags||[]).slice(0,3).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')||'<span class="muted">—</span>'});
  // actions
  const actTd=el('td');
  actTd.append(el('button',{class:'btn ghost icon sm rowbtn', title:'Edit', 'aria-label':'Edit project', html:icon('edit'),
    onclick:(e)=>{ e.stopPropagation(); openProjectEditor(p.id, ctx); }}));
  tr.append(pinTd,nameTd,stTd,vTd,upTd,tagTd,actTd);
  return tr;
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

  // custom fields editor
  const customWrap=el('div');
  const custom = { ...(v.fields||{}) };
  const renderCustom=()=>{
    customWrap.innerHTML='';
    Object.entries(custom).forEach(([k,val])=>{
      const row=el('div',{style:'display:flex;gap:8px;margin-bottom:8px;align-items:center'});
      const kk=el('input',{class:'input', style:'flex:0 0 34%', value:k, placeholder:'Field'});
      const vv=el('input',{class:'input', style:'flex:1', value:val, placeholder:'Value'});
      const del=el('button',{class:'btn ghost icon sm', title:'Remove field', 'aria-label':'Remove field', html:icon('trash'),
        onclick:()=>{ delete custom[k]; renderCustom(); }});
      kk.addEventListener('change',()=>{ const nv=vv.value; delete custom[k]; if(kk.value.trim()) custom[kk.value.trim()]=nv; renderCustom(); });
      vv.addEventListener('input',()=>{ custom[k]=vv.value; });
      row.append(kk,vv,del); customWrap.append(row);
    });
    customWrap.append(el('button',{class:'btn sm', html:`${icon('plus')} Add field`, onclick:()=>{ let n='field'; let i=1; while(custom[n]) n='field'+(++i); custom[n]=''; renderCustom(); }}));
  };
  renderCustom();

  const body=el('div');
  const twoCol=(a,b)=>{ const r=el('div',{style:'display:flex;gap:14px;flex-wrap:wrap'}); a.style.flex='1'; b.style.flex='1'; a.style.minWidth='180px'; b.style.minWidth='180px'; r.append(a,b); return r; };
  body.append(
    f('Name', name),
    twoCol(f('Repository', repo, 'owner/name on GitHub'), f('Live site', site, 'blank if none')),
    f('Claude Code session', session, 'The session you drive most of this work from — opens in a new tab.'),
    twoCol(f('Status', status), f('Cadence', cadence, 'how it self-improves')),
    f('Tags', tags, 'comma-separated'),
    f('Assessment', assessment),
    f('Icon', picker),
    el('div',{class:'divider'}),
    el('div',{class:'field'}, [el('label',{text:'Custom fields'}), el('span',{class:'tiny muted', text:'Track anything — model, owner, budget… surfaced on the project page.'}), customWrap]),
  );

  const save=el('button',{class:'btn primary', text:isNew?'Create project':'Save changes', onclick:()=>{
    const nm=name.value.trim(); if(!nm){ name.focus(); return; }
    const data={ name:nm, repo:repo.value.trim(), site:site.value.trim(), sessionUrl:session.value.trim(),
      status:status.value, icon:chosenIcon, cadence:cadence.value.trim(),
      tags:tags.value.split(',').map(t=>t.trim()).filter(Boolean),
      assessment:assessment.value.trim(), fields:custom };
    if(isNew){ const created=Store.addProject(data); hide(); toast('Project added',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:created.id}); }
    else { Store.updateProject(id, data); hide(); toast('Project saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.refresh(); }
  }});
  const foot=[ el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}) ];
  if(!isNew) foot.unshift(el('button',{class:'btn danger', html:`${icon('trash')} Delete`, onclick:async()=>{
    if(await confirmDialog('Delete project', `Remove "${v.name}" and its releases from Manager? You can undo this.`, {danger:true, okLabel:'Delete'})){
      Store.remove('projects', id); hide(); toast('Project deleted',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('projects');
    }
  }}));
  foot.push(save);
  const {hide}=modal({ title:isNew?'Add project':'Edit project', icon:isNew?'plus':'edit', body, foot, wide:true });
  setTimeout(()=>name.focus(),50);
}
