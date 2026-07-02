// Settings — theme, Simple mode, welcome tour, what's-new preferences,
// data (export/import/reset), and access.
import { Store, FIELD_TYPES, DEFAULT_HEALTH_WEIGHTS } from '../store.js';
import { Access } from '../access.js';
import { getThemePref, setTheme } from '../theme.js';
import { el, escapeHtml, toast, modal, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { AUTO_SYNC_FAIL_THRESHOLD } from '../ingest.js';

export function renderSettings(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const s=Store.settings();

  wrap.append(el('div',{class:'section-title', style:'margin-top:0', html:`<span style="color:var(--brand-b);display:inline-flex">${icon('settings')}</span><h2>Settings</h2>`}));

  // ---- Appearance ----
  const appearance=card('Appearance', 'sun');
  // theme segmented
  const themeRow=optRow('Theme','Dark, light, or follow your system.');
  const seg=el('div',{class:'seg'});
  [['dark','Dark'],['light','Light'],['system','System']].forEach(([v,t])=>{
    const b=el('button',{class:getThemePref()===v?'on':'', text:t, onclick:()=>{ setTheme(v); [...seg.children].forEach(x=>x.classList.remove('on')); b.classList.add('on'); ctx.syncTheme&&ctx.syncTheme(); }});
    seg.append(b);
  });
  themeRow.append(seg);
  appearance.append(themeRow);
  // simple mode
  appearance.append(toggleRow('Simple mode', 'Trim the navigation to the essentials — a calmer view for newcomers.', s.simpleMode, (on)=>{ Store.setSetting('simpleMode', on); ctx.refresh(); toast(on?'Simple mode on':'Simple mode off',{kind:'ok'}); }));
  wrap.append(appearance);

  // ---- Onboarding ----
  const onboard=card('Onboarding', 'rocket');
  const tourRow=optRow('Welcome tour','Replay the guided walkthrough of Manager.');
  tourRow.append(el('button',{class:'btn sm', html:`${icon('play')} Start tour`, onclick:()=>ctx.startTour&&ctx.startTour()}));
  onboard.append(tourRow);
  onboard.append(optRow('Documentation','The complete guide for first-time users.').also(r=>r.append(el('button',{class:'btn sm', html:`${icon('book')} Open docs`, onclick:()=>ctx.go('docs')}))));
  wrap.append(onboard);

  // ---- What's new preferences (tracked attributes) ----
  const wn=card("What’s-new preferences", 'sparkle');
  wn.append(el('p',{class:'muted tiny', style:'margin:0 0 6px', text:'Choose which attributes show in the What’s-new panel and the default order.'}));
  const tracked={...s.wnTracked};
  const attrs=[['version','Version badge'],['date','Ship date'],['kind','Kind (feature/polish/fix)'],['items','Detail bullets']];
  attrs.forEach(([k,lbl])=>wn.append(toggleRow(lbl, '', tracked[k]!==false, (on)=>{ tracked[k]=on; Store.setSetting('wnTracked', tracked); }, true)));
  const sortRow=optRow('Default sort','');
  const sortSeg=el('div',{class:'seg'});
  [['newest','Newest'],['oldest','Oldest']].forEach(([v,t])=>{ const b=el('button',{class:s.wnSort===v?'on':'', text:t, onclick:()=>{ Store.setSetting('wnSort',v); [...sortSeg.children].forEach(x=>x.classList.remove('on')); b.classList.add('on'); }}); sortSeg.append(b); });
  sortRow.append(sortSeg); wn.append(sortRow);
  wrap.append(wn);

  // ---- Auto-sync (quiet, on-a-cadence changelog ingestion) ----
  const auto=card('Auto-sync', 'refresh');
  auto.append(el('p',{class:'muted tiny', style:'margin:0 0 6px', text:'Quietly re-pulls each opted-in project’s changelog on app open, and again once its interval has passed — banking new releases without a modal. Opt a project in from its own health panel; this switch (plus the interval) governs the fleet.'}));
  const acfg = s.autoSync || {enabled:false, intervalMinutes:360};
  const curMin = acfg.intervalMinutes ?? (acfg.intervalHours!=null ? acfg.intervalHours*60 : 360);
  auto.append(toggleRow('Auto-sync changelogs', 'Nothing runs in the background unless this is on.', acfg.enabled, (on)=>{
    Store.setSetting('autoSync', { ...Store.settings().autoSync, enabled:on });
    toast(on?'Auto-sync on':'Auto-sync off', {kind:'ok'});
  }));
  const intervalRow=optRow('Check every', 'How often a due, opted-in project is re-checked. Runs quietly in the background — a check that’s still in flight never starts another, and it pauses while the tab is hidden.');
  const intervalSel=el('select',{class:'input', style:'max-width:150px'});
  [[1,'1 minute'],[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[180,'3 hours'],[360,'6 hours'],[720,'12 hours'],[1440,'24 hours']].forEach(([m,t])=>
    intervalSel.append(el('option',{value:m, text:t, selected:curMin===m})));
  intervalSel.addEventListener('change',()=>Store.setSetting('autoSync', { ...Store.settings().autoSync, intervalMinutes:parseInt(intervalSel.value,10) }));
  intervalRow.append(intervalSel);
  auto.append(intervalRow);
  const optedIn=Store.projects().filter(p=>p.autoSync);
  auto.append(el('div',{class:'tiny muted', style:'margin-top:4px', text: optedIn.length?`Opted in: ${optedIn.map(p=>p.name).join(', ')}.`:'No projects opted in yet.'}));
  const failing=optedIn.filter(p=>(p.autoSyncFailCount||0)>=AUTO_SYNC_FAIL_THRESHOLD);
  if(failing.length){
    auto.append(el('div',{class:'tiny', style:'margin-top:6px;color:var(--danger)',
      html:`${icon('warning','warn-ic')} ${failing.length} failing: ${failing.map(p=>escapeHtml(p.name)).join(', ')} — see each project’s health panel.`}));
  }
  wrap.append(auto);

  // ---- Fleet health weighting ----
  const health=card('Fleet health weighting', 'gauge');
  health.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'Every project’s health score (0-100) blends three signals — how recently it shipped, how fast it’s shipping, and its status. Drag to change how much each one counts; they’re relative, so they always add up to 100 no matter what you set them to.'}));
  const wRow=el('div',{style:'display:flex;flex-direction:column;gap:12px'});
  const dims=[['recency','Recency','How recently the project last shipped something.'],['velocity','Velocity','How many releases it’s shipped in the last 90 days.'],['status','Status','Live/active projects score higher than paused or archived ones.']];
  const pctEls={};
  const renderPcts=()=>{
    const norm=Store.healthWeights();
    dims.forEach(([k])=>{ if(pctEls[k]) pctEls[k].textContent=Math.round(norm[k])+'%'; });
  };
  dims.forEach(([k,label,desc])=>{
    const cur=(Store.settings().healthWeights||DEFAULT_HEALTH_WEIGHTS)[k] ?? DEFAULT_HEALTH_WEIGHTS[k];
    const row=el('div',{class:'field', style:'margin:0'});
    const head=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
    head.innerHTML=`<label style="margin:0">${escapeHtml(label)}</label><span class="tiny muted mono" style="min-width:34px;text-align:right"></span>`;
    const pctEl=head.lastElementChild; pctEls[k]=pctEl;
    const slider=el('input',{type:'range', min:'0', max:'100', step:'1', value:String(cur), class:'health-weight-slider', 'data-dim':k});
    slider.addEventListener('input',()=>{ Store.setHealthWeights({ [k]:parseInt(slider.value,10) }); renderPcts(); });
    row.append(head, slider, el('span',{class:'tiny muted', text:desc}));
    wRow.append(row);
  });
  health.append(wRow);
  renderPcts();
  health.append(el('button',{class:'btn sm', style:'margin-top:12px', html:`${icon('refresh')} Reset to default weighting`, onclick:()=>{
    Store.setSetting('healthWeights', { ...DEFAULT_HEALTH_WEIGHTS });
    dims.forEach(([k])=>{ const s=wRow.querySelector(`[data-dim="${k}"]`); if(s) s.value=String(DEFAULT_HEALTH_WEIGHTS[k]); });
    renderPcts(); toast('Health weighting reset',{kind:'ok'});
  }}));
  wrap.append(health);

  // ---- Custom fields (typed project-metadata schema) ----
  const fields=card('Custom fields', 'sliders');
  fields.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'Define typed fields — text, number, URL, date, or a fixed set of options — and they’ll show up on every project’s editor, health panel, and the library’s filters and sort.'}));
  const fieldsList=el('div',{style:'display:flex;flex-direction:column;gap:8px'});
  const renderFieldsList=()=>{
    fieldsList.innerHTML='';
    const defs=Store.fieldDefs();
    if(!defs.length) fieldsList.append(el('div',{class:'card muted tiny', text:'No custom fields yet.'}));
    else defs.forEach(d=>fieldsList.append(fieldDefRow(d, renderFieldsList)));
  };
  renderFieldsList();
  fields.append(fieldsList);
  fields.append(el('button',{class:'btn sm', style:'margin-top:10px', html:`${icon('plus')} Add field`, onclick:()=>editFieldDef(null, renderFieldsList)}));
  wrap.append(fields);

  // ---- Data ----
  const data=card('Data', 'db');
  data.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'Everything lives in this browser. Export a JSON backup, import it elsewhere, or reset to the seeded fleet.'}));
  const dataBtns=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('download')} Export JSON`, onclick:exportJSON}));
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('upload')} Import JSON`, onclick:()=>importJSON(ctx)}));
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('undo')} Undo last change`, onclick:()=>{ if(Store.canUndo()){ const o=Store.undo(); toast('Undone: '+(o?.label||''),{kind:'ok'}); ctx.render&&ctx.render(); } else toast('Nothing to undo',{kind:'info'}); }}));
  dataBtns.append(el('button',{class:'btn sm danger', html:`${icon('trash')} Reset workspace`, onclick:async()=>{ if(await confirmDialog('Reset workspace','This wipes your local Manager data and restores the seeded fleet. This cannot be undone.',{danger:true,okLabel:'Reset'})){ Store.reset(); toast('Workspace reset',{kind:'ok'}); ctx.go('home'); } }}));
  data.append(dataBtns);
  wrap.append(data);

  // ---- Access ----
  const access=card('Access', 'shield');
  const info=Access.info();
  access.append(optRow(Access.isAdmin()?'Signed in as admin':'Access', info?`Unlocked via ${escapeHtml(info.via)}${info.label?` · ${escapeHtml(info.label)}`:''}.`:'Invite-only preview.')
    .also(r=>{
      if(Access.isAdmin()) r.append(el('button',{class:'btn sm', html:`${icon('shield')} Admin area`, onclick:()=>ctx.go('admin')}));
      else r.append(el('button',{class:'btn sm', html:`${icon('key')} Unlock admin`, onclick:()=>ctx.go('admin')}));
    }));
  wrap.append(access);

  wrap.append(el('p',{class:'tiny muted', style:'text-align:center;margin-top:26px', html:`Manager · part of the <a class="link" href="https://polecat.live" target="_blank" rel="noopener">polecat.live</a> family`}));
  root.append(wrap);
}

// ---- little builders -----------------------------------------------------
function card(title, ic){
  const c=el('div',{class:'card', style:'margin-bottom:16px'});
  c.append(el('div',{class:'section-title', style:'margin-top:0', html:`<span style="color:var(--brand-b);display:inline-flex">${icon(ic)}</span><h2 style="font-size:14px">${escapeHtml(title)}</h2>`}));
  return c;
}
function optRow(title, desc){
  const r=el('div',{class:'opt-row'});
  r.innerHTML=`<div class="sp"><b>${escapeHtml(title)}</b>${desc?`<p>${escapeHtml(desc)}</p>`:''}</div>`;
  r.also=(fn)=>{ fn(r); return r; };
  return r;
}
function toggleRow(title, desc, on, onChange, compact){
  const r=optRow(title, desc);
  if(compact) r.style.padding='8px 0';
  const t=el('button',{class:'toggle'+(on?' on':''), role:'switch', 'aria-checked':String(on), 'aria-label':title,
    onclick:()=>{ const now=!t.classList.contains('on'); t.classList.toggle('on', now); t.setAttribute('aria-checked',String(now)); onChange(now); }});
  r.append(t);
  return r;
}

// ---- custom fields (typed project-metadata schema) -----------------------
function fieldDefRow(d, onChange){
  const row=el('div',{class:'card', style:'display:flex;align-items:center;gap:12px'});
  row.innerHTML=`<span class="qicon" style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand-b),var(--consensus));color:#05121a">${icon('sliders')}</span>`;
  const mid=el('div',{style:'flex:1;min-width:0'});
  mid.innerHTML=`<b>${escapeHtml(d.label)}</b> <span class="tiny mono muted">${escapeHtml(d.key)}</span>
    <div class="tiny muted">${escapeHtml(FIELD_TYPES[d.type]?.label||'Text')}${d.type==='select'&&d.options?.length?` · ${d.options.map(escapeHtml).join(', ')}`:''}</div>`;
  row.append(mid);
  row.append(el('button',{class:'btn ghost icon sm', title:'Edit', 'aria-label':'Edit field', html:icon('edit'), onclick:()=>editFieldDef(d.id, onChange)}));
  row.append(el('button',{class:'btn ghost icon sm', title:'Remove', 'aria-label':'Remove field', html:icon('trash'), onclick:async()=>{
    if(await confirmDialog('Remove field', `Remove "${d.label}" from the schema? Existing values stay on projects, but the field won’t appear in the editor, filters, or sort unless you re-add it.`, {danger:true, okLabel:'Remove'})){
      Store.removeFieldDef(d.id); toast('Field removed',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); onChange();
    }
  }}));
  return row;
}

// Add/edit a field definition. Shared by Settings (schema management) and the
// project editor ("+ New field" — define one without leaving the modal).
export function editFieldDef(id, onChange){
  const d = id ? Store.fieldDef(id) : null;
  const isNew = !d;
  const label=el('input',{class:'input', placeholder:'Owner', value:d?.label||''});
  const type=el('select',{class:'input'});
  Object.entries(FIELD_TYPES).forEach(([k,t])=>type.append(el('option',{value:k,text:t.label})));
  type.value = d?.type||'text';
  const options=el('input',{class:'input', placeholder:'small, medium, large', value:(d?.options||[]).join(', ')});
  const optionsField=el('div',{class:'field'}); optionsField.append(el('label',{text:'Options'}), options, el('span',{class:'tiny muted', text:'Comma-separated choices for a Select field.'}));
  optionsField.style.display = type.value==='select' ? '' : 'none';
  type.addEventListener('change',()=>{ optionsField.style.display = type.value==='select' ? '' : 'none'; });
  const f=(l,n,hint)=>{ const w=el('div',{class:'field'}); w.append(el('label',{text:l}), n); if(hint) w.append(el('span',{class:'tiny muted', text:hint})); return w; };
  const body=el('div');
  body.append(f('Name', label, 'Shown on the project editor, health panel, and library filters.'), f('Type', type), optionsField);
  const save=el('button',{class:'btn primary', text:isNew?'Add field':'Save changes', onclick:()=>{
    const lbl=label.value.trim(); if(!lbl){ label.focus(); return; }
    const opts=options.value.split(',').map(s=>s.trim()).filter(Boolean);
    try{
      const data={ label:lbl, type:type.value, options:type.value==='select'?opts:[] };
      if(isNew) Store.addFieldDef(data); else Store.updateFieldDef(id, data);
      hide(); toast(isNew?'Field added':'Field saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); onChange&&onChange();
    }catch(e){ toast('Couldn’t save field',{body:e.message, kind:'err'}); }
  }});
  const {hide}=modal({ title:isNew?'Add custom field':'Edit custom field', icon:'sliders', body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), save] });
  setTimeout(()=>label.focus(),50);
}

// ---- data helpers --------------------------------------------------------
export function exportJSON(){
  const blob=new Blob([Store.exportJSON()],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='manager-workspace.json';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('Workspace exported',{kind:'ok'});
}
export function importJSON(ctx){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange=()=>{ const file=inp.files[0]; if(!file) return; const rd=new FileReader();
    rd.onload=()=>{ try{ Store.importJSON(rd.result); toast('Workspace imported',{kind:'ok'}); ctx.go('home'); }
      catch(e){ toast('Import failed',{body:e.message,kind:'err'}); } };
    rd.readAsText(file); };
  inp.click();
}
