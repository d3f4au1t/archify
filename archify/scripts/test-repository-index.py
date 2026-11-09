#!/usr/bin/env python3
"""Focused source-index regression checks; never runs project code."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

base = Path(__file__).parent
spec = importlib.util.spec_from_file_location('repository_builder', base/'build-repository-explorer.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class JavaIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        files = {
            'TeamCode/Types.java': '''package example;
class Parent { void f(String value) {} Parent() {} }
class Child extends Parent { void f(int value) {} void test() { f("hello"); } }
class SameLine { void m() {} void m(int value) {} }
class A { void use() {} }
class B { void use() {} }
class Shadow { A item; void call(B item) { item.use(); } }
class ConstructorUse { void build() { new Child(); } }
class Callback { void target() {} void setup() { Runnable r = () -> target(); } }
''',
            'TeamCode/Real.java': 'package robot; import sdk.External; class Real { void run(External e) { e.act(); } }',
            'scripts/tests/External.java': 'package sdk; class External { void act() {} }',
        }
        for path, source in files.items():
            (root/path).parent.mkdir(parents=True, exist_ok=True)
            (root/path).write_text(source)
        cls.index = json.loads(subprocess.check_output(['java', str(base/'IndexJava.java'), str(root)], text=True))
        builder.resolve_java(cls.index)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def method(self, owner, name):
        return next(m for m in self.index['methods'] if m['ownerName'] == owner and m['name'] == name)

    def test_same_line_overloads_have_unique_ids(self):
        ids = [m['id'] for m in self.index['methods']]
        self.assertEqual(len(ids), len(set(ids)))

    def test_inherited_overload_does_not_claim_wrong_target(self):
        call = self.method('Child', 'test')['calls'][0]
        self.assertNotIn('target', call)
        self.assertIn('ambiguous', call['unresolved'])

    def test_parameter_shadows_field_receiver_type(self):
        call = self.method('Shadow', 'call')['calls'][0]
        self.assertEqual(call['target'], self.method('B', 'use')['id'])

    def test_implicit_constructor_does_not_link_to_parent_constructor(self):
        self.assertNotIn('target', self.method('ConstructorUse', 'build')['calls'][0])

    def test_callback_site_is_retained_and_labeled(self):
        call = self.method('Callback', 'setup')['calls'][0]
        self.assertTrue(call['callback'])
        self.assertEqual(call['target'], self.method('Callback', 'target')['id'])

    def test_runtime_never_binds_to_test_stub(self):
        self.assertNotIn('target', self.method('Real', 'run')['calls'][0])

    def test_python_inventory_excludes_nested_calls_from_outer_function(self):
        methods = builder.python_symbols('example.py', 'def outer(callback):\n    def inner():\n        callback()\n    return inner\n')
        self.assertEqual(len(methods), 2)
        self.assertEqual(methods[0]['calls'], [])
        self.assertEqual(methods[1]['calls'][0]['name'], 'callback')
        self.assertIn('callback', methods[0]['boundNames'])


if __name__ == '__main__':
    unittest.main()
