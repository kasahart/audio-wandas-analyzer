import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { SpectrogramData } from '../shared/analysis/analysisTypes';
import {
    domSnapshotBase,
    latestSpectrogramSnapshot,
    visibleFileRange,
    waveformCoverageSnapshot,
} from '../webview/runtime/testSnapshot';

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
    </body>`);
    assert.deepEqual(domSnapshotBase(dom.window.document), {
        hasToolbar: true,
        toolbarActions: ['zoom-in', 'fit'],
        trackRowCount: 2,
        audioElementCount: 1,
        hasRulerCanvas: true,
        spectrumOverlayPresent: false,
        intlLocale: new Intl.NumberFormat().resolvedOptions().locale,
        navigatorLanguage: dom.window.navigator.language,
    });
});

test('latestSpectrogramSnapshot prefers STFT settings and reports applied display limits', () => {
    assert.equal(latestSpectrogramSnapshot(undefined, null), undefined);
    assert.deepEqual(latestSpectrogramSnapshot(spectrogram(), null), {
        windowSize: 2048, overlapPercent: null, hopSize: 512, dbMinApplied: null, dbMaxApplied: null, maxFrequencyHzApplied: null,
    });
    assert.deepEqual(latestSpectrogramSnapshot(spectrogram(), {
        auto: false,
        stft: { nFft: 4096, overlapPercent: 50, window: 'hann' },
        display: { dbMin: -70, dbMax: null, maxFrequencyHz: 12_000 },
    }), {
        windowSize: 4096, overlapPercent: 50, hopSize: 512, dbMinApplied: -70, dbMaxApplied: null, maxFrequencyHzApplied: 12_000,
    });
});

test('visibleFileRange: ズーム範囲をファイル内の正規化位置に変換し 0..1 に収める', () => {
    assert.deepEqual(visibleFileRange(0.25, 0.5, { offsetNorm: 0, trackDurRatio: 0.5 }), { startNorm: 0.5, endNorm: 1 });
    assert.deepEqual(visibleFileRange(0, 1, { offsetNorm: 0.2, trackDurRatio: 0.4 }), { startNorm: 0, endNorm: 1 });
});

test('waveformCoverageSnapshot: coverage がなければ false と null を返す', () => {
    assert.deepEqual(waveformCoverageSnapshot(null), {
        waveformCoversViewportLeft: false,
        waveformCoversViewportRight: false,
        waveformMinDrawX: null,
        waveformMaxDrawX: null,
        waveformCanvasWidth: null,
    });
    assert.deepEqual(waveformCoverageSnapshot({ minX: 0, maxX: 80, canvasWidth: 100, coversLeft: true, coversRight: false }), {
        waveformCoversViewportLeft: true,
        waveformCoversViewportRight: false,
        waveformMinDrawX: 0,
        waveformMaxDrawX: 80,
        waveformCanvasWidth: 100,
    });
});


