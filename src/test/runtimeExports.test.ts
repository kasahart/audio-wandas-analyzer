import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpectrumCsv, wavLoopRegions } from '../webview/runtime/runtimeExports';
import type { SpectrumSlice } from '../webview/runtime/types';
import { assertNotDrawn } from './fullNotDrawn';
import { P, T } from './helpers/figure';

const slice = (values: number[], extra: Partial<SpectrumSlice> = {}): SpectrumSlice => ({
    values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0, ...extra,
});

test('spectrum CSV pairs a frequency and a level column per track, each named as its axis is (C5), and pads shorter tracks', () => {
    const csv = buildSpectrumCsv([
        { name: 'a.wav ch1', slice: slice([-10, -20, -30], { axisLabel: 'Level [dB SPL]' }), levelTitle: T('Level [dB SPL re 20 µPa]') },
        { name: 'b,"x".wav', slice: slice([-1.5], { originalMaxFrequencyHz: 500 }), levelTitle: T('Level, uncalibrated [dBFS]') },
    ], P('Frequency [Hz]'));
    assert.deepEqual(csv.split('\n'), [
        'a.wav ch1 Frequency [Hz],a.wav ch1 Level [dB SPL re 20 µPa],"b,""x"".wav Frequency [Hz]","b,""x"".wav Level, uncalibrated [dBFS]"',
        '0.0000,-10.000000,0.0000,-1.500000',
        '500.0000,-20.000000,,',
        '1000.0000,-30.000000,,',
    ]);
});

test('spectrum CSV lists the band centres of an octave-band slice', () => {
    const csv = buildSpectrumCsv([{ name: 'a', slice: slice([-10, -20], { bandsPerOctave: 3, bandCentersHz: [31.5, 40], axisLabel: 'Band level [dBFS]' }), levelTitle: T('Level, uncalibrated [dBFS]') }], P('Frequency [Hz]'));
    assert.deepEqual(csv.split('\n').slice(1), ['31.5000,-10.000000', '40.0000,-20.000000']);
});

test('WAV loop regions clip to each file and drop files outside the loop', () => {
    const tracks = [
        { filePath: 'a.wav', offsetSeconds: 0, durationSeconds: 10 },
        { filePath: 'b.wav', offsetSeconds: 5, durationSeconds: 2 },
        { filePath: 'c.wav', offsetSeconds: 20, durationSeconds: 5 },
    ];
    assert.deepEqual(wavLoopRegions(tracks, 4, 6), [
        { filePath: 'a.wav', startNorm: 0.4, endNorm: 0.6 },
        { filePath: 'b.wav', startNorm: 0, endNorm: 0.5 },
    ]);
    assert.deepEqual(wavLoopRegions(tracks, 30, 40), []);
});

test('spectrum CSV writes every FFT bin of a whole row at fs / n_fft spacing', () => {
    const sampleRateHz = 12000;
    const nFft = 8192;
    const values = Array.from({ length: nFft / 2 + 1 }, (_, bin) => -1 - bin / 100);
    // The display may cap the plotted range; the file still lists every bin up to Nyquist.
    const shown = slice(values, { maxFrequencyHz: 2000, originalMaxFrequencyHz: sampleRateHz / 2 });
    const csv = buildSpectrumCsv([{ name: 'a', slice: shown, levelTitle: T('Level, uncalibrated [dBFS]') }], P('Frequency [Hz]'));
    const rows = csv.split('\n').slice(1).map(row => row.split(',').map(Number));
    assert.equal(rows.length, nFft / 2 + 1);
    assertNotDrawn(rows.length, values.filter((_, bin) => bin * sampleRateHz / nFft <= shown.maxFrequencyHz).length, 'not only the bins of the range the display draws');
    assert.notEqual(Math.round(rows[rows.length - 1][0]), shown.maxFrequencyHz, 'up to Nyquist, not the range the display draws');
    rows.forEach(([frequencyHz, level], bin) => {
        assert.ok(Math.abs(frequencyHz - bin * sampleRateHz / nFft) < 1e-4);
        assert.ok(Math.abs(level - values[bin]) < 1e-6);
    });
});
