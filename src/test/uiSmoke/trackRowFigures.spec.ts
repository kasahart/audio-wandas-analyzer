import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { buildUiSmokeRowFiguresHtml } from './buildHtml';
import { backendRequired } from './entryHelpers';
import { bridgeComparison, backendPython, RealBackend } from './realBackend';
import { pointOnLane, seenFigure, type Seen } from './tracksFigures';

/**
 * The Tracks screen's rows on the Figure path: a channel's waveform and spectrogram are one Figure,
 * drawn by the figure service from the answers the REAL backend keeps (`track-answers`), on the screen's own state.
 *
 * Checked: the row asks its answers once and draws both lanes beside the rows' axis column; a click puts the cursor
 * at the time of the sample read there; a box drawn on the waveform is the screen's time on screen (the ruler's too),
 * and the 0 key is the screen's reset; Shift+drag shifts the recording's place in time; a row zoomed past the
 * whole file's columns, or boxed to a narrow band, shows the frames and the bins that are there (R3); zoomed or
 * scrolled, the waveform's range up stays the whole recording's (R16); Alt+drag shows its loop while dragged (R17).
 */
const RATE = 8000, SECONDS = 2, LONG_SECONDS = 120;
const ROW = '#track-row-figure-0 canvas[data-figure]';
let backend: RealBackend | undefined;
let folder = '';
let sound = '';
let longSound = '';
let backendError = '';

/** 2 s of a tone: 440 Hz at half of full scale, then 1 kHz at a quarter of it (16-bit PCM, mono). */
function writeSound(filePath: string, seconds = SECONDS): void {
    const count = RATE * seconds;
    const data = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i += 1) {
        const late = i >= count / 2;
        data.writeInt16LE(Math.round(32767 * (late ? 0.25 : 0.5) * Math.sin((2 * Math.PI * (late ? 1000 : 440) * i) / RATE)), i * 2);
    }
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28);
    head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    writeFileSync(filePath, Buffer.concat([head, data]));
}

test.beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'row-figures-ui-'));
    sound = path.join(folder, 'two-tones.wav');
    writeSound(sound);
    longSound = path.join(folder, 'two-tones-long.wav');
    writeSound(longSound, LONG_SECONDS);
    if (!backendPython()) { backendError = 'no Python found'; return; }
    try { backend = new RealBackend(); } catch (error) { backendError = error instanceof Error ? error.message : String(error); }
});
test.afterAll(() => {
    backend?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
});

const ready = (): boolean => {
    if (!backend && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but could not run: ${backendError}`);
    return !!backend;
};

async function openRows(page: Page, file = sound, seconds = SECONDS, autoStft = false): Promise<() => Promise<string[]>> {
    await page.setViewportSize({ width: 1280, height: 900 });
    // With the automatic settings the track is the backend's own analysis of the file, as in the product: it names
    // the file's version and the STFT of the analysis, and the page takes a row's answers only when they are of both.
    const analysis = autoStft ? await backend!.request({ cmd: 'analyze', filePath: file }) : undefined;
    await page.setContent(buildUiSmokeRowFiguresHtml(file, { sampleRateHz: RATE, durationSeconds: seconds, autoStft, analysis }), { waitUntil: 'domcontentloaded' });
    return bridgeComparison(page, backend!, {}, true);
}
/** The row's Figure once both its lanes are drawn and it waits for no other picture. */
async function drawnRow(page: Page): Promise<Seen> {
    await expect.poll(async () => {
        const now = await seenFigure(page, ROW).catch(() => null);
        return !!now && !now.waiting && now.pictureId !== null && now.lanes.length === 2 && now.lanes[0].lines.length > 0 && !!now.lanes[1].image;
    }, { timeout: 30_000, message: 'the row drew its waveform and its spectrogram' }).toBe(true);
    return seenFigure(page, ROW);
}
const cursorAt = (page: Page): Promise<number> => page.locator('#tracks-wrapper').evaluate(el => Number((el as HTMLElement).dataset.cursorAt));

test('a row on the Figure path draws its waveform and spectrogram from the answers the backend keeps', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    const seen = await drawnRow(page);
    expect(seen.lanes.map(lane => lane.id)).toEqual(['wave', 'spectrogram']);
    // Beside the rows' axis column, one time axis for both lanes: the whole recording.
    expect(seen.lanes[0].frame.left).toBe(64);
    expect(seen.lanes[1].frame.left).toBe(64);
    expect(seen.lanes[0].range?.x).toEqual([0, SECONDS]);
    expect(seen.lanes[1].range?.x).toEqual([0, SECONDS]);
    // Up the spectrogram: 0 Hz to Nyquist, on a linear axis.
    expect(seen.lanes[1].range?.y).toEqual([0, RATE / 2]);
    expect(seen.lanes[1].yLog).toBe(false);
    // The time grid down the waveform is drawn over its band, as the old lanes drew it: a tone fills the lane, and a
    // line under it would not show, so no time could be read down the row (docs/display-rules.md, Tracks 行の縦線).
    const wave = seen.lanes[0];
    const line = (wave.grid ?? []).find(px => px > wave.frame.left + 4 && px < wave.frame.left + wave.frame.width - 4);
    expect(line, 'a time grid line down the waveform').toBeDefined();
    const colours = await page.locator(ROW).evaluate((canvas, at) => {
        const own = canvas as HTMLCanvasElement, ctx = own.getContext('2d')!, ratio = own.width / own.clientWidth;
        const pixel = (x: number): number[] => [...ctx.getImageData(Math.round(x * ratio), Math.round(at.y * ratio), 1, 1).data.slice(0, 3)];
        return { on: pixel(at.x), beside: pixel(at.x + 3) };
    }, { x: line!, y: wave.frame.top + wave.frame.height / 2 });
    expect(colours.on, 'the grid line shows through the waveform\'s band, not hidden under it').not.toEqual(colours.beside);
    // The lanes' own canvases are out of sight, the row says nothing, and its answers were asked once.
    await expect(page.locator('#track-canvas-0')).toBeHidden();
    await expect(page.locator('#track-row-figure-0 .track-row-says')).toBeHidden();
    const asked = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; answers?: string }> }).__uiSmokePostedMessages.filter(message => message.type === 'request-track-detail'));
    expect(asked.map(message => message.answers)).toEqual(['linear']);
    expect(await stop()).toEqual([]);
});

test('a click, a box and Shift+drag on a row are the screen\'s cursor, time on screen and offset', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    await drawnRow(page);
    // A click a quarter across: the cursor is at the time of the sample read there.
    const quarter = await pointOnLane(page, ROW, 'wave', 0.25);
    await page.mouse.move(quarter.x, quarter.y);
    await settled(page);
    await page.mouse.click(quarter.x, quarter.y);
    await expect.poll(() => cursorAt(page), { message: 'the cursor went to the time clicked' }).toBeCloseTo(0.5, 1);
    // A box from a quarter to a half across the waveform: the time on screen, on both lanes.
    const half = await pointOnLane(page, ROW, 'wave', 0.5, 0.9);
    await page.mouse.move(quarter.x, quarter.y - 10);
    await page.mouse.down();
    await page.mouse.move(half.x, half.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await seenFigure(page, ROW)).lanes[1].range?.x.map(end => Math.round(end * 100) / 100), { timeout: 15_000, message: 'both lanes show the box\'s time' }).toEqual([0.5, 1]);
    const zoomed = await drawnRow(page);
    expect(zoomed.lanes[0].range?.x.map(end => Math.round(end * 100) / 100)).toEqual([0.5, 1]);
    // The 0 key over the row is the screen's reset: the whole recording again.
    await page.keyboard.press('0');
    await expect.poll(async () => (await seenFigure(page, ROW)).lanes[0].range?.x, { timeout: 15_000 }).toEqual([0, SECONDS]);
    await drawnRow(page);
    // Shift+drag to the right: the recording starts later.
    const from = await pointOnLane(page, ROW, 'wave', 0.25);
    const to = await pointOnLane(page, ROW, 'wave', 0.5);
    await page.mouse.move(from.x, from.y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.locator('#offset-val-0')).toHaveText(/^\+0\.[45]\d\ds$/);
    expect(await stop()).toEqual([]);
});

const loopText = (page: Page): Promise<string | null> => page.locator('#loop-time-display').evaluate(el => ((el as HTMLElement).style.display === 'none' ? null : el.textContent));
const boxDrawn = (page: Page): Promise<unknown> => page.locator(ROW).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { box: unknown } }).__figureInspect().box);

test('Alt+drag on a row shows the loop while it is dragged, never a zoom box; dragging an end moves that end; let go where pressed puts the loop back (R17)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    await drawnRow(page);
    const rule = 'R17: an Alt+drag shows the loop it makes from its first move, not the box zoom\'s rubber band (figure.ts ranging, trackRowsScreen.ts ranging)';
    const at = (across: number) => pointOnLane(page, ROW, 'wave', across);
    const quarter = await at(0.25), middle = await at(0.5), late = await at(0.75);
    expect(await loopText(page)).toBeNull();
    // Pressed a quarter across, held, moved to the middle: the loop is there already, 0.5 s to 1 s, and no box.
    await page.mouse.move(quarter.x, quarter.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    await expect.poll(() => loopText(page), { message: `${rule}: the loop shows mid-drag` }).toMatch(/0:00\.50 – 0:01\.00/);
    expect(await boxDrawn(page), `${rule}: no zoom box is drawn`).toBeNull();
    // Further on, still held: the loop follows the pointer, from the same press.
    await page.mouse.move(late.x, late.y, { steps: 4 });
    await expect.poll(() => loopText(page), { message: `${rule}: the loop follows the pointer` }).toMatch(/0:00\.50 – 0:01\.50/);
    await page.mouse.up();
    await expect.poll(() => loopText(page)).toMatch(/0:00\.50 – 0:01\.50/);
    // Its end pressed and dragged back to the middle: the end moves while held, the start stays.
    await page.mouse.move(late.x, late.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    await expect.poll(() => loopText(page), { message: `${rule}: the end follows, the start stays` }).toMatch(/0:00\.50 – 0:01\.00/);
    await page.mouse.up();
    // A new loop dragged out and brought back to its press: let go there, it picks nothing, and the loop before is back.
    const early = await at(0.1);
    await page.mouse.move(early.x, early.y);
    await page.mouse.down();
    await page.mouse.move(quarter.x, quarter.y, { steps: 4 });
    await expect.poll(() => loopText(page)).toMatch(/0:00\.20 – 0:00\.50/);
    await page.mouse.move(early.x, early.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(() => loopText(page), { message: `${rule}: a drag that picks nothing puts the loop at its press back` }).toMatch(/0:00\.50 – 0:01\.00/);
    expect(await boxDrawn(page)).toBeNull();
    expect(await stop()).toEqual([]);
});

/** The askings of the rows' answers so far: the window each asked for (null: the whole file) and any band of frequencies. */
const askings = (page: Page): Promise<Array<{ window: [number, number] | null; band: boolean }>> => page.evaluate(() =>
    (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; answers?: string; startNorm?: number; endNorm?: number; lowHz?: number }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'request-track-detail' && !!message.answers)
        .map(message => ({ window: typeof message.startNorm === 'number' && typeof message.endNorm === 'number' ? [message.startNorm, message.endNorm] as [number, number] : null, band: typeof message.lowHz === 'number' })));

/** Opens the long recording, boxes a fortieth of it (3 s) on the waveform, and waits until the spectrogram there has more than twice the columns a second the whole file's had. */
async function zoomedLong(page: Page, autoStft: boolean): Promise<{ stop: () => Promise<string[]>; shown: [number, number] }> {
    const stop = await openRows(page, longSound, LONG_SECONDS, autoStft);
    const whole = (await drawnRow(page)).lanes[1];
    expect(whole.range?.x).toEqual([0, LONG_SECONDS]);
    // Not zoomed, the whole file's columns serve: nothing more is asked.
    expect(await askings(page)).toEqual([{ window: null, band: false }]);
    const perSecond = whole.image!.columns / LONG_SECONDS;
    const from = await pointOnLane(page, ROW, 'wave', 0.5, 0.2);
    const to = await pointOnLane(page, ROW, 'wave', 0.525, 0.8);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => {
        const now = await seenFigure(page, ROW);
        const image = now.lanes[1];
        return !now.waiting && !!image?.image && !!image.range && image.range.x[1] - image.range.x[0] < 4 ? image.image.columns / (image.range.x[1] - image.range.x[0]) : 0;
    }, { timeout: 30_000, message: 'R3: the zoomed spectrogram is drawn from the frames that are there, not from the whole file\'s columns stretched' }).toBeGreaterThan(perSecond * 2);
    return { stop, shown: (await seenFigure(page, ROW)).lanes[1].range!.x };
}

test('a row zoomed or scrolled onto its quiet half keeps the waveform\'s range up: the whole recording\'s (R16)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    const whole = (await drawnRow(page)).lanes[0].range!.y;
    // The tone is at half of full scale in the first second and at a quarter in the second: ± the half, with room.
    expect(whole[1]).toBeGreaterThan(0.5);
    // Ctrl+wheel zooms the time about the pointer at three quarters across (1.5 s) until only the quiet second is on
    // screen: the louder half is off screen. (A box would set the range up too: that is a range the user gives.)
    const quiet = await pointOnLane(page, ROW, 'wave', 0.75, 0.5);
    await page.mouse.move(quiet.x, quiet.y);
    await page.keyboard.down('Control');
    for (let notch = 0; notch < 8; notch += 1) await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await seenFigure(page, ROW)).lanes[0].range?.x[0] ?? 0, { timeout: 15_000, message: 'the row shows only the quiet second' }).toBeGreaterThan(1.05);
    const rule = 'R16: a waveform\'s automatic range up is of the whole recording, never of the part on screen (python-backend/figures/ranges.py whole_band)';
    expect((await drawnRow(page)).lanes[0].range!.y, `${rule}: zoomed onto the quiet half`).toEqual(whole);
    // Scrolled back by Shift+wheel: still the whole recording's.
    const start = (await seenFigure(page, ROW)).lanes[0].range!.x[0];
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await seenFigure(page, ROW)).lanes[0].range!.x[0], { timeout: 15_000, message: 'the wheel across moved the time on screen' }).not.toBe(start);
    expect((await drawnRow(page)).lanes[0].range!.y, `${rule}: scrolled`).toEqual(whole);
    expect(await stop()).toEqual([]);
});

test('with the automatic STFT, a row zoomed past the whole file\'s columns asks for the window on screen and draws that window\'s own frames (R3)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    test.setTimeout(120_000);
    const { stop, shown } = await zoomedLong(page, true);
    // The window asked for covers the time on screen and is a part of the file.
    const asked = (await askings(page)).filter(item => item.window).at(-1)?.window;
    expect(asked, 'the zoomed row asked for a window').toBeTruthy();
    expect(asked![0] * LONG_SECONDS).toBeLessThanOrEqual(shown[0] + 1e-3);
    expect(asked![1] * LONG_SECONDS).toBeGreaterThanOrEqual(shown[1] - 1e-3);
    expect(asked![1] - asked![0]).toBeLessThan(1);
    // Reset: the whole file's columns again, and no window is asked for.
    const count = (await askings(page)).length;
    await page.keyboard.press('0');
    await expect.poll(async () => (await seenFigure(page, ROW)).lanes[1].range?.x, { timeout: 15_000 }).toEqual([0, LONG_SECONDS]);
    await drawnRow(page);
    expect((await askings(page)).length).toBe(count);
    expect(await stop()).toEqual([]);
});

test('with STFT settings given, a zoomed row draws the frames of the whole file\'s STFT that are there, with nothing more asked (R3)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    test.setTimeout(120_000);
    const { stop } = await zoomedLong(page, false);
    expect(await askings(page)).toEqual([{ window: null, band: false }]);
    expect(await stop()).toEqual([]);
});

test('a zoomed row scrolled across shows at once what its last picture was drawn ahead: no blank strip while the next picture is on its way', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    test.setTimeout(120_000);
    const { stop, shown } = await zoomedLong(page, false);
    const before = await seenFigure(page, ROW);
    const [wave, image] = before.lanes;
    // The picture reaches the time shown again past each end (at least 0.4 of it here): the waveform's points and the spectrogram's cells.
    const xs = wave.lines[0].points.flatMap(point => (point ? [point[0]] : []));
    const ahead = 0.4 * wave.frame.width;
    expect(Math.min(...xs), 'the waveform is drawn ahead on the left').toBeLessThan(wave.frame.left - ahead);
    expect(Math.max(...xs), 'the waveform is drawn ahead on the right').toBeGreaterThan(wave.frame.left + wave.frame.width + ahead);
    expect(image.image!.edges.left, 'the spectrogram is drawn ahead on the left').toBeLessThan(image.frame.left - ahead);
    expect(image.image!.edges.right, 'the spectrogram is drawn ahead on the right').toBeGreaterThan(image.frame.left + image.frame.width + ahead);
    // The confirmed range is the time on screen all the same: what is read is unchanged.
    expect(image.range!.x).toEqual(shown);
    // Scrolled a third of the screen: on the first frame the range has moved, before the next picture is there, the
    // last picture covers the whole frame of both lanes.
    const at = await pointOnLane(page, ROW, 'wave', 0.5, 0.5);
    await page.mouse.move(at.x, at.y);
    const first = await page.evaluate(async ({ selector, x, y, by }) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean; mapped: boolean; lanes: Array<{ frame: { left: number; width: number }; range: { x: [number, number] } | null; lines: Array<{ points: Array<[number, number] | null> }>; image?: { edges: { left: number; right: number } } }> } };
        const start = canvas.__figureInspect().lanes[0].range!.x[0];
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: by, deltaY: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        for (let frame = 0; frame < 30; frame += 1) {
            const now = canvas.__figureInspect();
            if (now.lanes[0]?.range && now.lanes[0].range.x[0] !== start) {
                const points = now.lanes[0].lines[0].points.flatMap(point => (point ? [point[0]] : []));
                return { waiting: now.waiting, mapped: now.mapped, moved: now.lanes[0].range.x[0] - start, frame: now.lanes[0].frame, low: Math.min(...points), high: Math.max(...points), edges: now.lanes[1].image?.edges ?? null };
            }
            await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        }
        return null;
    }, { selector: ROW, x: at.x, y: at.y, by: wave.frame.width / 3 });
    expect(first, 'the wheel across moved the time on screen').not.toBeNull();
    expect(first!.moved).toBeGreaterThan(0);
    expect([first!.waiting, first!.mapped], 'the next picture is still on its way: the last one is drawn on the new range').toEqual([true, true]);
    expect(first!.low, 'the waveform reaches the frame\'s left edge').toBeLessThanOrEqual(first!.frame.left);
    expect(first!.high, 'the waveform reaches the frame\'s right edge').toBeGreaterThanOrEqual(first!.frame.left + first!.frame.width);
    expect(first!.edges!.left, 'the spectrogram reaches the frame\'s left edge').toBeLessThanOrEqual(first!.frame.left);
    expect(first!.edges!.right, 'the spectrogram reaches the frame\'s right edge').toBeGreaterThanOrEqual(first!.frame.left + first!.frame.width);
    await drawnRow(page);
    expect(await stop()).toEqual([]);
});

test('a zoomed row scrolled on and on shows the pictures asked on the way, not only the one after the last move', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    test.setTimeout(120_000);
    const { stop } = await zoomedLong(page, false);
    const at = await pointOnLane(page, ROW, 'wave', 0.5, 0.5);
    await page.mouse.move(at.x, at.y);
    // A tenth of the screen every 60 ms, never resting. The picture drawn before the first move reaches one screen
    // past the frame (ROW_AHEAD), so from the 25th move on nothing of it is on screen: whatever covers the frame
    // then, while the newest picture is still waited for, is a picture asked on the way.
    const seen = await page.evaluate(async ({ selector, x, y }) => {
        const canvas = document.querySelector(selector) as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean; lanes: Array<{ frame: { left: number; width: number }; lines: Array<{ points: Array<[number, number] | null> }>; image?: { edges: { left: number; right: number } } }> } };
        const covered: number[] = [];
        for (let move = 0; move < 110; move += 1) {
            const frame = canvas.__figureInspect().lanes[0].frame;
            canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: frame.width / 10, deltaY: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
            await new Promise(resolve => setTimeout(resolve, 60));
            const now = canvas.__figureInspect();
            const edges = now.lanes[1]?.image?.edges;
            const points = (now.lanes[0]?.lines[0]?.points ?? []).flatMap(point => (point ? [point[0]] : []));
            const left = Math.max(now.lanes[0].frame.left, edges?.left ?? Infinity, points.length ? Math.min(...points) : Infinity);
            const right = Math.min(now.lanes[0].frame.left + now.lanes[0].frame.width, edges?.right ?? -Infinity, points.length ? Math.max(...points) : -Infinity);
            covered.push(now.waiting ? Math.max(0, right - left) / now.lanes[0].frame.width : -1);
            if (move >= 25 && covered[move] > 0) break;
        }
        return covered;
    }, { selector: ROW, x: at.x, y: at.y });
    expect(seen.length, 'the row was scrolled past its first picture').toBeGreaterThan(25);
    expect(seen.at(-1), `the part of the frame covered while waiting, at each move (-1: not waiting): ${seen.map(part => part.toFixed(1)).join(' ')}`).toBeGreaterThan(0);
    await drawnRow(page);
    expect(await stop()).toEqual([]);
});

test('a row boxed to a narrow band draws that band\'s own bins from the answers kept, with nothing more asked (R3)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    const whole = (await drawnRow(page)).lanes[1];
    const perHz = whole.image!.rows / (RATE / 2);
    // A box over the whole time and a tenth of the lane's height, about the 1 kHz tone (a quarter up 0–4 kHz).
    const from = await pointOnLane(page, ROW, 'spectrogram', 0.02, 0.2);
    const to = await pointOnLane(page, ROW, 'spectrogram', 0.98, 0.3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => { const y = (await seenFigure(page, ROW)).lanes[1].range?.y; return y ? y[1] - y[0] : RATE; }, { timeout: 15_000, message: 'the lane shows the band boxed' }).toBeLessThan(600);
    const band = (await drawnRow(page)).lanes[1];
    expect(band.range!.y[0]).toBeLessThan(1000);
    expect(band.range!.y[1]).toBeGreaterThan(1000);
    // The band's own bins: more rows a hertz than the whole range's had (those were pooled to the lane's height).
    expect(band.image!.rows / (band.range!.y[1] - band.range!.y[0])).toBeGreaterThan(perHz * 2);
    // The figure service keeps every bin: the band is drawn from what the row asked at first.
    expect(await askings(page)).toEqual([{ window: null, band: false }]);
    expect(await stop()).toEqual([]);
});

test('the PNG of the rows is the ruler over each row\'s name and its Figure as drawn, the ruler over the plot as on the page, with the cursor line on the Figure, not beside it', async ({ page }) => {
    test.skip(!ready(), 'no Python backend here');
    const stop = await openRows(page);
    const seen = await drawnRow(page);
    const at = await pointOnLane(page, ROW, 'wave', 0.25);
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => cursorAt(page)).toBeGreaterThan(0);
    await settled(page);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-png"]')?.click());
    // The export waits for the cursor spectra asked for, which this page's bridge does not answer: the test does, with
    // the host's error (the image of the rows needs none of them).
    await expect.poll(() => page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId: string; analysisId: string; settingsSignature: string; trackIndex: number; filePath: string }> }).__uiSmokePostedMessages;
        const answered = ((window as unknown as { __slicesAnswered?: Set<string> }).__slicesAnswered ??= new Set());
        for (const message of posted) {
            if (message.type !== 'request-spectrum-slice' || answered.has(message.requestId)) continue;
            answered.add(message.requestId);
            window.postMessage({ type: 'spectrum-slice-error', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath, error: 'no spectra here' }, '*');
        }
        return (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.some(saved => saved.download === 'waveform-export.png');
    }), { timeout: 20_000 }).toBe(true);
    const lane = seen.lanes[1].frame;
    const got = await page.evaluate(async ({ lane }) => {
        const href = (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads.find(saved => saved.download === 'waveform-export.png')!.href;
        const image = new Image();
        image.src = href;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const ruler = document.getElementById('ruler-canvas') as HTMLCanvasElement;
        const figure = document.querySelector('#track-row-figure-0 canvas[data-figure]') as HTMLCanvasElement;
        const ratio = figure.width / figure.clientWidth;
        // The row's block starts under the ruler and the line its name is written on (18 CSS px); the ruler is as far
        // right of the Figure's left edge as the page has it (over the plot, past the axis room).
        const top = ruler.height + Math.round(18 * ratio);
        const rulerLeft = Math.round((ruler.getBoundingClientRect().left - figure.getBoundingClientRect().left) * ratio);
        // A cell in the middle of the spectrogram, away from the cursor: the image's, and the Figure's own.
        const x = Math.round((lane.left + lane.width * 0.6) * ratio), y = Math.round((lane.top + lane.height * 0.5) * ratio);
        const cursorX = Math.round((lane.left + lane.width * 0.25) * ratio);
        const pixel = (from: CanvasRenderingContext2D, px: number, py: number): number[] => [...from.getImageData(px, py, 1, 1).data.slice(0, 3)];
        const own = figure.getContext('2d')!;
        // Down the cursor's column of the row's block: how many pixels differ from the Figure's own (the line over it).
        let lined = 0;
        for (let py = 0; py < figure.height; py += 1) {
            const a = pixel(ctx, cursorX, top + py), b = pixel(own, cursorX, py);
            if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 24) lined += 1;
        }
        return { size: [image.width, image.height], stacked: [Math.max(rulerLeft + ruler.width, figure.width), top + figure.height], rulerLeft, cell: pixel(ctx, x, top + y), drawn: pixel(own, x, y), lined, rows: figure.height };
    }, { lane });
    expect(got.size, 'the ruler, and a name line and one block a row: the layer of lines is no block of its own').toEqual(got.stacked);
    expect(got.rulerLeft, 'the ruler starts right of the row\'s axis room').toBeGreaterThan(0);
    expect(got.cell, 'the row\'s block is its Figure as drawn, at its own place under the ruler').toEqual(got.drawn);
    expect(got.lined, 'the cursor line lies on the row').toBeGreaterThan(got.rows / 4);
    expect(await stop()).toEqual([]);
});

