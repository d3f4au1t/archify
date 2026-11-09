import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../assets/repository-explorer.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function drawEdges(p){'),html.indexOf('function breadcrumb(n){'));
function render(height,kind='method'){
  const nodes=new Map(['a','b','c'].map(id=>[id,{id,kind,parent:'owner',path:id}]));
  const visible=[...nodes.values()].map((n,i)=>({n,x:i*400,y:0,w:280,h:height,alpha:1}));
  const strokes=[],heads=[];let path=[];
  const ctx={save(){},restore(){},setLineDash(){},beginPath(){path=[];},
    moveTo(...p){path.push(p);},lineTo(...p){path.push(p);},
    bezierCurveTo(...p){path.push(p);},closePath(){},
    stroke(){strokes.push(path);},fill(){heads.push(path);}};
  const edges=[{from:'a',to:'b',kind:'call'},{from:'b',to:'a',kind:'call'},{from:'b',to:'c',kind:'reference'}];
  const scope={ctx,nodes,visible,data:{edges},root:{id:'root'},edgeMode:'all',selected:null,focus:{ids:new Set()},canvas:{dataset:{}}};
  vm.runInNewContext(source,scope);scope.drawEdges({edge:'#789',selected:'#abc'});
  assert.equal(heads.length,edges.length,'Exactly one head per connection');
  for(let i=0;i<edges.length;i++){
    const a=visible.find(v=>v.n.id===edges[i].from),b=visible.find(v=>v.n.id===edges[i].to);
    const start=strokes[i][0],end=strokes[i][1].slice(-2),head=heads[i];
    assert.deepEqual(head[0],end,'Head must sit at the destination');
    assert.equal(end[0],b.x>a.x?b.x:b.x+b.w,'Tip must touch destination boundary');
    assert.ok(start[1]>a.y+a.h/2&&end[1]<b.y+b.h/2,'Outgoing tails and incoming tips must use separate ports');
    assert.ok(head.slice(1).every(p=>(end[0]-p[0])*(b.x>a.x?1:-1)>0),'Head must point into the destination');
    assert.ok(head.every(p=>p[1]>=b.y&&p[1]<=b.y+b.h),'Small boxes must contain their arrowheads');
  }
  assert.notDeepEqual(strokes[0][0],heads[1][0],'Opposing directions must not share an endpoint');
  assert.notDeepEqual(strokes[1][0],heads[0][0],'Opposing directions must not share an endpoint');
}
for(const height of [4,12,66,300])for(const kind of ['method','file','folder'])render(height,kind);
console.log(JSON.stringify({ok:true,scenarios:12,checks:['one-destination-head','left-and-right-directions','separate-incoming-outgoing-ports','reciprocal-links','small-box-head-bounds']}));
