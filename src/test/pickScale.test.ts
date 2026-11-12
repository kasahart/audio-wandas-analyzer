/**
 * Scale for decisions is exact; holding is only for painting (docs/display-rules.md R14). A plot paints a line by
 * `paintY`, which holds a value ten spans past its axis so a stretch off the plot leaves it at the right slope. Held,
 * two of its y's are no scale: on an axis of ±0.001 over 100 px, paintY(1) − paintY(0) is 1,050 px where the axis has
 * 50,000 px per unit. The pointer's pick, the scale the plot sends the backend for a dense window
 * (full_read._nearest_on_screen) and the read mark take the axis's exact `pixelsPerUnit` and `yOf` instead.
 *
 * Each plot here is painted by paintOverlay (its own axisTransform, never a hand-made one), on the left axis, on the
 * right-hand axis and on a log frequency axis. The dense line is answered by the real backend (fixtures/pickScale/
 * answer.py: stage_combine.read_points), so the point the backend keeps and the point the readout picks are both
 * the ones the real code chooses.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { N, R, T } from './helpers/figure';
import { testLine } from './helpers/whole';
import { backendPython } from './uiSmoke/realBackend';
import { fetchedSource } from '../webview/runtime/fullRead';
import { HOVER_PICK_RADIUS_PX } from '../webview/runtime/plotHover';
import { paintOverlay, stageHover, type StageLayer, type StagePlot } from '../webview/runtime/stagePanes';
import type { StagePoints, StageRead as BackendRead, StageView } from '../shared/protocol/backendProtocol';

const repoRoot = path.resolve(__dirname, '..', '..');
const ANSWER = path.join(repoRoot, 'src', 'test', 'fixtures', 'pickScale', 'answer.py');
/** The backend is required where the repo has its .venv (or AWA_REQUIRE_BACKEND=1), as the UI tests require it. */
const required = process.env.AWA_REQUIRE_BACKEND === '1' || (process.env.AWA_REQUIRE_BACKEND !== '0' && existsSync(path.join(repoRoot, '.venv', 'bin', 'python')));

const FIX = 'R14 (docs/display-rules.md): scale for decisions is exact; holding is only for painting. Take the axis\'s '
    + 'pixelsPerUnit and yOf (stagePanes.ts axisTransform) for the pick, the scale sent to full_read.py and the read mark; '
    + 'paintY (held ten spans past the axis) is for painting a line only, and no scale is made by differencing two y\'s.';

/** The narrow value axis: ±0.001 over the plot's 100 px, 50,000 px per unit. */
const NARROW = { min: -0.001, max: 0.001 };
const EXACT = 100 / (NARROW.max - NARROW.min);
/** What differencing the held paintY around 0 gives on it: (0.001 + 10 × 0.002 − 0) × 50,000. */
const HELD = 1050;

type Case = { name: string; log: boolean; right: boolean };
const CASES: Case[] = [
    { name: 'left axis', log: false, right: false },
    { name: 'right-hand axis', log: false, right: true },
    { name: 'log frequency axis', log: true, right: false },
];

/** Runs `check` on every case; the messages of the cases it fails, so a failure names each axis it breaks on. */
function eachCase(check: (item: Case) => void): string[] {
    const broken: string[] = [];
    for (const item of CASES) {
        try { check(item); } catch (error) { broken.push(error instanceof Error ? error.message.split('\n')[0] : String(error)); }
    }
    return broken;
}

/** A canvas 120 px high (a plot of 100 px between its margins) that draws nothing. */
function canvas(): HTMLCanvasElement {
    // What is set is kept (a font is read back to scale a long tick); everything else draws nothing.
    const state = new Map<PropertyKey, unknown>([['font', '10px sans-serif']]);
    const context = new Proxy({}, {
        get: (_target, key) => (state.has(key) ? state.get(key) : key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => undefined),
        set: (_target, key, value) => { state.set(key, value); return true; },
    });
    return { width: 0, height: 0, clientWidth: 600, clientHeight: 120, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
}

/** 40,000 points across the axis, about a hundred a pixel column: a hover's window is too dense to send whole. */
const COUNT = 40_000;
function axisXs(log: boolean): number[] {
    return Array.from({ length: COUNT }, (_, index) => (log ? 100 * 100 ** (index / (COUNT - 1)) : 1000 + index * 0.25));
}

/**
 * The plot of `item`, painted with the dense line on the narrow axis (left or right-hand); its full data is answered
 * by `answer`. On the right-hand case, the left axis holds a flat line far from the pointer.
 */
function painted(item: Case, answer: (read: BackendRead) => StagePoints | null): { plot: StagePlot; on: StagePlot; asked: BackendRead[] } {
    const xs = axisXs(item.log);
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: item.log ? 'log' : 'linear', quantity: 'value', xs: [xs[0], xs[COUNT - 1]], values: [0, 0] } as unknown as StageView;
    const asked: BackendRead[] = [];
    const dense: StageLayer = { view, color: '#f80', label: 'dense', full: fetchedSource((read, done) => { asked.push(read); done(answer(read)); }) };
    const axes = N({ x: 'Frequency [Hz]', y: item.right ? 'Amplitude [FS]' : 'Value [Pa]' });
    const plot = item.right
        ? paintOverlay(canvas(), { layers: [{ view, color: '#00f', label: 'left', full: testLine([xs[0], xs[COUNT - 1]], [0.9, 0.9]) }] }, R({ min: -1, max: 1 }), axes,
            { secondary: { layers: [dense], range: R(NARROW), title: T('Value [Pa]') } })
        : paintOverlay(canvas(), { layers: [dense] }, R(NARROW), axes);
    assert.ok(plot, `${item.name}: painted`);
    const on = item.right ? plot.secondary : plot;
    assert.ok(on, `${item.name}: the right-hand axis is painted`);
    assert.equal(on.frame.height, 100, `${item.name}: a plot of 100 px`);
    assert.deepEqual(on.valueRange, NARROW, `${item.name}: the narrow axis is painted as given`);
    return { plot, on, asked };
}

/**
 * The dense line around the pointer at (`x`, the plot's middle, value 0), its points placed at offsets from the
 * pointer in pixels. Every point is ±0.0008 (40 px from the pointer, each pixel column's lowest and highest) but
 * three: A 0.3 px right and 5 px up (0.0001), B 3.2 px right and 1 px up (0.00002), Z 3.7 px right at the pointer's
 * height (0). On screen B is nearest (3.35 px; Z 3.70, A 5.01). By the held scale the heights all but vanish and A
 * is nearest (0.32 px). B and Z share one of the backend's columns, where Z is the nearest in height: so B reaches
 * the webview only as the point nearest on screen, which needs the exact scale.
 */
function denseLine(on: StagePlot, item: Case, x: number): { xs: number[]; values: number[]; b: number; z: number } {
    const xs = axisXs(item.log);
    const values = xs.map((_, index): number => (index % 2 ? 0.0008 : -0.0008));
    const xOf = on.xOf;
    assert.ok(xOf);
    const place = (offset: number, value: number): number => {
        const at = xOf(x + offset);
        let index = 0;
        for (let next = 1; next < COUNT; next++) if (Math.abs(xs[next] - at) < Math.abs(xs[index] - at)) index = next;
        xs[index] = at;
        values[index] = value;
        return at;
    };
    place(0.3, 0.0001);
    const b = place(3.2, 0.00002), z = place(3.7, 0);
    for (let index = 1; index < COUNT; index++) assert.ok(xs[index] > xs[index - 1], 'the line\'s xs stay sorted');
    return { xs, values, b, z };
}

/** The backend's answers (answer.py) to `reads` of the line. */
function backend(line: { xs: number[]; values: number[] }, reads: BackendRead[]): Array<StagePoints | null> {
    const python = backendPython();
    const run = python ? spawnSync(python, [ANSWER], { input: JSON.stringify({ xs: line.xs, values: line.values, reads }), encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }) : undefined;
    if (!run || run.status !== 0) throw new Error(`the backend's read failed: ${run?.stderr ?? 'no Python'}`);
    return run.stdout.trim().split('\n').map(text => JSON.parse(text) as StagePoints | null);
}

function backendReady(): boolean {
    const python = backendPython();
    const ok = !!python && spawnSync(python, [ANSWER], { input: JSON.stringify({ xs: [1, 2], values: [0, 0], reads: [{ x: [1], beyond: 0 }] }), encoding: 'utf8', timeout: 60_000 }).status === 0;
    if (!ok && required) throw new Error('the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo\'s .venv) but answer.py could not run');
    return ok;
}

test('on a value axis of ±0.001 over 100 px the scale a plot sends for a dense window is the axis\'s exact 50,000 px per unit, never 1,050 from the held painting y: on the left axis, the right-hand one and a log frequency axis (R14)', () => {
    const broken = eachCase(item => {
        const { on, asked } = painted(item, () => null);
        const x = on.frame.left + on.frame.width / 2, y = on.frame.top + on.frame.height / 2;
        assert.equal(stageHover(on, x, y)?.pending, true, `${item.name}: the window is asked for`);
        const sent = asked[0]?.pixels;
        assert.ok(sent, `${item.name}: the read sends the screen's scale`);
        assert.ok(Math.abs(sent[1] - EXACT) < 1e-6, `${item.name}: sent ${sent[1]} px per unit, the axis has ${EXACT}${Math.abs(sent[1] - HELD) < 1e-6 ? ' (the held paintY\'s difference)' : ''}. ${FIX}`);
        assert.equal(on.pixelsPerUnit, EXACT, `${item.name}: the axis's own scale. ${FIX}`);
        assert.ok(Math.abs(on.yOf(0.0005) - (on.frame.top + 25)) < 1e-9, `${item.name}: yOf is the exact place`);
        assert.ok(Math.abs(on.yOf(1) - (on.frame.top + 50 - EXACT)) < 1e-6, `${item.name}: yOf holds nothing, however far past the axis (${on.yOf(1)}). ${FIX}`);
    });
    assert.deepEqual(broken, [], FIX);
});

test('a dense line whose nearest point differs between the held scale and the exact one: the backend keeps the exact-scale point and the readout picks it, on the left axis, the right-hand one and a log frequency axis (R7, R14)', { timeout: 300_000 }, t => {
    if (!backendReady()) { t.skip('no Python backend'); return; }
    const broken = eachCase(item => {
        let line: { xs: number[]; values: number[]; b: number; z: number } | null = null;
        const answers: Array<StagePoints | null> = [];
        const { plot, on, asked } = painted(item, read => { const answer = line ? backend(line, [read])[0] : null; answers.push(answer); return answer; });
        const x = on.frame.left + on.frame.width / 2, y = on.frame.top + on.frame.height / 2;
        line = denseLine(on, item, x);
        const first = stageHover(on, x, y);
        assert.equal(first?.pending, true, `${item.name}: the window is asked for`);
        const read = stageHover(on, x, y);
        const sent = asked[asked.length - 1];
        assert.equal(sent.columns !== undefined && sent.near !== undefined, true, `${item.name}: a dense window's read`);
        // The data tells the two scales apart: by the held one the backend does not keep B (its window keeps each
        // column's lowest, highest and nearest in height, and the one point nearest by the scale sent).
        const [held, exact] = backend(line, [{ ...sent, pixels: [sent.pixels?.[0] ?? 0, HELD] }, { ...sent, pixels: [sent.pixels?.[0] ?? 0, EXACT] }]);
        assert.equal(held?.complete, false, `${item.name}: the window is too dense to send whole`);
        assert.ok(!held?.xs.includes(line.b), `${item.name}: by the held scale the backend leaves B out (the case discriminates)`);
        assert.ok(exact?.xs.includes(line.b), `${item.name}: by the exact scale the backend keeps B (full_read._nearest_on_screen)`);
        // The TS path: the readout picks B, within the pick radius, not Z (the nearest of what the held scale keeps).
        assert.equal(read?.full, true, `${item.name}: read from the full data`);
        assert.equal(read?.at, line.b, `${item.name}: the readout picks the point nearest on screen (B at ${line.b}), not ${read?.at === line.z ? 'Z' : read?.at}. ${FIX}`);
        // The Python path: the backend's answer to the read the plot sent holds B.
        const answered = answers[answers.length - 1];
        assert.ok(answered?.xs.includes(line.b), `${item.name}: the backend keeps the point nearest on screen for the read the plot sent (scale ${sent.pixels?.[1]}). ${FIX}`);
        assert.ok(read && Math.hypot(read.x - x, read.y - y) <= HOVER_PICK_RADIUS_PX, `${item.name}: within the pick radius`);
        // The read mark is at B's exact place on its own axis (1 px over the pointer).
        assert.ok(read && Math.abs(read.y - (y - 1)) < 1e-6, `${item.name}: the mark at B's exact y (${read?.y}). ${FIX}`);
        assert.ok(item.right ? plot.secondary === on : plot === on, `${item.name}: read on its own axis's plot`);
    });
    assert.deepEqual(broken, [], FIX);
});
