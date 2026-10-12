import assert from 'node:assert/strict';
import test from 'node:test';
import { spectrumDbRangeAfterZoom } from '../webview/runtime/spectrumRuntime';

test('spectrumDbRangeAfterZoom: zooming out to the full frequency range restores auto dB', () => {
    assert.deepEqual(spectrumDbRangeAfterZoom({ start: 0, end: 1 }, 1 / 0.7, { min: -80, max: -20 }), { dbMin: null, dbMax: null });
});

test('spectrumDbRangeAfterZoom: scales the last visible dB span around its center', () => {
    assert.deepEqual(spectrumDbRangeAfterZoom({ start: 0.2, end: 0.6 }, 0.5, { min: -80, max: -20 }), { dbMin: -65, dbMax: -35 });
    assert.deepEqual(spectrumDbRangeAfterZoom({ start: 0, end: 1 }, 0.5, { min: -80, max: -20 }), { dbMin: -65, dbMax: -35 });
});

test('spectrumDbRangeAfterZoom: keeps the current dB range before the first spectrum paint', () => {
    assert.equal(spectrumDbRangeAfterZoom({ start: 0.2, end: 0.6 }, 0.5, null), null);
});
