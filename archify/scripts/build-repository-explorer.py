#!/usr/bin/env python3
"""Build a local, source-indexed atlas from a pinned Git revision. Requires JDK 17+."""
import argparse
import ast
import collections
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit, urlunsplit


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def category(path):
    if '/samples/' in path:
        return 'SDK samples'
    if path.startswith('scripts/tests/') or Path(path).name.startswith('test-'):
        return 'Tests and stubs'
    if path.startswith('TeamCode/'):
        return 'Robot code'
    if path.startswith('PedroCore/'):
        return 'Local Pedro core'
    if path.startswith('FtcRobotController/'):
        return 'Robot controller'
    if path.startswith('scripts/'):
        return 'Tools'
    if path.startswith('docs/') or path.endswith('.md'):
        return 'Documentation'
    return 'Build and resources'


def python_symbols(path, source):
    tree = ast.parse(source, filename=path)
    methods = []
    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.stack = []
        def visit_ClassDef(self, node):
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()
        def visit_FunctionDef(self, node):
            owner = '.'.join(self.stack)
            name = '.'.join([*self.stack, node.name])
            item = {'id': path+'#'+name+'@'+str(node.lineno), 'path': path, 'name': node.name,
                    'ownerName': owner, 'line': node.lineno, 'endLine': node.end_lineno,
                    'signature': ('async ' if isinstance(node, ast.AsyncFunctionDef) else '')+'def '+node.name+'('+ast.unparse(node.args)+')',
                    'doc': ast.get_docstring(node) or '', 'calls': [], 'params': [], 'language': 'Python'}
            bound = {a.arg for a in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]}
            if node.args.vararg:
                bound.add(node.args.vararg.arg)
            if node.args.kwarg:
                bound.add(node.args.kwarg.arg)
            class Calls(ast.NodeVisitor):
                def visit_FunctionDef(self, n):
                    bound.add(n.name)
                visit_AsyncFunctionDef = visit_FunctionDef
                def visit_ClassDef(self, n):
                    bound.add(n.name)
                def visit_Name(self, n):
                    if isinstance(n.ctx, ast.Store):
                        bound.add(n.id)
                def visit_Import(self, n):
                    bound.update(a.asname or a.name.split('.')[0] for a in n.names)
                def visit_ImportFrom(self, n):
                    bound.update(a.asname or a.name for a in n.names)
                def visit_Lambda(self, n):
                    # A nested callable's parameters must not resolve to same-named globals.
                    bound.update(a.arg for a in [*n.args.posonlyargs, *n.args.args, *n.args.kwonlyargs])
                    self.generic_visit(n)
                def visit_Call(self, n):
                    expr = ast.unparse(n.func)
                    item['calls'].append({'name': expr.split('.')[-1], 'receiver': expr.rsplit('.', 1)[0] if '.' in expr else '',
                                          'line': n.lineno, 'arity': len(n.args), 'text': (ast.get_source_segment(source, n) or expr)[:500], 'callback': False})
                    self.generic_visit(n)
            for statement in node.body:
                Calls().visit(statement)
            item['boundNames'] = sorted(bound)
            methods.append(item)
            self.stack.append(node.name)
            self.generic_visit(node)
            self.stack.pop()
        visit_AsyncFunctionDef = visit_FunctionDef
    Visitor().visit(tree)
    return methods


def resolve_java(index):
    """Conservative declared-type links, not a compiler or runtime call graph."""
    classes = {c['id']: c for c in index['classes']}
    files = {f['path']: f for f in index['files']}
    qualified = collections.defaultdict(list)
    for c in classes.values():
        qualified[c['qualified']].append(c)
    methods = collections.defaultdict(list)
    for m in index['methods']:
        methods[(m['owner'], m['name'])].append(m)

    def choose(candidates, path):
        own = [c for c in candidates if c['path'] == path]
        if len(own) == 1:
            return own[0]
        runtime = not path.startswith('scripts/')
        candidates = [c for c in candidates if not c['path'].startswith('scripts/')] if runtime else candidates
        same_module = [c for c in candidates if c['path'].split('/')[0] == path.split('/')[0]]
        if len(same_module) == 1:
            return same_module[0]
        return candidates[0] if len(candidates) == 1 else None

    def type_class(type_name, context):
        if not type_name:
            return None
        name = re.sub(r'<.*>', '', type_name).replace('[]', '').strip()
        if not re.fullmatch(r'[\w.]+', name):
            return None
        path = context['path']
        f = files[path]
        direct = choose(qualified.get(name, []), path)
        if direct:
            return direct
        # Explicit imports and lexical nesting precede same-package and wildcard lookup.
        for imp in f['imports']:
            if not imp['static'] and imp['name'].split('.')[-1] == name.split('.')[0]:
                suffix = name[len(name.split('.')[0]):]
                return choose(qualified.get(imp['name']+suffix, []), path)
        c = context
        while c:
            if c['name'] == name:
                return c
            nested = choose(qualified.get(c['qualified']+'.'+name, []), path)
            if nested:
                return nested
            c = classes.get(c.get('parent'))
        local = choose(qualified.get(f['package']+'.'+name, []), path)
        if local:
            return local
        matches = []
        for imp in f['imports']:
            if not imp['static'] and imp['name'].endswith('.*'):
                matches += qualified.get(imp['name'][:-1]+name, [])
        return choose(matches, path)

    def ancestors(c, seen=None):
        seen = set() if seen is None else seen
        if not c or c['id'] in seen:
            return
        seen.add(c['id'])
        yield c
        for parent in c['supers']:
            yield from ancestors(type_class(parent, c), seen)

    def field_type(c, name):
        for owner in ancestors(c):
            matches = [v for v in owner['fields'] if v['name'] == name]
            if len(matches) == 1:
                return type_class(matches[0]['type'], owner)
        return None

    def receiver_class(expr, method, call):
        owner = classes[method['owner']]
        if not expr or expr == 'this':
            return owner
        if expr == 'super':
            return type_class(owner['supers'][0], owner) if owner['supers'] else None
        if not re.fullmatch(r'[\w.]+', expr):
            return None
        parts = expr.split('.')
        if parts[0] == 'this':
            current = owner
        else:
            variables = [v for v in method['variables'] if v['name'] == parts[0] and v['line'] <= call['line'] <= v['scopeEnd']]
            parameters = [v for v in method['params'] if v['name'] == parts[0]]
            if variables:
                current = type_class(max(variables, key=lambda v: v['line'])['type'], owner)
            elif parameters:
                current = type_class(parameters[0]['type'], owner)
            else:
                current = field_type(owner, parts[0]) or type_class(parts[0], owner)
            if current is None:
                return type_class(expr, owner)
        for part in parts[1:]:
            current = field_type(current, part) if current else None
        return current

    for m in index['methods']:
        m['language'] = 'Java'
        m['ownerName'] = classes[m['owner']]['qualified'].split(files[m['path']]['package']+'.')[-1]
        for call in m['calls']:
            call['text'] = call['text'][:500]
            context = classes[m['owner']]
            receiver = type_class(call['receiver'], context) if call.get('constructor') else receiver_class(call['receiver'], m, call)
            found = []
            signatures = set()
            owners = [receiver] if receiver and call.get('constructor') else ancestors(receiver)
            for owner in owners:
                name = owner['name'] if call.get('constructor') else call['name']
                candidates = methods.get((owner['id'], name), [])
                candidates = [candidate for candidate in candidates if call['arity'] == -1 or len(candidate['params']) == call['arity']]
                for candidate in candidates:
                    signature = tuple(p['type'] for p in candidate['params'])
                    if signature not in signatures:
                        found.append(candidate)
                        signatures.add(signature)
            if len(found) == 1:
                call['target'] = found[0]['id']
                call['resolution'] = 'declared receiver; unique name and arity' if not call.get('reference') else 'method reference; unique declaration'
            else:
                call['unresolved'] = 'overload is ambiguous' if len(found) > 1 else 'external, dynamic, inherited-library, or unbound receiver'
    dependencies = []
    for f in index['files']:
        own_classes = [c for c in classes.values() if c['path'] == f['path']]
        if not own_classes:
            continue
        for imp in f['imports']:
            name = imp['name'].rsplit('.', 1)[0] if imp['static'] else imp['name']
            target = type_class(name, own_classes[0])
            if target and target['path'] != f['path']:
                dependencies.append({'from': 'file:'+f['path'], 'to': 'file:'+target['path'], 'kind': 'import', 'line': imp['line'], 'text': imp['name']})
    return dependencies


def build(repo, revision, output, notes_path=None):
    repo = Path(repo).resolve()
    revision = git(repo, 'rev-parse', revision+'^{commit}').decode().strip()
    paths = git(repo, 'ls-tree', '-r', '--name-only', revision).decode().splitlines()
    remote = git(repo, 'remote', 'get-url', 'origin').decode().strip()
    parsed = urlsplit(remote)
    if parsed.scheme in ('http', 'https'):
        host = parsed.hostname or ''
        if parsed.port:
            host += ':'+str(parsed.port)
        remote = urlunsplit((parsed.scheme, host, parsed.path, '', ''))
    if remote.startswith('git@github.com:'):
        remote = 'https://github.com/'+remote.split(':', 1)[1]
    remote = remote.removesuffix('.git')
    notes = json.loads(Path(notes_path).read_text()) if notes_path else {'areas': [], 'flows': []}
    if notes_path and notes.get('revision') != revision:
        raise ValueError('Notes must name the exact indexed revision.')
    sources = {}
    with tempfile.TemporaryDirectory(prefix='archify-index-') as temporary:
        root = Path(temporary)
        archive = git(repo, 'archive', revision)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(root, filter='data')
        java = subprocess.run(['java', str(Path(__file__).with_name('IndexJava.java')), str(root)], capture_output=True, text=True)
        if java.returncode:
            raise RuntimeError('Java parse failed: '+java.stderr+'\n'+java.stdout[-2500:])
        index = json.loads(java.stdout)
        imports = resolve_java(index)
        all_methods = index['methods']
        for path in paths:
            if Path(path).suffix in ('.java', '.py'):
                sources[path] = (root/path).read_text(encoding='utf-8')
            if path.endswith('.py'):
                all_methods.extend(python_symbols(path, sources[path]))
        py_names = collections.defaultdict(list)
        for m in all_methods:
            if m['language'] == 'Python':
                py_names[(m['path'], m['ownerName'], m['name'])].append(m)
        for m in all_methods:
            if m['language'] != 'Python':
                continue
            for call in m['calls']:
                owner = m['ownerName'] if call['receiver'] in ('self', 'cls') else ''
                enclosing = [outer for outer in all_methods if outer['language'] == 'Python' and outer['path'] == m['path'] and outer['line'] < m['line'] <= outer['endLine']]
                shadowed = call['receiver'] == '' and any(call['name'] in scope.get('boundNames', []) for scope in [m, *enclosing])
                found = py_names.get((m['path'], owner, call['name']), []) if not shadowed and call['receiver'] in ('', 'self', 'cls') else []
                if len(found) == 1:
                    call['target'] = found[0]['id']
                    call['resolution'] = 'same-file lexical name (Python dynamic binding remains possible)'
                else:
                    call['unresolved'] = 'external, dynamic, or unbound receiver'
        file_sizes = {p: (root/p).stat().st_size for p in paths if (root/p).is_file()}

    nodes = [{'id': 'root', 'kind': 'folder', 'label': repo.name, 'path': '', 'parent': None, 'category': 'Project'}]
    folders = set()
    for path in paths:
        parent = Path(path).parent
        while str(parent) != '.':
            folders.add(parent.as_posix())
            parent = parent.parent
    for path in sorted(folders):
        parent = Path(path).parent.as_posix()
        nodes.append({'id': 'dir:'+path, 'kind': 'folder', 'label': Path(path).name, 'path': path,
                      'parent': 'root' if parent == '.' else 'dir:'+parent, 'category': category(path+'/')})
    classes_by_file = collections.defaultdict(list)
    for c in index['classes']:
        classes_by_file[c['path']].append({'name': c['qualified'], 'line': c['line'], 'supers': c['supers'], 'fields': c['fields']})
    java_files = {f['path']: f for f in index['files']}
    for path in paths:
        parent = Path(path).parent.as_posix()
        nodes.append({'id': 'file:'+path, 'kind': 'file', 'label': Path(path).name, 'path': path,
                      'parent': 'root' if parent == '.' else 'dir:'+parent, 'category': category(path),
                      'bytes': file_sizes.get(path, 0), 'language': 'Java' if path.endswith('.java') else 'Python' if path.endswith('.py') else 'File',
                      'classes': classes_by_file.get(path, []), 'imports': java_files.get(path, {}).get('imports', []),
                      'summary': 'Declaration and call-site index' if path in sources else 'Tracked file; contents are not method-indexed'})
    edges = list(imports)
    for m in all_methods:
        nodes.append({'id': m['id'], 'kind': 'method', 'label': m['name']+'()', 'path': m['path'], 'parent': 'file:'+m['path'],
                      'category': category(m['path']), 'language': m['language'], 'ownerName': m['ownerName'],
                      'line': m['line'], 'endLine': m['endLine'], 'signature': m['signature'], 'constructor': m.get('constructor', False),
                      'summary': re.sub(r'<[^>]*>', '', m['doc']).strip()[:1200], 'calls': m['calls']})
        for call in m['calls']:
            if call.get('target'):
                edges.append({'from': m['id'], 'to': call['target'], 'kind': 'reference' if call.get('reference') else 'call',
                              'line': call['line'], 'text': call['text'], 'callback': call.get('callback', False), 'resolution': call['resolution']})
    by_id = {n['id']: n for n in nodes}
    for area in notes.get('areas', []):
        node = by_id.get('dir:'+area['path']) or by_id.get('file:'+area['path'])
        if not node:
            raise ValueError('Area references a missing path: '+area['path'])
        node['summary'] = area['summary']
        node['subtitle'] = area['label']
    for flow in notes.get('flows', []):
        for step in flow['steps']:
            matches = [n for n in nodes if n['kind'] == 'method' and n['path'] == step['path'] and n['label'] == step['symbol']+'()']
            if len(matches) > 1:
                matches = [n for n in matches if n['line'] <= step['line'] <= n['endLine']]
            if len(matches) != 1 or not matches[0]['line'] <= step['line'] <= matches[0]['endLine']:
                raise ValueError('Flow must name one indexed symbol and a line within it: '+str(step))
            step['node'] = matches[0]['id']
    calls = [c for m in all_methods for c in m['calls']]
    data = {'version': 1, 'title': repo.name+' · Repository explorer', 'repository': {'url': remote, 'revision': revision},
            'nodes': nodes, 'edges': edges, 'sources': sources, 'flows': notes.get('flows', []),
            'coverage': {'files': len(paths), 'folders': len(folders), 'javaFiles': len(index['files']),
                         'pythonFiles': sum(p.endswith('.py') for p in paths), 'methods': len(all_methods),
                         'callSites': len(calls), 'resolvedCalls': sum(bool(c.get('target')) for c in calls),
                         'unresolvedCalls': sum(not c.get('target') for c in calls), 'imports': len(imports)},
            'limitations': ['Pinned committed source; local uncommitted edits and generated/untracked files are excluded.',
                            'Java and Python declarations are parsed; other tracked files appear as file nodes.',
                            'Solid links are conservative static call candidates, not measured execution. Dynamic dispatch and overloaded calls may be unresolved.',
                            'Dashed links are imports or method references, not evidence of execution.',
                            'Calls in field initializers and module-level scripts are not method edges. Library bodies and physical robot behavior are not inspected.']+notes.get('limitations', [])}
    validate(data)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    template = Path(__file__).parent.parent/'assets/repository-explorer.html'
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    html = template.read_text().replace('__METHOD_LAYOUT__', template.with_name('method-layout.js').read_text()).replace('__REPOSITORY_DATA__', payload)
    with tempfile.NamedTemporaryFile(mode='w', dir=output.parent, delete=False, encoding='utf-8') as temp:
        temp.write(html)
        temporary_output = Path(temp.name)
    temporary_output.replace(output)
    output.with_suffix('.index.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
    receipt = {'ok': True, 'artifact': str(output), 'sha256': hashlib.sha256(html.encode()).hexdigest(),
               'repository': data['repository'], 'coverage': data['coverage'], 'checks': ['all-tracked-files-included', 'java-parse-no-errors', 'python-parse-no-errors', 'unique-symbols', 'source-line-ranges', 'edge-endpoints', 'parent-ownership']}
    output.with_suffix('.index-check.json').write_text(json.dumps(receipt, indent=2)+'\n')
    return receipt


def validate(data):
    nodes = data['nodes']
    by_id = {n['id']: n for n in nodes}
    assert len(by_id) == len(nodes), 'Duplicate IDs'
    for node in nodes:
        assert node['parent'] is None or node['parent'] in by_id, 'Missing parent'
        if node['kind'] == 'method':
            assert by_id[node['parent']]['kind'] == 'file'
            lines = data['sources'][node['path']].splitlines()
            assert 1 <= node['line'] <= node['endLine'] <= len(lines), node['id']
    for edge in data['edges']:
        assert edge['from'] in by_id and edge['to'] in by_id, 'Missing edge endpoint'
        assert edge['kind'] in ('call', 'reference', 'import')
        assert edge['line'] >= 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo')
    parser.add_argument('output')
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--notes')
    args = parser.parse_args()
    print(json.dumps(build(args.repo, args.revision, args.output, args.notes)))
