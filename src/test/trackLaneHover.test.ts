import assert from 'node:assert/strict';
import { N, P, R, T } from './helpers/figure';
import test from 'node:test';
import { assertNotDrawn, nearestOf } from './fullNotDrawn';
import type { SpectrogramData } from '../shared/analysis/analysisTypes';
import { localCells, localLine } from '../webview/runtime/fullRead';
import { paintOverlay, stageHover, stageStep, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import { laneWaveformOverlay, paintTrackSpectrogram } from '../webview/runtime/trackCanvasPainter';
import { laneReadoutText, spectrogramReadoutText } from '../webview/runtime/trackLaneHover';

/** A lane canvas at its CSS size whose context draws nothing. */
function laneCanvas(width: number, height: number): HTMLCanvasElement {
    const state: Record<string, unknown> = {};
    const context = new Proxy(state, {
        get(target, key) {
            const name = String(key);
            if (name in target) return target[name];
            if (name === 'measureText') return () => ({ width: 10 });
            if (name === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
            if (name === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
            return () => undefined;
        },
        set(target, key, value) { target[String(key)] = value; return true; },
    });
    return { width, height, clientWidth: width, clientHeight: height, dataset: {}, ownerDocument: {}, getContext: () => context } as unknown as HTMLCanvasElement;
}

const close = (actual: number | undefined, expected: number, what: string): void => {
    assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${what}: ${actual} ≠ ${expected}`);
};

// A 2 s file placed from 1 s to 3 s of a 4 s span of the lanes' axis, starting at 10 s.
const place = { startSec: 10, spanSec: 4, offsetNorm: 0.25, trackDurRatio: 0.5 };
const laneSeconds = (fileSeconds: number): number => 11 + fileSeconds;

test('the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)', () => {
    const count = 40000;
    const samples = Array.from({ length: count }, (_, index) => 0.8 * Math.sin(index * 1.37) * Math.cos(index * 0.013));
    const norms = samples.map((_, index) => index / (count - 1));
    // Drawn as 400 buckets' lowest and highest samples (R2).
    const min: number[] = [], max: number[] = [], minT: number[] = [], maxT: number[] = [];
    const drawn = new Set<number>();
    for (let start = 0; start < count; start += 100) {
        let low = start, high = start;
        for (let index = start; index < start + 100; index++) {
            if (samples[index] < samples[low]) low = index;
            if (samples[index] > samples[high]) high = index;
        }
        min.push(samples[low]); max.push(samples[high]); minT.push(norms[low]); maxT.push(norms[high]);
        drawn.add(low).add(high);
    }
    const lane = laneWaveformOverlay({ waveform: { min, max, minT, maxT, samples: [], absolutePeak: 1 }, dataStart: 0, dataEnd: 1, amplitudeScale: 1 },
        place, '#00ff00', 'Pa', localLine(norms, samples));
    const plot = paintOverlay(laneCanvas(400, 100), lane.overlay, R({ min: -1, max: 1 }), N({ x: 'Time [s]', y: 'Amplitude [Pa]' }),
        { axisCanvas: null, axisView: lane.axisView, window: { x: { start: 0, end: 1 } } }) as StagePlot;
    assert.ok(plot);
    let at = 20003;
    while (drawn.has(at)) at++;
    let read: StageRead | null | undefined = stageHover(plot, plot.xAt(laneSeconds(at / (count - 1) * 2)), plot.yAt(samples[at]));
    assert.equal(read?.full, true);
    close(read?.at, laneSeconds(at / (count - 1) * 2), 'the sample under the pointer, on the lanes\' time axis');
    assert.equal(read?.value, samples[at]);
    assert.ok(read?.values.endsWith(' Pa'), read?.values);
    const drawnValues = [...drawn].map(index => samples[index]);
    assert.ok(!drawnValues.includes(samples[at]));
    assertNotDrawn(read?.value, nearestOf(drawnValues, samples[at]), 'not a value of the envelope drawn');
    const started = at;
    for (const delta of [1, 1, 1, 1, 1, -1, -1, -1] as const) {
        read = read ? stageStep(plot, read, delta) : null;
        at += delta;
        close(read?.at ?? undefined, laneSeconds(at / (count - 1) * 2), `step to sample ${at}`);
        assert.equal(read?.value, samples[at]);
    }
    // Five keys on and three back: two samples on, never the envelope's second point after.
    assertNotDrawn(read?.value, samples[[...drawn].filter(index => index > started).sort((a, b) => a - b)[1]], 'not the second drawn point on');
});

test('a track lane\'s readout names the recording, its time to the digits a pixel tells apart and the amplitude in its unit', () => {
    assert.equal(laneReadoutText('a.wav', 1.23456, 0.001, -0.0123, 'Pa'), 'a.wav / 1.235 s / −0.0123 Pa');
    assert.equal(laneReadoutText('a.wav', 12, 0.5, 0.5, null), 'a.wav / 12.00 s / 0.500');
});

test('the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)', () => {
    // The STFT: 80 frames 25 ms apart, 9 bins 500 Hz apart; each cell its own level.
    const frames = Array.from({ length: 80 }, (_, frame) => 0.0125 + frame * 0.025);
    const bins = Array.from({ length: 9 }, (_, bin) => bin * 500);
    const raw = bins.map((_, bin) => frames.map((_, frame) => -60 + 20 * Math.sin(frame * 0.9 + bin)));
    // Drawn eight frames to a column and two bins to a row: their mean.
    const spec: SpectrogramData = {
        values: Array.from({ length: 10 }, (_, column) => Array.from({ length: 5 }, (_, row) => {
            const cells = raw.slice(row * 2, row * 2 + 2).flatMap(line => line.slice(column * 8, column * 8 + 8));
            return cells.reduce((sum, value) => sum + value, 0) / cells.length;
        })),
        timeBins: 10, frequencyBins: 5, windowSize: 256, hopSize: 64, maxFrequencyHz: 4000, minDb: -80, maxDb: -40, unit: 'dB',
    };
    const entry = paintTrackSpectrogram(laneCanvas(400, 90), null, spec, place,
        { window: { start: 0, end: 1 }, dbLo: -80, dbHi: -40, maxFrequencyHz: 4000, minFrequencyHz: 0, durationSec: 2 }, undefined,
        { colour: T('Level [dBFS]'), frequency: P('Frequency [Hz]'), time: P('Time [s]') }, '', localCells(frames, bins, raw));
    const plot = entry.plot;
    assert.ok(plot?.image);
    let frame = 41;
    const bin = 5;
    const where = plot.image.placeOf(laneSeconds(frames[frame]), bins[bin]);
    let read: StageRead | null | undefined = stageHover(plot, where.x, where.y);
    assert.equal(read?.full, true);
    assert.equal(read?.value, raw[bin][frame], 'the cell itself');
    assert.notEqual(read?.value, spec.values[Math.floor(frame / 8)][Math.floor(bin / 2)], 'not the mean drawn');
    close(read?.at, laneSeconds(frames[frame]), 'its frame, on the lanes\' time axis');
    assert.equal(read?.row, bins[bin]);
    assert.equal(read?.rowStep, 500);
    for (const delta of [1, 1, 1, -1, -1] as const) {
        read = read ? stageStep(plot, read, delta) : null;
        frame += delta;
        close(read?.at ?? undefined, laneSeconds(frames[frame]), `step to frame ${frame}`);
        assert.equal(read?.value, raw[bin][frame]);
    }
    assert.equal(spectrogramReadoutText('', 0.25, 0.01, { frequencyHz: 2000, level: -22 }, 'dB'), '0.25 s / 2 kHz / −22.0 dB');
});
