// Releases — a fleet-wide, time-grouped feed of every project's releases, so
// you can see at a glance what improved recently across the whole suite.
// Read-only: it reads the same `releases` table the per-project timelines do.
import { Store } from '../store.js';
import { el, escapeHtml, fmtCT, avatarColor, toast, modal } from '../ui.js';
import { icon } from '../icons.js';

const VIEW_KEY = 'manager.releases.view';
const DEFAULT = { q:'', project:'all', range:'all', kind:'all', group:'day', density:'full', milestones:false };
function state(){ try{ return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')) }; }catch{ return { ...DEFAULT }; } }
function save(s){ try{ localStorage.setItem(VIEW_KEY, JSON.stringify(s)); }catch{} }

// ---- "since you last looked" — a fleet-wide unread marker -----------------
// Mirrors js/views/whatsnew.js's seen-version idea, but for the whole fleet's
// release feed rather than just Manager's own changelog: a single timestamp
// of the last time this feed was actually opened. A brand-new workspace (or
// one upgrading to this feature) shouldn't suddenly show years of history as
// "unread", so the first-ever check quietly adopts "now" as the baseline
// instead of leaving the key unset (which would otherwise count as "since
// the beginning of time").
const SEEN_KEY = 'manager.releases.seenTs';
function ensureSeenTs(){
  let raw; try{ raw = localStorage.getItem(SEEN_KEY); }catch{ return Date.now(); }
  if(raw==null){ raw=String(Date.now()); try{ localStorage.setItem(SEEN_KEY, raw); }catch{} }
  return parseInt(raw,10)||0;
}
export function releasesSeenTs(){ return ensureSeenTs(); }
export function markReleasesSeen(){ try{ localStorage.setItem(SEEN_KEY, String(Date.now())); }catch{} }
export function unreadReleasesCount(){
  const seen = ensureSeenTs();
  return Store.all('releases').filter(r=>r.ts && +new Date(r.ts) > seen).length;
}

const RANGES = { all:Infinity, '7':7, '30':30, '90':90 };

// A Central-Time day key (YYYY-MM-DD) so releases group by the day they
// shipped in the house time zone, not the viewer's.
function ctDayKey(ts){ try{ return new Date(ts).toLocaleDateString('en-CA',{ timeZone:'America/Chicago' }); }catch{ return String(ts).slice(0,10); } }
function ctDayLabel(ts){
  const key = ctDayKey(ts);
  const today = ctDayKey(Date.now());
  const yest = ctDayKey(Date.now()-86400000);
  const friendly = new Date(ts).toLocaleDateString('en-US',{ timeZone:'America/Chicago', weekday:'long', month:'short', day:'numeric', year:'numeric' });
  if(key===today) return { lead:'Today', rest:friendly };
  if(key===yest)  return { lead:'Yesterday', rest:friendly };
  return { lead:friendly, rest:'' };
}
function timeCT(ts){ try{ return new Date(ts).toLocaleTimeString('en-US',{ timeZone:'America/Chicago', hour:'numeric', minute:'2-digit' })+' CT'; }catch{ return ''; } }

// The Monday (CT) of the current calendar week, as a 'YYYY-MM-DD' key —
// distinct from the rolling "last 7 days" stat: this resets every Monday
// rather than sliding, so "this week" reads the way a status update would say it.
function ctWeekStartKey(){
  const d = new Date(ctDayKey(Date.now())+'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() - (dow===0?6:dow-1));
  return d.toISOString().slice(0,10);
}

// A compact one-line preview of a group's releases for digest/density mode —
// "By day" names the project per release (the header is just a date); "By
// project" already names the project in the header, so this only needs the
// version + title.
function digestSummary(items, mode){
  const parts = items.slice(0,3).map(x => mode==='project' ? `v${x.r.v} ${x.r.title||'Untitled release'}` : `${x.p.name} v${x.r.v}`);
  const extra = items.length>3 ? `, +${items.length-3} more` : '';
  return parts.join(', ') + extra;
}

// Groups a row set the same way whether the caller wants it on-screen (HTML
// headers) or off-screen (plain-text headers for Markdown) — shared so the
// two never drift apart. Returns [{ items, project? , day? }].
function buildGroups(rows, groupMode){
  if(groupMode==='project'){
    const byProj=new Map();
    rows.forEach(x=>{ const arr=byProj.get(x.p.id)||[]; arr.push(x); byProj.set(x.p.id, arr); });
    const order=[...byProj.keys()].sort((a,b)=> new Date(byProj.get(b)[0].r.ts) - new Date(byProj.get(a)[0].r.ts));
    return order.map(pid=>{ const items=byProj.get(pid); return { items, project:items[0].p }; });
  }
  const byDay=new Map();
  rows.forEach(x=>{ const day=ctDayKey(x.r.ts); const arr=byDay.get(day)||[]; arr.push(x); byDay.set(day,arr); });
  // `rows` is already newest-first, so Map insertion order is day order too
  return [...byDay.values()].map(items=>({ items, day:items[0].r.ts }));
}
function groupLabelPlain(g, groupMode){
  if(groupMode==='project') return g.project.name;
  const lab=ctDayLabel(g.day);
  return lab.rest ? `${lab.lead} — ${lab.rest}` : lab.lead;
}

// ---- copy-as-markdown / JSON / RSS export ---------------------------------
// Markdown mirrors exactly what's grouped on screen (same filters, same
// Day/Project toggle) — meant to be pasted straight into a status update or
// PR description. JSON/RSS are a *combined, filter-independent* snapshot
// (every project, last N days) so "what shipped across the suite" can be
// piped into a feed reader or script rather than only ever copy/pasted.
const RECENT_EXPORT_DAYS = 30;

function feedMarkdown(rows, groupMode){
  if(!rows.length) return '## Releases\n\nNothing matches the current filters.\n';
  const lines=['## Releases',''];
  buildGroups(rows, groupMode).forEach(g=>{
    lines.push(`### ${groupLabelPlain(g, groupMode)}`);
    g.items.forEach(({r,p})=>{
      const head = groupMode==='project'
        ? `v${r.v} — ${r.title||'Untitled release'} _(${fmtCT(r.ts,{withTime:false})})_`
        : `**${p.name}** v${r.v} — ${r.title||'Untitled release'}`;
      lines.push(`- ${head}`);
      (r.items||[]).forEach(i=>lines.push(`  - ${i}`));
    });
    lines.push('');
  });
  return lines.join('\n').trim()+'\n';
}

function downloadFile(name, content, mime){
  const blob=new Blob([content],{type:mime});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function recentFeedJSON(rows){
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    windowDays: RECENT_EXPORT_DAYS,
    releases: rows.map(({r,p})=>({
      project: p.name, projectId: p.id, version: String(r.v), title: r.title||'Untitled release',
      kind: r.kind||'feature', ts: r.ts, items: r.items||[],
    })),
  }, null, 2);
}

function recentFeedRSS(rows){
  const site = location.origin + location.pathname.replace(/\/app\/.*$/, '/app/');
  const items = rows.map(({r,p})=>{
    const desc = [r.title||'Untitled release', ...(r.items||[])].map(escapeHtml).join('&lt;br/&gt;');
    return `  <item>
    <title>${escapeHtml(p.name)} v${escapeHtml(String(r.v))} — ${escapeHtml(r.title||'Untitled release')}</title>
    <link>${escapeHtml(site)}#project/${encodeURIComponent(p.id)}</link>
    <guid isPermaLink="false">${escapeHtml(r.id)}</guid>
    <pubDate>${new Date(r.ts).toUTCString()}</pubDate>
    <description>${desc}</description>
  </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Manager — Releases across the fleet</title>
  <link>${escapeHtml(site)}</link>
  <description>What shipped across the fleet in the last ${RECENT_EXPORT_DAYS} days.</description>
${items}
</channel></rss>
`;
}

function openExportModal(currentRows, groupMode, recentRows){
  const body=el('div');

  const mdWrap=el('div');
  mdWrap.innerHTML=`<div><b>Copy as Markdown</b></div>
    <p class="tiny muted" style="margin:4px 0 10px">Copies exactly what’s on screen right now — your current filters,
    grouped by <b>${groupMode==='project'?'project':'day'}</b> — as a <span class="mono">## Releases</span> list ready
    to paste into a status update or PR description.</p>`;
  mdWrap.append(el('button',{class:'btn', html:`${icon('copy')} Copy as Markdown`, onclick:async()=>{
    const md=feedMarkdown(currentRows, groupMode);
    try{ await navigator.clipboard.writeText(md); toast('Copied as Markdown',{kind:'ok'}); }
    catch{ toast('Couldn’t copy',{body:'Clipboard access was blocked.', kind:'err'}); }
  }}));

  const expWrap=el('div');
  expWrap.innerHTML=`<div><b>Export the combined feed</b></div>
    <p class="tiny muted" style="margin:4px 0 10px">A snapshot of every project’s releases from the last
    ${RECENT_EXPORT_DAYS} days — independent of your filters above — so “what shipped across the suite” can be
    watched from a feed reader or script instead of only ever pasted.</p>`;
  const btnRow=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  btnRow.append(
    el('button',{class:'btn', html:`${icon('download')} Download JSON`, onclick:()=>{
      downloadFile('manager-releases.json', recentFeedJSON(recentRows), 'application/json');
      toast('Exported as JSON',{kind:'ok'});
    }}),
    el('button',{class:'btn', html:`${icon('download')} Download RSS`, onclick:()=>{
      downloadFile('manager-releases.xml', recentFeedRSS(recentRows), 'application/rss+xml');
      toast('Exported as RSS',{kind:'ok'});
    }}),
  );
  expWrap.append(btnRow);

  body.append(mdWrap, el('div',{class:'divider'}), expWrap);
  modal({ title:'Copy & export releases', icon:'copy', body });
}

export function renderReleases(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const s=state();
  // the last time this feed was actually opened, captured *before* app.js
  // marks it seen post-render — this is what drives each card's "new" tag.
  const sinceTs=releasesSeenTs();

  // gather every release + its project, newest first
  const all = Store.all('releases')
    .map(r=>({ r, p:Store.project(r.projectId) }))
    .filter(x=>x.p && x.r.ts && !isNaN(new Date(x.r.ts)))
    .sort((a,b)=> new Date(b.r.ts) - new Date(a.r.ts));

  const now = Date.now();
  const within = (x,days)=> (now - +new Date(x.r.ts)) <= days*86400000;
  const in7 = all.filter(x=>within(x,7));
  const in30 = all.filter(x=>within(x,30));

  // ---- header ----
  const head=el('div',{class:'section-title', style:'margin-top:0'});
  head.innerHTML=`<span style="color:var(--brand-b);display:inline-flex">${icon('sparkle')}</span><h2>Releases</h2>`;
  head.append(el('span',{class:'sp'}));
  head.append(el('span',{class:'tiny muted', text:'What shipped across the fleet'}));
  wrap.append(head);

  // ---- summary stats ----
  const stats=el('div',{class:'grid stats', style:'margin-bottom:8px'});
  const stat=(k,v,d,color)=>{ const c=el('div',{class:'card stat'}); c.innerHTML=
    `<div class="glow" style="background:radial-gradient(circle,${color},transparent 70%)"></div>
     <div class="k">${k}</div><div class="v">${v}</div><div class="d">${escapeHtml(d)}</div>`; return c; };
  const proj7 = new Set(in7.map(x=>x.p.id)).size;
  const newestLabel = all.length ? fmtCT(all[0].r.ts) : '—';
  stats.append(
    stat('Last 7 days', in7.length, `${proj7} project${proj7!==1?'s':''} shipped`, 'var(--brand-b)'),
    stat('Last 30 days', in30.length, 'releases across the fleet', 'var(--consensus)'),
    stat('All time', all.length, `${Store.projects().length} projects tracked`, 'var(--brand-c)'),
    stat('Most recent', all.length?('v'+all[0].r.v):'—', all.length?`${all[0].p.name} · ${newestLabel}`:'nothing yet', 'var(--success)'),
  );
  wrap.append(stats);

  // ---- weekly rollup — a pasteable one-liner, calendar week not rolling ----
  const weekStart = ctWeekStartKey();
  const inWeek = all.filter(x => ctDayKey(x.r.ts) >= weekStart);
  if(inWeek.length){
    const weekProj = new Set(inWeek.map(x=>x.p.id)).size;
    const line = `This week across the suite: ${inWeek.length} release${inWeek.length!==1?'s':''} across ${weekProj} project${weekProj!==1?'s':''}.`;
    const rollup = el('div',{class:'week-rollup'});
    rollup.append(el('span',{style:'display:inline-flex', html:icon('bolt')}));
    rollup.append(el('span',{html:`This week across the suite: <b>${inWeek.length} release${inWeek.length!==1?'s':''}</b> across <b>${weekProj} project${weekProj!==1?'s':''}</b>.`}));
    rollup.append(el('button',{class:'btn ghost sm', html:`${icon('copy')} Copy`,
      onclick:()=>navigator.clipboard?.writeText(line).then(()=>toast('Copied',{kind:'ok'}))}));
    wrap.append(rollup);
  }

  // ---- "who shipped" chips (in the selected range) ----
  // built after we know the range; placeholder appended in render()

  // ---- toolbar ----
  const bar=el('div',{class:'toolbar'});
  const search=el('div',{class:'search'});
  const input=el('input',{class:'input', placeholder:'Search releases — title or detail…', value:s.q});
  search.append(el('span',{html:icon('search')}), input);
  input.addEventListener('input',()=>{ const ns={...state(),q:input.value}; save(ns); rerender(); });

  const projSel=el('select',{class:'input', style:'max-width:170px'});
  projSel.append(el('option',{value:'all',text:'All projects'}));
  Store.projects().slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>projSel.append(el('option',{value:p.id,text:p.name,selected:s.project===p.id})));
  projSel.value = Store.project(s.project)?s.project:'all';
  projSel.addEventListener('change',()=>{ const ns={...state(),project:projSel.value}; save(ns); rerender(); });

  const rangeSel=el('select',{class:'input', style:'max-width:150px'});
  [['all','All time'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']].forEach(([v,t])=>rangeSel.append(el('option',{value:v,text:t,selected:s.range===v})));
  rangeSel.addEventListener('change',()=>{ const ns={...state(),range:rangeSel.value}; save(ns); rerender(); });

  const kinds=el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'});
  ['all','feature','polish','fix'].forEach(k=>{
    const c=el('button',{class:'filter-chip'+(s.kind===k?' on':''), text:k[0].toUpperCase()+k.slice(1),
      onclick:()=>{ const ns={...state(),kind:k}; save(ns); rerender(); }});
    kinds.append(c);
  });
  const msChip=el('button',{class:'filter-chip ms-chip'+(s.milestones?' on':''), html:`${icon('flag')} Milestones`,
    title:'Show only releases marked as major milestones',
    onclick:()=>{ const ns={...state(),milestones:!state().milestones}; save(ns); rerender(); }});
  kinds.append(msChip);
  const groupLabel=(g)=>g==='project'?'By project':'By day';
  const groupIcon=(g)=>g==='project'?'layers':'calendar';
  const groupBtn=el('button',{class:'btn sm', title:'Toggle how the feed is grouped',
    html:`${icon(groupIcon(s.group))} <span>${groupLabel(s.group)}</span>`,
    onclick:()=>{
      const ns={...state(), group: state().group==='project'?'day':'project'};
      save(ns);
      groupBtn.innerHTML=`${icon(groupIcon(ns.group))} <span>${groupLabel(ns.group)}</span>`;
      rerender();
    }});
  const densityLabel=(d)=>d==='digest'?'Digest':'Full';
  const densityIcon=(d)=>d==='digest'?'menu':'eye';
  const densityBtn=el('button',{class:'btn sm', title:'Toggle between full cards and a collapsed one-line digest per group',
    html:`${icon(densityIcon(s.density))} <span>${densityLabel(s.density)}</span>`,
    onclick:()=>{
      const ns={...state(), density: state().density==='digest'?'full':'digest'};
      save(ns);
      densityBtn.innerHTML=`${icon(densityIcon(ns.density))} <span>${densityLabel(ns.density)}</span>`;
      rerender();
    }});

  const jumpSel=el('select',{class:'input', style:'max-width:190px', 'aria-label':'Jump to date'});
  jumpSel.addEventListener('change',()=>{ if(jumpSel.value) jumpToDay(jumpSel.value); jumpSel.value=''; });

  let currentRows=[];
  const exportBtn=el('button',{class:'btn sm', title:'Copy as Markdown or export JSON/RSS',
    html:`${icon('copy')} <span>Copy / Export</span>`,
    onclick:()=>openExportModal(currentRows, state().group, all.filter(x=>within(x, RECENT_EXPORT_DAYS)))});

  bar.append(search, projSel, rangeSel, kinds, groupBtn, densityBtn, jumpSel, exportBtn);
  wrap.append(bar);

  const shippedHost=el('div');
  wrap.append(shippedHost);
  const listHost=el('div',{id:'relFeed'});
  wrap.append(listHost);
  root.append(wrap);

  function rerender(){
    const cur=state();
    const days=RANGES[cur.range] ?? Infinity;
    const q=cur.q.trim().toLowerCase();
    const rows=all.filter(x=>{
      if(cur.project!=='all' && x.p.id!==cur.project) return false;
      if(cur.kind!=='all' && (x.r.kind||'feature')!==cur.kind) return false;
      if(cur.milestones && !x.r.milestone) return false;
      if(days!==Infinity && !within(x, days)) return false;
      if(q && !(x.r.title.toLowerCase().includes(q) || (x.r.items||[]).some(i=>i.toLowerCase().includes(q)) || x.p.name.toLowerCase().includes(q))) return false;
      return true;
    });
    currentRows=rows;

    // "who shipped" chips for the filtered set
    shippedHost.innerHTML='';
    if(rows.length){
      const counts=new Map();
      rows.forEach(x=>counts.set(x.p.id,(counts.get(x.p.id)||0)+1));
      const chips=el('div',{class:'saved-views', style:'margin-bottom:14px'});
      [...counts.entries()].sort((a,b)=>b[1]-a[1]).forEach(([pid,n])=>{
        const p=Store.project(pid); if(!p) return;
        const chip=el('button',{class:'filter-chip'+(cur.project===pid?' on':''),
          html:`<span class="mini-av" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span> ${escapeHtml(p.name)} <b style="opacity:.7">${n}</b>`,
          onclick:()=>{ const ns={...state(),project:cur.project===pid?'all':pid}; save(ns); renderReleases(root,ctx); }});
        chips.append(chip);
      });
      shippedHost.append(chips);
    }

    // jump-to-date — one option per distinct day present in the filtered set,
    // newest first (matches feed order); works in either grouping mode since
    // it targets the release card's own data-day, not the group header.
    const dayKeys=[]; const seenDay=new Set();
    rows.forEach(x=>{ const k=ctDayKey(x.r.ts); if(!seenDay.has(k)){ seenDay.add(k); dayKeys.push(k); } });
    jumpSel.innerHTML='';
    jumpSel.append(el('option',{value:'', text:dayKeys.length?'Jump to date…':'No dates yet', disabled:true, selected:true}));
    dayKeys.forEach(k=>{
      const first=rows.find(x=>ctDayKey(x.r.ts)===k);
      const n=rows.filter(x=>ctDayKey(x.r.ts)===k).length;
      const lab=ctDayLabel(first.r.ts);
      jumpSel.append(el('option',{value:k, text:`${lab.rest?`${lab.lead} — ${lab.rest}`:lab.lead} (${n})`}));
    });
    jumpSel.disabled = dayKeys.length===0;

    // grouped feed — either day-by-day (default) or clustered by project;
    // digest/density mode collapses each group's cards behind a one-line
    // <details> summary instead of removing them, so nothing is ever lost.
    listHost.innerHTML='';
    if(!rows.length){
      listHost.append(el('div',{class:'card empty', html:`${icon('sparkle')}<div>No releases match.<br><span class="tiny">Sync a project (or clear filters) to populate the timeline.</span></div>`}));
      return;
    }
    const groups = buildGroups(rows, cur.group).map(g=>{
      if(cur.group==='project'){
        const p=g.project;
        return { items:g.items, headHtml:`<span class="mini-av" style="background:${avatarColor(p.id)}">${icon(p.icon||'grid')}</span> ${escapeHtml(p.name)}` };
      }
      const lab=ctDayLabel(g.day);
      return { items:g.items, headHtml:`${escapeHtml(lab.lead)}${lab.rest?` <span class="cnt" style="font-weight:400">· ${escapeHtml(lab.rest)}</span>`:''}` };
    });
    groups.forEach(({items,headHtml})=>{
      const d=el('div',{class:'feed-day'});
      d.innerHTML=`<h3>${headHtml}</h3><span class="ln"></span><span class="cnt">${items.length} release${items.length!==1?'s':''}</span>`;
      listHost.append(d);
      if(cur.density==='digest'){
        const det=el('details',{class:'rel-group'});
        det.append(el('summary',{class:'rel-digest', html:`<span class="rel-digest-text">${escapeHtml(digestSummary(items,cur.group))}</span>`}));
        const body=el('div',{class:'rel-group-body'});
        items.forEach(x=>body.append(relCard(x, ctx, sinceTs)));
        det.append(body);
        listHost.append(det);
      } else {
        items.forEach(x=>listHost.append(relCard(x, ctx, sinceTs)));
      }
    });
  }

  // opens the release's group (if collapsed in digest mode) and scrolls it
  // into view with a brief highlight, so "jump to date" lands somewhere
  // visibly obvious rather than just silently changing scroll position.
  function jumpToDay(key){
    const target = listHost.querySelector(`[data-day="${CSS.escape(key)}"]`);
    if(!target) return;
    const group = target.closest('details.rel-group');
    if(group && !group.open) group.open = true;
    target.scrollIntoView({ behavior:'smooth', block:'center' });
    target.classList.add('jump-flash');
    setTimeout(()=>target.classList.remove('jump-flash'), 1400);
  }
  rerender();
}

function relCard(x, ctx, sinceTs){
  const { r, p } = x;
  const isNew = sinceTs!=null && +new Date(r.ts) > sinceTs;
  const card=el('div',{class:'rel-card'+(isNew?' is-new':'')+(r.milestone?' is-milestone':''), tabindex:'0', role:'button', 'data-day':ctDayKey(r.ts), 'aria-label':`${p.name} v${r.v}: ${r.title}${r.milestone?' — milestone':''}${isNew?' — new since your last visit':''}`,
    onclick:()=>ctx.go('project',{id:p.id}),
    onkeydown:(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); ctx.go('project',{id:p.id}); } }});
  const av=el('span',{class:'rc-av', style:`background:${avatarColor(p.id)}`, html:icon(p.icon||'grid')});
  const main=el('div',{class:'rc-main'});
  main.innerHTML=`<div class="rc-top">
      ${isNew ? `<span class="tag sync-new">new</span>` : ''}
      <span class="rc-proj">${escapeHtml(p.name)}</span>
      <span class="vchip mono">v${r.v}</span>
      ${r.milestone ? `<span class="ms-badge" title="${escapeHtml(r.milestoneLabel||'Marked milestone')}">${icon('flag')} ${escapeHtml(r.milestoneLabel||'Milestone')}</span>` : ''}
      ${r.kind && r.kind!=='feature' ? `<span class="wn-kind">${escapeHtml(r.kind)}</span>` : ''}
      ${r.source==='sync' ? `<span class="tag" title="Synced from ${escapeHtml(r.sourceUrl||'')}">synced</span>` : ''}
      <span class="rc-when" title="${escapeHtml(fmtCT(r.ts))}">${escapeHtml(timeCT(r.ts))}</span>
    </div>
    <div class="rc-title">${escapeHtml(r.title||'Untitled release')}</div>
    ${r.items&&r.items.length?`<ul>${r.items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>`:''}`;
  card.append(av, main);
  return card;
}
