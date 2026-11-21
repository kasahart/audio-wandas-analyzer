/**
 * A bins lane of the Figure (a distribution on the new path) against a stand-in of the figure service: the
 * bars, dots, ticks and role lines are placed where the picture's edges, levels and counts say; the readout writes the
 * bar, the row or the role line the service answered; a click on a bar, or where no point is read, tells the screen
 * that bin's range (the picture's or the reply's own ends), and a click on a row tells the row. The Figure counts
 * nothing and works out no bin: every count and every edge checked here is the stand-in's.
 *
 * And the handing of a table column (answers/figureRequests.ts): once, with the first request whose spec names it, and
 * again when a picture counts it as not kept.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult, FigureReadPayload, FigureReadResult, FigureSpec } from '../shared/protocol/generated/backendProtocolSchema';
import type { FigurePick, FigureRange } from '../webview/figure/index';
import { figurePage, type FigurePage } from './helpers/figureStandIn';

const SIZE = { size: { width: 56 + 600 + 14, height: 16 + 200 + 22 + 200 + 30 } };
const FRAMES = { A: { left: 56, top: 16, width: 600, height: 200 }, B: { left: 56, top: 238, width: 600, height: 200 } };
const COLUMN = { key: 'column:temp', version: 'v1', rows: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 's1', 's2'], values: [5, 10, 60, 55, 70, 90, 30, 31] };
const SPEC: FigureSpec = {
    lanes: [
        { id: 'A', kind: 'bins', column: COLUMN.key, rows: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], lines: [{ id: 'A:compare1', role: 'compare1', of: { key: 'r3' } }] },
        { id: 'B', kind: 'bins', column: COLUMN.key, rows: ['s1', 's2'], lines: [] },
    ],
    keys: [{ key: COLUMN.key, state: 'usable', version: 'v1' }],
};
const EDGES = [0, 25, 50, 75, 100];
const AXIS = { quantity: 'count', unit: '', reference: 1, referenceLabel: '', calibration: 'unknown', xScale: 'linear', yScale: 'linear' } as const;

function picture(draw: FigureDrawPayload, id: string, picked?: number[]): FigureDrawResult {
    const range = (top: number) => ({ x: [0, 100], y: [0, top] });
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: id, dataId: `data-${id}`,
        lanes: [
            {
                id: 'A', kind: 'bins', axis: AXIS, lines: [], guides: [], range: range(4), whole: range(4),
                bins: {
                    column: COLUMN.key, bars: 'A:bars', rows: 'A:rows', edges: EDGES, step: 25, counts: [2, 0, 3, 1], ...(picked ? { countsPicked: picked } : {}),
                    members: [{ key: 'r1', value: 5 }, { key: 'r2', value: 10 }, { key: 'r4', value: 55 }, { key: 'r3', value: 60 }, { key: 'r5', value: 70 }, { key: 'r6', value: 90 }],
                    n: 6, blank: 0, marks: [{ id: 'A:compare1', role: 'compare1', key: 'r3', value: 60 }],
                },
            },
            {
                id: 'B', kind: 'bins', axis: AXIS, lines: [], guides: [], range: range(3), whole: range(3),
                bins: { column: COLUMN.key, bars: 'B:bars', rows: 'B:rows', edges: EDGES, step: 25, members: [{ key: 's1', value: 30, at: 0.5 }, { key: 's2', value: 31, at: 1.5 }], n: 2, blank: 1, marks: [] },
            },
        ],
        headlines: [],
        members: { shown: { used: [COLUMN.key], n: 1, excluded: [] }, combined: { used: [COLUMN.key], n: 1, excluded: [] }, calibration: 'unknown', lines: [] },
    };
}
const NAMES: Record<string, string> = { r2: 'two.wav', r3: 'three.wav' };
function shown(page: FigurePage, selection: readonly [number, number] | null = null, picked?: number[]) {
    const figure = page.figure(undefined, { ...SIZE, columnName: () => 'temp [°C]', lineLabel: line => (line.key !== undefined ? NAMES[line.key] ?? line.key : line.id) });
    figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    figure.show(SPEC, null, selection);
    const [draw] = page.draws();
    const payload = draw.message.payload as FigureDrawPayload;
    draw.answer(picture(payload, 'p1', picked));
    return { figure, payload };
}
const near = (actual: number, expected: number, what: string, tolerance = 0.5): void => assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const xPx = (value: number): number => 56 + (value / 100) * 600;
const yPx = (lane: 'A' | 'B', count: number): number => FRAMES[lane].top + (1 - count / (lane === 'A' ? 4 : 3)) * 200;
const reply = (read: FigureReadPayload, more: Partial<FigureReadResult>): FigureReadResult => ({ status: 'point', figureId: read.figureId, pictureId: read.pictureId, requestNumber: read.requestNumber, lane: 'A', version: 'col@v1', ...more });
/** The pointer moved to (value, count) of a lane, and the read it asked answered with `more`. */
function hover(page: FigurePage, figure: ReturnType<typeof shown>['figure'], lane: 'A' | 'B', value: number, count: number, more: Partial<FigureReadResult>): FigureReadPayload {
    page.mouse(figure.canvas, 'mousemove', xPx(value), yPx(lane, count), { buttons: 0 });
    const [read] = page.reads();
    const payload = read.message.payload as FigureReadPayload;
    read.answer(reply(payload, more));
    return payload;
}
function click(page: FigurePage, figure: ReturnType<typeof shown>['figure'], lane: 'A' | 'B', value: number, count: number): void {
    page.mouse(figure.canvas, 'mousedown', xPx(value), yPx(lane, count));
    page.mouse(page.document, 'mouseup', xPx(value), yPx(lane, count));
}
function signals(figure: ReturnType<typeof shown>['figure']) {
    const ranges: FigureRange[] = [], picks: FigurePick[] = [];
    figure.on('range', range => { ranges.push(range); });
    figure.on('pick', read => { picks.push(read); });
    return { ranges, picks };
}

test('a bins lane places its bars between the picture\'s edges at the picture\'s counts, its rows as ticks or stacked dots, and its role lines; the axes are the column\'s and the count\'s', () => {
    const page = figurePage();
    const { figure, payload } = shown(page);
    assert.equal(payload.selection, undefined, 'no selection is sent when none is made');
    const [a, b] = figure.inspect().lanes;
    assert.deepEqual([a.frame, b.frame], [FRAMES.A, FRAMES.B]);
    assert.deepEqual(a.axisNames, { x: 'temp [°C]', y: 'Count per group [recordings]' });
    // A bar for every bin with a row (none for the empty bin 1), from edge to edge and up to its count.
    assert.deepEqual(a.bins?.bars.map(bar => [bar.bin, bar.count]), [[0, 2], [2, 3], [3, 1]]);
    const third = a.bins?.bars[1];
    near(third?.left ?? NaN, xPx(50), 'bin 2\'s left edge');
    near(third?.right ?? NaN, xPx(75), 'bin 2\'s right edge');
    near(third?.top ?? NaN, yPx('A', 3), 'bin 2\'s top');
    near(third?.bottom ?? NaN, yPx('A', 0), 'bin 2\'s foot');
    assert.equal(third?.picked, undefined);
    // Under bars each row is a tick at its value; a role's row is a line at its value.
    assert.deepEqual(a.bins?.ticks.map(tick => tick.key), ['r1', 'r2', 'r4', 'r3', 'r5', 'r6']);
    near(a.bins?.ticks[3].px ?? NaN, xPx(60), 'the tick of r3');
    assert.deepEqual(a.bins?.dots, []);
    assert.deepEqual(a.bins?.marks.map(mark => [mark.id, mark.role, mark.key]), [['A:compare1', 'compare1', 'r3']]);
    near(a.bins?.marks[0].px ?? NaN, xPx(60), 'the role line');
    // A group of few: a dot a row, where up the count axis the picture says it is; no bar, no tick.
    assert.deepEqual([b.bins?.bars, b.bins?.ticks], [[], []]);
    assert.deepEqual(b.bins?.dots.map(dot => dot.key), ['s1', 's2']);
    near(b.bins?.dots[1].px ?? NaN, xPx(31), 'the second dot across');
    near(b.bins?.dots[1].py ?? NaN, yPx('B', 1.5), 'the second dot, where the picture put it');
});

test('a selected range is sent with the draw, and the part of each bar it takes is the picture\'s', () => {
    const page = figurePage();
    const { figure, payload } = shown(page, [50, 75], [0, 0, 3, 0]);
    assert.deepEqual(payload.selection, [50, 75]);
    const bars = figure.inspect().lanes[0].bins?.bars ?? [];
    assert.deepEqual(bars.map(bar => bar.picked), [0, 3, 0]);
    near(bars[1].pickedTop ?? NaN, yPx('A', 3), 'the picked part of bin 2');
    // Another range asks for another picture; the same one does not.
    figure.show(SPEC, null, [50, 75]);
    assert.equal(page.draws().length, 0);
    figure.show(SPEC, null, [0, 25]);
    const [again] = page.draws();
    assert.deepEqual((again.message.payload as FigureDrawPayload).selection, [0, 25]);
});

test('a bar reads its group, its bin\'s ends and its count; a click on it tells the screen that bin\'s range', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const { ranges, picks } = signals(figure);
    const asked = hover(page, figure, 'A', 62, 3, { line: 'A:bars', point: { index: 2, x: 62.5, value: 3, xStep: 25 } });
    assert.equal(asked.pointer?.lane, 'A');
    near(asked.pointer?.x ?? NaN, 62, 'the pointer\'s value', 1e-9);
    near(asked.pointer?.y ?? NaN, 3, 'the pointer\'s count', 1e-9);
    assert.deepEqual(asked.pointer?.scale, [6, 50]);
    const seen = figure.inspect();
    assert.equal(seen.readout, 'A / 50.0–75.0 / 3 recordings');
    near(seen.mark?.px ?? NaN, xPx(62.5), 'the mark across');
    near(seen.mark?.py ?? NaN, yPx('A', 3), 'the mark on the bar\'s top');
    click(page, figure, 'A', 62, 3);
    assert.deepEqual(ranges, [{ lane: 'A', x: [50, 75] }]);
    assert.deepEqual(picks, []);
    // ← / → step from the bar read: asked of the service, by the bar's line and bin.
    page.mouse(figure.canvas, 'mousemove', xPx(62), yPx('A', 3), { buttons: 0 });
    page.key('ArrowRight');
    const step = page.reads().map(read => read.message.payload as FigureReadPayload).find(read => read.step);
    assert.deepEqual(step?.step, { lane: 'A', line: 'A:bars', version: 'col@v1', index: 2, steps: 1 });
});

test('with a range selected a bar reads how many of its rows the range takes, of all in it', () => {
    const page = figurePage();
    const { figure } = shown(page, [50, 60], [0, 0, 1, 0]);
    hover(page, figure, 'A', 62, 3, { line: 'A:bars', point: { index: 2, x: 62.5, value: 3, xStep: 25 } });
    assert.equal(figure.inspect().readout, 'A / 50.0–75.0 / 1 / 3 recordings');
});

test('a row\'s tick reads its group, the row and its value; a click on it tells the screen the row', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const { ranges, picks } = signals(figure);
    hover(page, figure, 'A', 10, 0, { line: 'A:rows', point: { index: 1, x: 10, value: 0, key: 'r2' } });
    assert.equal(figure.inspect().readout, 'A / two.wav / 10.0');
    click(page, figure, 'A', 10, 0);
    assert.deepEqual(picks.map(read => [read.line, read.point.key]), [['A:rows', 'r2']]);
    assert.deepEqual(ranges, []);
    // A row is stepped from by its key (rows of one value are told apart by it).
    page.mouse(figure.canvas, 'mousemove', xPx(10), yPx('A', 0), { buttons: 0 });
    page.key('ArrowRight');
    const step = page.reads().map(read => read.message.payload as FigureReadPayload).find(read => read.step);
    assert.deepEqual(step?.step, { lane: 'A', line: 'A:rows', key: 'r2', version: 'col@v1', index: 1, steps: 1 });
});

test('a role\'s line reads the row and its value, in its role\'s colour, and a click tells the screen the row', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const { picks } = signals(figure);
    hover(page, figure, 'A', 60, 3.9, { line: 'A:compare1', role: 'compare1', point: { index: 1, x: 60, value: 4, key: 'r3' } });
    assert.equal(figure.inspect().readout, 'three.wav / 60.0');
    assert.equal(figure.readout.style.color, 'rgb(232, 113, 10)');
    click(page, figure, 'A', 60, 3.9);
    assert.deepEqual(picks.map(read => [read.line, read.role, read.point.key]), [['A:compare1', 'compare1', 'r3']]);
});

test('where no point is read, a click tells the screen the bin the service said is under the pointer; with none said, nothing', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const { ranges, picks } = signals(figure);
    hover(page, figure, 'B', 80, 2.5, { status: 'outside', lane: 'B', bin: { index: 3, low: 75, high: 100 } });
    assert.equal(figure.inspect().readout, '');
    assert.equal(figure.inspect().mark, null);
    click(page, figure, 'B', 80, 2.5);
    // (The last bin: it reaches the top of the lane's whole axis, so the range says it takes the values on it.)
    assert.deepEqual(ranges, [{ lane: 'B', x: [75, 100], closed: true }]);
    // A read of no point that names no bin (off the value axis): a click does nothing.
    hover(page, figure, 'B', 81, 2.5, { status: 'outside', lane: 'B' });
    click(page, figure, 'B', 81, 2.5);
    assert.deepEqual([ranges.length, picks.length], [1, 0]);
});

test('a click whose read has not come yet waits for it, and picks the bin it then says', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const { ranges } = signals(figure);
    page.mouse(figure.canvas, 'mousedown', xPx(30), yPx('A', 2));
    page.mouse(page.document, 'mouseup', xPx(30), yPx('A', 2));
    assert.deepEqual(ranges, []);
    const [read] = page.reads();
    read.answer(reply(read.message.payload as FigureReadPayload, { status: 'outside', bin: { index: 1, low: 25, high: 50 } }));
    assert.deepEqual(ranges, [{ lane: 'A', x: [25, 50] }]);
});

test('a row read is no longer shown once the picture has another row there', () => {
    const page = figurePage();
    const { figure } = shown(page);
    // The service answers a row the picture does not have at that index (a picture of another table): not shown.
    hover(page, figure, 'A', 10, 0, { line: 'A:rows', point: { index: 1, x: 10, value: 0, key: 'gone' } });
    assert.equal(figure.inspect().readout, '');
    assert.equal(figure.inspect().mark, null);
});

test('a table column is handed once, with the first request whose spec names it, and again when a picture counts it as not kept', () => {
    const page = figurePage();
    page.answers.column(COLUMN);
    const figure = page.figure(undefined, SIZE);
    figure.show(SPEC, null);
    const [first] = page.draws();
    const payload = first.message.payload as FigureDrawPayload;
    assert.deepEqual(payload.columns, [COLUMN]);
    first.answer(picture(payload, 'p1'));
    // The next draw names the column by key alone.
    figure.show(SPEC, { x: [10, 90], lanes: [] });
    const [second] = page.draws();
    const next = second.message.payload as FigureDrawPayload;
    assert.equal(next.columns, undefined);
    // The service no longer keeps it: the draw is asked once more with the column, and that picture is the one drawn.
    const evicted: FigureDrawResult = {
        ...picture(next, 'p2'), lanes: SPEC.lanes.map(lane => ({ id: lane.id, kind: 'bins' as const, axis: AXIS, lines: [], guides: [] })),
        members: { shown: { used: [], n: 0, excluded: [{ key: COLUMN.key, reason: 'evicted' }] }, combined: { used: [], n: 0, excluded: [{ key: COLUMN.key, reason: 'evicted' }] }, calibration: 'unknown', lines: [] },
    };
    second.answer(evicted);
    assert.equal(figure.inspect().waiting, true, 'the picture without the column is not drawn');
    const [third] = page.draws();
    const again = third.message.payload as FigureDrawPayload;
    assert.deepEqual([again.columns, again.requestNumber], [[COLUMN], next.requestNumber]);
    third.answer(evicted);
    // Not kept again: asked no further, and the picture (with nothing to draw) is the Figure's.
    assert.equal(page.draws().length, 0);
    assert.equal(figure.inspect().waiting, false);
    // A new version of the column (the table changed) is handed with the next request that names it.
    page.answers.column({ ...COLUMN, version: 'v2' });
    figure.show({ ...SPEC, keys: [{ key: COLUMN.key, state: 'usable', version: 'v2' }] }, null);
    const [fourth] = page.draws();
    assert.deepEqual((fourth.message.payload as FigureDrawPayload).columns, [{ ...COLUMN, version: 'v2' }]);
});
