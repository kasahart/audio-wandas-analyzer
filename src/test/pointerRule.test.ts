/**
 * The pointer's one rule for every kind of line (docs/display-rules.md R7), and where a readout's digits come from:
 *
 * - the NEAREST point (picked within the pick radius) is only ever a point whose value is on screen;
 * - the point UNDER THE POINTER (read when none is within the radius) is the line's point at the pointer's place,
 *   whatever its value: past a zoomed value axis its mark is held at the plot's edge and its true value is written;
 * - a place's digits come from the step of the SOURCE data, which the source sends with each point (`steps`), never
 *   from the gap between the few points a dense window sends.
 */
import { testLine } from './helpers/whole';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { StagePoints, StageView } from '../shared/protocol/backendProtocol';
import { fetchedSource, mappedSource, sourceSteps, type FullSource } from '../webview/runtime/fullRead';
import { stageHover, stageStep, type StageLayer, type StagePlot } from '../webview/runtime/stagePanes';

/** The four kinds of line a plot draws. Each is 41 points one unit apart, all 0 but 50 at x = 20. */
const KINDS = ['waveform', 'spectrum', 'level trend', 'Δ'] as const;
type Kind = typeof KINDS[number];
const XS = Array.from({ length: 41 }, (_, index) => index);
const VALUES = XS.map(x => (x === 20 ? 50 : 0));

/**
 * A plot 400 × 100 px of one line of `kind`, 10 px a point across, its value axis zoomed to −10…10 (5 px a unit): the
 * point at x = 20 (50) is past the axis's top, every other point is at mid height (y = 50).
 */
function plotOf(kind: Kind, full: FullSource = testLine(XS, VALUES)): StagePlot {
    const base = { kind: 'line', xScale: 'linear', xs: [0, 40], values: [0, 0] };
    const view = (kind === 'waveform'
        ? { ...base, frame: 'ChannelFrame', x: 'time', quantity: 'value', waveform: { min: [0, 0], max: [0, 0], minT: [0, 40], maxT: [0, 40], absolutePeak: 50, unit: 'Pa', ref: 2e-5 } }
        : kind === 'level trend' ? { ...base, frame: 'ChannelFrame', x: 'time', quantity: 'level', unit: 'Pa' }
        : { ...base, frame: 'SpectralFrame', x: 'frequency', quantity: 'level', unit: 'Pa' }) as unknown as StageView;
    const layer: StageLayer = { view, color: 'blue', full };
    return {
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: x => x * 10, xOf: x => x / 10,
        yAt: value => 50 - value * 5, levelOf: y => (50 - y) / 5, ratioStep: 1.12, diff: kind === 'Δ', levelUnit: kind === 'Δ' ? 'dB' : 'dB re 20 µPa',
        ...(kind === 'waveform' ? { signal: { unit: 'Pa', range: { min: -10, max: 10 }, paint: () => undefined } } : {}),
        lines: [layer],
    };
}

/** What the pointer at (x, y) reads once its source has answered (a fetched source's first hover only asks). */
function hover(plot: StagePlot, x: number, y: number) {
    const first = stageHover(plot, x, y);
    return first?.pending ? stageHover(plot, x, y) : first;
}

test('on a waveform, a spectrum, a level trend and a Δ line alike, with the value axis zoomed the pointer picks its nearest point among those on screen, and with none near reads the point under it whatever its value, at the plot\'s edge (R7)', () => {
    for (const kind of KINDS) {
        const plot = plotOf(kind);
        // 3 px right of x = 20 and 2 px above mid height: the points at 19, 20 and 21 are within the pick radius across.
        // The one at 20 (value 50) is past the axis, not drawn, and not picked: the nearest on screen is 21.
        const near = hover(plot, 203, 48);
        assert.equal(near?.at, 21, `${kind}: the nearest point must be one whose value is on screen (fullLineNear near, valueOnScreen)`);
        assert.equal(near?.value, 0, kind);
        // At the same place across but 45 px below every point on screen: none is within the radius. The point under
        // the pointer is the line's point there, x = 20, though its value 50 is past the axis.
        const under = hover(plot, 201, 95);
        assert.equal(under?.at, 20, `${kind}: with no point near, the point under the pointer is read whatever its value (fullLineNear at)`);
        assert.equal(under?.value, 50, `${kind}: its true value is read, not the axis's end`);
        assert.equal(under?.y, 0, `${kind}: its mark is held at the plot's edge`);
        // An arrow key reads the same point the same way.
        const from = hover(plot, 190, 50);
        assert.equal(from?.at, 19, kind);
        const stepped = from ? stageStep(plot, from, 1) : null;
        assert.equal(stepped?.at, 20, `${kind}: → steps onto the point past the axis, as the pointer reads it`);
        assert.equal(stepped?.value, 50, kind);
        assert.equal(stepped?.y, 0, kind);
    }
});

test('on a waveform, a spectrum, a level trend and a Δ line too dense to send whole, the point the backend names as under the pointer is read though its value is past the axis, and the picked one never is (R7)', () => {
    for (const kind of KINDS) {
        // A dense window's answer: three of the many points, the middle one (value 50) past the axis and named `under`.
        const answer: StagePoints = { xs: [19, 20, 21], values: [0, 50, 0], start: 0, end: 40, complete: false, under: 1, steps: [1, 1, 1] };
        const asked: Array<{ shown?: number[] }> = [];
        const plot = plotOf(kind, fetchedSource((read, done) => { asked.push(read); done(answer); }));
        assert.equal(hover(plot, 201, 95)?.value, 50, `${kind}: the backend's under point is read whatever its value`);
        assert.equal(hover(plot, 203, 48)?.at, 21, `${kind}: the nearest picked is on screen`);
        // The values on screen are sent, so the backend holds its nearest to them (full_read._nearest_on_screen).
        assert.deepEqual(asked.find(read => read.shown)?.shown?.map(value => Math.round(value)), [-10, 10], kind);
    }
});

test('a dense window\'s readout takes its digits from the source data\'s own step, which the answer carries, never from the gap between the points sent (R7)', () => {
    // A signal at 48 kHz, a window too dense to send whole: three samples 50 ms apart are sent, each with its step in
    // the source (1/48000 s). Its time is written to the digits that tell it from the NEXT SAMPLE.
    const rate = 48000, sent = [2.0, 2.05, 2.1];
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 4], values: [0, 0], waveform: { min: [0, 0], max: [0, 0], minT: [0, 4], maxT: [0, 4], absolutePeak: 1, unit: 'Pa', ref: 2e-5 } } as unknown as StageView;
    const signal = (steps?: number[]): StagePlot => ({
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: s => s * 100, xOf: x => x / 100, yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false,
        signal: { unit: 'Pa', range: { min: -1, max: 1 }, paint: () => undefined },
        lines: [{ view, color: 'blue', full: fetchedSource((_read, done) => { done({ xs: sent, values: [0.1, 0.2, 0.3], start: 0, end: 4, complete: false, under: 1, ...(steps ? { steps } : {}) }); }) }],
    });
    const read = hover(signal([1 / rate, 1 / rate, 1 / rate]), 205, 42);
    assert.equal(read?.at, 2.05);
    assert.equal(read?.step, 1 / rate, 'the step read is the source\'s (StagePoints.steps), not the 50 ms between the points sent');
    assert.match(read?.values ?? '', /2\.05000 s/u, `written to the digits of a sample's step: ${read?.values}`);
    // An answer that names no step gives none: the gap between the points sent is never taken for it.
    assert.equal(hover(signal(), 205, 42)?.step, undefined, 'no step is made up from the spacing of the points sent (fullPoint)');
    // A spectrum of bins 0.25 Hz apart, sent 12 Hz apart: its frequency is written to the bins' digits.
    const spectrum: StagePlot = {
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: hz => (hz - 1000) * 10, xOf: x => 1000 + x / 10, yAt: value => -value, levelOf: y => -y, ratioStep: 1.12, diff: false, levelUnit: 'dB re 20 µPa',
        lines: [{ view: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', unit: 'Pa', xs: [1000, 1040], values: [-50, -50] } as unknown as StageView, color: 'blue',
            full: fetchedSource((_read, done) => { done({ xs: [1000.5, 1012.5, 1024.5], values: [-50, -50, -50], start: 0, end: 24000, complete: false, under: 1, steps: [0.25, 0.25, 0.25] }); }) }],
    };
    assert.match(hover(spectrum, 125, 50)?.values ?? '', /1\.0125 kHz/u, 'a frequency among bins 0.25 Hz apart is written to their digits');
});

test('every source says each point\'s step in its whole data: a line the webview holds, a seek in it, and a source read on another axis (R7)', () => {
    // Points unevenly spaced: each one's step is its distance to its NEARER neighbour in all the data.
    const xs = [0, 1, 1.5, 4, 10];
    assert.deepEqual(sourceSteps(xs, 0, xs.length), [1, 0.5, 0.5, 2.5, 6]);
    assert.deepEqual(sourceSteps([7], 0, 1), [null], 'a lone point has no step');
    const source = testLine(xs, [1, 2, 3, 4, 5]);
    // A window holding only the point at 4 (and none beyond) still says its step among its neighbours not sent.
    const window = source.line({ x0: 3.9, x1: 4.1, beyond: 0 }, () => undefined);
    assert.deepEqual([window?.xs, window?.steps], [[4], [2.5]]);
    const seek = source.line({ x0: 1.5, x1: 1.5, beyond: 0, seek: 1 }, () => undefined);
    assert.deepEqual([seek?.xs, seek?.steps], [[1.5, 4], [0.5, 2.5]]);
    // Read on an axis ten times the source's (a lane on the lanes' time axis): places and steps are both carried over.
    const mapped = mappedSource(source, x => x / 10, x => x * 10).line({ x0: 39, x1: 41, beyond: 0 }, () => undefined);
    assert.deepEqual([mapped?.xs, mapped?.steps], [[40], [25]]);
});
