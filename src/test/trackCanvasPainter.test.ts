import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpectrogramData, WaveformEnvelope } from '../shared/analysis/analysisTypes';
import { hexToRgba, laneWaveformOverlay, onColourBar, paintTrackSpectrogram } from '../webview/runtime/trackCanvasPainter';

function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[]; props: Record<string, unknown> } {
    const calls: string[] = [];
    const props: Record<string, unknown> = {};
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
        get(_t, prop) {
            const key = String(prop);
            if (key in target) {
                return target[key];
            }
            if (key === 'measureText') {
                return () => ({ width: 10 });
            }
            if (key === 'createImageData') {
                return (w: number, h: number) => { calls.push(`createImageData ${w}x${h}`); return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
            }
            if (key === 'createLinearGradient') {
                return () => ({ addColorStop() { /* recorded by nothing */ } });
            }
            if (key === 'fillText') {
                return (text: string) => { calls.push(`fillText ${text}`); };
            }
            return () => { calls.push(key); };
        },
        set(_t, prop, value) {
            const key = String(prop);
            if (typeof value === 'function') {
                target[key] = value;
            }
            else {
                props[key] = value;
            }
            return true;
        },
        deleteProperty(_t, prop) {
            delete target[String(prop)];
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, props };
}


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
    assert.deepEqual(signal.minT.map(t => +t!.toFixed(6)), [11.2, 12.2]);
    assert.deepEqual(signal.maxT.map(t => +t!.toFixed(6)), [11.4, 12.4]);
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
const STYLE = { title: 'Level [dBFS]', text: '#ddd', back: '#111', line: '#444' };
const rasterView = { zoomStart: 0, zoomEnd: 1, trackStart: 0, trackDurRatio: 1, dbLo: -80, dbHi: -20, maxFrequencyHz: 1000 };

test('paintTrackSpectrogram repaints only when the spectrogram or its view changes', () => {
    const first = recordingCtx();
    const entry = paintTrackSpectrogram(first.ctx, 120, 40, spec, rasterView, undefined, STYLE);
    assert.ok(first.calls.includes('putImageData'));
    assert.equal(entry.source, spec);

    const same = recordingCtx();
    assert.equal(paintTrackSpectrogram(same.ctx, 120, 40, spec, rasterView, entry, STYLE), entry);
    assert.deepEqual(same.calls, []);

    const zoomed = recordingCtx();
    const next = paintTrackSpectrogram(zoomed.ctx, 120, 40, spec, { ...rasterView, zoomEnd: 0.5 }, entry, STYLE);
    assert.notEqual(next, entry);
    assert.ok(zoomed.calls.includes('putImageData'));
});

test('a spectrogram lane is drawn over its whole width, with the colour bar every coloured picture draws in its top right (R13)', () => {
    const { ctx, calls } = recordingCtx();
    const entry = paintTrackSpectrogram(ctx, 400, 60, spec, rasterView, undefined, STYLE);
    // The raster spans the canvas: the lanes share one time axis with nothing beside it.
    assert.ok(calls.includes('createImageData 400x60'), calls.join(','));
    // paintColourBar: the name, the low end, the strip, the high end.
    assert.ok(calls.includes('fillText Level [dBFS]') && calls.includes('fillText -80') && calls.includes('fillText -20'), calls.join(','));
    const box = entry.colourBar;
    assert.ok(box.x > 0 && box.x + box.width <= 396 && box.y === 3 && box.height === 14, JSON.stringify(box));
    assert.equal(onColourBar(entry, box.x + 1, box.y + 1), true);
    assert.equal(onColourBar(entry, 10, 50), false);
    // A new name is a new look: the lane is painted again.
    const renamed = recordingCtx();
    assert.notEqual(paintTrackSpectrogram(renamed.ctx, 400, 60, spec, rasterView, entry, { ...STYLE, title: 'Level [dB SPL]' }), entry);
});
