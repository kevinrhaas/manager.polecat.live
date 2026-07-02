// tour.js — a spotlight welcome tour. Highlights real UI, one step at a time.
// Restartable from Settings. Fully keyboard- and touch-friendly.
import { el } from './ui.js';
import { icon } from './icons.js';

export const MANAGER_TOUR = [
  { title:'Welcome to Mission Control', icon:'rocket',
    body:'Manager is the console for your whole fleet of self-improving Claude Code projects. This 60-second tour shows the essentials — you can replay it any time from Settings.' },
  { sel:'.rail-brand', title:'The rail', icon:'compass', open:true,
    body:'Everything lives on this rail. Drag its edge to resize, or collapse it for focus. On mobile it becomes a drawer.' },
  { sel:'.tile', title:'Project tiles', icon:'grid',
    body:'Each tile is one project: its status, when it last shipped (in CT), the latest version, and a short assessment. The buttons jump to the live site, its what’s-new, and the Claude Code session you steer it from.' },
  { sel:'.wn-btn', title:'What’s new', icon:'sparkle',
    body:'This app improves itself hourly. Click here any time to see what shipped — searchable, filterable, and sortable.' },
  { sel:'.rail-item[data-sec="projects"]', title:'Your library', icon:'grid', open:true,
    body:'Filter, sort, search, pin, and edit every project — add your own metadata fields. This is the source of truth for the fleet.' },
  { sel:'.rail-item[data-sec="settings"]', title:'Make it yours', icon:'settings', open:true,
    body:'Themes, Simple mode for a calmer view, credentials, and this tour all live in Settings. You’re ready — welcome aboard.' },
];

export function startTour(steps=MANAGER_TOUR, { onDone, setRailOpen }={}){
  let i = 0;
  const veil = el('div',{class:'tour-veil'});
  const spot = el('div',{class:'tour-spot'});
  const pop  = el('div',{class:'tour-pop'});
  document.body.append(veil, spot, pop);
  requestAnimationFrame(()=>{ veil.classList.add('show'); });

  function render(){
    const step = steps[i];
    if(step.open && setRailOpen) setRailOpen(true);
    const target = step.sel ? document.querySelector(step.sel) : null;
    // spotlight
    if(target){
      const r = target.getBoundingClientRect();
      const pad = 8;
      spot.style.opacity='1';
      spot.style.left = (r.left-pad)+'px';
      spot.style.top = (r.top-pad)+'px';
      spot.style.width = (r.width+pad*2)+'px';
      spot.style.height = (r.height+pad*2)+'px';
      try{ target.scrollIntoView({ block:'nearest', behavior:'smooth' }); }catch{}
    }else{
      spot.style.opacity='0';
      spot.style.width=spot.style.height='0px';
      spot.style.left='50%'; spot.style.top='50%';
    }
    // popover content
    pop.innerHTML = `<h3>${icon(step.icon||'sparkle')} ${step.title}</h3><p>${step.body}</p>`;
    const foot = el('div',{class:'tour-foot'});
    const dots = el('div',{class:'tour-dots'});
    steps.forEach((_,k)=>dots.append(el('i',{class:k===i?'on':''})));
    foot.append(dots);
    if(i>0) foot.append(el('button',{class:'btn sm', text:'Back', onclick:()=>{ i--; render(); }}));
    foot.append(el('button',{class:'btn sm ghost', text:'Skip', onclick:finish}));
    foot.append(el('button',{class:'btn sm primary', text:i===steps.length-1?'Done':'Next',
      onclick:()=>{ if(i===steps.length-1) finish(); else { i++; render(); } }}));
    pop.append(foot);
    positionPop(target);
    requestAnimationFrame(()=>pop.classList.add('show'));
  }

  function positionPop(target){
    const pr = pop.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 14;
    let left, top;
    if(target){
      const r = target.getBoundingClientRect();
      // prefer to the right, else below, else above, else left
      if(r.right + pr.width + m < vw){ left=r.right+m; top=r.top; }
      else if(r.bottom + pr.height + m < vh){ left=Math.min(r.left, vw-pr.width-m); top=r.bottom+m; }
      else if(r.top - pr.height - m > 0){ left=Math.min(r.left, vw-pr.width-m); top=r.top-pr.height-m; }
      else { left=Math.max(m, r.left-pr.width-m); top=r.top; }
    }else{
      left=(vw-pr.width)/2; top=(vh-pr.height)/2;
    }
    pop.style.left = Math.max(m, Math.min(left, vw-pr.width-m))+'px';
    pop.style.top  = Math.max(m, Math.min(top,  vh-pr.height-m))+'px';
  }

  function finish(){
    document.removeEventListener('keydown', key);
    window.removeEventListener('resize', onResize);
    veil.classList.remove('show'); pop.classList.remove('show');
    setTimeout(()=>{ veil.remove(); spot.remove(); pop.remove(); },260);
    onDone && onDone();
  }
  function key(e){ if(e.key==='Escape') finish(); else if(e.key==='ArrowRight'){ if(i<steps.length-1){ i++; render(); } } else if(e.key==='ArrowLeft'&&i>0){ i--; render(); } }
  function onResize(){ const step=steps[i]; positionPop(step.sel?document.querySelector(step.sel):null); }
  document.addEventListener('keydown', key);
  window.addEventListener('resize', onResize);
  render();
  return { finish };
}
