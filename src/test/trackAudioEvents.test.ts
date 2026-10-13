import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachTrackAudioListeners } from '../webview/runtime/trackAudioEvents';
import type { TrackId } from '../webview/runtime/types';

test('attachTrackAudioListeners forwards play always and pause/ended/error only for the current track', () => {
    const { window } = new JSDOM('<!doctype html><body><audio></audio></body>');
    const audio = window.document.querySelector('audio') as unknown as HTMLAudioElement;
    const trackId = 'track-a' as TrackId;
    let current: TrackId | null = null;
    const calls: string[] = [];
    attachTrackAudioListeners(audio, trackId, {
        isCurrent: (id) => current === id,
        onPlay: (el, id) => { calls.push(`play:${id}:${el === audio}`); },
        onPause: (id, ended) => { calls.push(`pause:${id}:${ended}`); },
        onEnded: (id) => { calls.push(`ended:${id}`); },
        onError: (id) => { calls.push(`error:${id}`); },
    });
    const fire = (type: string) => audio.dispatchEvent(new window.Event(type));
    fire('pause');
    fire('ended');
    fire('error');
    fire('play');
    current = trackId;
    fire('pause');
    fire('ended');
    fire('error');
    assert.deepEqual(calls, ['play:track-a:true', 'pause:track-a:false', 'ended:track-a', 'error:track-a']);
});
