import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { testPython } from './helpers/python';

// The skip gate of `npm run verify` (scripts/test-skips.mjs): in CI a test that skips fails verify unless
// scripts/test-skip-allowlist.json lists it for that OS. Held here with the gate's own pieces, as verify runs them: a
// node:test file and a pytest file that skip, recorded through the same arguments, then checked.

const repoRoot = path.resolve(__dirname, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'test-skips.mjs');
/** The allowlist's entries; lower it when an entry goes, never raise it. */
const SKIP_ALLOWLIST_CEILING = 0;

/** What the gate module exports, evaluated in an ES module (this file is compiled to CommonJS). */
function fromGate(expression: string): unknown {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import * as gate from ${JSON.stringify(pathToFileURL(gate).href)}; console.log(JSON.stringify(${expression}));`], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout) as unknown;
}

/** This process's environment without CI, nor the mark node:test leaves on its test files' processes (a node --test
 * started with it reports to a parent run instead of through its own reporters). */
function withoutCi(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env['CI'];
    delete env['NODE_TEST_CONTEXT'];
    return env;
}

test('in CI a node:test or pytest test that skips and is not on the allowlist fails verify; outside CI it is only reported', (t) => {
    const python = testPython();
    if (!python) { t.skip('no Python'); return; }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'skip-gate-'));
    try {
        const nodeRecord = path.join(dir, 'node-test.json');
        const pytestRecord = path.join(dir, 'pytest.json');
        const args = fromGate(`{ node: gate.nodeTestSkipArgs(${JSON.stringify(nodeRecord)}), pytest: gate.pytestSkipArgs(${JSON.stringify(pytestRecord)}) }`) as { node: string[]; pytest: string[] };

        writeFileSync(path.join(dir, 'probe.test.js'), `const test = require('node:test');
test('a test that runs', () => {});
test('a node test that skips', (t) => { t.skip('no tool here'); });
`);
        const nodeRun = spawnSync(process.execPath, ['--test', ...args.node, path.join(dir, 'probe.test.js')], { cwd: repoRoot, encoding: 'utf8', env: withoutCi() });
        assert.equal(nodeRun.status, 0, `a skip passes node:test itself\n${nodeRun.stdout}${nodeRun.stderr}`);

        writeFileSync(path.join(dir, 'pytest.ini'), '[pytest]\n');
        writeFileSync(path.join(dir, 'test_probe.py'), 'import pytest\n\n\ndef test_a_pytest_test_that_skips():\n    pytest.skip("no tool here")\n');
        // python-backend/conftest.py is where verify's pytest run gets --record-skips; loaded here as a plugin.
        const pythonPath = [path.join(repoRoot, 'python-backend'), process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter);
        const pytestRun = spawnSync(python, ['-m', 'pytest', '-p', 'conftest', ...args.pytest, '-c', path.join(dir, 'pytest.ini'), '--rootdir', dir, '-p', 'no:cacheprovider', '-p', 'no:xdist', path.join(dir, 'test_probe.py')], {
            cwd: dir, encoding: 'utf8', env: { ...withoutCi(), PYTHONPATH: pythonPath },
        });
        assert.equal(pytestRun.status, 0, `a skip passes pytest itself\n${pytestRun.stdout}${pytestRun.stderr}`);

        const records = [...JSON.parse(readFileSync(nodeRecord, 'utf8')), ...JSON.parse(readFileSync(pytestRecord, 'utf8'))] as Array<{ test: string; reason: string }>;
        assert.deepEqual(records.map(record => [record.test.replace(/^.*probe\.test\.js/u, 'probe.test.js'), record.reason]), [
            ['probe.test.js > a node test that skips', 'no tool here'],
            ['test_probe.py::test_a_pytest_test_that_skips', 'no tool here'],
        ]);

        const check = (ci: boolean, allowlist?: object[]): SpawnSyncReturns<string> => {
            const extra: string[] = [];
            if (allowlist) {
                writeFileSync(path.join(dir, 'allowlist.json'), JSON.stringify({ skips: allowlist }));
                extra.push('--allowlist', path.join(dir, 'allowlist.json'));
            }
            return spawnSync(process.execPath, [gate, 'check', nodeRecord, pytestRecord, ...extra], {
                cwd: repoRoot, encoding: 'utf8', env: ci ? { ...withoutCi(), CI: 'true' } : withoutCi(),
            });
        };
        const inCi = check(true);
        assert.equal(inCi.status, 1, `an unlisted skip under CI=true fails verify\n${inCi.stdout}${inCi.stderr}`);
        assert.match(inCi.stderr, /a node test that skips skipped \(no tool here\): in CI every test must run/u);
        assert.match(inCi.stderr, /test_probe\.py::test_a_pytest_test_that_skips skipped \(no tool here\)/u);

        const locally = check(false);
        assert.equal(locally.status, 0, locally.stderr);
        assert.match(locally.stdout, /skipped: .*a node test that skips \(no tool here\)/u, 'outside CI a skip is still reported');

        const listed = records.map(record => ({ test: record.test, platform: process.platform, reason: 'why it cannot run here' }));
        const allowed = check(true, listed);
        assert.equal(allowed.status, 0, `a skip the allowlist lists for this OS passes\n${allowed.stderr}`);
        const otherOs = check(true, listed.map(entry => ({ ...entry, platform: process.platform === 'aix' ? 'sunos' : 'aix' })));
        assert.equal(otherOs.status, 1, 'an entry for another OS does not allow the skip here');
        const stale = check(true, [...listed, { test: 'src/test/x.test.ts > a test that runs now', platform: process.platform, reason: 'once' }]);
        assert.equal(stale.status, 1, 'an entry whose test runs fails: the allowlist only shrinks');
        assert.match(stale.stderr, /a test that runs now runs on .* now: remove its entry/u);
        const unexplained = check(false, [{ test: 'src/test/x.test.ts > y', platform: process.platform }]);
        assert.equal(unexplained.status, 1, 'every entry says why');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the skip allowlist only shrinks, and verify records and checks the skips of node:test and pytest', () => {
    const entries = fromGate('gate.readAllowlist()') as Array<{ test: string; platform: string; reason: string }>;
    assert.ok(entries.length <= SKIP_ALLOWLIST_CEILING, `scripts/test-skip-allowlist.json has ${entries.length} entries; the ceiling is ${SKIP_ALLOWLIST_CEILING} and only goes down`);
    const verify = readFileSync(path.join(repoRoot, 'scripts', 'verify.mjs'), 'utf8');
    assert.match(verify, /\['node:test', \.\.\.node\('--test', \.\.\.nodeTestSkipArgs\(nodeSkips\)/u);
    assert.match(verify, /\['-m', 'pytest', 'python-backend', [^\]]*\.\.\.pytestSkipArgs\(pytestSkips\)\]/u);
    assert.match(verify, /node\('scripts\/test-skips\.mjs', 'check', nodeSkips, pytestSkips\)/u);
});
