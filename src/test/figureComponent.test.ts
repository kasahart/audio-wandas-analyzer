/**
 * The Figure (src/webview/figure/) against a stand-in of the figure service (figure-design.md 第 9 節, the Figure
 * part): what it draws is at the places the picture's points are (< 1 px), its ticks come of the picture's confirmed
 * range, its read mark is at the point read, its read requests carry the lane, the place and the scale, it uses no
 * stale reply, a click waiting for its read follows the redraw rule (第 1 節, the third consequence), a double press
 * takes back the first click through the page's one arbitration (R13), the range fields make today's ends (R9), and
 * the browser build's long computations hold the readout (spec 4). Cases come from the shared test data recorded from
 * the old path (python-backend/tests/fixtures/figure_overlay_cases.json).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { FigureReadPayload, FigureView } from '../shared/protocol/generated/backendProtocolSchema';
import { axisScale } from '../webview/figure/axisScale';
import { specifiedEnds, tickNameAt, type Figure, type FigurePick } from '../webview/figure/figure';
import { alongAxisTicks, valueAxisTicks } from '../webview/figure/ticks';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotWindow } from '../webview/runtime/plotInteraction';
import { keyRouterFor } from '../webview/shell/keyRouter';
import { figurePage, keysReply, pointReply, SCENE_SIZE, scenePicture, sceneSpec, type FigurePage } from './helpers/figureStandIn';
import type { PendingInput, R13Input, R7Input, R9Input, Scene } from './helpers/figureOverlayRun';

const repoRoot = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(repoRoot, 'python-backend', 'tests', 'fixtures', 'figure_overlay_cases.json');
type Case<I, E = unknown> = { id: string; input: I; expected: E; changes_with?: string };
type ReadRecord = { line: string; index: number; at: number; value: number | string; x_px: number; y_px: number; name: string; values: string } | { line: string; empty: true } | null;
const TABLE = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    scenes: Record<string, Scene>;
    r7: Array<Case<R7Input & { view: { scale: { x: number; y: number } } }, { ts: { read: ReadRecord; steps?: ReadRecord[] } }>>;
    r9: Array<Case<R9Input, { painted: { x: number[]; y: number[] }; fields: { min: string; max: string }; applied?: { closed: boolean; error: string; painted: { x: number[]; y: number[] }; fields_again: { min: string; max: string } | null } }>>;
    r13: Array<Case<R13Input, { fired: string[] }>>;
    pending_click: Array<Case<PendingInput, { acted: Array<{ line: string; at: number; value: number }>; undone: unknown[] }>>;
};
const SCENE = TABLE.scenes.spectrum;
const FRAMES = { overlay: { left: 56, top: 10, width: 600, height: 200 }, delta: { left: 56, top: 232, width: 600, height: 160 } } as const;
const laneOf = (pane: 'overlay' | 'diff'): 'overlay' | 'delta' => (pane === 'diff' ? 'delta' : 'overlay');
const WHOLE = { x: [20, 20000], overlay: [-60, -10], delta: [-32, 32] } as const;

/** A Figure on a page with the scene drawn (the first draw answered), at `view`. */
function drawn(page: FigurePage, view: FigureView | null = null, options: Parameters<FigurePage['figure']>[1] = {}): Figure {
    const figure = page.figure(undefined, { ...SCENE_SIZE, ...options });
    figure.show(sceneSpec(), view);
    answerDraws(page);
    return figure;
}
let pictures = 0;
function answerDraws(page: FigurePage): void {
    for (const draw of page.draws()) draw.answer(scenePicture(TABLE.scenes.spectrum, draw.message.payload as never, `picture-${++pictures}`));
}
/** The client place of a point given in CSS px from a lane's frame's top left. */
const client = (lane: 'overlay' | 'delta', at: { x: number; y: number }): { x: number; y: number } => ({ x: FRAMES[lane].left + at.x, y: FRAMES[lane].top + at.y });
const near = (actual: number, expected: number, what: string, tolerance = 1): void => assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
/** A view of a case's zoom (fractions of the whole axes), by the Figure's own rule for a part's ends. */
function zoomView(window?: { x: { start: number; end: number }; y: { start: number; end: number } }, diffY?: { start: number; end: number }): FigureView | null {
    if (!window && !diffY) return null;
    const x = window ? specifiedEnds(axisScale(WHOLE.x[0], WHOLE.x[1], true), window.x) : [null, null];
    const lanes = [];
    if (window) lanes.push({ lane: 'overlay', y: specifiedEnds(axisScale(WHOLE.overlay[0], WHOLE.overlay[1], false), window.y) });
    if (diffY) lanes.push({ lane: 'delta', y: specifiedEnds(axisScale(WHOLE.delta[0], WHOLE.delta[1], false), diffY) });
    return { x, lanes };
}
const xRangeOf = (view: FigureView | null): [number, number] => [view?.x?.[0] ?? WHOLE.x[0], view?.x?.[1] ?? WHOLE.x[1]];

// ── R7: places, marks, requests ─────────────────────────────────────────────────────────────────────────────────

for (const item of TABLE.r7.filter(row => row.changes_with !== 'spec1')) {
    test(`R7 ${item.id}: the read request carries the lane, the place and the scale; the mark is at the point read (< 1 px) and the readout writes it`, () => {
        const page = figurePage();
        const view = zoomView(item.input.window, item.input.diffY);
        const figure = drawn(page, view);
        const lane = laneOf(item.input.pane);
        const at = client(lane, item.input.pointer);
        page.mouse(figure.canvas, 'mousemove', at.x, at.y, { buttons: 0 });
        const [read] = page.reads();
        assert.ok(read, 'a read is asked at the pointer');
        const payload = read.message.payload as FigureReadPayload;
        assert.equal(payload.pointer?.lane, lane);
        const [low, high] = xRangeOf(view);
        const expectedX = low * (high / low) ** (item.input.pointer.x / 600);
        near(payload.pointer.x / expectedX, 1, 'the pointer\'s place across (as a ratio)', 1e-9);
        near(payload.pointer.scale[0], item.input.view.scale.x, 'px per natural-log unit across', 1e-9);
        near(payload.pointer.scale[1], item.input.view.scale.y, 'px per dB up', 1e-9);
        const expected = item.expected.ts.read;
        const answer = (record: ReadRecord, asked: FigureReadPayload) => (record && 'index' in record
            ? pointReply(SCENE, asked, lane, record.line, record.index)
            : { status: record ? 'no-value' : 'outside', figureId: asked.figureId, pictureId: asked.pictureId, requestNumber: asked.requestNumber, lane } as const);
        read.answer(answer(expected, payload));
        const check = (record: ReadRecord, what: string): void => {
            const seen = figure.inspect();
            if (!record || !('index' in record)) {
                assert.equal(seen.mark, null, `${what}: no mark`);
                assert.equal(seen.readout, record ? '— (no value here)' : '', `${what}: the readout`);
                return;
            }
            assert.ok(seen.mark, `${what}: a mark`);
            near(seen.mark.px, FRAMES[lane].left + record.x_px, `${what}: the mark across`);
            near(seen.mark.py, FRAMES[lane].top + record.y_px, `${what}: the mark up`);
            // As today's readout row writes it (showPlotReadout: name / values), a level in its axis's reference (the
            // stand-in's axis is dBFS; the recorded scene's had none, so its values carry no unit).
            assert.equal(seen.readout, `${record.name} / ${record.values}${lane === 'overlay' ? ' dBFS' : ''}`, `${what}: the readout (layer 3 rounds)`);
            // The line read is drawn last, on top (spec 1).
            const order = seen.lanes.find(item2 => item2.id === lane)!.order;
            assert.equal(order[order.length - 1], record.line, `${what}: the line read is drawn last`);
        };
        check(expected, 'the read');
        (item.expected.ts.steps ?? []).forEach((record, index) => {
            const step = item.input.steps![index];
            page.key(step > 0 ? 'ArrowRight' : 'ArrowLeft');
            // Every key is a step read (b) from the selected point by its name: the Webview holds no list of points.
            const asked = page.reads();
            assert.equal(asked.length, 1, 'one step read per key');
            const payload = asked[0].message.payload as FigureReadPayload;
            assert.equal(payload.step?.steps, step > 0 ? 1 : -1);
            assert.equal(payload.pointer, undefined);
            asked[0].answer(keysReply(SCENE, payload, xRangeOf(view)));
            check(record, `step ${index + 1}`);
        });
        figure.dispose();
    });
}

test('every line is drawn at the places of its drawn points (< 1 px), in declared order, and the ticks are placed from the confirmed range', () => {
    const page = figurePage();
    const figure = drawn(page);
    const seen = figure.inspect();
    assert.deepEqual(seen.lanes.map(lane => lane.id), ['overlay', 'delta']);
    assert.deepEqual(seen.lanes[0].order, ['median', 'compare', 'other'], 'declared order (spec 1)');
    for (const lane of seen.lanes) {
        const frame = FRAMES[lane.id as 'overlay' | 'delta'];
        assert.deepEqual(lane.frame, frame);
        const [ymin, ymax] = lane.id === 'overlay' ? WHOLE.overlay : WHOLE.delta;
        for (const line of lane.lines) {
            const spec = SCENE.lines[line.id as keyof Scene['lines']];
            line.points.forEach((point, index) => {
                const value = spec.values[index];
                if (typeof value !== 'number') { assert.equal(point, null, `${line.id}[${index}] is a gap`); return; }
                assert.ok(point);
                near(point[0], frame.left + Math.log(spec.xs[index] / 20) / Math.log(1000) * frame.width, `${line.id}[${index}] across`);
                near(point[1], frame.top + (1 - (value - ymin) / (ymax - ymin)) * frame.height, `${line.id}[${index}] up`);
            });
        }
        const yTicks = valueAxisTicks({ min: ymin, max: ymax }, frame.height);
        assert.deepEqual(lane.yTicks.map(tick => [tick.value, tick.text]), yTicks.map(tick => [tick.value, tick.text]), 'the value ticks of the confirmed range');
        for (const tick of lane.yTicks) near(tick.px, frame.top + (1 - (tick.value - ymin) / (ymax - ymin)) * frame.height, `tick ${tick.text}`, 1e-9);
        assert.deepEqual(lane.xTicks.map(tick => tick.value), alongAxisTicks(20, 20000, true).map(tick => tick.value));
        assert.equal(lane.axisNames.x, 'Frequency [Hz]');
    }
    assert.equal(seen.lanes[0].axisNames.y, 'Level (uncalibrated) [dBFS]', 'the level axis is named from the picture\'s reference and calibration words');
    assert.equal(seen.lanes[1].axisNames.y, 'Difference Δ [dB]');
    figure.dispose();
});

test('a zoomed picture\'s ticks come of its own confirmed range, never the whole axis', () => {
    const page = figurePage();
    const figure = drawn(page, { x: [123.457, 4567.891], lanes: [{ lane: 'overlay', y: [-47.25, -12.125] }] });
    const lane = figure.inspect().lanes[0];
    assert.deepEqual(lane.range, { x: [123.457, 4567.891], y: [-47.25, -12.125] });
    assert.deepEqual(lane.yTicks.map(tick => tick.value), valueAxisTicks({ min: -47.25, max: -12.125 }, 200).map(tick => tick.value));
    for (const tick of lane.xTicks) assert.ok(tick.value >= 123.457 && tick.value <= 4567.891 && tick.px >= 56 && tick.px <= 656, `tick ${tick.text} inside`);
    figure.dispose();
});

// ── Stale replies ───────────────────────────────────────────────────────────────────────────────────────────────

test('a draw reply of an older generation is not drawn; the newest is (reordering)', () => {
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), null);
    const [first] = page.draws();
    figure.show(sceneSpec(), { x: [100, 1000] });
    figure.show(sceneSpec(), { x: [200, 2000] });
    first.answer(scenePicture(SCENE, first.message.payload as never, 'old'));
    assert.equal(figure.inspect().pictureId, null, 'the first draw is of an older generation');
    const [newest] = page.draws();
    assert.equal((newest.message.payload as { generation: number }).generation, 3, 'the middle one waited and was dropped');
    newest.answer(scenePicture(SCENE, newest.message.payload as never, 'new'));
    assert.equal(figure.inspect().pictureId, 'new');
    assert.deepEqual(figure.inspect().lanes[0].range?.x, [200, 2000]);
    figure.dispose();
});

test('read replies are used only for the current picture and the newest read: an older reply arriving later is dropped', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 }), b = client('overlay', { x: 240.82399653118495, y: 8 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    // A press elsewhere asks its own read, counted apart (the click's): two reads are out at once.
    page.mouse(figure.canvas, 'mousemove', b.x, b.y, { buttons: 0 });
    page.mouse(figure.canvas, 'mousedown', b.x, b.y);
    const reads = page.reads();
    assert.equal(reads.length, 2, 'the hover\'s and the click\'s read are both out');
    const [older, newer] = reads;
    newer.answer(pointReply(SCENE, newer.message.payload as FigureReadPayload, 'overlay', 'compare', 23));
    older.answer(pointReply(SCENE, older.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark?.index, 23, 'the older reply, arriving last, is not shown');
    page.mouse(page.document, 'mouseup', b.x, b.y);
    // A reply for a picture drawn before is not used either.
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [stale] = page.reads();
    figure.resize(670, 423);
    assert.equal(figure.inspect().mark, null, 'a new generation clears the mark');
    page.mouse(figure.canvas, 'mousemove', a.x + 1, a.y, { buttons: 0 });
    assert.deepEqual(page.reads(), [], 'no read while the new picture is on its way');
    stale.answer(pointReply(SCENE, stale.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark, null);
    assert.equal(figure.inspect().readout, '');
    figure.dispose();
});

test('an arrow key\'s point is not overwritten by a hover reply asked before the key', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [first] = page.reads();
    first.answer(pointReply(SCENE, first.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.mouse(figure.canvas, 'mousemove', a.x + 3, a.y, { buttons: 0 });
    const [slow] = page.reads();
    page.key('ArrowRight');
    slow.answer(pointReply(SCENE, slow.message.payload as FigureReadPayload, 'overlay', 'median', 19));
    // The key's step read went once the slow hover read was answered (one read runs at a time).
    for (const read of page.reads()) read.answer(keysReply(SCENE, read.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 20, 'the slow hover reply is not used');
    assert.equal(figure.inspect().mark?.line, 'compare');
    figure.dispose();
});

// ── Generations ─────────────────────────────────────────────────────────────────────────────────────────────────

test('a change of the view alone draws the previous picture\'s points on the new view until the new picture comes; a change of the spec draws nothing old', () => {
    const page = figurePage();
    const figure = drawn(page);
    figure.show(sceneSpec(), { x: [200, 2000], lanes: [{ lane: 'overlay', y: [null, -20] }] });
    const seen = figure.inspect();
    assert.equal(seen.waiting, true);
    assert.equal(seen.mapped, true);
    assert.deepEqual(seen.lanes[0].range, { x: [200, 2000], y: [-60, -20] }, 'specified ends, the others the previous confirmed range');
    const compare = seen.lanes[0].lines.find(line => line.id === 'compare')!;
    const index = SCENE.lines.compare.xs.indexOf(320);
    near(compare.points[index]![0], 56 + Math.log(320 / 200) / Math.log(10) * 600, 'mapped across');
    near(compare.points[index]![1], 10 + (1 - (-12 - -60) / 40) * 200, 'mapped up');
    assert.equal(seen.mark, null);
    answerDraws(page);
    // The spec changed (a version): nothing old is drawn while waiting.
    figure.show(sceneSpec({}, { cmp: 'v2' }), null);
    assert.equal(figure.inspect().waiting, true);
    assert.equal(figure.inspect().mapped, false);
    assert.deepEqual(figure.inspect().lanes, []);
    figure.dispose();
});

test('with keepWhileWaiting a changed spec keeps the last picture drawn until the new one comes, and nothing is read of it', () => {
    const page = figurePage();
    const figure = drawn(page, null, { keepWhileWaiting: true });
    // The spec changed (a version): the picture before stays on the plot while the next is on its way.
    figure.show(sceneSpec({}, { cmp: 'v2' }), null);
    const seen = figure.inspect();
    assert.equal(seen.waiting, true);
    assert.equal(seen.mapped, true);
    assert.deepEqual(seen.lanes[0].lines.map(line => line.id).sort(), ['compare', 'median', 'other']);
    assert.equal(seen.pictureId, null, 'no picture is current: nothing is read, stepped or exported of the one kept');
    const at = client('overlay', { x: 300, y: 100 });
    page.mouse(figure.canvas, 'mousemove', at.x, at.y, { buttons: 0 });
    assert.equal(page.reads().length, 0, 'the pointer reads nothing of the picture kept');
    assert.equal(figure.inspect().mark, null);
    answerDraws(page);
    assert.equal(figure.inspect().waiting, false);
    assert.notEqual(figure.inspect().pictureId, null);
    figure.dispose();
});

test('while a reset is on its way, the previous picture is mapped onto the whole axes, so a zoom made meanwhile starts from the whole', () => {
    const page = figurePage();
    const figure = drawn(page);
    figure.show(sceneSpec(), { x: [200, 2000], lanes: [{ lane: 'overlay', y: [-40, -20] }] });
    answerDraws(page);
    const views: FigureView[] = [];
    figure.on('view', view => { views.push(view); });
    // The reset (a double click's, or 0) asks for the whole; its picture has not come yet.
    figure.show(sceneSpec(), null);
    const seen = figure.inspect();
    assert.equal(seen.waiting, true);
    assert.equal(seen.mapped, true);
    assert.deepEqual(seen.lanes[0].range, { x: [20, 20000], y: [-60, -10] }, 'the whole ends, not the zoomed picture\'s');
    // A zoom key meanwhile zooms the whole about its middle (as when the reset picture has come).
    figure.zoom('in');
    assert.equal(views.length, 1);
    const settled = drawn(figurePage());
    const settledViews: FigureView[] = [];
    settled.on('view', view => { settledViews.push(view); });
    settled.zoom('in');
    assert.deepEqual(views[0].x, settledViews[0].x, 'the same zoom as on the whole picture drawn');
    settled.dispose();
    figure.dispose();
});

test('answers that only went stale do not redraw: the picture stays and the lines of them are not read', () => {
    const page = figurePage();
    const figure = drawn(page);
    figure.show(sceneSpec({ cmp: 'stale' }), null);
    assert.deepEqual(page.draws(), [], 'no draw for a stale-only change');
    assert.ok(figure.inspect().pictureId);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark, null, 'the stale line is not read');
    assert.equal(figure.inspect().readout, '');
    figure.show(sceneSpec({}, { cmp: 'v2' }), null);
    assert.equal(page.draws().length, 1, 'a new answer redraws');
    figure.dispose();
});

test('"no-picture" redraws, twice at most with no read between, then says the picture failed', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200, y: 80 });
    for (let round = 0; round < 3; round++) {
        page.mouse(figure.canvas, 'mousemove', a.x + round, a.y, { buttons: 0 });
        // Every read out (one may be of the picture before, and is dropped) answered "no-picture".
        for (let reads = page.reads(); reads.length; reads = page.reads()) {
            for (const read of reads) {
                const asked = read.message.payload as FigureReadPayload;
                read.answer({ status: 'no-picture', figureId: asked.figureId, pictureId: asked.pictureId, requestNumber: asked.requestNumber });
            }
            if (page.open.some(item => item.message.command === 'figure-draw')) break;
        }
        const draws = page.draws();
        if (round < 2) {
            assert.equal(draws.length, 1, `round ${round + 1}: drawn again`);
            draws[0].answer(scenePicture(SCENE, draws[0].message.payload as never, `again-${round}`));
        } else {
            assert.equal(draws.length, 0, 'the third "no-picture" in a row is not drawn again');
            assert.equal(figure.inspect().readout, 'failed');
        }
    }
    figure.dispose();
});

test('after a redraw, the point the arrow keys marked is read again by its name and stays marked', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.key('ArrowRight');
    for (const step of page.reads()) step.answer(keysReply(SCENE, step.message.payload as FigureReadPayload));
    figure.resize(670, 430);
    answerDraws(page);
    const [again] = page.reads();
    const asked = again.message.payload as FigureReadPayload;
    assert.deepEqual(asked.name, { lane: 'overlay', line: 'compare', key: 'cmp', x: SCENE.lines.compare.xs[20] }, 'read by the point\'s name (c), with its recording key');
    assert.equal(asked.pointer, undefined);
    again.answer(pointReply(SCENE, asked, 'overlay', 'compare', 20));
    assert.equal(figure.inspect().mark?.index, 20);
    figure.dispose();
});

test('an arrow key is a step read from the selected point\'s name; keys pressed while it is on its way go as one step once it comes', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.key('ArrowRight');
    page.key('ArrowRight');
    const [first] = page.reads();
    const asked = first.message.payload as FigureReadPayload;
    assert.deepEqual(asked.step, { lane: 'overlay', line: 'compare', key: 'cmp', version: 'compare@v1', index: 19, steps: 1 }, 'the selected point\'s name and one point on');
    assert.equal(asked.dataId, figure.inspect().dataId, 'with the data id its point was read from');
    assert.equal(asked.generation, figure.inspect().generation, 'and the generation');
    assert.equal(asked.pointer, undefined);
    page.key('ArrowRight');
    page.key('ArrowRight');
    page.key('ArrowRight');
    assert.deepEqual(page.reads(), [], 'one keys\' read at a time: the keys meanwhile are counted');
    first.answer(keysReply(SCENE, asked));
    assert.equal(figure.inspect().mark?.index, 20);
    const [onward] = page.reads();
    assert.deepEqual((onward.message.payload as FigureReadPayload).step, { lane: 'overlay', line: 'compare', key: 'cmp', version: 'compare@v1', index: 20, steps: 4 }, 'the four keys pressed meanwhile, as one step');
    onward.answer(keysReply(SCENE, onward.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 24, 'the keys pressed while it was on its way are taken');
    figure.dispose();
});

// ── The click waiting for its read (shared test data, pending_click) ─────────────────────────────────────────────

for (const item of TABLE.pending_click) {
    const changed = item.changes_with === 'redraw-rule';
    test(`pending click ${item.id}${changed ? ' (changes with the redraw rule: not done)' : ''}`, () => {
        const page = figurePage();
        const figure = drawn(page);
        const acted: Array<{ line: string; at: number; value: number }> = [];
        const undone: unknown[] = [];
        figure.on('pick', (read: FigurePick) => {
            // The stage's own tap acts only on a trigger's event line (none here).
            if (item.input.stageTap) return undefined;
            const record = { line: read.line, at: read.point.x, value: read.point.value };
            acted.push(record);
            return () => { undone.push(record); };
        });
        const inline = !item.input.fetchedCompare;
        const serve = (): void => {
            for (const asked of page.reads()) {
                const payload = asked.message.payload as FigureReadPayload;
                if (payload.pointer?.lane === 'delta') asked.answer(pointReply(SCENE, payload, 'delta', 'delta', 0));
                else if (payload.pointer && payload.pointer.x < 25) asked.answer({ status: 'outside', figureId: payload.figureId, pictureId: payload.pictureId, requestNumber: payload.requestNumber, lane: 'overlay' });
                else page.open.push(asked);
            }
        };
        const answerAll = (): void => { serve(); for (const asked of page.reads()) asked.answer(pointReply(SCENE, asked.message.payload as FigureReadPayload, 'overlay', 'compare', 19)); };
        for (const step of item.input.steps) {
            const at = step.at ? client('overlay', step.at) : { x: 0, y: 0 };
            switch (step.do) {
                case 'move': page.mouse(figure.canvas, 'mousemove', at.x, at.y, { buttons: 0 }); break;
                case 'down': page.mouse(figure.canvas, 'mousedown', at.x, at.y, { detail: step.detail ?? 1 }); break;
                case 'up': page.mouse(figure.canvas, 'mouseup', at.x, at.y, { detail: step.detail ?? 1 }); break;
                case 'answer': answerAll(); break;
                case 'fail': serve(); for (const asked of page.reads()) asked.fail(); break;
                case 'redraw': figure.resize(670, 430); break;
                case 'remove': figure.dispose(); break;
                case 'press_other': {
                    const other = client('delta', step.at ?? { x: 10, y: 10 });
                    page.mouse(figure.canvas, 'mousemove', other.x, other.y, { buttons: 0 });
                    serve();
                    page.mouse(figure.canvas, 'mousedown', other.x, other.y); page.mouse(figure.canvas, 'mouseup', other.x, other.y);
                    break;
                }
                case 'drag':
                    page.mouse(figure.canvas, 'mousedown', at.x, at.y);
                    page.mouse(page.document, 'mousemove', at.x + 40, at.y + 20, { buttons: 1 });
                    page.mouse(page.document, 'mouseup', at.x + 40, at.y + 20);
                    break;
                case 'lost': page.mouse(page.document, 'mousemove', at.x, at.y, { buttons: 0 }); break;
                default: throw new Error(`no step ${String(step.do)}`);
            }
            if (inline) answerAll(); else serve();
        }
        const expected = changed ? [] : item.expected.acted.map(record => ({ line: record.line, at: record.at, value: record.value }));
        assert.deepEqual(acted, expected, `${item.id}: what the click did`);
        assert.deepEqual(undone, item.expected.undone);
        figure.dispose();
    });
}

// ── R13 through the page's one arbitration: two Figures and an old plot on one page ──────────────────────────────

for (const item of TABLE.r13) {
    test(`R13 ${item.id}: through the page's one arbitration, shared by the Figures and the old plots`, () => {
        const page = figurePage();
        const fired: string[] = [];
        const figures = new Map<string, Figure>();
        for (const name of ['overlay', 'diff']) {
            const host = page.document.createElement('div');
            page.document.body.append(host);
            const figure = page.figure(undefined, { host, size: { width: 170, height: 140 }, laneHeights: { overlay: 100, delta: 0 } });
            const top = name === 'overlay' ? 0 : 200;
            figure.canvas.getBoundingClientRect = () => ({ left: 0, top, width: 170, height: 140, right: 170, bottom: top + 140, x: 0, y: top, toJSON: () => ({}) });
            figure.show(sceneSpec(), null);
            answerDraws(page);
            figure.on('pick', () => { fired.push(`click:${name}`); return () => { fired.push(`undo:${name}`); }; });
            figure.on('view', view => { fired.push(`${view.x?.every(end => end === null) && !view.lanes?.length ? 'reset' : 'zoom'}:${name}`); });
            figures.set(name, figure);
        }
        // A time ruler's surface (plotInteraction.ts), on the same page.
        const lanes = page.document.createElement('div');
        lanes.innerHTML = '<canvas class="track-canvas" id="lane"></canvas>';
        page.document.body.append(lanes);
        const lane = page.document.getElementById('lane') as HTMLElement;
        lane.getBoundingClientRect = () => ({ left: 0, top: 400, width: 100, height: 100, right: 100, bottom: 500, x: 0, y: 400, toJSON: () => ({}) });
        const windows = new Map<HTMLElement, PlotWindow>();
        const point = (clientX: number, clientY: number) => ({ fx: Math.max(0, Math.min(1, clientX / 100)), fy: Math.max(0, Math.min(1, 1 - (clientY - 400) / 100)) });
        attachPlotInteraction(lanes, page.document, '.track-canvas', {
            locate: target => ((target as HTMLElement | null)?.closest?.('.track-canvas') ? { plot: lane, point: { fx: 0.3, fy: 0.6 }, axis: null } : null),
            pointOn: (_plot, x, y) => point(x, y), window: plot => windows.get(plot) ?? FULL_PLOT_WINDOW,
            setWindow: (plot, next) => { fired.push(next ? 'zoom:lane' : 'reset:lane'); if (next) windows.set(plot, next); else windows.delete(plot); },
            hover: () => undefined, clearHover: () => undefined, showBox: () => undefined, hideBox: () => undefined, openAxisRange: () => false, stepFrom: () => null,
            tap: () => () => { fired.push('click:lane'); return () => { fired.push('undo:lane'); }; },
        });
        const where = (on: string, x: number, y: number): { target: EventTarget; clientX: number; clientY: number } => {
            if (on === 'body') return { target: page.document.body, clientX: x, clientY: y };
            if (on === 'lane') return { target: lane, clientX: x, clientY: 400 + y };
            const top = on === 'overlay' ? 0 : 200;
            return { target: figures.get(on)!.canvas, clientX: 56 + x, clientY: top + 10 + y };
        };
        for (const event of item.input.events) {
            const { target, clientX, clientY } = where(event.on, event.x, event.y);
            const init = { detail: event.detail ?? 1 };
            if (event.type === 'down') {
                // The Figure reads at the press (R7): its hover is there first, answered with a point.
                if (event.on === 'overlay' || event.on === 'diff') {
                    page.mouse(target, 'mousemove', clientX, clientY, { buttons: 0 });
                    for (const read of page.reads()) read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
                }
                page.mouse(target, 'mousedown', clientX, clientY, init);
            } else if (event.type === 'move') page.mouse(target, 'mousemove', clientX, clientY, { buttons: 1 });
            else if (event.type === 'lost') page.mouse(target, 'mousemove', clientX, clientY, { buttons: 0 });
            else if (event.type === 'up') page.mouse(target, 'mouseup', clientX, clientY, init);
            else page.mouse(target, 'dblclick', clientX, clientY, init);
            for (const read of page.reads()) read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
        }
        // The old record names its taps (the old receiver's own) and resets the clicked plot twice where two of its
        // surfaces answered one double click (r13-double-click): what was done is the same.
        const done = item.expected.fired.filter(entry => !entry.startsWith('tap:')).map(entry => entry.replace(/@[\d.]+,[\d.]+$/u, ''))
            .filter((entry, index, all) => !(entry.startsWith('reset:') && all[index - 1] === entry));
        assert.deepEqual(fired, done, `${item.id}: what the presses did`);
        for (const figure of figures.values()) figure.dispose();
    });
}

test('the take-back of a click is kept across generations and dropped on dispose', () => {
    const page = figurePage();
    const figure = drawn(page);
    const fired: string[] = [];
    figure.on('pick', () => { fired.push('click'); return () => { fired.push('undo'); }; });
    const a = client('overlay', { x: 200, y: 80 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    for (const read of page.reads()) read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.mouse(figure.canvas, 'mousedown', a.x, a.y);
    page.mouse(figure.canvas, 'mouseup', a.x, a.y);
    figure.resize(670, 430);
    answerDraws(page);
    page.mouse(page.document.body, 'mousedown', 5, 5, { detail: 2 });
    assert.deepEqual(fired, ['click', 'undo'], 'taken back after a redraw');
    page.mouse(page.document.body, 'mouseup', 5, 5, { detail: 2 });
    for (const read of page.reads()) read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    for (const read of page.reads()) read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.mouse(figure.canvas, 'mousedown', a.x, a.y);
    page.mouse(figure.canvas, 'mouseup', a.x, a.y);
    figure.dispose();
    page.mouse(page.document.body, 'mousedown', 5, 5, { detail: 2 });
    assert.deepEqual(fired, ['click', 'undo', 'click'], 'disposed: nothing is taken back');
});

// ── R9: the range fields (shared test data) ─────────────────────────────────────────────────────────────────────

for (const item of TABLE.r9) {
    test(`R9 ${item.id}: the range popover makes today's ends; the service draws them as given`, () => {
        const page = figurePage();
        const figure = page.figure(undefined, SCENE_SIZE);
        let view: FigureView | null = null;
        const show = (next: FigureView | null): void => { view = next; figure.show(sceneSpec(), view); answerDraws(page); };
        figure.on('view', next => show(next));
        show(null);
        if (item.input.window || item.input.diffY) show(zoomView(item.input.window, item.input.diffY));
        const lane = laneOf(item.input.pane);
        const painted = (): { x: number[]; y: number[] } => { const range = figure.inspect().lanes.find(entry => entry.id === lane)!.range!; return { x: range.x, y: range.y }; };
        const id = (suffix: string): HTMLElement => page.document.getElementById(`${figure.figureId}-range-${suffix}`)!;
        const open = (): { min: string; max: string } | null => {
            const frame = FRAMES[lane];
            const at = item.input.axis === 'x' ? { x: FRAMES.delta.left + 300, y: FRAMES.delta.top + FRAMES.delta.height + 6 } : { x: frame.left / 2, y: frame.top + frame.height / 2 };
            page.mouse(figure.canvas, 'dblclick', at.x, at.y, { detail: 2 });
            if (page.document.getElementById(`${figure.figureId}-range-popover`)!.style.display === 'none') return null;
            return { min: (id('min') as HTMLInputElement).value, max: (id('max') as HTMLInputElement).value };
        };
        assert.deepEqual(painted(), item.expected.painted, 'the confirmed range drawn');
        const fields = open();
        assert.deepEqual(fields, item.expected.fields, 'the fields write the confirmed ends');
        if (!item.input.type || !item.expected.applied) { figure.dispose(); return; }
        if (item.input.type.min !== null) (id('min') as HTMLInputElement).value = item.input.type.min;
        if (item.input.type.max !== null) (id('max') as HTMLInputElement).value = item.input.type.max;
        (id('apply') as HTMLButtonElement).click();
        const applied = item.expected.applied;
        assert.equal(page.document.getElementById(`${figure.figureId}-range-popover`)!.style.display === 'none', applied.closed);
        assert.equal(id('error').textContent ?? '', applied.error);
        assert.deepEqual(painted(), applied.painted, 'the same input gives the same confirmed range as today');
        assert.deepEqual(open(), applied.fields_again);
        figure.dispose();
    });
}

// ── Spec 4: the browser build's long computations ───────────────────────────────────────────────────────────────

test('spec 4 (Web): during a long computation the readout says so, no read is sent, a reply to an earlier read is not used and a click does nothing; after it the pointer is read once', () => {
    const page = figurePage({ holds: true });
    const figure = drawn(page);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [before] = page.reads();
    const ended = page.answers.computations.begin();
    assert.equal(figure.inspect().readout, 'computing…');
    before.answer(pointReply(SCENE, before.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark, null, 'the reply to a read sent before is not used');
    page.mouse(figure.canvas, 'mousemove', a.x + 2, a.y, { buttons: 0 });
    page.mouse(figure.canvas, 'mousedown', a.x + 2, a.y);
    page.mouse(figure.canvas, 'mouseup', a.x + 2, a.y);
    assert.deepEqual(page.reads(), [], 'no read during it');
    assert.deepEqual(picks, [], 'no click during it');
    ended();
    const after = page.reads();
    assert.equal(after.length, 1, 'one read at the pointer once it is over');
    after[0].answer(pointReply(SCENE, after[0].message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark?.index, 19);
    assert.equal(figure.inspect().readout, 'compare / 201.6 Hz / −30.2 dBFS');
    figure.dispose();
});

test('spec 4 (Web): after a long computation the pointer is read once even if it never moved, the read shown before it being of no use after (第 6 節)', () => {
    const page = figurePage({ holds: true });
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [first] = page.reads();
    const asked = (first.message.payload as FigureReadPayload).pointer;
    first.answer(pointReply(SCENE, first.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().mark?.index, 19);
    const ended = page.answers.computations.begin();
    assert.deepEqual(page.reads(), [], 'no read during it');
    ended();
    const after = page.reads();
    assert.equal(after.length, 1, 'exactly one read at the pointer once the count is 0, though the pointer did not move');
    assert.deepEqual((after[0].message.payload as FigureReadPayload).pointer, asked, 'at the pointer\'s place');
    after[0].answer(pointReply(SCENE, after[0].message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().readout, 'compare / 201.6 Hz / −30.2 dBFS');
    assert.deepEqual(page.reads(), [], 'and only one');
    figure.dispose();
});

for (const when of ['during it', 'after it'] as const) {
    test(`spec 4 (Web): a read whose reply is dropped by a long computation (arriving ${when}) does not count its place as asked: the place is read again once it is over`, () => {
        const page = figurePage({ holds: true });
        const figure = drawn(page);
        const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
        // A first read shown at another place: what a stuck readout would keep showing.
        page.mouse(figure.canvas, 'mousemove', a.x - 40, a.y, { buttons: 0 });
        const [earlier] = page.reads();
        earlier.answer(pointReply(SCENE, earlier.message.payload as FigureReadPayload, 'overlay', 'compare', 12));
        assert.equal(figure.inspect().mark?.index, 12);
        // The pointer stops at A; its read is on its way when a long computation begins.
        page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
        const [atA] = page.reads();
        const ended = page.answers.computations.begin();
        if (when === 'during it') atA.answer(pointReply(SCENE, atA.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
        ended();
        if (when === 'after it') atA.answer(pointReply(SCENE, atA.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
        assert.notEqual(figure.inspect().mark?.index, 19, 'the dropped reply is not used');
        const again = page.reads();
        assert.equal(again.length, 1, 'A is read again once the computation is over');
        assert.deepEqual((again[0].message.payload as FigureReadPayload).pointer, (atA.message.payload as FigureReadPayload).pointer);
        again[0].answer(pointReply(SCENE, again[0].message.payload as FigureReadPayload, 'overlay', 'compare', 19));
        assert.equal(figure.inspect().mark?.index, 19, 'the readout is of the pointer\'s place, not of the place before');
        figure.dispose();
    });
}

test('spec 4 is the browser build\'s: VS Code keeps reading during a long computation', () => {
    const page = figurePage({ holds: false });
    const figure = drawn(page);
    const ended = page.answers.computations.begin();
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    assert.ok(read);
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    assert.equal(figure.inspect().readout, 'compare / 201.6 Hz / −30.2 dBFS');
    ended();
    figure.dispose();
});

test('the range a typed field gives is one rule: the figure model\'s fieldWindow is figure/fieldWindow\'s', async () => {
    const fieldWindow = await import('../webview/figure/fieldWindow');
    const figureModel = await import('../webview/runtime/figureModel');
    assert.equal(figureModel.fieldWindow, fieldWindow.fieldWindow);
});

test('Alt+drag tells the stretch across it covers (range), in the axis\'s values; a plain drag a box zoom (view) made by today\'s rule', () => {
    const page = figurePage();
    const figure = drawn(page);
    const ranges: Array<{ lane: string; x: [number, number] }> = [];
    const views: FigureView[] = [];
    figure.on('range', range => { ranges.push(range); });
    figure.on('view', view => { views.push(view); });
    const from = client('overlay', { x: 120, y: 50 }), to = client('overlay', { x: 420, y: 150 });
    page.mouse(figure.canvas, 'mousedown', from.x, from.y, { altKey: true });
    page.mouse(page.document, 'mousemove', to.x, to.y, { buttons: 1, altKey: true });
    page.mouse(page.document, 'mouseup', to.x, to.y, { altKey: true });
    assert.equal(ranges.length, 1);
    near(ranges[0].x[0] / (20 * 1000 ** (120 / 600)), 1, 'the stretch\'s low end', 1e-9);
    near(ranges[0].x[1] / (20 * 1000 ** (420 / 600)), 1, 'the stretch\'s high end', 1e-9);
    assert.equal(views.length, 0, 'an Alt+drag is no zoom');
    page.mouse(figure.canvas, 'mousedown', from.x, from.y);
    page.mouse(page.document, 'mousemove', to.x, to.y, { buttons: 1 });
    page.mouse(page.document, 'mouseup', to.x, to.y);
    assert.equal(views.length, 1);
    const whole = axisScale(20, 20000, true);
    assert.deepEqual(views[0].x, specifiedEnds(whole, { start: 120 / 600, end: 420 / 600 }), 'the box\'s ends across, at the range field\'s decimals');
    assert.deepEqual(views[0].lanes, [{ lane: 'overlay', y: specifiedEnds(axisScale(-60, -10, false), { start: 0.25, end: 0.75 }) }]);
    figure.dispose();
});

// ── The selected point ────────────────────────────────────────────────────────────

/** Answers every step and name read out by the service's rule, until none is left. */
function serveKeys(page: FigurePage, xRange: readonly [number, number] = [20, 20000]): void {
    for (let reads = page.reads(); reads.length; reads = page.reads()) {
        for (const read of reads) {
            const payload = read.message.payload as FigureReadPayload;
            if (payload.step || payload.name) read.answer(keysReply(SCENE, payload, xRange));
            else page.open.push(read);
        }
        if (!page.open.some(item => (item.message.payload as FigureReadPayload).step || (item.message.payload as FigureReadPayload).name)) break;
    }
}
/** A Figure with the compare line's point 19 read at the pointer and one arrow key pressed (the point 20 selected). */
function keyed(page: FigurePage): Figure {
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    page.key('ArrowRight');
    serveKeys(page);
    assert.equal(figure.inspect().mark?.index, 20);
    return figure;
}

test('a Figure that takes the focus at a press leaves ← → to the screen while its canvas has the focus; without the focus they step its readout (R7)', () => {
    const page = figurePage();
    const figure = drawn(page, null, { pressFocuses: true });
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    // The pointer on it, the focus elsewhere: the keys step its readout, as on every Figure.
    page.key('ArrowRight');
    serveKeys(page);
    assert.equal(figure.inspect().mark?.index, 20);
    // The focus on its canvas (a press put it there): ← → are the screen's (a Tracks row's time cursor), not a step.
    figure.canvas.focus();
    page.key('ArrowRight');
    assert.deepEqual(page.reads(), [], 'a focused row asks for no step: the key is left to the screen (docs/display-rules.md R7, the keyboard-focus exception; figure.ts keydown)');
    assert.equal(figure.inspect().mark?.index, 20);
    figure.dispose();
});

test('class 1 (A): a point the arrow keys selected is not shown once its answer goes stale, no key steps from it, and it is read again by its name once the new answer is drawn', () => {
    const page = figurePage();
    const figure = keyed(page);
    figure.show(sceneSpec({ cmp: 'stale' }), null);
    assert.equal(figure.inspect().mark, null, 'no mark on a stale answer');
    assert.equal(figure.inspect().readout, '', 'no readout of a stale answer');
    page.key('ArrowRight');
    assert.deepEqual(page.reads(), [], 'no step from a point of a stale answer');
    assert.equal(figure.inspect().mark, null);
    figure.show(sceneSpec({}, { cmp: 'v2' }), null);
    answerDraws(page);
    const [again] = page.reads();
    assert.deepEqual((again.message.payload as FigureReadPayload).name, { lane: 'overlay', line: 'compare', key: 'cmp', x: SCENE.lines.compare.xs[20] }, 'read again by its name on the new answer');
    again.answer(keysReply(SCENE, again.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 20);
    figure.dispose();
});

test('class 1 (B): after a redraw that puts another recording on the line, nothing of the point before is shown, its name read carries its recording key, and the other recording\'s point is not taken for it', () => {
    const page = figurePage();
    const figure = keyed(page);
    figure.resize(670, 430);
    const swapped = { compare: 'cmp-b', other: 'oth' };
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, `swapped-${++pictures}`, undefined, swapped));
    assert.equal(figure.inspect().mark, null, 'no mark of the recording before on the new picture');
    assert.equal(figure.inspect().readout, '', 'no readout of it either');
    const [again] = page.reads();
    const asked = again.message.payload as FigureReadPayload;
    assert.equal(asked.name?.key, 'cmp', 'the name read carries the recording key the point was read of');
    again.answer(keysReply(SCENE, asked, [20, 20000], swapped));
    assert.equal(figure.inspect().mark, null, 'the line is of another recording now: no point of that name');
    const after = page.reads();
    assert.equal(after.length, 1, 'the pointer\'s place is read instead');
    assert.ok((after[0].message.payload as FigureReadPayload).pointer);
    figure.dispose();
});

test('class 1 (B): a key pressed while the name read after a redraw is on its way is taken after it: the late reply never moves the point back', () => {
    const page = figurePage();
    const figure = keyed(page);
    figure.resize(670, 430);
    answerDraws(page);
    const [again] = page.reads();
    page.key('ArrowRight');
    assert.deepEqual(page.reads(), [], 'the key waits for the name read');
    again.answer(keysReply(SCENE, again.message.payload as FigureReadPayload));
    const [onward] = page.reads();
    assert.equal((onward.message.payload as FigureReadPayload).step?.index, 20, 'the key steps from the point read again');
    onward.answer(keysReply(SCENE, onward.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 21, 'the key pressed during the name read is kept');
    figure.dispose();
});

test('class 1 (H): a step answered "no-picture" draws again and reads the point again by its name; a successful name read starts the count of "no-picture" again', () => {
    const page = figurePage();
    const figure = keyed(page);
    page.key('ArrowRight');
    const [stepRead] = page.reads();
    assert.ok(stepRead && (stepRead.message.payload as FigureReadPayload).step, 'a step read');
    const noPicture = (read: (typeof page.open)[number]): void => {
        const asked = read.message.payload as FigureReadPayload;
        read.answer({ status: 'no-picture', figureId: asked.figureId, pictureId: asked.pictureId, requestNumber: asked.requestNumber });
    };
    noPicture(stepRead);
    const [draw] = page.draws();
    assert.ok(draw, 'drawn again after the step\'s "no-picture"');
    draw.answer(scenePicture(SCENE, draw.message.payload as never, `again-${++pictures}`));
    const [named] = page.reads();
    assert.ok((named.message.payload as FigureReadPayload).name, 'the point read again by its name');
    named.answer(keysReply(SCENE, named.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 20);
    // Two "no-picture" in a row after that successful read still draw again: the count started again.
    for (let round = 0; round < 2; round++) {
        page.key('ArrowRight');
        const [read] = page.reads();
        noPicture(read);
        const [redraw] = page.draws();
        assert.ok(redraw, `round ${round + 1}: drawn again, not failed`);
        redraw.answer(scenePicture(SCENE, redraw.message.payload as never, `again-${++pictures}`));
        if (round === 0) { const [name] = page.reads(); name.answer(keysReply(SCENE, name.message.payload as FigureReadPayload)); }
    }
    assert.notEqual(figure.inspect().readout, 'failed');
    figure.dispose();
});

test('class 1 (I, Web): a step dropped by a long computation does not stop the keys: it is sent again once the computation is over, and later keys step on', () => {
    const page = figurePage({ holds: true });
    const figure = keyed(page);
    page.key('ArrowRight');
    const [dropped] = page.reads();
    const ended = page.answers.computations.begin();
    dropped.answer(keysReply(SCENE, dropped.message.payload as FigureReadPayload));
    ended();
    const [resent] = page.reads();
    assert.equal((resent?.message.payload as FigureReadPayload | undefined)?.step?.index, 20, 'the dropped step is sent again from the selected point');
    resent.answer(keysReply(SCENE, resent.message.payload as FigureReadPayload));
    assert.equal(figure.inspect().mark?.index, 21);
    page.key('ArrowRight');
    serveKeys(page);
    assert.equal(figure.inspect().mark?.index, 22, 'a later key steps on');
    figure.dispose();
});

// ── Range edges ────────────────────────────────────────────────────────────────────

test('class 3 (G): when the answers change under a zoom, the whole axes a typed range and a zoom are parts of are the new picture\'s, never the ones kept from before', () => {
    const narrower = { x: [20, 8000], overlay: [-70, -20], delta: [-16, 16] };
    const zoomed: FigureView = { x: [200, 2000], lanes: [] };
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), null);
    answerDraws(page);
    figure.show(sceneSpec(), zoomed);
    answerDraws(page);
    // Another recording's answer (its Nyquist lower), the zoom kept: the picture's whole axes are its own.
    figure.show(sceneSpec({}, { cmp: 'v2' }), zoomed);
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, `narrower-${++pictures}`, narrower));
    assert.deepEqual(figure.inspect().whole, narrower.x, 'the whole axis across is the new picture\'s');
    assert.deepEqual(figure.inspect().lanes[0].wholeY, narrower.overlay, 'and the whole value axis');
    const views: FigureView[] = [];
    figure.on('view', view => { views.push(view); });
    figure.zoom('in');
    // The same zoom on a Figure that only ever drew the new answers.
    const fresh = figurePage();
    const other = fresh.figure(undefined, SCENE_SIZE);
    other.show(sceneSpec({}, { cmp: 'v2' }), zoomed);
    for (const draw of fresh.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, 'fresh', narrower));
    const freshViews: FigureView[] = [];
    other.on('view', view => { freshViews.push(view); });
    other.zoom('in');
    assert.deepEqual(views[0].x, freshViews[0].x, 'the zoom is a part of the new whole axis');
    other.dispose();
    figure.dispose();
});

test('a Δ the service could not take says why in its headline: another unit or reference, another axis; nothing while its base may still come', () => {
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), null);
    const without = (reason: string | null): void => {
        for (const draw of page.draws()) {
            const picture = scenePicture(SCENE, draw.message.payload as never, `no-delta-${reason}`);
            if (picture.status !== 'picture') throw new Error('a picture');
            picture.lanes = (picture.lanes ?? []).map(lane => (lane.id === 'delta' ? { ...lane, lines: [] } : lane));
            picture.members!.lines = picture.members!.lines.map(line => (line.line === 'delta' ? { ...line, drawn: false, used: ['cmp'], excluded: reason ? [{ key: 'b1', reason: reason as never }] : [] } : line));
            draw.answer(picture);
        }
    };
    without('other-reference');
    assert.equal(figure.inspect().headline, '— (no Δ: other units)');
    figure.show(sceneSpec({ b3: 'stale' }), null);
    figure.show(sceneSpec(), null);
    without('other-axis');
    assert.equal(figure.inspect().headline, '— (no Δ)', 'lines of another axis (a sample-by-sample Δ of sounds says the rates)');
    figure.show(sceneSpec({ b3: 'stale' }), null);
    figure.show(sceneSpec(), null);
    without('pending');
    assert.equal(figure.inspect().headline, '', 'its base on its way: it may still come');
    figure.dispose();
});

// ── Later findings: S, P, Q ────────────────────────────────────────────────────────────

test('S: the Δ headline is not shown once the answer of its line goes stale (either side), as the readout and the mark are not', () => {
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), null);
    for (const draw of page.draws()) draw.answer({ ...scenePicture(SCENE, draw.message.payload as never, 'headed'), headlines: [{ lane: 'delta', line: 'delta', index: 23, x: SCENE.lines.delta.xs[23], value: 16 }] });
    assert.match(figure.inspect().headline, /^Largest Δ \+16\.0 dB at /u, 'the headline of the answers drawn');
    // The compared recording's answer went stale (no new one yet): the picture stays, its headline does not.
    figure.show(sceneSpec({ cmp: 'stale' }), null);
    assert.equal(figure.inspect().headline, '');
    // A base recording's answer stale: the Δ is of it too.
    figure.show(sceneSpec({ b2: 'stale' }), null);
    assert.equal(figure.inspect().headline, '');
    // Fresh again (drawn again if the change asks for it): shown again.
    figure.show(sceneSpec(), null);
    for (let draws = page.draws(); draws.length; draws = page.draws()) for (const draw of draws) draw.answer({ ...scenePicture(SCENE, draw.message.payload as never, `headed-${++pictures}`), headlines: [{ lane: 'delta', line: 'delta', index: 23, x: SCENE.lines.delta.xs[23], value: 16 }] });
    assert.match(figure.inspect().headline, /^Largest Δ/u, 'fresh again: shown again');
    figure.dispose();
});

test('P: an arrow key typed into a text field (the range popover\'s, any input) steps no point', () => {
    const page = figurePage();
    const figure = drawn(page);
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    const field = page.document.createElement('input');
    page.document.body.append(field);
    field.focus();
    field.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.deepEqual(page.reads(), [], 'no step read');
    assert.equal(figure.inspect().mark?.index, 19, 'the point stays');
    figure.dispose();
});

test('Q: a Figure disposed leaves no document mousedown listener and no key context of its range popover', () => {
    const page = figurePage();
    const doc = page.document;
    const listening = new Set<unknown>();
    const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
    doc.addEventListener = ((type: string, listener: unknown, options?: unknown) => { if (type === 'mousedown') listening.add(listener); add(type, listener as EventListener, options as AddEventListenerOptions); }) as typeof doc.addEventListener;
    doc.removeEventListener = ((type: string, listener: unknown, options?: unknown) => { if (type === 'mousedown') listening.delete(listener); remove(type, listener as EventListener, options as EventListenerOptions); }) as typeof doc.removeEventListener;
    const router = keyRouterFor(page.window);
    const before = router.layers().length;
    for (let round = 0; round < 3; round++) {
        const figure = drawn(page);
        assert.ok(listening.size > 0 && router.layers().length > before, 'listening while it is there');
        figure.dispose();
    }
    assert.equal(listening.size, 0, 'no mousedown listener left on the document');
    assert.equal(router.layers().length, before, 'no key context left');
});

// ── A later finding: X1 ─────────────────────────────────────────────────────────────────

test('X1: a range field open while a new picture comes shows its ends and applies a value typed on its axis, never on the axis it was opened on', () => {
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    const views: FigureView[] = [];
    figure.on('view', next => { views.push(next); });
    figure.show(sceneSpec(), null);
    answerDraws(page);
    const id = (suffix: string): HTMLInputElement => page.document.getElementById(`${figure.figureId}-range-${suffix}`) as HTMLInputElement;
    // The level axis's field, opened on the whole −60…−10 dB.
    page.mouse(figure.canvas, 'dblclick', FRAMES.overlay.left / 2, FRAMES.overlay.top + FRAMES.overlay.height / 2, { detail: 2 });
    assert.deepEqual([id('min').value, id('max').value], ['-60', '-10']);
    // The base group's scan answers while it is open: the automatic axis is now −100…−20 dB.
    const moved = { x: [20, 20000], overlay: [-100, -20], delta: [-32, 32] };
    figure.show(sceneSpec({}, { b1: 'v2' }), null);
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, `moved-${++pictures}`, moved));
    assert.deepEqual([id('min').value, id('max').value], ['-100', '-20'], 'the open field shows the new picture\'s ends');
    id('min').value = '-90';
    id('max').value = '-55';
    (page.document.getElementById(`${figure.figureId}-range-apply`) as HTMLButtonElement).click();
    assert.deepEqual(views.at(-1)?.lanes, [{ lane: 'overlay', y: [-90, -55] }], 'the typed ends, on the axis drawn now');
    // Typed first, then a new picture (what was typed is kept): applied on the axis drawn when it is applied.
    figure.show(sceneSpec({}, { b1: 'v3' }), null);
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, `whole-${++pictures}`));
    page.mouse(figure.canvas, 'dblclick', FRAMES.overlay.left / 2, FRAMES.overlay.top + FRAMES.overlay.height / 2, { detail: 2 });
    id('min').value = '-90';
    id('max').value = '-55';
    figure.show(sceneSpec({}, { b1: 'v4' }), null);
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, `moved-${++pictures}`, moved));
    assert.deepEqual([id('min').value, id('max').value], ['-90', '-55'], 'what was typed is kept');
    (page.document.getElementById(`${figure.figureId}-range-apply`) as HTMLButtonElement).click();
    assert.deepEqual(views.at(-1)?.lanes, [{ lane: 'overlay', y: [-90, -55] }], 'applied on the axis drawn now');
    figure.dispose();
});

test('the place across the pointer reads is told while it reads it; a place followed from outside is a line down the lanes and no read', () => {
    const page = figurePage();
    const figure = drawn(page);
    const told: Array<number | null> = [];
    figure.on('across', x => told.push(x));
    const a = client('overlay', { x: 200.6865052212012, y: 80.696 });
    page.mouse(figure.canvas, 'mousemove', a.x, a.y, { buttons: 0 });
    const [read] = page.reads();
    read.answer(pointReply(SCENE, read.message.payload as FigureReadPayload, 'overlay', 'compare', 19));
    const mark = figure.inspect().mark;
    assert.ok(mark);
    assert.deepEqual(told, [mark.x], 'told once, with the point\'s own place (never the pointer\'s)');
    page.mouse(figure.canvas, 'mouseleave', a.x, a.y, { buttons: 0 });
    assert.deepEqual(told, [mark.x, null], 'the pointer left: nothing is followed, though the point stays drawn');
    figure.dispose();

    const other = drawn(figurePage());
    other.follow(2000);
    const followed = other.inspect().followed;
    assert.ok(followed);
    assert.equal(followed.x, 2000);
    near(followed.px, FRAMES.overlay.left + FRAMES.overlay.width * 2 / 3, 'two thirds along a log axis of 20 Hz to 20 kHz');
    assert.equal(other.inspect().mark, null, 'a followed place reads no point');
    assert.equal(other.inspect().readout, '', 'and the readout says nothing of it');
    other.follow(5);
    assert.equal(other.inspect().followed, null, 'out of the range shown: no line');
    other.follow(null);
    assert.equal(other.inspect().followed, null);
    other.dispose();
});

test('a value-axis tick is named beside it, but its name is never cut by the canvas nor written into the lane next to it', () => {
    // The Tracks rows: a waveform lane from the canvas's top, a spectrogram lane 6 px under it, to the canvas's bottom.
    const wave = { top: 0, height: 60 }, image = { top: 66, height: 94 };
    // The waveform's top tick (at px 0) is named 5 px down, wholly in the canvas; its bottom tick (px 60) 2 px up,
    // above the middle of the gap, where the spectrogram's top tick (px 66) is named 2 px down, below it.
    assert.equal(tickNameAt(0, wave, undefined, image, 160), 5);
    assert.equal(tickNameAt(60, wave, undefined, image, 160), 58);
    assert.equal(tickNameAt(66, image, wave, undefined, 160), 68);
    assert.equal(tickNameAt(160, image, wave, undefined, 160), 155);
    // A tick away from the ends is named beside it.
    assert.equal(tickNameAt(30, wave, undefined, image, 160), 30);
    // With room around the lane (the comparison's Figure: 10 px above, 22 px between, 30 px below) every name is beside its tick.
    const upper = { top: 10, height: 200 }, lower = { top: 232, height: 100 };
    for (const px of [10, 110, 210]) assert.equal(tickNameAt(px, upper, undefined, lower, 362), px);
    for (const px of [232, 332]) assert.equal(tickNameAt(px, lower, upper, undefined, 362), px);
});
