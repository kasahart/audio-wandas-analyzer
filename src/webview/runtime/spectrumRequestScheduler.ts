/** A cursor-spectrum slice request waits here until the backend is free; `generation` marks the cursor it was asked at. */
export interface ScheduledSliceRequest {
    requestId: string;
    generation: number;
}

export interface SpectrumRequestSchedulerDeps<R extends ScheduledSliceRequest> {
    now(): number;
    setTimeout(handler: () => void, ms: number): number;
    clearTimeout(id: number): void;
    requestAnimationFrame(callback: () => void): number;
    /** Repaints the spectra; `advanceCursor` moves them to the current cursor first. */
    refresh(advanceCursor: boolean): void;
    /** Whether a request taken from the queue still matches its track, analysis and settings. */
    isCurrent(request: R): boolean;
    send(request: R): void;
}

/** One request in flight at a time, at most one sent per frame budget, and only the latest one wanted per track. */
export const SPECTRUM_REQUEST_INTERVAL_MS = 1000 / 32;

/**
 * Coalesces spectrum repaints into animation frames and paces the slice requests those repaints ask for.
 * A repaint that must not ask for slices (a hover, or one following an answer) runs with `allowsSliceRequests` false.
 */
export class SpectrumRequestScheduler<R extends ScheduledSliceRequest> {
    private frame: { allowSliceRequests: boolean; advanceCursor: boolean } | null = null;
    private allows = true;
    private generationValue = 0;
    private inFlight: R | null = null;
    private readonly desired = new Map<string, R>();
    private timerId: number | null = null;
    private lastSentAt = -Infinity;

    constructor(private readonly deps: SpectrumRequestSchedulerDeps<R>) {}

    /** Bumped whenever the cursor, an offset or the settings change: requests of an older generation are stale. */
    get generation(): number {
        return this.generationValue;
    }

    get allowsSliceRequests(): boolean {
        return this.allows;
    }

    get active(): R | null {
        return this.inFlight;
    }

    get desiredCount(): number {
        return this.desired.size;
    }

    desiredFor(key: string): R | undefined {
        return this.desired.get(key);
    }

    /** Replaces whatever was wanted for `key` and sends it as soon as the backend and the pacing allow. */
    want(key: string, request: R): void {
        this.desired.set(key, request);
        this.pump();
    }

    drop(key: string): void {
        this.desired.delete(key);
    }

    invalidate(): void {
        this.generationValue += 1;
        this.desired.clear();
        if (this.timerId !== null) {
            this.deps.clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    /** The request in flight, if `requestId` answers it; the backend is free again either way it went. */
    settle(requestId: string): R | null {
        const active = this.inFlight;
        if (!active || active.requestId !== requestId) {
            return null;
        }
        this.inFlight = null;
        return active;
    }

    /** Stops waiting for the request in flight (its host dropped it). */
    abandonActive(): void {
        this.inFlight = null;
    }

    /** The ids of every request wanted or in flight. */
    openRequestIds(): string[] {
        const ids = [...this.desired.values()].map(request => request.requestId);
        if (this.inFlight) ids.push(this.inFlight.requestId);
        return ids;
    }

    pump(): void {
        if (this.inFlight) {
            return;
        }
        if (this.desired.size > 0) {
            const remainingMs = SPECTRUM_REQUEST_INTERVAL_MS - (this.deps.now() - this.lastSentAt);
            if (remainingMs > 1) {
                if (this.timerId === null) {
                    this.timerId = this.deps.setTimeout(() => {
                        this.timerId = null;
                        this.pump();
                    }, remainingMs);
                }
                return;
            }
        }
        for (const [key, request] of this.desired) {
            this.desired.delete(key);
            if (request.generation !== this.generationValue || !this.deps.isCurrent(request)) {
                continue;
            }
            this.inFlight = request;
            this.lastSentAt = this.deps.now();
            this.deps.send(request);
            return;
        }
    }

    scheduleFrame(allowSliceRequests: boolean, advanceCursor: boolean): void {
        if (this.frame) {
            return;
        }
        const frame = { allowSliceRequests, advanceCursor };
        this.frame = frame;
        this.deps.requestAnimationFrame(() => this.runFrame(frame.allowSliceRequests, frame.advanceCursor));
    }

    /** Repaints now; a frame already scheduled still runs. */
    runFrame(allowSliceRequests: boolean, advanceCursor: boolean): void {
        this.frame = null;
        const previous = this.allows;
        this.allows = allowSliceRequests;
        try {
            this.deps.refresh(advanceCursor);
        }
        finally {
            this.allows = previous;
        }
    }
}
