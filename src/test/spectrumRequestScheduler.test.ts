import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECTRUM_REQUEST_INTERVAL_MS, SpectrumRequestScheduler, type ScheduledSliceRequest } from '../webview/runtime/spectrumRequestScheduler';

interface Request extends ScheduledSliceRequest {
    track: string;
    stale?: boolean;
}

function setup() {
    const clock = { now: 1000 };
    const frames: Array<() => void> = [];
    const timers = new Map<number, () => void>();
    let timerId = 0;
    const sent: string[] = [];
    const refreshes: Array<{ advance: boolean; allows: boolean }> = [];
    const scheduler: SpectrumRequestScheduler<Request> = new SpectrumRequestScheduler<Request>({
        now: () => clock.now,
        setTimeout: (handler) => { timers.set(++timerId, handler); return timerId; },
        clearTimeout: id => { timers.delete(id); },
        requestAnimationFrame: callback => frames.push(callback),
        refresh: advance => { refreshes.push({ advance, allows: scheduler.allowsSliceRequests }); },
        isCurrent: request => !request.stale,
        send: request => { sent.push(request.requestId); },
    });
    const runFrames = () => frames.splice(0).forEach(frame => frame());
    const runTimers = () => {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(timer => timer());
    };
    const request = (track: string, requestId: string, extra: Partial<Request> = {}): Request =>
        ({ track, requestId, generation: scheduler.generation, ...extra });
    return { scheduler, clock, frames, timers, sent, refreshes, runFrames, runTimers, request };
}

test('one slice request is in flight at a time and the next waits for its answer', () => {
    const { scheduler, sent, request } = setup();
    scheduler.want('a', request('a', 'r1'));
    scheduler.want('b', request('b', 'r2'));
    assert.deepEqual(sent, ['r1']);
    assert.equal(scheduler.active?.requestId, 'r1');
    assert.equal(scheduler.desiredCount, 1);
    assert.deepEqual(scheduler.openRequestIds().sort(), ['r1', 'r2']);
    assert.equal(scheduler.settle('other'), null);
    assert.equal(scheduler.settle('r1')?.requestId, 'r1');
    assert.equal(scheduler.active, null);
});

test('requests are paced to one per frame budget, the latest per track winning', () => {
    const { scheduler, clock, sent, timers, runTimers, request } = setup();
    scheduler.want('a', request('a', 'r1'));
    scheduler.settle('r1');
    clock.now += 5;
    scheduler.want('a', request('a', 'r2'));
    scheduler.want('a', request('a', 'r3'));
    assert.deepEqual(sent, ['r1']);
    assert.equal(timers.size, 1, 'a single timer waits out the budget');
    clock.now += SPECTRUM_REQUEST_INTERVAL_MS;
    runTimers();
    assert.deepEqual(sent, ['r1', 'r3']);
});

test('invalidate drops what was wanted, and older generations or stale requests are never sent', () => {
    const { scheduler, clock, sent, timers, request } = setup();
    scheduler.want('a', request('a', 'r1'));
    scheduler.settle('r1');
    scheduler.want('a', request('a', 'r2'));
    assert.equal(timers.size, 1);
    const before = scheduler.generation;
    scheduler.invalidate();
    assert.equal(scheduler.generation, before + 1);
    assert.equal(scheduler.desiredCount, 0);
    assert.equal(timers.size, 0);
    clock.now += 100;
    scheduler.want('a', { track: 'a', requestId: 'old', generation: before });
    scheduler.want('b', request('b', 'stale', { stale: true }));
    scheduler.want('c', request('c', 'r3'));
    assert.deepEqual(sent, ['r1', 'r3']);
});

test('drop and desiredFor address one track', () => {
    const { scheduler, request } = setup();
    scheduler.want('a', request('a', 'r1'));
    scheduler.want('b', request('b', 'r2'));
    assert.equal(scheduler.desiredFor('b')?.requestId, 'r2');
    scheduler.drop('b');
    assert.equal(scheduler.desiredFor('b'), undefined);
    scheduler.abandonActive();
    assert.equal(scheduler.active, null);
});

test('repaints coalesce into one frame and allow slice requests only while they run', () => {
    const { scheduler, frames, refreshes, runFrames } = setup();
    scheduler.scheduleFrame(true, true);
    scheduler.scheduleFrame(true, true);
    assert.equal(frames.length, 1);
    assert.deepEqual(refreshes, []);
    runFrames();
    assert.deepEqual(refreshes, [{ advance: true, allows: true }]);
    scheduler.runFrame(false, false);
    assert.deepEqual(refreshes[1], { advance: false, allows: false });
    assert.equal(scheduler.allowsSliceRequests, true, 'the default is restored after the repaint');
});

test('an immediate repaint leaves the frame already scheduled to run as well', () => {
    const { scheduler, frames, refreshes, runFrames } = setup();
    scheduler.scheduleFrame(false, true);
    scheduler.runFrame(true, true);
    scheduler.scheduleFrame(true, true);
    assert.equal(frames.length, 2);
    runFrames();
    assert.equal(refreshes.length, 3);
});
