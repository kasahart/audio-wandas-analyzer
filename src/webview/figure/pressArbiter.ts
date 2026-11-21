/**
 * The one arbitration of presses on the page (R13; figure-design.md 第 6 節「押下の調停はページに 1 つ」): one
 * count of presses, whether a drag is under way, and the last click done with how to take it back. Every plot's
 * gestures share it, the old plots (runtime/plotInteraction.ts) and the Figure alike, so the second press of a double
 * click takes back the click before it wherever either landed, and a click that waits for its read is no longer
 * current once any later press comes.
 *
 * A press that stays put is a click and acts at once; the second press of the browser's double click (`detail` 2, at
 * whatever interval its OS sets) is no click and takes back what its first did. No timer decides it.
 */

/** Pointer travel in px, on either axis, before a press counts as a drag rather than a click (every plot's). */
export const DRAG_START_THRESHOLD_PX = 3;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
    return Math.abs(dx) > DRAG_START_THRESHOLD_PX || Math.abs(dy) > DRAG_START_THRESHOLD_PX;
}

/** What a click does, done at once; it returns how to take it back, for the second press of a double click (R13). */
export type PressClick = () => (() => void) | void;

/** The page's presses: kept on the document, so every bundle and every plot of the page shares one. */
export interface PagePresses {
    count: number;
    dragging: boolean;
    endedBy: Event | null;
    /** The last click done on a plot, at which press, how to take it back and how to reset that plot's zoom. */
    click: { at: number; plot: object; takeBack: () => void; reset: () => void } | null;
}

const PLOT_PRESSES = Symbol.for('audio-wandas-analyzer.plotPresses');

/** The page's one arbitration (made with the first plot's gestures). */
export function pagePresses(doc: object): PagePresses {
    const holder = doc as { [PLOT_PRESSES]?: PagePresses };
    return holder[PLOT_PRESSES] ??= { count: 0, dragging: false, endedBy: null, click: null };
}

/** A press began on a plot: it is counted, so a click before it no longer stands. */
export function pressBegan(presses: PagePresses): void {
    presses.count += 1;
}

/**
 * A press that stayed put was let go on `plot`: the one arbitration of a click for every plot (R13). The second press
 * of a double click (`detail` > 1) is told with `current` false and nothing is done; any other is a click, acted on
 * at once (`tap` decides it, `current` says whether it still stands for a click that waits), and what it returns to
 * take it back is kept for the next press.
 */
export function clickReleased(presses: PagePresses, plot: object, detail: number, tap: (current: () => boolean) => PressClick | void, reset: () => void): void {
    const at = presses.count;
    presses.click = null;
    if (detail > 1) { tap(() => false); return; }
    const current = (): boolean => presses.count === at;
    const action = tap(current);
    const takeBack = typeof action === 'function' ? action() : undefined;
    if (typeof takeBack === 'function') presses.click = { at, plot, takeBack, reset };
}

/**
 * The second press of a double click right after a click (no press between), wherever it lands: the click is taken
 * back and that plot's zoom reset, unless it landed on the plot clicked (its own double click resets it there).
 * Told on the document before any press is counted; the first to tell it answers it, the rest find nothing.
 */
export function secondPress(presses: PagePresses, landedOn: (plot: object) => boolean): void {
    const first = presses.click;
    if (!first || first.at !== presses.count) return;
    presses.click = null;
    first.takeBack();
    if (!landedOn(first.plot)) first.reset();
}

/** A plot taken off the page (a Figure disposed): the click it holds can no longer be taken back. */
export function forgetClick(presses: PagePresses, plot: object): void {
    if (presses.click?.plot === plot) presses.click = null;
}
