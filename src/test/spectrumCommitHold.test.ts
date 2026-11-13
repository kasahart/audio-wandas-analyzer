import assert from 'node:assert/strict';
import test from 'node:test';
import { ShownSpectrumCursor, SPECTRUM_COMMIT_HOLD_MS, SpectrumCommitHold } from '../webview/runtime/spectrumCommitHold';

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
    assert.equal(h.hold.holds(false, 1), false);
    assert.equal(h.hold.holds(true, 1), true);
    h.advance(300);
    assert.equal(h.hold.holds(true, 1), true);
    assert.equal(h.hold.holds(false, 1), false);
    assert.equal(h.timers, 0, 'no repaint is left scheduled once everything arrived');
    assert.equal(h.expired, 0);
});

test('a slow answer holds the picture back no longer than the cap, then asks for a repaint', () => {
    const h = harness();
    assert.equal(h.hold.holds(true, 1), true);
    h.advance(SPECTRUM_COMMIT_HOLD_MS);
    assert.equal(h.expired, 1);
    assert.equal(h.hold.holds(true, 1), false);
    // A new action starts a new hold only after the previous one has fully arrived.
    assert.equal(h.hold.holds(false, 1), false);
    assert.equal(h.hold.holds(true, 1), true);
});

test('a new action while an older one is still arriving starts its own full hold', () => {
    const h = harness();
    assert.equal(h.hold.holds(true, 1), true);
    h.advance(800);
    // The cursor moved again: its answers get the whole cap, not what was left of the first click's.
    assert.equal(h.hold.holds(true, 2), true);
    h.advance(400);
    assert.equal(h.expired, 0, 'the first click\'s timer was dropped');
    assert.equal(h.hold.holds(true, 2), true);
    h.advance(600);
    assert.equal(h.expired, 1);
    assert.equal(h.hold.holds(true, 2), false);
});

test('while the last cursor spectrum is kept its header names that picture\'s time; once drawn again, the new cursor\'s', () => {
    const shown = new ShownSpectrumCursor();
    assert.equal(shown.at(0.5), 0.5, 'nothing drawn yet: the cursor');
    shown.keep();
    assert.equal(shown.at(0.5), 0.5, 'nothing to keep');
    shown.drawn(0.2);
    shown.keep();
    assert.equal(shown.at(0.7), 0.2, 'kept: the picture\'s time, never the new cursor beside the old lines');
    assert.ok(shown.kept());
    shown.drawn(0.7);
    assert.equal(shown.at(0.7), 0.7);
    assert.ok(!shown.kept());
});

test('the cursor spectrum\'s header takes its time from the picture it heads', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const source = readFileSync(path.resolve(__dirname, '..', '..', 'src', 'webview', 'runtime', 'comparisonRuntime.ts'), 'utf8');
    // Every early return that keeps the picture says so, and the header's time goes through the shown cursor.
    assert.match(source, /shownSpectrumCursor\.keep\(\);\s*return;/);
    assert.doesNotMatch(source, /'@ ' \+ formatClockTime\(gs\.startSec \+ spectrumCursorNorm/);
});
