/** The step bar's undo / redo: every edit from the bar keeps what was there before, the last `limit` of them. */
export interface StepHistory<T> {
    /** An edit is made while `here` is on screen: `here` can be gone back to, and what was undone is dropped. */
    record(here: T): void;
    /**
     * What ↶ goes back to, keeping `here` for ↷; undefined when there is nothing to undo, or nothing on screen
     * (`here` null) to come back to, which drops the step undone.
     */
    undo(here: T | null): T | undefined;
    /** What ↷ goes forward to, keeping `here` for ↶; undefined as for undo. */
    redo(here: T | null): T | undefined;
    canUndo(): boolean;
    canRedo(): boolean;
}

export const STEP_HISTORY_LIMIT = 50;

export function createStepHistory<T>(limit = STEP_HISTORY_LIMIT): StepHistory<T> {
    const past: T[] = [], future: T[] = [];
    function travel(from: T[], to: T[], here: T | null): T | undefined {
        const target = from.pop();
        if (target === undefined || here === null) return undefined;
        to.push(here);
        return target;
    }
    return {
        record(here) {
            past.push(here);
            if (past.length > limit) past.shift();
            future.length = 0;
        },
        undo: here => travel(past, future, here),
        redo: here => travel(future, past, here),
        canUndo: () => past.length > 0,
        canRedo: () => future.length > 0,
    };
}
