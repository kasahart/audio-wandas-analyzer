import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { createDetailPlanner, DETAIL_SETTLE_MS, detailRangeKey, onOneRange } from '../webview/runtime/stageDetail';
import { createStageSource, stageCacheKey } from '../webview/runtime/stageSource';

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
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.55, end: 0.65 }), [second, first]);
    // Off the first range, only the second can draw the view.
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.75, end: 0.85 }), [second]);
});

test('a zoom in waits to settle, drawing the detail fetched before (finer than the whole picture) meanwhile', () => {
    const { detail, advance } = planner();
    advance(DETAIL_SETTLE_MS);
    const wide = detail.spec(base, timeLine, { start: 0.4, end: 0.5 }, null, WIDTH)!;
    detail.moved();
    assert.equal(detail.spec(base, timeLine, { start: 0.44, end: 0.46 }, null, WIDTH), null);
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.44, end: 0.46 }), [wide]);
    advance(DETAIL_SETTLE_MS);
    const narrow = detail.spec(base, timeLine, { start: 0.44, end: 0.46 }, null, WIDTH)!;
    // The finest first.
    assert.deepEqual(detail.drawn(base, timeLine, { start: 0.44, end: 0.46 }), [narrow, wide]);
});

test('other pictures keep the view\'s own range with a 5 % margin, and draw nothing else', () => {
    const { detail, advance } = planner();
    advance(DETAIL_SETTLE_MS);
    const spec = detail.spec(base, spectrum, { start: 0.4, end: 0.5 }, null, WIDTH)!;
    const [from, to] = spec.message.detail!.x;
    assert.ok(Math.abs(from - 39.5) < 1e-9 && Math.abs(to - 50.5) < 1e-9, `${from}–${to}`);
    assert.equal(spec.message.detail!.points, 2 * WIDTH);
    assert.deepEqual(detail.drawn(base, spectrum, { start: 0.4, end: 0.5 }), []);
});

test('a median or a difference takes every member over one range: the newest range all have, else none', () => {
    const at = (x: number[]) => ({ key: `detail|${x.join(',')}`, message: { stage: 'step', detail: { x, points: 10 } } });
    const older = at([20, 70]), newer = at([35, 85]);
    const view = (tag: string): StageView => ({ ...timeLine, frame: tag });
    // The compared file has the newer range in already, the base only the older one.
    const have: Record<string, Map<string, StageView>> = {
        compare: new Map([[newer.key, view('compare-newer')], [older.key, view('compare-older')]]),
        base: new Map([[older.key, view('base-older')]]),
    };
    const read = (spec: { key: string }, member: string) => have[member].get(spec.key);
    const both = onOneRange(['compare', 'base'], () => [newer, older], read)!;
    assert.deepEqual([both.get('compare')!.frame, both.get('base')!.frame], ['compare-older', 'base-older']);
    have.base.set(newer.key, view('base-newer'));
    const updated = onOneRange(['compare', 'base'], () => [newer, older], read)!;
    assert.deepEqual([updated.get('compare')!.frame, updated.get('base')!.frame], ['compare-newer', 'base-newer']);
    assert.equal(onOneRange(['compare', 'base'], () => [newer], (spec, member) => (member === 'base' ? undefined : read(spec, member))), null);
});

// An hour at 48 kHz, zoomed in deep: two windows a few samples apart (well under six significant figures of the
// axis) are different requests, so neither's detail may be kept or drawn for the other.
const hour: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 3600], values: [0, 0] };
const spectrumOfHour: StageView = { ...spectrum, xs: [0, 3600] };
const sample = 1 / 48000 / 3600;

test('a detail\'s key is the range asked for exactly as it is sent: two deep windows a few samples apart never share one', () => {
    for (const coarse of [hour, spectrumOfHour]) {
        const { detail, advance } = planner();
        advance(DETAIL_SETTLE_MS);
        const at = 0.5;
        const first = detail.spec(base, coarse, { start: at, end: at + 20 * sample }, null, WIDTH)!;
        // Far enough along (a pan, or a new zoom) that the planner asks again.
        detail.moved();
        advance(DETAIL_SETTLE_MS);
        const second = detail.spec(base, coarse, { start: at + 200 * sample, end: at + 220 * sample }, null, WIDTH)!;
        assert.notDeepEqual(second.message.detail!.x, first.message.detail!.x, 'the two windows ask for different samples');
        assert.notEqual(second.key, first.key, `${coarse.frame}: a different range is a different key`);
        assert.notEqual(detailRangeKey(second), detailRangeKey(first));
        // The key names the request: its every number reads back to the one sent.
        for (const spec of [first, second]) {
            const sent = spec.message.detail!;
            const range = spec.key.split('|')[2].split(',').map(Number);
            assert.deepEqual(range, [...sent.x, ...(sent.y ?? [])]);
            assert.equal(Number(spec.key.split('|')[3]), sent.points);
        }
    }
});

test('pictures are cached under the range sent, so a spec whose key matches another\'s never takes its detail', () => {
    const posted: Array<{ requestId?: string; detail?: unknown }> = [];
    const stages = createStageSource('compare', message => posted.push(message), () => undefined);
    const ask = (from: number) => ({ key: 'same', message: { stage: 'step', detail: { x: [1800 + from, 1800 + from + 1e-3], points: 1000 } } });
    const one = ask(0), other = ask(1e-4);
    assert.notEqual(stageCacheKey(one), stageCacheKey(other));
    const stage = (marker: number): StageView => ({ ...hour, xs: [marker], values: [marker], detail: true });
    assert.equal(stages.ensure(one, ['/a.wav']), true);
    stages.handle({ type: 'compare-scan-result', requestId: posted[0].requestId, filePath: '/a.wav', result: { ok: true, stage: stage(1) } } as { type: string });
    stages.handle({ type: 'compare-scan-done', requestId: posted[0].requestId } as { type: string });
    assert.equal(stages.view(other, '/a.wav'), undefined, 'the other window is not in yet');
    assert.equal(stages.ensure(other, ['/a.wav']), true, 'the other window is asked for');
    assert.deepEqual(posted[1].detail, other.message.detail);
    stages.handle({ type: 'compare-scan-result', requestId: posted[1].requestId, filePath: '/a.wav', result: { ok: true, stage: stage(2) } } as { type: string });
    assert.deepEqual(stages.view(one, '/a.wav')?.values, [1]);
    assert.deepEqual(stages.view(other, '/a.wav')?.values, [2]);
});
