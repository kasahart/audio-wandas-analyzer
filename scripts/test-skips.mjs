// The skip gate of `npm run verify`: in CI (CI=true, as GitHub Actions sets it) a node:test or pytest test that skips
// fails verify, unless scripts/test-skip-allowlist.json lists it with its reason, on that OS.
//
// Why: a test that skips for want of something on the machine (no Python found, no rights for a symlink) passes
// unseen, and the run looks green. Some did, in CI, on every OS: they looked for `.venv/bin/python` only. On a
// developer's machine a skip is reported but allowed (a contributor may have no Python); CI is where every test must
// run. The allowlist only shrinks: an entry whose test runs now on its OS fails verify too (remove it), and
// src/test/testSkipGate.test.ts holds the number of entries to a ceiling that only goes down.
//
// How: node:test reports through scripts/test-skip-reporter.mjs as well as spec, pytest through the --record-skips
// option of python-backend/conftest.py; each writes the skipped tests (id, reason) as JSON, and `check` compares
// them with the allowlist. pytest's opt-in markers (slow, perf) deselect rather than skip: they are not part of a run
// unless their variable asks for them, which is a choice, not a missing tool.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST = join(here, 'test-skip-allowlist.json');

/** node --test arguments that keep the spec output and also record the skipped tests to `recordFile`. */
export function nodeTestSkipArgs(recordFile) {
    return [
        '--test-reporter=spec', '--test-reporter-destination=stdout',
        `--test-reporter=${pathToFileURL(join(here, 'test-skip-reporter.mjs')).href}`, `--test-reporter-destination=${recordFile}`,
    ];
}

/** pytest arguments that record the skipped tests to `recordFile` (python-backend/conftest.py). */
export function pytestSkipArgs(recordFile) {
    return ['--record-skips', recordFile];
}

/** The allowlist's entries: { test, platform, reason }. */
export function readAllowlist(file = ALLOWLIST) {
    return JSON.parse(readFileSync(file, 'utf8')).skips;
}

/**
 * What the skips in `records` ([{ test, reason }]) break: in CI, every skip the allowlist does not list for
 * `platform`, and every entry for `platform` whose test did not skip. Empty outside CI.
 */
export function skipProblems(records, allowlist, { ci, platform }) {
    const problems = [];
    for (const entry of allowlist) {
        if (!entry.test || !entry.platform || !entry.reason) {
            problems.push(`allowlist entry ${JSON.stringify(entry)} needs a test, a platform and a reason`);
        }
    }
    if (!ci) {
        return problems;
    }
    const listed = allowlist.filter(entry => entry.platform === platform);
    for (const record of records) {
        if (!listed.some(entry => entry.test === record.test)) {
            problems.push(`${record.test} skipped (${record.reason || 'no reason given'}): in CI every test must run. Give the test what it needs, or list it in scripts/test-skip-allowlist.json with why it cannot run on ${platform}`);
        }
    }
    for (const entry of listed) {
        if (!records.some(record => record.test === entry.test)) {
            problems.push(`${entry.test} runs on ${platform} now: remove its entry from scripts/test-skip-allowlist.json (the allowlist only shrinks)`);
        }
    }
    return problems;
}

async function main([command, ...files]) {
    if (command !== 'check' || files.length === 0) {
        console.error('usage: node scripts/test-skips.mjs check <records.json>... [--allowlist <file>]');
        return 2;
    }
    const at = files.indexOf('--allowlist');
    const allowlistFile = at >= 0 ? files.splice(at, 2)[1] : ALLOWLIST;
    // A record that is missing means its test run did not finish, which the gate must not take for "nothing skipped".
    const records = files.flatMap(file => JSON.parse(readFileSync(file, 'utf8')));
    const ci = process.env.CI === 'true';
    const problems = skipProblems(records, readAllowlist(allowlistFile), { ci, platform: process.platform });
    for (const record of records) {
        console.log(`skipped: ${record.test} (${record.reason || 'no reason given'})`);
    }
    if (problems.length > 0) {
        console.error(problems.map(problem => `test skips: ${problem}`).join('\n'));
        return 1;
    }
    console.log(`test skips: ${records.length} skipped${ci ? ', each listed for this OS' : ' (allowed outside CI; CI=true fails on any not listed)'}`);
    return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    process.exitCode = await main(process.argv.slice(2));
}
