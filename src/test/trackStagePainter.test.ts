import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import type { StageView } from '../shared/protocol/backendProtocol';
import { ROLE_COLORS } from '../shared/gui/roleColors';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { plotsOf } from '../webview/runtime/trackStageModel';
import { localLine } from '../webview/runtime/fullRead';
import { stageAxes, stageHover, stageStep } from '../webview/runtime/stagePanes';
import type { Combined } from '../webview/runtime/combineSource';
import { byReference, calibrationWords, overlayLayers, overlayLegendItems, paintBaseGate, paintNoPicture, paintStageControls, paintStageLanes, paintStageOverlay, stageDom, stageModeHeadline, writeStageLegend, type Drawn, type StageFrame, type StageTrack } from '../webview/runtime/trackStagePainter';

const strings = getStrings('en');
const line = (values: Array<number | null>): StageView => ({ kind: 'line', x: 'frequency', quantity: 'level', xScale: 'log', xs: values.map((_, index) => 100 * 2 ** index), values } as StageView);

/** The mode's markup on a page, its canvases answering getContext with nothing (jsdom draws nothing). */
function page() {
    const dom = new JSDOM(`<!doctype html><body><div class="track-stage"><nav data-step-bar></nav><div class="track-stage-controls">`
        + `<button data-action="stage-layout"></button><button data-action="stage-diff"></button><span data-stage-headline></span>`
        + `<span data-stage-base-gate hidden><button data-action="stage-base-scan"></button></span></div>`
        + `<div data-stage-panel><div data-stage-legend></div><canvas data-stage-canvas="overlay"></canvas>`
        + `<div data-stage-diff hidden><span data-stage-diff-headline></span><canvas data-stage-canvas="diff"></canvas></div></div></div></body>`);
    const document = dom.window.document;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const painted: Element[] = [];
    const quiet = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
        canvas.getContext = (() => { painted.push(canvas); return null; }) as HTMLCanvasElement['getContext'];
        return canvas;
    };
    root.querySelectorAll('canvas').forEach(canvas => quiet(canvas));
    const lane = (filePath: string): StageTrack => {
        const canvas = quiet(document.createElement('canvas'));
        canvas.setAttribute('aria-label', `waveform of ${filePath}`);
        return { filePath, color: '#888', canvas, axis: quiet(document.createElement('canvas')) };
    };
    return { dom, document, dom_: stageDom(root, root.querySelector('nav') as HTMLElement), painted, lane };
}

const slots = ['base.wav', 'one.wav', null, null];
const role = (path: string): number | undefined => { const at = slots.indexOf(path); return at >= 0 ? at : undefined; };
const named = (path: string, slot: number | undefined) => ({ label: `${slot ?? '·'} · ${path}` });

/** The backend's difference of one.wav from base.wav (lines of `line`), and where it is largest. */
const combined: Combined = { base: null, diff: line([10, 0]) };

const coarseOf = (views: Record<string, StageView | null | undefined>) => (path: string) => views[path];

function frameFor(tracks: StageTrack[], views: Record<string, StageView | null | undefined>, extra: Partial<StageFrame> = {}): StageFrame {
    const coarse = (path: string) => views[path];
    return {
        strings, tracks, allTracks: tracks, referencePath: null, comparePath: 'one.wav', coarse, shown: coarse, picture: views['one.wav'] ?? null,
        coarsePlots: plotsOf(coarse, tracks, 'one.wav', ['base.wav'], combined), window: FULL_PLOT_WINDOW, diffY: FULL_PLOT_WINDOW.y, waiting: false, role, named, drawnOn: new Map<Element, Drawn>(), ...extra,
    };
}

test('the mode\'s parts are found once; a part missing from its markup is an error, not a null', () => {
    const { dom_ } = page();
    assert.equal(dom_.panel.getAttribute('data-stage-panel'), '');
    assert.throws(() => dom_.query('[data-no-such-part]'), /no \[data-no-such-part\]/);
});

test('without a picture the plot says why, the headline and the difference are cleared', () => {
    const { dom_, painted } = page();
    dom_.query<HTMLElement>('[data-stage-headline]').textContent = 'old';
    dom_.query<HTMLElement>('[data-stage-diff]').hidden = false;
    paintNoPicture(dom_, 'node-2', 'why');
    assert.equal(dom_.panel.hidden, false);
    assert.equal(dom_.query('[data-stage-headline]').textContent, '');
    assert.equal(dom_.query<HTMLElement>('[data-stage-diff]').hidden, true);
    assert.deepEqual([dom_.bar.dataset.drawn, dom_.bar.dataset.stage], ['0', 'node-2']);
    assert.deepEqual(painted, [dom_.query('[data-stage-canvas="overlay"]')]);
});

test('the toggles: images cannot be overlaid, the difference needs an overlay, a compared file and no base measured against', () => {
    const { dom_ } = page();
    const layout = dom_.query<HTMLButtonElement>('[data-action="stage-layout"]'), diff = dom_.query<HTMLButtonElement>('[data-action="stage-diff"]');
    paintStageControls(dom_, strings, { overlaid: true, images: false, showDiff: false, overlay: true, measuredAgainstBase: false, nothingCompared: false });
    assert.deepEqual([layout.textContent, layout.getAttribute('aria-pressed'), layout.hidden, diff.textContent, diff.hidden, diff.disabled], [strings.stageLayoutSide, 'true', false, strings.compareDiffShow, false, false]);
    paintStageControls(dom_, strings, { overlaid: false, images: true, showDiff: true, overlay: false, measuredAgainstBase: false, nothingCompared: true });
    assert.deepEqual([layout.textContent, layout.getAttribute('aria-pressed'), layout.hidden, diff.textContent, diff.hidden, diff.disabled], [strings.stageLayoutOverlay, 'false', true, strings.compareDiffHide, true, true]);
    paintStageControls(dom_, strings, { overlaid: true, images: false, showDiff: false, overlay: true, measuredAgainstBase: true, nothingCompared: false });
    assert.equal(diff.hidden, true);
    paintStageControls(dom_, strings, { overlaid: true, images: false, showDiff: false, overlay: true, measuredAgainstBase: false, nothingCompared: false, baseEach: true });
    assert.equal(diff.hidden, true, 'a base group drawn as its waveforms: no Δ against its median');
});

test('a gated base group\'s button says how many recordings and about how long', () => {
    const { dom_ } = page();
    paintBaseGate(dom_, strings, { gated: true, count: 40, ms: 125_000 });
    assert.equal(dom_.query<HTMLElement>('[data-stage-base-gate]').hidden, false);
    assert.equal(dom_.root.dataset.baseGate, '40');
    assert.equal(dom_.query('[data-action="stage-base-scan"]').textContent, strings.stageBaseScan.replace('{n}', '40').replace('{time}', strings.entryMinutes.replace('{n}', '3')));
    paintBaseGate(dom_, strings, { gated: false, count: 40, ms: 0 });
    assert.equal(dom_.query<HTMLElement>('[data-stage-base-gate]').hidden, true);
    assert.equal(dom_.root.dataset.baseGate, '');
});

test('the headline names no difference (the row holds the pointer\'s readout): the steps bypassed and the region; nothing while computing', () => {
    const { lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) });
    const text = stageModeHeadline(frame, ['HPF 20 Hz'], { start: 0.5, end: 1 });
    assert.equal(text, `${strings.stepBypassing.replace('{ops}', 'HPF 20 Hz')} · ${strings.stepRegion} 0.50–1.00 s`.replace(/^\s*(·\s*)?/, ''));
    assert.equal(stageModeHeadline(frame, [], null), '');
    assert.equal(stageModeHeadline({ ...frame, waiting: true }, ['x'], null), '');
    assert.equal(stageModeHeadline({ ...frame, comparePath: null }, [], null), strings.stageChooseRoles);
    assert.equal(stageModeHeadline({ ...frame, referencePath: 'base.wav' }, [], null), strings.stageVsBase.replace('{file}', '0 · base.wav'));
    // A base group drawn as its waveforms: its median level is on no line, so no difference is named.
    assert.equal(stageModeHeadline({ ...frame, baseEach: true }, [], null), '');
    assert.equal(stageModeHeadline({ ...frame, baseEach: true }, [], { start: 0.5, end: 1 }), `${strings.stepRegion} 0.50–1.00 s`);
    assert.equal(stageModeHeadline({ ...frame, baseEach: true }, ['HPF 20 Hz'], null), strings.stepBypassing.replace('{ops}', 'HPF 20 Hz').trim());
});

test('side by side, every lane draws its own picture and says it shows the step; the base measured against says so', () => {
    const { lane, painted } = page();
    const tracks = [lane('base.wav'), lane('one.wav'), lane('other.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]), 'other.wav': undefined });
    assert.equal(paintStageLanes(frame), 2);
    assert.equal(tracks[1].canvas?.getAttribute('aria-label'), strings.ariaStageLaneCanvas.replace('{file}', 'one.wav'));
    assert.equal(tracks[1].canvas?.dataset.laneLabel, 'waveform of one.wav');
    assert.equal(frame.drawnOn.get(tracks[1].canvas as Element)?.picture, frame.coarse('one.wav'));
    assert.equal(painted.filter(canvas => tracks.some(track => track.canvas === canvas)).length, 3);
    const reference = lane('ref.wav');
    painted.length = 0;
    paintStageLanes({ ...frame, allTracks: [...tracks, reference], referencePath: 'ref.wav' });
    assert.ok(painted.includes(reference.canvas as Element));
});

test('overlaid: lines without a role, each in its track\'s own colour, under the roles\', the base, the others, the compared file on top; the legend names them', () => {
    const { lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav'), { ...lane('grey.wav'), color: '#2bb3a3' }];
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]), 'grey.wav': line([-40, -40]) };
    const frame = frameFor(tracks, views);
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined);
    assert.deepEqual(overlayLayers(frame, plots).map(layer => [layer.color, layer.width]), [['#2bb3a3', 1.2], [ROLE_COLORS[0], 2], [ROLE_COLORS[1], 2.2]]);
    const members = { ...plots, baseMembers: [{ path: 'm1.wav', view: views['base.wav'] }, { path: 'm2.wav', view: views['grey.wav'] }] };
    assert.deepEqual(overlayLayers(frame, members, 'Base').map(layer => [layer.color, layer.width, layer.label]),
        [['#2bb3a3', 1.2, '· · grey.wav'], [ROLE_COLORS[0], 1, 'Base · m1.wav'], [ROLE_COLORS[0], 1, 'Base · m2.wav'], [ROLE_COLORS[1], 2.2, '1 · one.wav']], 'a base group\'s waveforms, each thin under the compared one (no median line)');
    const items = overlayLegendItems(frame, plots, { title: 'Base', group: true, gated: false, count: 1, held: false, playable: path => ({ path }) });
    assert.deepEqual(items.map(item => [item.label, item.color, !!item.trailingHtml, item.path]), [['Base', ROLE_COLORS[0], true, undefined], ['1 · one.wav', ROLE_COLORS[1], false, 'one.wav'], ['· · grey.wav', '#2bb3a3', false, 'grey.wav']]);
    const gated = overlayLegendItems(frame, plots, { title: 'Base', group: false, gated: true, count: 40, held: true, playable: () => ({}) });
    assert.equal(gated[0].label, `Base${strings.stageBaseNoLine}`);
    assert.equal(gated[0].hint, undefined);
    assert.equal(gated[1].held, true);
    assert.deepEqual(overlayLegendItems({ ...frame, referencePath: 'base.wav' }, plots, { title: 'Base', group: false, gated: false, count: 1, held: false, playable: () => ({}) }).map(item => item.label), ['1 · one.wav', '· · grey.wav']);
});

test('the overlaid plot draws its difference under it only on request, with a compared file and no base measured against', () => {
    const { dom_, lane, painted } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) });
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined);
    const diff = dom_.query<HTMLElement>('[data-stage-diff]');
    paintStageOverlay(dom_, frame, plots, overlayLayers(frame, plots), false);
    assert.equal(diff.hidden, true);
    assert.deepEqual(painted, [dom_.query('[data-stage-canvas="overlay"]')]);
    paintStageOverlay(dom_, frame, plots, overlayLayers(frame, plots), true);
    assert.equal(diff.hidden, false);
    assert.ok(dom_.query('[data-stage-diff-headline]').textContent);
    assert.ok(frame.drawnOn.has(dom_.query('[data-stage-canvas="diff"]')));
    paintStageOverlay(dom_, { ...frame, referencePath: 'base.wav' }, plots, [], true);
    assert.equal(diff.hidden, true);
    // A base group drawn as its waveforms: no Δ.
    paintStageOverlay(dom_, { ...frame, baseEach: true }, plots, overlayLayers(frame, plots), true);
    assert.equal(diff.hidden, true);
});

test('with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data', () => {
    const { dom_, lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) };
    const none: Combined = { base: null, diff: null };
    const cases: Array<[Partial<StageFrame>, string]> = [
        [{ noDelta: 'rate' }, strings.stageNoDeltaRate],
        [{ noDelta: 'unit' }, strings.stageNoDeltaUnit],
        [{ tooLarge: true }, strings.stageTooLarge],
        [{ failed: true }, strings.stageCombineFailed],
        [{}, strings.stageNoDelta],
    ];
    for (const [extra, reason] of cases) {
        const frame = { ...frameFor(tracks, views, extra), coarsePlots: plotsOf(coarseOf(views), tracks, 'one.wav', ['base.wav'], none) };
        const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], none);
        paintStageOverlay(dom_, frame, plots, overlayLayers(frame, plots), true);
        assert.equal(dom_.query('[data-stage-diff-headline]').textContent, reason);
    }
});

test('the difference is shown or hidden before the overlay is drawn: the overlay is measured at the height it keeps', () => {
    const { dom_, lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) });
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined);
    const diff = dom_.query<HTMLElement>('[data-stage-diff]');
    const overlay = dom_.query<HTMLCanvasElement>('[data-stage-canvas="overlay"]');
    const hiddenWhenDrawn: boolean[] = [];
    overlay.getContext = (() => { hiddenWhenDrawn.push(diff.hidden); return null; }) as HTMLCanvasElement['getContext'];
    paintStageOverlay(dom_, frame, plots, overlayLayers(frame, plots), true);
    paintStageOverlay(dom_, frame, plots, overlayLayers(frame, plots), false);
    assert.deepEqual(hiddenWhenDrawn, [false, true]);
});

test('the legend is written only when it changed and no role chip is open, and keeps the focus on its ▶', () => {
    const { document, dom_ } = page();
    (globalThis as unknown as Record<string, unknown>)['CSS'] = { escape: (text: string) => text };
    const legend = dom_.query<HTMLElement>('[data-stage-legend]');
    const play = (playing: boolean): string => `<button data-action="compare-play" data-path="one.wav">${playing ? '■' : '▶'}</button>`;
    assert.equal(writeStageLegend(legend, play(false), '', document), play(false));
    legend.querySelector<HTMLElement>('button')?.focus();
    const before = legend.querySelector('button');
    assert.equal(writeStageLegend(legend, play(false), play(false), document), play(false));
    assert.equal(legend.querySelector('button'), before, 'the same legend is not written again');
    assert.equal(writeStageLegend(legend, play(true), play(false), document), play(true));
    assert.equal(document.activeElement?.textContent, '■', 'the new ▶ has the focus');
    legend.innerHTML = '<details class="role-chip" open></details>';
    assert.equal(writeStageLegend(legend, play(false), 'x', document), 'x');
    assert.ok(legend.querySelector('details[open]'));
});

test('side by side, each lane is read at its own full data, never the line thinned to draw it: a bin thinned out under the pointer, and ← / → one bin at a time (R7)', () => {
    const { document } = page();
    // Lanes that draw: a context that draws nothing but answers what the plot component asks of it.
    const anything: object = new Proxy(() => undefined, { get: (_target, prop) => (prop === 'then' ? undefined : () => anything), set: () => true });
    const context = new Proxy({}, { get: (_target, prop) => (prop === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : prop === 'font' ? '10px sans-serif' : () => anything), set: () => true });
    const lane = (filePath: string): StageTrack => {
        const canvas = document.createElement('canvas');
        canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
        Object.defineProperty(canvas, 'clientWidth', { value: 600 });
        Object.defineProperty(canvas, 'clientHeight', { value: 160 });
        return { filePath, color: '#888', canvas, axis: null };
    };
    // Each recording's spectrum, 8193 bins; each lane draws it thinned to each bucket's lowest and highest bin.
    const bins = 8193, hz = 24000 / (bins - 1);
    const xs = Array.from({ length: bins }, (_, bin) => bin * hz);
    const spectra: Record<string, number[]> = {
        'base.wav': xs.map((_, bin) => -50 + 15 * Math.sin(bin * 1.37) * Math.cos(bin * 0.11)),
        'one.wav': xs.map((_, bin) => -40 + 12 * Math.sin(bin * 0.91) * Math.cos(bin * 0.07)),
    };
    const thinned = (values: number[]): StageView => {
        const keep: number[] = [];
        for (let start = 1; start < bins; start += 64) {
            const part = values.slice(start, Math.min(bins, start + 64));
            keep.push(start + part.indexOf(Math.min(...part)), start + part.indexOf(Math.max(...part)));
        }
        const at = [...new Set(keep)].sort((a, b) => a - b);
        return { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: at.map(bin => xs[bin]), values: at.map(bin => values[bin]), xLimits: [0, 24000] };
    };
    const views = Object.fromEntries(Object.entries(spectra).map(([path, values]) => [path, thinned(values)]));
    const tracks = [lane('base.wav'), lane('one.wav')];
    const fullOf = (view: StageView | null | undefined) => {
        const path = Object.keys(views).find(key => views[key] === view);
        return path ? localLine(xs, spectra[path]) : undefined;
    };
    const frame = frameFor(tracks, views, { fullOf });
    assert.equal(paintStageLanes(frame), 2);
    for (const track of tracks) {
        const plot = frame.drawnOn.get(track.canvas as Element)?.plot;
        assert.ok(plot, `${track.filePath} drew`);
        const values = spectra[track.filePath];
        const drawn = new Set(views[track.filePath].xs);
        let bin = 4000;
        while (drawn.has(xs[bin])) bin++;
        let read = stageHover(plot, plot.xAt(xs[bin]), plot.yAt(values[bin]));
        assert.equal(read?.full, true, `${track.filePath}: read from its full data`);
        assert.equal(read?.at, xs[bin]);
        assert.equal(read?.value, values[bin], `${track.filePath}: the bin thinned out of the line drawn`);
        for (let step = 1; step <= 10; step++) {
            read = read ? stageStep(plot, read, 1) ?? null : null;
            assert.equal(read?.at, xs[bin + step], `${track.filePath}: step ${step} is the next bin`);
            assert.equal(read?.value, values[bin + step]);
        }
    }
});

test('overlaid, each line is on the axis of its own recording\'s reference: one shared, two split left and right as the cursor spectrum does, more not overlaid (A22, C1)', () => {
    const { lane } = page();
    const fs = { unit: '', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true } as const;
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
    const volt = { unit: 'V', ref: 1, levelReferenceLabel: 'dB re 1 V', calibrationStatus: 'calibrated', fullScale: false } as const;
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([74, 64]), 'two.wav': line([-6, -9]) };
    const draw = (inputs: Record<string, StageTrack['input']>, paths = ['base.wav', 'one.wav']): string[] => {
        const tracks = paths.map(path => ({ ...lane(path), input: inputs[path] }));
        const frame = frameFor(tracks, views);
        const plots = { ...plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined), others: tracks.filter(track => track.filePath === 'two.wav').map(track => ({ track, view: views['two.wav'] })) };
        const split = byReference(frame, overlayLayers(frame, plots, undefined, 'base.wav'));
        if (split.tooMany) return [];
        const titles = [stageAxes(strings, frame.picture, split.mainInput).y, ...(split.secondary ? [split.secondary.title] : [])];
        // Each line is on the axis named by its own recording's reference, and a second axis's lines are dashed.
        for (const layer of split.mainLayers) assert.equal(stageAxes(strings, frame.picture, inputs[layer.recording ?? '']).y, titles[0]);
        for (const layer of split.secondary?.layers ?? []) { assert.equal(stageAxes(strings, frame.picture, inputs[layer.recording ?? '']).y, titles[1]); assert.ok(layer.dash); }
        return titles;
    };
    // One reference: one axis, named by it.
    assert.deepEqual(draw({ 'base.wav': spl, 'one.wav': spl }).map(title => /\[(.*)\]$/u.exec(title)?.[1]), ['dB SPL re 20 µPa']);
    // The compared recording calibrated, the base not: the base's axis on the left, the other's on the right.
    assert.deepEqual(draw({ 'base.wav': fs, 'one.wav': spl }).map(title => /\[(.*)\]$/u.exec(title)?.[1]), ['dBFS', 'dB SPL re 20 µPa']);
    // Three references: not overlaid on one plot, as the cursor spectrum does not.
    assert.deepEqual(draw({ 'base.wav': fs, 'one.wav': spl, 'two.wav': volt }, ['base.wav', 'one.wav', 'two.wav']), []);
});

test('overlaid, lines share an axis by their level identity, not their axis name: a gain-corrected FS file and a raw one are one axis, and only the raw one says uncalibrated (R1, R4)', () => {
    const { lane } = page();
    const raw = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true } as const;
    const corrected = { ...raw, calibrationStatus: 'calibrated' } as const;
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([-24, -28]), 'two.wav': line([74, 64]) };
    const split = (inputs: Record<string, StageTrack['input']>, paths = ['base.wav', 'one.wav']) => {
        const tracks = paths.map(path => ({ ...lane(path), input: inputs[path] }));
        const frame = frameFor(tracks, views);
        const plots = { ...plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined), others: tracks.filter(track => track.filePath === 'two.wav').map(track => ({ track, view: views['two.wav'] })) };
        return { frame, tracks, result: byReference(frame, overlayLayers(frame, plots, undefined, 'base.wav')) };
    };
    // One identity, two calibration statuses: one axis, which says uncalibrated only when every line on it is.
    const mixed = split({ 'base.wav': raw, 'one.wav': corrected });
    assert.equal(mixed.result.tooMany, false);
    assert.equal(mixed.result.secondary, undefined, 'one axis for one identity');
    assert.equal(mixed.result.mainLayers.length, 2);
    const title = stageAxes(strings, mixed.frame.picture, mixed.result.mainInput).y;
    assert.ok(!title.includes(strings.axisUncalibrated), title);
    assert.ok(title.endsWith('[dBFS]'), title);
    const word = calibrationWords(strings, mixed.tracks, ['base.wav', 'one.wav']);
    assert.equal(word('base.wav'), strings.axisUncalibrated, 'the raw line says so itself');
    assert.equal(word('one.wav'), '');
    const both = split({ 'base.wav': raw, 'one.wav': raw });
    assert.ok(stageAxes(strings, both.frame.picture, both.result.mainInput).y.includes(strings.axisUncalibrated), 'all uncalibrated: the axis says so');
    assert.equal(calibrationWords(strings, both.tracks, ['base.wav', 'one.wav'])('base.wav'), '', 'and no line repeats it');
    // Three axis names but two identities: two axes, not too many.
    const three = split({ 'base.wav': raw, 'one.wav': corrected, 'two.wav': spl }, ['base.wav', 'one.wav', 'two.wav']);
    assert.equal(three.result.tooMany, false);
    assert.equal(three.result.mainLayers.length, 2);
    assert.ok(three.result.secondary?.title.endsWith('[dB SPL re 20 µPa]'), three.result.secondary?.title);
});

test('overlaid, a trigger\'s events are split by level identity as any line, and a vertical zoom narrows the right-hand axis as the left (A43, A45, R13)', () => {
    const { lane } = page();
    const fs = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true } as const;
    const pa = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
    const events = (scale: number): StageView => ({ frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 1], values: [0, scale],
        events: [{ id: 0, time: 0.5, xs: [0, 1], values: [-scale, scale] }] } as unknown as StageView);
    const views = { 'base.wav': events(0.5), 'one.wav': events(2) };
    const tracks = ['base.wav', 'one.wav'].map(path => ({ ...lane(path), input: path === 'base.wav' ? fs : pa }));
    const frame = frameFor(tracks, views);
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav'], combined);
    const whole = byReference(frame, overlayLayers(frame, plots, undefined, 'base.wav'));
    assert.equal(whole.tooMany, false);
    assert.ok(whole.secondary, 'the Pa recording\'s events on an axis of their own');
    assert.equal(whole.mainLayers.length, 1);
    const zoomed = byReference({ ...frame, window: { x: { start: 0, end: 1 }, y: { start: 0.25, end: 0.75 } } }, overlayLayers(frame, plots, undefined, 'base.wav'));
    const [a, b] = [whole.secondary.range, zoomed.secondary?.range ?? { min: NaN, max: NaN }];
    assert.equal(b.min, a.min + 0.25 * (a.max - a.min));
    assert.equal(b.max, a.min + 0.75 * (a.max - a.min));
});

test('side by side, lanes share a range only with the lanes in their own reference: a dB SPL lane is never on a dBFS lane\'s scale (A32, C1)', () => {
    const { lane } = page();
    const fs = { unit: '', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true } as const;
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([74, 64]), 'two.wav': line([-26, -34]) };
    const ranges = (inputs: Record<string, StageTrack['input']>): Record<string, { min: number; max: number } | undefined> => {
        const tracks = ['base.wav', 'one.wav', 'two.wav'].map(path => ({ ...lane(path), input: inputs[path] }));
        const frame = frameFor(tracks, views);
        paintStageLanes(frame);
        return Object.fromEntries(tracks.map(track => [track.filePath, frame.drawnOn.get(track.canvas as Element)?.range]));
    };
    const mixed = ranges({ 'base.wav': fs, 'one.wav': spl, 'two.wav': fs });
    assert.deepEqual(mixed['base.wav'], mixed['two.wav'], 'two dBFS lanes share one range');
    assert.notDeepEqual(mixed['one.wav'], mixed['base.wav'], 'the dB SPL lane has its own');
    assert.ok(mixed['one.wav']!.min > 0 && mixed['base.wav']!.max <= 0, JSON.stringify(mixed));
    // One reference: one range for all.
    const one = ranges({ 'base.wav': spl, 'one.wav': spl, 'two.wav': spl });
    assert.deepEqual(one['base.wav'], one['one.wav']);
});
