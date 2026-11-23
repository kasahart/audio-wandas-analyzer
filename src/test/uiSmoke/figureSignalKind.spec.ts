import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, openEntry, type ScannedFile } from './entryHelpers';
import { readTimingText, startReadTiming } from './readTiming';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * The sound itself in the comparison: the time signals overlaid by the one Figure of the new path, a
 * band each (drawn and read by the figure service), with their Δ lane, through the REAL backend.
 *
 * Checked: the base recording's and the compared recording's signals are each a line of at most two samples per two
 * pixels, in the declared order; the sample read is the service's (a real sample at its own time), the mark at its
 * place; ← → step one sample; a box zoom draws the part again, every sample as itself once there are few; the Δ lane
 * is compare − base sample by sample, named and headed in the signal's unit; and how long a read takes from the
 * pointer's move to the readout.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
let files: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'figure-signal-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'narrow', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    try {
        backend = new RealBackend();
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe, stage: String(recipe.output) }) });
        files = scanned;
    } catch (error) {
        fixtureError = error instanceof Error ? error.message : String(error);
    }
});
test.afterAll(() => {
    backend?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
});

const ready = (): boolean => {
    if (!files && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the narrow fixture could not be analysed: ${fixtureError}`);
    return !!files;
};

interface Seen {
    waiting: boolean; pictureId: string | null; readout: string; headline: string; failure: string | null;
    lanes: Array<{
        id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; axisNames: { x: string; y: string };
        lines: Array<{ id: string; colour: string; points: Array<[number, number] | null> }>;
    }>;
    mark: { line: string; index: number; x: number; value: number; px: number; py: number } | null;
}
const PREVIEW = '[data-stage-figure] canvas[data-figure]';
const seen = (page: Page): Promise<Seen> => page.locator(PREVIEW).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
const drawn = async (page: Page): Promise<Seen> => {
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && (now.lanes[0]?.lines.length ?? 0) > 0; }, { timeout: 30_000, message: 'the Figure drew its signals' }).toBe(true);
    return seen(page);
};
/** The base in slot 0, the compared recording in slot 1, the comparison opened on its input (the sound itself). */
async function openComparison(page: Page): Promise<() => Promise<string[]>> {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openEntry(page, files!, { language: 'en', recipe });
    const stop = await bridgeComparison(page, backend!, recipe);
    await page.keyboard.press('0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const paths = files!.map(file => file.filePath);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.1, fullScale: true, waveform: { min: [-0.1, -0.1], max: [0.1, 0.1], minT: [0.1, 1.1], maxT: [0.4, 1.4], absolutePeak: 0.1 } }],
    })) } })), paths);
    await expect(page.locator('.track-stage')).toBeVisible();
    // The first opening shows the input: the sound itself.
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-stage', 'node-input', { timeout: 30_000 });
    return stop;
}

test('the sound itself is overlaid by the one Figure of the new path: its samples, reads, steps, zoom and Δ are the figure service\'s', async ({ page }, testInfo) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
    await expect(page.locator('[data-stage-canvas="overlay"]')).toBeHidden();
    await expect.poll(async () => (await seen(page)).lanes[0]?.lines.length ?? 0, { timeout: 30_000 }).toBe(2);
    const first = await drawn(page);
    expect(first.failure).toBeNull();
    const [lane] = first.lanes;
    expect(first.lanes.map(item => item.id)).toEqual(['overlay']);
    expect(lane.axisNames).toEqual({ x: 'Time [s]', y: 'Amplitude, uncalibrated [FS]' });
    // The base recording, then the compared recording (the declared order, spec 1): a line each (no median of time signals).
    expect(lane.lines.map(line => line.id)).toEqual(['base1', 'compare1']);
    // 2 s at 16 kHz: 32,000 samples, drawn as each bucket's lowest and highest: two buckets a pixel (a time signal's
    // density, thinning.py BAND_BUCKETS_PER_PX: dense enough that a steady tone is a filled band, not a zigzag), with
    // the sample past each end.
    for (const line of lane.lines) {
        expect(line.points.length).toBeGreaterThan(lane.frame.width * 2);
        expect(line.points.length).toBeLessThanOrEqual(2 * Math.ceil(lane.frame.width * 2) + 2);
    }
    expect(lane.range!.x[0]).toBe(0);
    expect(lane.range!.x[1]).toBeCloseTo(2 - 1 / 16000, 9);
    expect(lane.range!.y[0]).toBe(-lane.range!.y[1]);

    // A read: a real sample (62.5 µs apart) at its own time.
    const box = (await page.locator(PREVIEW).boundingBox())!;
    const at = { x: lane.frame.left + lane.frame.width * 0.4, y: lane.frame.top + lane.frame.height * 0.5 };
    await startReadTiming(page, PREVIEW);
    const times: number[] = [];
    for (let move = 0; move < 12; move += 1) {
        const before = (await seen(page)).mark;
        const started = Date.now();
        await page.mouse.move(box.x + at.x + move * 9, box.y + at.y + (move % 2) * 3);
        await expect.poll(async () => { const mark = (await seen(page)).mark; return !!mark && mark.index !== before?.index; }, { timeout: 15_000, intervals: [5] }).toBe(true);
        times.push(Date.now() - started);
    }
    await settled(page);
    const read = await seen(page);
    const mark = read.mark!;
    expect(mark.x * 16000, 'the time read is a real sample\'s').toBeCloseTo(mark.index, 6);
    expect(Math.abs(mark.px - (at.x + 11 * 9)), 'the mark is within the pick radius of the pointer').toBeLessThanOrEqual(21);
    expect(read.readout).toMatch(/ \/ \d+\.\d{4,6} s \/ −?[\d.]+(e−?\d+)? FS$/u);
    const sorted = [...times].sort((a, b) => a - b);
    testInfo.annotations.push({ type: 'read round trip (ms, pointer move to readout, 12 moves)', description: `median ${sorted[6]}, max ${sorted[11]}` });
    testInfo.annotations.push({ type: 'read, the page\'s own part', description: await readTimingText(page) });

    // The arrow keys step one sample.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await seen(page)).mark?.index, { timeout: 15_000 }).toBe(mark.index + 1);
    const stepped = (await seen(page)).mark!;
    expect(stepped.x - mark.x).toBeCloseTo(1 / 16000, 9);
    expect(stepped.line).toBe(mark.line);

    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'signal-overlay.png') });

    // A box zoom onto a few milliseconds: the part is drawn again, every sample there as itself.
    const from = { x: lane.frame.left + lane.frame.width * 0.5, y: lane.frame.top + lane.frame.height * 0.2 };
    const to = { x: from.x + lane.frame.width * 0.012, y: lane.frame.top + lane.frame.height * 0.8 };
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.pictureId !== first.pictureId && (now.lanes[0]?.range?.x[1] ?? 9) < 1.1; }, { timeout: 30_000 }).toBe(true);
    const zoomed = (await seen(page)).lanes[0];
    const span = zoomed.range!.x[1] - zoomed.range!.x[0];
    expect(span).toBeLessThan(0.03);
    const samples = Math.floor(zoomed.range!.x[1] * 16000 + 1e-6) - Math.ceil(zoomed.range!.x[0] * 16000 - 1e-6) + 1;
    // Every sample inside, and the one past each end (the line reaches the frame's edges).
    expect(zoomed.lines[0].points.length).toBe(samples + 2);
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'signal-zoomed.png') });

    // Δ: a lane under the overlay sharing the time axis, compare − base sample by sample, in the signal's unit. The
    // two recordings differ only by a tone of amplitude 0.002 (the narrow fixture): the Δ's largest sample is that.
    await page.keyboard.press('0');
    await page.locator('[data-action="stage-diff"]').click();
    await expect.poll(async () => (await seen(page)).lanes.map(item => item.id), { timeout: 30_000 }).toEqual(['overlay', 'delta']);
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && (now.lanes[1]?.lines.length ?? 0) === 1; }, { timeout: 30_000 }).toBe(true);
    const both = await seen(page);
    expect(both.lanes[1].axisNames).toEqual({ x: 'Time [s]', y: 'Δ Amplitude, uncalibrated [FS]' });
    expect(both.lanes[1].range!.x).toEqual(both.lanes[0].range!.x);
    expect(both.lanes[1].range!.y[0]).toBe(-both.lanes[1].range!.y[1]);
    expect(both.lanes[1].range!.y[1]).toBeGreaterThanOrEqual(0.002);
    expect(both.lanes[1].range!.y[1]).toBeLessThan(0.003);
    await expect(page.locator('[data-stage-figure-headline]')).toHaveText(/^largest Δ \d+\.\d{4,6} s [+−]0\.0020\d* FS$/u);
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'signal-delta.png') });
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

/**
 * A trigger's events: each event of each recording is a line of the one Figure over the time from
 * its trigger, cut and kept by the real backend (transport/figure_answers.py: an event's key is its step's with its
 * number). Checked: the lines are the base's events then the compared recording's, by their number; the axis is the
 * time from the trigger in the signal's unit; a read names the event and where in the recording it was cut; a click on
 * a line itself leaves that event out (the tracks under it say so) and a click in the empty part of the plot nothing.
 */
test('the sound itself, thinned to several points a pixel, is painted as the pixels its lines cover, not stroked: a painting of it takes a few ms, not hundreds', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    await expect.poll(async () => (await seen(page)).lanes[0]?.lines.length ?? 0, { timeout: 30_000 }).toBe(2);
    const first = await drawn(page);
    const colours = first.lanes[0].lines.map(line => line.colour);
    expect(colours.length).toBe(2);
    // What the Figure's canvas is given while it paints again (a resize: everything is painted again).
    await page.locator(PREVIEW).evaluate(target => {
        const w = window as unknown as { __strokes: string[]; __images: number; __paintings: number };
        w.__strokes = []; w.__images = 0; w.__paintings = 0;
        const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...rest: unknown[]) => unknown>;
        const { stroke, drawImage, clearRect } = proto;
        proto.stroke = function(this: CanvasRenderingContext2D, ...args: unknown[]) { if (this.canvas === target && !this.getLineDash().length) w.__strokes.push(typeof this.strokeStyle === 'string' ? this.strokeStyle : ''); return stroke.apply(this, args); };
        proto.drawImage = function(this: CanvasRenderingContext2D, ...args: unknown[]) { if (this.canvas === target) w.__images += 1; return drawImage.apply(this, args); };
        proto.clearRect = function(this: CanvasRenderingContext2D, ...args: unknown[]) { if (this.canvas === target && Number(args[0]) === 0 && Number(args[1]) === 0) w.__paintings += 1; return clearRect.apply(this, args); };
    });
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width - 40, height: size.height });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __paintings: number }).__paintings), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => !(await seen(page)).waiting, { timeout: 30_000 }).toBe(true);
    await settled(page);
    const given = await page.evaluate(() => { const w = window as unknown as { __strokes: string[]; __images: number }; return { strokes: w.__strokes, images: w.__images }; });
    expect(given.images, 'the lines are put as an image').toBeGreaterThan(0);
    expect(given.strokes.filter(colour => colours.includes(colour)), 'a dense time signal is not stroked: three took 130 ms and more to stroke a painting. Fix: the Figure paints a band lane\'s dense lines with paintDenseLines (src/webview/figure/denseLine.ts)').toEqual([]);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a trigger\'s events are lines of the one Figure of the new path: each event of each recording by its number, read and left out by a click on its line', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: 'Average spectrum' }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    await expect(page.locator('[data-stage-headline]')).toHaveText(/^\d+ events in the base, \d+ in the compared$/u, { timeout: 60_000 });
    const [, inBase, inCompared] = /^(\d+) events in the base, (\d+) in the compared$/u.exec((await page.locator('[data-stage-headline]').textContent()) ?? '')!.map(Number);
    expect(inBase).toBeGreaterThan(0);
    expect(inCompared).toBeGreaterThan(0);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
    await expect.poll(async () => (await seen(page)).lanes[0]?.lines.length ?? 0, { timeout: 30_000 }).toBe(inBase + inCompared);
    const first = await drawn(page);
    expect(first.failure).toBeNull();
    const [lane] = first.lanes;
    expect(first.lanes.map(item => item.id)).toEqual(['overlay']);
    expect(lane.axisNames).toEqual({ x: 'Time from trigger [s]', y: 'Amplitude, uncalibrated [FS]' });
    expect(lane.lines.map(line => line.id)).toEqual([
        ...Array.from({ length: inBase }, (_, at) => `base1#${at + 1}`), ...Array.from({ length: inCompared }, (_, at) => `compare1#${at + 1}`),
    ]);
    // The events begin before their trigger (the time before it is negative) and are cut to one length.
    expect(lane.range!.x[0]).toBeLessThanOrEqual(0);
    expect(lane.range!.x[1]).toBeGreaterThan(0);

    // The tracks under the events, marked: nothing left out yet.
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked')), { timeout: 60_000 }).toBeGreaterThan(0);
    const out = page.locator('[data-action="stage-event-toggle"][data-out="true"]');
    await expect(out).toHaveCount(0);
    // They are lanes of a Figure of their own under the events' (a lane a recording, over the recording's own time):
    // the signal as the trigger takes it, the trigger's level, a line where each event fired, each stretch cut and the
    // count of the events used, all the figure service's of the kept answers.
    type Under = { waiting: boolean; failure: string | null; lanes: Array<{ id: string; axisNames: { x: string; y: string }; range: { x: [number, number]; y: [number, number] } | null;
        guides: Array<{ axis: string; at: number; id?: string; out?: boolean }>; spans?: Array<{ start: number; end: number }>; events?: { used: number; total: number }; lines: Array<{ id: string; points: unknown[] }> }> };
    const under = (): Promise<Under> => page.locator('[data-stage-lanes-figure] canvas[data-figure]').evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Under }).__figureInspect());
    await expect.poll(async () => { const now = await under(); return !now.waiting && now.lanes.length === 2 && now.lanes.every(item => item.events); }, { timeout: 60_000 }).toBe(true);
    const lanes = await under();
    expect(lanes.failure).toBeNull();
    expect(lanes.lanes.map(item => item.id)).toEqual(['track1', 'track2']);
    expect(lanes.lanes.map(item => item.events!.total).sort()).toEqual([inBase, inCompared].sort());
    for (const item of lanes.lanes) {
        expect(item.axisNames.x).toBe('Time [s]');
        expect(item.lines).toHaveLength(1);
        expect(item.lines[0].points.length).toBeGreaterThan(10);
        expect(item.events!.used).toBe(item.events!.total);
        const fired = item.guides.filter(guide => guide.axis === 'x');
        expect(fired.map(guide => guide.id)).toEqual(Array.from({ length: item.events!.total }, (_, at) => `event:${at}`));
        // Each event was cut from before its firing: its stretch begins at or before it and is as long as every other.
        expect(item.spans).toHaveLength(item.events!.total);
        item.spans!.forEach((span, at) => { expect(span.start).toBeLessThanOrEqual(fired[at].at); expect(span.end - span.start).toBeCloseTo(item.spans![0].end - item.spans![0].start, 9); });
        // The level is in sight, between the signal's ends.
        const level = item.guides.find(guide => guide.id === 'threshold')!;
        expect(level.at).toBeGreaterThan(item.range!.y[0]);
        expect(level.at).toBeLessThan(item.range!.y[1]);
        // The lanes are looked at together: one axis across, one range up.
        expect(item.range).toEqual(lanes.lanes[0].range);
    }
    // A control per event over its line (where they have room), and each lane's count.
    await expect(page.locator('.stage-event-count')).toHaveCount(2);
    expect(await page.locator('[data-action="stage-event-play"]').count()).toBeGreaterThan(0);

    // A place where no line is (above the tone's peaks): the point under it is read, and a click leaves nothing out.
    const box = (await page.locator(PREVIEW).boundingBox())!;
    const across = lane.frame.left + lane.frame.width * 0.5;
    await page.mouse.move(box.x + across, box.y + lane.frame.top + 3);
    await expect.poll(async () => (await seen(page)).mark !== null, { timeout: 15_000 }).toBe(true);
    await settled(page);
    expect((await seen(page)).readout).toMatch(/ #\d+ @ \d+\.\d\d s \/ −?\d+\.\d+ m?s \/ −?[\d.]+(e−?\d+)? FS$/u);
    const onLine = (): Promise<boolean> => page.locator(PREVIEW).evaluate(canvas => (canvas as HTMLElement).style.cursor === 'pointer');
    if (!await onLine()) {
        await page.mouse.click(box.x + across, box.y + lane.frame.top + 3);
        await settled(page);
        await expect(out).toHaveCount(0);
    }
    // On a line itself (the point read, at its place): the cursor says a click acts on it, and it leaves that event out.
    const mark = (await seen(page)).mark!;
    await page.mouse.move(box.x + mark.px, box.y + mark.py);
    await expect.poll(onLine, { timeout: 15_000 }).toBe(true);
    await settled(page);
    const on = (await seen(page)).mark!;
    await expect(page.locator('#hint-footer')).toHaveText('click to leave out');
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'trigger-events.png') });
    await page.mouse.click(box.x + on.px, box.y + on.py);
    await expect(out).toHaveCount(1, { timeout: 30_000 });
    expect(await out.getAttribute('data-event')).toBe(String(Number(on.line.split('#')[1]) - 1));
    // Its lane counts one fewer, its line fainter and its stretch no longer shaded (the service's, of the event left out).
    await expect.poll(async () => { const now = await under(); return now.waiting ? -1 : now.lanes.reduce((sum, item) => sum + (item.events?.used ?? 0), 0); }, { timeout: 30_000 }).toBe(inBase + inCompared - 1);
    const less = (await under()).lanes.find(item => item.events!.used < item.events!.total)!;
    expect(less.guides.filter(guide => guide.out).map(guide => guide.id)).toEqual([`event:${Number(on.line.split('#')[1]) - 1}`]);
    expect(less.spans).toHaveLength(less.events!.used);
    // Still a line of the Figure (drawn faint), clicked back.
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && (now.lanes[0]?.lines.length ?? 0); }, { timeout: 30_000 }).toBe(inBase + inCompared);
    await page.mouse.move(box.x + on.px, box.y + on.py + 1);
    await page.mouse.move(box.x + on.px, box.y + on.py);
    await expect(page.locator('#hint-footer')).toHaveText('left out · click to put back', { timeout: 15_000 });
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'trigger-event-out.png') });
    await settled(page);
    await page.mouse.click(box.x + on.px, box.y + on.py);
    await expect(out).toHaveCount(0, { timeout: 30_000 });
    expect(await stop(), 'the backend answered every request').toEqual([]);
});
