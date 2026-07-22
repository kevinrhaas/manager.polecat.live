// gen-shots.mjs — regenerate the marketing screenshots from the REAL app.
//
// The public site (index.html) shows a hero carousel of genuine app
// screenshots. They must never go stale as the app evolves, so this script
// drives the actual (gated) app in a headless browser and captures every
// showcased view fresh:
//   node .github/gen-shots.mjs
//
// Writes assets/shots/*.png. NOTE: the filenames are stable, so the landing
// page busts browser/CDN cache with a `?v=N` query on each <img> src — when a
// regenerated shot visibly changes, bump that N in index.html (search `?v=`).
//
// The invite gate is satisfied by pre-seeding the
// `manager.access` grant (same shape Access.grant() writes). Fleet Ops and
// the Steward log depend on the GitHub API, so those calls are STUBBED with a
// representative roster + run history so the marquee views render populated
// and beautiful offline — the shots show the real UI with realistic data,
// never a spinner or an error card. Resilient: a view that fails to capture
// is logged and skipped, leaving the committed baseline in place. Requires
// playwright (chromium).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 4199;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

function serve(){
  return http.createServer(async (req, res)=>{
    try{
      let p = decodeURIComponent(req.url.split('?')[0]);
      if(p.endsWith('/')) p += 'index.html';
      normalize(join(ROOT, p)).replace(/^(\.\.[/\\])+/,'');
      const data = await readFile(join(ROOT, p.replace(/^\//,'')));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(data);
    }catch{ res.writeHead(404); res.end('not found'); }
  });
}

// ---- stub GitHub so Fleet Ops / Steward log render populated & pretty ------
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const ROSTER = { apps: {
    'games.polecat.live':{enabled:false,everyHours:1}, 'jobtracker.polecat.live':{enabled:true,everyHours:2},
    'manager.polecat.live':{enabled:true,everyHours:1}, 'analytics.polecat.live':{enabled:true,everyHours:1},
    'autoselector.polecat.live':{enabled:false,everyHours:1}, 'relay.polecat.live':{enabled:false,everyHours:1},
  }, jobs: {
    'fleet-improve':{enabled:true,everyHours:2,offset:1}, 'sweep-ux':{enabled:true,everyHours:12,offset:6},
    'sweep-tech':{enabled:true,everyHours:12,offset:10}, 'janitor':{enabled:true,everyHours:2},
  } };
const RUNS = { workflow_runs: [
  { id:1, name:'Steward improve', display_title:'Steward improve — analytics.polecat.live', event:'schedule', status:'completed', conclusion:'success', created_at:iso(9*60e3), updated_at:iso(3*60e3), run_started_at:iso(9*60e3), html_url:'#' },
  { id:2, name:'Steward janitor', display_title:'Steward janitor', event:'schedule', status:'completed', conclusion:'success', created_at:iso(58*60e3), updated_at:iso(56*60e3), run_started_at:iso(58*60e3), html_url:'#' },
  { id:3, name:'Steward improve', display_title:'Steward improve — manager.polecat.live', event:'workflow_dispatch', status:'in_progress', conclusion:null, created_at:iso(2*60e3), updated_at:iso(1*60e3), run_started_at:iso(2*60e3), html_url:'#' },
  { id:4, name:'Steward sweep (UX)', display_title:'Steward sweep (UX)', event:'schedule', status:'completed', conclusion:'success', created_at:iso(5*3600e3), updated_at:iso(5*3600e3-4*60e3), run_started_at:iso(5*3600e3), html_url:'#' },
  { id:5, name:'Steward improve', display_title:'Steward improve — jobtracker.polecat.live', event:'schedule', status:'completed', conclusion:'success', created_at:iso(2*3600e3), updated_at:iso(2*3600e3-6*60e3), run_started_at:iso(2*3600e3), html_url:'#' },
] };
async function stubGitHub(ctx){
  await ctx.route('https://api.github.com/**', (route)=>{
    const url = route.request().url();
    const json = (d)=>route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(d) });
    if(url.includes('/contents/')) return json({ content:Buffer.from(JSON.stringify(ROSTER)).toString('base64'), sha:'stub' });
    if(url.includes('/user')) return json({ login:'kevinrhaas' });
    if(url.includes('/actions/runs') && url.includes('/jobs')) return json({ jobs:[] });
    if(url.includes('/actions/runs')) return json(RUNS);
    if(url.includes('/search/')) return json({ items:[] });
    if(url.includes('/pulls') || url.includes('/issues')) return json([]);
    return json({});
  });
}

// Strip first-run chrome so shots show the clean, populated app.
const DECLUTTER = `document.querySelectorAll('.tour-back,.tour-pop,.confetti-root,#toasts .toast,.ps-rail-backdrop').forEach(e=>e.remove());`;
const GRANT = `try{localStorage.setItem('manager.access',JSON.stringify({grantedAt:Date.now(),via:'ci',label:'Preview'}));localStorage.setItem('manager.theme','manager:dark');localStorage.setItem('manager.tourDone','1');}catch(e){}`;
// Connect Fleet Ops to a (stubbed) token so the roster/runs render live.
const CONNECT_FO = `try{const s=JSON.parse(localStorage.getItem('manager.db')||'{}');}catch(e){}`;

const DESKTOP = [
  ['home','dashboard', 1400],
  ['projects','library', 1100],
  ['releases','releases', 1100],
  ['fleetops','fleetops', 1800],
  ['stewardlog','stewardlog', 1800],
];
const MOBILE = [ ['home','m-dashboard', 1200], ['fleetops','m-fleetops', 1600] ];

(async ()=>{
  const server = serve();
  await new Promise(r=>server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });
  const base = `http://localhost:${PORT}/app/`;
  let ok = 0, fail = 0;

  const shoot = async (page, sec, name, wait=1000)=>{
    try{
      await page.evaluate(s=>{ location.hash = s; }, sec); await page.waitForTimeout(wait);
      await page.evaluate(DECLUTTER); await page.waitForTimeout(160);
      await page.screenshot({ path:`assets/shots/${name}.png` });
      console.log('  ✓', name); ok++;
    }catch(e){ console.log('  ✗', name, '—', e.message); fail++; }
  };

  try{
    // ---- desktop (1440×952 @2x → 2880×1904 px; ~1.513 ratio matches the
    //      carousel container so hi-DPI displays get crisp, un-upscaled art) --
    const ctx = await browser.newContext({ viewport:{ width:1440, height:952 }, deviceScaleFactor:2 });
    await stubGitHub(ctx);
    await ctx.addInitScript(GRANT);
    const p = await ctx.newPage();
    await p.goto(base, { waitUntil:'networkidle', timeout:20000 });
    await p.waitForSelector('.ps-rail-item', { timeout:12000 });
    // Wire Fleet Ops to the stubbed token (first credential) so it connects.
    await p.evaluate(async ()=>{
      const { Store } = await import('/js/store.js');
      let cred = Store.credentials('global').find(c=>/git|pat|token/i.test(c.name||c.key||''));
      if(!cred) cred = Store.addCredential({ scope:'global', name:'STEWARD_PAT', key:'STEWARD_PAT', value:'ghp_stub_for_shots' });
      Store.setSetting('fleetOps', { credId: cred.id });
    });
    await p.waitForTimeout(600);
    await p.evaluate(DECLUTTER);
    for(const [sec,name,wait] of DESKTOP) await shoot(p, sec, name, wait);
    await ctx.close();

    // ---- mobile (390×840 @2x) ------------------------------------------
    const mctx = await browser.newContext({ viewport:{ width:390, height:840 }, deviceScaleFactor:2, isMobile:true });
    await stubGitHub(mctx);
    await mctx.addInitScript(GRANT);
    const mp = await mctx.newPage();
    await mp.goto(base, { waitUntil:'networkidle', timeout:20000 });
    await mp.waitForSelector('.ps-rail-item', { timeout:12000 });
    await mp.evaluate(async ()=>{
      const { Store } = await import('/js/store.js');
      let cred = Store.credentials('global')[0] || Store.addCredential({ scope:'global', name:'STEWARD_PAT', value:'ghp_stub' });
      Store.setSetting('fleetOps', { credId: cred.id });
    });
    for(const [sec,name,wait] of MOBILE) await shoot(mp, sec, name, wait);
    await mctx.close();
  } finally {
    await browser.close(); server.close();
  }
  console.log(`shots: ${ok} ok, ${fail} failed`);
  if(ok === 0) process.exit(1);
})();
