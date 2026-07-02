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

  // ---------- Projects library ----------
  console.log('Projects library');
  await openSec('projects');
  await check('library renders a table of projects', async () => (await count('.lib-table tbody tr')) >= 5);
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
    // kind filter chip
    await page.click('.sheet-tools .filter-chip:has-text("Polish")'); await page.waitForTimeout(200);
    const filtered = (await count('.wn-entry')) === 0;   // v1 is a feature, so Polish shows none
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

  if (errors.length) { console.error('\nConsole/page errors:\n' + errors.join('\n')); failed = true; }
} catch (e) {
  console.error('SUITE CRASH: ' + e.message); failed = true;
} finally {
  await browser.close();
  server.close();
}

if (failed) { console.error('\nSMOKE FAILED — not publishing.'); process.exit(1); }
console.log('\nSMOKE OK — all functional checks passed.');
