import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { DEFAULT_PYTHON_COMMAND, pythonCandidates } from '../extension/pythonInterpreter';
import { testPythonCommand } from './helpers/python';

// The tests find the backend's Python by the rule of src/extension/pythonInterpreter.ts, on every OS. They once looked
// for `.venv/bin/python` only: on Windows (`.venv\Scripts\python.exe`) they skipped, and nothing said so. verify and
// the protocol-type generator hold the same rule in scripts/python-candidates.mjs (they run before tsc compile).

const repoRoot = path.resolve(__dirname, '..', '..');

test('the tests find the workspace venv\'s interpreter: .venv\\Scripts\\python.exe on Windows, .venv/bin/python elsewhere', () => {
    const only = (file: string) => (candidate: string) => candidate === file;
    const never = () => false;
    assert.equal(testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: only('C:\\work\\.venv\\Scripts\\python.exe'), runs: never }), 'C:\\work\\.venv\\Scripts\\python.exe');
    assert.equal(testPythonCommand({ env: {}, platform: 'linux', root: '/work', exists: only('/work/.venv/bin/python'), runs: never }), '/work/.venv/bin/python');
    assert.equal(testPythonCommand({ env: {}, platform: 'darwin', root: '/work', exists: only('/work/venv/bin/python'), runs: never }), '/work/venv/bin/python', 'the other workspace venv names too');
});

test('the tests take WANDAS_PYTHON first, then the workspace venv, the activated venv, then python3 and python', () => {
    const none = () => false;
    const all = () => true;
    assert.equal(testPythonCommand({ env: { WANDAS_PYTHON: '/opt/py/bin/python' }, platform: 'linux', root: '/work', exists: all }), '/opt/py/bin/python');
    assert.equal(testPythonCommand({ env: { VIRTUAL_ENV: 'C:\\envs\\a' }, platform: 'win32', root: 'C:\\work', exists: file => file === 'C:\\envs\\a\\Scripts\\python.exe' }), 'C:\\envs\\a\\Scripts\\python.exe');
    assert.equal(testPythonCommand({ env: { VIRTUAL_ENV: '/envs/a' }, platform: 'linux', root: '/work', exists: none, runs: all }), 'python3', 'a VIRTUAL_ENV without an interpreter is passed over');
    assert.equal(testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: none, runs: command => command === 'python' }), 'python', 'python when python3 does not start');
    assert.equal(testPythonCommand({ env: {}, platform: 'linux', root: '/work', exists: none, runs: none }), undefined);
});

// Each case is one environment on one OS; add a case here when the rule changes (both files change with it).
const CANDIDATE_CASES: Array<{ platform: NodeJS.Platform; root: string; env: Record<string, string> }> = [
    { platform: 'linux', root: '/work', env: {} },
    { platform: 'darwin', root: '/Users/me/work', env: { VIRTUAL_ENV: '/Users/me/envs/a' } },
    { platform: 'win32', root: 'C:\\work', env: {} },
    { platform: 'win32', root: 'C:\\work', env: { WANDAS_PYTHON: 'C:\\py\\python.exe', VIRTUAL_ENV: 'C:\\envs\\a' } },
    { platform: 'linux', root: '/work', env: { WANDAS_PYTHON: 'python3.11', VIRTUAL_ENV: '/envs/python' } },
];

test('the pre-compile scripts\' lookup (scripts/python-candidates.mjs) gives the same candidates as pythonInterpreter.ts, on each OS', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import { pythonCandidates } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts', 'python-candidates.mjs')).href)};
console.log(JSON.stringify(${JSON.stringify(CANDIDATE_CASES)}.map(pythonCandidates)));`], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const scripts = JSON.parse(run.stdout) as string[][];
    CANDIDATE_CASES.forEach((input, index) => {
        assert.deepEqual(scripts[index], pythonCandidates(input), JSON.stringify(input));
    });
    assert.deepEqual(pythonCandidates(CANDIDATE_CASES[2]), ['C:\\work\\.venv\\Scripts\\python.exe', 'C:\\work\\venv\\Scripts\\python.exe', 'C:\\work\\env\\Scripts\\python.exe', 'python3', 'python']);
});

test('verify and the protocol-type generator choose their Python through scripts/python-candidates.mjs', () => {
    for (const script of ['verify.mjs', 'generate-protocol-types.mjs']) {
        const text = readFileSync(path.join(repoRoot, 'scripts', script), 'utf8');
        assert.match(text, /import \{ firstPython, pythonCandidates \} from '\.\/python-candidates\.mjs';/u, script);
        assert.match(text, /firstPython\(pythonCandidates\(/u, script);
    }
});

test('the default interpreter command is the pythonCommand setting\'s default in package.json', () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };
    assert.equal(manifest.contributes.configuration.properties['audioWandasAnalyzer.pythonCommand']?.default, DEFAULT_PYTHON_COMMAND);
});
