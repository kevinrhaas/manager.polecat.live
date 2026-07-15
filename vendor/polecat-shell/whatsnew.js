// -----------------------------------------------------------------------
// whatsnew.js — Polecat Shell: the fleet's "What's New" feed, made generic.
//
// Generalized from Manager's searchable/filterable changelog sheet and the
// Games arcade's updates drawer. Renders the fleet-contract changelog shape
// (see SHELL-API.md § changelog contract):
//   entries: [{ v, title, kind:'feature'|'polish'|'fix', ts, items:[...] }]
//
// The unseen dot is a version comparison, not a per-entry read state: we
// store the highest version the user has OPENED under storageKey and light
// the indicator whenever `latest` is newer. Rendering the feed counts as
// seeing it, so initWhatsNew marks seen immediately.
//
// initWhatsNew returns the built node; if `mount` is omitted the caller
// wraps it (typically in shell.js rightPanel({ body: node })).
// -----------------------------------------------------------------------
import { el, escapeHtml, fmtDate, relTime } from './ui.js';
import { icon } from './icons.js';

function readSeen(storageKey){
  try{ return parseInt(localStorage.getItem(storageKey) || '0', 10) || 0; }
  catch{ return 0; }
}

// hasUnseen(storageKey, latest) → boolean — drives the sparkle/dot badge.
export function hasUnseen(storageKey, latest){
  return Number(latest || 0) > readSeen(storageKey);
}

// markSeen(storageKey, latest) — remember that the user has seen `latest`.
export function markSeen(storageKey, latest){
  try{ localStorage.setItem(storageKey, String(Number(latest || 0))); }catch{}
}

const DEFAULT_LABELS = {
  title: "What’s new",
  searchPlaceholder: 'Search updates…',
  empty: 'No updates match.',
  allKind: 'All',
  kinds: ['feature', 'polish', 'fix'],
};

/**
 * initWhatsNew({ entries, latest, storageKey, mount?, labels? }) → node
 *
 * - entries     the changelog array (newest first per the fleet contract;
 *               re-sorted defensively anyway).
 * - latest      the newest version number (usually LATEST_VERSION).
 * - storageKey  where the seen-version int lives (per app).
 * - mount       optional element to append into; omitted = caller mounts.
 * - labels      wording overrides (see DEFAULT_LABELS).
 */
export function initWhatsNew({ entries = [], latest, storageKey, mount, labels = {} } = {}){
  const L = { ...DEFAULT_LABELS, ...labels };
  let kind = 'all';
  let query = '';

  const root = el('div', { class: 'shell-whatsnew' });

  // ---- header: title + latest-version meta --------------------------------
  const head = el('div', { class: 'wn-head' });
  head.append(el('h3', { text: L.title }));
  head.append(el('div', { class: 'muted tiny',
    text: `${latest != null ? 'v' + latest + ' · ' : ''}${entries.length} release${entries.length === 1 ? '' : 's'}` }));
  root.append(head);

  // ---- search --------------------------------------------------------------
  const search = el('div', { class: 'search wn-search' });
  const input = el('input', { class: 'input', type: 'search', placeholder: L.searchPlaceholder, spellcheck: 'false', 'aria-label': L.searchPlaceholder });
  search.append(el('span', { html: icon('search', 16) }), input);
  root.append(search);

  // ---- kind filter chips -----------------------------------------------------
  const chips = el('div', { class: 'wn-kinds', role: 'group', 'aria-label': 'Filter by kind' });
  ['all', ...L.kinds].forEach(k=>{
    const c = el('button', {
      class: 'filter-chip' + (k === kind ? ' on' : ''), type: 'button',
      text: k === 'all' ? L.allKind : k[0].toUpperCase() + k.slice(1),
      onclick: ()=>{
        kind = k;
        [...chips.children].forEach(x=>x.classList.remove('on'));
        c.classList.add('on');
        render();
      },
    });
    chips.append(c);
  });
  root.append(chips);

  // ---- feed -----------------------------------------------------------------
  const list = el('div', { class: 'wn-list' });
  root.append(list);

  function render(){
    list.replaceChildren();
    const needle = query.trim().toLowerCase();
    const rows = entries
      .filter(e=>{
        if(kind !== 'all' && (e.kind || 'feature') !== kind) return false;
        if(!needle) return true;
        return String(e.title || '').toLowerCase().includes(needle) ||
               (e.items || []).some(i=>String(i).toLowerCase().includes(needle));
      })
      .slice()
      .sort((a, b)=>(b.v || 0) - (a.v || 0));
    if(!rows.length){
      list.append(el('div', { class: 'empty muted', text: L.empty }));
      return;
    }
    rows.forEach(e=>{
      const entry = el('div', { class: 'wn-entry' });
      const top = el('div', { class: 'wn-top' });
      if(e.v != null) top.append(el('span', { class: 'wn-badge', text: 'v' + e.v }));
      top.append(el('b', { text: e.title || '' }));
      if(e.kind) top.append(el('span', { class: `wn-kind kind-${escapeHtml(e.kind)}`, text: e.kind }));
      entry.append(top);
      // Absolute date with a relative-time hint — "Jul 1, 2026 · 2 weeks ago"
      // reads better in a feed than either alone. Tolerates an empty ts (a
      // just-committed entry CI hasn't stamped yet).
      if(e.ts){
        entry.append(el('div', { class: 'wn-date muted tiny', text: `${fmtDate(e.ts)} · ${relTime(e.ts)}` }));
      }
      if(e.items?.length){
        const ul = el('ul');
        e.items.forEach(i=>ul.append(el('li', { text: String(i) })));
        entry.append(ul);
      }
      list.append(entry);
    });
  }
  render();
  input.addEventListener('input', ()=>{ query = input.value; render(); });

  // Opening the feed IS seeing it — clear the unseen dot right away so a
  // rightPanel close doesn't have to remember to.
  if(storageKey && latest != null) markSeen(storageKey, latest);

  if(mount) mount.append(root);
  return root;
}
