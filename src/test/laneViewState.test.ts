import assert from 'node:assert/strict';
import test from 'node:test';
import { LaneViewState } from '../webview/runtime/laneViewState';
import type { LoopRegion } from '../webview/runtime/types';

function setup() {
    const calls: string[] = [];
    const view = new LaneViewState({
        scheduleRender: () => { calls.push('render'); },
        showTime: norm => { calls.push('time ' + norm); },
        loopChanged: (region: LoopRegion | null) => { calls.push('loop ' + (region ? region.start + '-' + region.end : 'none')); },
    });
    return { view, calls };
}

test('LaneViewState starts with the cursor at the start, no hover and no loop', () => {
    const { view, calls } = setup();
    assert.equal(view.cursor, 0);
    assert.equal(view.hover, null);
    assert.equal(view.loop, null);
    assert.deepEqual(calls, []);
});

test('the cursor is clamped to the tracks, shown and redrawn', () => {
    const { view, calls } = setup();
    view.setCursor(1.5);
    assert.equal(view.cursor, 1);
    view.setCursor(-0.2);
    assert.equal(view.cursor, 0);
    view.setCursor(0.25);
    assert.deepEqual(calls, ['time 1', 'render', 'time 0', 'render', 'time 0.25', 'render']);
});

test('the hover shows its own time and clearing it shows the cursor again', () => {
    const { view, calls } = setup();
    view.setCursor(0.25);
    calls.length = 0;
    view.setHover(0.5);
    assert.equal(view.hover, 0.5);
    assert.equal(view.clearHover(), true);
    assert.equal(view.hover, null);
    assert.equal(view.clearHover(), false, 'nothing to clear the second time');
    assert.deepEqual(calls, ['render', 'time 0.5', 'render', 'time 0.25']);
});

test('the loop region is reported and redrawn whether set or cleared', () => {
    const { view, calls } = setup();
    view.setLoop({ start: 0.1, end: 0.4 });
    assert.deepEqual(view.loop, { start: 0.1, end: 0.4 });
    view.setLoop(null);
    assert.equal(view.loop, null);
    assert.deepEqual(calls, ['loop 0.1-0.4', 'render', 'loop none', 'render']);
});
