import assert from 'node:assert/strict';
import test from 'node:test';
import { WaveformView } from '../webview/runtime/waveformView';

function close(actual: number, expected: number) {
    assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

test('WaveformView starts unzoomed in time and amplitude', () => {
    const view = new WaveformView();
    assert.deepEqual(view.timeRange(), { start: 0, end: 1 });
    assert.equal(view.span(), 1);
    assert.equal(view.isAmplitudeZoomed(), false);
});

test('WaveformView time operations update the visible window', () => {
    const view = new WaveformView();
    view.zoomBy(0.5);
    assert.deepEqual(view.timeRange(), { start: 0.25, end: 0.75 });
    view.pan(1);
    close(view.start, 0.3);
    close(view.end, 0.8);
    view.centerOn(0.5);
    close(view.start, 0.25);
    close(view.end, 0.75);
    view.zoomAround(0.25, 2);
    close(view.start, 0);
    close(view.end, 1);
    view.showRegion({ start: 0.4, end: 0.6 }, 0.05);
    close(view.start, 0.39);
    close(view.end, 0.61);
});

test('WaveformView rect zoom sets both windows and reset restores them', () => {
    const view = new WaveformView();
    view.applyRectZoom({ zoomStart: 0.1, zoomEnd: 0.2, amplitudeMin: -0.5, amplitudeMax: 0.5 });
    assert.deepEqual(view.timeRange(), { start: 0.1, end: 0.2 });
    assert.equal(view.isAmplitudeZoomed(), true);
    assert.equal(view.canvasYToAmplitude(100, 100), -0.5);
    view.reset();
    assert.deepEqual(view.timeRange(), { start: 0, end: 1 });
    assert.deepEqual([view.amplitudeMin, view.amplitudeMax], [-1, 1]);
    assert.equal(view.isAmplitudeZoomed(), false);
});
