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
 * And (R13): a canvas on screen not drawn by the plot component fails it, unless plotRegistry.ts lists it; so does a
 * plot (a canvas the component marked) drawn into by anything but the component, which is what drew it, not its
 * mark; and a chart drawn as SVG or as boxes of the page instead of on a plot.
 *
 * And (R6): a plot on screen that drew a louder compared line over a quieter one fails it, whichever plot it is. The
 * plot component writes the levels of the lines it compared, in the order it drew them (`data-plot-order`); they
 * never rise, so the quietest line is on top on every plot, and each is measured from the values before thinning
 * (`levelBins`), never from the drawn points ('?').
 */
import { test as base } from '@playwright/test';
import { DRAWN_OUTSIDE_PENDING, PLOT_LAYERS, PLOTS_PENDING, SVG_CHARTS_PENDING } from './plotRegistry';

export * from '@playwright/test';

/**
 * How long a canvas may stay at another size than it is shown at: a resize is drawn again within a frame or two,
 * so 6 frames and 100 ms (both, for a slow machine's long frames) is a canvas that will not be drawn again.
 */
const SETTLE = { frames: 6, ms: 100 };
const AUDIT = {
    settle: SETTLE,
    others: [...PLOTS_PENDING.map(item => item.selector), ...PLOT_LAYERS].join(', '),
    drawnOutside: DRAWN_OUTSIDE_PENDING.map(item => item.selector).join(', '),
    svgCharts: SVG_CHARTS_PENDING.map(item => item.selector).join(', '),
};
/** An SVG this large on both sides is a chart, not an icon. */
const SVG_CHART_MIN = { width: 64, height: 40 };

declare global {
    interface Window { __canvasAudit?: string[]; __readoutAudit?: string[]; __plotAudit?: string[]; __drawnAudit?: string[]; __svgAudit?: string[]; __orderAudit?: string[]; __plotPainting?: number }
}

/** Runs in the page: samples the canvases on screen and records each one that stayed at another size. */
function installCanvasAudit({ settle, others, drawnOutside, svgCharts, svgMin }: { settle: { frames: number; ms: number }; others: string; drawnOutside: string; svgCharts: string; svgMin: { width: number; height: number } }): void {
    if (window.__canvasAudit) return;
    const canvasName = (canvas: HTMLCanvasElement): string => (canvas.id ? `#${canvas.id}` : `canvas${Array.from(canvas.attributes).filter(a => a.name === 'class' || (a.name.startsWith('data-') && !a.name.startsWith('data-plot'))).map(a => (a.name === 'class' ? `.${a.value.trim().split(/\s+/).join('.')}` : `[${a.name}]`)).join('')}`);
    // What drew each plot: a draw into a canvas the plot component marked, made while the component is not drawing,
    // is recorded. A picture copied in from another canvas (drawImage) is a draw too: only the component, while it
    // paints (__plotPainting), puts a picture on a plot.
    const drawn: string[] = [];
    window.__drawnAudit = drawn;
    const drawnSeen = new Set<string>();
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'putImageData', 'drawImage']) {
        const original = proto[method];
        proto[method] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
            const canvas = this.canvas;
            // A plot on the page (an export's picture made off the page, with its white paper under it, is not one).
            if (canvas instanceof HTMLCanvasElement && canvas.isConnected && canvas.hasAttribute('data-plot') && !(window.__plotPainting ?? 0)
                && !(drawnOutside && canvas.matches(drawnOutside))) {
                const name = `${canvasName(canvas)}: ${method}`;
                if (!drawnSeen.has(name)) { drawnSeen.add(name); drawn.push(name); }
            }
            return original.apply(this, args);
        };
    }
    // What the plot component drew on each plot, for a test to read what is on it (not only its attributes): each
    // stroke's colour and its points, and the rectangle it was clipped to, in the canvas's CSS pixels. A plot's record
    // starts again each time the component clears the whole of it (each paint).
    type Stroke = { color: string; points: Array<[number, number]>; clip: [number, number, number, number] | null };
    type Kept = { path: Array<[number, number]>; rect: [number, number, number, number] | null; clip: Array<[number, number, number, number] | null>; strokes: Stroke[] };
    const keptOf = (context: CanvasRenderingContext2D): Kept | null => {
        const canvas = context.canvas as HTMLCanvasElement & { __plotDrawn?: Kept };
        if (!(window.__plotPainting ?? 0) || !(canvas instanceof HTMLCanvasElement)) return null;
        canvas.__plotDrawn ??= { path: [], rect: null, clip: [null], strokes: [] };
        return canvas.__plotDrawn;
    };
    /** A point of the path in the canvas's CSS pixels: through the context's transform, then its bitmap's scale. */
    const cssPoint = (context: CanvasRenderingContext2D, x: number, y: number): [number, number] => {
        const at = context.getTransform().transformPoint({ x, y });
        const { canvas } = context;
        const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
        return [at.x / scale, at.y / scale];
    };
    const recorders: Record<string, (context: CanvasRenderingContext2D, kept: Kept, args: number[]) => void> = {
        clearRect(context, kept, [x, y, width, height]) {
            const [left, top] = cssPoint(context, x, y), [right, bottom] = cssPoint(context, x + width, y + height);
            const { canvas } = context;
            if (left <= 0 && top <= 0 && right >= canvas.clientWidth - 1 && bottom >= canvas.clientHeight - 1) { kept.strokes = []; kept.path = []; kept.clip = [null]; }
        },
        beginPath(_context, kept) { kept.path = []; kept.rect = null; },
        moveTo(context, kept, [x, y]) { kept.path.push([NaN, NaN], cssPoint(context, x, y)); },
        lineTo(context, kept, [x, y]) { kept.path.push(cssPoint(context, x, y)); },
        rect(context, kept, [x, y, width, height]) {
            const [left, top] = cssPoint(context, x, y), [right, bottom] = cssPoint(context, x + width, y + height);
            kept.rect = [left, top, right - left, bottom - top];
        },
        clip(_context, kept) { kept.clip[kept.clip.length - 1] = kept.rect; },
        save(_context, kept) { kept.clip.push(kept.clip[kept.clip.length - 1] ?? null); },
        restore(_context, kept) { if (kept.clip.length > 1) kept.clip.pop(); },
        stroke(context, kept) {
            // Each run of the path (from a moveTo) a stroke of its own.
            let run: Array<[number, number]> = [];
            const close = (): void => { if (run.length > 1) kept.strokes.push({ color: typeof context.strokeStyle === 'string' ? context.strokeStyle : 'pattern', points: run, clip: kept.clip[kept.clip.length - 1] ?? null }); run = []; };
            for (const point of kept.path) { if (Number.isNaN(point[0])) close(); else run.push(point); }
            close();
        },
    };
    for (const [method, record] of Object.entries(recorders)) {
        const original = proto[method];
        proto[method] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
            const kept = keptOf(this);
            if (kept) record(this, kept, args as number[]);
            return original.apply(this, args);
        };
    }
    // Charts drawn as SVG: on screen, a chart's size, and not listed while it waits for its move.
    const svgs: string[] = [];
    window.__svgAudit = svgs;
    const svgSeen = new Set<string>();
    const sampleSvgs = (): void => {
        for (const svg of Array.from(document.querySelectorAll('svg'))) {
            if (svg.parentElement?.closest('svg')) continue;
            const box = svg.getBoundingClientRect();
            if (box.width < svgMin.width || box.height < svgMin.height || !svg.checkVisibility({ visibilityProperty: true }) || (svgCharts && svg.matches(svgCharts))) continue;
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
        // The outermost readout only (not its name and values again), and the plots (not the hover marks laid over one).
        const readouts = Array.from(document.querySelectorAll('[id*="readout"], [class*="readout"]'))
            .filter(element => element.textContent?.trim() && !element.parentElement?.closest('[id*="readout"], [class*="readout"]'));
        if (!readouts.length) return;
        const canvases = Array.from(document.querySelectorAll('canvas')).filter(canvas => !canvas.classList.contains('plot-hover-layer')).map(canvas => ({ canvas, box: seenBox(canvas) })).filter(item => item.box);
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
    /**
     * Each canvas on screen that the plot component did not draw and that is on neither list (plotRegistry.ts), past
     * the frames a plot just shown takes to be drawn.
     */
    const unmarkedSince = new WeakMap<HTMLCanvasElement, { frame: number; at: number }>();
    // Each plot on screen whose compared lines' levels rise in the order drawn (R6): a louder line over a quieter one.
    const misordered: string[] = [];
    window.__orderAudit = misordered;
    const rises = (order: string): boolean => order.split(';').some(axis => {
        // A compared level ordered with no levels from the values before thinning ('?', drawnLevelsText) fails too.
        if (axis.split(',').includes('?')) return true;
        const levels = axis.split(',').map(level => (level === '-inf' ? -Infinity : Number(level)));
        return levels.some((level, index) => index > 0 && level > levels[index - 1]);
    });
    const samplePlots = (): void => {
        const now = performance.now();
        for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
            const order = canvas.getAttribute('data-plot-order');
            if (order && canvas.hasAttribute('data-plot') && rises(order) && shownBox(canvas)) {
                const name = `order ${canvasName(canvas)}: ${order}`;
                if (!reported.has(name)) { reported.add(name); misordered.push(`${canvasName(canvas)} drew levels ${order}`); }
            }
            if (canvas.hasAttribute('data-plot') || (others && canvas.matches(others)) || !shownBox(canvas)) { unmarkedSince.delete(canvas); continue; }
            const from = unmarkedSince.get(canvas) ?? { frame, at: now };
            unmarkedSince.set(canvas, from);
            if (frame - from.frame < settle.frames || now - from.at < settle.ms) continue;
            const name = canvas.id ? `#${canvas.id}` : `canvas${Array.from(canvas.attributes).filter(a => a.name === 'class' || a.name.startsWith('data-')).map(a => (a.name === 'class' ? `.${a.value.trim().split(/\s+/).join('.')}` : `[${a.name}]`)).join('')}`;
            if (!reported.has(`plot ${name}`)) { reported.add(`plot ${name}`); unregistered.push(name); }
        }
    };
    const tick = (): void => { sample(); sampleReadouts(); samplePlots(); sampleSvgs(); window.requestAnimationFrame(tick); };
    window.requestAnimationFrame(tick);
}

/** The page with the audit installed by its first script, before any of its own run. */
export function withAuditFirst(html: string): string {
    const first = html.search(/<script\b/u);
    if (first < 0) return html;
    const nonce = /<script nonce="([^"]+)"/u.exec(html)?.[1];
    const script = `<script${nonce ? ` nonce="${nonce}"` : ''}>(${installCanvasAudit.toString()})(${JSON.stringify({ ...AUDIT, svgMin: SVG_CHART_MIN })});</script>`;
    return html.slice(0, first) + script + html.slice(first);
}

export const test = base.extend<{ canvasAudit: void }>({
    canvasAudit: [async ({ page }, use) => {
        await page.addInitScript(installCanvasAudit, { ...AUDIT, svgMin: SVG_CHART_MIN });
        // setContent writes the document without a navigation, so the init script does not run for it: the audit goes
        // in as the document's first script (with the page's nonce), so the first drawing is audited too.
        const setContent = page.setContent.bind(page);
        page.setContent = async (html, options) => {
            await setContent(withAuditFirst(html), options);
            await page.evaluate(installCanvasAudit, { ...AUDIT, svgMin: SVG_CHART_MIN });
        };
        await use();
        // A page the test closed has nothing left to check; any other failure to read the audit fails the test.
        if (page.isClosed()) return;
        const found = await page.evaluate(() => window.__canvasAudit ?? []);
        base.expect.soft(found, 'canvases left drawn at another size than they are shown at').toEqual([]);
        const over = await page.evaluate(() => window.__readoutAudit ?? []);
        base.expect.soft(over, 'hover readouts shown over a plot, or their values cut off (R7: each has its own row outside the plots)').toEqual([]);
        const unregistered = await page.evaluate(() => window.__plotAudit ?? []);
        base.expect.soft(unregistered, 'plots on screen not drawn by the plot component (R13: draw them with paintOverlay, or list them in plotRegistry.ts while they wait)').toEqual([]);
        const drawnOutsideFound = await page.evaluate(() => window.__drawnAudit ?? []);
        base.expect.soft(drawnOutsideFound, 'plots drawn into outside the plot component (R13: draw it as a layer of paintOverlay, or list it in plotRegistry.ts while it waits)').toEqual([]);
        const misorderedFound = await page.evaluate(() => window.__orderAudit ?? []);
        base.expect.soft(misorderedFound, 'plots that drew a louder compared line over a quieter one (R6: paintOverlay draws the quietest last, on top)').toEqual([]);
        const svgFound = await page.evaluate(() => window.__svgAudit ?? []);
        base.expect.soft(svgFound, 'charts drawn as SVG (R13: draw them with paintOverlay, or list them in plotRegistry.ts while they wait)').toEqual([]);
    }, { auto: true }],
});
