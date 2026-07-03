// Project detail — the full what's-new timeline + health panel + links.
import { Store, STATUSES, healthBand, DEFAULT_HEALTH_WEIGHTS } from '../store.js';
import { el, escapeHtml, fmtCT, ago, avatarColor, toast, modal, confirmDialog, sparkline } from '../ui.js';
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
        <span class="status ${st.cls}"><span class="dot"></span>${st.label}</span>
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

  const rels=Store.releasesFor(p.id);
  if(!rels.length){
    main.append(el('div',{class:'card empty', html:`${icon('sparkle')}<div>No releases recorded yet.<br><span class="tiny">Add one to start this project’s what’s-new timeline.</span></div>`}));
  }else{
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
    ['Status', `<span class="status ${st.cls}"><span class="dot"></span>${st.label}</span>`],
    ['Health score', `<span class="hchip ${band.cls}" title="Recency + release velocity + status">${score} · ${band.label}</span>`],
    ['Latest version', rel?`<span class="vchip mono">v${rel.v}</span>`:'—'],
    ['Last shipped', escapeHtml(fmtCT(Store.lastActivity(p.id)))],
    ['Releases', String(rels.length)],
    ['Cadence', escapeHtml(p.cadence||'—')],
    ['Tags', (p.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')||'—'],
    ['Changelog sync', p.lastSyncAt?`Synced ${escapeHtml(fmtCT(p.lastSyncAt))}`:'<span class="muted">Not connected</span>'],
  ];
  health.innerHTML=`<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Health</h2></div>`;
  rows.forEach(([k,v])=>{ const r=el('div',{class:'row'}); r.innerHTML=`<span class="k">${k}</span><span class="v">${v}</span>`; health.append(r); if(k==='Health score') health.append(weightingRow(p, ctx)); });
  const velRow=el('div',{class:'row'});
  velRow.innerHTML=`<span class="k">Velocity · 10w</span>`;
  velRow.append(el('span',{class:'v', title:'Releases per week, oldest to newest', html:sparkline(Store.releaseVelocity(p.id), {width:100, height:24, color:band.color})}));
  health.append(velRow);
  health.append(autoSyncRow(p, ctx));
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
  grid.append(side);
  wrap.append(grid);
  root.append(wrap);
}

function formatFieldValue(d, val){
  if(d.type==='url') return `<a class="link" href="${escapeHtml(val)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>`;
  if(d.type==='date'){ const t=Date.parse(val); return escapeHtml(isNaN(t)?val:fmtCT(t, {withTime:false})); }
  if(d.type==='select') return `<span class="tag">${escapeHtml(val)}</span>`;
  if(d.type==='number') return `<span class="mono">${escapeHtml(val)}</span>`;
  return escapeHtml(val);
}

// Every project's health score normally rides the fleet-wide weighting from
// Settings → "Fleet health weighting" — but the rare project on a
// deliberately different cadence (e.g. one that should never be marked down
// just for shipping slowly) can override just its own three dimensions.
// This row shows which mode is active; the modal it opens is where that gets
// dialed in, scoped to this project only.
function weightingRow(p, ctx){
  const ov=Store.projectHealthWeightsOverride(p.id);
  const r=el('div',{class:'row'});
  r.innerHTML=`<span class="k">Weighting</span>`;
  const v=el('span',{class:'v', style:'display:inline-flex;align-items:center;gap:8px;font-weight:400'});
  if(ov.enabled){
    const w=Store.healthWeightsFor(p.id);
    v.append(el('span',{class:'tiny muted', title:'Custom weighting for this project only', text:`Custom · R${Math.round(w.recency)}/V${Math.round(w.velocity)}/S${Math.round(w.status)}`}));
  }else{
    v.append(el('span',{class:'tiny muted', text:'Fleet default'}));
  }
  v.append(el('button',{class:'btn ghost sm', text:'Customize', onclick:()=>openHealthWeightingModal(p, ctx)}));
  r.append(v);
  return r;
}

// Per-project override of the fleet health weighting — same three sliders as
// Settings → "Fleet health weighting", scoped to just this project. Disabled
// (the default) falls straight back to the live fleet-wide weights; the
// dialed-in numbers persist even while disabled, so flipping it back on
// restores what was there rather than resetting to the shipped default.
function openHealthWeightingModal(p, ctx){
  const ov=Store.projectHealthWeightsOverride(p.id);
  const body=el('div');
  body.append(el('p',{class:'muted tiny', style:'margin:0 0 12px', text:`${p.name}’s health score uses the fleet-wide weighting from Settings by default. Turn this on to dial in different weights just for this project — for a cadence that's deliberately different from the fleet norm.`}));

  const toggleRow=el('div',{class:'opt-row', style:'padding:0 0 14px'});
  toggleRow.innerHTML=`<div class="sp"><b>Override fleet weighting</b><p>Only affects ${escapeHtml(p.name)}.</p></div>`;
  const t=el('button',{class:'toggle'+(ov.enabled?' on':''), role:'switch', 'aria-checked':String(!!ov.enabled), 'aria-label':'Override fleet weighting for this project'});
  toggleRow.append(t);
  body.append(toggleRow);

  const wRow=el('div',{style:'display:flex;flex-direction:column;gap:12px'});
  const dims=[['recency','Recency','How recently the project last shipped something.'],['velocity','Velocity','How many releases it’s shipped in the last 90 days.'],['status','Status','Live/active projects score higher than paused or archived ones.']];
  const pctEls={};
  const renderPcts=()=>{
    const norm=Store.healthWeightsFor(p.id);
    dims.forEach(([k])=>{ if(pctEls[k]) pctEls[k].textContent=Math.round(norm[k])+'%'; });
  };
  dims.forEach(([k,label,desc])=>{
    const cur=ov[k] ?? DEFAULT_HEALTH_WEIGHTS[k];
    const row=el('div',{class:'field', style:'margin:0'});
    const head=el('div',{style:'display:flex;justify-content:space-between;align-items:baseline;gap:8px'});
    head.innerHTML=`<label style="margin:0">${escapeHtml(label)}</label><span class="tiny muted mono" style="min-width:34px;text-align:right"></span>`;
    const pctEl=head.lastElementChild; pctEls[k]=pctEl;
    const slider=el('input',{type:'range', min:'0', max:'100', step:'1', value:String(cur), class:'proj-weight-slider', 'data-dim':k});
    slider.addEventListener('input',()=>{ Store.setProjectHealthWeights(p.id, { [k]:parseInt(slider.value,10) }); renderPcts(); });
    row.append(head, slider, el('span',{class:'tiny muted', text:desc}));
    wRow.append(row);
  });
  wRow.style.opacity = ov.enabled?'1':'.45';
  wRow.style.pointerEvents = ov.enabled?'':'none';
  body.append(wRow);
  renderPcts();

  t.addEventListener('click',()=>{
    const now=!t.classList.contains('on');
    t.classList.toggle('on', now); t.setAttribute('aria-checked',String(now));
    Store.setProjectHealthWeights(p.id, { enabled:now });
    wRow.style.opacity = now?'1':'.45';
    wRow.style.pointerEvents = now?'':'none';
  });

  const resetBtn=el('button',{class:'btn sm', html:`${icon('refresh')} Reset to fleet default`, onclick:()=>{
    Store.setProjectHealthWeights(p.id, { ...DEFAULT_HEALTH_WEIGHTS });
    dims.forEach(([k])=>{ const s=wRow.querySelector(`[data-dim="${k}"]`); if(s) s.value=String(DEFAULT_HEALTH_WEIGHTS[k]); });
    renderPcts(); toast('Weighting reset to fleet default',{kind:'ok'});
  }});
  body.append(resetBtn);

  const {hide}=modal({ title:`Health weighting — ${p.name}`, icon:'gauge', body, foot:[el('button',{class:'btn primary', text:'Done', onclick:()=>{ hide(); ctx.go('project',{id:p.id}); }})] });
}

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
  const failing = p.autoSync && failCount>=Store.attentionThresholds().autoSyncFails;
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
  const proceed = await confirmDialog('Force sync', `This fully reconciles ${p.name}’s releases to ${url} — any local edits to a matching version are overwritten, and previously-synced releases no longer published there are removed. Releases you added by hand are left alone.`, { danger:true, okLabel:'Force sync' });
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

function release(r, ctx){
  const item=el('div',{class:'tl-item '+(r.kind||'feature')});
  const head=el('div',{class:'tl-head'});
  head.innerHTML=`<span class="tl-badge">v${r.v}</span><b>${escapeHtml(r.title||'Untitled release')}</b>
    ${r.kind&&r.kind!=='feature'?`<span class="wn-kind">${escapeHtml(r.kind)}</span>`:''}
    ${r.source==='sync'?`<span class="tag sync-tag" title="Synced from ${escapeHtml(r.sourceUrl||'')}">${icon('refresh')} synced</span>`:''}
    <span class="tl-when">${escapeHtml(fmtCT(r.ts))}</span>`;
  const edit=el('button',{class:'btn ghost icon sm', title:'Edit release', 'aria-label':'Edit release', html:icon('edit'),
    style:'margin-left:auto', onclick:()=>addRelease(r.projectId, ctx, r)});
  head.append(edit);
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
    if(await confirmDialog('Delete release', `Remove v${existing.v} "${existing.title}"?`, {danger:true, okLabel:'Delete'})){
      Store.remove('releases', existing.id); hide(); toast('Release deleted',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('project',{id:projectId});
    }
  }}));
  foot.push(save);
  const {hide}=modal({ title:isNew?'Add release':'Edit release', icon:'sparkle', body, foot });
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
    fresh.forEach(e=>list.append(el('li',{html:`<span class="tag sync-new">new</span><b>v${e.v}</b> ${escapeHtml(e.title)}`})));
    changed.forEach(e=>list.append(el('li',{html:`<span class="tag sync-upd">update</span><b>v${e.v}</b> ${escapeHtml(e.title)}`})));
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
  const {hide}=modal({ title:'Sync changelog', icon:'refresh', body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), importBtn] });
  setTimeout(()=>{ urlInput.focus(); urlInput.select(); }, 60);
}
