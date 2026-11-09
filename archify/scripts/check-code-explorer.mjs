import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const [artifactArg, evidenceArg] = process.argv.slice(2);
if (!artifactArg || !evidenceArg) throw new Error('Usage: node check-code-explorer.mjs <explorer.html> <evidence-directory>');
const artifact = resolve(artifactArg), out = resolve(evidenceArg);
await mkdir(out,{recursive:true});
const browser = new ChromeVisualBrowser(findChrome());
const checks = [], captures = [];
const session = await browser.sessionPromise;
async function evaluate(expression) {
 const result = await browser.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);
 if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
 return result.result.value;
}
const ready = async () => evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const poll=()=>{const f=document.getElementById('viewer');if(f?.getAttribute('aria-busy')==='false'&&f.contentDocument?.querySelector('[data-node-id]'))resolve(true);else if(Date.now()-start>15000)reject(new Error('Explorer frame did not become ready'));else setTimeout(poll,25)};poll()}).then(async()=>{const w=document.getElementById('viewer').contentWindow;await w.Archify?.layoutStability?.whenStable();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})`);
async function clickLevel(level) {
 await evaluate(`document.querySelector('[data-level="${level}"]').click()`);
 await ready();
 assert.equal(await evaluate('document.body.dataset.level'),String(level));
}
async function capture(name) {
 const screenshot = await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);
 const path = resolve(out,name+'.png');
 await writeFile(path,Buffer.from(screenshot.data,'base64'));
 captures.push(path);
}
try {
 // File previews embed HTML in srcdoc, where updating browser history can be forbidden.
 await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
 await browser.cdp.send('Page.navigate',{url:'about:blank'},session);
 await evaluate(`(async()=>{
  document.body.style.margin='0';
  const preview=document.createElement('iframe');
  preview.style='width:100%;height:100vh;border:0';
  preview.srcdoc=${JSON.stringify(await readFile(artifact,'utf8'))};
  document.body.append(preview);
  async function loaded(level) {
   const start=Date.now();
   while(Date.now()-start<5000) {
    const doc=preview.contentDocument, f=doc?.getElementById('viewer');
    if(doc?.body?.dataset.level===String(level)&&f?.getAttribute('aria-busy')==='false'&&f.contentDocument?.querySelector('[data-node-id]')) {
     await f.contentWindow.Archify?.layoutStability?.whenStable();
     if(f.getBoundingClientRect().height<200) throw new Error('Embedded diagram collapsed');
     return;
    }
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   throw new Error('Embedded preview is blank at level '+level);
  }
  await loaded(0);
  for(const level of [1,2,0]) {preview.contentDocument.querySelector('[data-level="'+level+'"]').click();await loaded(level);}
 })()`);
 await capture('embedded-preview'); checks.push('embedded-preview-all-levels');
 await browser.inspect({artifactPath:artifact,width:1440,height:1000,theme:'light'});
 await ready();
 assert.equal(await evaluate('document.body.dataset.level'),'0');
 await capture('project'); checks.push('initial-project');
 const areas = await evaluate(`Array.from(document.querySelector('#area').options,option=>option.value)`);
 for (const area of areas) {
  await evaluate(`(()=>{const select=document.getElementById('area');select.value=${JSON.stringify(area)};select.dispatchEvent(new Event('change'))})()`);
  await ready();
  assert.equal(await evaluate('document.body.dataset.area'),area);
  await clickLevel(1); await capture(area+'-files');
  const selected = await evaluate(`(()=>{const data=JSON.parse(document.getElementById('explorer-data').textContent);const area=data.areas.find(item=>item.id===document.body.dataset.area);const id=Object.keys(area.filesToMethods)[0];document.getElementById('viewer').contentDocument.querySelector('[data-node-id="'+id+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));return {file:id,method:area.filesToMethods[id][0]}})()`);
  await clickLevel(2);
  assert.equal(await evaluate(`new URLSearchParams(location.hash.slice(1)).get('file')`),selected.file);
  assert.equal(await evaluate(`document.getElementById('viewer').contentWindow.location.hash`),'');
  await capture(area+'-methods');
  await clickLevel(1); assert.equal(await evaluate(`new URLSearchParams(location.hash.slice(1)).get('file')`),selected.file);
  await clickLevel(0);
  checks.push(area+':buttons-context-and-return');
 }
 // Use real wheel input over empty diagram canvas, then wait for each new document.
 for (const expected of [1,2,1,0]) {
  const current = Number(await evaluate('document.body.dataset.level'));
  const point = await evaluate(`(()=>{const f=document.getElementById('viewer');const r=f.getBoundingClientRect();const p=f.contentDocument.querySelector('.diagram-container').getBoundingClientRect();return {x:r.x+p.x+8,y:r.y+p.y+8}})()`);
  await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:expected>current?-160:160},session);
  await evaluate('new Promise(resolve=>setTimeout(resolve,500))');
  await ready(); assert.equal(await evaluate('document.body.dataset.level'),String(expected));
 }
 checks.push('real-wheel-both-directions');
 // Keyboard node activation chooses its actual area before drill-down.
 const keyboardArea = await evaluate(`(()=>{const data=JSON.parse(document.getElementById('explorer-data').textContent);const a=data.areas[data.areas.length-1];document.getElementById('viewer').contentDocument.querySelector('[data-node-id="'+a.overviewNodes[0]+'"]').focus();return a.id})()`);
 await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'},session);
 await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',modifiers:1},session);
 await ready(); assert.equal(await evaluate('document.body.dataset.level'),'1');
 assert.equal(await evaluate('document.body.dataset.area'),keyboardArea);
 checks.push('keyboard-scale');
 await clickLevel(2);
 // Geometric zoom must unwind before semantic zoom returns to Files.
 await evaluate(`document.getElementById('viewer').contentDocument.querySelector('[data-view="in"]').click()`);
 assert.ok(await evaluate(`parseFloat(document.getElementById('viewer').contentDocument.querySelector('[data-view-percent]').textContent)>101`));
 for(let attempt=0;attempt<4 && await evaluate('document.body.dataset.level')==='2';attempt++) {
  const point=await evaluate(`(()=>{const f=document.getElementById('viewer'),r=f.getBoundingClientRect(),p=f.contentDocument.querySelector('.diagram-container').getBoundingClientRect();return {x:r.x+p.x+8,y:r.y+p.y+8}})()`);
  await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:160},session);
  await evaluate('new Promise(resolve=>setTimeout(resolve,500))'); await ready();
 }
 assert.equal(await evaluate('document.body.dataset.level'),'1'); checks.push('geometric-to-semantic-zoom-out');
 await clickLevel(2);
 const copied = await evaluate(`(()=>{const f=document.getElementById('viewer');const data=JSON.parse(document.getElementById('explorer-data').textContent);const a=data.areas.find(item=>item.id===document.body.dataset.area);const file=Object.keys(a.filesToMethods).at(-1),method=a.filesToMethods[file][0];f.contentDocument.querySelector('[data-node-id="'+method+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));const t=f.contentDocument.documentElement.getAttribute('data-reading-link-template');return {area:a.id,file,method,link:t.replace('{state}',encodeURIComponent('focus='+method))}})()`);
 const link=copied.link;
 await browser.cdp.send('Page.navigate',{url:link},session);
 await evaluate('new Promise(resolve=>setTimeout(resolve,250))'); await ready();
 assert.equal(await evaluate('document.body.dataset.level'),'2');
 assert.equal(await evaluate('document.body.dataset.area'),copied.area);
 assert.equal(await evaluate(`new URLSearchParams(location.hash.slice(1)).get('file')`),copied.file);
 assert.equal(await evaluate(`document.getElementById('viewer').contentWindow.location.hash`),'#focus='+copied.method);
 await clickLevel(1);assert.equal(await evaluate(`new URLSearchParams(location.hash.slice(1)).get('file')`),copied.file);await clickLevel(2);
 checks.push('reading-link-restoration');
 for (const [width,height] of [[1440,900],[390,844]]) {
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
  await evaluate('new Promise(resolve=>setTimeout(resolve,150))');
  const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,frame:document.getElementById('viewer').getBoundingClientRect().height})`);
  assert.ok(layout.scroll<=layout.width,'Explorer horizontal overflow'); assert.ok(layout.frame>200,'Explorer frame too short');
  if(width===390) {
   await clickLevel(0);
   assert.ok(await evaluate(`(()=>{const canvas=document.getElementById('viewer').contentDocument.querySelector('.diagram-container');return canvas.scrollWidth>canvas.clientWidth})()`),'Horizontal-scroll fixture must exceed the panel width');
   const point=await evaluate(`(()=>{const f=document.getElementById('viewer'),r=f.getBoundingClientRect(),p=f.contentDocument.querySelector('.diagram-container').getBoundingClientRect();return {x:r.x+p.x+8,y:r.y+p.y+8}})()`);
   await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:180,deltaY:0},session);
   await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
   assert.ok(await evaluate(`document.getElementById('viewer').contentDocument.querySelector('.diagram-container').scrollLeft>0`),'Narrow diagram cannot scroll sideways');
   checks.push('narrow-diagram-horizontal-scroll');
   await capture('project-panned-390');
   await clickLevel(2);
  }
  await capture('methods-'+width); checks.push('containment-'+width);
 }
 await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
 await evaluate(`document.getElementById('viewer').contentDocument.querySelector('#btn-theme').click()`);
 await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
 await capture('methods-dark');
 const receipt = {ok:true,command:'check-code-explorer',artifact:{path:artifact,sha256:createHash('sha256').update(await readFile(artifact)).digest('hex')},checks,captures};
 await writeFile(resolve(out,'explorer-check.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
} finally {await browser.close();}
