import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { testPython } from './helpers/python';

// The skip gate (scripts/test-skips.mjs): in CI a test that skips fails its run unless scripts/test-skip-allowlist.json
// lists it for its runner and that OS. Held here with the gate's own pieces, as verify and test:ui run them: probe
// files with every form of skip each runner has, recorded or reported through the same arguments, then checked.

const repoRoot = path.resolve(__dirname, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'test-skips.mjs');
/** The allowlist's entries; lower it when an entry goes, never raise it. */
const SKIP_ALLOWLIST_CEILING = 3;

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

type SkipRecord = { runner: string; test: string; reason: string };

/** Each node:test form of skip: a skip called inside a test, the skip option (with and without a reason), test.skip,
 * todo (as test.todo and as an option), and a skipped suite (describe.skip and the suite option). */
const NODE_PROBE = `const { describe, test } = require('node:test');
test('a test that runs', () => {});
test('t.skip inside a test', (t) => { t.skip('no tool here'); });
test('the skip option', { skip: true }, () => {});
test('the skip option with a reason', { skip: 'no tool here' }, () => {});
test.skip('test.skip', () => {});
test.todo('test.todo');
test('the todo option', { todo: 'later' }, () => {});
describe.skip('describe.skip', () => { test('in it', () => {}); });
describe('a suite with the skip option', { skip: 'no tool here' }, () => { test('in it', () => {}); });
`;
const NODE_SKIPS = [
    't.skip inside a test', 'the skip option', 'the skip option with a reason', 'test.skip', 'test.todo', 'the todo option',
    'describe.skip', 'a suite with the skip option',
];

/** Each pytest form of skip: pytest.skip in a test, a skipif mark, and a module that skips while it is collected
 * (pytest.skip with allow_module_level, a module-level importorskip). */
const PYTEST_PROBES: Record<string, string> = {
    'test_probe.py': 'import pytest\n\n\ndef test_runs():\n    pass\n\n\ndef test_skip_inside():\n    pytest.skip("no tool here")\n\n\n@pytest.mark.skipif(True, reason="no tool here")\ndef test_skipif():\n    pass\n',
    'test_module_skip.py': 'import pytest\n\npytest.skip("no tool at module level", allow_module_level=True)\n\n\ndef test_in_it():\n    pass\n',
    'test_module_importorskip.py': 'import pytest\n\npytest.importorskip("a_module_that_is_not_installed")\n\n\ndef test_in_it():\n    pass\n',
};
const PYTEST_SKIPS = ['test_module_importorskip.py', 'test_module_skip.py', 'test_probe.py::test_skip_inside', 'test_probe.py::test_skipif'];

test('in CI a node:test or pytest test that skips in any form and is not on the allowlist fails verify; outside CI it is only reported', (t) => {
    const python = testPython();
    if (!python) { t.skip('no Python'); return; }
    const dir = mkdtempSync(path.join(os.tmpdir(), 'skip-gate-'));
    try {
        const nodeRecord = path.join(dir, 'node-test.json');
        const args = fromGate(`{ node: gate.nodeTestSkipArgs(${JSON.stringify(nodeRecord)}), pytestSerial: gate.pytestSkipArgs(${JSON.stringify(path.join(dir, 'pytest-serial.json'))}), pytestXdist: gate.pytestSkipArgs(${JSON.stringify(path.join(dir, 'pytest-xdist.json'))}) }`) as { node: string[]; pytestSerial: string[]; pytestXdist: string[] };

        writeFileSync(path.join(dir, 'probe.test.js'), NODE_PROBE);
        const nodeRun = spawnSync(process.execPath, ['--test', ...args.node, path.join(dir, 'probe.test.js')], { cwd: repoRoot, encoding: 'utf8', env: withoutCi() });
        assert.equal(nodeRun.status, 0, `a skip passes node:test itself\n${nodeRun.stdout}${nodeRun.stderr}`);
        const nodeRecords = JSON.parse(readFileSync(nodeRecord, 'utf8')) as SkipRecord[];
        assert.deepEqual(nodeRecords.map(record => record.test.replace(/^.*probe\.test\.js > /u, '')).sort(), [...NODE_SKIPS].sort(), 'every form of node:test skip is recorded');
        assert.ok(nodeRecords.every(record => record.runner === 'node:test'));

        const pytestDir = path.join(dir, 'pytest');
        mkdirSync(pytestDir);
        writeFileSync(path.join(pytestDir, 'pytest.ini'), '[pytest]\n');
        for (const [name, source] of Object.entries(PYTEST_PROBES)) writeFileSync(path.join(pytestDir, name), source);
        // python-backend/conftest.py is where verify's pytest run gets --record-skips; loaded here as a plugin. Run
        // serially and across pytest-xdist workers, as verify runs it: the controller must record what the workers skip.
        const pythonPath = [path.join(repoRoot, 'python-backend'), process.env['PYTHONPATH']].filter(Boolean).join(path.delimiter);
        const pytestRecords: Record<string, SkipRecord[]> = {};
        for (const [mode, recordArgs, parallel] of [['serial', args.pytestSerial, ['-p', 'no:xdist']], ['xdist', args.pytestXdist, ['-n', '2']]] as const) {
            const run: SpawnSyncReturns<string> = spawnSync(python, ['-m', 'pytest', '-p', 'conftest', ...recordArgs, '-c', path.join(pytestDir, 'pytest.ini'), '--rootdir', pytestDir, '-p', 'no:cacheprovider', ...parallel, pytestDir], {
                cwd: pytestDir, encoding: 'utf8', env: { ...withoutCi(), PYTHONPATH: pythonPath },
            });
            assert.equal(run.status, 0, `a skip passes pytest itself (${mode})\n${run.stdout}${run.stderr}`);
            pytestRecords[mode] = JSON.parse(readFileSync(path.join(dir, `pytest-${mode}.json`), 'utf8')) as SkipRecord[];
            assert.deepEqual(pytestRecords[mode].map(record => record.test).sort(), PYTEST_SKIPS, `every form of pytest skip is recorded once (${mode})`);
        }
        assert.match(pytestRecords['serial'].find(record => record.test === 'test_module_skip.py')!.reason, /no tool at module level/u);
        assert.match(pytestRecords['xdist'].find(record => record.test === 'test_module_importorskip.py')!.reason, /a_module_that_is_not_installed/u);

        const records = [...nodeRecords, ...pytestRecords['serial']];
        const check = (ci: boolean, allowlist?: object[]): SpawnSyncReturns<string> => {
            const extra: string[] = [];
            if (allowlist) {
                writeFileSync(path.join(dir, 'allowlist.json'), JSON.stringify({ skips: allowlist }));
                extra.push('--allowlist', path.join(dir, 'allowlist.json'));
            }
            return spawnSync(process.execPath, [gate, 'check', `node:test=${nodeRecord}`, `pytest=${path.join(dir, 'pytest-serial.json')}`, ...extra], {
                cwd: repoRoot, encoding: 'utf8', env: ci ? { ...withoutCi(), CI: 'true' } : withoutCi(),
            });
        };
        const inCi = check(true);
        assert.equal(inCi.status, 1, `an unlisted skip under CI=true fails verify\n${inCi.stdout}${inCi.stderr}`);
        for (const record of records) {
            assert.ok(inCi.stderr.includes(`${record.runner}: ${record.test} skipped`), `the gate names ${record.runner}: ${record.test}\n${inCi.stderr}`);
        }

        const locally = check(false);
        assert.equal(locally.status, 0, locally.stderr);
        assert.match(locally.stdout, /skipped: node:test: .*t\.skip inside a test \(no tool here\)/u, 'outside CI a skip is still reported');

        const listed = records.map(record => ({ runner: record.runner, test: record.test, platform: process.platform, reason: 'why it cannot run here' }));
        const allowed = check(true, listed);
        assert.equal(allowed.status, 0, `a skip the allowlist lists for its runner and this OS passes\n${allowed.stderr}`);
        const otherOs = check(true, listed.map(entry => ({ ...entry, platform: process.platform === 'aix' ? 'sunos' : 'aix' })));
        assert.equal(otherOs.status, 1, 'an entry for another OS does not allow the skip here');
        const stale = check(true, [...listed, { runner: 'node:test', test: 'src/test/x.test.ts > a test that runs now', platform: process.platform, reason: 'once' }]);
        assert.equal(stale.status, 1, 'an entry whose test runs fails: the allowlist only shrinks');
        assert.match(stale.stderr, /a test that runs now runs on .* now: remove its entry/u);
        const otherRunner = check(true, [...listed, { runner: 'playwright', test: 'src/test/uiSmoke/x.spec.ts > y', platform: process.platform, reason: 'checked by test:ui' }]);
        assert.equal(otherRunner.status, 0, 'an entry of a runner this run did not run is left to that runner');
        const unexplained = check(false, [{ runner: 'node:test', test: 'src/test/x.test.ts > y', platform: process.platform }]);
        assert.equal(unexplained.status, 1, 'every entry says why');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('in CI a Playwright test that does not run (test.skip in a test or a file, test.describe.skip, test.fixme) fails test:ui unless listed', () => {
    // Inside the repository, so the probe specs resolve @playwright/test; Playwright's output goes inside it too.
    const dir = mkdtempSync(path.join(repoRoot, '.skip-gate-'));
    try {
        writeFileSync(path.join(dir, 'a.spec.js'), `const { test } = require('@playwright/test');
test('a test that runs', () => {});
test.fixme('test.fixme', () => {});
test.describe.skip('test.describe.skip', () => { test('in it', () => {}); });
test('test.skip inside a test', () => { test.skip(true, 'no tool here'); });
`);
        writeFileSync(path.join(dir, 'b.spec.js'), `const { test } = require('@playwright/test');
test.skip(true, 'no tool for this file');
test('in a skipped file', () => {});
`);
        const reporter = path.join(repoRoot, 'scripts', 'playwright-skip-reporter.mjs');
        const run = (ci: boolean, allowlist: object[]): SpawnSyncReturns<string> => {
            writeFileSync(path.join(dir, 'allowlist.json'), JSON.stringify({ skips: allowlist }));
            writeFileSync(path.join(dir, 'pw.config.mjs'), `export default { testDir: '.', outputDir: './out', workers: 1, reporter: [[${JSON.stringify(reporter)}, { allowlist: ${JSON.stringify(path.join(dir, 'allowlist.json'))} }]] };\n`);
            return spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'playwright.mjs'), 'test', '-c', path.join(dir, 'pw.config.mjs')], {
                cwd: repoRoot, encoding: 'utf8', env: ci ? { ...withoutCi(), CI: 'true' } : withoutCi(),
            });
        };
        const relative = path.relative(repoRoot, dir).split(path.sep).join('/');
        const skips = [`${relative}/a.spec.js > test.fixme`, `${relative}/a.spec.js > test.describe.skip > in it`, `${relative}/a.spec.js > test.skip inside a test`, `${relative}/b.spec.js > in a skipped file`];

        const inCi = run(true, []);
        assert.equal(inCi.status, 1, `unlisted skips under CI=true fail test:ui\n${inCi.stdout}${inCi.stderr}`);
        for (const skip of skips) assert.ok(inCi.stdout.includes(`skipped: playwright: ${skip}`) && inCi.stderr.includes(`playwright: ${skip} skipped`), `the gate names ${skip}\n${inCi.stdout}${inCi.stderr}`);
        const locally = run(false, []);
        assert.equal(locally.status, 0, `outside CI a skip is only reported\n${locally.stdout}${locally.stderr}`);
        const listed = run(true, skips.map(test => ({ runner: 'playwright', test, platform: process.platform, reason: 'why it cannot run here' })));
        assert.equal(listed.status, 0, `listed skips pass\n${listed.stdout}${listed.stderr}`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the skip allowlist only shrinks, and verify and test:ui record and check their skips', () => {
    const entries = fromGate('gate.readAllowlist()') as Array<{ runner: string; test: string; platform: string; reason: string }>;
    assert.ok(entries.length <= SKIP_ALLOWLIST_CEILING, `scripts/test-skip-allowlist.json has ${entries.length} entries; the ceiling is ${SKIP_ALLOWLIST_CEILING} and only goes down`);
    for (const entry of entries) assert.match(entry.reason, /#\d+/u, `${entry.test}: an entry names the issue that ends it`);
    const verify = readFileSync(path.join(repoRoot, 'scripts', 'verify.mjs'), 'utf8');
    assert.match(verify, /\['node:test', \.\.\.node\('--test', \.\.\.nodeTestSkipArgs\(nodeSkips\)/u);
    assert.match(verify, /\['-m', 'pytest', 'python-backend', [^\]]*\.\.\.pytestSkipArgs\(pytestSkips\)\]/u);
    assert.match(verify, /node\('scripts\/test-skips\.mjs', 'check', `node:test=\$\{nodeSkips\}`, `pytest=\$\{pytestSkips\}`\)/u);
    assert.match(readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8'), /\['\.\/scripts\/playwright-skip-reporter\.mjs'\]/u);
});
