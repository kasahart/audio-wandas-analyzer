/**
 * When the entry screen draws itself again. A state change asks for the parts it touched; outside a batch they are
 * drawn at once, inside one (a click, a key, a change) once when it ends, so a handler that changes several
 * things draws once. Work that needs what was drawn (a focus on a redrawn button) runs after it.
 */
export interface Redraw<Part extends string> {
    request(part: Part): void;
    /** Runs `fn` with its requests drawn once at its end; a batch inside another joins it. */
    batch<T>(fn: () => T): T;
    /** Runs `fn` once what is asked for is drawn (now, when nothing is). */
    after(fn: () => void): void;
}

/** `parts` in the order they are drawn: a part asked for while drawing an earlier one is drawn in the same pass. */
export function createRedraw<Part extends string>(parts: ReadonlyArray<readonly [Part, () => void]>): Redraw<Part> {
    const pending = new Set<Part>();
    const afterwards: Array<() => void> = [];
    let depth = 0;
    let flushing = false;
    function flush(): void {
        if (depth > 0 || flushing) return;
        flushing = true;
        try {
            while (pending.size || afterwards.length) {
                for (const [part, draw] of parts) if (pending.delete(part)) draw();
                if (!pending.size) afterwards.shift()?.();
            }
        } finally {
            flushing = false;
        }
    }
    return {
        request(part) { pending.add(part); flush(); },
        batch(fn) {
            depth++;
            try { return fn(); } finally { depth--; flush(); }
        },
        after(fn) { afterwards.push(fn); flush(); },
    };
}

export interface Throttle {
    /** Runs the work once, as soon as the interval since its last run allows; again while waiting changes nothing. */
    schedule(): void;
    /** Drops a run that is waiting. */
    cancel(): void;
}

/**
 * Work run at most every `minimumMs`, and a longer wait when it takes longer: it keeps under a fifth of the time
 * (each redraw of the table sorts every row, so redrawing per scan result would cost the square of the folder).
 */
export function createThrottle(timers: Pick<Window, 'setTimeout' | 'clearTimeout'>, now: () => number, minimumMs: number, work: () => void): Throttle {
    let timer: number | undefined;
    let last = 0;
    let cost = 0;
    return {
        schedule() {
            if (timer !== undefined) return;
            const interval = Math.max(minimumMs, 4 * cost);
            const wait = Math.max(0, interval - (now() - last));
            timer = timers.setTimeout(() => {
                timer = undefined;
                const started = now();
                work();
                last = now();
                cost = last - started;
            }, wait);
        },
        cancel() {
            if (timer === undefined) return;
            timers.clearTimeout(timer);
            timer = undefined;
        },
    };
}
