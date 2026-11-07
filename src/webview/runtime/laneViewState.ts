import type { LoopRegion } from './types';

export interface LaneViewStateHooks {
    scheduleRender(): void;
    /** Only what follows the cursor is drawn again (its lines); the plots under it stay as drawn. */
    scheduleCursorRender(): void;
    /** The time readout shows `norm`: the cursor, or the hover while there is one. */
    showTime(norm: number): void;
    /** The loop region was set or cleared (its time readout and the zoom-to-selection button follow). */
    loopChanged(region: LoopRegion | null): void;
}

/** What the lanes draw over their plots, in global timeline norms: the cursor, the hover line and the loop region. */
export class LaneViewState {
    private cursorNorm = 0;
    private hoverNorm: number | null = null;
    private loopRegion: LoopRegion | null = null;

    constructor(private readonly hooks: LaneViewStateHooks) {}

    get cursor(): number {
        return this.cursorNorm;
    }

    /** The hover preview's position; null when the pointer is off the lanes. */
    get hover(): number | null {
        return this.hoverNorm;
    }

    get loop(): LoopRegion | null {
        return this.loopRegion;
    }

    /** Clamped to the tracks; 'cursor' draws only the cursor again, for a move that changes nothing else (playback). */
    setCursor(norm: number, redraw: 'all' | 'cursor' = 'all'): void {
        this.cursorNorm = Math.max(0, Math.min(1, norm));
        this.hooks.showTime(this.cursorNorm);
        if (redraw === 'cursor') this.hooks.scheduleCursorRender();
        else this.hooks.scheduleRender();
    }

    setHover(norm: number): void {
        this.hoverNorm = norm;
        this.hooks.scheduleRender();
        this.hooks.showTime(norm);
    }

    /** Returns whether there was a hover to clear. */
    clearHover(): boolean {
        if (this.hoverNorm === null) {
            return false;
        }
        this.hoverNorm = null;
        this.hooks.scheduleRender();
        this.hooks.showTime(this.cursorNorm);
        return true;
    }

    setLoop(region: LoopRegion | null): void {
        this.loopRegion = region;
        this.hooks.loopChanged(region);
        this.hooks.scheduleRender();
    }
}
