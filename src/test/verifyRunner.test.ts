import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// scripts/verify-runner.mjs runs `npm run verify`'s lanes at once. It once kept running for the CI job's whole time
// limit after a lane failed (on Windows), and left the other lane's processes behind. Held here on every OS CI runs:
// the first failure ends verify within moments, non-zero, and no process of any step outlives it.

const repoRoot = path.resolve(__dirname, '..', '..');
const runner = pathToFileURL(path.join(repoRoot, 'scripts', 'verify-runner.mjs')).href;

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
