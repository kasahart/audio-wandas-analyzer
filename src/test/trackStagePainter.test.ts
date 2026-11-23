import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { ROLE_COLORS } from '../shared/gui/roleColors';
import { emptyStageText, overlayLegendItems, paintBaseGate, paintStageControls, stageDom, stageModeHeadline, writeStageLegend, type StageTrack } from '../webview/runtime/trackStagePainter';

/**
 * The comparison's own markup around its Figure (trackStagePainter.ts): the controls, the headline's notes, the base
 * group's gate and the legend. What the plots draw, read and count is the Figure's and the figure service's, tested
 * there (figureComponent.test.ts, compareOverlayFigure.test.ts, python-backend/test_figures_*.py).
 */
const strings = getStrings('en');

/** The mode's markup on a page. */
function page() {
    const dom = new JSDOM(`<!doctype html><body><div class="track-stage"><nav data-step-bar></nav><div class="track-stage-controls">`
        + `<button data-action="stage-layout"></button><button data-action="stage-diff"></button><span data-stage-headline></span>`
        + `<span data-stage-base-gate hidden><button data-action="stage-base-scan"></button></span></div>`
        + `<div data-stage-panel><div data-stage-legend></div><div data-stage-message hidden></div><div data-stage-figure hidden></div></div></div></body>`);
    const document = dom.window.document;
    const root = document.querySelector('.track-stage') as HTMLElement;
    return { dom, document, dom_: stageDom(root, root.querySelector('nav') as HTMLElement) };
}

const slots = ['base.wav', 'one.wav', null, null];
const role = (path: string): number | undefined => { const at = slots.indexOf(path); return at >= 0 ? at : undefined; };
const named = (path: string, slot: number | undefined) => ({ label: `${slot ?? '·'} · ${path}` });
const track = (filePath: string): StageTrack => ({ filePath, color: '#888' });

test('the mode\'s parts are found once; a part missing from its markup is an error, not a null', () => {
    const { dom_ } = page();
    assert.equal(dom_.panel.getAttribute('data-stage-panel'), '');
    assert.throws(() => dom_.query('[data-no-such-part]'), /no \[data-no-such-part\]/);
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
    const frame = { strings, waiting: false, referencePath: null as string | null, comparePath: 'one.wav' as string | null, named };
    const text = stageModeHeadline(frame, ['HPF 20 Hz'], { start: 0.5, end: 1 });
    assert.equal(text, `${strings.stepBypassing.replace('{ops}', 'HPF 20 Hz')} · ${strings.stepRegion} 0.50–1.00 s`.replace(/^\s*(·\s*)?/, ''));
    assert.equal(stageModeHeadline(frame, [], null), '');
    assert.equal(stageModeHeadline({ ...frame, waiting: true }, ['x'], null), '');
    assert.equal(stageModeHeadline({ ...frame, comparePath: null }, [], null), strings.stageChooseRoles);
    assert.equal(stageModeHeadline({ ...frame, referencePath: 'base.wav' }, [], null), strings.stageVsBase.replace('{file}', '0 · base.wav'));
    assert.equal(stageModeHeadline(frame, [], { start: 0.5, end: 1 }), `${strings.stepRegion} 0.50–1.00 s`);
    assert.equal(stageModeHeadline(frame, ['HPF 20 Hz'], null), strings.stepBypassing.replace('{ops}', 'HPF 20 Hz').trim());
});

test('the legend names the base (a group with how its curve is made), the compared recording, then the others; measured against the base slot\'s recording, the base has no entry', () => {
    const base = { title: 'Base · n=3', group: true, gated: false, count: 3, held: false, playable: (path: string) => ({ path }) };
    const items = overlayLegendItems({ comparePath: 'one.wav', referencePath: null, role, named, strings }, [track('two.wav')], base);
    assert.deepEqual(items.map(item => [item.label, item.color]), [['Base · n=3', ROLE_COLORS[0]], ['1 · one.wav', ROLE_COLORS[1]], ['· · two.wav', '#888']]);
    assert.match(items[0].trailingHtml ?? '', /data-action="stage-base-info"/u);
    assert.equal(items[1].active, true);
    // A base group not analysed says it has no line.
    assert.equal(overlayLegendItems({ comparePath: 'one.wav', referencePath: null, role, named, strings }, [], { ...base, gated: true })[0].label, `Base · n=3${strings.stageBaseNoLine}`);
    // Measured against the base slot's recording: the base is the reference, on no line and in no legend entry.
    assert.deepEqual(overlayLegendItems({ comparePath: 'one.wav', referencePath: 'base.wav', role, named, strings }, [], base).map(item => item.label), ['1 · one.wav']);
    // Nothing compared: the recordings on screen alone.
    assert.deepEqual(overlayLegendItems({ comparePath: null, referencePath: null, role, named, strings }, [track('two.wav')], base).map(item => item.label), ['· · two.wav']);
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

test('with no figure to show, the comparison says why: a trigger that found no event says to lower its level, any other step that it is not drawn', () => {
    const words = { stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' };
    assert.equal(emptyStageText(words, { frame: 'ChannelFrameSegments', kind: 'line', events: [] }), 'lower it');
    assert.equal(emptyStageText(words, { frame: 'X', kind: 'none' }), 'no X');
    assert.equal(emptyStageText(words, null), 'no ');
});
