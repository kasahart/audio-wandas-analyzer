import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, openEntry, type ScannedFile } from './entryHelpers';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * R2 on real data through the real path: a long recording the backend analyses (backend_server.py, as the host runs
 * it, src/test/fixtures/longSignal), drawn as a spectrogram whose 500 STFT frames are averaged into fewer columns. Each drawn column sits at the mean time of the frames it holds, so the first is a block's half-width after
 * the first frame and the last before the last frame. The whole view's horizontal axis is taken of the picture's
 * source axis (`xSource`, the frames' own first and last times), never of its first and last drawn columns: the
 * axis's range, as its range popover opens on it, is from the first frame to the last.
 *
 * If this fails with the range a few hundredths of a second short at either end, it was taken of the drawn points
 * (stagePanes.axisScale must read `xSource`, which stage_view.source_axis sends).
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const SAMPLE_RATE = 16000;
const SAMPLES = 2 * SAMPLE_RATE;
let files: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'long-signal-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'longSignal', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    // The entry Recipe with its average spectrum swapped for a spectrogram: 500 frames 4 ms apart, more than drawn.
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    const nodes = recipe.nodes as Array<Record<string, unknown>>;
    nodes[2] = { ...nodes[2], operation: 'wandas.audio.stft', version: 2, params: { $type: 'map', entries: [['hop_length', 64], ['n_fft', 256]] } };
    try {
        backend = new RealBackend();
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe }) });
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
    if (!files && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the long-signal fixture could not be analysed: ${fixtureError}`);
    return !!files;
};

/** The two recordings opened in the comparison on their spectrogram step, drawn by the backend. */
async function openSpectrogram(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, files!, { language: 'en', recipe });
    await bridgeComparison(page, backend!, recipe);
    // The first recording in slot 0, the second in slot 1.
    await page.keyboard.press('0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const paths = files!.map(file => file.filePath);
    await page.evaluate(({ paths, samples, rate }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: rate, durationSeconds: samples / rate, channelCount: 1, sampleCount: samples,
        channels: [{ label: 'L', peakAbsolute: 0.1, fullScale: true, waveform: { min: [-0.1, -0.1], max: [0.1, 0.1], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.1 } }],
    })) } })), { paths, samples: SAMPLES, rate: SAMPLE_RATE });
    const stage = page.locator('.track-stage');
    await expect(stage).toBeVisible();
    const bar = page.locator('.track-stage-bar');
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect(bar).toHaveAttribute('data-stage', 'node-2');
    // An image is drawn on each track's lane, its time axis in the lane's bottom margin.
    const lane = page.locator('.track-canvas').first();
    await expect.poll(async () => ({
        pending: await stage.getAttribute('data-pending'),
        axes: ((await lane.getAttribute('data-plot-axes')) ?? '') !== '',
    }), { timeout: 30_000 }).toEqual({ pending: '', axes: true });
    await settled(page);
}

test('a long recording\'s spectrogram, thinned to columns, has a whole view from its first STFT frame to its last, not from its first to its last drawn column (R2)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas: ${fixtureError}`);
    await openSpectrogram(page);
    const box = (await page.locator('.track-canvas').first().boundingBox())!;
    // The horizontal axis's range, as the popover opens it on the whole view (R13): its two ends.
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height - 6);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    const low = Number(await popover.locator('input[id$="-min"]').inputValue());
    const high = Number(await popover.locator('input[id$="-max"]').inputValue());
    // What the backend says of the compared recording's picture: its STFT frames' own first and last time (the
    // source axis, checked against wandas in test_drawn_x_is_source_x.py), and its first and last drawn column.
    const answer = await backend!.request({ cmd: 'scan', filePath: files![1].filePath, recipe, stage: 'node-2' }) as { stage: { xs: number[]; xSource: { first: number; last: number } } };
    const { xs, xSource } = answer.stage;
    const digits = (value: number): number => Number(value.toFixed(3));
    expect(digits(xs[0]) !== digits(xSource.first) && digits(xs[xs.length - 1]) !== digits(xSource.last), 'the drawn columns end inside the source, or this test shows nothing').toBe(true);
    expect(low, `the whole view starts at the first STFT frame, ${xSource.first} s, not at the first drawn column (${xs[0]} s): got ${low} s. Take the range of xSource (stagePanes.axisScale), never of the drawn xs (R2); the range box writes it exactly (R9)`).toBe(xSource.first);
    expect(high, `the whole view ends at the last STFT frame, ${xSource.last} s, not at the last drawn column (${xs[xs.length - 1]} s): got ${high} s. Take the range of xSource (stagePanes.axisScale), never of the drawn xs (R2); the range box writes it exactly (R9)`).toBe(xSource.last);
    await page.keyboard.press('Escape');
});
