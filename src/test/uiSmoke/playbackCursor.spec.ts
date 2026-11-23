import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';
import { CURSOR_FIGURE, drawnFigure, drawnRow, rowFigure } from './tracksFigures';


/** The layer over the first row's Figure: what follows the cursor (the cursor's line, the loop, the analysis window's band). */
const ROW_LAYER = '#track-row-figure-0 canvas.track-row-layer';

/**
 * How many columns the analysis window band's curve lights (a light blue-grey, unlike the grey of a track without a role).
 * The cursor, in the theme's text colour, can be such a grey too: it is one line, so a band is more than a few columns.
 */
async function bandColumnCount(page: Page, selector: string): Promise<number> {
    return page.evaluate((selector) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Set<number>();
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 150 && b - r >= 8 && g > r) {
                columns.add((i / 4) % canvas.width);
            }
        }
        return columns.size;
    }, selector);
}

test('playback hides the analysis window band and leaves the cursor at the track end', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => bandColumnCount(page, ROW_LAYER)).toBeGreaterThan(3);
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
    expect(await bandColumnCount(page, ROW_LAYER)).toBeLessThanOrEqual(3);

    await ended;
    // The demo track is 2 s long.
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/^@ 0:02\.00/);
    await expect(page.locator('[data-action="toggle-playback"][data-track-id="track-1"]')).toHaveText('▶');
});

test('a playback frame redraws only the layer of lines over the lanes: the waveform, its axes, the spectrogram and the ruler stay as drawn', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => bandColumnCount(page, ROW_LAYER)).toBeGreaterThan(3);
    // This page's recording has no spectrogram cells: the row is its waveform.
    await drawnRow(page, 0, 0, true);
    const painted = () => page.evaluate((selector) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
        return lit;
    }, rowFigure(0));
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
                    // A row's canvases have no id of their own: its Figure's and its layer's are named by the row's box.
                    const row = this.canvas.closest('.track-row-figure');
                    const entry = counts[this.canvas.id || (row ? `${row.id} ${this.canvas.classList.contains('track-row-layer') ? 'layer' : 'figure'}` : '')] ??= {};
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
    // The cursor moved over several frames, each drawing the layer over the lane again (R13: the layer holds only what
    // its painter drew).
    expect(counts['track-row-figure-0 layer']?.clearRect ?? 0).toBeGreaterThan(3);
    // Nothing else on the row follows the cursor: its Figure (the waveform, the spectrogram, their axes) and the ruler stay as drawn.
    for (const id of ['track-row-figure-0 figure', 'ruler-canvas']) {
        expect(counts[id]?.clearRect ?? 0, id).toBe(0);
        expect(counts[id]?.drawImage ?? 0, id).toBe(0);
    }
    // The waveform is still on screen under the moving cursor.
    expect(await painted()).toBeGreaterThan(before * 0.5);
});

test('the cursor spectrum\'s header names the time of the picture on show: it changes once the picture of the new time is drawn, not before', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await drawnFigure(page, CURSOR_FIGURE);
    // Every time written to the header, with whether the Figure was then waiting for a picture (the one before on show).
    await page.evaluate((figure) => {
        const el = document.getElementById('spectrum-cursor-time')!;
        const own = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
        const log: Array<{ time: string; waiting: string | undefined }> = [{ time: /^@ \S+/u.exec(el.textContent ?? '')?.[0] ?? '', waiting: 'false' }];
        (window as typeof window & { __cursorTimes: typeof log }).__cursorTimes = log;
        Object.defineProperty(el, 'textContent', {
            configurable: true,
            get() { return own.get!.call(this) as string; },
            set(value: string) {
                const time = /^@ \S+/u.exec(value)?.[0] ?? '';
                if (time !== log.at(-1)?.time) log.push({ time, waiting: document.querySelector<HTMLCanvasElement>(figure)?.dataset.figureWaiting });
                own.set!.call(this, value);
            },
        });
    }, CURSOR_FIGURE);
    for (const [cursorNorm, label] of [[.25, '0:00.50'], [.6, '0:01.20'], [.4, '0:00.80']] as const) {
        await page.evaluate(at => window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actions: [{ action: 'set-cursor', payload: { cursorNorm: at } }] } })), cursorNorm);
        await expect(page.locator('#spectrum-cursor-time')).toHaveText(new RegExp('^@ ' + label.replace('.', '\\.'), 'u'));
        await drawnFigure(page, CURSOR_FIGURE);
    }
    const log = await page.evaluate(() => (window as typeof window & { __cursorTimes: Array<{ time: string; waiting: string | undefined }> }).__cursorTimes);
    expect(log.map(entry => entry.time)).toEqual(['@ 0:00.00', '@ 0:00.50', '@ 0:01.20', '@ 0:00.80']);
    expect(log.filter(entry => entry.waiting === 'true')).toEqual([]);
});
