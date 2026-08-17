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
//   • T-NNNN-*.md   — one file per ticket: front matter + the ask/acceptance.
//
// This view READS tickets.json to draw the board (a wide, numbered Queue plus
// compact In-progress / Blocked / Done columns), opens a ticket's full detail
// on click (fetching its .md), and lets the owner reorder the Queue — moving a
// ticket and committing rewrites QUEUE.md on `dev` via the contents API (sha
// compare-and-swap, vault token). (This is ticket T-0030.)
import { el, escapeHtml, toast, confirmDialog, modal, mdToHtml } from '../ui.js';
import { icon } from '../icons.js';
import { ghToken, getRepoJson, getRepoText, getRepoDir, putRepoText, clearGhCache } from '../github.js';

const TICKETS = {
  repo: 'kevinrhaas/custom',
  branch: 'dev',
  label: '4D Chicago',
  jsonPath: 'chicago/4d/tickets/tickets.json',
  queuePath: 'chicago/4d/tickets/QUEUE.md',
  dirPath: 'chicago/4d/tickets',
  dirUrl: 'https://github.com/kevinrhaas/custom/tree/dev/chicago/4d/tickets',
};

// The read-only status columns (the Queue is rendered separately). `withdrawn`
// is hidden.
const STATUS_COLS = [
  { key: 'progress', title: 'In progress', states: ['claimed', 'review'],             hint: 'claimed or in review' },
  { key: 'blocked',  title: 'Blocked',     states: ['blocked-owner', 'blocked-tech'], hint: 'waiting on a decision or a fix' },
  { key: 'done',     title: 'Done',        states: ['done'],                          hint: 'shipped' },
];

const errNote = (e) => `<span class="${/rate.?limit/i.test(e.message) ? 'fo-warn' : 'fo-err'} tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`;

function stripFrontMatter(text){
  const s = String(text || '');
  if(s.startsWith('---')){
    const end = s.indexOf('\n---', 3);
    if(end !== -1){ const nl = s.indexOf('\n', end + 1); return s.slice(nl + 1).trim(); }
  }
  return s.trim();
}

export function renderBoard(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('board')}</span><h2>4D Board</h2>
    <span class="muted tiny">${escapeHtml(TICKETS.label)} — the reconstruction ticket queue</span>`;
  title.append(el('span', { class: 'sp' }));
  title.append(
    el('button', { class: 'btn ghost sm', html: `${icon('refresh')} Refresh`, title: 'Reload tickets from GitHub', onclick: () => load(true) }),
    el('a', { class: 'btn ghost sm', href: TICKETS.dirUrl, target: '_blank', rel: 'noopener', html: `${icon('external')} GitHub`, title: 'Open the tickets folder on GitHub' }));
  wrap.append(title);

  const intro = el('p', { class: 'tiny muted', style: 'margin:0 0 12px' });
  intro.innerHTML = `The board reads <span class="mono">${escapeHtml(TICKETS.jsonPath)}</span> on <span class="mono">${escapeHtml(TICKETS.branch)}</span>. Click a card for its full ticket. The <b>Queue</b> is owner-ordered — reorder with the arrows, then <b>Commit order</b> to rewrite <span class="mono">QUEUE.md</span> (a vault token is needed to commit).`;
  wrap.append(intro);

  const body = el('div', { html: `<div class="card"><span class="tiny muted">Loading tickets…</span></div>` });
  wrap.append(body);
  root.append(wrap);

  let tickets = [];
  let queueOrder = [];      // ids of open tickets, in the order shown
  let queueSha = null;
  let dirty = false;
  let fileById = new Map(); // id → { name, path } for the ticket .md files

  const byId = (id) => tickets.find(t => t.id === id);

  const load = async (fresh = false) => {
    if(fresh) clearGhCache();
    body.innerHTML = '';
    body.append(el('div', { class: 'card', html: `<span class="tiny muted">Loading tickets…</span>` }));
    try{
      const [{ json }, q, dir] = await Promise.all([
        getRepoJson(TICKETS.repo, TICKETS.jsonPath, TICKETS.branch),
        getRepoText(TICKETS.repo, TICKETS.queuePath, TICKETS.branch).catch(() => ({ sha: null })),
        getRepoDir(TICKETS.repo, TICKETS.dirPath, TICKETS.branch).catch(() => []),
      ]);
      tickets = Array.isArray(json?.tickets) ? json.tickets : [];
      queueSha = q.sha;
      fileById = new Map();
      for(const e of dir){ const m = (e.name || '').match(/^(T-\d+)-.*\.md$/); if(m) fileById.set(m[1], { name: e.name, path: e.path }); }
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
      const q = await getRepoText(TICKETS.repo, TICKETS.queuePath, TICKETS.branch);   // fresh sha
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

    // commit bar
    const bar = el('div', { class: 'bd-commitbar' + (dirty ? ' on' : '') });
    bar.append(el('span', { class: 'tiny muted', text: dirty ? 'Queue order changed — not yet on GitHub.' : '' }), el('span', { class: 'sp' }));
    bar.append(
      el('button', { class: 'btn ghost sm', html: `${icon('refresh')} Reset`, disabled: !dirty, onclick: () => load(false) }),
      el('button', { class: 'btn sm primary', html: `${icon('check')} Commit order`, disabled: !dirty, onclick: commit }));
    body.append(bar);

    const layout = el('div', { class: 'bd-layout' });

    // --- the Queue: a wide, numbered card grid ---------------------------
    const queueTickets = queueOrder.map(byId).filter(Boolean);
    const qcol = el('div', { class: 'bd-queue' });
    const qhead = el('div', { class: 'bd-col-head' });
    qhead.innerHTML = `<h3>Queue <span class="bd-count">${queueTickets.length}</span></h3><span class="tiny muted">top = next · reorder to reprioritise</span>`;
    qcol.append(qhead);
    const grid = el('div', { class: 'bd-qgrid' });
    if(!queueTickets.length) grid.append(el('div', { class: 'tiny muted', text: 'Queue is empty.' }));
    queueTickets.forEach((t, idx) => grid.append(queueCard(t, idx, queueTickets.length)));
    qcol.append(grid);
    layout.append(qcol);

    // --- the status columns: compact sidebar -----------------------------
    const side = el('div', { class: 'bd-side' });
    for(const col of STATUS_COLS){
      const items = tickets.filter(t => col.states.includes(t.state));
      const c = el('div', { class: 'bd-col bd-col-' + col.key });
      const head = el('div', { class: 'bd-col-head' });
      head.innerHTML = `<h3>${escapeHtml(col.title)} <span class="bd-count">${items.length}</span></h3><span class="tiny muted">${escapeHtml(col.hint)}</span>`;
      c.append(head);
      const list = el('div', { class: 'bd-cards' });
      if(!items.length) list.append(el('div', { class: 'tiny muted bd-empty', text: '—' }));
      items.forEach(t => list.append(statusCard(t)));
      c.append(list);
      side.append(c);
    }
    layout.append(side);
    body.append(layout);
  }

  // one queue card: rank number + up/down + the ticket, click opens detail
  const queueCard = (t, idx, n) => {
    const card = el('div', { class: 'bd-card is-click' + (t.requested_by === 'owner' ? ' is-owner' : ''),
      role: 'button', tabindex: '0', onclick: () => openDetail(t),
      onkeydown: (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(t); } } });
    const gutter = el('div', { class: 'bd-gutter' });
    gutter.append(el('span', { class: 'bd-rank mono', text: String(idx + 1) }));
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    gutter.append(el('div', { class: 'bd-move' }, [
      el('button', { class: 'btn ghost icon xs', title: 'Higher priority (up)', 'aria-label': `Move ${t.id} up`, disabled: idx === 0, html: icon('chev-up'), onclick: stop(() => move(t.id, -1)) }),
      el('button', { class: 'btn ghost icon xs', title: 'Lower priority (down)', 'aria-label': `Move ${t.id} down`, disabled: idx === n - 1, html: icon('chev-down'), onclick: stop(() => move(t.id, +1)) }),
    ]));
    card.append(gutter, cardMain(t));
    return card;
  };

  const statusCard = (t) => {
    const card = el('div', { class: 'bd-card is-click' + (t.requested_by === 'owner' ? ' is-owner' : ''),
      role: 'button', tabindex: '0', onclick: () => openDetail(t),
      onkeydown: (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(t); } } });
    card.append(cardMain(t));
    return card;
  };

  const cardMain = (t) => {
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
    return main;
  };

  // ticket detail: the fields from tickets.json + the ticket's own .md body,
  // fetched lazily and rendered as markdown.
  async function openDetail(t){
    const file = fileById.get(t.id);
    const box = el('div', { class: 'bd-detail' });

    const meta = el('div', { class: 'bd-detail-meta' });
    const field = (k, v) => { if(v == null || v === '' || v === false) return;
      meta.append(el('div', { class: 'bd-detail-row', html: `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span>` })); };
    field('State', t.state); field('Epic', t.epic); field('Requested by', t.requested_by);
    field('Effort', t.effort); if(t.needs_bake) field('Needs bake', 'yes'); if(t.seen) field('Seen', 'yes');
    field('Opened', t.opened); field('Closed', t.closed); field('PR', t.pr ? '#' + t.pr : '');
    field('Claimed by', t.claimed_by); field('Blocked on', t.blocked_on); field('Legacy id', t.legacy_id);
    box.append(meta);

    const bodyEl = el('div', { class: 'bd-detail-body', html: `<span class="tiny muted">Loading ticket…</span>` });
    box.append(bodyEl);

    const foot = [];
    if(file) foot.push(el('a', { class: 'btn ghost sm', href: `https://github.com/${TICKETS.repo}/blob/${TICKETS.branch}/${file.path}`, target: '_blank', rel: 'noopener', html: `${icon('external')} GitHub` }));
    const closeBtn = el('button', { class: 'btn primary', text: 'Close' });
    foot.push(closeBtn);
    const { hide } = modal({ title: `${t.id} — ${t.title || ''}`, icon: icon('board'), body: box, foot });
    closeBtn.onclick = () => hide();

    if(!file){ bodyEl.innerHTML = `<span class="tiny muted">No ticket file found for ${escapeHtml(t.id)} in the listing.</span>`; return; }
    try{
      const { text } = await getRepoText(TICKETS.repo, file.path, TICKETS.branch);
      const md = stripFrontMatter(text);
      bodyEl.innerHTML = '';
      bodyEl.append(el('div', { class: 'notes-md', html: mdToHtml(md) || '<span class="tiny muted">No description in the ticket.</span>' }));
    }catch(e){
      bodyEl.innerHTML = `<span class="tiny muted">Couldn’t load the ticket body.</span>`;
    }
  }

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
