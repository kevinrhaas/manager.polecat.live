// Settings — theme, Simple mode, welcome tour, what's-new preferences,
// data (export/import/reset), and access.
import { Store, FIELD_TYPES, DEFAULT_HEALTH_WEIGHTS, DEFAULT_ATTENTION_THRESHOLDS, DEFAULT_AUTO_SYNC_BACKOFF_CAP, healthBand } from '../store.js';
import { Access } from '../access.js';
import { getThemePref, setTheme } from '../theme.js';
import { el, escapeHtml, toast, modal, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';

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
  const bRow=el('div',{class:'field', style:'margin:14px 0 0'});
  const bHead=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
  bHead.innerHTML=`<label style="margin:0">Failure backoff cap</label><span class="tiny muted mono" style="min-width:70px;text-align:right"></span>`;
  const bVal=bHead.lastElementChild;
  const renderBVal=(v)=>{ bVal.textContent=`${v}× max`; };
  const bSlider=el('input',{type:'range', min:'1', max:'64', step:'1', value:String(Store.autoSyncBackoffCap()), class:'backoff-cap-slider'});
  bSlider.addEventListener('input',()=>{ const v=parseInt(bSlider.value,10); renderBVal(v); Store.setAutoSyncBackoffCap(v); });
  renderBVal(Store.autoSyncBackoffCap());
  bRow.append(bHead, bSlider, el('span',{class:'tiny muted', text:'Each consecutive failure doubles a project’s retry wait; this caps how many times slower it can get.'}));
  auto.append(bRow);
  auto.append(el('button',{class:'btn sm', style:'margin-top:12px', html:`${icon('refresh')} Reset backoff cap`, onclick:()=>{
    Store.setAutoSyncBackoffCap(DEFAULT_AUTO_SYNC_BACKOFF_CAP);
    bSlider.value=String(DEFAULT_AUTO_SYNC_BACKOFF_CAP); renderBVal(DEFAULT_AUTO_SYNC_BACKOFF_CAP);
    toast('Backoff cap reset to default',{kind:'ok'});
  }}));
  const optedIn=Store.projects().filter(p=>p.autoSync);
  auto.append(el('div',{class:'tiny muted', style:'margin-top:4px', text: optedIn.length?`Opted in: ${optedIn.map(p=>p.name).join(', ')}.`:'No projects opted in yet.'}));
  const failing=optedIn.filter(p=>(p.autoSyncFailCount||0)>=Store.attentionThresholdsFor(p.id).autoSyncFails);
  if(failing.length){
    auto.append(el('div',{class:'tiny', style:'margin-top:6px;color:var(--danger)',
      html:`${icon('warning','warn-ic')} ${failing.length} failing: ${failing.map(p=>escapeHtml(p.name)).join(', ')} — see each project’s health panel.`}));
  }
  wrap.append(auto);

  // ---- Status automation (derive a project's status from its sync activity) ----
  const asCfg = Store.settings().autoStatus || { enabled:true };
  const stat=card('Status automation', 'compass');
  stat.append(el('p',{class:'muted tiny', style:'margin:0 0 6px', text:'When a project syncs, set its status from its release activity: shipped recently → Live (or Active if it has no live site), gone quiet for months → Paused. It never touches Archived or any project you’ve Locked on its health panel (an Idea does promote once it has real releases).'}));
  stat.append(toggleRow('Update status on sync', 'Applies to manual Sync, Force sync, Sync all, and Auto-sync.', asCfg.enabled!==false, (on)=>{
    Store.setSetting('autoStatus', { ...Store.settings().autoStatus, enabled:on });
    toast(on?'Status will update on sync':'Status is now manual only', {kind:'ok'});
  }));
  wrap.append(stat);

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

  // ---- Needs-attention thresholds ----
  const attn=card('Needs attention', 'warning');
  attn.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'The bell, the Dashboard rail badge, and the “Needs attention” callout all flag a project once its health score sinks low enough, or its auto-sync fails too many times in a row. Tune how sensitive that is — a smaller fleet you watch closely might want an earlier warning; a big one might want to only hear about real trouble.'}));
  const at=Store.attentionThresholds();
  const attnCountEl=el('span',{class:'tiny muted mono'});
  const renderAttnCount=()=>{ attnCountEl.textContent=`${Store.needsAttention().length} of ${Store.projects().length} project${Store.projects().length===1?'':'s'} flagged right now`; };

  const hRow=el('div',{class:'field', style:'margin:0'});
  const hHead=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
  hHead.innerHTML=`<label style="margin:0">Health score</label><span class="tiny muted mono" style="min-width:120px;text-align:right"></span>`;
  const hVal=hHead.lastElementChild;
  const renderHVal=(v)=>{ const b=healthBand(Math.max(0,v-1)); hVal.textContent=`below ${v} (${b.label})`; };
  const hSlider=el('input',{type:'range', min:'1', max:'100', step:'1', value:String(at.healthMax), class:'attn-slider', 'data-attn':'health'});
  hSlider.addEventListener('input',()=>{ const v=parseInt(hSlider.value,10); renderHVal(v); Store.setAttentionThresholds({ healthMax:v }); renderAttnCount(); });
  renderHVal(at.healthMax);
  hRow.append(hHead, hSlider, el('span',{class:'tiny muted', text:'Flag a project once its health score falls below this line.'}));
  attn.append(hRow);

  const sRow=el('div',{class:'field', style:'margin:14px 0 0'});
  const sHead=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
  sHead.innerHTML=`<label style="margin:0">Auto-sync failures</label><span class="tiny muted mono" style="min-width:70px;text-align:right"></span>`;
  const sVal=sHead.lastElementChild;
  const renderSVal=(v)=>{ sVal.textContent=`×${v} in a row`; };
  const sSlider=el('input',{type:'range', min:'1', max:'10', step:'1', value:String(at.autoSyncFails), class:'attn-slider', 'data-attn':'sync'});
  sSlider.addEventListener('input',()=>{ const v=parseInt(sSlider.value,10); renderSVal(v); Store.setAttentionThresholds({ autoSyncFails:v }); renderAttnCount(); });
  renderSVal(at.autoSyncFails);
  sRow.append(sHead, sSlider, el('span',{class:'tiny muted', text:'Flag an opted-in project once its auto-sync has failed this many times in a row.'}));
  attn.append(sRow);

  const attnFoot=el('div',{style:'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px'});
  attnFoot.append(el('button',{class:'btn sm', html:`${icon('refresh')} Reset to default`, onclick:()=>{
    Store.setSetting('attentionThresholds', { ...DEFAULT_ATTENTION_THRESHOLDS });
    hSlider.value=String(DEFAULT_ATTENTION_THRESHOLDS.healthMax); renderHVal(DEFAULT_ATTENTION_THRESHOLDS.healthMax);
    sSlider.value=String(DEFAULT_ATTENTION_THRESHOLDS.autoSyncFails); renderSVal(DEFAULT_ATTENTION_THRESHOLDS.autoSyncFails);
    renderAttnCount(); toast('Needs-attention thresholds reset',{kind:'ok'});
  }}));
  attnFoot.append(attnCountEl);
  attn.append(attnFoot);
  renderAttnCount();
  wrap.append(attn);

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
  data.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'Everything lives in this browser. Export a JSON backup, import it elsewhere (replacing everything or merging in just the new rows), or reset to the seeded fleet.'}));
  const dataBtns=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('download')} Export JSON`, onclick:exportJSON}));
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('upload')} Import JSON`, onclick:()=>importJSON(ctx)}));
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('layers')} Merge JSON`, onclick:()=>mergeImportFile(ctx)}));
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
  const row=el('div',{class:'card field-row'});
  row.innerHTML=`<span class="qicon" style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand-b),var(--consensus));color:#05121a">${icon('sliders')}</span>`;
  const mid=el('div',{class:'field-row-mid'});
  mid.innerHTML=`<b>${escapeHtml(d.label)}</b> <span class="tiny mono muted">${escapeHtml(d.key)}</span>
    <div class="tiny muted">${escapeHtml(FIELD_TYPES[d.type]?.label||'Text')}${d.type==='select'&&d.options?.length?` · ${d.options.map(escapeHtml).join(', ')}`:''}</div>`;
  row.append(mid);
  const actions=el('div',{class:'field-row-actions'});
  actions.append(el('button',{class:'btn ghost icon sm', title:'Edit', 'aria-label':'Edit field', html:icon('edit'), onclick:()=>editFieldDef(d.id, onChange)}));
  actions.append(el('button',{class:'btn ghost icon sm', title:'Remove', 'aria-label':'Remove field', html:icon('trash'), onclick:async()=>{
    if(await confirmDialog('Remove field', `Remove "${d.label}" from the schema? Existing values stay on projects, but the field won’t appear in the editor, filters, or sort unless you re-add it.`, {danger:true, okLabel:'Remove'})){
      Store.removeFieldDef(d.id); toast('Field removed',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); onChange();
    }
  }}));
  row.append(actions);
  return row;
}

// Add/edit a field definition. Shared by Settings (schema management), the
// project editor ("+ New field" — define one without leaving the modal), and
// "Promote to field" (turns a legacy free-form value into a typed one, via
// `extra.prefill` + `extra.onAdded`).
export function editFieldDef(id, onChange, extra={}){
  const d = id ? Store.fieldDef(id) : null;
  const isNew = !d;
  const prefill = extra.prefill || {};
  const label=el('input',{class:'input', placeholder:'Owner', value:d?.label ?? prefill.label ?? ''});
  const type=el('select',{class:'input'});
  Object.entries(FIELD_TYPES).forEach(([k,t])=>type.append(el('option',{value:k,text:t.label})));
  type.value = d?.type || prefill.type || 'text';
  const options=el('input',{class:'input', placeholder:'small, medium, large', value:(d?.options||[]).join(', ')});
  const optionsField=el('div',{class:'field'}); optionsField.append(el('label',{text:'Options'}), options, el('span',{class:'tiny muted', text:'Comma-separated choices for a Select field.'}));
  optionsField.style.display = type.value==='select' ? '' : 'none';
  type.addEventListener('change',()=>{ optionsField.style.display = type.value==='select' ? '' : 'none'; });
  const f=(l,n,hint)=>{ const w=el('div',{class:'field'}); w.append(el('label',{text:l}), n); if(hint) w.append(el('span',{class:'tiny muted', text:hint})); return w; };
  const body=el('div');
  if(extra.note) body.append(el('div',{class:'tiny muted', style:'margin-bottom:10px', text:extra.note}));
  body.append(f('Name', label, 'Shown on the project editor, health panel, and library filters.'), f('Type', type), optionsField);
  const save=el('button',{class:'btn primary', text:extra.saveLabel || (isNew?'Add field':'Save changes'), onclick:()=>{
    const lbl=label.value.trim(); if(!lbl){ label.focus(); return; }
    const selectOpts=options.value.split(',').map(s=>s.trim()).filter(Boolean);
    try{
      const data={ label:lbl, type:type.value, options:type.value==='select'?selectOpts:[] };
      const saved = isNew ? Store.addFieldDef(data) : Store.updateFieldDef(id, data);
      hide(); toast(isNew?'Field added':'Field saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); onChange&&onChange(); extra.onAdded&&extra.onAdded(saved);
    }catch(e){ toast('Couldn’t save field',{body:e.message, kind:'err'}); }
  }});
  const {hide}=modal({ title:extra.title || (isNew?'Add custom field':'Edit custom field'), icon:'sliders', body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), save] });
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
    rd.onload=async()=>{
      const text=rd.result;
      let counts;
      try{ counts=Store.previewImport(text); }
      catch(e){ toast('Import failed',{body:e.message,kind:'err'}); return; }
      const summary=`This file has ${counts.projects} project${counts.projects===1?'':'s'}, `
        +`${counts.releases} release${counts.releases===1?'':'s'}, and ${counts.credentials} credential${counts.credentials===1?'':'s'}. `
        +`Importing replaces everything in this browser's Manager workspace right now — export a backup first if you want to keep it.`;
      const go=await confirmDialog('Import workspace', summary, {danger:true, okLabel:'Import & replace'});
      if(!go) return;
      try{ Store.importJSON(text); toast('Workspace imported',{kind:'ok'}); ctx.go('home'); }
      catch(e){ toast('Import failed',{body:e.message,kind:'err'}); }
    };
    rd.readAsText(file); };
  inp.click();
}
// "Merge" mode alongside importJSON()'s replace-everything mode: adds rows
// from the file that don't already exist here (by id) and leaves every
// existing row untouched — for combining a backup made in one browser into
// a different browser's workspace, rather than always overwriting it.
const MERGE_ROW_LABELS = { projects:'project', releases:'release', credentials:'credential', runs:'run', fieldDefs:'custom field', savedViews:'saved view' };
// Names one incoming row for the merge review list — the same "list what's
// new by name, not just a count" idea as the per-project sync preview (see
// `<b>v${e.v}</b> ${escapeHtml(e.title)}` in openSync(), views/project.js).
// `incomingProjects` is previewMerge()'s raw id->row map straight from the
// file, needed because a new release or credential's parent project might
// itself be new in this same file and so not yet resolvable via a live
// Store.get() lookup. Returns pre-escaped HTML, not plain text.
function mergeRowHtml(table, row, incomingProjects){
  const projectName = id => (Store.get('projects', id)||{}).name || (incomingProjects[id]||{}).name || id || '(no project)';
  switch(table){
    case 'projects': return escapeHtml(row.name || '(untitled project)');
    case 'releases': return `${escapeHtml(projectName(row.projectId))} — <b>v${escapeHtml(String(row.v||'?'))}</b> ${escapeHtml(row.title||'')}`;
    case 'credentials': return `${escapeHtml(row.scope==='global'?'Global':projectName(row.scope))} · ${escapeHtml(row.name||row.key||'(unnamed)')}`;
    case 'runs': return escapeHtml(row.note || `${row.mode||'run'} run`);
    case 'fieldDefs': return escapeHtml(row.label || '(untitled field)');
    case 'savedViews': return escapeHtml(row.label || '(untitled view)');
    default: return escapeHtml(row.id);
  }
}
// Fields hidden from the "would update" diff — bookkeeping the user never
// edits by hand, and would just be noise (`id` can't differ, it's the merge
// key; slug is derived from name and always moves with it).
const MERGE_DIFF_SKIP_KEYS = new Set(['id', 'createdAt', 'updatedAt', 'slug']);
function mergeDiffValueHtml(v){
  if(v==null || v==='') return '<i>(empty)</i>';
  const s = Array.isArray(v) ? (v.length ? v.join(', ') : '(empty)')
    : (typeof v==='object' ? JSON.stringify(v) : String(v));
  return escapeHtml(s.length>70 ? s.slice(0,69)+'…' : s);
}
// The field-by-field diff behind a merge-review "update" row: every top-level
// key present on either side whose value differs, local → incoming. Used
// purely for display — Store._rowsDiffer() (a stricter, key-order-safe
// compare) is what actually decided this row belongs in `updateRows` at all.
function mergeRowDiffHtml(local, incoming){
  const keys=[...new Set([...Object.keys(local), ...Object.keys(incoming)])].filter(k=>!MERGE_DIFF_SKIP_KEYS.has(k));
  const changed=keys.filter(k=>JSON.stringify(local[k])!==JSON.stringify(incoming[k]));
  if(!changed.length) return '';
  return `<div class="merge-diff">${changed.map(k=>
    `<div class="merge-diff-row"><b>${escapeHtml(k)}</b> ${mergeDiffValueHtml(local[k])} → ${mergeDiffValueHtml(incoming[k])}</div>`
  ).join('')}</div>`;
}
export function mergeImportFile(ctx){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange=()=>{ const file=inp.files[0]; if(!file) return; const rd=new FileReader();
    rd.onload=async()=>{
      const text=rd.result;
      let preview;
      try{ preview=Store.previewMerge(text); }
      catch(e){ toast('Merge failed',{body:e.message,kind:'err'}); return; }
      const { tables, projects:incomingProjects } = preview;
      let totalAdd=0, totalSkip=0, totalUpdate=0, totalRemove=0;
      const addParts=[];
      Object.entries(tables).forEach(([t,{add,skip,update,remove}])=>{
        totalAdd+=add; totalSkip+=skip; totalUpdate+=update; totalRemove+=remove;
        if(add) addParts.push(`${add} new ${MERGE_ROW_LABELS[t]}${add===1?'':'s'}`);
      });
      if(!totalAdd && !totalUpdate && !totalRemove){ toast('Nothing to merge — every row in that file already exists here and matches',{kind:'info'}); return; }

      const body=el('div');
      body.append(el('p',{class:'muted', text: addParts.length
        ? `This file has ${addParts.join(', ')}`
          +(totalSkip?` (plus ${totalSkip} row${totalSkip===1?'':'s'} identical to what's already here)`:'')
          +`. Merging adds the new rows — nothing already in this workspace is changed`
          +(totalUpdate||totalRemove?', unless you opt in below.':'.')
        : totalUpdate
          ? `Every row in this file already exists here — ${totalUpdate} of them differ from your copy.`
          : `Every row in this file already exists here and matches your copy.`}));

      // Opt-in: by default a merge only ever adds rows, never overwrites —
      // this checkbox is the one way to let it also refresh rows that exist
      // in both places but drifted apart (e.g. edited on one machine after a
      // backup was taken on another).
      let applyUpdates=false;
      if(totalUpdate){
        const updRow=el('label',{class:'merge-update-opt'});
        const cb=el('input',{type:'checkbox'});
        cb.onchange=()=>{ applyUpdates=cb.checked; ok.disabled = !(totalAdd || applyUpdates || applyRemoves); };
        updRow.append(cb, el('span',{text:`Also update ${totalUpdate} row${totalUpdate===1?'':'s'} that already exist here but differ from the file`}));
        body.append(updRow);
      }

      // A second, separately-styled opt-in for the destructive direction:
      // rows that exist here but whose id is missing from the file entirely.
      // Off by default — a partial export legitimately omits rows without
      // meaning "delete these" — this is only for someone doing a genuine
      // two-way sync where the file really is the full, current state of
      // both browsers.
      let applyRemoves=false;
      if(totalRemove){
        const rmRow=el('label',{class:'merge-update-opt merge-remove-opt'});
        const cb=el('input',{type:'checkbox'});
        cb.onchange=()=>{ applyRemoves=cb.checked; ok.disabled = !(totalAdd || applyUpdates || applyRemoves); ok.classList.toggle('danger', applyRemoves); };
        rmRow.append(cb, el('span',{text:`Also remove ${totalRemove} row${totalRemove===1?'':'s'} that exist here but aren't in the file`}));
        body.append(rmRow);
      }

      // A review step: expand to see exactly which rows are new (and, if any,
      // which would update or be removed, and how) by name, before
      // committing — not just a per-table count.
      const totalListed=totalAdd+totalUpdate+totalRemove;
      if(totalListed){
        const details=el('details',{class:'merge-review'});
        details.append(el('summary',{text:`Review the ${totalListed} row${totalListed===1?'':'s'} in this file`}));
        Object.entries(tables).forEach(([t,{add,rows,update,updateRows,remove,removeRows}])=>{
          if(add){
            details.append(el('div',{class:'merge-review-head', text:`${add} new ${MERGE_ROW_LABELS[t]}${add===1?'':'s'}`}));
            const list=el('ul',{class:'sync-preview'});
            rows.forEach(r=>list.append(el('li',{html:`<span class="tag sync-new">new</span><span>${mergeRowHtml(t,r,incomingProjects)}</span>`})));
            details.append(list);
          }
          if(update){
            details.append(el('div',{class:'merge-review-head', text:`${update} ${MERGE_ROW_LABELS[t]}${update===1?'':'s'} that would update`}));
            const list=el('ul',{class:'sync-preview'});
            updateRows.forEach(({local,incoming})=>list.append(el('li',{html:
              `<span class="tag sync-upd">update</span><span>${mergeRowHtml(t,incoming,incomingProjects)}${mergeRowDiffHtml(local,incoming)}</span>`
            })));
            details.append(list);
          }
          if(remove){
            details.append(el('div',{class:'merge-review-head', text:`${remove} ${MERGE_ROW_LABELS[t]}${remove===1?'':'s'} that would be removed`}));
            const list=el('ul',{class:'sync-preview'});
            removeRows.forEach(r=>list.append(el('li',{html:`<span class="tag sync-del">remove</span><span>${mergeRowHtml(t,r,incomingProjects)}</span>`})));
            details.append(list);
          }
        });
        body.append(details);
      }

      const ok=el('button',{class:'btn primary', text:'Merge in', disabled: !totalAdd});
      const cancel=el('button',{class:'btn', text:'Cancel'});
      const go=await new Promise(res=>{
        const {hide}=modal({ title:'Merge workspace', icon:'layers', body, foot:[cancel, ok] });
        ok.onclick=()=>{hide();res(true)}; cancel.onclick=()=>{hide();res(false)};
      });
      if(!go) return;
      try{
        const { added, updated, removed }=Store.mergeImport(text, { applyUpdates, applyRemoves });
        const parts=[]; if(added) parts.push(`${added} added`); if(updated) parts.push(`${updated} updated`); if(removed) parts.push(`${removed} removed`);
        toast('Merged workspace',{kind:'ok', body:parts.join(', '), action:{label:'Undo', fn:()=>Store.undo()}});
        ctx.go('home');
      }catch(e){ toast('Merge failed',{body:e.message,kind:'err'}); }
    };
    rd.readAsText(file); };
  inp.click();
}
