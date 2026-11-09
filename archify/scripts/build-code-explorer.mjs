import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const text = (value, name) => typeof value === 'string' && value.trim() ? value : fail(`${name} must be non-empty text.`);

export async function buildCodeExplorer(manifestPath, outputPath) {
 const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
 const base = dirname(resolve(manifestPath));
 const artifacts = [];
 let revision;
 async function artifact(entry, name) {
  const path = resolve(base,text(entry?.html,`${name}.html`));
  const receiptPath = resolve(base,text(entry?.receipt,`${name}.receipt`));
  const receipt = JSON.parse(await readFile(receiptPath,'utf8'));
  const bytes = await readFile(path);
  if (!receipt.ok || receipt.status !== 'pass' || receipt.command !== 'finalize' || !['validate','deliver','check','browser-check'].every(key=>receipt.gates?.[key]==='pass')) fail(`${name} requires a passing finalize receipt.`);
  if (resolve(receipt.artifact.path) !== path || digest(bytes) !== receipt.artifact.sha256) fail(`${name} artifact differs from its verified receipt.`);
  const specification = await readFile(receipt.specification.path);
  if (digest(specification) !== receipt.specification.sha256) fail(`${name} specification changed after validation.`);
  const spec = JSON.parse(specification);
  const repo = spec.meta?.repository;
  if (!repo?.revision) fail(`${name} must have pinned repository evidence.`);
  const identity = `${repo.url}@${repo.revision}`;
  if (revision && identity !== revision) fail('All levels must describe the same repository revision.');
  revision = identity;
  if (spec.diagram_type !== 'architecture' || !Array.isArray(spec.components)) fail(`${name} must be an Architecture diagram.`);
  const nodeIds = new Set(spec.components.map(node=>node.id));
  artifacts.push({name,path,sha256:digest(bytes),receipt:receiptPath});
  return {html:bytes.toString('base64'),nodeIds,spec};
 }
 const project = await artifact(manifest.project,'project');
 if (!Array.isArray(manifest.areas) || !manifest.areas.length) fail('At least one authored detail area is required.');
 const areaIds = new Set(), overviewOwners = new Set();
 const areas = [];
 for (const input of manifest.areas) {
  const id = text(input.id,'area.id');
  if (!/^[a-zA-Z][\w-]*$/.test(id) || areaIds.has(id)) fail(`Duplicate or invalid area ID: ${id}`);
  areaIds.add(id);
  const files = await artifact(input.files,`${id}.files`), methods = await artifact(input.methods,`${id}.methods`);
  if (!Array.isArray(input.overviewNodes) || !input.overviewNodes.length) fail(`${id} needs overviewNodes.`);
  for (const node of input.overviewNodes) {
   if (!project.nodeIds.has(node) || overviewOwners.has(node)) fail(`Missing or ambiguous overview node: ${node}`);
   overviewOwners.add(node);
  }
  const mapping = input.filesToMethods;
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object' || !Object.keys(mapping).length) fail(`${id} needs filesToMethods.`);
  const mappedMethods = new Set();
  for (const [file, children] of Object.entries(mapping)) {
   if (!files.nodeIds.has(file) || !Array.isArray(children) || !children.length) fail(`Invalid file mapping: ${file}`);
   const owner = files.spec.components.find(node=>node.id===file);
   for (const method of children) {
    if (!methods.nodeIds.has(method) || mappedMethods.has(method)) fail(`Missing or ambiguous method: ${method}`);
    const node = methods.spec.components.find(node=>node.id===method);
    if (node.type !== 'external' && !owner.sources?.some(source=>source.path===node.sources?.[0]?.path)) fail(`Method ${method} is not sourced from its mapped file ${file}.`);
    mappedMethods.add(method);
   }
  }
  if ([...files.nodeIds].some(node=>!Object.hasOwn(mapping,node)) || [...methods.nodeIds].some(node=>!mappedMethods.has(node))) fail(`${id} must map every displayed file/API and method node.`);
  const fileLabels = Object.fromEntries(files.spec.components.map(node=>[node.id,node.label]));
  areas.push({id,label:text(input.label,'area.label'),overviewNodes:input.overviewNodes,filesToMethods:mapping,fileLabels,files:{html:files.html},methods:{html:methods.html}});
 }
 const data = {title:text(manifest.title,'title'),coverage:text(manifest.coverage,'coverage'),project:{html:project.html},areas};
 const template = await readFile(new URL('../assets/code-explorer.html',import.meta.url),'utf8');
 const html = template.replace('__ARCHIFY_EXPLORER_DATA__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
 const output = resolve(outputPath);
 if (extname(output).toLowerCase() !== '.html') fail('Output must be an HTML file.');
 if (artifacts.some(item=>item.path===output)) fail('Explorer output must not overwrite an input diagram.');
 await mkdir(dirname(output),{recursive:true});
 const temp = `${output}.${randomUUID()}.tmp`;
 try { await writeFile(temp,html,{flag:'wx'}); await rename(temp,output); }
 finally { await unlink(temp).catch(error=>{if(error.code!=='ENOENT') throw error;}); }
 return {ok:true,command:'build-code-explorer',artifact:{path:output,sha256:digest(html)},repository:revision,areas:areas.map(area=>area.id),artifacts};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  if (process.argv.length !== 4) fail('Usage: node build-code-explorer.mjs <manifest.json> <output.html>');
  console.log(JSON.stringify(await buildCodeExplorer(process.argv[2],process.argv[3])));
 } catch(error) { console.error(error.message); process.exitCode=1; }
}
