/**
 * A band lane of the Figure (time signals on the new path) against a stand-in of the figure service: the
 * lane is drawn as the picture's lines over a linear time axis and a linear value axis named with the signal's unit,
 * a read carries the pointer's time and value, the readout writes the sample the service answered (when, to its sample
 * period, and its value in its unit), and the arrow keys step a sample from the one read. The Figure chooses no sample
 * and makes no value: every number checked here is the stand-in's.
 *
 * And the retry of a draw answered "busy" (the process's one budget, figures/budget.py): asked once more a little
 * later if it is still the Figure's newest; busy again, the Figure says so.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult, FigureReadPayload, FigureReadResult, FigureSpec } from '../shared/protocol/generated/backendProtocolSchema';
import type { FigureRequestMessage } from '../shared/protocol/figureMessages';
import { BUSY_WAIT_MS, createFigureAnswers } from '../webview/answers/figureRequests';
import { figurePage, type FigurePage } from './helpers/figureStandIn';

const SIZE = { size: { width: 56 + 600 + 14, height: 10 + 200 + 30 } };
const FRAME = { left: 56, top: 10, width: 600, height: 200 };
const SPEC: FigureSpec = {
    lanes: [{ id: 'sound', kind: 'band', lines: [{ id: 'cmp', role: 'compare1', of: { key: 'rec' } }, { id: 'base', role: 'base', of: { key: 'ref' } }] }],
    keys: [{ key: 'rec', state: 'usable', version: 'v1' }, { key: 'ref', state: 'usable', version: 'v1' }],
};
const RANGE = { x: [0, 4], y: [-0.8, 0.8] };

function picture(draw: FigureDrawPayload, id: string, unit = 'Pa'): FigureDrawResult {
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: id, dataId: `data-${id}`,
        lanes: [{
            id: 'sound', kind: 'band', guides: [], range: RANGE, whole: RANGE,
            // The drawn points are the service's alone (their type cannot be made here): the stand-in's are cast.
            lines: [
                { id: 'cmp', role: 'compare1', key: 'rec', xs: [0, 1, 1.000125, 2, 4], values: [0, -0.4, 0.72, null, 0.2] },
                { id: 'base', role: 'base', key: 'ref', xs: [0, 4], values: [0.1, -0.1] },
            ] as never,
            axis: { quantity: 'value', unit, reference: 2e-5, referenceLabel: 'dB SPL', calibration: 'calibrated', xScale: 'linear', yScale: 'linear' },
        }],
        headlines: [],
        members: {
            shown: { used: ['rec', 'ref'], n: 2, excluded: [] }, combined: { used: ['rec', 'ref'], n: 2, excluded: [] }, calibration: 'calibrated',
            lines: [{ line: 'cmp', drawn: true, used: ['rec'], excluded: [] }, { line: 'base', drawn: true, used: ['ref'], excluded: [] }],
        },
    };
}
const sample = (read: FigureReadPayload, index: number, x: number, value: number): FigureReadResult => ({
    status: 'point', figureId: read.figureId, pictureId: read.pictureId, requestNumber: read.requestNumber, lane: 'sound', line: 'cmp', role: 'compare1', version: 'cmp@v1',
    point: { index, x, value, xStep: 0.000125, key: 'rec' },
});
function shown(page: FigurePage, unit = 'Pa') {
    const figure = page.figure(undefined, SIZE);
    figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    figure.show(SPEC, null);
    const [draw] = page.draws();
    const payload = draw.message.payload as FigureDrawPayload;
    draw.answer(picture(payload, 'p1', unit));
    return { figure, payload };
}
const near = (actual: number, expected: number, what: string, tolerance = 1): void => assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const xPx = (seconds: number): number => FRAME.left + (seconds / 4) * FRAME.width;
const yPx = (value: number): number => FRAME.top + (1 - (value + 0.8) / 1.6) * FRAME.height;

test('a band lane is drawn as its signals\' lines over time, the value axis named with the signal\'s unit, and asks for no lane height', () => {
    const page = figurePage();
    const { figure, payload } = shown(page);
    assert.equal(payload.width, 600);
    assert.equal(payload.laneHeights, undefined);
    const [lane] = figure.inspect().lanes;
    assert.deepEqual(lane.frame, FRAME);
    assert.deepEqual(lane.axisNames, { x: 'Time [s]', y: 'Amplitude [Pa]' });
    assert.equal(lane.image, undefined);
    // Declared order is the draw order; each sample at its own time and value, a sample with no value a gap.
    assert.deepEqual(lane.lines.map(line => line.id), ['cmp', 'base']);
    const [compared] = lane.lines;
    assert.equal(compared.points[3], null);
    near(compared.points[2]?.[0] ?? NaN, xPx(1.000125), 'the click across');
    near(compared.points[2]?.[1] ?? NaN, yPx(0.72), 'the click up');
    // Both axes are linear: 2 s is half way across, 0 half way up.
    near(lane.xTicks.find(tick => tick.value === 2)?.px ?? NaN, xPx(2), 'the 2 s tick');
    near(lane.yTicks.find(tick => tick.value === 0)?.px ?? NaN, yPx(0), 'the 0 tick');
});

test('a signal with no unit names its value axis without one', () => {
    const page = figurePage();
    const { figure } = shown(page, '');
    assert.deepEqual(figure.inspect().lanes[0].axisNames, { x: 'Time [s]', y: 'Amplitude' });
});

test('a read on a band lane carries the pointer\'s time and value; the readout writes the sample answered, and ← → step a sample from it', () => {
    const page = figurePage();
    const { figure } = shown(page);
    page.mouse(figure.canvas, 'mousemove', xPx(1), yPx(0.7), { buttons: 0 });
    const [read] = page.reads();
    const payload = read.message.payload as FigureReadPayload;
    assert.equal(payload.pointer?.lane, 'sound');
    near(payload.pointer?.x ?? NaN, 1, 'the pointer\'s time', 1e-9);
    near(payload.pointer?.y ?? NaN, 0.7, 'the pointer\'s value', 1e-9);
    // px per second across, px per unit up.
    near(payload.pointer?.scale[0] ?? NaN, 150, 'the scale across', 1e-9);
    near(payload.pointer?.scale[1] ?? NaN, 125, 'the scale up', 1e-9);
    read.answer(sample(payload, 8001, 1.000125, 0.7234567));
    const seen = figure.inspect();
    // When, to the digits that tell samples 125 µs apart (the shared rule of every time read: four decimals here), and
    // the value to three significant figures in its unit.
    assert.equal(seen.readout, 'cmp / 1.0001 s / 0.723 Pa');
    assert.deepEqual([seen.mark?.index, seen.mark?.x, seen.mark?.value], [8001, 1.000125, 0.7234567]);
    near(seen.mark?.px ?? NaN, xPx(1.000125), 'the mark across');
    near(seen.mark?.py ?? NaN, yPx(0.7234567), 'the mark up');
    page.key('ArrowRight');
    const [step] = page.reads();
    const asked = step.message.payload as FigureReadPayload;
    assert.deepEqual(asked.step, { lane: 'sound', line: 'cmp', key: 'rec', version: 'cmp@v1', index: 8001, steps: 1 });
    assert.deepEqual([asked.dataId, asked.generation], ['data-p1', figure.inspect().generation]);
});

/** The page's requests with a clock of the test's own: what waits to run, and its delay. */
function busyPage() {
    const posted: FigureRequestMessage[] = [];
    const waits: Array<{ run: () => void; ms: number }> = [];
    const answers = createFigureAnswers(
        { cancels: true, holdsReadsWhileComputing: false, post(message) { if (message.type === 'figure-request' && message.command === 'figure-draw') posted.push(message); } },
        'busy', (run, ms) => { waits.push({ run, ms }); },
    );
    const answer = (message: FigureRequestMessage, status: FigureDrawResult['status']): void => {
        const payload = message.payload as FigureDrawPayload;
        answers.handle({ type: 'figure-result', requestId: message.requestId, command: message.command, result: { status, figureId: payload.figureId, generation: payload.generation, requestNumber: payload.requestNumber } });
    };
    return { answers, posted, waits, answer };
}
const DRAW = { generation: 1, spec: SPEC, view: null, width: 600, height: 200 };

test('the line read is drawn wider than the others of its lane; a lane\'s one line is drawn the same read or not', () => {
    const widths = (figure: ReturnType<typeof shown>['figure']): Record<string, number> => Object.fromEntries(figure.inspect().lanes[0].lines.map(line => [line.id, line.width]));
    // Two signals on the lane: the one read is told from the other.
    const page = figurePage();
    const { figure } = shown(page);
    const before = widths(figure);
    page.mouse(figure.canvas, 'mousemove', xPx(1), yPx(0.7), { buttons: 0 });
    const [read] = page.reads();
    read.answer(sample(read.message.payload as FigureReadPayload, 8001, 1.000125, 0.7234567));
    assert.ok(widths(figure).cmp > before.cmp, 'the line read is wider');
    assert.equal(widths(figure).base, before.base);
    // One signal alone (a Tracks row): wider, its short peaks would look taller under the pointer than beside it.
    const alone = figurePage();
    const one = alone.figure(undefined, SIZE);
    one.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    one.show(SPEC, null);
    const [draw] = alone.draws();
    const reply = picture(draw.message.payload as FigureDrawPayload, 'p1');
    const lane = (reply.lanes ?? [])[0];
    lane.lines = lane.lines.filter(line => line.id === 'cmp');
    draw.answer(reply);
    const unread = widths(one);
    alone.mouse(one.canvas, 'mousemove', xPx(1), yPx(0.7), { buttons: 0 });
    const [second] = alone.reads();
    second.answer(sample(second.message.payload as FigureReadPayload, 8001, 1.000125, 0.7234567));
    assert.equal(one.inspect().mark?.index, 8001, 'the sample is read');
    assert.deepEqual(widths(one), unread);
});

test('a draw answered "busy" is asked once more a little later; busy again, the Figure is told', () => {
    const { answers, posted, waits, answer } = busyPage();
    const replies: Array<FigureDrawResult | null> = [];
    answers.figure().draw(DRAW, reply => replies.push(reply));
    answer(posted[0], 'busy');
    assert.deepEqual([replies.length, waits.length, waits[0]?.ms], [0, 1, BUSY_WAIT_MS]);
    waits[0].run();
    assert.equal(posted.length, 2);
    assert.deepEqual(posted[1].payload, posted[0].payload);
    assert.notEqual(posted[1].requestId, posted[0].requestId);
    answer(posted[1], 'busy');
    assert.deepEqual([replies.map(reply => reply?.status), waits.length], [['busy'], 1]);
});

test('a draw asked again after "busy" that is answered with its picture is delivered as any draw', () => {
    const { answers, posted, waits, answer } = busyPage();
    const replies: Array<FigureDrawResult | null> = [];
    answers.figure().draw(DRAW, reply => replies.push(reply));
    answer(posted[0], 'busy');
    waits[0].run();
    answer(posted[1], 'too-large');
    assert.deepEqual(replies.map(reply => reply?.status), ['too-large']);
});

test('a "busy" draw is not asked again once a newer draw came or the Figure went', () => {
    const { answers, posted, waits, answer } = busyPage();
    const requests = answers.figure();
    requests.draw(DRAW, () => assert.fail('the older draw is never delivered'));
    answer(posted[0], 'busy');
    requests.draw({ ...DRAW, generation: 2 }, () => undefined);
    waits[0].run();
    assert.equal(posted.length, 2, 'only the newer draw was sent');
    const gone = busyPage();
    const going = gone.answers.figure();
    going.draw(DRAW, () => assert.fail('nothing is delivered after dispose'));
    gone.answer(gone.posted[0], 'busy');
    going.dispose();
    gone.waits[0].run();
    assert.equal(gone.posted.length, 1);
});

test('the Figure says a picture was busy twice, apart from too large and failed', () => {
    const page = figurePage();
    const busy = busyPage();
    const figure = page.figure(busy.answers.figure(), SIZE);
    figure.show(SPEC, null);
    busy.answer(busy.posted[0], 'busy');
    // Asked once more: the Figure still waits, and says nothing yet.
    assert.deepEqual([figure.inspect().waiting, figure.inspect().failure], [true, null]);
    busy.waits[0].run();
    busy.answer(busy.posted[1], 'busy');
    assert.deepEqual([figure.inspect().waiting, figure.inspect().failure, figure.inspect().readout], [false, 'busy', 'busy']);
});
