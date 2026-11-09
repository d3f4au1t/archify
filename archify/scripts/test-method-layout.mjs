import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const scope = {};
vm.runInNewContext(readFileSync(new URL('../assets/method-layout.js', import.meta.url), 'utf8'), scope);
const method = (id, line, ownerName='Example') => ({id, line, ownerName, label:id+'()', constructor:false});
function arrange(methods, edges) {
  const file = {children:structuredClone(methods)}, outgoing = new Map();
  for (const [from,to] of edges) { if (!outgoing.has(from)) outgoing.set(from, []); outgoing.get(from).push({from,to}); }
  scope.layoutMethods(file, outgoing);
  return file;
}
function valid(file) {
  assert.ok(Number.isFinite(file.w+file.h) && file.w>0 && file.h>0);
  const grouped=file.sections.flatMap(s=>s.blocks.flatMap(b=>Array.from(b.ids)));
  assert.deepEqual([...grouped].sort(),file.children.map(m=>m.id).sort());
  for (const m of file.children) {
    assert.ok(m.x>=24 && m.y>=file.header && m.x+m.w<=file.w-24 && m.y+m.h<=file.h-24,`Escaped file: ${m.id}`);
    for (const other of file.children) if (m!==other) assert.ok(m.x+m.w<=other.x || other.x+other.w<=m.x || m.y+m.h<=other.y || other.y+other.h<=m.y,`Overlap: ${m.id} / ${other.id}`);
  }
}
const methods=[method('entry',10),method('branch',20),method('shared',30),method('leaf',40),method('cycleA',50),method('cycleB',60),method('detached',70),method('nested',80,'Example.Nested'),{...method('Example',1),constructor:true}];
const edges=[['entry','branch'],['entry','shared'],['branch','shared'],['shared','leaf'],['cycleA','cycleB'],['cycleB','cycleA'],['cycleB','leaf'],['entry','nested'],['entry','external']];
const file=arrange(methods,edges);valid(file);const byId=new Map(file.children.map(m=>[m.id,m]));
for (const [a,b] of edges) if(byId.has(b)&&!a.startsWith('cycle')&&b!=='nested')assert.ok(byId.get(a).x<byId.get(b).x,`${a} must precede ${b}`);
assert.equal(byId.get('cycleA').x,byId.get('cycleB').x);
assert.equal(file.sections.length,2);
assert.ok(file.sections[0].blocks.some(b=>b.label.startsWith('Constructors')));
const reversed=arrange([...methods].reverse(),[...edges].reverse());
const positions=f=>f.children.map(m=>[m.id,m.x,m.y]).sort((a,b)=>a[0].localeCompare(b[0]));
assert.deepEqual(positions(file),positions(reversed));
valid(arrange([],[]));valid(arrange([method('self',1)],[['self','self']]));
valid(arrange(Array.from({length:76},(_,i)=>method('isolated'+i,i+1)),[]));
let files=0, declarations=0;
if(process.argv[2]){
  const data=JSON.parse(readFileSync(process.argv[2],'utf8')), outgoing=new Map();
  for(const edge of data.edges){if(!outgoing.has(edge.from))outgoing.set(edge.from,[]);outgoing.get(edge.from).push(edge);}
  for(const source of data.nodes.filter(n=>n.kind==='file')){
    const f={...source,children:data.nodes.filter(n=>n.parent===source.id).map(n=>({...n}))};scope.layoutMethods(f,outgoing);valid(f);files++;declarations+=f.children.length;
  }
}
console.log(JSON.stringify({ok:true,checks:['caller-before-callee','shared-target','recursive-cycle','class-separation','constructor-group','stable-source-order','empty-file','self-call','large-unlinked-class','no-overlap-or-escaped-methods'],files,declarations}));
