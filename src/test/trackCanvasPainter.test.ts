import assert from 'node:assert/strict';
import { drawableLine } from '../shared/drawnPoints';
import test from 'node:test';
import type { SpectrogramData, WaveformEnvelope } from '../shared/analysis/analysisTypes';
import { hexToRgba, laneSpectrogramView, laneWaveformOverlay, paintTrackSpectrogram } from '../webview/runtime/trackCanvasPainter';
import { stagePlotPoint } from '../webview/runtime/stagePanes';
import { normalizedColor, viridis } from '../shared/gui-core/index';
import { P, T } from './helpers/figure';

test('hexToRgba converts a #rrggbb color', () => {
    assert.equal(hexToRgba('#ff8000', 0.25), 'rgba(255,128,0,0.25)');
});

const place = { startSec: 10, spanSec: 4, offsetNorm: 0.25, trackDurRatio: 0.5 };

test('a lane with no waveform yet gives the plot component no pictures, on the lanes\' time axis in seconds', () => {
    const lane = laneWaveformOverlay(null, place, '#ff0000', 'FS');
    assert.deepEqual(lane.overlay.layers, []);
    assert.deepEqual(lane.axisView.xs, [10, 14]);
    // The file runs from 11 s to 13 s on that axis.
    assert.equal(lane.fileNormOf(11), 0);
    assert.equal(lane.fileNormOf(13), 1);
});

test('a lane\'s waveform is one signal layer, its bucket times placed in seconds where the track sits (R13)', () => {
    const envelope = { min: [-0.5, -0.2], max: [0.5, 0.2], minT: [0.1, 0.6], maxT: [0.2, 0.7], samples: [], absolutePeak: 0.5 } as WaveformEnvelope;
    const lane = laneWaveformOverlay({ waveform: envelope, dataStart: 0, dataEnd: 1, amplitudeScale: 0.8 }, place, '#00ff00', 'Pa');
    assert.equal(lane.overlay.layers.length, 1);
    const [layer] = lane.overlay.layers;
    assert.equal(layer.color, '#00ff00');
    assert.equal(layer.span, undefined);
    const signal = layer.view.waveform!;
    assert.deepEqual(drawableLine(signal.minT).map(t => +t!.toFixed(6)), [11.2, 12.2]);
    assert.deepEqual(drawableLine(signal.maxT).map(t => +t!.toFixed(6)), [11.4, 12.4]);
    assert.deepEqual([signal.min, signal.max, signal.unit, signal.absolutePeak], [[-0.5, -0.2], [0.5, 0.2], 'Pa', 0.8]);
    // Buckets without times sit across the part's stretch, as the lanes placed them.
    const untimed = laneWaveformOverlay({ waveform: { min: [0, 0], max: [1, 1], samples: [], absolutePeak: 1 }, dataStart: 0.5, dataEnd: 1, amplitudeScale: undefined }, place, '#00ff00', '');
    assert.deepEqual(untimed.overlay.layers[0].view.waveform!.minT, [12, 12.5]);
});

test('finer detail over part of the view is drawn over its own stretch, the overview only around it', () => {
    const envelope = { min: [0], max: [0], samples: [], absolutePeak: 1 } as unknown as WaveformEnvelope;
    const detail = { waveform: envelope, dataStart: 0.25, dataEnd: 0.5, amplitudeScale: undefined };
    const lane = laneWaveformOverlay({ waveform: envelope, dataStart: 0, dataEnd: 1, amplitudeScale: undefined, detail }, place, '#00ff00', '');
    const spans = lane.overlay.layers.map(layer => layer.span);
    // The detail covers 11.5 s to 12 s; the overview the rest of the axis on either side.
    assert.deepEqual(spans, [[6, 11.5], [12, 18], [11.5, 12]]);
});

const spec: SpectrogramData = {
    values: [[-80, -20], [-60, -40]],
    timeBins: 2, frequencyBins: 2, windowSize: 1024, hopSize: 256,
    maxFrequencyHz: 1000, minDb: -80, maxDb: -20, unit: 'dB',
};
const TITLES = { colour: T('Level [dBFS]'), frequency: P('Frequency [Hz]'), time: P('Time [s]') };
// One 2 s file filling the lanes' axis.
const wholePlace = { startSec: 0, spanSec: 2, offsetNorm: 0, trackDurRatio: 1 };
const laneView = { window: { start: 0, end: 1 }, dbLo: -80, dbHi: -20, maxFrequencyHz: 1000, minFrequencyHz: 0, durationSec: 2 };

/** A lane canvas (its bitmap at its CSS size) whose context records what is drawn, and keeps the image put on it. */
function laneCanvas(width: number, height: number) {
    const calls: string[] = [];
    const put: { image?: ImageData } = {};
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
        get(target, key) {
            const name = String(key);
            if (name in target) return target[name];
            if (name === 'measureText') return () => ({ width: 10 });
            if (name === 'createImageData') return (w: number, h: number) => { calls.push(`createImageData ${w}x${h}`); return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
            if (name === 'putImageData') return (image: ImageData) => { calls.push('putImageData'); put.image = image; };
            if (name === 'fillText') return (text: string) => { calls.push(`fillText ${text}`); };
            if (name === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
            return () => undefined;
        },
        set(target, key, value) { target[String(key)] = value; return true; },
    });
    const canvas = { width, height, clientWidth: width, clientHeight: height, dataset: {}, ownerDocument: {}, getContext: () => context } as unknown as HTMLCanvasElement;
    const pixel = (x: number, y: number): number[] => Array.from(put.image!.data.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    return { canvas, calls, pixel };
}

test('paintTrackSpectrogram repaints only when the spectrogram or its view changes', () => {
    const first = laneCanvas(120, 40);
    const entry = paintTrackSpectrogram(first.canvas, null, spec, wholePlace, laneView, undefined, TITLES, '');
    assert.ok(first.calls.includes('putImageData'));
    assert.equal(entry.source, spec);

    const same = laneCanvas(120, 40);
    assert.equal(paintTrackSpectrogram(same.canvas, null, spec, wholePlace, laneView, entry, TITLES, ''), entry);
    assert.deepEqual(same.calls, []);

    const zoomed = laneCanvas(120, 40);
    const next = paintTrackSpectrogram(zoomed.canvas, null, spec, wholePlace, { ...laneView, window: { start: 0, end: 0.5 } }, entry, TITLES, '');
    assert.notEqual(next, entry);
    assert.ok(zoomed.calls.includes('putImageData'));
});

test('a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)', () => {
    const { canvas, calls } = laneCanvas(400, 60);
    const entry = paintTrackSpectrogram(canvas, null, spec, wholePlace, laneView, undefined, TITLES, '');
    // The plot component's mark, and its picture across the canvas: the lanes share one time axis with nothing beside it.
    assert.equal((canvas.dataset as Record<string, string>).plot, '');
    assert.ok(calls.includes('createImageData 400x60'), calls.join(','));
    // paintColourBar: the name, the low end, the strip, the high end.
    assert.ok(calls.includes('fillText Level [dBFS]') && calls.includes('fillText −80') && calls.includes('fillText −20'), calls.join(','));
    const box = entry.colourBar;
    // Its colours are a range the user types (⚙ or a double-click on the bar), declared on the plot (R13).
    assert.equal((canvas.dataset as Record<string, string>).plotColourRange, 'typed');
    assert.ok(box.x > 0 && box.x + box.width <= 396 && box.y === 3 && box.height === 14, JSON.stringify(box));
    // The pointer finds it by the one hit test of every colour bar (stagePlotPoint, R13): a value axis there, none off it.
    const onScreen = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 60, right: 400, bottom: 60, x: 0, y: 0, toJSON: () => ({}) }) };
    assert.deepEqual([stagePlotPoint(onScreen, box.x + 1, box.y + 1, entry.plot).axis, stagePlotPoint(onScreen, box.x + 1, box.y + 1, entry.plot).colour], ['y', true]);
    assert.equal(stagePlotPoint(onScreen, 10, 50, entry.plot).colour, undefined);
    // Its frequency axis runs up to the band shown (in Hz, from its own rows), not the lanes' time axis.
    assert.deepEqual([entry.ticks[0]?.text, entry.ticks.at(-1)?.text], ['0', '1000']);
    // A new name is a new look: the lane is painted again.
    const renamed = laneCanvas(400, 60);
    assert.notEqual(paintTrackSpectrogram(renamed.canvas, null, spec, wholePlace, laneView, entry, { ...TITLES, colour: T('Level [dB SPL]') }, ''), entry);
});

test('each pixel of a spectrogram lane shows the loudest of the cells it covers, in the lanes\' viridis colours (R2)', () => {
    // Eight frames in 2 px: each pixel covers four. One loud frame in the second half must not be thinned away.
    const frames = Array.from({ length: 8 }, (_, k) => (k === 6 ? [-20, -20] : [-80, -80]));
    const narrow: SpectrogramData = { ...spec, values: frames, timeBins: 8 };
    const { canvas, pixel } = laneCanvas(2, 1);
    paintTrackSpectrogram(canvas, null, narrow, wholePlace, laneView, undefined, TITLES, '');
    assert.deepEqual(pixel(0, 0), normalizedColor(0, viridis));
    assert.deepEqual(pixel(1, 0), normalizedColor(1, viridis));
});

test('a spectrogram lane places its frames on the lanes\' time axis, in seconds, by their centres', () => {
    // The file starts 1 s into a 4 s axis and lasts 2 s; its two frames are centred at 0.5 s and 1.5 s of it.
    const view = laneSpectrogramView({ ...spec, timeCentersSec: [0.5, 1.5] }, { startSec: 0, spanSec: 4, offsetNorm: 0.25, trackDurRatio: 0.5 }, 2);
    assert.deepEqual(view.xs, [1.5, 2.5]);
    assert.deepEqual(view.ys, [0, 1000]);
    // Rows of frequency, each across the frames.
    assert.deepEqual(view.matrix, [[-80, -60], [-20, -40]]);
});

test('a spectrogram lane paints only where its recording is: its end cells stop at the file\'s start and end', () => {
    // A 2 s file whose frames are centred at 0, 0.5, … 2 s (STFT centre=True), placed 1–3 s on a 4 s axis, 400 px wide.
    const frames: SpectrogramData = { ...spec, values: Array.from({ length: 5 }, () => [-20, -20]), timeBins: 5, timeCentersSec: [0, 0.5, 1, 1.5, 2] };
    const { canvas, pixel } = laneCanvas(400, 1);
    paintTrackSpectrogram(canvas, null, frames, { startSec: 0, spanSec: 4, offsetNorm: 0.25, trackDurRatio: 0.5 }, { ...laneView, durationSec: 2 }, undefined, TITLES, '');
    const painted = Array.from({ length: 400 }, (_, x) => x).filter(x => pixel(x, 0).some(channel => channel > 0));
    assert.deepEqual([painted[0], painted.at(-1)], [100, 299]);
});

test('a lane\'s waveform points are placed once per envelope and place, and placed again when the track moves', () => {
    const envelope = { min: [-0.5, -0.2], max: [0.5, 0.2], minT: [0.1, 0.6], maxT: [0.2, 0.7], samples: [], absolutePeak: 0.5 } as WaveformEnvelope;
    const source = { waveform: envelope, dataStart: 0, dataEnd: 1, amplitudeScale: 0.8 };
    const first = laneWaveformOverlay(source, place, '#00ff00', 'Pa').overlay.layers[0].view.waveform!;
    // Painted again (a zoom, a pan, a hover): the same arrays, not new ones over every point.
    assert.equal(laneWaveformOverlay(source, place, '#00ff00', 'Pa').overlay.layers[0].view.waveform, first);
    const moved = laneWaveformOverlay(source, { ...place, offsetNorm: 0.5 }, '#00ff00', 'Pa').overlay.layers[0].view.waveform!;
    assert.notEqual(moved, first);
    assert.deepEqual(drawableLine(moved.minT).map(t => +t!.toFixed(6)), [12.2, 13.2]);
    assert.deepEqual(laneWaveformOverlay(source, place, '#00ff00', 'V').overlay.layers[0].view.waveform!.unit, 'V');
});
