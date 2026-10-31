import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeEventFeed, type ComparisonRuntimeEvent } from '../webview/runtime/runtimeEvents';
import { ComparisonTestBridge } from '../webview/runtime/testBridge';
import type { HostMessenger } from '../webview/runtime/hostMessaging';
import type { RuntimeWindow, UiSmokeState } from '../webview/runtime/types';

const waveformZoom: ComparisonRuntimeEvent = {
    type: 'waveform-zoom',
    snapshot: { zoomStart: 0.1, zoomEnd: 0.6, amplitudeZoomMinNorm: -1, amplitudeZoomMaxNorm: 1, rectZoomSelection: null },
};

function bridgeFor(state: UiSmokeState | undefined): ComparisonTestBridge {
    return new ComparisonTestBridge({ __uiSmokeState: state } as unknown as RuntimeWindow, {} as HostMessenger);
}

test('RuntimeEventFeed builds an event only while someone listens', () => {
    const feed = new RuntimeEventFeed();
    let built = 0;
    const build = () => { built += 1; return waveformZoom; };
    feed.emit(build);
    assert.equal(built, 0);
    const seen: ComparisonRuntimeEvent[] = [];
    const unsubscribe = feed.subscribe(event => seen.push(event));
    feed.emit(build);
    assert.equal(built, 1);
    assert.deepEqual(seen, [waveformZoom]);
    unsubscribe();
    feed.emit(build);
    assert.equal(built, 1);
});

test('the test bridge copies the runtime events into the smoke state', () => {
    const state: UiSmokeState = {};
    const feed = new RuntimeEventFeed();
    bridgeFor(state).observe(feed);
    feed.emit(() => waveformZoom);
    feed.emit(() => ({
        type: 'spectrum-zoom',
        snapshot: { specFreqStart: 0, specFreqEnd: 0.5, trackHeight: 160, spectrumOverlayHeight: 140, specDbMin: null, specDbMax: -10 },
    }));
    const timing = { requestId: 'slice-1', cursorNorm: 0.2, backendComputeMs: 3, cursorToResponseMs: 12, responseAt: 40, inFlight: 0, desiredCount: 1 };
    feed.emit(() => ({ type: 'spectrum-slice-timing', timing }));
    assert.equal(state.zoomStart, 0.1);
    assert.equal(state.zoomEnd, 0.6);
    assert.equal(state.rectZoomSelection, null);
    assert.deepEqual(state.spectrumZoom, { specFreqStart: 0, specFreqEnd: 0.5, trackHeight: 160, spectrumOverlayHeight: 140, specDbMin: null, specDbMax: -10 });
    assert.deepEqual(state.spectrumPerformance, timing);
});

test('outside the smoke tests the bridge does not listen, so no event is built', () => {
    const feed = new RuntimeEventFeed();
    bridgeFor(undefined).observe(feed);
    let built = 0;
    feed.emit(() => { built += 1; return waveformZoom; });
    assert.equal(built, 0);
});
