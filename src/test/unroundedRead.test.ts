import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchedSource } from '../webview/runtime/fullRead';
import { stageHover, stageStep, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import type { StagePoints, StageView } from '../shared/protocol/backendProtocol';
import { backendPython } from './uiSmoke/realBackend';

const repoRoot = path.resolve(__dirname, '..', '..');
const ANSWER = path.join(repoRoot, 'src', 'test', 'fixtures', 'unroundedRead', 'answer.py');
/** The backend is required where the repo has its .venv (or AWA_REQUIRE_BACKEND=1), as the UI tests require it. */
const required = process.env.AWA_REQUIRE_BACKEND === '1' || (process.env.AWA_REQUIRE_BACKEND !== '0' && existsSync(path.join(repoRoot, '.venv', 'bin', 'python')));

/** Each read the plot sends, answered by the backend's own read path (answer.py: stage_combine.read_points). */
function backendAnswer(read: unknown): StagePoints | null | undefined {
    const python = backendPython();
    const run = python ? spawnSync(python, [ANSWER, JSON.stringify(read)], { encoding: 'utf8', timeout: 60_000 }) : undefined;
    if (!run || run.status !== 0) throw new Error(`the backend's read failed: ${run?.stderr ?? 'no Python'}`);
    return JSON.parse(run.stdout) as StagePoints | null;
}

function backendReady(): boolean {
    const python = backendPython();
    const ok = !!python && spawnSync(python, [ANSWER, '{"x":[100],"beyond":0}'], { encoding: 'utf8', timeout: 60_000 }).status === 0;
    if (!ok && required) throw new Error('the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo\'s .venv) but answer.py could not run');
    return ok;
}

/**
 * A spectrum (answer.py's eight bins, 100 Hz apart) on a plot 0.001 dB a pixel about −10 dB, its full data read from
 * the backend: −10.004 dB at 200 Hz and −9.996 dB at 300 Hz eight pixels apart, −249.999 dB at 500 Hz between silent
 * bins (−300 dB).
 */
function plot(): StagePlot {
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', unit: 'Pa', xs: [100, 800], values: [-300, -20] } as unknown as StageView;
    const full = fetchedSource((read, done) => { done(backendAnswer(read)); });
    return {
        frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: hz => hz / 10, xOf: x => x * 10,
        yAt: value => 50 - (value + 10) * 1000, levelOf: y => -10 + (50 - y) / 1000, ratioStep: 1.12, diff: false, levelUnit: 'dB re 20 µPa',
        lines: [{ view, color: 'blue', full }],
    };
}

/** What the pointer at (x, y) reads once the backend has answered (the first hover only asks). */
function hover(drawn: StagePlot, x: number, y: number): StageRead | null {
    const first = stageHover(drawn, x, y);
    return first?.pending ? stageHover(drawn, x, y) : first;
}

function step(drawn: StagePlot, from: StageRead, delta: -1 | 1): StageRead | null {
    const first = stageStep(drawn, from, delta);
    return (first === undefined ? stageStep(drawn, from, delta) : first) ?? null;
}

test('the backend\'s read is unrounded end to end: of −10.004 and −9.996 dB the pointer picks the one it is nearest, and −249.999 dB is a point the arrow keys step onto, not silence (R1, R7)', { timeout: 120_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    const drawn = plot();
    // Halfway across between 200 and 300 Hz, a pixel below −9.996 dB and seven above −10.004 dB: rounded alike to
    // −10.00 they would be at one height, and the first (−10.004) would be read.
    const read = hover(drawn, 25, 47);
    assert.equal(read?.full, true, 'read from the backend\'s full data');
    assert.equal(read?.at, 300);
    assert.equal(read?.value, -9.996);
    assert.match(read?.text ?? '', /−10\.0/u, 'written to the tenth only as text');
    // And a pixel above −10.004 dB the other way: the 200 Hz bin.
    assert.equal(hover(drawn, 25, 53)?.value, -10.004);
    // → from 300 Hz: 400 Hz is silent (−300 dB); 500 Hz at −249.999 dB is above the floor (−250 dB) and is read.
    const next = read ? step(drawn, read, 1) : null;
    assert.equal(next?.at, 500, 'stepped onto the bin just above the silent floor, not past it to 800 Hz');
    assert.equal(next?.value, -249.999);
    const after = next ? step(drawn, next, 1) : null;
    assert.equal(after?.at, 800, 'then past the silent bins');
    assert.equal(after ? step(drawn, after, -1)?.at : undefined, 500, 'and back onto it');
});
