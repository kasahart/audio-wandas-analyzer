/**
 * A line is painted, picked and marked with its own value axis's transform (docs/display-rules.md R14): on a plot with
 * a right-hand axis (two level references, FigureModel's two axes) a line assigned to the right-hand axis is drawn at
 * that axis's place for its value, the pointer over that place reads that very point, and the read mark is drawn
 * there too. Never the left axis's transform, nor "the plot's".
 */
import { testLine } from './helpers/whole';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { N, R, T } from './helpers/figure';
import type { StageView } from '../shared/protocol/backendProtocol';
import { createPlotHoverLayer } from '../webview/runtime/plotHoverLayer';
import { axisTransform, paintOverlay, type StageLayer } from '../webview/runtime/stagePanes';

type Stroke = { color: string; points: Array<[number, number]> };
/** A 2D context that records every stroked path with its colour, in canvas pixels (translations applied). */
function recordingContext(strokes: Stroke[]): CanvasRenderingContext2D {
    const state = { strokeStyle: '', tx: 0, ty: 0 };
    const saved: Array<typeof state> = [];
    let points: Array<[number, number]> = [];
    return new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'strokeStyle' ? state.strokeStyle
            : key === 'save' ? () => { saved.push({ ...state }); }
            : key === 'restore' ? () => { Object.assign(state, saved.pop() ?? state); }
            : key === 'translate' ? (x: number, y: number) => { state.tx += x; state.ty += y; }
            : key === 'beginPath' ? () => { points = []; }
            : key === 'moveTo' || key === 'lineTo' ? (x: number, y: number) => { points.push([x + state.tx, y + state.ty]); }
            : key === 'stroke' ? () => { strokes.push({ color: state.strokeStyle, points: [...points] }); }
            : key === 'createImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => { if (key === 'strokeStyle') state.strokeStyle = String(value); return true; },
    }) as CanvasRenderingContext2D;
}

const XS = Array.from({ length: 11 }, (_, index) => index);
/** A signal drawn as itself: its samples are its envelope (one per bucket) and its full data. */
function signal(values: number[], unit: string): StageView {
    return { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit, xs: XS, values,
        waveform: { min: values, max: values, minT: XS, maxT: XS, absolutePeak: Math.max(...values.map(Math.abs)), unit, ref: unit === 'Pa' ? 2e-5 : 1 } } as unknown as StageView;
}
function levels(values: number[]): StageView {
    return { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: XS, values } as unknown as StageView;
}

// Left and right axes of other units and ranges. The right line's sample at t = 5 is three quarters up the right axis;
// the left line runs 18 px under it on a plot 180 px high (0.3 of ±1 FS, −24 of −80–0 dBFS): within the pick radius.
const CASES = [
    {
        kind: 'waveform', left: signal(XS.map(() => 0.3), 'FS'), right: signal([-20, -10, 0, 10, 30, 50, 30, 10, 0, -10, -20], 'Pa'),
        leftRange: { min: -1, max: 1 }, rightRange: { min: -100, max: 100 }, axes: { x: 'Time [s]', y: 'Amplitude, uncalibrated [FS]' }, rightTitle: 'Sound pressure [Pa]', read: /50\.0 Pa$/u,
    },
    {
        kind: 'level line', left: levels(XS.map(() => -24)), right: levels([40, 50, 60, 70, 75, 80, 75, 70, 60, 50, 40]),
        leftRange: { min: -80, max: 0 }, rightRange: { min: 20, max: 100 }, axes: { x: 'Time [s]', y: 'Level, uncalibrated [dBFS]' }, rightTitle: 'Level [dB SPL re 20 µPa]', read: /80\.0 dB SPL re 20 µPa$/u,
    },
] as const;

test('a waveform and a level line on the right-hand axis are painted, picked and marked with that axis\'s transform, never the left one\'s (R14)', () => {
    for (const item of CASES) {
        const strokes: Stroke[] = [];
        const context = recordingContext(strokes);
        const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
        const values = (view: StageView): number[] => (view.values ?? []) as unknown as number[];
        const leftLayer: StageLayer = { view: item.left, color: '#00f', label: 'left', full: testLine(XS, values(item.left)) };
        const rightLayer: StageLayer = { view: item.right, color: '#f80', label: 'right', full: testLine(XS, values(item.right)) };
        const plot = paintOverlay(canvas, { layers: [leftLayer] }, R(item.leftRange), N(item.axes),
            { secondary: { layers: [rightLayer], range: R(item.rightRange), title: T(item.rightTitle) } });
        assert.ok(plot?.secondary, `${item.kind}: the plot has a right-hand axis`);
        const sample = values(item.right)[5];
        // The right axis's own transform, made by the one function every use takes (axisTransform).
        const right = axisTransform({ range: item.rightRange }, { box: plot.frame, time: { low: 0, high: 10 }, window: { start: 0, end: 1 } });
        const x = plot.xAt(5), y = right.yAt(sample);
        // Three quarters up the right axis (50 of ±100 Pa, 80 of 20–100 dB): a quarter of the plot under its top.
        assert.ok(Math.abs(y - (plot.frame.top + 0.25 * plot.frame.height)) < 1e-9, `${sample} is three quarters up the right axis (${y})`);
        assert.equal(plot.secondary.yAt(sample), y, 'the right-hand plot places its values by the right transform');
        // Painted: the right line's stroke passes through (x, y) of the right transform.
        const near = (points: ReadonlyArray<[number, number]>, at: [number, number]): boolean => points.some(([px, py]) => Math.abs(px - at[0]) < 0.75 && Math.abs(py - at[1]) < 0.75);
        const painted = strokes.filter(stroke => stroke.color === '#f80');
        assert.ok(painted.some(stroke => near(stroke.points, [x, y])),
            `${item.kind}: the right line is drawn at its own axis's place for ${sample} (${x.toFixed(1)}, ${y.toFixed(1)}); drawn at ${JSON.stringify(painted.map(stroke => stroke.points.filter(([px]) => Math.abs(px - x) < 1)))}. R14: paint a line with the transform of the axis it is on (axisTransform), never the plot's first axis's`);

        // Picked and marked: the pointer at that pixel, through the readout every plot uses.
        const { window } = new JSDOM('<!doctype html><body><div class="plot-readout" hidden><span></span><span></span></div><canvas id="plot"></canvas></body>');
        const marks: Stroke[] = [];
        const markContext = recordingContext(marks);
        window.HTMLCanvasElement.prototype.getContext = (() => markContext) as unknown as HTMLCanvasElement['getContext'];
        const element = window.document.getElementById('plot') as HTMLElement;
        element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
        const slot = window.document.querySelector<HTMLElement>('.plot-readout');
        const layer = createPlotHoverLayer(window.document);
        layer.show(element, plot, x, y, slot);
        const read = layer.reading();
        assert.equal(read?.layer.label, 'right', `${item.kind}: the pointer on the right line's drawn point reads it, not the left line ${Math.abs(y - plot.yAt(values(item.left)[5])).toFixed(0)} px away (R14: pick by the line's own axis)`);
        assert.equal(read?.at, 5);
        assert.equal(read?.value, sample);
        assert.match(slot?.textContent ?? '', item.read);
        assert.ok(Math.abs((read?.y ?? NaN) - y) < 1e-9, `the read point is at the right transform's y ${y}, not ${read?.y}`);
        // The read mark: the level guide at that y (to the right-hand axis), and the line read drawn again over it there.
        assert.ok(marks.some(stroke => stroke.points.length === 2 && stroke.points.every(([, py]) => Math.abs(py - y) < 1e-9)), 'the level guide is drawn at the read point');
        assert.ok(marks.some(stroke => stroke.color === '#f80' && near(stroke.points, [x, y])), `the line read is drawn again where it is painted, through (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
});
