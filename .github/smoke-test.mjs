// Functional smoke suite for CI. Serves the repo and drives the REAL app end
// to end; the hourly self-improvement loop only commits/deploys if every check
// here passes. This is a GROWING list — when a feature ships, add a check.
//
// Local run:  PW_EXECUTABLE=/path/to/chrome node .github/smoke-test.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8188;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(d);
  });
});

const errors = [];
let failed = false;
const base = `http://localhost:${PORT}`;
const fail = (m) => { failed = true; console.error('  ✗ ' + m); };
const ok   = (m) => console.log('  ✓ ' + m);
async function check(name, fn) {
  try { const r = await fn(); if (r === false) fail(name); else ok(name); }
  catch (e) { fail(`${name} — ${e.message}`); }
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // pre-grant the invite gate so the app boots in CI
  await ctx.addInitScript(`try{localStorage.setItem('manager.access',JSON.stringify({grantedAt:Date.now(),via:'ci'}));}catch(e){}`);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/net::ERR_/.test(t) || /favicon/.test(t)) return;
    errors.push('console: ' + t);
  });
  const $ = (s) => page.$(s);
  const count = (s) => page.$$eval(s, (e) => e.length).catch(() => 0);
  const sec = (s) => page.$(`.rail-item[data-sec="${s}"]`);
  const openSec = async (s) => { const el = await sec(s); if (el) { await el.click(); await page.waitForTimeout(320); } return !!el; };
  const store = (fn) => page.evaluate(`(async()=>{const{Store}=await import('/js/store.js');return (${fn})(Store);})()`);

  // ---------- Landing ----------
  console.log('Landing');
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await check('landing renders a headline', async () => !!(await $('h1')));
  await check('landing has a Launch link to /app/', async () =>
    (await page.$$eval('a', (as) => as.some((a) => /\/app\/?$/.test(a.getAttribute('href') || '')))));
  await check('landing shows the fleet showcase', async () => (await count('#fleet .fchip')) >= 5);

  // ---------- App shell ----------
  console.log('App shell');
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1100);
  await page.keyboard.press('Escape');   // dismiss the first-run welcome tour
  await page.waitForTimeout(300);
  await check('nav rail renders (>=5 sections)', async () => (await count('.rail-item')) >= 5);
  for (const s of ['home', 'projects', 'activity', 'credentials', 'docs', 'settings']) {
    await check(`section "${s}" opens`, async () => { if (!(await openSec(s))) return false; return (await count('#view *')) > 0; });
  }

  // ---------- Dashboard ----------
  console.log('Dashboard');
  await openSec('home');
  await check('dashboard shows project tiles (seeded fleet)', async () => (await count('.tile')) >= 5);
  await check('a tile opens the project detail', async () => {
    await (await $('.tile')).click(); await page.waitForTimeout(350);
    return !!(await page.$('.detail-head')) && (await count('.detail-head')) > 0;
  });
  await check('dashboard shows a fleet health score and per-project trend sparklines', async () => {
    await openSec('home');
    const fleetStat = await page.$eval('.stats', (s) => /Fleet health/i.test(s.textContent));
    return fleetStat && (await count('.tile .hchip')) >= 5 && (await count('.tile .spark')) >= 5;
  });

  // ---------- Projects library ----------
  console.log('Projects library');
  await openSec('projects');
  await check('library renders a table of projects', async () => (await count('.lib-table tbody tr')) >= 5);
  await check('Latest column shows the version\'s ship time in CT', async () => {
    // a project with releases (relay is seeded with real ones) shows a CT date under its version chip
    const cell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.lib-table tbody tr')];
      const relay = rows.find((r) => /relay/i.test(r.textContent));
      const vcell = relay && relay.querySelector('td:nth-child(4)');
      return vcell ? vcell.textContent.trim() : '';
    });
    return /v\d+/.test(cell) && /\bCT$/.test(cell);
  });
  await check('projects header has a "Sync all" button', async () => !!(await page.$('#view .section-title button:has-text("Sync all")')));
  await check('search filters the list', async () => {
    await page.fill('.toolbar .search input', 'relay'); await page.waitForTimeout(300);
    const n = await count('.lib-table tbody tr');
    await page.fill('.toolbar .search input', ''); await page.waitForTimeout(250);
    return n >= 1 && n < 6;
  });
  await check('create a project via the modal', async () => {
    await page.click('#view .btn.primary'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Smoke Project');
    await page.click('.modal button:has-text("Create project")'); await page.waitForTimeout(450);
    return await store(`(S)=>S.projects().some(p=>p.name==='Smoke Project')`);
  });
  await check('undo removes the created project', async () => {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    return !(await store(`(S)=>S.projects().some(p=>p.name==='Smoke Project')`));
  });
  await check('pin toggles persist to the store', async () => {
    await openSec('projects');
    const before = await store(`(S)=>S.project('games').pinned`);
    await store(`(S)=>S.togglePin('games')`);
    const after = await store(`(S)=>S.project('games').pinned`);
    await store(`(S)=>S.togglePin('games')`);   // restore
    return before !== after;
  });

  // ---------- Project detail / releases ----------
  console.log('Project detail');
  await page.evaluate(() => { location.hash = 'project/relay'; });
  await page.waitForTimeout(400);
  await check('project detail shows the what\'s-new timeline', async () => (await count('.timeline .tl-item')) >= 1);
  await check('project detail health panel shows a health score and velocity sparkline', async () =>
    (await count('.health .hchip')) >= 1 && (await count('.health .spark')) >= 1);
  await check('add a release to a project', async () => {
    const before = await store(`(S)=>S.releasesFor('relay').length`);
    await page.click('button:has-text("Add release")'); await page.waitForTimeout(300);
    await page.fill('.modal input[placeholder="What changed, in a few words"]', 'Smoke release');
    await page.click('.modal button:has-text("Add release")'); await page.waitForTimeout(400);
    const after = await store(`(S)=>S.releasesFor('relay').length`);
    // clean up
    await store(`(S)=>{const r=S.releasesFor('relay').find(x=>x.title==='Smoke release'); if(r) S.remove('releases', r.id, {silent:true});}`);
    return after === before + 1;
  });
  await check('project health panel: per-project weighting override is isolated to that project and resettable', async () => {
    await openSec('projects');
    await page.evaluate(() => { location.hash = 'project/solution-engineering'; });
    await page.waitForTimeout(400);
    const rowBefore = await page.$eval('.row:has-text("Weighting") .v', (e) => e.textContent).catch(() => '');
    const otherBefore = await store(`(S)=>S.healthScore('games')`);
    await page.click('.health button:has-text("Customize")'); await page.waitForTimeout(300);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150);
    await page.$eval('.proj-weight-slider[data-dim="recency"]', (s) => { s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('.proj-weight-slider[data-dim="velocity"]', (s) => { s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('.proj-weight-slider[data-dim="status"]', (s) => { s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const overridden = await store(`(S)=>({...S.healthWeightsFor('solution-engineering')})`);
    const otherAfter = await store(`(S)=>S.healthScore('games')`);
    await page.click('.modal button:has-text("Reset to fleet default")'); await page.waitForTimeout(150);
    const afterReset = await store(`(S)=>({...S.healthWeightsFor('solution-engineering')})`);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150); // back off — should now mirror the fleet
    const disabledMatchesFleet = await store(`(S)=>{const f=S.healthWeights(); const p=S.healthWeightsFor('solution-engineering'); return Math.abs(f.recency-p.recency)<0.01 && Math.abs(f.velocity-p.velocity)<0.01 && Math.abs(f.status-p.status)<0.01;}`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(300);
    const rowAfter = await page.$eval('.row:has-text("Weighting") .v', (e) => e.textContent).catch(() => '');
    return /Fleet default/.test(rowBefore) && Math.abs(overridden.status - 100) < 0.01 && overridden.recency === 0 && overridden.velocity === 0
      && otherAfter === otherBefore
      && Math.abs(afterReset.recency - 40) < 0.01 && Math.abs(afterReset.velocity - 40) < 0.01 && Math.abs(afterReset.status - 20) < 0.01
      && disabledMatchesFleet && /Fleet default/.test(rowAfter);
  });

  // ---------- Live changelog sync ----------
  console.log('Changelog sync');
  await check('sync fetches, previews, and imports a real changelog', async () => {
    await openSec('projects');   // ensure the section actually changes so the hash nav below fires
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    const before = await store(`(S)=>S.releasesFor('games').length`);
    await page.click('button:has-text("Sync")'); await page.waitForTimeout(300);
    // point at Manager's own changelog.js, served same-origin by this test server
    await page.fill('.modal input.mono', `${base}/js/changelog.js`);
    await page.click('.modal button:has-text("Fetch")'); await page.waitForTimeout(500);
    const previewed = (await count('.sync-preview li')) >= 1;
    await page.click('.modal button:has-text("Import")'); await page.waitForTimeout(400);
    const after = await store(`(S)=>S.releasesFor('games').length`);
    const synced = await store(`(S)=>S.releasesFor('games').some(r=>r.source==='sync')`);
    // clean up
    await store(`(S)=>{S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, changelogUrl:'', lastSyncAt:0}, {silent:true});}`);
    return previewed && synced && after > before;
  });
  await check('sync surfaces a graceful error for an unreachable URL', async () => {
    await page.click('button:has-text("Sync")'); await page.waitForTimeout(300);
    // an unreachable port — simulates the network/CORS failures this fallback exists for,
    // without tripping a real 404 (which Chromium logs as a console error the suite treats as a failure)
    await page.fill('.modal input.mono', 'http://localhost:1/changelog.js');
    await page.click('.modal button:has-text("Fetch")'); await page.waitForTimeout(500);
    const hasError = (await count('.sync-err')) >= 1;
    const pasteShown = await page.$eval('.modal textarea', (t) => t.closest('div').style.display !== 'none').catch(() => false);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    return hasError && pasteShown;
  });

  // ---------- Fleet-wide sync ----------
  console.log('Fleet-wide sync');
  await check('dashboard "Sync all" ingests every project\'s changelog with a per-project summary', async () => {
    await openSec('home');
    const changelogUrl = `${base}/js/changelog.js`;
    // isolate: make 'games' the only reachable sync target (same-origin), so this
    // check never depends on real network/CORS access to the other projects' sites
    const saved = await store(`(S)=>{
      const snap={};
      S.projects().forEach(p=>{
        snap[p.id]={site:p.site,changelogUrl:p.changelogUrl};
        S.put('projects', Object.assign({}, p, p.id==='games'?{changelogUrl:'${changelogUrl}'}:{site:'',changelogUrl:''}), {silent:true});
      });
      return snap;
    }`);
    const before = await store(`(S)=>S.releasesFor('games').length`);
    await page.click('.qa:has-text("Sync all")'); await page.waitForTimeout(300);
    await page.waitForTimeout(700); // let the single same-origin fetch resolve
    const rowOk = await page.$eval('.sync-all-row .status', (e) => e.textContent.trim() !== 'Waiting…' && !e.classList.contains('sync-err')).catch(() => false);
    const after = await store(`(S)=>S.releasesFor('games').length`);
    const loggedRun = await store(`(S)=>S.runs().some(r=>r.mode==='manual' && (r.note||'').indexOf('Fleet-wide sync')===0)`);
    await page.click('.modal button:has-text("Close")').catch(() => {});
    await page.waitForTimeout(200);
    // restore
    await store(`(S)=>{
      const snap=${JSON.stringify(saved)};
      Object.keys(snap).forEach(id=>{ const p=S.project(id); if(p) S.put('projects', Object.assign({}, p, snap[id]), {silent:true}); });
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const g=S.project('games'); if(g) S.put('projects', Object.assign({}, g, {lastSyncAt:0}), {silent:true});
      const badRun=S.runs().find(r=>r.mode==='manual' && (r.note||'').indexOf('Fleet-wide sync')===0);
      if(badRun) S.remove('runs', badRun.id, {silent:true});
    }`);
    return rowOk && after > before && loggedRun;
  });

  // ---------- Auto-sync & force sync ----------
  console.log('Auto-sync & force sync');
  await check('project health panel toggles per-project auto-sync', async () => {
    await openSec('projects');
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    const before = await store(`(S)=>!!S.project('games').autoSync`);
    await page.click('.health .toggle'); await page.waitForTimeout(200);
    const after = await store(`(S)=>!!S.project('games').autoSync`);
    await store(`(S)=>{const p=S.project('games'); S.put('projects', {...p, autoSync:false}, {silent:true});}`);
    return before !== after;
  });
  await check('settings: global auto-sync toggle + minute interval persist', async () => {
    await openSec('settings');
    const before = await store(`(S)=>({...S.settings().autoSync})`);
    await page.click('.card:has-text("Auto-sync") .opt-row .toggle'); await page.waitForTimeout(200);
    // interval is now stored in minutes and can go as low as 1 minute
    await page.selectOption('.card:has-text("Auto-sync") select.input', '1'); await page.waitForTimeout(150);
    const after = await store(`(S)=>({...S.settings().autoSync})`);
    await store(`(S)=>S.setSetting('autoSync', ${JSON.stringify({ enabled:false, intervalMinutes:360 })})`);
    return after.enabled !== before.enabled && after.intervalMinutes === 1;
  });
  await check('force sync overwrites a drifted release and removes a stale synced one', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await openSec('projects');
    await store(`(S)=>{const p=S.project('games'); S.put('projects', {...p, changelogUrl:'${changelogUrl}'}, {silent:true});}`);
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    // seed synced releases directly (fetch/parse already covered by the sync check above), then corrupt one and plant a stale one
    await page.evaluate(async (url) => {
      const { fetchChangelog } = await import('/js/ingest.js');
      const { Store } = await import('/js/store.js');
      Store.syncReleases('games', await fetchChangelog(url), url);
    }, changelogUrl);
    await store(`(S)=>{
      const r=S.releasesFor('games').find(x=>x.source==='sync');
      if(r) S.put('releases', {...r, title:'CORRUPTED TITLE'}, {silent:true});
      S.addRelease('games', { v:9999, title:'Stale synced release', kind:'feature', items:[], source:'sync', sourceUrl:'${changelogUrl}' }, {silent:true});
    }`);
    const corruptedBefore = await store(`(S)=>S.releasesFor('games').some(r=>r.title==='CORRUPTED TITLE')`);
    const staleBefore = await store(`(S)=>S.releasesFor('games').some(r=>r.v===9999)`);
    await page.click('button:has-text("Force sync")'); await page.waitForTimeout(300);
    await page.click('.modal button:has-text("Force sync")'); await page.waitForTimeout(700);
    const corruptedAfter = await store(`(S)=>S.releasesFor('games').some(r=>r.title==='CORRUPTED TITLE')`);
    const staleAfter = await store(`(S)=>S.releasesFor('games').some(r=>r.v===9999)`);
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, changelogUrl:'', lastSyncAt:0}, {silent:true});
    }`);
    return corruptedBefore && staleBefore && !corruptedAfter && !staleAfter;
  });
  await check('auto-sync runs quietly on app open when a project is due', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      S.setSetting('autoSync', {enabled:true, intervalHours:6});
      const p=S.project('games'); S.put('projects', {...p, autoSync:true, changelogUrl:'${changelogUrl}', lastAutoSyncAt:0}, {silent:true});
    }`);
    await page.reload({ waitUntil:'networkidle' });
    await page.waitForTimeout(1500);
    const synced = await store(`(S)=>S.releasesFor('games').some(r=>r.source==='sync')`);
    const stamped = await store(`(S)=>S.project('games').lastAutoSyncAt > 0`);
    const loggedRun = await store(`(S)=>S.runs().some(r=>r.mode==='auto-sync')`);
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0}, {silent:true});
      S.setSetting('autoSync', {enabled:false, intervalHours:6});
      const run=S.runs().find(r=>r.mode==='auto-sync'); if(run) S.remove('runs', run.id, {silent:true});
    }`);
    return synced && stamped && loggedRun;
  });
  await check('auto-sync backoff multiplier grows with consecutive failures, capped at 8x', async () => {
    const mults = await page.evaluate(async () => {
      const { autoSyncBackoffMultiplier } = await import('/js/ingest.js');
      return [0, 1, 2, 3, 4, 5].map(autoSyncBackoffMultiplier);
    });
    return mults[0] === 1 && mults[1] === 2 && mults[2] === 4 && mults[3] === 8 && mults[4] === 8 && mults[5] === 8;
  });
  await check('a project failing auto-sync surfaces a "Failing" badge (health panel + tile) with a working Retry now', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const tileFailBadge = (await count('.tile .fail-chip')) > 0;
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    const panelFailBadgeBefore = await page.$eval('.health .fail-chip', (e) => e.textContent).catch(() => null);
    await page.click('.health button:has-text("Retry now")');
    await page.waitForTimeout(700);
    const failCountAfter = await store(`(S)=>S.project('games').autoSyncFailCount`);
    const panelFailBadgeAfter = await count('.health .fail-chip');
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return tileFailBadge && /Failing ×3/.test(panelFailBadgeBefore || '') && failCountAfter === 0 && panelFailBadgeAfter === 0;
  });
  await check('dashboard "Needs attention" callout surfaces a failing project with a working Retry now', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const panelBefore = (await count('.attn-panel')) > 0;
    const chipText = await page.$eval('.attn-row .fail-chip', (e) => e.textContent).catch(() => null);
    await page.click('.attn-row button:has-text("Retry now")');
    await page.waitForTimeout(700);
    const failCountAfter = await store(`(S)=>S.project('games').autoSyncFailCount`);
    const panelRowsAfter = await count('.attn-row');
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return panelBefore && /Auto-sync failing/.test(chipText || '') && failCountAfter === 0 && panelRowsAfter === 0;
  });
  await check('projects library "Needs attention" saved view matches Store.needsAttention()', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('projects');
    await page.click('.saved-views button:has-text("Needs attention")');
    await page.waitForTimeout(300);
    const expected = await store(`(S)=>S.needsAttention().length`);
    const rows = await count('.lib-table tbody tr');
    const hasGames = await page.evaluate(() => document.querySelector('.lib-table tbody')?.textContent.includes('Games'));
    await page.click('.saved-views button:has-text("All")');
    await page.waitForTimeout(200);
    // clean up
    await store(`(S)=>{
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return rows === expected && hasGames;
  });

  await check('notification bell badges the same count as Store.needsAttention() and opens a matching popover', async () => {
    await openSec('home');
    const baseline = await store(`(S)=>S.needsAttention().length`);
    const badgeVisible = await page.$eval('.notif-btn .badge', (e) => !e.hidden).catch(() => false);
    const badgeText = badgeVisible ? await page.$eval('.notif-btn .badge', (e) => e.textContent) : '0';
    const badgeMatches = baseline > 0 ? (badgeVisible && badgeText === String(baseline)) : !badgeVisible;
    await page.click('.notif-btn'); await page.waitForTimeout(250);
    const popShown = (await count('.notif-pop.show')) > 0;
    const rows = await count('.notif-pop .attn-row');
    const emptyShown = (await count('.notif-pop-empty')) > 0;
    const listMatches = baseline > 0 ? (rows === baseline && !emptyShown) : (emptyShown && rows === 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    const closed = (await count('.notif-pop.show')) === 0;
    return badgeMatches && popShown && listMatches && closed;
  });
  await check('rail Dashboard item badges the same "Needs attention" count, expanded and collapsed', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const expected = await store(`(S)=>S.needsAttention().length`);
    const railBadgeText = () => page.$eval('.rail-item[data-sec="home"] .badge', (e) => (e.hidden ? null : e.textContent)).catch(() => null);
    const railBadgeVisible = () => page.$eval('.rail-item[data-sec="home"] .badge', (e) => !e.hidden && getComputedStyle(e).opacity !== '0');
    const railOpenBefore = await page.$eval('#rail', (e) => e.classList.contains('open'));
    if (!railOpenBefore) { await page.click('.rail-toggle'); await page.waitForTimeout(300); }
    const openBadgeText = await railBadgeText();
    const openVisible = await railBadgeVisible();
    await page.click('.rail-toggle'); await page.waitForTimeout(300); // collapse
    const collapsedVisible = await railBadgeVisible();
    if (railOpenBefore) { await page.click('.rail-toggle'); await page.waitForTimeout(300); } // restore original rail state
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return expected > 0 && openBadgeText === String(expected) && openVisible && collapsedVisible;
  });
  await check('notification popover "Retry now" recovers a failing project and updates the badge', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const before = await page.$eval('.notif-btn .badge', (e) => e.textContent);
    await page.click('.notif-btn'); await page.waitForTimeout(250);
    const chipText = await page.$eval('.notif-pop .attn-row .fail-chip', (e) => e.textContent).catch(() => null);
    await page.click('.notif-pop .attn-row button:has-text("Retry now")');
    await page.waitForTimeout(700);
    const popClosed = (await count('.notif-pop.show')) === 0; // a successful retry navigates home, closing the popover
    const failCountAfter = await store(`(S)=>S.project('games').autoSyncFailCount`);
    const badgeAfter = await page.$eval('.notif-btn .badge', (e) => (e.hidden ? '0' : e.textContent)).catch(() => '0');
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return /Auto-sync failing/.test(chipText || '') && popClosed && failCountAfter === 0 && badgeAfter !== before;
  });
  await check('a "Needs attention" row can be dismissed independently of the underlying condition, undone via the toast, and restored from the "N dismissed" review modal', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const rawBefore = await store(`(S)=>S.needsAttention().length`);
    const activeBefore = await store(`(S)=>S.needsAttentionActive().length`);

    await page.click('.attn-panel .attn-row button:has-text("Dismiss")');
    await page.waitForTimeout(400);
    const rawAfterDismiss = await store(`(S)=>S.needsAttention().length`); // the condition itself never changed
    const activeAfterDismiss = await store(`(S)=>S.needsAttentionActive().length`);
    const panelRowsAfterDismiss = await count('.attn-panel .attn-row');
    const badgeAfterDismiss = await page.$eval('.notif-btn .badge', (e) => (e.hidden ? 0 : parseInt(e.textContent, 10))).catch(() => 0);

    await page.click('.toast .undo'); // undo the dismiss
    await page.waitForTimeout(400);
    const activeAfterUndo = await store(`(S)=>S.needsAttentionActive().length`);

    await page.click('.attn-panel .attn-row button:has-text("Dismiss")'); // dismiss again, restore via the review modal this time
    await page.waitForTimeout(400);
    const dismissedLinkVisible = (await count('.attn-panel .section-title button:has-text("dismissed")')) > 0;
    await page.click('.attn-panel .section-title button:has-text("dismissed")');
    await page.waitForTimeout(300);
    const modalHasRow = (await count('.modal .attn-row')) > 0;
    await page.click('.modal button:has-text("Restore")');
    await page.waitForTimeout(300);
    const activeAfterRestore = await store(`(S)=>S.needsAttentionActive().length`);

    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
      S.undismissAttention('games');
    }`);

    return rawBefore === activeBefore && rawAfterDismiss === rawBefore &&
      activeAfterDismiss === activeBefore - 1 && panelRowsAfterDismiss === activeAfterDismiss &&
      badgeAfterDismiss === activeAfterDismiss && activeAfterUndo === activeBefore &&
      dismissedLinkVisible && modalHasRow && activeAfterRestore === activeBefore;
  });

  // ---------- Credentials ----------
  console.log('Credentials');
  await openSec('credentials');
  await check('add a credential', async () => {
    await page.click('#view .btn.primary'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Smoke Secret');
    // value textarea
    await page.fill('.modal textarea', 'sk-smoke-123');
    await page.click('.modal button:has-text("Add")'); await page.waitForTimeout(400);
    const okc = await store(`(S)=>S.all('credentials').some(c=>c.name==='Smoke Secret')`);
    await store(`(S)=>{const c=S.all('credentials').find(x=>x.name==='Smoke Secret'); if(c) S.remove('credentials', c.id, {silent:true});}`);
    return okc;
  });

  // ---------- Activity ----------
  console.log('Activity');
  await openSec('activity');
  await check('activity shows the cadence + run log', async () => !!(await $('.cadence')) && (await count('.run-row')) >= 1);

  // ---------- What's new ----------
  console.log("What's new");
  await check("what's new panel opens, lists entries, dates in CT, searches, filters", async () => {
    await (await $('.wn-btn')).click(); await page.waitForTimeout(320);
    if (!(await $('.sheet-overlay.show'))) return false;
    if ((await count('.wn-entry')) < 1) return false;
    const dateText = await page.evaluate(() => { const d = document.querySelector('.wn-entry .wn-date'); return d ? d.textContent.trim() : ''; });
    if (!/\bCT$/.test(dateText)) return false;
    await page.fill('.sheet .search input', 'zzzznomatch'); await page.waitForTimeout(250);
    const none = (await count('.wn-entry')) === 0;
    await page.fill('.sheet .search input', ''); await page.waitForTimeout(200);
    // kind filter chip — compare against the real data so this doesn't assume which kinds exist
    const expectPolish = await page.evaluate(async () => {
      const { CHANGELOG } = await import('/js/changelog.js');
      return CHANGELOG.filter((e) => (e.kind || 'feature') === 'polish').length;
    });
    await page.click('.sheet-tools .filter-chip:has-text("Polish")'); await page.waitForTimeout(200);
    const filtered = (await count('.wn-entry')) === expectPolish;
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    return none && filtered;
  });

  // ---------- Settings: theme, simple mode, tour ----------
  console.log('Settings');
  await openSec('settings');
  await check('theme toggle changes data-theme', async () => {
    const t0 = await page.getAttribute('html', 'data-theme');
    await page.click('.seg button:has-text("Light")'); await page.waitForTimeout(200);
    const t1 = await page.getAttribute('html', 'data-theme');
    await page.click('.seg button:has-text("Dark")'); await page.waitForTimeout(150);
    return t0 !== t1 && t1 === 'light';
  });
  await check('simple mode trims the rail then restores', async () => {
    const full = await count('.rail-item');
    // toggle simple mode on (first toggle in Appearance card)
    await page.click('.opt-row .toggle'); await page.waitForTimeout(350);
    const trimmed = await count('.rail-item');
    await openSec('settings');
    await page.click('.opt-row .toggle'); await page.waitForTimeout(350);
    const restored = await count('.rail-item');
    return trimmed < full && restored === full;
  });
  await check('healthWeights() renormalizes any ratio to sum to 100', async () => {
    const w = await store(`(S)=>{
      S.setSetting('healthWeights', {recency:10, velocity:10, status:5});
      const w=S.healthWeights();
      S.setSetting('healthWeights', {recency:40, velocity:40, status:20});
      return w;
    }`);
    const total = w.recency + w.velocity + w.status;
    return Math.abs(total - 100) < 0.01 && Math.abs(w.recency - 40) < 0.01 && Math.abs(w.velocity - 40) < 0.01 && Math.abs(w.status - 20) < 0.01;
  });
  await check('settings: fleet health weighting sliders persist, reset restores the shipped default', async () => {
    await openSec('settings');
    await page.$eval('.health-weight-slider[data-dim="velocity"]', (s) => { s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const zeroed = await store(`(S)=>S.settings().healthWeights.velocity`);
    await page.click('.card:has-text("Fleet health weighting") button:has-text("Reset to default weighting")');
    await page.waitForTimeout(150);
    const restored = await store(`(S)=>({...S.settings().healthWeights})`);
    return zeroed === 0 && restored.recency === 40 && restored.velocity === 40 && restored.status === 20;
  });
  await check('settings: needs-attention thresholds are tunable and drive Store.needsAttention()', async () => {
    await openSec('settings');
    const before = await store(`(S)=>S.needsAttention().length`);
    // cranking the health cutoff to 100 must flag every project (nothing scores >=100)
    await page.$eval('.attn-slider[data-attn="health"]', (s) => { s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const maxed = await store(`(S)=>S.needsAttention().length`);
    const totalProjects = await store(`(S)=>S.projects().length`);
    const savedHealthMax = await store(`(S)=>S.attentionThresholds().healthMax`);
    // and dropping it to 1 must flag none on health (a project would need to score 0)
    await page.$eval('.attn-slider[data-attn="health"]', (s) => { s.value = '1'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const minned = await store(`(S)=>S.needsAttention().filter(a=>a.reasons.some(r=>r.kind==='health')).length`);
    await page.click('.card:has-text("Needs attention") button:has-text("Reset to default")');
    await page.waitForTimeout(150);
    const restored = await store(`(S)=>({...S.attentionThresholds()})`);
    return maxed === totalProjects && savedHealthMax === 100 && minned === 0
      && restored.healthMax === 35 && restored.autoSyncFails === 2 && before === (await store(`(S)=>S.needsAttention().length`));
  });
  await check('welcome tour starts and can finish', async () => {
    await openSec('settings');
    await page.click('button:has-text("Start tour")'); await page.waitForTimeout(400);
    if (!(await $('.tour-pop'))) return false;
    // click through to the end
    for (let i = 0; i < 8; i++) {
      const done = await page.$('.tour-pop .btn.primary:has-text("Done")');
      if (done) { await done.click(); break; }
      const next = await page.$('.tour-pop .btn.primary:has-text("Next")');
      if (!next) break;
      await next.click(); await page.waitForTimeout(250);
    }
    await page.waitForTimeout(300);
    return !(await $('.tour-pop'));
  });

  // ---------- Custom fields (typed project-metadata schema) ----------
  console.log('Custom fields');
  await check('define a select-type custom field in Settings', async () => {
    await openSec('settings');
    await page.click('.card:has-text("Custom fields") button:has-text("Add field")'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Tier');
    await page.selectOption('.modal select.input', 'select'); await page.waitForTimeout(150);
    await page.fill('.modal input[placeholder="small, medium, large"]', 'Gold, Silver, Bronze');
    await page.click('.modal button:has-text("Add field")'); await page.waitForTimeout(300);
    return await store(`(S)=>S.fieldDefs().some(f=>f.label==='Tier' && f.type==='select')`);
  });
  await check('set the field on a project and see it rendered as a tag on the detail page', async () => {
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    await page.click('button:has-text("Edit")'); await page.waitForTimeout(300);
    await page.selectOption('.modal select[data-field="tier"]', 'Gold'); await page.waitForTimeout(150);
    await page.click('.modal button:has-text("Save changes")'); await page.waitForTimeout(400);
    return await page.$$eval('.card.health', (els) => els.some((e) => e.textContent.includes('Gold'))).catch(() => false);
  });
  await check('library filters the fleet by that custom field value', async () => {
    await openSec('projects');
    await page.selectOption('.toolbar select.field-filter', 'tier'); await page.waitForTimeout(200);
    await page.selectOption('.toolbar select.field-filter-value', 'Gold'); await page.waitForTimeout(250);
    const n = await count('.lib-table tbody tr');
    const onlyGames = await page.$eval('.lib-table tbody', (tb) => tb.textContent.includes('Games')).catch(() => false);
    await page.selectOption('.toolbar select.field-filter', ''); await page.waitForTimeout(200);
    return n === 1 && onlyGames;
  });
  await check('cleanup: remove the smoke custom field and its value', async () => {
    await store(`(S)=>{
      const f=S.fieldDefs().find(x=>x.label==='Tier'); if(f) S.removeFieldDef(f.id, {silent:true});
      const g=S.project('games');
      if(g && g.fields && g.fields.tier){ const nf={...g.fields}; delete nf.tier; S.put('projects', {...g, fields:nf}, {silent:true}); }
    }`);
    return !(await store(`(S)=>S.fieldDefs().some(f=>f.label==='Tier')`));
  });

  // ---------- Command palette ----------
  console.log('Command palette');
  await check('⌘K palette jumps to a project', async () => {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
    await page.waitForTimeout(250);
    if (!(await $('.cmdk.show'))) return false;
    await page.fill('.cmdk-in', 'Games'); await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    return /project\/games/.test(await page.evaluate(() => location.hash));
  });

  // ---------- Mobile ----------
  console.log('Mobile');
  await check('mobile: hamburger opens the rail drawer', async () => {
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(300);
    await page.evaluate(() => window.__rail && window.__rail.setOpen(false)); await page.waitForTimeout(250);
    await page.click('.topbar-menu'); await page.waitForTimeout(300);
    const open = await page.$eval('#rail', (r) => r.classList.contains('open'));
    await page.setViewportSize({ width: 1280, height: 900 });
    return open;
  });
  const noHorizOverflow = (sel) => page.$eval(sel, (e) => e.scrollWidth <= e.clientWidth + 1);
  // On mobile, opening a section auto-closes the rail drawer (app.js), so the
  // drawer must be re-opened before every nav click here or the next section's
  // rail-item is off-canvas and unclickable.
  const openSecMobile = async (s) => { await page.evaluate(() => window.__rail && window.__rail.setOpen(true)); await page.waitForTimeout(150); return openSec(s); };
  // Generalized: every rail section, at a narrow phone width, has no horizontal
  // overflow — a loop instead of the one-off project-detail/landing checks this
  // sweep found (see ROADMAP), so the next `.section-title`-shaped regression
  // anywhere in the app trips this instead of shipping unnoticed.
  await check('mobile: every rail section has no horizontal overflow (320px)', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    let allOk = true;
    for (const s of ['home', 'projects', 'activity', 'credentials', 'docs', 'settings']) {
      await openSecMobile(s);
      if (!(await noHorizOverflow('.view'))) { console.error(`  (overflow in section "${s}")`); allOk = false; }
    }
    await openSecMobile('home');
    const tile = await $('.tile'); await tile.click(); await page.waitForTimeout(400);
    if (!(await noHorizOverflow('.view'))) { console.error('  (overflow in project detail)'); allOk = false; }
    await page.setViewportSize({ width: 1280, height: 900 });
    return allOk;
  });
  await check('mobile (320px): notification popover stays within the viewport regardless of how many topbar buttons sit to its right', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await openSecMobile('home');
    await page.click('.notif-btn'); await page.waitForTimeout(350);
    const box = await page.$eval('.notif-pop', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 900 });
    return box.left >= 0 && box.right <= 320;
  });
  await check('mobile: landing page has no horizontal overflow (narrow phone)', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 30000 });
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    await page.goto(`${base}/app/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 900 });
    return ok;
  });

  // A narrow-phone content audit, prompted by three real bugs this sweep found:
  // rows built as `display:flex;align-items:center` around a text column that
  // can wrap to several lines squeeze the column so hard at 320px that its text
  // visually overflows (browsers paint overflow, they don't clip it by default)
  // right into the icon/action buttons, which sit vertically centered against
  // the *whole* tall row instead of beside the text's first line. A bounding-box
  // check on the text column's own flex box misses this — that box legitimately
  // shrinks to ~0 while its overflowing text still paints wherever it wants — so
  // this measures the actual painted text line rects (via Range.getClientRects)
  // against the actions box instead.
  const textOverlapsBox = (textEl, boxRect) => {
    if (!textEl || !boxRect) return false;
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const rects = [...range.getClientRects()];
    return rects.some((r) => r.left < boxRect.right - 1 && boxRect.left < r.right - 1 && r.top < boxRect.bottom - 1 && boxRect.top < r.bottom - 1);
  };
  await check('mobile (320px): custom-field row keeps its edit/remove buttons out of the middle of a long wrapped label (top-aligned or wrapped below, never centered mid-column)', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await store(`(S)=>S.addFieldDef({label:'Priority Tier Level', type:'select', options:['Gold Standard','Silver Standard','Bronze Standard']})`);
    await openSecMobile('settings');
    const { midTop, midBottom, midH, actionsTop, actionsBottom } = await page.evaluate(() => {
      const mid = document.querySelector('.field-row-mid').getBoundingClientRect();
      const actions = document.querySelector('.field-row-actions').getBoundingClientRect();
      return { midTop: mid.top, midBottom: mid.bottom, midH: mid.height, actionsTop: actions.top, actionsBottom: actions.bottom };
    });
    await store(`(S)=>{const f=S.fieldDefs().find(x=>x.label==='Priority Tier Level'); if(f) S.removeFieldDef(f.id, {silent:true});}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    // only meaningful if the label really did wrap to multiple lines — a single
    // line looks identical whether centered or top-aligned
    const reallyWrapped = midH > 40;
    // the bug: actions strictly nested inside the label's vertical span (neither
    // touching its top nor its bottom) — i.e. floating mid-column. Landing on the
    // same line (top-aligned) or wrapping to their own line below are both fine.
    const floatingMidColumn = actionsTop > midTop + 4 && actionsBottom < midBottom - 4;
    return reallyWrapped && !floatingMidColumn;
  });
  await check('mobile (320px): "Sync all" modal keeps project names legible instead of squeezing them behind the status chip', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await openSecMobile('home');
    await page.click('.qa:has-text("Sync all")'); await page.waitForTimeout(500);
    // "Manager" paired with a long status ("10 New, 1 Updated") used to claim
    // almost the whole row width, squeezing the name into an illegible fragment
    const nameWidth = await page.$$eval('.sync-all-row', (rows) => {
      const row = rows.find((r) => /Manager/.test(r.textContent));
      return row ? row.querySelector('.name').getBoundingClientRect().width : 0;
    });
    await page.click('.modal button:has-text("Close")').catch(() => {});
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1280, height: 900 });
    return nameWidth > 60;
  });
  await check('mobile (320px): admin invite row keeps a long created/expiry line from overlapping Copy/Revoke', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await page.evaluate(() => { try { localStorage.setItem('manager.adminkey', 'smoke-test-fake-not-a-real-key'); } catch {} });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
    await page.evaluate(() => { try { localStorage.setItem('manager.invites', JSON.stringify([
      { label: 'Design partner walkthrough', iat: Date.now() - 60000, exp: 0, jti: 'abc12345', code: 'x.y', link: 'https://example.com/x' },
    ])); } catch {} });
    await page.evaluate(() => { location.hash = 'admin'; }); await page.waitForTimeout(400);
    const overlap = await page.evaluate(`(${textOverlapsBox})(document.querySelector('.invite-row > div:first-child'), document.querySelector('.invite-row .invite-actions')?.getBoundingClientRect())`);
    await page.evaluate(() => { try { localStorage.removeItem('manager.adminkey'); localStorage.removeItem('manager.invites'); localStorage.removeItem('manager.access'); } catch {} });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    return !overlap;
  });

  // Three more `align-items:center`-around-a-wrapping-text-column bugs found by
  // hand this sweep (see ROADMAP: a real audit of every such row is still
  // queued) — each verified to actually fail against the pre-fix CSS first.
  await check('mobile (320px): credential row with a long unbroken env-var key stays inside the viewport with Reveal/Copy/Edit still reachable', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await store(`(S)=>S.addCredential({name:'Smoke Test Long Key Credential', key:'SOME_REALLY_LONG_UNBROKEN_ENV_VARIABLE_NAME', value:'x', scope:'global'})`);
    await openSecMobile('credentials');
    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.cred-row')].find((r) => r.textContent.includes('Smoke Test Long Key Credential'));
      if (!row) return null;
      const right = row.getBoundingClientRect().right;
      const btns = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      return { right, btnsVisible: btns.length === 3 && btns.every((b) => b.right <= 320 && b.left >= 0) };
    });
    await store(`(S)=>{const c=S.credentials('global').find(x=>x.name==='Smoke Test Long Key Credential'); if(c) S.remove('credentials', c.id, {silent:true});}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    return !!info && info.right <= 320 && info.btnsVisible;
  });
  await check('mobile (320px): Settings toggle switch stays aligned with its title instead of floating mid-paragraph when the description wraps', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await openSecMobile('settings');
    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.opt-row')].find((r) => r.querySelector('b')?.textContent === 'Simple mode');
      if (!row) return null;
      const b = row.querySelector('b').getBoundingClientRect();
      const toggle = row.querySelector('.toggle').getBoundingClientRect();
      const p = row.querySelector('p')?.getBoundingClientRect();
      return { aligned: Math.abs(b.top - toggle.top) < 2, wrapped: (p?.height || 0) > 24 };
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    return !!info && info.wrapped && info.aligned;
  });
  await check('mobile (320px): Run log icon stays aligned with the top of a long wrapped run note instead of floating mid-column', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await store(`(S)=>S.logRun({mode:'feature', note:'This is a deliberately long run note used to force the run-row text column to wrap across several lines for this smoke check', projectId:''})`);
    await openSecMobile('activity');
    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.run-row')].find((r) => r.textContent.includes('deliberately long run note'));
      if (!row) return null;
      const sp = row.querySelector('.sp').getBoundingClientRect();
      const ric = row.querySelector('.ric').getBoundingClientRect();
      return { aligned: Math.abs(sp.top - ric.top) < 2, wrapped: sp.height > 50 };
    });
    await store(`(S)=>{const r=S.all('runs').find(x=>(x.note||'').includes('deliberately long run note')); if(r) S.remove('runs', r.id, {silent:true});}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    return !!info && info.wrapped && info.aligned;
  });

  if (errors.length) { console.error('\nConsole/page errors:\n' + errors.join('\n')); failed = true; }
} catch (e) {
  console.error('SUITE CRASH: ' + e.message); failed = true;
} finally {
  await browser.close();
  server.close();
}

if (failed) { console.error('\nSMOKE FAILED — not publishing.'); process.exit(1); }
console.log('\nSMOKE OK — all functional checks passed.');
