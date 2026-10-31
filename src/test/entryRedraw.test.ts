import assert from 'node:assert/strict';
import test from 'node:test';
import { createRedraw, createThrottle } from '../webview/runtime/entryRedraw';

function recorder() {
    const drawn: string[] = [];
    const redraw = createRedraw([['paint', () => drawn.push('paint')], ['compare', () => drawn.push('compare')]] as const);
    return { drawn, redraw };
}

test('outside a batch a part is drawn when it is asked for', () => {
    const { drawn, redraw } = recorder();
    redraw.request('compare');
    redraw.request('paint');
    redraw.after(() => drawn.push('after'));
    assert.deepEqual(drawn, ['compare', 'paint', 'after']);
});

test('a batch draws each part asked for once, in order, at its end, then what waits for it', () => {
    const { drawn, redraw } = recorder();
    const result = redraw.batch(() => {
        redraw.request('compare');
        redraw.after(() => drawn.push('after'));
        redraw.request('paint');
        redraw.batch(() => redraw.request('paint'));
        assert.deepEqual(drawn, [], 'an inner batch joins the outer one');
        return 7;
    });
    assert.equal(result, 7);
    assert.deepEqual(drawn, ['paint', 'compare', 'after']);
});

test('a part asked for while drawing, or by work that waited, is drawn in the same pass; a throw still draws', () => {
    const drawn: string[] = [];
    let again = true;
    const redraw = createRedraw([['paint', () => { drawn.push('paint'); if (again) { again = false; redraw.request('paint'); } }]] as const);
    redraw.batch(() => { redraw.request('paint'); redraw.after(() => { drawn.push('after'); redraw.request('paint'); }); });
    assert.deepEqual(drawn, ['paint', 'paint', 'after', 'paint']);
    assert.throws(() => redraw.batch(() => { redraw.request('paint'); throw new Error('x'); }));
    assert.equal(drawn.length, 5);
});

test('the throttle runs once per interval, waits longer for work that takes long, and can be cancelled', () => {
    let now = 0;
    const timers: Array<{ at: number; run: () => void } | undefined> = [];
    const clock = {
        setTimeout: (run: () => void, wait: number) => timers.push({ at: now + wait, run }),
        clearTimeout: (id: number) => { timers[id - 1] = undefined; },
    } as unknown as Pick<Window, 'setTimeout' | 'clearTimeout'>;
    const tick = (to: number): void => { now = to; timers.forEach((timer, index) => { if (timer && timer.at <= now) { timers[index] = undefined; timer.run(); } }); };
    let runs = 0;
    let takes = 0;
    const throttle = createThrottle(clock, () => now, 250, () => { runs++; now += takes; });
    now = 1000;
    throttle.schedule();
    throttle.schedule();
    assert.equal(timers.filter(Boolean).length, 1);
    tick(1000);
    assert.equal(runs, 1, 'long after the last run, it waits for nothing');
    takes = 100;
    throttle.schedule();
    tick(1249);
    assert.equal(runs, 1);
    tick(1250);
    assert.equal(runs, 2);
    throttle.schedule();
    tick(1600);
    assert.equal(runs, 2, 'work of 100 ms waits 400 ms after it ended');
    tick(1750);
    assert.equal(runs, 3);
    throttle.schedule();
    throttle.cancel();
    tick(9000);
    assert.equal(runs, 3);
});
