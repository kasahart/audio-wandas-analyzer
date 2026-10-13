import type { TrackId } from './types';

type AudioEventTarget = Pick<HTMLAudioElement, 'addEventListener' | 'ended'>;

export interface TrackAudioHandlers<A extends AudioEventTarget> {
    isCurrent(trackId: TrackId): boolean;
    onPlay(audio: A, trackId: TrackId): void;
    onPause(trackId: TrackId, ended: boolean): void;
    onEnded(trackId: TrackId): void;
    onError(trackId: TrackId): void;
}

export function attachTrackAudioListeners<A extends AudioEventTarget>(audio: A, trackId: TrackId, handlers: TrackAudioHandlers<A>): void {
    audio.addEventListener('play', function () {
        handlers.onPlay(audio, trackId);
    });
    audio.addEventListener('pause', function () {
        if (handlers.isCurrent(trackId)) {
            handlers.onPause(trackId, audio.ended);
        }
    });
    audio.addEventListener('ended', function () {
        if (handlers.isCurrent(trackId)) {
            handlers.onEnded(trackId);
        }
    });
    audio.addEventListener('error', function () {
        if (handlers.isCurrent(trackId)) {
            handlers.onError(trackId);
        }
    });
}
