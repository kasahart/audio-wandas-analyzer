import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECTRUM_COMMIT_HOLD_MS, SpectrumCommitHold } from '../webview/runtime/spectrumCommitHold';

function harness() {
    let now = 0;
    let expired = 0;
    const timers = new Map<number, { at: number; handler: () => void }>();
    let nextId = 1;
    const hold = new SpectrumCommitHold({
        now: () => now,
        setTimeout: (handler, ms) => { timers.set(nextId, { at: now + ms, handler }); return nextId++; },
        clearTimeout: (id) => { timers.delete(id); },
        onExpired: () => { expired += 1; },
    });
    return {
        hold,
        advance(ms: number) {
            now += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= now) { timers.delete(id); timer.handler(); }
            }
        },
        get expired() { return expired; },
        get timers() { return timers.size; },
    };
}

test('holds the last picture while answers are on their way, and lets go once none is', () => {
    const h = harness();
    assert.equal(h.hold.holds(false), false);
    assert.equal(h.hold.holds(true), true);
    h.advance(300);
    assert.equal(h.hold.holds(true), true);
    assert.equal(h.hold.holds(false), false);
    assert.equal(h.timers, 0, 'no repaint is left scheduled once everything arrived');
    assert.equal(h.expired, 0);
});

test('a slow answer holds the picture back no longer than the cap, then asks for a repaint', () => {
    const h = harness();
    assert.equal(h.hold.holds(true), true);
    h.advance(SPECTRUM_COMMIT_HOLD_MS);
    assert.equal(h.expired, 1);
    assert.equal(h.hold.holds(true), false);
    // A new action starts a new hold only after the previous one has fully arrived.
    assert.equal(h.hold.holds(false), false);
    assert.equal(h.hold.holds(true), true);
});
