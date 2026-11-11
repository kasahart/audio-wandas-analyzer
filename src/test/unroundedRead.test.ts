import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchedSource } from '../webview/runtime/fullRead';
import { stageDiffRange, stageHover, stageStep, strokeStageLine, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
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

test('a Δ of −260 dB is a Δ, not silence: the backend\'s difference is read, stepped onto, drawn and ranged at −260 dB (R1, R7)', { timeout: 120_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    // The difference of answer.py's compared recording (−269.996 dB at 300 Hz) and its base (−9.996 dB): 0 dB at every
    // bin but −260 dB at 300 Hz. A level of the same picture at −260 dB would be silence; its Δ is not.
    const xs = [100, 200, 300, 400, 500, 600, 700, 800];
    const values = xs.map(hz => (hz === 300 ? -260 : 0));
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', unit: 'Pa', xs, values, valueRange: { min: -260, max: 0 } } as unknown as StageView;
    const full = fetchedSource((read, done) => { done(backendAnswer({ ...read, of: 'diff' })); }, { of: 'diff' });
    const drawn: StagePlot = {
        frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: hz => hz / 10, xOf: x => x * 10,
        yAt: value => -value / 3, levelOf: y => -y * 3, ratioStep: 1.12, diff: true, levelUnit: 'dB',
        lines: [{ view, color: 'red', full }],
    };
    const read = hover(drawn, 30, 86);
    assert.equal(read?.at, 300, 'the Δ under the pointer');
    assert.equal(read?.value, -260);
    // → from 200 Hz onto it, and on past it.
    const from = hover(drawn, 20, 0);
    assert.equal(from?.at, 200);
    const onto = from ? step(drawn, from, 1) : null;
    assert.equal(onto?.at, 300, 'stepped onto the Δ of −260 dB, not past it');
    assert.equal(onto?.value, -260);
    // Drawn as a point of the line, not a gap.
    const points: Array<[number, number]> = [];
    const context = new Proxy({}, { get: (_target, key) => (key === 'lineTo' || key === 'moveTo' ? (x: number, y: number) => { points.push([x, y]); } : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    strokeStageLine(context, drawn, drawn.lines[0], 1);
    assert.ok(points.some(([x, y]) => Math.abs(x - 30) < 1e-9 && Math.abs(y - drawn.yAt(-260)) < 1e-9), `drawn at −260 dB: ${JSON.stringify(points)}`);
    // And the Δ's range holds it, as the backend's valueRange of the difference does.
    assert.ok(stageDiffRange({ ...view, valueRange: undefined }).min <= -260);
});

test('a median and a difference are taken in float64 end to end: of 0.5 and 0.5 + 2⁻²⁴ the median reads 0.5 + 2⁻²⁵, and the Δ of 0.5 + 2⁻²⁴ from it 2⁻²⁵, never 0 (R1)', { timeout: 120_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    const xs = Array.from({ length: 8 }, (_, i) => i / 1000);
    const plot = (of: 'base' | 'diff'): StagePlot => {
        const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs, values: xs.map(() => 0) } as unknown as StageView;
        const full = fetchedSource((read, done) => { done(backendAnswer({ ...read, of, fixture: 'signal' })); }, { of });
        // 2⁻²⁵ a pixel about the value read, so the line's points are where the pointer is.
        const centre = of === 'base' ? 0.5 : 0;
        return { frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: x => x * 10000, xOf: x => x / 10000, yAt: value => 50 - (value - centre) * 2 ** 25, levelOf: y => centre + (50 - y) / 2 ** 25, ratioStep: 1.12, diff: of === 'diff', lines: [{ view, color: 'blue', full }] };
    };
    assert.equal(hover(plot('base'), 30, 49)?.value, 0.5 + 2 ** -25, 'the median of 0.5 and 0.5 + 2⁻²⁴, which float32 rounds to one of them');
    assert.equal(hover(plot('diff'), 30, 49)?.value, 2 ** -25, 'the Δ of 0.5 + 2⁻²⁴ from that median');
});

test('a dense window read beyond the pick radius of every point reads the real sample under the pointer, which the backend sends (R7)', { timeout: 120_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    const count = 20_000;
    const signal = Array.from({ length: count }, (_, n) => Math.sin(n * 0.37) * Math.cos(n * 0.011) * 0.9);
    // 50 samples a pixel, the pointer 60 pixels above the plot's top: no sample is within the pick radius.
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, (count - 1) / 1000], values: [0, 0] } as unknown as StageView;
    const asked: unknown[] = [];
    const full = fetchedSource((read, done) => { asked.push(read); done(backendAnswer({ ...read, fixture: 'dense' })); });
    const drawn: StagePlot = { frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: s => s * 1000 / 50, xOf: x => x * 50 / 1000, yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', full }] };
    for (const x of [100, 100.3, 257.7]) {
        const read = hover(drawn, x, -60);
        const under = Math.round(x * 50);
        assert.equal(Math.round((read?.at ?? NaN) * 1000), under, `the sample under the pointer at x = ${x}`);
        assert.equal(read?.value, signal[under]);
    }
    assert.ok(asked.some(read => (read as { columns?: number }).columns), 'read as a dense window, not whole');
});

test('on a value axis zoomed in, a dense window reads the nearest sample on screen, never one past the axis left out after (R7)', { timeout: 120_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    // 50 samples a pixel, the axis shown from −1 to 0.9: the sample under the pointer (0.95 at n = 5003) is just past
    // its top, and the one on screen nearest the pointer is 0.8 at n = 5010, seven samples on.
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 19.999], values: [0, 0] } as unknown as StageView;
    const asked: Array<{ shown?: number[] }> = [];
    const full = fetchedSource((read, done) => { asked.push(read); done(backendAnswer({ ...read, fixture: 'zoomed' })); });
    const drawn: StagePlot = {
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: s => s * 1000 / 50, xOf: x => x * 50 / 1000,
        yAt: value => (0.9 - value) / 0.019, levelOf: y => 0.9 - y * 0.019, ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', full }],
    };
    const read = hover(drawn, 5003 / 50, (0.9 - 0.89) / 0.019);
    assert.equal(Math.round((read?.at ?? NaN) * 1000), 5010, 'the nearest sample on screen');
    assert.equal(read?.value, 0.8);
    const shown = asked.find(item => item.shown)?.shown;
    assert.ok(shown && Math.abs(shown[0] + 1) < 1e-9 && Math.abs(shown[1] - 0.9) < 1e-9, `the values shown are asked for: ${JSON.stringify(shown)}`);
});
