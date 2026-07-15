// -----------------------------------------------------------------------
// shortcuts.js — app keyboard shortcuts + the `?` cheat-sheet panel.
//
// Ported from JobTracker's shortcuts.js (which was reference-only, with the
// keydown wiring inlined in app.js) and parameterized for the fleet: apps
// register their OWN bindings and the shell handles the keydown dispatch,
// the typing guard, and the cheat-sheet rendering — one registration feeds
// both. The panel keeps JobTracker's class names (shortcuts-list,
// sc-group-title, sc-row, sc-keys, sc-label, kbd) via the shared modal().
//
//   registerShortcuts([
//     { group:'Navigate', combo:'/',           label:'Search',  handler:openSearch },
//     { group:'Navigate', combo:'mod+k',       label:'Command palette', handler:… },
//     { group:'Edit',     combo:'mod+shift+z', label:'Redo',    handler:doRedo },
//     // docs-only rows (no combo/handler) still show in the sheet:
//     { group:'Board',    keys:['↑','↓'],      label:'Move through cards' },
//   ])
//   // or map form: registerShortcuts({ 'mod+k': { group, label, handler } })
//
// Combos: '+'-separated — 'mod' (⌘ or Ctrl), 'shift', 'alt', then an e.key
// name ('k', '/', '?', 'escape', 'arrowup'…). '?' is auto-bound to the
// cheat sheet on first registration (pass {help:false} to opt out).
// registerShortcuts returns an unregister() for its entries.
// -----------------------------------------------------------------------
import { el, modal } from './ui.js';
import { icon } from './icons.js';

const registry = [];      // ordered: [{ group, keys, label, combo, handler, whileTyping }]
let listening = false;
let helpBound = false;

// ---- combo parsing / matching -------------------------------------------
function parseCombo(str){
  const c = { mod:false, shift:false, alt:false, key:'' };
  for(const part of String(str).split('+')){
    const p = part.trim().toLowerCase();
    if(p==='mod' || p==='cmd' || p==='ctrl' || p==='meta') c.mod = true;
    else if(p==='shift') c.shift = true;
    else if(p==='alt' || p==='option') c.alt = true;
    else c.key = p;
  }
  return c;
}

function matches(e, c){
  if(!c.key || e.key.toLowerCase()!==c.key) return false;
  if(c.mod !== (e.metaKey || e.ctrlKey)) return false;
  if(c.alt !== e.altKey) return false;
  // For plain letter/digit keys Shift distinguishes bindings (mod+z vs
  // mod+shift+z must not both fire). Symbol keys like '?' already encode
  // Shift in e.key itself, so we don't second-guess the layout there.
  if(/^[a-z0-9]$/.test(c.key) && c.shift !== e.shiftKey) return false;
  return true;
}

// Pretty keycaps for the cheat sheet when the entry doesn't supply `keys`.
const KEY_DISPLAY = { escape:'Esc', arrowup:'↑', arrowdown:'↓', arrowleft:'←',
  arrowright:'→', enter:'Enter', backspace:'⌫', ' ':'Space', tab:'Tab' };
function displayKeys(c){
  const out = [];
  if(c.mod) out.push('⌘/Ctrl');
  if(c.shift) out.push('Shift');
  if(c.alt) out.push('Alt');
  if(c.key) out.push(KEY_DISPLAY[c.key] || (c.key.length===1 ? c.key.toUpperCase() : c.key));
  return out;
}

// ---- dispatch -------------------------------------------------------------
function onKeydown(e){
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
    || document.activeElement?.isContentEditable;
  for(const entry of registry){
    if(!entry.handler || !entry._combo) continue;
    if(typing && !entry.whileTyping) continue;
    if(matches(e, entry._combo)){ e.preventDefault(); entry.handler(e); return; }
  }
}

function ensureListener(){
  if(listening) return;
  listening = true;
  document.addEventListener('keydown', onKeydown);
}

// ---- registration ---------------------------------------------------------
// Accepts an array of entries or a { combo: handler|{…} } map (see header).
export function registerShortcuts(defs, { help=true }={}){
  let entries;
  if(Array.isArray(defs)) entries = defs.map(d=>({ ...d }));
  else entries = Object.entries(defs||{}).map(([combo, v])=>
    typeof v==='function' ? { combo, handler:v } : { combo, ...v });

  for(const entry of entries){
    entry.group = entry.group || 'Shortcuts';
    if(entry.combo){
      entry._combo = parseCombo(entry.combo);
      if(!entry.keys) entry.keys = displayKeys(entry._combo);
    }
    registry.push(entry);
  }

  // Bind `?` → cheat sheet once, so every app gets the panel for free.
  if(help && !helpBound){
    helpBound = true;
    registry.push({ group:'Help', combo:'?', _combo:parseCombo('?'),
      keys:['?'], label:'This shortcut sheet', handler:()=>openCheatSheet() });
  }
  ensureListener();

  return function unregister(){
    for(const entry of entries){
      const i = registry.indexOf(entry);
      if(i>=0) registry.splice(i,1);
    }
  };
}

// ---- the `?` cheat-sheet panel --------------------------------------------
// Purely a reference overlay: no state, no side effects beyond rendering a
// modal. Grouped so it doubles as a quick "what can this app do" primer.
function keycap(k){ return el('kbd',{text:k}); }

export function openCheatSheet(){
  // Group in first-appearance order so apps control the reading order.
  const groups = [];
  const byTitle = new Map();
  for(const entry of registry){
    if(!entry.label) continue;   // handler-only bindings stay undocumented
    let g = byTitle.get(entry.group);
    if(!g){ g = { title:entry.group, rows:[] }; byTitle.set(entry.group, g); groups.push(g); }
    g.rows.push(entry);
  }
  const body = el('div',{class:'shortcuts-list'});
  groups.forEach(g=>{
    body.append(el('div',{class:'sc-group-title muted tiny', text:g.title}));
    g.rows.forEach(entry=>{
      body.append(el('div',{class:'sc-row'},[
        el('div',{class:'sc-keys'}, (entry.keys||[]).map(keycap)),
        el('div',{class:'sc-label', text:entry.label}),
      ]));
    });
  });
  return modal({ title:'Keyboard shortcuts', icon:icon('bolt',20), body });
}
