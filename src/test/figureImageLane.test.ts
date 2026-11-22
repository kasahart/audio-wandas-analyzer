/**
 * An image lane of the Figure (a spectrogram on the new path) against a stand-in of the figure service: the
 * draw request says the plot's width and the lane's own height (the service makes the cells for them), the cells are
 * painted where the picture's edges say (配置), the axis up is logarithmic, the colour axis is the picture's confirmed
 * one, a read carries the pointer's time and frequency, the readout writes the cell the service answered (time,
 * frequency, level), the mark is at the cell's place, and the arrow keys step a column or a row from the cell read.
 * The Figure chooses no cell and makes no value: every number checked here is the stand-in's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult, FigureReadPayload, FigureReadResult, FigureSpec, FigureView } from '../shared/protocol/generated/backendProtocolSchema';
import { axisScale } from '../webview/figure/axisScale';
import { COLOUR_BAR_ROOM, colourOf, imagePixelsOf, shadeOf, WHOLE_IMAGE_PIXELS } from '../webview/figure/imageLane';
import { figurePage, type FigurePage } from './helpers/figureStandIn';

const SIZE = { size: { width: 56 + 600 + 14 + COLOUR_BAR_ROOM, height: 10 + 256 + 30 } };
const FRAME = { left: 56, top: 10, width: 600, height: 256 };
const SPEC: FigureSpec = {
    lanes: [{ id: 'image', kind: 'image', lines: [{ id: 'sound', of: { key: 'rec' } }] }],
    keys: [{ key: 'rec', state: 'usable', version: 'v1' }],
};
const WHOLE = { x: [0, 2], y: [20, 4000], colour: [-100, 0] };
/** Four columns across 0 … 2 s and three rows 20 … 4000 Hz (edges at 20, 200, 2000, 4000). */
const IMAGE = { line: 'sound', key: 'rec', columnEdges: [0, 0.5, 1, 1.5, 2], rowEdges: [20, 200, 2000, 4000], cells: [[-90, -80, -70, -60], [-50, -40, null, -20], [-10, -5, -3, 0]] };

function picture(draw: FigureDrawPayload, id: string): FigureDrawResult {
    const lane = draw.view?.lanes?.find(item => item.lane === 'image');
    const range = { x: [draw.view?.x?.[0] ?? WHOLE.x[0], draw.view?.x?.[1] ?? WHOLE.x[1]], y: [lane?.y[0] ?? WHOLE.y[0], lane?.y[1] ?? WHOLE.y[1]], colour: WHOLE.colour };
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: id, dataId: `data-${id}`,
        lanes: [{
            id: 'image', kind: 'image', lines: [], guides: [], image: IMAGE as never, range, whole: WHOLE,
            axis: { quantity: 'level', unit: 'Pa', reference: 2e-5, referenceLabel: 'dB SPL', calibration: 'calibrated', xScale: 'linear', yScale: 'log' },
        }],
        headlines: [],
        members: { shown: { used: ['rec'], n: 1, excluded: [] }, combined: { used: ['rec'], n: 1, excluded: [] }, calibration: 'calibrated', lines: [{ line: 'sound', drawn: true, used: ['rec'], excluded: [] }] },
    };
}
const cell = (read: FigureReadPayload, index: number, row: number, x: number, y: number, value: number): FigureReadResult => ({
    status: 'point', figureId: read.figureId, pictureId: read.pictureId, requestNumber: read.requestNumber, lane: 'image', line: 'sound', version: 'sound@v1',
    point: { index, row, x, y, value, xStep: 0.004, yStep: 31.25, key: 'rec' },
});
function shown(page: FigurePage, view: FigureView | null = null) {
    const figure = page.figure(undefined, SIZE);
    figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    figure.show(SPEC, view);
    const [draw] = page.draws();
    const payload = draw.message.payload as FigureDrawPayload;
    draw.answer(picture(payload, 'p1'));
    return { figure, payload };
}
const near = (actual: number, expected: number, what: string, tolerance = 1): void => assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const yPx = (hz: number, low = 20, high = 4000): number => FRAME.top + (1 - Math.log(hz / low) / Math.log(high / low)) * FRAME.height;

test('an image lane\'s draw request says the plot\'s width (the colour bar\'s room left out) and the lane\'s own height', () => {
    const page = figurePage();
    const { payload } = shown(page);
    assert.equal(payload.width, 600);
    assert.deepEqual(payload.laneHeights, [{ lane: 'image', height: 256 }]);
});

test('an image lane is drawn where the picture\'s edges say: time across, frequency up a log axis, the colour axis beside it', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const [lane] = figure.inspect().lanes;
    assert.deepEqual(lane.frame, FRAME);
    assert.deepEqual(lane.axisNames, { x: 'Time [s]', y: 'Frequency [Hz]' });
    assert.deepEqual(lane.lines, []);
    const image = lane.image;
    assert.ok(image, 'the lane has its image');
    assert.deepEqual([image.rows, image.columns, image.colour], [3, 4, [-100, 0]]);
    assert.equal(image.colourName, 'Level [dB SPL]');
    near(image.edges.left, FRAME.left, 'the first column\'s left edge');
    near(image.edges.right, FRAME.left + FRAME.width, 'the last column\'s right edge');
    near(image.edges.bottom, FRAME.top + FRAME.height, 'the first row\'s lower edge');
    near(image.edges.top, FRAME.top, 'the last row\'s upper edge');
    // The axis up is logarithmic: 200 Hz is at its place between 20 Hz and 4 kHz, never at a linear one.
    const tick = lane.yTicks.find(item => item.value === 200);
    assert.ok(tick, 'a tick at 200 Hz');
    near(tick.px, yPx(200), 'the 200 Hz tick');
    // The colour axis's ticks are of the picture's confirmed colour range, up the bar: 0 dB at its top, −100 dB at its bottom.
    near(image.colourTicks.find(item => item.value === 0)?.px ?? NaN, FRAME.top, 'the colour axis\'s top');
    near(image.colourTicks.find(item => item.value === -100)?.px ?? NaN, FRAME.top + FRAME.height, 'the colour axis\'s bottom');
    assert.deepEqual([shadeOf(-100, -100, 0), shadeOf(-50, -100, 0), shadeOf(0, -100, 0), shadeOf(-140, -100, 0), shadeOf(6, -100, 0)], [0, 128, 255, 0, 255]);
});

test('a read on an image lane carries the pointer\'s time and frequency; the readout writes the cell answered and the mark is at its place', () => {
    const page = figurePage();
    const { figure } = shown(page);
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 300, yPx(1000), { buttons: 0 });
    const [read] = page.reads();
    const payload = read.message.payload as FigureReadPayload;
    assert.equal(payload.pointer?.lane, 'image');
    near(payload.pointer?.x ?? NaN, 1, 'the pointer\'s time', 1e-9);
    near((payload.pointer?.y ?? NaN) / 1000, 1, 'the pointer\'s frequency (as a ratio)', 1e-9);
    read.answer(cell(payload, 250, 32, 1, 1000, -12.540070305527902));
    const seen = figure.inspect();
    assert.equal(seen.readout, 'sound / 1.000 s / 1 kHz / −12.5 dB SPL');
    assert.deepEqual([seen.mark?.index, seen.mark?.row, seen.mark?.x, seen.mark?.y, seen.mark?.value], [250, 32, 1, 1000, -12.540070305527902]);
    near(seen.mark?.px ?? NaN, FRAME.left + 300, 'the mark across');
    near(seen.mark?.py ?? NaN, yPx(1000), 'the mark up');
});

test('the arrow keys step a column (← →) or a row (↑ ↓) from the cell read, by its name', () => {
    const page = figurePage();
    const { figure } = shown(page);
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 300, yPx(1000), { buttons: 0 });
    const [read] = page.reads();
    read.answer(cell(read.message.payload as FigureReadPayload, 250, 32, 1, 1000, -12.5));
    page.key('ArrowUp');
    const [up] = page.reads();
    const upPayload = up.message.payload as FigureReadPayload;
    assert.deepEqual(upPayload.step, { lane: 'image', line: 'sound', key: 'rec', version: 'sound@v1', index: 250, steps: 0, row: 32, rows: 1 });
    assert.deepEqual([upPayload.dataId, upPayload.generation], ['data-p1', figure.inspect().generation]);
    up.answer(cell(upPayload, 250, 33, 1, 1031.25, -18.4));
    assert.equal(figure.inspect().mark?.row, 33);
    page.key('ArrowRight');
    const [right] = page.reads();
    assert.deepEqual((right.message.payload as FigureReadPayload).step, { lane: 'image', line: 'sound', key: 'rec', version: 'sound@v1', index: 250, steps: 1, row: 33, rows: 0 });
});

test('↑ pressed again while its read is on its way is kept: the next step moves the rows not yet asked, with the columns', () => {
    const page = figurePage();
    const { figure } = shown(page);
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 300, yPx(1000), { buttons: 0 });
    const [read] = page.reads();
    read.answer(cell(read.message.payload as FigureReadPayload, 250, 32, 1, 1000, -12.5));
    page.key('ArrowUp');
    const [up] = page.reads();
    // Before the first reply: two more rows up and one column right, none of them asked yet (one read at a time).
    page.key('ArrowUp');
    page.key('ArrowUp');
    page.key('ArrowRight');
    assert.equal(page.reads().length, 0);
    up.answer(cell(up.message.payload as FigureReadPayload, 250, 33, 1, 1031.25, -18.4));
    const [rest] = page.reads();
    assert.deepEqual((rest.message.payload as FigureReadPayload).step, { lane: 'image', line: 'sound', key: 'rec', version: 'sound@v1', index: 250, steps: 1, row: 33, rows: 2 });
    rest.answer(cell(rest.message.payload as FigureReadPayload, 251, 35, 1.004, 1093.75, -20.1));
    assert.deepEqual([figure.inspect().mark?.index, figure.inspect().mark?.row], [251, 35]);
    assert.equal(page.reads().length, 0);
});

test('a box dragged on an image lane asks for its time span and its frequency span on the log axis', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const views: FigureView[] = [];
    figure.on('view', view => { views.push(view); });
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 150, yPx(2000));
    page.mouse(page.document, 'mousemove', FRAME.left + 450, yPx(200), { buttons: 1 });
    page.mouse(page.document, 'mouseup', FRAME.left + 450, yPx(200));
    const [view] = views;
    assert.ok(view, 'a view is asked for');
    near(view.x?.[0] ?? NaN, 0.5, 'the low time', 0.01);
    near(view.x?.[1] ?? NaN, 1.5, 'the high time', 0.01);
    const [low, high] = view.lanes?.find(lane => lane.lane === 'image')?.y ?? [];
    near((low ?? NaN) / 200, 1, 'the low frequency (as a ratio)', 0.01);
    near((high ?? NaN) / 2000, 1, 'the high frequency (as a ratio)', 0.01);
});

/** A Tracks row's Figure: its plots start where the rows' time ruler does, with no axis across of its own. */
const ROW = { size: { width: 40 + 600 + COLOUR_BAR_ROOM, height: 96 }, margin: { left: 40, right: 0, top: 0, bottom: 0 }, acrossAxis: false, imagePalette: 'viridis' as const };

test('a Figure given its margins and no axis across fills its box: the plot starts at the margin, nothing is ticked across, and the draw asks for that plot', () => {
    const page = figurePage();
    const figure = page.figure(undefined, ROW);
    figure.show(SPEC, null);
    const [draw] = page.draws();
    const payload = draw.message.payload as FigureDrawPayload;
    draw.answer(picture(payload, 'p1'));
    assert.equal(payload.width, 600);
    assert.deepEqual(payload.laneHeights, [{ lane: 'image', height: 96 }]);
    const [lane] = figure.inspect().lanes;
    assert.deepEqual(lane.frame, { left: 40, top: 0, width: 600, height: 96 });
    assert.deepEqual(lane.xTicks, [], 'the screen draws the axis across once for all its rows');
    assert.ok(lane.yTicks.length > 0, 'the axis up is still the Figure\'s');
});

test('viridis colours a level from the low end (dark purple) to the high end (yellow), held at the ends', () => {
    assert.equal(colourOf(-100, -100, 0, 'viridis'), 'rgb(68,1,84)');
    assert.equal(colourOf(0, -100, 0, 'viridis'), 'rgb(253,231,37)');
    assert.equal(colourOf(-140, -100, 0, 'viridis'), colourOf(-100, -100, 0, 'viridis'));
    assert.equal(colourOf(6, -100, 0, 'viridis'), colourOf(0, -100, 0, 'viridis'));
});

test('Shift+drag tells the screen how far across the pointer is from its press, and zooms nothing; without a listener it is a box zoom as any drag', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const views: FigureView[] = [];
    const shifts: Array<{ lane: string; by: number | null; done: boolean }> = [];
    figure.on('view', view => { views.push(view); });
    const stop = figure.on('shift', drag => { shifts.push(drag); });
    const y = FRAME.top + 100;
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 150, y, { shiftKey: true });
    page.mouse(page.document, 'mousemove', FRAME.left + 450, y, { buttons: 1, shiftKey: true });
    page.mouse(page.document, 'mouseup', FRAME.left + 450, y, { shiftKey: true });
    assert.deepEqual(views, []);
    assert.deepEqual(shifts.map(drag => [drag.lane, drag.done]), [['image', false], ['image', true]]);
    // 300 px of a 600 px plot over 2 s: one second later.
    for (const drag of shifts) near(drag.by ?? NaN, 1, 'the shift across', 0.01);
    assert.equal(figure.inspect().box, null, 'no box is drawn');
    stop();
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 150, y, { shiftKey: true });
    page.mouse(page.document, 'mousemove', FRAME.left + 450, y, { buttons: 1, shiftKey: true });
    page.mouse(page.document, 'mouseup', FRAME.left + 450, y, { shiftKey: true });
    assert.equal(views.length, 1, 'with no listener a Shift+drag zooms as a drag does');
    assert.equal(shifts.length, 2);
});

test('a click where the screen takes its place tells the place of the point read at the press, waited for; where nothing is read, the place under the pointer; it picks no point', () => {
    const page = figurePage();
    const { figure } = shown(page);
    const places: Array<{ lane: string; x: number }> = [];
    let picks = 0;
    figure.on('pick', () => { picks += 1; });
    figure.on('place', at => { places.push(at); });
    const y = FRAME.top + 100;
    // The press reads its place; the click waits for that read and acts on the cell it names (its frame's time).
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 150, y);
    page.mouse(page.document, 'mouseup', FRAME.left + 150, y);
    assert.equal(places.length, 0, 'the read is on its way');
    const [read] = page.reads();
    read.answer(cell(read.message.payload as FigureReadPayload, 120, 32, 0.48, 1000, -30));
    assert.deepEqual(places, [{ lane: 'image', x: 0.48 }]);
    // Nothing read there (off the recording): the place under the pointer, a quarter across 0 … 2 s.
    const noPoint = (): void => {
        for (const open of page.reads()) {
            const asked = open.message.payload as FigureReadPayload;
            open.answer({ status: 'no-point', figureId: asked.figureId, pictureId: asked.pictureId, requestNumber: asked.requestNumber, lane: 'image' });
        }
    };
    page.mouse(figure.canvas, 'mousemove', FRAME.left + 400, y, { buttons: 0 });
    noPoint();
    page.mouse(figure.canvas, 'mousedown', FRAME.left + 150, y);
    page.mouse(page.document, 'mouseup', FRAME.left + 150, y);
    noPoint();
    assert.equal(places.length, 2);
    near(places.at(-1)?.x ?? NaN, 0.5, 'the place under the pointer', 0.01);
    assert.equal(picks, 0);
});

// ── An image's pixels (imagePixelsOf) ────────────────────────────────────────────────────────────────────────────────

const UP = axisScale(20, 4000, true);
const pixelAt = (pixels: ReturnType<typeof imagePixelsOf>, data: Uint8ClampedArray, px: number, py: number): number[] => [...data.slice((py * pixels.width + px) * 4, (py * pixels.width + px) * 4 + 4)];
/** The pixel row of a frequency in a plot 256 px tall on 20 Hz … 4 kHz. */
const rowPx = (hz: number): number => Math.round((1 - UP.fraction(hz)) * 256);

test('an image\'s pixels are its cells where its edges say: a cell\'s colour all over it, clear where it has no value', () => {
    const pixels = imagePixelsOf(IMAGE as never, 600, 256, axisScale(0, 2, false), UP, [-100, 0]);
    assert.deepEqual([pixels.left, pixels.width, pixels.height, pixels.whole], [0, 600, 256, true]);
    const data = pixels.data();
    assert.equal(data.length, 600 * 256 * 4);
    const shade = (value: number): number[] => { const at = shadeOf(value, -100, 0); return [at, at, at, 255]; };
    // The first row (20 … 200 Hz) is at the bottom, the first column (0 … 0.5 s) at the left.
    assert.deepEqual(pixelAt(pixels, data, 10, rowPx(60)), shade(-90));
    assert.deepEqual(pixelAt(pixels, data, 590, rowPx(60)), shade(-60));
    assert.deepEqual(pixelAt(pixels, data, 10, rowPx(3000)), shade(-10));
    // A cell's last pixel and its neighbour's first: no seam, no cell drawn over another.
    assert.deepEqual([pixelAt(pixels, data, 149, rowPx(60)), pixelAt(pixels, data, 150, rowPx(60))], [shade(-90), shade(-80)]);
    assert.deepEqual(pixelAt(pixels, data, 400, rowPx(600)), [0, 0, 0, 0], 'a cell with no value is clear: what lies under shows');
});

test('an image moved across has the same pixels at another place: none is made again for a pan', () => {
    const at = imagePixelsOf(IMAGE as never, 600, 256, axisScale(0, 2, false), UP, [-100, 0]);
    const moved = imagePixelsOf(IMAGE as never, 600, 256, axisScale(0.5, 2.5, false), UP, [-100, 0]);
    assert.deepEqual([moved.left, moved.width, moved.whole], [-150, 600, true], 'put 150 px further left');
    assert.deepEqual([...moved.data()], [...at.data()]);
    // Looked at more closely it has other pixels (twice as wide), and is still the whole image's.
    const closer = imagePixelsOf(IMAGE as never, 600, 256, axisScale(0.5, 1.5, false), UP, [-100, 0]);
    assert.deepEqual([closer.left, closer.width, closer.whole], [-300, 1200, true]);
});

test('an image far wider than the plot is made for the plot\'s part alone', () => {
    const far = axisScale(1, 1.0001, false);
    const pixels = imagePixelsOf(IMAGE as never, 600, 256, far, UP, [-100, 0]);
    assert.ok(2 / 0.0001 * 600 > WHOLE_IMAGE_PIXELS);
    assert.deepEqual([pixels.left, pixels.width, pixels.whole], [0, 600, false]);
    const data = pixels.data();
    // 1 s … 1.0001 s is inside the third column (1 … 1.5 s): its cell of the first row all across.
    const shade = shadeOf(-70, -100, 0);
    assert.deepEqual([pixelAt(pixels, data, 0, rowPx(60)), pixelAt(pixels, data, 599, rowPx(60))], [[shade, shade, shade, 255], [shade, shade, shade, 255]]);
});

test('viridis and signed values are the pixels colourOf says', () => {
    const rgba = (text: string): number[] => [...(text.match(/\d+/g) ?? []).map(Number), 255];
    for (const palette of ['viridis', 'signed'] as const) {
        const pixels = imagePixelsOf(IMAGE as never, 600, 256, axisScale(0, 2, false), UP, [-100, 0], palette);
        assert.deepEqual(pixelAt(pixels, pixels.data(), 200, rowPx(600)), rgba(colourOf(-40, -100, 0, palette)), palette);
    }
});

test('past its whole axis across (a recording\'s end) an image lane paints nothing: the colour of no value is the recording\'s alone', () => {
    const page = figurePage();
    // The recording is 0 … 2 s; the screen shows 1 … 3 s (a longer recording's row beside it sets the time on screen).
    const { figure } = shown(page, { x: [1, 3] });
    const image = figure.inspect().lanes[0].image;
    assert.ok(image);
    near(image.ground[0], FRAME.left, 'painted from the plot\'s left side');
    near(image.ground[1], FRAME.left + FRAME.width / 2, 'to the recording\'s end (2 s), not to the plot\'s right side');
    // The whole recording on screen: the whole plot.
    const whole = shown(figurePage()).figure.inspect().lanes[0].image;
    assert.deepEqual(whole?.ground, [FRAME.left, FRAME.left + FRAME.width]);
});

test('the screen\'s own ticks across are drawn down an image lane too, where the screen says they are (acrossGrid)', () => {
    const page = figurePage();
    const figure = page.figure(undefined, { ...SIZE, acrossAxis: false, acrossGrid: () => [0.25, 0.5, 1.5, -0.1] });
    figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    figure.show(SPEC, null);
    const [draw] = page.draws();
    draw.answer(picture(draw.message.payload as FigureDrawPayload, 'p1'));
    const lane = figure.inspect().lanes[0];
    assert.deepEqual(lane.xTicks, [], 'the Figure has no ticks across of its own');
    assert.deepEqual(lane.grid, [lane.frame.left + lane.frame.width * 0.25, lane.frame.left + lane.frame.width * 0.5].map(Math.round), 'a line at each tick inside the plot, none outside it');
    // With no such axis told, none.
    assert.equal(shown(figurePage()).figure.inspect().lanes[0].grid, undefined);
});

// ── The image kept under (FigureOptions.imageUnder) ──────────────────────────────────────────────────────────────────

test('the widest picture of the answer a lane keeps under stays under the picture drawn: of that answer alone, and never read', () => {
    const page = figurePage();
    let under: string | undefined = 'rec';
    const figure = page.figure(undefined, { ...SIZE, imageUnder: () => under });
    figure.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE.size.width, height: SIZE.size.height, right: SIZE.size.width, bottom: SIZE.size.height, x: 0, y: 0, toJSON: () => ({}) });
    figure.show(SPEC, null);
    const first = page.draws()[0];
    first.answer(picture(first.message.payload as FigureDrawPayload, 'p1'));
    // A zoom's own answer (another key), reaching 0.75 … 1.25 s, drawn on 0.5 … 1.5 s.
    const zoomSpec: FigureSpec = { lanes: [{ id: 'image', kind: 'image', lines: [{ id: 'sound', of: { key: 'zoom' } }] }], keys: [{ key: 'zoom', state: 'usable', version: 'v1' }] };
    figure.show(zoomSpec, { x: [0.5, 1.5] });
    const second = page.draws().at(-1);
    assert.ok(second);
    const reply = picture(second.message.payload as FigureDrawPayload, 'p2');
    (reply.lanes ?? [])[0].image = { ...IMAGE, key: 'zoom', columnEdges: [0.75, 0.875, 1, 1.125, 1.25] } as never;
    second.answer(reply);
    const image = figure.inspect().lanes[0].image;
    assert.ok(image);
    assert.equal(image.key, 'zoom', 'the picture drawn, and read, is the zoom\'s');
    near(image.edges.left, FRAME.left + 150, 'the zoom\'s own left edge');
    assert.ok(image.under, 'the whole file\'s picture is kept under it');
    near(image.under.left, FRAME.left - 300, 'the whole file\'s first edge (0 s) on the view 0.5 … 1.5 s');
    near(image.under.right, FRAME.left + 900, 'its last edge (2 s)');
    // The screen names another answer (other settings): the one kept is of nothing now.
    under = 'other';
    assert.equal(figure.inspect().lanes[0].image?.under, undefined);
});
