// -----------------------------------------------------------------------
// notifications.js — Polecat Shell: topbar bell over a DERIVED feed.
//
// Generalized from Manager's buildNotifBell and JobTracker's derived
// notifications: the app computes its feed live from its own data (overdue,
// slipping, approvals — whatever), and the ONLY thing persisted here is
// which item ids the user has dismissed. Feed items should embed the fact
// that triggered them in the id (e.g. `overdue:<jobId>:<dueDate>`) so that
// when the underlying thing changes again, a fresh id reappears instead of
// staying silently hidden behind an old dismissal.
//
// initBell({ feed, storageKey, onOpen? }) → node (a <button>). The node
// also carries a `.refresh()` method — call it whenever app data changes so
// the badge (and an open panel) stay honest.
//
//   feed()      → [{ id, title, body?, kind?, ts?, href?, icon? }]
//   storageKey  where dismissed ids persist (per app).
//   onOpen(item)  optional item-activation handler (SPA routing); when
//                 omitted, items with an href navigate via location.
// -----------------------------------------------------------------------
import { el, relTime, anchoredPopover } from './ui.js';
import { icon } from './icons.js';

// Loose kind → glyph mapping; an item can override with its own `icon`.
const KIND_ICONS = {
  danger: 'warn', error: 'warn', warn: 'clock', warning: 'clock',
  info: 'info', success: 'check', ok: 'check',
};

const MAX_DISMISSED = 1000;   // ids are tiny; cap keeps the key from growing forever
const MAX_SHOWN = 30;         // a bell panel is a summary, not an inbox

export function initBell({ feed, storageKey, onOpen } = {}){
  if(!storageKey) throw new Error('initBell: storageKey is required');

  // ---- dismissed-id persistence ---------------------------------------------
  let dismissed;
  try{ dismissed = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); }
  catch{ dismissed = new Set(); }
  function persistDismissed(){
    try{ localStorage.setItem(storageKey, JSON.stringify([...dismissed].slice(-MAX_DISMISSED))); }catch{}
  }

  const items = ()=> (typeof feed === 'function' ? feed() : []) || [];
  const active = ()=> items().filter(n=>n && !dismissed.has(n.id));

  // ---- bell button + badge ----------------------------------------------------
  const btn = el('button', { class: 'btn icon ghost notif-btn', type: 'button',
    title: 'Notifications', 'aria-label': 'Notifications', html: icon('bell') });
  const badge = el('span', { class: 'nb-badge' });
  badge.hidden = true;
  btn.append(badge);

  let openPanel = null;   // { body, close } while the popover is up

  function refresh(){
    const n = active().length;
    if(n > 0){
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.hidden = false;
      btn.classList.add('has-unread');
    } else {
      badge.hidden = true;
      btn.classList.remove('has-unread');
    }
    if(openPanel) renderList(openPanel.body);
  }

  // ---- anchored panel -----------------------------------------------------------
  function emptyNode(){
    return el('div', { class: 'notif-empty' }, [
      el('div', { html: icon('check', 26) }),
      el('p', { class: 'muted tiny', text: 'You’re all caught up — nothing needs attention.' }),
    ]);
  }

  function activateItem(n, close){
    close();
    // onOpen wins so SPA apps can route in-place; href is the plain fallback.
    if(onOpen) onOpen(n);
    else if(n.href) location.href = n.href;
  }

  function renderList(body){
    body.replaceChildren();
    const list = active();
    if(!list.length){ body.append(emptyNode()); return; }
    list.slice(0, MAX_SHOWN).forEach(n=>body.append(rowNode(n, body)));
    if(list.length > MAX_SHOWN){
      body.append(el('p', { class: 'muted tiny', style: 'padding:8px 12px', text: `+ ${list.length - MAX_SHOWN} more` }));
    }
  }

  function rowNode(n, body){
    const row = el('div', { class: 'notif-item', 'data-kind': n.kind || '' });
    row.append(el('div', { class: 'ni-ic', html: icon(n.icon || KIND_ICONS[n.kind] || 'info', 16) }));
    const main = el('div', { class: 'ni-main' });
    main.append(el('div', { class: 'ni-title', text: n.title || '' }));
    if(n.body) main.append(el('div', { class: 'ni-detail tiny muted', text: n.body }));
    if(n.ts) main.append(el('div', { class: 'ni-time tiny muted', text: relTime(n.ts) }));
    row.append(main);
    row.append(el('button', { class: 'btn icon ghost sm', title: 'Dismiss', 'aria-label': 'Dismiss notification',
      html: icon('close', 14), onclick: e=>{
        e.stopPropagation();       // dismissing must not also open the item
        dismissed.add(n.id); persistDismissed();
        row.remove();
        if(!body.querySelector('.notif-item')) body.append(emptyNode());
        refresh();
      } }));
    if(onOpen || n.href){
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.addEventListener('click', ()=>activateItem(n, openPanel.close));
      row.addEventListener('keydown', e=>{ if(e.key === 'Enter') activateItem(n, openPanel.close); });
    }
    return row;
  }

  btn.addEventListener('click', ()=>{
    if(openPanel){ openPanel.close(); return; }    // second click toggles shut
    const panel = el('div', { class: 'notif-panel', role: 'dialog', 'aria-label': 'Notifications' });
    const head = el('div', { class: 'notif-head' });
    head.append(el('b', { text: 'Notifications' }));
    if(active().length){
      head.append(el('button', { class: 'btn sm ghost', text: 'Mark all read', onclick: ()=>{
        // Dismiss the full computed feed, not just what's on screen, so the
        // badge really goes to zero.
        items().forEach(n=>n && dismissed.add(n.id));
        persistDismissed();
        openPanel?.close();
        refresh();
      } }));
    }
    panel.append(head);
    const body = el('div', { class: 'notif-body' });
    panel.append(body);
    const { close } = anchoredPopover(btn, panel, { onClose: ()=>{ openPanel = null; } });
    openPanel = { body, close };
    renderList(body);
  });

  refresh();
  btn.refresh = refresh;   // apps call this on their store's 'change' event
  return btn;
}
