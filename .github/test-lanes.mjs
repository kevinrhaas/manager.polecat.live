import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const harness = `<!doctype html><html data-palette="manager" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/polecat-shell/tokens.css"><link rel="stylesheet" href="/vendor/polecat-shell/shell.css"><link rel="stylesheet" href="/css/styles.css"></head><body><main id="view"></main><div id="toasts"></div></body></html>`;
const server = http.createServer((req,res) => {
  if(req.url === '/test'){ res.setHeader('Content-Type','text/html'); res.end(harness); return; }
  const file = path.join(root, req.url.split('?')[0]);
  fs.readFile(file,(err,data) => { res.writeHead(err?404:200,{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'});res.end(err?'missing':data); });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({executablePath:process.env.PW_EXECUTABLE || undefined});
try {
  for(const width of [1280,390]){
    let roster = {apps:{chicago:{enabled:false,everyHours:1,slices:3,model:'claude-opus-5-5',effort:'max'}},jobs:{janitor:{enabled:false,everyHours:1}}};
    let saved, dispatch;
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://api.github.com/**',async route=>{
      const req=route.request();
      if(req.url().includes('focus.json')){
        if(req.method()==='PUT'){saved=JSON.parse(req.postData());roster=JSON.parse(Buffer.from(saved.content,'base64'));await route.fulfill({json:{content:{sha:'updated'}}});}
        else await route.fulfill({json:{sha:'original',content:Buffer.from(JSON.stringify(roster)).toString('base64')}});
      }else if(req.url().endsWith('/dispatches')){dispatch=JSON.parse(req.postData());await route.fulfill({status:204});}
      else if(req.url().endsWith('/user')) await route.fulfill({json:{login:'fixture'}});
      else await route.fulfill({json:{resources:{},workflow_runs:[]}});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/test`);
    const render=async()=>page.evaluate(async()=>{
      const {Store}=await import('/js/store.js');
      const g=await import('/js/github.js');
      if(!g.ghToken()) {const c=Store.addCredential({name:'test',value:'fixture-not-a-token'});g.setFleetOpsCfg({credId:c.id});}
      g.clearGhCache();
      const {renderFleetOps}=await import('/js/views/fleetops.js');renderFleetOps(document.querySelector('#view'),{go(){}});
    });
    await render();
    await page.getByRole('button',{name:'Add lane for this app',exact:true}).click();
    const name='chicago · chicago-lane-2';
    await page.getByLabel(`Processor for ${name}`,{exact:true}).selectOption('gpt');
    await page.getByLabel(`Model for ${name}`,{exact:true}).selectOption('gpt-6-astra');
    await page.getByLabel(`Effort for ${name}`,{exact:true}).selectOption('xhigh');
    await page.getByLabel(`Slices per run for ${name}`,{exact:true}).selectOption('2');
    await page.getByRole('button',{name:'Commit roster',exact:true}).click();
    await page.getByRole('button',{name:'Commit to main',exact:true}).click();
    await page.getByText('Roster committed',{exact:true}).waitFor();
    assert.equal(saved.sha,'original');
    assert.equal(roster.apps.chicago.effort,'max');
    assert.deepEqual(roster.lanes['chicago-lane-2'],{enabled:false,everyHours:1,slices:2,model:'gpt-6-astra',effort:'xhigh',app:'chicago',processor:'gpt'});
    await render();
    assert.equal(await page.getByLabel(`Effort for ${name}`,{exact:true}).inputValue(),'xhigh');
    await page.getByLabel(`Model for ${name}`,{exact:true}).selectOption('custom');
    await page.getByLabel(`Exact model ID for ${name}`,{exact:true}).fill('gpt-private-deployment');
    await page.getByRole('button',{name:'Commit roster',exact:true}).click();
    await page.getByRole('button',{name:'Commit to main',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.toast')].some(t=>/Roster committed/.test(t.textContent)));
    await render();
    assert.equal(await page.getByLabel(`Exact model ID for ${name}`,{exact:true}).inputValue(),'gpt-private-deployment');
    await page.getByLabel('Processor for one-off run',{exact:true}).selectOption('gpt');
    await page.getByLabel('Model for one-off run',{exact:true}).selectOption('gpt-6-astra');
    await page.getByLabel('Effort for one-off run',{exact:true}).selectOption('high');
    await page.getByRole('button',{name:'Improve run',exact:true}).click();
    await page.getByText('Improve run dispatched',{exact:true}).waitFor();
    assert.equal(dispatch.inputs.processor,'gpt');assert.equal(dispatch.inputs.effort,'high');
    await page.getByLabel('Model for chicago',{exact:true}).selectOption('claude-haiku-4-5');
    assert.equal(await page.getByLabel('Effort for chicago',{exact:true}).isDisabled(),true);
    for(const theme of ['dark','light']){
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${theme} overflow`);
      await page.screenshot({path:`/tmp/fleet-lanes-${width}-${theme}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    await page.close();console.log(`Fleet lane save/reload, custom models, dispatch, and layout ${width}px: PASS`);
  }
} finally { await browser.close();server.close(); }
