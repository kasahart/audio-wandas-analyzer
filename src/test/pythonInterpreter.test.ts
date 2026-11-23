import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    DEFAULT_PYTHON_COMMAND,
    extensionPythonCandidates,
    fallbackPythonCommands,
    firstRunningPython,
    invocationText,
    pythonCandidates,
    type PythonInvocation,
} from '../extension/pythonInterpreter';
import { testPythonCommand } from './helpers/python';

// The tests find the backend's Python by the rule of src/extension/pythonInterpreter.ts, on every OS. They once looked
// for `.venv/bin/python` only: on Windows (`.venv\Scripts\python.exe`) they skipped, and nothing said so. verify and
// the protocol-type generator hold the same rule in scripts/python-candidates.mjs (they run before tsc compile).

const repoRoot = path.resolve(__dirname, '..', '..');

test('the tests find the workspace venv\'s interpreter: .venv\\Scripts\\python.exe on Windows, .venv/bin/python elsewhere', () => {
    const only = (file: string) => (candidate: string) => candidate === file;
    const never = () => false;
    const found = (options: Parameters<typeof testPythonCommand>[0]) => {
        const python = testPythonCommand(options);
        return python && invocationText(python);
    };
    assert.equal(found({ env: {}, platform: 'win32', root: 'C:\\work', exists: only('C:\\work\\.venv\\Scripts\\python.exe'), runs: never }), 'C:\\work\\.venv\\Scripts\\python.exe');
    assert.equal(found({ env: {}, platform: 'linux', root: '/work', exists: only('/work/.venv/bin/python'), runs: never }), '/work/.venv/bin/python');
    assert.equal(found({ env: {}, platform: 'darwin', root: '/work', exists: only('/work/venv/bin/python'), runs: never }), '/work/venv/bin/python', 'the other workspace venv names too');
});

test('the tests take WANDAS_PYTHON first, then the workspace venv, the activated venv, then the OS\'s fallback commands', () => {
    const none = () => false;
    const all = () => true;
    assert.deepEqual(testPythonCommand({ env: { WANDAS_PYTHON: '/opt/py/bin/python' }, platform: 'linux', root: '/work', exists: all }), { command: '/opt/py/bin/python', args: [] });
    assert.deepEqual(testPythonCommand({ env: { VIRTUAL_ENV: 'C:\\envs\\a' }, platform: 'win32', root: 'C:\\work', exists: file => file === 'C:\\envs\\a\\Scripts\\python.exe' }), { command: 'C:\\envs\\a\\Scripts\\python.exe', args: [] });
    assert.deepEqual(testPythonCommand({ env: { VIRTUAL_ENV: '/envs/a' }, platform: 'linux', root: '/work', exists: none, runs: all }), { command: 'python3', args: [] }, 'a VIRTUAL_ENV without an interpreter is passed over');
    assert.equal(testPythonCommand({ env: {}, platform: 'linux', root: '/work', exists: none, runs: none }), undefined);
});

// The fallback commands, per OS (#789): on Windows `python3` usually does not exist, so the extension and the tests
// try the Python launcher `py -3`, then `python`; elsewhere python3, then python. Each test runs every OS's rule on any
// host, by an injected platform and a fake probe that records what was started.

/** A probe that records each candidate it is asked to start and lets only those `works` names run. */
function fakeProbe(works: readonly string[] = []) {
    const tried: string[] = [];
    return {
        tried,
        probe: async (candidate: PythonInvocation) => {
            tried.push(invocationText(candidate));
            if (!works.includes(invocationText(candidate))) throw new Error(`${invocationText(candidate)}: not found`);
            return invocationText(candidate);
        },
        runs: (candidate: PythonInvocation) => {
            tried.push(invocationText(candidate));
            return works.includes(invocationText(candidate));
        },
    };
}

test('on Windows the fallback tries py -3 and then python, each started as a command with its own arguments', async () => {
    assert.deepEqual(fallbackPythonCommands('win32'), [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]);
    const extension = fakeProbe();
    const { found, failures } = await firstRunningPython(extensionPythonCandidates({}, 'win32'), extension.probe);
    assert.equal(found, undefined);
    assert.deepEqual(extension.tried, ['py -3', 'python']);
    assert.deepEqual(failures.map(failure => failure.candidate), [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]);
    const tests = fakeProbe();
    testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: () => false, runs: tests.runs });
    assert.deepEqual(tests.tried, ['py -3', 'python'], 'the tests\' lookup tries the same commands');
});

test('on Linux and macOS the fallback tries python3 and then python', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
        assert.deepEqual(fallbackPythonCommands(platform), [{ command: 'python3', args: [] }, { command: 'python', args: [] }], platform);
        const extension = fakeProbe();
        await firstRunningPython(extensionPythonCandidates({}, platform), extension.probe);
        assert.deepEqual(extension.tried, ['python3', 'python'], platform);
        const tests = fakeProbe();
        testPythonCommand({ env: {}, platform, root: '/work', exists: () => false, runs: tests.runs });
        assert.deepEqual(tests.tried, ['python3', 'python'], platform);
    }
});

test('the first candidate that runs is used and no later one is started', async () => {
    const windows = fakeProbe(['python']);
    const first = await firstRunningPython(extensionPythonCandidates({}, 'win32'), windows.probe);
    assert.deepEqual(first.found, { candidate: { command: 'python', args: [] }, result: 'python' });
    assert.deepEqual(first.failures.map(failure => invocationText(failure.candidate)), ['py -3']);

    const launcher = fakeProbe(['py -3', 'python']);
    assert.deepEqual((await firstRunningPython(extensionPythonCandidates({}, 'win32'), launcher.probe)).found?.candidate, { command: 'py', args: ['-3'] });
    assert.deepEqual(launcher.tried, ['py -3'], 'python is not started once py -3 runs');

    // A chosen interpreter (the setting, the Python extension's, VIRTUAL_ENV) is the only candidate: it is probed once
    // (the dependency check the extension runs anyway) and never passed over for a fallback command.
    for (const sources of [{ configured: '.venv', active: '/opt/py/bin/python' }, { active: '/opt/py/bin/python' }, { virtualEnv: '/envs/a' }]) {
        const chosen = fakeProbe([Object.values(sources)[0]!]);
        const result = await firstRunningPython(extensionPythonCandidates(sources, 'win32'), chosen.probe);
        assert.deepEqual(chosen.tried, [Object.values(sources)[0]], JSON.stringify(sources));
        assert.equal(result.failures.length, 0);
    }
    assert.deepEqual(extensionPythonCandidates({ configured: 'C:\\envs\\a' }, 'win32'), [{ command: 'C:\\envs\\a', args: [] }]);

    const tests = fakeProbe(['py -3']);
    assert.deepEqual(testPythonCommand({ env: {}, platform: 'win32', root: 'C:\\work', exists: () => false, runs: tests.runs }), { command: 'py', args: ['-3'] });
    assert.deepEqual(tests.tried, ['py -3']);
});

// Each case is one environment on one OS; add a case here when the rule changes (both files change with it).
const CANDIDATE_CASES: Array<{ platform: NodeJS.Platform; root: string; env: Record<string, string> }> = [
    { platform: 'linux', root: '/work', env: {} },
    { platform: 'darwin', root: '/Users/me/work', env: {} },
    { platform: 'darwin', root: '/Users/me/work', env: { VIRTUAL_ENV: '/Users/me/envs/a' } },
    { platform: 'win32', root: 'C:\\work', env: {} },
    { platform: 'win32', root: 'C:\\work', env: { WANDAS_PYTHON: 'C:\\py\\python.exe', VIRTUAL_ENV: 'C:\\envs\\a' } },
    { platform: 'linux', root: '/work', env: { WANDAS_PYTHON: 'python3.11', VIRTUAL_ENV: '/envs/python' } },
];

test('the pre-compile scripts\' lookup (scripts/python-candidates.mjs) gives the same candidates as pythonInterpreter.ts, on each OS', () => {
    const platforms: NodeJS.Platform[] = ['win32', 'linux', 'darwin'];
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import { fallbackPythonCommands, pythonCandidates } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts', 'python-candidates.mjs')).href)};
console.log(JSON.stringify({ candidates: ${JSON.stringify(CANDIDATE_CASES)}.map(pythonCandidates), fallbacks: ${JSON.stringify(platforms)}.map(fallbackPythonCommands) }));`], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const scripts = JSON.parse(run.stdout) as { candidates: PythonInvocation[][]; fallbacks: PythonInvocation[][] };
    CANDIDATE_CASES.forEach((input, index) => {
        assert.deepEqual(scripts.candidates[index], pythonCandidates(input), JSON.stringify(input));
    });
    platforms.forEach((platform, index) => {
        assert.deepEqual(scripts.fallbacks[index], fallbackPythonCommands(platform), platform);
    });
    assert.deepEqual(pythonCandidates(CANDIDATE_CASES[3]).map(invocationText), ['C:\\work\\.venv\\Scripts\\python.exe', 'C:\\work\\venv\\Scripts\\python.exe', 'C:\\work\\env\\Scripts\\python.exe', 'py -3', 'python']);
    assert.deepEqual(pythonCandidates(CANDIDATE_CASES[0]).slice(-2).map(invocationText), ['python3', 'python']);
});

test('verify and the protocol-type generator choose their Python through scripts/python-candidates.mjs', () => {
    for (const script of ['verify.mjs', 'generate-protocol-types.mjs']) {
        const text = readFileSync(path.join(repoRoot, 'scripts', script), 'utf8');
        assert.match(text, /import \{ firstPython, invocationText, pythonCandidates \} from '\.\/python-candidates\.mjs';/u, script);
        assert.match(text, /const candidates = pythonCandidates\(\{ root \}\);\n\s*const \w+ = firstPython\(candidates\);/u, script);
        // The interpreter is a command and its own arguments (`py -3`): every start passes both.
        assert.doesNotMatch(text, /spawnSync\(python,/u, script);
    }
});

test('the default interpreter command is the pythonCommand setting\'s default in package.json', () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default?: unknown }> } } };
    assert.equal(manifest.contributes.configuration.properties['audioWandasAnalyzer.pythonCommand']?.default, DEFAULT_PYTHON_COMMAND);
});
