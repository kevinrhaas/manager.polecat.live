// Real Fleet Ops UI with mocked GitHub transport: no credentials or paid runs.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const server = http.createServer(async (req, res) => {
  try{
    if(req.url === '/test'){
      res.setHeader('content-type', 'text/html');
      res.end('<html data-palette="aurora" data-theme="dark"><head><link rel="stylesheet" href="/vendor/polecat-shell/tokens.css"><link rel="stylesheet" href="/vendor/polecat-shell/shell.css"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="view"></main></body></html>'); return;
    }
    const file = path.join(root, req.url.split('?')[0]);
    res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await fs.readFile(file));
  }catch{ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });
try{
  for(const width of [1280, 390]) for(const theme of ['dark', 'light']){
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], dispatches = [];
    page.on('pageerror', e => errors.push(e.message));
    let roster = { apps: { chicago: { enabled: false, slices: 3, model: 'claude-opus-5', max_turns: 400 } },
      lanes: { saved: { app: 'chicago', name: 'Saved model', enabled: false, model: 'custom-future-model', processor: 'codex', effort: 'high' } },
      jobs: { janitor: { enabled: false, everyHours: 1 } }, untouched: { keep: true } };
    await page.route('https://api.github.com/**', async route => {
      const req = route.request(), url = decodeURIComponent(req.url());
      let body = {};
      if(url.includes('/contents/.github/steward/focus.json')){
        if(req.method() === 'PUT'){
          const data = req.postDataJSON(); assert.equal(data.sha, 'test-sha');
          roster = JSON.parse(Buffer.from(data.content, 'base64').toString()); body = { content: { sha: 'new-sha' } };
        }else body = { sha: 'test-sha', content: Buffer.from(JSON.stringify(roster)).toString('base64') };
      }else if(url.includes('/dispatches')){
        dispatches.push(req.postDataJSON()); await route.fulfill({ status: 204 }); return;
      }else if(url.endsWith('/user')) body = { login: 'test-user' };
      else if(url.includes('/rate_limit')) body = { resources: {} };
      else body = [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(base + '/test');
    await page.evaluate(async theme => {
      document.documentElement.dataset.theme = theme;
      const { Store } = await import('/js/store.js');
      const { setFleetOpsCfg } = await import('/js/github.js');
      const cred = Store.addCredential({ name: 'Test', value: 'fake-offline-token' });
      setFleetOpsCfg({ credId: cred.id });
      const { renderFleetOps } = await import('/js/views/fleetops.js');
      renderFleetOps(document.querySelector('#view'), { go(){} });
    }, theme);
    await page.getByLabel('Schedule details for chicago / Saved model', { exact: true }).click();
    assert.equal(await page.getByLabel('Custom model ID for chicago / Saved model', { exact: true }).inputValue(), 'custom-future-model');
    await page.getByLabel('App for new lane').selectOption('chicago');
    await page.getByRole('button', { name: 'Add lane', exact: true }).click();
    await page.getByLabel('Processor for chicago / New lane', { exact: true }).selectOption('codex');
    await page.getByLabel('Model for chicago / New lane', { exact: true }).selectOption('gpt-6-astra');
    await page.getByLabel('Effort for chicago / New lane', { exact: true }).selectOption('xhigh');
    await page.getByLabel('Slices per run for chicago / New lane', { exact: true }).selectOption('2');
    await page.getByRole('button', { name: 'Commit roster', exact: true }).click();
    await page.getByRole('button', { name: 'Commit to main', exact: true }).click();
    await page.getByText('Roster committed', { exact: true }).waitFor();
    const added = Object.entries(roster.lanes).find(([key]) => key !== 'saved');
    assert.ok(added);
    assert.equal(added[1].processor, 'codex'); assert.equal(added[1].model, 'gpt-6-astra');
    assert.equal(added[1].effort, 'xhigh'); assert.equal(added[1].slices, 2); assert.equal(added[1].enabled, false);
    assert.equal(roster.apps.chicago.max_turns, 400); assert.equal(roster.lanes.saved.model, 'custom-future-model');
    assert.equal(roster.untouched.keep, true);
    await page.getByLabel('Run once for chicago / New lane', { exact: true }).click();
    await page.getByText('Improve runs dispatched', { exact: true }).waitFor();
    assert.equal(dispatches.length, 2);
    assert.equal(dispatches[0].inputs.processor, 'codex'); assert.equal(dispatches[1].inputs.slice, '2');
    assert.equal(dispatches[0].inputs.effort, 'xhigh');
    assert.equal(dispatches[0].inputs.lane, dispatches[1].inputs.lane);
    assert.notEqual(dispatches[0].inputs.lane, added[0]);
    await page.getByLabel('Processor for one-off run', { exact: true }).selectOption('claude');
    await page.getByLabel('Model for one-off run', { exact: true }).selectOption('claude-opus-5-5');
    await page.getByLabel('Effort for one-off run', { exact: true }).selectOption('max');
    await page.getByLabel('Concurrent one-off runs').selectOption('3');
    await page.getByRole('button', { name: 'Improve run', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Improve run')?.disabled);
    assert.equal(dispatches.length, 5);
    assert.equal(dispatches[2].inputs.model, 'claude-opus-5-5');
    assert.equal(dispatches[2].inputs.effort, 'max');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
    assert.deepEqual(errors, []);
    await fs.mkdir('/tmp/fleet-lanes-shots', { recursive: true });
    await page.screenshot({ path: `/tmp/fleet-lanes-shots/${width}-${theme}.png`, fullPage: true });
    await page.close();
    console.log(`Fleet lane save/dispatch/custom model/overflow passed: ${width}px ${theme}`);
  }
}finally{ await browser.close(); server.close(); }
