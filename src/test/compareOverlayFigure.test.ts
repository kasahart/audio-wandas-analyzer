/**
 * The comparison's spectrum overlay on the new path: its spec (charts/compareOverlay.ts: the declared order of 仕様 1
 * and the Δ lane), the gestures the old overlay offered that the Figure now takes (R13: Ctrl+wheel zoom about the
 * pointer, Shift+wheel and a swipe pan, + / − / 0, an Alt+drag that is a box zoom where nothing takes a stretch), the
 * picture's calibration words and Δ headline in the readout's form, and which host messages are a long computation
 * (spec 4). The service is the tests' stand-in (helpers/figureStandIn.ts); nothing here picks or counts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compareOverlay, OVERLAY_LINE } from '../webview/charts/compareOverlay';
import { createFigureAnswers } from '../webview/answers/figureRequests';
import { watchLongComputations } from '../webview/answers/longComputations';
import { axisScale } from '../webview/figure/axisScale';
import { specifiedEnds, type Figure } from '../webview/figure/figure';
import { zoomRangeAroundPivot, panNormalizedRangeBy, ZOOM_IN_FACTOR } from '../webview/figure/zoomSteps';
import type { FigureDrawPayload, FigureDrawResult, FigureView } from '../shared/protocol/generated/backendProtocolSchema';
import { figurePage, SCENE_SIZE, scenePicture, sceneSpec, WORDS, type FigurePage } from './helpers/figureStandIn';
import type { Scene } from './helpers/figureOverlayRun';

const repoRoot = path.resolve(__dirname, '..', '..');
const SCENE = (JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'tests', 'fixtures', 'figure_overlay_cases.json'), 'utf8')) as { scenes: Record<string, Scene> }).scenes.spectrum;
const FRAME = { left: 56, top: 10, width: 600, height: 200 };
let pictures = 0;

function answer(page: FigurePage, more: (picture: FigureDrawResult) => FigureDrawResult = picture => picture): void {
    for (const draw of page.draws()) draw.answer(more(scenePicture(SCENE, draw.message.payload as FigureDrawPayload, `p${++pictures}`)));
}
function drawn(page: FigurePage, more?: (picture: FigureDrawResult) => FigureDrawResult): { figure: Figure; views: FigureView[] } {
    const figure = page.figure(undefined, SCENE_SIZE);
    const views: FigureView[] = [];
    figure.on('view', view => { views.push(view); });
    figure.show(sceneSpec(), null);
    answer(page, more);
    return { figure, views };
}
const wheel = (page: FigurePage, at: { x: number; y: number }, init: WheelEventInit): void => {
    page.window.HTMLCanvasElement.prototype.dispatchEvent.call(page.document.querySelector('canvas'), new page.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, ...init }));
};
const WHOLE_X = axisScale(20, 20000, true);
const near = (actual: number, expected: number, what: string): void => assert.ok(Math.abs(actual - expected) < 1, `${what}: ${actual} is not within 1 of ${expected}`);

test('the overlay\'s spec declares its lines in the order they are drawn: no role, the base, compare 1, 2, then the Δ lane of compare 1 − the base (仕様 1)', () => {
    const keys = ['o', 'b1', 'b2', 'c1', 'c2'].map(key => ({ key, state: 'usable' as const, version: key }));
    const spec = compareOverlay({ others: ['o'], base: ['b1', 'b2'], compare: ['c1', 'c2'], delta: true, keys });
    assert.deepEqual(spec.lanes.map(lane => lane.id), ['overlay', 'delta']);
    assert.deepEqual(spec.lanes[0].lines.map(line => [line.id, line.role ?? null, line.of]), [
        ['other1', null, { key: 'o' }], ['base', 'base', { median: ['b1', 'b2'] }], ['compare1', 'compare1', { key: 'c1' }], ['compare2', 'compare2', { key: 'c2' }],
    ]);
    assert.deepEqual(spec.lanes[1].lines, [{ id: OVERLAY_LINE.delta, of: { delta: { compare: 'c1', base: ['b1', 'b2'] } }, role: 'compare1' }]);
    assert.deepEqual(spec.keys, keys, 'every key with the state and version answers/ gave it');
    // One base recording is declared as the base's set too: whether it is one recording or a median is 計算ア's.
    assert.deepEqual(compareOverlay({ others: [], base: ['b1'], compare: ['c1'], delta: false, keys }).lanes[0].lines[0], { id: 'base', of: { median: ['b1'] }, role: 'base' });
    // No Δ without the request, a compared recording or a base.
    assert.equal(compareOverlay({ others: [], base: [], compare: ['c1'], delta: true, keys }).lanes.length, 1);
    assert.equal(compareOverlay({ others: [], base: ['b1'], compare: [], delta: true, keys }).lanes.length, 1);
    // The screen cannot choose a line of one key, or none, for the base: the type has no way to say it.
    // (Never called: tsc rejects them, which is what is checked.)
    void (() => [
        // @ts-expect-error the base is a set of keys, never one key
        compareOverlay({ others: [], base: { key: 'b1' }, compare: ['c1'], delta: false, keys }),
        // @ts-expect-error the base is a set of keys, never a median chosen by the screen
        compareOverlay({ others: [], base: { median: ['b1', 'b2'] }, compare: ['c1'], delta: false, keys }),
    ]);
});

test('time signals overlaid (R1): each base recording is a line of its own, and a Δ lane is declared only against one base recording, never a group', () => {
    const keys = ['b1', 'b2', 'c1'].map(key => ({ key, state: 'usable' as const, version: key }));
    const one = compareOverlay({ others: [], base: ['b1'], compare: ['c1'], delta: true, signals: true, keys });
    assert.deepEqual(one.lanes.map(lane => lane.id), ['overlay', 'delta']);
    assert.deepEqual(one.lanes[1].lines, [{ id: OVERLAY_LINE.delta, of: { delta: { compare: 'c1', base: ['b1'] } }, role: 'compare1' }]);
    const group = compareOverlay({ others: [], base: ['b1', 'b2'], compare: ['c1'], delta: true, signals: true, keys });
    assert.deepEqual(group.lanes.map(lane => lane.id), ['overlay'],
        'Rule: docs/display-rules.md R1, a time signal\'s Δ is taken only against one base recording (the median of unaligned waveforms is near 0). '
        + 'Fix: keep `s.base.length === 1` in signalOverlay (src/webview/charts/compareOverlay.ts).');
    assert.deepEqual(group.lanes[0].lines.map(line => [line.id, line.of]), [['base1', { key: 'b1' }], ['base2', { key: 'b2' }], ['compare1', { key: 'c1' }]]);
});

test('a lane a recording (「One lane per track」): each recording on screen is a lane of its own line, in the tracks\' order, with no median and no Δ; sounds as band lanes, a trigger\'s events by their recording', () => {
    const keys = ['o', 'b1', 'b2', 'c1'].map(key => ({ key, state: 'usable' as const, version: key }));
    const spec = compareOverlay({ others: ['o'], base: ['b1', 'b2'], compare: ['c1'], delta: true, apart: ['c1', 'b2', 'o', 'b1'], keys });
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.kind, lane.lines.map(line => [line.id, line.role ?? null, line.of])]), [
        ['own-compare1', 'lines', [['compare1', 'compare1', { key: 'c1' }]]],
        // A base recording's line is declared as the base is everywhere (its set, here of one: its own answer).
        ['own-base2', 'lines', [['base2', 'base', { median: ['b2'] }]]],
        ['own-other1', 'lines', [['other1', null, { key: 'o' }]]],
        ['own-base1', 'lines', [['base1', 'base', { median: ['b1'] }]]],
    ]);
    assert.deepEqual(spec.keys, keys);
    // Sounds: a band lane each, a base recording's own signal.
    const sounds = compareOverlay({ others: [], base: ['b1'], compare: ['c1'], delta: true, signals: true, apart: ['b1', 'c1'], keys });
    assert.deepEqual(sounds.lanes.map(lane => [lane.id, lane.kind, lane.lines[0].of]), [['own-base1', 'band', { key: 'b1' }], ['own-compare1', 'band', { key: 'c1' }]]);
    // A trigger's events: the lines as the screen declared them, each in its recording's lane.
    const events = [{ id: 'compare1#1', of: { key: 'c1#event:0' } }, { id: 'compare1#2', of: { key: 'c1#event:1' } }, { id: 'base1#1', of: { key: 'b1#event:0' } }];
    assert.deepEqual(compareOverlay({ others: [], base: [], compare: [], delta: false, events, apart: [], keys }).lanes.map(lane => [lane.id, lane.kind, lane.lines.map(line => line.id)]),
        [['own-compare1', 'band', ['compare1#1', 'compare1#2']], ['own-base1', 'band', ['base1#1']]]);
});

test('Ctrl+wheel zooms the axis across about the pointer, over an axis about its middle; Shift+wheel pans a tenth; a sideways swipe pans as far as the fingers went (R13)', () => {
    const page = figurePage();
    const { figure, views } = drawn(page);
    const at = { x: FRAME.left + 150, y: FRAME.top + 100 };
    wheel(page, at, { deltaY: -100, ctrlKey: true });
    assert.equal(views.length, 1);
    assert.deepEqual(views[0].x, specifiedEnds(WHOLE_X, zoomRangeAroundPivot({ start: 0, end: 1 }, 0.25, 0.85)), 'about the pointer, by the wheel\'s step, at the range field\'s decimals');
    // Over the axis across (under the last lane, the Δ's): about its middle.
    wheel(page, { x: FRAME.left + 150, y: 232 + 160 + 10 }, { deltaY: 100, ctrlKey: true });
    assert.deepEqual(views[1].x, [null, null], 'zoomed out from the whole: still the whole');
    wheel(page, at, { deltaY: 100, shiftKey: true });
    assert.deepEqual(views[2].x, [null, null], 'a pan of the whole stays the whole');
    // Zoomed in first (the screen hands the view back), a pan moves it.
    figure.show(sceneSpec(), views[0]);
    answer(page);
    wheel(page, at, { deltaY: 100, shiftKey: true });
    const part = zoomRangeAroundPivot({ start: 0, end: 1 }, 0.25, 0.85);
    const shownPart = { start: WHOLE_X.fraction(views[0].x[0]!), end: WHOLE_X.fraction(views[0].x[1]!) };
    assert.deepEqual(views[3].x, specifiedEnds(WHOLE_X, panNormalizedRangeBy(shownPart, 0.1)), 'a tenth of what is shown, later');
    assert.ok(part.end < 1);
    wheel(page, at, { deltaX: 60, deltaY: 0 });
    assert.deepEqual(views[4].x, specifiedEnds(WHOLE_X, panNormalizedRangeBy(shownPart, 60 / FRAME.width)), 'a swipe pans by the pixels moved');
    figure.dispose();
});

test('+ / − / 0 over the Figure zoom the axis across about its middle or reset every axis; the screen\'s zoom with the pointer elsewhere does the same (R13)', () => {
    const page = figurePage();
    const { figure, views } = drawn(page);
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 10, FRAME.top + 10, { buttons: 0 });
    page.key('+');
    assert.deepEqual(views[0].x, specifiedEnds(WHOLE_X, zoomRangeAroundPivot({ start: 0, end: 1 }, 0.5, ZOOM_IN_FACTOR)));
    page.key('0');
    assert.deepEqual(views[1], { x: [null, null], lanes: [] });
    figure.zoom('in');
    assert.deepEqual(views[2].x, views[0].x);
    figure.dispose();
});

test('an Alt+drag where no screen takes a stretch is a drag as any: a box zoom, as on the old overlay', () => {
    const page = figurePage();
    const { figure, views } = drawn(page);
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 120, FRAME.top + 50, { altKey: true });
    page.mouse(page.document, 'mousemove', FRAME.left + 420, FRAME.top + 150, { buttons: 1, altKey: true });
    page.mouse(page.document, 'mouseup', FRAME.left + 420, FRAME.top + 150, { altKey: true });
    assert.equal(views.length, 1);
    assert.deepEqual(views[0].x, specifiedEnds(WHOLE_X, { start: 0.2, end: 0.7 }));
    figure.dispose();
});

test('the calibration words and the Δ headline are the picture\'s: an uncalibrated line on an axis named calibrated says so, and the headline is in the readout\'s form', () => {
    const page = figurePage();
    const { figure } = drawn(page, picture => ({
        ...picture,
        lanes: picture.lanes!.map(lane => ({ ...lane, axis: { ...lane.axis, calibration: 'calibrated' as const } })),
        headlines: [{ lane: 'delta', line: 'delta', index: 3, x: 1234, xStep: 10, value: 4.26 }],
        members: { ...picture.members!, calibration: 'calibrated', lines: picture.members!.lines.map(line => ({ ...line, calibration: line.line === 'other' ? 'uncalibrated' as const : 'calibrated' as const })) },
    }));
    const headline = figure.inspect().headline;
    // Its place written to the digits its data step tells apart, as a readout writes it (frequencyText).
    assert.equal(headline, 'Largest Δ +4.3 dB at 1.234 kHz');
    const [read] = page.reads();
    assert.equal(read, undefined, 'nothing read without a pointer');
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 300, FRAME.top + 100, { buttons: 0 });
    const [hover] = page.reads();
    const payload = hover.message.payload as { figureId: string; pictureId: string; requestNumber: number };
    hover.answer({ status: 'point', figureId: payload.figureId, pictureId: payload.pictureId, requestNumber: payload.requestNumber, lane: 'overlay', line: 'other', version: 'other@v1', point: { index: 2, x: 500, value: -40, key: 'oth' } });
    assert.equal(figure.inspect().readout, 'other, uncalibrated / 500 Hz / −40.0 dBFS');
    figure.dispose();
});

test('a scan and a recipe analysed again are long computations, each until its answer or a newer one of its kind (spec 4)', () => {
    const answers = createFigureAnswers({ post: () => undefined, cancels: false, holdsReadsWhileComputing: true });
    const watch = watchLongComputations(answers.computations);
    const count = (): number => answers.computations.count();
    watch.posted({ type: 'compare-scan', requestId: 'track-stage-1' });
    watch.posted({ type: 'compare-scan', requestId: 'report-scan-1' });
    assert.equal(count(), 2);
    // A newer scan of one asker takes the older one's place: the host drops it without a done.
    watch.posted({ type: 'compare-scan', requestId: 'track-stage-2' });
    assert.equal(count(), 2);
    watch.received({ type: 'compare-scan-done', requestId: 'track-stage-1' });
    assert.equal(count(), 2, 'the done of a scan dropped ends nothing');
    watch.received({ type: 'compare-scan-done', requestId: 'track-stage-2' });
    watch.received({ type: 'compare-scan-done', requestId: 'report-scan-1' });
    assert.equal(count(), 0);
    watch.received({ type: 'reanalyze-start' });
    assert.equal(count(), 1);
    watch.received({ type: 'reanalyze-end' });
    assert.equal(count(), 0);
    // While one is under way, a Figure's reads are held (the browser build).
    watch.posted({ type: 'compare-scan', requestId: 'track-stage-3' });
    assert.equal(answers.figure().readsHeld(), true);
});

test('the previous picture is drawn on the new view only when the range or the size changed: a resize maps it, a new answer\'s version or a new line does not (第 6 節 2)', () => {
    const page = figurePage();
    const { figure } = drawn(page);
    figure.resize(700, 422);
    assert.equal(figure.inspect().waiting, true);
    assert.equal(figure.inspect().mapped, true, 'a size change maps the previous picture');
    assert.ok(figure.inspect().lanes[0].lines.length > 0);
    answer(page);
    figure.show(sceneSpec({}, { oth: 'v2' }), null);
    assert.equal(figure.inspect().mapped, false, 'a version changed: nothing old drawn');
    assert.deepEqual(figure.inspect().lanes, []);
    answer(page);
    const spec = sceneSpec();
    figure.show({ ...spec, lanes: [spec.lanes[0]] }, null);
    assert.equal(figure.inspect().mapped, false, 'a lane less: nothing old drawn');
    figure.dispose();
});

test('the Δ headline is in the readout\'s form: its place and value written as a read of that point writes them (第 5 節 オ)', () => {
    const page = figurePage();
    // Points half a hertz apart: the place is written to the digits that tell them apart (frequencyText's step).
    const peak = { lane: 'delta', line: 'delta', index: 7, x: 1234.5, xStep: 0.5, value: 4.26 };
    const { figure } = drawn(page, picture => ({ ...picture, headlines: [peak] }));
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 300, 232 + 80, { buttons: 0 });
    const [hover] = page.reads();
    const payload = hover.message.payload as { figureId: string; pictureId: string; requestNumber: number };
    hover.answer({ status: 'point', figureId: payload.figureId, pictureId: payload.pictureId, requestNumber: payload.requestNumber, lane: 'delta', line: 'delta', role: 'compare1', version: 'delta@v1', point: { index: peak.index, x: peak.x, xStep: peak.xStep, value: peak.value } });
    const [, at, delta] = figure.inspect().readout.split(' / ');
    assert.equal(figure.inspect().headline, `Largest Δ ${delta} at ${at}`);
    figure.dispose();
});

test('目安の線 (guide lines) of a picture are drawn at their place on one axis and are never lines read, ordered or named; the mark (印) is only ever on a point read', () => {
    const page = figurePage();
    const { figure } = drawn(page, picture => ({ ...picture, lanes: picture.lanes!.map(lane => (lane.id === 'overlay' ? { ...lane, guides: [{ axis: 'x' as const, at: 1000 }, { axis: 'y' as const, at: -30 }] } : lane)) }));
    const lane = figure.inspect().lanes[0];
    assert.deepEqual(lane.guides.map(guide => [guide.axis, guide.at]), [['x', 1000], ['y', -30]]);
    near(lane.guides[0].px, FRAME.left + Math.log(1000 / 20) / Math.log(1000) * FRAME.width, 'the guide across, at its place');
    near(lane.guides[1].px, FRAME.top + (1 - (-30 - -60) / 50) * FRAME.height, 'the guide up, at its place');
    assert.deepEqual(lane.order, ['median', 'compare', 'other'], 'no guide among the lines drawn');
    // The pointer on the guide across: what is read is the service's point of a line, never the guide.
    page.mouse(figure.canvas, 'mousemove', lane.guides[0].px, FRAME.top + 20, { buttons: 0 });
    const [hover] = page.reads();
    assert.ok(hover, 'a read is asked, of the lines');
    assert.equal(JSON.stringify(hover.message.payload).includes('guide'), false);
    assert.equal(figure.inspect().mark, null, 'no mark before a point is read');
    figure.dispose();
});

test('the Δ\'s headline and axis name the slot the screen says is compared, not always slot 1 (#848)', () => {
    const page = figurePage();
    let slot: number | undefined = 2;
    const words = { ...WORDS, deltaPair: 'Compare {n} − Base', axisDelta: 'Δ = {pair} [dB]', stageMaxDelta: 'Largest Δ ({pair}) {delta} at {at}' };
    const figure = page.figure(undefined, { ...SCENE_SIZE, words, deltaSlot: () => slot });
    figure.show(sceneSpec(), null);
    answer(page, picture => ({ ...picture, headlines: [{ lane: 'delta', line: 'delta', index: 3, x: 1234, xStep: 10, value: 4.26 }] }));
    // Slot 2 tapped (or slot 1 empty): the Δ is compare 2 − the base, and says so (trackStageModel.ts comparedPath).
    assert.equal(figure.inspect().headline, 'Largest Δ (Compare 2 − Base) +4.3 dB at 1.234 kHz');
    assert.equal(figure.inspect().lanes.find(lane => lane.id === 'delta')?.axisNames.y, 'Δ = Compare 2 − Base [dB]');
    // No slot said: slot 1, the compared one by default.
    slot = undefined;
    assert.equal(figure.inspect().headline, 'Largest Δ (Compare 1 − Base) +4.3 dB at 1.234 kHz');
    figure.dispose();
});
