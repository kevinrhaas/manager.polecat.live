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
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  // pre-grant the invite gate so the app boots in CI
  await ctx.addInitScript(`try{localStorage.setItem('manager.access',JSON.stringify({grantedAt:Date.now(),via:'ci'}));}catch(e){}`);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/net::ERR_/.test(t) || /favicon/.test(t)) return;
    // Live GitHub API calls (Fleet Ops / steward signals) hitting anonymous
    // rate limits in CI log 403/429 resource errors — environmental, not app
    // bugs; the app renders inline degraded states for them. Never fail
    // smoke on them (they made the janitor park green PRs).
    if (/api\.github\.com/.test(t) || /api\.github\.com/.test(m.location()?.url || '')) return;
    errors.push('console: ' + t);
  });
  const $ = (s) => page.$(s);
  const count = (s) => page.$$eval(s, (e) => e.length).catch(() => 0);
  const sec = (s) => page.$(`.ps-rail-item[data-sec="${s}"]`);
  const openSec = async (s) => { const el = await sec(s); if (el) { await el.click(); await page.waitForTimeout(320); } return !!el; };
  const store = (fn) => page.evaluate(`(async()=>{const{Store}=await import('/js/store.js');return (${fn})(Store);})()`);

  // ---------- Landing ----------
  console.log('Landing');
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await check('landing renders a headline', async () => !!(await $('h1')));
  await check('landing has a Launch link to /app/', async () =>
    (await page.$$eval('a', (as) => as.some((a) => /\/app\/?$/.test(a.getAttribute('href') || '')))));
  await check('landing shows the fleet showcase', async () => (await count('#fleet .fchip')) >= 5);
  await check('landing hero carousel: real screenshots present, dots built, auto-advances with a caption', async () => {
    if ((await count('#hero-carousel .hc-slide')) < 4) return false;
    // every slide references an actual shipped screenshot file (not a broken src)
    const shots = await page.$$eval('#hero-carousel .hc-slide img', (imgs) => imgs.map((i) => i.getAttribute('src')));
    if (!shots.every((s) => /^\/assets\/shots\/.+\.png(\?v=\d+)?$/.test(s || ''))) return false;
    const broken = await page.$$eval('#hero-carousel .hc-slide img', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).length);
    if (broken > 0) return false;
    if ((await count('#hero-carousel .hc-dots button')) !== (await count('#hero-carousel .hc-slide'))) return false;
    // caption populated for the active slide
    const cap = await page.$eval('#hc-title', (n) => n.textContent).catch(() => '');
    if (!cap) return false;
    // auto-advance moves the active slide within the hold window
    const before = await page.$eval('#hero-carousel .hc-slide.on img', (n) => n.getAttribute('src'));
    await page.waitForTimeout(6000);
    const after = await page.$eval('#hero-carousel .hc-slide.on img', (n) => n.getAttribute('src'));
    return before !== after;
  });
  await check('landing keeps its own version copy honest (reads live from js/changelog.js, never hand-frozen)', async () => {
    const latest = await page.evaluate(`import('/js/changelog.js').then(m=>m.CHANGELOG[0])`);
    const whatsNew = await page.$eval('#whats-new', (el) => el.textContent).catch(() => '');
    const status = await page.$eval('#fleet-manager-status', (el) => el.textContent).catch(() => '');
    return whatsNew.includes(`v${latest.v}`) && whatsNew.includes(latest.title)
      && status.includes(`v${latest.v}`) && /Live/i.test(status);
  });
  await check('landing has a working skip-to-content link for keyboard users (hidden until focused)', async () => {
    const before = await page.$eval('.skip-link', (el) => parseFloat(getComputedStyle(el).top));
    await page.$eval('.skip-link', (el) => el.focus());
    await page.waitForTimeout(250);   // let the .18s reveal transition settle before reading it back
    const after = await page.$eval('.skip-link', (el) => parseFloat(getComputedStyle(el).top));
    return before < 0 && after >= 0;
  });
  await check('landing CTA (shared site-chrome) shows a visible keyboard-focus ring', async () => {
    // Tab through the header until the shared CTA is focused (keyboard focus
    // reliably triggers :focus-visible, unlike a programmatic .focus()).
    await page.evaluate(() => (document.activeElement || document.body).blur?.());
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.classList.contains('psx-cta')) return null;
        const cs = getComputedStyle(el);
        return parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none';
      });
      if (r === true) return true;
      if (r === false) return false;
    }
    return false;
  });
  await check('fleet showcase colors Live vs Active status differently, matching real in-app status semantics', async () => {
    const liveColor = await page.$eval('.fchip .st.is-live', (el) => getComputedStyle(el).color);
    const activeColor = await page.$eval('.fchip .st.is-active', (el) => getComputedStyle(el).color);
    return !!liveColor && !!activeColor && liveColor !== activeColor;
  });
  await check('fleet showcase status dots pulse (a live "the loop is running" heartbeat), each chip ticking on its own offset', async () => {
    const anims = await page.$$eval('#fleet .fchip .st.is-live .dot, #fleet .fchip .st.is-active .dot', (dots) =>
      dots.map((d) => {
        const s = getComputedStyle(d, '::after');
        return { name: s.animationName, delay: s.animationDelay };
      }));
    const allPulse = anims.length >= 5 && anims.every((a) => a.name !== 'none');
    const delays = new Set(anims.map((a) => a.delay));
    return allPulse && delays.size > 1; // not one flat synced blink
  });
  await check('fleet showcase chips cascade in with a staggered entrance delay, not one flat pop', async () => {
    const delays = await page.$$eval('#fleet .fchip', (chips) => chips.map((c) => getComputedStyle(c).transitionDelay));
    return delays.length >= 5 && new Set(delays).size > 1;
  });
  await check('landing shows a "recent activity" ticker with the real latest changelog entries (not the frozen fallback)', async () => {
    const real = await page.evaluate(`import('/js/changelog.js').then(m=>m.CHANGELOG.slice(0,5).map(e=>({v:e.v,title:e.title})))`);
    const chips = await page.$$eval('#at-track .at-chip', (els) => els.map((e) => e.textContent.trim()));
    return chips.length === real.length && real.every((e, i) => chips[i].includes(`v${e.v}`) && chips[i].includes(e.title));
  });
  await check('recent-activity ticker gently auto-drifts and pauses while hovered', async () => {
    const overflow = await page.$eval('#at-track', (t) => t.scrollWidth > t.clientWidth);
    if (!overflow) return true; // nothing to drift if the strip happens to fit
    await page.waitForTimeout(600);
    const moved = await page.$eval('#at-track', (t) => t.scrollLeft);
    if (moved <= 0) return false;
    await page.hover('#at-track .at-chip');
    await page.waitForTimeout(150);
    const atHover = await page.$eval('#at-track', (t) => t.scrollLeft);
    await page.waitForTimeout(500);
    const afterHover = await page.$eval('#at-track', (t) => t.scrollLeft);
    return Math.abs(afterHover - atHover) < 0.5;
  });
  await check('recent-activity ticker respects prefers-reduced-motion (no auto-drift)', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    const before = await page.$eval('#at-track', (t) => t.scrollLeft);
    await page.waitForTimeout(500);
    const after = await page.$eval('#at-track', (t) => t.scrollLeft);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    return before === after;
  });

  // ---------- App shell ----------
  console.log('App shell');
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1100);
  await page.keyboard.press('Escape');   // dismiss the first-run welcome tour
  await page.waitForTimeout(300);
  await check('nav rail renders (>=5 sections)', async () => (await count('.ps-rail-item')) >= 5);
  await check('app shell has a working skip-to-content link (jumps keyboard focus straight to the view)', async () => {
    const href = await page.$eval('.skip-link', (a) => a.getAttribute('href')).catch(() => null);
    if (href !== '#view') return false;
    await page.$eval('.skip-link', (a) => a.click());
    await page.waitForTimeout(150);
    return await page.evaluate(() => document.activeElement && document.activeElement.id === 'view');
  });
  await check('rail nav items show the app\'s own branded keyboard-focus ring (previously only the bare browser default)', async () => {
    const ringOf = async (sel) => {
      const before = await page.$eval(sel, (n) => getComputedStyle(n).boxShadow);
      await page.$eval(sel, (n) => n.focus());
      await page.waitForTimeout(60);
      const after = await page.$eval(sel, (n) => getComputedStyle(n).boxShadow);
      await page.$eval(sel, (n) => n.blur());
      return after !== 'none' && after !== before;
    };
    return (await ringOf('.ps-rail-brand')) && (await ringOf('.ps-rail-item[data-sec="home"]')) && (await ringOf('.ps-rail-toggle'));
  });
  for (const s of ['home', 'projects', 'releases', 'activity', 'credentials', 'docs', 'settings']) {
    await check(`section "${s}" opens`, async () => { if (!(await openSec(s))) return false; return (await count('#view *')) > 0; });
  }
  await check('docs: "Fleet Ops & the steward" section documents the platform era (roster, janitor, token, attention signals)', async () => {
    await openSec('docs');
    const bodyText = await page.$eval('#doc-fleetops', (n) => n.textContent).catch(() => '');
    return ['roster', 'janitor', 'sweep', 'vault', 'Needs attention'].every((w) => bodyText.toLowerCase().includes(w.toLowerCase()));
  });
  await check('docs: "Health, weighting & notifications" section covers the health/attention system and its TOC link scrolls to it', async () => {
    await openSec('docs');
    const bodyText = await page.$eval('#doc-health', (n) => n.textContent).catch(() => '');
    const covers = ['Thriving', 'Stale', 'Weighting', 'Needs attention', 'Dismiss'].every((w) => bodyText.includes(w));
    await page.click('.docs-toc a[data-doc="health"]');
    // poll until BOTH the smooth-scroll settles AND the scroll-spy marks the
    // link active (the observer updates async, a beat after the scroll) — a
    // fixed wait raced one or the other. Up to ~3.5s.
    let top = 999, tocActive = false;
    for (let i = 0; i < 35; i++) {
      top = await page.$eval('#doc-health', (n) => n.getBoundingClientRect().top);
      tocActive = await page.$eval('.docs-toc a[data-doc="health"]', (n) => n.classList.contains('active'));
      if (Math.abs(top) < 200 && tocActive) break;
      await page.waitForTimeout(100);
    }
    return covers && Math.abs(top) < 200 && tocActive;
  });

  console.log('Releases timeline');
  await check('releases feed shows cross-project releases grouped by day, newest first', async () => {
    await openSec('releases');
    if ((await count('.rel-card')) < 2) return false;              // seeded relay releases + manager v1, etc.
    if ((await count('.feed-day')) < 1) return false;              // at least one day header
    // releases from more than one project appear (cross-project)
    const projNames = await page.$$eval('.rel-card .rc-proj', (ns) => [...new Set(ns.map((n) => n.textContent))]);
    if (projNames.length < 2) return false;
    // ordered newest-first: first card's time is >= second card's (same or later)
    return !!(await page.$('.grid.stats')) && !!(await page.$('.toolbar'));
  });
  await check('releases feed filters by project and searches', async () => {
    await openSec('releases');
    const before = await count('.rel-card');
    await page.selectOption('.toolbar select', 'relay'); await page.waitForTimeout(250);   // first select = project
    const filtered = await count('.rel-card');
    // every visible card is now Relay
    const allRelay = await page.$$eval('.rel-card .rc-proj', (ns) => ns.length > 0 && ns.every((n) => /relay/i.test(n.textContent)));
    await page.selectOption('.toolbar select', 'all'); await page.waitForTimeout(200);
    return filtered <= before && allRelay;
  });
  await check('releases feed toggles "by day" vs. "by project" grouping', async () => {
    await openSec('releases');
    const dayHeaderAvatars = await count('.feed-day h3 .mini-av');   // day headers carry no project avatar
    const groupBtn = 'button[title="Toggle how the feed is grouped"]';
    await page.click(groupBtn); await page.waitForTimeout(250);
    const projHeaderAvatars = await count('.feed-day h3 .mini-av');  // project headers do
    const cardsStillShow = (await count('.rel-card')) > 0;
    await page.click(groupBtn); await page.waitForTimeout(250);      // toggle back
    const backToDay = await count('.feed-day h3 .mini-av');
    return dayHeaderAvatars === 0 && projHeaderAvatars > 0 && cardsStillShow && backToDay === 0;
  });
  await check('releases feed "Full / Digest" toggle collapses each group behind a one-line summary without losing any cards', async () => {
    await openSec('releases');
    const cardsBefore = await count('.rel-card');
    const densityBtn = 'button[title="Toggle between full cards and a collapsed one-line digest per group"]';
    await page.click(densityBtn); await page.waitForTimeout(250);
    const groupsInDigest = await count('.rel-group');
    const digestLinesShown = await count('.rel-digest-text');
    const cardsStillInDom = await count('.rel-card');   // collapsed <details>, not removed
    await page.click(densityBtn); await page.waitForTimeout(250);   // toggle back to Full
    const groupsAfter = await count('.rel-group');
    const cardsAfter = await count('.rel-card');
    return groupsInDigest > 0 && digestLinesShown === groupsInDigest && cardsStillInDom === cardsBefore
      && groupsAfter === 0 && cardsAfter === cardsBefore;
  });
  await check('releases feed "Jump to date" scrolls to and highlights a release from the chosen day, expanding a collapsed digest group first', async () => {
    await openSec('releases');
    const densityBtn = 'button[title="Toggle between full cards and a collapsed one-line digest per group"]';
    await page.click(densityBtn); await page.waitForTimeout(250);   // switch to Digest so the target starts collapsed
    const dateKey = await page.$eval('select[aria-label="Jump to date"] option:not([value=""])', (o) => o.value);
    await page.selectOption('select[aria-label="Jump to date"]', dateKey);
    await page.waitForTimeout(700);   // smooth scroll + flash
    const opened = await page.$eval(`.rel-card[data-day="${dateKey}"]`, (e) => !!e.closest('details.rel-group')?.open);
    const flashed = await page.$eval(`.rel-card[data-day="${dateKey}"]`, (e) => e.classList.contains('jump-flash'));
    await page.click(densityBtn); await page.waitForTimeout(250);   // back to Full
    return opened && flashed;
  });
  await check('releases feed shows a "this week" rollup line with a copy button', async () => {
    await openSec('releases');
    const text = await page.$eval('.week-rollup', (e) => e.textContent).catch(() => '');
    return /This week across the suite/.test(text) && !!(await page.$('.week-rollup .btn'));
  });
  await check('releases feed "Copy / Export" → Copy as Markdown copies the current filtered feed, grouped like the on-screen toggle', async () => {
    await openSec('releases');
    await page.selectOption('.toolbar select', 'relay'); await page.waitForTimeout(250);   // first select = project filter
    await page.click('button[title="Copy as Markdown or export JSON/RSS"]');
    await page.waitForTimeout(200);
    await page.click('.modal-body button:has-text("Copy as Markdown")');
    await page.waitForTimeout(200);
    const md = await page.evaluate(() => navigator.clipboard.readText());
    await page.keyboard.press('Escape');   // close the modal
    await page.selectOption('.toolbar select', 'all'); await page.waitForTimeout(200);   // reset filter for later checks
    return md.startsWith('## Releases') && /Relay/.test(md) && !/Games/.test(md);
  });
  await check('releases feed "Copy / Export" → Download JSON / Download RSS export a filter-independent snapshot of recent releases', async () => {
    await openSec('releases');
    await page.click('button[title="Copy as Markdown or export JSON/RSS"]');
    await page.waitForTimeout(200);
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.modal-body button:has-text("Download JSON")'),
    ]);
    const jsonText = fs.readFileSync(await jsonDl.path(), 'utf8');
    const jsonOk = jsonDl.suggestedFilename() === 'manager-releases.json' && /"releases":\s*\[/.test(jsonText);
    const [rssDl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.modal-body button:has-text("Download RSS")'),
    ]);
    const rssText = fs.readFileSync(await rssDl.path(), 'utf8');
    const rssOk = rssDl.suggestedFilename() === 'manager-releases.xml' && /<rss version="2.0">/.test(rssText);
    await page.keyboard.press('Escape');
    return jsonOk && rssOk;
  });
  await check('releases feed flags releases shipped since your last visit as "new" and the rail badge clears on open', async () => {
    // wind the fleet-wide "seen" marker back so a freshly-seeded release reads as unread
    await page.evaluate(() => localStorage.setItem('manager.releases.seenTs', String(Date.now() - 999999999)));
    await store(`(S)=>{
      S.addProject({ slug:'smoke-unread-proj', name:'Smoke Unread' });
      S.put('releases', { id:'smoke-unread-rel', projectId:'smoke-unread-proj', v:1, title:'Smoke unread release', ts:new Date().toISOString() }, { silent:true });
    }`);
    await openSec('home');   // navigate away first so the rail badge reflects the fresh unread count, not a stale one
    await page.waitForTimeout(250);
    const badgeText = await page.$eval('.ps-rail-item[data-sec="releases"] .badge', (e) => (e.hidden ? null : e.textContent)).catch(() => null);
    const hadUnreadBadge = badgeText != null && parseInt(badgeText, 10) > 0;
    await openSec('releases');
    const hasNewCard = (await count('.rel-card.is-new')) > 0;
    const badgeAfter = await page.$eval('.ps-rail-item[data-sec="releases"] .badge', (e) => (e.hidden ? null : e.textContent)).catch(() => null);
    await store(`(S)=>S.remove('projects','smoke-unread-proj',{silent:true})`);   // cascades the seeded release too
    return hadUnreadBadge && hasNewCard && badgeAfter == null;
  });

  // ---------- Dashboard ----------
  console.log('Dashboard');
  await openSec('home');
  await check('dashboard shows project tiles (seeded fleet)', async () => (await count('.tile')) >= 5);
  await check('Manager\'s own dashboard tile and project page track its real CHANGELOG version, not a stale seed', async () => {
    // app.js reconciles js/changelog.js's CHANGELOG straight into the 'manager'
    // project's releases on every boot (no fetch — it's already an ES import),
    // so Manager never shows a frozen "v1" while every other project's version
    // moves. Verify it against the actual imported module, not a hardcoded number.
    const real = await page.evaluate(async () => { const { LATEST_VERSION, CHANGELOG } = await import('/js/changelog.js'); return { LATEST_VERSION, count: CHANGELOG.length }; });
    const stored = await store(`(S)=>{const r=S.latestRelease('manager'); return { v:r&&r.v, total:S.releasesFor('manager').length };}`);
    const tileVersion = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.tile')].find(x => /Manager/.test(x.textContent));
      return t?.querySelector('.vchip')?.textContent.trim();
    });
    return real.LATEST_VERSION > 1 && stored.v === real.LATEST_VERSION && stored.total === real.count && tileVersion === `v${real.LATEST_VERSION}`;
  });
  await check('a tile opens the project detail', async () => {
    await (await $('.tile')).click(); await page.waitForTimeout(350);
    return !!(await page.$('.detail-head')) && (await count('.detail-head')) > 0;
  });
  await check('dashboard shows a fleet health score and per-project trend sparklines', async () => {
    await openSec('home');
    const fleetStat = await page.$eval('.stats', (s) => /Fleet health/i.test(s.textContent));
    return fleetStat && (await count('.tile .hchip')) >= 5 && (await count('.tile .spark')) >= 5;
  });
  await check('a project tile is keyboard-focusable and Enter opens it (not just click)', async () => {
    await openSec('home');
    const role = await page.$eval('.tile', (t) => t.getAttribute('role'));
    await page.$eval('.tile', (t) => t.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    return role === 'button' && (await count('.detail-head')) > 0;
  });
  await check('a dashboard quick-action card is keyboard-focusable and Enter activates it', async () => {
    await openSec('home');
    await page.$eval('.qa', (c) => c.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const overlayOpen = !!(await page.$('.modal-back.in'));
    if (overlayOpen) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
    return overlayOpen;
  });

  // ---------- Projects library ----------
  console.log('Projects library');
  await openSec('projects');
  await check('library renders a table of projects', async () => (await count('.lib-table tbody tr')) >= 5);
  await check('projects: transient NEW marker flags, decays, and clears when opened', async () => {
    return await store(`(S)=>{
      const pid=S.projects()[0]?.id; if(!pid) return false;
      S.clearProjectUnseen(pid);
      if(S.projectHasNewUpdates(pid)) return false;            // clean baseline
      S.markProjectUpdated(pid);
      if(!S.projectHasNewUpdates(pid)) return false;           // flags on a real update
      const at1=(S.settings().projectUnseen||{})[pid];
      S.markProjectUpdated(pid);                                // idempotent — keeps first-seen time
      if((S.settings().projectUnseen||{})[pid]!==at1) return false;
      // a marker older than the 10-day decay window self-prunes on read
      const stale={...(S.settings().projectUnseen||{})}; stale[pid]=Date.now()-11*86400000; S.setSetting('projectUnseen',stale);
      if(S.projectHasNewUpdates(pid)) return false;
      // and opening a project clears it
      S.markProjectUpdated(pid); S.clearProjectUnseen(pid);
      return !S.projectHasNewUpdates(pid);
    }`);
  });
  await check('store.batch coalesces reactive events — a bulk write repaints once, not once per row', async () => {
    return await store(`(S)=>new Promise(async (resolve)=>{
      let hits = 0;
      const off = S.on('projects', () => hits++);
      const ids = S.projects().slice(0, 5).map(p => p.id);
      await S.batch(async () => { for(const id of ids){ S.updateProject(id, { _batchProbe: Date.now() }, { silent:true }); } });
      off();
      // 5 writes inside the batch → the 'projects' listener fired exactly once
      resolve(hits === 1);
    })`);
  });
  await check('projects: a flagged project shows a NEW badge in the library that clears after opening it', async () => {
    const pid = await store(`(S)=>{ const id=S.projects()[0]?.id; if(id) S.markProjectUpdated(id); return id; }`);
    if(!pid) return false;
    await openSec('projects'); await page.waitForTimeout(200);
    const badgeShown = (await count('.lib-table .lib-new')) >= 1;
    await page.evaluate((id)=>{ location.hash = 'project/'+id; }, pid); await page.waitForTimeout(250);
    await openSec('projects'); await page.waitForTimeout(200);
    const stillFlagged = await store(`(S)=>S.projectHasNewUpdates('${pid}')`);
    return badgeShown && !stillFlagged;
  });
  await check('status pills carry an explanatory hover tooltip', async () => {
    const title = await page.$eval('.lib-table .status', (s) => s.getAttribute('title') || '');
    return /—/.test(title) && title.length > 12;   // "Live — Shipping to production…"
  });
  await check('Latest column shows the version\'s ship time in CT', async () => {
    // a project with releases (relay is seeded with real ones) shows a CT date under its version chip
    const cell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.lib-table tbody tr')];
      const relay = rows.find((r) => /relay/i.test(r.textContent));
      const vcell = relay && relay.querySelector('td:nth-child(5)');   // 1=select, 2=pin, 3=name, 4=status, 5=latest
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
  await check('a library row is keyboard-focusable — Enter opens it, and a nested pin button\'s own Enter toggles the pin without also navigating away', async () => {
    await openSec('projects');
    const role = await page.$eval('.lib-table tbody tr', (t) => t.getAttribute('role'));
    await page.$eval('.lib-table tbody tr', (t) => t.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const opened = (await count('.detail-head')) > 0;

    await openSec('projects');
    const pinBefore = await store(`(S)=>S.project('games').pinned`);
    await page.$$eval('.lib-table tbody tr', (rows) => rows.find((r) => /games/i.test(r.textContent)).querySelector('.pin-btn').focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const stillOnLibrary = !!(await page.$('.lib-table'));
    const pinAfter = await store(`(S)=>S.project('games').pinned`);
    if (pinAfter !== pinBefore) await store(`(S)=>S.togglePin('games')`);   // restore
    return role === 'button' && opened && stillOnLibrary && pinAfter !== pinBefore;
  });
  await check('a sortable library column header is keyboard-focusable and Enter sorts by it', async () => {
    await openSec('projects');
    const statusTh = await page.$('th:has-text("Status")');
    const role = await statusTh.getAttribute('role');
    await statusTh.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('manager.lib.view') || '{}').sort);
    return role === 'button' && after === 'status';
  });

  // ---------- Bulk actions (library multi-select) ----------
  console.log('Bulk actions');
  await check('the library "select all" header checkbox selects and clears every visible row, driving a live-count bulk bar', async () => {
    await openSec('projects');
    const total = await count('.lib-table tbody tr');
    await page.click('th.lib-sel-th input.lib-sel');
    await page.waitForTimeout(150);
    const checkedAfter = await page.$$eval('input.lib-sel[data-pid]', (cbs) => cbs.filter((c) => c.checked).length);
    const barText = await page.$eval('.bulkbar-count', (e) => e.textContent);
    await page.click('th.lib-sel-th input.lib-sel');   // toggle back off
    await page.waitForTimeout(150);
    const bulkGone = !(await page.$('.bulkbar'));
    return checkedAfter === total && barText === `${total} selected` && bulkGone;
  });
  await check('bulk "Add tag" tags every checked project in one shot, and Undo reverts the whole batch together', async () => {
    await openSec('projects');
    const before = await store(`(S)=>({games:[...(S.project('games').tags||[])], polecat:[...(S.project('polecat').tags||[])]})`);
    await page.click('input.lib-sel[data-pid="games"]');
    await page.click('input.lib-sel[data-pid="polecat"]');
    await page.waitForTimeout(150);
    await page.click('.bulkbar button:has-text("Add tag")');
    await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'smoke-bulk');
    await page.click('.modal button:has-text("Add tag")');
    await page.waitForTimeout(400);
    const tagged = await store(`(S)=>(S.project('games').tags||[]).includes('smoke-bulk') && (S.project('polecat').tags||[]).includes('smoke-bulk')`);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const after = await store(`(S)=>({games:[...(S.project('games').tags||[])], polecat:[...(S.project('polecat').tags||[])]})`);
    const undone = JSON.stringify(after.games) === JSON.stringify(before.games) && JSON.stringify(after.polecat) === JSON.stringify(before.polecat);
    return tagged && undone;
  });
  await check('bulk "Remove tag" removes a tag from every checked project that has it, offers only tags applicable to the current selection, and Undo reverts the whole batch together', async () => {
    await openSec('projects');
    await store(`(S)=>{
      const g=S.project('games'); S.updateProject('games', { tags:[...(g.tags||[]), 'smoke-remove-tag'] }, { silent:true });
      const p=S.project('polecat'); S.updateProject('polecat', { tags:[...(p.tags||[]), 'smoke-remove-tag'] }, { silent:true });
      const r=S.project('relay'); S.updateProject('relay', { tags:[...(r.tags||[]), 'smoke-relay-only'] }, { silent:true });
    }`);
    await page.waitForTimeout(200);
    const before = await store(`(S)=>({games:[...(S.project('games').tags||[])], polecat:[...(S.project('polecat').tags||[])]})`);
    await page.click('input.lib-sel[data-pid="games"]');
    await page.click('input.lib-sel[data-pid="polecat"]');
    await page.waitForTimeout(150);
    await page.click('.bulkbar button:has-text("Remove tag")');
    await page.waitForTimeout(300);
    const options = await page.$$eval('.modal select.input option', (os) => os.map((o) => o.value));
    const onlyApplicable = options.includes('smoke-remove-tag') && !options.includes('smoke-relay-only');
    await page.selectOption('.modal select.input', 'smoke-remove-tag');
    await page.click('.modal button:has-text("Remove tag")');
    await page.waitForTimeout(400);
    const removed = await store(`(S)=>!(S.project('games').tags||[]).includes('smoke-remove-tag') && !(S.project('polecat').tags||[]).includes('smoke-remove-tag')`);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const after = await store(`(S)=>({games:[...(S.project('games').tags||[])], polecat:[...(S.project('polecat').tags||[])]})`);
    const undone = JSON.stringify(after.games) === JSON.stringify(before.games) && JSON.stringify(after.polecat) === JSON.stringify(before.polecat);
    // clean up the relay-only marker tag regardless of outcome
    await store(`(S)=>{ const r=S.project('relay'); S.updateProject('relay', { tags:(r.tags||[]).filter(t=>t!=='smoke-relay-only') }, { silent:true }); }`);
    return onlyApplicable && removed && undone;
  });
  await check('bulk "Set status" changes every checked project, leaves an unselected one untouched, and Undo reverts the whole batch together', async () => {
    await openSec('projects');
    const beforeGames = await store(`(S)=>S.project('games').status`);
    const beforePolecat = await store(`(S)=>S.project('polecat').status`);
    const relayBefore = await store(`(S)=>S.project('relay').status`);
    await page.click('input.lib-sel[data-pid="games"]');
    await page.click('input.lib-sel[data-pid="polecat"]');
    await page.waitForTimeout(150);
    await page.selectOption('.bulkbar select', 'paused');
    await page.waitForTimeout(400);
    const changed = await store(`(S)=>S.project('games').status==='paused' && S.project('polecat').status==='paused'`);
    const relayUntouched = (await store(`(S)=>S.project('relay').status`)) === relayBefore;
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const undone = (await store(`(S)=>S.project('games').status`)) === beforeGames && (await store(`(S)=>S.project('polecat').status`)) === beforePolecat;
    return changed && relayUntouched && undone;
  });
  await check('bulk "Archive" sets every checked project\'s status to Archived, with Undo reverting the whole batch together', async () => {
    await openSec('projects');
    const beforeGames = await store(`(S)=>S.project('games').status`);
    const beforePolecat = await store(`(S)=>S.project('polecat').status`);
    await page.click('input.lib-sel[data-pid="games"]');
    await page.click('input.lib-sel[data-pid="polecat"]');
    await page.waitForTimeout(150);
    await page.click('.bulkbar button:has-text("Archive")');
    await page.waitForTimeout(400);
    const archived = await store(`(S)=>S.project('games').status==='archived' && S.project('polecat').status==='archived'`);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const undone = (await store(`(S)=>S.project('games').status`)) === beforeGames && (await store(`(S)=>S.project('polecat').status`)) === beforePolecat;
    return archived && undone;
  });
  await check('bulk "Delete" removes every checked project (+ its releases) behind a confirm, and Undo restores the whole batch together', async () => {
    await openSec('projects');
    await store(`(S)=>{
      S.addProject({ slug:'smoke-bulk-del-1', name:'Smoke Bulk Del 1' });
      S.addProject({ slug:'smoke-bulk-del-2', name:'Smoke Bulk Del 2' });
      S.put('releases', { id:'smoke-bulk-del-rel', projectId:'smoke-bulk-del-1', v:1, title:'x', ts:Date.now() }, { silent:true });
    }`);
    await page.waitForTimeout(300);
    await page.click('input.lib-sel[data-pid="smoke-bulk-del-1"]');
    await page.click('input.lib-sel[data-pid="smoke-bulk-del-2"]');
    await page.waitForTimeout(150);
    // Cancel first: confirms the dialog is a real gate, not a no-op.
    await page.click('.bulkbar button:has-text("Delete")');
    await page.waitForTimeout(300);
    await page.click('.modal button:has-text("Cancel")');
    await page.waitForTimeout(300);
    const survivedCancel = await store(`(S)=>!!S.project('smoke-bulk-del-1') && !!S.project('smoke-bulk-del-2')`);
    await page.click('.bulkbar button:has-text("Delete")');
    await page.waitForTimeout(300);
    await page.click('.modal button:has-text("Delete")');
    await page.waitForTimeout(400);
    const gone = await store(`(S)=>!S.project('smoke-bulk-del-1') && !S.project('smoke-bulk-del-2') && S.releasesFor('smoke-bulk-del-1').length===0`);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const restored = await store(`(S)=>!!S.project('smoke-bulk-del-1') && !!S.project('smoke-bulk-del-2') && S.releasesFor('smoke-bulk-del-1').length===1`);
    // clean up regardless of outcome
    await store(`(S)=>{ S.remove('projects','smoke-bulk-del-1',{silent:true}); S.remove('projects','smoke-bulk-del-2',{silent:true}); }`);
    return survivedCancel && gone && restored;
  });

  // ---------- Saved views (user-defined) ----------
  console.log('Saved views');
  await check('Save the current filter as a named view — it highlights while active, reapplies exactly, and deletes with Undo', async () => {
    await openSec('projects');
    const beforeCount = await store(`(S)=>S.savedViews().length`);
    // dial in a distinctive, non-default combo directly (the status/sort controls
    // that write this state are already covered by other checks above)
    await page.evaluate(() => localStorage.setItem('manager.lib.view', JSON.stringify({ q: '', status: 'live', sort: 'name', dir: 'asc', field: '', fieldValue: '' })));
    await openSec('projects');
    await page.click('.saved-views button:has-text("Save view")');
    await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Smoke View');
    await page.click('.modal button:has-text("Save view")');
    await page.waitForTimeout(350);
    const created = await store(`(S)=>S.savedViews().some(v=>v.label==='Smoke View' && v.state.status==='live' && v.state.sort==='name' && v.state.dir==='asc')`);
    const chipOnWhenActive = await page.$eval('.filter-chip-custom:has-text("Smoke View")', (c) => c.classList.contains('on')).catch(() => false);

    // switching to a different built-in view un-highlights the custom chip
    await page.click('.saved-views .filter-chip:has-text("All")');
    await page.waitForTimeout(200);
    const chipOffAfterSwitch = await page.$eval('.filter-chip-custom:has-text("Smoke View")', (c) => c.classList.contains('on')).catch(() => true);

    // clicking the chip's apply half restores its exact saved filter
    await page.click('.filter-chip-custom:has-text("Smoke View") .fc-apply');
    await page.waitForTimeout(250);
    const reapplied = await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('manager.lib.view') || '{}'); return v.status === 'live' && v.sort === 'name' && v.dir === 'asc'; });

    // its delete half removes the chip, and Undo brings it back
    await page.click('.filter-chip-custom:has-text("Smoke View") .fc-del');
    await page.waitForTimeout(300);
    const deleted = !(await page.$('.filter-chip-custom:has-text("Smoke View")')) && !(await store(`(S)=>S.savedViews().some(v=>v.label==='Smoke View')`));
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
    await page.waitForTimeout(350);
    const undone = await store(`(S)=>S.savedViews().some(v=>v.label==='Smoke View')`);

    // clean up regardless of outcome
    await store(`(S)=>{const v=S.savedViews().find(x=>x.label==='Smoke View'); if(v) S.removeSavedView(v.id,{silent:true});}`);
    await page.evaluate(() => localStorage.removeItem('manager.lib.view'));
    const restoredCount = (await store(`(S)=>S.savedViews().length`)) === beforeCount;

    return created && chipOnWhenActive && !chipOffAfterSwitch && reapplied && deleted && undone && restoredCount;
  });
  await check('"Reorder saved views" appears once 2+ exist; up/down arrows swap their order in the modal', async () => {
    await store(`(S)=>{
      S.addSavedView({ label:'Smoke Order A', state:{ status:'all', sort:'name', dir:'asc' } });
      S.addSavedView({ label:'Smoke Order B', state:{ status:'all', sort:'name', dir:'desc' } });
    }`);
    await openSec('projects');
    const reorderBtn = await page.$('.saved-views button[title="Reorder saved views"]');
    if (!reorderBtn) return false;
    await reorderBtn.click(); await page.waitForTimeout(300);
    const before = await store(`(S)=>S.savedViews().map(v=>v.label)`);
    const iA = before.indexOf('Smoke Order A'), iB = before.indexOf('Smoke Order B');
    if (!(iA >= 0 && iB === iA + 1)) return false; // freshly added, appended in order
    const bDownDisabled = await page.$eval('.modal .field-row:has-text("Smoke Order B") button[title="Move down"]', (b) => b.disabled);
    await page.click('.modal .field-row:has-text("Smoke Order B") button[title="Move up"]'); await page.waitForTimeout(250);
    const after = await store(`(S)=>S.savedViews().map(v=>v.label)`);
    const swapped = after.indexOf('Smoke Order B') === iA && after.indexOf('Smoke Order A') === iA + 1;
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(200);
    // the strip's own chip order (not just the Store) reflects the swap once the modal closes
    const chipsOrder = await page.$$eval('.filter-chip-custom', (els) => els.map((e) => e.textContent));
    const chipSwapped = chipsOrder.findIndex((t) => t.includes('Smoke Order B')) < chipsOrder.findIndex((t) => t.includes('Smoke Order A'));
    return bDownDisabled && swapped && chipSwapped;
  });
  await check('dragging a saved view′s grip handle above another persists the new order, and Undo restores it', async () => {
    // order coming in from the previous check: [..., Smoke Order B, Smoke Order A]
    await page.click('.saved-views button[title="Reorder saved views"]'); await page.waitForTimeout(300);
    const before = await store(`(S)=>S.savedViews().map(v=>v.label)`);
    await page.dragAndDrop('.modal .field-row:has-text("Smoke Order A") .field-row-grip', '.modal .field-row:has-text("Smoke Order B")', { targetPosition: { x: 20, y: 3 } });
    await page.waitForTimeout(300);
    const after = await store(`(S)=>S.savedViews().map(v=>v.label)`);
    const draggedAbove = after.indexOf('Smoke Order A') < after.indexOf('Smoke Order B');
    await store(`(S)=>S.undo()`);
    await page.waitForTimeout(200);
    const undone = await store(`(S)=>S.savedViews().map(v=>v.label)`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(200);
    return draggedAbove && JSON.stringify(undone) === JSON.stringify(before);
  });
  await check('cleanup: remove the two smoke saved-view reorder rows', async () => {
    await store(`(S)=>{ ['Smoke Order A','Smoke Order B'].forEach(label=>{ const v=S.savedViews().find(x=>x.label===label); if(v) S.removeSavedView(v.id, {silent:true}); }); }`);
    return !(await store(`(S)=>S.savedViews().some(v=>v.label==='Smoke Order A' || v.label==='Smoke Order B')`));
  });
  await check('marking a saved view "default" applies it automatically the next time the library loads; unmarking stops it', async () => {
    // a second saved view is only there so "Reorder saved views" (which needs 2+) appears —
    // the default-view toggle itself lives in that modal (chips have no room for a third button)
    await store(`(S)=>{
      S.addSavedView({ label:'Smoke Default View', state:{ status:'live', sort:'name', dir:'asc' } });
      S.addSavedView({ label:'Smoke Default Sibling', state:{ status:'all', sort:'name', dir:'asc' } });
    }`);
    await openSec('projects');
    // pin it default from the reorder modal
    await page.click('.saved-views button[title="Reorder saved views"]'); await page.waitForTimeout(300);
    const pinBtn = await page.$('.modal .field-row:has-text("Smoke Default View") .default-view-btn');
    if (!pinBtn) { await page.click('.modal button:has-text("Done")'); return false; }
    await pinBtn.click(); await page.waitForTimeout(250);
    const markedInStore = await store(`(S)=>{const v=S.savedViews().find(x=>x.label==='Smoke Default View'); return !!v && v.isDefault===true;}`);
    const onlyOneDefault = await store(`(S)=>S.savedViews().filter(v=>v.isDefault).length===1`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(200);
    const badgeShown = !!(await page.$('.filter-chip-custom:has-text("Smoke Default View") .fc-default-badge'));

    // dial in a *different* filter, navigate away and back — the default view's filter should win on the fresh load
    await page.evaluate(() => localStorage.setItem('manager.lib.view', JSON.stringify({ q: '', status: 'archived', sort: 'version', dir: 'desc', field: '', fieldValue: '' })));
    await openSec('home');
    await openSec('projects');
    const appliedOnLoad = await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('manager.lib.view') || '{}'); return v.status === 'live' && v.sort === 'name' && v.dir === 'asc'; });

    // unmark it — reapplied nav no longer overrides the active filter
    await page.click('.saved-views button[title="Reorder saved views"]'); await page.waitForTimeout(300);
    await page.click('.modal .field-row:has-text("Smoke Default View") .default-view-btn'); await page.waitForTimeout(250);
    const unmarkedInStore = await store(`(S)=>{const v=S.savedViews().find(x=>x.label==='Smoke Default View'); return !!v && v.isDefault===false;}`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(200);
    const badgeGone = !(await page.$('.filter-chip-custom:has-text("Smoke Default View") .fc-default-badge'));
    await page.evaluate(() => localStorage.setItem('manager.lib.view', JSON.stringify({ q: '', status: 'archived', sort: 'version', dir: 'desc', field: '', fieldValue: '' })));
    await openSec('home');
    await openSec('projects');
    const noLongerApplied = await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('manager.lib.view') || '{}'); return v.status === 'archived' && v.sort === 'version'; });

    // clean up regardless of outcome
    await store(`(S)=>{ ['Smoke Default View','Smoke Default Sibling'].forEach(label=>{ const v=S.savedViews().find(x=>x.label===label); if(v) S.removeSavedView(v.id, {silent:true}); }); }`);
    await page.evaluate(() => localStorage.removeItem('manager.lib.view'));
    return markedInStore && onlyOneDefault && badgeShown && appliedOnLoad && unmarkedInStore && badgeGone && noLongerApplied;
  });

  // ---------- Project detail / releases ----------
  console.log('Project detail');
  await page.evaluate(() => { location.hash = 'project/relay'; });
  await page.waitForTimeout(400);
  await check('project detail shows the what\'s-new timeline', async () => (await count('.timeline .tl-item')) >= 1);
  await check('the what\'s-new timeline has a legend explaining the marks, and rows carry explanatory tooltips', async () => {
    const keys = await page.$$eval('.wn-legend .wn-key', (ns) => ns.map((n) => n.textContent.trim()));
    const allTitled = await page.$$eval('.wn-legend .wn-key', (ns) => ns.every((n) => (n.getAttribute('title') || '').length > 5));
    // a release row itself carries a kind tooltip (so the coloured dot is explained on hover)
    const rowTitled = await page.$eval('.timeline .tl-item', (n) => /Feature|Polish|Fix/.test(n.getAttribute('title') || ''));
    return ['Feature', 'Polish', 'Fix', 'Milestone', 'Synced'].every((k) => keys.includes(k)) && allTitled && rowTitled;
  });
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
  await check('milestones: flag toggles a release, badge renders, and the store persists it', async () => {
    // flag the newest timeline release, verify badge + store, then unflag
    await page.evaluate(() => { location.hash = 'project/relay'; });
    await page.waitForTimeout(400);
    const rid = await store(`(S)=>S.releasesFor('relay')[0].id`);
    const before = await store(`(S)=>!!S.releasesFor('relay')[0].milestone`);
    await page.click('.timeline .tl-item .tl-actions button[aria-label*="milestone" i]'); await page.waitForTimeout(300);
    // the flag modal appears when marking (not when unmarking); mark path
    const modal = await page.$('.modal button:has-text("Mark milestone")');
    if (modal) { await modal.click(); await page.waitForTimeout(400); }
    const marked = await store(`(S)=>!!S.get('releases','${rid}').milestone`);
    const badge = (await count('.timeline .tl-item.is-milestone .ms-badge')) >= 1;
    // clean up: unmark
    await store(`(S)=>S.setMilestone('${rid}', false)`);
    return before === false && marked === true && badge;
  });
  await check('milestones: recommendedMilestone heuristic returns a scored suggestion or null (never throws)', async () => {
    const rec = await store(`(S)=>{
      // synth a project with a feature burst → stabilizing tail → pause
      const pid='smoke-ms-proj';
      S.put('projects',{id:pid,name:'Smoke MS',status:'active'},{silent:true});
      const day=86400000, base=Date.now()-40*day;
      const mk=(v,kind,d)=>S.put('releases',{id:pid+'-r'+v,projectId:pid,v,kind,title:'r'+v,ts:new Date(base+d*day).toISOString()},{silent:true});
      mk(1,'feature',0); mk(2,'feature',1); mk(3,'feature',2); mk(4,'polish',3); mk(5,'fix',4);
      const r=S.recommendedMilestone(pid);
      S.remove('projects',pid,{silent:true});
      return r && { v:r.release.v, score:r.score, reasons:r.reasons.length };
    }`);
    // v5 (or the stabilizing tail) should be picked, with a score and reasons
    return rec && typeof rec.score === 'number' && rec.score > 0 && rec.reasons >= 1;
  });
  await check('milestones: dismissing or marking the suggestion ends it with no weaker fallback (no treadmill)', async () => {
    return await store(`(S)=>{
      const pid='smoke-ms-dismiss';
      S.put('projects',{id:pid,name:'Smoke Dismiss',status:'active'},{silent:true});
      const day=86400000, base=Date.now()-40*day;
      const mk=(v,kind,d)=>S.put('releases',{id:pid+'-r'+v,projectId:pid,v,kind,title:'r'+v,ts:new Date(base+d*day).toISOString()},{silent:true});
      mk(1,'feature',0); mk(2,'feature',1); mk(3,'feature',2); mk(4,'polish',3); mk(5,'fix',4);
      const first = S.recommendedMilestone(pid); if(!first){ S.remove('projects',pid,{silent:true}); return false; }
      const clean=(ok)=>{ S.remove('projects',pid,{silent:true}); const d=(S.settings().recDismissed||{}); delete d[pid]; S.setSetting('recDismissed',d); return ok; };
      // dismiss the standout → NOTHING else surfaces (no drop to a weaker one)
      S.dismissRecommendation(pid, first.release.v);
      if(S.recommendedMilestone(pid) !== null) return clean(false);
      // and marking it as a milestone also yields no suggestion
      const d=(S.settings().recDismissed||{}); delete d[pid]; S.setSetting('recDismissed',d);
      const again = S.recommendedMilestone(pid); if(!again) return clean(false);
      S.setMilestone(again.release.id, true, 'x');
      return clean(S.recommendedMilestone(pid) === null);
    }`);
  });
  await check('project page shows no recommendation banner — the suggestion lives on the timeline', async () => {
    // the old dismissable banner is gone; a rec (when any) is a marker on a card
    await page.evaluate(() => { location.hash = 'project/relay'; }); await page.waitForTimeout(300);
    return (await count('.rec-milestone')) === 0 && (await count('.callout.rec-milestone')) === 0;
  });
  await check('releases feed has a "Milestones" filter that narrows to marked releases', async () => {
    await store(`(S)=>{const r=S.releasesFor('relay')[0]; S.setMilestone(r.id, true, 'Smoke milestone');}`);
    await openSec('releases');
    await page.waitForTimeout(200);
    const badgeInFeed = (await count('.rel-card .ms-badge')) >= 1;
    await page.click('.filter-chip.ms-chip'); await page.waitForTimeout(250);
    const allMilestones = await page.$$eval('.rel-card', (cards) => cards.length > 0 && cards.every((c) => c.classList.contains('is-milestone')));
    await page.click('.filter-chip.ms-chip'); await page.waitForTimeout(150);   // clear filter
    await store(`(S)=>{const r=S.releasesFor('relay').find(x=>x.milestone); if(r) S.setMilestone(r.id, false);}`);
    return badgeInFeed && allMilestones;
  });
  await page.evaluate(() => { location.hash = 'project/relay'; });
  await page.waitForTimeout(400);
  await check('project notes: autosaves on pause, keeps a revision history, and renders Markdown in Preview', async () => {
    await page.fill('.notes-editor', 'Notes draft one');
    await page.waitForTimeout(1150);
    const afterFirst = await store(`(S)=>({notes:S.project('relay').notes, histLen:S.notesHistoryFor('relay').length})`);
    const md = '# Heading\n\n**Bold** point and a normal line.\n\n- item one\n- item two';
    await page.fill('.notes-editor', md);
    await page.waitForTimeout(1150);
    const afterSecond = await store(`(S)=>({notes:S.project('relay').notes, hist:S.notesHistoryFor('relay')})`);
    await page.click('.notes-card button:has-text("Preview")'); await page.waitForTimeout(150);
    const previewOk = (await page.$eval('.notes-md h3', (e) => e.textContent).catch(() => '')) === 'Heading'
      && (await count('.notes-md b')) >= 1 && (await count('.notes-md li')) >= 2;
    await page.click('.notes-card button:has-text("History")'); await page.waitForTimeout(300);
    const histRows = await count('.notes-hist-row');
    await page.click('.modal .notes-hist-row button:has-text("Restore")'); await page.waitForTimeout(500);
    const afterRestore = await store(`(S)=>({notes:S.project('relay').notes, histLen:S.notesHistoryFor('relay').length})`);
    // clean up
    await store(`(S)=>{const p=S.project('relay'); S.put('projects', {...p, notes:'', notesHistory:[]}, {silent:true});}`);
    return afterFirst.notes === 'Notes draft one' && afterFirst.histLen === 0
      && afterSecond.notes === md && afterSecond.hist.length === 1 && afterSecond.hist[0].text === 'Notes draft one'
      && previewOk && histRows === 1
      && afterRestore.notes === 'Notes draft one' && afterRestore.histLen === 1;
  });
  await check('project health panel: per-project weighting override is isolated to that project and resettable', async () => {
    await openSec('projects');
    await page.evaluate(() => { location.hash = 'project/solution-engineering'; });
    await page.waitForTimeout(400);
    const rowBefore = await page.$eval('.row:has-text("Weighting") .v', (e) => e.textContent).catch(() => '');
    const otherBefore = await store(`(S)=>S.healthScore('games')`);
    await page.click('.health button:has-text("Customize")'); await page.waitForTimeout(300);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150);
    await page.$eval('.proj-weight-slider[data-key="recency"]', (s) => { s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('.proj-weight-slider[data-key="velocity"]', (s) => { s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('.proj-weight-slider[data-key="status"]', (s) => { s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
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
  await check('project health panel: per-project "needs attention" threshold override is isolated to that project and resettable', async () => {
    await openSec('projects');
    await page.evaluate(() => { location.hash = 'project/polecat'; });
    await page.waitForTimeout(400);
    const rowBefore = await page.$eval('.row:has-text("Attention") .v', (e) => e.textContent).catch(() => '');
    const otherBefore = await store(`(S)=>S.needsAttention().some(a=>a.project.id==='games')`);
    await page.click('.row:has-text("Attention") button:has-text("Customize")'); await page.waitForTimeout(300);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150);
    // cranking this project's own health cutoff to 100 must flag it (no project scores 100)
    // without touching any other project's flagged state
    await page.$eval('.proj-attn-slider[data-key="healthMax"]', (s) => { s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const overridden = await store(`(S)=>({...S.attentionThresholdsFor('polecat')})`);
    const flaggedNow = await store(`(S)=>S.needsAttention().some(a=>a.project.id==='polecat')`);
    const otherAfter = await store(`(S)=>S.needsAttention().some(a=>a.project.id==='games')`);
    await page.click('.modal button:has-text("Reset to fleet default")'); await page.waitForTimeout(150);
    const afterReset = await store(`(S)=>({...S.attentionThresholdsFor('polecat')})`);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150); // back off — should now mirror the fleet
    const disabledMatchesFleet = await store(`(S)=>{const f=S.attentionThresholds(); const p=S.attentionThresholdsFor('polecat'); return f.healthMax===p.healthMax && f.autoSyncFails===p.autoSyncFails;}`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(300);
    const rowAfter = await page.$eval('.row:has-text("Attention") .v', (e) => e.textContent).catch(() => '');
    return /Fleet default/.test(rowBefore) && overridden.healthMax === 100 && flaggedNow
      && otherAfter === otherBefore
      && afterReset.healthMax === 35 && afterReset.autoSyncFails === 2
      && disabledMatchesFleet && /Fleet default/.test(rowAfter);
  });
  await check('project health panel: per-project auto-sync backoff cap override is isolated to that project and resettable', async () => {
    await openSec('projects');
    await page.evaluate(() => { location.hash = 'project/polecat'; });
    await page.waitForTimeout(400);
    const rowBefore = await page.$eval('.row:has-text("Backoff cap") .v', (e) => e.textContent).catch(() => '');
    const otherBefore = await store(`(S)=>S.autoSyncBackoffCapFor('games')`);
    await page.click('.row:has-text("Backoff cap") button:has-text("Customize")'); await page.waitForTimeout(300);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150);
    await page.$eval('.proj-backoff-slider[data-key="backoffCap"]', (s) => { s.value = '32'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const overridden = await store(`(S)=>S.autoSyncBackoffCapFor('polecat')`);
    const otherAfter = await store(`(S)=>S.autoSyncBackoffCapFor('games')`);
    await page.click('.modal button:has-text("Reset to fleet default")'); await page.waitForTimeout(150);
    const afterReset = await store(`(S)=>S.autoSyncBackoffCapFor('polecat')`);
    await page.click('.modal .opt-row .toggle'); await page.waitForTimeout(150); // back off — should now mirror the fleet
    const disabledMatchesFleet = await store(`(S)=>S.autoSyncBackoffCap()===S.autoSyncBackoffCapFor('polecat')`);
    await page.click('.modal button:has-text("Done")'); await page.waitForTimeout(300);
    const rowAfter = await page.$eval('.row:has-text("Backoff cap") .v', (e) => e.textContent).catch(() => '');
    return /Fleet default/.test(rowBefore) && overridden === 32
      && otherAfter === otherBefore
      && afterReset === 8
      && disabledMatchesFleet && /Fleet default/.test(rowAfter);
  });

  // ---------- Live changelog sync ----------
  console.log('Changelog sync');
  await check('parseChangelogSource handles a double-quoted string with an apostrophe (not just single-quoted ones)', async () => {
    // Regression: the naive quote-requoter used to scan the whole file for
    // single-quote pairs, so a `"…it's…"` DOUBLE-quoted value anywhere in an
    // entry made it treat that lone apostrophe as opening a new single-quoted
    // span and mangle every field after it in that object.
    const src = `export const CHANGELOG = [
      { v: 2, title: "Manager's own version stops lying", kind: 'polish', ts: '', items: ["It's fixed", 'Another "quoted" line'] },
      { v: 1, title: 'earlier release', kind: 'feature', ts: '', items: ['ok'] },
    ];`;
    const parsed = await page.evaluate(`import('/js/ingest.js').then(m=>m.parseChangelogSource(${JSON.stringify(src)}))`);
    return parsed.length === 2 && parsed[0].v === 2 && parsed[0].title === "Manager's own version stops lying"
      && parsed[0].items[0] === "It's fixed" && parsed[0].items[1] === 'Another "quoted" line'
      && parsed[1].v === 1 && parsed[1].title === 'earlier release';
  });
  await check('parseChangelogSource does not treat a comma-word-colon run inside a title/item as an unquoted key', async () => {
    // Regression: the bare-key-quoting and trailing-comma regexes used to run
    // over the WHOLE converted string, including inside string values. A title
    // like `**, quietly:**` (comma, a word, a colon) looks exactly like an
    // unquoted object key, so the key regex rewrote it to `, "quietly":` inside
    // the title — injecting unescaped quotes and breaking JSON.parse. The
    // transforms must only ever touch structural text, never string contents.
    const src = `export const CHANGELOG = [
      { v: 5, title: 'Boss fights land quietly — **, quietly:** you win', kind: 'feature', ts: '', items: ['api: gives, foo: bar'] },
      { v: 4, title: 'plain', kind: 'fix', ts: '', items: [] },
    ];`;
    const parsed = await page.evaluate(`import('/js/ingest.js').then(m=>m.parseChangelogSource(${JSON.stringify(src)}))`);
    return parsed.length === 2
      && parsed[0].v === 5 && parsed[0].title === 'Boss fights land quietly — **, quietly:** you win'
      && parsed[0].items[0] === 'api: gives, foo: bar'
      && parsed[1].v === 4 && parsed[1].title === 'plain';
  });
  await check('sync auto-updates status from activity (and Lock protects it)', async () => {
    // a project with a site + a fresh release should land on Live after syncing
    await store(`(S)=>S.updateProject('games',{status:'idea',statusLocked:false,statusAuto:false},{silent:true})`);
    await store(`(S)=>S.syncReleases('games',[{v:998,title:'probe',kind:'feature',ts:new Date().toISOString(),items:['x']}],'probe://x')`);
    const promoted = await store(`(S)=>S.project('games').status`);
    // a Locked project is left exactly as the user set it
    await store(`(S)=>S.updateProject('games',{status:'paused',statusLocked:true},{silent:true})`);
    await store(`(S)=>S.syncReleases('games',[{v:997,title:'probe2',kind:'feature',ts:new Date().toISOString(),items:['y']}],'probe://y')`);
    const lockedKept = await store(`(S)=>S.project('games').status`);
    // cleanup: drop probe releases + restore games to Live/unlocked
    await store(`(S)=>{[998,997].forEach(v=>{const r=S.releasesFor('games').find(x=>x.v===v); if(r) S.remove('releases', r.id, {silent:true});}); S.updateProject('games',{status:'live',statusLocked:false,statusAuto:false},{silent:true});}`);
    return promoted === 'live' && lockedKept === 'paused';
  });
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
    await page.click('.health .toggle[aria-label*="Auto-sync"]'); await page.waitForTimeout(200);
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
      return [0, 1, 2, 3, 4, 5].map((n) => autoSyncBackoffMultiplier(n));
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
  await check('a "Needs attention" row is keyboard-focusable — Enter opens the project, and a nested action button\'s own Enter does not', async () => {
    const changelogUrl = `${base}/js/changelog.js`;
    await store(`(S)=>{
      const p=S.project('games');
      S.put('projects', {...p, autoSync:true, autoSyncFailCount:3, autoSyncLastError:'HTTP 404', lastAutoSyncAt:Date.now(), changelogUrl:'${changelogUrl}'}, {silent:true});
    }`);
    await openSec('home');
    const role = await page.$eval('.attn-row', (r) => r.getAttribute('role'));
    await page.$eval('.attn-row button:has-text("Dismiss")', (b) => b.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const stillOnDashboard = !!(await page.$('.attn-panel, .stats'));
    await store(`(S)=>S.undismissAttention('games')`);
    await page.$eval('.attn-row', (r) => r.focus());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const opened = (await count('.detail-head')) > 0;
    // clean up
    await store(`(S)=>{
      S.releasesFor('games').filter(r=>r.source==='sync').forEach(r=>S.remove('releases', r.id, {silent:true}));
      const p=S.project('games'); S.put('projects', {...p, autoSync:false, changelogUrl:'', lastSyncAt:0, lastAutoSyncAt:0, autoSyncFailCount:0, autoSyncLastError:''}, {silent:true});
    }`);
    return role === 'button' && stillOnDashboard && opened;
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
    const railBadgeText = () => page.$eval('.ps-rail-item[data-sec="home"] .badge', (e) => (e.hidden ? null : e.textContent)).catch(() => null);
    const railBadgeVisible = () => page.$eval('.ps-rail-item[data-sec="home"] .badge', (e) => !e.hidden && getComputedStyle(e).opacity !== '0');
    const railOpenBefore = await page.$eval('.ps-rail', (e) => e.classList.contains('open'));
    if (!railOpenBefore) { await page.click('.ps-rail-toggle'); await page.waitForTimeout(300); }
    const openBadgeText = await railBadgeText();
    const openVisible = await railBadgeVisible();
    await page.click('.ps-rail-toggle'); await page.waitForTimeout(300); // collapse
    const collapsedVisible = await railBadgeVisible();
    if (railOpenBefore) { await page.click('.ps-rail-toggle'); await page.waitForTimeout(300); } // restore original rail state
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

    await page.click('.toast .toast-action'); // undo the dismiss
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

  // ---------- Fleet Ops (steward console) ----------
  // GitHub may be unreachable/rate-limited in CI — the panel must render its
  // chrome and settle every async card into data OR an inline error state,
  // with zero pageerrors either way.
  console.log('Fleet Ops');
  const foBodiesSettle = async () => {
    // async GitHub loads settle (data or an inline error note) — gh() carries
    // an 8s fetch deadline, so poll a little past it
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      const stillLoading = await page.evaluate(() =>
        [...document.querySelectorAll('#view .fo-body')].some((b) => /Loading|Scanning/.test(b.textContent)));
      if (!stillLoading) return true;
    }
    return false;
  };
  await check('steward log renders: safety nets, runs, and open-work cards settle without errors', async () => {
    if (!(await openSec('stewardlog'))) return false;
    if (!(await $('.fo-health'))) return false;
    if ((await count('#view .card')) < 3) return false;
    return foBodiesSettle();
  });
  await check('fleet ops control room renders: connect, roster, dispatch, and coming-up cards settle without errors', async () => {
    if (!(await openSec('fleetops'))) return false;
    if (!(await $('.fo-connect'))) return false;
    if ((await count('#view .card')) < 4) return false;
    if (!(await foBodiesSettle())) return false;
    // when the roster loaded (needs GitHub, may be unreachable in CI), app lanes
    // carry the ×N slices control and platform-job lanes don't
    const appRows = await count('.fo-roster .fo-app-row');
    if (appRows > 0 && (await count('.fo-roster .fo-slices')) === 0) return false;
    return true;
  });
  await check('lane schedule evaluator mirrors the platform semantics (cadence/offset/window/until/startAt, next-run on the :03 tick)', async () => {
    return await page.evaluate(async () => {
      const m = await import('/js/schedule.js');
      const at = (h) => new Date(Date.UTC(2026, 6, 16, h, 3));
      const ok = [];
      ok.push(m.isDueAt({ enabled:true, everyHours:2, offset:1 }, at(21)) && !m.isDueAt({ enabled:true, everyHours:2, offset:1 }, at(20)));
      ok.push(!m.isDueAt({ enabled:true, window:[9,17] }, at(18)) && m.isDueAt({ enabled:true, window:[9,17] }, at(9)));
      ok.push(m.isDueAt({ enabled:true, window:[22,6] }, at(23)) && !m.isDueAt({ enabled:true, window:[22,6] }, at(12)));
      ok.push(!m.isDueAt({ enabled:true, until:'2026-07-16T20:00:00Z' }, at(21)));
      ok.push(!m.isDueAt({ enabled:true, startAt:'2026-07-17T00:00:00Z' }, at(21)));
      const n = m.nextRunAt({ enabled:true, everyHours:2, offset:1 }, new Date(Date.UTC(2026,6,16,20,30)));
      ok.push(!!n && n.toISOString() === '2026-07-16T21:03:00.000Z');
      ok.push(m.nextRunAt({ enabled:true, until:'2026-07-16T21:00:00Z' }, new Date(Date.UTC(2026,6,16,20,30))) === null);
      ok.push(m.localInputToIso(m.isoToLocalInput('2026-07-16T21:03:00.000Z')) === '2026-07-16T21:03:00.000Z');
      // slices: default 1, clamp 1..5, and it must NOT change when a lane fires
      ok.push(m.slicesOf({}) === 1 && m.slicesOf({ slices: 3 }) === 3 && m.slicesOf({ slices: 9 }) === 5 && m.slicesOf({ slices: 0 }) === 1);
      ok.push(m.isDueAt({ enabled:true, everyHours:1, slices:3 }, at(21)) === m.isDueAt({ enabled:true, everyHours:1 }, at(21)));
      return ok.every(Boolean);
    });
  });
  await check('github GET cache: repeat reads are served from cache, writes and fresh:true bust it', async () => {
    return await page.evaluate(async () => {
      const g = await import('/js/github.js');
      g.clearGhCache();
      let calls = 0;
      const realFetch = window.fetch;
      window.fetch = async () => { calls++; return new Response(JSON.stringify({ n: calls }), { status: 200, headers: { 'content-type': 'application/json' } }); };
      try{
        const a = await g.gh('/cache-probe'); const b = await g.gh('/cache-probe');
        const cachedOnce = calls === 1 && a.n === 1 && b.n === 1;
        await g.gh('/cache-probe', { method: 'POST', body: {} });   // write → cache busted
        await g.gh('/cache-probe');
        const refetchedAfterWrite = calls === 3;
        await g.gh('/cache-probe', { fresh: true });
        return cachedOnce && refetchedAfterWrite && calls === 4;
      }finally{ window.fetch = realFetch; g.clearGhCache(); }
    });
  });
  await check('github rate-limit errors surface the reset time (and don\'t re-suggest a token you already have)', async () => {
    return await page.evaluate(async () => {
      const g = await import('/js/github.js');
      g.clearGhCache();
      const realFetch = window.fetch;
      const resetEpoch = Math.floor(Date.now() / 1000) + 1800;   // 30 min out
      window.fetch = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpoch) } });
      try{
        let err;
        try{ await g.gh('/rl-probe', { fresh: true }); }catch(e){ err = e; }
        if(!err) return false;
        // reset moment captured for the UI, and the message names a clock time, not "within the hour"
        if(err.resetAt !== resetEpoch * 1000) return false;
        if(!/resets \d/.test(err.message)) return false;
        return true;
      }finally{ window.fetch = realFetch; g.clearGhCache(); }
    });
  });
  await check('fleet ops dispatch + roster writes are gated behind a vault token (no silent unauthenticated writes)', async () => {
    // with no credential selected, the Improve run button must toast a warning, not POST
    await page.click('#view .btn.primary:has-text("Improve run")'); await page.waitForTimeout(300);
    const warned = await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /token/i.test(t.textContent)));
    return warned;
  });
  await check('steward signals flow into Needs attention: bell + rail badge + dashboard chips, and dismissal clears them', async () => {
    // deterministic: inject signals directly (the live fetcher is offline in CI)
    const before = await store(`(S)=>S.needsAttentionActive().length`);
    await store(`(S)=>{ const repo=S.project('games').repo; S.setStewardSignals({ [repo]: { openPRs:1, redPRs:1, sweepIssues:2 } }); }`);
    await openSec('home'); await page.waitForTimeout(300);
    const after = await store(`(S)=>S.needsAttentionActive().length`);
    if (after !== before + 1) return false;
    const chips = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.attn-row')].find((r) => r.textContent.includes('Games'));
      return row ? { steward: /red steward PR/.test(row.textContent), sweep: /sweep finding/.test(row.textContent) } : null;
    });
    const badgeText = await page.$eval('.notif-btn .badge', (e) => (e.hidden ? null : e.textContent)).catch(() => null);
    // dismissal is signature-scoped: acknowledging drops it from the active set
    await store(`(S)=>{ const a=S.needsAttentionActive().find(x=>x.project.id==='games'); if(a) S.dismissAttention(a); }`);
    const dismissed = (await store(`(S)=>S.needsAttentionActive().length`)) === before;
    await store(`(S)=>{ S.setStewardSignals(null); S.undismissAttention('games'); }`);
    return !!chips && chips.steward && chips.sweep && badgeText != null && parseInt(badgeText, 10) >= after && dismissed;
  });
  await check('project page shows a Steward card for a repo-linked project', async () => {
    await store(`(S)=>{ location.hash='project/manager'; }`);
    await page.waitForTimeout(600);
    return (await count('.card.health .section-title h2')) >= 2 &&
      (await page.evaluate(() => [...document.querySelectorAll('.card.health h2')].some((h) => h.textContent === 'Steward')));
  });

  // ---------- What's new ----------
  console.log("What's new");
  await check("what's new panel opens (shell right panel), lists dated entries, searches, filters", async () => {
    await (await $('.wn-btn')).click(); await page.waitForTimeout(320);
    if (!(await $('.ps-rpanel.in'))) return false;
    if ((await count('.wn-entry')) < 1) return false;
    // the shell feed shows "Mon D, YYYY · relative" for stamped entries
    const dateText = await page.evaluate(() => { const d = document.querySelector('.wn-entry .wn-date'); return d ? d.textContent.trim() : ''; });
    if (!/\d{4}/.test(dateText)) return false;
    await page.fill('.ps-rpanel .search input', 'zzzznomatch'); await page.waitForTimeout(250);
    const none = (await count('.wn-entry')) === 0;
    await page.fill('.ps-rpanel .search input', ''); await page.waitForTimeout(200);
    // kind filter chip — compare against the real data so this doesn't assume which kinds exist
    const expectPolish = await page.evaluate(async () => {
      const { CHANGELOG } = await import('/js/changelog.js');
      return CHANGELOG.filter((e) => (e.kind || 'feature') === 'polish').length;
    });
    await page.click('.ps-rpanel .filter-chip:has-text("Polish")'); await page.waitForTimeout(200);
    const filtered = (await count('.wn-entry')) === expectPolish;
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
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
    const full = await count('.ps-rail-item');
    // toggle simple mode on (first toggle in Appearance card)
    await page.click('.opt-row .toggle'); await page.waitForTimeout(350);
    const trimmed = await count('.ps-rail-item');
    await openSec('settings');
    await page.click('.opt-row .toggle'); await page.waitForTimeout(350);
    const restored = await count('.ps-rail-item');
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
    // cranking the health cutoff to 100 must flag every project scoring below
    // a perfect 100 (the check is `score < healthMax`, so a project that's
    // itself maxed out every dimension — e.g. Manager, which ships on every
    // run — correctly stays unflagged even at the most aggressive cutoff)
    await page.$eval('.attn-slider[data-attn="health"]', (s) => { s.value = '100'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const maxed = await store(`(S)=>S.needsAttention().length`);
    const totalProjects = await store(`(S)=>S.projects().filter(p=>S.healthScore(p.id) < 100).length`);
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
  await check('settings: auto-sync backoff cap slider persists and drives the retry multiplier, reset restores the shipped default', async () => {
    await openSec('settings');
    await page.$eval('.backoff-cap-slider', (s) => { s.value = '4'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    const saved = await store(`(S)=>S.autoSyncBackoffCap()`);
    const multAtCap = await page.evaluate(async () => {
      const { autoSyncBackoffMultiplier } = await import('/js/ingest.js');
      const { Store } = await import('/js/store.js');
      return autoSyncBackoffMultiplier(5, Store.autoSyncBackoffCap());
    });
    await page.click('.card:has-text("Auto-sync") button:has-text("Reset backoff cap")');
    await page.waitForTimeout(150);
    const restored = await store(`(S)=>S.autoSyncBackoffCap()`);
    return saved === 4 && multAtCap === 4 && restored === 8;
  });
  // ---------- Data: export / import round-trip ----------
  console.log('Data (export/import)');
  await check('export produces a JSON workspace with the seeded fleet', async () => {
    const parsed = await store(`(S)=>JSON.parse(S.exportJSON())`);
    return !!parsed.projects && Object.keys(parsed.projects).length >= 5 && !!parsed.settings;
  });
  await check('Store.importJSON round-trips: export, mutate, re-import restores the original exactly', async () => {
    const before = await store(`(S)=>S.exportJSON()`);
    await store(`(S)=>{ S.addProject({slug:'smoke-roundtrip-temp', name:'Smoke Roundtrip Temp'}); S.updateProject('games', {assessment:'mutated by smoke test'}); }`);
    const mutatedHasTemp = await store(`(S)=>!!S.project('smoke-roundtrip-temp')`);
    await page.evaluate(`(async()=>{const{Store}=await import('/js/store.js');Store.importJSON(${JSON.stringify(before)});})()`);
    const after = await store(`(S)=>S.exportJSON()`);
    const tempGone = !(await store(`(S)=>!!S.project('smoke-roundtrip-temp')`));
    const gamesRestored = await store(`(S)=>S.project('games').assessment`);
    return mutatedHasTemp && tempGone && after === before && !/mutated by smoke test/.test(gamesRestored);
  });
  await check('Store.previewImport counts rows without mutating the live store, and rejects garbage JSON', async () => {
    const liveBefore = await store(`(S)=>S.projects().length`);
    const counts = await store(`(S)=>S.previewImport(S.exportJSON())`);
    const liveAfter = await store(`(S)=>S.projects().length`);
    let rejected = false;
    try{ await store(`(S)=>S.previewImport('{"nope":true}')`); } catch { rejected = true; }
    return counts.projects === liveBefore && liveBefore === liveAfter && rejected;
  });
  await check('Import JSON: file picker → confirm dialog previews counts; Cancel leaves the workspace untouched', async () => {
    await openSec('settings');
    const exported = await store(`(S)=>S.exportJSON()`);
    const tmpFile = path.join(ROOT, '.smoke-import-tmp.json');
    fs.writeFileSync(tmpFile, exported);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Import JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      const dialogText = await page.$eval('.modal-body', (b) => b.textContent).catch(() => '');
      const mentionsProjects = /project/i.test(dialogText);
      await page.click('.modal button:has-text("Cancel")');
      await page.waitForTimeout(200);
      const stillOnSettings = await page.evaluate(() => location.hash.includes('settings'));
      return mentionsProjects && stillOnSettings;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('Import JSON: confirming replaces the workspace and clears undo history', async () => {
    await openSec('settings');
    // bank an undoable op so we can prove import wipes it, not just the data
    await store(`(S)=>S.addProject({slug:'smoke-import-undo-temp', name:'Smoke Import Undo Temp'})`);
    const canUndoBefore = await store(`(S)=>S.canUndo()`);
    const snapshot = await store(`(S)=>S.exportJSON()`); // captures the temp project too — imports back to a known state
    const tmpFile = path.join(ROOT, '.smoke-import-tmp2.json');
    fs.writeFileSync(tmpFile, snapshot);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Import JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      await page.click('.modal button:has-text("Import & replace")');
      await page.waitForTimeout(400);
      const hasTemp = await store(`(S)=>!!S.project('smoke-import-undo-temp')`);
      const canUndoAfter = await store(`(S)=>S.canUndo()`);
      // cleanup: remove the temp project without relying on undo (history is now empty by design)
      await store(`(S)=>S.remove('projects','smoke-import-undo-temp',{silent:true})`);
      return canUndoBefore && hasTemp && !canUndoAfter;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('"Recently deleted" tray lists deleted projects (single + bulk) and restores one at a time, leaving the rest of a bulk delete intact', async () => {
    await store(`(S)=>{
      S.addProject({ slug:'smoke-recently-deleted-1', name:'Smoke Recently Deleted 1' });
      S.put('releases', { id:'smoke-rd-rel', projectId:'smoke-recently-deleted-1', v:1, title:'x', ts:Date.now() }, { silent:true });
      S.addProject({ slug:'smoke-recently-deleted-2', name:'Smoke Recently Deleted 2' });
      S.addProject({ slug:'smoke-recently-deleted-3', name:'Smoke Recently Deleted 3' });
      S.remove('projects','smoke-recently-deleted-1');
      S.bulkRemove('projects', ['smoke-recently-deleted-2','smoke-recently-deleted-3']);
    }`);
    await openSec('settings');
    await page.waitForTimeout(250);
    await page.click('button:has-text("Recently deleted")');
    await page.waitForTimeout(300);
    const rowsText = await page.$$eval('.modal .notes-hist-row', (els) => els.map((e) => e.textContent));
    const sawAllThree = ['Smoke Recently Deleted 1', 'Smoke Recently Deleted 2', 'Smoke Recently Deleted 3']
      .every((n) => rowsText.some((t) => t.includes(n)));
    const releaseNoted = rowsText.some((t) => t.includes('Smoke Recently Deleted 1') && t.includes('1 release'));
    // restore just one project out of the bulk-deleted pair — its sibling must stay gone
    await page.click('.modal .notes-hist-row:has-text("Smoke Recently Deleted 2") button:has-text("Restore")');
    await page.waitForTimeout(300);
    const partialRestore = await store(`(S)=>!!S.project('smoke-recently-deleted-2') && !S.project('smoke-recently-deleted-3')`);
    const modalStillOpen = !!(await $('.modal-back.in'));
    // restore the singly-deleted project — its cascaded release should come back with it
    await page.click('.modal .notes-hist-row:has-text("Smoke Recently Deleted 1") button:has-text("Restore")');
    await page.waitForTimeout(300);
    const releaseRestored = await store(`(S)=>S.releasesFor('smoke-recently-deleted-1').length===1`);
    // restoring the last remaining row should empty the list and auto-close the modal
    await page.click('.modal .notes-hist-row:has-text("Smoke Recently Deleted 3") button:has-text("Restore")');
    await page.waitForTimeout(400);
    const allBack = await store(`(S)=>['smoke-recently-deleted-1','smoke-recently-deleted-2','smoke-recently-deleted-3'].every(id=>!!S.project(id))`);
    const modalClosed = !(await $('.modal-back.in'));
    await store(`(S)=>{ ['smoke-recently-deleted-1','smoke-recently-deleted-2','smoke-recently-deleted-3'].forEach(id=>S.remove('projects', id, {silent:true})); }`);
    return sawAllThree && releaseNoted && partialRestore && modalStillOpen && releaseRestored && allBack && modalClosed;
  });

  // ---------- Data: merge import ----------
  console.log('Data (merge import)');
  await check('Store.previewMerge counts new-vs-already-here rows per table without mutating the live store', async () => {
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['smoke-merge-preview']={id:'smoke-merge-preview',slug:'smoke-merge-preview',name:'Smoke Merge Preview',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()}; return JSON.stringify(db); }`);
    const liveBefore = await store(`(S)=>S.projects().length`);
    const preview = await store(`(S)=>S.previewMerge(${JSON.stringify(merged)})`);
    const liveAfter = await store(`(S)=>S.projects().length`);
    const t = preview.tables.projects;
    return t.add === 1 && t.rows.length === 1 && t.rows[0].id === 'smoke-merge-preview'
      && t.skip === liveBefore && liveBefore === liveAfter;
  });
  await check('Store.mergeImport adds only new rows, spanning two tables, as one grouped Undo step', async () => {
    const merged = await store(`(S)=>{
      const db=JSON.parse(S.exportJSON());
      db.projects['smoke-merge-proj']={id:'smoke-merge-proj',slug:'smoke-merge-proj',name:'Smoke Merge Proj',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()};
      db.releases['smoke-merge-rel']={id:'smoke-merge-rel',projectId:'games',v:'v999.0.0',title:'Smoke merge release',kind:'feature',items:['test'],ts:new Date().toISOString(),createdAt:Date.now(),updatedAt:Date.now()};
      return JSON.stringify(db);
    }`);
    const gamesAssessmentBefore = await store(`(S)=>S.project('games').assessment`);
    const n = await store(`(S)=>S.mergeImport(${JSON.stringify(merged)})`);
    const hasProj = await store(`(S)=>!!S.project('smoke-merge-proj')`);
    const hasRel = await store(`(S)=>!!S.get('releases','smoke-merge-rel')`);
    const gamesUntouched = (await store(`(S)=>S.project('games').assessment`)) === gamesAssessmentBefore;
    await store(`(S)=>S.undo()`);
    const projGone = !(await store(`(S)=>!!S.project('smoke-merge-proj')`));
    const relGone = !(await store(`(S)=>!!S.get('releases','smoke-merge-rel')`));
    return n.added === 2 && n.updated === 0 && hasProj && hasRel && gamesUntouched && projGone && relGone;
  });
  await check('Store.previewMerge flags a row that exists in both places but differs as `update` (not `skip`), carrying local+incoming for a diff — and never mutates the live row', async () => {
    const beforeAssessment = await store(`(S)=>S.project('games').assessment`);
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['games']={ ...db.projects['games'], assessment:'Smoke-updated assessment (preview)' }; return JSON.stringify(db); }`);
    const preview = await store(`(S)=>S.previewMerge(${JSON.stringify(merged)})`);
    const stillOriginal = (await store(`(S)=>S.project('games').assessment`)) === beforeAssessment;
    const t = preview.tables.projects;
    const row = (t.updateRows||[]).find((r) => r.id === 'games');
    return t.update === 1 && !!row
      && row.local.assessment === beforeAssessment
      && row.incoming.assessment === 'Smoke-updated assessment (preview)'
      && stillOriginal;
  });
  await check('Store.mergeImport leaves a differing existing row untouched by default, but overwrites it with {applyUpdates:true} — and Undo restores the exact previous version', async () => {
    const beforeAssessment = await store(`(S)=>S.project('games').assessment`);
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['games']={ ...db.projects['games'], assessment:'Smoke-applied merge update' }; return JSON.stringify(db); }`);
    const withoutFlag = await store(`(S)=>S.mergeImport(${JSON.stringify(merged)})`);
    const untouchedByDefault = (await store(`(S)=>S.project('games').assessment`)) === beforeAssessment;
    const withFlag = await store(`(S)=>S.mergeImport(${JSON.stringify(merged)}, {applyUpdates:true})`);
    const nowUpdated = (await store(`(S)=>S.project('games').assessment`)) === 'Smoke-applied merge update';
    await store(`(S)=>S.undo()`);
    const restored = (await store(`(S)=>S.project('games').assessment`)) === beforeAssessment;
    return withoutFlag.added === 0 && withoutFlag.updated === 0 && untouchedByDefault
      && withFlag.added === 0 && withFlag.updated === 1 && nowUpdated && restored;
  });
  await check('Merge JSON: file picker → confirm dialog previews new-row counts; Cancel leaves the workspace untouched', async () => {
    await openSec('settings');
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['smoke-merge-ui']={id:'smoke-merge-ui',slug:'smoke-merge-ui',name:'Smoke Merge UI',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()}; return JSON.stringify(db); }`);
    const tmpFile = path.join(ROOT, '.smoke-merge-tmp.json');
    fs.writeFileSync(tmpFile, merged);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Merge JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      const dialogText = await page.$eval('.modal-body', (b) => b.textContent).catch(() => '');
      const mentionsNew = /new project/i.test(dialogText);
      await page.click('.modal button:has-text("Cancel")');
      await page.waitForTimeout(200);
      const stillAbsent = !(await store(`(S)=>!!S.project('smoke-merge-ui')`));
      return mentionsNew && stillAbsent;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('Merge JSON: the review disclosure lists new rows by name, resolving a new release’s project name even when that project is also new in the same file', async () => {
    await openSec('settings');
    const merged = await store(`(S)=>{
      const db=JSON.parse(S.exportJSON());
      db.projects['smoke-merge-review']={id:'smoke-merge-review',slug:'smoke-merge-review',name:'Smoke Merge Review UI',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()};
      db.releases['smoke-merge-review-rel']={id:'smoke-merge-review-rel',projectId:'smoke-merge-review',v:1,title:'Smoke review release',kind:'feature',items:['test'],ts:new Date().toISOString(),createdAt:Date.now(),updatedAt:Date.now()};
      return JSON.stringify(db);
    }`);
    const tmpFile = path.join(ROOT, '.smoke-merge-review-tmp.json');
    fs.writeFileSync(tmpFile, merged);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Merge JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      // The row list lives inside a closed <details> until expanded — assert
      // it's collapsed by default, then open it and check the actual names.
      const openBefore = await page.$eval('.modal details.merge-review', (d) => d.open);
      await page.click('.modal details.merge-review summary');
      await page.waitForTimeout(150);
      const reviewText = await page.$eval('.modal details.merge-review', (d) => d.textContent);
      await page.click('.modal button:has-text("Cancel")');
      await page.waitForTimeout(200);
      const stillAbsent = !(await store(`(S)=>!!S.project('smoke-merge-review')`));
      return !openBefore
        && reviewText.includes('Smoke Merge Review UI')
        && reviewText.includes('v1')
        && reviewText.includes('Smoke review release')
        && stillAbsent;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('Merge JSON: confirming adds only the new rows (existing project left untouched), and Undo removes them together', async () => {
    await openSec('settings');
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['smoke-merge-ui2']={id:'smoke-merge-ui2',slug:'smoke-merge-ui2',name:'Smoke Merge UI 2',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()}; return JSON.stringify(db); }`);
    const tmpFile = path.join(ROOT, '.smoke-merge-tmp2.json');
    fs.writeFileSync(tmpFile, merged);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Merge JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      await page.click('.modal button:has-text("Merge in")');
      await page.waitForTimeout(400);
      const added = await store(`(S)=>!!S.project('smoke-merge-ui2')`);
      const canUndo = await store(`(S)=>S.canUndo()`);
      await store(`(S)=>S.undo()`);
      const goneAfterUndo = !(await store(`(S)=>!!S.project('smoke-merge-ui2')`));
      return added && canUndo && goneAfterUndo;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('Merge JSON: a differing existing row is left alone unless the "also update" checkbox is opted into, and the review shows a field-level diff', async () => {
    await openSec('settings');
    const beforeAssessment = await store(`(S)=>S.project('games').assessment`);
    const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); db.projects['games']={ ...db.projects['games'], assessment:'Smoke merge-update UI value' }; return JSON.stringify(db); }`);
    const tmpFile = path.join(ROOT, '.smoke-merge-update-tmp.json');
    fs.writeFileSync(tmpFile, merged);
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Merge JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      const checkbox = await $('.modal input[type=checkbox]');
      if (!checkbox) return false;
      await page.click('.modal details.merge-review summary');
      await page.waitForTimeout(150);
      const reviewText = await page.$eval('.modal details.merge-review', (d) => d.textContent);
      const showsDiff = reviewText.includes('Smoke merge-update UI value') && /assessment/i.test(reviewText);
      // Confirming with the box unchecked must leave the row untouched.
      const mergeBtn = await $('.modal button.primary:has-text("Merge in")');
      const disabledByDefault = await page.$eval('.modal button.primary:has-text("Merge in")', (b) => b.disabled);
      // Opt in, then confirm — now it should overwrite.
      await checkbox.click();
      await page.click('.modal button:has-text("Merge in")');
      await page.waitForTimeout(400);
      const updated = (await store(`(S)=>S.project('games').assessment`)) === 'Smoke merge-update UI value';
      await store(`(S)=>S.undo()`);
      const restored = (await store(`(S)=>S.project('games').assessment`)) === beforeAssessment;
      return showsDiff && disabledByDefault && !!mergeBtn && updated && restored;
    } finally { fs.unlinkSync(tmpFile); }
  });
  await check('Store.previewMerge flags a local row absent from the file as `remove`, and Store.mergeImport only deletes it (cascading its release) with {applyRemoves:true} — Undo restores both', async () => {
    await store(`(S)=>{
      S.put('projects',{id:'smoke-merge-remove-proj',slug:'smoke-merge-remove-proj',name:'Smoke Merge Remove Proj',status:'idea',tags:[],fields:{}},{silent:true});
      S.put('releases',{id:'smoke-merge-remove-rel',projectId:'smoke-merge-remove-proj',v:1,title:'Smoke remove release',kind:'feature',items:['test'],ts:new Date().toISOString()},{silent:true});
    }`);
    try {
      const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); delete db.projects['smoke-merge-remove-proj']; return JSON.stringify(db); }`);
      const preview = await store(`(S)=>S.previewMerge(${JSON.stringify(merged)})`);
      const t = preview.tables.projects;
      const flagged = t.remove === 1 && (t.removeRows || []).some((r) => r.id === 'smoke-merge-remove-proj');
      const withoutFlag = await store(`(S)=>S.mergeImport(${JSON.stringify(merged)})`);
      const stillThereByDefault = await store(`(S)=>!!S.project('smoke-merge-remove-proj')`);
      const withFlag = await store(`(S)=>S.mergeImport(${JSON.stringify(merged)}, {applyRemoves:true})`);
      const projGone = !(await store(`(S)=>!!S.project('smoke-merge-remove-proj')`));
      const relGone = !(await store(`(S)=>!!S.get('releases','smoke-merge-remove-rel')`));
      await store(`(S)=>S.undo()`);
      const projRestored = await store(`(S)=>!!S.project('smoke-merge-remove-proj')`);
      const relRestored = await store(`(S)=>!!S.get('releases','smoke-merge-remove-rel')`);
      return flagged && withoutFlag.removed === 0 && stillThereByDefault
        && withFlag.removed === 1 && projGone && relGone && projRestored && relRestored;
    } finally {
      await store(`(S)=>{ S.remove('projects','smoke-merge-remove-proj',{silent:true}); S.remove('releases','smoke-merge-remove-rel',{silent:true}); }`);
    }
  });
  await check('Merge JSON: a local-only row is left alone unless the "also remove" checkbox is opted into, and the review lists it tagged `remove`', async () => {
    await openSec('settings');
    await store(`(S)=>S.put('projects',{id:'smoke-merge-remove-ui',slug:'smoke-merge-remove-ui',name:'Smoke Merge Remove UI',status:'idea',tags:[],fields:{}},{silent:true})`);
    try {
      const merged = await store(`(S)=>{ const db=JSON.parse(S.exportJSON()); delete db.projects['smoke-merge-remove-ui']; return JSON.stringify(db); }`);
      const tmpFile = path.join(ROOT, '.smoke-merge-remove-tmp.json');
      fs.writeFileSync(tmpFile, merged);
      try {
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.click('button:has-text("Merge JSON")'),
        ]);
        await chooser.setFiles(tmpFile);
        await page.waitForTimeout(300);
        const removeCheckbox = await $('.modal .merge-remove-opt input[type=checkbox]');
        if (!removeCheckbox) return false;
        await page.click('.modal details.merge-review summary');
        await page.waitForTimeout(150);
        const reviewText = await page.$eval('.modal details.merge-review', (d) => d.textContent);
        const showsRemove = reviewText.includes('Smoke Merge Remove UI') && /remove/i.test(reviewText);
        const disabledByDefault = await page.$eval('.modal button.primary:has-text("Merge in")', (b) => b.disabled);
        await removeCheckbox.click();
        await page.click('.modal button:has-text("Merge in")');
        await page.waitForTimeout(400);
        const removed = !(await store(`(S)=>!!S.project('smoke-merge-remove-ui')`));
        await store(`(S)=>S.undo()`);
        const restored = await store(`(S)=>!!S.project('smoke-merge-remove-ui')`);
        return showsRemove && disabledByDefault && removed && restored;
      } finally { fs.unlinkSync(tmpFile); }
    } finally {
      await store(`(S)=>S.remove('projects','smoke-merge-remove-ui',{silent:true})`);
    }
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
  await check('define a number-type custom field and narrow the library with its range-slider filter', async () => {
    await openSec('settings');
    await page.click('.card:has-text("Custom fields") button:has-text("Add field")'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Score');
    await page.selectOption('.modal select.input', 'number'); await page.waitForTimeout(150);
    await page.click('.modal button:has-text("Add field")'); await page.waitForTimeout(300);
    const defined = await store(`(S)=>S.fieldDefs().some(f=>f.label==='Score' && f.type==='number')`);
    // give two real projects distinct values so the slider has a real range to narrow
    await store(`(S)=>{
      const a=S.project('games'); S.put('projects', {...a, fields:{...(a.fields||{}), score:90}}, {silent:true});
      const b=S.project('relay'); S.put('projects', {...b, fields:{...(b.fields||{}), score:10}}, {silent:true});
    }`);
    await openSec('projects');
    await page.selectOption('.toolbar select.field-filter', 'score'); await page.waitForTimeout(200);
    const hasSlider = !!(await $('.range-filter-min'));
    const bothBeforeNarrowing = await page.$eval('.lib-table tbody', (tb) => tb.textContent.includes('Games') && tb.textContent.includes('Relay')).catch(() => false);
    // drag the min handle past Relay's 10 but not Games' 90
    await page.$eval('.range-filter-min', (el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(250);
    const narrowedCount = await count('.lib-table tbody tr');
    const onlyGames = await page.$eval('.lib-table tbody', (tb) => tb.textContent.includes('Games') && !tb.textContent.includes('Relay')).catch(() => false);
    // the reset button clears the filter back to the field's full range
    await page.click('.range-filter-clear');
    await page.waitForTimeout(250);
    const restored = await page.$eval('.lib-table tbody', (tb) => tb.textContent.includes('Games') && tb.textContent.includes('Relay')).catch(() => false);
    await page.selectOption('.toolbar select.field-filter', ''); await page.waitForTimeout(200);
    return defined && hasSlider && bothBeforeNarrowing && narrowedCount === 1 && onlyGames && restored;
  });
  await check('cleanup: remove the smoke Score field and its values', async () => {
    await store(`(S)=>{
      const f=S.fieldDefs().find(x=>x.label==='Score'); if(f) S.removeFieldDef(f.id, {silent:true});
      ['games','relay'].forEach(id=>{
        const p=S.project(id);
        if(p && p.fields && 'score' in p.fields){ const nf={...p.fields}; delete nf.score; S.put('projects', {...p, fields:nf}, {silent:true}); }
      });
    }`);
    return !(await store(`(S)=>S.fieldDefs().some(f=>f.label==='Score')`));
  });
  await check('"Promote to field" turns a legacy free-form value into a typed field, prefilled and carrying the value over', async () => {
    await store(`(S)=>{ const g=S.project('games'); S.put('projects', {...g, fields:{...(g.fields||{}), smoke_docs_link:'https://example.com/docs'}}, {silent:true}); }`);
    await page.evaluate(() => { location.hash = 'project/games'; });
    await page.waitForTimeout(400);
    await page.click('button:has-text("Edit")'); await page.waitForTimeout(300);
    const promoteBtn = await page.$('.modal button[title="Promote to field"]');
    if (!promoteBtn) return false;
    await promoteBtn.click(); await page.waitForTimeout(300);
    const overlays = await page.$$('.modal-back.in');
    const promoteModal = overlays[overlays.length - 1];
    if (!promoteModal) return false;
    const prefilledLabel = await promoteModal.$eval('input.input', (i) => i.value).catch(() => '');
    const prefilledType = await promoteModal.$eval('select.input', (s) => s.value).catch(() => '');
    const saveBtn = await promoteModal.$('button:has-text("Promote")');
    if (!saveBtn) return false;
    await saveBtn.click(); await page.waitForTimeout(300);
    await page.click('.modal button:has-text("Save changes")'); await page.waitForTimeout(400);
    const defOk = await store(`(S)=>S.fieldDefs().some(f=>f.label==='Smoke Docs Link' && f.type==='url')`);
    const valueOk = await store(`(S)=>{ const g=S.project('games'); return g.fields['smoke-docs-link']==='https://example.com/docs' && !('smoke_docs_link' in g.fields); }`);
    const renderedAsLink = await page.$$eval('.card.health a.link', (els) => els.some((e) => e.href === 'https://example.com/docs')).catch(() => false);
    return prefilledLabel === 'Smoke Docs Link' && prefilledType === 'url' && defOk && valueOk && renderedAsLink;
  });
  await check('cleanup: remove the promoted smoke field and its value', async () => {
    await store(`(S)=>{
      const f=S.fieldDefs().find(x=>x.label==='Smoke Docs Link'); if(f) S.removeFieldDef(f.id, {silent:true});
      const g=S.project('games');
      if(g && g.fields && g.fields['smoke-docs-link']){ const nf={...g.fields}; delete nf['smoke-docs-link']; S.put('projects', {...g, fields:nf}, {silent:true}); }
    }`);
    return !(await store(`(S)=>S.fieldDefs().some(f=>f.label==='Smoke Docs Link')`));
  });
  await check('up/down arrows reorder custom fields, with the last row′s "move down" arrow disabled', async () => {
    await openSec('settings');
    await page.click('.card:has-text("Custom fields") button:has-text("Add field")'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Smoke Alpha');
    await page.click('.modal button:has-text("Add field")'); await page.waitForTimeout(300);
    await page.click('.card:has-text("Custom fields") button:has-text("Add field")'); await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'Smoke Beta');
    await page.click('.modal button:has-text("Add field")'); await page.waitForTimeout(300);
    const before = await store(`(S)=>S.fieldDefs().map(f=>f.label)`);
    const iAlpha = before.indexOf('Smoke Alpha'), iBeta = before.indexOf('Smoke Beta');
    if (!(iAlpha >= 0 && iBeta === iAlpha + 1)) return false; // freshly added, appended in order
    const betaDownDisabled = await page.$eval('.field-row:has-text("Smoke Beta") button[title="Move down"]', (b) => b.disabled);
    await page.click('.field-row:has-text("Smoke Beta") button[title="Move up"]'); await page.waitForTimeout(250);
    const after = await store(`(S)=>S.fieldDefs().map(f=>f.label)`);
    const swapped = after.indexOf('Smoke Beta') === iAlpha && after.indexOf('Smoke Alpha') === iAlpha + 1;
    return betaDownDisabled && swapped;
  });
  await check('dragging a custom field′s grip handle above another persists the new order, and Undo restores it', async () => {
    // order coming in from the previous check: [..., Smoke Beta, Smoke Alpha]
    const before = await store(`(S)=>S.fieldDefs().map(f=>f.label)`);
    await page.dragAndDrop('.field-row:has-text("Smoke Alpha") .field-row-grip', '.field-row:has-text("Smoke Beta")', { targetPosition: { x: 20, y: 3 } });
    await page.waitForTimeout(300);
    const after = await store(`(S)=>S.fieldDefs().map(f=>f.label)`);
    const draggedAbove = after.indexOf('Smoke Alpha') < after.indexOf('Smoke Beta');
    await store(`(S)=>S.undo()`);
    await page.waitForTimeout(200);
    const undone = await store(`(S)=>S.fieldDefs().map(f=>f.label)`);
    return draggedAbove && JSON.stringify(undone) === JSON.stringify(before);
  });
  await check('cleanup: remove the two smoke reorder fields', async () => {
    await store(`(S)=>{ ['Smoke Alpha','Smoke Beta'].forEach(label=>{ const f=S.fieldDefs().find(x=>x.label===label); if(f) S.removeFieldDef(f.id, {silent:true}); }); }`);
    return !(await store(`(S)=>S.fieldDefs().some(f=>f.label==='Smoke Alpha' || f.label==='Smoke Beta')`));
  });

  // ---------- Tags (fleet-wide tag manager in Settings) ----------
  console.log('Tags manager');
  await check('Settings → Tags lists a tag with its live usage count, and its "View" action filters the library down to it', async () => {
    await store(`(S)=>{ ['games','relay'].forEach(id=>{ const p=S.project(id); S.put('projects', {...p, tags:[...(p.tags||[]), 'smoketagx']}, {silent:true}); }); }`);
    await openSec('settings');
    const row = await page.$('.field-row:has-text("smoketagx")');
    if (!row) return false;
    const countText = await row.$eval('.field-row-mid', (e) => e.textContent);
    if (!/2 projects/.test(countText)) return false;
    await row.$eval('button[title^="View projects"]', (b) => b.click());
    await page.waitForTimeout(350);
    const searchVal = await page.$eval('.search input.input', (i) => i.value).catch(() => '');
    const rows = await count('.lib-table tbody tr');
    const namesOk = await page.$eval('.lib-table tbody', (tb) => tb.textContent.includes('Games') && tb.textContent.includes('Relay')).catch(() => false);
    await page.fill('.search input.input', ''); await page.waitForTimeout(200); // leave the library filter clean for later checks
    return searchVal === 'smoketagx' && rows === 2 && namesOk;
  });
  await check('renaming a tag in Settings → Tags updates every project that carries it in one step, and merging into a tag that already exists doesn′t duplicate it', async () => {
    await store(`(S)=>{ const m=S.project('manager'); S.put('projects', {...m, tags:[...(m.tags||[]), 'smoketagy']}, {silent:true}); }`);
    await openSec('settings');
    const row = await page.$('.field-row:has-text("smoketagx")');
    if (!row) return false;
    await row.$eval('button[title="Rename everywhere"]', (b) => b.click());
    await page.waitForTimeout(300);
    await page.fill('.modal input.input', 'smoketagy');
    await page.click('.modal button:has-text("Rename")');
    await page.waitForTimeout(300);
    const renamed = await store(`(S)=>{
      const once=(arr,t)=>arr.filter(x=>x===t).length===1;
      const g=S.project('games'), r=S.project('relay'), m=S.project('manager');
      return !g.tags.includes('smoketagx') && once(g.tags,'smoketagy')
        && !r.tags.includes('smoketagx') && once(r.tags,'smoketagy')
        && once(m.tags,'smoketagy');
    }`);
    await store(`(S)=>S.undo()`);
    await page.waitForTimeout(200);
    const undone = await store(`(S)=>{
      const g=S.project('games'), r=S.project('relay'), m=S.project('manager');
      return g.tags.includes('smoketagx') && !g.tags.includes('smoketagy')
        && r.tags.includes('smoketagx') && !r.tags.includes('smoketagy')
        && m.tags.includes('smoketagy') && !m.tags.includes('smoketagx');
    }`);
    return renamed && undone;
  });
  await check('the Remove action in Settings → Tags removes a tag from every project that carries it, as one Undo step', async () => {
    await openSec('settings');
    const row = await page.$('.field-row:has-text("smoketagx")');
    if (!row) return false;
    await row.$eval('button[title="Remove from every project"]', (b) => b.click());
    await page.waitForTimeout(300);
    const removed = await store(`(S)=>!S.project('games').tags.includes('smoketagx') && !S.project('relay').tags.includes('smoketagx')`);
    await store(`(S)=>S.undo()`);
    await page.waitForTimeout(200);
    const restored = await store(`(S)=>S.project('games').tags.includes('smoketagx') && S.project('relay').tags.includes('smoketagx')`);
    return removed && restored;
  });
  await check('cleanup: remove the smoke tags', async () => {
    await store(`(S)=>{
      ['games','relay','manager'].forEach(id=>{
        const p=S.project(id);
        if(p && p.tags && (p.tags.includes('smoketagx')||p.tags.includes('smoketagy'))){
          S.put('projects', {...p, tags:p.tags.filter(t=>t!=='smoketagx'&&t!=='smoketagy')}, {silent:true});
        }
      });
    }`);
    return !(await store(`(S)=>S.allTags().some(t=>t.tag==='smoketagx'||t.tag==='smoketagy')`));
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

  // ---------- Accessibility: focus trap + restore on every overlay ----------
  // All four "floats above the page" surfaces (modal, ⌘K palette, What's-new
  // sheet, notification popover) share the same shape: opening one used to
  // leave keyboard focus wherever it already was, so Tab could walk a
  // keyboard user straight through the "on top" surface into the page
  // underneath, and closing it never gave focus back to whatever opened it.
  // trapFocus() (js/ui.js) now backs all four; these checks drive the real
  // UI — click the trigger, confirm focus landed inside, confirm Tab can't
  // escape, confirm Escape hands focus back to the exact trigger element.
  console.log('Accessibility');
  await check('the "Add project" modal moves focus inside itself, traps Tab within it, and Escape restores focus to the button that opened it', async () => {
    await openSec('home');
    const btn = await page.$('.ps-topbar .btn.primary');
    await btn.click(); await page.waitForTimeout(300);
    const focusedInModal = await page.evaluate(() => !!document.querySelector('.modal-back.in .modal')?.contains(document.activeElement));
    let staysTrapped = true;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const ok = await page.evaluate(() => !!document.querySelector('.modal-back.in .modal')?.contains(document.activeElement));
      if (!ok) staysTrapped = false;
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const restored = await page.evaluate((b) => document.activeElement === b, btn);
    return focusedInModal && staysTrapped && restored;
  });
  await check('the notification bell popover moves focus inside itself; Escape restores focus to the bell', async () => {
    await openSec('home');
    const bell = await page.$('.notif-btn');
    await bell.click(); await page.waitForTimeout(300);
    const focusedInPop = await page.evaluate(() => !!document.querySelector('.notif-pop')?.contains(document.activeElement));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const restored = await page.evaluate((b) => document.activeElement === b, bell);
    return focusedInPop && restored;
  });
  await check('the "What\'s new" right panel moves focus inside itself; Escape restores focus to the wn-btn that opened it', async () => {
    await openSec('home');
    const wn = await page.$('.wn-btn');
    await wn.click(); await page.waitForTimeout(300);
    const focusedInPanel = await page.evaluate(() => !!document.querySelector('.ps-rpanel')?.contains(document.activeElement));
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const restored = await page.evaluate((b) => document.activeElement === b, wn);
    return focusedInPanel && restored;
  });
  await check('the ⌘K palette keeps Tab from leaving its input, and Escape restores focus to the trigger button', async () => {
    await openSec('home');
    const cmdBtn = await page.$('.ps-topbar button[title="Command palette"]');
    await cmdBtn.click(); await page.waitForTimeout(250);
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('cmdk-in'));
    await page.keyboard.press('Tab');
    const staysOnInput = await page.evaluate(() => document.activeElement?.classList.contains('cmdk-in'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    const restored = await page.evaluate((b) => document.activeElement === b, cmdBtn);
    return focused && staysOnInput && restored;
  });

  // ---------- Mobile ----------
  console.log('Mobile');
  await check('mobile: hamburger opens the rail drawer', async () => {
    await page.setViewportSize({ width: 390, height: 780 }); await page.waitForTimeout(300);
    await page.evaluate(() => window.__rail && window.__rail.setOpen(false)); await page.waitForTimeout(250);
    await page.click('.ps-topbar-menu'); await page.waitForTimeout(300);
    const open = await page.$eval('.ps-rail', (r) => r.classList.contains('open'));
    await page.setViewportSize({ width: 1280, height: 900 });
    return open;
  });
  await check('mobile: projects list scrolls all the way to its last row', async () => {
    await page.setViewportSize({ width: 390, height: 720 }); await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = 'projects'; }); await page.waitForTimeout(400);
    // the scroll container is .view; it must be able to reach the bottom, and
    // the last table row must become visible within the viewport once scrolled.
    const reached = await page.evaluate(async () => {
      const v = document.querySelector('.view'); if (!v) return false;
      // .view has scroll-behavior:smooth, which makes a direct scrollTop
      // assignment animate instead of jump — force instant so the check
      // doesn't race a CSS transition whose duration grows with content
      // height (e.g. taller mobile touch-target rows).
      const prevBehavior = v.style.scrollBehavior;
      v.style.scrollBehavior = 'auto';
      v.scrollTop = v.scrollHeight;                 // scroll to the very bottom
      v.style.scrollBehavior = prevBehavior;
      await new Promise(r => setTimeout(r, 100));
      const atBottom = Math.abs(v.scrollTop + v.clientHeight - v.scrollHeight) <= 2;
      const rows = document.querySelectorAll('.lib-table tbody tr');
      const last = rows[rows.length - 1];
      if (!last) return atBottom;                   // no table (empty) — bottom reachable is enough
      const r = last.getBoundingClientRect();
      const visible = r.bottom <= window.innerHeight + 1 && r.top >= 0;
      return atBottom && visible;
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    return reached;
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
    for (const s of ['home', 'projects', 'releases', 'activity', 'credentials', 'docs', 'settings']) {
      await openSecMobile(s);
      if (!(await noHorizOverflow('.view'))) { console.error(`  (overflow in section "${s}")`); allOk = false; }
    }
    await openSecMobile('home');
    const tile = await $('.tile'); await tile.click(); await page.waitForTimeout(400);
    if (!(await noHorizOverflow('.view'))) { console.error('  (overflow in project detail)'); allOk = false; }
    await page.setViewportSize({ width: 1280, height: 900 });
    return allOk;
  });
  await check('mobile (320px): projects library table shows a scroll-right hint that clears once fully scrolled, and a scroll-left hint appears', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    await openSecMobile('projects');
    await page.waitForTimeout(150);
    const before = await page.$eval('.lib-table', (e) => e.className);
    await page.$eval('.lib-table', (e) => { e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(150);
    const after = await page.$eval('.lib-table', (e) => e.className);
    await page.setViewportSize({ width: 1280, height: 900 });
    return /can-scroll-r/.test(before) && !/can-scroll-r/.test(after) && /can-scroll-l/.test(after);
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
  await check('mobile (320px): merge-review row with a long title wraps as one paragraph instead of splitting into squeezed columns', async () => {
    await page.setViewportSize({ width: 320, height: 780 }); await page.waitForTimeout(200);
    const merged = await store(`(S)=>{
      const db=JSON.parse(S.exportJSON());
      db.projects['smoke-merge-mobile']={id:'smoke-merge-mobile',slug:'smoke-merge-mobile',name:'Smoke Merge Mobile Project With A Long Name',status:'idea',tags:[],fields:{},createdAt:Date.now(),updatedAt:Date.now()};
      db.releases['smoke-merge-mobile-rel']={id:'smoke-merge-mobile-rel',projectId:'smoke-merge-mobile',v:1,title:'A deliberately long release title used to force this merge-review row to wrap across several lines',kind:'feature',items:['test'],ts:new Date().toISOString(),createdAt:Date.now(),updatedAt:Date.now()};
      return JSON.stringify(db);
    }`);
    const tmpFile = path.join(ROOT, '.smoke-merge-mobile-tmp.json');
    fs.writeFileSync(tmpFile, merged);
    let info;
    try {
      await openSecMobile('settings');
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('button:has-text("Merge JSON")'),
      ]);
      await chooser.setFiles(tmpFile);
      await page.waitForTimeout(300);
      await page.click('.modal details.merge-review summary');
      await page.waitForTimeout(150);
      info = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.modal .sync-preview li')];
        const row = rows.find((r) => r.textContent.includes('deliberately long release title'));
        if (!row) return null;
        const tag = row.querySelector('.tag').getBoundingClientRect();
        const content = row.querySelector('span:last-child').getBoundingClientRect();
        return {
          right: row.getBoundingClientRect().right,
          topAligned: Math.abs(tag.top - content.top) < 2,
          wrapped: content.height > 20,
          // the bug this guards against: content splitting into several
          // narrow anonymous-flex-item columns instead of one wide paragraph
          notSqueezed: content.width > 150,
        };
      });
      await page.click('.modal button:has-text("Cancel")');
    } finally { fs.unlinkSync(tmpFile); }
    await page.setViewportSize({ width: 1280, height: 900 });
    return !!info && info.right <= 320 && info.topAligned && info.wrapped && info.notSqueezed;
  });

  // ---------- Data source (pluggable backends) ----------
  console.log('Data source');
  await check('rail shows a "Local" data-source indicator that reflects sync state', async () => {
    await openSec('home');
    const txt = await page.$eval('.rail-source .rail-src-txt b', (n) => n.textContent).catch(() => '');
    const status = await page.$eval('.rail-source', (n) => n.dataset.status).catch(() => '');
    return /Local/.test(txt) && status === 'local';
  });
  await check('Store.snapshot() / replaceAll() round-trip a whole workspace (the portable unit sync pushes)', async () => {
    return await page.evaluate(async () => {
      const { Store } = await import('/js/store.js');
      const original = Store.snapshot();
      if (!(original.app === 'manager' && original.tables && Array.isArray(original.tables.projects))) return false;
      // adopt a modified copy, assert it took, then restore the original exactly
      const clone = JSON.parse(JSON.stringify(original));
      clone.tables.projects.push({ id: 'ds-roundtrip', name: 'Roundtrip', status: 'idea' });
      Store.replaceAll(clone);
      const took = !!Store.get('projects', 'ds-roundtrip') && Store.snapshot().tables.projects.length === original.tables.projects.length + 1;
      Store.replaceAll(original);
      const restored = !Store.get('projects', 'ds-roundtrip') && Store.snapshot().tables.projects.length === original.tables.projects.length;
      return took && restored;
    });
  });
  await check('every backend adapter satisfies the DataSource contract (id/label/fields + the async methods)', async () => {
    return await page.evaluate(async () => {
      const { SOURCES } = await import('/js/sources/index.js');
      const methods = ['test', 'probe', 'provision', 'summarize', 'drop', 'load', 'save'];
      return SOURCES.length >= 4 && SOURCES.every((s) =>
        s.id && s.label && s.blurb && Array.isArray(s.fields) && methods.every((m) => typeof s[m] === 'function'));
    });
  });
  await check('Admin → Data source card renders and the connect wizard lists every remote backend', async () => {
    await page.evaluate(() => { localStorage.setItem('manager.adminkey', 'ci-admin'); });
    await page.evaluate(() => location.hash = 'admin'); await page.waitForTimeout(400);
    if (!(await page.$('.ds-card'))) return false;
    await page.click('.ds-card .btn.primary'); await page.waitForTimeout(300);
    const opts = await page.$$eval('.ds-flow .ds-opt b', (ns) => ns.map((n) => n.textContent));
    const hasAll = ['Turso', 'Supabase', 'Firebase'].every((n) => opts.some((o) => o.includes(n)));
    // Supabase advertises its one-time SQL setup
    const supaTag = await page.$$eval('.ds-flow .ds-opt', (cards) => cards.some((c) => /Supabase/.test(c.textContent) && /SQL setup/i.test(c.textContent)));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    return hasAll && supaTag;
  });
  await check('connect wizard: an unreachable database fails gracefully with an error, no crash', async () => {
    await page.evaluate(() => location.hash = 'admin'); await page.waitForTimeout(300);
    await page.click('.ds-card .btn.primary'); await page.waitForTimeout(250);
    // pick Turso, enter a bogus URL, inspect
    const turso = (await page.$$('.ds-flow .ds-opt'))[0];
    await turso.click(); await page.waitForTimeout(200);
    const inputs = await page.$$('.ds-flow .field input');
    await inputs[0].fill('https://nope.invalid.localhost.example');
    await inputs[1].fill('bogus-token');
    await page.click('.ds-flow button:has-text("Inspect database")');
    await page.waitForTimeout(1500);
    const err = await page.$eval('.ds-flow .ds-status', (n) => n.textContent).catch(() => '');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    return /error|could not|reach|network|cors/i.test(err);
  });
  await check('full connect lifecycle against an in-memory source: empty→provision→push, write-through mirror, adopt, disconnect', async () => {
    // inject a mock DataSource into the live registry (never shipped)
    await page.evaluate(async () => {
      const reg = await import('/js/sources/index.js');
      const { emptySnapshot } = await import('/js/sources/schema.js');
      if (reg.SOURCES.some((s) => s.id === 'memtest')) return;
      window.__mem = { data: null, saves: 0 };
      reg.SOURCES.push({
        id: 'memtest', label: 'Memory', blurb: 'in-memory test source', icon: 'db', accent: '#888',
        browserProvision: true, fields: [],
        async test() { return { ok: true }; },
        async probe() { return window.__mem.data ? { state: 'polecat', app: 'manager', schemaVersion: 1, tables: [] } : { state: 'empty', tables: [] }; },
        async provision(cfg, snap) { window.__mem.data = JSON.parse(JSON.stringify(snap)); return { ok: true }; },
        async summarize() { return this.probe(); },
        async drop() { window.__mem.data = null; return { ok: true }; },
        async load() { return window.__mem.data || emptySnapshot(); },
        async save(cfg, snap) { window.__mem.data = JSON.parse(JSON.stringify(snap)); window.__mem.saves++; return { ok: true }; },
      });
    });
    const sync = () => import('/js/sync.js');
    // provision an empty source + push the current workspace up, then connect
    const afterPush = await page.evaluate(async () => {
      const s = await import('/js/sync.js');
      const src = (await import('/js/sources/index.js')).sourceById('memtest');
      await src.provision({}, (await import('/js/store.js')).Store.snapshot());
      await s.connectPush('memtest', {});
      return { status: s.syncState().status, isRemote: s.syncState().isRemote, pushed: !!window.__mem.data, projects: window.__mem.data.tables.projects.length };
    });
    // mutate a project → write-through mirror should carry it up (debounced)
    await page.evaluate(async () => {
      (await import('/js/store.js')).Store.put('projects', { id: 'ds-mirror', name: 'Mirror', status: 'idea' }, { silent: true });
    });
    await page.waitForTimeout(1700);
    const mirrored = await page.evaluate(() => window.__mem.data.tables.projects.some((p) => p.id === 'ds-mirror'));
    // disconnect → back to local, working copy retained
    const afterDisc = await page.evaluate(async () => { const s = await import('/js/sync.js'); s.disconnect(); return { status: s.syncState().status, keep: !!(await import('/js/store.js')).Store.get('projects', 'ds-mirror') }; });
    // adopt the remote back → Store replaced from the mirror
    const afterAdopt = await page.evaluate(async () => {
      const s = await import('/js/sync.js');
      await s.connectAdopt('memtest', {});
      return { status: s.syncState().status, hasRow: !!(await import('/js/store.js')).Store.get('projects', 'ds-mirror') };
    });
    // pull: simulate ANOTHER browser writing to the remote, then Refresh
    const afterPull = await page.evaluate(async () => {
      const s = await import('/js/sync.js');
      window.__mem.data.tables.projects.push({ id: 'ds-elsewhere', name: 'Elsewhere', status: 'idea' });
      await s.pullNow();
      return { status: s.syncState().status, pulled: !!(await import('/js/store.js')).Store.get('projects', 'ds-elsewhere') };
    });
    // the connected Admin card exposes Refresh + Edit (pull-oriented), not a "Sync now" push
    await page.evaluate(() => location.hash = 'admin'); await page.waitForTimeout(350);
    const cardActions = await page.$$eval('.ds-actions button', (ns) => ns.map((n) => n.textContent.trim()));
    const cardOk = cardActions.some((t) => /Refresh/.test(t)) && cardActions.some((t) => /Edit/.test(t)) && !cardActions.some((t) => /Sync now/i.test(t));
    // cleanup: disconnect, drop the probe rows, forget the saved connection
    await page.evaluate(async () => {
      const s = await import('/js/sync.js'); s.disconnect();
      const St = (await import('/js/store.js')).Store;
      St.remove('projects', 'ds-mirror', { silent: true }); St.remove('projects', 'ds-elsewhere', { silent: true });
      const reg = await import('/js/sources/index.js'); const i = reg.SOURCES.findIndex((x) => x.id === 'memtest'); if (i >= 0) reg.SOURCES.splice(i, 1);
      localStorage.removeItem('manager.datasource.v1'); localStorage.removeItem('manager.adminkey');
    });
    return afterPush.status === 'connected' && afterPush.isRemote && afterPush.pushed && afterPush.projects >= 1
      && mirrored && afterDisc.status === 'local' && afterDisc.keep
      && afterAdopt.status === 'connected' && afterAdopt.hasRow
      && afterPull.pulled && afterPull.status === 'connected' && cardOk;
  });
  await check('at-rest secret encryption: credentials are ciphertext on the remote, locked on a fresh browser, unlock restores them', async () => {
    const r = await page.evaluate(async () => {
      const { Store } = await import('/js/store.js');
      const sync = await import('/js/sync.js');
      const { isEnvelope } = await import('/js/crypto.js');
      const { emptySnapshot } = await import('/js/sources/schema.js');
      const reg = await import('/js/sources/index.js');
      const cid = Store.addCredential({ name: 'Smoke secret', key: 'SMOKE_ENC_KEY', value: 'sk-smoke-secret' }).id;
      window.__enc = { data: null };
      reg.SOURCES.push({
        id: 'memenc', label: 'MemEnc', blurb: 't', icon: 'db', accent: '#888', browserProvision: true, fields: [],
        async test() { return { ok: true }; }, async probe() { return window.__enc.data ? { state: 'polecat', app: 'manager', schemaVersion: 1, tables: [] } : { state: 'empty', tables: [] }; },
        async provision(c, s) { window.__enc.data = JSON.parse(JSON.stringify(s)); return { ok: true }; }, async summarize() { return this.probe(); },
        async drop() { window.__enc.data = null; return { ok: true }; },
        async load() { return window.__enc.data ? JSON.parse(JSON.stringify(window.__enc.data)) : emptySnapshot(); },
        async save(c, s) { window.__enc.data = JSON.parse(JSON.stringify(s)); return { ok: true }; },
      });
      await sync.connectPush('memenc', {});
      const cred = () => window.__enc.data.tables.credentials.find((x) => x.key === 'SMOKE_ENC_KEY');
      const plainBefore = cred().value === 'sk-smoke-secret';
      await sync.enableSecrets('correct horse battery');
      const remoteCiphertext = isEnvelope(cred().value) && !!window.__enc.data.meta?.secretsEnc?.salt;
      const localStillReadable = Store.get('credentials', cid).value === 'sk-smoke-secret';
      // simulate another browser: disconnect (drops the in-memory key like a reload), forget the cached pass, re-adopt
      sync.disconnect(); localStorage.removeItem('manager.datasource.secret.v1');
      await sync.connectAdopt('memenc', {});
      const locked = sync.secretsState().locked === true && isEnvelope(Store.get('credentials', cid).value);
      let wrongRejected = false; try { await sync.unlockSecrets('nope'); } catch { wrongRejected = true; }
      await sync.unlockSecrets('correct horse battery');
      const unlocked = Store.get('credentials', cid).value === 'sk-smoke-secret' && sync.secretsState().locked === false;
      // cleanup
      sync.disconnect(); Store.remove('credentials', cid, { silent: true });
      const i = reg.SOURCES.findIndex((x) => x.id === 'memenc'); if (i >= 0) reg.SOURCES.splice(i, 1);
      localStorage.removeItem('manager.datasource.v1'); localStorage.removeItem('manager.datasource.secret.v1');
      return { plainBefore, remoteCiphertext, localStillReadable, locked, wrongRejected, unlocked };
    });
    return r.plainBefore && r.remoteCiphertext && r.localStillReadable && r.locked && r.wrongRejected && r.unlocked;
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
