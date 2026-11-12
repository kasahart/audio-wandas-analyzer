import { testLine } from './helpers/whole';
import assert from 'node:assert/strict';
import { N, R, T } from './helpers/figure';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { StageView } from '../shared/protocol/backendProtocol';
import { mappedSource, type FullSource, cannotRead, fullSource, readsFullData, sourceWith } from '../webview/runtime/fullRead';
import { createPlotHoverLayer } from '../webview/runtime/plotHoverLayer';
import type { PaneRange } from '../webview/runtime/comparePanes';
import { floorless, paintOverlay, paintStage, stageRange, type StagePlot } from '../webview/runtime/stagePanes';
import { held } from './helpers/heldSource';

/**
 * The readout is one state machine (plotHoverLayer over stageHover / stageStep): hover → read, a key → the next point
 * of the full data, a redraw at the same place → the same point, a key while the points are on their way → that point
 * once they are in, a move → the point there again. Every Frame kind the app draws (the plot contract's fixture) runs
 * every transition, with its full data held and with it fetched (A41, A42, A46, R7). The surface a key goes to (A47)
 * is trackPointerEvents.test's; an empty answer from the backend (A41) is fullRead.test's.
 */
const KINDS = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'stageViewKinds.json'), 'utf8')) as Record<string, StageView>;
const W = 600, H = 300;

function canvasFor(document: Document): HTMLCanvasElement {
    const context = new Proxy({}, {
        get: (_target, key) => key === 'font' ? '10px sans-serif' : key === 'textAlign' ? 'left' : key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'createImageData' || key === 'getImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: () => true,
    });
    // Every canvas (the plot's and the hover layer's) draws into nothing.
    (document.defaultView as unknown as { HTMLCanvasElement: typeof HTMLCanvasElement }).HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W });
    Object.defineProperty(canvas, 'clientHeight', { value: H });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
    document.body.append(canvas);
    return canvas;
}

/**
 * The full data of `view`, answering at once (held), or only once `release` is called (fetched, the backend slow); a
 * trigger's events each read their own points (eventLayers: full.event), held or fetched alike.
 */
function sourceOf(view: StageView, fetched: boolean): { full: FullSource; release: () => void; hold: () => void } {
    let holding = fetched;
    const waiting: Array<() => void> = [];
    const wait = <Q, A>(read: (query: Q, ready: () => void) => A) => ((read as unknown) === cannotRead ? read : (query: Q, ready: () => void): A | undefined => {
        if (holding) { waiting.push(ready); return undefined; }
        return read(query, ready);
    });
    const of = (whole: StageView): FullSource => {
        const inner = held(whole);
        const event = whole.events ? (id: number): FullSource => { const one = whole.events!.find(item => item.id === id)!; return of({ ...whole, events: undefined, xs: one.xs, values: one.values }); } : undefined;
        if (!fetched) return event ? sourceWith(inner, { event }) : inner;
        return fullSource('fetched', { line: wait(inner.line), cells: wait(inner.cells), ...(event ? { event } : {}) });
    };
    return { full: of(view), release: () => { holding = false; for (const ready of waiting.splice(0)) ready(); }, hold: () => { holding = fetched; } };
}

for (const [kind, view] of Object.entries(KINDS)) {
    for (const fetched of [false, true]) {
        test(`${kind} (${fetched ? 'fetched' : 'held'}): hover reads a point of the full data, a key the next one, a redraw keeps it, a key while waiting reads once in, a move reads where it is (A41, A42, A46, R7)`, () => {
            const { window } = new JSDOM('<!doctype html><body><div class="plot-readout" hidden><span></span><span></span></div></body>');
            const document = window.document;
            const canvas = canvasFor(document);
            const slot = document.querySelector<HTMLElement>('.plot-readout');
            const layer = createPlotHoverLayer(document);
            const source = sourceOf(view, fetched);
            const range = stageRange([view]);
            const draw = (on: PaneRange = range): StagePlot => {
                const plot = paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full: source.full }] }, R(on), N({ x: 'x', y: 'y', ...(view.kind === 'heatmap' ? { colour: 'Level [dBFS]' } : {}) }), { size: { width: W, height: H } });
                assert.ok(plot, `${kind} is drawn`);
                return plot;
            };
            let drawn = draw();
            const { frame } = drawn;
            // Hover: pending while fetched, then a point of the full data.
            const hx = frame.left + frame.width * 0.4, hy = frame.top + frame.height * 0.5;
            layer.show(canvas, drawn, hx, hy, slot);
            if (fetched) {
                assert.equal(layer.reading(), null, 'no number while its points are on their way');
                source.release();
            }
            const first = layer.reading();
            assert.ok(first && first.full && first.at !== undefined, `${kind}: read from the full data`);
            // Every x the full data of the line read holds (a line's points, an image's columns, an event's samples).
            const xs = first.layer.view.xs ?? [];
            const index = xs.indexOf(first.at);
            assert.ok(index >= 0, `${kind}: ${first.at} is one of the full data's xs`);
            // A key: the next x of the full data, one point at a time however many share a pixel.
            const at = layer.stepFrom(canvas, drawn, 1);
            assert.ok(at, `${kind}: a key steps`);
            layer.show(canvas, drawn, at.clientX, at.clientY, slot);
            assert.equal(layer.reading()?.at, xs[index + 1], `${kind}: the next point`);
            // Drawn again at the same place (a hover redraws the cursor spectrum and the pair), as drawn and zoomed onto
            // the level first read, so the point stepped to is off the plot, held at its edge: the same point (A46).
            for (const on of [range, { ...range, min: (first.value ?? 0) - 1e-9, max: (first.value ?? 0) + 1e-9 }]) {
                drawn = draw(on);
                layer.show(canvas, drawn, at.clientX, at.clientY, slot);
                assert.equal(layer.reading()?.at, xs[index + 1], `${kind}: the same point after the redraw`);
            }
            drawn = draw();
            // The pointer moved on, and a key pressed while that read still waits for its points: the point it steps
            // to once they are in, never an empty readout (A42).
            source.hold();
            const mx = frame.left + frame.width * 0.6;
            layer.show(canvas, drawn, mx, hy, slot);
            const later = layer.stepFrom(canvas, drawn, 1);
            if (later) layer.show(canvas, drawn, later.clientX, later.clientY, slot);
            if (fetched) assert.equal(layer.reading(), null, `${kind}: no number while they are on their way`);
            source.release();
            assert.ok(layer.reading()?.full, `${kind}: read once the points are in`);
            assert.ok(slot?.textContent, `${kind}: the readout shows it`);
            // A move: the point under the pointer again, not the one stepped to.
            layer.show(canvas, drawn, hx, hy, slot);
            assert.equal(layer.reading()?.at, first.at, `${kind}: the point read there before`);
            // Gone: nothing read; back: read again.
            layer.hide();
            assert.equal(layer.reading(), null);
            layer.show(canvas, drawn, hx, hy, slot);
            assert.equal(layer.reading()?.at, first.at, `${kind}: read again`);
        });
    }
}

/*
 * The table: every Frame kind × every kind of chart × every state of its full data × every event a chart answers,
 * each asserting what the one readout (plotHoverLayer, the machine every chart reads through: the comparison's and the
 * steps' plots, the Δ pane, the cursor spectrum and the pair, the held plot, the distribution, the track lanes) reads.
 *
 * Charts: drawn as their painters draw them. The overlay (comparison, steps, trigger, held, pair), the Δ pane
 * (paintStage, diff), a right-hand level axis (the cursor spectrum and the steps' overlay with two references), and a
 * track lane (its full data on the file's 0..1 through mappedSource, shown by its owner on its next frame, as the
 * lanes are drawn).
 * States: held (in hand), fetched (pending, then in), failed (the backend failed, then answered after its pause), empty.
 * Events: hover, ← / → (and back, symmetric), past either end, outside a zoomed window, through a silence, a key while
 * pending or failed (taken once in), a redraw, a resize, + / − / 0 (a zoom off the point stepped to), a box zoom or
 * Alt+drag let go elsewhere, a scroll under a still pointer, and the focus or the pointer gone.
 */
type State = 'held' | 'fetched' | 'failed' | 'empty';
const STATES: State[] = ['held', 'fetched', 'failed', 'empty'];
type Draw = (canvas: HTMLCanvasElement, view: StageView, full: FullSource, options: { window?: { start: number; end: number }; size: { width: number; height: number }; other?: { view: StageView; full: FullSource } }) => StagePlot | null;
interface ChartKind { name: string; images: boolean; draw: Draw; mapped?: boolean; later?: boolean; /** Draws a difference: a Δ has no silent floor. */ diff?: boolean }
const names = (view: StageView) => N({ x: 'x', y: 'y', ...(view.kind === 'heatmap' ? { colour: 'Level [dBFS]' } : {}) });
const CHARTS: ChartKind[] = [
    {
        name: 'overlay', images: true,
        draw: (canvas, view, full, { window, size, other }) => paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full }, ...(other ? [{ view: other.view, color: '#c63', label: 'b.wav', full: other.full }] : [])] }, R(stageRange([view])), names(view), { size, ...(window ? { window: { x: window } } : {}) }),
    },
    {
        name: 'difference', images: true, diff: true,
        draw: (canvas, view, full, { window, size }) => paintStage(canvas, view, R(stageRange([view])), '#c33', names(view), full, { diff: true, size, ...(window ? { window: { x: window } } : {}) }),
    },
    {
        name: 'right-hand level axis', images: false,
        // The left axis holds a line of the other reference, nowhere near the pointer: the one read is on the right.
        draw: (canvas, view, full, { window, size }) => paintOverlay(canvas, { layers: [{ view: { ...view, xs: (view.xs ?? []).slice(0, 1), values: (view.values ?? []).slice(0, 1), levelBins: undefined, events: undefined }, color: '#c63', label: 'b.wav', full: testLine([], []) }] }, R(stageRange([view])), names(view),
            { size, ...(window ? { window: { x: window } } : {}), axisView: view, secondary: { layers: [{ view, color: '#36c', label: 'a.wav', full }], range: R(stageRange([view])), title: T('Level [dB SPL]') } }),
    },
    {
        name: 'track lane', images: true, mapped: true, later: true,
        draw: (canvas, view, full, { window, size, other }) => paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full }, ...(other ? [{ view: other.view, color: '#c63', label: 'b.wav', full: other.full }] : [])] }, R(stageRange([view])), names(view), { size, ...(window ? { window: { x: window } } : {}) }),
    },
];

/** A source over `view` in state `state`: held answers at once; fetched waits for `release`; failed answers null until `recover`. */
function stateSource(view: StageView, state: State, mapped: boolean): { full: FullSource; release: () => void; recover: () => void } {
    const xs = view.xs ?? [];
    const low = xs[0] ?? 0, high = xs[xs.length - 1] ?? 1, span = high - low || 1;
    const toFile = (x: number): number => (x - low) / span, fromFile = (f: number): number => low + f * span;
    const own = state === 'empty' ? { ...view, xs: [], values: view.values ? [] : undefined, ys: view.ys ? [] : undefined, matrix: view.matrix ? [] : undefined, events: view.events?.map(event => ({ ...event, xs: [], values: [] })) } : view;
    // A lane reads its file over 0..1 (mappedSource): the source is the file's, the plot's axis is the lanes'.
    const inner = (whole: StageView): FullSource => held(mapped ? { ...whole, xs: (whole.xs ?? []).map(toFile) } : whole);
    let holding = state === 'fetched', failing = state === 'failed';
    const waiting: Array<() => void> = [];
    const wrap = (whole: StageView): FullSource => {
        const source = inner(whole);
        const gate = <Q, A>(read: (query: Q, ready: () => void) => A) => ((read as unknown) === cannotRead ? read : (query: Q, ready: () => void): A | null | undefined => {
            if (holding) { waiting.push(ready); return undefined; }
            // The backend failed: null (no points known), and those waiting are told once its pause is over (fullRead.ts).
            if (failing) { waiting.push(ready); return null; }
            return read(query, ready);
        });
        const fetched: FullSource = state === 'held' ? source : fullSource('fetched', { line: gate(source.line), cells: gate(source.cells) });
        const event = whole.events ? (id: number): FullSource => { const one = whole.events!.find(item => item.id === id)!; return wrap({ ...whole, events: undefined, xs: one.xs, values: one.values }); } : undefined;
        const onAxis = mapped ? mappedSource(fetched, toFile, fromFile) : fetched;
        return event && readsFullData(onAxis) ? sourceWith(onAxis, { event }) : onAxis;
    };
    const flush = (): void => { for (const ready of waiting.splice(0)) ready(); };
    return { full: wrap(own), release: () => { holding = false; flush(); }, recover: () => { failing = false; flush(); } };
}

/** Values −300 over four points after the 40 % one: a silence on a level, plain values on a signal or a metric. */
function withSilence(view: StageView): { view: StageView; k: number } | null {
    if (view.kind === 'heatmap' || view.events || !view.values || view.values.length < 12) return null;
    const k = Math.floor(view.values.length * 0.4);
    const values = view.values.map((value, index) => (index > k && index <= k + 4 ? -300 : value));
    return { view: { ...view, values, valueRange: undefined }, k };
}

const near = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const indexIn = (xs: readonly number[], at: number | undefined): number => (at === undefined ? -1 : xs.findIndex(x => near(x, at)));

for (const [kind, view] of Object.entries(KINDS)) {
    for (const chart of CHARTS) {
        if (view.kind === 'heatmap' && !chart.images) continue;
        for (const state of STATES) {
            test(`${kind} on the ${chart.name}, its full data ${state}: every event reads what the one readout defines (R7)`, () => {
                const { window } = new JSDOM('<!doctype html><body><div class="plot-readout" hidden><span></span><span></span></div></body>');
                const document = window.document;
                const canvas = canvasFor(document);
                // The canvas's place and size on screen, which a scroll and a resize change.
                const box = { left: 0, top: 0, width: W, height: H };
                canvas.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) });
                const slot = document.querySelector<HTMLElement>('.plot-readout');
                const layer = createPlotHoverLayer(document);
                const source = stateSource(view, state, !!chart.mapped);
                // A failed line beside one in hand: the failed one may be the nearest, so nothing is read (never the other's).
                const other = state === 'failed' && view.kind !== 'heatmap' && !view.events ? { view, full: held(view) } : undefined;
                const draw = (on: { window?: { start: number; end: number } } = {}): StagePlot => {
                    const plot = chart.draw(canvas, view, source.full, { size: { width: box.width, height: box.height }, ...on, ...(other ? { other } : {}) });
                    assert.ok(plot, `${kind} is drawn`);
                    return plot;
                };
                let drawn = draw();
                // The owner: shows where the pointer (or a step) is; a lane shows on its next frame, as the lanes are drawn.
                let pointer: { x: number; y: number } | null = null;
                const frame = (): void => { if (pointer) layer.show(canvas, drawn, pointer.x, pointer.y, slot); };
                const hover = (x: number, y: number): void => { pointer = { x, y }; if (!chart.later) frame(); };
                // A step is shown at the true pointer (plotInteraction's hoverAt), which a key never moves.
                const arrived = (at: { clientX: number; clientY: number }): void => { if (pointer) hover(pointer.x, pointer.y); else hover(at.clientX, at.clientY); };
                const key = (delta: -1 | 1): boolean => {
                    const at = layer.stepFrom(canvas, drawn, delta, arrived);
                    if (at) arrived(at);
                    return !!at;
                };
                const rendered = (): void => { if (chart.later) frame(); };
                const reading = () => layer.reading();
                const at = (x: number, y: number) => ({ x: box.left + drawn.frame.left + drawn.frame.width * x, y: box.top + drawn.frame.top + drawn.frame.height * y });
                const place = at(0.4, 0.5);
                hover(place.x, place.y);
                rendered();

                if (state === 'empty') {
                    // Nothing to read: no number, and a key has nothing to step from (it is the plot's, and steps nothing).
                    assert.equal(reading(), null, 'nothing read');
                    assert.equal(key(1), false, 'a key steps nothing');
                    assert.equal(reading(), null);
                    return;
                }
                const fresh = (x: number, y: number, on: StagePlot = drawn) => {
                    const other = createPlotHoverLayer(document);
                    other.show(canvas, on, x, y, null);
                    return other.reading();
                };
                if (state === 'fetched' || state === 'failed') {
                    // No number while the points are on their way, or after a failure: never another line's (R7).
                    assert.equal(reading(), null, 'no number yet');
                    assert.equal(canvas.dataset.plotRead, state === 'fetched' ? 'pending' : 'failed');
                    // A key meanwhile: taken once the points are in, from the point read there (A42).
                    assert.equal(key(1), true, 'the key waits for the points');
                    rendered();
                    if (state === 'fetched') source.release(); else source.recover();
                    rendered();
                    const under = fresh(place.x, place.y);
                    assert.ok(under?.full, 'the point under the pointer, once in');
                    const xs = under.layer.view.xs ?? [];
                    assert.ok(near(reading()?.at, xs[indexIn(xs, under.at) + 1]) || (view.kind === 'heatmap' && reading()?.at !== under.at), `the key's step taken once in: ${reading()?.at} after ${under.at}`);
                    // The pointer moved off and back: the point under it.
                    hover(place.x + 1, place.y);
                    rendered();
                    hover(place.x, place.y);
                    rendered();
                }
                const first = reading();
                assert.ok(first && first.full && first.at !== undefined, `${kind}: read from the full data`);
                const xs = first.layer.view.xs ?? [];
                const index = indexIn(xs, first.at);
                assert.ok(index >= 0, `${kind}: ${first.at} is one of the full data's xs`);
                // → the next point, ← back to the one before: symmetric (R7).
                assert.equal(key(1), true);
                rendered();
                assert.ok(near(reading()?.at, xs[index + 1]), `${kind}: → the next point`);
                assert.equal(key(-1), true);
                rendered();
                assert.ok(near(reading()?.at, xs[index]), `${kind}: ← back`);
                // Two keys before the next frame: two points (a lane shows a step on its next frame).
                key(1); key(1);
                rendered();
                assert.ok(near(reading()?.at, xs[index + 2]), `${kind}: two keys, two points`);
                const stepped = reading()?.at;
                // A redraw at the same place: the same point (A46).
                drawn = draw();
                frame();
                assert.ok(near(reading()?.at, stepped), `${kind}: the same point after a redraw`);
                // A resize: the same point, read again on the plot drawn at its new size, on the plot.
                box.width = W + 120; box.height = H + 40;
                drawn = draw();
                frame();
                assert.ok(near(reading()?.at, stepped), `${kind}: the same point after a resize`);
                const shown = reading();
                assert.ok(shown && shown.x >= drawn.frame.left - 0.5 && shown.x <= drawn.frame.left + drawn.frame.width + 0.5, 'on the plot');
                // Moved on screen by a resize (no scroll) under the still pointer: the point stepped to is read on
                // (only a scroll lets it go, R7), where it is drawn now.
                {
                    const moved = createPlotHoverLayer(document);
                    const truePointer = pointer!;
                    moved.show(canvas, drawn, truePointer.x, truePointer.y, null);
                    const stepTo = moved.stepFrom(canvas, drawn, 1);
                    const steppedTo = moved.reading();
                    if (stepTo && steppedTo) {
                        moved.show(canvas, drawn, truePointer.x, truePointer.y, null);
                        const at = moved.reading()?.at;
                        box.left += 24;
                        drawn = draw();
                        moved.show(canvas, drawn, truePointer.x, truePointer.y, null);
                        assert.ok(near(moved.reading()?.at, at), `${kind}: moved by a resize, the point stepped to is still read`);
                        box.left -= 24;
                        drawn = draw();
                    }
                    moved.hide();
                }
                // + / −: zoomed off the point stepped to, it is let go: never read off the plot (the pointer's place is read).
                const shownAt = (shown.x - drawn.frame.left) / drawn.frame.width;
                drawn = draw({ window: shownAt < 0.55 ? { start: 0.6, end: 0.9 } : { start: 0.05, end: 0.35 } });
                frame();
                const zoomed = reading();
                assert.ok(!near(zoomed?.at, stepped), `${kind}: the point off the window is not read`);
                if (zoomed) assert.ok(zoomed.x >= drawn.frame.left - 0.5 && zoomed.x <= drawn.frame.left + drawn.frame.width + 0.5, 'what is read is on the plot');
                // Outside the zoomed window: at its right edge the key cannot step past it; the readout stays.
                const edge = at(0.999, 0.45);
                hover(edge.x, edge.y);
                rendered();
                const atEdge = reading();
                if (atEdge) {
                    let steps = 0;
                    while (key(1) && steps < 64) { rendered(); steps++; }
                    rendered();
                    const last = reading();
                    assert.ok(last, `${kind}: the readout stays at the window's edge`);
                    const lastXs = last.layer.view.xs ?? [];
                    assert.ok(indexIn(lastXs, last.at) < lastXs.length - 1 || view.kind === 'heatmap', `${kind}: stopped at the window, not the data's end`);
                    assert.ok(last.x <= drawn.frame.left + drawn.frame.width + 0.5, 'on the plot');
                }
                // 0: the whole again. Past either end of the data: the last key steps nothing, the readout stays.
                drawn = draw();
                for (const [fx, delta] of [[0.999, 1], [0.001, -1]] as const) {
                    const end = at(fx, 0.5);
                    hover(end.x, end.y);
                    rendered();
                    if (!reading()) continue;
                    let steps = 0;
                    while (key(delta) && steps < 64) { rendered(); steps++; }
                    rendered();
                    assert.ok(reading(), `${kind}: past the ${delta > 0 ? 'last' : 'first'} point the readout stays`);
                    assert.equal(key(delta), false, 'and a key steps nothing');
                }
                // A box zoom or Alt+drag let go elsewhere: the owner hovers where it was let go, on what it drew.
                drawn = draw({ window: { start: 0.2, end: 0.8 } });
                const release = at(0.6, 0.4);
                hover(release.x, release.y);
                rendered();
                const there = fresh(release.x, release.y);
                assert.equal(reading()?.at, there?.at, `${kind}: read where the drag was let go`);
                assert.equal(reading()?.row, there?.row);
                // A scroll under a still pointer: the point now under it, never the one stepped to before.
                drawn = draw();
                hover(place.x, place.y);
                rendered();
                key(1);
                rendered();
                box.top += 30;
                document.dispatchEvent(new window.Event('scroll'));
                frame();
                const scrolled = fresh(pointer!.x, pointer!.y);
                assert.equal(reading()?.at, scrolled?.at, `${kind}: after a scroll, the point under the pointer`);
                box.top -= 30;
                // The focus or the pointer gone: nothing read; back: read again.
                layer.hide();
                assert.equal(reading(), null);
                assert.equal(slot?.hidden, true, 'its readout row emptied');
                hover(place.x, place.y);
                rendered();
                assert.ok(reading(), 'read again');
            });
        }
        const silent = withSilence(view);
        if (silent && !chart.mapped) {
            test(`${kind} on the ${chart.name}: ← / → through −300 for four points step one point at a time on plain values, cross a level's silence in one, and → and ← agree (R7)`, () => {
                const { window } = new JSDOM('<!doctype html><body><div class="plot-readout" hidden><span></span><span></span></div></body>');
                const document = window.document;
                const canvas = canvasFor(document);
                const layer = createPlotHoverLayer(document);
                for (const fetched of [false, true]) {
                    // Fetched: answered as fetchedSource answers from what the backend sent (seek: full_read._seek_line).
                    const whole = held(silent.view);
                    const full: FullSource = fetched ? fullSource('fetched', { line: (query, ready) => whole.line(query, ready) }) : whole;
                    const drawn = chart.draw(canvas, silent.view, full, { size: { width: W, height: H } });
                    assert.ok(drawn);
                    const xs: readonly number[] = silent.view.xs ?? [];
                    const k: number = silent.k;
                    // Read the point k by stepping from the start of the plot's line to it.
                    const startX = drawn.xAt(xs[k]);
                    layer.show(canvas, drawn, startX, drawn.frame.top + drawn.frame.height / 2, null);
                    let guard = 0;
                    while ((layer.reading()?.at ?? -Infinity) < xs[k] && guard++ < 64) {
                        const next = layer.stepFrom(canvas, drawn, 1);
                        if (!next) break;
                        layer.show(canvas, drawn, next.clientX, next.clientY, null);
                    }
                    while ((layer.reading()?.at ?? Infinity) > xs[k] && guard++ < 128) {
                        const next = layer.stepFrom(canvas, drawn, -1);
                        if (!next) break;
                        layer.show(canvas, drawn, next.clientX, next.clientY, null);
                    }
                    assert.equal(layer.reading()?.at, xs[k], `${kind}: at the point before the run`);
                    // A Δ has no silent floor (−300 dB is a Δ): its points step one at a time, as plain values do.
                    const plain = floorless(silent.view, !!chart.diff);
                    const step = (delta: -1 | 1): number | undefined => {
                        const next = layer.stepFrom(canvas, drawn, delta);
                        assert.ok(next, 'a key steps');
                        layer.show(canvas, drawn, next.clientX, next.clientY, null);
                        return layer.reading()?.at;
                    };
                    if (plain) {
                        // Every point is a value: one at a time, −300 read as it is, and back the same way.
                        for (let point = k + 1; point <= k + 5; point++) assert.equal(step(1), xs[point], `${kind}: → reads the point at ${point}`);
                        assert.equal(layer.reading()?.value, silent.view.values?.[k + 5]);
                        for (let point = k + 4; point >= k; point--) assert.equal(step(-1), xs[point], `${kind}: ← reads the point at ${point}`);
                    } else {
                        // A level's silence is crossed in one key, either way.
                        assert.equal(step(1), xs[k + 5], `${kind}: → past the silence`);
                        assert.equal(step(-1), xs[k], `${kind}: ← back past it`);
                    }
                    layer.hide();
                }
            });
        }
    }
}

test('every chart reads through the one readout: outside plotHoverLayer no runtime code reads or steps a point itself (the lanes keep no readout of their own); a trigger\'s event click is decided on the clicked plot only (R7)', () => {
    const root = path.resolve(__dirname, '..', '..', 'src', 'webview');
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith('.ts')) files.push(full);
        }
    };
    walk(root);
    // stagePanes defines the reads; trackStageGestures decides a click (not a readout) on the line under it.
    const allowed = new Set(['runtime/stagePanes.ts', 'runtime/plotHoverLayer.ts', 'runtime/trackStageGestures.ts']);
    const readers = files.filter(file => /\b(stageHover|stageStep|stageReadAgain)\(/.test(readFileSync(file, 'utf8'))).map(file => path.relative(root, file).split(path.sep).join('/'));
    assert.deepEqual(readers.filter(file => !allowed.has(file)), []);
    const gestures = readFileSync(path.join(root, 'runtime', 'trackStageGestures.ts'), 'utf8');
    assert.equal((gestures.match(/\bstage(Hover|Step|ReadAgain)\(/g) ?? []).length, 1, 'only the event line under a click');
    // The lanes' old parallel readout is gone: they show and step through laneMarks.
    const lanes = readFileSync(path.join(root, 'runtime', 'comparisonRuntime.ts'), 'utf8');
    assert.doesNotMatch(lanes, /\blaneRead\b|\blaneStepped\b|\bsteppedRead\b/);
    assert.match(lanes, /laneMarks\.stepFrom\(/);
});

test('the transitions table runs every Frame kind on every chart in every state of its full data, and every line through a silence (R7)', () => {
    // Each case above is a test of its own; this names the table's extent, so a kind or chart left out is seen.
    const cases = Object.values(KINDS).flatMap(view => CHARTS.filter(chart => view.kind !== 'heatmap' || chart.images).flatMap(chart => STATES.map(state => `${chart.name}:${state}:${view.frame}`)));
    const images = Object.values(KINDS).filter(view => view.kind === 'heatmap').length;
    assert.equal(cases.length, (Object.keys(KINDS).length * CHARTS.length - images * CHARTS.filter(chart => !chart.images).length) * STATES.length);
    assert.ok(Object.keys(KINDS).length >= 12 && CHARTS.length === 4 && STATES.length === 4);
    const silences = Object.values(KINDS).filter(view => withSilence(view) !== null);
    assert.ok(silences.some(view => floorless(view)) && silences.some(view => !floorless(view)), 'plain values and levels both cross a silence');
});
