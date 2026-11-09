import type { CurrentAnswers, ShownAnswers } from '../webview/runtime/answerStore';
import { R } from './helpers/figure';
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
import { stageHover, stageStep } from '../webview/runtime/stagePanes';
import { stepChipLabel } from '../webview/runtime/stepBar';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';

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
    ok: true, conditionId: 'x@v1', input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true },
    leqDbA: [60], peakHz: [100], spectrumDb: [[-40, -50, -60]], thirdOctDb: [[50, 40]], crest: [3], specVersion: 5,
});

const step = (patch: Partial<RecipeStep>): RecipeStep => ({ id: 'node-1', operation: 'wandas.frame.highpass_filter', name: 'highpass_filter', params: {}, editable: [], input: 'ChannelFrame', output: 'ChannelFrame', ...patch });

function setup(results = new Map<string, ScanResult>(), options: { recipe?: RecipeDocument; channelOf?: (path: string) => number | null } = {}) {
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
        // The table's scans as the answer store hands them: all of the current chain here (read live, as a test changes them).
        shown: results as unknown as ShownAnswers, current: () => results as unknown as CurrentAnswers,
        comparison: (path, over) => { compared.push({ path, over }); return buildCompareModel(buildEntryModel([...over].map(([filePath, result]) => ({ filePath, result })), null), over, path, null, strings, false, undefined, { paths: [...results.keys()].filter(file => file !== path), title: 'base' }); },
        basePaths: path => [...results.keys()].filter(file => file !== path),
        scanRecipe: () => undefined,
        focusedFile: () => state.focused, slotFiles: () => state.slots,
        colorOf: filePath => { colored.push(filePath); return `colour of ${filePath}`; },
        channelOf: options.channelOf ?? (() => null),
        recipe: () => options.recipe ?? null, runRecipe: () => undefined, limits: () => ({}), spectral: () => true,
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

test('a held step draws the channel its row is compared as, not every channel averaged (R11)', () => {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()]]);
    const channels: string[] = [];
    const { plot, state, calls } = setup(results, { recipe, channelOf: file => { channels.push(file); return 2; } });
    state.focused = '/d/a.wav';
    const welch = step({ id: 'node-2', operation: 'wandas.audio.welch', name: 'welch', input: 'ChannelFrame', output: 'SpectralFrame' });
    plot.holdStep(welch);
    plot.paint();
    assert.deepEqual(channels, ['/d/a.wav'], 'the held row\'s file');
    const asked = calls.flatMap(([kind, message]) => (kind === 'post' ? [message as { recipe?: RecipeDocument }] : []));
    assert.ok(asked.length, 'the step\'s picture is asked for');
    for (const message of asked) {
        const head = (message.recipe as unknown as { nodes: Array<{ id: string; operation: string; params: { entries: Array<[string, unknown]> } }> }).nodes[0];
        assert.equal(head.operation, 'wandas.frame.get_channel');
        assert.deepEqual(head.params.entries, [['channel_idx', 1]], 'channel 2, from 0');
    }
    // A one-channel row (no channel to pick) draws the Recipe as it is.
    const single = setup(results, { recipe, channelOf: () => null });
    single.state.focused = '/d/a.wav';
    single.plot.holdStep(welch);
    single.plot.paint();
    const plain = single.calls.flatMap(([kind, message]) => (kind === 'post' ? [message as { recipe?: RecipeDocument }] : []));
    assert.ok(plain.every(message => !(message.recipe as unknown as { nodes: Array<{ id: string }> }).nodes.some(node => node.id === 'node-channel')));
});

test('a held step of a chain that compares the recording\'s channels picks no channel for either picture', () => {
    // An unpaired channel_difference needs every channel: with it held, the "with" picture keeps them all, and so does
    // the "without" one, so the Δ is the step's and not one channel against all of them.
    const recipe = {
        schema: 'wandas.recipe', version: 3, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }],
        nodes: [
            { id: 'node-0', operation: 'wandas.audio.channel_difference', version: 1, inputs: ['input-0'], params: { $type: 'map', entries: [['other_channel', 0]] } },
            { id: 'node-2', operation: 'wandas.audio.welch', version: 3, inputs: ['node-0'], params: { $type: 'map', entries: [['n_fft', 1024]] } },
        ],
        output: 'node-2',
    } as unknown as RecipeDocument;
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()]]);
    const { plot, state, calls } = setup(results, { recipe, channelOf: () => 2 });
    state.focused = '/d/a.wav';
    plot.holdStep(step({ id: 'node-0', operation: 'wandas.audio.channel_difference', name: 'channel_difference' }));
    plot.paint();
    // The picture with the step is asked for first; once it is in, the one without it.
    const posted = () => calls.flatMap(([kind, message]) => (kind === 'post' ? [message as { requestId: string; recipe?: RecipeDocument }] : []));
    const first = posted()[0];
    assert.ok(first);
    plot.handle({ type: 'compare-scan-result', requestId: first.requestId, filePath: '/d/a.wav', result: { ...scanned(), stage: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000], values: [-40, -50], data: 'k1' } } } as { type: string });
    plot.handle({ type: 'compare-scan-done', requestId: first.requestId } as { type: string });
    plot.paint();
    const asked = posted().filter(message => message.recipe);
    assert.equal(asked.length, 2, 'with and without the step');
    for (const message of asked) assert.ok(!(message.recipe as unknown as { nodes: Array<{ id: string }> }).nodes.some(node => node.id === 'node-channel'));
});

test('a held step whose values the backend refused to keep asks for no combination and scans nothing again', () => {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()]]);
    const { plot, state, calls } = setup(results, { recipe });
    state.focused = '/d/a.wav';
    plot.holdStep(step({ id: 'node-0', operation: 'wandas.frame.highpass_filter' }));
    plot.paint();
    const posted = () => calls.flatMap(([kind, message]) => (kind === 'post' ? [message as { type: string; requestId: string }] : []));
    const picture = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000], values: [-40, -50] } as const;
    // Each picture as it comes: the second one over the store's budget (stageDataTooLarge). Even were a key named
    // with it, a combination of it would only be answered missing and scanned again: none is asked for.
    for (const [index, extra] of [[0, { data: 'k1' }], [1, { data: 'k2' }]] as const) {
        const asked = posted().filter(message => message.type === 'compare-scan')[index];
        assert.ok(asked, `picture ${index + 1} is asked for`);
        plot.handle({ type: 'compare-scan-result', requestId: asked.requestId, filePath: '/d/a.wav', result: { ...scanned(), ...(index === 1 ? { stageDataTooLarge: true } : {}), stage: { ...picture, ...extra } } } as { type: string });
        plot.handle({ type: 'compare-scan-done', requestId: asked.requestId } as { type: string });
        plot.paint();
    }
    const before = posted().length;
    plot.paint();
    plot.paint();
    assert.deepEqual(posted().filter(message => message.type === 'compare-combine'), [], 'nothing combined of values not kept');
    assert.equal(posted().length, before, 'and nothing asked again');
});

test('narrowed takes a window\'s vertical part of a level range', () => {
    assert.deepEqual(narrowed(R({ min: -20, max: 20 }), { x: { start: 0, end: 1 }, y: { start: 0.25, end: 0.75 } }), { min: -10, max: 10 });
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
    assert.equal(plot.picture()?.drawn ?? null, null, 'nothing of the table\'s 192 points is drawn while the bins come (R1, R2)');
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
    // Another version of the file whose 192 drawn points happen to be alike: told apart by its condition alone.
    const rescanned = (): ScanResult => ({ ...scanned(), conditionId: 'changed-on-disk' });
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
    // The recording changed and the table scanned it again: its kept bins are of the old version.
    results.set('/d/a.wav', rescanned());
    plot.paint();
    assert.equal(posts().length, asked + 1);
    assert.deepEqual(posts().at(-1)!.filePaths, ['/d/a.wav']);
    // The host's answer still differs from the table's (another scan of it): not asked again and again.
    answer('/d/a.wav', scanned());
    plot.paint();
    plot.paint();
    assert.equal(posts().length, asked + 1);
});

test('← / → on a held slot\'s Δ step to the next of every bin, not the next point drawn of the Δ thinned to the plot\'s width (R7)', () => {
    // 4000 bins, each a different Δ (the bin's number modulo 7), on a plot a few hundred pixels wide.
    const BINS = 4000, HZ = 6;
    const deltaAt = (bin: number): number => bin % 7;
    const binned = (louder: boolean): ScanResult => ({ ...scanned(), spectrumBinsDb: [Array.from({ length: BINS }, (_, bin) => -40 + (louder ? deltaAt(bin) : 0))], spectrumBinHz: HZ });
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/b.wav', scanned()]]);
    const { document, window, plot, calls, state } = setup(results);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-entry-held-canvas]')!;
    Object.defineProperties(canvas, { clientWidth: { value: 400 }, clientHeight: { value: 200 } });
    // A context that draws nothing but answers what the plot component asks of it.
    const anything: object = new Proxy(() => undefined, { get: (_target, prop) => (prop === 'then' ? undefined : () => anything), set: () => true });
    canvas.getContext = (() => new Proxy({}, {
        get: (_target, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : prop === 'createImageData' || prop === 'getImageData' ? (...size: number[]) => ({ width: size.at(-2) ?? 1, height: size.at(-1) ?? 1, data: new Uint8ClampedArray(Math.max(1, (size.at(-2) ?? 1) * (size.at(-1) ?? 1) * 4)) }) : () => anything),
        set: () => true,
    })) as unknown as HTMLCanvasElement['getContext'];
    state.slots = [null, '/d/a.wav', null, null];
    plot.press(1);
    window.advance(TAP_MS);
    plot.paint();
    const asked = calls.filter(([kind]) => kind === 'post').map(([, message]) => message as { requestId: string })[0];
    plot.handle({ type: 'compare-scan-result', requestId: asked.requestId, filePath: '/d/a.wav', result: binned(true) } as { type: string });
    plot.handle({ type: 'compare-scan-result', requestId: asked.requestId, filePath: '/d/b.wav', result: binned(false) } as { type: string });
    plot.handle({ type: 'compare-scan-done', requestId: asked.requestId } as { type: string });
    plot.paint();
    const drawn = plot.picture()?.drawn;
    assert.ok(drawn, 'the Δ is drawn');
    const line = drawn.lines[0];
    const points = line?.view.values?.length ?? 0;
    assert.ok(points > 0 && points < BINS / 4, `the Δ is thinned to be drawn (${points} points of ${BINS} bins)`);
    // The pointer in the middle of the plot: the bin read there, then → and ← one bin at a time.
    const read = stageHover(drawn, drawn.frame.left + drawn.frame.width / 2, drawn.frame.top + drawn.frame.height / 2);
    assert.ok(read?.full, 'read from every bin');
    assert.ok(read.at !== undefined);
    const bin = Math.round(read.at / HZ);
    assert.equal(read.value, deltaAt(bin));
    let at = read;
    for (const [delta, expected] of [[1, bin + 1], [1, bin + 2], [1, bin + 3], [-1, bin + 2], [-1, bin + 1]] as const) {
        const next = stageStep(drawn, at, delta);
        assert.ok(next, `a step to bin ${expected}`);
        assert.equal(Math.round((next.at ?? NaN) / HZ), expected, 'one bin on, not the next point drawn');
        assert.equal(next.value, deltaAt(expected), 'the value of that bin');
        at = next;
    }
});
