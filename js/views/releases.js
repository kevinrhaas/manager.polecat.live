// Releases — a fleet-wide, time-grouped feed of every project's releases, so
// you can see at a glance what improved recently across the whole suite.
// Read-only: it reads the same `releases` table the per-project timelines do.
import { Store } from '../store.js';
import { el, escapeHtml, fmtCT, avatarColor } from '../ui.js';
import { icon } from '../icons.js';

const VIEW_KEY = 'manager.releases.view';
const DEFAULT = { q:'', project:'all', range:'all', kind:'all' };
function state(){ try{ return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')) }; }catch{ return { ...DEFAULT }; } }
function save(s){ try{ localStorage.setItem(VIEW_KEY, JSON.stringify(s)); }catch{} }

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

export function renderReleases(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const s=state();

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
  bar.append(search, projSel, rangeSel, kinds);
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
      if(days!==Infinity && !within(x, days)) return false;
      if(q && !(x.r.title.toLowerCase().includes(q) || (x.r.items||[]).some(i=>i.toLowerCase().includes(q)) || x.p.name.toLowerCase().includes(q))) return false;
      return true;
    });

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

    // grouped feed
    listHost.innerHTML='';
    if(!rows.length){
      listHost.append(el('div',{class:'card empty', html:`${icon('sparkle')}<div>No releases match.<br><span class="tiny">Sync a project (or clear filters) to populate the timeline.</span></div>`}));
      return;
    }
    let lastDay=null;
    rows.forEach(x=>{
      const day=ctDayKey(x.r.ts);
      if(day!==lastDay){
        lastDay=day;
        const dayRows=rows.filter(y=>ctDayKey(y.r.ts)===day);
        const lab=ctDayLabel(x.r.ts);
        const d=el('div',{class:'feed-day'});
        d.innerHTML=`<h3>${escapeHtml(lab.lead)}${lab.rest?` <span class="cnt" style="font-weight:400">· ${escapeHtml(lab.rest)}</span>`:''}</h3><span class="ln"></span><span class="cnt">${dayRows.length} release${dayRows.length!==1?'s':''}</span>`;
        listHost.append(d);
      }
      listHost.append(relCard(x, ctx));
    });
  }
  rerender();
}

function relCard(x, ctx){
  const { r, p } = x;
  const card=el('div',{class:'rel-card', tabindex:'0', role:'button', 'aria-label':`${p.name} v${r.v}: ${r.title}`,
    onclick:()=>ctx.go('project',{id:p.id}),
    onkeydown:(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); ctx.go('project',{id:p.id}); } }});
  const av=el('span',{class:'rc-av', style:`background:${avatarColor(p.id)}`, html:icon(p.icon||'grid')});
  const main=el('div',{class:'rc-main'});
  main.innerHTML=`<div class="rc-top">
      <span class="rc-proj">${escapeHtml(p.name)}</span>
      <span class="vchip mono">v${r.v}</span>
      ${r.kind && r.kind!=='feature' ? `<span class="wn-kind">${escapeHtml(r.kind)}</span>` : ''}
      ${r.source==='sync' ? `<span class="tag" title="Synced from ${escapeHtml(r.sourceUrl||'')}">synced</span>` : ''}
      <span class="rc-when" title="${escapeHtml(fmtCT(r.ts))}">${escapeHtml(timeCT(r.ts))}</span>
    </div>
    <div class="rc-title">${escapeHtml(r.title||'Untitled release')}</div>
    ${r.items&&r.items.length?`<ul>${r.items.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>`:''}`;
  card.append(av, main);
  return card;
}
