import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChartSpec } from '../../shared/chartSpec';
import { renderChartSpecDocument } from '../../webview/panels/chartSpecDocument';

/** Serves the Recipe result document with the bundled ChartSpec renderer, as the panel loads it. */
async function openCharts(page: Page, charts: ChartSpec[]): Promise<void> {
    const html = renderChartSpecDocument('Recipe', charts, {
        language: 'en', nonce: 'n0', rendererScriptUri: './chartSpecRuntime.js', cspSource: "'self'",
    });
    await page.route('http://awa.test/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (!name) { await route.fulfill({ contentType: 'text/html', body: html }); return; }
        await route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(process.cwd(), 'dist/webview', name), 'utf8') });
    });
    await page.goto('http://awa.test/');
    await expect(page.locator('#charts canvas')).toHaveCount(charts.length);
}

/** Rows of the first series' colour (#4ea1ff) on chart `index`, as a fraction of the canvas height. */
async function lineRowSpan(page: Page, index: number): Promise<number> {
    return page.locator('#charts canvas').nth(index).evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let top = height, bottom = -1;
        for (let y = 0; y < height; y++) {
            // Right of the legend swatch, which shares the colour.
            for (let x = Math.floor(width * 0.4); x < Math.floor(width * 0.9); x++) {
                const i = (y * width + x) * 4;
                // Blue-dominant: also the antialiased half of a line clipped at the plot edge (coherence at 1).
                if (data[i + 2] > 100 && data[i + 2] - data[i] > 60 && data[i + 2] - data[i + 1] > 20) {
                    top = Math.min(top, y); bottom = Math.max(bottom, y);
                }
            }
        }
        return bottom < 0 ? -1 : (bottom - top + 1) / height;
    });
}

test('a transfer function flat at -6 dB, its phase and its coherence render as flat lines', async ({ page }) => {
    const n = 200;
    const xs = Array.from({ length: n }, (_, i) => i * 120);
    // The rounding noise of C = 0.5 * A: ±0.0002 dB, ±3e-5 rad, 1 ± 3e-7.
    const jitter = (center: number, amount: number) => xs.map((_, i) => center + (i % 2 ? amount : -amount));
    await openCharts(page, [
        { kind: 'line', title: 'TF', xLabel: 'Frequency [Hz]', yLabel: 'Gain [dB]', xs, yScale: 'db', series: [{ name: 'gain', ys: jitter(-6.0206, 2e-4) }] },
        { kind: 'line', title: 'TF (phase)', xLabel: 'Frequency [Hz]', yLabel: 'Phase [rad]', xs, yScale: 'linear', yMinSpan: 2 * Math.PI, series: [{ name: 'phase', ys: jitter(0, 3e-5) }] },
        { kind: 'line', title: 'Coherence', xLabel: 'Frequency [Hz]', yLabel: 'Coherence', xs, yScale: 'linear', yMin: 0, yMax: 1, series: [{ name: 'coh', ys: jitter(1 - 3e-7, 3e-7) }] },
        // A series with a real shape still fills the plot.
        { kind: 'line', title: 'Spectrum', xLabel: 'Frequency [Hz]', yLabel: 'Level [dB]', xs, yScale: 'db', series: [{ name: 'level', ys: xs.map((_, i) => -80 + 60 * Math.sin(i / 20) ** 2) }] },
    ]);
    for (const index of [0, 1, 2]) {
        const span = await lineRowSpan(page, index);
        expect(span, `chart ${index} line height`).toBeGreaterThan(0);
        expect(span, `chart ${index} line height`).toBeLessThan(0.03);
    }
    expect(await lineRowSpan(page, 3)).toBeGreaterThan(0.5);
});
