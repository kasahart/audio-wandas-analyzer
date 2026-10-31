import { FADE_SECONDS, type AudioFader } from './audioFade';
import { loopRestartTime, passFadeSeconds, playbackEndFade, playbackStartTime, type TrackTimeMapping } from './playback';
import { attachTrackAudioListeners } from './trackAudioEvents';
import type { LoopRegion, TrackId } from './types';

// Queuing the end fade further ahead would let a media stall silence the track before it reaches the end.
const END_FADE_LOOKAHEAD_SECONDS = 0.25;

/** 'playback': the track playing, or whether it runs, changed; 'follow': the view's following of the cursor did. */
export type PlaybackChange = 'playback' | 'follow';

export interface PlaybackControllerDeps {
    fader: AudioFader;
    audioFor(trackIndex: number): HTMLAudioElement | null;
    /** The protocol index of an active track; null once it is gone. */
    indexOf(trackId: TrackId): number | null;
    /** As `indexOf`, for a track that must be active. */
    requireIndex(trackId: TrackId): number;
    timeMapping(trackIndex: number): TrackTimeMapping | null;
    globalNormAt(trackIndex: number, seconds: number): number | null;
    /** The analysed duration of a track (0 when unknown). */
    durationSeconds(trackIndex: number): number;
    loopRegion(): LoopRegion | null;
    cursorNorm(): number;
    moveCursor(norm: number, playing?: boolean): void;
    /** Keeps the visible window on the cursor while the view follows it. */
    centerOn(norm: number): void;
    invalidateSpectrumRequests(): void;
    scheduleRender(): void;
    refreshSpectrum(mode: 'immediate' | 'playback'): void;
    /** The playing time readout; null while nothing plays. */
    showTime(seconds: number | null): void;
    /** Every playback frame and on clearing: the loop badge follows whether the loop plays. */
    syncLoopBadge(): void;
    requestAnimationFrame(callback: () => void): number;
    cancelAnimationFrame(id: number): void;
}

/** One track plays at a time: its element, the fades around starts, loops and ends, and the cursor following it. */
export class PlaybackController {
    private element: HTMLAudioElement | null = null;
    private current: TrackId | null = null;
    private rafId: number | null = null;
    private endFadeTarget: number | null = null;
    private passFade = FADE_SECONDS;
    /** Where the last start began (the loop's start, or the cursor): a stop goes back there. */
    private startNorm = 0;
    private following = false;
    private rejection: string | null = null;
    private readonly listeners = new Set<(change: PlaybackChange) => void>();

    constructor(private readonly deps: PlaybackControllerDeps) {}

    get trackId(): TrackId | null {
        return this.current;
    }

    get follow(): boolean {
        return this.following;
    }

    /** Why the browser last refused to play (tests read it). */
    get lastPlayRejection(): string | null {
        return this.rejection;
    }

    /** The track holds the playback element, running or paused. */
    isActive(trackId: TrackId): boolean {
        return this.current === trackId && this.element !== null;
    }

    /** Audible: neither paused nor fading out to a pause. */
    isRunning(): boolean {
        return this.element !== null && !this.element.paused && !this.deps.fader.isPausing(this.element);
    }

    playingTrackId(): TrackId | null {
        return this.current !== null && this.element && this.isRunning() ? this.current : null;
    }

    isElementPlaying(): boolean {
        return this.element !== null && !this.element.paused;
    }

    onChange(listener: (change: PlaybackChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Returns whether it changed. */
    setFollow(next: boolean): boolean {
        if (this.following === next) {
            return false;
        }
        this.following = next;
        this.notify('follow');
        return true;
    }

    setMuted(trackIndex: number, muted: boolean): void {
        const audio = this.deps.audioFor(trackIndex);
        if (audio) this.deps.fader.setMuted(audio, muted);
    }

    toggle(trackId: TrackId): void {
        const { deps } = this;
        const fader = deps.fader;
        const idx = deps.requireIndex(trackId);
        const audio = deps.audioFor(idx);
        if (!audio) {
            return;
        }
        if (this.current === trackId && this.element === audio && !audio.paused && !fader.isPausing(audio)) {
            this.pauseSmoothly(audio, () => {
                // Playback runs on through the fade-out, so resume from where it actually stopped.
                const pausedCursor = this.element === audio && audio.paused ? deps.globalNormAt(idx, audio.currentTime) : null;
                if (pausedCursor !== null) {
                    deps.moveCursor(pausedCursor);
                    deps.scheduleRender();
                }
            });
            deps.invalidateSpectrumRequests();
            this.notify('playback');
            this.stopLoop();
            deps.refreshSpectrum('immediate');
            return;
        }
        if (this.current !== null && this.current !== trackId) {
            // The cursor goes back to where the other track started before switching.
            deps.moveCursor(this.startNorm);
            this.stop(this.current, { keepCursor: true });
        }
        if (this.current === trackId && this.element === audio && fader.isPausing(audio)) {
            // Still playing through the pause fade-out: turn the fade around instead of seeking or zeroing the gain.
            this.endFadeTarget = null;
            fader.fadeTo(audio, 1, passFadeSeconds(deps.timeMapping(idx), audio.currentTime, deps.loopRegion(), this.duration(idx)));
            deps.invalidateSpectrumRequests();
            this.notify('playback');
            this.startLoop();
            deps.refreshSpectrum('immediate');
            return;
        }
        this.current = trackId;
        this.element = audio;
        deps.invalidateSpectrumRequests();
        const durationSeconds = audio.duration || deps.durationSeconds(idx);
        const loop = deps.loopRegion();
        const startNorm = loop ? loop.start : deps.cursorNorm();
        const startTime = playbackStartTime(deps.timeMapping(idx), startNorm, durationSeconds);
        try {
            audio.currentTime = startTime;
        }
        catch (_err) { }
        this.startNorm = startNorm;
        fader.prepare(audio);
        fader.fadeTo(audio, 0, 0);
        this.endFadeTarget = null;
        const fadeInSeconds = passFadeSeconds(deps.timeMapping(idx), startTime, loop, durationSeconds);
        this.passFade = fadeInSeconds;
        const fadeIn = () => {
            if (this.element === audio && !fader.isPausing(audio)) {
                fader.fadeTo(audio, 1, fadeInSeconds);
                this.endFadeTarget = null;
            }
        };
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(fadeIn, (err: unknown) => {
                this.rejection = err instanceof Error ? err.name + ': ' + err.message : String(err);
                this.clear();
            });
        }
        else {
            fadeIn();
        }
        const nextCursor = deps.globalNormAt(idx, audio.currentTime);
        if (nextCursor !== null) deps.moveCursor(nextCursor);
        this.notify('playback');
        this.startLoop();
        deps.scheduleRender();
        deps.refreshSpectrum('immediate');
    }

    /** Stops a track (null: whatever element plays); stopping the current one puts the cursor back where it started. */
    stop(trackId: TrackId | null, options: { keepCursor?: boolean } = {}): void {
        const { deps } = this;
        const trackIndex = trackId ? deps.indexOf(trackId) : null;
        const audio = trackIndex === null ? this.element : deps.audioFor(trackIndex);
        if (audio) {
            this.pauseSmoothly(audio, function () {
                try {
                    audio.currentTime = 0;
                }
                catch (_err) { }
            });
        }
        if (trackId === this.current) {
            if (options.keepCursor !== true) deps.moveCursor(this.startNorm);
            deps.invalidateSpectrumRequests();
            this.clear();
            deps.scheduleRender();
            deps.refreshSpectrum('immediate');
            return;
        }
        this.notify('playback');
    }

    /** Nothing plays any more (the element fades out if it still does). */
    clear(): void {
        if (this.element) {
            this.pauseSmoothly(this.element);
        }
        this.element = null;
        this.current = null;
        this.stopLoop();
        this.notify('playback');
        this.deps.syncLoopBadge();
        this.deps.showTime(null);
        this.deps.scheduleRender();
    }

    attachAudio(audio: HTMLAudioElement, trackId: TrackId, trackIndex: number): void {
        const fader = this.deps.fader;
        audio.addEventListener('playing', () => {
            // A stall lets the queued end fade run ahead of the media; restore the gain and queue it again.
            if (this.element === audio && this.endFadeTarget !== null && !fader.isPausing(audio)) {
                fader.fadeTo(audio, 1, this.passFade);
                this.endFadeTarget = null;
            }
        });
        attachTrackAudioListeners(audio, trackId, {
            isCurrent: (id) => this.current === id,
            onPlay: (el, id) => {
                this.element = el;
                this.current = id;
                this.notify('playback');
                this.startLoop();
            },
            onPause: (id, ended) => {
                this.deps.invalidateSpectrumRequests();
                this.notify('playback');
                if (ended) {
                    // 'pause' fires before 'ended' and this clears the current track, so onEnded never runs after it.
                    this.finishAtEnd(trackIndex, id);
                }
            },
            onEnded: (id) => {
                this.finishAtEnd(trackIndex, id);
            },
            onError: () => {
                this.deps.invalidateSpectrumRequests();
                this.clear();
            },
        });
    }

    private notify(change: PlaybackChange): void {
        this.listeners.forEach(listener => listener(change));
    }

    private finishAtEnd(trackIndex: number, trackId: TrackId): void {
        const endNorm = this.deps.globalNormAt(trackIndex, this.deps.durationSeconds(trackIndex));
        if (endNorm !== null) this.deps.moveCursor(endNorm);
        this.stop(trackId, { keepCursor: true });
    }

    private duration(idx: number): number {
        return (this.element && this.element.duration) || this.deps.durationSeconds(idx);
    }

    private startLoop(): void {
        if (this.rafId !== null) {
            return;
        }
        const { deps } = this;
        const fader = deps.fader;
        const tick = () => {
            const playbackTrackIndex = this.current ? deps.indexOf(this.current) : null;
            if (this.element && playbackTrackIndex !== null && !this.element.paused && !fader.isPausing(this.element)) {
                const mapping = deps.timeMapping(playbackTrackIndex);
                const loopStartTime = loopRestartTime(mapping, this.element.currentTime, deps.loopRegion());
                if (loopStartTime !== null) {
                    const fadeInSeconds = passFadeSeconds(mapping, loopStartTime, deps.loopRegion(), this.duration(playbackTrackIndex));
                    this.passFade = fadeInSeconds;
                    this.endFadeTarget = null;
                    try {
                        this.element.currentTime = loopStartTime;
                        this.fadeInOnceSeeked(this.element, fadeInSeconds);
                        deps.invalidateSpectrumRequests();
                    }
                    catch (_err) {
                        fader.fadeTo(this.element, 1, fadeInSeconds);
                    }
                }
                else {
                    this.fadeBeforeEnd(this.element, playbackTrackIndex);
                }
                const nextCursor = deps.globalNormAt(playbackTrackIndex, this.element.currentTime);
                if (nextCursor !== null) {
                    if (this.following) {
                        deps.centerOn(nextCursor);
                    }
                    deps.moveCursor(nextCursor, true);
                    deps.scheduleRender();
                    deps.refreshSpectrum('playback');
                }
                deps.showTime(this.element.currentTime);
            }
            else {
                deps.showTime(null);
            }
            deps.syncLoopBadge();
            this.rafId = deps.requestAnimationFrame(tick);
        };
        this.rafId = deps.requestAnimationFrame(tick);
    }

    private stopLoop(): void {
        if (this.rafId !== null) {
            this.deps.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private pauseSmoothly(audio: HTMLAudioElement, after?: () => void): void {
        const idx = audio === this.element && this.current ? this.deps.indexOf(this.current) : null;
        const fade = idx === null ? null : playbackEndFade(this.deps.timeMapping(idx), audio.currentTime, this.deps.loopRegion(), this.duration(idx));
        // Never fade past the point where the track ends or the loop jumps back.
        this.deps.fader.pauseSmoothly(audio, after, fade ? Math.max(0, Math.min(FADE_SECONDS, fade.remaining)) : FADE_SECONDS);
    }

    private fadeInOnceSeeked(audio: HTMLAudioElement, seconds: number): void {
        // The seek takes effect asynchronously; fading in before it lands would let the old position through.
        audio.addEventListener('seeked', () => {
            if (this.element === audio && !this.deps.fader.isPausing(audio)) {
                this.deps.fader.fadeTo(audio, 1, seconds);
                this.endFadeTarget = null;
            }
        }, { once: true });
    }

    private fadeBeforeEnd(audio: HTMLAudioElement, idx: number): void {
        const fader = this.deps.fader;
        const fade = playbackEndFade(this.deps.timeMapping(idx), audio.currentTime, this.deps.loopRegion(), this.duration(idx));
        if (!fade) {
            return;
        }
        const endTime = audio.currentTime + fade.remaining;
        if (this.endFadeTarget !== null && Math.abs(this.endFadeTarget - endTime) <= 1e-3) {
            return;
        }
        const fadeSeconds = Math.min(fade.fadeSeconds, this.passFade);
        if (this.endFadeTarget !== null && fade.remaining > fadeSeconds) {
            fader.fadeTo(audio, 1, fadeSeconds);
            this.endFadeTarget = null;
        }
        if (fade.remaining > fadeSeconds + END_FADE_LOOKAHEAD_SECONDS) {
            return;
        }
        // Queued on the audio clock so a late animation frame cannot skip the fade.
        fader.fadeTo(audio, 0, Math.max(0, Math.min(fadeSeconds, fade.remaining)), Math.max(0, fade.remaining - fadeSeconds));
        this.endFadeTarget = endTime;
    }
}
