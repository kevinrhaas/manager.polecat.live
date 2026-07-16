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
    res = await fetch(API + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  }catch{
    throw new Error('GitHub unreachable — check your connection');
  }
  if(res.status === 204){ clearGhCache(); return null; }
  let json = null;
  try{ json = await res.json(); }catch{ /* some endpoints return no body */ }
  if(!res.ok){
    const hint = res.status === 401 ? 'token rejected'
      : res.status === 403 ? (json?.message?.includes('rate limit') ? 'rate-limited — resets within the hour; connect a vault token to raise limits' : 'forbidden — token lacks scope')
      : res.status === 404 ? 'not found (private repo needs a token)'
      : (json?.message || 'request failed');
    const err = new Error(`GitHub ${res.status}: ${hint}`);
    err.status = res.status;
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

// Reduce a PR head commit's check runs to one signal for a status dot.
export async function checkState(repo, sha){
  const j = await gh(`/repos/${repo}/commits/${sha}/check-runs?per_page=20`);
  const runs = j.check_runs || [];
  if(!runs.length) return 'none';
  if(runs.some(r => r.status !== 'completed')) return 'pending';
  if(runs.some(r => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion))) return 'failure';
  return runs.every(r => ['success', 'neutral', 'skipped'].includes(r.conclusion)) ? 'success' : 'none';
}

export async function stewardPRs(repo){
  const prs = await gh(`/repos/${repo}/pulls?state=open&per_page=30`);
  return (prs || []).filter(p => /^(steward|chore)\//.test(p.head?.ref || '') || /^chore: polecat-shell/.test(p.title || ''));
}

export async function sweepIssues(repo){
  const issues = await gh(`/repos/${repo}/issues?state=open&per_page=30`);
  return (issues || []).filter(i => !i.pull_request && /sweep/i.test(i.title || ''));
}

// Fleet repos worth scanning: every project with a repo, platform included.
export function fleetRepos(){
  const repos = Store.projects().map(p => p.repo).filter(Boolean);
  if(!repos.includes(PLATFORM_REPO)) repos.push(PLATFORM_REPO);
  return [...new Set(repos)];
}
