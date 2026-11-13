import { P, T } from './helpers/figure';
import { drawableBuckets, drawableLine } from '../shared/drawnPoints';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNotDrawn, nearestOf, nthAfter } from './fullNotDrawn';
import { frequencyFraction, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { paintOverlaySpectrum, renderSpectrumAxisLegend, spectrumLayer, SECONDARY_AXIS_DASH, SECONDARY_AXIS_MARK } from '../webview/runtime/overlaySpectrumPainter';
import { screenLevels, stageHover, stageStep, type StagePlot } from '../webview/runtime/stagePanes';
import { SpectrumView } from '../webview/runtime/spectrumView';
import { OVERLAY_SPECTRUM_PAD, overlayLevelAxes, spectrumReadoutText, withCalibrationWords, type SpectrumViewState } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSeries, SpectrumSlice } from '../webview/runtime/types';
import { extractSpectrumAtCursor } from '../webview/spectrum/cursorSpectrum';
import { createLaneReads } from '../webview/runtime/laneReads';
import { NO_FULL_DATA } from '../webview/runtime/fullRead';

function recordingCtx(): { ctx: CanvasDrawCtx; calls: string[] } {
    const calls: string[] = [];
    const ctx = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'measureText') {
                return () => ({ width: 10 });
            }
            return () => { calls.push(String(prop)); };
        },
        set() {
            return true;
        },
    }) as unknown as CanvasDrawCtx;
    return { ctx, calls };
}

/** A canvas drawn on through `ctx`, at ratio 1 with no style (as paintOverlay is given a fixed size); its marks layer
 *  beside it draws through `marks` (the same context unless given). */
function canvasOf(ctx: CanvasDrawCtx, marks: CanvasDrawCtx = ctx): HTMLCanvasElement {
    const layer = { width: 0, height: 0, style: {}, getContext: () => marks };
    const parentElement = { querySelector: () => layer };
    return { width: 0, height: 0, clientWidth: 0, clientHeight: 0, offsetLeft: 0, offsetTop: 0, parentElement, ownerDocument: { defaultView: null }, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

const series: SpectrumSeries[] = [{
    slice: { values: [-60, -20, -40, -50], bins: [-60, -20, -40, -50], frequencyBins: 4, maxFrequencyHz: 1000, minDb: -60, maxDb: -20, unit: 'dB' },
    color: '#ff0000',
    index: 0,
    channelIndex: 0,
    label: 'A',
}];
const fullView: SpectrumViewState = { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null };

/** The plot a paint drew its lines on (the pointer reads them through the plot component, plotHoverLayer.ts). */
const plotOf = (paint: { plot: StagePlot | null }): StagePlot => { assert.ok(paint.plot, 'lines drawn'); return paint.plot; };

test('paintOverlaySpectrum reports the visible window and where it drew its lines, for the pointer to read', () => {
    const { ctx, calls } = recordingCtx();
    const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, fullView);
    assert.ok(calls.indexOf('clearRect') >= 0 && calls.indexOf('clearRect') < calls.indexOf('stroke'), 'cleared before anything is drawn');
    assert.equal(paint.painted, true);
    assert.equal(paint.maxFrequencyHz, 1000);
    assert.ok(paint.dbMin <= -60 && paint.dbMax >= -20);
    const plot = plotOf(paint);
    // The pointer reads the line as the cursor spectrum reads it: its name, frequency and level in its unit.
    const read = stageHover(plot, plot.xAt(1000 / 3), plot.yAt(-20));
    assert.equal(read?.text, spectrumReadoutText('A', series[0].slice, 1000 / 3, -20));
    assert.equal(read?.layer.color, '#ff0000');
});

test('paintOverlaySpectrum draws no line and gives nothing to read when the frequency window is empty', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, { ...fullView, freqStart: 0.5, freqEnd: 0.5 });
    assert.equal(paint.painted, false);
    assert.equal(paint.plot, null);
});

test('an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)', () => {
    const bins = 129, tone = 40;
    const values = Array.from({ length: bins }, (_, bin) => -Math.abs(bin - tone) / 2);
    const slice = { values, bins: values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' };
    const binHz = (bin: number) => bin * 24000 / (bins - 1);
    const { ctx } = recordingCtx();
    const plot = plotOf(paintOverlaySpectrum(canvasOf(ctx), 356, 200, [{ ...series[0], slice }], fullView));
    // The pointer on the tone's top reads the tone.
    let read = stageHover(plot, plot.xAt(binHz(tone)), plot.yAt(0));
    assert.equal(read?.text, spectrumReadoutText('A', slice, binHz(tone), 0));
    for (const [delta, bin] of [[1, tone + 1], [1, tone + 2], [-1, tone + 1], [-1, tone], [-1, tone - 1]] as const) {
        read = read ? stageStep(plot, read, delta) ?? null : null;
        assert.equal(read?.text, spectrumReadoutText('A', slice, binHz(bin), values[bin]), `${delta} to bin ${bin}`);
    }
});

test('a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)', () => {
    const bins = 8193;
    const values = Array.from({ length: bins }, (_, bin) => -50 + 20 * Math.sin(bin * 1.37) * Math.cos(bin * 0.11));
    const slice = { values, bins: values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' };
    const binHz = (bin: number) => bin * 24000 / (bins - 1);
    const { ctx } = recordingCtx();
    const plot = plotOf(paintOverlaySpectrum(canvasOf(ctx), 356, 200, [{ ...series[0], slice }], fullView));
    const drawn = new Set(plot.lines[0].view.xs);
    assert.ok(drawn.size < bins / 4, 'the line is thinned to be drawn');
    // A bin the line does not draw, under the pointer: its own frequency and level are read.
    let bin = 4000;
    while (drawn.has(binHz(bin))) bin++;
    let read = stageHover(plot, plot.xAt(binHz(bin)), plot.yAt(values[bin]));
    assert.equal(read?.full, true);
    assert.equal(read?.at, binHz(bin));
    assert.equal(read?.value, values[bin]);
    assert.equal(read?.text, spectrumReadoutText('A', slice, binHz(bin), values[bin]));
    assertNotDrawn(read?.at, nearestOf(drawn, binHz(bin)), 'not the nearest point of the line drawn');
    // ← / → visit every bin in turn, however many share a pixel.
    for (const delta of [1, -1] as const) {
        for (let step = 1; step <= 40; step++) {
            read = read ? stageStep(plot, read, delta) ?? null : null;
            bin += delta;
            assert.equal(read?.at, binHz(bin), `step ${step} (${delta})`);
            assert.equal(read?.value, values[bin]);
        }
        if (delta === 1) assertNotDrawn(read?.at, nthAfter(drawn, binHz(bin - 40), 40), 'forty keys on are forty bins on, not forty drawn points');
    }
});

test('a cursor slice is read from its every bin as the backend sends it (bins, x-whole), never from its drawn values; one without bins has nothing to read (R7)', () => {
    // values and bins differ here only so the test can tell which one was read: the backend sends the same numbers.
    const drawnValues = [-60, -20, -40, -50], every = [-61, -21, -41, -51];
    const layer = spectrumLayer({ ...series[0], slice: { ...series[0].slice, values: drawnValues, bins: every } }, 1000);
    const read = layer.full.line({ x0: 0, x1: 1000, beyond: 0 }, () => undefined);
    assert.deepEqual(read?.values, every);
    assertNotDrawn(read?.values?.[1], drawnValues[1], 'not the value drawn');
    // A slice cut for display (no bins) is only drawn: without a read of every bin (series.full) it has no full data.
    const cut = spectrumLayer({ ...series[0], slice: { ...series[0].slice, values: drawnValues, bins: undefined, frequenciesHz: [0, 250, 500, 1000] } }, 1000);
    assert.equal(cut.full, NO_FULL_DATA);
});

test('the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)', () => {
    const bins = 129, tone = 60;
    const values = Array.from({ length: bins }, (_, bin) => (bin === tone ? 0 : -60));
    const slice = { values, bins: values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' };
    const binHz = (bin: number) => bin * 24000 / (bins - 1);
    const { ctx } = recordingCtx();
    const plot = plotOf(paintOverlaySpectrum(canvasOf(ctx), 356, 200, [{ ...series[0], slice }], fullView));
    // 6 px right of the peak, a few px under its top.
    const read = stageHover(plot, plot.xAt(binHz(tone)) + 6, plot.yAt(0) + 4);
    assert.equal(read?.text, spectrumReadoutText('A', slice, binHz(tone), 0));
});

const SPL = 'Spectrum amplitude level [dB SPL re 20 µPa]';
const VOLT = 'Spectrum amplitude level [dB re 1 V]';
function levelSeries(label: string, color: string, axisLabel: string, values: number[], minDb: number, maxDb: number): SpectrumSeries {
    return { slice: { values, bins: values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb, maxDb, unit: axisLabel === SPL ? 'dB SPL' : 'dB', axisLabel }, color, index: 0, channelIndex: 0, label };
}
const mixed = [
    levelSeries('A', '#0000ff', SPL, [80, 40, 60, 50], 40, 80),
    levelSeries('B', '#ffff00', VOLT, [-60, -20, -40, -50], -60, -20),
];

test('two level references: the second is read on its own axis at the right, following the first axis\' zoom', () => {
    const axes = overlayLevelAxes(mixed, fullView);
    assert.deepEqual(axes.map(axis => axis.title), [SPL, VOLT]);
    assert.deepEqual([axes[0].visible.dbMin, axes[0].visible.dbMax, axes[1].visible.dbMin, axes[1].visible.dbMax], [40, 80, -60, -20]);
    // The lower half of the left axis shows the lower half of the right one.
    const zoomed = overlayLevelAxes(mixed, { ...fullView, dbMin: 40, dbMax: 60 });
    assert.deepEqual([zoomed[1].visible.dbMin, zoomed[1].visible.dbMax], [-60, -40]);
    assert.equal(overlayLevelAxes([mixed[0], { ...mixed[0], label: 'C' }], fullView).length, 1);
    const third = levelSeries('C', '#ff00ff', 'Spectrum amplitude level [dB re 1 m/s^2]', [0, 1, 2, 3], 0, 3);
    const three = overlayLevelAxes([...mixed, third], fullView);
    assert.equal(three.length, 1, 'three references: one axis behind the warning');
    assert.deepEqual(three[0].series.map(s => s.label), ['A'], 'only the lines of that axis\' reference are drawn on it');
});

test('a slice cut from the spectrogram shares the axis of a backend slice with the same reference', () => {
    // While the backend answers, a lane's cursor spectrum is cut from its spectrogram, whose axis names another quantity.
    const cut = levelSeries('A2', '#00ffff', 'STFT amplitude level [dB SPL re 20 µPa]', [50, 60, 70, 40], 40, 70);
    const axes = overlayLevelAxes([mixed[0], cut, mixed[1]], fullView);
    assert.deepEqual(axes.map(axis => [axis.reference, axis.series.map(s => s.label)]), [['dB SPL re 20 µPa', ['A', 'A2']], ['dB re 1 V', ['B']]]);
    assert.equal(overlayLevelAxes([mixed[0], cut], fullView).length, 1);
});

test('a typed dB range is the left axis\' alone: the right one keeps its own range', () => {
    // A range typed for the Pa track (0–100 dB) replaces every slice's ends; the V slice keeps its own as auto ends.
    const typed = mixed.map(s => ({ ...s, slice: { ...s.slice, minDb: 0, maxDb: 100, autoMinDb: s.slice.minDb, autoMaxDb: s.slice.maxDb } }));
    const axes = overlayLevelAxes(typed, fullView);
    assert.deepEqual([axes[0].visible.dbMin, axes[0].visible.dbMax, axes[1].visible.dbMin, axes[1].visible.dbMax], [0, 100, -60, -20]);
});

test('paintOverlaySpectrum: a second reference widens the right margin, names its axis and its readout\'s reference', () => {
    const texts: string[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string) => { texts.push(text); } : Reflect.get(target, prop); } });
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, mixed, fullView);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 48);
    assert.ok(texts.includes(SPL) && texts.includes(VOLT), JSON.stringify(texts));
    // The right axis' values sit at the left axis' gridlines (40–80 dB SPL in tens), so a gridline reads on both sides.
    assert.ok(['50', '60', '70', '−50', '−40', '−30'].every(value => texts.includes(value)), JSON.stringify(texts));
    assert.deepEqual(paint.levelAxes.map(({ visible: _visible, ...axis }) => axis), [
        { title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#0000ff'], lines: [{ color: '#0000ff', label: 'A' }] },
        { title: VOLT, reference: 'dB re 1 V', colors: ['#ffff00'], lines: [{ color: '#ffff00', label: 'B' }], follow: { left: { min: 40, max: 80 }, right: { min: -60, max: -20 } } },
    ]);
    // Each axis' levels on screen, the right one's its own (its range popover opens on them, R13).
    assert.deepEqual(paint.levelAxes.map(axis => axis.visible && [axis.visible.dbMin, axis.visible.dbMax]), [[40, 80], [-60, -20]]);
    // B's peak (-20 dB re 1 V, bin 1) is at the top of the right axis: read there on that axis' lines.
    const right = paint.plot?.secondary;
    assert.ok(right);
    const read = stageHover(right, right.xAt(1000 / 3), right.yAt(-20));
    assert.equal(read?.layer.color, '#ffff00');
    // "dB" alone could be either axis: the value names its reference.
    assert.ok(read?.text.startsWith('B') && read.text.endsWith(' dB re 1 V'), read?.text);
    paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, fullView);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 8, 'one reference gives the margin back');
});

test('paintOverlaySpectrum: with one level axis a point read still names its reference, never bare dB (R7)', () => {
    const { ctx } = recordingCtx();
    for (const [series, unit] of [[mixed[1], ' dB re 1 V'], [mixed[0], ' dB SPL re 20 µPa']] as const) {
        const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, [series], fullView);
        const plot = paint.plot;
        assert.ok(plot);
        const peak = Math.max(...drawableBuckets(series.slice.values));
        const read = stageHover(plot, plot.xAt(1000 / 3), plot.yAt(peak));
        assert.ok(read?.text.endsWith(unit), read?.text);
    }
});

test('paintOverlaySpectrum: a line read on the right-hand axis is dashed, so lines of one colour are told apart', () => {
    const grey = mixed.map(s => ({ ...s, color: '#8b949e' }));
    const strokes: Array<{ dash: number[] }> = [];
    let dash: number[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) {
        if (prop === 'setLineDash') return (pattern: number[]) => { dash = pattern; };
        if (prop === 'save') return () => undefined;
        if (prop === 'restore') return () => { dash = []; };
        if (prop === 'stroke') return () => { strokes.push({ dash }); };
        return Reflect.get(target, prop);
    } });
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, grey, fullView);
    assert.deepEqual(paint.levelAxes.map(axis => axis.colors), [['#8b949e'], ['#8b949e']]);
    assert.ok(strokes.some(s => s.dash.length === 0), 'the left axis\' line is solid');
    assert.ok(strokes.some(s => s.dash.join() === SECONDARY_AXIS_DASH.join()), 'the right axis\' line is dashed');
});

test('renderSpectrumAxisLegend names every line by its colour, grouped by the side it is read on with two axes', () => {
    const children: Array<{ attrs: Record<string, string>; parts: string[] }> = [];
    const makeEl = (): Record<string, unknown> => {
        const el: Record<string, unknown> = { textContent: '', style: {}, className: '', title: '', attrs: {}, kids: [] as unknown[] };
        el.setAttribute = (k: string, v: string) => { (el.attrs as Record<string, string>)[k] = v; };
        el.appendChild = (child: unknown) => { (el.kids as unknown[]).push(child); };
        return el;
    };
    const hostAttrs: Record<string, string> = {};
    const host = { hidden: true, ownerDocument: { createElement: makeEl }, getAttribute: (k: string) => hostAttrs[k] ?? null, setAttribute: (k: string, v: string) => { hostAttrs[k] = v; }, replaceChildren() { children.length = 0; }, appendChild(item: Record<string, unknown>) {
        const attrs = item.attrs as Record<string, string>;
        assert.ok(attrs['data-hint'], 'each side names its lines in the footer');
        children.push({ attrs: { 'data-axis': attrs['data-axis'] }, parts: (item.kids as Array<{ textContent: string; style: { background?: string }; kids: Array<{ textContent: string }> }>).map(k => k.textContent || k.kids.map(part => part.textContent).join('|') || (k.style.background ?? '')) });
    } };
    const two = [
        { title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#0000ff', '#00ffff'], lines: [{ color: '#0000ff', label: 'A' }, { color: '#00ffff', label: 'A2' }] },
        { title: VOLT, reference: 'dB re 1 V', colors: ['#ffff00'], lines: [{ color: '#ffff00', label: 'B' }] },
    ];
    renderSpectrumAxisLegend(host as unknown as HTMLElement, two);
    assert.equal(host.hidden, false);
    assert.deepEqual(children, [
        { attrs: { 'data-axis': 'left' }, parts: ['◀', SPL, '#0000ff', 'A', '#00ffff', 'A2'] },
        { attrs: { 'data-axis': 'right' }, parts: [VOLT, 'repeating-linear-gradient(90deg, #ffff00 0 5px, transparent 5px 8px)', 'B', SECONDARY_AXIS_MARK] },
    ]);
    // Repainting with the same lines leaves the legend as it is (a rebuild would clear the marker).
    children.push({ attrs: { 'data-axis': 'marker' }, parts: [] });
    renderSpectrumAxisLegend(host as unknown as HTMLElement, two);
    assert.equal(children.length, 3);
    // Calibrated with the same reference (FS, ref 1: still dBFS), only the level's name changes: the legend follows it.
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ ...two[0], title: 'Level [dB SPL re 20 µPa]' }, two[1]]);
    assert.equal(children.length, 2);
    assert.equal(children[0].parts[1], 'Level [dB SPL re 20 µPa]');
    // One axis: the level's name and the lines'. Grey lines without a role are told apart by their names.
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#8b949e'], lines: [{ color: '#8b949e', label: 'A' }, { color: '#8b949e', label: 'C' }] }]);
    assert.equal(host.hidden, false);
    assert.deepEqual(children, [{ attrs: { 'data-axis': 'left' }, parts: [SPL, '#8b949e', 'A', '#8b949e', 'C'] }]);
    // A file's name and its channel are apart, so a long name is cut and the channel stays.
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#8b949e'], lines: [{ color: '#8b949e', label: 'take00.wav / Channel 1 / 2 (L)' }] }]);
    assert.deepEqual(children, [{ attrs: { 'data-axis': 'left' }, parts: [SPL, '#8b949e', 'take00.wav| / Channel 1 / 2 (L)'] }]);
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: '', reference: '', colors: [], lines: [] }]);
    assert.equal(host.hidden, true);
    assert.equal(children.length, 0);
});

test('paintOverlaySpectrum names a level axis as the caller says, from its reference and the lines read on it', () => {
    const texts: string[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string) => { texts.push(text); } : Reflect.get(target, prop); } });
    const named: Array<[string, string[]]> = [];
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, mixed, fullView, '', (reference, series) => {
        named.push([reference, series.map(s => s.label)]);
        return T(`Level, uncalibrated [${reference}]`);
    });
    assert.deepEqual(named, [['dB SPL re 20 µPa', ['A']], ['dB re 1 V', ['B']]]);
    assert.deepEqual(paint.levelAxes.map(axis => axis.title), ['Level, uncalibrated [dB SPL re 20 µPa]', 'Level, uncalibrated [dB re 1 V]']);
    assert.ok(texts.some(text => text.startsWith('Level, uncalibrated')), JSON.stringify(texts));
});

test('reordering a Pa track and a V track clears a dB zoom kept in the old left axis\' dB', () => {
    // As the overlay does before each paint: the left axis' reference first, then the axes from the view.
    const view = new SpectrumView();
    const leftAxes = (series: SpectrumSeries[]) => {
        view.followLevelReference(overlayLevelAxes(series, view.state())[0].key);
        return overlayLevelAxes(series, view.state());
    };
    leftAxes(mixed);
    view.setDbRange(60, 70);
    assert.deepEqual([leftAxes(mixed)[0].visible.dbMin, leftAxes(mixed)[0].visible.dbMax], [60, 70]);
    // The V track moved ahead: its own range on the left, not 60–70 dB re 1 V where none of its lines are.
    const reordered = leftAxes([mixed[1], mixed[0]]);
    assert.deepEqual(reordered.map(axis => [axis.reference, axis.visible.dbMin, axis.visible.dbMax]), [['dB re 1 V', -60, -20], ['dB SPL re 20 µPa', 40, 80]]);
});

test('paintOverlaySpectrum names the frequency axis at the right end of its ticks, as the comparison does', () => {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string, x: number, y: number) => { texts.push({ text, x, y }); } : Reflect.get(target, prop); } });
    paintOverlaySpectrum(canvasOf(recording), 400, 200, series, fullView, P('Frequency [Hz]'));
    const title = texts.find(t => t.text === 'Frequency [Hz]');
    assert.equal(title?.y, 197, 'in the bottom row');
    const ticks = texts.filter(t => t.y === 197 && t !== title);
    assert.ok(ticks.length > 1 && ticks.every(t => t.x + 10 < (title?.x ?? 0)), 'its ticks stop short of it');
});

test('a line past the dB axis leaves the plot where it crosses the axis (clipped), not along its edge', () => {
    const ys: number[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'lineTo' ? (_x: number, y: number) => { ys.push(y); } : Reflect.get(target, prop); } });
    // -60 and -50 dB are below a -45…-15 dB axis: the plot's bottom edge is at 200 - 16 = 184.
    paintOverlaySpectrum(canvasOf(recording), 400, 200, series, { ...fullView, dbMin: -45, dbMax: -15 });
    assert.ok(ys.some(y => y > 184 + 1), JSON.stringify(ys));
});

test('zoomed between two log ticks, the frequency axis still labels where it is', () => {
    const centers = Array.from({ length: 31 }, (_, band) => 20 * 2 ** (band / 3));
    const bands: SpectrumSeries[] = [{ ...series[0], slice: { values: centers.map(() => -30), bins: centers.map(() => -30), frequencyBins: 31, maxFrequencyHz: 20000 * 2 ** (1 / 6), minDb: -60, maxDb: 0, unit: 'dB', bandsPerOctave: 3, bandCentersHz: centers, minFrequencyHz: 20 / 2 ** (1 / 6) } }];
    const axis = { frequencyMin: 20 / 2 ** (1 / 6), frequencyMax: 20000 * 2 ** (1 / 6), logFrequency: true };
    const view = { ...fullView, freqStart: frequencyFraction(1100, axis), freqEnd: frequencyFraction(1900, axis) };
    const texts: Array<{ text: string; y: number }> = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string, _x: number, y: number) => { texts.push({ text, y }); } : Reflect.get(target, prop); } });
    paintOverlaySpectrum(canvasOf(recording), 600, 200, bands, view, P('Frequency [Hz]'));
    const labels = texts.filter(t => t.y === 197 && t.text !== 'Frequency [Hz]').map(t => t.text);
    assert.ok(labels.length >= 2 && labels.every(text => /^\d+(\.\d+)?k?$/.test(text)), JSON.stringify(labels));
});

test('a full-resolution slice is thinned only to be drawn: every bin in a narrow zoomed range is kept, a bucket per two pixels across a wide one (R2, R3)', () => {
    const bins = 8193;
    const every = Array.from({ length: bins }, (_, bin) => Math.sin(bin * 1.3) * 20 - 40);
    const slice = { values: every, bins: every, frequencyBins: bins, maxFrequencyHz: 8192, minDb: -60, maxDb: -20 } as unknown as SpectrumSeries['slice'];
    const series = { slice, color: '#fff', label: 'a' } as unknown as SpectrumSeries;
    const zoomed = spectrumLayer(series, 8192, { frequencyMin: 1000, frequencyMax: 1100, buckets: 300 });
    const inside = (zoomed.view.xs ?? []).filter(x => x >= 1000 && x <= 1100);
    assert.equal(inside.length, 101, 'every 1 Hz bin from 1000 to 1100 Hz');
    const whole = spectrumLayer(series, 8192, { frequencyMin: 0, frequencyMax: 8192, buckets: 300 });
    const wholeXs = whole.view.xs ?? [];
    assert.ok(wholeXs.length <= 2 * 300 + 1, `${wholeXs.length} points`);
    assert.equal(wholeXs[0], 0, 'DC kept');
    // A slice the backend already thinned (it names its frequencies) is drawn as it came.
    const thinned = spectrumLayer({ ...series, slice: { ...slice, bins: undefined, frequenciesHz: every.map((_, bin) => bin) } }, 8192, { frequencyMin: 0, frequencyMax: 8192, buckets: 300 });
    assert.equal(thinned.view.xs?.length, bins);
});

test('a narrow high peak on the linear frequency axis is drawn at its own pixel: the slice is thinned in equally wide buckets, its axis\'s scale (R2)', () => {
    // 8193 bins of 1 Hz on the cursor spectrum's linear axis, 300 buckets across: two narrow peaks 60 Hz apart near the
    // top, about four pixels apart. In log buckets (one about 200 Hz wide there) only the higher one was kept.
    const bins = 8193;
    const every = Array.from({ length: bins }, () => -60);
    every[7100] = -10;
    every[7160] = -20;
    const slice = { values: every, bins: every, frequencyBins: bins, maxFrequencyHz: 8192, minDb: -60, maxDb: -10 } as unknown as SpectrumSeries['slice'];
    const layer = spectrumLayer({ slice, color: '#fff', label: 'a' } as unknown as SpectrumSeries, 8192, { frequencyMin: 0, frequencyMax: 8192, buckets: 300 });
    const xs = layer.view.xs ?? [], values = drawableLine(layer.view.values ?? []);
    assert.ok(xs.length <= 2 * 300 + 2, `thinned to draw: ${xs.length} points`);
    for (const [hz, level] of [[7100, -10], [7160, -20]]) {
        assert.equal(values[xs.indexOf(hz)], level, `R2 (docs/display-rules.md) broke: the peak at ${hz} Hz is not drawn at its own frequency with its level. A line is thinned in buckets of its axis's own scale: spectrumLayer passes the axis's scale (linear unless the window says log) to comparePanes.minMaxLine.`);
    }
});

test('the cursor spectrum orders a slice cut for display by every bin on screen, not by the points kept to draw it (R6, R2)', async () => {
    // Two channels' slices of 4097 bins over 0–24 kHz, each cut for display as the backend cuts it (min_max_spectrum:
    // a point per group of bins, the peak kept). Over every bin the spiky one is the quieter (−46 dB against −45 dB);
    // over its kept points its −10 dB spike makes it look the louder.
    const bins = 4097, maxHz = 24000;
    const binHz = (bin: number): number => bin * maxHz / (bins - 1);
    const spiky = Array.from({ length: bins }, (_, bin) => (bin === 1000 ? -10 : -60)), steady = Array.from({ length: bins }, () => -45);
    const kept = Array.from({ length: bins }, (_, bin) => bin).filter(bin => bin % 32 === 0 || bin === 1000);
    const cut = (values: number[], channelIndex: number, color: string): SpectrumSeries => ({
        slice: { values: kept.map(bin => values[bin]), frequencyBins: kept.length, frequenciesHz: kept.map(binHz), maxFrequencyHz: maxHz, minDb: -60, maxDb: -10, unit: 'dB', cursorNorm: 0.5, channelIndex },
        color, index: 0, channelIndex, label: color,
    });
    // Every bin is read through the track view's reads: the same slice asked for again at full resolution.
    const posted: Array<{ requestId: string }> = [];
    const reads = createLaneReads(message => { posted.push(message); });
    const track = { trackIndex: 0, filePath: 'a.wav', sourceVersion: undefined, calibrationSignature: undefined, stftSignature: '1024/256/hann', analysisId: 'a', settingsSignature: 's' };
    const lines = [cut(spiky, 0, 'spiky'), cut(steady, 1, 'steady')].map(series => ({ ...series, full: reads.slice(track, 0.5, series.channelIndex) }));
    // The order expected, worked out here from every bin on screen (the linear axis from 0 Hz to the top).
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length;
    const expected = [{ color: 'spiky', values: spiky }, { color: 'steady', values: steady }].sort((a, b) => mean(b.values) - mean(a.values)).map(item => item.color);
    assert.deepEqual(expected, ['steady', 'spiky']);
    const strokes: string[] = [];
    let strokeStyle = '';
    const ctx = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'stroke' ? () => { strokes.push(strokeStyle); } : () => undefined),
        set: (_target, key, value) => { if (key === 'strokeStyle') strokeStyle = String(value); return true; },
    }) as unknown as CanvasDrawCtx;
    const canvas = Object.assign(canvasOf(ctx), { dataset: {} });
    paintOverlaySpectrum(canvas, 400, 200, lines, fullView);
    assert.match(canvas.dataset.plotOrder ?? '', /…/u, 'not judged until every bin is in');
    assert.equal(posted.length, 1, 'the slice at every bin asked for once, for both channels');
    reads.handle({ type: 'spectrum-slice-result', requestId: posted[0].requestId, maxFrequencyHz: maxHz, channels: [{ channelIndex: 0, values: spiky, bins: spiky }, { channelIndex: 1, values: steady, bins: steady }] } as { type: string; requestId: string });
    strokes.length = 0;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(strokes.filter(color => color === 'spiky' || color === 'steady'), expected, 'drawn again with every bin: the quieter on top');
    assert.equal(canvas.dataset.plotOrder, `${(10 * Math.log10(mean(steady))).toFixed(2)},${(10 * Math.log10(mean(spiky))).toFixed(2)}`);
    // Not the order of the points kept to draw it, where the spike makes the spiky one the louder (drawn under).
    const keptLevels = [spiky, steady].map(values => 10 * Math.log10(mean(kept.map(bin => values[bin])))).sort((a, b) => b - a);
    assertNotDrawn(canvas.dataset.plotOrder, keptLevels.map(level => level.toFixed(2)).join(','));
});

test('until the backend\'s slice comes, the cursor spectrum draws the lane\'s averaged spectrogram column and reads nothing of it; past the end, nothing (R7)', () => {
    // The lane's display spectrogram: each cell a power average of many STFT cells, drawn only.
    const spectrogram = {
        values: [[-70, -42.5, -61, -66], [-71, -43, -60, -65]], timeBins: 2, frequencyBins: 4, windowSize: 512, hopSize: 256,
        maxFrequencyHz: 1000, minDb: -100, maxDb: -3, unit: 'dB',
    };
    const source = { durationSeconds: 1, channels: [{ spectrogram }] };
    const asked: number[] = [];
    const context = { trackIndex: 0, cached: null, settingsSignature: 's', cursorTolerance: 0.002, requestSlice: (_track: number, norm: number) => { asked.push(norm); }, applyDisplaySettings: (slice: SpectrumSlice) => slice };
    const pending = extractSpectrumAtCursor(source, 0, 0.25, { startSec: 0, spanSec: 1 }, context);
    assert.ok(pending);
    assert.deepEqual(asked, [0.25], 'the slice is asked for');
    assert.equal(pending.standIn, 'pending');
    const { ctx } = recordingCtx();
    const plot = plotOf(paintOverlaySpectrum(canvasOf(ctx), 400, 200, [{ ...series[0], slice: pending }], fullView));
    assert.deepEqual(plot.lines[0].view.values, spectrogram.values[0], 'the averaged column is drawn');
    assert.equal(plot.lines[0].view.levelBins, undefined, 'the averaged column is never the level the overlay is ordered by');
    // On the column's top: the cursor's marks, no number, until the slice is in.
    const read = stageHover(plot, plot.xAt(1000 / 3), plot.yAt(-42.5));
    assert.equal(read?.pending, true);
    assert.equal(read?.text, '');
    assert.equal(read?.value, undefined);
    assertNotDrawn(read?.value, spectrogram.values[0][1], 'not the averaged cell drawn under the pointer');

    // Past the track's end: the floor is drawn, and a line beside it with a slice of its own is the one read.
    const silence = extractSpectrumAtCursor(source, 0, 1.5, { startSec: 0, spanSec: 1 }, context);
    assert.ok(silence);
    assert.equal(silence.standIn, 'silence');
    const real = { values: [-80, -30, -50, -55], bins: [-80, -30, -50, -55], frequencyBins: 4, maxFrequencyHz: 1000, minDb: -80, maxDb: -30, unit: 'dB' };
    const both = plotOf(paintOverlaySpectrum(canvasOf(ctx), 400, 200, [{ ...series[0], slice: silence }, { ...series[0], color: '#0000ff', label: 'B', slice: real }], fullView));
    const floor = both.lines.find(line => line.color === '#ff0000');
    assert.ok(floor, 'the floor is drawn');
    // Silence has no power: the quietest, measured (not ordered by its drawn floor, nor left unmeasured).
    assert.deepEqual(screenLevels([floor], floor.view).get(floor), { level: -Infinity, state: 'exact' });
    const onFloor = stageHover(both, both.xAt(2000 / 3), both.yAt(drawableBuckets(silence.values)[2]));
    assert.notEqual(onFloor?.layer.color, '#ff0000', 'the floor past the end is never read as a level');
    assert.ok(!onFloor || onFloor.text === spectrumReadoutText('B', real, 2000 / 3, -50));
    const stepped = stageStep(both, { ...(stageHover(both, both.xAt(1000 / 3), both.yAt(-30)) as NonNullable<ReturnType<typeof stageHover>>) }, 1);
    assert.equal(stepped?.layer.color, '#0000ff');

    // Octave bands past the end: the floor is a line read as none, not bars read as they are drawn.
    const bandsCached = { values: [-40, -35, -30], frequencyBins: 3, maxFrequencyHz: 1000, minDb: -90, maxDb: -30, unit: 'dB', bandCentersHz: [250, 500, 1000], settingsSignature: 's' };
    const bandSilence = extractSpectrumAtCursor(source, 0, 1.5, { startSec: 0, spanSec: 1 }, { ...context, bands: true, cached: bandsCached });
    assert.ok(bandSilence);
    const bandsPlot = plotOf(paintOverlaySpectrum(canvasOf(ctx), 400, 200, [{ ...series[0], slice: bandSilence }], fullView));
    assert.equal(stageHover(bandsPlot, bandsPlot.xAt(500), bandsPlot.yAt(-90))?.text ?? '', '');
});

test('on one level axis mixing calibration statuses, each uncalibrated line says so in its legend and readout; on its own the axis says it (A49, R1, R4)', () => {
    const FS = 'Spectrum amplitude level [dBFS]';
    const corrected = levelSeries('a.wav', '#0000ff', FS, [-20, -30, -40, -50], -50, -20);
    const raw = levelSeries('b.wav', '#ffff00', FS, [-25, -35, -45, -55], -55, -25);
    const calibrated = (s: SpectrumSeries): boolean => s === corrected;
    const said = withCalibrationWords([corrected, raw], calibrated, ' 未校正');
    assert.deepEqual(said.map(s => s.label), ['a.wav', 'b.wav 未校正']);
    // The legend and the readout both name a line by its label.
    const layer = spectrumLayer(said[1], 1000);
    assert.equal(layer.label, 'b.wav 未校正');
    // All uncalibrated: the axis says it, and no line repeats it.
    assert.deepEqual(withCalibrationWords([raw, { ...raw, label: 'c.wav' }], () => false, ' 未校正').map(s => s.label), ['b.wav', 'c.wav']);
    // Another reference is another axis: its lines are not mixed with these.
    assert.deepEqual(withCalibrationWords([raw, levelSeries('d.wav', '#0f0', SPL, [80, 70, 60, 50], 50, 80)], s => s.label === 'd.wav', ' 未校正').map(s => s.label), ['b.wav', 'd.wav']);
});
