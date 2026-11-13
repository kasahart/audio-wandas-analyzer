/**
 * Lines are clipped, not clamped (docs/display-rules.md R2). Every point of a line is placed at its axis's exact y
 * (`yOf`), never held at the plot's edge or some spans past it, and each segment is cut where it crosses the plot's box
 * grown by the line's width (plot/lineClip.ts, the one rule strokeStageLine and the signal's paintDecimatedPoints both
 * stroke by). So, zoomed in, a segment from a point on the plot to one far past the axis is drawn along the true
 * segment and leaves the plot where the true segment does, at every zoom. Held before joining (as a y held ten spans
 * past the axis was), the segment ran towards the held point and its visible part changed shape with the zoom.
 *
 * Each plot here is painted by paintOverlay (its own axisTransform, never a hand-made one).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { N, R } from './helpers/figure';
import { testLine } from './helpers/whole';
import { clippedSegment } from '../webview/plot/lineClip';
import { spectrumLayer } from '../webview/runtime/overlaySpectrumPainter';
import { paintOverlay, type StageLayer, type StagePaintOptions, type StagePlot } from '../webview/runtime/stagePanes';
import type { SpectrumSeries } from '../webview/runtime/types';
import type { StageView } from '../shared/protocol/backendProtocol';

const FIX = 'R2 (docs/display-rules.md): lines are clipped, not clamped. Place every point of a line at its axis\'s exact y '
    + '(AxisTransform.yOf), never a y held at or past the plot\'s edge, and stroke it through plot/lineClip.ts clippedPath, '
    + 'which cuts each segment where it crosses the plot (grown by the line\'s width).';

type Stroke = { color: string; dash: string; width: number; points: Array<[number, number]>; runs: number; segments: Array<[number, number, number, number]> };
/** A 2D context that records every stroked path (its colour, dash, width, points and runs) in canvas pixels. */
function recordingContext(strokes: Stroke[]): CanvasRenderingContext2D {
    const state = { strokeStyle: '', dash: '', lineWidth: 1, tx: 0, ty: 0 };
    const saved: Array<typeof state> = [];
    let points: Array<[number, number]> = [];
    let segments: Array<[number, number, number, number]> = [];
    let pen: [number, number] | null = null;
    let runs = 0;
    return new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'strokeStyle' ? state.strokeStyle
            : key === 'font' ? '10px sans-serif'
            : key === 'save' ? () => { saved.push({ ...state }); }
            : key === 'restore' ? () => { Object.assign(state, saved.pop() ?? state); }
            : key === 'translate' ? (x: number, y: number) => { state.tx += x; state.ty += y; }
            : key === 'setLineDash' ? (dash: number[]) => { state.dash = dash.join(','); }
            : key === 'beginPath' ? () => { points = []; segments = []; pen = null; runs = 0; }
            : key === 'moveTo' ? (x: number, y: number) => { points.push([x + state.tx, y + state.ty]); pen = [x + state.tx, y + state.ty]; runs += 1; }
            : key === 'lineTo' ? (x: number, y: number) => {
                const to: [number, number] = [x + state.tx, y + state.ty];
                points.push(to);
                if (pen) segments.push([pen[0], pen[1], to[0], to[1]]);
                pen = to;
            }
            : key === 'stroke' ? () => { strokes.push({ color: state.strokeStyle, dash: state.dash, width: state.lineWidth, points: [...points], runs, segments: [...segments] }); }
            : key === 'createImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => {
            if (key === 'strokeStyle') state.strokeStyle = String(value);
            if (key === 'lineWidth') state.lineWidth = Number(value);
            return true;
        },
    }) as CanvasRenderingContext2D;
}

function paint(layers: StageLayer[], range: { min: number; max: number }, options: StagePaintOptions = {}): { plot: StagePlot; strokes: Stroke[] } {
    const strokes: Stroke[] = [];
    const context = recordingContext(strokes);
    const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    const plot = paintOverlay(canvas, { layers }, R(range), N({ x: 'Frequency [Hz]', y: 'Level [dB]' }), options);
    assert.ok(plot, 'the plot is painted');
    return { plot, strokes };
}

const XS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
function line(values: number[], color: string, extra: Partial<StageView> = {}): StageLayer {
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: XS, values, ...extra } as unknown as StageView;
    return { view, color, label: color, full: testLine(XS, values) };
}
function signal(values: number[], color: string): StageLayer {
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: XS, values,
        waveform: { min: values, max: values, minT: XS, maxT: XS, absolutePeak: Math.max(...values.map(Math.abs)), unit: 'Pa', ref: 2e-5 } } as unknown as StageView;
    return { view, color, label: color, full: testLine(XS, values) };
}

/** The zooms: a value axis of ±span around `centre`, and the value past it, many spans away. */
const ZOOMS = [
    { name: '±1, the far point 1,000 up', centre: 0, span: 1, far: 1000 },
    { name: '±0.001, the far point 1 up (a million spans)', centre: 0, span: 0.001, far: 1 },
    { name: '±1e-9 about 0.5, the far point 1 up', centre: 0.5, span: 1e-9, far: 1 },
    { name: '±0.001, the far point 100 down (a hundred thousand spans)', centre: 0, span: 0.001, far: -100 },
    { name: '±1, the far point 1e300 up', centre: 0, span: 1, far: 1e300 },
] as const;

/** Where the true segment from (x0, y0) to (x1, y1) crosses the canvas row y. */
const crossing = (x0: number, y0: number, x1: number, y1: number, y: number): number => x0 + (y - y0) / (y1 - y0) * (x1 - x0);

test('a segment from a point on the plot to one far past the value axis is drawn along the true segment and crosses the plot\'s edge at the true x, at every zoom, from either end (R2)', () => {
    const broken: string[] = [];
    for (const zoom of ZOOMS) {
        // On the plot at x = 4 (a quarter of the span over the centre), far past the axis at x = 5; and the reverse.
        for (const reverse of [false, true]) {
            const near = zoom.centre + zoom.span / 4;
            const values = XS.map(x => (x === (reverse ? 5 : 4) ? near : x === (reverse ? 4 : 5) ? zoom.far : near));
            const { plot, strokes } = paint([line(values, '#f00')], { min: zoom.centre - zoom.span, max: zoom.centre + zoom.span });
            const { top, height } = plot.frame;
            const edge = zoom.far > zoom.centre ? top : top + height;
            const x0 = plot.xAt(reverse ? 5 : 4), y0 = plot.yOf(near), x1 = plot.xAt(reverse ? 4 : 5), y1 = plot.yOf(zoom.far);
            const expected = crossing(x0, y0, x1, y1, edge);
            const drawn = strokes.filter(stroke => stroke.color === '#f00').flatMap(stroke => stroke.points);
            // The drawn piece that leaves the plot: from the on-screen point to the cut end past the edge.
            const at = drawn.findIndex(([x, y]) => Math.abs(x - x0) < 1e-9 && Math.abs(y - y0) < 1e-9);
            const cut = reverse ? drawn[at - 1] : drawn[at + 1];
            const label = `${zoom.name}${reverse ? ', from the far point' : ''}`;
            if (at < 0 || !cut) { broken.push(`${label}: the point on the plot (${x0}, ${y0}) or the segment from it is not drawn: ${JSON.stringify(drawn.slice(0, 12))}`); continue; }
            const along = crossing(x0, y0, cut[0], cut[1], edge);
            const past = zoom.far > zoom.centre ? cut[1] <= top : cut[1] >= top + height;
            if (!past || Math.abs(along - expected) > 1e-6) {
                broken.push(`${label}: drawn towards (${cut[0].toFixed(3)}, ${cut[1].toPrecision(6)}), crossing the edge at x ${along.toFixed(6)}, the true segment crosses at ${expected.toFixed(6)}${past ? '' : ' (and it stops before the edge)'}`);
            }
            // Cut, not handed to the canvas far off the plot: every point is within the plot grown by the width.
            const grown = 1.5 + 1e-6;
            const off = drawn.find(([x, y]) => x < plot.frame.left - grown || x > plot.frame.left + plot.frame.width + grown || y < top - grown || y > top + height + grown);
            if (off) broken.push(`${label}: a point far off the plot was stroked, (${off[0]}, ${off[1]}): cut the segment to the plot`);
        }
    }
    assert.deepEqual(broken, [], FIX);
});

test('a signal drawn as itself is cut to its plot by the same rule: on a zoomed amplitude axis its segment crosses the edge at the true x (R2)', () => {
    const values = XS.map(x => (x === 5 ? 1000 : 0.25));
    const { plot, strokes } = paint([signal(values, '#0a0')], { min: -1, max: 1 });
    const { left, top, width, height } = plot.frame;
    const drawn = strokes.filter(stroke => stroke.color === '#0a0').flatMap(stroke => stroke.points);
    assert.ok(drawn.length > 0, 'the signal is drawn');
    const off = drawn.find(([x, y]) => x < left - 1.5 - 1e-6 || x > left + width + 1.5 + 1e-6 || y < top - 1.5 - 1e-6 || y > top + height + 1.5 + 1e-6);
    assert.equal(off, undefined, `a point far off the plot was stroked: ${JSON.stringify(off)}. ${FIX}`);
    // The piece from the sample at x = 4 up to the cut: on the true segment to (x of 5, y of 1000).
    const x0 = plot.xAt(4), y0 = plot.yOf(0.25), x1 = plot.xAt(5), y1 = plot.yOf(1000);
    // A sample is a pair (its envelope's min and max, here one point): the piece from its last.
    const at = drawn.map(([x, y]) => Math.abs(x - x0) < 1e-6 && Math.abs(y - y0) < 1e-6).lastIndexOf(true);
    assert.ok(at >= 0 && drawn[at + 1], `the sample at x = 4 and the segment from it are drawn: ${JSON.stringify(drawn)}`);
    const cut = drawn[at + 1];
    assert.ok(Math.abs(crossing(x0, y0, cut[0], cut[1], top) - crossing(x0, y0, x1, y1, top)) < 1e-6, `drawn towards ${JSON.stringify(cut)}, not along the true segment. ${FIX}`);
});

test('a line wholly on the plot is stroked as the same path as without clipping: its points at their exact places, one run (R2)', () => {
    const values = [0.1, 0.5, -0.3, 0.9, -0.9, 0.2, 0.0, 0.7, -0.6, 0.4, 0.3];
    const { plot, strokes } = paint([line(values, '#00f'), line(values.map(v => -v), '#f0f', { kind: 'bar' })], { min: -1, max: 1 });
    const drawn = strokes.filter(stroke => stroke.color === '#00f');
    assert.equal(drawn.length, 1, 'one stroke');
    assert.equal(drawn[0].runs, 1, 'one run: no segment of a line on the plot is cut');
    assert.deepEqual(drawn[0].points, XS.map((x, index) => [plot.xAt(x), plot.yOf(values[index])]), `the unclipped path, every point at (xAt, yOf). ${FIX}`);
    // A bar's top edge at its value's exact y, from its cell's left edge to a pixel short of its right.
    const bars = strokes.filter(stroke => stroke.color === '#f0f');
    assert.equal(bars.length, XS.length, 'one edge per bar');
    bars.forEach((bar, index) => assert.ok(bar.points.length === 2 && bar.points.every(([, y]) => y === plot.yOf(-values[index])), `bar ${index} at its exact y: ${JSON.stringify(bar.points)}`));
});

test('a bar, the Δ\'s 0 and a trigger\'s level past the value axis are not drawn along the plot\'s edge (R2)', () => {
    const range = { min: 5, max: 10 };
    // Every value far over the axis (the bars, the dots) or under it (the Δ's 0, the guide's level).
    const { plot, strokes } = paint([line(XS.map(() => 100), '#f0f', { kind: 'bar' })], range, { diff: true, guides: { level: { value: -50, label: 'fires' } } });
    const { left, top, width, height } = plot.frame;
    const along = (stroke: Stroke, y: number): boolean => stroke.points.length >= 2 && stroke.points.every(([, py]) => Math.abs(py - y) <= 1.5);
    const bars = strokes.filter(stroke => stroke.color === '#f0f' && stroke.points.length);
    assert.deepEqual(bars, [], `a bar edge over the axis is clipped off the plot, not stroked: ${JSON.stringify(bars)}. ${FIX}`);
    // The Δ's 0 (muted) and the guide's level (dashed) are under the axis: neither runs along the plot's floor.
    const floor = strokes.filter(stroke => (stroke.color === '#888' || stroke.dash === '5,3') && along(stroke, top + height) && Math.abs(stroke.points[0][0] - left) < 1e-9 && Math.abs((stroke.points.at(-1)?.[0] ?? 0) - (left + width)) < 1e-9);
    assert.deepEqual(floor, [], `the Δ's 0 or the trigger's level, under the axis, is drawn along the plot's floor as if it were there. ${FIX}`);
    // Shown when on the plot: the Δ's 0 and the level at their exact y's.
    const shown = paint([line(XS.map(() => 1), '#f0f')], { min: -2, max: 2 }, { diff: true, guides: { level: { value: 1, label: 'fires' } } });
    assert.ok(shown.strokes.some(stroke => stroke.color === '#888' && along(stroke, shown.plot.yOf(0))), 'the Δ\'s 0 on the plot is drawn at its y');
    assert.ok(shown.strokes.some(stroke => stroke.dash === '5,3' && along(stroke, shown.plot.yOf(1))), 'the trigger\'s level on the plot is drawn at its y');
});

test('the clip keeps the segment itself: its cut ends on the true segment at the box\'s edges, none where it misses the box (R2)', () => {
    const box = { left: 0, top: 0, right: 100, bottom: 100 };
    assert.deepEqual(clippedSegment(box, 10, 10, 90, 90), [10, 10, 90, 90], 'inside: unchanged');
    assert.equal(clippedSegment(box, -10, -10, -5, 200), null, 'wholly left of the box');
    const [, , x, y] = clippedSegment(box, 50, 50, 60, -1e12) ?? [NaN, NaN, NaN, NaN];
    assert.equal(y, 0);
    assert.ok(Math.abs(x - (50 + 50 / (50 + 1e12) * 10)) < 1e-9, `cut at the true x, ${x}`);
    const [ex, ey] = clippedSegment(box, -50, 50, 50, 100) ?? [NaN, NaN, NaN, NaN];
    assert.ok(ex === 0 && Math.abs(ey - 75) < 1e-12, `entering through the left edge at its true y (${ex}, ${ey})`);
    // Past double range (an overflowed y): held at ±1e300 px, the crossing is the near end's x to the last bit.
    const [, , ox, oy] = clippedSegment(box, 40, 50, 41, -Infinity) ?? [NaN, NaN, NaN, NaN];
    assert.ok(oy === 0 && Math.abs(ox - 40) < 1e-12, `an infinite y crosses at its near end's x (${ox}, ${oy})`);
});

const GAP_FIX = 'R2 (docs/display-rules.md): a value that is not finite is a gap, and a line is never joined across it. Thinning keeps '
    + 'a break (null) where the source has a gap (comparePanes.minMaxLine, stage_view.min_max_indices, waveformRenderer.decimateBuckets), '
    + 'and the stroke lifts the pen there (stagePanes.strokeStageLine, waveformRenderer.paintDecimatedPoints through lineClip.clippedPath).';

/** The stroked segments of `strokes` that reach into the open stretch (`low`, `high`) of canvas x, where the line has no value. */
function across(strokes: readonly Stroke[], low: number, high: number): Array<[number, number, number, number]> {
    return strokes.flatMap(stroke => stroke.segments).filter(([x0, , x1]) => Math.max(x0, x1) > low + 1e-9 && Math.min(x0, x1) < high - 1e-9);
}

test('a line with a stretch of no values is drawn with a break there at every zoom, thinned to be drawn or not: never joined across it (R2)', () => {
    // A cursor spectrum's 8193 bins (1 Hz each) with no value (NaN) from 3000 to 3499 Hz, drawn whole and zoomed onto
    // the gap and its edges: thinned in buckets of its linear axis where its bins outnumber them, else drawn bin by bin.
    const bins = 8193;
    const every = Array.from({ length: bins }, (_, bin) => (bin >= 3000 && bin < 3500 ? Number.NaN : Math.sin(bin * 1.3) * 20 - 40));
    const slice = { values: every, bins: every, frequencyBins: bins, maxFrequencyHz: 8192, minDb: -60, maxDb: -20 } as unknown as SpectrumSeries['slice'];
    const series = { slice, color: '#0af', label: 'a' } as unknown as SpectrumSeries;
    const broken: string[] = [];
    for (const [low, high] of [[0, 8192], [2000, 4000], [2950, 3050], [3450, 3550], [2990, 3510], [2999, 3001]]) {
        const layer = spectrumLayer(series, 8192, { frequencyMin: low, frequencyMax: high, buckets: 300 });
        const { plot, strokes } = paint([layer], { min: -80, max: 0 }, { axisView: { frame: 'spectrum', kind: 'line', xs: [low, high], xLimits: [low, high], xScale: 'linear' } });
        const ours = strokes.filter(stroke => stroke.color === '#0af');
        const joined = across(ours, plot.xAt(2999), plot.xAt(3500));
        if (joined.length) broken.push(`${low}–${high} Hz: ${joined.length} segment(s) joined across the gap, e.g. ${JSON.stringify(joined[0])}`);
        if (!ours.some(stroke => stroke.segments.length)) broken.push(`${low}–${high} Hz: nothing drawn`);
    }
    assert.deepEqual(broken, [], GAP_FIX);
});

test('a signal drawn as itself breaks at its gap: a sample with no value is not drawn at 0, nor joined across (R2)', () => {
    // Eleven samples at 0.5 with none (null, as the backend sends a gap of the envelope) at x 4 to 6.
    const values = XS.map(x => (x >= 4 && x <= 6 ? null : 0.5));
    const view = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: XS, values,
        waveform: { min: values, max: values, minT: XS, maxT: XS, absolutePeak: 0.5, unit: 'Pa', ref: 2e-5 } } as unknown as StageView;
    const { plot, strokes } = paint([{ view, color: '#a0a', label: 's', full: testLine(XS, values.map(value => value ?? Number.NaN)) }], { min: -1, max: 1 });
    const ours = strokes.filter(stroke => stroke.color === '#a0a');
    assert.ok(ours.some(stroke => stroke.segments.length), 'the signal is drawn');
    assert.deepEqual(across(ours, plot.xAt(3), plot.xAt(7)), [], GAP_FIX);
    const zero = plot.yOf(0);
    assert.equal(ours.flatMap(stroke => stroke.points).find(([, y]) => Math.abs(y - zero) < 1e-6), undefined, `a gap is drawn as a sample at 0. ${GAP_FIX}`);
});
