import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {ChromeVisualBrowser,findChrome} from '../bin/visual-check.mjs';

const [input,directory]=process.argv.slice(2);
if(!input||!directory)throw new Error('Usage: node check-repository-explorer.mjs <html> <evidence-directory>');
const artifact=resolve(input),out=resolve(directory);await mkdir(out,{recursive:true});
const html=await readFile(artifact,'utf8');
const data=JSON.parse(html.match(/<script id="repository-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || 'null');
assert.ok(data?.nodes?.length,'Expected an indexed repository explorer');
const byId=new Map(data.nodes.map(n=>[n.id,n]));
const localCall=data.edges.find(e=>{const a=byId.get(e.from),b=byId.get(e.to);return a?.kind==='method'&&b?.kind==='method'&&a.id!==b.id&&a.parent===b.parent&&a.ownerName===b.ownerName;});
assert.ok(localCall,'Browser verification requires a file with a local method call');
const method=byId.get(localCall.from),file=byId.get(method.parent);
const browser=new ChromeVisualBrowser(findChrome()),session=await browser.sessionPromise,checks=[],captures=[],errors=[];
browser.cdp.subscribe(event=>{if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);});
async function evaluate(expression){const r=await browser.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function ready(){await evaluate(`new Promise((resolve,reject)=>{const start=Date.now();let previous='',stable=0;function check(){const c=document.getElementById('canvas');const state=c?.dataset.zoom+':'+c?.dataset.cameraX+':'+c?.dataset.cameraY;if(c?.dataset.ready==='true'&&state===previous)stable++;else stable=0;previous=state;if(stable>5)return resolve();if(Date.now()-start>12000)return reject(new Error('Canvas did not settle'));requestAnimationFrame(check)}check()})`);}
async function capture(name){const r=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);const p=resolve(out,name+'.png');await writeFile(p,Buffer.from(r.data,'base64'));captures.push(p);}
async function state(){return evaluate(`(()=>{const c=document.getElementById('canvas'),r=c.getBoundingClientRect();return{k:Number(c.dataset.zoom),x:Number(c.dataset.cameraX),y:Number(c.dataset.cameraY),left:r.x,top:r.y,width:r.width,height:r.height,level:c.dataset.level,pageX:scrollX,pageY:scrollY,selected:document.getElementById('inspector').dataset.node}})()`);}
async function search(node){
 const query=node.kind==='method'?node.path+' '+node.label:node.path;
 const detail=`${node.subtitle?node.subtitle+' · ':''}${node.kind} · ${node.path}${node.line?' · L'+node.line:''}`;
 await evaluate(`(()=>{const i=document.getElementById('search');i.value=${JSON.stringify(query)};i.dispatchEvent(new Event('input'));const button=Array.from(document.querySelectorAll('#results button')).find(b=>b.querySelector('small')?.textContent===${JSON.stringify(detail)});if(!button)throw new Error('No matching search result');button.click()})()`);await ready();
 assert.equal((await state()).selected,node.id);
}
try{
 await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
 await browser.cdp.send('Page.navigate',{url:pathToFileURL(artifact).href},session);await ready();
 assert.equal(await evaluate('document.querySelectorAll("iframe").length'),0);
 assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),true);
 await capture('project');checks.push('single-fixed-canvas');
 const before=await state(),point={x:before.left+before.width*.61,y:before.top+before.height*.46};
 const world={x:(point.x-before.left-before.x)/before.k,y:(point.y-before.top-before.y)/before.k};
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-35},session);
 await ready();const after=await state();assert.ok(after.k>before.k&&after.k<before.k*1.2,'Small wheel input must change scale continuously');
 assert.ok(Math.abs(world.x*after.k+after.x-(point.x-after.left))<.3,'Zoom must keep pointer world position');
 assert.ok(Math.abs(world.y*after.k+after.y-(point.y-after.top))<.3,'Vertical zoom anchor drift');
 assert.equal(after.pageY,0);assert.equal(after.pageX,0);checks.push('continuous-pointer-anchored-wheel');
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:35},session);await ready();assert.ok(Math.abs((await state()).k-before.k)<.00002);checks.push('reversible-zoom');
 for(const node of data.nodes.filter(n=>n.subtitle).slice(0,4)){
  await search(node);const {label:name,subtitle}=node;
  assert.equal(await evaluate(`document.querySelector('#inspector h2').textContent`),name);
  assert.equal(await evaluate(`document.querySelector('#inspector .subtitle').textContent`),subtitle);
  assert.equal(await evaluate(`document.querySelector('#breadcrumbs button:last-child').textContent`),name);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('#results button')).some(b=>b.firstChild.textContent===${JSON.stringify(name)})`));
 }
 if(data.nodes.some(n=>n.subtitle))checks.push('original-folder-file-names-with-descriptive-subtitles');
 await search(file);await capture('file-inventory');
 const fitted=await evaluate(`JSON.parse(document.getElementById('canvas').dataset.selectedBounds)`),space=await state();assert.ok(fitted.x>=0&&fitted.y>=0&&fitted.x+fitted.w<=space.width+.1&&fitted.y+fitted.h<=space.height+.1,'Selected file must fit after inspector opens');checks.push('fit-after-inspector-resize');
 const hasMethod=await evaluate(`document.getElementById('inspector').innerText.includes('Methods and constructors')`);assert.ok(hasMethod);checks.push('file-search-and-method-inventory');
 assert.ok(await evaluate(`document.getElementById('inspector').innerText.includes('Calls from')`));await capture('structured-methods');checks.push('class-groups-and-directed-call-chains');
 await search(method);assert.equal((await state()).level,'Methods');
 assert.ok(await evaluate(`document.getElementById('inspector').innerText.includes('Outgoing static links')`));
 const evidence=await evaluate(`Array.from(document.querySelectorAll('#inspector a')).find(a=>a.href.includes('/blob/'))?.href`);if(data.repository.url.startsWith('https://github.com/'))assert.ok(evidence?.includes('/blob/'+data.repository.revision+'/'));await capture('method-source');checks.push('method-search-source-and-links');
 const neighbors=await evaluate(`(()=>{const d=JSON.parse(document.getElementById('repository-data').textContent),id=document.getElementById('inspector').dataset.node;const edges=d.edges.filter(e=>e.from===id||e.to===id);return{expected:[...new Set([id,...edges.flatMap(e=>[e.from,e.to])])].sort(),actual:JSON.parse(document.getElementById('canvas').dataset.highlightedNodes).sort(),edges:edges.length,highlighted:Number(document.getElementById('canvas').dataset.highlightedEdges)}})()`);
 assert.ok(neighbors.expected.length>1);assert.deepEqual(neighbors.actual,neighbors.expected);assert.equal(neighbors.highlighted,neighbors.edges);checks.push('selected-method-highlights-callers-callees-and-edges');
 await evaluate(`Array.from(document.querySelectorAll('#inspector button')).find(b=>b.textContent==='Fit connections').click()`);await ready();await capture('highlighted-connections');
 await evaluate(`Array.from(document.querySelectorAll('#inspector button')).find(b=>b.textContent==='Zoom to method').click()`);await ready();
 await evaluate(`Array.from(document.querySelectorAll('#inspector .heading button')).find(b=>b.textContent==='Close').click()`);await ready();
 const dragStart=await state(),p={x:dragStart.left+dragStart.width/2,y:dragStart.top+dragStart.height/2};
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1},session);
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+100,y:p.y+40,button:'left',buttons:1},session);
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+100,y:p.y+40,button:'left',clickCount:1},session);await ready();
 const dragEnd=await state();assert.ok(Math.abs(dragEnd.x-dragStart.x-100)<1&&Math.abs(dragEnd.y-dragStart.y-40)<1);assert.equal(await evaluate(`document.getElementById('inspector').hidden`),true);checks.push('drag-pan-without-accidental-selection');
 await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},session);await ready();assert.deepEqual(await evaluate(`JSON.parse(document.getElementById('canvas').dataset.highlightedNodes)`),[]);checks.push('escape-clears-method-highlights');
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:-12,modifiers:2},session);await ready();assert.ok((await state()).k>dragEnd.k);checks.push('trackpad-pinch-wheel');
 await browser.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1},session);
 await evaluate(`document.getElementById('canvas').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,clientX:${p.x},clientY:${p.y}}))`);
 const cancelled=await state();await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+80,y:p.y,buttons:1,button:'left'},session);await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+80,y:p.y,button:'left',clickCount:1},session);await ready();assert.ok(Math.abs((await state()).x-cancelled.x)<1);checks.push('cancelled-drag-releases-pan');
 await evaluate(`document.getElementById('canvas').focus()`);const keyboardBefore=await state();await browser.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus'},session);await ready();assert.ok((await state()).k<keyboardBefore.k);checks.push('keyboard-zoom');
 if(data.flows.length){await evaluate(`document.getElementById('tour').value='0';document.getElementById('tour').dispatchEvent(new Event('change'))`);await ready();assert.ok(await evaluate(`document.getElementById('inspector').innerText.includes('Source-backed walkthrough')`));checks.push('guided-runtime-flow');}
 await evaluate(`document.getElementById('coverage').click()`);await ready();const beforeInspector=await state();const panelPoint=await evaluate(`(()=>{const r=document.getElementById('inspector').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...panelPoint,deltaX:0,deltaY:450},session);await evaluate('new Promise(r=>setTimeout(r,150))');assert.ok(await evaluate(`document.getElementById('inspector').scrollTop>0`));assert.equal((await state()).k,beforeInspector.k);assert.equal((await state()).pageY,0);checks.push('independent-inspector-scroll');
 await evaluate(`document.getElementById('fit').click()`);await ready();
 await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:535,height:850,deviceScaleFactor:1,mobile:false},session);await ready();
 await evaluate(`document.getElementById('fit').click()`);await ready();await capture('narrow-project');
 assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),true);
 assert.ok(await evaluate(`document.getElementById('coverage').getBoundingClientRect().width>0`),'Coverage must remain available in narrow preview');
 await search(file);await capture('narrow-file');assert.ok((await state()).width>=500);checks.push('narrow-canvas-and-overlay-details');
 await search(method);
 await evaluate(`Array.from(document.querySelectorAll('#inspector button')).find(b=>b.textContent==='Fit connections').click()`);await ready();
 assert.equal(await evaluate(`document.getElementById('inspector').hidden`),true);assert.ok(await evaluate(`JSON.parse(document.getElementById('canvas').dataset.highlightedNodes).length>1`));await capture('narrow-highlighted-connections');checks.push('narrow-fit-connections-uses-full-canvas');
 await evaluate(`document.getElementById('fit').click()`);await ready();const narrow=await state();
 for(const delta of [-120,-120,120,120])await browser.cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:narrow.left+narrow.width/2,y:narrow.top+narrow.height/2,deltaX:0,deltaY:delta},session);
 await ready();assert.equal((await state()).pageY,0);checks.push('no-page-scroll-during-zoom');
 await browser.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},session);
 await evaluate(`document.getElementById('in').click()`);await ready();checks.push('reduced-motion');
 await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
 await evaluate(`document.getElementById('theme').click();document.getElementById('fit').click()`);await ready();await capture('alternate-theme');
 const legacyNode=file.id;
 await browser.cdp.send('Page.navigate',{url:'about:blank'},session);
 await browser.cdp.send('Page.navigate',{url:pathToFileURL(artifact).href+'#x=-900000&y=-900000&z=4&node='+encodeURIComponent(legacyNode)},session);await ready();
 const restored=await evaluate(`JSON.parse(document.getElementById('canvas').dataset.selectedBounds)`),restoredSpace=await state();assert.ok(restored&&restored.x>=0&&restored.y>=0&&restored.x+restored.w<=restoredSpace.width+.1&&restored.y+restored.h<=restoredSpace.height+.1);checks.push('old-grid-reading-links-refit-selected-box');
 // An app preview has a srcdoc URL, which may reject browser history changes.
 await browser.cdp.send('Page.navigate',{url:'about:blank'},session);
 await evaluate(`(async()=>{document.body.style.margin='0';const f=document.createElement('iframe');f.style='width:100%;height:100vh;border:0';f.srcdoc=${JSON.stringify(html)};document.body.append(f);await new Promise((resolve,reject)=>{const start=Date.now();function check(){if(f.contentDocument?.getElementById('canvas')?.dataset.ready==='true')return resolve();if(Date.now()-start>5000)return reject(new Error('Embedded canvas blank'));setTimeout(check,25)}check()});f.contentDocument.getElementById('in').click()})()`);
 await capture('embedded-preview');checks.push('embedded-srcdoc-preview');
 assert.deepEqual(errors,[],'Unexpected browser errors');
 const receipt={ok:true,artifact:{path:artifact,sha256:createHash('sha256').update(html).digest('hex')},checks,captures};await writeFile(resolve(out,'repository-check.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await browser.close();}
