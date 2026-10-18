import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecSummaryText, buildSpectrumCsv, wavLoopRegions } from '../webview/runtime/runtimeExports';
import type { SpectrumSlice } from '../webview/runtime/types';

const slice = (values: number[], extra: Partial<SpectrumSlice> = {}): SpectrumSlice => ({
    values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0, ...extra,
});

test('spectrum CSV pairs a frequency and a level column per track and pads shorter tracks', () => {
    const csv = buildSpectrumCsv([
        { name: 'a.wav ch1', slice: slice([-10, -20, -30], { axisLabel: 'Level [dB SPL]' }) },
        { name: 'b,"x".wav', slice: slice([-1.5], { originalMaxFrequencyHz: 500 }) },
    ]);
    assert.deepEqual(csv.split('\n'), [
        'a.wav ch1 frequency (Hz),a.wav ch1 Level [dB SPL],"b,""x"".wav frequency (Hz)","b,""x"".wav Spectrum level [dB]"',
        '0.0000,-10.000000,0.0000,-1.500000',
        '500.0000,-20.000000,,',
        '1000.0000,-30.000000,,',
    ]);
});

test('spectrum CSV lists the band centres of an octave-band slice', () => {
    const csv = buildSpectrumCsv([{ name: 'a', slice: slice([-10, -20], { bandsPerOctave: 3, bandCentersHz: [31.5, 40], axisLabel: 'Band level [dBFS]' }) }]);
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

test('spec summary lists each track and the STFT settings', () => {
    const text = buildSpecSummaryText([
        { fileName: 'a.wav', sampleRateHz: 48000, durationSeconds: 1.5, channelCount: 2 },
        {},
    ], { nFft: 1024, overlapPercent: 75, window: 'hann' });
    assert.equal(text, [
        '=== Audio Analyzer Spec ===',
        '[Track 1] a.wav  48.0 kHz  1.50 s  2 ch',
        '[Track 2]   0.0 kHz  0.00 s  0 ch',
        '--- STFT ---',
        'nFft: 1024  overlap: 75%  window: hann',
    ].join('\n'));
});

test('spec summary tolerates missing STFT settings', () => {
    assert.match(buildSpecSummaryText([], undefined), /nFft: {3}overlap: {3}window: $/);
});
