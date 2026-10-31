import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import type { StageView } from '../shared/protocol/backendProtocol';
import { NO_ROLE_COLOR, ROLE_COLORS } from '../shared/gui/roleColors';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { plotsOf } from '../webview/runtime/trackStageModel';
import { overlayLayers, overlayLegendItems, paintBaseGate, paintNoPicture, paintStageControls, paintStageLanes, paintStageOverlay, stageDom, stageModeHeadline, writeStageLegend, type Drawn, type StageFrame, type StageTrack } from '../webview/runtime/trackStagePainter';

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

function frameFor(tracks: StageTrack[], views: Record<string, StageView | null | undefined>, extra: Partial<StageFrame> = {}): StageFrame {
    const coarse = (path: string) => views[path];
    return {
        strings, tracks, allTracks: tracks, referencePath: null, comparePath: 'one.wav', coarse, shown: coarse, picture: views['one.wav'] ?? null,
        coarsePlots: plotsOf(coarse, tracks, 'one.wav', ['base.wav']), window: FULL_PLOT_WINDOW, waiting: false, role, named, drawnOn: new Map<Element, Drawn>(), ...extra,
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

test('the headline: the difference shown and where it is largest, then the steps bypassed and the region; nothing while computing', () => {
    const { lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) });
    const text = stageModeHeadline(frame, ['HPF 20 Hz'], { start: 0.5, end: 1 });
    assert.ok(text.startsWith(strings.stageCompareMinusBase.replace('{n}', '1')));
    assert.ok(text.endsWith(`${strings.stepBypassing.replace('{ops}', 'HPF 20 Hz')} · ${strings.stepRegion} 0.50–1.00 s`));
    assert.equal(stageModeHeadline({ ...frame, waiting: true }, ['x'], null), '');
    assert.equal(stageModeHeadline({ ...frame, comparePath: null }, [], null), strings.stageChooseRoles);
    assert.equal(stageModeHeadline({ ...frame, referencePath: 'base.wav' }, [], null), strings.stageVsBase.replace('{file}', '0 · base.wav'));
});

test('side by side, every lane draws its own picture and says it shows the step; the base measured against says so', () => {
    const { lane, painted } = page();
    const tracks = [lane('base.wav'), lane('one.wav'), lane('other.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]), 'other.wav': undefined });
    assert.equal(paintStageLanes(frame), 2);
    assert.equal(tracks[1].canvas?.getAttribute('aria-label'), strings.ariaStageLaneCanvas.replace('{file}', 'one.wav'));
    assert.equal(tracks[1].canvas?.dataset.laneLabel, 'waveform of one.wav');
    assert.equal(frame.drawnOn.get(tracks[1].canvas as Element)?.views.compare, frame.coarse('one.wav'));
    assert.equal(painted.filter(canvas => tracks.some(track => track.canvas === canvas)).length, 3);
    const reference = lane('ref.wav');
    painted.length = 0;
    paintStageLanes({ ...frame, allTracks: [...tracks, reference], referencePath: 'ref.wav' });
    assert.ok(painted.includes(reference.canvas as Element));
});

test('overlaid: grey lines under the roles\', the base, the others, the compared file on top; the legend names them', () => {
    const { lane } = page();
    const tracks = [lane('base.wav'), lane('one.wav'), lane('grey.wav')];
    const views = { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]), 'grey.wav': line([-40, -40]) };
    const frame = frameFor(tracks, views);
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav']);
    assert.deepEqual(overlayLayers(frame, plots).map(layer => [layer.color, layer.width]), [[NO_ROLE_COLOR, 1.2], [ROLE_COLORS[0], 2], [ROLE_COLORS[1], 2.2]]);
    const items = overlayLegendItems(frame, plots, { title: 'Base', group: true, gated: false, tableBase: null, tableBands: null, count: 1, held: false, playable: path => ({ path }) });
    assert.deepEqual(items.map(item => [item.label, item.color, !!item.trailingHtml, item.path]), [['Base', ROLE_COLORS[0], true, undefined], ['1 · one.wav', ROLE_COLORS[1], false, 'one.wav'], ['· · grey.wav', NO_ROLE_COLOR, false, 'grey.wav']]);
    const gated = overlayLegendItems(frame, plots, { title: 'Base', group: false, gated: true, tableBase: views['base.wav'], tableBands: { count: 7 }, count: 40, held: true, playable: () => ({}) });
    assert.equal(gated[0].label, `Base${strings.stageBaseTableNote}`);
    assert.equal(gated[0].hint, strings.stageBaseTableHint.replace('{m}', '7').replace('{n}', '40'));
    assert.equal(gated[1].held, true);
    assert.deepEqual(overlayLegendItems({ ...frame, referencePath: 'base.wav' }, plots, { title: 'Base', group: false, gated: false, tableBase: null, tableBands: null, count: 1, held: false, playable: () => ({}) }).map(item => item.label), ['1 · one.wav', '· · grey.wav']);
});

test('the overlaid plot draws its difference under it only on request, with a compared file and no base measured against', () => {
    const { dom_, lane, painted } = page();
    const tracks = [lane('base.wav'), lane('one.wav')];
    const frame = frameFor(tracks, { 'base.wav': line([-20, -30]), 'one.wav': line([-10, -30]) });
    const plots = plotsOf(frame.shown, tracks, 'one.wav', ['base.wav']);
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
