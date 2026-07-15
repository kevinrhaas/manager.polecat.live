// steward-signals.js — feeds steward state into the Needs-attention pipeline.
//
// Fetches, per fleet repo: red (check-failing) steward PRs and open
// sweep-finding issues, then hands the summary to Store.setStewardSignals()
// so the bell / rail badge / dashboard callout surface them like any other
// attention reason (with the same signature-scoped dismissals).
//
// Fetch policy: one sweep at boot (works unauthenticated on public repos),
// then a 5-minute refresh ONLY while a vault token is connected (the
// unauthenticated rate limit is far too small to poll) and the tab is
// visible. Everything is caught — a rate-limited or offline session simply
// keeps the store-derived reasons and shows no steward ones.
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
  refreshStewardSignals().catch(() => {});
  if(timer) clearInterval(timer);
  timer = setInterval(() => {
    if(ghToken() && !document.hidden) refreshStewardSignals().catch(() => {});
  }, REFRESH_MS);
}
