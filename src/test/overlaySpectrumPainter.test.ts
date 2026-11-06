import assert from 'node:assert/strict';
import test from 'node:test';
import { frequencyFraction, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { paintOverlaySpectrum, renderSpectrumAxisLegend, SECONDARY_AXIS_DASH, SECONDARY_AXIS_MARK, type OverlaySpectrumHover } from '../webview/runtime/overlaySpectrumPainter';
import { SpectrumView } from '../webview/runtime/spectrumView';
import { OVERLAY_SPECTRUM_PAD, overlayLevelAxes, spectrumReadoutText, spectrumVisibleWindow, steppedOverlaySpectrumHoverNorm, type SpectrumViewState } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSeries } from '../webview/runtime/types';

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

/** A canvas drawn on through `ctx`, at ratio 1 with no style (as paintOverlay is given a fixed size). */
function canvasOf(ctx: CanvasDrawCtx): HTMLCanvasElement {
    return { width: 0, height: 0, clientWidth: 0, clientHeight: 0, ownerDocument: { defaultView: null }, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

const series: SpectrumSeries[] = [{
    slice: { values: [-60, -20, -40, -50], frequencyBins: 4, maxFrequencyHz: 1000, minDb: -60, maxDb: -20, unit: 'dB' },
    color: '#ff0000',
    index: 0,
    channelIndex: 0,
    label: 'A',
}];
const fullView: SpectrumViewState = { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null };
const noHover: OverlaySpectrumHover = { norm: null, yFrac: null, target: null };

test('paintOverlaySpectrum reports the visible window and clears the readout without a hover', () => {
    const { ctx, calls } = recordingCtx();
    const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, fullView, noHover, null);
    assert.ok(calls.indexOf('clearRect') >= 0 && calls.indexOf('clearRect') < calls.indexOf('stroke'), 'cleared before anything is drawn');
    assert.equal(paint.painted, true);
    assert.equal(paint.maxFrequencyHz, 1000);
    assert.ok(paint.dbMin <= -60 && paint.dbMax >= -20);
    assert.deepEqual(paint.readout, { text: '', color: '' });
});

test('paintOverlaySpectrum fills the readout from the nearest series under an overlay hover', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, fullView, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null);
    assert.equal(paint.readout?.color, '#ff0000');
    assert.match(paint.readout?.text ?? '', /^A/);
});

test('paintOverlaySpectrum draws no line and reads nothing when the frequency window is empty', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, { ...fullView, freqStart: 0.5, freqEnd: 0.5 }, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null);
    assert.equal(paint.painted, false);
    assert.equal(paint.readout, null);
});

for (const [bins, tone] of [[1025, 40], [8193, 320]]) {
    test(`each arrow press moves the overlay readout one bin, also over bins denser than pixels (${bins} bins)`, () => {
        const values = Array.from({ length: bins }, (_, bin) => -Math.abs(bin - tone) / 10);
        const dense: SpectrumSeries[] = [{ ...series[0], slice: { values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' } }];
        const binHz = (bin: number) => bin * 24000 / (bins - 1);
        const readoutAt = (bin: number) => spectrumReadoutText('A', dense[0].slice, binHz(bin), values[bin]);
        const vis = spectrumVisibleWindow(24000, -100, 0, fullView);
        const { ctx } = recordingCtx();
        // The pointer one pixel beside the tone (300 px plot) reads the tone.
        const pointer = { norm: binHz(tone) / 24000 + 1 / 300, yFrac: 0.1, target: 'overlay' as const };
        assert.equal(paintOverlaySpectrum(canvasOf(ctx), 356, 200, dense, fullView, pointer, null).readout?.text, readoutAt(tone));
        let norm = binHz(tone) / 24000;
        for (let press = 1; press <= 8; press++) {
            norm = steppedOverlaySpectrumHoverNorm(dense, norm, 0.1, { width: 356, height: 200 }, vis, 1) ?? NaN;
            const hover = { norm, yFrac: 0.1, target: 'overlay' as const, stepped: true };
            assert.equal(paintOverlaySpectrum(canvasOf(ctx), 356, 200, dense, fullView, hover, null).readout?.text, readoutAt(tone + press), `press ${press}`);
        }
    });
}

for (const [bins, tone] of [[1025, 40], [8193, 320]]) {
    for (const delta of [1, -1]) {
        test(`after the pointer, the first arrow press moves the overlay readout one bin from the bin shown (${bins} bins, ${delta > 0 ? '→' : '←'})`, () => {
            const values = Array.from({ length: bins }, (_, bin) => -Math.abs(bin - tone) / 10);
            const dense: SpectrumSeries[] = [{ ...series[0], slice: { values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' } }];
            const binHz = (bin: number) => bin * 24000 / (bins - 1);
            const readoutAt = (bin: number) => spectrumReadoutText('A', dense[0].slice, binHz(bin), values[bin]);
            const vis = spectrumVisibleWindow(24000, -100, 0, fullView);
            const { ctx } = recordingCtx();
            const pointer = { norm: binHz(tone) / 24000 + 1 / 300, yFrac: 0.1, target: 'overlay' as const };
            assert.equal(paintOverlaySpectrum(canvasOf(ctx), 356, 200, dense, fullView, pointer, null).readout?.text, readoutAt(tone));
            const norm = steppedOverlaySpectrumHoverNorm(dense, pointer.norm, 0.1, { width: 356, height: 200 }, vis, delta, true) ?? NaN;
            const hover = { norm, yFrac: 0.1, target: 'overlay' as const, stepped: true };
            assert.equal(paintOverlaySpectrum(canvasOf(ctx), 356, 200, dense, fullView, hover, null).readout?.text, readoutAt(tone + delta));
        });
    }
}

const SPL = 'Spectrum amplitude level [dB SPL re 20 µPa]';
const VOLT = 'Spectrum amplitude level [dB re 1 V]';
function levelSeries(label: string, color: string, axisLabel: string, values: number[], minDb: number, maxDb: number): SpectrumSeries {
    return { slice: { values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb, maxDb, unit: axisLabel === SPL ? 'dB SPL' : 'dB', axisLabel }, color, index: 0, channelIndex: 0, label };
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
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, mixed, fullView, noHover, null);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 48);
    assert.ok(texts.includes(SPL) && texts.includes(VOLT), JSON.stringify(texts));
    // The right axis' values sit at the left axis' gridlines (40–80 dB SPL in tens), so a gridline reads on both sides.
    assert.ok(['50', '60', '70', '−50', '−40', '−30'].every(value => texts.includes(value)), JSON.stringify(texts));
    assert.deepEqual(paint.levelAxes, [
        { title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#0000ff'], lines: [{ color: '#0000ff', label: 'A' }] },
        { title: VOLT, reference: 'dB re 1 V', colors: ['#ffff00'], lines: [{ color: '#ffff00', label: 'B' }] },
    ]);
    // B's peak (-20 dB re 1 V, bin 1) is at the top of the right axis, where the pointer is.
    const hover = { norm: 1 / 3, yFrac: 8 / 200, target: 'overlay' as const };
    const readout = paintOverlaySpectrum(canvasOf(ctx), 400, 200, mixed, fullView, hover, null).readout;
    assert.equal(readout?.color, '#ffff00');
    // "dB" alone could be either axis: the value names its reference.
    assert.ok(readout?.text.startsWith('B') && readout.text.endsWith(' dB re 1 V'), readout?.text);
    paintOverlaySpectrum(canvasOf(ctx), 400, 200, series, fullView, noHover, null);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 8, 'one reference gives the margin back');
});

test('paintOverlaySpectrum: a line read on the right-hand axis is dashed, so lines of one colour (grey, without a role) are told apart', () => {
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
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, grey, fullView, noHover, null);
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
        children.push({ attrs: { 'data-axis': attrs['data-axis'] }, parts: (item.kids as Array<{ textContent: string; style: { background?: string } }>).map(k => k.textContent || (k.style.background ?? '')) });
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
    // One axis: the level's name and the lines'. Grey lines without a role are told apart by their names.
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: SPL, reference: 'dB SPL re 20 µPa', colors: ['#8b949e'], lines: [{ color: '#8b949e', label: 'A' }, { color: '#8b949e', label: 'C' }] }]);
    assert.equal(host.hidden, false);
    assert.deepEqual(children, [{ attrs: { 'data-axis': 'left' }, parts: [SPL, '#8b949e', 'A', '#8b949e', 'C'] }]);
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: '', reference: '', colors: [], lines: [] }]);
    assert.equal(host.hidden, true);
    assert.equal(children.length, 0);
});

test('paintOverlaySpectrum names a level axis as the caller says, from its reference and the lines read on it', () => {
    const texts: string[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string) => { texts.push(text); } : Reflect.get(target, prop); } });
    const named: Array<[string, string[]]> = [];
    const paint = paintOverlaySpectrum(canvasOf(recording), 400, 200, mixed, fullView, noHover, null, '', (reference, series) => {
        named.push([reference, series.map(s => s.label)]);
        return `Amplitude, uncalibrated [${reference}]`;
    });
    assert.deepEqual(named, [['dB SPL re 20 µPa', ['A']], ['dB re 1 V', ['B']]]);
    assert.deepEqual(paint.levelAxes.map(axis => axis.title), ['Amplitude, uncalibrated [dB SPL re 20 µPa]', 'Amplitude, uncalibrated [dB re 1 V]']);
    assert.ok(texts.some(text => text.startsWith('Amplitude, uncalibrated')), JSON.stringify(texts));
});

test('paintOverlaySpectrum: with two level axes the level guide runs only to the axis the line is read on', () => {
    const lines: Array<[number, number, number, number]> = [];
    let from: [number, number] = [0, 0];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) {
        if (prop === 'moveTo') return (x: number, y: number) => { from = [x, y]; };
        if (prop === 'lineTo') return (x: number, y: number) => { lines.push([from[0], from[1], x, y]); };
        return Reflect.get(target, prop);
    } });
    paintOverlaySpectrum(canvasOf(recording), 400, 200, mixed, fullView, { norm: 1 / 3, yFrac: 8 / 200, target: 'overlay' }, null);
    // The plot runs from x 52 to 352 (400 - 48); B is read on the right axis, so its guide starts at the cursor.
    // (The level gridlines also end there, but start at the left axis.)
    const guide = lines.find(([x0, y0, x1, y1]) => y0 === y1 && y0 < 20 && x1 === 352 && x0 !== 52);
    assert.ok(guide, JSON.stringify(lines));
    assert.ok(guide[0] > 52 + 50, 'the guide does not reach the left axis');
});

test('reordering a Pa track and a V track clears a dB zoom kept in the old left axis\' dB', () => {
    // As the overlay does before each paint: the left axis' reference first, then the axes from the view.
    const view = new SpectrumView();
    const leftAxes = (series: SpectrumSeries[]) => {
        view.followLevelReference(overlayLevelAxes(series, view.state())[0].reference);
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
    paintOverlaySpectrum(canvasOf(recording), 400, 200, series, fullView, noHover, null, 'Frequency [Hz]');
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
    paintOverlaySpectrum(canvasOf(recording), 400, 200, series, { ...fullView, dbMin: -45, dbMax: -15 }, noHover, null);
    assert.ok(ys.some(y => y > 184 + 1), JSON.stringify(ys));
});

test('zoomed between two log ticks, the frequency axis still labels where it is', () => {
    const centers = Array.from({ length: 31 }, (_, band) => 20 * 2 ** (band / 3));
    const bands: SpectrumSeries[] = [{ ...series[0], slice: { values: centers.map(() => -30), frequencyBins: 31, maxFrequencyHz: 20000 * 2 ** (1 / 6), minDb: -60, maxDb: 0, unit: 'dB', bandsPerOctave: 3, bandCentersHz: centers, minFrequencyHz: 20 / 2 ** (1 / 6) } }];
    const axis = { frequencyMin: 20 / 2 ** (1 / 6), frequencyMax: 20000 * 2 ** (1 / 6), logFrequency: true };
    const view = { ...fullView, freqStart: frequencyFraction(1100, axis), freqEnd: frequencyFraction(1900, axis) };
    const texts: Array<{ text: string; y: number }> = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string, _x: number, y: number) => { texts.push({ text, y }); } : Reflect.get(target, prop); } });
    paintOverlaySpectrum(canvasOf(recording), 600, 200, bands, view, noHover, null, 'Frequency [Hz]');
    const labels = texts.filter(t => t.y === 197 && t.text !== 'Frequency [Hz]').map(t => t.text);
    assert.ok(labels.length >= 2 && labels.every(text => /^\d+(\.\d+)?k?$/.test(text)), JSON.stringify(labels));
});
