// Dashboard — a live wall of project tiles + fleet stats + quick actions.
import { Store, STATUSES, healthBand } from '../store.js';
import { el, escapeHtml, fmtCT, ago, avatarColor, toast, modal, confirmDialog, sparkline } from '../ui.js';
import { icon } from '../icons.js';
import { openProjectEditor } from './projects.js';
import { syncProject, forceSyncProject, attemptAutoSync } from '../ingest.js';

function greeting(){
  const h = new Date().toLocaleString('en-US',{ timeZone:'America/Chicago', hour:'numeric', hour12:false });
  const n = parseInt(h,10);
  return n<5?'Still up':n<12?'Good morning':n<18?'Good afternoon':'Good evening';
}

export function renderHome(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const projects=Store.projects();
  const live=projects.filter(p=>p.status==='live').length;
  const active=projects.filter(p=>['live','building','active'].includes(p.status)).length;
  const feat=Store.featureCount();
  const untilSweep=(5-(feat%5))%5===0?0:(5-(feat%5));
  const rel7=Store.all('releases').filter(r=>r.ts && (Date.now()-+new Date(r.ts))<7*86400000).length;
  const scores=projects.map(p=>Store.healthScore(p.id));
  const fleetScore=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  const fleetBand=healthBand(fleetScore);

  // hero
  const hero=el('div',{style:'margin-bottom:20px'});
  hero.innerHTML=`<h1 style="margin:0 0 4px;font-size:26px;letter-spacing:-.4px">${greeting()}, Commander.</h1>
    <p class="muted" style="margin:0;font-size:14px">Your fleet has <b style="color:var(--text)">${projects.length}</b> project${projects.length!==1?'s':''} — ${active} active, ${live} live. Everything below updates the moment it changes.</p>`;
  wrap.append(hero);

  // needs attention — a callout roll-up of the same health/auto-sync signals
  // that already show as passive badges on each tile, so a slipping project
  // never gets lost in a big grid. Dismissed rows (see attentionRow) drop out
  // of this active set even though the underlying condition may still hold —
  // Store.dismissedAttention() is how they stay reachable again.
  const attn=Store.needsAttentionActive();
  const dismissedCount=Store.dismissedAttention().length;
  if(attn.length || dismissedCount) wrap.append(attentionPanel(attn, dismissedCount, ctx));

  // stats
  const stats=el('div',{class:'grid stats'});
  const stat=(k,v,d,color,ic)=>{ const c=el('div',{class:'card stat'}); c.innerHTML=
    `<div class="glow" style="background:radial-gradient(circle,${color},transparent 70%)"></div>
     <div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div>`; return c; };
  stats.append(
    stat('Projects', projects.length, `${projects.filter(p=>p.pinned).length} pinned`, 'var(--brand-b)'),
    stat('Live now', live, 'shipping to production', 'var(--success)'),
    stat('Shipped · 7d', rel7, 'releases across the fleet', 'var(--consensus)'),
    stat('Feature runs', feat, untilSweep===0?'sweep is next ✦':`${untilSweep} until next sweep`, 'var(--brand-c)'),
    stat('Fleet health', fleetScore, `${fleetBand.label} · avg across ${projects.length}`, fleetBand.color),
  );
  wrap.append(stats);

  // pinned / all tiles
  const pinned=projects.filter(p=>p.pinned).sort((a,b)=>Store.lastActivity(b.id)-Store.lastActivity(a.id));
  const rest=projects.filter(p=>!p.pinned).sort((a,b)=>Store.lastActivity(b.id)-Store.lastActivity(a.id));

  if(pinned.length){
    wrap.append(sectionTitle('Pinned', 'pin'));
    const g=el('div',{class:'grid tiles'}); pinned.forEach(p=>g.append(tile(p,ctx))); wrap.append(g);
  }
  wrap.append(sectionTitle(pinned.length?'Everything else':'Your fleet', 'grid', el('button',{class:'btn sm', html:`${icon('plus')} Add project`, onclick:()=>openProjectEditor(null,ctx)})));
  const g2=el('div',{class:'grid tiles'});
  (rest.length?rest:projects).forEach(p=>g2.append(tile(p,ctx)));
  if(!projects.length) g2.append(el('div',{class:'card empty', html:`${icon('grid')}<div>No projects yet — add your first.</div>`}));
  wrap.append(g2);

  // quick actions
  wrap.append(sectionTitle('Quick actions', 'bolt'));
  const qa=el('div',{class:'grid quick'});
  const act=(ic,color,title,desc,fn)=>{ const c=el('div',{class:'card qa hover', onclick:fn});
    c.innerHTML=`<div class="qicon" style="background:${color}">${icon(ic)}</div><div><b>${title}</b><p>${desc}</p></div>`; return c; };
  const syncable=projects.filter(p=>p.changelogUrl||p.site).length;
  const autoCfg=Store.settings().autoSync||{};
  const autoOn=projects.filter(p=>p.autoSync).length;
  qa.append(
    act('plus','linear-gradient(135deg,var(--brand-b),var(--consensus))','Add a project','Track a new repo or site in the fleet.',()=>openProjectEditor(null,ctx)),
    act('grid','linear-gradient(135deg,var(--consensus),#7c3aed)','Open the library','Filter, sort, and edit every project.',()=>ctx.go('projects')),
    act('refresh','linear-gradient(135deg,#0891b2,var(--brand-b))','Sync all', syncable?`Pull real changelogs for all ${syncable} synced project${syncable===1?'':'s'} in one pass.${autoCfg.enabled?` Auto-sync is on for ${autoOn} project${autoOn===1?'':'s'} (every ${autoCfg.intervalHours||6}h).`:''}`:'Add a site or changelog URL to a project to enable this.', ()=>openSyncAll(ctx)),
    act('bolt','linear-gradient(135deg,var(--warning),var(--danger))','Force sync all', syncable?'Fully reconcile every synced project to its source — overwrites drifted rows.':'Add a site or changelog URL to a project to enable this.', ()=>openForceSyncAll(ctx)),
    act('book','linear-gradient(135deg,var(--brand-a),var(--brand-b))','Read the docs','New here? Start with the guide.',()=>ctx.go('docs')),
    act('sparkle','linear-gradient(135deg,var(--brand-c),#65a30d)','What’s new','See what shipped in Manager.',()=>ctx.openWhatsNew()),
  );
  wrap.append(qa);

  root.append(wrap);
}

// -------------------------------------------------------------------------
// Needs-attention callout — a dashboard-level roll-up of every project whose
// health has slipped or whose auto-sync is failing, worst-off first, with a
// one-click jump to the project and (when it's a sync failure) a "Retry now"
// right in the row. Built from Store.needsAttentionActive() — the same set
// the bell and the rail badge count — so a row a user has dismissed (see
// attentionRow below) drops out here too, even while the raw condition
// persists; the library's "Needs attention" saved view is the one surface
// that still shows the full Store.needsAttention() picture, dismissed or not.
// -------------------------------------------------------------------------
function attentionPanel(attn, dismissedCount, ctx){
  const panel=el('div',{class:'card attn-panel', style:'margin-bottom:20px'});
  const head=el('div',{class:'section-title', style:'margin:0 0 6px'});
  head.innerHTML=`<span style="color:var(--danger);display:inline-flex">${icon('warning')}</span><h2>Needs attention</h2>`;
  head.append(el('span',{class:'sp'}));
  if(dismissedCount) head.append(el('button',{class:'linkbtn tiny', html:`${icon('eyeOff')} ${dismissedCount} dismissed`,
    title:'Review or restore what you’ve dismissed', onclick:()=>openDismissedModal(ctx)}));
  if(attn.length) head.append(el('span',{class:'tiny muted', text:`${attn.length} project${attn.length===1?'':'s'}`}));
  panel.append(head);
  if(attn.length) attn.forEach(a=>panel.append(attentionRow(a, ctx)));
  else panel.append(el('div',{class:'notif-pop-empty', style:'padding:16px 4px', html:`${icon('check')}<span>Everything hot right now is already dismissed.</span>`}));
  return panel;
}

export function attentionRow(a, ctx){
  const {project:p, band, reasons}=a;
  const row=el('div',{class:'attn-row', onclick:()=>ctx.go('project',{id:p.id})});
  row.innerHTML=`<span class="aavatar" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
    <span class="aname">${escapeHtml(p.name)}</span>`;
  const reasonsWrap=el('span',{class:'areasons'});
  reasons.forEach(r=>{
    if(r.kind==='health') reasonsWrap.append(el('span',{class:`hchip ${band.cls}`, html:`${icon('activity')} ${escapeHtml(r.text)}`}));
    else reasonsWrap.append(el('span',{class:'fail-chip', title:p.autoSyncLastError||'', html:`${icon('warning')} ${escapeHtml(r.text)}`}));
  });
  row.append(reasonsWrap);
  const actions=el('span',{class:'aactions'});
  if(reasons.some(r=>r.kind==='sync')){
    actions.append(el('button',{class:'linkbtn stopnav', html:`${icon('refresh')} Retry now`, onclick:async(e)=>{
      e.stopPropagation();
      const btn=e.currentTarget; btn.disabled=true; btn.textContent='Retrying…';
      const res=await attemptAutoSync(p);
      if(res.status==='ok') toast('Auto-sync recovered', { kind:'ok', body:`${p.name}: ${res.added} new, ${res.updated} updated.` });
      else toast('Still failing', { kind:'warn', body:res.message||res.reason||'Could not reach that source.' });
      ctx.go('home');
    }}));
  }
  actions.append(el('button',{class:'linkbtn stopnav', html:`${icon('chevron')} Open`, onclick:(e)=>{ e.stopPropagation(); ctx.go('project',{id:p.id}); }}));
  // Dismiss — mark this exact set of reasons as "seen" so it stops pinging
  // the bell/rail badge/dashboard callout, without requiring it to actually
  // be fixed first. If the reasons change (new or worsened problem), the
  // dismissal no longer matches and the row comes right back.
  actions.append(el('button',{class:'linkbtn stopnav', title:'Dismiss — stop notifying about this until it changes', html:`${icon('eyeOff')} Dismiss`, onclick:(e)=>{
    e.stopPropagation();
    Store.dismissAttention(a);
    toast('Dismissed', { kind:'info', body:`${p.name} won’t notify again unless the reason changes.`,
      action:{ label:'Undo', fn:()=>Store.undismissAttention(p.id) } });
  }}));
  row.append(actions);
  return row;
}

// -------------------------------------------------------------------------
// Dismissed notifications — a lightweight review list so dismissing never
// feels like data loss: every dismissed row is still one click from being
// restored, from either the dashboard callout or the notification bell.
// -------------------------------------------------------------------------
export function openDismissedModal(ctx){
  const dismissed=Store.dismissedAttention();
  const body=el('div');
  if(!dismissed.length){
    body.append(el('div',{class:'notif-pop-empty', html:`${icon('check')}<span>Nothing dismissed right now.</span>`}));
  }else{
    body.append(el('p',{class:'muted', style:'margin:0 0 10px;font-size:13px',
      text:'These stay quiet until their reason changes. Restore one to let it notify again.'}));
    dismissed.forEach(a=>{
      const {project:p, band, reasons}=a;
      const row=el('div',{class:'attn-row'});
      row.innerHTML=`<span class="aavatar" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
        <span class="aname">${escapeHtml(p.name)}</span>`;
      const reasonsWrap=el('span',{class:'areasons'});
      reasons.forEach(r=>{
        if(r.kind==='health') reasonsWrap.append(el('span',{class:`hchip ${band.cls}`, html:`${icon('activity')} ${escapeHtml(r.text)}`}));
        else reasonsWrap.append(el('span',{class:'fail-chip', html:`${icon('warning')} ${escapeHtml(r.text)}`}));
      });
      row.append(reasonsWrap);
      const actions=el('span',{class:'aactions'});
      actions.append(el('button',{class:'linkbtn', html:`${icon('refresh')} Restore`, onclick:()=>{
        Store.undismissAttention(p.id);
        row.remove();
        toast('Restored', { kind:'ok', body:`${p.name} can notify again.` });
        if(!body.querySelector('.attn-row')) hide();
      }}));
      row.append(actions);
      body.append(row);
    });
  }
  const closeBtn=el('button',{class:'btn primary', text:'Close', onclick:()=>hide()});
  const {hide}=modal({ title:'Dismissed notifications', icon:'eyeOff', body, foot:[closeBtn] });
}

function sectionTitle(text, ic, extra){
  const t=el('div',{class:'section-title', html:`<span style="color:var(--brand-b);display:inline-flex">${icon(ic)}</span><h2>${escapeHtml(text)}</h2>`});
  t.append(el('span',{class:'sp'})); if(extra) t.append(extra); return t;
}

export function tile(p, ctx){
  const rel=Store.latestRelease(p.id);
  const st=STATUSES[p.status]||STATUSES.idea;
  const c=el('div',{class:'card tile hover', onclick:(e)=>{ if(e.target.closest('.stopnav')) return; ctx.go('project',{id:p.id}); }});
  const accent=avatarColor(p.id);
  const top=el('div',{class:'tile-top'});
  top.innerHTML=`<span class="tavatar" style="background:${accent}">${icon(p.icon||'grid')}</span>
    <div class="thead"><b>${escapeHtml(p.name)}</b><div class="repo">${escapeHtml(p.repo||p.site||'—')}</div></div>
    <span class="status ${st.cls}"><span class="dot"></span>${st.label}</span>`;
  c.append(top);
  c.append(el('div',{class:'assessment', text:p.assessment||p.description||'No assessment yet — add one.'}));
  const meta=el('div',{class:'tmeta'});
  meta.innerHTML=`${rel?`<span class="vchip">v${rel.v}</span>`:'<span class="muted">no releases</span>'}
    <span title="${escapeHtml(fmtCT(Store.lastActivity(p.id)))}">${icon('clock')} ${escapeHtml(fmtCT(Store.lastActivity(p.id)))}</span>`;
  meta.querySelectorAll('svg').forEach(s=>{s.style.width='13px';s.style.height='13px';s.style.verticalAlign='-2px';s.style.marginRight='3px';});
  c.append(meta);

  const score=Store.healthScore(p.id);
  const band=healthBand(score);
  const health=el('div',{class:'thealth'});
  health.innerHTML=`<span class="hchip ${band.cls}" title="Health score: ${score}/100 — ${band.label} (recency + release velocity + status)">${icon('activity')} ${score} · ${band.label}</span>`;
  health.append(el('span',{class:'sp'}));
  health.append(el('span',{class:'tspark', title:'Release velocity — last 10 weeks', html:sparkline(Store.releaseVelocity(p.id), {width:56, height:20, color:band.color})}));
  if(p.autoSync && (p.autoSyncFailCount||0)>=Store.attentionThresholdsFor(p.id).autoSyncFails){
    health.append(el('span',{class:'fail-chip', title:`Auto-sync failing ×${p.autoSyncFailCount}: ${p.autoSyncLastError||'sync failed'}`, html:`${icon('warning')} sync failing`}));
  }
  c.append(health);

  const foot=el('div',{class:'tile-foot'});
  // what's new (in-app detail)
  foot.append(el('button',{class:'linkbtn stopnav', html:`${icon('sparkle')} What’s new`, title:'Open what’s new',
    onclick:(e)=>{ e.stopPropagation(); ctx.go('project',{id:p.id}); }}));
  // live site
  if(p.site) foot.append(linkOut(p.site, 'external', 'Site'));
  foot.append(el('span',{class:'sp'}));
  // Claude Code session
  if(p.sessionUrl) foot.append(linkOut(p.sessionUrl, 'terminal', 'Session', 'session'));
  else foot.append(el('button',{class:'linkbtn stopnav session', html:`${icon('terminal')} Link session`, title:'Add the Claude Code session URL',
    onclick:(e)=>{ e.stopPropagation(); openProjectEditor(p.id, ctx); }}));
  c.append(foot);

  const bar=el('div',{class:'accent-bar', style:`background:${accent}`}); c.append(bar);
  return c;
}

function linkOut(href, ic, label, cls=''){
  return el('a',{class:'linkbtn stopnav '+cls, href, target:'_blank', rel:'noopener', html:`${icon(ic)} ${label}`,
    onclick:(e)=>e.stopPropagation()});
}

// -------------------------------------------------------------------------
// Fleet-wide sync — run the same live changelog ingestion as the project
// page's Sync button, once per project, and show a per-project result
// summary. Skips projects with no site and no changelog URL to fetch from.
// Cross-origin fetches that CORS blocks show up as a per-row failure (with
// a nudge to sync that one project individually, which offers the paste-in
// fallback) rather than derailing the whole run.
// -------------------------------------------------------------------------
export function openSyncAll(ctx){
  const all=Store.projects();
  const targets=all.filter(p=>p.changelogUrl||p.site);
  const skipped=all.length-targets.length;

  const body=el('div');
  body.append(el('p',{class:'muted', style:'margin:0 0 14px;font-size:13px', text:
    targets.length
      ? `Fetching each project’s real changelog and importing anything new or changed.${skipped?` ${skipped} project${skipped===1?'':'s'} skipped — no site or changelog URL.`:''}`
      : 'No projects have a site or changelog URL to sync from yet. Add one from the project editor.'}));

  const rows=new Map();
  if(targets.length){
    const list=el('div',{class:'sync-all-list'});
    targets.forEach(p=>{
      const row=el('div',{class:'sync-all-row'});
      row.innerHTML=`<span class="saa" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="status tiny muted">Waiting…</span>`;
      rows.set(p.id, row.querySelector('.status'));
      list.append(row);
    });
    body.append(list);
  }
  const summary=el('div',{class:'tiny', style:'margin-top:14px;min-height:16px'});
  body.append(summary);

  const closeBtn=el('button',{class:'btn primary', text:targets.length?'Close':'OK', onclick:()=>hide()});
  const {hide}=modal({ title:'Sync all changelogs', icon:'refresh', body, foot:[closeBtn] });
  if(!targets.length) return;

  (async()=>{
    let added=0, updated=0, ok=0, failed=0;
    for(const p of targets){
      const statusEl=rows.get(p.id);
      statusEl.textContent='Fetching…';
      const res=await syncProject(p);
      if(res.status==='ok'){
        ok++; added+=res.added; updated+=res.updated;
        const changed=res.added||res.updated;
        statusEl.className='status tiny'+(changed?'':' muted');
        statusEl.style.color=changed?'var(--success)':'';
        statusEl.textContent=changed?`${res.added?`${res.added} new`:''}${res.added&&res.updated?', ':''}${res.updated?`${res.updated} updated`:''}`:'up to date';
      }else{
        failed++;
        statusEl.className='status tiny sync-err';
        statusEl.textContent=res.message||'failed';
      }
    }
    summary.className='tiny '+(failed?'muted':'');
    summary.innerHTML=`Done — <b>${ok}</b> synced${failed?`, <b>${failed}</b> failed`:''}${skipped?`, ${skipped} skipped`:''}. `+
      `<b>${added}</b> new release${added===1?'':'s'}, <b>${updated}</b> updated.`;
    if(added||updated){
      Store.logRun({ mode:'manual', note:`Fleet-wide sync — ${added} new, ${updated} updated across ${ok} project${ok===1?'':'s'}` });
      toast('Fleet sync complete', { kind:'ok', body:`${added} new, ${updated} updated across ${ok} project${ok===1?'':'s'}.` });
      ctx.go('home');
    }else if(ok){
      toast('Fleet sync complete', { kind:'info', body:'Everything was already up to date.' });
    }else{
      toast('Fleet sync failed', { kind:'warn', body:`Couldn’t reach ${failed} project${failed===1?'':'s'} — try syncing them individually.` });
    }
  })();
}

// -------------------------------------------------------------------------
// Force sync all — the destructive sibling of Sync all: for every synced
// project, fully reconciles local releases to the source (overwrites drifted
// or manually-edited rows, removes synced releases no longer published
// upstream). Gated behind an explicit confirm since it can't be undone with
// a single ⌘Z (each row change is written silently, like the safe sync).
// -------------------------------------------------------------------------
async function openForceSyncAll(ctx){
  const all=Store.projects();
  const targets=all.filter(p=>p.changelogUrl||p.site);
  if(!targets.length){ toast('Nothing to force sync', {kind:'info', body:'Add a site or changelog URL to a project first.'}); return; }

  const proceed=await confirmDialog('Force sync all', `This fully reconciles ${targets.length} project${targets.length===1?'':'s'} to its source — any local edits to a matching version are overwritten, and previously-synced releases no longer published upstream are removed. Releases added by hand are left alone.`, {danger:true, okLabel:'Force sync all'});
  if(!proceed) return;

  const body=el('div');
  const list=el('div',{class:'sync-all-list'});
  const rows=new Map();
  targets.forEach(p=>{
    const row=el('div',{class:'sync-all-row'});
    row.innerHTML=`<span class="saa" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="status tiny muted">Waiting…</span>`;
    rows.set(p.id, row.querySelector('.status'));
    list.append(row);
  });
  body.append(list);
  const summary=el('div',{class:'tiny', style:'margin-top:14px;min-height:16px'});
  body.append(summary);

  const closeBtn=el('button',{class:'btn primary', text:'Close', onclick:()=>hide()});
  const {hide}=modal({ title:'Force sync all', icon:'bolt', body, foot:[closeBtn] });

  let added=0, updated=0, removed=0, ok=0, failed=0;
  for(const p of targets){
    const statusEl=rows.get(p.id);
    statusEl.textContent='Fetching…';
    const res=await forceSyncProject(p);
    if(res.status==='ok'){
      ok++; added+=res.added; updated+=res.updated; removed+=res.removed;
      const changed=res.added||res.updated||res.removed;
      statusEl.className='status tiny'+(changed?'':' muted');
      statusEl.style.color=changed?'var(--success)':'';
      const parts=[res.added?`${res.added} new`:'', res.updated?`${res.updated} updated`:'', res.removed?`${res.removed} removed`:''].filter(Boolean);
      statusEl.textContent=parts.length?parts.join(', '):'up to date';
    }else{
      failed++;
      statusEl.className='status tiny sync-err';
      statusEl.textContent=res.message||'failed';
    }
  }
  summary.className='tiny '+(failed?'muted':'');
  summary.innerHTML=`Done — <b>${ok}</b> reconciled${failed?`, <b>${failed}</b> failed`:''}. `+
    `<b>${added}</b> new, <b>${updated}</b> updated, <b>${removed}</b> removed.`;
  if(added||updated||removed){
    Store.logRun({ mode:'manual', note:`Fleet-wide force sync — ${added} new, ${updated} updated, ${removed} removed across ${ok} project${ok===1?'':'s'}` });
    toast('Fleet force sync complete', { kind:'ok', body:`${added} new, ${updated} updated, ${removed} removed across ${ok} project${ok===1?'':'s'}.` });
    ctx.go('home');
  }else if(ok){
    toast('Fleet force sync complete', { kind:'info', body:'Everything already matched the source.' });
  }else{
    toast('Fleet force sync failed', { kind:'warn', body:`Couldn’t reach ${failed} project${failed===1?'':'s'}.` });
  }
}
