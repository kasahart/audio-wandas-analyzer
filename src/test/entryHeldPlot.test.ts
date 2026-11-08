import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { RecipeStep } from '../shared/recipe/recipeSteps';
import { TIME_SLICE } from '../shared/recipe/recipeSteps';
import { createHeldPlot, DELTA_RELEASE_MS, narrowed, TAP_MS, type HeldPlotDeps } from '../webview/runtime/entryHeldPlot';
import { buildCompareModel } from '../webview/runtime/comparePanes';
import { buildEntryModel } from '../webview/runtime/entryTable';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { stepChipLabel } from '../webview/runtime/stepBar';

const strings = getStrings('en');

/** A clock and timers the test moves by hand. */
function fakeWindow() {
    let now = 0, next = 1;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
        performance: { now: () => now },
        setTimeout: ((fn: () => void, ms = 0) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; }) as unknown as Window['setTimeout'],
        clearTimeout: ((id: number) => { timers.delete(id); }) as Window['clearTimeout'],
        advance(ms: number) {
            now += ms;
            for (const [id, timer] of [...timers].sort(([, a], [, b]) => a.at - b.at)) {
                if (timer.at > now) continue;
                timers.delete(id);
                timer.fn();
            }
        },
        pending: () => timers.size,
    };
}

/** A scanned one-channel recording. */
const scanned = (): ScanResult => ({
    ok: true, input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true },
    leqDbA: [60], peakHz: [100], spectrumDb: [[-40, -50, -60]], thirdOctDb: [[50, 40]], crest: [3], specVersion: 5,
});

const step = (patch: Partial<RecipeStep>): RecipeStep => ({ id: 'node-1', operation: 'wandas.frame.highpass_filter', name: 'highpass_filter', params: {}, editable: [], input: 'ChannelFrame', output: 'ChannelFrame', ...patch });

function setup(results = new Map<string, ScanResult>()) {
    const dom = new JSDOM('<!doctype html><body><div id="hint-footer"></div><div data-entry-held hidden><span data-entry-held-title></span><canvas data-entry-held-canvas></canvas></div></body>');
    const { document } = dom.window;
    const held = document.querySelector<HTMLElement>('[data-entry-held]');
    const title = document.querySelector<HTMLElement>('[data-entry-held-title]');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-entry-held-canvas]');
    assert.ok(held && title && canvas);
    // jsdom has no 2D context; the painter then draws nothing.
    canvas.getContext = (() => null) as HTMLCanvasElement['getContext'];
    const window = fakeWindow();
    const calls: Array<[string, unknown]> = [];
    const state = { focused: null as string | null, slots: [null, null, null, null] as (string | null)[] };
    const colored: string[] = [];
    const compared: Array<{ path: string; over: ReadonlyMap<string, ScanResult> }> = [];
    const deps: HeldPlotDeps = {
        document, window, strings, held, title, canvas,
        post: message => calls.push(['post', message]),
        scheduleSide: () => calls.push(['side', null]),
        keepWindow: () => FULL_PLOT_WINDOW,
        results,
        comparison: (path, over) => { compared.push({ path, over }); return buildCompareModel(buildEntryModel([...over].map(([filePath, result]) => ({ filePath, result })), null), over, path, null, strings, false, undefined, { paths: [...results.keys()].filter(file => file !== path), title: 'base' }); },
        basePaths: path => [...results.keys()].filter(file => file !== path),
        scanRecipe: () => undefined,
        focusedFile: () => state.focused, slotFiles: () => state.slots,
        colorOf: filePath => { colored.push(filePath); return `colour of ${filePath}`; },
        recipe: () => null, runRecipe: () => undefined, limits: () => ({}), spectral: () => true,
        tapped: slot => calls.push(['tapped', slot]),
    };
    const plot = createHeldPlot(deps);
    return { document, window, held, title, plot, calls, state, colored, compared };
}

test('a short press on a slot key is a tap; a long one shows the slot until 150 ms after it is let go', () => {
    const { window, plot, calls } = setup();
    plot.press(2);
    window.advance(TAP_MS - 1);
    plot.release(2);
    assert.deepEqual(calls, [['tapped', 2]]);
    assert.equal(plot.slot(), null);
    assert.equal(window.pending(), 0, 'the hold timer is gone');
    calls.length = 0;
    plot.press(1);
    plot.press(3);
    plot.release(3);
    assert.deepEqual(calls, [], 'a second key while one is pressed is not a press, nor its release');
    window.advance(TAP_MS);
    assert.equal(plot.slot(), 1);
    assert.deepEqual(calls, [['side', null]]);
    plot.release(1);
    window.advance(DELTA_RELEASE_MS - 1);
    assert.equal(plot.slot(), 1, 'the picture stays a moment');
    plot.press(2);
    window.advance(TAP_MS);
    assert.equal(plot.slot(), 2, 'a new hold takes over and cancels the old one\'s removal');
    window.advance(DELTA_RELEASE_MS);
    assert.equal(plot.slot(), 2);
    plot.release(2);
    window.advance(DELTA_RELEASE_MS);
    assert.equal(plot.slot(), null);
    assert.deepEqual(calls.at(-1), ['side', null]);
});

test('nothing held hides the plot; a held slot shows its file\'s Δ under its name', () => {
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()]]);
    const { window, held, title, plot, state, calls } = setup(results);
    held.hidden = false;
    plot.paint();
    assert.equal(held.hidden, true);
    state.slots = [null, '/d/a.wav', null, null];
    plot.press(1);
    window.advance(TAP_MS);
    plot.paint();
    assert.equal(held.hidden, false);
    assert.equal(title.textContent, '1 · a.wav');
    assert.equal(plot.picture(), null, 'a file alone has no base, so no Δ to point at');
    assert.deepEqual(calls.filter(([kind]) => kind === 'post'), [], 'nor any bins to ask for');
});

test('a held step needs a scanned row: without one the footer says so; let go, it goes 150 ms later', () => {
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/bad.wav', { ok: false, reason: 'x' }]]);
    const { document, window, held, title, plot, calls, state } = setup(results);
    state.focused = '/d/bad.wav';
    plot.holdStep(step({}));
    assert.equal(document.getElementById('hint-footer')?.textContent, strings.stepHeldNoRow);
    assert.deepEqual(calls, []);
    state.focused = null;
    state.slots = [null, '/d/a.wav', null, null];
    plot.holdStep(step({}));
    assert.deepEqual(calls, [['side', null]], 'slot 1 is the row without a focused one');
    plot.paint();
    assert.equal(held.hidden, false);
    assert.equal(title.textContent, strings.stepHeldRow.replace('{what}', strings.stepHeldWithout.replace('{step}', stepChipLabel(step({}), strings))).replace('{file}', 'a.wav'));
    plot.holdStep(null);
    window.advance(DELTA_RELEASE_MS - 1);
    plot.holdStep(step({}));
    window.advance(DELTA_RELEASE_MS);
    plot.paint();
    assert.equal(held.hidden, false, 'held again before it went, it stays');
    plot.holdStep(null);
    window.advance(DELTA_RELEASE_MS);
    plot.paint();
    assert.equal(held.hidden, true);
});

test('a step without a Recipe to draw from says it cannot be drawn; the region and unknown chains are not held', () => {
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()]]);
    const { held, title, plot, state } = setup(results);
    state.focused = '/d/a.wav';
    plot.holdStep(step({}));
    plot.paint();
    assert.equal(held.classList.contains('is-pending'), false);
    assert.equal(title.textContent, strings.stepHeldRow.replace('{what}', strings.stepHeldWithout.replace('{step}', stepChipLabel(step({}), strings))).replace('{file}', 'a.wav'));
    assert.equal(plot.picture(), null);
    assert.equal(plot.canHold(step({ operation: TIME_SLICE })), false);
    assert.equal(plot.canHold(step({})), false, 'no Recipe: nothing to hold');
    assert.equal(plot.handle({ type: 'entry-scan-result' }), false);
});

test('a held step draws its row in the colour the row is drawn in elsewhere (its role\'s, else its own), not always slot 1\'s yellow (R5)', () => {
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/b.wav', scanned()]]);
    const { plot, state, colored } = setup(results);
    state.slots = [null, '/d/a.wav', null, null];
    state.focused = '/d/b.wav';
    plot.holdStep(step({}));
    plot.paint();
    assert.deepEqual([...new Set(colored)], ['/d/b.wav'], 'the focused row\'s colour');
});

test('narrowed takes a window\'s vertical part of a level range', () => {
    assert.deepEqual(narrowed({ min: -20, max: 20 }, { x: { start: 0, end: 1 }, y: { start: 0.25, end: 0.75 } }), { min: -10, max: 10 });
});

test('a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)', () => {
    const binnedScan = (level: number): ScanResult => ({ ...scanned(), spectrumBinsDb: [[-40, level, -40, -40]], spectrumBinHz: 4000 });
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/b.wav', scanned()], ['/d/c.wav', scanned()]]);
    const { window, held, title, plot, calls, state, compared } = setup(results);
    state.slots = [null, '/d/a.wav', null, null];
    plot.press(1);
    window.advance(TAP_MS);
    plot.paint();
    const asked = calls.filter(([kind]) => kind === 'post').map(([, message]) => message as { type: string; requestId: string; filePaths: string[]; spectrumBins?: boolean });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].type, 'compare-scan');
    assert.equal(asked[0].spectrumBins, true);
    assert.deepEqual(asked[0].filePaths, ['/d/a.wav', '/d/b.wav', '/d/c.wav'], 'the slotted file and its base');
    assert.ok(held.classList.contains('is-pending'));
    assert.equal(title.textContent, `1 · a.wav · ${strings.comparePending}`);
    plot.paint();
    assert.equal(calls.filter(([kind]) => kind === 'post').length, 1, 'asked once while it is being scanned');
    // The host's answers: the compared file louder in one bin only.
    for (const [filePath, level] of [['/d/a.wav', -28], ['/d/b.wav', -40], ['/d/c.wav', -40]] as const) {
        assert.equal(plot.handle({ type: 'compare-scan-result', requestId: asked[0].requestId, filePath, result: binnedScan(level) } as { type: string }), true);
    }
    plot.handle({ type: 'compare-scan-done', requestId: asked[0].requestId } as { type: string });
    compared.length = 0;
    plot.paint();
    assert.equal(held.classList.contains('is-pending'), false);
    assert.equal(title.textContent, '1 · a.wav');
    const comparison = buildCompareModel(buildEntryModel([...compared.at(-1)!.over].map(([filePath, result]) => ({ filePath, result })), null), compared.at(-1)!.over, '/d/a.wav', null, strings, false, undefined, { paths: ['/d/b.wav', '/d/c.wav'], title: 'base' });
    assert.deepEqual(comparison.bins?.diff, [0, 12, 0, 0], 'every bin, so the one bin that differs is there');
    assert.equal(calls.filter(([kind]) => kind === 'post').length, 1, 'held again, nothing is asked anew');
});

test('a file scanned again since its bins were kept is asked for again, once, so a hold does not stay at 192 points', () => {
    const withLevel = (level: number): ScanResult => ({ ...scanned(), spectrumDb: [[level, -50, -60]] });
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/b.wav', scanned()]]);
    const { window, plot, calls, state } = setup(results);
    state.slots = [null, '/d/a.wav', null, null];
    plot.press(1);
    window.advance(TAP_MS);
    plot.paint();
    const posts = () => calls.filter(([kind]) => kind === 'post').map(([, message]) => message as { requestId: string; filePaths: string[] });
    const answer = (filePath: string, result: ScanResult): void => {
        const { requestId } = posts().at(-1)!;
        plot.handle({ type: 'compare-scan-result', requestId, filePath, result: { ...result, spectrumBinsDb: [[-40, -40]], spectrumBinHz: 4000 } } as { type: string });
        plot.handle({ type: 'compare-scan-done', requestId } as { type: string });
    };
    answer('/d/a.wav', scanned());
    plot.paint();
    answer('/d/b.wav', scanned());
    plot.paint();
    const asked = posts().length;
    // The recording changed and the table scanned it again: its kept bins are of the old spectrum.
    results.set('/d/a.wav', withLevel(-30));
    plot.paint();
    assert.equal(posts().length, asked + 1);
    assert.deepEqual(posts().at(-1)!.filePaths, ['/d/a.wav']);
    // The host's answer still differs from the table's (another scan of it): not asked again and again.
    answer('/d/a.wav', scanned());
    plot.paint();
    plot.paint();
    assert.equal(posts().length, asked + 1);
});
