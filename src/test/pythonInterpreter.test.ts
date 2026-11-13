import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_PYTHON_COMMAND } from '../extension/pythonInterpreter';
import { testPythonCommand } from './helpers/python';

// The tests find the backend's Python as the extension does (src/extension/pythonInterpreter.ts), on every OS. They
// once looked for `.venv/bin/python` only: on Windows (`.venv\Scripts\python.exe`) they skipped, and nothing said so.

const repoRoot = path.resolve(__dirname, '..', '..');

test('the tests find the workspace venv\'s interpreter as the extension does: .venv\\Scripts\\python.exe on Windows, .venv/bin/python elsewhere', () => {
    const only = (file: string) => (candidate: string) => candidate === file;
    assert.equal(testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: only('C:\\work\\.venv\\Scripts\\python.exe') }), 'C:\\work\\.venv\\Scripts\\python.exe');
    assert.equal(testPythonCommand({ env: {}, platform: 'linux', root: '/work', exists: only('/work/.venv/bin/python') }), '/work/.venv/bin/python');
    assert.equal(testPythonCommand({ env: {}, platform: 'darwin', root: '/work', exists: only('/work/venv/bin/python') }), '/work/venv/bin/python', 'the other workspace venv names too');
});

test('the tests take WANDAS_PYTHON first (the pythonCommand setting\'s stand-in), then the workspace venv, the activated venv, and else python3', () => {
    const none = () => false;
    assert.equal(testPythonCommand({ env: { WANDAS_PYTHON: '/opt/py/bin/python' }, platform: 'linux', root: '/work', exists: () => true }), '/opt/py/bin/python');
    assert.equal(testPythonCommand({ env: { VIRTUAL_ENV: 'C:\\envs\\a' }, platform: 'win32', root: 'C:\\work', exists: file => file === 'C:\\envs\\a\\Scripts\\python.exe' }), 'C:\\envs\\a\\Scripts\\python.exe');
    assert.equal(testPythonCommand({ env: { VIRTUAL_ENV: '/envs/a' }, platform: 'linux', root: '/work', exists: none }), DEFAULT_PYTHON_COMMAND, 'a VIRTUAL_ENV without an interpreter is passed over');
    assert.equal(testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: none }), DEFAULT_PYTHON_COMMAND);
});

test('the default interpreter command is the pythonCommand setting\'s default in package.json', () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };
    assert.equal(manifest.contributes.configuration.properties['audioWandasAnalyzer.pythonCommand']?.default, DEFAULT_PYTHON_COMMAND);
});
