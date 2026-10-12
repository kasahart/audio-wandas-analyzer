import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { SpectrogramData } from '../shared/analysis/analysisTypes';
import {
    domSnapshotBase,
    latestSpectrogramSnapshot,
    spectrogramAxisLabelTexts,
    spectrumAxisLabelTexts,
} from '../webview/runtime/testSnapshot';
import type { RuntimeDocument } from '../webview/runtime/types';

function spectrogram(overrides: Partial<SpectrogramData> = {}): SpectrogramData {
    return {
        values: [[0]], timeBins: 1, frequencyBins: 1, windowSize: 2048, hopSize: 512,
        maxFrequencyHz: 24_000, minDb: -90, maxDb: -10, ...overrides,
    };
}

test('domSnapshotBase counts the rendered toolbar, rows, audio elements and canvases', () => {
    const dom = new JSDOM(`<body>
        <div id="toolbar"><button data-action="zoom-in"></button><button data-action=""></button><button data-action="fit"></button></div>
        <div class="track-row"></div><div class="track-row"></div>
        <div id="audio-host"><audio></audio></div>
        <canvas id="ruler-canvas"></canvas>
        <canvas class="track-spectrum-canvas"></canvas>
    </body>`);
    assert.deepEqual(domSnapshotBase(dom.window.document as unknown as RuntimeDocument), {
        hasToolbar: true,
        toolbarActions: ['zoom-in', 'fit'],
        trackRowCount: 2,
        audioElementCount: 1,
        hasRulerCanvas: true,
        spectrumOverlayPresent: false,
        spectrumTrackCanvasCount: 1,
    });
});

test('spectrumAxisLabelTexts lists dB ticks top-down then frequency ticks with the source unit', () => {
    assert.deepEqual(spectrumAxisLabelTexts(-80, 0, 0, 2000, null), ['0 dB', '-40 dB', '-80 dB', '0 Hz', '1.0 kHz', '2.0 kHz']);
    assert.deepEqual(spectrumAxisLabelTexts(20, 100, 0, 500, { unit: 'dB SPL' }).slice(0, 3), ['100 dB SPL', '60 dB SPL', '20 dB SPL']);
});

test('spectrogramAxisLabelTexts applies display overrides and caps the max frequency', () => {
    const spec = spectrogram();
    assert.deepEqual(
        spectrogramAxisLabelTexts(spec, { dbMin: null, dbMax: null, maxFrequencyHz: null }, 0),
        ['0 Hz', '12 kHz', '24 kHz', '-90 dB', '-10 dB', 'Freq'],
    );
    assert.deepEqual(
        spectrogramAxisLabelTexts(spec, { dbMin: -60, dbMax: 0, maxFrequencyHz: 8000 }, 0),
        ['0 Hz', '4.0 kHz', '8.0 kHz', '-60 dB', '0 dB', 'Freq'],
    );
});

test('spectrogramAxisLabelTexts falls back to the sample-rate limit without spectrogram data', () => {
    assert.deepEqual(
        spectrogramAxisLabelTexts(null, { dbMin: null, dbMax: null, maxFrequencyHz: null }, 4000),
        ['0 Hz', '2.0 kHz', '4.0 kHz', '-120 dB', '0 dB', 'Freq'],
    );
    assert.deepEqual(spectrogramAxisLabelTexts(null, { dbMin: null, dbMax: null, maxFrequencyHz: null }, 0), []);
});

test('latestSpectrogramSnapshot prefers STFT settings and reports applied display limits', () => {
    assert.equal(latestSpectrogramSnapshot(undefined, null), undefined);
    assert.deepEqual(latestSpectrogramSnapshot(spectrogram(), null), {
        windowSize: 2048, hopSize: 512, dbMinApplied: null, dbMaxApplied: null, maxFrequencyHzApplied: null,
    });
    assert.deepEqual(latestSpectrogramSnapshot(spectrogram(), {
        auto: false,
        stft: { nFft: 4096, hopSize: 1024, window: 'hann' },
        display: { dbMin: -70, dbMax: null, maxFrequencyHz: 12_000 },
    }), {
        windowSize: 4096, hopSize: 1024, dbMinApplied: -70, dbMaxApplied: null, maxFrequencyHzApplied: 12_000,
    });
});
