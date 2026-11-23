import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { testPython } from './helpers/python';

// scripts/verify-runner.mjs runs `npm run verify`'s lanes at once. It once kept running for the CI job's whole time
// limit after a lane failed (on Windows), and left the other lane's processes behind. Held here on every OS CI runs:
// the first failure ends verify within moments, non-zero, and no process of any step outlives it.

const repoRoot = path.resolve(__dirname, '..', '..');
const runner = pathToFileURL(path.join(repoRoot, 'scripts', 'verify-runner.mjs')).href;

/** Runs `driver` (an ES module that imports the runner) and resolves to its exit status and output, bounded. */
async function runDriver(driver: string, cwd: string): Promise<{ status: number | null | 'still running'; output: string }> {
    const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    // A runner that waits for what a step left running would never end here: fail with that, rather than hang.
    const status = await new Promise<number | null | 'still running'>(resolve => {
        const bound = setTimeout(() => {
            child.kill('SIGKILL');
            resolve('still running');
        }, 30_000);
        child.on('close', code => {
            clearTimeout(bound);
            resolve(code);
        });
    });
    return { status, output };
}

/** Waits a moment for `pids` to be gone (a killed process may take that long to be reaped); whether each still runs. */
async function stillRunning(pids: number[]): Promise<boolean[]> {
    const deadline = Date.now() + 3_000;
    while (pids.some(alive) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return pids.map(alive);
}

/** Whether the process runs (a Linux zombie waiting for its reaper has ended and counts as gone). */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
    } catch {
        return false;
    }
    try {
        return !/^\d+ \(.*\) Z/su.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    } catch {
        return true;
    }
}

test('verify ends moments after a lane fails, non-zero, and stops the other lane\'s whole process tree, its grandchild too', { timeout: 60_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-runner-'));
    try {
        const pids = path.join(dir, 'pids');
        const failedAt = path.join(dir, 'failed-at');
        // A step as npm runs one: a process that starts another and waits; neither ever ends by itself. The grandchild
        // shares the step's output pipes, as a real one does.
        const sleeper = `const { spawn } = require('node:child_process'); const fs = require('node:fs');
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
fs.writeFileSync(${JSON.stringify(pids)}, process.pid + ' ' + grandchild.pid); console.log('sleeper started'); setInterval(() => {}, 1000);`;
        // Fails once the other lane's tree is up, so the stop has a grandchild to reach.
        const failing = `const fs = require('node:fs'); const wait = () => fs.existsSync(${JSON.stringify(pids)})
    ? (fs.writeFileSync(${JSON.stringify(failedAt)}, String(Date.now())), console.error('the failure'), process.exit(1)) : setTimeout(wait, 50); wait();`;
        const driver = `import { runLanes } from ${JSON.stringify(runner)};
const node = process.execPath;
const failures = await runLanes([
    ['Long', [['sleeper', node, ['-e', ${JSON.stringify(sleeper)}]], ['after sleeper', node, ['-e', '']]]],
    ['Fails', [['failing', node, ['-e', ${JSON.stringify(failing)}]]]],
    ['Waits', [['waits for sleeper', node, ['-e', ''], { after: 'sleeper' }]]],
], { cwd: process.cwd(), env: process.env });
console.log('failures: ' + JSON.stringify(failures));
process.exit(failures.length ? 1 : 0);`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        // A runner that waits for the other lanes would never end here: fail with that, rather than hang the suite.
        const status = await new Promise<number | null | 'still running'>(resolve => {
            const bound = setTimeout(() => {
                child.kill('SIGKILL');
                resolve('still running');
            }, 20_000);
            child.on('close', code => {
                clearTimeout(bound);
                resolve(code);
            });
        });
        const endedAt = Date.now();

        assert.equal(status, 1, output);
        const sinceFailure = endedAt - Number(fs.readFileSync(failedAt, 'utf8'));
        assert.ok(sinceFailure < 5_000, `verify ended ${sinceFailure} ms after the failure: it must not wait for the other lanes\n${output}`);
        assert.match(output, /---- Fails lane: FAILED/u);
        assert.match(output, /the failure/u, 'the failed lane\'s output is printed');
        assert.match(output, /---- Long lane: stopped/u);
        assert.match(output, /sleeper started/u, 'a stopped lane\'s output so far is printed');
        assert.match(output, /verify: sleeper stopped after .*: failing failed/u);
        assert.match(output, /verify: waits for sleeper not run/u);
        assert.doesNotMatch(output, /==> after sleeper/u, 'a step after a stopped one does not start');
        assert.match(output, /failures: \["failing"\]/u, 'only the failure is named a failure, not the steps it stopped');

        const [stepPid, grandchildPid] = fs.readFileSync(pids, 'utf8').split(' ').map(Number);
        // A killed process may take a moment to be reaped by the OS; it must not run on.
        const deadline = Date.now() + 3_000;
        while ((alive(stepPid) || alive(grandchildPid)) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.deepEqual({ step: alive(stepPid), grandchild: alive(grandchildPid) }, { step: false, grandchild: false }, 'no process of a stopped step survives verify');
    } finally {
        // A failed assertion above must not leave the test's own processes behind either.
        const pids = path.join(dir, 'pids');
        for (const pid of fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').split(' ').map(Number) : []) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Gone, as it should be.
            }
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a step that exits while a process it started still runs fails verify, and that process is ended, on every OS', { timeout: 60_000 }, async (t) => {
    // On Windows such a process cannot be found by process tree once the step has exited: the job object the step runs
    // in (scripts/verify-job.ps1) still holds it. On POSIX it is in the step's process group. Python's subprocess
    // starts it plainly on every OS (Node's own children are ended with their parent on Windows, which proves nothing).
    const python = testPython();
    if (!python) { t.skip('no Python'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-runner-'));
    const pids = path.join(dir, 'pids');
    try {
        const leaves = [
            'import subprocess, sys',
            "left = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
            `open(${JSON.stringify(pids)}, 'w').write(str(left.pid))`,
            "print('started a process and left it running')",
        ].join('\n');
        // A process that exits by itself a moment after its step (as a compiler's helper does) is not a leftover.
        const helper = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' }).unref();`;
        const { status, output } = await runDriver(`import { runLanes } from ${JSON.stringify(runner)};
const failures = await runLanes([
    ['Helper', [['helper ends by itself', process.execPath, ['-e', ${JSON.stringify(helper)}]]]],
    ['Leaves', [['leaves a process', ${JSON.stringify(python.command)}, [...${JSON.stringify(python.args)}, '-c', ${JSON.stringify(leaves)}]]]],
], { cwd: process.cwd(), env: process.env, serial: true });
console.log('failures: ' + JSON.stringify(failures));
process.exit(failures.length ? 1 : 0);`, dir);

        assert.equal(status, 1, output);
        assert.match(output, /<== helper ends by itself/u, 'a process that exits by itself within moments does not fail its step');
        assert.match(output, /started a process and left it running/u);
        // Not a count of one: on Windows a venv's python.exe is a launcher that starts the base interpreter as its child,
        // so the process left running is two processes there.
        assert.match(output, /left [1-9]\d* process\(es\) running after it exited \(they were ended\)/u);
        assert.match(output, /failures: \["leaves a process"\]/u);
        assert.deepEqual(await stillRunning([Number(fs.readFileSync(pids, 'utf8'))]), [false], 'what the step left running does not outlive it');
    } finally {
        for (const pid of fs.existsSync(pids) ? [Number(fs.readFileSync(pids, 'utf8'))] : []) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Gone, as it should be.
            }
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a step\'s command line on Windows quotes each argument as Windows programs parse it (the rule Node\'s spawn uses)', async () => {
    const { status, output } = await runDriver(`import { windowsArgument } from ${JSON.stringify(runner)};
console.log(JSON.stringify(${JSON.stringify(['', 'plain', 'two words', 'say "hi"', 'C:\\Program Files\\node.exe', 'ends\\', 'end space\\', 'a\\"b', 'tab\there'])}.map(windowsArgument)));`, os.tmpdir());
    assert.equal(status, 0, output);
    assert.deepEqual(JSON.parse(output), ['""', 'plain', '"two words"', '"say \\"hi\\""', '"C:\\Program Files\\node.exe"', 'ends\\', '"end space\\\\"', '"a\\\\\\"b"', '"tab\there"']);
});

test('when PowerShell refuses to compile the job helper (Constrained Language Mode), verify says what happened and what to do', async () => {
    // Stands in for scripts/verify-job.ps1 as it ends under Constrained Language Mode: the raw reason on stderr, and
    // the exit code that says the helper could not be set up.
    const blocked = `console.error('verify-job: Add-Type failed: Cannot add type. Definition of new types is not supported in this language mode.'); process.exit(213);`;
    const { status, output } = await runDriver(`import { runLanes } from ${JSON.stringify(runner)};
const failures = await runLanes([['Lane', [['node:test', process.execPath, ['-e', '']]]]], { cwd: process.cwd(), env: process.env, serial: true, jobLauncher: [process.execPath, ['-e', ${JSON.stringify(blocked)}]] });
console.log('failures: ' + JSON.stringify(failures));
process.exit(failures.length ? 1 : 0);`, os.tmpdir());
    assert.equal(status, 1, output);
    assert.match(output, /verify: node:test could not start: PowerShell could not compile the job-object helper \(scripts\/verify-job\.ps1\)/u);
    assert.match(output, /Constrained Language Mode .* blocks Add-Type\. Run verify from an unrestricted shell/u);
    assert.match(output, /failures: \["node:test"\]/u);
    // The helper and the runner agree on the code.
    const helper = fs.readFileSync(path.join(repoRoot, 'scripts', 'verify-job.ps1'), 'utf8');
    const { JOB_HELPER_BLOCKED } = JSON.parse((await runDriver(`import { JOB_HELPER_BLOCKED } from ${JSON.stringify(runner)}; console.log(JSON.stringify({ JOB_HELPER_BLOCKED }));`, os.tmpdir())).output) as { JOB_HELPER_BLOCKED: number };
    assert.match(helper, new RegExp(`^\\$blocked = ${JOB_HELPER_BLOCKED}$`, 'mu'));
    assert.match(helper, /LanguageMode -ne 'FullLanguage'[\s\S]*exit \$blocked[\s\S]*catch \{[\s\S]*exit \$blocked/u, 'both a non-full language mode and a failed Add-Type end with that code');
});
