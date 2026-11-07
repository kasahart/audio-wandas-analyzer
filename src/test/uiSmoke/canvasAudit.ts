/**
 * Every ui-smoke test runs with this check: a canvas on screen whose bitmap stays a size other than the one it is
 * shown at fails the test. Such a canvas was drawn before a layout change resized it (Δ opened under a plot, the step
 * bar grown over it) and not drawn again, so the browser stretches its picture while the hover marks are drawn at
 * the new size: every hovered line looks doubled. Specs import `test` and `expect` from here, not '@playwright/test'.
 *
 * And with this one (R7): a hover's readout shown over a plot fails the test, whichever plot and readout it is. The
 * readout of every plot has a row of its own outside the plots, so the lines under the pointer stay in view.
 */
import { test as base } from '@playwright/test';

export * from '@playwright/test';

/**
 * How long a canvas may stay at another size than it is shown at: a resize is drawn again within a frame or two,
 * so 6 frames and 100 ms (both, for a slow machine's long frames) is a canvas that will not be drawn again.
 */
const SETTLE = { frames: 6, ms: 100 };

declare global {
    interface Window { __canvasAudit?: string[]; __readoutAudit?: string[] }
}

/** Runs in the page: samples the canvases on screen and records each one that stayed at another size. */
function installCanvasAudit(settle: { frames: number; ms: number }): void {
    if (window.__canvasAudit) return;
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
        const canvases = Array.from(document.querySelectorAll('canvas')).filter(canvas => !canvas.classList.contains('track-stage-cursor')).map(canvas => ({ canvas, box: seenBox(canvas) })).filter(item => item.box);
        for (const readout of readouts) {
            const box = shownBox(readout);
            if (!box) continue;
            for (const { canvas, box: plot } of canvases) {
                const across = Math.min(box.right, plot!.right) - Math.max(box.left, plot!.left);
                const up = Math.min(box.bottom, plot!.bottom) - Math.max(box.top, plot!.top);
                if (across <= 1 || up <= 1) continue;
                const name = `${readout.id ? `#${readout.id}` : `.${String(readout.className).trim().split(/\s+/).join('.')}`} over ${canvas.id ? `#${canvas.id}` : canvas.dataset.stageCanvas ? `[data-stage-canvas="${canvas.dataset.stageCanvas}"]` : `canvas.${canvas.className}`}`;
                if (!reported.has(name)) { reported.add(name); readoutsOver.push(`${name} ("${readout.textContent?.trim()}")`); }
            }
        }
    };
    const tick = (): void => { sample(); sampleReadouts(); window.requestAnimationFrame(tick); };
    window.requestAnimationFrame(tick);
}

export const test = base.extend<{ canvasAudit: void }>({
    canvasAudit: [async ({ page }, use) => {
        await page.addInitScript(installCanvasAudit, SETTLE);
        // setContent writes the document without a navigation, so the init script does not run for it.
        const setContent = page.setContent.bind(page);
        page.setContent = async (html, options) => {
            await setContent(html, options);
            await page.evaluate(installCanvasAudit, SETTLE);
        };
        await use();
        // A page the test closed has nothing left to check; any other failure to read the audit fails the test.
        if (page.isClosed()) return;
        const found = await page.evaluate(() => window.__canvasAudit ?? []);
        base.expect(found, 'canvases left drawn at another size than they are shown at').toEqual([]);
        const over = await page.evaluate(() => window.__readoutAudit ?? []);
        base.expect(over, 'hover readouts shown over a plot (R7: each has its own row outside the plots)').toEqual([]);
    }, { auto: true }],
});
