// -----------------------------------------------------------------------
// tour.js — a lightweight, restartable welcome tour.
//
// Highlights key UI elements with a positioned popover (`.tour-back` +
// `.tour-pop`), stepping through app-provided steps. Ported from
// JobTracker's tour.js, parameterized for the fleet: the app passes its own
// steps and its own "seen it" persistence, so no storage key is hardcoded.
//
//   steps: [{ sel:'.rail-item[data-sec="home"]', title:'…', body:'…' }]
//   maybeStartTour(steps, { storageKey, isDone?, markDone?, delay? })
//     — auto-start once per user; by default done-ness is a '1' boolean at
//       localStorage[storageKey]; pass isDone()/markDone() to keep an app's
//       historical location (e.g. JobTracker's settings.tourDone).
//   startTour(steps, opts) — always runs (Settings → "restart tour").
//     opts.blockedBy: selector — skip if a full-screen overlay is up (the
//       target the tour points at wouldn't even be visible).
//     opts.onStep(step, target): hook per step (e.g. force the rail open).
// -----------------------------------------------------------------------
import { el, $ } from './ui.js';

export function maybeStartTour(steps, { storageKey, isDone, markDone, delay=700, ...opts }={}){
  // The default persistence is a plain boolean flag at storageKey — enough
  // for new apps; existing apps adapt via isDone/markDone.
  const done = isDone ? isDone()
    : storageKey ? localStorage.getItem(storageKey)==='1'
    : false;
  if(done) return;
  // Small delay so first render settles before we measure targets.
  setTimeout(()=>startTour(steps, { storageKey, markDone, ...opts }), delay);
}

export function startTour(steps, { storageKey, markDone, blockedBy, onStep }={}){
  if(!steps || !steps.length) return;
  // Never float the tour over a full-screen overlay (e.g. a focus mode
  // opened via a deep link during the auto-start delay) — the element it
  // points at isn't even visible there.
  if(blockedBy && document.querySelector(blockedBy)) return;
  let i=0;
  const back=el('div',{class:'tour-back', onclick:()=>finish()});
  const pop=el('div',{class:'tour-pop'});
  document.body.append(back, pop);
  show();

  function show(){
    const step=steps[i];
    const target=$(step.sel);
    if(target){
      onStep && onStep(step, target);
      // Lift the target above the dimmer and ring it — inline styles so no
      // extra CSS contract beyond .tour-back/.tour-pop.
      target.style.position='relative'; target.style.zIndex='152';
      target.style.boxShadow='0 0 0 3px var(--brand)';
      target.style.borderRadius='10px';
    }
    pop.innerHTML='';
    pop.append(
      el('h3',{text:step.title}),
      el('p',{text:step.body}),
      (()=>{ const f=el('div',{class:'tour-foot'});
        const dots=el('div',{class:'tour-dots'});
        steps.forEach((_,k)=>dots.append(el('i',{class:k===i?'on':''})));
        const btns=el('div',{style:'display:flex;gap:8px'});
        btns.append(el('button',{class:'btn sm ghost', text:'Skip', onclick:()=>finish()}));
        btns.append(el('button',{class:'btn sm primary', text: i===steps.length-1?'Done':'Next', onclick:()=>next()}));
        f.append(dots, btns); return f; })()
    );
    position(target);
  }
  function position(target){
    const r = target? target.getBoundingClientRect() : { right:80, top:80, bottom:120, left:80 };
    const pw=340, ph=pop.offsetHeight||150;
    let left = r.right + 14; let top = r.top;
    if(left+pw>window.innerWidth-12) left = Math.max(12, r.left - pw - 14);
    if(left<12) left=12;
    if(top+ph>window.innerHeight-12) top=Math.max(12, window.innerHeight-ph-12);
    pop.style.left=left+'px'; pop.style.top=top+'px';
  }
  function clear(){ const t=$(steps[i].sel); if(t){ t.style.boxShadow=''; t.style.zIndex=''; } }
  function next(){ clear(); if(i>=steps.length-1){ finish(); return; } i++; show(); }
  function finish(){
    clear(); back.remove(); pop.remove();
    if(markDone) markDone();
    else if(storageKey){ try{ localStorage.setItem(storageKey,'1'); }catch{} }
  }
}
