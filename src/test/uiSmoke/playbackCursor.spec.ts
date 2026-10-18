import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

async function amberPixelCount(page: Page, canvasId: string): Promise<number> {
    return page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 60 && r > b * 1.6 && g > b * 1.2 && r >= g) {
                count += 1;
            }
        }
        return count;
    }, canvasId);
}

test('playback hides the analysis window band and leaves the cursor at the track end', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => amberPixelCount(page, 'track-canvas-0')).toBeGreaterThan(0);
    const ended = page.evaluate(() => new Promise<void>((resolve) => {
        const audio = document.getElementById('track-audio-0') as HTMLAudioElement;
        audio.muted = true;
        // Real output devices report the position in coarse steps, so the last frame before 'ended' can sit well short of the end.
        const position = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
        Object.defineProperty(audio, 'currentTime', {
            configurable: true,
            get() { return Math.min(position.get!.call(this), 1.8); },
            set(value: number) { position.set!.call(this, value); },
        });
        audio.addEventListener('ended', () => resolve(), { once: true });
    }));

    await page.locator('[data-action="toggle-playback"][data-track-id="track-1"]').click();
    await expect.poll(() => page.evaluate(() => (document.getElementById('track-audio-0') as HTMLAudioElement).currentTime)).toBeGreaterThan(0.3);
    expect(await amberPixelCount(page, 'track-canvas-0')).toBe(0);

    await ended;
    // The demo track is 2 s long.
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/^@ 0:02\.00/);
    await expect(page.locator('[data-action="toggle-playback"][data-track-id="track-1"]')).toHaveText('▶');
});
