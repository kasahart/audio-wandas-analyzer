import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNotDrawn, nearestOf } from './fullNotDrawn';
import { FAILED_RETRY_MS as FAILED_HOLD_MS } from '../webview/runtime/answerStore';
import { fetchedSource, mappedSource, NO_FULL_DATA, STEP_AHEAD, type FullSource, type LineQuery, fullSource, cannotRead, readsFullData, sourceWith } from '../webview/runtime/fullRead';
import { wholeValue, testLine, testCells } from './helpers/whole';
import { wholeBars } from '../webview/runtime/wholeAnswers';
import { declaresFullRead, stageHover, stageStep, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import { HOVER_PICK_RADIUS_PX } from '../webview/runtime/plotHover';
import { createStageReader } from '../webview/runtime/stageReader';
import { spectrumReadoutValues } from '../webview/runtime/spectrumRuntime';
import type { StageRead as FullReadRequest, StageView } from '../shared/protocol/backendProtocol';

/** A backend held in the test: each read is answered only when `flush` is called, as a reply arrives later. */
function heldBackend(xs: number[], values: number[]): { source: FullSource; flush(): void; asked: FullReadRequest[] } {
    const queue: Array<() => void> = [];
    const asked: FullReadRequest[] = [];
    const whole = testLine(xs, values);
    const source = fetchedSource((read, done) => {
        asked.push(read);
        queue.push(() => done(whole.line({ x0: Math.min(...read.x), x1: Math.max(...read.x), beyond: read.beyond ?? 1 }, () => undefined)));
    });
    return { source, asked, flush: () => { while (queue.length) queue.shift()?.(); } };
}

/** Steps `delta` from `read`, answering any fetch the step waits for. */
function step(plot: StagePlot, read: StageRead, delta: -1 | 1, flush: () => void): StageRead | null {
    let next = stageStep(plot, read, delta);
    if (next === undefined) { flush(); next = stageStep(plot, read, delta); }
    assert.notEqual(next, undefined, 'answered once its points are in');
    return next ?? null;
}

const count = 20000;
const samples = Array.from({ length: count }, (_, index) => index);
const signal = samples.map(index => 0.8 * Math.sin(index * 1.37) * Math.cos(index * 0.013));

/** The signal as a lane draws it: each 100 samples' lowest and highest point (R2). */
function envelope(): StageView {
    const min: number[] = [], max: number[] = [], minT: number[] = [], maxT: number[] = [];
    for (let start = 0; start < count; start += 100) {
        let low = start, high = start;
        for (let index = start; index < start + 100; index++) {
            if (signal[index] < signal[low]) low = index;
            if (signal[index] > signal[high]) high = index;
        }
        min.push(signal[low]); max.push(signal[high]); minT.push(low); maxT.push(high);
    }
    return { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'amplitude', xs: [], values: [], waveform: { min, max, minT, maxT, unit: 'Pa', ref: 1 } } as unknown as StageView;
}

test('a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)', () => {
    const backend = heldBackend(samples, signal);
    const view = envelope();
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: value => value / 100, xOf: x => x * 100,
        yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false,
        lines: [{ view, color: 'blue', full: backend.source }],
    };
    const drawn = new Set([...(view.waveform?.minT ?? []), ...(view.waveform?.maxT ?? [])]);
    let at = 10003;
    while (drawn.has(at)) at++;
    const x = plot.xAt(at), y = plot.yAt(signal[at]);
    // Until the samples around the pointer are in: the marks and no number.
    const first = stageHover(plot, x, y);
    assert.equal(first?.pending, true);
    assert.equal(first?.text, '');
    backend.flush();
    let read = stageHover(plot, x, y);
    assert.equal(read?.full, true);
    assert.equal(read?.at, at, 'the sample under the pointer, thinned out of the line drawn');
    assert.equal(read?.value, signal[at]);
    // ← / → visit every sample in turn, though a hundred share each pixel.
    const before = backend.asked.length;
    for (const delta of [1, -1] as const) {
        for (let index = 1; index <= 60; index++) {
            read = read ? step(plot, read, delta, () => backend.flush()) : null;
            at += delta;
            assert.equal(read?.at, at, `step ${index} (${delta})`);
            assert.equal(read?.value, signal[at]);
        }
    }
    // The next steps come with the read: a request for each STEP_AHEAD samples, not one per key.
    assert.ok(backend.asked.length - before <= Math.ceil(120 / STEP_AHEAD) + 1, `${backend.asked.length - before} requests`);
});

test('a level asked for while a read is on its way is never dropped for a newer read: the pointer\'s latest goes next, then the latest level (R6, R7)', () => {
    const backend = heldBackend(samples, signal);
    const none = (): void => undefined;
    assert.equal(backend.source.line({ x0: 10, x1: 20, beyond: 1 }, none), undefined);
    // While it is on its way: the level of one window, then of the next (zoomed on), then the pointer moving on twice.
    assert.equal(backend.source.level({ x0: 0, x1: 5000, square: true }, none), undefined);
    assert.equal(backend.source.level({ x0: 5000, x1: 9000, square: true }, none), undefined);
    backend.source.line({ x0: 30, x1: 40, beyond: 1 }, none);
    backend.source.line({ x0: 50, x1: 60, beyond: 1 }, none);
    backend.flush();
    const sent = backend.asked.map(read => (read.level ? `level ${read.x.join('-')}` : `read ${read.x.map(Math.round).join('-')}`));
    assert.equal(sent.length, 3, sent.join(', '));
    assert.equal(sent[1], 'read 35-75', 'the pointer\'s latest read goes next; the one it moved on from is not sent');
    assert.deepEqual(sent.slice(2), ['level 5000-9000'], 'then the level of the window on screen now, not one zoomed past');
});

test('a window read is asked for once and kept: the pointer moving inside it asks for nothing more (R7)', () => {
    const backend = heldBackend(samples, signal);
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: value => value / 100, xOf: x => x * 100,
        yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false,
        lines: [{ view: envelope(), color: 'blue', full: backend.source }],
    };
    stageHover(plot, 100, 50);
    // Asked again while on its way: the same request is not sent twice.
    stageHover(plot, 100, 50);
    assert.equal(backend.asked.length, 1);
    backend.flush();
    assert.equal(stageHover(plot, 100, 50)?.full, true);
    assert.equal(backend.asked.length, 1);
});

test('a window too dense to send whole is read where the pointer is: the point nearest it on screen, by its true distance, as brute force finds it; elsewhere, or at another level, its readout is empty until that place\'s points come; zoomed in further it is asked anew (R7)', () => {
    const asked: FullReadRequest[] = [];
    const count = 400 * 50;
    const signal = Array.from({ length: count }, (_, index) => Math.sin(index * 0.37) * Math.cos(index * 0.011) * 0.9);
    const envelope = (): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, count - 1], values: [0, 0] });
    // The backend's dense answer (full_read.read_line): each pixel column's lowest, highest and nearest the level
    // asked, and the one point nearest the pointer on screen at the scale asked.
    const source = fetchedSource((read, done) => {
        asked.push(read);
        const [low, high] = read.x, columns = read.columns ?? 1;
        const keep = new Set<number>();
        for (let column = 0; column < columns; column++) {
            const a = Math.ceil(low + (high - low) * column / columns), b = Math.min(count, Math.ceil(low + (high - low) * (column + 1) / columns));
            let lo = -1, hi = -1, near = -1;
            for (let index = Math.max(0, a); index < b; index++) {
                if (lo < 0 || signal[index] < signal[lo]) lo = index;
                if (hi < 0 || signal[index] > signal[hi]) hi = index;
                if (near < 0 || Math.abs(signal[index] - (read.near ?? 0)) < Math.abs(signal[near] - (read.near ?? 0))) near = index;
            }
            for (const index of [lo, hi, near]) if (index >= 0) keep.add(index);
        }
        if (read.at !== undefined && read.pixels) {
            let best = -1;
            const away = (index: number): number => Math.hypot((index - (read.at ?? 0)) * (read.pixels?.[0] ?? 0), (signal[index] - (read.near ?? 0)) * (read.pixels?.[1] ?? 0));
            for (let index = Math.max(0, Math.ceil(low)); index <= Math.min(count - 1, Math.floor(high)); index++) if (best < 0 || away(index) < away(best)) best = index;
            if (best >= 0) keep.add(best);
        }
        // And the sample under the pointer (full_read._nearest_along), named by its place among those sent.
        const under = read.at !== undefined ? Math.max(0, Math.min(count - 1, Math.round(read.at))) : -1;
        if (under >= 0) keep.add(under);
        const xs = [...keep].sort((p, q) => p - q);
        done({ xs, values: xs.map(index => signal[index]), start: null, end: null, complete: false, ...(under >= 0 ? { under: xs.indexOf(under) } : {}) });
    });
    // 50 samples a pixel: a hover window of 41 columns holds 2050 samples, padded to 8200, more than the backend sends whole.
    const plot = (perPixel: number): StagePlot => ({
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: value => value / perPixel, xOf: x => x * perPixel,
        yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false,
        lines: [{ view: envelope(), color: 'blue', full: source }],
    });
    // Brute force: of every sample within the pick radius on screen, the nearest the pointer.
    const nearest = (perPixel: number, x: number, y: number): number | null => {
        let best: number | null = null, bestAway = Infinity;
        for (let index = 0; index < count; index++) {
            const away = Math.hypot(index / perPixel - x, 50 - signal[index] * 40 - y);
            if (away <= HOVER_PICK_RADIUS_PX && away < bestAway) { best = index; bestAway = away; }
        }
        return best;
    };
    const lane = plot(50);
    assert.equal(stageHover(lane, 200, 50)?.pending, true);
    assert.equal(asked.length, 1);
    assert.ok(asked[0].columns && asked[0].columns > 41, 'the window is padded, its columns with it');
    assert.equal(asked[0].at, 200 * 50);
    assert.ok(Math.abs((asked[0].pixels?.[0] ?? 0) - 1 / 50) < 1e-9 && asked[0].pixels?.[1] === 40, 'the screen\'s scale: pixels per sample and per unit of value');
    for (const [x, y] of [[200, 50], [201, 50], [203.5, 31], [190, 70], [215, 22]] as const) {
        const first = stageHover(lane, x, y);
        // Each new place waits for its own nearest point: an empty readout, never the last place's point.
        if (first?.pending) assert.equal(first.text, '');
        const read = first?.pending ? stageHover(lane, x, y) : first;
        assert.equal(read?.full, true);
        assert.equal(read?.at, nearest(50, x, y), `the true nearest sample at (${x}, ${y})`);
        assertNotDrawn(read?.at, nearestOf(envelope().xs ?? [], x * 50), 'not a point of the line drawn');
        assert.equal(signal[read?.at], read?.value, 'a real sample');
    }
    // Beyond the pick radius of every sample (the pointer far above the line): the sample under the pointer, not
    // the nearest along of the few points sent for its columns (each column's lowest, highest, nearest in height).
    for (const x of [100, 100.3, 257.7]) {
        const y = -60;
        assert.equal(nearest(50, x, y), null, 'no sample within the radius');
        const first = stageHover(lane, x, y);
        const read = first?.pending ? stageHover(lane, x, y) : first;
        assert.equal(read?.at, Math.round(x * 50), `the sample under the pointer at ${x}`);
        assert.equal(read?.value, signal[Math.round(x * 50)]);
    }
    const before = asked.length;
    assert.equal(stageHover(lane, 215, 22)?.full, true);
    assert.equal(asked.length, before, 'the same place is read from what came');
    // Zoomed in fourfold: the kept columns are coarser than the screen's, so the window is asked for again.
    assert.equal(stageHover(plot(12.5), 800, 50)?.pending, true);
    assert.equal(asked.length, before + 1);
});

test('a spectrogram\'s hover asks the backend once for a block around the pointer: moving across frames and bins reads what came (R7)', () => {
    const columns = 400, ys = Array.from({ length: 64 }, (_, row) => 100 + row * 10);
    const xs = Array.from({ length: columns }, (_, index) => index * 0.01);
    const raw = ys.map((_, row) => xs.map((_, column) => -60 + 30 * Math.sin(column * 0.9 + row)));
    const asked: FullReadRequest[] = [];
    const nearest = (axis: number[], value: number): number => axis.reduce((best, at, index) => (Math.abs(at - value) < Math.abs(axis[best] - value) ? index : best), 0);
    // full_read.read_cells: the cell nearest the place, `beyond` columns and `rows` rows (two unless asked) either side.
    const source = fetchedSource((read, done) => {
        asked.push(read);
        const column = nearest(xs, read.x[0]), row = nearest(ys, read.y?.[0] ?? 0);
        const beyond = read.beyond ?? 1, either = read.rows ?? 2;
        const c0 = Math.max(0, column - beyond), c1 = Math.min(xs.length, column + beyond + 1);
        const r0 = Math.max(0, row - either), r1 = Math.min(ys.length, row + either + 1);
        done({ xs: xs.slice(c0, c1), ys: ys.slice(r0, r1), matrix: raw.slice(r0, r1).map(line => line.slice(c0, c1)), start: c0 > 0 ? xs[c0] : null, end: c1 < xs.length ? xs[c1 - 1] : null, complete: true });
    });
    const view: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', unit: 'dB', xs, ys, matrix: raw };
    const width = 400, height = 640;
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width, height }, xAt: value => value / (columns * 0.01) * width, yAt: () => 0, ratioStep: 1.12, diff: false, lines: [],
        image: {
            layer: { view, color: '', full: source },
            cellAt: () => ({ column: -1, row: -1 }),
            valueAt: (x, y) => ({ x: x / width * columns * 0.01, y: 100 + (1 - y / height) * 630 }),
            placeOf: (x, y) => ({ x: x / (columns * 0.01) * width, y: (1 - (y - 100) / 630) * height }),
            rowLog: false, columnLog: false,
        },
    };
    const at = (column: number, row: number): [number, number] => { const place = plot.image?.placeOf(xs[column], ys[row]); return [place?.x ?? 0, place?.y ?? 0]; };
    assert.equal(stageHover(plot, ...at(200, 30))?.pending, true);
    for (const [column, row] of [[200, 30], [201, 30], [202, 31], [210, 28], [190, 40], [229, 20]]) {
        const read = stageHover(plot, ...at(column, row));
        assert.equal(read?.pending, undefined, `read at once at frame ${column}, bin ${row}`);
        assert.equal(read?.value, raw[row][column]);
    }
    assert.equal(asked.length, 1, 'one request for the block');
    assert.equal(asked[0].rows, 16);
});

test('a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)', () => {
    const columns = 400, ys = [100, 200, 300, 400];
    const xs = Array.from({ length: columns }, (_, index) => index * 0.01);
    const raw = ys.map((_, row) => xs.map((_, column) => -60 + 30 * Math.sin(column * 0.9 + row)));
    // Drawn four frames to a cell: their mean.
    const drawnXs = Array.from({ length: columns / 4 }, (_, cell) => (cell * 4 + 1.5) * 0.01);
    const drawn = raw.map(line => drawnXs.map((_, cell) => line.slice(cell * 4, cell * 4 + 4).reduce((sum, value) => sum + value, 0) / 4));
    const view: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', unit: 'dB', xs: drawnXs, ys, matrix: drawn };
    const layer = { view, color: '', full: testCells(xs, ys, raw) };
    const width = 200, height = 100;
    const timeAt = (x: number): number => x / width * columns * 0.01;
    const rowAt = (y: number): number => 100 + (1 - y / height) * 300;
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width, height }, xAt: value => value / (columns * 0.01) * width, yAt: () => 0, ratioStep: 1.12, diff: false, lines: [],
        image: {
            layer,
            cellAt: (x, y) => ({ column: Math.min(drawnXs.length - 1, Math.floor(x / width * drawnXs.length)), row: Math.round((rowAt(y) - 100) / 100) }),
            valueAt: (x, y) => ({ x: timeAt(x), y: rowAt(y) }),
            placeOf: (x, y) => ({ x: x / (columns * 0.01) * width, y: (1 - (y - 100) / 300) * height }),
            rowLog: false, columnLog: false,
        },
    };
    let column = 201;
    const row = 2;
    let read = stageHover(plot, plot.image?.placeOf(xs[column], ys[row]).x ?? 0, plot.image?.placeOf(xs[column], ys[row]).y ?? 0);
    assert.equal(read?.full, true);
    assert.equal(read?.value, raw[row][column], 'the cell itself');
    assertNotDrawn(read?.value, drawn[row][Math.floor(column / 4)], 'not the mean drawn');
    assert.equal(read?.at, xs[column]);
    assert.equal(read?.row, ys[row]);
    for (const delta of [1, 1, 1, 1, 1, -1, -1, -1] as const) {
        read = read ? stageStep(plot, read, delta) ?? null : null;
        column += delta;
        assert.equal(read?.at, xs[column]);
        assert.equal(read?.value, raw[row][column]);
    }
});

test('every layer a plot draws is given its full data, held or fetched: one given none is marked and reads no number, bars too (R7)', () => {
    const line: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [1, 2], values: [0, 1] };
    const bars: StageView = { ...line, kind: 'bar' };
    assert.equal(declaresFullRead({ view: line, color: '', full: NO_FULL_DATA }), false);
    assert.equal(declaresFullRead({ view: bars, color: '', full: NO_FULL_DATA }), false, 'bars are not taken as whole for being bars');
    assert.equal(declaresFullRead({ view: line, color: '', full: testLine([1, 2], [0, 1]) }), true);
    assert.equal(declaresFullRead({ view: bars, color: '', full: wholeBars(bars) ?? NO_FULL_DATA }), true);
    assert.equal(wholeBars(line), undefined, 'a line is never read from what it draws');
    // Given none, the pointer reads no number off it, not the point drawn under it.
    const plot = (full: FullSource): StagePlot => ({ frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: x => (x - 1) * 100, yAt: v => 100 - v * 100, xOf: x => 1 + x / 100, ratioStep: 1.12, lines: [{ view: bars, color: '', full }], diff: false });
    assert.equal(stageHover(plot(NO_FULL_DATA), 0, 100), null);
    assert.equal(stageHover(plot(wholeBars(bars) ?? NO_FULL_DATA), 0, 100)?.value, 0);
    // A line thinned to be drawn (its 1.5 peak left out) is never taken whole: its full data is read, not its points.
    const thinned: StageView = { ...line, values: [0, 0] };
    const over = (full: FullSource): number | undefined => stageHover({ ...plot(full), lines: [{ view: thinned, color: '', full }] }, 50, 0)?.value;
    const full = wholeBars(thinned) ?? testLine([1, 1.5, 2], [0, 1, 0]);
    assert.equal(over(full), 1);
    assert.notEqual(over(wholeBars(thinned) ?? full), over(testLine([1, 2], [0, 0])), 'not the value of the points drawn');
});

test('a picture\'s full data is held or fetched, never its drawn points: a band table without a key reads its every band at once, a line without one has none (R7)', () => {
    const reader = createStageReader('kinds-test', () => undefined);
    const keyed = reader.of({ frame: 'SpectralFrame', kind: 'line', xs: [0, 1], values: [0, 0], data: 'k1' });
    assert.equal(keyed?.held, 'fetched');
    const bands: StageView = { frame: 'NOctFrame', kind: 'bar', x: 'band', xs: [100, 125, 160], values: [-40, -12, -33] };
    const whole = reader.of(bands);
    assert.equal(whole?.held, 'inline');
    assert.deepEqual(whole?.line({ x0: 125, x1: 125, beyond: 1 }, () => undefined)?.values, [-40, -12, -33]);
    assert.equal(reader.of({ frame: 'SpectralFrame', kind: 'line', xs: [0, 1], values: [0, 0] }), NO_FULL_DATA, 'a thinned line is never read as if whole: it has no full data, by name');
});

test('the only source that reads nothing is NO_FULL_DATA: a source is made with a read, and one whose every read is "cannot" is refused', () => {
    assert.equal(readsFullData(NO_FULL_DATA), false);
    assert.equal(NO_FULL_DATA.line, cannotRead);
    assert.equal(NO_FULL_DATA.cells, cannotRead);
    assert.equal(NO_FULL_DATA.level, cannotRead);
    assert.equal(NO_FULL_DATA.event(0), NO_FULL_DATA);
    const cells = fullSource('inline', { cells: () => null });
    assert.equal(readsFullData(cells), true);
    assert.equal(cells.line, cannotRead, 'a read not given cannot be read');
    // A read passed on from another source can be "cannot": the source it would make reads nothing, and is refused.
    assert.throws(() => fullSource('fetched', { line: cells.line }), /would read nothing\. Pass NO_FULL_DATA/u);
    assert.throws(() => sourceWith(cells, { cells: cannotRead }), /would read nothing/u);
    assert.equal(sourceWith(cells, { line: () => null }).cells, cells.cells, 'the reads not replaced are kept');
    // No full data on one axis is no full data on another: never a new source that reads nothing.
    assert.equal(mappedSource(NO_FULL_DATA, x => x, x => x), NO_FULL_DATA);
});

test('a read of values the backend let go is not kept as empty: their pictures are scanned again, and the read is asked again (R7)', () => {
    const posts: Array<{ requestId: string }> = [];
    const lost: string[][] = [];
    const reader = createStageReader('read-test', message => posts.push(message), keys => lost.push([...keys]));
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0, 1], values: [0, 0], data: 'k1' };
    const source = reader.of(view);
    const query = { x0: 0.4, x1: 0.6, beyond: 1 };
    assert.equal(source.line(query, () => undefined), undefined);
    assert.equal(posts.length, 1);
    reader.handle({ type: 'compare-combine-result', requestId: posts[0].requestId, result: { ok: false, missing: ['k1'] } } as never);
    assert.deepEqual(lost, [['k1']]);
    // Read again once the picture is back: asked anew, not answered with nothing.
    assert.equal(source.line(query, () => undefined), undefined);
    assert.equal(posts.length, 2);
    reader.handle({ type: 'compare-combine-result', requestId: posts[1].requestId, result: { ok: true, points: { xs: [0, 1], values: [1, 2], start: null, end: null, complete: true } } } as never);
    assert.deepEqual(source.line(query, () => undefined)?.values, [1, 2]);
});

test('a cursor spectrum read at its real bins writes its frequency to the digits those bins need, not the drawn points\' (R7)', () => {
    const slice = { values: [0, 0], frequencyBins: 2, maxFrequencyHz: 4000, minDb: -100, maxDb: 0, frequenciesHz: [0, 1000, 2000] };
    assert.equal(spectrumReadoutValues(slice, 1000, -10)[0], spectrumReadoutValues(slice, 1000.48828125, -10)[0], 'the drawn points\' spacing cannot tell them apart');
    const atBins = spectrumReadoutValues(slice, 1000.48828125, -10, 0.48828125)[0];
    assert.notEqual(spectrumReadoutValues(slice, 1000, -10, 0.48828125)[0], atBins);
    assert.equal(atBins, '1.0005 kHz', 'the bin\'s own frequency, to the digits its spacing needs');
    assertNotDrawn(atBins, spectrumReadoutValues(slice, 1000.48828125, -10)[0], 'not the digits the drawn points\' spacing gives');
});

test('an arrow key crosses silent points past one fetched window to the next point with a value (R7)', () => {
    // 1000 bins, readable at 0 and 600, silent (−300 dB) between: more than one step's window apart.
    const xs = Array.from({ length: 1000 }, (_, bin) => bin);
    const values = xs.map(bin => (bin === 0 || bin === 600 ? -20 : -300));
    const source = testLine(xs, values);
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', unit: 'dB', xs: [0, 999], values: [-20, -300] };
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 1000, height: 100 }, xAt: value => value, xOf: x => x, yAt: value => -value, levelOf: y => -y,
        ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', full: source }],
    };
    const first = stageHover(plot, 0, 20);
    assert.equal(first?.at, 0);
    const next = first ? stageStep(plot, first, 1) : null;
    assert.equal(next?.at, 600);
    assert.equal(next ? stageStep(plot, next, 1) : 'none', null, 'nothing past the last value');
});

test('an arrow key crosses a silence of any length in one read the backend answers, and the keys after it ask for nothing more: never a request per window, never one asked again (R7)', () => {
    // Two million samples, readable at 10, 1_999_000 and the 300 after it, silent (−300 dB) between: thousands of
    // step windows apart. The backend answers a seek as full_read._seek_line does (the held line's own seek).
    const count = 2_000_000;
    const xs = Array.from({ length: count }, (_, index) => index);
    const values = xs.map(index => (index === 10 || index >= 1_999_000 && index < 1_999_300 ? -20 : -300));
    const whole = testLine(xs, values);
    const asked: FullReadRequest[] = [];
    const source = fetchedSource((read, done) => {
        asked.push(read);
        done(whole.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1, ...(read.seek ? { seek: read.seek } : {}) }, () => undefined));
    });
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', unit: 'dB', xs: [0, count - 1], values: [-20, -20] };
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 1000, height: 100 }, xAt: value => value / 2000, xOf: x => x * 2000, yAt: value => -value, levelOf: y => -y,
        ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', full: source }],
    };
    const read = (x: number, y: number) => { const first = stageHover(plot, x, y); return first?.pending ? stageHover(plot, x, y) : first; };
    const start = read(0.005, 20);
    assert.equal(start?.at, 10);
    const before = asked.length;
    // → crosses the 1 998 989 silent samples in one request, and reads the first sample past them.
    const step = (from: StageRead, delta: -1 | 1): StageRead | null => { const got = stageStep(plot, from, delta); return got === undefined ? stageStep(plot, from, delta) ?? null : got; };
    const past = start ? step(start, 1) : null;
    assert.equal(past?.at, 1_999_000);
    assert.equal(asked.length, before + 1, 'one read for the whole silence');
    assert.equal(asked.at(-1)?.seek, 1);
    // The next 200 keys read the samples that came with it: no request.
    let here: StageRead | null = past;
    for (let key = 0; key < 200 && here; key++) here = step(here, 1);
    assert.equal(here?.at, 1_999_200);
    assert.equal(asked.length, before + 1, 'the keys after it need none');
    // ← back across the silence: one read again, to the sample before it.
    const back = past ? step(past, -1) : null;
    assert.equal(back?.at, 10);
    assert.equal(asked.length, before + 2);
    // Past the last value there is nothing: one read says so, and it is not asked again.
    const last = { ...(here), at: wholeValue(1_999_299) };
    assert.equal(step(last, 1), null);
    const asking = asked.length;
    assert.equal(step(last, 1), null);
    assert.equal(asked.length, asking, 'the end, once known, is not asked again');
    // The empty answer at the end answers that seek only: the line is still read where it has values, nearest the
    // pointer, never nothing (A41, R7).
    const after = read(0.005, 20);
    assert.equal(after?.at, 10, 'read again at its start after the end was found');
    assert.equal(after?.full, true);
    const again = read(999.5, 20);
    assert.ok(again && again.at !== undefined && again.at >= 1_999_000, `read near its end: ${again?.at}`);
});

test('a source read on another axis gets the pointer\'s place and the screen\'s scale on its own axis, so a dense window there is read nearest the pointer (R7)', () => {
    // A file's 0..1 drawn over 10..30 s of the lanes' axis: 20 s to the file's whole.
    const asked: LineQuery[] = [];
    const file: FullSource = fullSource('fetched', { line: query => { asked.push(query); return { xs: [], values: [], complete: true, start: null, end: null }; } });
    const toNorm = (seconds: number): number => (seconds - 10) / 20, toSec = (norm: number): number => 10 + norm * 20;
    mappedSource(file, toNorm, toSec).line({ x0: 12, x1: 18, at: 15, pixels: [40, 3], beyond: 1 }, () => undefined);
    assert.equal(asked.length, 1);
    const [query] = asked;
    assert.ok(Math.abs(query.x0 - 0.1) < 1e-12 && Math.abs(query.x1 - 0.4) < 1e-12);
    assert.ok(Math.abs((query.at ?? NaN) - 0.25) < 1e-12, 'the pointer at 15 s is at a quarter of the file');
    // 40 px a second is 800 px per file's whole; the value axis is not mapped.
    assert.ok(Math.abs((query.pixels?.[0] ?? NaN) - 800) < 1e-9);
    assert.equal(query.pixels?.[1], 3);
});

test('a failed full read is held a while, then asked again: a passing failure does not stay for good (C2)', () => {
    let clock = 0, fail = true;
    const asked: FullReadRequest[] = [];
    const source = fetchedSource((read, done) => {
        asked.push(read);
        done(fail ? null : { xs: [1, 2, 3], values: [10, 20, 30], start: 1, end: 3, complete: true });
    }, {}, () => clock);
    const query: LineQuery = { x0: 2, x1: 2, beyond: 1 };
    assert.equal(source.line(query, () => undefined), undefined, 'asked: pending');
    assert.equal(source.line(query, () => undefined), null, 'the backend failed: nothing to read');
    clock = FAILED_HOLD_MS - 1;
    assert.equal(source.line(query, () => undefined), null, 'held: not asked again at once');
    assert.equal(asked.length, 1);
    fail = false;
    clock = FAILED_HOLD_MS;
    assert.equal(source.line(query, () => undefined), undefined, 'the hold has passed: asked again');
    assert.equal(asked.length, 2, 'asked again once the hold has passed');
    assert.deepEqual(source.line(query, () => undefined)?.values, [10, 20, 30]);
});

test('a seek on plain values (a signal, a metric over time) reads −250 and below as values, one point at a time, and → and ← agree; a level crosses its floor in one (R7)', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const values = [1, 2, -300, -300, -300, -300, 10, 11];
    const source = testLine(xs, values);
    const seek = (x: number, seek: -1 | 1, plain: boolean): number => {
        const got = source.line({ x0: x, x1: x, beyond: 0, seek, ...(plain ? { plain: true } : {}) }, () => undefined);
        const past = (got?.xs ?? []).filter((at, index) => (seek > 0 ? at > x : at < x) && (plain || (got?.values?.[index] ?? -Infinity) > -250));
        return seek > 0 ? Math.min(...past) : Math.max(...past);
    };
    assert.deepEqual([1, 2, 3, 4, 5].map(x => seek(x, 1, true)), [2, 3, 4, 5, 6]);
    assert.deepEqual([6, 5, 4, 3, 2].map(x => seek(x, -1, true)), [5, 4, 3, 2, 1]);
    assert.equal(seek(1, 1, false), 6);
    assert.equal(seek(6, -1, false), 1);
    // Through the plot: a waveform's samples are plain, its steps read −300 as a sample.
    const view: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'value', unit: 'Pa', xs: [0, 7], values: [1, 11] };
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 700, height: 100 }, xAt: value => value * 100, xOf: x => x / 100, yAt: value => 50 - value / 10, levelOf: y => (50 - y) * 10,
        ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', full: source }],
    };
    let read = stageHover(plot, 100, 50 - 0.2);
    assert.equal(read?.at, 1);
    const seen: number[] = [];
    for (let key = 0; key < 5 && read; key++) { read = stageStep(plot, read, 1) ?? null; if (read?.at !== undefined) seen.push(read.at); }
    assert.deepEqual(seen, [2, 3, 4, 5, 6]);
});

test('a read the backend failed is no line read: the readout reads nothing, never the line beside it, and is read again once the failure\'s pause is over (R7, C2)', async () => {
    let clock = 0;
    const source = fetchedSource((_read, done) => { done(null); }, {}, () => clock);
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', unit: 'dB', xs: [0, 9], values: [-20, -20] };
    const beside = testLine([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [-21, -21, -21, -21, -21, -21, -21, -21, -21, -21]);
    const plot: StagePlot = {
        frame: { left: 0, top: 0, width: 900, height: 100 }, xAt: value => value * 100, xOf: x => x / 100, yAt: value => -value, levelOf: y => -y,
        ratioStep: 1.12, diff: false, lines: [{ view, color: 'blue', label: 'base', full: source }, { view, color: 'red', label: 'other', full: beside }],
    };
    let woken = 0;
    assert.equal(stageHover(plot, 300, 20)?.pending, true, 'asked');
    // Read again near the end of the failure's pause: the wake comes when it is over.
    clock = FAILED_HOLD_MS - 10;
    const read = stageHover(plot, 300, 20, () => { woken++; });
    assert.equal(read?.failed, true, 'failed: no number');
    assert.equal(read?.values, '');
    assert.notEqual(read?.layer.label, 'other', 'never the line beside it');
    assert.equal(woken, 0, 'not before the pause is over');
    clock = FAILED_HOLD_MS + 1;
    await new Promise(resolve => { setTimeout(resolve, 60); });
    assert.equal(woken, 1, 'told once its pause is over, to read again');
});
