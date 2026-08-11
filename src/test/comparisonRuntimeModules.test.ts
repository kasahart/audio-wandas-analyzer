import assert from 'node:assert/strict';
import test from 'node:test';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import {
    createTrackTimeMapping,
    globalNormFromTrackTime,
    trackTimeFromGlobalNorm,
} from '../webview/runtime/playback';
import { parseBoundedInteger, positionPopover } from '../webview/runtime/settingsPopover';
import { spectrumBinAtFrequency } from '../webview/runtime/spectrumRuntime';
import { PersistedStateStore } from '../webview/runtime/stateStore';
import {
    amplitudeNormToCanvasY,
    canvasYToAmplitudeNorm,
    zoomNormalizedRange,
} from '../webview/runtime/waveformInteraction';
import type { PersistedWebviewState, WebviewHostApi } from '../webview/runtime/types';

test('playback mapping converts between track time and the global timeline', () => {
    const mapping = createTrackTimeMapping(4, 2, { startSeconds: -2, spanSeconds: 8 });
    assert.ok(mapping);
    assert.equal(globalNormFromTrackTime(mapping, 2), 0.75);
    assert.equal(trackTimeFromGlobalNorm(mapping, 0.75), 2);
    assert.equal(trackTimeFromGlobalNorm(mapping, 1), 4);
});

test('waveform interaction keeps normalized zoom and amplitude transforms bounded', () => {
    const zoomed = zoomNormalizedRange({ start: 0, end: 0.4 }, 2);
    assert.equal(zoomed.start, 0);
    assert.ok(Math.abs(zoomed.end - 0.6) < Number.EPSILON);
    const y = amplitudeNormToCanvasY(0.25, 100, -0.5, 0.5);
    assert.equal(canvasYToAmplitudeNorm(y, 100, -0.5, 0.5), 0.25);
    assert.equal(canvasYToAmplitudeNorm(0, 0, -1, 1), 0);
});

test('spectrum interaction snaps to a visible source bin', () => {
    const snap = spectrumBinAtFrequency(
        { values: [-80, -40, -20], frequencyBins: 3, maxFrequencyHz: 2000, minDb: -100, maxDb: 0 },
        900,
        10,
        100,
        5,
        50,
        0,
        2000,
        -100,
        0,
    );
    assert.deepEqual(snap, { binIdx: 1, freqHz: 1000, x: 60, dbVal: -40, y: 25 });
});

test('settings helpers clamp input and keep popovers inside the viewport', () => {
    assert.equal(parseBoundedInteger('999', 80, 220), 220);
    assert.equal(parseBoundedInteger('invalid', 80, 220), null);
    assert.deepEqual(positionPopover(190, 90, 80, 60, 200, 100), { left: 102, top: 22 });
});

test('persisted state store merges patches through the host boundary', () => {
    const writes: PersistedWebviewState[] = [];
    const host: WebviewHostApi = {
        postMessage: () => undefined,
        getState: () => ({ contentType: 'waveform' }),
        setState: (state) => { writes.push(state); },
    };
    const store = new PersistedStateStore(host);
    store.update({ treeFilterQuery: 'kick' });
    assert.deepEqual(store.snapshot, { contentType: 'waveform', treeFilterQuery: 'kick' });
    assert.deepEqual(writes, [store.snapshot]);
});

test('host message validation rejects unknown and incomplete payloads', () => {
    assert.equal(isHostInboundMessage({ type: 'unknown-message' }), false);
    assert.equal(isHostInboundMessage({ type: 'waveform-range-result', requestId: '1' }), false);
    assert.equal(isHostInboundMessage({ type: 'reanalyze-end' }), true);
});
