import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../assets/repository-explorer.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function methodLabelLines('),html.indexOf('function rounded('));
const scope={ctx:{measureText:value=>({width:value.length*7})}};
vm.runInNewContext(source,scope);
for(const name of ['slugify()','_replace_disallowed_unicode()','validateRepositorySource()','非常长的方法名称()']){
 const lines=Array.from(scope.methodLabelLines(name,140,'14px monospace'));
 assert.equal(lines.join(''),name,'Wrapping must preserve the exact symbol name');
 assert.ok(lines.length<=2&&lines.every(Boolean),'Use at most two nonempty label lines');
 assert.ok(scope.ctx.measureText(lines[0]).width<=140,'First line stays inside the method');
}
assert.deepEqual(Array.from(scope.methodLabelLines('_replace_disallowed_unicode()',140,'')),['_replace_disallowed_','unicode()']);
assert.deepEqual(Array.from(scope.methodLabelLines('slugify()',140,'')),['slugify()']);
console.log(JSON.stringify({ok:true,checks:['exact-symbol-name','underscore-boundary','long-unbroken-name','unicode-name','short-name']}));
