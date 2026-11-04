/** How long one action's cursor-spectrum answers may hold back the picture before what has arrived is drawn. */
export const SPECTRUM_COMMIT_HOLD_MS = 1000;

/**
 * One action (a cursor click, a stop) asks every track for its cursor spectrum, and the answers come back one by one.
 * While some are still on its way the last picture stays, so every track changes in the same frame — up to a cap,
 * so a slow file never freezes the others.
 */
export class SpectrumCommitHold {
    private since: number | null = null;
    private timer: number | null = null;

    constructor(private readonly deps: {
        now(): number;
        setTimeout(handler: () => void, ms: number): number;
        clearTimeout(id: number): void;
        /** Draws again once the cap has passed, since no answer may arrive to do it. */
        onExpired(): void;
    }) {}

    /** Whether to keep the last committed picture: something asked for is still on its way and the cap has not passed. */
    holds(pending: boolean): boolean {
        if (!pending) {
            this.release();
            return false;
        }
        const now = this.deps.now();
        if (this.since === null) {
            this.since = now;
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
