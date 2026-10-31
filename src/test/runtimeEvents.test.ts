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

test('the test bridge builds and posts a snapshot only on a page with test hooks', () => {
    for (const hooks of [false, true]) {
        const posted: unknown[] = [];
        const frames: Array<() => void> = [];
        const bridge = new ComparisonTestBridge(
            { __AWA_TEST_HOOKS__: hooks, requestAnimationFrame: (callback: () => void) => frames.push(callback) } as unknown as RuntimeWindow,
            { post: (message: unknown) => { posted.push(message); } } as unknown as HostMessenger,
        );
        let built = 0;
        bridge.provide({
            build: () => { built += 1; if (built === 3) throw new Error('half drawn'); return { built }; },
            fallback: error => ({ failed: (error as Error).message }),
        });
        bridge.publish();
        bridge.publishAfterFrame();
        frames.forEach(frame => frame());
        bridge.publishFor('a1');
        if (!hooks) {
            assert.equal(built, 0);
            assert.deepEqual(posted, []);
            continue;
        }
        assert.deepEqual(posted, [
            { type: 'comparison-panel-test-snapshot', actionId: undefined, renderedUi: { built: 1 } },
            { type: 'comparison-panel-test-snapshot', actionId: undefined, renderedUi: { built: 2 } },
            { type: 'comparison-panel-test-snapshot', actionId: 'a1', renderedUi: { failed: 'half drawn' } },
        ]);
    }
});
