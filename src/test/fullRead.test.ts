import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchedSource, localCells, localLine, STEP_AHEAD, type FullSource } from '../webview/runtime/fullRead';
import { declaresFullRead, stageHover, stageStep, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import type { StagePoints, StageRead as FullReadRequest, StageView } from '../shared/protocol/backendProtocol';

/** A backend held in the test: each read is answered only when `flush` is called, as a reply arrives later. */
function heldBackend(xs: number[], values: number[]): { source: FullSource; flush(): void; asked: FullReadRequest[] } {
    const queue: Array<() => void> = [];
    const asked: FullReadRequest[] = [];
    const whole = localLine(xs, values);
    const source = fetchedSource((read, done) => {
        asked.push(read);
        queue.push(() => done(whole.line?.({ x0: Math.min(...read.x), x1: Math.max(...read.x), beyond: read.beyond ?? 1 }, () => undefined) as StagePoints));
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
