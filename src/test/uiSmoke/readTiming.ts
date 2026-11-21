import type { Page } from './canvasAudit';

/**
 * How long the page itself takes over a read of a Figure, measured inside the page (performance.now()): from the
 * pointer's move to the read request leaving, and from the reply's posting to the page to the readout or the mark changing. What
 * lies between the two is the host and the backend (to be measured where they run); here it is the tests' bridge, which looks for requests every 30 ms and is no measure
 * of the product.
 */
export interface ReadTiming { asks: number[]; shows: number[] }

/** Starts measuring the reads of the Figure on `canvas` (a selector). */
export function startReadTiming(page: Page, canvas: string): Promise<void> {
    return page.evaluate(selector => {
        const timing = { asks: [] as number[], shows: [] as number[] };
        (window as unknown as { __readTiming: typeof timing }).__readTiming = timing;
        const state = (): string => {
            const figure = document.querySelector<HTMLCanvasElement & { __figureInspect?: () => { readout: string; mark: unknown } }>(selector);
            const now = figure?.__figureInspect?.();
            return now ? `${now.readout}\u0000${JSON.stringify(now.mark ?? null)}` : '';
        };
        let moved: number | null = null;
        window.addEventListener('pointermove', () => { moved = performance.now(); }, true);
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<{ type?: string; command?: string }> }).__uiSmokePostedMessages;
        const push = posted.push.bind(posted);
        posted.push = (...messages) => {
            if (moved !== null && messages.some(message => message.type === 'figure-request' && message.command === 'figure-read')) {
                timing.asks.push(performance.now() - moved);
                moved = null;
            }
            return push(...messages);
        };
        // After the page's own listener (added before this one): the reply has been read, and what it changed is seen at
        // once. Counted from when the reply was posted to the page (the event's own time).
        let before = state();
        window.addEventListener('message', event => {
            const data = event.data as { type?: string; command?: string } | null;
            if (data?.type !== 'figure-result' || data.command !== 'figure-read') return;
            const now = state();
            if (now !== before) timing.shows.push(performance.now() - event.timeStamp);
            before = now;
        });
    }, canvas);
}

/** What was measured since startReadTiming, as the text of a test annotation. */
export async function readTimingText(page: Page): Promise<string> {
    const timing = await page.evaluate(() => (window as unknown as { __readTiming: ReadTiming }).__readTiming);
    const said = (values: number[]): string => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted.length ? `median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}, max ${sorted.at(-1)!.toFixed(1)} (${sorted.length})` : 'none';
    };
    return `inside the page, ms: pointer move to request ${said(timing.asks)}; reply to readout ${said(timing.shows)}`;
}
