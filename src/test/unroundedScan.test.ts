import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { getStrings } from '../shared/i18n/strings';
import { diffHeadline } from '../webview/runtime/comparePanes';
import { BAND_CENTERS_HZ, buildEntryModel } from '../webview/runtime/entryTable';
import { compareOf } from './helpers/compareInput';
import { backendRequired } from './helpers/python';
import { backendPython } from './uiSmoke/realBackend';

const repoRoot = path.resolve(__dirname, '..', '..');
const SCAN = path.join(repoRoot, 'src', 'test', 'fixtures', 'unroundedScan', 'scan.py');
/** The backend is required where the repo has its .venv (or AWA_REQUIRE_BACKEND=1), as the UI tests require it. */
const required = backendRequired();

/** The three recordings scan.py writes, each scanned by the backend's own scan command with every Welch bin. */
function scanned(): Map<string, ScanResult> | null {
    const python = backendPython();
    if (!python) {
        if (required) throw new Error('the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo\'s .venv)');
        return null;
    }
    const directory = mkdtempSync(path.join(os.tmpdir(), 'awa-unrounded-scan-'));
    try {
        const run = spawnSync(python.command, [...python.args, SCAN, directory], { encoding: 'utf8', timeout: 120_000 });
        if (run.status !== 0) throw new Error(`the backend's scan failed: ${run.stderr}`);
        return new Map(Object.entries(JSON.parse(run.stdout) as Record<string, ScanResult>));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

const fourDecimals = (value: number): number => Math.round(value * 1e4) / 1e4;

test('a scan\'s levels are sent unrounded and its median and Δ are of them: three levels 3.5e-5 dB apart give run 3 a Δ of 8.7e-6 dB from its group, never 0 (R1)', { timeout: 180_000 }, t => {
    const results = scanned();
    if (!results) { t.skip('no Python backend'); return; }
    const [run1, run2, run3] = [...results.keys()].sort();
    const leq = (file: string): number => (results.get(file) as ScanResult & { ok: true }).leqDbA![0];
    // Within 1e-4 dB of each other: rounded to 1e-4 dB (what the scan sent before), they are one level.
    assert.equal(new Set([run1, run2, run3].map(file => fourDecimals(leq(file)))).size, 1);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: BAND_CENTERS_HZ.indexOf(1000) });
    const comparison = compareOf(model, results, run3, null, getStrings('en'));
    assert.deepEqual(comparison.base?.filePaths, [run1, run2]);
    // The median of runs 1 and 2 and run 3's Δ from it, of the levels as the backend measured them.
    const median = (leq(run1) + leq(run2)) / 2;
    assert.equal(comparison.leq?.base, median);
    assert.equal(comparison.leq?.delta, leq(run3) - median);
    assert.ok(Math.abs(comparison.leq.delta - (20 * Math.log10(1 + 3e-6) - 10 * Math.log10(1 + 4e-6))) < 3e-6, `Δ ${comparison.leq.delta}`);
    assert.ok(comparison.leq.delta > 4e-6);
    // The levels rounded to 1e-4 dB first would give a Δ of 0.
    assert.equal(fourDecimals(leq(run3)) - (fourDecimals(leq(run1)) + fourDecimals(leq(run2))) / 2, 0);
    // The 1 kHz band and the 1 kHz bin alike: unrounded, and their Δ is of them.
    const band = BAND_CENTERS_HZ.indexOf(1000);
    assert.ok(Math.abs(comparison.bandDeltas[band]! - comparison.leq.delta) < 3e-6 && comparison.bandDeltas[band]! > 4e-6, `band Δ ${comparison.bandDeltas[band]}`);
    const bin = Math.round(1000 / comparison.bins!.hz);
    assert.ok(Math.abs(comparison.bins!.diff![bin] - comparison.leq.delta) < 3e-6 && comparison.bins!.diff![bin] > 4e-6, `bin Δ ${comparison.bins!.diff![bin]}`);
    // A peak frequency and a crest factor are sent unrounded too (a median is taken of them): only text rounds.
    assert.equal((results.get(run3) as ScanResult & { ok: true }).peakHz![0], 1000);
    assert.ok((results.get(run3) as ScanResult & { ok: true }).crest!.some(value => value !== Math.round(value * 1000) / 1000));
    // What is written is rounded, and only there.
    assert.ok(diffHeadline(comparison, getStrings('en')).endsWith('Leq +0.0 dB'), diffHeadline(comparison, getStrings('en')));
});
