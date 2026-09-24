// board.js — the 4D Chicago ticket board.
//
// The 4D Chicago project (kevinrhaas/chicago, chicago.polecat.live/4d/) keeps its
// tickets in their OWN repository, kevinrhaas/chicago-tickets, since 2026-09-23 —
// split out of the code repo so ticket and queue edits never ride a code PR and
// never conflict with one. In that repo:
//   • QUEUE.md       — the priority order, top = next, on `main`. **The owner
//                      orders this file** (agents only append/remove). This is
//                      the one file Manager writes: reordering the queue commits
//                      it straight to main — no PR, no merge, no conflict lap.
//   • T-0000-0249/…  — one file per ticket (front matter + the ask/acceptance),
//                      in folders of 250 by ticket number.
//   • tickets.json   — generated from the two above by `ticket.mjs board` and
//                      force-pushed to the `board` branch by the tickets repo's
//                      own workflow (one writer, never hand-edited). It carries
//                      each ticket's `path` and `pr_url`, so no directory listing
//                      is needed to open a ticket.
//
// Live work (branches and open PRs carrying a ticket number) is still read from
// the CODE repo, kevinrhaas/chicago — that is where runs push.
//
// Tickets in state `blocked-owner` are the owner's decisions; they are drawn
// first, above the queue, with the question each one is waiting on. (T-0030 for
// the board itself.)
import { el, escapeHtml, toast, confirmDialog, promptDialog, modal, wireDragReorder, mdToHtml, fmtCT, ago } from '../ui.js';
import { icon } from '../icons.js';
import { ghToken, getRepoJson, getRepoText, putRepoText, clearGhCache,
  stewardPRs, listBranches, branchTip } from '../github.js';

const TICKETS = {
  repo: 'kevinrhaas/chicago-tickets',   // tickets + QUEUE.md
  branch: 'main',
  boardBranch: 'board',                 // generated tickets.json, one writer
  codeRepo: 'kevinrhaas/chicago',       // where runs push branches and open PRs
  label: '4D Chicago',
  jsonPath: 'tickets.json',
  queuePath: 'QUEUE.md',
  dirUrl: 'https://github.com/kevinrhaas/chicago-tickets',
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
  intro.innerHTML = `Tickets from <span class="mono">${escapeHtml(TICKETS.repo)}</span> — queue order from <span class="mono">QUEUE.md</span> on <span class="mono">${escapeHtml(TICKETS.branch)}</span> (the file the loop reads), ticket data from the generated <span class="mono">${escapeHtml(TICKETS.jsonPath)}</span> on <span class="mono">${escapeHtml(TICKETS.boardBranch)}</span>. Click a row for its full ticket. Drag a <b>Queue</b> row by its handle (or use the arrows) — past a band heading moves it into that band — then <b>Commit order</b> to rewrite <span class="mono">QUEUE.md</span> (a vault token is needed to commit).`;
  wrap.append(intro);

  const body = el('div', { html: `<div class="card"><span class="tiny muted">Loading tickets…</span></div>` });
  wrap.append(body);
  root.append(wrap);

  let tickets = [];
  let queueOrder = [];      // ids of open tickets, in the order shown
  let queueItems = [];      // QUEUE.md as items: band/comment blocks + ticket blocks (parseQueueItems)
  let queueText = '';       // QUEUE.md exactly as loaded — a commit is refused if GitHub's has moved
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
      const [{ json }, q] = await Promise.all([
        getRepoJson(TICKETS.repo, TICKETS.jsonPath, TICKETS.boardBranch),
        getRepoText(TICKETS.repo, TICKETS.queuePath, TICKETS.branch).catch(() => ({ sha: null })),
      ]);
      tickets = Array.isArray(json?.tickets) ? json.tickets : [];
      queueSha = q.sha;
      // tickets.json names each ticket's file (folders of 250), so opening one
      // needs no directory listing.
      fileById = new Map();
      for(const t of tickets){ if(t.id && t.path) fileById.set(t.id, { name: t.path.split('/').pop(), path: t.path }); }
      // ORDER comes from QUEUE.md — it is the file the owner reorders and the
      // loop reads, and it is authoritative the moment it is committed. Do NOT
      // order by tickets.json's queue_rank: that field is regenerated from
      // QUEUE.md by the project's `ticket.mjs board` run, so between a reorder
      // and that regeneration it is stale — which made the board disagree with
      // the file and look like reordering "didn't take". Fall back to queue_rank
      // only if QUEUE.md couldn't be read.
      queueText = q.text || '';
      queueItems = parseQueueItems(queueText);
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
    try{ prs = await stewardPRs(TICKETS.codeRepo); }catch{ /* anonymous rate limit; the rest still works */ }
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
    try{ branches = await listBranches(TICKETS.codeRepo); }catch{ branches = []; }
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
      const tip = await branchTip(TICKETS.codeRepo, c.name).catch(() => null);
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

  // One step up or down the FILE: past a band heading counts as a step, so the
  // arrows can carry a ticket from one band into the next.
  const move = (id, dir) => {
    const next = moveQueueItem(queueItems, id, dir);
    if(!next) return;
    setItems(next);
  };
  const setItems = (next) => {
    queueItems = next;
    queueOrder = queueItems.filter(it => it.kind === 't').map(it => it.id);
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
      // The new file is the rows EXACTLY as they sit on screen, band headings
      // included — so it may only replace the file it was drawn from. A run that
      // filed or closed a ticket meanwhile would otherwise be silently undone.
      if(q.text !== queueText){
        toast('The queue changed on GitHub', { kind: 'warn', body: 'A run changed QUEUE.md since you loaded it. Refresh, then reorder again.' });
        return;
      }
      const next = composeQueue(queueItems);
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

    // --- the owner's decisions, above everything --------------------------
    // A ticket carrying `decision: pending` is waiting on the owner, not on a run:
    // the loop skips it until it is answered. Each one says its question, its
    // options and the recommendation, and answering commits the choice to the
    // ticket file on main — the next run picks it up from there.
    const decisions = tickets.filter(t => t.decision === 'pending');
    if(decisions.length) body.append(decisionsSection(decisions));

    // --- in progress and the status groups: collapsible, above the queue ----
    // Anything in QUEUE.md belongs to the Queue (the file is the source of
    // truth); the status groups show tickets by state that are NOT queued.
    // In progress is computed, not filtered: a run's claim can live on its own
    // branch before the tickets repo shows it.
    const queueSet = new Set(queueOrder);
    body.append(section('progress', 'In progress', inflight.length, 'claimed on a branch, or in review', inflightList()));
    for(const col of STATUS_COLS){
      const items = tickets.filter(t => col.states.includes(t.state) && !queueSet.has(t.id));
      const list = el('div', { class: 'bd-rows' });
      if(!items.length) list.append(el('div', { class: 'tiny muted bd-empty', text: 'None.' }));
      items.forEach(t => list.append(statusRow(t)));
      body.append(section(col.key, col.title, items.length, col.hint, list));
    }

    // --- the Queue: one tight row per ticket, dragged or arrowed into place ---
    body.append(queueList());

    // --- finished, newest first ------------------------------------------
    body.append(finishedSection(tickets.filter(t => t.state === 'done').sort(byFinish)));
  }

  // A collapsible group. Its open/closed state is remembered per browser; by
  // default a group opens when it has something in it.
  function section(key, title, count, hint, content){
    const k = `manager.board.open.${key}`;
    let open = key === 'progress' && count > 0;   // live work shows; the rest starts folded
    try{ const v = localStorage.getItem(k); if(v === '1' || v === '0') open = v === '1'; }catch{}
    const d = el('details', { class: 'bd-sect bd-sect-' + key });
    d.open = open;
    const sum = el('summary', { class: 'bd-sect-head' });
    sum.innerHTML = `<span class="bd-sect-caret" aria-hidden="true">${icon('chev-down')}</span>
      <h3>${escapeHtml(title)} <span class="bd-count">${count}</span></h3><span class="tiny muted">${escapeHtml(hint)}</span>`;
    d.append(sum, content);
    d.addEventListener('toggle', () => { try{ localStorage.setItem(k, d.open ? '1' : '0'); }catch{} });
    return d;
  }

  // One line per ticket: id, title (clipped), a few chips. The same row serves
  // the status groups; the queue's rows add a grip, a rank and the arrows.
  function rowMain(t, id){
    const main = el('div', { class: 'bd-row-main' });
    main.append(el('span', { class: 'bd-tid mono', text: id || t?.id || '' }));
    main.append(el('span', { class: 'bd-row-title', text: t?.title || '(no ticket file — still listed in QUEUE.md)', title: t?.title || '' }));
    const chips = el('span', { class: 'bd-row-chips' });
    if(t){
      if(t.decision === 'pending') chips.append(el('span', { class: 'bd-chip warn', text: 'decision', title: 'waiting on your answer — see Needs your decision' }));
      if(t.requested_by === 'owner') chips.append(el('span', { class: 'bd-chip owner', text: 'OWNER' }));
      if(t.needs_bake) chips.append(el('span', { class: 'bd-chip warn', text: 'bake' }));
      if(t.state === 'claimed' || t.state === 'review') chips.append(el('span', { class: 'bd-chip', text: t.state }));
      if(t.effort) chips.append(el('span', { class: 'bd-chip', text: t.effort }));
      if(t.epic) chips.append(el('span', { class: 'bd-chip ghost', text: t.epic }));
    }
    const live = inflight.find(f => f.ticket.id === (t?.id || id));
    if(live) chips.append(el('span', { class: 'bd-row-live', title: live.kind, html: `<span class="fo-dot ${KIND_DOT[live.kind] || 'muted'}"></span>` }));
    main.append(chips);
    return main;
  }
  function clickable(row, t){
    if(!t) return row;
    row.classList.add('is-click');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.addEventListener('click', () => openDetail(t));
    row.addEventListener('keydown', (e) => { if(e.target === row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); openDetail(t); } });
    return row;
  }
  function statusRow(t){
    const row = el('div', { class: 'bd-row' + (t.requested_by === 'owner' ? ' is-owner' : '') });
    row.append(rowMain(t));
    if(t.blocked_on) row.append(el('div', { class: 'bd-row-sub tiny muted', text: t.blocked_on }));
    return clickable(row, t);
  }
  function inflightList(){
    const list = el('div', { class: 'bd-rows' });
    if(!inflight.length){
      list.append(el('div', { class: 'tiny muted bd-empty',
        text: inflightNote ? '—' : 'Nothing in flight. A run\u2019s claim shows here within a minute of it pushing its branch.' }));
    }
    inflight.forEach((f) => {
      const t = f.ticket;
      const row = el('div', { class: 'bd-row' + (t.requested_by === 'owner' ? ' is-owner' : '') });
      row.append(rowMain(t));
      const line = el('div', { class: 'bd-row-sub tiny' });
      line.append(el('span', { class: `fo-dot ${KIND_DOT[f.kind] || 'muted'}` }), el('span', { class: 'bd-inflight-kind', text: f.kind }));
      if(f.when) line.append(el('span', { class: 'muted', text: ago(new Date(f.when).getTime()) }));
      if(f.pr) line.append(el('a', { class: 'bd-chip link', href: f.pr.html_url, target: '_blank', rel: 'noopener', text: '#' + f.pr.number, onclick: (e) => e.stopPropagation() }));
      if(f.branch) line.append(el('a', { class: 'bd-inflight-branch mono', href: `https://github.com/${TICKETS.codeRepo}/tree/${encodeURIComponent(f.branch)}`,
        target: '_blank', rel: 'noopener', text: f.branch.replace(/^steward\//, ''), title: f.branch, onclick: (e) => e.stopPropagation() }));
      if(f.run) line.append(el('a', { class: 'bd-run', href: f.run, target: '_blank', rel: 'noopener', html: `${icon('external')} run`, title: 'the steward run that claimed it', onclick: (e) => e.stopPropagation() }));
      row.append(line);
      list.append(clickable(row, t));
    });
    if(inflightNote) list.append(el('div', { class: 'tiny muted bd-inflight-note', text: inflightNote }));
    return list;
  }

  // The queue as the FILE is: band headings where they stand, ticket rows between
  // them. Drag a row by its grip (or use the arrows) — across a heading moves it
  // into that band. Commit writes the file in exactly the order on screen.
  function queueList(){
    const wrap = el('div', { class: 'bd-queue' });
    const n = queueOrder.length;
    const head = el('div', { class: 'bd-col-head' });
    head.innerHTML = `<h3>Queue <span class="bd-count">${n}</span></h3><span class="tiny muted">top = next · drag a row by its handle, or use the arrows</span>`;
    wrap.append(head);
    const list = el('div', { class: 'bd-qlist' });
    const items = queueItems.length ? queueItems : queueOrder.map(id => ({ kind: 't', id, lines: [`${id} — ${byId(id)?.title || ''}`] }));
    if(!n) list.append(el('div', { class: 'tiny muted bd-empty', text: 'Queue is empty.' }));
    let rank = 0;
    items.forEach((it, idx) => {
      if(it.kind === 'sep'){
        const label = bandLabel(it.lines);
        list.append(el('div', { class: 'bd-qitem ' + (label ? 'bd-band' : 'bd-sep-quiet'), 'data-id': 's:' + idx,
          text: label || '', title: label ? it.lines.filter(l => l.trim()).join('\n').slice(0, 800) : '' }));
        return;
      }
      rank += 1;
      const t = byId(it.id);
      const row = el('div', { class: 'bd-qitem bd-row bd-qrow' + (t?.requested_by === 'owner' ? ' is-owner' : ''), 'data-id': 't:' + it.id });
      const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
      row.append(
        el('span', { class: 'bd-grip', draggable: 'true', title: 'Drag to reorder', 'aria-hidden': 'true', html: icon('grip'), onclick: (e) => e.stopPropagation() }),
        el('span', { class: 'bd-rank mono', text: String(rank) }),
        rowMain(t, it.id),
        el('span', { class: 'bd-move' }, [
          el('button', { class: 'btn ghost icon xs', title: 'Up', 'aria-label': `Move ${it.id} up`, disabled: rank === 1, html: icon('chev-up'), onclick: stop(() => move(it.id, -1)) }),
          el('button', { class: 'btn ghost icon xs', title: 'Down', 'aria-label': `Move ${it.id} down`, disabled: rank === n, html: icon('chev-down'), onclick: stop(() => move(it.id, +1)) }),
        ]));
      list.append(clickable(row, t));
    });
    const byKey = new Map(items.map((it, idx) => [it.kind === 'sep' ? 's:' + idx : 't:' + it.id, it]));
    wireDragReorder(list, '.bd-qitem', '.bd-grip', (keys) => {
      const next = keys.map(k => byKey.get(k)).filter(Boolean);
      if(next.length === items.length && next.some((it, i) => it !== items[i])) setItems(next);
    });
    wrap.append(list);
    return wrap;
  }

  function decisionsSection(list){
    const sec = el('div', { class: 'card bd-decisions' });
    const head = el('div', { class: 'bd-col-head' });
    head.innerHTML = `<h3>Needs your decision <span class="bd-count">${list.length}</span></h3>
      <span class="tiny muted">the loop skips these until you answer · answering commits to ${escapeHtml(TICKETS.repo)}</span>`;
    sec.append(head);
    const rank = (t) => { const i = queueOrder.indexOf(t.id); return i < 0 ? 1e9 : i; };
    [...list].sort((a, b) => rank(a) - rank(b)).forEach(t => {
      const row = el('div', { class: 'bd-decision' });
      const q = el('div', { class: 'bd-decision-q is-click', role: 'button', tabindex: '0', onclick: () => openDetail(t),
        onkeydown: (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(t); } } });
      q.innerHTML = `<span class="bd-tid mono">${escapeHtml(t.id)}</span>
        <b>${escapeHtml(t.decision_question || t.blocked_on || t.title || '')}</b>
        <span class="tiny muted">${escapeHtml(t.title || '')}</span>`;
      row.append(q);
      const opts = el('div', { class: 'bd-decision-opts' });
      for(const o of (Array.isArray(t.decision_options) ? t.decision_options : [])){
        const rec = t.decision_rec && String(t.decision_rec).trim().toLowerCase().startsWith(`(${o.key})`);
        opts.append(el('button', { class: 'btn sm ' + (rec ? 'primary' : 'ghost'),
          title: rec ? 'Recommended' : '', text: `(${o.key}) ${o.label}${rec ? ' ★' : ''}`,
          onclick: () => answerDecision(t, o) }));
      }
      if(t.decision_rec) opts.append(el('div', { class: 'tiny muted bd-decision-rec', text: `Recommendation: ${t.decision_rec}` }));
      row.append(opts);
      sec.append(row);
    });
    return sec;
  }

  async function answerDecision(t, option){
    if(!ghToken()){ toast('Connect a GitHub token first', { kind: 'warn', body: 'Answering needs a PAT from the vault (Fleet Ops → GitHub access).' }); return; }
    if(!t.path){ toast('No ticket file', { kind: 'err', body: `tickets.json names no file for ${t.id}.` }); return; }
    // A NOTE TRAVELS WITH THE ANSWER. Some answers are a fact, not just a letter — "(a)
    // I will name the source" is only useful with the source — and the buttons alone
    // left the owner no way to give it here (T-0909, 2026-09-24).
    const note = await promptDialog({ title: `Answer ${t.id}: (${option.key})`,
      message: `${option.label}\n\nThis commits your answer to ${t.path} on ${TICKETS.branch}. The next run acts on it.`,
      label: 'Note for the next run (optional) — a source, a link, a detail',
      placeholder: 'e.g. https://… or "only for the east side"', okText: 'Commit answer' });
    if(note === null) return;
    try{
      const f = await getRepoText(TICKETS.repo, t.path, TICKETS.branch);
      const next = answerTicketText(f.text, option, new Date(), note);
      await putRepoText(TICKETS.repo, t.path, next, f.sha, {
        message: `${t.id}: owner decision (${option.key}) via Manager`, branch: TICKETS.branch });
      clearGhCache();
      toast(`${t.id} answered`, { kind: 'ok', body: 'The board shows it once the ticket board regenerates.' });
      t.decision = 'answered';
      render();
    }catch(e){
      toast('Answer failed', { kind: 'err', body: e.status === 409 ? 'The ticket changed on GitHub since you loaded it — refresh and try again.' : (e.message || 'Could not write the ticket') });
    }
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
        if(t.pr) chips.append(el('a', { class: 'bd-chip link', href: t.pr_url || `https://github.com/${TICKETS.codeRepo}/pull/${t.pr}`,
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
  const KIND_DOT = { 'claim merged': 'ok', 'PR open': 'live', 'branch pushed': 'live' };



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
  // THE FILE'S SHAPE IS THE OWNER'S TOO. QUEUE.md is banded — `# --- 3B. RECONSTRUCT
  // RESIDENTS …` headings sit between the ticket lines — and this used to hoist every
  // comment to the top and rebuild the body as a bare list, so one reorder from the
  // board flattened every band. Now only the TICKET LINES move: each keeps a slot in
  // the file, the slots are refilled in the new order, and every other line — band
  // headings, notes, blanks — stays exactly where it was.
  //
  // A `#   ? T-NNNN DECISION: …` line (ticket.mjs ask) belongs to the ticket above it
  // and moves with it, so a question never ends up under somebody else's ticket.
  const lines = String(text || '').replace(/\n+$/, '').split('\n');
  const skeleton = [];            // a string (kept line) or null (a ticket slot)
  const entryById = new Map();    // id → [its line, …its attached decision lines]
  const fileOrder = [];
  for(let i = 0; i < lines.length; i++){
    const m = lines[i].match(/^(T-\d+)\b/);
    if(!m){ skeleton.push(lines[i]); continue; }
    const block = [lines[i]];
    const attached = new RegExp(`^#\\s*\\?\\s*${m[1]}\\b`);
    while(i + 1 < lines.length && attached.test(lines[i + 1])) block.push(lines[++i]);
    entryById.set(m[1], block);
    fileOrder.push(m[1]);
    skeleton.push(null);
  }
  const seen = new Set();
  const seq = [];
  for(const id of order){
    if(seen.has(id)) continue;
    seen.add(id);
    seq.push(entryById.get(id) || [`${id} — ${byId?.(id)?.title || ''}`.trimEnd()]);
  }
  for(const id of fileOrder){ if(!seen.has(id)){ seen.add(id); seq.push(entryById.get(id)); } }   // never drop an unknown line
  const out = [];
  let k = 0;
  for(const item of skeleton){
    if(item !== null){ out.push(item); continue; }
    if(k < seq.length) out.push(...seq[k++]);
  }
  while(k < seq.length) out.push(...seq[k++]);   // more tickets than slots: the rest at the foot
  return out.join('\n') + '\n';
}

/**
 * Record an owner's answer in a ticket's text: `decision: pending` → `answered`,
 * `decision_answer: <key>`, and a dated line appended under the body so the
 * reasoning trail stays in the ticket. Pure, so the smoke test can hold it.
 */
export function answerTicketText(text, option, when = new Date(), note = ''){
  const s = String(text || '');
  if(!s.startsWith('---')) throw new Error('ticket has no front matter');
  const end = s.indexOf('\n---', 3);
  if(end < 0) throw new Error('ticket front matter is not closed');
  let fm = s.slice(0, end);
  const rest = s.slice(end);
  if(!/^decision: pending$/m.test(fm)) throw new Error('ticket is not waiting on a decision');
  fm = fm.replace(/^decision: pending$/m, 'decision: answered');
  fm = /^decision_answer: /m.test(fm)
    ? fm.replace(/^decision_answer: .*$/m, `decision_answer: ${option.key}`)
    : fm + `\ndecision_answer: ${option.key}`;
  const day = when.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const n = String(note || '').trim();
  return `${fm}${rest.replace(/\s*$/, '')}\n\n**Owner answer (${day}, via Manager):** (${option.key}) ${option.label}\n`
    + (n ? `\n**Owner's note:** ${n}\n` : '');
}

/**
 * QUEUE.md as an ordered list of items, so the board can show and reorder it as
 * the file is: `{ kind:'t', id, lines }` for a ticket line (with any `#   ? T-NNNN
 * DECISION:` lines under it, which belong to it), and `{ kind:'sep', lines }` for
 * every run of other lines — band headings, notes, blanks. composeQueue() of the
 * unchanged list gives back the file byte for byte.
 */
export function parseQueueItems(text){
  const lines = String(text || '').replace(/\n+$/, '').split('\n');
  const items = [];
  let sep = null;
  for(let i = 0; i < lines.length; i++){
    const m = lines[i].match(/^(T-\d+)\b/);
    if(!m){
      if(!sep){ sep = { kind: 'sep', lines: [] }; items.push(sep); }
      sep.lines.push(lines[i]);
      continue;
    }
    sep = null;
    const block = [lines[i]];
    const attached = new RegExp(`^#\\s*\\?\\s*${m[1]}\\b`);
    while(i + 1 < lines.length && attached.test(lines[i + 1])) block.push(lines[++i]);
    items.push({ kind: 't', id: m[1], lines: block });
  }
  return items;
}
export function composeQueue(items){
  return items.flatMap(it => it.lines).join('\n') + '\n';
}
/** Move a ticket one item up or down (a band heading counts as a step, so the
 *  ticket crosses into the neighbouring band). Returns a new list, or null. */
export function moveQueueItem(items, id, dir){
  const i = items.findIndex(it => it.kind === 't' && it.id === id);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= items.length) return null;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  // Two band blocks now adjacent (a ticket was the only thing between them) is
  // fine: composeQueue joins their lines in order.
  return next;
}
/** The first `# --- …` heading in a separator block, trimmed, or '' if none. */
export function bandLabel(lines){
  for(const l of lines || []){
    const m = String(l).match(/^#\s*-{3,}\s*(.+?)\s*-*\s*$/);
    if(m && m[1]) return m[1];
  }
  return '';
}
