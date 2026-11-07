import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

/**
 * How many columns the analysis window band's curve lights (a light blue-grey, unlike the grey of a track without a role).
 * The cursor, in the theme's text colour, can be such a grey too: it is one line, so a band is more than a few columns.
 */
async function bandColumnCount(page: Page, canvasId: string): Promise<number> {
    return page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Set<number>();
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 150 && b - r >= 8 && g > r) {
                columns.add((i / 4) % canvas.width);
            }
        }
        return columns.size;
    }, canvasId);
}

test('playback hides the analysis window band and leaves the cursor at the track end', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => bandColumnCount(page, 'track-canvas-0')).toBeGreaterThan(3);
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
    expect(await bandColumnCount(page, 'track-canvas-0')).toBeLessThanOrEqual(3);

    await ended;
    // The demo track is 2 s long.
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/^@ 0:02\.00/);
    await expect(page.locator('[data-action="toggle-playback"][data-track-id="track-1"]')).toHaveText('▶');
});

test('a playback frame redraws only the cursor: the waveform is copied back, not traced again, and the axes, spectrogram and ruler stay as drawn', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => bandColumnCount(page, 'track-canvas-0')).toBeGreaterThan(3);
    const painted = () => page.evaluate(() => {
        const canvas = document.getElementById('track-canvas-0') as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
        return lit;
    });
    const before = await painted();
    await page.evaluate(() => {
        const audio = document.getElementById('track-audio-0') as HTMLAudioElement;
        audio.muted = true;
        const counts: Record<string, Record<string, number>> = {};
        const w = window as unknown as { __drawCounts: typeof counts; __counting: boolean };
        w.__drawCounts = counts;
        w.__counting = false;
        const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        for (const name of ['clearRect', 'drawImage']) {
            const original = proto[name];
            proto[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
                if (w.__counting) {
                    const entry = counts[this.canvas.id] ??= {};
                    entry[name] = (entry[name] ?? 0) + 1;
                }
                return original.apply(this, args);
            };
        }
    });
    await page.locator('[data-action="toggle-playback"][data-track-id="track-1"]').click();
    await expect.poll(() => page.evaluate(() => (document.getElementById('track-audio-0') as HTMLAudioElement).currentTime)).toBeGreaterThan(0.2);
    // Away from the lanes, so no hover readout is drawn.
    await page.mouse.move(0, 0);
    await page.evaluate(() => { (window as unknown as { __counting: boolean }).__counting = true; });
    await page.waitForTimeout(400);
    const counts = await page.evaluate(() => {
        const w = window as unknown as { __drawCounts: Record<string, Record<string, number>>; __counting: boolean };
        w.__counting = false;
        return w.__drawCounts;
    });
    const lane = counts['track-canvas-0'] ?? {};
    // The cursor moved over several frames, each copying the kept plot back and drawing one cursor line.
    expect(lane.clearRect ?? 0).toBeGreaterThan(3);
    expect(lane.drawImage ?? 0).toBeGreaterThanOrEqual(lane.clearRect ?? 0);
    // Nothing else on the lane follows the cursor: its axes, the spectrogram raster and the ruler stay as drawn.
    for (const id of ['track-axis-canvas-0', 'track-spec-axis-canvas-0', 'track-spec-canvas-0', 'ruler-canvas']) {
        expect(counts[id]?.clearRect ?? 0, id).toBe(0);
    }
    // The waveform is still on screen under the moving cursor.
    expect(await painted()).toBeGreaterThan(before * 0.5);
});
