// steward-signals.js — feeds steward state into the Needs-attention pipeline.
//
// Fetches, per fleet repo: red (check-failing) steward PRs and open
// sweep-finding issues, then hands the summary to Store.setStewardSignals()
// so the bell / rail badge / dashboard callout surface them like any other
// attention reason (with the same signature-scoped dismissals).
//
// Fetch policy: TOKEN-GATED end to end — the sweep costs ~2 calls per fleet
// repo plus per-PR check lookups, and the unauthenticated GitHub budget is
// only ~60/hour per IP (a few token-less app opens used to drain it and
// 403 every panel). With a vault token connected: one sweep at boot, then a
// 5-minute refresh while the tab is visible. Everything is caught — a
// rate-limited or offline session simply keeps the store-derived reasons.
import { Store } from './store.js';
import { stewardPRs, sweepIssues, checkState, ghToken } from './github.js';

const REFRESH_MS = 300000;   // 5 min
const RED_CHECK_CAP = 6;     // per-repo cap on per-PR check lookups

export async function refreshStewardSignals(){
  const repos = [...new Set(Store.projects().map(p => p.repo).filter(Boolean))];
  const map = {};
  await Promise.allSettled(repos.map(async repo => {
    const [prs, issues] = await Promise.all([stewardPRs(repo), sweepIssues(repo)]);
    let red = 0;
    await Promise.allSettled(prs.slice(0, RED_CHECK_CAP).map(async pr => {
      if(pr.head?.sha && (await checkState(repo, pr.head.sha)) === 'failure') red++;
    }));
    map[repo] = { openPRs: prs.length, redPRs: red, sweepIssues: issues.length };
  }));
  Store.setStewardSignals(map);
  return map;
}

let timer = null;
export function startStewardSignals(){
  if(ghToken()) refreshStewardSignals().catch(() => {});
  if(timer) clearInterval(timer);
  timer = setInterval(() => {
    if(ghToken() && !document.hidden) refreshStewardSignals().catch(() => {});
  }, REFRESH_MS);
}
