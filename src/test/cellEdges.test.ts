import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { StageView } from '../shared/protocol/backendProtocol';
import { cellEdgeValues, cellIndex } from '../webview/runtime/fullRead';
import { barEdges, paintOverlay, stageHeadline, stageHover, stageRange } from '../webview/runtime/stagePanes';
import { N, R } from './helpers/figure';
import { held } from './helpers/heldSource';

const W = 400, H = 200;

/** A canvas whose context records each bar stroke (moveTo, lineTo) and draws nothing else. */
function canvasFor(): { canvas: HTMLCanvasElement; strokes: Array<[string, number, number]> } {
    const { window } = new JSDOM('<!doctype html><body></body>');
    const strokes: Array<[string, number, number]> = [];
    const context = new Proxy({}, {
        get: (_target, key) => key === 'font' ? '10px sans-serif' : key === 'textAlign' ? 'left' : key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'createImageData' || key === 'getImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key === 'moveTo' || key === 'lineTo' ? (x: number, y: number) => { strokes.push([key, x, y]); }
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: () => true,
    });
    (window as unknown as { HTMLCanvasElement: typeof HTMLCanvasElement }).HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    const canvas = window.document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W });
    Object.defineProperty(canvas, 'clientHeight', { value: H });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
    window.document.body.append(canvas);
    return { canvas, strokes };
}

// Bands 100, 125 and 160 Hz: a log axis's cells meet at √(100·125) = 111.80 Hz and √(125·160) = 141.42 Hz.
const BANDS = [100, 125, 160];
const EDGE = Math.sqrt(100 * 125), EDGE2 = Math.sqrt(125 * 160);

test('a log axis\'s cells meet at the geometric mean of their points, a linear one\'s at the midpoint: one rule for every chart (cellEdges)', () => {
    const log = cellEdgeValues(BANDS, true);
    assert.ok(Math.abs(log[1] - EDGE) < 1e-9 && Math.abs(log[2] - EDGE2) < 1e-9, String(log));
    assert.deepEqual(cellEdgeValues(BANDS, false).slice(1, 3), [112.5, 142.5]);
    // A hover finds its cell by the same edges: 112 Hz is the 125 Hz cell on a log axis, the 100 Hz one on a linear.
    assert.equal(cellIndex(BANDS, 112, true, { low: true, high: true }), 1);
    assert.equal(cellIndex(BANDS, 112, false, { low: true, high: true }), 0);
});

test('a heatmap on a log x axis draws and reads its columns by the geometric edges: 112 Hz is the 125 Hz column, drawn and read alike (R7)', () => {
    const view = { frame: 'NOctFrame', kind: 'heatmap', x: 'frequency', xScale: 'log', quantity: 'level', xs: BANDS, ys: [1, 2], matrix: [[-10, -20, -30], [-11, -21, -31]] } as unknown as StageView;
    const { canvas } = canvasFor();
    const plot = paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full: held(view) }] }, R(stageRange([view])), N({ x: 'x', y: 'y', colour: 'Level [dBFS]' }), { size: { width: W, height: H } });
    assert.ok(plot?.image && plot.xLog);
    const y = plot.frame.top + plot.frame.height * 0.75;
    for (const [hz, column] of [[112, 1], [111.5, 0], [142, 2], [141, 1]] as const) {
        const x = plot.xAt(hz);
        assert.equal(plot.image.cellAt(x, y).column, column, `drawn: ${hz} Hz`);
        const read = stageHover(plot, x, y);
        assert.equal(read?.at, BANDS[column], `read: ${hz} Hz`);
    }
});

test('bars on a log axis span their cells by the same geometric edges, however unevenly the bands are spaced (R7)', () => {
    const view = { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: BANDS, values: [-10, -20, -30] } as unknown as StageView;
    const { canvas, strokes } = canvasFor();
    const plot = paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full: held(view) }] }, R(stageRange([view])), N({ x: 'x', y: 'y' }), { size: { width: W, height: H } });
    assert.ok(plot?.xLog);
    const edges = barEdges(plot, BANDS);
    assert.ok(Math.abs(edges[1][0] - plot.xAt(EDGE)) < 1e-9 && Math.abs(edges[1][1] - plot.xAt(EDGE2)) < 1e-9, JSON.stringify(edges));
    // Each bar's stroke as drawn: the 125 Hz bar from √(100·125) to √(125·160), at its level.
    const level = plot.yAt(-20);
    const start = strokes.findIndex(([kind, x, at]) => kind === 'moveTo' && Math.abs(at - level) < 1e-9 && Math.abs(x - plot.xAt(EDGE)) < 1e-6);
    assert.ok(start >= 0, 'the 125 Hz bar starts at the geometric edge');
    assert.ok(Math.abs(strokes[start + 1][1] - (plot.xAt(EDGE2) - 1)) < 1e-6, 'and ends at the next one');
});

test('a readout and a headline keep the unit of a non-dB heatmap and of a non-dB Δ (R4, R7)', () => {
    const rough = { frame: 'RoughnessFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'roughness', unit: 'asper/Bark', xs: [0, 1, 2], ys: [1, 2], matrix: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] } as unknown as StageView;
    for (const diff of [false, true]) {
        const { canvas } = canvasFor();
        const plot = paintOverlay(canvas, { layers: [{ view: rough, color: '#36c', label: 'a.wav', full: held(rough) }] }, R(stageRange([rough])), N({ x: 'x', y: 'y', colour: 'Roughness [asper/Bark]' }), { size: { width: W, height: H }, ...(diff ? { diff: true } : {}) });
        assert.ok(plot?.image);
        const read = stageHover(plot, plot.xAt(1), plot.frame.top + plot.frame.height * 0.75);
        assert.match(read?.values ?? '', /asper\/Bark/u, `${diff ? 'Δ' : 'value'}: ${read?.values}`);
    }
    // A Δ line of a non-dB quantity, and its headline.
    const coherence = { frame: 'CoherenceFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'coherence', unit: 'Pa', xs: [100, 200, 300], values: [0.1, -0.2, 0.3], peak: { x: 300, value: 0.3 } } as unknown as StageView;
    const { canvas } = canvasFor();
    const plot = paintOverlay(canvas, { layers: [{ view: coherence, color: '#c33', label: 'Δ', full: held(coherence) }] }, R(stageRange([coherence])), N({ x: 'x', y: 'y' }), { size: { width: W, height: H }, diff: true });
    assert.ok(plot);
    const read = stageHover(plot, plot.xAt(200), plot.yAt(-0.2));
    assert.match(read?.values ?? '', /−0\.200 Pa/u, String(read?.values));
    assert.match(stageHeadline(coherence, { stageNoDelta: '—', stageMaxDelta: '{at} {delta}' }), /\+0\.300 Pa/u);
});
