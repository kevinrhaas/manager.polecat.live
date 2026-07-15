// -----------------------------------------------------------------------
// settings.js — the shared settings framework + UI modes.
//
// Two jobs:
//   1. uiMode — the fleet-wide simple/standard/expert switch. 'simple' trims
//      chrome for newcomers (rail sections and settings fields declare
//      minMode); 'expert' reveals power tools. Extends the old boolean
//      simpleMode the template apps shipped.
//   2. defineSettings(schema) + renderSettings(mount) — declarative,
//      section-based settings pages so every app's Settings reads the same
//      way (the manager/jobtracker section pattern, minus the copy-paste).
//
// Schema shape:
//   defineSettings({
//     storageKey: 'app.settings',          // where field values persist
//     sections: [{
//       key, title, blurb?, minMode?, admin?,
//       fields: [{ key, label, hint?, type: 'toggle'|'select'|'text'|
//                  'number'|'custom', options?, def?, minMode?, admin?,
//                  render?(value, set) /* for type:'custom' */ }],
//     }],
//     get?(key), set?(key, value),         // override storage (e.g. a Store);
//                                          //   defaults to a JSON blob at
//                                          //   storageKey
//   })
// -----------------------------------------------------------------------

import { el, field, toast } from './ui.js';

export const UI_MODES = ['simple', 'standard', 'expert'];

let modeKey = 'polecat.uimode';
export function configureUiMode({ storageKey } = {}){ if(storageKey) modeKey = storageKey; }

export function getUiMode(){
  const m = localStorage.getItem(modeKey);
  return UI_MODES.includes(m) ? m : 'standard';
}

export function setUiMode(mode){
  if(!UI_MODES.includes(mode)) throw new Error(`unknown uiMode: ${mode}`);
  localStorage.setItem(modeKey, mode);
  document.documentElement.setAttribute('data-uimode', mode);
  window.dispatchEvent(new CustomEvent('polecat:uimode', { detail: { mode } }));
}

// True when `item` (a rail section, settings field, …) is visible at `mode`.
// Items without minMode show everywhere; admin items also need isAdmin.
export function visibleAt(item, mode = getUiMode(), isAdmin = false){
  if(item.admin && !isAdmin) return false;
  const min = item.minMode || 'simple';
  return UI_MODES.indexOf(mode) >= UI_MODES.indexOf(min);
}

// ---- declarative settings pages ----------------------------------------

let schema = null;

export function defineSettings(s){
  if(!s || !Array.isArray(s.sections)) throw new Error('defineSettings needs { sections }');
  schema = s;
  return schema;
}

function blobGet(key){
  try { return JSON.parse(localStorage.getItem(schema.storageKey) || '{}')[key]; }
  catch { return undefined; }
}
function blobSet(key, value){
  let all = {};
  try { all = JSON.parse(localStorage.getItem(schema.storageKey) || '{}'); } catch {}
  all[key] = value;
  localStorage.setItem(schema.storageKey, JSON.stringify(all));
}

function getVal(f){
  const g = schema.get || blobGet;
  const v = g(f.key);
  return v === undefined ? f.def : v;
}
function setVal(f, v){
  (schema.set || blobSet)(f.key, v);
  window.dispatchEvent(new CustomEvent('polecat:setting', { detail: { key: f.key, value: v } }));
}

function control(f){
  const v = getVal(f);
  if(f.type === 'custom') return f.render(v, nv => setVal(f, nv));
  if(f.type === 'toggle'){
    const b = el('button', { class: 'ps-toggle' + (v ? ' on' : ''), role: 'switch',
      'aria-checked': String(!!v), onclick: () => {
        const on = b.classList.toggle('on');
        b.setAttribute('aria-checked', String(on));
        setVal(f, on);
      } }, el('span', { class: 'ps-toggle-knob' }));
    return b;
  }
  if(f.type === 'select'){
    const s = el('select', { class: 'input', onchange: e => setVal(f, e.target.value) },
      (f.options || []).map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        const opt = el('option', { value: val, text: label });
        if(val === v) opt.selected = true;
        return opt;
      }));
    return s;
  }
  const input = el('input', { type: f.type === 'number' ? 'number' : 'text',
    value: v == null ? '' : v,
    onchange: e => setVal(f, f.type === 'number' ? +e.target.value : e.target.value) });
  return input;
}

// Renders the whole settings page into `mount`, filtered by uiMode/admin.
// Re-call after setUiMode to re-filter (cheap: it's declarative).
export function renderSettings(mount, { isAdmin = false } = {}){
  if(!schema) throw new Error('defineSettings first');
  const mode = getUiMode();
  mount.replaceChildren(...schema.sections
    .filter(sec => visibleAt(sec, mode, isAdmin))
    .map(sec => el('section', { class: 'ps-settings-section', id: `set-${sec.key}` }, [
      el('h2', { text: sec.title }),
      sec.blurb ? el('p', { class: 'ps-settings-blurb', text: sec.blurb }) : null,
      ...sec.fields
        .filter(f => visibleAt(f, mode, isAdmin))
        .map(f => field(f.label, control(f), f.hint)),
    ])));
  return { refresh: () => renderSettings(mount, { isAdmin }) };
}

// The stock "Interface mode" field apps can drop into their schema.
export function uiModeField(){
  return {
    key: '_uimode', label: 'Interface mode',
    hint: 'Simple hides advanced tools; Expert shows everything.',
    type: 'custom',
    render(){
      const seg = el('div', { class: 'ps-seg', role: 'radiogroup' },
        UI_MODES.map(m => el('button', {
          class: 'ps-seg-btn' + (m === getUiMode() ? ' on' : ''),
          text: m[0].toUpperCase() + m.slice(1),
          onclick: () => {
            setUiMode(m);
            seg.querySelectorAll('.ps-seg-btn').forEach((b, i) =>
              b.classList.toggle('on', UI_MODES[i] === m));
            toast('Interface mode', { body: `Now in ${m} mode.`, kind: 'info' });
          },
        })));
      return seg;
    },
  };
}
