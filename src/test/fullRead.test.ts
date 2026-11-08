import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchedSource, localCells, localLine, STEP_AHEAD, type FullSource } from '../webview/runtime/fullRead';
import { declaresFullRead, stageHover, stageStep, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import { createStageReader } from '../webview/runtime/stageReader';
import { spectrumReadoutValues } from '../webview/runtime/spectrumRuntime';
import type { StageRead as FullReadRequest, StageView } from '../shared/protocol/backendProtocol';

/** A backend held in the test: each read is answered only when `flush` is called, as a reply arrives later. */
function heldBackend(xs: number[], values: number[]): { source: FullSource; flush(): void; asked: FullReadRequest[] } {
    const queue: Array<() => void> = [];
    const asked: FullReadRequest[] = [];
    const whole = localLine(xs, values);
    const source = fetchedSource((read, done) => {
        asked.push(read);
        queue.push(() => done(whole.line?.({ x0: Math.min(...read.x), x1: Math.max(...read.x), beyond: read.beyond ?? 1 }, () => undefined)));
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

test('a window too dense to send whole is read again while the pointer moves along it; at another level it is shown until that level\'s points come; zoomed in further it is asked anew (R7)', () => {
    const asked: FullReadRequest[] = [];
    // The backend's dense answer: each pixel column's lowest, highest and nearest the level asked (full_read.read_line).
    const source = fetchedSource((read, done) => {
        asked.push(read);
        const [low, high] = read.x, columns = read.columns ?? 1;
        const xs: number[] = [], values: number[] = [];
        for (let column = 0; column < columns; column++) {
            const a = Math.ceil(low + (high - low) * column / columns), b = Math.min(count, Math.ceil(low + (high - low) * (column + 1) / columns));
            let lo = -1, hi = -1, near = -1;
            for (let index = Math.max(0, a); index < b; index++) {
                if (lo < 0 || signal[index] < signal[lo]) lo = index;
                if (hi < 0 || signal[index] > signal[hi]) hi = index;
                if (near < 0 || Math.abs(signal[index] - (read.near ?? 0)) < Math.abs(signal[near] - (read.near ?? 0))) near = index;
            }
            for (const index of [...new Set([lo, hi, near])].filter(index => index >= 0).sort((p, q) => p - q)) { xs.push(index); values.push(signal[index]); }
        }
        done({ xs, values, start: null, end: null, complete: false });
    });
    // 50 samples a pixel: a hover window of 41 columns holds 2050 samples, padded to 8200, more than the backend sends whole.
    const plot = (perPixel: number): StagePlot => ({
        frame: { left: 0, top: 0, width: 400, height: 100 }, xAt: value => value / perPixel, xOf: x => x * perPixel,
        yAt: value => 50 - value * 40, levelOf: y => (50 - y) / 40, ratioStep: 1.12, diff: false,
        lines: [{ view: envelope(), color: 'blue', full: source }],
    });
    const lane = plot(50);
    assert.equal(stageHover(lane, 200, 50)?.pending, true);
    assert.equal(asked.length, 1);
    assert.ok(asked[0].columns && asked[0].columns > 41, 'the window is padded, its columns with it');
    for (const x of [200, 201, 203, 190, 215]) {
        const read = stageHover(lane, x, 50);
        assert.equal(read?.pending, undefined, `read at once at ${x}`);
        assert.equal(read?.full, true);
        assert.equal(signal[read?.at as number], read?.value, 'a real sample');
    }
    assert.equal(asked.length, 1, 'nothing more asked while the pointer moves along the window');
    // At another level: what came is read meanwhile (no blank readout), and that level's points are asked for.
    const meanwhile = stageHover(lane, 203, 20);
    assert.equal(meanwhile?.pending, undefined);
    assert.equal(asked.length, 2);
    assert.equal(asked[1].near, (50 - 20) / 40);
    assert.equal(stageHover(lane, 203, 20)?.full, true);
    assert.equal(asked.length, 2, 'that level\'s answer is kept');
    // Zoomed in fourfold: the kept columns are coarser than the screen's, so the window is asked for again.
    assert.equal(stageHover(plot(12.5), 800, 50)?.pending, true);
    assert.equal(asked.length, 3);
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
            rowLog: false,
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
    const layer = { view, color: '', full: localCells(xs, ys, raw) };
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
            rowLog: false,
        },
    };
    let column = 201;
    const row = 2;
    let read = stageHover(plot, plot.image?.placeOf(xs[column], ys[row]).x ?? 0, plot.image?.placeOf(xs[column], ys[row]).y ?? 0);
    assert.equal(read?.full, true);
    assert.equal(read?.value, raw[row][column], 'the cell itself');
    assert.notEqual(read?.value, drawn[row][Math.floor(column / 4)], 'not the mean drawn');
    assert.equal(read?.at, xs[column]);
    assert.equal(read?.row, ys[row]);
    for (const delta of [1, 1, 1, 1, 1, -1, -1, -1] as const) {
        read = read ? stageStep(plot, read, delta) ?? null : null;
        column += delta;
        assert.equal(read?.at, xs[column]);
        assert.equal(read?.value, raw[row][column]);
    }
});

test('every line and image a plot draws says where its full data is read; bars are whole (R7)', () => {
    const line: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [1, 2], values: [0, 1] };
    assert.equal(declaresFullRead({ view: line, color: '' }), false);
    assert.equal(declaresFullRead({ view: line, color: '', full: 'drawn' }), true);
    assert.equal(declaresFullRead({ view: line, color: '', full: localLine([1, 2], [0, 1]) }), true);
    assert.equal(declaresFullRead({ view: { ...line, kind: 'bar' }, color: '' }), true);
});

test('a read of values the backend let go is not kept as empty: their pictures are scanned again, and the read is asked again (R7)', () => {
    const posts: Array<{ requestId: string }> = [];
    const lost: string[][] = [];
    const reader = createStageReader('read-test', message => posts.push(message), keys => lost.push([...keys]));
    const view: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs: [0, 1], values: [0, 0], data: 'k1' };
    const source = reader.of(view) as FullSource;
    const query = { x0: 0.4, x1: 0.6, beyond: 1 };
    assert.equal(source.line?.(query, () => undefined), undefined);
    assert.equal(posts.length, 1);
    reader.handle({ type: 'compare-combine-result', requestId: posts[0].requestId, result: { ok: false, missing: ['k1'] } } as never);
    assert.deepEqual(lost, [['k1']]);
    // Read again once the picture is back: asked anew, not answered with nothing.
    assert.equal(source.line?.(query, () => undefined), undefined);
    assert.equal(posts.length, 2);
    reader.handle({ type: 'compare-combine-result', requestId: posts[1].requestId, result: { ok: true, points: { xs: [0, 1], values: [1, 2], start: null, end: null, complete: true } } } as never);
    assert.deepEqual(source.line?.(query, () => undefined)?.values, [1, 2]);
});

test('a cursor spectrum read at its real bins writes its frequency to the digits those bins need, not the drawn points\' (R7)', () => {
    const slice = { values: [0, 0], frequencyBins: 2, maxFrequencyHz: 4000, minDb: -100, maxDb: 0, frequenciesHz: [0, 1000, 2000] };
    assert.equal(spectrumReadoutValues(slice, 1000, -10)[0], spectrumReadoutValues(slice, 1000.48828125, -10)[0], 'the drawn points\' spacing cannot tell them apart');
    assert.notEqual(spectrumReadoutValues(slice, 1000, -10, 0.48828125)[0], spectrumReadoutValues(slice, 1000.48828125, -10, 0.48828125)[0]);
});
