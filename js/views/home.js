// Dashboard — a live wall of project tiles + fleet stats + quick actions.
import { Store, STATUSES } from '../store.js';
import { el, escapeHtml, fmtCT, ago, avatarColor, toast } from '../ui.js';
import { icon } from '../icons.js';
import { openProjectEditor } from './projects.js';

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

  // hero
  const hero=el('div',{style:'margin-bottom:20px'});
  hero.innerHTML=`<h1 style="margin:0 0 4px;font-size:26px;letter-spacing:-.4px">${greeting()}, Commander.</h1>
    <p class="muted" style="margin:0;font-size:14px">Your fleet has <b style="color:var(--text)">${projects.length}</b> project${projects.length!==1?'s':''} — ${active} active, ${live} live. Everything below updates the moment it changes.</p>`;
  wrap.append(hero);

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
  qa.append(
    act('plus','linear-gradient(135deg,var(--brand-b),var(--consensus))','Add a project','Track a new repo or site in the fleet.',()=>openProjectEditor(null,ctx)),
    act('grid','linear-gradient(135deg,var(--consensus),#7c3aed)','Open the library','Filter, sort, and edit every project.',()=>ctx.go('projects')),
    act('book','linear-gradient(135deg,var(--brand-a),var(--brand-b))','Read the docs','New here? Start with the guide.',()=>ctx.go('docs')),
    act('sparkle','linear-gradient(135deg,var(--brand-c),#65a30d)','What’s new','See what shipped in Manager.',()=>ctx.openWhatsNew()),
  );
  wrap.append(qa);

  root.append(wrap);
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
