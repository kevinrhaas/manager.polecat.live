// Project detail — the full what's-new timeline + health panel + links.
import { projectStewardCard } from './fleetops.js';
import { Store, STATUSES, healthBand, statusPill, DEFAULT_HEALTH_WEIGHTS, DEFAULT_ATTENTION_THRESHOLDS, DEFAULT_AUTO_SYNC_BACKOFF_CAP } from '../store.js';
import { el, escapeHtml, fmtCT, ago, avatarColor, toast, modal, confirmDialog, sparkline, debounce, mdToHtml } from '../ui.js';
import { icon } from '../icons.js';
import { openProjectEditor } from './projects.js';
import { fetchChangelog, parseChangelogSource, guessChangelogUrl, forceSyncProject, attemptAutoSync } from '../ingest.js';

export function renderProject(root, ctx, params){
  const p = Store.project(params?.id);
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  if(!p){
    wrap.append(el('div',{class:'card empty', html:`${icon('grid')}<div>That project doesn’t exist. <a class="link" id="back">Back to library</a></div>`, onclick:e=>{ if(e.target.id==='back') ctx.go('projects'); }}));
    root.append(wrap); return;
  }
  const st=STATUSES[p.status]||STATUSES.idea;

  // back
  wrap.append(el('button',{class:'btn ghost sm', style:'margin-bottom:14px', html:`${icon('chevron')} Library`,
    onclick:()=>ctx.go('projects')}));

  // header
  const head=el('div',{class:'detail-head'});
  head.innerHTML=`<span class="tavatar" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2>${escapeHtml(p.name)}</h2>
        ${statusPill(p.status)}
      </div>
      <div class="tiny mono muted" style="margin-top:4px">${escapeHtml(p.repo||'')}</div>
      <p class="muted" style="margin:8px 0 0;max-width:60ch">${escapeHtml(p.assessment||p.description||'')}</p>
    </div>`;
  const acts=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  acts.append(el('button',{class:'pin-btn'+(p.pinned?' on':''), title:p.pinned?'Unpin':'Pin', 'aria-label':p.pinned?'Unpin':'Pin', html:icon('pin'),
    onclick:()=>{ Store.togglePin(p.id); ctx.go('project',{id:p.id}); }}));
  acts.append(el('button',{class:'btn sm', html:`${icon('edit')} Edit`, onclick:()=>openProjectEditor(p.id, ctx)}));
  head.append(acts);
  wrap.append(head);

  // link row
  const links=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 22px'});
  if(p.site) links.append(linkBtn(p.site,'globe','Open live site'));
  if(p.repo) links.append(linkBtn('https://github.com/'+p.repo,'branch','Repository'));
  if(p.sessionUrl) links.append(linkBtn(p.sessionUrl,'terminal','Claude Code session','session'));
  else links.append(el('button',{class:'linkbtn session', html:`${icon('terminal')} Link Claude Code session`, onclick:()=>openProjectEditor(p.id,ctx)}));
  wrap.append(links);

  // grid: timeline | side panel
  const grid=el('div',{class:'detail-grid'});

  // -- what's new timeline --
  const main=el('div');
  const th=el('div',{class:'section-title', style:'margin-top:0'});
  th.innerHTML=`<span style="color:var(--brand-b);display:inline-flex">${icon('sparkle')}</span><h2>What’s new</h2>`;
  th.append(el('span',{class:'sp'}));
  th.append(el('button',{class:'btn sm', html:`${icon('refresh')} Sync`, title:'Pull real releases from the project’s deployed changelog', onclick:()=>openSync(p, ctx)}));
  th.append(el('button',{class:'btn sm', html:`${icon('bolt')} Force sync`, title:'Fully reconcile local releases to the source — overwrites drifted rows and removes synced releases no longer published there', onclick:()=>runForceSync(p, ctx)}));
  th.append(el('button',{class:'btn sm primary', html:`${icon('plus')} Add release`, onclick:()=>addRelease(p.id, ctx)}));
  main.append(th);
  main.append(recommendedCallout(p, ctx));

  const rels=Store.releasesFor(p.id);
  if(!rels.length){
    main.append(el('div',{class:'card empty', html:`${icon('sparkle')}<div>No releases recorded yet.<br><span class="tiny">Add one to start this project’s what’s-new timeline.</span></div>`}));
  }else{
    main.append(timelineLegend());
    const tl=el('div',{class:'timeline'});
    rels.forEach(r=>tl.append(release(r, ctx)));
    main.append(tl);
  }
  grid.append(main);

  // -- side panel --
  const side=el('div');
  const health=el('div',{class:'card health'});
  const rel=Store.latestRelease(p.id);
  const score=Store.healthScore(p.id);
  const band=healthBand(score);
  const rows=[
    ['Status', statusPill(p.status)],
    ['Health score', `<span class="hchip ${band.cls}" title="Recency + release velocity + status">${score} · ${band.label}</span>`],
    ['Latest version', rel?`<span class="vchip mono">v${rel.v}</span>`:'—'],
    ['Last shipped', escapeHtml(fmtCT(Store.lastActivity(p.id)))],
    ['Releases', String(rels.length)],
    ['Cadence', escapeHtml(p.cadence||'—')],
    ['Tags', (p.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')||'—'],
    ['Changelog sync', p.lastSyncAt?`Synced ${escapeHtml(fmtCT(p.lastSyncAt))}`:'<span class="muted">Not connected</span>'],
  ];
  health.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Health</h2></div>`;
  rows.forEach(([k,v])=>{ const r=el('div',{class:'row'}); r.innerHTML=`<span class="k">${k}</span><span class="v">${v}</span>`; health.append(r); if(k==='Status'){ health.append(statusSourceRow(p, ctx)); } if(k==='Health score'){ health.append(weightingRow(p, ctx)); health.append(attentionRow(p, ctx)); } });
  const velRow=el('div',{class:'row'});
  velRow.innerHTML=`<span class="k">Velocity · 10w</span>`;
  velRow.append(el('span',{class:'v', title:'Releases per week, oldest to newest', html:sparkline(Store.releaseVelocity(p.id), {width:100, height:24, color:band.color})}));
  health.append(velRow);
  health.append(autoSyncRow(p, ctx));
  health.append(backoffRow(p, ctx));
  side.append(health);

  // custom metadata — typed per the fleet's field schema, plus any legacy
  // free-form values entered before that schema existed.
  const fieldDefs=Store.fieldDefs();
  const fieldEntries=[];
  fieldDefs.forEach(d=>{ const val=(p.fields||{})[d.key]; if(val!=null && val!=='') fieldEntries.push([d.label, formatFieldValue(d, val)]); });
  const defKeys=new Set(fieldDefs.map(d=>d.key));
  Object.entries(p.fields||{}).filter(([k,v])=>k&&v&&!defKeys.has(k)).forEach(([k,v])=>fieldEntries.push([k, escapeHtml(v)]));
  if(fieldEntries.length){
    const meta=el('div',{class:'card health', style:'margin-top:16px'});
    meta.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Metadata</h2></div>`;
    fieldEntries.forEach(([k,v])=>{ const r=el('div',{class:'row'}); r.innerHTML=`<span class="k">${escapeHtml(k)}</span><span class="v">${v}</span>`; meta.append(r); });
    side.append(meta);
  }
  // steward at a glance — this repo's open steward PRs + sweep findings
  const steward=projectStewardCard(p);
  if(steward) side.append(steward);
  grid.append(side);
  wrap.append(grid);
  wrap.append(notesSection(p, ctx));
  root.append(wrap);
}

// -------------------------------------------------------------------------
// Notes — a free-form Markdown scratchpad, separate from the curated
// description/assessment blurbs, for working context that doesn't fit
// either ("why this is paused", "next thing to try", a link to a design
// doc). Autosaves on pause rather than an explicit Save button, matching how
// the rest of the app treats edits as live; see Store.saveProjectNotes() for
// why that save deliberately skips the usual reactive re-render (it would
// steal the textarea's focus mid-keystroke). A capped revision trail
// (Store.notesHistoryFor()) gives undo-style safety without a new table.
// -------------------------------------------------------------------------
function notesSection(p, ctx){
  const wrap=el('div',{class:'card notes-card', style:'margin-top:22px'});
  const head=el('div',{class:'section-title', style:'margin-top:0'});
  head.innerHTML=`<span style="color:var(--brand-b);display:inline-flex">${icon('notes')}</span><h2>Notes</h2>`;
  head.append(el('span',{class:'sp'}));
  const status=el('span',{class:'tiny muted notes-status'});
  head.append(status);
  const modeBtn=el('button',{class:'btn ghost sm'});
  const histBtn=el('button',{class:'btn ghost sm', html:`${icon('clock')} History`, title:'View or restore an earlier version',
    onclick:()=>openNotesHistory(p, ctx)});
  histBtn.style.display = Store.notesHistoryFor(p.id).length ? '' : 'none';
  head.append(modeBtn, histBtn);
  wrap.append(head);

  const body=el('div',{class:'notes-body'});
  wrap.append(body);

  let mode = (p.notes||'').trim() ? 'preview' : 'edit';
  const textarea=el('textarea',{class:'input mono notes-editor', rows:'8',
    placeholder:'Free-form notes for this project — why it’s paused, what to try next, links to a design doc… Markdown supported, autosaves as you pause.',
    value:p.notes||''});

  function renderMode(){
    body.innerHTML='';
    if(mode==='edit'){
      body.append(textarea);
      modeBtn.innerHTML=`${icon('eye')} Preview`;
    }else{
      const html=mdToHtml(Store.project(p.id)?.notes||'');
      body.append(el('div',{class:'notes-md', html: html || '<p class="muted tiny">Nothing here yet — switch to Edit to start writing.</p>'}));
      modeBtn.innerHTML=`${icon('edit')} Edit`;
    }
  }
  modeBtn.addEventListener('click',()=>{ mode = mode==='edit'?'preview':'edit'; renderMode(); });
  renderMode();

  const doSave=debounce(()=>{
    const saved=Store.saveProjectNotes(p.id, textarea.value);
    if(saved){
      status.textContent='Saved just now';
      histBtn.style.display = Store.notesHistoryFor(p.id).length ? '' : 'none';
    }
  }, 800);
  textarea.addEventListener('input',()=>{ status.textContent='Saving…'; doSave(); });

  return wrap;
}

function openNotesHistory(p, ctx){
  const hist=Store.notesHistoryFor(p.id);
  const body=el('div');
  if(!hist.length){
    body.append(el('p',{class:'muted tiny', text:'No earlier versions yet — a snapshot is kept each time your notes change.'}));
  }else{
    const list=el('div',{class:'notes-hist-list'});
    hist.forEach(h=>{
      const row=el('div',{class:'notes-hist-row'});
      const preview=h.text.length>160 ? h.text.slice(0,160)+'…' : h.text;
      const mid=el('div',{class:'notes-hist-mid'});
      mid.innerHTML=`<div><b>${escapeHtml(fmtCT(h.ts))}</b> <span class="tiny muted">${escapeHtml(ago(h.ts))}</span></div>
        <div class="tiny muted notes-hist-preview">${escapeHtml(preview||'(empty)')}</div>`;
      row.append(mid, el('button',{class:'btn ghost sm', text:'Restore', onclick:()=>{
        Store.restoreProjectNotes(p.id, h.ts);
        hide();
        toast('Notes restored',{kind:'ok'});
        ctx.go('project',{id:p.id});
      }}));
      list.append(row);
    });
    body.append(list);
  }
  const {hide}=modal({ title:`Notes history — ${p.name}`, icon:icon('clock'), body });
}

// Status source + a Lock toggle. Sync derives status from release activity;
// locking a project pins its status so sync leaves it alone.
function statusSourceRow(p, ctx){
  const locked = !!p.statusLocked;
  const r=el('div',{class:'row'});
  r.innerHTML=`<span class="k">Status source</span>`;
  const v=el('span',{class:'v', style:'display:inline-flex;align-items:center;gap:8px;font-weight:400'});
  v.append(el('span',{class:'tiny muted', text: locked ? 'Locked — you set it' : (p.statusAuto ? 'Auto — from sync' : 'Manual') }));
  v.append(el('button',{class:'toggle'+(locked?' on':''), role:'switch', 'aria-checked':String(locked), 'aria-label':'Lock status against auto-updates from sync',
    title: locked ? 'Unlock — let sync update this status' : 'Lock — keep this status fixed when syncing',
    onclick:()=>{ Store.updateProject(p.id, { statusLocked:!locked }, { silent:true }); toast(locked?'Status unlocked — sync can update it':'Status locked',{kind:'ok'}); ctx.go('project',{id:p.id}); }}));
  r.append(v);
  return r;
}

function formatFieldValue(d, val){
  if(d.type==='url') return `<a class="link" href="${escapeHtml(val)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>`;
  if(d.type==='date'){ const t=Date.parse(val); return escapeHtml(isNaN(t)?val:fmtCT(t, {withTime:false})); }
  if(d.type==='select') return `<span class="tag">${escapeHtml(val)}</span>`;
  if(d.type==='number') return `<span class="mono">${escapeHtml(val)}</span>`;
  return escapeHtml(val);
}

// -------------------------------------------------------------------------
// Per-project "override the fleet default" plumbing — shared by every knob
// that's normally fleet-wide (Settings) but can be dialed in per-project for
// a deliberately different cadence: health weighting, needs-attention
// thresholds, and the auto-sync backoff cap. Each is a project-row toggle +
// N drag sliders that fall back to the live fleet default when off, with the
// dialed-in numbers persisting even while disabled so re-enabling restores
// them instead of resetting. A `cfg` describes one override: how to
// read/write it on the project row, its fleet defaults, and the sliders that
// edit it — see HEALTH_WEIGHTING_OVERRIDE / ATTENTION_THRESHOLDS_OVERRIDE /
// AUTO_SYNC_BACKOFF_OVERRIDE below.
// -------------------------------------------------------------------------
function overrideRow(p, ctx, cfg){
  const ov=cfg.getOverride(p.id);
  const r=el('div',{class:'row'});
  r.innerHTML=`<span class="k">${cfg.rowLabel}</span>`;
  const v=el('span',{class:'v', style:'display:inline-flex;align-items:center;gap:8px;font-weight:400'});
  if(ov.enabled){
    v.append(el('span',{class:'tiny muted', title:cfg.summaryTitle, text:`Custom · ${cfg.summary(cfg.getEffective(p.id))}`}));
  }else{
    v.append(el('span',{class:'tiny muted', text:'Fleet default'}));
  }
  v.append(el('button',{class:'btn ghost sm', text:'Customize', onclick:()=>openOverrideModal(p, ctx, cfg)}));
  r.append(v);
  return r;
}

function openOverrideModal(p, ctx, cfg){
  const ov=cfg.getOverride(p.id);
  const body=el('div');
  body.append(el('p',{class:'muted tiny', style:'margin:0 0 12px', text:cfg.description(p)}));

  const toggleRow=el('div',{class:'opt-row', style:'padding:0 0 14px'});
  toggleRow.innerHTML=`<div class="sp"><b>${escapeHtml(cfg.toggleLabel)}</b><p>Only affects ${escapeHtml(p.name)}.</p></div>`;
  const t=el('button',{class:'toggle'+(ov.enabled?' on':''), role:'switch', 'aria-checked':String(!!ov.enabled), 'aria-label':`${cfg.toggleLabel} for this project`});
  toggleRow.append(t);
  body.append(toggleRow);

  const fRow=el('div',{style:'display:flex;flex-direction:column;gap:12px'});
  const valEls={};
  const renderVals=()=>{
    const eff=cfg.getEffective(p.id);
    cfg.fields.forEach(f=>{ if(valEls[f.key]) valEls[f.key].textContent=f.format(eff[f.key]); });
  };
  cfg.fields.forEach(f=>{
    const cur=ov[f.key] ?? cfg.defaults[f.key];
    const row=el('div',{class:'field', style:'margin:0'});
    const head=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
    head.innerHTML=`<label style="margin:0">${escapeHtml(f.label)}</label><span class="tiny muted mono" style="min-width:${f.valueWidth||'34px'};text-align:right"></span>`;
    valEls[f.key]=head.lastElementChild;
    const slider=el('input',{type:'range', min:String(f.min), max:String(f.max), step:'1', value:String(cur), class:cfg.sliderClass, 'data-key':f.key});
    slider.addEventListener('input',()=>{ cfg.setOverride(p.id, { [f.key]:parseInt(slider.value,10) }); renderVals(); });
    row.append(head, slider, el('span',{class:'tiny muted', text:f.desc}));
    fRow.append(row);
  });
  fRow.style.opacity = ov.enabled?'1':'.45';
  fRow.style.pointerEvents = ov.enabled?'':'none';
  body.append(fRow);
  renderVals();

  t.addEventListener('click',()=>{
    const now=!t.classList.contains('on');
    t.classList.toggle('on', now); t.setAttribute('aria-checked',String(now));
    cfg.setOverride(p.id, { enabled:now });
    fRow.style.opacity = now?'1':'.45';
    fRow.style.pointerEvents = now?'':'none';
  });

  const resetBtn=el('button',{class:'btn sm', html:`${icon('refresh')} Reset to fleet default`, onclick:()=>{
    cfg.setOverride(p.id, { ...cfg.defaults });
    cfg.fields.forEach(f=>{ const s=fRow.querySelector(`[data-key="${f.key}"]`); if(s) s.value=String(cfg.defaults[f.key]); });
    renderVals(); toast(cfg.resetToast,{kind:'ok'});
  }});
  body.append(resetBtn);

  const {hide}=modal({ title:`${cfg.modalTitle} — ${p.name}`, icon:icon(cfg.modalIcon), body, foot:[el('button',{class:'btn primary', text:'Done', onclick:()=>{ hide(); ctx.go('project',{id:p.id}); }})] });
}

const HEALTH_WEIGHTING_OVERRIDE={
  rowLabel:'Weighting',
  summaryTitle:'Custom weighting for this project only',
  summary:w=>`R${Math.round(w.recency)}/V${Math.round(w.velocity)}/S${Math.round(w.status)}`,
  getOverride:id=>Store.projectHealthWeightsOverride(id),
  getEffective:id=>Store.healthWeightsFor(id),
  setOverride:(id,patch)=>Store.setProjectHealthWeights(id,patch),
  defaults:DEFAULT_HEALTH_WEIGHTS,
  toggleLabel:'Override fleet weighting',
  description:p=>`${p.name}’s health score uses the fleet-wide weighting from Settings by default. Turn this on to dial in different weights just for this project — for a cadence that's deliberately different from the fleet norm.`,
  modalTitle:'Health weighting', modalIcon:'gauge', sliderClass:'proj-weight-slider',
  resetToast:'Weighting reset to fleet default',
  fields:[
    { key:'recency', label:'Recency', desc:'How recently the project last shipped something.', min:0, max:100, format:v=>Math.round(v)+'%' },
    { key:'velocity', label:'Velocity', desc:'How many releases it’s shipped in the last 90 days.', min:0, max:100, format:v=>Math.round(v)+'%' },
    { key:'status', label:'Status', desc:'Live/active projects score higher than paused or archived ones.', min:0, max:100, format:v=>Math.round(v)+'%' },
  ],
};

const ATTENTION_THRESHOLDS_OVERRIDE={
  rowLabel:'Attention',
  summaryTitle:'Custom "needs attention" cutoffs for this project only',
  summary:t=>`<${t.healthMax} / ×${t.autoSyncFails}`,
  getOverride:id=>Store.projectAttentionThresholdsOverride(id),
  getEffective:id=>Store.attentionThresholdsFor(id),
  setOverride:(id,patch)=>Store.setProjectAttentionThresholds(id,patch),
  defaults:DEFAULT_ATTENTION_THRESHOLDS,
  toggleLabel:'Override fleet thresholds',
  description:p=>`${p.name} is flagged "needs attention" using the fleet-wide cutoffs from Settings by default. Turn this on to dial in a different health-score cutoff or auto-sync fail count just for this project.`,
  modalTitle:'Needs-attention thresholds', modalIcon:'warning', sliderClass:'proj-attn-slider',
  resetToast:'Thresholds reset to fleet default',
  fields:[
    { key:'healthMax', label:'Health score', desc:'Flag this project once its health score falls below this line.', min:1, max:100, valueWidth:'120px', format:v=>`below ${v} (${healthBand(Math.max(0,v-1)).label})` },
    { key:'autoSyncFails', label:'Auto-sync failures', desc:'Flag this project once its auto-sync has failed this many times in a row.', min:1, max:10, valueWidth:'70px', format:v=>`×${v} in a row` },
  ],
};

const AUTO_SYNC_BACKOFF_OVERRIDE={
  rowLabel:'Backoff cap',
  summaryTitle:'Custom auto-sync failure backoff cap for this project only',
  summary:t=>`${t.backoffCap}× max`,
  getOverride:id=>Store.projectAutoSyncBackoffCapOverride(id),
  getEffective:id=>({ backoffCap:Store.autoSyncBackoffCapFor(id) }),
  setOverride:(id,patch)=>Store.setProjectAutoSyncBackoffCap(id,patch),
  defaults:{ backoffCap:DEFAULT_AUTO_SYNC_BACKOFF_CAP },
  toggleLabel:'Override fleet backoff cap',
  description:p=>`${p.name}’s auto-sync retry backoff uses the fleet-wide cap from Settings by default — each consecutive failure doubles the wait, up to this many times the normal interval. Turn this on to dial in a different ceiling just for this project, e.g. a flakier source you'd rather retry sooner, or a fragile one you'd rather back off harder on.`,
  modalTitle:'Auto-sync backoff cap', modalIcon:'refresh', sliderClass:'proj-backoff-slider',
  resetToast:'Backoff cap reset to fleet default',
  fields:[
    { key:'backoffCap', label:'Backoff cap', desc:'How many times slower a repeatedly-failing sync is retried, at most.', min:1, max:64, valueWidth:'70px', format:v=>`${v}× max` },
  ],
};

function weightingRow(p, ctx){ return overrideRow(p, ctx, HEALTH_WEIGHTING_OVERRIDE); }
function attentionRow(p, ctx){ return overrideRow(p, ctx, ATTENTION_THRESHOLDS_OVERRIDE); }
function backoffRow(p, ctx){ return overrideRow(p, ctx, AUTO_SYNC_BACKOFF_OVERRIDE); }

// Per-project opt-in for the quiet, on-a-cadence auto-sync (also needs the
// global switch in Settings → Auto-sync). Toggling here never fires a fetch
// itself — it just marks the project eligible for the next scheduled pass.
// A source that keeps failing (dead site, CORS, 404) surfaces here instead of
// silently retrying forever in the background — see the tunable
// autoSyncFails threshold (Store.attentionThresholds(), Settings → Needs
// attention) and the backoff in ingest.js.
function autoSyncRow(p, ctx){
  const r=el('div',{class:'row'});
  r.innerHTML=`<span class="k">Auto-sync</span>`;
  const v=el('span',{class:'v', style:'display:inline-flex;align-items:center;gap:8px;font-weight:400'});
  const failCount=p.autoSyncFailCount||0;
  const failing = p.autoSync && failCount>=Store.attentionThresholdsFor(p.id).autoSyncFails;
  if(failing){
    v.append(el('span',{class:'fail-chip', title:`${p.autoSyncLastError||'Sync failed'} — last attempt ${fmtCT(p.lastAutoSyncAt)}. Retrying less often the longer it fails.`,
      html:`${icon('warning')} Failing ×${failCount}`}));
    v.append(el('button',{class:'btn ghost sm', text:'Retry now', onclick:async(e)=>{
      const btn=e.target; btn.disabled=true; btn.textContent='Retrying…';
      const res=await attemptAutoSync(p);
      if(res.status==='ok') toast('Auto-sync recovered', { kind:'ok', body:`${res.added} new, ${res.updated} updated.` });
      else toast('Still failing', { kind:'warn', body:res.message||res.reason||'Could not reach that source.' });
      ctx.go('project',{id:p.id});
    }}));
  }else{
    v.append(el('span',{class:'tiny muted', text: p.autoSync ? (p.lastAutoSyncAt?`Last ${fmtCT(p.lastAutoSyncAt)}`:'Due now') : 'Off'}));
  }
  v.append(el('button',{class:'toggle'+(p.autoSync?' on':''), role:'switch', 'aria-checked':String(!!p.autoSync), 'aria-label':'Auto-sync this project’s changelog',
    onclick:()=>{ Store.updateProject(p.id, { autoSync:!p.autoSync }, { silent:true }); ctx.go('project',{id:p.id}); }}));
  r.append(v);
  return r;
}

// Force sync: no preview — a full reconcile is deterministic (the source is
// the source of truth), so it's a fetch + confirm, not a fetch + pick-and-choose.
async function runForceSync(p, ctx){
  const url = p.changelogUrl || guessChangelogUrl(p.site);
  if(!url){ toast('Nothing to sync from', { kind:'warn', body:'Add a site or changelog URL from Edit first.' }); return; }
  const proceed = await confirmDialog({ title:'Force sync', message:`This fully reconciles ${p.name}’s releases to ${url} — any local edits to a matching version are overwritten, and previously-synced releases no longer published there are removed. Releases you added by hand are left alone.`, danger:true, okText:'Force sync' });
  if(!proceed) return;
  const res = await forceSyncProject(p);
  if(res.status==='ok'){
    toast(`Force synced ${p.name}`, { kind:'ok', body:`${res.added} added, ${res.updated} updated, ${res.removed} removed.` });
    ctx.go('project',{id:p.id});
  }else{
    toast('Force sync failed', { kind:'err', body: res.reason||res.message||'Could not reach that source.' });
  }
}

function linkBtn(href, ic, label, cls=''){
  return el('a',{class:'linkbtn '+cls, href, target:'_blank', rel:'noopener', html:`${icon(ic)} ${label}`});
}

// A gentle "this looks like a good stable stopping point" nudge — Manager's
// read on where the release history *settled* (a burst of features, then a
// stabilizing tail / a quiet pause / a round version). Purely advisory; the
// human decides what actually gets the milestone flag.
function recommendedCallout(p, ctx){
  const rec=Store.recommendedMilestone(p.id);
  if(!rec) return el('span',{style:'display:none'});
  const r=rec.release;
  const box=el('div',{class:'callout rec-milestone'});
  box.innerHTML=`<div class="rec-head">
      <span class="rec-ic">${icon('trophy')}</span>
      <div class="rec-lead">
        <div class="rec-title">Recommended release point <span class="rec-score" title="Manager's confidence this is a natural stable milestone (0–10)">${rec.score.toFixed(1)}</span></div>
        <div class="rec-sub"><span class="vchip mono">v${r.v}</span> ${escapeHtml(r.title||'Untitled release')} <span class="tiny muted">· ${escapeHtml(fmtCT(r.ts))}</span></div>
      </div>
    </div>
    ${rec.reasons.length?`<ul class="rec-why">${rec.reasons.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}`;
  // Dismiss (×): wave off this suggestion for good. It won't come back for the
  // same version, but a later stable point still can. Marking it as a milestone
  // also clears it (the recommender skips milestones), so either action ends it.
  const dismiss=el('button',{class:'btn ghost icon sm rec-dismiss', title:'Dismiss this suggestion', 'aria-label':`Dismiss the recommended release point v${r.v}`,
    html:icon('x'), onclick:()=>{ Store.dismissRecommendation(p.id, r.v); toast(`Recommendation for v${r.v} dismissed`,{kind:'ok'}); ctx.go('project',{id:p.id}); }});
  box.append(dismiss);
  const foot=el('div',{class:'rec-foot'});
  const mark=el('button',{class:'btn sm primary', html:`${icon('flag')} Mark as milestone`,
    onclick:()=>{ Store.setMilestone(r.id, true, 'Stable milestone'); toast(`v${r.v} marked as a milestone`,{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:p.id}); }});
  const jump=el('button',{class:'btn sm ghost', text:'Why this one?', title:'Manager weighs feature bursts, stabilizing fixes, quiet pauses, round versions and recency', onclick:()=>explainRecommendation(rec)});
  foot.append(mark, jump);
  box.append(foot);
  return box;
}

function explainRecommendation(rec){
  const r=rec.release;
  const body=el('div');
  body.innerHTML=`<p class="muted" style="margin-top:0">Manager looks for the shape of a natural “it’s done for now” point in a project’s release history — not just the newest version.</p>
    <div class="rec-detail"><b>v${r.v} · ${escapeHtml(r.title||'')}</b> scored <b>${rec.score.toFixed(1)}/10</b> because:</div>
    <ul>${rec.reasons.map(x=>`<li>${escapeHtml(x)}</li>`).join('')||'<li>it stands out against the surrounding releases</li>'}</ul>
    <p class="tiny muted">Signals weighed: a run of shipped features, a stabilizing tail of polish/fix releases after them, a quiet gap before the next change, round version numbers, and how recent it is. This is a suggestion — mark whichever release feels complete to you.</p>`;
  const {hide}=modal({ title:'Why this release point', icon:icon('trophy'), body, foot:[el('button',{class:'btn primary', text:'Got it', onclick:()=>hide()})] });
}

function toggleMilestone(r, ctx){
  if(r.milestone){
    Store.setMilestone(r.id, false);
    toast(`v${r.v} milestone removed`,{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}});
    ctx.go('project',{id:r.projectId});
    return;
  }
  const label=el('input',{class:'input', placeholder:'e.g. First stable release, 1.0, Public launch…', value:r.milestoneLabel||''});
  const f=el('div',{class:'field'}); f.append(el('label',{text:'Milestone label (optional)'}), label);
  const body=el('div'); body.append(el('p',{class:'muted', style:'margin-top:0', text:`Mark v${r.v} “${r.title||''}” as a major milestone — a stable point worth remembering across the fleet.`}), f);
  const save=el('button',{class:'btn primary', html:`${icon('flag')} Mark milestone`, onclick:()=>{
    Store.setMilestone(r.id, true, label.value.trim()); hide();
    toast(`v${r.v} marked as a milestone`,{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:r.projectId});
  }});
  const {hide}=modal({ title:'Mark milestone', icon:icon('flag'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), save] });
  setTimeout(()=>label.focus(),50);
}

// What each release "mark" means — one source of truth shared by the per-row
// tooltips and the timeline legend below, so a coloured dot / tag is never
// unexplained. `feature` carries no text tag (it's the default), so the dot
// colour + this legend are how you tell it apart.
const KIND_INFO = {
  feature: { label:'Feature', desc:'New content or a new mechanic — the project grew.' },
  polish:  { label:'Polish',  desc:'A refinement of something that already shipped.' },
  fix:     { label:'Fix',     desc:'A bug fix.' },
};

// A compact key explaining the timeline's dots, tags and badges. Sits between
// the "What's new" header and the list so the marks are self-documenting.
function timelineLegend(){
  const leg=el('div',{class:'wn-legend', role:'list', 'aria-label':'What the release marks mean'});
  ['feature','polish','fix'].forEach(k=>{
    const i=KIND_INFO[k];
    leg.append(el('span',{class:'wn-key', role:'listitem', title:i.desc, tabindex:'0',
      html:`<i class="wn-swatch ${k}"></i>${i.label}`}));
  });
  leg.append(el('span',{class:'wn-key', role:'listitem', title:'A release you marked as a stable milestone worth remembering.', tabindex:'0',
    html:`<span class="wn-key-ic ms">${icon('flag')}</span>Milestone`}));
  leg.append(el('span',{class:'wn-key', role:'listitem', title:'Pulled automatically from the project’s live, deployed changelog — not hand-entered.', tabindex:'0',
    html:`<span class="wn-key-ic">${icon('refresh')}</span>Synced`}));
  return leg;
}

function release(r, ctx){
  const kind=r.kind||'feature';
  const ki=KIND_INFO[kind]||KIND_INFO.feature;
  const item=el('div',{class:'tl-item '+kind+(r.milestone?' is-milestone':''), title:`${ki.label} — ${ki.desc}`});
  const head=el('div',{class:'tl-head'});
  head.innerHTML=`<span class="tl-badge" title="Version number">v${r.v}</span><b>${escapeHtml(r.title||'Untitled release')}</b>
    ${r.milestone?`<span class="ms-badge" title="${escapeHtml(r.milestoneLabel||'Marked milestone')}">${icon('flag')} ${escapeHtml(r.milestoneLabel||'Milestone')}</span>`:''}
    ${r.kind&&r.kind!=='feature'?`<span class="wn-kind" title="${escapeHtml(ki.label)} — ${escapeHtml(ki.desc)}">${escapeHtml(r.kind)}</span>`:''}
    ${r.source==='sync'?`<span class="tag sync-tag" title="Synced from the project’s live changelog${r.sourceUrl?` (${escapeHtml(r.sourceUrl)})`:''}">${icon('refresh')} synced</span>`:''}
    <span class="tl-when">${escapeHtml(fmtCT(r.ts))}</span>`;
  const actions=el('div',{class:'tl-actions', style:'margin-left:auto;display:inline-flex;gap:4px'});
  const flag=el('button',{class:'btn ghost icon sm'+(r.milestone?' active':''), title:r.milestone?'Unmark milestone':'Mark as major milestone',
    'aria-label':r.milestone?'Unmark milestone':'Mark milestone', html:icon('flag'),
    onclick:()=>toggleMilestone(r, ctx)});
  const edit=el('button',{class:'btn ghost icon sm', title:'Edit release', 'aria-label':'Edit release', html:icon('edit'),
    onclick:()=>addRelease(r.projectId, ctx, r)});
  actions.append(flag, edit);
  head.append(actions);
  item.append(head);
  if(r.items?.length){
    const ul=el('ul'); r.items.forEach(i=>ul.append(el('li',{text:i}))); item.append(ul);
  }
  return item;
}

// add or edit a release
function addRelease(projectId, ctx, existing){
  const isNew=!existing;
  const next=(Store.latestRelease(projectId)?.v||0)+1;
  const v=el('input',{class:'input mono', style:'max-width:120px', value:existing?existing.v:next, type:'number', min:'0'});
  const title=el('input',{class:'input', placeholder:'What changed, in a few words', value:existing?.title||''});
  const kind=el('select',{class:'input', style:'max-width:150px'});
  [['feature','Feature'],['polish','Polish'],['fix','Fix']].forEach(([k,t])=>kind.append(el('option',{value:k,text:t,selected:existing?.kind===k})));
  const items=el('textarea',{class:'input', rows:'5', placeholder:'One bullet per line…', value:(existing?.items||[]).join('\n')});
  const body=el('div');
  const row=el('div',{style:'display:flex;gap:14px;flex-wrap:wrap'});
  const vf=el('div',{class:'field'}); vf.append(el('label',{text:'Version'}), v);
  const kf=el('div',{class:'field'}); kf.append(el('label',{text:'Kind'}), kind);
  row.append(vf,kf);
  const tf=el('div',{class:'field'}); tf.append(el('label',{text:'Title'}), title);
  const itf=el('div',{class:'field'}); itf.append(el('label',{text:'Details (one per line)'}), items);
  body.append(row, tf, itf);

  const save=el('button',{class:'btn primary', text:isNew?'Add release':'Save', onclick:()=>{
    const t=title.value.trim(); if(!t){ title.focus(); return; }
    const data={ v:parseInt(v.value,10)||next, title:t, kind:kind.value,
      items:items.value.split('\n').map(s=>s.trim()).filter(Boolean) };
    if(isNew) Store.addRelease(projectId, data);
    else Store.put('releases', { ...existing, ...data }, { label:'Edit release' });
    hide(); toast(isNew?'Release added':'Release saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:projectId});
  }});
  const foot=[ el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}) ];
  if(!isNew) foot.unshift(el('button',{class:'btn danger', html:`${icon('trash')} Delete`, onclick:async()=>{
    if(await confirmDialog({ title:'Delete release', message:`Remove v${existing.v} "${existing.title}"?`, danger:true, okText:'Delete' })){
      Store.remove('releases', existing.id); hide(); toast('Release deleted',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:projectId});
    }
  }}));
  foot.push(save);
  const {hide}=modal({ title:isNew?'Add release':'Edit release', icon:icon('sparkle'), body, foot });
  setTimeout(()=>title.focus(),50);
}

// -------------------------------------------------------------------------
// Live "what's new" ingestion — pull a project's real changelog from its
// deployed site (js/changelog.js by convention across this fleet). Never
// executes remote code: the source text is parsed as data only. Cross-origin
// fetches are often blocked by CORS, so on failure we offer a paste-in
// fallback — copy the file from a tab you opened yourself, paste it here.
// -------------------------------------------------------------------------
function openSync(p, ctx){
  const urlInput=el('input',{class:'input mono', placeholder:'https://relay.polecat.live/js/changelog.js', value:p.changelogUrl||guessChangelogUrl(p.site)});
  const status=el('div',{class:'tiny muted', style:'margin-top:10px'});
  const results=el('div');
  const pasteWrap=el('div',{style:'display:none;margin-top:12px'});
  const pasteArea=el('textarea',{class:'input mono', rows:'6', placeholder:'…paste the raw contents of changelog.js here…'});
  pasteWrap.append(
    el('div',{class:'tiny muted', style:'margin-bottom:6px', text:'Couldn’t fetch automatically — that’s usually a CORS restriction on the source site, not a bug. Open the URL above in a new tab, copy the file’s contents, and paste them here:'}),
    pasteArea,
    el('button',{class:'btn sm', style:'margin-top:8px', text:'Parse pasted content', onclick:()=>{
      try{ onParsed(parseChangelogSource(pasteArea.value), urlInput.value.trim()); }
      catch(e){ status.innerHTML=`<span class="sync-err">Couldn’t parse that: ${escapeHtml(e.message)}</span>`; }
    }}),
  );

  let pending=null;
  function setImportEnabled(n){ importBtn.disabled = !n; importBtn.textContent = n?`Import ${n} release${n===1?'':'s'}`:'Import'; }

  function onParsed(entries, url){
    const existing=new Map(Store.releasesFor(p.id).map(r=>[r.v,r]));
    const fresh=entries.filter(e=>!existing.has(e.v));
    const changed=entries.filter(e=>{ const ex=existing.get(e.v); return ex && (ex.title!==e.title || JSON.stringify(ex.items)!==JSON.stringify(e.items)); });
    results.innerHTML=''; pasteWrap.style.display='none';
    if(!fresh.length && !changed.length){
      status.textContent=`Fetched ${entries.length} release${entries.length===1?'':'s'} — already up to date.`;
      setImportEnabled(0); pending=null; return;
    }
    status.textContent=`Found ${entries.length} release${entries.length===1?'':'s'} — ${fresh.length} new, ${changed.length} updated.`;
    const list=el('ul',{class:'sync-preview'});
    fresh.forEach(e=>list.append(el('li',{html:`<span class="tag sync-new">new</span><span><b>v${e.v}</b> ${escapeHtml(e.title)}</span>`})));
    changed.forEach(e=>list.append(el('li',{html:`<span class="tag sync-upd">update</span><span><b>v${e.v}</b> ${escapeHtml(e.title)}</span>`})));
    results.append(list);
    pending={ entries, url };
    setImportEnabled(fresh.length+changed.length);
  }

  async function runFetch(){
    const url=urlInput.value.trim();
    if(!url){ urlInput.focus(); return; }
    status.textContent='Fetching…'; results.innerHTML=''; pasteWrap.style.display='none'; setImportEnabled(0); pending=null;
    try{ onParsed(await fetchChangelog(url), url); }
    catch(e){ status.innerHTML=`<span class="sync-err">Couldn’t load that automatically (${escapeHtml(e.message)}).</span>`; pasteWrap.style.display='block'; }
  }

  const fetchBtn=el('button',{class:'btn sm primary', html:`${icon('refresh')} Fetch`, onclick:runFetch});
  const importBtn=el('button',{class:'btn primary', text:'Import', disabled:true, onclick:()=>{
    if(!pending) return;
    const { added, updated }=Store.syncReleases(p.id, pending.entries, pending.url);
    hide();
    toast(`Synced ${p.name}`,{kind:'ok', body:`${added} added, ${updated} updated.`});
    ctx.go('project',{id:p.id});
  }});

  const body=el('div');
  body.append(
    el('div',{class:'field'},[el('label',{text:'Changelog URL'}), urlInput,
      el('span',{class:'tiny muted', text:'A raw JS or JSON file exposing a CHANGELOG array — the convention every project in this fleet publishes at js/changelog.js.'})]),
    el('div',{style:'display:flex;gap:8px'},[fetchBtn]),
    status, results, pasteWrap,
  );
  const {hide}=modal({ title:'Sync changelog', icon:icon('refresh'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), importBtn] });
  setTimeout(()=>{ urlInput.focus(); urlInput.select(); }, 60);
}
