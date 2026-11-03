import assert from 'node:assert/strict';
import test from 'node:test';
import { envelopePeak } from '../webview/waveform/envelopePeak';

const envelope = { min: [-0.2, -0.1, -0.9], max: [0.3, 0.25, 1.0], minT: [0.05, 0.45, 0.95], maxT: [0.1, 0.5, 0.9], absolutePeak: 1.0 };

test('a trigger\'s starting peak is the region\'s, not a click outside it', () => {
    // 10 s recording: the click at 9–9.5 s is outside a 0–6 s region.
    assert.equal(envelopePeak(envelope, 10, { start: 0, end: 6 }), 0.3);
    assert.equal(envelopePeak(envelope, 10, null), 1.0);
    assert.equal(envelopePeak(envelope, 10, { start: 8, end: 10 }), 1.0);
    // Without positions or a length, the whole recording's.
    assert.equal(envelopePeak({ ...envelope, minT: undefined, maxT: undefined }, 10, { start: 0, end: 6 }), 1.0);
    assert.equal(envelopePeak(undefined, 10, null), 0);
});
