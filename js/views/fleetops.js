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
import { fmtCT, mdToHtml } from '../ui.js';
import { nextRunAt, slicesOf, isoToLocalInput, localInputToIso, utcHourLabel } from '../schedule.js';
import { icon } from '../icons.js';
import {
  whoami, ghCred, ghToken, fleetOpsCfg, setFleetOpsCfg, clearGhCache,
  getRoster, putRoster, dispatchWorkflow, stewardRuns, stewardPRs, sweepIssues,
  checkState, fleetRepos, IMPROVE_WORKFLOW, SWEEP_WORKFLOWS,
  runJobs, journalFor, journalRecords, parseStewardRecord,
  issuesCreatedBetween, prsCreatedBetween, prsMergedBetween,
  rateLimit, ghUsage, ghCooldown,
} from '../github.js';

// Inline error note: a rate limit is a calm, self-healing condition (amber),
// anything else is a real error (red).
const errNote = (e) => `<span class="${/rate.?limit/i.test(e.message) ? 'fo-warn' : 'fo-err'} tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`;

// Fleet Ops is split across two rail sections:
//   Fleet Ops    — the control room: token, schedules (roster), run-now,
//                  and a computed "Coming up" timeline.
//   Steward log  — what has happened: safety nets, run reviews, open work.
export function renderFleetOps(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('rocket')}</span><h2>Fleet Ops</h2>
    <span class="muted tiny">schedule and run the platform steward</span>`;
  title.append(el('span', { class: 'sp' }),
    el('button', { class: 'btn ghost sm', html: `${icon('clock')} Steward log`,
      title: 'What the steward has been doing', onclick: () => ctx.go('stewardlog') }));
  wrap.append(title);

  const grid = el('div', { class: 'fo-grid' });
  // (Re)build the data cards. Called on first render and again whenever the
  // Fleet Ops credential connects or changes — the cards each self-fetch on
  // creation, so rebuilding re-reads the roster/runs with the now-present
  // token. Without this, a roster that loaded anonymously (e.g. before the
  // vault row was unlocked) stays stuck on its 403 even after "Connected".
  let builtAuthed = false;
  const buildGrid = () => {
    builtAuthed = !!ghToken();
    grid.innerHTML = '';
    const upcoming = upcomingCard();
    const right = el('div', { class: 'fo-col' });
    right.append(dispatchCard(), upcoming.card);
    grid.append(rosterCard(upcoming.update), right);
  };
  buildGrid();
  // Rebuild only when it changes the outcome: a forced reload (the credential
  // was switched) always rebuilds; a connect/Test reload rebuilds only if the
  // grid was built without a token and one is now available — so a normal
  // visit with a healthy token doesn't double-load.
  const reload = (force) => {
    if(!force && (!!ghToken() === builtAuthed)) return;
    clearGhCache(); buildGrid();
  };
  wrap.append(connectCard(ctx, reload));
  wrap.append(grid);
  wrap.append(budgetCard());

  root.append(wrap);
}

export function renderStewardLog(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('clock')}</span><h2>Steward log</h2>
    <span class="muted tiny">what the steward has been doing across the fleet</span>`;
  title.append(el('span', { class: 'sp' }),
    el('button', { class: 'btn ghost sm', html: `${icon('rocket')} Fleet Ops`,
      title: 'Adjust schedules or dispatch a run', onclick: () => ctx.go('fleetops') }));
  wrap.append(title);

  wrap.append(healthCard());
  wrap.append(runsCard());
  wrap.append(workCard(ctx));

  root.append(wrap);
}

// ---- API budget meter --------------------------------------------------------
// "I keep getting 403 rate-limited and I can't tell where it's going."
// GitHub enforces TWO separate budgets and a 403 never says which one you hit:
// the core REST pool (5000/hour with a token, ~60 without) and a much tighter
// search pool (~30/MINUTE). Fleet Ops leans on search for run correlation, so
// search is nearly always the one that goes first — and because it refills on
// a one-minute window, it also clears on its own far sooner than "within the
// hour" implies. Both are shown side by side with their real reset moments.
//
// /rate_limit is free ("does not count against your REST API rate limit"), so
// polling it can never be part of the problem. Alongside GitHub's numbers we
// show THIS tab's own call tally by endpoint class, which is what actually
// answers "where is it getting blown" — the budget is account-wide and shared
// with the stewards' own Actions runs, so a drained pool with a near-zero
// local tally means something else spent it.
const BUDGET_POLL_MS = 30000;
function budgetCard(){
  const card = el('div', { class: 'card', style: 'margin-top:16px' });
  const head = el('div', { class: 'section-title', style: 'margin-top:0' });
  head.innerHTML = `<h2 style="font-size:13px">API budget</h2>`;
  const refresh = el('button', { class: 'btn ghost icon sm', title: 'Re-read the budget',
    'aria-label': 'Re-read the budget', html: icon('refresh'), onclick: () => load() });
  head.append(el('span', { class: 'sp' }), refresh);
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Reading budget…</span>` });
  card.append(head, body);

  const meter = (label, res, unit, note) => {
    const wrap = el('div', { class: 'fo-budget' });
    if(!res){ wrap.append(el('div', { class: 'tiny muted', text: `${label}: unavailable` })); return wrap; }
    const used = res.limit - res.remaining;
    const pct = res.limit ? Math.min(100, Math.round(100 * used / res.limit)) : 0;
    // Amber past two-thirds, red once it's nearly gone — the point is to see
    // it coming, not to find out at zero.
    const tone = pct >= 90 ? 'err' : pct >= 66 ? 'warn' : 'ok';
    const resetMs = (res.reset || 0) * 1000;
    const secs = Math.max(0, Math.round((resetMs - Date.now()) / 1000));
    const when = secs < 90 ? `${secs}s` : `${Math.round(secs / 60)} min`;
    wrap.innerHTML = `<div class="fo-budget-top tiny">
        <b>${escapeHtml(label)}</b>
        <span class="sp"></span>
        <span class="${tone === 'ok' ? 'muted' : 'fo-' + (tone === 'err' ? 'err' : 'warn')}">
          ${res.remaining} / ${res.limit} left</span></div>
      <div class="fo-bar"><i class="fo-bar-fill ${tone}" style="width:${pct}%"></i></div>
      <div class="tiny muted">${escapeHtml(unit)} · refills in ${when}${note ? ' · ' + escapeHtml(note) : ''}</div>`;
    return wrap;
  };

  const load = async () => {
    try{
      const r = await rateLimit();
      body.innerHTML = '';
      if(!r){ body.append(el('div', { class: 'tiny muted', text: 'GitHub returned no budget data.' })); return; }
      body.append(meter('Core REST', r.core, 'per hour',
        ghToken() ? '' : 'anonymous — connect a token for 5,000/h'));
      body.append(meter('Search', r.search, 'per minute', 'run correlation uses this'));

      // The confusing case, and the one that actually bit: both pools full and
      // every call still 403ing. That is the SECONDARY limit — a throttle on
      // burst shape, not a quota — and without saying so the meter looks like
      // it is contradicting the errors on screen. Say it plainly, and say it
      // clears in seconds, because the quota's hourly reset does not apply.
      const cool = ghCooldown();
      if(cool > 0){
        body.append(el('div', { class: 'fo-warn tiny', style: 'margin-top:2px',
          html: `${icon('warning')} Throttled for ${Math.ceil(cool / 1000)}s — too many requests at once.
            This is GitHub’s burst limit, not the quota above (which is why both bars can read full while calls fail).
            Requests are paused until it clears.` }));
      }

      // this tab's own footprint
      const u = ghUsage();
      const mins = Math.max(1, Math.round((Date.now() - u.since) / 60000));
      const tally = el('div', { class: 'fo-usage' });
      tally.append(el('div', { class: 'tiny muted', style: 'margin-top:2px',
        text: `This tab: ${u.total} calls in ${mins} min (${u.search} search).` }));
      u.by.slice(0, 4).forEach(([k, n]) => {
        tally.append(el('div', { class: 'tiny fo-usage-row',
          html: `<span class="fo-usage-name">${escapeHtml(k)}</span><span class="sp"></span><span class="muted">${n}</span>` }));
      });
      if(!u.total) tally.append(el('div', { class: 'tiny muted', text: 'No calls from this tab yet.' }));
      else tally.append(el('div', { class: 'tiny muted', style: 'margin-top:4px',
        text: 'The budget is account-wide: the stewards’ own runs spend from it too, so a drained pool with a small tally here was spent elsewhere.' }));
      body.append(tally);
    }catch(e){ body.innerHTML = errNote(e); }
  };
  load();
  const timer = setInterval(() => {
    if(!body.isConnected){ clearInterval(timer); return; }
    if(!document.hidden) load();
  }, BUDGET_POLL_MS);
  return card;
}

// ---- coming up: the computed next-runs timeline ------------------------------
// Derived entirely from the roster via the schedule evaluator — zero extra
// API calls — and re-computed live as lanes are edited, so it previews the
// schedule AS SHOWN including uncommitted flips.
function upcomingCard(){
  const card = el('div', { class: 'card' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Coming up</h2></div>
    <p class="tiny muted" style="margin:0 0 10px">The next scheduled runs, from the roster as shown — including edits you haven’t committed yet.</p>`;
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Loads with the roster…</span>` });
  card.append(body);
  const update = (roster) => {
    body.innerHTML = '';
    if(!roster){ body.append(el('div', { class: 'tiny muted', text: 'Roster unavailable.' })); return; }
    const entries = [];
    for(const [name, lane] of Object.entries(roster.apps || {})){
      const n = nextRunAt(lane); if(n) entries.push({ label: name, mono: true, at: n, slices: slicesOf(lane) });
    }
    for(const [job, lane] of Object.entries(roster.jobs || {})){
      const n = nextRunAt(lane); if(n) entries.push({ label: JOB_META[job]?.label || job, mono: false, at: n, slices: 1 });
    }
    entries.sort((a, b) => a.at - b.at);
    if(!entries.length){ body.append(el('div', { class: 'tiny muted', text: 'Nothing scheduled — every lane is off. Flip one on in the roster, or dispatch a one-off above.' })); return; }
    entries.slice(0, 10).forEach(e => {
      const row = el('div', { class: 'fo-app-row', style: 'padding:3px 0' });
      row.append(
        el('span', { class: 'fo-dot live' }),
        el('span', { class: 'fo-app-name' + (e.mono ? ' mono' : ''), text: e.label }));
      if(e.slices > 1) row.append(el('span', { class: 'fo-slices-badge', text: '×' + e.slices, title: `${e.slices} slices per run` }));
      row.append(
        el('span', { class: 'sp' }),
        el('span', { class: 'tiny muted fo-when', text: fmtCT(e.at.getTime()) }));
      body.append(row);
    });
  };
  return { card, update };
}

// ---- connect: pick the vault credential that holds a GitHub PAT ------------
function connectCard(ctx, onReload){
  const card = el('div', { class: 'card fo-connect' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">GitHub access</h2></div>`;
  const row = el('div', { class: 'fo-row' });

  const creds = Store.credentials('global');
  const sel = el('select', { class: 'input', style: 'max-width:260px' });
  sel.append(el('option', { value: '', text: creds.length ? 'No token (public read-only)' : 'No credentials in the vault yet' }));
  creds.forEach(c => sel.append(el('option', { value: c.id, text: c.name || c.key || 'Unnamed credential', selected: fleetOpsCfg().credId === c.id })));

  // When the connection proves healthy, refetch the data cards so a roster/runs
  // that loaded anonymously (before the token was available) pick up the token
  // instead of staying stuck on a 403. reload() no-ops when nothing changed, so
  // repeated Test clicks are cheap.
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
      onReload?.(false);   // token proven good → refetch cards under auth if they loaded anonymously
    }catch(e){
      status.innerHTML = `<span class="fo-warn">${icon('warning')} ${escapeHtml(e.message)}</span>`;
    }
  };
  sel.addEventListener('change', () => {
    setFleetOpsCfg({ credId: sel.value || null });
    status.classList.remove('fo-ok');
    onReload?.(true);      // credential switched — rebuild cards for the new token
    refreshStatus();
  });

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
// Y"). The loop ticks every ~10 min (cron */10) — that is the granularity.
function laneNextLabel(a){
  if(!a.enabled) return 'off';
  const n = nextRunAt(a);
  if(!n) return a.until && new Date(a.until) <= new Date() ? 'ended' : 'never';
  // Drop the year — every scheduled run is within days, so "Jul 23, 11:03 PM CT"
  // reads fine and fits the roster row without truncating.
  return `next ${fmtCT(n.getTime()).replace(/,\s*\d{4}/, '')}`;
}
// Platform-level jobs (focus.json `jobs`) — same lane schema, friendlier names.
const JOB_META = {
  'fleet-improve': { label: 'Fleet improve', hint: 'steward picks the app that most needs work' },
  'sweep-ux':      { label: 'UX sweep',      hint: 'files findings issues per app' },
  'sweep-tech':    { label: 'Tech sweep',    hint: 'audits contracts, drift, CI health' },
  'janitor':       { label: 'Janitor',       hint: 'merges green steward PRs' },
};
function rosterCard(onChange){
  const card = el('div', { class: 'card fo-roster' });
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">Focus roster</h2>
    <span class="sp"></span></div>
    <p class="tiny muted" style="margin:0 0 10px">Per-app improve lanes (<span class="mono">.github/steward/focus.json</span> on polecat-platform; the loop ticks every ~10&nbsp;min). A <b>continuous</b> lane fires its next batch within ~10&nbsp;min of the last one finishing; a coarser cadence gates it to specific hours. Dial the slices (<span class="mono">×N</span>) to fire that many runs <b>in parallel</b> each time the lane is due — N agent lanes on that app at once, each its own PR — fence it to a time window, or give it a start/stop, then commit; the next tick picks it up.</p>`;
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Loading roster…</span>` });
  card.append(body);

  let state = null;   // { roster, sha }
  let dirty = false;
  const openEditors = new Set();

  const touch = () => { dirty = true; save.disabled = false; onChange?.(state?.roster); };

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

  const laneRow = (key, a, display, hint, mono=true, isApp=false) => {
    const r = el('div', { class: 'fo-app-row' });
    const nextEl = el('span', { class: 'tiny muted fo-next', text: laneNextLabel(a) });
    const refreshRow = () => { nextEl.textContent = laneNextLabel(a); };
    const tog = el('button', {
      class: 'fo-toggle' + (a.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(!!a.enabled),
      'aria-label': `Lane for ${display}`,
      onclick: () => { a.enabled = !a.enabled; touch(); render(); },
    }, el('span', { class: 'fo-knob' }));
    const cad = el('select', { class: 'input fo-cad', 'aria-label': `Cadence for ${display}` });
    [[1, 'continuous'], [2, 'every 2h'], [3, 'every 3h'], [6, 'every 6h'], [12, 'every 12h'], [24, 'daily']]
      .forEach(([h, t]) => cad.append(el('option', { value: h, text: t, selected: (a.everyHours || 1) === h })));
    cad.addEventListener('change', () => {
      a.everyHours = parseInt(cad.value, 10);
      if(a.offset != null) a.offset = a.offset % Math.max(1, a.everyHours);
      touch(); render();   // re-render: the align options depend on cadence
    });
    // Model pin (apps only): which Claude model the lane's runs use. '' = the
    // Claude Code CLI default. steward-focus passes it through to each run's
    // --model (focus.json lane `model`). Pinned lanes light up like ×N does.
    let modelSel = null;
    if(isApp){
      modelSel = el('select', { class: 'input fo-cad fo-model' + (a.model ? ' pinned' : ''),
        'aria-label': `Model for ${display}`,
        title: 'Model — which Claude model this lane’s improve runs use. “auto” is the fleet default: opus.' });
      [['', 'auto (opus)'], ['claude-fable-5', 'fable'], ['claude-sonnet-5', 'sonnet'], ['claude-opus-5', 'opus'], ['claude-haiku-4-5', 'haiku']]
        .forEach(([v, t]) => modelSel.append(el('option', { value: v, text: t, selected: (a.model || '') === v })));
      modelSel.addEventListener('change', () => {
        if(modelSel.value) a.model = modelSel.value; else delete a.model;
        modelSel.classList.toggle('pinned', !!modelSel.value);
        touch();
      });
    }
    // Slices per run (apps only): fire N independent improve runs each time the
    // lane is due — each a full unit of work (its own PR + smoke gate), all
    // running AT ONCE (the platform dispatches slice=1..N in one tick, and each
    // run takes the k-th topmost queue item so they don't collide).
    // Default 1; >1 lights up so a boosted app reads at a glance.
    let slicesSel = null;
    if(isApp){
      const cur = slicesOf(a);
      slicesSel = el('select', { class: 'input fo-cad fo-slices' + (cur > 1 ? ' boosted' : ''),
        'aria-label': `Slices per run for ${display}`,
        title: 'Slices per run — how many improve runs to fire each time this lane is due. Each is a separate unit of work with its own PR.' });
      for(let s = 1; s <= 10; s++) slicesSel.append(el('option', { value: s, text: '×' + s, selected: cur === s }));
      slicesSel.addEventListener('change', () => {
        const v = parseInt(slicesSel.value, 10);
        if(v > 1) a.slices = v; else delete a.slices;
        slicesSel.classList.toggle('boosted', v > 1);
        touch();
      });
    }
    const gear = el('button', { class: 'btn ghost icon sm fo-gear' + (openEditors.has(key) ? ' on' : ''),
      title: 'Schedule details', 'aria-label': `Schedule details for ${display}`, 'aria-expanded': String(openEditors.has(key)),
      html: icon('sliders'),
      onclick: () => { openEditors.has(key) ? openEditors.delete(key) : openEditors.add(key); render(); } });
    const name = el('span', { class: 'fo-app-name' + (mono ? ' mono' : ''), text: display });
    if(hint) name.title = hint;
    // Name + "next …" time stack in one identity column so the (often long)
    // timestamp gets its own line and stays readable instead of being clipped
    // by the controls when the panel is narrow.
    const idCol = el('div', { class: 'fo-app-id' });
    idCol.append(name, nextEl);
    r.append(tog, idCol, el('span', { class: 'sp' }), cad);
    if(modelSel) r.append(modelSel);
    if(slicesSel) r.append(slicesSel);
    r.append(gear);
    body.append(r);
    if(openEditors.has(key)) body.append(laneEditor(display, a, refreshRow));
  };

  const render = () => {
    body.innerHTML = '';
    const apps = state.roster.apps || {};
    Object.keys(apps).forEach(name => laneRow(name, apps[name], name, '', true, true));
    const jobs = state.roster.jobs || {};
    if(Object.keys(jobs).length){
      body.append(el('div', { class: 'fo-repo-name tiny', style: 'margin-top:8px',
        text: 'Platform jobs — sweeps, janitor, fleet improve' }));
      Object.keys(jobs).forEach(job => {
        const meta = JOB_META[job] || { label: job, hint: '' };
        laneRow('job:' + job, jobs[job], meta.label, meta.hint, false, false);
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
      if(!(a.slices > 1)) delete a.slices; else a.slices = Math.min(10, Math.max(2, Math.floor(a.slices)));
      if(!a.model) delete a.model;
    });
    try{
      const res = await putRoster(state.roster, state.sha, `fleet-ops: roster update via Manager (${on.length} lane${on.length === 1 ? '' : 's'} on)`);
      state.sha = res.content?.sha || state.sha;
      dirty = false;
      toast('Roster committed', { kind: 'ok', body: 'Takes effect on the next tick (~10 min).' });
    }catch(e){
      if(e.status === 409){ toast('Roster changed upstream', { kind: 'warn', body: 'Reloaded the latest — re-apply your flips.' }); clearGhCache(); load(); }
      else { toast('Commit failed', { kind: 'err', body: e.message }); save.disabled = false; }
    }
  } });
  const saveRow = el('div', { class: 'fo-row', style: 'margin-top:10px' }, [save]);

  const load = async () => {
    try{ state = await getRoster(); dirty = false; render(); onChange?.(state.roster); }
    catch(e){ body.innerHTML = errNote(e); onChange?.(null); }
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
      const runs = await stewardRuns(RUNS_PAGE);
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
    }catch(e){ body.innerHTML = errNote(e); }
  })();
  return card;
}

// ---- recent steward runs -----------------------------------------------------
const RUN_DOT = { success: 'ok', failure: 'err', cancelled: 'muted', startup_failure: 'err' };
const RUNS_POLL_MS = 30000;
// ONE page size for every reader of the runs list. The health card and the runs
// card ask for the same thing; asking for 50 and 40 made them two different
// URLs, so the GET cache saw two misses where one call would have served both.
const RUNS_PAGE = 50;

// Expanded run detail: the job/step breakdown (an in-panel run log) plus what
// the run PRODUCED — sweep runs file issues, improve runs open PRs, the
// janitor merges them. Production is time-window correlated (anything created
// fleet-wide while the run executed), so it's labeled as such.
// A COMPLETED run's detail is immutable — its journal, job log, and the work it
// produced never change again — so we fetch it once and reuse it. This matters
// because the runs card re-renders every RUNS_POLL_MS: without the cache, every
// expanded run re-fired ~5 calls per poll INCLUDING the Search API (which has a
// far tighter ~30/min secondary limit), which could exhaust the budget and 403
// the whole panel.
//
// THE IN-PROGRESS EXEMPTION WAS THE HOLE IN THAT. Skipping the cache entirely
// for a running run is right for the job/step breakdown — that is what you are
// watching it for — but it also re-fired the three `/search/issues` calls every
// 30 s, for as long as the row stayed expanded. Per expanded run that is
// 6 Search calls a minute against a limit of about 30, so two or three of them
// plus anything else on the account crosses it, and the panel starts taking
// periodic 403s. Reported by Kevin 2026-08-27; it is also the best candidate
// for the secondary-limit 403 steward-improve run 1140 took at 16:05:30Z with
// 5,000 core calls still on the clock (chicago/4d T-0234).
//
// So the two halves are cached differently, by what actually changes:
//   • journal + jobs — one cheap REST call each, and they DO change as a run
//     progresses. Refetched every poll, as before.
//   • the three Search calls — a running run's "production" window grows, but
//     not meaningfully twice a minute. Held for LIVE_WORK_TTL_MS.
// Search cost per expanded in-progress run: 360/hour -> 36/hour.
const _runDetailCache = new Map();
const _liveWorkCache = new Map();
const LIVE_WORK_TTL_MS = 300000;   // 5 min
// Even behind that TTL the search window ended at NOW, and a bound that moves
// every millisecond mints a brand-new URL every time it IS refetched — so the
// shared GET cache could never dedupe it either, across cards or across a
// reload (measured 11% hit rate). Quantising the end into a coarse bucket
// makes repeated asks identical, which the cache can actually answer. Free:
// the window is approximate by construction and only ever grows.
const LIVE_WINDOW_BUCKET = 120000;
/**
 * WHAT A RUN PICKED UP — the line the Steward log never had.
 *
 * Since 2026-09-03 every improve run journals a machine-readable record built
 * from its own tool calls (polecat-platform `.github/steward/run-record.mjs`):
 * the ticket it claimed, the branch it pushed, the PR it opened and whether the
 * merge actually happened. Before it, five parallel slices posted five entries
 * under one heading and the only way to tell them apart was to read the prose.
 * Runs older than that have no record and render exactly as they did.
 */
const RECORD_DOT = { merged: 'ok', open: 'live', hold: 'live', blocked: 'err', died: 'err', 'no-pr': 'muted' };

function recordChip(rec, { long = false } = {}){
  if(!rec) return null;
  const box = el('span', { class: 'fo-record tiny' + (long ? ' fo-record-line' : '') });
  const ticket = (rec.tickets_done || []).map(d => d.id).join(', ')
    || (rec.tickets_claimed || []).join(', ') || 'no ticket';
  box.append(el('span', { class: `fo-dot ${RECORD_DOT[rec.outcome] || 'muted'}` }));
  box.append(el('span', { class: 'fo-record-ticket', text: ticket }));
  if(rec.pr && rec.pr_url){
    box.append(el('a', { class: 'fo-record-pr', href: rec.pr_url, target: '_blank', rel: 'noopener',
      text: `#${rec.pr}`, title: `${rec.pr_repo || ''} pull request`, onclick: (e) => e.stopPropagation() }));
  }
  box.append(el('span', { class: 'fo-record-outcome', text: rec.outcome }));
  if(long){
    const bits = [
      rec.branch, rec.tool_calls != null ? `${rec.tool_calls} tool calls` : '',
      rec.turns != null ? `${rec.turns} turns` : '',
      rec.minutes != null ? `${rec.minutes} min` : '',
      rec.cost_usd != null ? `$${rec.cost_usd.toFixed(2)}` : '',
      rec.resumes ? `${rec.resumes} resume after an API 5xx` : '',
      (rec.salvaged_branches || []).length ? `salvaged ${rec.salvaged_branches.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    if(bits) box.append(el('span', { class: 'muted', text: bits }));
  }
  return box;
}

function runDetail(r){
  const d = el('div', { class: 'fo-run-detail' });
  d.innerHTML = `<span class="tiny muted">Loading run details…</span>`;
  (async () => {
    try{
      const start = r.run_started_at || r.created_at;
      const done = r.status === 'completed';
      const endMs = done ? new Date(r.updated_at).getTime() + 120000
        : Math.ceil((Date.now() + 120000) / LIVE_WINDOW_BUCKET) * LIVE_WINDOW_BUCKET;
      const end = new Date(endMs).toISOString();
      const isJanitor = /janitor/i.test(r.name || '');
      let data = done ? _runDetailCache.get(r.id) : null;
      if(!data){
        // Cheap and genuinely live — always refetched.
        const [journal, jobs] = await Promise.all([
          // …with one exception. A run posts its journal entry in its OWN final
          // step, so a run that is still going has none by construction. Asking
          // anyway walked up to three pages of a 250-comment issue every poll to
          // reliably find nothing — the largest remaining waste in the panel
          // once the search calls were behind a TTL.
          done ? journalFor(r.id).catch(() => null) : Promise.resolve(null),
          runJobs(r.id).catch(() => []),
        ]);
        // Expensive and slow-moving. A completed run's window is closed, so it
        // rides the permanent cache below; a running one is held for a TTL
        // rather than refired every poll.
        let work = done ? null : _liveWorkCache.get(r.id);
        if(work && Date.now() - work.at > LIVE_WORK_TTL_MS) work = null;
        if(!work){
          const [issues, prs, merged] = await Promise.all([
            issuesCreatedBetween(start, end).catch(() => []),
            prsCreatedBetween(start, end).catch(() => []),
            isJanitor ? prsMergedBetween(start, end).catch(() => []) : Promise.resolve([]),
          ]);
          work = { at: Date.now(), issues, prs, merged };
          if(!done) _liveWorkCache.set(r.id, work);
        }
        data = { journal, jobs, issues: work.issues, prs: work.prs, merged: work.merged };
        if(done){
          _runDetailCache.set(r.id, data);   // immutable once completed — cache forever
          _liveWorkCache.delete(r.id);       // it finished; drop the interim copy
        }
      }
      const { journal, jobs, issues, prs, merged } = data;
      d.innerHTML = '';

      // Lead with the run's OWN account of what it did (the Steward journal —
      // every run posts its summary there). This is the review Kevin reads;
      // the CI step breakdown below is demoted to failures only.
      if(journal){
        const chip = recordChip(parseStewardRecord(journal.body), { long: true });
        if(chip) d.append(chip);
        const md = String(journal.body || '').replace(/<!--[\s\S]*?-->/g, '').trim();
        d.append(el('div', { class: 'fo-journal', html: mdToHtml(md) }));
      }else if(done){
        d.append(el('div', { class: 'tiny muted', text: 'No journal entry for this run (runs journal what they did starting 2026-07-17).' }));
      }

      // job one-liners; individual steps only when something failed
      jobs.forEach(j => {
        const wrap = el('div', { class: 'fo-steps' });
        const mins = j.started_at && j.completed_at ? Math.max(1, Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 60000)) + ' min' : '';
        wrap.append(el('div', { class: 'tiny', html: `<b>${escapeHtml(j.name)}</b> <span class="muted">· ${escapeHtml(j.conclusion || j.status)}${mins ? ' · ' + mins : ''}</span>` }));
        (j.steps || []).filter(s => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion)).forEach(s => {
          wrap.append(el('div', { class: 'fo-step tiny', html: `<span class="fo-dot err"></span><span class="fo-step-name">${escapeHtml(s.name)}</span>` }));
        });
        d.append(wrap);
      });

      // what it produced (time-correlated across the fleet)
      const section = (title, items, ic) => {
        if(!items.length) return false;
        d.append(el('div', { class: 'fo-repo-name tiny', text: title }));
        items.forEach(i => {
          const repo = (i.repository_url || '').split('/').slice(-2).join('/');
          d.append(workRow(ic, `${repo} #${i.number} · ${i.title}`, i.html_url));
        });
        return true;
      };
      const prIds = new Set(merged.map(p => p.id));
      const any = [
        section('Issues filed while this run executed', issues, 'eye'),
        section('PRs opened while this run executed', prs.filter(p => !prIds.has(p.id)), 'branch'),
        section('PRs merged while this run executed', merged, 'check'),
      ].some(Boolean);
      if(any) d.append(el('div', { class: 'tiny muted', style: 'margin-top:4px', text: 'Time-correlated: everything created fleet-wide during the run window.' }));
      else d.append(el('div', { class: 'tiny muted', text: done ? 'This run filed no issues and opened no PRs.' : 'Still running — results appear as it produces them.' }));
      d.append(el('a', { class: 'linkbtn tiny', href: r.html_url, target: '_blank', rel: 'noopener', html: `${icon('external')} Full log on GitHub` }));
    }catch(e){ d.innerHTML = errNote(e); }
  })();
  return d;
}
function runsCard(){
  const card = el('div', { class: 'card', style: 'margin-top:16px' });
  const head = el('div', { class: 'section-title', style: 'margin-top:0' });
  head.innerHTML = `<h2 style="font-size:13px">Recent steward runs</h2>`;
  const live = el('span', { class: 'tiny muted fo-live', hidden: true, html: `<span class="fo-dot live"></span> live` });
  head.append(live, el('span', { class: 'sp' }));
  const refresh = el('button', { class: 'btn ghost icon sm', title: 'Refresh runs', 'aria-label': 'Refresh runs', html: icon('refresh'), onclick: () => load(true) });
  head.append(refresh);
  const body = el('div', { class: 'fo-body', html: `<span class="tiny muted">Loading runs…</span>` });
  card.append(head, body);

  const openRuns = new Set();
  let shown = 15;   // how many runs to render; "Show more" grows it (history, not just latest)
  // The journal's run records, so a row can say WHICH ticket it took without
  // opening it. One paged read of the journal issue, cached like every other
  // call here, and never allowed to hold up the rows: a rate limit means the
  // list renders exactly as it did before records existed.
  let records = new Map();
  journalRecords().then((m) => { records = m; load(); }).catch(() => {});
  const load = async (fresh = false) => {
    try{
      const runs = await stewardRuns(RUNS_PAGE, fresh);
      body.innerHTML = '';
      if(!runs.length){ body.append(el('div', { class: 'tiny muted', text: 'No steward runs yet.' })); return; }
      runs.slice(0, shown).forEach(r => {
        const state = r.status !== 'completed' ? r.status.replace('_', ' ') : (r.conclusion || 'done');
        const dot = r.status !== 'completed' ? 'live' : (RUN_DOT[r.conclusion] || 'muted');
        // run-name (display_title) carries the target app AND, for one run of a
        // parallel batch, the slice — "Steward improve — analytics.polecat.live
        // [1/2]". Split the "[n/m]" into its own badge so you can see which of
        // the batch's runs this is. Fall back to the workflow name for runs
        // from before the platform annotated them.
        const rawTitle = r.display_title && r.display_title !== r.name ? r.display_title : r.name;
        const sliceM = rawTitle.match(/\s*\[(\d+)\s*\/\s*(\d+)\]\s*$/);
        const title = sliceM ? rawTitle.slice(0, sliceM.index).trim() : rawTitle;
        // Mobile-first row: the title line owns the width (tapping it toggles
        // the detail too — the chevron alone is a thin target on a phone);
        // the metadata wraps to its own line on narrow screens (see CSS) and
        // the event label hides there entirely.
        const row = el('div', { class: 'fo-run-row fo-run-static' });
        const toggle = () => { openRuns.has(r.id) ? openRuns.delete(r.id) : openRuns.add(r.id); load(); };
        const exp = el('button', { class: 'fo-expand' + (openRuns.has(r.id) ? ' on' : ''),
          title: 'What this run did', 'aria-label': `Details for ${title}`, 'aria-expanded': String(openRuns.has(r.id)),
          html: icon('chevron'), onclick: toggle });
        const main = el('button', { class: 'fo-run-main', title: 'What this run did', onclick: toggle,
          html: `<span class="fo-dot ${dot}"></span><span class="fo-run-name">${escapeHtml(title)}</span>`
            + (sliceM ? `<span class="fo-slice-badge" title="run ${sliceM[1]} of ${sliceM[2]} fired together in this batch">slice ${sliceM[1]}/${sliceM[2]}</span>` : '') });
        const meta = el('span', { class: 'fo-run-meta' });
        meta.append(
          el('span', { class: 'tiny muted fo-run-event', text: r.event }),
          el('span', { class: `tiny ${dot === 'err' ? 'fo-warn' : 'muted'}`, text: state }),
          el('span', { class: 'tiny muted fo-when', text: ago(new Date(r.created_at).getTime()) }),
          el('a', { class: 'btn ghost icon sm fo-run-link', href: r.html_url, target: '_blank', rel: 'noopener',
            title: 'Open on GitHub', 'aria-label': `Open ${title} on GitHub`, html: icon('external') }));
        const rec = recordChip(records.get(String(r.id)));
        if(rec) main.append(rec);
        row.append(exp, main, meta);
        body.append(row);
        if(openRuns.has(r.id)) body.append(runDetail(r));
      });
      // History, not just the latest: reveal older runs in batches (the poll
      // re-renders every 30s and keeps whatever's been expanded to).
      if(runs.length > shown){
        body.append(el('button', { class: 'btn ghost sm fo-show-more',
          text: `Show ${Math.min(15, runs.length - shown)} more (${runs.length - shown} older)`,
          onclick: () => { shown = Math.min(runs.length, shown + 15); load(); } }));
      }
    }catch(e){ body.innerHTML = errNote(e); }
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
    let shown = 0;
    // 403 (rate limit) is transient and clears within the hour on its own;
    // 404 (private repo, unauthenticated) never will — a token is the only
    // fix. Distinguishing the two means the fleet-wide summary doesn't tell
    // someone to "wait it out" for a repo that can never load without one.
    const rateLimited = [], privateRepos = [], otherFailed = [];
    results.forEach((res, i) => {
      if(res.status !== 'fulfilled'){
        const status = res.reason?.status;
        (status === 403 ? rateLimited : status === 404 ? privateRepos : otherFailed).push(repos[i]);
        return;
      }
      const { repo, prs, issues } = res.value;
      if(!prs.length && !issues.length) return;
      shown++;
      const g = el('div', { class: 'fo-repo-group' });
      g.append(el('div', { class: 'fo-repo-name mono tiny', text: repo }));
      prs.forEach(p => {
        const row = workRow('branch', `PR #${p.number} · ${p.title}`, p.html_url);
        // live check dot: green = the janitor will merge it on its next pass,
        // red = it commented and parked it, hollow = checks still running.
        // One API call per PR — skipped without a token (anon budget is tiny).
        const dot = el('span', { class: 'fo-dot muted', title: ghToken() ? 'Checks: loading…' : 'Checks: connect a token' });
        row.prepend(dot);
        if(p.head?.sha && ghToken()) checkState(repo, p.head.sha).then(s => {
          dot.className = 'fo-dot ' + (s === 'success' ? 'ok' : s === 'failure' ? 'err' : s === 'pending' ? 'live' : 'muted');
          dot.title = 'Checks: ' + s;
        }).catch(() => { dot.title = 'Checks: unknown'; });
        g.append(row);
      });
      issues.forEach(i => g.append(workRow('eye', `Issue #${i.number} · ${i.title}`, i.html_url)));
      body.append(g);
    });
    const failed = rateLimited.length + privateRepos.length + otherFailed.length;
    const failParts = [];
    if(rateLimited.length) failParts.push(`${rateLimited.length} rate-limited (resets within the hour)`);
    if(privateRepos.length) failParts.push(`${privateRepos.length} private — needs a token to ever read (${privateRepos.join(', ')})`);
    if(otherFailed.length) failParts.push(`${otherFailed.length} unreachable`);
    if(!shown) body.append(el('div', { class: 'tiny muted', text: failed ? `No open steward work found (${failParts.join('; ')}${ghToken() ? '' : ' — connect a vault token to raise limits and read private repos'}).` : 'No open steward work — the fleet is clear.' }));
    else if(failed) body.append(el('div', { class: 'tiny muted', style: 'margin-top:8px', text: `${failParts.join('; ')}${ghToken() ? '' : ' — connect a vault token to raise limits and read private repos'}.` }));
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
