import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestSpectrumSnap, spectrumBinAtHover, setSpectrumReadout, spectrumReadoutText, trackSpectrumReadoutText, type SpectrumPlotFrame } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSlice } from '../webview/runtime/types';

function slice(values: number[]): SpectrumSlice {
    return { values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0 };
}

const FRAME: SpectrumPlotFrame = {
    padLeft: 10, plotWidth: 100, padTop: 5, plotHeight: 100,
    frequencyMin: 0, frequencyMax: 1000, dbMin: -100, dbMax: 0,
};

test('spectrumBinAtHover maps the hover position to the nearest bin inside the frame', () => {
    const snap = spectrumBinAtHover(slice([-100, -50, 0, -25, -75]), 0.5, FRAME);
    assert.deepEqual(snap, { binIdx: 2, freqHz: 500, x: 60, dbVal: 0, y: 5 });
});

test('nearestSpectrumSnap picks the series closest to the mouse Y', () => {
    const quiet = { name: 'quiet', slice: slice([-90, -90, -90]) };
    const loud = { name: 'loud', slice: slice([-10, -10, -10]) };
    const hit = nearestSpectrumSnap([quiet, loud], 0.5, 20, FRAME);
    assert.equal(hit?.s.name, 'loud');
    assert.equal(hit?.dbVal, -10);
    assert.ok(Math.abs((hit?.snapY ?? 0) - 15) < 1e-9);
});

test('nearestSpectrumSnap without a mouse Y returns the first usable series', () => {
    const empty = { name: 'empty', slice: { ...slice([]), frequencyBins: 0 } };
    const first = { name: 'first', slice: slice([-60, -60]) };
    const second = { name: 'second', slice: slice([-5, -5]) };
    assert.equal(nearestSpectrumSnap([empty, first, second], 0.2, null, FRAME)?.s.name, 'first');
});

test('nearestSpectrumSnap returns null when no series has a value at the hover bin', () => {
    const flatRange = { ...FRAME, dbMin: 0, dbMax: 0 };
    assert.equal(nearestSpectrumSnap([{ slice: slice([-1, -2]) }], 0.5, 10, flatRange), null);
    assert.equal(nearestSpectrumSnap([], 0.5, 10, FRAME), null);
});

test('spectrum readout texts include the label, frequency and level with its unit', () => {
    const s = { ...slice([-12.34]), unit: 'dB SPL' };
    assert.equal(spectrumReadoutText('a.wav / ch1', s, 1500, -12.34), 'a.wav / ch1 / 1500 Hz / -12.3 dB SPL');
    assert.equal(trackSpectrumReadoutText('a.wav', slice([0]), 250, -3), 'a.wav 250 Hz  -3.0 dB');
    assert.equal(trackSpectrumReadoutText('a.wav', slice([0]), 250, undefined), 'a.wav 250 Hz');
});

test('setSpectrumReadout: 要素のテキストと色を書き換え、要素が無ければ何もしない', () => {
    const el = { textContent: 'old' as string | null, style: { color: 'red' } };
    setSpectrumReadout(el, 'a.wav 250 Hz', '#0af');
    assert.deepEqual(el, { textContent: 'a.wav 250 Hz', style: { color: '#0af' } });
    setSpectrumReadout(el, '', '');
    assert.deepEqual(el, { textContent: '', style: { color: '' } });
    assert.doesNotThrow(() => setSpectrumReadout(null, 'x', 'y'));
});
