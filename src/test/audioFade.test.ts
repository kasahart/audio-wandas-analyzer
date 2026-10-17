import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineRampValues, createAudioFader, fadeSecondsForSpan, rampValueAt, type FadeContext } from '../webview/runtime/audioFade';

function fakeParam() {
    const events: Array<[string, number, number?]> = [];
    return {
        value: 1,
        events,
        cancelScheduledValues(time: number) { events.push(['cancel', time]); return this as unknown as AudioParam; },
        setValueAtTime(value: number, time: number) { events.push(['set', value, time]); return this as unknown as AudioParam; },
        linearRampToValueAtTime(value: number, time: number) { events.push(['ramp', value, time]); return this as unknown as AudioParam; },
    };
}

function fakeContext() {
    const gains: Array<ReturnType<typeof fakeParam>> = [];
    const ctx: FadeContext = {
        currentTime: 2,
        state: 'running',
        destination: {},
        resume: async () => undefined,
        createGain() {
            const gain = fakeParam();
            gains.push(gain);
            return { gain, connect: () => undefined };
        },
        createMediaElementSource: () => ({ connect: () => undefined }),
    };
    return { ctx, gains };
}

function fakeMedia(muted = false) {
    return { muted, paused: false, pauseCount: 0, pause() { this.paused = true; this.pauseCount++; } };
}

test('cosineRampValues follows a raised-cosine from the start to the target value', () => {
    const values = cosineRampValues(1, 0, 4);
    assert.equal(values.length, 4);
    assert.ok(Math.abs(values[1] - 0.5) < 1e-12);
    assert.equal(values[3], 0);
    assert.ok(values[0] > values[1] && values[1] > values[2]);
});

test('fadeSecondsForSpan uses 0.1 s and halves spans shorter than 0.2 s', () => {
    assert.equal(fadeSecondsForSpan(5), 0.1);
    assert.equal(fadeSecondsForSpan(0.08), 0.04);
    assert.equal(fadeSecondsForSpan(-1), 0);
});

test('pauseSmoothly fades the gain out and pauses only after the fade', () => {
    const { ctx, gains } = fakeContext();
    let scheduled: (() => void) | null = null;
    const fader = createAudioFader(() => ctx, fn => { scheduled = fn; return 1; }, () => undefined);
    const media = fakeMedia();
    assert.equal(fader.prepare(media), true);
    let stopped = 0;
    fader.pauseSmoothly(media, () => stopped++);
    fader.pauseSmoothly(media, () => stopped++);
    assert.equal(media.pauseCount, 0);
    assert.equal(fader.isPausing(media), true);
    const fade = gains[0].events;
    assert.deepEqual(fade.slice(0, 2), [['cancel', 2], ['set', 1, 2]]);
    assert.deepEqual(fade.at(-1), ['ramp', 0, 2.1]);
    scheduled!();
    assert.equal(media.pauseCount, 1);
    assert.equal(stopped, 2);
    assert.equal(fader.isPausing(media), false);
});

test('fading back in cancels a pending pause', () => {
    const { ctx } = fakeContext();
    let cancelled = 0;
    const fader = createAudioFader(() => ctx, () => 7, () => cancelled++);
    const media = fakeMedia();
    fader.prepare(media);
    fader.pauseSmoothly(media);
    fader.fadeTo(media, 1, 0.1);
    assert.equal(cancelled, 1);
    assert.equal(fader.isPausing(media), false);
});

test('restarting at zero gain during a fade-out keeps the element playing', () => {
    const { ctx } = fakeContext();
    let scheduled: (() => void) | null = null;
    const fader = createAudioFader(() => ctx, fn => { scheduled = fn; return 1; }, () => { scheduled = null; });
    const media = fakeMedia();
    fader.prepare(media);
    let stopped = 0;
    fader.pauseSmoothly(media, () => stopped++);
    fader.fadeTo(media, 0, 0);
    assert.equal(fader.isPausing(media), false);
    assert.equal(scheduled, null);
    assert.equal(media.pauseCount, 0);
    assert.equal(stopped, 0);
});

test('rampValueAt follows the scheduled piecewise-linear cosine', () => {
    const ramp = { from: 1, to: 0, start: 2, seconds: 0.1 };
    assert.equal(rampValueAt(ramp, 1.9), 1);
    assert.ok(Math.abs(rampValueAt(ramp, 2.05) - 0.5) < 1e-9);
    assert.equal(rampValueAt(ramp, 2.2), 0);
    assert.equal(rampValueAt({ ...ramp, seconds: 0 }, 2), 0);
});

test('a ramp starts from the gain the previous automation left, not the intrinsic value', () => {
    const { ctx, gains } = fakeContext();
    const fader = createAudioFader(() => ctx);
    const media = fakeMedia();
    fader.prepare(media);
    fader.fadeTo(media, 0, 0);
    fader.fadeTo(media, 1, 0.1);
    const fade = gains[0].events;
    assert.equal(gains[0].value, 1);
    assert.deepEqual(fade.slice(-18, -16), [['cancel', 2], ['set', 0, 2]]);
    assert.ok((fade.at(-16)?.[1] ?? 1) < 0.01);
    assert.deepEqual(fade.at(-1), ['ramp', 1, 2.1]);
});

test('pauseSmoothly shortens the fade and the pause delay to the given span', () => {
    const { ctx, gains } = fakeContext();
    let delay = -1;
    const fader = createAudioFader(() => ctx, (_fn, ms) => { delay = ms; return 1; }, () => undefined);
    const media = fakeMedia();
    fader.prepare(media);
    fader.pauseSmoothly(media, undefined, 0.03);
    assert.equal(delay, 30);
    assert.deepEqual(gains[0].events.at(-1), ['ramp', 0, 2.03]);
    const other = fakeMedia();
    fader.prepare(other);
    fader.pauseSmoothly(other, undefined, 0);
    assert.equal(other.pauseCount, 1);
});

test('without Web Audio the element pauses and mutes immediately', () => {
    const fader = createAudioFader(() => null);
    const media = fakeMedia();
    assert.equal(fader.prepare(media), false);
    let stopped = 0;
    fader.pauseSmoothly(media, () => stopped++);
    assert.equal(media.pauseCount, 1);
    assert.equal(stopped, 1);
    fader.setMuted(media, true);
    assert.equal(media.muted, true);
});

test('a routed element ramps its mute gain and flips the element flag once silent', () => {
    const { ctx, gains } = fakeContext();
    let scheduled: (() => void) | null = null;
    const fader = createAudioFader(() => ctx, fn => { scheduled = fn; return 1; }, () => undefined);
    const media = fakeMedia(true);
    fader.prepare(media);
    assert.equal(gains[1].value, 0);
    gains[1].value = 0;
    fader.setMuted(media, false);
    assert.equal(media.muted, false);
    assert.deepEqual(gains[1].events.at(-1), ['ramp', 1, 2.1]);
    gains[1].value = 1;
    fader.setMuted(media, true);
    assert.deepEqual(gains[1].events.at(-1), ['ramp', 0, 2.1]);
    assert.equal(media.muted, false);
    scheduled!();
    assert.equal(media.muted, true);
});
