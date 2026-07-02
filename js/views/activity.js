// Activity — the self-improvement cadence log. Tracks the feature/sweep rhythm
// (every 5th feature run → a design & feature sweep) and every recorded run.
import { Store } from '../store.js';
import { el, escapeHtml, fmtCT, ago, toast, modal } from '../ui.js';
import { icon } from '../icons.js';

export function renderActivity(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});
  const runs=Store.runs();
  const feat=Store.featureCount();
  const untilSweep=(5-(feat%5))%5;

  const head=el('div',{class:'section-title', style:'margin-top:0'});
  head.innerHTML=`<span style="color:var(--brand-b);display:inline-flex">${icon('activity')}</span><h2>Cadence</h2>`;
  head.append(el('span',{class:'sp'}));
  head.append(el('button',{class:'btn sm', html:`${icon('plus')} Log a run`, onclick:()=>logRun(ctx)}));
  wrap.append(head);

  // cadence explainer + ring of dots (last 20 runs, oldest→newest)
  const card=el('div',{class:'card'});
  card.innerHTML=`<p class="muted" style="margin:0 0 10px;font-size:13px">Manager self-improves on a schedule. Four <b style="color:var(--brand-b)">feature</b> runs, then one <b style="color:var(--brand-c)">sweep</b> — a design &amp; feature polish across the app and the public site. ${untilSweep===0?'A sweep is next. ✦':`<b>${untilSweep}</b> feature run${untilSweep!==1?'s':''} until the next sweep.`}</p>`;
  const strip=el('div',{class:'cadence'});
  runs.slice(0,24).reverse().forEach(r=>{
    strip.append(el('div',{class:'cad-dot '+(r.mode==='sweep'||r.mode==='polish'?'sweep':r.mode==='feature'?'feature':''), title:`${r.mode} · ${fmtCT(r.ts)}`, text:r.mode==='sweep'?'✦':r.mode[0].toUpperCase()}));
  });
  if(!runs.length) strip.append(el('span',{class:'muted tiny', text:'No runs logged yet.'}));
  card.append(strip);
  // next 5-cycle preview
  const preview=el('div',{class:'cadence', style:'margin-top:12px;opacity:.55'});
  for(let k=0;k<5;k++){ const isSweep=((feat+k+1)%5===0); preview.append(el('div',{class:'cad-dot '+(isSweep?'sweep':'feature'), title:isSweep?'sweep':'feature', text:isSweep?'✦':'F'})); }
  card.append(el('div',{class:'tiny muted', style:'margin-top:10px', text:'Upcoming rhythm →'}), preview);
  wrap.append(card);

  // run log
  wrap.append(el('div',{class:'section-title', html:`<h2>Run log (${runs.length})</h2>`}));
  if(!runs.length){
    wrap.append(el('div',{class:'card empty', html:`${icon('activity')}<div>No runs yet. Each self-improvement run appears here.</div>`}));
  }else{
    const list=el('div',{class:'grid', style:'gap:8px'});
    runs.forEach(r=>list.append(runRow(r, ctx)));
    wrap.append(list);
  }
  root.append(wrap);
}

function runRow(r, ctx){
  const p=r.projectId?Store.project(r.projectId):null;
  const mode=r.mode||'feature';
  const color=mode==='sweep'||mode==='polish'?'linear-gradient(135deg,var(--brand-c),#65a30d)':mode==='feature'?'linear-gradient(135deg,var(--brand-b),var(--consensus))':'var(--surface-3)';
  const c=el('div',{class:'card run-row'});
  c.innerHTML=`<span class="ric" style="background:${color};color:#05121a">${icon(mode==='sweep'?'sparkle':mode==='feature'?'bolt':'edit')}</span>
    <div class="sp" style="min-width:0"><b>${escapeHtml(r.note||mode)}</b>
      <div class="tiny muted">${escapeHtml(mode)}${p?` · ${escapeHtml(p.name)}`:''} · ${escapeHtml(fmtCT(r.ts))}</div></div>`;
  if(p) c.append(el('button',{class:'btn ghost sm', html:icon('external'), title:'Open project', 'aria-label':'Open project', onclick:()=>ctx.go('project',{id:p.id})}));
  return c;
}

function logRun(ctx){
  const projects=Store.projects();
  const mode=el('select',{class:'input'});
  [['feature','Feature'],['sweep','Sweep'],['polish','Polish'],['manual','Manual']].forEach(([k,t])=>mode.append(el('option',{value:k,text:t})));
  const proj=el('select',{class:'input'});
  proj.append(el('option',{value:'',text:'— No project —'}));
  projects.forEach(p=>proj.append(el('option',{value:p.id,text:p.name})));
  const note=el('input',{class:'input', placeholder:'What did this run do?'});
  const body=el('div');
  const f=(l,n)=>{ const w=el('div',{class:'field'}); w.append(el('label',{text:l}), n); return w; };
  body.append(f('Mode', mode), f('Project', proj), f('Note', note));
  const {hide}=modal({ title:'Log a run', icon:'activity', body, foot:[
    el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}),
    el('button',{class:'btn primary', text:'Log run', onclick:()=>{
      Store.logRun({ mode:mode.value, projectId:proj.value, note:note.value.trim() });
      hide(); toast('Run logged',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('activity');
    }})]});
  setTimeout(()=>note.focus(),50);
}
