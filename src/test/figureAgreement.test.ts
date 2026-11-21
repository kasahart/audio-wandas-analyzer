/**
 * The drawn figure and the point read name the same thing (docs/figure-design.md 第 6 節
 * 「読み値とクリック」): under replies delayed and reordered, on the log axis across, in an extremely
 * narrow range up, from A to B on one picture, with the arrow keys past the 256 points a read carries, a click and
 * Enter after the arrow keys, a slow hover reply during the keys, a long computation that fails (spec 4), a cancelled
 * draw that finishes later, and the size, the specified range or an answer's version changed while a click waits.
 *
 * Every case checks the four at once: the readout, the mark and the click's target agree on the line id, the point
 * index, the recording key and the value; the mark is within 1 px of the point's place on the confirmed range; the
 * ticks are placed from that same confirmed range; and no reply of an older picture or read is used.
 * The figure service is the tests' stand-in (helpers/figureStandIn.ts): which point a read reads is the case's input.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { FigureReadPayload, FigureReadResult, FigureView } from '../shared/protocol/generated/backendProtocolSchema';
import type { Figure, FigurePick } from '../webview/figure/figure';
import { alongAxisTicks, valueAxisTicks } from '../webview/figure/ticks';
import { frequencyText, levelText } from '../webview/shell/numberText';
import { figurePage, keysReply, LABELS, pointReply, SCENE_SIZE, scenePicture, sceneSpec, type FigurePage } from './helpers/figureStandIn';
import type { Scene } from './helpers/figureOverlayRun';

const FIXTURE = path.join(path.resolve(__dirname, '..', '..'), 'python-backend', 'tests', 'fixtures', 'figure_overlay_cases.json');
const SCENE = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { scenes: Record<string, Scene> }).scenes.spectrum;
const FRAME = { left: 56, top: 10, width: 600, height: 200 };
/** The recording each line of one key is of (the service puts it on every point of such a line). */
const KEYS: Record<string, string> = { compare: 'cmp', other: 'oth' };

/** A scene whose compare line has `count` log-spaced points (past the 256 a read carries either side). */
function longScene(count: number): Scene {
    const xs = Array.from({ length: count }, (_, at) => 20 * 1000 ** (at / (count - 1)));
    const values = xs.map((_, at) => -40 + 10 * Math.sin(at / 7));
    return { ...SCENE, lines: { ...SCENE.lines, compare: { ...SCENE.lines.compare, xs, values } } };
}

/** The stand-in's reply for `index` of `line`, its point carrying its recording's key as the service's do. */
function reply(scene: Scene, asked: FigureReadPayload, line: string, index: number, _xRange: readonly [number, number] = [20, 20000]): FigureReadResult {
    return pointReply(scene, asked, line === 'delta' ? 'delta' : 'overlay', line, index);
}

function drawn(page: FigurePage, scene: Scene = SCENE, view: FigureView | null = null): Figure {
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), view);
    answer(page, scene);
    return figure;
}
let pictures = 0;
function answer(page: FigurePage, scene: Scene = SCENE): void {
    for (const draw of page.draws()) draw.answer(scenePicture(scene, draw.message.payload as never, `agree-${++pictures}`));
}
const at = (x: number, y: number): { x: number; y: number } => ({ x: FRAME.left + x, y: FRAME.top + y });
const move = (page: FigurePage, figure: Figure, place: { x: number; y: number }): void => page.mouse(figure.canvas, 'mousemove', place.x, place.y, { buttons: 0 });
const click = (page: FigurePage, figure: Figure, place: { x: number; y: number }): void => {
    page.mouse(figure.canvas, 'mousedown', place.x, place.y);
    page.mouse(figure.canvas, 'mouseup', place.x, place.y);
};

/**
 * The readout, the mark and (when given) the click agree on `expected` (line, index, key, value) of `scene`, the mark
 * is within 1 px of its place on the confirmed range drawn, and the ticks drawn are that range's.
 */
function agree(figure: Figure, scene: Scene, expected: { line: string; index: number }, pick?: FigurePick): void {
    const seen = figure.inspect();
    const line = scene.lines[expected.line as keyof Scene['lines']];
    const value = Number(line.values[expected.index]);
    const x = line.xs[expected.index];
    const key = KEYS[expected.line];
    assert.ok(seen.mark, 'a mark');
    assert.deepEqual({ line: seen.mark.line, index: seen.mark.index, x: seen.mark.x, value: seen.mark.value }, { line: expected.line, index: expected.index, x, value }, 'the mark');
    const lane = seen.lanes.find(item => item.id === seen.mark!.lane)!;
    const range = lane.range!;
    const px = FRAME.left + Math.log(x / range.x[0]) / Math.log(range.x[1] / range.x[0]) * FRAME.width;
    const py = Math.max(FRAME.top, Math.min(FRAME.top + FRAME.height, FRAME.top + (1 - (value - range.y[0]) / (range.y[1] - range.y[0])) * FRAME.height));
    assert.ok(Math.abs(seen.mark.px - px) < 1 && Math.abs(seen.mark.py - py) < 1, `the mark at (${seen.mark.px}, ${seen.mark.py}), the point at (${px}, ${py})`);
    // The readout writes the same point: its line's name, its place and its value (R7).
    const step = Math.min(...[expected.index - 1, expected.index].filter(i => i >= 0 && i < line.xs.length - 1).map(i => Math.abs(line.xs[i + 1] - line.xs[i])));
    assert.equal(seen.readout, `${LABELS[expected.line]} / ${frequencyText(x, step)} / ${levelText(value, 'dBFS')}`, 'the readout');
    // The ticks come of the confirmed range the mark is placed on.
    assert.deepEqual(lane.xTicks.map(tick => tick.value), alongAxisTicks(range.x[0], range.x[1], true).map(tick => tick.value), 'ticks across');
    assert.deepEqual(lane.yTicks.map(tick => tick.value), valueAxisTicks({ min: range.y[0], max: range.y[1] }, lane.frame.height).map(tick => tick.value), 'ticks up');
    for (const tick of lane.xTicks) assert.ok(Math.abs(tick.px - (FRAME.left + Math.log(tick.value / range.x[0]) / Math.log(range.x[1] / range.x[0]) * FRAME.width)) < 1, 'a tick across at its place');
    if (!pick) return;
    assert.deepEqual({ line: pick.line, index: pick.point.index, key: pick.point.key, value: pick.point.value, x: pick.point.x }, { line: expected.line, index: expected.index, key, value, x }, 'the click acted on the point read');
}

test('A to B on one picture with the replies reordered: the newest read is shown and clicked, the older one arriving last is not used', () => {
    const page = figurePage();
    const figure = drawn(page);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const a = at(150, 80), b = at(300, 60);
    move(page, figure, a);
    const [first] = page.reads();
    move(page, figure, b);
    // B's read waits behind A's (one runs, the latest waits); a press at B claims it for the click, so it goes at once.
    page.mouse(figure.canvas, 'mousedown', b.x, b.y);
    page.mouse(figure.canvas, 'mouseup', b.x, b.y);
    const [second] = page.reads();
    assert.ok(second, 'the click\'s read is out beside the hover\'s');
    assert.deepEqual(picks, [], 'the click waits for the read at its own place');
    // Reordered: B's reply comes first, A's (older) after it.
    second.answer(reply(SCENE, second.message.payload as FigureReadPayload, 'compare', 30));
    assert.equal(picks.length, 1, 'done once its read came');
    first.answer(reply(SCENE, first.message.payload as FigureReadPayload, 'compare', 15));
    agree(figure, SCENE, { line: 'compare', index: 30 }, picks[0]);
    figure.dispose();
});

test('in an extremely narrow range up (0.01 dB) the mark stays on the point read, its ticks are of that range', () => {
    const page = figurePage();
    const index = 25;
    const value = Number(SCENE.lines.compare.values[index]);
    const view: FigureView = { x: [200, 400], lanes: [{ lane: 'overlay', y: [value - 0.005, value + 0.005] }] };
    const figure = drawn(page, SCENE, view);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const place = at(300, 100);
    move(page, figure, place);
    for (const read of page.reads()) read.answer(reply(SCENE, read.message.payload as FigureReadPayload, 'compare', index, [200, 400]));
    click(page, figure, place);
    agree(figure, SCENE, { line: 'compare', index }, picks[0]);
    figure.dispose();
});

test('more than 256 arrow presses: every key is a step read the service answers (no list of points is held), keys pressed meanwhile are sent as one step, and the click and Enter act on the point the keys marked', () => {
    const scene = longScene(1200);
    const page = figurePage();
    const figure = drawn(page, scene);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const place = at(100, 100);
    move(page, figure, place);
    for (const read of page.reads()) read.answer(reply(scene, read.message.payload as FigureReadPayload, 'compare', 100));
    const sent = new Set<string>();
    for (let key = 0; key < 300; key++) {
        page.key('ArrowRight');
        for (const read of page.reads()) {
            const asked = read.message.payload as FigureReadPayload;
            sent.add(read.message.requestId);
            assert.ok(asked.step, 'every key is a step read by the selected point\'s name and a count of points');
            assert.equal(asked.pointer, undefined);
            assert.deepEqual({ lane: asked.step.lane, line: asked.step.line, key: asked.step.key }, { lane: 'overlay', line: 'compare', key: 'cmp' });
            // A slow hover reply asked before the keys must not move the point either: none is out here (keys only).
            // The step read is answered after a few more keys were pressed, as when its reply is slow.
            if (key % 5 === 4 || key === 299) read.answer(keysReply(scene, asked));
            else page.open.push(read);
        }
    }
    for (let reads = page.reads(); reads.length; reads = page.reads()) for (const read of reads) read.answer(keysReply(scene, read.message.payload as FigureReadPayload));
    assert.ok(sent.size >= 1 && sent.size < 300, `keys pressed while a step was on its way went as one step (${sent.size} step reads for 300 keys)`);
    agree(figure, scene, { line: 'compare', index: 400 });
    page.key('Enter');
    agree(figure, scene, { line: 'compare', index: 400 }, picks.at(-1));
    // A click after the keys acts on the point they marked, not on a read at the press.
    click(page, figure, place);
    assert.deepEqual(page.reads(), [], 'the click reads nothing: the point is marked');
    assert.equal(picks.length, 2);
    agree(figure, scene, { line: 'compare', index: 400 }, picks[1]);
    figure.dispose();
});

test('a slow hover reply arriving while the arrow keys move does not move the point, the readout or the click', () => {
    const page = figurePage();
    const figure = drawn(page);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const place = at(200, 80);
    move(page, figure, place);
    for (const read of page.reads()) read.answer(reply(SCENE, read.message.payload as FigureReadPayload, 'compare', 19));
    move(page, figure, at(205, 80));
    const [slow] = page.reads();
    page.key('ArrowRight');
    page.key('ArrowRight');
    slow.answer(reply(SCENE, slow.message.payload as FigureReadPayload, 'other', 12));
    // The keys' step reads (the second key waited for the first) answered by the service's rule.
    for (let reads = page.reads(); reads.length; reads = page.reads()) for (const read of reads) read.answer(keysReply(SCENE, read.message.payload as FigureReadPayload));
    page.key('Enter');
    agree(figure, SCENE, { line: 'compare', index: 21 }, picks[0]);
    figure.dispose();
});

test('a draw running when the range moves again is not stopped: its picture is shown meanwhile on the newest range and is never read; no read of an older picture is used on the newest', () => {
    const page = figurePage({ cancels: true });
    const figure = drawn(page);
    const place = at(200, 80);
    move(page, figure, place);
    const [old] = page.reads();
    figure.show(sceneSpec(), { x: [100, 1000] });
    const [running] = page.draws();
    figure.show(sceneSpec(), { x: [150, 1500] });
    assert.ok(!page.posted.some(message => message.type === 'figure-cancel'), 'a range moved on stops no draw: the one running is shown meanwhile');
    // It finishes while the newest is waited for: drawn on the newest range, the Figure still waiting, nothing read.
    const before = JSON.stringify(figure.inspect().lanes[0].lines.map(line => line.points));
    // The stand-in draws the same points for any range: one value is moved so the picture on the way is told apart.
    const onTheWay = scenePicture(SCENE, running.message.payload as never, 'on-the-way');
    const first = onTheWay.lanes![0].lines[0];
    first.values = (first.values as unknown as Array<number | null>).map((value, index) => (index === 0 && value !== null ? value + 1 : value)) as unknown as typeof first.values;
    running.answer(onTheWay);
    const meanwhile = figure.inspect();
    assert.deepEqual([meanwhile.waiting, meanwhile.mapped, meanwhile.pictureId, meanwhile.readout], [true, true, null, '']);
    assert.deepEqual(meanwhile.lanes[0].range?.x, [150, 1500]);
    assert.notEqual(JSON.stringify(meanwhile.lanes[0].lines.map(line => line.points)), before, 'the picture asked on the way took the last one\'s place');
    assert.equal(page.reads().length, 0, 'nothing is read of a picture shown meanwhile');
    const [newest] = page.draws();
    newest.answer(scenePicture(SCENE, newest.message.payload as never, 'newest'));
    assert.equal(figure.inspect().pictureId, 'newest');
    // The read of the first picture, answered now, is not used on the newest.
    old.answer(reply(SCENE, old.message.payload as FigureReadPayload, 'compare', 19));
    const fresh = page.reads();
    assert.equal(fresh.length, 1, 'the pointer is read again on the new picture');
    assert.equal((fresh[0].message.payload as FigureReadPayload).pictureId, 'newest');
    fresh[0].answer(reply(SCENE, fresh[0].message.payload as FigureReadPayload, 'compare', 30, [150, 1500]));
    agree(figure, SCENE, { line: 'compare', index: 30 });
    figure.dispose();
});

test('a draw running when the spec changes is stopped, and its picture is never drawn', () => {
    const page = figurePage({ cancels: true });
    const figure = drawn(page);
    figure.show(sceneSpec(), { x: [100, 1000] });
    const [running] = page.draws();
    const other = sceneSpec();
    figure.show({ ...other, keys: other.keys.map(key => ({ ...key, version: `${key.version}-next` })) }, { x: [100, 1000] });
    assert.ok(page.posted.some(message => message.type === 'figure-cancel' && message.requestIds.includes(running.message.requestId)), 'the stale running draw is cancelled');
    const before = JSON.stringify(figure.inspect().lanes.map(lane => lane.lines.map(line => line.points)));
    running.answer(scenePicture(SCENE, running.message.payload as never, 'cancelled-late'));
    assert.equal(JSON.stringify(figure.inspect().lanes.map(lane => lane.lines.map(line => line.points))), before, 'a picture of the spec before is not drawn');
    figure.dispose();
});

for (const change of ['size', 'range', 'version'] as const) {
    test(`a click waiting for its read is not done once the ${change} changed meanwhile; the next picture's read and click agree`, () => {
        const page = figurePage();
        const figure = drawn(page);
        const picks: FigurePick[] = [];
        figure.on('pick', read => { picks.push(read); });
        const place = at(300, 60);
        move(page, figure, place);
        page.mouse(figure.canvas, 'mousedown', place.x, place.y);
        page.mouse(figure.canvas, 'mouseup', place.x, place.y);
        const waiting = page.reads();
        if (change === 'size') figure.resize(670, 430);
        else if (change === 'range') figure.show(sceneSpec(), { x: [100, 10000] });
        else figure.show(sceneSpec({}, { cmp: 'v2' }), null);
        for (const read of waiting) read.answer(reply(SCENE, read.message.payload as FigureReadPayload, 'compare', 30));
        assert.deepEqual(picks, [], 'the click waiting is not done on the new picture');
        assert.equal(figure.inspect().mark, null, 'no mark while the new picture is on its way');
        answer(page);
        const range: [number, number] = change === 'range' ? [100, 10000] : [20, 20000];
        for (const read of page.reads()) read.answer(reply(SCENE, read.message.payload as FigureReadPayload, 'compare', 30, range));
        click(page, figure, place);
        agree(figure, SCENE, { line: 'compare', index: 30 }, picks[0]);
        figure.dispose();
    });
}

test('spec 4 (Web): a long computation that fails ends it all the same, and the pointer is read and clicked again after it', () => {
    const page = figurePage({ holds: true });
    const figure = drawn(page);
    const picks: FigurePick[] = [];
    figure.on('pick', read => { picks.push(read); });
    const place = at(200, 80);
    move(page, figure, place);
    for (const read of page.reads()) read.answer(reply(SCENE, read.message.payload as FigureReadPayload, 'compare', 19));
    // The export (a long computation) fails.
    const table = figure.exportTable();
    assert.equal(figure.inspect().readout, 'computing…');
    click(page, figure, place);
    assert.deepEqual(picks, [], 'no click while it runs');
    const [exported] = page.take(message => message.command === 'figure-export');
    exported.fail();
    assert.notEqual(figure.inspect().readout, 'computing…', 'the failed reply ended the long computation');
    // Reads go again: the pointer's place is read once at once (第 6 節), then the pointer moved on is read, and the
    // click acts on that read.
    const resumed = page.reads();
    assert.equal(resumed.length, 1, 'the pointer is read once as the failed computation ends');
    resumed[0].answer(reply(SCENE, resumed[0].message.payload as FigureReadPayload, 'compare', 19));
    const next = at(260, 70);
    move(page, figure, next);
    const after = page.reads();
    assert.equal(after.length, 1, 'reads are sent again once the failed computation ended');
    after[0].answer(reply(SCENE, after[0].message.payload as FigureReadPayload, 'compare', 27));
    click(page, figure, next);
    agree(figure, SCENE, { line: 'compare', index: 27 }, picks[0]);
    void table;
    figure.dispose();
});

test('row 8: a picture refused as too large is said so, nothing is drawn or read, and no draw is asked again until the spec, view or size changes', () => {
    const page = figurePage();
    const figure = page.figure(undefined, SCENE_SIZE);
    figure.show(sceneSpec(), null);
    const [asked] = page.draws();
    const payload = asked.message.payload as { figureId: string; generation: number; requestNumber: number };
    asked.answer({ status: 'too-large', figureId: payload.figureId, generation: payload.generation, requestNumber: payload.requestNumber });
    const seen = figure.inspect();
    assert.equal(seen.failure, 'too-large');
    assert.equal(seen.readout, 'too large');
    assert.deepEqual(seen.lanes, [], 'nothing drawn');
    move(page, figure, at(200, 80));
    click(page, figure, at(200, 80));
    assert.deepEqual(page.reads(), [], 'nothing read');
    assert.deepEqual(page.draws(), [], 'not asked again by itself');
    figure.show(sceneSpec(), { x: [100, 1000] });
    assert.equal(page.draws().length, 1, 'a change asks once more');
    figure.dispose();
});
