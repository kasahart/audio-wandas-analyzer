import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopAfterDrag, LOOP_GRIP_VIEW_FRACTION, MIN_LOOP_SPAN } from '../webview/screens/loopDrag';

const LOOP = { start: 0.2, end: 0.8 };

test('a drag with no loop there, or begun away from its ends, is a new loop: the stretch between press and release', () => {
    assert.deepEqual(loopAfterDrag(null, 0.3, 0.5, 1), { start: 0.3, end: 0.5 });
    assert.deepEqual(loopAfterDrag(null, 0.5, 0.3, 1), { start: 0.3, end: 0.5 }, 'dragged to the left');
    assert.deepEqual(loopAfterDrag(LOOP, 0.4, 0.6, 1), { start: 0.4, end: 0.6 });
    assert.deepEqual(loopAfterDrag(null, -0.2, 1.4, 1), { start: 0, end: 1 }, 'kept within the whole time');
    assert.equal(loopAfterDrag(null, 0.3, 0.3, 1), null, 'no length: no loop');
});

test('a drag begun on an end of the loop moves that end and keeps the other (screens/loopDrag.ts)', () => {
    assert.deepEqual(loopAfterDrag(LOOP, 0.2, 0.3, 1), { start: 0.3, end: 0.8 }, 'the start dragged in: the end stays');
    assert.deepEqual(loopAfterDrag(LOOP, 0.8, 0.9, 1), { start: 0.2, end: 0.9 }, 'the end dragged out: the start stays');
    assert.deepEqual(loopAfterDrag(LOOP, 0.205, 0.1, 1), { start: 0.1, end: 0.8 }, 'grabbed near the start');
});

test('an end is grabbed within a part of the time on screen, so it is as easy to grab zoomed in', () => {
    const off = 0.2 + LOOP_GRIP_VIEW_FRACTION * 0.5;
    assert.deepEqual(loopAfterDrag(LOOP, off, 0.3, 1), { start: 0.3, end: 0.8 }, 'within reach at the whole view');
    assert.deepEqual(loopAfterDrag(LOOP, off, 0.3, 0.1), { start: off, end: 0.3 }, 'zoomed in tenfold the same place is away from the end: a new loop');
});

test('an end dragged past the other stops short of it: the loop keeps a length', () => {
    assert.deepEqual(loopAfterDrag(LOOP, 0.2, 0.95, 1), { start: 0.8 - MIN_LOOP_SPAN, end: 0.8 });
    assert.deepEqual(loopAfterDrag(LOOP, 0.8, 0.05, 1), { start: 0.2, end: 0.2 + MIN_LOOP_SPAN });
    assert.deepEqual(loopAfterDrag(LOOP, 0.2, -0.5, 1), { start: 0, end: 0.8 });
});
