import test from 'node:test';
import assert from 'node:assert/strict';
import { wavLoopRegions } from '../webview/runtime/runtimeExports';

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
