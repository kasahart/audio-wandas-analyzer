import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { createDetailPlanner, DETAIL_SETTLE_MS } from '../webview/runtime/stageDetail';

const timeLine: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 100], values: [0, 0] };
const spectrum: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [0, 100], values: [0, 0] };
const base = { key: 'run', message: { stage: 'step' } };
const WIDTH = 500;

function planner() {
    let now = 0;
    const timers: Array<() => void> = [];
    const setTimeout = ((fn: () => void) => { timers.push(fn); return timers.length; }) as unknown as Window['setTimeout'];
    const detail = createDetailPlanner({ now: () => now }, { setTimeout }, () => undefined);
    const advance = (ms: number): void => { now += ms; };
    return { detail, advance, timers };
}

test('a line over time is fetched two screens either side of the view, at one screen\'s density', () => {
    const { detail, advance } = planner();
    detail.moved();
    assert.equal(detail.spec(base, timeLine, { start: 0.4, end: 0.5 }, null, WIDTH), null, 'a zoom waits to settle');
    advance(DETAIL_SETTLE_MS);
    const spec = detail.spec(base, timeLine, { start: 0.4, end: 0.5 }, null, WIDTH)!;
    const [from, to] = spec.message.detail!.x;
    assert.ok(Math.abs(from - 20) < 1e-9 && Math.abs(to - 70) < 1e-9, `${from}–${to}`);
    assert.equal(spec.message.detail!.points, 5 * 2 * WIDTH);
});

test('panning keeps the detail fetched while a screen of it is left, then asks again at once, drawing the old one meanwhile', () => {
    const { detail, advance } = planner();
    advance(DETAIL_SETTLE_MS);
    const first = detail.spec(base, timeLine, { start: 0.4, end: 0.5 }, null, WIDTH)!;
    // Half a screen along: more than a screen of it is left on both sides.
    detail.moved();
    assert.equal(detail.spec(base, timeLine, { start: 0.45, end: 0.55 }, null, WIDTH), first);
    // Past the margin, still panning (no settle): a new range around the view...
    detail.moved();
    const second = detail.spec(base, timeLine, { start: 0.55, end: 0.65 }, null, WIDTH)!;
    assert.notEqual(second, first);
    assert.ok(Math.abs(second.message.detail!.x[0] - 35) < 1e-9);
    // ...while the first, which still covers the view, is drawn until it is in.
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.55, end: 0.65 }, WIDTH), [second, first]);
    // Off the first range, only the second can draw the view.
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.75, end: 0.85 }, WIDTH), [second]);
});

test('a zoom past the fetched density waits to settle and does not draw the coarser detail', () => {
    const { detail, advance } = planner();
    advance(DETAIL_SETTLE_MS);
    detail.spec(base, timeLine, { start: 0.4, end: 0.5 }, null, WIDTH);
    detail.moved();
    assert.equal(detail.spec(base, timeLine, { start: 0.44, end: 0.46 }, null, WIDTH), null);
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.44, end: 0.46 }, WIDTH), []);
});

test('other pictures keep the view\'s own range with a 5 % margin, and draw nothing else', () => {
    const { detail, advance } = planner();
    advance(DETAIL_SETTLE_MS);
    const spec = detail.spec(base, spectrum, { start: 0.4, end: 0.5 }, null, WIDTH)!;
    const [from, to] = spec.message.detail!.x;
    assert.ok(Math.abs(from - 39.5) < 1e-9 && Math.abs(to - 50.5) < 1e-9, `${from}–${to}`);
    assert.equal(spec.message.detail!.points, 2 * WIDTH);
    assert.deepEqual(detail.drawn(base, spectrum, { start: 0.4, end: 0.5 }, WIDTH), []);
});
