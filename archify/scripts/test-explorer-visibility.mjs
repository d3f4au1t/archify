import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../assets/repository-explorer.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function detail(n){'),html.indexOf('function drawBox(item,p){'));
const file={id:'file',kind:'file',x:100,y:100,w:2100,h:2000,header:128,children:[]};
const folder={id:'folder',kind:'folder',x:50,y:50,w:2400,h:2400,header:180,children:[file]};
const root={id:'root',kind:'folder',x:0,y:0,w:3000,h:3000,header:240,children:[folder]};
const scope={root,selected:null,camera:{x:0,y:0,k:.08},width:535,height:280,visible:[],readingPath:new Set(),readingReveal:0,children:n=>n.children,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
vm.runInNewContext(source,scope);
scope.collect(root);
assert.ok(!scope.visible.some(v=>v.n===file),'Unfocused small folders should stay collapsed');
scope.selected=file;scope.readingPath=new Set(['root','folder','file']);
let previous=0;
for(const reveal of [.25,.5,.75,1]){
  scope.visible=[];scope.readingReveal=reveal;scope.collect(root);
  const box=scope.visible.find(v=>v.n===file);
  assert.ok(box&&box.alpha>previous,'Selection must reveal its file progressively through collapsed parents');
  previous=box.alpha;
}
assert.equal(previous,1,'Fitted file must be fully visible in a short viewport');
assert.equal(scope.detail(file),0,'Small selected file keeps its readable collapsed title');
assert.equal(scope.detail(folder),1,'Expanded ancestor must release its collapsed title');
scope.readingReveal=0;scope.camera.k=1;scope.visible=[];scope.collect(root);
assert.equal(scope.detail(file),1,'Zooming in exposes file detail naturally');
assert.ok(scope.visible.some(v=>v.n===file));
console.log(JSON.stringify({ok:true,checks:['natural-collapse','progressive-selection-reveal','short-viewport-selection','single-owner-label-level','natural-file-detail']}));
