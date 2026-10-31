import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import type { RecipeStep } from '../shared/recipe/recipeSteps';
import { TIME_SLICE } from '../shared/recipe/recipeSteps';
import { createHeldPlot, DELTA_RELEASE_MS, narrowed, TAP_MS, type HeldPlotDeps } from '../webview/runtime/entryHeldPlot';
import { buildEntryModel } from '../webview/runtime/entryTable';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { OCTAVE_BRANCH, stepChipLabel } from '../webview/runtime/stepBar';

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
    ok: true, input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5 },
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
    const deps: HeldPlotDeps = {
        document, window, strings, held, title, canvas,
        post: message => calls.push(['post', message]),
        scheduleSide: () => calls.push(['side', null]),
        keepWindow: () => FULL_PLOT_WINDOW,
        entryModel: () => buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null),
        results, focusedFile: () => state.focused, slotFiles: () => state.slots,
        recipe: () => null, runRecipe: () => undefined, limits: () => ({}), spectral: () => true,
        slotHeld: () => calls.push(['slotHeld', null]),
        tapped: slot => calls.push(['tapped', slot]),
    };
    const plot = createHeldPlot(deps);
    return { document, window, held, title, plot, calls, state };
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
    assert.deepEqual(calls, [['slotHeld', null], ['side', null]]);
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
    const { window, held, title, plot, state } = setup(results);
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
});

test('a held step needs a scanned row: without one the footer says so; let go, it goes 150 ms later', () => {
    const results = new Map<string, ScanResult>([['/d/a.wav', scanned()], ['/d/bad.wav', { ok: false, reason: 'x' }]]);
    const { document, window, held, title, plot, calls, state } = setup(results);
    state.focused = '/d/bad.wav';
    plot.holdStep(step({ id: OCTAVE_BRANCH }));
    assert.equal(document.getElementById('hint-footer')?.textContent, strings.stepHeldNoRow);
    assert.deepEqual(calls, []);
    state.focused = null;
    state.slots = [null, '/d/a.wav', null, null];
    plot.holdStep(step({ id: OCTAVE_BRANCH }));
    assert.deepEqual(calls, [['side', null]], 'slot 1 is the row without a focused one');
    plot.paint();
    assert.equal(held.hidden, false);
    assert.equal(title.textContent, strings.stepHeldRow.replace('{what}', strings.stepOctave).replace('{file}', 'a.wav'));
    plot.holdStep(null);
    window.advance(DELTA_RELEASE_MS - 1);
    plot.holdStep(step({ id: OCTAVE_BRANCH }));
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
    assert.equal(plot.canHold(step({ id: OCTAVE_BRANCH })), true, 'the app\'s bands are always the table\'s own');
    assert.equal(plot.canHold(step({})), false, 'no Recipe: nothing to hold');
    assert.equal(plot.handle({ type: 'entry-scan-result' }), false);
});

test('narrowed takes a window\'s vertical part of a level range', () => {
    assert.deepEqual(narrowed({ min: -20, max: 20 }, { x: { start: 0, end: 1 }, y: { start: 0.25, end: 0.75 } }), { min: -10, max: 10 });
});
