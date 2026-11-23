/**
 * A click waiting for its read (figure-design.md 第 6 節「読み値とクリック」), the one place its rule is kept:
 * it is done once, when the read at the press arrives, and only while all of these hold:
 *
 * - the press still stands: no later press anywhere on the page (the page's arbitration, pressArbiter.ts);
 * - the Figure is at the generation it was pressed on: a redraw (spec, specified range, size or answers' versions
 *   changed, or a "no-picture" redraw) means the point was read on another picture (第 1 節, the third consequence);
 * - the Figure is not disposed;
 * - a read is there to act on (spec 4: during a long computation there is none, so nothing is done).
 *
 * Its take-back stops a click not done yet, and takes back one done (the second press of a double click, R13).
 */

/** What a waiting click is checked against when its read arrives. */
export interface ClickGround {
    generation(): number;
    disposed(): boolean;
}

/** Whether a click pressed at `pressedOn` may still be done now. */
export function clickStands(current: () => boolean, pressedOn: number, ground: ClickGround): boolean {
    return current() && !ground.disposed() && ground.generation() === pressedOn;
}

/**
 * A click whose read is on its way: `arrived` with the read (null: nothing to act on) does it once if it still stands;
 * `takeBack` stops it, or takes back what it did.
 */
export function waitingClick<R>(current: () => boolean, ground: ClickGround, act: (read: R) => (() => void) | void): { arrived(read: R | null): void; takeBack(): void } {
    const pressedOn = ground.generation();
    let settled = false;
    let undo: (() => void) | void;
    return {
        arrived(read) {
            if (settled) return;
            settled = true;
            if (read !== null && clickStands(current, pressedOn, ground)) undo = act(read);
        },
        takeBack() {
            settled = true;
            const done = undo;
            undo = undefined;
            if (typeof done === 'function') done();
        },
    };
}
