import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

/** Counts amber band pixels (the analysis-window fill and curve) per canvas column. */
async function amberColumns(page: Page, canvasId: string): Promise<number[]> {
    return page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Array<number>(canvas.width).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 60 && r > b * 1.6 && g > b * 1.2 && r >= g) {
                columns[(i / 4) % canvas.width] += 1;
            }
        }
        return columns;
    }, canvasId);
}

test('analysis window band follows the cursor on the track canvas and the header names it', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann -?\d+\.\d{3}–\d+\.\d{3} s \(\d+(\.\d+)? ms\)/);

    const canvas = page.locator('#track-canvas-0');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#spectrum-cursor-time')).not.toHaveText(/@ 0:00\.00/);
    await expect.poll(async () => {
        const columns = await amberColumns(page, 'track-canvas-0');
        const lit = columns.flatMap((count, x) => (count > 0 ? [x] : []));
        const middle = columns.length / 2;
        return lit.length > 0 && Math.min(...lit) < middle && Math.max(...lit) > middle && lit.every((x) => Math.abs(x - middle) < columns.length / 4);
    }).toBe(true);
});
