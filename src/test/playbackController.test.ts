import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioFader } from '../webview/runtime/audioFade';
import { createTrackTimeMapping } from '../webview/runtime/playback';
import { PlaybackController, type PlaybackChange, type PlaybackControllerDeps } from '../webview/runtime/playbackController';
import type { LoopRegion, TrackId } from '../webview/runtime/types';

class FakeAudio {
    paused = true;
    ended = false;
    currentTime = 0;
    duration = 10;
    playResult: Promise<void> = Promise.resolve();
    private readonly listeners = new Map<string, Array<() => void>>();
    addEventListener(type: string, listener: () => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string): void {
        (this.listeners.get(type) ?? []).forEach(listener => listener());
    }
    play(): Promise<void> {
        this.paused = false;
        return this.playResult;
    }
    pause(): void {
        this.paused = true;
    }
}

function fakeFader(): AudioFader & { fades: Array<[number, number]>; muted: boolean[] } {
    const fades: Array<[number, number]> = [];
    const muted: boolean[] = [];
    return {
        fades,
        muted,
        prepare: () => true,
        fadeTo: (_el, value, seconds) => { fades.push([value, seconds]); },
        pauseSmoothly: (el, after) => { el.pause(); after?.(); },
        isPausing: () => false,
        setMuted: (_el, value) => { muted.push(value); },
        release: () => undefined,
        contextState: () => null,
    };
}

const A = 'track-a' as TrackId;
const B = 'track-b' as TrackId;

function setup(options: { loop?: LoopRegion | null } = {}) {
    const audios = [new FakeAudio(), new FakeAudio()];
    const frames = new Map<number, () => void>();
    let frameId = 0;
    const calls: string[] = [];
    const changes: PlaybackChange[] = [];
    const cursor = { norm: 0.2 };
    const fader = fakeFader();
    const centered: number[] = [];
    // Both tracks span the whole 10 s timeline.
    const mapping = createTrackTimeMapping(10, 0, { startSeconds: 0, spanSeconds: 10 });
    const deps: PlaybackControllerDeps = {
        fader,
        audioFor: idx => (audios[idx] as unknown as HTMLAudioElement) ?? null,
        indexOf: id => (id === A ? 0 : id === B ? 1 : null),
        requireIndex: id => (id === A ? 0 : 1),
        timeMapping: () => mapping,
        globalNormAt: (_idx, seconds) => seconds / 10,
        durationSeconds: () => 10,
        loopRegion: () => options.loop ?? null,
        cursorNorm: () => cursor.norm,
        moveCursor: (norm, playing) => { cursor.norm = norm; calls.push('cursor ' + norm.toFixed(2) + (playing ? ' playing' : '')); },
        centerOn: norm => { centered.push(norm); },
        invalidateSpectrumRequests: () => { calls.push('invalidate'); },
        scheduleRender: () => { calls.push('render'); },
        refreshSpectrum: mode => { calls.push('spectrum ' + mode); },
        showTime: seconds => { calls.push('time ' + (seconds === null ? '-' : seconds.toFixed(1))); },
        syncLoopBadge: () => { calls.push('badge'); },
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => { frames.delete(id); },
    };
    const playback = new PlaybackController(deps);
    playback.onChange(change => changes.push(change));
    const runFrame = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(frame => frame());
    };
    return { playback, audios, frames, runFrame, calls, changes, cursor, fader, centered };
}

test('PlaybackController starts at the cursor and announces the change', () => {
    const { playback, audios, calls, changes } = setup();
    playback.toggle(A);
    assert.equal(audios[0].currentTime, 2);
    assert.equal(audios[0].paused, false);
    assert.equal(playback.trackId, A);
    assert.equal(playback.isRunning(), true);
    assert.equal(playback.playingTrackId(), A);
    assert.equal(playback.isActive(A), true);
    assert.equal(playback.isActive(B), false);
    assert.deepEqual(changes, ['playback']);
    assert.deepEqual(calls, ['invalidate', 'cursor 0.20', 'render', 'spectrum immediate']);
});

test('PlaybackController starts at the loop region rather than the cursor', () => {
    const { playback, audios } = setup({ loop: { start: 0.5, end: 0.8 } });
    playback.toggle(A);
    assert.equal(audios[0].currentTime, 5);
});

test('each playback frame moves the cursor as playing and keeps the view on it while following', () => {
    const { playback, audios, runFrame, calls, centered } = setup();
    playback.toggle(A);
    calls.length = 0;
    audios[0].currentTime = 3;
    runFrame();
    assert.deepEqual(calls, ['cursor 0.30 playing', 'render', 'spectrum playback', 'time 3.0', 'badge']);
    assert.deepEqual(centered, []);
    assert.equal(playback.setFollow(true), true);
    assert.equal(playback.setFollow(true), false);
    audios[0].currentTime = 4;
    runFrame();
    assert.deepEqual(centered, [0.4]);
});

test('toggling the playing track pauses it and leaves the cursor where it stopped', () => {
    const { playback, audios, frames, cursor, changes } = setup();
    playback.toggle(A);
    audios[0].currentTime = 6;
    playback.toggle(A);
    assert.equal(audios[0].paused, true);
    assert.equal(cursor.norm, 0.6);
    assert.equal(playback.isRunning(), false);
    assert.equal(playback.playingTrackId(), null);
    // The paused track keeps the element (its ■ stays enabled) and the frame loop stops.
    assert.equal(playback.isActive(A), true);
    assert.equal(frames.size, 0);
    assert.deepEqual(changes, ['playback', 'playback']);
});

test('stop puts the cursor back where playback started and clears the track', () => {
    const { playback, audios, cursor, calls } = setup();
    playback.toggle(A);
    audios[0].currentTime = 7;
    cursor.norm = 0.7;
    calls.length = 0;
    playback.stop(A);
    assert.equal(cursor.norm, 0.2);
    assert.equal(audios[0].currentTime, 0);
    assert.equal(playback.trackId, null);
    assert.equal(playback.isActive(A), false);
    assert.deepEqual(calls, ['cursor 0.20', 'invalidate', 'badge', 'time -', 'render', 'render', 'spectrum immediate']);
});

test('switching tracks stops the first one at its start position', () => {
    const { playback, audios, cursor } = setup();
    playback.toggle(A);
    cursor.norm = 0.9;
    playback.toggle(B);
    assert.equal(audios[0].paused, true);
    assert.equal(audios[0].currentTime, 0);
    assert.equal(playback.trackId, B);
    // B starts from where A started, not from where A's cursor had got to.
    assert.equal(audios[1].currentTime, 2);
});

test('the end of the track leaves the cursor at its end', () => {
    const { playback, audios, cursor } = setup();
    playback.attachAudio(audios[0] as unknown as HTMLAudioElement, A, 0);
    playback.toggle(A);
    audios[0].paused = true;
    audios[0].ended = true;
    audios[0].emit('pause');
    assert.equal(cursor.norm, 1);
    assert.equal(playback.trackId, null);
});

test('an element started outside the controller becomes the current track', () => {
    const { playback, audios, changes } = setup();
    playback.attachAudio(audios[1] as unknown as HTMLAudioElement, B, 1);
    audios[1].paused = false;
    audios[1].emit('play');
    assert.equal(playback.trackId, B);
    assert.equal(playback.isRunning(), true);
    assert.deepEqual(changes, ['playback']);
});

test('a refused play is recorded and clears the playback', async () => {
    const { playback, audios } = setup();
    audios[0].playResult = Promise.reject(new Error('blocked'));
    playback.toggle(A);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(playback.lastPlayRejection, 'Error: blocked');
    assert.equal(playback.trackId, null);
});

test('setMuted mutes the track element through the fader', () => {
    const { playback, fader } = setup();
    playback.setMuted(0, true);
    playback.setMuted(5, false);
    assert.deepEqual(fader.muted, [true]);
});

test('follow changes are announced once per change', () => {
    const { playback, changes } = setup();
    playback.setFollow(false);
    playback.setFollow(true);
    playback.setFollow(false);
    assert.deepEqual(changes, ['follow', 'follow']);
    assert.equal(playback.follow, false);
});
