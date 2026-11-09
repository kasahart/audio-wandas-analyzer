/** How long one action's cursor-spectrum answers may hold back the picture before what has arrived is drawn. */
export const SPECTRUM_COMMIT_HOLD_MS = 1000;

/**
 * One action (a cursor click, a stop) asks every track for its cursor spectrum, and the answers come back one by one.
 * While some are still on their way the last picture stays, so every track changes in the same frame — up to a cap,
 * so a slow file never freezes the others.
 */
export class SpectrumCommitHold {
    private since: number | null = null;
    private generation: number | null = null;
    private timer: number | null = null;

    constructor(private readonly deps: {
        now(): number;
        setTimeout(handler: () => void, ms: number): number;
        clearTimeout(id: number): void;
        /** Draws again once the cap has passed, since no answer may arrive to do it. */
        onExpired(): void;
    }) {}

    /**
     * Whether to keep the last committed picture: something asked for is still on its way and the cap has not passed.
     * `generation` names the action (it changes with the cursor): a new action starts its own hold.
     */
    holds(pending: boolean, generation: number): boolean {
        if (!pending) {
            this.release();
            return false;
        }
        const now = this.deps.now();
        if (this.since === null || this.generation !== generation) {
            this.release();
            this.since = now;
            this.generation = generation;
            this.timer = this.deps.setTimeout(() => {
                this.timer = null;
                this.deps.onExpired();
            }, SPECTRUM_COMMIT_HOLD_MS);
        }
        return now - this.since < SPECTRUM_COMMIT_HOLD_MS;
    }

    private release(): void {
        this.since = null;
        if (this.timer !== null) {
            this.deps.clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

/**
 * The cursor the cursor spectrum's picture is of. While the hold keeps the last picture, its lines, readouts and analysis
 * window are of the slices last drawn, so its header's "@ time" is that picture's cursor, not the new one: one picture,
 * one time. Once the picture is drawn again it is the new cursor's.
 */
export class ShownSpectrumCursor {
    private drawnAt: number | null = null;
    private held = false;

    /** The picture was drawn at `cursorNorm`. */
    drawn(cursorNorm: number): void {
        this.drawnAt = cursorNorm;
        this.held = false;
    }

    /** The last picture is kept: the hold is on and the new slices are still on their way. */
    keep(): void {
        this.held = this.drawnAt !== null;
    }

    /** Nothing drawn (the picture cleared): no time is kept. */
    clear(): void {
        this.drawnAt = null;
        this.held = false;
    }

    /** The cursor the header names: the kept picture's while it is kept, else the cursor's. */
    at(cursorNorm: number): number {
        return this.held && this.drawnAt !== null ? this.drawnAt : cursorNorm;
    }

    /** Whether the picture on show is a kept one (its window caption is then the kept bands too). */
    kept(): boolean {
        return this.held;
    }
}
