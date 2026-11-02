/**
 * Every ui-smoke test runs with this check: a canvas on screen whose bitmap stays a size other than the one it is
 * shown at fails the test. Such a canvas was drawn before a layout change resized it (Δ opened under a plot, the step
 * bar grown over it) and not drawn again, so the browser stretches its picture while the hover marks are drawn at
 * the new size: every hovered line looks doubled. Specs import `test` and `expect` from here, not '@playwright/test'.
 */
import { test as base } from '@playwright/test';

export * from '@playwright/test';

/**
 * How long a canvas may stay at another size than it is shown at: a resize is drawn again within a frame or two,
 * so 6 frames and 100 ms (both, for a slow machine's long frames) is a canvas that will not be drawn again.
 */
const SETTLE = { frames: 6, ms: 100 };

declare global {
    interface Window { __canvasAudit?: string[] }
}

/** Runs in the page: samples the canvases on screen and records each one that stayed at another size. */
function installCanvasAudit(settle: { frames: number; ms: number }): void {
    if (window.__canvasAudit) return;
    const found: string[] = [];
    window.__canvasAudit = found;
    const since = new Map<HTMLCanvasElement, { frame: number; at: number }>();
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
    const tick = (): void => { sample(); window.requestAnimationFrame(tick); };
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
        const found = await page.evaluate(() => window.__canvasAudit ?? []).catch(() => []);
        base.expect(found, 'canvases left drawn at another size than they are shown at').toEqual([]);
    }, { auto: true }],
});
