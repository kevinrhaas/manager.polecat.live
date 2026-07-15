// -----------------------------------------------------------------------
// views.js — Polecat Shell: the JobTracker views system, made generic.
//
// Three standalone widgets extracted from JobTracker's inventory screen:
//   • filterPills          — a row of toggle pills (multi-value or boolean)
//   • multiselectDropdown  — a chip that opens a checklist popover w/ counts
//   • savedViews           — named view library: save / update-when-dirty /
//                            rename / reorder / set-default / delete / share
//
// The decoupling contract: NO domain knowledge lives here. A "view" is an
// opaque state blob the app produces via serialize() and consumes via
// apply(state) — filters, sort, columns, whatever. All persistence is under
// the caller's storageKey. Widgets don't self-rerender on change; the fleet
// pattern is that onChange/apply triggers the app's own rebuild, which
// re-creates the widgets from fresh state (see inventory.js).
// -----------------------------------------------------------------------
import { el, escapeHtml, uuid, field, modal, confirmDialog, toast, anchoredPopover, copy } from './ui.js';
import { icon } from './icons.js';

const countOf = (counts, key)=> counts == null ? null : (typeof counts === 'function' ? counts(key) : counts[key]);

// =========================================================================
// filterPills({ options:[{key,label,icon?}], selected:[], counts?, onChange })
// → node. A boolean toggle is just a single-key pill: present in `selected`
// means on — one shape covers both JobTracker's type pills and its
// rush/overdue/mine toggles.
// =========================================================================
export function filterPills({ options = [], selected = [], counts, onChange } = {}){
  const row = el('div', { class: 'shell-pills filterbar', role: 'group' });
  options.forEach(o=>{
    const on = selected.includes(o.key);
    const n = countOf(counts, o.key);
    const p = el('button', { class: 'pill' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false' });
    if(o.icon) p.append(el('span', { class: 't-ic', html: icon(o.icon, 14) }));
    p.append(el('span', { text: o.label }));
    if(n != null) p.append(el('span', { class: 'filter-count', text: String(n) }));
    p.addEventListener('click', ()=>{
      onChange?.(on ? selected.filter(k=>k !== o.key) : [...selected, o.key]);
    });
    row.append(p);
  });
  return row;
}

// =========================================================================
// multiselectDropdown({ label, options:[{value,label,icon?}], selected:[],
//                       counts?, onChange }) → node.
// Anchored checklist popover — lighter than a modal, stays open while the
// user ticks several boxes (JobTracker's checklistDropdown). Counts render
// per row so the user sees how many items each value would match.
// =========================================================================
export function multiselectDropdown({ label, options = [], selected = [], counts, onChange } = {}){
  const current = [...selected];
  const btn = el('button', { class: 'pill', type: 'button', title: label });

  // The chip badge is updated in place: the popover lives on document.body,
  // so it survives an app re-render — the chip must stay honest without one.
  function paintChip(){
    btn.className = 'pill' + (current.length ? ' on' : '');
    btn.innerHTML = `${icon('filter', 14)}<span>${escapeHtml(label)}</span>` +
      (current.length ? `<span class="filter-count">${current.length}</span>` : '') +
      icon('chevronDown', 13);
  }
  paintChip();

  btn.addEventListener('click', ()=>{
    const panel = el('div', { class: 'filter-pop', role: 'dialog', 'aria-label': label });
    const group = el('div', { class: 'fp-group' });
    options.forEach(opt=>{
      const n = countOf(counts, opt.value);
      const row = el('label', { class: 'fp-row' });
      const cb = el('input', { type: 'checkbox', checked: current.includes(opt.value) ? 'checked' : null });
      cb.addEventListener('change', ()=>{
        const i = current.indexOf(opt.value);
        if(i >= 0) current.splice(i, 1); else current.push(opt.value);
        paintChip();
        onChange?.([...current]);
      });
      row.append(cb);
      if(opt.icon) row.append(el('span', { class: 'fp-ic', html: icon(opt.icon, 15) }));
      row.append(el('span', { style: 'flex:1', text: opt.label ?? String(opt.value) }));
      if(n != null) row.append(el('span', { class: 'muted', style: 'font-size:11px', text: String(n) }));
      group.append(row);
    });
    panel.append(group);
    panel.append(el('div', { class: 'fp-foot' }, [
      el('button', { class: 'btn sm ghost', text: 'Clear', onclick: ()=>{
        current.length = 0; paintChip(); onChange?.([]);
        panel.querySelectorAll('input[type=checkbox]').forEach(c=>{ c.checked = false; });
      } }),
      el('button', { class: 'btn sm', text: 'Done', onclick: ()=>close() }),
    ]));
    const { close } = anchoredPopover(btn, panel);
  });
  return btn;
}

// =========================================================================
// Saved-view share codes — the whole view config rides in the URL fragment
// (`#view/<base64url>`), local-first: nothing is stored or sent anywhere but
// the link text itself.
// =========================================================================
function b64urlEncode(str){
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str){
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while(str.length % 4) str += '=';
  return decodeURIComponent(escape(atob(str)));
}

export function encodeViewShare(view){
  return b64urlEncode(JSON.stringify({ n: view.name, i: view.icon, s: view.state || {} }));
}

// Accepts a bare code, a `#view/<code>` fragment, or a full URL ending in
// one. Returns { name, icon, state } or null if the code isn't ours.
export function decodeViewShare(code){
  try{
    const raw = String(code).replace(/^.*#?view\//, '');
    const p = JSON.parse(b64urlDecode(raw));
    return {
      name: p.n || 'Shared view',
      icon: p.i || 'link',
      state: (p.s && typeof p.s === 'object') ? p.s : {},
    };
  }catch{ return null; }
}

// Canonical signature of a state blob: recursively key-sorted stringify, so
// object key order and array copies never read as "you changed something".
// (Arrays keep their order — for columns and the like, order IS meaning.)
function canon(v){
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object'){
    return '{' + Object.keys(v).sort().map(k=>{
      const c = v[k];
      // Drop empty/falsey leaves so "filter set then cleared" isn't dirty.
      if(c == null || c === false || c === '' || (Array.isArray(c) && !c.length)) return null;
      return JSON.stringify(k) + ':' + canon(c);
    }).filter(Boolean).join(',') + '}';
  }
  return JSON.stringify(v);
}

const DEFAULT_ICONS = ['list', 'star', 'eye', 'fire', 'grid', 'filter', 'rocket', 'flag', 'bolt', 'target', 'inbox', 'calendar'];

// =========================================================================
// savedViews({ storageKey, serialize, apply, icons? }) → { node, refresh }
//
//   serialize() → state    the app's current working state (opaque blob)
//   apply(state)           load a state blob into the app (the app then
//                          re-renders and calls refresh())
//
// Persists [{ id, name, icon, state, isDefault, order }] under storageKey.
// If a default view exists it is applied once at construction (JobTracker's
// first-visit behavior) — build the widget before the first render pass.
// =========================================================================
export function savedViews({ storageKey, serialize, apply, icons } = {}){
  if(!storageKey) throw new Error('savedViews: storageKey is required');
  const ICONS = (icons && icons.length) ? icons : DEFAULT_ICONS;
  let activeId = null;

  function load(){
    try{
      const a = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(a) ? a.slice().sort((x, y)=>(x.order ?? 0) - (y.order ?? 0)) : [];
    }catch{ return []; }
  }
  function save(views){
    views.forEach((v, i)=>{ v.order = i; });      // order is positional truth
    try{ localStorage.setItem(storageKey, JSON.stringify(views)); }
    catch(e){ console.warn('savedViews persist failed', e); }
  }

  const node = el('div', { class: 'shell-views inv-views' });

  function activate(v){
    activeId = v.id;
    apply(structuredClone(v.state ?? {}));
    build();
  }
  function isDirty(v){ return canon(serialize()) !== canon(v.state); }

  // ---- main pill row ------------------------------------------------------
  function build(){
    node.replaceChildren();
    const views = load();
    if(activeId && !views.some(v=>v.id === activeId)) activeId = null;   // deleted elsewhere

    views.forEach(v=>{
      const on = v.id === activeId;
      node.append(el('button', {
        class: 'pill' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
        html: `${icon(v.icon || 'list', 15)}<span>${escapeHtml(v.name)}</span>`,
        onclick: ()=>activate(v),
      }));
    });
    node.append(el('button', {
      class: 'pill', type: 'button', title: 'Save the current setup as a view',
      html: `${icon('plus', 15)}<span>Save view</span>`, onclick: ()=>openSaveView(),
    }));

    const active = views.find(v=>v.id === activeId);
    if(active){
      // The working state drifted from the saved view — offer a one-click
      // save-back instead of making the user re-create it.
      if(isDirty(active)){
        node.append(el('button', {
          class: 'pill on', type: 'button', title: `Save your changes back to “${active.name}”`,
          html: `${icon('check', 15)}<span>Update “${escapeHtml(active.name)}”</span>`,
          onclick: ()=>{
            const views2 = load();
            const v = views2.find(x=>x.id === active.id);
            if(v){ v.state = structuredClone(serialize()); save(views2); toast('View updated', { kind: 'ok' }); }
            build();
          },
        }));
      }
      node.append(el('button', { class: 'btn icon sm ghost', title: 'Copy a link to this view', 'aria-label': 'Copy link to current view',
        html: icon('link', 15), onclick: ()=>copy(shareLink(active), `Link to “${active.name}” copied`) }));
      node.append(el('button', { class: 'btn icon sm ghost', title: 'Edit this view', 'aria-label': 'Edit current view',
        html: icon('edit', 15), onclick: ()=>openSaveView(active) }));
      node.append(el('button', { class: 'btn icon sm ghost', title: 'Delete this view', 'aria-label': 'Delete current view',
        html: icon('trash', 15), onclick: ()=>deleteView(active) }));
    }
    node.append(el('button', {
      class: 'btn sm ghost', type: 'button',
      title: 'Rename, reorder, set your default, or delete your saved views.',
      html: `${icon('list', 15)}<span>Manage views</span>`, onclick: ()=>openManageViews(),
    }));
  }

  function shareLink(v){
    // origin+pathname (not a hardcoded /app/) so the link lands back on the
    // page that owns this widget in any app.
    return `${location.origin}${location.pathname}#view/${encodeViewShare(v)}`;
  }

  // ---- save / edit dialog ---------------------------------------------------
  function openSaveView(existing){
    let chosenIcon = existing?.icon || ICONS[0];
    const nameInput = el('input', { class: 'input', value: existing ? existing.name : '', placeholder: 'e.g. Rush this week', 'aria-label': 'View name' });
    const picker = el('div', { class: 'icon-picker' });
    ICONS.forEach(k=>{
      const o = el('button', { class: 'icon-opt' + (k === chosenIcon ? ' on' : ''), type: 'button', title: k, 'aria-label': 'Icon ' + k, html: icon(k, 20) });
      o.addEventListener('click', ()=>{
        chosenIcon = k;
        picker.querySelectorAll('.icon-opt').forEach(x=>x.classList.remove('on'));
        o.classList.add('on');
      });
      picker.append(o);
    });
    let updateState = true;
    const body = [field('Name', nameInput), field('Icon', picker)];
    if(existing){
      // Editing shouldn't silently clobber a saved state with the working
      // one — renaming alone is a common intent, so make the overwrite opt-in.
      const wrap = el('label', { class: 'col-check' });
      const cb = el('input', { type: 'checkbox', checked: 'checked' });
      cb.addEventListener('change', ()=>{ updateState = cb.checked; });
      wrap.append(cb, el('span', { text: 'Save the current setup into this view' }));
      body.push(wrap);
    }
    const { hide } = modal({ title: existing ? 'Edit view' : 'Save view', icon: icon('star'), body,
      foot: [
        el('button', { class: 'btn', text: 'Cancel', onclick: ()=>hide() }),
        el('button', { class: 'btn primary', text: existing ? 'Save changes' : 'Create view', onclick: ()=>{
          const name = nameInput.value.trim();
          if(!name){ nameInput.focus(); return; }
          const views = load();
          if(existing){
            const v = views.find(x=>x.id === existing.id);
            if(v){
              v.name = name; v.icon = chosenIcon;
              if(updateState) v.state = structuredClone(serialize());
              save(views);
            }
            toast('View updated', { kind: 'ok' });
          } else {
            const v = { id: uuid(), name, icon: chosenIcon, state: structuredClone(serialize()), isDefault: false, order: views.length };
            views.push(v); save(views);
            activeId = v.id;
            toast('View saved', { kind: 'ok' });
          }
          hide(); build();
        } }),
      ] });
    setTimeout(()=>nameInput.focus(), 30);
  }

  async function deleteView(v){
    const ok = await confirmDialog({ title: 'Delete view?', message: `Remove the “${v.name}” saved view? This can’t be undone.`, okText: 'Delete', danger: true });
    if(!ok) return;
    save(load().filter(x=>x.id !== v.id));
    if(activeId === v.id) activeId = null;
    toast('View deleted', { kind: 'info' });
    build();
  }

  // ---- manage dialog (rename / reorder / set default / delete) --------------
  function openManageViews(){
    const list = el('div');
    const { hide } = modal({ title: 'View library', icon: icon('list'),
      body: [el('div', { class: 'muted tiny', style: 'margin-bottom:10px', text: 'Rename, reorder, set your default, or delete your saved views.' }), list],
      foot: [el('button', { class: 'btn primary', text: 'Done', onclick: ()=>hide() })],
    });
    function draw(){
      list.replaceChildren();
      const views = load();
      if(!views.length){
        list.append(el('p', { class: 'muted', text: 'No saved views yet — build one with “Save view”.' }));
        return;
      }
      views.forEach((v, i)=>{
        const setStar = ()=>{
          const vs = load();
          vs.forEach(x=>{ x.isDefault = x.id === v.id; });   // exactly one default
          save(vs); draw();
        };
        const move = dir=>{
          const vs = load();
          const from = vs.findIndex(x=>x.id === v.id), to = from + dir;
          if(from < 0 || to < 0 || to >= vs.length) return;
          const [m] = vs.splice(from, 1); vs.splice(to, 0, m);
          save(vs); draw(); build();
        };
        const star = el('button', { class: 'btn icon sm ghost star' + (v.isDefault ? ' on' : ''),
          title: v.isDefault ? 'Default view' : 'Set as default', 'aria-label': 'Set as default', html: icon('star', 15), onclick: setStar });
        const up = el('button', { class: 'btn icon sm ghost', title: 'Move up', 'aria-label': 'Move up',
          html: icon('chevron', 14), style: 'transform:rotate(-90deg)', onclick: ()=>move(-1) });
        up.disabled = i === 0;
        const down = el('button', { class: 'btn icon sm ghost', title: 'Move down', 'aria-label': 'Move down',
          html: icon('chevron', 14), style: 'transform:rotate(90deg)', onclick: ()=>move(1) });
        down.disabled = i === views.length - 1;
        const edit = el('button', { class: 'btn icon sm ghost', title: 'Rename / change icon', 'aria-label': 'Edit view',
          html: icon('edit', 15), onclick: ()=>{ hide(); openSaveView(v); } });
        const del = el('button', { class: 'btn icon sm ghost', title: 'Delete view', 'aria-label': 'Delete view',
          html: icon('trash', 15), onclick: async ()=>{
            if(await confirmDialog({ title: 'Delete view?', danger: true, okText: 'Delete', message: `“${v.name}” will be removed from your library.` })){
              save(load().filter(x=>x.id !== v.id));
              if(activeId === v.id) activeId = null;
              draw(); build();
            }
          } });
        list.append(el('div', { class: 'mv-row' }, [
          el('span', { class: 'mv-ic', html: icon(v.icon || 'list', 18) }),
          el('span', { class: 'mv-name', text: v.name }),
          star, up, down, edit, del,
        ]));
      });
    }
    draw();
  }

  // First construction: land on the default view if one exists, so the app
  // opens where the user chose (build the widget BEFORE the first render).
  const def = load().find(v=>v.isDefault);
  if(def){ activeId = def.id; apply(structuredClone(def.state ?? {})); }
  build();

  return { node, refresh: build };
}
