// "What's new" — a searchable, filterable, sortable changelog sheet for
// Manager itself. Which attributes show (version / date / kind / bullets) and
// the default sort are customizable in Settings.
import { CHANGELOG, LATEST_VERSION } from '../changelog.js';
import { Store } from '../store.js';
import { el, escapeHtml, fmtCT } from '../ui.js';
import { icon } from '../icons.js';

const SEEN_KEY = 'manager.whatsnew.seen';

export function hasUnread(){
  let seen=0; try{ seen=parseInt(localStorage.getItem(SEEN_KEY)||'0',10); }catch{}
  return LATEST_VERSION > seen;
}
export function markSeen(){ try{ localStorage.setItem(SEEN_KEY, String(LATEST_VERSION)); }catch{} }

export function openWhatsNew(){
  const settings=Store.settings();
  const tracked=settings.wnTracked||{version:true,date:true,kind:true,items:true};
  let sort=settings.wnSort||'newest';
  let kind='all';
  let query='';

  const overlay=el('div',{class:'sheet-overlay'});
  const sheet=el('div',{class:'sheet', role:'dialog', 'aria-label':"What's new"});

  const head=el('div',{class:'sheet-head'});
  head.innerHTML=`<div><h3>What’s new</h3>
    <div class="muted tiny">Manager · v${LATEST_VERSION} · ${CHANGELOG.length} release${CHANGELOG.length!==1?'s':''}</div></div>`;
  head.append(el('button',{class:'btn ghost sm', text:'Close', onclick:()=>hide()}));

  // search
  const search=el('div',{class:'search', style:'margin:10px 20px 4px'});
  const input=el('input',{class:'input', placeholder:'Search updates…', spellcheck:'false'});
  search.append(el('span',{html:icon('search')}), input);

  // filter + sort tools
  const tools=el('div',{class:'sheet-tools'});
  const kinds=['all','feature','polish','fix'];
  const kindChips=el('div',{style:'display:flex;gap:6px;flex-wrap:wrap'});
  kinds.forEach(k=>{
    const c=el('button',{class:'filter-chip'+(k===kind?' on':''), text:k[0].toUpperCase()+k.slice(1),
      onclick:()=>{ kind=k; [...kindChips.children].forEach(x=>x.classList.remove('on')); c.classList.add('on'); render(); }});
    kindChips.append(c);
  });
  const sortBtn=el('button',{class:'btn sm', html:`${icon('sort')} <span>${sort==='newest'?'Newest':'Oldest'}</span>`,
    onclick:()=>{ sort=sort==='newest'?'oldest':'newest'; sortBtn.querySelector('span').textContent=sort==='newest'?'Newest':'Oldest'; render(); }});
  tools.append(kindChips, el('span',{style:'flex:1'}), sortBtn);

  const list=el('div',{class:'sheet-body'});
  function render(){
    list.innerHTML='';
    const needle=query.trim().toLowerCase();
    let rows=CHANGELOG.filter(e=>{
      if(kind!=='all' && (e.kind||'feature')!==kind) return false;
      if(!needle) return true;
      return e.title.toLowerCase().includes(needle) || (e.items||[]).some(i=>i.toLowerCase().includes(needle));
    });
    rows=rows.slice().sort((a,b)=> sort==='newest' ? b.v-a.v : a.v-b.v);
    if(!rows.length){ list.append(el('div',{class:'empty muted', text:'No updates match.'})); return; }
    rows.forEach(e=>{
      const entry=el('div',{class:'wn-entry'});
      const top=el('div',{class:'wn-top'});
      if(tracked.version!==false) top.append(el('span',{class:'wn-badge', text:'v'+e.v}));
      top.append(el('b',{text:e.title}));
      if(tracked.kind!==false && e.kind) top.append(el('span',{class:'wn-kind', text:e.kind}));
      entry.append(top);
      if(tracked.date!==false) entry.append(el('div',{class:'wn-date', text:fmtCT(e.ts)}));
      if(tracked.items!==false && e.items?.length){
        const ul=el('ul'); e.items.forEach(i=>ul.append(el('li',{text:i}))); entry.append(ul);
      }
      list.append(entry);
    });
  }
  render();
  input.addEventListener('input',()=>{ query=input.value; render(); });

  sheet.append(head, search, tools, list);
  overlay.append(sheet);
  overlay.addEventListener('mousedown',e=>{ if(e.target===overlay) hide(); });
  document.body.append(overlay);
  requestAnimationFrame(()=>overlay.classList.add('show'));
  markSeen();

  function hide(){ overlay.classList.remove('show'); setTimeout(()=>overlay.remove(),240); document.removeEventListener('keydown',esc); }
  function esc(e){ if(e.key==='Escape') hide(); }
  document.addEventListener('keydown',esc);
  setTimeout(()=>input.focus(),60);
  return { hide };
}
