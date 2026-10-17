import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackTimeMapping, loopRestartTime, playbackEndFade, playbackStartTime } from '../webview/runtime/playback';

const mapping = createTrackTimeMapping(4, 0, { startSeconds: 0, spanSeconds: 8 });

test('playbackStartTime maps the start position into track time', () => {
    assert.equal(playbackStartTime(mapping, 0.25, 4), 2);
    assert.equal(playbackStartTime(null, 0.25, 4), 0);
});

test('playbackStartTime restarts from the top at or near the end of the track', () => {
    assert.equal(playbackStartTime(mapping, 0.5, 4), 0);
    assert.equal(playbackStartTime(mapping, 0.4975, 4), 0);
    assert.equal(playbackStartTime(mapping, 0.49, 4), 3.92);
    assert.equal(playbackStartTime(mapping, 0.5, 0), 4);
});

test('loopRestartTime seeks back to the loop start once playback reaches the loop end', () => {
    const loop = { start: 0.125, end: 0.25 };
    assert.equal(loopRestartTime(mapping, 1.5, loop), null);
    assert.equal(loopRestartTime(mapping, 2, loop), 1);
    assert.equal(loopRestartTime(mapping, 2, null), null);
    assert.equal(loopRestartTime(null, 2, loop), null);
});

test('playbackEndFade measures the distance to the loop end or the track end', () => {
    assert.deepEqual(playbackEndFade(mapping, 1.5, { start: 0.125, end: 0.25 }, 4), { remaining: 0.5, fadeSeconds: 0.1 });
    assert.deepEqual(playbackEndFade(mapping, 3, null, 4), { remaining: 1, fadeSeconds: 0.1 });
    const shortLoop = playbackEndFade(mapping, 1, { start: 0.125, end: 0.13 }, 4);
    assert.ok(shortLoop && Math.abs(shortLoop.fadeSeconds - 0.02) < 1e-9);
    assert.deepEqual(playbackEndFade(mapping, 3, { start: 0.6, end: 0.8 }, 4), { remaining: 1, fadeSeconds: 0.1 });
    assert.equal(playbackEndFade(mapping, 0, null, 0), null);
});
