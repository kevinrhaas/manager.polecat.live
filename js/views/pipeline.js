// pipeline.js — the release console for the dev → stage → prod promotion
// pipeline (pilot: jobtracker — see its docs/PIPELINE.md).
//
// Fleet Ops is the STEWARD console (schedules the improvement loop); this is
// the RELEASE console: per-app stage cards showing where dev/stage/prod sit,
// what the last stage promotion concluded, and the three verbs — promote to stage,
// promote to prod, roll back prod — each a workflow_dispatch into the app's
// own repo. The pausable dev→stage schedule lives in the repo's
// .github/pipeline.json (a focus.json-style data file); the editor here
// writes it back through the contents API with sha compare-and-swap.
//
// Which repos appear: every fleet repo that HAS a .github/pipeline.json —
// probed live, so adopting the pipeline in a new repo lights it up here with
// zero Manager changes. Reads work anonymously (cached, rate-limit-aware, see
// github.js); every write needs the Fleet Ops vault token and says so.
import { Store } from '../store.js';
import { el, escapeHtml, toast, ago, confirmDialog } from '../ui.js';
import { icon } from '../icons.js';
import {
  gh, ghToken, clearGhCache, fleetRepos, getBranch, compareRefs,
  dispatchRepoWorkflow, workflowRuns, getRepoJson, putRepoJson, listTags,
} from '../github.js';

const PIPELINE_PATH = '.github/pipeline.json';

// The THREE-tier pilot's shape (jobtracker, analytics). It is the default, not
// the law: a repo declares its own shape in .github/pipeline.json and this view
// honours the declaration. That keeps the "adopting the pipeline lights up a
// card with zero Manager changes" property while letting a repo that is not
// shaped like the pilot say so — kevinrhaas/custom runs a TWO-tier dev → main
// pipeline for one subtree of a monorepo, at a subpath, with its own workflow
// names, and none of that needed a special case here.
const DEFAULT_STAGES = [
  { branch: 'dev',  label: 'Dev',  sub: 'integration',  path: '/dev/' },
  { branch: 'stage', label: 'Stage', sub: 'candidate',   path: '/stage/' },
  { branch: 'main', label: 'Prod', sub: 'production',   path: '/'     },
];
const DEFAULT_WORKFLOWS = {
  promoteToStage: 'promote-to-stage.yml',
  promoteToProd: 'promote-to-prod.yml',
  rollbackProd: 'rollback-prod.yml',
};

/**
 * The card's shape for one repo, from its own pipeline.json.
 *
 * `tiers` names which branches appear and in what order; `paths` overrides where
 * each one publishes (a monorepo tenant lives under a prefix, not at the root);
 * `workflows` names the dispatch targets, and a NULL entry means that verb does
 * not exist here and its button is not drawn. `label` renames the card, because
 * "custom" is a monorepo of unrelated projects and the pipeline covers exactly
 * one subtree of it.
 */
function shapeOf(cfg){
  const declared = Array.isArray(cfg?.tiers) && cfg.tiers.length ? cfg.tiers : null;
  const stages = (declared ? declared : DEFAULT_STAGES.map(s => s.branch))
    .map(branch => DEFAULT_STAGES.find(s => s.branch === branch)
      ?? { branch, label: branch, sub: '', path: `/${branch}/` })
    .map(s => ({ ...s, path: cfg?.paths?.[s.branch] ?? s.path }));
  const workflows = { ...DEFAULT_WORKFLOWS, ...(cfg?.workflows || {}) };
  // A repo with no stage tier has no stage promotion to run or report on,
  // whatever the workflow map happens to say.
  if(!stages.some(s => s.branch === 'stage')) workflows.promoteToStage = null;
  return { stages, workflows, label: cfg?.label || null };
}

const errNote = (e) => `<span class="${/rate.?limit/i.test(e.message) ? 'fo-warn' : 'fo-err'} tiny">${icon('warning')} ${escapeHtml(e.message)}</span>`;

export function renderPipeline(root, ctx){
  root.innerHTML = '';
  const wrap = el('div', { class: 'wrap view-in' });

  const title = el('div', { class: 'section-title', style: 'margin-top:0' });
  title.innerHTML = `<span style="color:var(--brand-b);display:inline-flex">${icon('branch')}</span><h2>Pipeline</h2>
    <span class="muted tiny">staged releases: dev → stage → prod</span>`;
  wrap.append(title);

  // Same vault token as Fleet Ops; reads are fine without it, writes are not.
  const auth = el('div', { class: 'tiny muted', style: 'margin-bottom:12px' });
  auth.innerHTML = ghToken()
    ? `${icon('check')} Using the Fleet Ops vault token — promotions and schedule edits enabled.`
    : `${icon('lock')} Read-only: connect a token under <a href="#" data-go="fleetops">Fleet Ops → GitHub access</a> to promote, roll back, or edit schedules.`;
  auth.querySelector('[data-go]')?.addEventListener('click', (e) => { e.preventDefault(); ctx.go('fleetops'); });
  wrap.append(auth);

  const grid = el('div', { class: 'fo-grid' });
  wrap.append(grid);
  root.append(wrap);

  loadRepos(grid);
}

// Probe every fleet repo for .github/pipeline.json; each hit becomes a card.
async function loadRepos(grid){
  grid.innerHTML = `<div class="card"><span class="tiny muted">${icon('refresh')} Finding pipeline-enabled repos…</span></div>`;
  const repos = fleetRepos();
  const found = [];
  await Promise.allSettled(repos.map(async (repo) => {
    try{
      const cfg = await getRepoJson(repo, PIPELINE_PATH);
      found.push({ repo, cfg });
    }catch{ /* no pipeline.json — not adopted (or unreachable); skip quietly */ }
  }));
  grid.innerHTML = '';
  if(!found.length){
    const none = el('div', { class: 'card' });
    none.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">No pipeline repos yet</h2></div>
      <p class="tiny muted">No fleet repo carries a <code>.github/pipeline.json</code>. The pilot lives in
      <b>jobtracker.polecat.live</b> — once a repo adopts the pipeline (see its <code>docs/PIPELINE.md</code>),
      it shows up here automatically.</p>`;
    grid.append(none);
    return;
  }
  found.sort((a, b) => a.repo.localeCompare(b.repo));
  found.forEach(({ repo, cfg }) => grid.append(repoCard(repo, cfg)));
}

function siteFor(repo){
  const p = Store.projects().find(x => x.repo === repo);
  return (p?.site || '').replace(/\/$/, '');
}

function repoCard(repo, cfgLoaded){
  const card = el('div', { class: 'card pl-card' });
  // cfgLoaded is getRepoJson's `{ json, sha }` envelope — the sha is what
  // fillSchedule's compare-and-swap write needs — so the CONFIG is `.json`.
  const shape = shapeOf(cfgLoaded?.json);
  const name = shape.label || repo.split('/')[1] || repo;
  const site = siteFor(repo);
  card.innerHTML = `<div class="section-title" style="margin-top:0"><h2 style="font-size:13px">${escapeHtml(name)}</h2>
    <span class="sp"></span>
    <a class="tiny muted" href="https://github.com/${escapeHtml(repo)}" target="_blank" rel="noopener">${icon('external')} repo</a></div>`;

  const stagesBox = el('div', { class: 'pl-stages' });
  const stageBox = el('div', { class: 'pl-stage-status tiny muted', html: `${icon('refresh')} Loading…` });
  const btnRow = el('div', { class: 'fo-row pl-actions' });
  const schedBox = el('div', { class: 'pl-sched' });
  card.append(stagesBox, stageBox, btnRow, schedBox);

  const reload = () => { clearGhCache(); fillStages(stagesBox, repo, site, shape); fillStage(stageBox, repo, shape); };
  fillStages(stagesBox, repo, site, shape);
  fillStage(stageBox, repo, shape);
  fillActions(btnRow, repo, reload, shape, name);
  // No scheduled promotion means no schedule editor — an empty one invites
  // someone to set a cadence that nothing reads.
  if(shape.workflows.promoteToStage) fillSchedule(schedBox, repo, cfgLoaded, reload);
  return card;
}

// ---- stage rows: sha + subject + ahead-of-next badge ------------------------
async function fillStages(box, repo, site, shape){
  const STAGES = shape.stages;
  box.innerHTML = `<span class="tiny muted">${icon('refresh')} Reading branches…</span>`;
  try{
    const heads = await Promise.all(STAGES.map(s => getBranch(repo, s.branch).catch(() => null)));
    const by = Object.fromEntries(STAGES.map((s, i) => [s.branch, heads[i]]));
    // Ahead counts, each independently fault-tolerant (a missing branch or a
    // rate-limited compare must not blank the whole card). Each tier is measured
    // against the NEXT one in the declared order, so a two-tier pipeline asks
    // "how far is dev ahead of main" and a three-tier one still asks about stage.
    const aheadPairs = await Promise.all(STAGES.map(async (s, i) => {
      const next = STAGES[i + 1];
      if(!next || !by[s.branch] || !by[next.branch]) return [s.branch, null];
      return [s.branch, await compareRefs(repo, next.branch, s.branch)
        .then(c => c.ahead_by).catch(() => null)];
    }));
    const ahead = Object.fromEntries(aheadPairs);
    box.innerHTML = '';
    STAGES.forEach(s => {
      const b = by[s.branch];
      const row = el('div', { class: 'pl-stage' });
      const url = site ? site + s.path : null;
      const head = b?.commit;
      const sha = head ? head.sha.slice(0, 7) : '—';
      const msg = head?.commit?.message?.split('\n')[0] || (b ? '' : 'branch missing — run pipeline-setup');
      const when = head?.commit?.committer?.date;
      const aheadTxt = ahead[s.branch] != null && ahead[s.branch] > 0
        ? `<span class="pl-ahead">${ahead[s.branch]} ahead</span>`
        : (ahead[s.branch] === 0 ? `<span class="tiny muted">in sync</span>` : '');
      row.innerHTML = `
        <span class="pl-stage-name">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${s.label}</a>` : s.label}
          <span class="tiny muted">${s.sub}</span></span>
        <code class="tiny">${sha}</code>
        <span class="pl-subject tiny" title="${escapeHtml(msg)}">${escapeHtml(msg)}</span>
        <span class="tiny muted">${when ? ago(new Date(when).getTime()) : ''}</span>
        ${aheadTxt}`;
      box.append(row);
    });
  }catch(e){
    box.innerHTML = errNote(e);
  }
}

// ---- last stage promotion = the stage status record -------------------------------
async function fillStage(box, repo, shape){
  // A two-tier pipeline has no stage promotion; its status record is the PROD
  // promotion, which is the only gated step it has.
  const wf = shape.workflows.promoteToStage || shape.workflows.promoteToProd;
  const noun = shape.workflows.promoteToStage ? 'stage promotion' : 'promotion';
  if(!wf){ box.innerHTML = ''; return; }
  try{
    const runs = await workflowRuns(repo, wf, 5);
    // The newest COMPLETED run is the verdict; an in-flight one shows as live.
    const live = runs.find(r => r.status !== 'completed');
    const done = runs.find(r => r.status === 'completed');
    if(!live && !done){ box.innerHTML = `<span class="tiny muted">No ${noun}s yet.</span>`; return; }
    const bits = [];
    if(live) bits.push(`<span class="fo-dot live"></span> promotion running <a href="${escapeHtml(live.html_url)}" target="_blank" rel="noopener">${icon('external')}</a>`);
    if(done){
      const ok = done.conclusion === 'success';
      bits.push(`<span class="fo-dot ${ok ? 'ok' : 'err'}"></span> last ${noun} <b>${escapeHtml(done.conclusion)}</b>
        · ${ago(new Date(done.updated_at).getTime())}
        <a href="${escapeHtml(done.html_url)}" target="_blank" rel="noopener">${icon('external')}</a>`);
    }
    box.innerHTML = bits.join(' &nbsp; ');
    box.dataset.stageGreen = done && done.conclusion === 'success' ? '1' : '';
  }catch(e){
    box.innerHTML = errNote(e);
  }
}

// ---- the three verbs --------------------------------------------------------
function needToken(){
  if(ghToken()) return false;
  toast('Connect a GitHub token first', { kind: 'warn', body: 'Promotions and schedule edits need the Fleet Ops vault token.' });
  return true;
}

function fillActions(row, repo, reload, shape, cardName){
  const name = cardName || repo.split('/')[1] || repo;
  const WF = shape.workflows;

  const promoteQa = el('button', { class: 'btn sm', html: `${icon('play')} Promote dev → stage` });
  promoteQa.onclick = async () => {
    if(needToken()) return;
    const ok = await confirmDialog({
      title: `Promote dev → stage on ${name}?`,
      message: 'Back-merges main into dev, merges dev into stage, and runs the FULL suite against the staged /stage/ build. A red suite rolls stage back automatically and files an issue.',
      okText: 'Promote', danger: false,
    });
    if(!ok) return;
    try{
      await dispatchRepoWorkflow(repo, WF.promoteToStage, { reason: 'Dispatched from Manager (Pipeline view)' });
      toast('stage promotion dispatched', { kind: 'ok', body: 'The run is the status record — this card refreshes shortly.' });
      setTimeout(reload, 4000);
    }catch(e){ toast('GitHub call failed', { kind: 'err', body: e.message }); }
  };

  const fromTier = WF.promoteToStage ? 'stage' : 'dev';
  const promoteProd = el('button', { class: 'btn sm primary', html: `${icon('rocket')} Promote ${fromTier} → prod` });
  promoteProd.onclick = async () => {
    if(needToken()) return;
    const stageGreen = promoteProd.closest('.pl-card')?.querySelector('.pl-stage-status')?.dataset.stageGreen === '1';
    const ok = await confirmDialog({
      title: `Ship ${name} to production?`,
      // A two-tier repo has no stage to be green or red, so the three-tier
      // warning would be describing a gate it does not have.
      message: !WF.promoteToStage
        ? `Back-merges main into ${fromTier} (so a hotfix is never lost), merges ${fromTier} into main with --no-ff, re-checks the changelog contract after both merges, and publishes.`
        : stageGreen
          ? 'Merges stage into main, tags release-vNNN, freezes a /v/ snapshot, and publishes. The workflow re-checks that the latest stage promotion is green before merging.'
          : 'The latest stage promotion is NOT green — the workflow will refuse unless forced. Dispatching anyway sends force=true. Are you sure?',
      okText: (stageGreen || !WF.promoteToStage) ? 'Ship it' : 'Force-ship anyway',
      danger: !!WF.promoteToStage && !stageGreen,
    });
    if(!ok) return;
    try{
      await dispatchRepoWorkflow(repo, WF.promoteToProd, stageGreen || !WF.promoteToStage ? {} : { force: 'true' });
      toast('prod promotion dispatched', { kind: 'ok',
        body: WF.promoteToStage ? 'It tags the release and archives a /v/ snapshot.'
          : 'The run is the status record — this card refreshes shortly.' });
      setTimeout(reload, 4000);
    }catch(e){ toast('GitHub call failed', { kind: 'err', body: e.message }); }
  };

  const rollback = el('button', { class: 'btn ghost sm', html: `${icon('undo')} Roll back prod` });
  rollback.onclick = async () => {
    if(needToken()) return;
    let tagTxt = 'the most recent "Promote stage→prod" merge';
    try{
      const tags = await listTags(repo, 5);
      const rel = tags.filter(t => /^release-v/.test(t.name)).map(t => t.name);
      if(rel.length) tagTxt = `${rel[0]} (previous: ${rel[1] || 'none'})`;
    }catch{ /* tags are decorative here */ }
    const ok = await confirmDialog({
      title: `Roll back production on ${name}?`,
      message: `Reverts ${tagTxt} on main with git revert (history stays append-only — never a force-push) and redeploys. Users can also self-serve any archived build from the app's version switcher.`,
      okText: 'Roll back', danger: true,
    });
    if(!ok) return;
    try{
      await dispatchRepoWorkflow(repo, WF.rollbackProd, {});
      toast('Rollback dispatched', { kind: 'ok', body: 'main gets a revert commit and redeploys.' });
      setTimeout(reload, 4000);
    }catch(e){ toast('GitHub call failed', { kind: 'err', body: e.message }); }
  };

  // Only the verbs this repo actually has. A button that dispatches a workflow
  // the repo does not contain fails with a 404 the user cannot act on.
  if(WF.promoteToStage) row.append(promoteQa);
  if(WF.promoteToProd) row.append(promoteProd);
  if(WF.rollbackProd) row.append(rollback);
}

// ---- the pausable dev→stage schedule (pipeline.json, sha CAS) ------------------
function fillSchedule(box, repo, loaded, reload){
  let { json: cfg, sha } = loaded;
  const p = cfg.promoteToStage || {};

  const render = () => {
    box.innerHTML = '';
    const row = el('div', { class: 'fo-row tiny' });
    const state = p.enabled === false ? 'off' : p.paused ? 'paused' : 'on';
    row.append(el('span', { class: 'muted', html: `${icon('clock')} Scheduled dev→stage:` }));

    const stateSel = el('select', { class: 'input input-sm' });
    [['on', 'On'], ['paused', 'Paused'], ['off', 'Off']].forEach(([v, t]) =>
      stateSel.append(el('option', { value: v, text: t, selected: state === v })));

    const cadSel = el('select', { class: 'input input-sm' });
    [1, 2, 3, 6, 12, 24].forEach(h =>
      cadSel.append(el('option', { value: String(h), text: `every ${h}h`, selected: (p.everyHours || 24) === h })));

    const info = el('span', { class: 'muted' , text:
      `at ${String(p.offset ?? 0).padStart(2, '0')}:00Z · window ${(p.window || [0, 24]).join('–')}Z` });

    const save = el('button', { class: 'btn ghost sm', html: `${icon('check')} Save` });
    save.onclick = async () => {
      if(needToken()) return;
      const v = stateSel.value;
      const next = { ...cfg, promoteToStage: { ...p,
        enabled: v !== 'off', paused: v === 'paused', everyHours: parseInt(cadSel.value, 10) } };
      try{
        await putRepoJson(repo, PIPELINE_PATH, next, sha,
          `pipeline: schedule ${v}${v !== 'off' ? `, every ${cadSel.value}h` : ''} (via Manager)`);
        toast('Schedule saved', { kind: 'ok', body: 'Takes effect on the next hourly tick.' });
        ({ json: cfg, sha } = await getRepoJson(repo, PIPELINE_PATH));
        Object.assign(p, cfg.promoteToStage || {});
        render(); reload();
      }catch(e){
        if(e.status === 409){
          // CAS lost: someone else edited pipeline.json — reload, never clobber.
          toast('pipeline.json changed upstream', { kind: 'warn', body: 'Reloaded the latest — re-apply your change.' });
          try{ ({ json: cfg, sha } = await getRepoJson(repo, PIPELINE_PATH)); Object.assign(p, cfg.promoteToStage || {}); render(); }catch{}
        }else toast('GitHub call failed', { kind: 'err', body: e.message });
      }
    };

    row.append(stateSel, cadSel, info, save);
    box.append(row);
  };
  render();
}
