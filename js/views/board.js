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
import { el, escapeHtml, toast, confirmDialog, modal, mdToHtml, fmtCT, ago } from '../ui.js';
import { icon } from '../icons.js';
import { ghToken, getRepoJson, getRepoText, getRepoDir, putRepoText, clearGhCache,
  stewardPRs, listBranches, branchTip } from '../github.js';

const TICKETS = {
  repo: 'kevinrhaas/custom',
  branch: 'dev',
  label: '4D Chicago',
  jsonPath: 'chicago/4d/tickets/tickets.json',
  queuePath: 'chicago/4d/tickets/QUEUE.md',
  dirPath: 'chicago/4d/tickets',
  dirUrl: 'https://github.com/kevinrhaas/custom/tree/dev/chicago/4d/tickets',
};

/**
 * WHY "IN PROGRESS" CANNOT BE READ FROM tickets.json ALONE.
 *
 * A run claims its ticket in its FIRST commit, on its own branch — and that
 * commit only reaches `dev` when the run's PR merges, at the very end. So for
 * the hour or two a run is actually working, `dev` still says its ticket is
 * `open`, and a board reading `dev` shows an empty In-progress column while
 * five runs are mid-flight. (That is deliberate in the ticket contract: "a claim
 * is only real once its PR merges", so two runs cannot both believe they hold
 * one ticket. It is right for the loop and useless for watching it.)
 *
 * The live signal is the one the project's own `ticket.mjs inflight` uses: a
 * REMOTE BRANCH carrying a ticket number. This view reads three sources and
 * says which is which, because they mean different things:
 *
 *   claim merged   the ticket itself says claimed/review on dev
 *   PR open        an open steward PR whose head branch carries the number
 *   branch pushed  a branch carrying the number, pushed within the run window,
 *                  with no PR yet — a run mid-flight, or one that died holding it
 *
 * Branch age is what separates the third from the graveyard: this repo carries
 * hundreds of old steward branches, twenty of them on tickets that are still
 * open. Only the tips pushed inside RUN_HOURS count, and only the top of the
 * queue is dated at all — the loop takes from the top, so that is where a live
 * branch is.
 */
const RUN_HOURS = 3;
const DATE_BUDGET = 12;

/** The same test `ticket.mjs branchCarries` uses: padding and separator
 *  optional, and T-0062 must not fire on `t-0620`. */
export function branchCarries(branch, id){
  const n = Number(String(id).replace(/^T-/, ''));
  if(!Number.isFinite(n)) return false;
  return new RegExp(`(?:^|[^0-9a-z])t-?0*${n}(?![0-9])`, 'i').test(branch || '');
}

// The read-only status columns (the Queue is rendered separately). `withdrawn`
// is hidden.
const STATUS_COLS = [
  { key: 'blocked',  title: 'Blocked',     states: ['blocked-owner', 'blocked-tech'], hint: 'waiting on a decision or a fix' },
];

// Finished work is its own section below the board, not a column: there are
// several hundred of them and the question about them is WHEN, not WHERE.
const FINISHED_PAGE = 40;

/**
 * FINISH ORDER — the order the work was actually finished in.
 *
 * `closed` is a Central Time DAY and nineteen tickets can close inside one, so a
 * sort on it alone leaves ties, and ties in tickets.json fall out in ticket-id
 * order — which is why a day's work used to read as if it had been done
 * alphabetically. `closed_at` (the instant a run closed the ticket) has been
 * recorded since 2026-09-03; the several hundred finished before that have only
 * the day and their PR number, and the PR number rises with time. So: day, then
 * instant, then PR, and the id only as a last resort.
 */
export function byFinish(a, b){
  return String(b.closed ?? '').localeCompare(String(a.closed ?? ''))
    || String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? ''))
    || (Number(b.pr) || 0) - (Number(a.pr) || 0)
    || String(b.id).localeCompare(String(a.id));
}

/** When a ticket finished, in the project's clock. The instant when it was
 *  recorded, the bare day when it is all there is. */
function finishedWhen(t){
  return t.closed_at ? fmtCT(t.closed_at) : (t.closed || '—');
}

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
  intro.innerHTML = `Ticket data from <span class="mono">${escapeHtml(TICKETS.jsonPath)}</span>, queue order from <span class="mono">QUEUE.md</span> (the file the loop reads), both on <span class="mono">${escapeHtml(TICKETS.branch)}</span>. Click a card for its full ticket. Reorder the <b>Queue</b> with the arrows, then <b>Commit order</b> to rewrite <span class="mono">QUEUE.md</span> (a vault token is needed to commit).`;
  wrap.append(intro);

  const body = el('div', { html: `<div class="card"><span class="tiny muted">Loading tickets…</span></div>` });
  wrap.append(body);
  root.append(wrap);

  let tickets = [];
  let queueOrder = [];      // ids of open tickets, in the order shown
  let queueSha = null;
  let dirty = false;
  let fileById = new Map(); // id → { name, path } for the ticket .md files
  let inflight = [];        // [{ ticket, kind, branch, pr, when }] — live work, see the note above
  let inflightNote = '';    // why the list is what it is, when it needs saying

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
      // ORDER comes from QUEUE.md — it is the file the owner reorders and the
      // loop reads, and it is authoritative the moment it is committed. Do NOT
      // order by tickets.json's queue_rank: that field is regenerated from
      // QUEUE.md by the project's `ticket.mjs board` run, so between a reorder
      // and that regeneration it is stale — which made the board disagree with
      // the file and look like reordering "didn't take". Fall back to queue_rank
      // only if QUEUE.md couldn't be read.
      const qIds = parseQueueIds(q.text || '');
      queueOrder = qIds.length
        ? qIds.filter(id => byId(id))
        : tickets.filter(t => t.state === 'open').sort((a, b) => (a.queue_rank ?? 1e9) - (b.queue_rank ?? 1e9)).map(t => t.id);
      dirty = false;
      render();
      // Live work is a second, slower question than the board itself, and it
      // must never hold the board up or blank it: the answer arrives and the
      // column re-renders.
      loadInflight().then(render).catch(() => {});
    }catch(e){
      body.innerHTML = '';
      const card = el('div', { class: 'card' });
      card.innerHTML = `<div class="tiny">${errNote(e)}</div>
        <p class="tiny muted" style="margin:8px 0 0">${e.status === 404 ? 'The tickets file was not found on that branch (or the repo needs a token to read).' : 'Connect a GitHub token in Fleet Ops if this repo is private.'}</p>`;
      body.append(card);
    }
  };

  /**
   * What is being worked RIGHT NOW, from the three sources above. Cost is
   * bounded: ~5 calls for the branch list, 1 for the open PRs, and at most
   * DATE_BUDGET tip reads — all through the shared 10-minute GET cache.
   */
  async function loadInflight(){
    const workable = new Map(tickets.filter(t => ['open', 'claimed', 'review'].includes(t.state)).map(t => [t.id, t]));
    const rank = (id) => { const i = queueOrder.indexOf(id); return i < 0 ? 9999 : i; };
    const found = new Map();   // ticket id → entry, first source wins

    // 1. a claim that has already merged — the ticket itself says so
    for(const t of tickets){
      if(t.state === 'claimed' || t.state === 'review'){
        found.set(t.id, { ticket: t, kind: 'claim merged', branch: null, pr: null, when: null, run: t.claimed_run || null });
      }
    }

    // 2. an open steward PR carrying a ticket number
    let prs = [];
    try{ prs = await stewardPRs(TICKETS.repo); }catch{ /* anonymous rate limit; the rest still works */ }
    for(const pr of prs){
      const ref = pr.head?.ref || '';
      const hit = [...workable.values()].find(t => branchCarries(ref, t.id));
      if(hit && !found.has(hit.id)){
        found.set(hit.id, { ticket: hit, kind: 'PR open', branch: ref, pr, when: pr.updated_at || pr.created_at, run: hit.claimed_run || null });
      }
    }

    // 3. a branch pushed inside the run window with no PR yet — the state a run
    //    spends most of its life in, and the one the old column could never show
    let branches = [];
    try{ branches = await listBranches(TICKETS.repo); }catch{ branches = []; }
    const candidates = [];
    for(const b of branches){
      const name = b.name || '';
      if(!name.startsWith('steward/')) continue;
      const hit = [...workable.values()].find(t => branchCarries(name, t.id));
      if(hit && !found.has(hit.id) && !candidates.some(c => c.id === hit.id)) candidates.push({ id: hit.id, ticket: hit, name });
    }
    candidates.sort((a, b) => rank(a.id) - rank(b.id));
    const dated = candidates.slice(0, DATE_BUDGET);
    const cutoff = Date.now() - RUN_HOURS * 3600e3;
    await Promise.allSettled(dated.map(async (c) => {
      const tip = await branchTip(TICKETS.repo, c.name).catch(() => null);
      const at = tip?.date ? Date.parse(tip.date) : NaN;
      if(Number.isFinite(at) && at >= cutoff){
        found.set(c.id, { ticket: c.ticket, kind: 'branch pushed', branch: c.name, pr: null, when: tip.date, run: null });
      }
    }));

    inflight = [...found.values()].sort((a, b) => rank(a.ticket.id) - rank(b.ticket.id));
    const older = candidates.length - dated.length;
    inflightNote = older > 0
      ? `${older} more branch${older === 1 ? '' : 'es'} sit on open tickets further down the queue; only the top ${DATE_BUDGET} are dated.`
      : '';
  }

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
    // Anything in QUEUE.md belongs to the Queue (the file is the source of
    // truth); the status columns show tickets by state that are NOT queued.
    const queueSet = new Set(queueOrder);
    const side = el('div', { class: 'bd-side' });

    // In progress comes FIRST and is computed, not filtered: a run's claim lives
    // on its own branch until its PR merges, so `dev` alone cannot see it.
    side.append(inflightCol());

    for(const col of STATUS_COLS){
      const items = tickets.filter(t => col.states.includes(t.state) && !queueSet.has(t.id));
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

    // --- finished, newest first ------------------------------------------
    body.append(finishedSection(tickets.filter(t => t.state === 'done').sort(byFinish)));
  }

  // The record of what has shipped, in the order it shipped. Paged rather than
  // capped: the whole history is reachable, but the answer to "what has the loop
  // done today" is the first screen.
  let finishedShown = FINISHED_PAGE;
  function finishedSection(finished){
    const sec = el('div', { class: 'bd-finished' });
    const head = el('div', { class: 'bd-col-head' });
    head.innerHTML = `<h3>Finished <span class="bd-count">${finished.length}</span></h3>
      <span class="tiny muted">newest first — the order they were finished in, not by number</span>`;
    sec.append(head);
    if(!finished.length){ sec.append(el('div', { class: 'tiny muted', text: 'Nothing finished yet.' })); return sec; }

    const list = el('div', { class: 'bd-done-list' });
    const draw = () => {
      list.innerHTML = '';
      let day = null;
      finished.slice(0, finishedShown).forEach((t) => {
        // A day heading, so a glance answers "what shipped today".
        if(t.closed !== day){
          day = t.closed;
          list.append(el('div', { class: 'bd-done-day tiny', text: day || 'undated' }));
        }
        const row = el('div', { class: 'bd-done-row is-click' + (t.requested_by === 'owner' ? ' is-owner' : ''),
          role: 'button', tabindex: '0', onclick: () => openDetail(t),
          onkeydown: (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(t); } } });
        const when = t.closed_at ? finishedWhen(t).replace(/^.*?, /, '').replace(/^\d{4}, /, '') : '';
        row.innerHTML = `<span class="bd-done-when tiny mono">${escapeHtml(when || '—')}</span>
          <span class="bd-tid mono">${escapeHtml(t.id)}</span>
          <span class="bd-done-title">${escapeHtml(t.title || '(untitled)')}</span>`;
        const chips = el('span', { class: 'bd-done-chips' });
        if(t.requested_by === 'owner') chips.append(el('span', { class: 'bd-chip owner', text: 'OWNER' }));
        if(t.pr) chips.append(el('a', { class: 'bd-chip link', href: `https://github.com/${TICKETS.repo}/pull/${t.pr}`,
          target: '_blank', rel: 'noopener', text: '#' + t.pr, onclick: (e) => e.stopPropagation() }));
        row.append(chips);
        list.append(row);
      });
      if(finishedShown < finished.length){
        list.append(el('button', { class: 'btn ghost sm', text: `Show ${Math.min(FINISHED_PAGE, finished.length - finishedShown)} more of ${finished.length - finishedShown}`,
          onclick: () => { finishedShown += FINISHED_PAGE; draw(); } }));
      }
    };
    draw();
    sec.append(list);
    return sec;
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
    const main = cardMain(t);
    // The same ticket can be at the top of the queue AND be the one a run is
    // working: the claim has not merged yet, so the queue still lists it. Say so
    // in place rather than leaving the reader to compare two columns.
    const live = inflight.find(f => f.ticket.id === t.id);
    if(live) main.append(el('div', { class: 'bd-inflight tiny',
      html: `<span class="fo-dot ${KIND_DOT[live.kind] || 'muted'}"></span><span class="bd-inflight-kind">${escapeHtml(live.kind)}</span>` }));
    card.append(gutter, main);
    return card;
  };

  const KIND_DOT = { 'claim merged': 'ok', 'PR open': 'live', 'branch pushed': 'live' };

  function inflightCol(){
    const c = el('div', { class: 'bd-col bd-col-progress' });
    const head = el('div', { class: 'bd-col-head' });
    head.innerHTML = `<h3>In progress <span class="bd-count">${inflight.length}</span></h3>
      <span class="tiny muted">claimed on a branch, or in review</span>`;
    c.append(head);
    const list = el('div', { class: 'bd-cards' });
    if(!inflight.length){
      list.append(el('div', { class: 'tiny muted bd-empty',
        text: inflightNote ? '—' : 'Nothing in flight. A run\u2019s claim shows here within a minute of it pushing its branch.' }));
    }
    inflight.forEach((f) => {
      const t = f.ticket;
      const card = el('div', { class: 'bd-card is-click' + (t.requested_by === 'owner' ? ' is-owner' : ''),
        role: 'button', tabindex: '0', onclick: () => openDetail(t),
        onkeydown: (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(t); } } });
      const main = cardMain(t);
      const line = el('div', { class: 'bd-inflight tiny' });
      line.append(el('span', { class: `fo-dot ${KIND_DOT[f.kind] || 'muted'}` }));
      line.append(el('span', { class: 'bd-inflight-kind', text: f.kind }));
      if(f.when) line.append(el('span', { class: 'muted', text: ago(new Date(f.when).getTime()) }));
      if(f.pr){
        line.append(el('a', { class: 'bd-chip link', href: f.pr.html_url, target: '_blank', rel: 'noopener',
          text: '#' + f.pr.number, onclick: (e) => e.stopPropagation() }));
      }
      if(f.branch){
        line.append(el('a', { class: 'bd-inflight-branch mono', href: `https://github.com/${TICKETS.repo}/tree/${encodeURIComponent(f.branch)}`,
          target: '_blank', rel: 'noopener', text: f.branch.replace(/^steward\//, ''), title: f.branch,
          onclick: (e) => e.stopPropagation() }));
      }
      if(f.run){
        line.append(el('a', { class: 'bd-run', href: f.run, target: '_blank', rel: 'noopener',
          html: `${icon('external')} run`, title: 'the steward run that claimed it', onclick: (e) => e.stopPropagation() }));
      }
      main.append(line);
      card.append(main);
      list.append(card);
    });
    c.append(list);
    if(inflightNote) c.append(el('div', { class: 'tiny muted bd-inflight-note', text: inflightNote }));
    return c;
  }

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
    // WHO holds a claimed ticket, and where its log is. `claimed_by` is the
    // claim time; `claimed_run` is the Actions run that took it, which is the
    // only way to tell five parallel slices apart.
    if(t.state === 'claimed' || t.state === 'review'){
      const held = el('div', { class: 'bd-held tiny muted' });
      held.append(el('span', { text: t.claimed_by || 'claimed' }));
      if(t.claimed_run){
        held.append(el('a', { class: 'bd-run', href: t.claimed_run, target: '_blank', rel: 'noopener',
          title: 'the steward run holding this ticket', html: `${icon('external')} run`,
          onclick: (e) => e.stopPropagation() }));
      }
      main.append(held);
    }
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
    field('Opened', t.opened);
    field('Finished', t.closed_at ? finishedWhen(t) + ' CT' : t.closed);
    field('PR', t.pr ? '#' + t.pr : '');
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

// The ticket ids in QUEUE.md, in file order — the authoritative queue order.
export function parseQueueIds(text){
  const ids = [];
  for(const line of String(text || '').split('\n')){
    const m = line.match(/^(T-\d+)\b/);
    if(m) ids.push(m[1]);
  }
  return ids;
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
