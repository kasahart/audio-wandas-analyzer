/**
 * The loop a range drag on a row makes (Alt+drag). A drag begun on an end of the loop there is moves that end and
 * keeps the other: the grips drawn at the loop's ends are handles. Any other drag is a new loop, the stretch between
 * the press and the release. Places are parts of the tracks' whole time (0 to 1).
 */
export interface LoopStretch { start: number; end: number }

/** An end is grabbed within this part of the time on screen, so it can be grabbed at any zoom. */
export const LOOP_GRIP_VIEW_FRACTION = 0.015;
/** The shortest loop an end can be dragged to: the ends never meet or cross. */
export const MIN_LOOP_SPAN = 0.001;

const within = (place: number): number => Math.max(0, Math.min(1, place));

/**
 * The loop after a drag from `pressed` to `released`, with `loop` there before it (null: none) and `viewSpan` the
 * part of the whole time on screen. Null when the drag makes no loop (it has no length).
 */
export function loopAfterDrag(loop: LoopStretch | null, pressed: number, released: number, viewSpan: number): LoopStretch | null {
    if (loop) {
        const reach = viewSpan * LOOP_GRIP_VIEW_FRACTION;
        if (Math.abs(pressed - loop.start) < reach) return { start: Math.max(0, Math.min(loop.end - MIN_LOOP_SPAN, released)), end: loop.end };
        if (Math.abs(pressed - loop.end) < reach) return { start: loop.start, end: Math.min(1, Math.max(loop.start + MIN_LOOP_SPAN, released)) };
    }
    const start = within(Math.min(pressed, released)), end = within(Math.max(pressed, released));
    return end > start ? { start, end } : null;
}
