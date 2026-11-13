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
//   as its own process group on POSIX and the group is killed; on Windows each step runs in a job object
//   (scripts/verify-job.ps1), which holds every process started in it whoever its parent, and `taskkill /T /F` on the
//   step ends the tree and with it the job.
// - A step waits for what it starts: a process still running in the step's process group (POSIX) or job (Windows) a
//   moment after the step exited fails the step, and is ended. Why: on Windows such a process could not be found by
//   process tree any more, and on any OS it would run on unseen, holding the step's output pipes open.
// - Ctrl+C, or a CI cancel (SIGINT / SIGTERM), stops every step the same way and prints what each lane had so far.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
// How long a step that has exited may keep its output pipes open, and the processes it started may take to exit by
// themselves (a compiler's helper ends when its pipe from the step closes), before verify stops reading the pipes
// and fails the step for what it left running. Not a step time limit: steps run as long as they need.
const PIPE_CLOSE_GRACE_MS = 2000;
const LEFTOVER_GRACE_MS = 2000;
const jobHelper = join(dirname(fileURLToPath(import.meta.url)), 'verify-job.ps1');

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

/** An argument as Windows programs parse their command line (the rule Node's own spawn quotes by). */
export function windowsArgument(arg) {
    if (arg === '') {
        return '""';
    }
    if (!/[\s"]/u.test(arg)) {
        return arg;
    }
    let quoted = '"';
    let backslashes = 0;
    for (const character of arg) {
        if (character === '\\') {
            backslashes += 1;
            continue;
        }
        quoted += '\\'.repeat(character === '"' ? backslashes * 2 + 1 : backslashes) + character;
        backslashes = 0;
    }
    return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

/** Starts a step: on Windows inside a job object, through scripts/verify-job.ps1; on POSIX as its own process group. */
function startStep(command, args, { cwd, env, stdio }) {
    if (!windows) {
        return spawn(command, args, { cwd, env, detached: true, stdio });
    }
    return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', jobHelper], {
        cwd,
        env: {
            ...(env ?? process.env),
            AWA_VERIFY_JOB_COMMAND_LINE: [command, ...args].map(windowsArgument).join(' '),
            AWA_VERIFY_JOB_GRACE_MS: String(LEFTOVER_GRACE_MS),
        },
        windowsHide: true,
        stdio,
    });
}

/** Whether any process of process group `group` still exists (a zombie too). */
function groupExists(group) {
    try {
        process.kill(-group, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

/** The processes of process group `group` that still run (zombies, which have ended, left out), as `pid command`. */
function groupMembers(group) {
    const listed = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,stat=,args='], { encoding: 'utf8' }).stdout ?? '';
    return listed.split('\n').map(line => line.trim().split(/\s+/u)).filter(([, pgid, stat]) => Number(pgid) === group && stat && !stat.startsWith('Z'))
        .map(([pid, , , ...words]) => `${pid} ${words.join(' ').slice(0, 120)}`);
}

/**
 * What a step that exited by itself left running in its process group (POSIX) once the processes there had a moment
 * to exit by themselves; empty when nothing did. On Windows the job helper checks the same (scripts/verify-job.ps1).
 */
async function leftRunning(child) {
    if (windows) {
        return [];
    }
    const deadline = Date.now() + LEFTOVER_GRACE_MS;
    while (groupExists(child.pid)) {
        if (Date.now() >= deadline) {
            return groupMembers(child.pid);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return [];
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
            const child = startStep(command, args.map(arg => typeof arg === 'function' ? arg() : arg), {
                cwd,
                env,
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
            // The step's output pipes have all closed (registered now: they may close while its leftovers are checked).
            const closed = new Promise(resolveClosed => child.on('close', resolveClosed));
            child.on('exit', (status, signal) => void (async () => {
                const left = stopped.has(child) ? [] : await leftRunning(child);
                if (!windows) {
                    // What the step left running ends with it (on Windows its pid may already be another process's;
                    // the job helper ends what is left there).
                    killTree(child);
                }
                if (!live) {
                    let grace;
                    await Promise.race([closed, new Promise(resolveGrace => {
                        grace = setTimeout(() => {
                            child.stdout.destroy();
                            child.stderr.destroy();
                            resolveGrace();
                        }, PIPE_CLOSE_GRACE_MS);
                    })]);
                    clearTimeout(grace);
                }
                if (stopped.has(child)) {
                    finish('stopped', `\nverify: ${label} stopped after ${seconds(started)}: ${stopReason}\n`);
                } else if (left.length > 0) {
                    finish('failed', `verify: ${label} failed: the step left ${left.length} process(es) running after it exited (they were ended): a step must wait for every process it starts\n${left.map(line => `  ${line}\n`).join('')}`);
                } else if (status === 0) {
                    finish('ok', `<== ${label} (${seconds(started)})\n`);
                } else {
                    finish('failed', `verify: ${label} failed (${signal ? `signal ${signal}` : `exit ${status}`})\n`);
                }
            })());
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
