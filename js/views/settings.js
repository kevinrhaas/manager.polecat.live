// Settings — theme, Simple mode, welcome tour, what's-new preferences,
// data (export/import/reset), and access.
import { Store } from '../store.js';
import { Access } from '../access.js';
import { getThemePref, setTheme } from '../theme.js';
import { el, escapeHtml, toast, confirmDialog } from '../ui.js';
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

  // ---- Data ----
  const data=card('Data', 'db');
  data.append(el('p',{class:'muted tiny', style:'margin:0 0 10px', text:'Everything lives in this browser. Export a JSON backup, import it elsewhere, or reset to the seeded fleet.'}));
  const dataBtns=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap'});
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('download')} Export JSON`, onclick:exportJSON}));
  dataBtns.append(el('button',{class:'btn sm', html:`${icon('upload')} Import JSON`, onclick:()=>importJSON(ctx)}));
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
    rd.onload=()=>{ try{ Store.importJSON(rd.result); toast('Workspace imported',{kind:'ok'}); ctx.go('home'); }
      catch(e){ toast('Import failed',{body:e.message,kind:'err'}); } };
    rd.readAsText(file); };
  inp.click();
}
