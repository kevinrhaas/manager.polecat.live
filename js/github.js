// github.js — a minimal GitHub REST client for Fleet Ops.
//
// The token comes from the Credentials vault: the user picks a vault row once
// (its id is stored in settings.fleetOps.credId) and Fleet Ops reads the
// value live from the vault — the token itself is never copied anywhere
// else. Public reads work without a token (GitHub allows ~60 unauthenticated
// requests/hour); a PAT raises limits and unlocks the write paths (roster
// commits, workflow dispatch). Every call rejects with a short human-readable
// Error — callers render error states, never crash and never log.
import { Store } from './store.js';
import { isEnvelope } from './crypto.js';

const API = 'https://api.github.com';

export const PLATFORM_REPO = 'kevinrhaas/polecat-platform';
export const ROSTER_PATH = '.github/steward/focus.json';
export const IMPROVE_WORKFLOW = 'steward-improve.yml';
export const SWEEP_WORKFLOWS = [
  { file: 'steward-sweep-ux.yml',   label: 'UX sweep' },
  { file: 'steward-sweep-tech.yml', label: 'Tech sweep' },
];

export function fleetOpsCfg(){ return Store.settings().fleetOps || {}; }
export function setFleetOpsCfg(patch){ Store.setSetting('fleetOps', { ...fleetOpsCfg(), ...patch }); }

// The vault row currently wired to Fleet Ops (or null). A row whose value is
// an encrypted envelope this browser hasn't unlocked yields no token.
export function ghCred(){
  const id = fleetOpsCfg().credId;
  return id ? (Store.credentials().find(c => c.id === id) || null) : null;
}
export function ghToken(){
  const c = ghCred();
  if(!c || !c.value || isEnvelope(c.value)) return '';
  return String(c.value).trim();
}

// ---- GET cache --------------------------------------------------------------
// Unauthenticated GitHub allows ~60 requests/hour PER IP, and a Fleet Ops
// visit fans out across every fleet repo — so successful GETs are cached in
// sessionStorage: 10 minutes without a token (frugal read-only browsing),
// 25 seconds with one (keeps the 30s live-follow fresh). Any write clears
// the cache, as does a 409 reload (a stale sha must never be retried).
const CACHE_PREFIX = 'fo.gh.';
function cacheGet(path, ttl){
  try{
    const raw = sessionStorage.getItem(CACHE_PREFIX + path);
    if(!raw) return undefined;
    const { t, d } = JSON.parse(raw);
    if(Date.now() - t < ttl) return d;
  }catch{}
  return undefined;
}
function cachePut(path, d){
  try{ sessionStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ t: Date.now(), d })); }catch{}
}
export function clearGhCache(){
  try{
    Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  }catch{}
}

export async function gh(path, { method = 'GET', body, fresh = false } = {}){
  const headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = ghToken();
  if(token) headers.Authorization = `Bearer ${token}`;
  const isGet = method === 'GET';
  if(isGet && !fresh){
    const hit = cacheGet(path, token ? 25000 : 600000);
    if(hit !== undefined) return hit;
  }
  let res;
  try{
    // Hard 8s deadline: on some networks an unreachable host HANGS the fetch
    // for a minute-plus instead of failing — cards must settle, not spin.
    res = await fetch(API + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000) });
  }catch{
    throw new Error('GitHub unreachable — check your connection');
  }
  if(res.status === 204){ clearGhCache(); return null; }
  let json = null;
  try{ json = await res.json(); }catch{ /* some endpoints return no body */ }
  if(!res.ok){
    // Rate-limit? GitHub signals it a few ways: a 403/429 with a "rate limit"
    // message, x-ratelimit-remaining: 0, or a retry-after (the search API's
    // stricter secondary limit). Pull the reset moment from the headers so the
    // UI can say WHEN it clears instead of a vague "within the hour" — and,
    // when a token is already connected, drop the misleading "connect a token"
    // advice (a connected token that's still limited just needs to cool down).
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetHdr = res.headers.get('x-ratelimit-reset');
    const retryAfter = res.headers.get('retry-after');
    // GitHub signals rate limits several ways. The SECONDARY / abuse limit — hit
    // by bursts like back-to-back dispatches — returns a 403 whose message is
    // "secondary rate limit" or "abuse detection mechanism" (NOT the plain "rate
    // limit" string), so match those too or it gets mislabeled as a scope error.
    const msg = (json?.message || '').toLowerCase();
    const isRateLimit = (res.status === 403 || res.status === 429) &&
      (msg.includes('rate limit') || msg.includes('secondary rate') || msg.includes('abuse detection')
        || remaining === '0' || retryAfter != null);
    let resetMs = null;
    if(resetHdr) resetMs = parseInt(resetHdr, 10) * 1000;
    else if(retryAfter) resetMs = Date.now() + parseInt(retryAfter, 10) * 1000;
    const resetTxt = resetMs ? new Date(resetMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    const hint = res.status === 401 ? 'token rejected'
      : isRateLimit ? (`rate-limited${resetTxt ? ` — resets ${resetTxt}` : ' — resets within the hour'}`
          + (token ? '' : '; connect a vault token to raise the limit'))
      : res.status === 403 ? `forbidden — ${json?.message || 'token lacks a required scope'} (dispatching runs needs the 'workflow' scope on a classic PAT, or Actions read/write on a fine-grained one)`
      : res.status === 404 ? 'not found (private repo needs a token)'
      : (json?.message || 'request failed');
    const err = new Error(`GitHub ${res.status}: ${hint}`);
    err.status = res.status;
    err.resetAt = resetMs;
    throw err;
  }
  if(isGet) cachePut(path, json); else clearGhCache();
  return json;
}

// ---- endpoints Fleet Ops uses ---------------------------------------------

export const whoami = () => gh('/user');

// UTF-8-safe base64 for the contents API.
const b64decode = (s) => decodeURIComponent(escape(atob(String(s || '').replace(/\s/g, ''))));
const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));

export async function getRoster(){
  const f = await gh(`/repos/${PLATFORM_REPO}/contents/${encodeURIComponent(ROSTER_PATH)}?ref=main`);
  return { roster: JSON.parse(b64decode(f.content)), sha: f.sha };
}

// Roster flips are sanctioned direct commits to main (the file's own _doc
// invites edits from the GitHub UI / the Manager console; it's data, not
// code). The sha makes the write compare-and-swap: a concurrent edit 409s
// instead of being clobbered.
export function putRoster(roster, sha, message){
  return gh(`/repos/${PLATFORM_REPO}/contents/${encodeURIComponent(ROSTER_PATH)}`, {
    method: 'PUT',
    body: { message, content: b64encode(JSON.stringify(roster, null, 2) + '\n'), sha, branch: 'main' },
  });
}

export function dispatchWorkflow(file, inputs){
  return gh(`/repos/${PLATFORM_REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST', body: { ref: 'main', inputs: inputs || {} },
  });
}

export async function stewardRuns(limit = 30, fresh = false){
  const j = await gh(`/repos/${PLATFORM_REPO}/actions/runs?per_page=${limit}`, { fresh });
  return (j.workflow_runs || []).filter(r => /steward/i.test(r.name || ''));
}

// The platform's Steward journal: every run posts its own summary as a
// comment on the always-open `steward-journal` issue (see polecat-platform
// .github/steward/journal.sh), tagged `<!-- steward-run:ID -->`. Find this
// run's entry, newest comments first.
export async function journalFor(runId){
  const issues = await gh(`/repos/${PLATFORM_REPO}/issues?labels=steward-journal&state=all&per_page=1`);
  const issue = issues?.[0];
  if(!issue) return null;
  const perPage = 100;
  const lastPage = Math.max(1, Math.ceil((issue.comments || 0) / perPage));
  for(let p = lastPage; p >= Math.max(1, lastPage - 2); p--){
    const cs = await gh(`/repos/${PLATFORM_REPO}/issues/${issue.number}/comments?per_page=${perPage}&page=${p}`);
    const hit = [...(cs || [])].reverse().find(c => (c.body || '').includes(`steward-run:${runId}`));
    if(hit) return hit;
  }
  return null;
}

// Per-run job + step breakdown (the in-panel "run log" skeleton).
export async function runJobs(runId){
  const j = await gh(`/repos/${PLATFORM_REPO}/actions/runs/${runId}/jobs?per_page=30`);
  return j.jobs || [];
}

// What a run PRODUCED, by time correlation: issues and PRs created (or PRs
// merged) across the owner's repos while the run executed. Approximate by
// construction — anything created in the window shows up — so callers label
// it honestly.
const OWNER = PLATFORM_REPO.split('/')[0];
async function searchWork(qualifiers){
  const j = await gh(`/search/issues?q=${encodeURIComponent(`user:${OWNER} ${qualifiers}`)}&per_page=30&sort=created&order=asc`);
  return j.items || [];
}
export function issuesCreatedBetween(startIso, endIso){ return searchWork(`is:issue created:${startIso}..${endIso}`); }
export function prsCreatedBetween(startIso, endIso){ return searchWork(`is:pr created:${startIso}..${endIso}`); }
export function prsMergedBetween(startIso, endIso){ return searchWork(`is:pr merged:${startIso}..${endIso}`); }

// Reduce a PR head commit's check runs to one signal for a status dot.
export async function checkState(repo, sha){
  const j = await gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=20`);
  const runs = j.check_runs || [];
  if(!runs.length) return 'none';
  if(runs.some(r => r.status !== 'completed')) return 'pending';
  if(runs.some(r => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion))) return 'failure';
  return runs.every(r => ['success', 'neutral', 'skipped'].includes(r.conclusion)) ? 'success' : 'none';
}

// A project can be flagged `private:true` in its Store row (e.g. a repo that
// is genuinely GitHub-private, not just unreached). Without a token, a call
// against it is guaranteed to 404 — so short-circuit to the same shaped error
// `gh()` would throw, WITHOUT the network round trip. This spares the shared
// ~60/hour anonymous budget and stops a permanently-doomed request from
// showing up as a failed resource load on every visit; callers (workCard,
// projectStewardCard, steward-signals) already handle this error shape and
// need no change. A connected token still attempts the real call, since it
// might actually have read access.
function knownPrivateRepos(){
  return new Set(Store.projects().filter(p => p.private && p.repo).map(p => p.repo));
}
function assertReachable(repo){
  if(ghToken() || !knownPrivateRepos().has(repo)) return;
  const err = new Error('GitHub 404: not found (private repo needs a token)');
  err.status = 404;
  throw err;
}

export async function stewardPRs(repo){
  assertReachable(repo);
  const prs = await gh(`/repos/${repo}/pulls?state=open&per_page=30`);
  return (prs || []).filter(p => /^(steward|chore)\//.test(p.head?.ref || '') || /^chore: polecat-shell/.test(p.title || ''));
}

export async function sweepIssues(repo){
  assertReachable(repo);
  const issues = await gh(`/repos/${repo}/issues?state=open&per_page=30`);
  return (issues || []).filter(i => !i.pull_request && /sweep/i.test(i.title || ''));
}

// Fleet repos worth scanning: every project with a repo, platform included.
export function fleetRepos(){
  const repos = Store.projects().map(p => p.repo).filter(Boolean);
  if(!repos.includes(PLATFORM_REPO)) repos.push(PLATFORM_REPO);
  return [...new Set(repos)];
}

// ---- promotion pipeline (dev → qa → prod) ----------------------------------
// Generic per-repo primitives for the staged-delivery pilot (jobtracker's
// docs/PIPELINE.md). Same client, same vault token, same error shapes — the
// Pipeline view composes these; nothing here is jobtracker-specific.

export const getBranch = (repo, name) =>
  gh(`/repos/${repo}/branches/${encodeURIComponent(name)}`);

// GitHub's compare is directional: base...head → how far head is AHEAD of base.
export const compareRefs = (repo, base, head) =>
  gh(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);

export async function listTags(repo, limit = 15){
  const tags = await gh(`/repos/${repo}/tags?per_page=${limit}`);
  return tags || [];
}

// dispatchWorkflow (above) is pinned to the platform repo for the steward;
// promotions dispatch into each APP repo, so the repo is a parameter here.
export function dispatchRepoWorkflow(repo, file, inputs){
  return gh(`/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: 'POST', body: { ref: 'main', inputs: inputs || {} },
  });
}

export async function workflowRuns(repo, file, limit = 5, fresh = false){
  const j = await gh(`/repos/${repo}/actions/workflows/${file}/runs?per_page=${limit}`, { fresh });
  return j.workflow_runs || [];
}

// Contents-API JSON read/write with the roster's compare-and-swap contract:
// the sha makes a concurrent edit 409 instead of being clobbered. pipeline.json
// carries the same "data file — direct commits sanctioned" _doc as focus.json.
export async function getRepoJson(repo, path, ref = 'main'){
  const f = await gh(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  return { json: JSON.parse(b64decode(f.content)), sha: f.sha };
}
export function putRepoJson(repo, path, value, sha, message){
  return gh(`/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: { message, content: b64encode(JSON.stringify(value, null, 2) + '\n'), sha, branch: 'main' },
  });
}

// Generic text file read/write over the contents API (branch-aware) — used by
// the 4D Chicago ticket board, which reads tickets.json (via getRepoJson) and
// rewrites the owner-ordered QUEUE.md on the project's working branch. Writes
// carry the file's sha so a concurrent edit 409s instead of clobbering.
export async function getRepoText(repo, path, ref = 'main'){
  const f = await gh(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  return { text: b64decode(f.content), sha: f.sha };
}
// List a repo directory (contents API returns an array for a dir) — the board
// uses it to resolve a ticket id to its `T-NNNN-<slug>.md` file, whose slug is
// truncated and not reconstructable from the title alone.
export async function getRepoDir(repo, path, ref = 'main'){
  const arr = await gh(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  return Array.isArray(arr) ? arr : [];
}
export function putRepoText(repo, path, text, sha, { message, branch = 'main' } = {}){
  return gh(`/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: { message, content: b64encode(text), sha, branch },
  });
}
