/**
 * Every ui-smoke test runs with this check: a canvas on screen whose bitmap stays a size other than the one it is
 * shown at fails the test. Such a canvas was drawn before a layout change resized it (Δ opened under a plot, the step
 * bar grown over it) and not drawn again, so the browser stretches its picture while the hover marks are drawn at
 * the new size: every hovered line looks doubled. Specs import `test` and `expect` from here, not '@playwright/test'.
 *
 * And with this one (R7): a hover's readout shown over a plot fails the test, whichever plot and readout it is. The
 * readout of every plot has a row of its own outside the plots, so the lines under the pointer stay in view; and its
 * values shown past the end of that row or the window fail it too.
 *
 * And (R13): every chart is a Figure (src/webview/figure/, which marks its canvas `data-figure`). A canvas on screen
 * that is not a Figure's, nor an axis the screen paints on a canvas of its own (the time ruler,
 * `data-plot-axis-canvas`), nor a layer of marks laid over a plot (plotRegistry.ts), fails it; so does an axis canvas
 * drawn into while its painter is not painting (`__plotPainting`), and a chart drawn as SVG.
 *
 * And (R4): an axis name drawn partly outside its canvas, on a Figure or an axis canvas, fails it.
 *
 * And (R4): two tick labels of one painting of a Figure whose boxes overlap fail it (`__tickAudit`). A label is a
 * bare number ("−40", "1.5", "2k"); a label with a unit or a word is not judged here. The box is the text's measured
 * bounding box, not its inked pixels.
 *
 * What else a Figure draws (its points, the order of its lines) is not read off the canvas here: the Figure says it
 * (`__figureInspect`), and its own tests hold it (figureComponent.test.ts, figureOverlay.spec.ts).
 */
import { test as base } from '@playwright/test';
import { PLOT_LAYERS } from './plotRegistry';
import { installFigureStandIn } from './figureStandIn';

export * from '@playwright/test';

/**
 * How long a canvas may stay at another size than it is shown at: a resize is drawn again within a frame or two,
 * so 6 frames and 100 ms (both, for a slow machine's long frames) is a canvas that will not be drawn again.
 */
const SETTLE = { frames: 6, ms: 100 };
/** Canvases that are no chart of their own: the Figure's (data-figure) and the layers laid over a plot. */
const AUDIT = {
    settle: SETTLE,
    others: [...PLOT_LAYERS, 'canvas[data-figure]'].join(', '),
};
/** An SVG this large on both sides is a chart, not an icon. */
const SVG_CHART_MIN = { width: 64, height: 40 };

declare global {
    interface Window { __canvasAudit?: string[]; __readoutAudit?: string[]; __plotAudit?: string[]; __drawnAudit?: string[]; __svgAudit?: string[]; __titleAudit?: string[]; __tickAudit?: string[]; __plotPainting?: number; __settle?: SettleTracker }
}

/** What the page still has to do in answer to what it was given: its frames and short timers not yet run, and what it asked for from outside itself and has not been given (settled()). */
interface SettleTracker {
    busy(): number;
    frame(callback: () => void): void;
    /** Requests of these types the page posts are answered from outside it (a real backend, realBackend.ts): each is waited for until `answered`. */
    awaitHost(types: readonly string[]): void;
    answered(requestId: string): void;
}
/** The longest timer the page is waiting on as part of its answer (a debounce, a reply posted later); longer ones (a retry after 5 s) are not. */
const SETTLE_TIMER_MS = 1000;

/**
 * Runs in the page, before its own scripts: counts the animation frames it asked for and the short timers it set that
 * have not run yet, so a test waits for the page to finish answering an input (settled()) instead of a fixed time.
 * The audit's own frames are not counted.
 *
 * It also counts what the page asked for from outside itself and has not been given yet: a fetch (a test's
 * page.route answers it from the test's own process, which a loaded machine makes slow) and a read of a file's or a
 * response's bytes, and a message posted to the page itself until it is delivered (an answer a timer posts arrives
 * a task later). The page draws again when each arrives, so until then it has not finished answering. Anything new
 * the page waits on from outside its own thread belongs here too; otherwise settled() ends early on a slow machine
 * and the test acts on a page that is about to move.
 */
function installSettleTracker(timerMs: number): void {
    if (window.__settle) return;
    const nativeFrame = window.requestAnimationFrame.bind(window), nativeCancelFrame = window.cancelAnimationFrame.bind(window);
    const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    const frames = new Set<number>(), timers = new Set<number>();
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const id: number = nativeFrame(time => { frames.delete(id); callback(time); });
        frames.add(id);
        return id;
    };
    window.cancelAnimationFrame = (id: number): void => { frames.delete(id); nativeCancelFrame(id); };
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]): number => {
        if (typeof handler !== 'function' || (ms ?? 0) > timerMs) return nativeTimeout(handler, ms, ...args);
        const id: number = nativeTimeout(() => { timers.delete(id); (handler as (...rest: unknown[]) => void)(...args); }, ms);
        timers.add(id);
        return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number): void => { if (id !== undefined) timers.delete(id); nativeClear(id); }) as typeof window.clearTimeout;
    // A fetch, and a read of the bytes of a file or of a response, until it is given or fails.
    let outside = 0;
    const untilGiven = <T>(asked: Promise<T>): Promise<T> => {
        outside++;
        const given = (): void => { outside--; };
        asked.then(given, given);
        return asked;
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args: Parameters<typeof window.fetch>) => untilGiven(nativeFetch(...args));
    for (const owner of [Blob.prototype, Response.prototype] as const) {
        for (const read of ['arrayBuffer', 'text', 'json'] as const) {
            const native = (owner as unknown as Record<string, ((this: unknown) => Promise<unknown>) | undefined>)[read];
            if (native) (owner as unknown as Record<string, unknown>)[read] = function (this: unknown): Promise<unknown> { return untilGiven(native.call(this)); };
        }
    }
    // A message posted to the page itself (window.postMessage: the stand-in host's answer from its timer, a test's
    // scan results, the real-backend bridge's answers), until it is delivered. It arrives in a task of its own after
    // the one that posts it, and frames can run in between: a timer that posts an answer is no longer counted once it
    // has run, so without this the page looked quiet with the answer still on its way, and a test read it as it was
    // before the answer. Delivered in posting order; counted off as its dispatch begins (busy() is read only between
    // tasks, so by then every listener has handled it and what it draws from it is counted above). One that cannot
    // arrive (another target origin) is not counted.
    let inFlight = 0;
    const nativePost = window.postMessage.bind(window) as (message: unknown, options?: unknown, transfer?: Transferable[]) => void;
    window.postMessage = ((message: unknown, options?: string | WindowPostMessageOptions, transfer?: Transferable[]): void => {
        nativePost(message, options, transfer);
        const origin = typeof options === 'string' ? options : options?.targetOrigin ?? '/';
        if (origin === '*' || origin === '/' || origin === window.location.origin) inFlight++;
    }) as typeof window.postMessage;
    const delivered = (event: MessageEvent): void => { if (event.source === window && inFlight > 0) inFlight--; };
    window.addEventListener('message', delivered, true);
    window.addEventListener('messageerror', delivered, true);
    // Requests the test answers from outside the page: posted (the stand-in host's __uiSmokePostedMessages) and not answered yet.
    const awaited = new Set<string>(), answered = new Set<string>();
    const unanswered = (): number => {
        if (!awaited.size) return 0;
        const posted = (window as unknown as { __uiSmokePostedMessages?: Array<{ type?: string; requestId?: string }> }).__uiSmokePostedMessages ?? [];
        return posted.filter(message => awaited.has(message.type ?? '') && !answered.has(message.requestId ?? '')).length;
    };
    window.__settle = {
        busy: () => frames.size + timers.size + outside + inFlight + unanswered(),
        frame: callback => { nativeFrame(() => callback()); },
        awaitHost: types => { for (const type of types) awaited.add(type); },
        answered: requestId => { answered.add(requestId); },
    };
}

/** Runs in the page: samples the canvases on screen and records each one that stayed at another size. */
function installCanvasAudit({ settle, others, svgMin }: { settle: { frames: number; ms: number }; others: string; svgMin: { width: number; height: number } }): void {
    if (window.__canvasAudit) return;
    // The audit samples every frame on frames of its own, which the page's settling does not wait for.
    const nextFrame = (callback: () => void): void => { if (window.__settle) window.__settle.frame(callback); else window.requestAnimationFrame(callback); };
    const canvasName = (canvas: HTMLCanvasElement): string => (canvas.id ? `#${canvas.id}` : `canvas${Array.from(canvas.attributes).filter(a => a.name === 'class' || (a.name.startsWith('data-') && !a.name.startsWith('data-plot'))).map(a => (a.name === 'class' ? `.${a.value.trim().split(/\s+/).join('.')}` : `[${a.name}]`)).join('')}`);
    // What drew each axis canvas (the time ruler, data-plot-axis-canvas): a draw into one while its painter is not
    // painting (__plotPainting) is recorded. A picture copied in from another canvas (drawImage) is a draw too.
    const drawn: string[] = [];
    window.__drawnAudit = drawn;
    const drawnSeen = new Set<string>();
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'putImageData', 'drawImage']) {
        const original = proto[method];
        proto[method] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
            const canvas = this.canvas;
            if (canvas instanceof HTMLCanvasElement && !(window.__plotPainting ?? 0) && canvas.isConnected && canvas.hasAttribute('data-plot-axis-canvas')) {
                const name = `${canvasName(canvas)}: ${method}`;
                if (!drawnSeen.has(name)) { drawnSeen.add(name); drawn.push(name); }
            }
            return original.apply(this, args);
        };
    }
    const fillText = proto.fillText;
    const measureText = proto.measureText;
    const tickText = /^[−+-]?\d[\d.]*(e[−+-]?\d+)?k?$/u;
    // Axis names drawn (partly) outside their canvas (docs/display-rules.md R4: the Figure fits every name inside
    // it). Judged as each is drawn, against the bitmap it is drawn on, on every Figure and axis canvas of
    // every test, at whatever size the test gives the page. A name is told by its unit in closing brackets
    // ("Level [dBFS]", or the unit's own line "[dBFS]" of a name on two lines, whose quantity line was drawn just
    // before it at the same turn).
    const outside: string[] = [];
    const outsideSeen = new Set<string>();
    window.__titleAudit = outside;
    type InkBox = { text: string; left: number; top: number; right: number; bottom: number; turn: string };
    const lastText = new WeakMap<HTMLCanvasElement, InkBox>();
    /** Where a text's ink lands on the bitmap, through the context's transform (a name up a value axis is turned). */
    const inkBox = (context: CanvasRenderingContext2D, text: string, x: number, y: number): InkBox => {
        const metrics = measureText.call(context, text) as TextMetrics;
        const at = context.getTransform();
        const corners = [[x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent], [x + metrics.actualBoundingBoxRight, y - metrics.actualBoundingBoxAscent],
            [x - metrics.actualBoundingBoxLeft, y + metrics.actualBoundingBoxDescent], [x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent]].map(([px, py]) => at.transformPoint({ x: px, y: py }));
        return { text, left: Math.min(...corners.map(c => c.x)), right: Math.max(...corners.map(c => c.x)), top: Math.min(...corners.map(c => c.y)), bottom: Math.max(...corners.map(c => c.y)), turn: `${at.a.toFixed(3)},${at.b.toFixed(3)}` };
    };
    const checkInside = (canvas: HTMLCanvasElement, box: InkBox): void => {
        // A pixel and a half of slack: the ink's own antialiasing at the edge.
        const slack = 1.5;
        if (box.left >= -slack && box.top >= -slack && box.right <= canvas.width + slack && box.bottom <= canvas.height + slack) return;
        const where = canvas.id ? `#${canvas.id.replace(/\d+/gu, 'N')}` : canvas.hasAttribute('data-figure') ? 'canvas[data-figure]' : canvas.getAttribute('data-stage-canvas') ? `[data-stage-canvas="${canvas.getAttribute('data-stage-canvas')}"]` : canvas.className || 'canvas';
        const message = `${where} (${canvas.width}×${canvas.height} bitmap): "${box.text}" is drawn from (${Math.round(box.left)}, ${Math.round(box.top)}) to (${Math.round(box.right)}, ${Math.round(box.bottom)})`;
        const key = `${where}|${box.text}|${canvas.width}×${canvas.height}`;
        if (!outsideSeen.has(key)) { outsideSeen.add(key); outside.push(message); }
    };
    // Tick labels written over each other on a Figure (docs/display-rules.md R4), judged by the ink of the numbers
    // as they are drawn: of one painting (from the Figure's clearing of its whole canvas to the next), no two of
    // their bounding boxes may overlap. Told by their text (a bare number, as tickText).
    const ticksOver: string[] = [];
    const ticksOverSeen = new Set<string>();
    window.__tickAudit = ticksOver;
    const tickBoxes = new WeakMap<HTMLCanvasElement, InkBox[]>();
    const clearRect = proto.clearRect;
    proto.clearRect = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        const canvas = this.canvas;
        if (canvas instanceof HTMLCanvasElement && canvas.hasAttribute('data-figure') && Number(args[0]) === 0 && Number(args[1]) === 0) {
            // The whole bitmap cleared (through the transform): a smaller clearing from the corner starts no painting.
            const at = this.getTransform();
            if (Math.abs(at.a) * Number(args[2]) >= canvas.width - 1 && Math.abs(at.d) * Number(args[3]) >= canvas.height - 1) tickBoxes.set(canvas, []);
        }
        return clearRect.apply(this, args);
    };
    const checkTick = (canvas: HTMLCanvasElement, box: InkBox): void => {
        const drawn = tickBoxes.get(canvas) ?? [];
        tickBoxes.set(canvas, drawn);
        for (const other of drawn) {
            // The same number written again at the same place (a tick two lanes share) covers nothing.
            if (other.text === box.text && Math.abs(other.left - box.left) < 0.5 && Math.abs(other.top - box.top) < 0.5) continue;
            if (box.left < other.right - 0.5 && other.left < box.right - 0.5 && box.top < other.bottom - 0.5 && other.top < box.bottom - 0.5) {
                const key = `${canvas.width}×${canvas.height}|${other.text}|${box.text}`;
                if (!ticksOverSeen.has(key)) { ticksOverSeen.add(key); ticksOver.push(`canvas[data-figure] (${canvas.width}×${canvas.height} bitmap): "${other.text}" at (${Math.round(other.left)}, ${Math.round(other.top)}) and "${box.text}" at (${Math.round(box.left)}, ${Math.round(box.top)})`); }
            }
        }
        drawn.push(box);
    };
    proto.fillText = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        const canvas = this.canvas;
        if (canvas instanceof HTMLCanvasElement && typeof args[0] === 'string' && tickText.test(args[0]) && canvas.hasAttribute('data-figure')) checkTick(canvas, inkBox(this, args[0], Number(args[1]), Number(args[2])));
        if (canvas instanceof HTMLCanvasElement && typeof args[0] === 'string' && !tickText.test(args[0]) && (canvas.hasAttribute('data-figure') || canvas.hasAttribute('data-plot-axis-canvas'))) {
            const box = inkBox(this, args[0], Number(args[1]), Number(args[2]));
            if (/\[[^\]]+\]$/u.test(args[0].trim())) {
                checkInside(canvas, box);
                // The unit's own line: the quantity's line was drawn just before it, turned the same way.
                const before = lastText.get(canvas);
                if (/^\[[^\]]+\]$/u.test(args[0].trim()) && before && before.turn === box.turn) checkInside(canvas, before);
            }
            lastText.set(canvas, box);
        }
        return fillText.apply(this, args);
    };
    // Charts drawn as SVG: on screen and a chart's size.
    const svgs: string[] = [];
    window.__svgAudit = svgs;
    const svgSeen = new Set<string>();
    const sampleSvgs = (): void => {
        for (const svg of Array.from(document.querySelectorAll('svg'))) {
            if (svg.parentElement?.closest('svg')) continue;
            const box = svg.getBoundingClientRect();
            if (box.width < svgMin.width || box.height < svgMin.height || !svg.checkVisibility({ visibilityProperty: true })) continue;
            const name = svg.id ? `svg#${svg.id}` : `svg${Array.from(svg.attributes).filter(a => a.name === 'class' || a.name.startsWith('data-')).map(a => (a.name === 'class' ? `.${String(a.value).trim().split(/\s+/).join('.')}` : `[${a.name}]`)).join('')} in ${svg.parentElement?.id ? `#${svg.parentElement.id}` : svg.parentElement?.className ?? ''}`;
            if (!svgSeen.has(name)) { svgSeen.add(name); svgs.push(`${name} (${Math.round(box.width)}×${Math.round(box.height)})`); }
        }
    };
    const unregistered: string[] = [];
    window.__plotAudit = unregistered;
    const found: string[] = [];
    window.__canvasAudit = found;
    const since = new WeakMap<HTMLCanvasElement, { frame: number; at: number }>();
    let frame = 0;
    const reported = new Set<string>();
    const sample = (): void => {
        const ratio = window.devicePixelRatio || 1;
        const now = performance.now();
        frame += 1;
        for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
            const width = canvas.clientWidth, height = canvas.clientHeight;
            // Not on screen, or never drawn (a canvas's default 300×150 bitmap): nothing stretched to see.
            const shown = canvas.offsetParent !== null && width > 1 && height > 1 && !(canvas.width === 300 && canvas.height === 150);
            const other = shown && (Math.abs(canvas.width - Math.round(width * ratio)) > 1 || Math.abs(canvas.height - Math.round(height * ratio)) > 1);
            if (!other) { since.delete(canvas); continue; }
            const from = since.get(canvas) ?? { frame, at: now };
            since.set(canvas, from);
            const name = canvas.id || (canvas.dataset.stageCanvas ? `[data-stage-canvas="${canvas.dataset.stageCanvas}"]` : '') || `canvas.${canvas.className}`;
            if (frame - from.frame >= settle.frames && now - from.at >= settle.ms && !reported.has(name)) {
                reported.add(name);
                found.push(`${name}: bitmap ${canvas.width}×${canvas.height}, shown at ${width}×${height} (×${ratio})`);
            }
        }
    };
    const readoutsOver: string[] = [];
    window.__readoutAudit = readoutsOver;
    const shownBox = (element: Element): DOMRect | null => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        // Not offsetParent: a readout laid over a plot is often position: fixed, which has none.
        return box.width > 1 && box.height > 1 && style.visibility === 'visible' && element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) ? box : null;
    };
    /** The part of a canvas that can be seen: its box cut by every ancestor that clips (a scrolled list of lanes). */
    const seenBox = (canvas: HTMLCanvasElement): DOMRect | null => {
        const box = shownBox(canvas);
        if (!box) return null;
        let left = box.left, top = box.top, right = box.right, bottom = box.bottom;
        for (let parent = canvas.parentElement; parent; parent = parent.parentElement) {
            const style = window.getComputedStyle(parent);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
        return right - left > 1 && bottom - top > 1 ? new DOMRect(left, top, right - left, bottom - top) : null;
    };
    /** Each readout with something in it, on screen over the seen part of a plot: recorded once per pair. */
    const sampleReadouts = (): void => {
        // The outermost readout only (not its name and values again), and the plots (not the layers of marks laid over one).
        const readouts = Array.from(document.querySelectorAll('[id*="readout"], [class*="readout"]'))
            .filter(element => element.textContent?.trim() && !element.parentElement?.closest('[id*="readout"], [class*="readout"]'));
        if (!readouts.length) return;
        const canvases = Array.from(document.querySelectorAll('canvas')).filter(canvas => !canvas.classList.contains('track-row-layer')).map(canvas => ({ canvas, box: seenBox(canvas) })).filter(item => item.box);
        for (const readout of readouts) {
            const box = shownBox(readout);
            if (!box) continue;
            for (const { canvas, box: plot } of canvases) {
                const across = Math.min(box.right, plot!.right) - Math.max(box.left, plot!.left);
                const up = Math.min(box.bottom, plot!.bottom) - Math.max(box.top, plot!.top);
                if (across <= 1 || up <= 1) continue;
                // Over the plot only where the plot is seen there: a readout in a panel laid over a plot hides it.
                const atX = (Math.max(box.left, plot!.left) + Math.min(box.right, plot!.right)) / 2, atY = (Math.max(box.top, plot!.top) + Math.min(box.bottom, plot!.bottom)) / 2;
                const stack = document.elementsFromPoint(atX, atY);
                const under = stack.indexOf(canvas);
                if (under < 0 || stack.slice(0, under).some(element => !readout.contains(element) && !element.contains(readout) && !element.contains(canvas))) continue;
                const name = `${readout.id ? `#${readout.id}` : `.${String(readout.className).trim().split(/\s+/).join('.')}`} over ${canvas.id ? `#${canvas.id}` : canvas.dataset.stageCanvas ? `[data-stage-canvas="${canvas.dataset.stageCanvas}"]` : `canvas.${canvas.className}`}`;
                if (!reported.has(name)) { reported.add(name); readoutsOver.push(`${name} ("${readout.textContent?.trim()}")`); }
            }
            // Its values are read whole: inside its row and the window, never pushed past their end (the name is cut first).
            const values = readout.querySelector('[class*="readout-values"]');
            const row = readout.parentElement?.getBoundingClientRect();
            const at = values ? shownBox(values) : null;
            if (at && row && (at.right > Math.min(row.right, window.innerWidth) + 1 || at.left < Math.max(row.left, 0) - 1)) {
                const name = `${readout.id ? `#${readout.id}` : `.${String(readout.className).trim().split(/\s+/).join('.')}`} values cut off at ${window.innerWidth} px`;
                if (!reported.has(name)) { reported.add(name); readoutsOver.push(`${name} ("${values!.textContent?.trim()}")`); }
            }
        }
    };
    /** Each canvas on screen that is no Figure's, no axis canvas and no listed layer, past the frames one just shown takes to be marked. */
    const unmarkedSince = new WeakMap<HTMLCanvasElement, { frame: number; at: number }>();
    const samplePlots = (): void => {
        const now = performance.now();
        for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
            if (canvas.hasAttribute('data-plot-axis-canvas') || canvas.matches(others) || !shownBox(canvas)) { unmarkedSince.delete(canvas); continue; }
            const from = unmarkedSince.get(canvas) ?? { frame, at: now };
            unmarkedSince.set(canvas, from);
            if (frame - from.frame < settle.frames || now - from.at < settle.ms) continue;
            const name = canvasName(canvas);
            if (!reported.has(`plot ${name}`)) { reported.add(`plot ${name}`); unregistered.push(name); }
        }
    };
    const tick = (): void => { sample(); sampleReadouts(); samplePlots(); sampleSvgs(); nextFrame(tick); };
    nextFrame(tick);
}

/** The page with the audit installed by its first script, before any of its own run. */
export function withAuditFirst(html: string): string {
    const first = html.search(/<script\b/u);
    if (first < 0) return html;
    const nonce = /<script nonce="([^"]+)"/u.exec(html)?.[1];
    const script = `<script${nonce ? ` nonce="${nonce}"` : ''}>(${installSettleTracker.toString()})(${SETTLE_TIMER_MS});(${installCanvasAudit.toString()})(${JSON.stringify({ ...AUDIT, svgMin: SVG_CHART_MIN })});</script>`;
    return html.slice(0, first) + script + html.slice(first);
}

/**
 * Waits until the page has answered what the test just did: two frames in a row with no frame it asked for, no
 * short timer it set still to run (a redraw, a debounce, a reply the stand-in host posts later, the next step of a
 * read), no fetch or file read it is still waiting for and no message posted to it not yet delivered. Use it where a test would otherwise wait a fixed time before reading what the page shows: a slow machine
 * then waits longer and a fast one less, and the page read is the one the input led to. A page that keeps drawing
 * (playback) never settles: after `timeoutMs` the wait ends, and the read is the page as it is then.
 */
export async function settled(page: import('@playwright/test').Page, timeoutMs = 10_000): Promise<boolean> {
    return page.evaluate(timeout => new Promise<boolean>(resolve => {
        const tracker = window.__settle;
        if (!tracker) { resolve(false); return; }
        const start = performance.now();
        let quiet = 0;
        const check = (): void => {
            quiet = tracker.busy() === 0 ? quiet + 1 : 0;
            if (quiet >= 2) resolve(true);
            else if (performance.now() - start > timeout) resolve(false);
            else tracker.frame(check);
        };
        tracker.frame(check);
    }), timeoutMs);
}

export const test = base.extend<{ canvasAudit: void }>({
    canvasAudit: [async ({ page }, use) => {
        await page.addInitScript(installSettleTracker, SETTLE_TIMER_MS);
        await page.addInitScript(installCanvasAudit, { ...AUDIT, svgMin: SVG_CHART_MIN });
        // setContent writes the document without a navigation, so the init script does not run for it: the audit goes
        // in as the document's first script (with the page's nonce), so the first drawing is audited too.
        const setContent = page.setContent.bind(page);
        page.setContent = async (html, options) => {
            await setContent(withAuditFirst(html), options);
            await page.evaluate(installCanvasAudit, { ...AUDIT, svgMin: SVG_CHART_MIN });
        };
        // The figure service for the Figures of a page on the stand-in host (started on the first request only).
        const stopFigures = await installFigureStandIn(page);
        await use();
        stopFigures();
        // A page the test closed has nothing left to check; any other failure to read the audit fails the test.
        if (page.isClosed()) return;
        const found = await page.evaluate(() => window.__canvasAudit ?? []);
        base.expect.soft(found, 'canvases left drawn at another size than they are shown at').toEqual([]);
        const over = await page.evaluate(() => window.__readoutAudit ?? []);
        base.expect.soft(over, 'hover readouts shown over a plot, or their values cut off (R7: each has its own row outside the plots)').toEqual([]);
        const unregistered = await page.evaluate(() => window.__plotAudit ?? []);
        base.expect.soft(unregistered, 'canvases on screen that are not a Figure\'s (R13: every chart is drawn by the Figure, src/webview/figure/; a layer of marks over a plot is listed in plotRegistry.ts)').toEqual([]);
        const drawnOutsideFound = await page.evaluate(() => window.__drawnAudit ?? []);
        base.expect.soft(drawnOutsideFound, 'axis canvases drawn into by other code than their painter (R13: the time ruler is painted by timeRuler.ts alone)').toEqual([]);
        const titlesOutside = await page.evaluate(() => window.__titleAudit ?? []);
        base.expect.soft(titlesOutside, 'axis names drawn outside their canvas (docs/display-rules.md R4: every name is fitted inside its canvas. '
            + 'Fix in the Figure, not per chart: give fitAxisTitle (src/webview/figure/axisTitle.ts) the room the name really has)').toEqual([]);
        const ticksOver = await page.evaluate(() => window.__tickAudit ?? []);
        base.expect.soft(ticksOver, 'tick labels written over each other on a Figure (docs/display-rules.md R4: an axis writes only the ticks whose labels fit. '
            + 'Fix in the Figure: src/webview/figure/ticks.ts chooses the ticks, figure.ts places their text)').toEqual([]);
        const svgFound = await page.evaluate(() => window.__svgAudit ?? []);
        base.expect.soft(svgFound, 'charts drawn as SVG (R13: every chart is drawn by the Figure, src/webview/figure/)').toEqual([]);
    }, { auto: true }],
});
