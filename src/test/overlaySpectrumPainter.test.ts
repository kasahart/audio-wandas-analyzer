import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { paintOverlaySpectrum, renderSpectrumAxisLegend, SECONDARY_AXIS_MARK, type OverlaySpectrumHover } from '../webview/runtime/overlaySpectrumPainter';
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
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, fullView, noHover, null, DEFAULT_THEME);
    assert.equal(calls[0], 'clearRect');
    assert.equal(paint.painted, true);
    assert.equal(paint.maxFrequencyHz, 1000);
    assert.ok(paint.dbMin <= -60 && paint.dbMax >= -20);
    assert.deepEqual(paint.readout, { text: '', color: '' });
});

test('paintOverlaySpectrum fills the readout from the nearest series under an overlay hover', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, fullView, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null, DEFAULT_THEME);
    assert.equal(paint.readout?.color, '#ff0000');
    assert.match(paint.readout?.text ?? '', /^A/);
});

test('paintOverlaySpectrum stops after the axes when the frequency window is empty', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, { ...fullView, freqStart: 0.5, freqEnd: 0.5 }, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null, DEFAULT_THEME);
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
        assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, pointer, null, DEFAULT_THEME).readout?.text, readoutAt(tone));
        let norm = binHz(tone) / 24000;
        for (let press = 1; press <= 8; press++) {
            norm = steppedOverlaySpectrumHoverNorm(dense, norm, 0.1, { width: 356, height: 200 }, vis, 1) ?? NaN;
            const hover = { norm, yFrac: 0.1, target: 'overlay' as const, stepped: true };
            assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, hover, null, DEFAULT_THEME).readout?.text, readoutAt(tone + press), `press ${press}`);
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
            assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, pointer, null, DEFAULT_THEME).readout?.text, readoutAt(tone));
            const norm = steppedOverlaySpectrumHoverNorm(dense, pointer.norm, 0.1, { width: 356, height: 200 }, vis, delta, true) ?? NaN;
            const hover = { norm, yFrac: 0.1, target: 'overlay' as const, stepped: true };
            assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, hover, null, DEFAULT_THEME).readout?.text, readoutAt(tone + delta));
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
    assert.equal(overlayLevelAxes([...mixed, third], fullView).length, 1, 'three references stay on one axis behind the warning');
});

test('paintOverlaySpectrum: a second reference widens the right margin, names its axis and its readout\'s reference', () => {
    const texts: string[] = [];
    const { ctx } = recordingCtx();
    const recording = new Proxy(ctx, { get(target, prop) { return prop === 'fillText' ? (text: string) => { texts.push(text); } : Reflect.get(target, prop); } });
    const paint = paintOverlaySpectrum(recording, 400, 200, mixed, fullView, noHover, null, DEFAULT_THEME);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 48);
    assert.ok(texts.includes(SPL) && texts.includes(VOLT), JSON.stringify(texts));
    assert.deepEqual(paint.levelAxes, [{ title: SPL, colors: ['#0000ff'] }, { title: VOLT, colors: ['#ffff00'] }]);
    // B's peak (-20 dB re 1 V, bin 1) is at the top of the right axis, where the pointer is.
    const hover = { norm: 1 / 3, yFrac: 8 / 200, target: 'overlay' as const };
    const readout = paintOverlaySpectrum(ctx, 400, 200, mixed, fullView, hover, null, DEFAULT_THEME).readout;
    assert.equal(readout?.color, '#ffff00');
    // "dB" alone could be either axis: the value names its reference.
    assert.ok(readout?.text.startsWith('B') && readout.text.endsWith(' dB re 1 V'), readout?.text);
    paintOverlaySpectrum(ctx, 400, 200, series, fullView, noHover, null, DEFAULT_THEME);
    assert.equal(OVERLAY_SPECTRUM_PAD.right, 8, 'one reference gives the margin back');
});

test('renderSpectrumAxisLegend shows which lines are read on which side, only with two axes', () => {
    const children: Array<{ attrs: Record<string, string>; parts: string[] }> = [];
    const makeEl = (): Record<string, unknown> => {
        const el: Record<string, unknown> = { textContent: '', style: {}, className: '', title: '', attrs: {}, kids: [] as unknown[] };
        el.setAttribute = (k: string, v: string) => { (el.attrs as Record<string, string>)[k] = v; };
        el.appendChild = (child: unknown) => { (el.kids as unknown[]).push(child); };
        return el;
    };
    const host = { hidden: true, ownerDocument: { createElement: makeEl }, replaceChildren() { children.length = 0; }, appendChild(item: Record<string, unknown>) {
        children.push({ attrs: item.attrs as Record<string, string>, parts: (item.kids as Array<{ textContent: string; style: { background?: string } }>).map(k => k.textContent || (k.style.background ?? '')) });
    } };
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: SPL, colors: ['#0000ff', '#00ffff'] }, { title: VOLT, colors: ['#ffff00'] }]);
    assert.equal(host.hidden, false);
    assert.deepEqual(children, [
        { attrs: { 'data-axis': 'left' }, parts: ['◀', '#0000ff', '#00ffff', 'dB SPL re 20 µPa'] },
        { attrs: { 'data-axis': 'right' }, parts: ['#ffff00', 'dB re 1 V', SECONDARY_AXIS_MARK] },
    ]);
    renderSpectrumAxisLegend(host as unknown as HTMLElement, [{ title: SPL, colors: ['#0000ff'] }]);
    assert.equal(host.hidden, true);
    assert.equal(children.length, 0);
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
    paintOverlaySpectrum(recording, 400, 200, mixed, fullView, { norm: 1 / 3, yFrac: 8 / 200, target: 'overlay' }, null, DEFAULT_THEME);
    // The plot runs from x 48 to 352 (400 - 48); B is read on the right axis, so its guide starts at the cursor.
    const guide = lines.find(([, y0, x1, y1]) => y0 === y1 && y0 < 20 && x1 === 352);
    assert.ok(guide, JSON.stringify(lines));
    assert.ok(guide[0] > 48 + 50, 'the guide does not reach the left axis');
});
