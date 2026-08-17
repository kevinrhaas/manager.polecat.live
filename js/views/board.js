// board.js — the 4D Chicago ticket board.
//
// kevinrhaas/custom's chicago/4d project keeps a lightweight ticket system in
// `chicago/4d/tickets/` on its working branch (`dev`):
//   • tickets.json  — the generated, machine-readable list (state, epic,
//                     requested_by, effort, needs_bake, queue_rank …). Read-only
//                     here; the repo regenerates it from QUEUE.md + the ticket
//                     files with `tools/ticket.mjs board`.
//   • QUEUE.md      — the priority order, top = next. **The owner orders this
//                     file** (agents only append/remove). This is the one file
//                     Manager writes: reordering the queue rewrites it.
//
// So this view READS tickets.json to draw the board (grouped by state), and the
// Queue column is reorderable — moving a ticket up/down and committing rewrites
// QUEUE.md on `dev` via the contents API (sha compare-and-swap, vault token).
// (This is ticket T-0030, "A queue card in Manager reading tickets.json".)
import { el, escapeHtml, toast, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import { ghToken, whoami, getRepoJson, getRepoText, putRepoText, clearGhCache } from '../github.js';

const TICKETS = {
  repo: 'kevinrhaas/custom',
  branch: 'dev',
  label: '4D Chicago',
  jsonPath: 'chicago/4d/tickets/tickets.json',
  queuePath: 'chicago/4d/tickets/QUEUE.md',
  dirUrl: 'https://github.com/kevinrhaas/custom/tree/dev/chicago/4d/tickets',
};

// state → board column. `open` tickets are the reorderable queue; everything
// else is a read-only status column. `withdrawn` is hidden.
const COLUMNS = [
  { key: 'queue',    title: 'Queue',        states: ['open'],                       hint: 'top = next · reorder to reprioritise' },
  { key: 'progress', title: 'In progress',  states: ['claimed', 'review'],          hint: 'claimed or in review' },
  { key: 'blocked',  title: 'Blocked',      states: ['blocked-owner', 'blocked-tech'], hint: 'waiting on a decision or a fix' },
  { key: 'done',     title: 'Done',         states: ['done'],                       hint: 'shipped' },
];
const colFor = (state) => (COLUMNS.find(c => c.states.includes(state)) || {}).key;

const errNote = (e) => `<span class="${/rate.?limit/i.test(e.message) ? 'fo-warn' : 'fo-err'} tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`;

export function renderBoard(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('board')}</span><h2>4D Board</h2>
    <span class="muted tiny">${escapeHtml(TICKETS.label)} — the reconstruction ticket queue</span>`;
  title.append(el('span', { class: 'sp' }));
  const refresh = el('button', { class: 'btn ghost sm', html: `${icon('refresh')} Refresh`, title: 'Reload tickets from GitHub',
    onclick: () => load(true) });
  const ghLink = el('a', { class: 'btn ghost sm', href: TICKETS.dirUrl, target: '_blank', rel: 'noopener',
    html: `${icon('external')} GitHub`, title: 'Open the tickets folder on GitHub' });
  title.append(refresh, ghLink);
  wrap.append(title);

  const intro = el('p', { class: 'tiny muted', style: 'margin:0 0 12px' });
  intro.innerHTML = `The board reads <span class="mono">${escapeHtml(TICKETS.jsonPath)}</span> on <span class="mono">${escapeHtml(TICKETS.branch)}</span>. The <b>Queue</b> is owner-ordered — drag priorities with the arrows, then <b>Commit order</b> to rewrite <span class="mono">QUEUE.md</span>. A vault token (Fleet Ops) is needed to commit.`;
  wrap.append(intro);

  const body = el('div', { html: `<div class="card"><span class="tiny muted">Loading tickets…</span></div>` });
  wrap.append(body);
  root.append(wrap);

  // working state: the current queue order (array of open-ticket ids), the raw
  // tickets, and the QUEUE.md sha for a safe write.
  let tickets = [];
  let queueOrder = [];      // ids of open tickets, in the order shown
  let queueSha = null, queueText = '';
  let dirty = false;

  const load = async (fresh = false) => {
    body.innerHTML = '';
    body.append(el('div', { class: 'card', html: `<span class="tiny muted">Loading tickets…</span>` }));
    try{
      const [{ json }, q] = await Promise.all([
        getRepoJson(TICKETS.repo, TICKETS.jsonPath, TICKETS.branch),
        getRepoText(TICKETS.repo, TICKETS.queuePath, TICKETS.branch).catch(() => ({ text: '', sha: null })),
      ]);
      tickets = Array.isArray(json?.tickets) ? json.tickets : [];
      queueText = q.text; queueSha = q.sha;
      queueOrder = tickets.filter(t => t.state === 'open')
        .sort((a, b) => (a.queue_rank ?? 1e9) - (b.queue_rank ?? 1e9))
        .map(t => t.id);
      dirty = false;
      render();
    }catch(e){
      body.innerHTML = '';
      const card = el('div', { class: 'card' });
      card.innerHTML = `<div class="tiny">${errNote(e)}</div>
        <p class="tiny muted" style="margin:8px 0 0">${e.status === 404 ? 'The tickets file was not found on that branch (or the repo needs a token to read).' : 'Connect a GitHub token in Fleet Ops if this repo is private.'}</p>`;
      body.append(card);
    }
  };

  const byId = (id) => tickets.find(t => t.id === id);

  const move = (id, dir) => {
    const i = queueOrder.indexOf(id);
    const j = i + dir;
    if(i < 0 || j < 0 || j >= queueOrder.length) return;
    [queueOrder[i], queueOrder[j]] = [queueOrder[j], queueOrder[i]];
    dirty = true;
    render();
  };

  const commit = async () => {
    if(!ghToken()){ toast('Connect a GitHub token first', { kind: 'warn', body: 'Queue writes need a PAT from the vault (Fleet Ops → GitHub access).' }); return; }
    const ok = await confirmDialog({ title: 'Commit the queue order?',
      message: `This rewrites ${TICKETS.queuePath} on ${TICKETS.branch} so the top of the queue is what the loop picks up next.`, okText: 'Commit to ' + TICKETS.branch });
    if(!ok) return;
    try{
      // fresh sha right before writing (someone may have edited it since load)
      const q = await getRepoText(TICKETS.repo, TICKETS.queuePath, TICKETS.branch);
      const next = rewriteQueue(q.text, queueOrder, byId);
      if(next === q.text){ dirty = false; toast('Queue already in this order', { kind: 'ok' }); render(); return; }
      await putRepoText(TICKETS.repo, TICKETS.queuePath, next, q.sha, {
        message: 'tickets: reorder the queue via Manager', branch: TICKETS.branch });
      clearGhCache();
      dirty = false;
      toast('Queue order committed', { kind: 'ok', body: 'The board regenerates on the next ticket run.' });
      load(true);
    }catch(e){
      toast('Commit failed', { kind: 'err', body: e.status === 409 ? 'The queue changed on GitHub since you loaded it — refresh and try again.' : (e.message || 'Could not write QUEUE.md') });
    }
  };

  function render(){
    body.innerHTML = '';
    if(!tickets.length){ body.append(el('div', { class: 'card', html: '<span class="tiny muted">No tickets.</span>' })); return; }

    // commit bar (only when the queue order changed)
    const bar = el('div', { class: 'bd-commitbar' + (dirty ? ' on' : '') });
    bar.append(el('span', { class: 'tiny muted', text: dirty ? 'Queue order changed — not yet on GitHub.' : '' }),
      el('span', { class: 'sp' }));
    const commitBtn = el('button', { class: 'btn sm primary', html: `${icon('check')} Commit order`, disabled: !dirty, onclick: commit });
    const resetBtn = el('button', { class: 'btn ghost sm', html: `${icon('refresh')} Reset`, disabled: !dirty, onclick: () => load(false) });
    bar.append(resetBtn, commitBtn);
    body.append(bar);

    const board = el('div', { class: 'bd-board' });
    for(const col of COLUMNS){
      const items = col.key === 'queue'
        ? queueOrder.map(byId).filter(Boolean)
        : tickets.filter(t => col.states.includes(t.state));
      const column = el('div', { class: 'bd-col bd-col-' + col.key });
      const head = el('div', { class: 'bd-col-head' });
      head.innerHTML = `<h3>${escapeHtml(col.title)} <span class="bd-count">${items.length}</span></h3><span class="tiny muted">${escapeHtml(col.hint)}</span>`;
      column.append(head);
      const list = el('div', { class: 'bd-cards' });
      if(!items.length){ list.append(el('div', { class: 'tiny muted bd-empty', text: '—' })); }
      items.forEach((t, idx) => list.append(ticketCard(t, col.key, idx, items.length)));
      column.append(list);
      board.append(column);
    }
    body.append(board);
  }

  const ticketCard = (t, colKey, idx, n) => {
    const card = el('div', { class: 'bd-card' + (t.requested_by === 'owner' ? ' is-owner' : '') });
    // reorder controls (queue column only)
    if(colKey === 'queue'){
      const ctrls = el('div', { class: 'bd-move' });
      ctrls.append(
        el('button', { class: 'btn ghost icon xs bd-up', title: 'Move up', 'aria-label': `Move ${t.id} up`, disabled: idx === 0,
          html: icon('chevron'), onclick: () => move(t.id, -1) }),
        el('button', { class: 'btn ghost icon xs bd-down', title: 'Move down', 'aria-label': `Move ${t.id} down`, disabled: idx === n - 1,
          html: icon('chevron'), onclick: () => move(t.id, +1) }));
      card.append(ctrls);
    }
    const main = el('div', { class: 'bd-card-main' });
    const idRow = el('div', { class: 'bd-card-id' });
    idRow.append(el('span', { class: 'bd-tid mono', text: t.id }));
    if(t.epic) idRow.append(el('span', { class: 'bd-epic', text: t.epic }));
    main.append(idRow);
    main.append(el('div', { class: 'bd-card-title', text: t.title || '(untitled)' }));
    const chips = el('div', { class: 'bd-chips' });
    if(t.requested_by === 'owner') chips.append(el('span', { class: 'bd-chip owner', text: 'OWNER' }));
    if(t.seen) chips.append(el('span', { class: 'bd-chip', text: 'seen' }));
    if(t.needs_bake) chips.append(el('span', { class: 'bd-chip warn', text: 'needs-bake' }));
    if(t.effort) chips.append(el('span', { class: 'bd-chip', text: t.effort }));
    if(t.blocked_on) chips.append(el('span', { class: 'bd-chip warn', text: 'blocked' }));
    if(t.pr) chips.append(el('span', { class: 'bd-chip', text: 'PR #' + t.pr }));
    if(t.legacy_id) chips.append(el('span', { class: 'bd-chip ghost', title: 'previous id', text: t.legacy_id }));
    if(chips.children.length) main.append(chips);
    card.append(main);
    return card;
  };

  load();
}

// Rewrite QUEUE.md so its ticket lines follow `order` (an array of ids). Leading
// `#` comment lines are preserved verbatim at the top; each ticket keeps its
// existing label line (so nothing but the order changes); an id in `order` with
// no existing line falls back to "T-NNNN — <title>". Ids present in the file but
// not in `order` (shouldn't happen for open tickets) are appended in place to
// avoid dropping anyone.
export function rewriteQueue(text, order, byId){
  const lines = String(text || '').split('\n');
  const header = [];
  const entryById = new Map();
  const fileOrder = [];
  for(const line of lines){
    const m = line.match(/^(T-\d+)\b/);
    if(m){ entryById.set(m[1], line); fileOrder.push(m[1]); }
    else if(line.trim().startsWith('#')) header.push(line);
    // blank/other lines are dropped from the rebuilt body (header keeps comments)
  }
  const seen = new Set();
  const out = [];
  for(const id of order){
    seen.add(id);
    if(entryById.has(id)) out.push(entryById.get(id));
    else { const t = byId?.(id); out.push(`${id} — ${t?.title || ''}`.trimEnd()); }
  }
  for(const id of fileOrder){ if(!seen.has(id)) out.push(entryById.get(id)); }   // never drop an unknown line
  return header.concat(out).join('\n') + '\n';
}
