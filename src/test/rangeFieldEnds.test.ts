/**
 * Display rule R9: a range box writes the very ends its axis is painted with. For every kind of range popover the
 * comparison opens, the number each field reads back as (`Number(field)`) is the end the axis was painted with
 * (paintOverlay's `data-plot-ends`, the plot's own record, never a number of the test's), and applying the fields
 * unchanged paints the same range again. The runtime is the real comparison Webview in jsdom; the ranges are chosen
 * so that rounding shows: a top of 11025 Hz, a peak of 0.73 (an automatic edge of 0.8295454…), a zoom of 1/3, a
 * right-hand level axis following a fractional left one.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { getRenderScript } from './helpers/comparisonScriptLoader';
import { createWebviewEnv, evalScript } from './helpers/webviewTestEnv';
import { exactFieldText } from '../webview/plot/plotText';
import { fieldWindow, laneAmplitudeRange, windowEnds } from '../webview/runtime/figureModel';
import { overlayLevelAxes, rightAxisLeftRange } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSeries } from '../webview/runtime/types';
import type { StageView } from '../shared/protocol/backendProtocol';
import { paintOverlay } from '../webview/runtime/stagePanes';
import { linearAxis, openAxisPart, type AxisMapping, type RangePopover, type RangePopoverRequest } from '../webview/rangePopover';
import { N, R } from './helpers/figure';
import { held } from './helpers/heldSource';

const LOOP_REGION_JS = readFileSync(join(__dirname, '..', 'webview', 'comparisonWaveform.js'), 'utf8');

const spectrogram = (unit?: string) => ({
    values: [[-87.3, -40.1, -12.2, -50], [-70.7, -3.2, -33.3, -60], [-45.5, -20.25, -9.9, -66.6]], timeBins: 3, frequencyBins: 4,
    windowSize: 512, hopSize: 256, maxFrequencyHz: 11025, minDb: -87.3, maxDb: -3.2,
    ...(unit ? { unit, axisLabel: `Spectrum amplitude level [${unit} re 20 µPa]`, levelReferenceLabel: `${unit} re 20 µPa` } : {}),
});
const track = (name: string, peak: number, duration: number, unit?: string) => ({
    filePath: `/tmp/${name}.wav`, fileName: `${name}.wav`, audioSource: `vscode-resource:/tmp/${name}.wav`,
    sampleRateHz: 22050, durationSeconds: duration, channelCount: 1, sampleCount: Math.round(22050 * duration), error: undefined,
    channels: [{
        label: 'L', peakAbsolute: peak, unit: 'Pa',
        waveform: { min: [-peak, -peak / 3], max: [peak, peak / 2], minT: [0, duration / 2], maxT: [0, duration / 2], samples: [0, 0], absolutePeak: peak },
        spectrogram: spectrogram(unit),
    }],
});
const STATE = JSON.stringify({ mode: 'results', results: [track('a', 0.73, 0.73), track('b', 0.31, 1.0, 'dB SPL')] });

type Env = ReturnType<typeof createWebviewEnv>;
function setup(): Env {
    const env = createWebviewEnv(STATE, null);
    evalScript(env.dom, LOOP_REGION_JS);
    evalScript(env.dom, getRenderScript());
    return env;
}
const frame = (env: Env): Promise<void> => new Promise(resolve => env.dom.window.requestAnimationFrame(() => resolve()));
/** The ends a canvas's axes were painted with, as paintOverlay records them. */
function painted(env: Env, id: string): { x: [number, number]; y: [number, number]; right?: [number, number] } {
    const text = env.dom.window.document.getElementById(id)?.dataset.plotEnds;
    assert.ok(text, `${id} records the ends it was painted with (data-plot-ends)`);
    return JSON.parse(text);
}
function fields(env: Env, prefix: string): { min: string; max: string; apply(): void; set(min: string, max: string): void } {
    const doc = env.dom.window.document;
    const min = doc.getElementById(`${prefix}-min`) as HTMLInputElement, max = doc.getElementById(`${prefix}-max`) as HTMLInputElement;
    return {
        min: min.value, max: max.value,
        apply() { (doc.getElementById(`${prefix}-apply`) as HTMLElement).click(); },
        set(a: string, b: string) { min.value = a; max.value = b; },
    };
}
const dblclick = (env: Env, id: string, clientX = 10, clientY = 20): void => {
    env.dom.window.document.getElementById(id)?.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX, clientY }));
};
/** R9's check: each field, read back, is the end painted. */
function writesPainted(got: { min: string; max: string }, ends: readonly [number, number], what: string): void {
    assert.deepEqual([Number(got.min), Number(got.max)], [...ends], `R9: the ${what} range box writes ${got.min} to ${got.max}, but the axis is painted from ${ends[0]} to ${ends[1]}. `
        + 'Write the painted ends with exactFieldText, and make the range at the field\'s numbers in figureModel (never round the text).');
}

test('every lane range box writes the ends its axis is painted with, and applied unchanged paints the same range: amplitude, spectrogram band (box-zoomed too) and the lanes\' time (R9)', async () => {
    const env = setup();
    await frame(env);
    // The waveform's automatic amplitude: a peak of 0.73 is painted from an edge widened to the field's numbers.
    dblclick(env, 'track-axis-canvas-0');
    let box = fields(env, 'wave-range');
    const auto = painted(env, 'track-canvas-0').y;
    writesPainted(box, auto, 'waveform amplitude');
    box.apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-canvas-0').y, auto, 'R9: the amplitude applied unchanged is the range it was');
    // Typed ends are painted at the numbers typed, through the peak (a norm times 0.73 is no float step off them).
    dblclick(env, 'track-axis-canvas-0');
    fields(env, 'wave-range').set('-0.3', '0.41');
    fields(env, 'wave-range').apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-canvas-0').y, [-0.3, 0.41], 'R9: a typed amplitude is painted at the numbers typed');
    dblclick(env, 'track-axis-canvas-0');
    writesPainted(fields(env, 'wave-range'), [-0.3, 0.41], 'waveform amplitude (typed)');
    // The other lane follows by the same part of its own peak: its box writes its own painted ends.
    dblclick(env, 'track-axis-canvas-1');
    box = fields(env, 'wave-range');
    const other = painted(env, 'track-canvas-1').y;
    writesPainted(box, other, 'waveform amplitude (another lane)');
    box.apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-canvas-1').y, other, 'R9: applied unchanged on another lane, its range is the range it was');

    // The spectrogram's band: up to 11025 Hz, never 11030.
    dblclick(env, 'track-spec-axis-canvas-0');
    box = fields(env, 'wave-range');
    const band = painted(env, 'track-spec-canvas-0').y;
    writesPainted(box, band, 'spectrogram frequency');
    box.apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-spec-canvas-0').y, band, 'R9: the band applied unchanged is the band it was');
    // Box-zoomed to a part of it: the band's ends are made at the field's numbers and written so.
    const canvas = env.dom.window.document.getElementById('track-spec-canvas-0') as HTMLCanvasElement;
    const W = canvas.width || 800, H = canvas.height || 64;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
    const mouse = (type: string, x: number, y: number) => canvas.dispatchEvent(new env.dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: type === 'mouseup' ? 0 : 1 }));
    mouse('mousedown', W * 0.1, H * 0.21);
    mouse('mousemove', W * 0.5, H * 0.5);
    mouse('mousemove', W * 0.9, H * 0.79);
    mouse('mouseup', W * 0.9, H * 0.79);
    await frame(env);
    const zoomed = painted(env, 'track-spec-canvas-0').y;
    assert.ok(zoomed[1] - zoomed[0] < band[1] - band[0], `the box zoom narrowed the band: ${zoomed.join('–')} of ${band.join('–')}`);
    dblclick(env, 'track-spec-axis-canvas-0');
    box = fields(env, 'wave-range');
    writesPainted(box, zoomed, 'spectrogram frequency (box-zoomed)');
    box.apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-spec-canvas-0').y, zoomed, 'R9: a box-zoomed band applied unchanged is the band it was');

    // The lanes' time, zoomed in by the keys: the ruler's range box writes the lanes' painted time.
    for (let step = 0; step < 3; step++) env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: '+' }));
    await frame(env);
    // jsdom lays nothing out: the first lane is the one shown, as the ruler finds it in a browser.
    Object.defineProperty(env.dom.window.document.getElementById('track-canvas-0'), 'offsetParent', { get: () => env.dom.window.document.body });
    dblclick(env, 'ruler-canvas');
    box = fields(env, 'wave-range');
    const time = painted(env, 'track-canvas-0').x;
    assert.ok(time[0] > 0, `the lanes are zoomed in time: ${time.join('–')}`);
    writesPainted(box, time, 'time');
    box.apply();
    await frame(env);
    assert.deepEqual(painted(env, 'track-canvas-0').x, time, 'R9: the time applied unchanged is the time it was');
    env.dom.window.close();
});

test('the cursor spectrum\'s range boxes write the ends it is painted with, and applied unchanged paint the same: frequency, level and the right-hand level axis (R9)', async () => {
    const env = setup();
    await frame(env);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement;
    const W = overlay.width || 800, H = overlay.height || 140;
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) });
    const ends = (): ReturnType<typeof painted> => painted(env, 'spectrum-overlay-canvas');
    assert.ok(ends().right, 'two level references: the right-hand axis is painted');
    // Zoomed in by the buttons: the frequency and level ends are a zoom's, made at the field's numbers.
    env.dom.window.document.querySelector<HTMLElement>('[data-action="spec-zoom-in"]')?.click();
    await frame(env);
    assert.ok(ends().x[0] > 0, `the frequency axis is zoomed in: ${ends().x.join('–')}`);
    for (const [what, open, side] of [
        ['frequency', () => overlay.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: H - 5 })), 'x'],
        ['level', () => overlay.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: Math.floor(H / 2) })), 'y'],
        ['right-hand level', () => overlay.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: W - 5, clientY: Math.floor(H / 2) })), 'right'],
    ] as const) {
        const before = ends();
        open();
        const box = fields(env, 'spec-range');
        writesPainted(box, before[side] as [number, number], `cursor spectrum ${what}`);
        box.apply();
        await frame(env);
        assert.deepEqual(ends(), before, `R9: the cursor spectrum's ${what} applied unchanged paints the same ranges`);
    }
    // A range typed on the right-hand axis is painted there at the numbers typed (the left one follows to show them).
    overlay.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: W - 5, clientY: Math.floor(H / 2) }));
    fields(env, 'spec-range').set('-70.5', '-12');
    fields(env, 'spec-range').apply();
    await frame(env);
    assert.deepEqual(ends().right, [-70.5, -12], 'R9: a right-hand range typed is painted at the numbers typed');
    overlay.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: Math.floor(H / 2) }));
    writesPainted(fields(env, 'spec-range'), ends().y, 'cursor spectrum level (set from the right-hand axis)');
    env.dom.window.close();
});

test('a range made for a range box is at the numbers it writes: an amplitude typed through any peak, a zoom window, the right-hand level axis typed (R9)', () => {
    let seed = 7;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const failures: string[] = [];
    for (let index = 0; index < 3000; index++) {
        const peak = 10 ** (next() * 12 - 7) * (1 + next());
        // The automatic amplitude, and a typed one: written and read back, it paints the same numbers through the peak.
        const auto = laneAmplitudeRange(peak);
        if (Number(exactFieldText(auto.max)) !== auto.max || !(auto.max >= peak / 0.88)) failures.push(`auto ${peak}: ${auto.min}…${auto.max}`);
        const typed = fieldWindow(-peak * next(), peak * (0.1 + next()));
        const again = laneAmplitudeRange(peak, { minNorm: Number(exactFieldText(typed.min)) / peak, maxNorm: Number(exactFieldText(typed.max)) / peak });
        if (again.min !== typed.min || again.max !== typed.max) failures.push(`typed ${typed.min}…${typed.max} through ${peak}: painted ${again.min}…${again.max}`);
        // A zoom window: its ends written and typed back give the same window.
        const whole = { min: -100 + next() * 50, max: next() * 30 }, part = { start: next() * 0.4, end: 0.6 + next() * 0.4 };
        const window = windowEnds(whole, part), span = whole.max - whole.min;
        const back = windowEnds(whole, { start: (Number(exactFieldText(window.min)) - whole.min) / span, end: (Number(exactFieldText(window.max)) - whole.min) / span });
        if (back.min !== window.min || back.max !== window.max) failures.push(`window ${window.min}…${window.max}: typed back ${back.min}…${back.max}`);
        // The right-hand level axis typed: the left range that shows it makes it paint at the numbers typed.
        const series = [
            { slice: { minDb: -100 + next() * 40, maxDb: -next() * 20, maxFrequencyHz: 1000, unit: 'dBFS' } },
            { slice: { minDb: -80 + next() * 40, maxDb: 10 + next() * 20, maxFrequencyHz: 1000, unit: 'dB SPL', levelReferenceLabel: 'dB SPL re 20 µPa' } },
        ] as unknown as SpectrumSeries[];
        const follow = overlayLevelAxes(series, { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null })[1]?.follow;
        if (!follow) { failures.push('two references make no right-hand axis'); continue; }
        const right = fieldWindow(follow.right.min + next() * 10, follow.right.max - next() * 10);
        const left = rightAxisLeftRange(follow, right);
        const shown = overlayLevelAxes(series, { freqStart: 0, freqEnd: 1, dbMin: left.min, dbMax: left.max })[1]?.visible;
        if (!shown || shown.dbMin !== right.min || shown.dbMax !== right.max) failures.push(`right ${right.min}…${right.max}: painted ${shown?.dbMin}…${shown?.dbMax}`);
    }
    assert.deepEqual(failures.slice(0, 10), [], 'R9: a range is made at the numbers its range box writes (figureModel.fieldWindow / laneAmplitudeRange, spectrumRuntime.rightAxisLeftRange)');
});

test('a plot\'s range boxes write the ends its axes are painted with, across and up, zoomed or not: a time axis, a log frequency axis, a heatmap\'s rows; applied unchanged, the same (R9)', () => {
    const state: Record<string, string> = { font: '10px sans-serif', textAlign: 'left' };
    const context = new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'font' || key === 'textAlign' ? state[key]
            : key === 'createImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => { if (key === 'font' || key === 'textAlign') state[key] = String(value); return true; },
    });
    const canvas = { width: 0, height: 0, clientWidth: 360, clientHeight: 160, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    const line = (xs: number[], log: boolean): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: log ? 'frequency' : 'time', xScale: log ? 'log' : 'linear', quantity: 'level', xs, values: xs.map(() => -20) });
    const image: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', xs: [0.013, 0.5, 1.37], ys: [0, 3675, 7350, 11025], matrix: [[-1, -2, -3], [-4, -5, -6], [-7, -8, -9], [-1, -1, -1]] };
    // The log axis's edges: half a ratio beyond its first and last place (stagePanes.axisScale).
    const LOG_LOW = 20 / Math.sqrt(50), LOG_HIGH = 20000 * Math.sqrt(50);
    const failures: string[] = [];
    const parts = [{ start: 0, end: 1 }, { start: 1 / 3, end: 2 / 3 }, { start: 0.123457, end: 1 }, { start: 0, end: 0.7071 }, { start: 0.4999999, end: 0.5000001 }];
    for (const [name, view] of [['time', line([0.0123, 0.73, 2.9999791666666667], false)], ['log frequency', line([20, 1000, 20000], true)], ['heatmap', image]] as const) {
        for (const across of [true, false]) {
            if (!across && view.kind !== 'heatmap') continue;
            for (const part of parts) {
                const window = across ? { x: part } : { y: part };
                const plot = paintOverlay(canvas, { layers: [{ view, color: 'a', full: held(view) }] }, R({ min: -30, max: 0 }), N({ x: 'X', y: 'Y', colour: 'Level [dBFS]' }), { window });
                const shown = across ? plot?.xRange : plot?.rowRange;
                if (!shown) { failures.push(`${name}: no painted ends`); continue; }
                let request: RangePopoverRequest | null = null;
                const popover: RangePopover = { open(given) { request = given; }, close() { /* nothing open */ }, dispose() { /* nothing attached */ } };
                const set: Array<{ start: number; end: number }> = [];
                // The axis's own mapping between its parts and its values, as the plots' callers give it.
                const ends = across ? [view.xs?.[0] ?? 0, view.xs?.[view.xs.length - 1] ?? 1] : [image.ys?.[0] ?? 0, image.ys?.[image.ys.length - 1] ?? 1];
                const mapping: AxisMapping = view.xScale === 'log' && across
                    ? { at: f => LOG_LOW * (LOG_HIGH / LOG_LOW) ** f, of: v => Math.log(v / LOG_LOW) / Math.log(LOG_HIGH / LOG_LOW), label: 'X' }
                    : linearAxis(ends[0], ends[1], 'X');
                openAxisPart(popover, { mapping, horizontal: across, current: part, shown, clientX: 0, clientY: 0, invalid: '', set: next => { set.push(next); } });
                const opened = request as RangePopoverRequest | null;
                if (!opened) { failures.push('no popover'); continue; }
                const at = `${name} ${across ? 'across' : 'up'} ${part.start}–${part.end}`;
                if (Number(opened.min) !== shown.min || Number(opened.max) !== shown.max) failures.push(`${at}: fields ${opened.min} to ${opened.max}, painted ${shown.min} to ${shown.max}`);
                if (part.start !== 0 && Math.abs(shown.min) > 1e-3 && opened.min.length > 12) failures.push(`${at}: a zoom's end ${opened.min} is a float step, not made at the field's numbers`);
                opened.apply(Number(opened.min), Number(opened.max));
                const again = paintOverlay(canvas, { layers: [{ view, color: 'a', full: held(view) }] }, R({ min: -30, max: 0 }), N({ x: 'X', y: 'Y', colour: 'Level [dBFS]' }), { window: across ? { x: set[0] } : { y: set[0] } });
                const after = across ? again?.xRange : again?.rowRange;
                if (!after || after.min !== shown.min || after.max !== shown.max) failures.push(`${at}: applied unchanged, painted ${after?.min} to ${after?.max}`);
            }
        }
    }
    assert.deepEqual(failures, [], 'R9: a plot\'s axis is painted from its window\'s ends at the field\'s numbers (stagePanes.windowed → figureModel.fieldWindow), and its range box writes them exactly (StagePlot.xRange / rowRange, openAxisPart `shown`)');
});
