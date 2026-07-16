// -----------------------------------------------------------------------
// views/datasource.js — the Admin "Data source" card + the connect flow.
//
// Renders where the workspace currently lives (Local / a remote, with live
// status), and drives the connect wizard the user described:
//   pick a backend → enter credentials → inspect the database →
//     • empty      → create every object, copy this workspace up, connect
//     • ours        → summarise what's there, load it and adopt it
//     • foreign     → warn; optionally drop everything and set up fresh
// All of it is generic over the sources/ registry — no backend is special-
// cased here, so new adapters light up automatically.
// -----------------------------------------------------------------------

import { el, escapeHtml, toast, modal, confirmDialog, fmtCT } from '../ui.js';
import { icon } from '../icons.js';
import { SOURCES, REMOTE_SOURCES, sourceById } from '../sources/index.js';
import { describeContents } from '../sources/base.js';
import { Store } from '../store.js';
import { syncState, onSync, connectAdopt, connectPush, disconnect, pullNow, currentConfig,
         secretsState, enableSecrets, unlockSecrets, disableSecrets } from '../sync.js';

const STATUS_LABEL = {
  local:'Local only', connecting:'Connecting…', connected:'Connected',
  syncing:'Syncing…', error:'Sync error',
};
const STATUS_CLS = {
  local:'s-idea', connecting:'s-building', connected:'s-live', syncing:'s-active', error:'s-paused',
};

// The card shown in Admin. Re-renders itself on every sync state change.
export function renderDataSourceCard(host, ctx){
  const card = el('div',{class:'card ds-card', style:'margin-top:16px'});
  host.append(card);
  const paint = ()=>{
    const st = syncState();
    const src = st.source;
    card.innerHTML = `<div class="section-title" style="margin-top:0"><span style="color:var(--brand-b);display:inline-flex">${icon('db')}</span><h2 style="font-size:14px">Data source</h2></div>
      <p class="muted tiny">Where this workspace’s data lives. Connect a database to reach the same data from any browser — and to back the fleet behind dashboards and other Polecat apps. <b>Credentials are stored in this browser only.</b></p>`;
    const row = el('div',{class:'ds-current'});
    row.innerHTML = `<span class="ds-dot" style="background:${src.accent||'var(--brand-b)'}"></span>
      <div class="ds-cur-main">
        <div class="ds-cur-name">${escapeHtml(src.label)} <span class="status ${STATUS_CLS[st.status]||'s-idea'}" style="margin-left:6px"><span class="dot"></span>${STATUS_LABEL[st.status]||st.status}</span></div>
        <div class="muted tiny">${st.isRemote
          ? (st.status==='error'
             ? escapeHtml(st.lastError||'sync error')
             : `Changes save here automatically${st.lastPushAt?` · last synced ${escapeHtml(fmtCT(st.lastPushAt))}`:''}`)
          : 'Fast and private — but only on this device.'}</div>
      </div>`;
    const actions = el('div',{class:'ds-actions'});
    if(st.isRemote){
      // Writes mirror up automatically, so there's no "push" button — the one
      // thing automation can't do is notice a change made from ANOTHER browser
      // (there's no live subscription), so the manual action is a PULL.
      actions.append(el('button',{class:'btn sm', html:`${icon('download')} Refresh`,
        title:`Pull the latest from ${src.label} — e.g. after editing from another browser. Your changes here already save automatically.`,
        onclick:async(e)=>{ e.target.disabled=true; const r=await pullNow(); toast(r.status==='error'?'Refresh failed':'Refreshed from source',{kind:r.status==='error'?'err':'ok', body:r.status==='error'?r.lastError:''}); ctx?.refresh?.(); }}));
      actions.append(el('button',{class:'btn sm', html:`${icon('edit')} Edit`,
        title:'Update this connection’s credentials', onclick:()=>openConnectFlow(ctx, { editSource:src, editCfg:currentConfig() })}));
      actions.append(el('button',{class:'btn sm', html:`${icon('x')} Disconnect`, onclick:async()=>{
        if(await confirmDialog({ title:'Disconnect data source', message:`Stop mirroring to ${src.label} and go back to local-only? Your current data stays in this browser; the remote copy is left untouched.`, okText:'Disconnect' })){
          disconnect(); toast('Back to local',{kind:'ok'}); ctx?.refresh?.();
        }
      }}));
    }
    actions.append(el('button',{class:'btn sm primary', html:`${icon('plus')} ${st.isRemote?'Switch source':'Connect a data source'}`, onclick:()=>openConnectFlow(ctx)}));
    row.append(actions);
    card.append(row);
    if(st.isRemote) card.append(secretsRow(src, ctx));
  };
  paint();
  // live-update while the card is on screen; self-unsubscribe once a later
  // admin re-render has swapped this card out of the DOM (no teardown hook to
  // rely on, so we prune on the next sync event instead of leaking listeners).
  const off = onSync(()=>{ if(!card.isConnected){ off(); return; } paint(); });
  return card;
}

// At-rest encryption control for the connected source: encrypt the
// credentials vault before it's stored on the remote, keyed by a passphrase
// that never leaves this browser.
function secretsRow(src, ctx){
  const sec = secretsState();
  const row = el('div',{class:'ds-secrets'});
  if(!sec.available){
    row.innerHTML = `<span class="ds-sec-ic">${icon('lock')}</span><div class="ds-sec-main"><b>Secret encryption</b><div class="muted tiny">Not supported in this browser.</div></div>`;
    return row;
  }
  const state = sec.locked ? 'locked' : (sec.enabled ? 'on' : 'off');
  const copy = {
    off:   { title:'Secrets stored as plaintext', sub:`Your credential values are written to ${escapeHtml(src.label)} unencrypted. Turn on encryption to store them as ciphertext only.`, cls:'' },
    on:    { title:'Secrets encrypted', sub:'Credential values are AES-encrypted before they’re stored here. The passphrase stays in this browser.', cls:'on' },
    locked:{ title:'Secrets locked', sub:'This workspace’s credentials are encrypted. Enter the passphrase to read and edit them on this browser.', cls:'locked' },
  }[state];
  row.className = 'ds-secrets '+copy.cls;
  row.innerHTML = `<span class="ds-sec-ic">${icon('lock')}</span>
    <div class="ds-sec-main"><b>${copy.title}</b><div class="muted tiny">${copy.sub}</div></div>`;
  const act = el('div',{class:'ds-sec-act'});
  if(state==='off'){
    act.append(el('button',{class:'btn sm', html:`${icon('lock')} Encrypt secrets…`, onclick:()=>passphrasePrompt({
      title:'Encrypt secrets', label:'New passphrase', confirm:true, cta:'Encrypt & upload',
      note:`Credential values will be encrypted before they’re stored on ${escapeHtml(src.label)}. Keep this passphrase safe — it’s the only way to read them, and it’s never stored on the server. If you lose it, the encrypted secrets can’t be recovered.`,
      onSubmit:async(p)=>{ await enableSecrets(p); toast('Secrets encrypted',{kind:'ok'}); ctx?.refresh?.(); } })}));
  }else if(state==='locked'){
    act.append(el('button',{class:'btn sm primary', html:`${icon('key')} Unlock`, onclick:()=>passphrasePrompt({
      title:'Unlock secrets', label:'Passphrase', cta:'Unlock',
      note:'Enter the passphrase this workspace’s secrets were encrypted with.',
      onSubmit:async(p)=>{ await unlockSecrets(p); toast('Secrets unlocked',{kind:'ok'}); ctx?.refresh?.(); } })}));
  }else{
    act.append(el('button',{class:'btn sm', html:`${icon('x')} Turn off`, onclick:async()=>{
      if(await confirmDialog({ title:'Turn off encryption', message:`Store credential values on ${src.label} as plaintext again? They’ll be re-uploaded unencrypted.`, danger:true, okText:'Turn off' })){
        await disableSecrets(); toast('Encryption off',{kind:'ok'}); ctx?.refresh?.();
      }
    }}));
  }
  row.append(act);
  return row;
}

function passphrasePrompt({ title, label, note, cta, confirm=false, onSubmit }){
  const body = el('div');
  if(note) body.append(el('p',{class:'muted tiny', style:'margin-top:0', html:note}));
  const p1 = el('input',{class:'input', type:'password', placeholder:'Passphrase', autocomplete:'new-password', spellcheck:'false'});
  const f1 = el('div',{class:'field'}); f1.append(el('label',{text:label}), p1); body.append(f1);
  let p2;
  if(confirm){ p2 = el('input',{class:'input', type:'password', placeholder:'Repeat passphrase', autocomplete:'new-password', spellcheck:'false'});
    const f2 = el('div',{class:'field'}); f2.append(el('label',{text:'Confirm passphrase'}), p2); body.append(f2); }
  const status = el('div',{class:'ds-status tiny', style:'margin-top:8px'});
  body.append(status);
  const go = el('button',{class:'btn primary', text:cta||'OK', onclick:async()=>{
    const v = p1.value; if(!v){ status.innerHTML='<span class="sync-err">Enter a passphrase.</span>'; return; }
    if(confirm && v!==p2.value){ status.innerHTML='<span class="sync-err">Passphrases don’t match.</span>'; return; }
    go.disabled=true; status.textContent='Working…';
    try{ await onSubmit(v); hide(); }
    catch(e){ go.disabled=false; status.innerHTML=`<span class="sync-err">${escapeHtml(e.message||'Failed')}</span>`; }
  }});
  const { hide } = modal({ title, icon:icon('lock'), body, foot:[el('button',{class:'btn', text:'Cancel', onclick:()=>hide()}), go] });
  setTimeout(()=>p1.focus(), 40);
}

// ---- the connect wizard --------------------------------------------------
export function openConnectFlow(ctx, opts={}){
  const editing = !!opts.editSource;
  const body = el('div',{class:'ds-flow'});
  const { hide } = modal({ title:editing?'Edit data source':'Connect a data source', icon:icon('db'), body, wide:true });
  // edit mode jumps straight to the chosen source's form, pre-filled
  if(editing) formStep(opts.editSource, opts.editCfg||{}); else pickStep();

  function render(node){ body.innerHTML=''; body.append(node); }

  // step 1 — choose a backend
  function pickStep(){
    const wrap = el('div');
    wrap.append(el('p',{class:'muted tiny', style:'margin-top:0', text:'Pick where to store this workspace. The same data becomes reachable from any browser you connect with these credentials.'}));
    const grid = el('div',{class:'ds-grid'});
    REMOTE_SOURCES.forEach(src=>{
      const c = el('button',{class:'ds-opt', onclick:()=>formStep(src)});
      c.innerHTML = `<span class="ds-opt-ic" style="color:${src.accent}">${icon(src.icon)}</span>
        <span class="ds-opt-main"><b>${escapeHtml(src.label)}</b>
          <span class="muted tiny">${escapeHtml(src.blurb)}</span>
          ${src.browserProvision?'':'<span class="ds-tag">one-time SQL setup</span>'}</span>
        <span class="ds-opt-go">${icon('chevron')}</span>`;
      grid.append(c);
    });
    wrap.append(grid);
    render(wrap);
  }

  // step 2 — credentials for the chosen backend (prefill = edit mode)
  function formStep(src, prefill){
    const wrap = el('div');
    if(!editing) wrap.append(el('button',{class:'btn ghost sm', html:`<span class="flip-x">${icon('chevron')}</span> Back`, style:'margin-bottom:8px', onclick:pickStep}));
    const head = el('div',{class:'ds-form-head'});
    head.innerHTML = `<span class="ds-opt-ic" style="color:${src.accent}">${icon(src.icon)}</span><div><b>${escapeHtml(src.label)}</b><div class="muted tiny">${escapeHtml(src.blurb)}</div></div>`;
    wrap.append(head);
    const inputs = {};
    src.fields.forEach(f=>{
      const field = el('div',{class:'field'});
      field.append(el('label',{text:f.label}));
      const input = el('input',{class:'input mono', type:f.type==='password'?'password':'text', placeholder:f.placeholder||'', spellcheck:'false', autocomplete:'off', value:(prefill&&prefill[f.key])||''});
      inputs[f.key]=input;
      field.append(input);
      if(f.hint) field.append(el('div',{class:'tiny muted', style:'margin-top:4px', html:escapeHtml(f.hint)}));
      wrap.append(field);
    });
    if(src.docsUrl) wrap.append(el('a',{class:'link tiny', href:src.docsUrl, target:'_blank', rel:'noopener', text:'Where do I find these? →'}));
    const status = el('div',{class:'ds-status tiny', style:'margin-top:10px'});
    const inspect = el('button',{class:'btn primary', style:'margin-top:12px', html:`${icon('search')} Inspect database`, onclick:async()=>{
      const cfg={}; src.fields.forEach(f=>cfg[f.key]=inputs[f.key].value.trim());
      const missing = src.fields.find(f=>!cfg[f.key]);
      if(missing){ status.innerHTML=`<span class="sync-err">Enter the ${escapeHtml(missing.label)} first.</span>`; return; }
      inspect.disabled=true; status.innerHTML='Connecting and inspecting…';
      try{
        const probe = await src.probe(cfg);
        resultStep(src, cfg, probe);
      }catch(e){
        status.innerHTML=`<span class="sync-err">${escapeHtml(e.message||'Could not connect')}</span>`;
      }finally{ inspect.disabled=false; }
    }});
    wrap.append(inspect, status);
    render(wrap);
    setTimeout(()=>inputs[src.fields[0]?.key]?.focus(), 40);
  }

  // step 3 — classify + act
  function resultStep(src, cfg, probe){
    const wrap = el('div');
    wrap.append(el('button',{class:'btn ghost sm', html:`<span class="flip-x">${icon('chevron')}</span> Back`, style:'margin-bottom:8px', onclick:()=>formStep(src)}));
    const box = el('div',{class:'ds-result'});
    const status = el('div',{class:'ds-status tiny', style:'margin-top:12px'});
    const foreignApp = probe.state==='polecat' && probe.app && probe.app!=='manager';

    const busy = (msg)=>{ status.innerHTML=escapeHtml(msg); [...wrap.querySelectorAll('button')].forEach(b=>b.disabled=true); };
    const fail = (msg)=>{ status.innerHTML=`<span class="sync-err">${escapeHtml(msg)}</span>`; [...wrap.querySelectorAll('button')].forEach(b=>b.disabled=false); };
    const done = (label)=>{ toast(label,{kind:'ok'}); hide(); ctx?.refresh?.(); };

    if(foreignApp){
      box.className='ds-result warn';
      box.innerHTML=`<div class="ds-res-h">${icon('warning')} A different Polecat app’s workspace</div>
        <p class="muted tiny">This database belongs to Polecat app <b>${escapeHtml(probe.app)}</b> (schema v${probe.schemaVersion||'?'}), not Manager. Connecting would mix two apps’ data. Point Manager at its own database instead.</p>`;
      wrap.append(box);
      render(wrap); return;
    }

    if(probe.state==='polecat'){
      box.className='ds-result ok';
      box.innerHTML=`<div class="ds-res-h">${icon('check')} Found a Manager workspace</div>
        <p class="muted tiny">Schema v${probe.schemaVersion||1} · ${escapeHtml(describeContents(probe))}. Connecting loads this workspace and makes it the source of truth — your current local data is replaced by what’s here.</p>`;
      const load = el('button',{class:'btn primary', html:`${icon('download')} Connect &amp; load this workspace`, onclick:async()=>{
        busy('Loading workspace…');
        try{ await connectAdopt(src.id, cfg); done(`Connected to ${src.label}`); }
        catch(e){ fail(e.message||'Could not load'); }
      }});
      const reset = el('button',{class:'btn sm danger', style:'margin-left:8px', html:`${icon('trash')} Reset &amp; overwrite`, onclick:async()=>{
        if(!await confirmDialog({ title:'Overwrite remote workspace', message:`Destroy everything in this ${src.label} database and replace it with your current local workspace? This cannot be undone.`, danger:true, okText:'Overwrite' })) return;
        busy('Dropping and recreating…');
        try{ await resetAndPush(src, cfg); done(`Set up fresh on ${src.label}`); }
        catch(e){ fail(e.message||'Could not reset'); }
      }});
      const foot = el('div',{style:'margin-top:14px'}); foot.append(load, reset);
      wrap.append(box, foot, status);
      render(wrap); return;
    }

    if(probe.state==='foreign'){
      box.className='ds-result warn';
      box.innerHTML=`<div class="ds-res-h">${icon('warning')} This database isn’t empty</div>
        <p class="muted tiny">It already has objects that aren’t Manager’s: <b>${escapeHtml((probe.tables||[]).map(t=>t.name).join(', ')||'unknown tables')}</b>. Manager won’t touch a database it doesn’t recognise. Use an empty database, or drop everything here first.</p>`;
      const drop = el('button',{class:'btn danger', style:'margin-top:12px', html:`${icon('trash')} Drop everything &amp; set up here`, onclick:async()=>{
        if(!await confirmDialog({ title:'Destroy existing data', message:`This permanently drops ALL existing objects in this ${src.label} database, then creates Manager’s. Everything currently there is lost. Continue?`, danger:true, okText:'Drop everything' })) return;
        busy('Dropping existing objects…');
        try{ await resetAndPush(src, cfg); done(`Set up on ${src.label}`); }
        catch(e){ fail(e.message||'Could not set up'); }
      }});
      wrap.append(box, drop, status);
      render(wrap); return;
    }

    // empty → provision + push
    box.className='ds-result ok';
    if(src.browserProvision){
      box.innerHTML=`<div class="ds-res-h">${icon('sparkle')} Empty database — ready to set up</div>
        <p class="muted tiny">Manager will create all its objects here and copy your current workspace (${Store.projects().length} projects) up. Then every change mirrors here automatically.</p>`;
      const go = el('button',{class:'btn primary', style:'margin-top:12px', html:`${icon('rocket')} Create objects &amp; connect`, onclick:async()=>{
        busy('Creating objects and uploading…');
        try{
          const pr = await src.provision(cfg, Store.snapshot());
          if(pr.ok===false) throw new Error(pr.error||'Could not create objects');
          await connectPush(src.id, cfg);
          done(`Connected to ${src.label}`);
        }catch(e){ fail(e.message||'Could not set up'); }
      }});
      wrap.append(box, go, status);
    }else{
      // manual provisioning (Supabase): show the SQL, then re-probe
      const pr_promise = src.provision(cfg, Store.snapshot());
      box.innerHTML=`<div class="ds-res-h">${icon('sparkle')} Empty database — one-time SQL setup</div>
        <p class="muted tiny">${escapeHtml(src.label)} can’t create tables from the browser. Copy the script below into its SQL editor and run it once, then come back and continue — after that, all reads and writes happen here automatically.</p>`;
      const code = el('textarea',{class:'input mono', rows:'7', readonly:'', spellcheck:'false'});
      pr_promise.then(pr=>{ code.value = pr.sql || ''; });
      const copy = el('button',{class:'btn sm', style:'margin-top:8px', html:`${icon('copy')} Copy SQL`, onclick:()=>navigator.clipboard?.writeText(code.value).then(()=>toast('SQL copied',{kind:'ok'}))});
      const cont = el('button',{class:'btn primary', style:'margin-top:12px;margin-left:8px', html:`${icon('check')} I’ve run it — continue`, onclick:async()=>{
        busy('Verifying and uploading…');
        try{
          const re = await src.probe(cfg);
          if(re.state!=='polecat'){ fail('Still don’t see Manager’s tables — did the script run without errors?'); return; }
          await connectPush(src.id, cfg);
          done(`Connected to ${src.label}`);
        }catch(e){ fail(e.message||'Could not verify'); }
      }});
      wrap.append(box, code, el('div',null), copy, cont, status);
    }
    render(wrap);
  }

  // drop everything on the remote, recreate, and push the current workspace up
  async function resetAndPush(src, cfg){
    const dr = await src.drop(cfg);
    if(dr && dr.ok===false) throw new Error(dr.error||'drop failed');
    const pr = await src.provision(cfg, Store.snapshot());
    if(pr && pr.ok===false && !pr.manual) throw new Error(pr.error||'provision failed');
    await connectPush(src.id, cfg);
  }
}
