// The runner behind `npm run verify` (scripts/verify.mjs lists the steps; this file runs them). Plain Node, so it runs
// the same on Windows, macOS and Linux; src/test/verifyRunner.test.ts holds it to the rules below on every OS in CI.
//
// A lane is a list of steps that depend on the ones before them; lanes run at once. A step that needs another lane's
// step names it in `after` and waits for it.
//
// Rules (why: a verify that keeps running after it has failed, or leaves processes behind, hides the failure behind
// a timeout and takes the CI job's whole time limit with it — it did, on Windows):
// - Fail fast: the first failed step ends verify. Every step still running in any lane is stopped with its whole
//   process tree, the steps not yet started are not run, and verify exits non-zero naming the failure. A stopped step
//   is reported as stopped, not as failed, and its output so far is printed.
// - No orphans: a step is a process tree (npm starts node, pytest starts its xdist workers). Killing only the direct
//   child leaves the rest running — on Windows always, as there are no signals to a group. So each step is started
//   as its own process group on POSIX and the group is killed; on Windows `taskkill /T /F` ends the tree.
//   Whatever a step leaves behind when it exits by itself is ended with it too (POSIX), and verify does not wait more
//   than a moment for pipes such a leftover still holds open (it would never end otherwise).
// - Ctrl+C, or a CI cancel (SIGINT / SIGTERM), stops every step the same way and prints what each lane had so far.
import { spawn, spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
// How long a step that has exited may keep its output pipes open (a leftover grandchild holding them) before verify
// stops reading them. Not a step time limit: steps run as long as they need.
const PIPE_CLOSE_GRACE_MS = 2000;

const seconds = since => `${((Date.now() - since) / 1000).toFixed(1)} s`;

/** Ends a started process and every process it started. */
export function killTree(child) {
    if (child.pid === undefined) {
        return;
    }
    if (windows) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        return;
    }
    try {
        // The step is its own process group (spawned detached): this reaches its children's children too.
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        // The group is gone already.
    }
}

/**
 * Runs `lanes` ([name, steps][]; a step is [label, command, args, { after }?], an arg may be a function called at
 * start) and resolves to the labels of the failed steps (empty when every step passed). `serial` runs the lanes one by
 * one with their output live; otherwise each lane's output is printed whole when it ends, so lanes do not interleave.
 */
export async function runLanes(lanes, { cwd, env, serial = false, out = process.stdout } = {}) {
    /** Children running now, and those verify itself stopped (a stopped step is not a failure of its own). */
    const running = new Set();
    const stopped = new Set();
    let stopReason;

    const stop = reason => {
        stopReason ??= reason;
        for (const child of running) {
            stopped.add(child);
            killTree(child);
        }
    };
    const onSignal = signal => stop(`verify was stopped (${signal})`);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    /** Each step's outcome (true when it exited 0), by label, settled once it ran, failed or will not run. */
    const outcomes = new Map();
    const settle = new Map();
    for (const [, steps] of lanes) {
        for (const [label] of steps) {
            outcomes.set(label, new Promise(resolve => settle.set(label, resolve)));
        }
    }

    /** Resolves to 'ok', 'failed' or 'stopped'. */
    const runStep = ([label, command, args, { after } = {}], write, live) => new Promise(resolve => {
        const notRun = why => {
            write(`verify: ${label} not run: ${why}\n`);
            resolve('stopped');
        };
        if (stopReason) {
            return notRun(stopReason);
        }
        const waited = after ? outcomes.get(after) : Promise.resolve(true);
        void waited.then(passed => {
            if (stopReason) {
                return notRun(stopReason);
            }
            if (!passed) {
                return notRun(`${after} failed`);
            }
            const started = Date.now();
            write(`==> ${label}\n`);
            const child = spawn(command, args.map(arg => typeof arg === 'function' ? arg() : arg), {
                cwd,
                env,
                detached: !windows,
                windowsHide: true,
                stdio: live ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
            });
            running.add(child);
            if (!live) {
                child.stdout.on('data', chunk => write(chunk));
                child.stderr.on('data', chunk => write(chunk));
            }
            let done = false;
            const finish = (outcome, text) => {
                if (done) {
                    return;
                }
                done = true;
                running.delete(child);
                write(text);
                resolve(outcome);
            };
            child.on('error', error => finish('failed', `verify: could not start ${command}: ${error.message}\n`));
            child.on('exit', (status, signal) => {
                if (!windows) {
                    // What the step left running ends with it (on Windows its pid may already be another process's).
                    killTree(child);
                }
                const end = () => {
                    if (stopped.has(child)) {
                        finish('stopped', `\nverify: ${label} stopped after ${seconds(started)}: ${stopReason}\n`);
                    } else if (status === 0) {
                        finish('ok', `<== ${label} (${seconds(started)})\n`);
                    } else {
                        finish('failed', `verify: ${label} failed (${signal ? `signal ${signal}` : `exit ${status}`})\n`);
                    }
                };
                if (live) {
                    return end();
                }
                const grace = setTimeout(() => {
                    child.stdout.destroy();
                    child.stderr.destroy();
                    end();
                }, PIPE_CLOSE_GRACE_MS);
                child.on('close', () => {
                    clearTimeout(grace);
                    end();
                });
            });
        });
    });

    /** Runs a lane's steps in order up to the first that does not pass; resolves to it and its outcome, if any. */
    const lane = async (steps, write, live) => {
        for (const [index, item] of steps.entries()) {
            const outcome = await runStep(item, write, live);
            settle.get(item[0])?.(outcome === 'ok');
            if (outcome !== 'ok') {
                // The steps left in this lane will not run: a step in another lane waiting on one of them stops too.
                for (const [label] of steps.slice(index + 1)) {
                    settle.get(label)?.(false);
                }
                if (outcome === 'failed') {
                    stop(`${item[0]} failed`);
                }
                return { label: item[0], outcome };
            }
        }
        return undefined;
    };

    const failures = [];
    try {
        if (serial) {
            for (const [, steps] of lanes) {
                const ended = await lane(steps, text => out.write(text), true);
                if (ended) {
                    if (ended.outcome === 'failed') {
                        failures.push(ended.label);
                    }
                    break;
                }
            }
        } else {
            out.write(`verify: running lanes at once: ${lanes.map(([name]) => name).join(', ')} (AWA_VERIFY_SERIAL=1 runs them one by one)\n`);
            await Promise.all(lanes.map(async ([name, steps]) => {
                const laneStarted = Date.now();
                const chunks = [];
                const ended = await lane(steps, text => chunks.push(Buffer.from(text)), false);
                const state = !ended ? 'ok' : ended.outcome === 'failed' ? 'FAILED' : 'stopped';
                out.write(`\n---- ${name} lane: ${state} (${seconds(laneStarted)}) ----\n`);
                out.write(Buffer.concat(chunks));
                if (ended?.outcome === 'failed') {
                    failures.push(ended.label);
                }
            }));
        }
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
    if (failures.length === 0 && stopReason) {
        // Stopped from outside (a signal) with nothing failed: still not a pass.
        failures.push(stopReason);
    }
    return failures;
}
