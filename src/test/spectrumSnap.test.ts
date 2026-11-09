import assert from 'node:assert/strict';
import test from 'node:test';
import { spectrumReadoutText } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSlice } from '../webview/runtime/types';

function slice(values: number[]): SpectrumSlice {
    return { values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0 };
}

test('spectrum readout texts include the label, frequency and level with its unit', () => {
    const s = { ...slice([-12.34]), unit: 'dB SPL' };
    assert.equal(spectrumReadoutText('a.wav / ch1', s, 1500, -12.34), 'a.wav / ch1 / 1.5 kHz / −12.3 dB SPL');
    // A slice without a unit reads in its axis' reference; with neither it names none, never a bare "dB" (R4, A50).
    assert.equal(spectrumReadoutText('a.wav', { ...slice([0]), axisLabel: 'Spectrum amplitude level [dBFS]' }, 250, -3), 'a.wav / 250 Hz / −3.0 dBFS');
    assert.equal(spectrumReadoutText('a.wav', slice([0]), 250, -3), 'a.wav / 250 Hz / −3.0');
});

