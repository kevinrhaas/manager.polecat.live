// Fleet Ops — Manager's steward console over the GitHub API.
//
// Drives kevinrhaas/polecat-platform's steward from inside Manager: toggle
// the hourly focus roster (.github/steward/focus.json — data flips are
// sanctioned direct commits, guarded by sha compare-and-swap), dispatch
// improve/sweep runs, and observe recent steward runs plus the open steward
// PRs and sweep-findings issues across every fleet repo.
//
// Reads work unauthenticated on public repos (low rate limit); writes need a
// GitHub PAT picked from the Credentials vault (see js/github.js — only the
// vault row's id is stored, never the token). Everything degrades to inline
// error/empty states — no call here may crash the view or log to console.
import { Store } from '../store.js';
import { el, escapeHtml, toast, ago, confirmDialog } from '../ui.js';
import { fmtCT } from '../ui.js';
import { nextRunAt, isoToLocalInput, localInputToIso, utcHourLabel } from '../schedule.js';
import { icon } from '../icons.js';
import {
  whoami, ghCred, ghToken, fleetOpsCfg, setFleetOpsCfg,
  getRoster, putRoster, dispatchWorkflow, stewardRuns, stewardPRs, sweepIssues,
  checkState, fleetRepos, IMPROVE_WORKFLOW, SWEEP_WORKFLOWS,
} from '../github.js';

export function renderFleetOps(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('rocket')}</span><h2>Fleet Ops</h2>
    <span class="muted tiny">the platform steward, driven from Manager</span>`;
  wrap.append(title);

  wrap.append(connectCard(ctx));

  const grid = el('div', { class: 'fo-grid' });
  grid.append(rosterCard(), dispatchCard());
  wrap.append(grid);
  wrap.append(healthCard());
  wrap.append(runsCard());
  wrap.append(workCard(ctx));

  root.append(wrap);
}

// ---- connect: pick the vault credential that holds a GitHub PAT ------------
function connectCard(ctx){
  const card = el('div', { class: 'card fo-connect' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">GitHub access</h2></div>`;
  const row = el('div', { class: 'fo-row' });

  const creds = Store.credentials('global');
  const sel = el('select', { class: 'input', style: 'max-width:260px' });
  sel.append(el('option', { value: '', text: creds.length ? 'No token (public read-only)' : 'No credentials in the vault yet' }));
  creds.forEach(c => sel.append(el('option', { value: c.id, text: c.name || c.key || 'Unnamed credential', selected: fleetOpsCfg().credId === c.id })));

  const status = el('span', { class: 'tiny muted fo-status' });
  const refreshStatus = async () => {
    const cred = ghCred();
    if(!cred){ status.innerHTML = 'Read-only · unauthenticated (≈60 req/h). Writes disabled.'; return; }
    if(!ghToken()){ status.innerHTML = `<span class="fo-warn">${icon('lock')} That credential is encrypted and locked in this browser — unlock it in Admin → Data source.</span>`; return; }
    status.textContent = 'Checking token…';
    try{
      const u = await whoami();
      status.innerHTML = `${icon('check')} Connected as <b>${escapeHtml(u.login)}</b> — roster writes and dispatch enabled.`;
      status.classList.add('fo-ok');
    }catch(e){
      status.innerHTML = `<span class="fo-warn">${icon('warning')} ${escapeHtml(e.message)}</span>`;
    }
  };
  sel.addEventListener('change', () => { setFleetOpsCfg({ credId: sel.value || null }); status.classList.remove('fo-ok'); refreshStatus(); });

  row.append(el('label', { class: 'tiny muted', text: 'Token from vault' }), sel,
    el('button', { class: 'btn sm', html: `${icon('refresh')} Test`, onclick: refreshStatus }),
    el('button', { class: 'btn ghost sm', html: `${icon('key')} Open vault`, onclick: () => ctx.go('credentials') }));
  card.append(row, status);
  refreshStatus();
  return card;
}

// ---- focus roster: full schedule control per lane ---------------------------
// Each lane carries the platform's schedule fields (see js/schedule.js and
// the canonical evaluator in polecat-platform): cadence, offset ("runs at"),
// an active hour window, a start moment, and an expiry ("run every X until
// Y"). The tick is hourly at :03 UTC — that's the scheduling granularity.
function laneNextLabel(a){
  if(!a.enabled) return 'off';
  const n = nextRunAt(a);
  if(!n) return a.until && new Date(a.until) <= new Date() ? 'ended' : 'never';
  return `next ${fmtCT(n.getTime())}`;
}
// Platform-level jobs (focus.json `jobs`) — same lane schema, friendlier names.
const JOB_META = {
  'fleet-improve': { label: 'Fleet improve', hint: 'steward picks the app that most needs work' },
  'sweep-ux':      { label: 'UX sweep',      hint: 'files findings issues per app' },
  'sweep-tech':    { label: 'Tech sweep',    hint: 'audits contracts, drift, CI health' },
  'janitor':       { label: 'Janitor',       hint: 'merges green steward PRs' },
};
function rosterCard(){
  const card = el('div', { class: 'card fo-roster' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Focus roster</h2>
    <span class="sp"></span></div>
    <p class="tiny muted" style="margin:0 0 10px">Per-app improve lanes (<span class="mono">.github/steward/focus.json</span> on polecat-platform; ticks hourly at :03 UTC). Set cadence, align which hours it lands on, fence it to a time window, or give it a start/stop — then commit; the next tick picks it up.</p>`;
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Loading roster…</span>` });
  card.append(body);

  let state = null;   // { roster, sha }
  let dirty = false;
  const openEditors = new Set();

  const touch = () => { dirty = true; save.disabled = false; };

  const laneEditor = (name, a, refreshRow) => {
    const ed = el('div', { class: 'fo-lane-editor' });
    const row = (label, control) => {
      const r = el('div', { class: 'fo-ed-row' });
      r.append(el('label', { class: 'tiny muted', text: label }), control);
      return r;
    };
    const every = Math.max(1, a.everyHours || 1);

    // Align: which hours the cadence lands on — meaningless when hourly.
    if(every > 1){
      const align = el('select', { class: 'input fo-cad', 'aria-label': `Align ${name} runs` });
      for(let h = 0; h < every && h < 24; h++){
        const hours = [];
        for(let x = h; x < 24; x += every) hours.push(utcHourLabel(x));
        const cur = ((a.offset || 0) % every + every) % every;
        align.append(el('option', { value: h, text: hours.join(', '), selected: cur === h }));
      }
      align.addEventListener('change', () => { a.offset = parseInt(align.value, 10); touch(); refreshRow(); });
      ed.append(row('Runs at', align));
    }

    // Active window (local labels, UTC values). '' = all day.
    const winWrap = el('div', { class: 'fo-row', style: 'gap:6px' });
    const winSel = (which) => {
      const s = el('select', { class: 'input fo-cad', 'aria-label': `Window ${which} for ${name}` });
      s.append(el('option', { value: '', text: which === 0 ? 'all day' : '—' }));
      for(let h = 0; h < 24; h++) s.append(el('option', { value: h, text: utcHourLabel(h),
        selected: Array.isArray(a.window) && a.window[which] === h }));
      return s;
    };
    const winFrom = winSel(0), winTo = winSel(1);
    const applyWindow = () => {
      if(winFrom.value === '' || winTo.value === '' || winFrom.value === winTo.value) delete a.window;
      else a.window = [parseInt(winFrom.value, 10), parseInt(winTo.value, 10)];
      touch(); refreshRow();
    };
    winFrom.addEventListener('change', applyWindow); winTo.addEventListener('change', applyWindow);
    winWrap.append(winFrom, el('span', { class: 'tiny muted', text: 'to' }), winTo);
    ed.append(row('Only between', winWrap));

    // Start / stop moments ("run every X until Y").
    const dtRow = (label, key) => {
      const inp = el('input', { type: 'datetime-local', class: 'input fo-dt', value: isoToLocalInput(a[key]),
        'aria-label': `${label} for ${name}` });
      const clr = el('button', { class: 'btn ghost icon sm', title: `Clear ${label.toLowerCase()}`,
        'aria-label': `Clear ${label.toLowerCase()}`, html: icon('x'),
        onclick: () => { inp.value = ''; delete a[key]; touch(); refreshRow(); } });
      inp.addEventListener('change', () => {
        const iso = localInputToIso(inp.value);
        if(iso) a[key] = iso; else delete a[key];
        touch(); refreshRow();
      });
      const wrap = el('div', { class: 'fo-row', style: 'gap:6px' }, [inp, clr]);
      ed.append(row(label, wrap));
    };
    dtRow('Start at', 'startAt');
    dtRow('Run until', 'until');
    return ed;
  };

  const laneRow = (key, a, display, hint, mono=true) => {
    const r = el('div', { class: 'fo-app-row' });
    const nextEl = el('span', { class: 'tiny muted fo-next', text: laneNextLabel(a) });
    const refreshRow = () => { nextEl.textContent = laneNextLabel(a); };
    const tog = el('button', {
      class: 'fo-toggle' + (a.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(!!a.enabled),
      'aria-label': `Lane for ${display}`,
      onclick: () => { a.enabled = !a.enabled; touch(); render(); },
    }, el('span', { class: 'fo-knob' }));
    const cad = el('select', { class: 'input fo-cad', 'aria-label': `Cadence for ${display}` });
    [[1, 'hourly'], [2, 'every 2h'], [3, 'every 3h'], [6, 'every 6h'], [12, 'every 12h'], [24, 'daily']]
      .forEach(([h, t]) => cad.append(el('option', { value: h, text: t, selected: (a.everyHours || 1) === h })));
    cad.addEventListener('change', () => {
      a.everyHours = parseInt(cad.value, 10);
      if(a.offset != null) a.offset = a.offset % Math.max(1, a.everyHours);
      touch(); render();   // re-render: the align options depend on cadence
    });
    const gear = el('button', { class: 'btn ghost icon sm fo-gear' + (openEditors.has(key) ? ' on' : ''),
      title: 'Schedule details', 'aria-label': `Schedule details for ${display}`, 'aria-expanded': String(openEditors.has(key)),
      html: icon('sliders'),
      onclick: () => { openEditors.has(key) ? openEditors.delete(key) : openEditors.add(key); render(); } });
    const name = el('span', { class: 'fo-app-name' + (mono ? ' mono' : ''), text: display });
    if(hint) name.title = hint;
    r.append(tog, name, nextEl, el('span', { class: 'sp' }), cad, gear);
    body.append(r);
    if(openEditors.has(key)) body.append(laneEditor(display, a, refreshRow));
  };

  const render = () => {
    body.innerHTML = '';
    const apps = state.roster.apps || {};
    Object.keys(apps).forEach(name => laneRow(name, apps[name], name, ''));
    const jobs = state.roster.jobs || {};
    if(Object.keys(jobs).length){
      body.append(el('div', { class: 'fo-repo-name tiny', style: 'margin-top:8px',
        text: 'Platform jobs — sweeps, janitor, fleet improve' }));
      Object.keys(jobs).forEach(job => {
        const meta = JOB_META[job] || { label: job, hint: '' };
        laneRow('job:' + job, jobs[job], meta.label, meta.hint, false);
      });
    }
    body.append(saveRow);
    save.disabled = !dirty;
  };

  const save = el('button', { class: 'btn sm primary', html: `${icon('check')} Commit roster`, disabled: true, onclick: async () => {
    if(!ghToken()){ toast('Connect a GitHub token first', { kind: 'warn', body: 'Roster writes need a PAT from the vault.' }); return; }
    const on = [
      ...Object.entries(state.roster.apps || {}).filter(([, a]) => a.enabled).map(([n]) => n),
      ...Object.entries(state.roster.jobs || {}).filter(([, a]) => a.enabled).map(([n]) => JOB_META[n]?.label || n),
    ];
    const ok = await confirmDialog({ title:'Commit the focus roster?', message:on.length ? `Scheduled improve lanes will run for: ${on.join(', ')}. This spends tokens on the platform's Claude credentials.` :
      'All lanes will be paused.', okText: 'Commit to main' });
    if(!ok) return;
    save.disabled = true;
    // keep the roster file tidy: drop schedule fields at their defaults
    [...Object.values(state.roster.apps || {}), ...Object.values(state.roster.jobs || {})].forEach(a => {
      if(!a.offset) delete a.offset;
      if(!a.startAt) delete a.startAt;
      if(!a.until) delete a.until;
      if(!Array.isArray(a.window) || a.window.length !== 2) delete a.window;
    });
    try{
      const res = await putRoster(state.roster, state.sha, `fleet-ops: roster update via Manager (${on.length} lane${on.length === 1 ? '' : 's'} on)`);
      state.sha = res.content?.sha || state.sha;
      dirty = false;
      toast('Roster committed', { kind: 'ok', body: 'Takes effect on the next hourly tick.' });
    }catch(e){
      if(e.status === 409){ toast('Roster changed upstream', { kind: 'warn', body: 'Reloaded the latest — re-apply your flips.' }); load(); }
      else { toast('Commit failed', { kind: 'err', body: e.message }); save.disabled = false; }
    }
  } });
  const saveRow = el('div', { class: 'fo-row', style: 'margin-top:10px' }, [save]);

  const load = async () => {
    try{ state = await getRoster(); dirty = false; render(); }
    catch(e){ body.innerHTML = `<span class="fo-err tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`; }
  };
  load();
  return card;
}

// ---- dispatch: run the steward now ------------------------------------------
function dispatchCard(){
  const card = el('div', { class: 'card' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Run the steward now</h2></div>
    <p class="tiny muted" style="margin:0 0 10px">One-off <span class="mono">workflow_dispatch</span> runs on polecat-platform — free to start, they don’t recur.</p>`;

  const sel = el('select', { class: 'input', style: 'max-width:280px', 'aria-label': 'App to focus' });
  sel.append(el('option', { value: '', text: 'Fleet pick (steward chooses)' }));
  Store.projects().filter(p => p.repo && p.repo.startsWith('kevinrhaas/')).forEach(p =>
    sel.append(el('option', { value: p.repo.split('/')[1], text: p.name })));

  const runBtn = el('button', { class: 'btn sm primary', html: `${icon('play')} Improve run`, onclick: async () => {
    if(!ghToken()){ toast('Connect a GitHub token first', { kind: 'warn' }); return; }
    try{
      await dispatchWorkflow(IMPROVE_WORKFLOW, { app: sel.value });
      toast('Improve run dispatched', { kind: 'ok', body: sel.value ? `Focused on ${sel.value}.` : 'Fleet pick.' });
    }catch(e){ toast('Dispatch failed', { kind: 'err', body: e.message }); }
  } });
  card.append(el('div', { class: 'fo-row' }, [sel, runBtn]));

  const sweeps = el('div', { class: 'fo-row', style: 'margin-top:8px' });
  SWEEP_WORKFLOWS.forEach(w => sweeps.append(el('button', { class: 'btn sm', html: `${icon('eye')} ${w.label}`, onclick: async () => {
    if(!ghToken()){ toast('Connect a GitHub token first', { kind: 'warn' }); return; }
    try{ await dispatchWorkflow(w.file); toast(`${w.label} dispatched`, { kind: 'ok', body: 'Findings land as issues in each repo.' }); }
    catch(e){ toast('Dispatch failed', { kind: 'err', body: e.message }); }
  } })));
  card.append(sweeps);
  return card;
}

// ---- fleet health: is the fleet shipping itself? -----------------------------
// The zero-touch guarantee rests on three recurring Claude-free jobs: the
// janitor (re-smokes + merges green steward PRs every 2h) and the two daily
// sweeps. This strip shows each one's LAST outcome, so a silently-failing
// safety net is visible from Manager instead of only in the Actions tab.
const HEALTH_JOBS = [
  { match: /janitor/i,      label: 'Janitor',    sub: 'merges green steward PRs · 2h' },
  { match: /sweep \(ux\)/i,  label: 'UX sweep',   sub: 'files findings issues · daily' },
  { match: /sweep \(tech\)/i, label: 'Tech sweep', sub: 'audits contracts · daily' },
];
function healthCard(){
  const card = el('div', { class: 'card', style: 'margin-top:16px' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Fleet safety nets</h2></div>`;
  const body = el('div', { class: 'fo-body fo-health', html: `<span class="tiny muted">Loading safety-net status…</span>` });
  card.append(body);
  (async () => {
    try{
      const runs = await stewardRuns(50);
      body.innerHTML = '';
      HEALTH_JOBS.forEach(job => {
        const last = runs.find(r => job.match.test(r.name || ''));
        const row = el(last ? 'a' : 'div', { class: 'fo-run-row', ...(last ? { href: last.html_url, target: '_blank', rel: 'noopener' } : {}) });
        const dot = !last ? 'muted' : last.status !== 'completed' ? 'live' : (RUN_DOT[last.conclusion] || 'muted');
        const state = !last ? 'no runs yet' : last.status !== 'completed' ? last.status.replace('_', ' ') : (last.conclusion || 'done');
        row.innerHTML = `<span class="fo-dot ${dot}"></span>
          <span class="fo-run-name">${escapeHtml(job.label)}</span>
          <span class="tiny muted fo-health-sub">${escapeHtml(job.sub)}</span>
          <span class="sp"></span>
          <span class="tiny ${dot === 'err' ? 'fo-warn' : 'muted'}">${escapeHtml(state)}</span>
          ${last ? `<span class="tiny muted fo-when">${escapeHtml(ago(new Date(last.created_at).getTime()))}</span>` : ''}`;
        body.append(row);
      });
    }catch(e){ body.innerHTML = `<span class="fo-err tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`; }
  })();
  return card;
}

// ---- recent steward runs -----------------------------------------------------
const RUN_DOT = { success: 'ok', failure: 'err', cancelled: 'muted', startup_failure: 'err' };
const RUNS_POLL_MS = 30000;
function runsCard(){
  const card = el('div', { class: 'card', style: 'margin-top:16px' });
  const head = el('div', { class: 'section-title', style: 'margin-top:0' });
  head.innerHTML = `<h2 style="font-size:13px">Recent steward runs</h2>`;
  const live = el('span', { class: 'tiny muted fo-live', hidden: true, html: `<span class="fo-dot live"></span> live` });
  head.append(live, el('span', { class: 'sp' }));
  const refresh = el('button', { class: 'btn ghost icon sm', title: 'Refresh runs', 'aria-label': 'Refresh runs', html: icon('refresh'), onclick: () => load() });
  head.append(refresh);
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Loading runs…</span>` });
  card.append(head, body);

  const load = async () => {
    try{
      const runs = await stewardRuns(30);
      body.innerHTML = '';
      if(!runs.length){ body.append(el('div', { class: 'tiny muted', text: 'No steward runs yet.' })); return; }
      runs.slice(0, 12).forEach(r => {
        const state = r.status !== 'completed' ? r.status.replace('_', ' ') : (r.conclusion || 'done');
        const dot = r.status !== 'completed' ? 'live' : (RUN_DOT[r.conclusion] || 'muted');
        // run-name (display_title) carries the target app — "Steward improve
        // — manager.polecat.live" — fall back to the workflow name for runs
        // from before the platform annotated them.
        const title = r.display_title && r.display_title !== r.name ? r.display_title : r.name;
        const row = el('a', { class: 'fo-run-row', href: r.html_url, target: '_blank', rel: 'noopener' });
        row.innerHTML = `<span class="fo-dot ${dot}"></span>
          <span class="fo-run-name">${escapeHtml(title)}</span>
          <span class="tiny muted">${escapeHtml(r.event)}</span>
          <span class="sp"></span>
          <span class="tiny ${dot === 'err' ? 'fo-warn' : 'muted'}">${escapeHtml(state)}</span>
          <span class="tiny muted fo-when">${escapeHtml(ago(new Date(r.created_at).getTime()))}</span>`;
        body.append(row);
      });
    }catch(e){ body.innerHTML = `<span class="fo-err tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`; }
  };
  load();

  // Live-follow while the panel is on screen: poll every 30s, but only with a
  // token connected (unauthenticated rate limit is ~60/h — polling would eat
  // it), only while the tab is visible, and stop for good once the card
  // leaves the DOM (navigation re-renders the view).
  const timer = setInterval(() => {
    if(!body.isConnected){ clearInterval(timer); return; }
    const on = !!ghToken() && !document.hidden;
    live.hidden = !on;
    if(on) load();
  }, RUNS_POLL_MS);
  live.hidden = !ghToken();
  return card;
}

// ---- open steward work across the fleet --------------------------------------
function workCard(ctx){
  const card = el('div', { class: 'card', style: 'margin-top:16px' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Open steward work across the fleet</h2></div>
    <p class="tiny muted" style="margin:0 0 10px">Open <span class="mono">steward/*</span> + shell-vendoring PRs, and unresolved sweep-finding issues, per repo.</p>`;
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Scanning ${fleetRepos().length} repos…</span>` });
  card.append(body);

  (async () => {
    const repos = fleetRepos();
    const results = await Promise.allSettled(repos.map(async repo => ({
      repo, prs: await stewardPRs(repo), issues: await sweepIssues(repo),
    })));
    body.innerHTML = '';
    let shown = 0, failed = 0;
    results.forEach(res => {
      if(res.status !== 'fulfilled'){ failed++; return; }
      const { repo, prs, issues } = res.value;
      if(!prs.length && !issues.length) return;
      shown++;
      const g = el('div', { class: 'fo-repo-group' });
      g.append(el('div', { class: 'fo-repo-name mono tiny', text: repo }));
      prs.forEach(p => {
        const row = workRow('branch', `PR #${p.number} · ${p.title}`, p.html_url);
        // live check dot: green = the janitor will merge it on its next pass,
        // red = it commented and parked it, hollow = checks still running
        const dot = el('span', { class: 'fo-dot muted', title: 'Checks: loading…' });
        row.prepend(dot);
        if(p.head?.sha) checkState(repo, p.head.sha).then(s => {
          dot.className = 'fo-dot ' + (s === 'success' ? 'ok' : s === 'failure' ? 'err' : s === 'pending' ? 'live' : 'muted');
          dot.title = 'Checks: ' + s;
        }).catch(() => { dot.title = 'Checks: unknown'; });
        g.append(row);
      });
      issues.forEach(i => g.append(workRow('eye', `Issue #${i.number} · ${i.title}`, i.html_url)));
      body.append(g);
    });
    if(!shown) body.append(el('div', { class: 'tiny muted', text: failed ? `No open steward work found (${failed} repo${failed === 1 ? '' : 's'} unreachable — a token raises limits and reads private repos).` : 'No open steward work — the fleet is clear.' }));
    else if(failed) body.append(el('div', { class: 'tiny muted', style: 'margin-top:8px', text: `${failed} repo${failed === 1 ? '' : 's'} unreachable (rate limit or private — connect a token).` }));
  })();
  return card;
}

function workRow(ic, text, href){
  const row = el('a', { class: 'fo-run-row', href, target: '_blank', rel: 'noopener' });
  row.innerHTML = `<span class="fo-work-ic">${icon(ic)}</span><span class="fo-run-name">${escapeHtml(text)}</span><span class="sp"></span><span class="fo-work-ic">${icon('external')}</span>`;
  return row;
}

// ---- per-project steward card (used by the project detail page) --------------
export function projectStewardCard(p){
  if(!p.repo) return null;
  const card = el('div', { class: 'card health', style: 'margin-top:16px' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Steward</h2></div>`;
  const body = el('div', { class: 'fo-body tiny', html: `<span class="muted">Checking ${escapeHtml(p.repo)}…</span>` });
  card.append(body);
  (async () => {
    try{
      const [prs, issues] = await Promise.all([stewardPRs(p.repo), sweepIssues(p.repo)]);
      body.innerHTML = '';
      if(!prs.length && !issues.length){ body.append(el('span', { class: 'muted', text: 'No open steward PRs or sweep findings.' })); return; }
      prs.forEach(pr => body.append(workRow('branch', `PR #${pr.number} · ${pr.title}`, pr.html_url)));
      issues.forEach(i => body.append(workRow('eye', `Issue #${i.number} · ${i.title}`, i.html_url)));
    }catch(e){
      body.innerHTML = `<span class="muted">${escapeHtml(e.message)}</span>`;
    }
  })();
  return card;
}
