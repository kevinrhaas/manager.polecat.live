// Credentials & config — set shared secrets once (global) or per-project.
// Values live only in this browser's localStorage (design maps to a future
// encrypted SQLite table). Masked by default; never sent anywhere.
import { Store } from '../store.js';
import { el, escapeHtml, toast, modal, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { isEnvelope } from '../crypto.js';

export function renderCredentials(root, ctx){
  root.innerHTML='';
  const wrap=el('div',{class:'wrap view-in'});

  const head=el('div',{class:'section-title', style:'margin-top:0'});
  head.innerHTML=`<span style="color:var(--brand-b);display:inline-flex">${icon('key')}</span><h2>Credentials &amp; config</h2>`;
  head.append(el('span',{class:'sp'}));
  head.append(el('button',{class:'btn sm primary', html:`${icon('plus')} Add`, onclick:()=>editCred(null, ctx)}));
  wrap.append(head);

  wrap.append(el('div',{class:'callout', html:`${icon('lock')}<div>Set a value <b>once as global</b> and it’s available to every project; scope it to a project when it differs. By default values live only in this browser — connect a <b>data source</b> (Admin) to reach them elsewhere, and turn on <b>Encrypt secrets</b> there to store them as ciphertext, never plaintext, on the database.</div>`}));

  // global
  wrap.append(el('div',{class:'section-title', html:`<h2 style="font-size:13px">Shared · global</h2>`}));
  wrap.append(credGroup(Store.credentials('global'), ctx, 'No shared credentials yet.'));

  // per project
  Store.projects().forEach(p=>{
    const list=Store.credentials(p.id);
    if(!list.length) return;
    wrap.append(el('div',{class:'section-title', html:`<h2 style="font-size:13px">${escapeHtml(p.name)}</h2>`}));
    wrap.append(credGroup(list, ctx));
  });

  root.append(wrap);
}

function credGroup(list, ctx, emptyMsg){
  if(!list.length) return el('div',{class:'card muted tiny', text:emptyMsg||'None.'});
  const g=el('div',{class:'grid', style:'gap:8px'});
  list.forEach(c=>g.append(credRow(c, ctx)));
  return g;
}

function credRow(c, ctx){
  // A value is "locked" when it's an encrypted envelope this browser can't
  // read yet — the workspace has at-rest encryption on and hasn't been
  // unlocked here. Show a lock, not a crash, and point at where to unlock.
  const locked = isEnvelope(c.value);
  let shown=false;
  const row=el('div',{class:'card cred-row'+(locked?' cred-locked':'')});
  const val=el('span',{class:'mono tiny', style:'color:var(--text-2)'});
  const setVal=()=>{
    if(locked){ val.innerHTML=`<span class="cred-lock">${icon('lock')} Encrypted — unlock in Admin → Data source</span>`; return; }
    val.textContent = shown ? (c.value||'—') : '•'.repeat(Math.min(14,(c.value||'').length||6));
  };
  setVal();
  row.innerHTML=`<span class="qicon" style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,var(--brand-b),var(--consensus));color:#05121a">${icon(locked?'lock':'key')}</span>`;
  const mid=el('div',{class:'cred-row-mid'});
  mid.innerHTML=`<b>${escapeHtml(c.name||c.key||'Credential')}</b> ${c.key?`<span class="tiny mono muted">${escapeHtml(c.key)}</span>`:''}${c.note?`<div class="tiny muted">${escapeHtml(c.note)}</div>`:''}`;
  const valWrap=el('div',{style:'margin-top:2px'}); valWrap.append(val); mid.append(valWrap);
  row.append(mid);
  const actions=el('div',{class:'cred-row-actions'});
  if(!locked){
    actions.append(el('button',{class:'btn ghost icon sm', title:'Reveal', 'aria-label':'Reveal value', html:icon('eye'), onclick:()=>{ shown=!shown; setVal(); }}));
    actions.append(el('button',{class:'btn ghost icon sm', title:'Copy', 'aria-label':'Copy value', html:icon('copy'), onclick:()=>navigator.clipboard?.writeText(c.value||'').then(()=>toast('Copied',{kind:'ok'}))}));
  }
  actions.append(el('button',{class:'btn ghost icon sm', title:locked?'Edit (locked)':'Edit', 'aria-label':'Edit credential', html:icon('edit'), disabled:locked, onclick:()=>editCred(c.id, ctx)}));
  row.append(actions);
  return row;
}

function editCred(id, ctx){
  const c = id ? Store.get('credentials', id) : null;
  const isNew=!c;
  const name=el('input',{class:'input', placeholder:'OpenAI API key', value:c?.name||''});
  const scope=el('select',{class:'input'});
  scope.append(el('option',{value:'global',text:'Shared · global'}));
  Store.projects().forEach(p=>scope.append(el('option',{value:p.id,text:p.name,selected:c?.scope===p.id})));
  scope.value=c?.scope||'global';
  const key=el('input',{class:'input mono', placeholder:'ENV_VAR_NAME (optional)', value:c?.key||''});
  const value=el('textarea',{class:'input mono', rows:'2', placeholder:'the secret / value', value:c?.value||''});
  const note=el('input',{class:'input', placeholder:'note (optional)', value:c?.note||''});
  const body=el('div');
  const f=(l,n)=>{ const w=el('div',{class:'field'}); w.append(el('label',{text:l}), n); return w; };
  body.append(f('Name', name), f('Scope', scope), f('Env var / key', key), f('Value', value), f('Note', note));
  const save=el('button',{class:'btn primary', text:isNew?'Add':'Save', onclick:()=>{
    if(!name.value.trim()){ name.focus(); return; }
    const data={ name:name.value.trim(), scope:scope.value, key:key.value.trim(), value:value.value, note:note.value.trim() };
    if(isNew) Store.addCredential(data); else Store.put('credentials',{...c,...data},{label:'Edit credential'});
    hide(); toast(isNew?'Credential added':'Saved',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('credentials');
  }});
  const foot=[ el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}) ];
  if(!isNew) foot.unshift(el('button',{class:'btn danger', html:`${icon('trash')} Delete`, onclick:async()=>{
    if(await confirmDialog('Delete credential', `Remove "${c.name}"?`, {danger:true, okLabel:'Delete'})){ Store.remove('credentials',id); hide(); toast('Deleted',{kind:'ok', action:{label:'Undo', fn:()=>Store.undo()}}); ctx.go('credentials'); }
  }}));
  foot.push(save);
  const {hide}=modal({ title:isNew?'Add credential':'Edit credential', icon:'key', body, foot });
  setTimeout(()=>name.focus(),50);
}
