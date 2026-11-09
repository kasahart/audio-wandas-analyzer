import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { StageView } from '../shared/protocol/backendProtocol';
import type { FullSource } from '../webview/runtime/fullRead';
import { createPlotHoverLayer } from '../webview/runtime/plotHoverLayer';
import type { PaneRange } from '../webview/runtime/comparePanes';
import { paintOverlay, stageRange, type StagePlot } from '../webview/runtime/stagePanes';
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
    const wait = <Q, A>(read: ((query: Q, ready: () => void) => A) | undefined) => read && ((query: Q, ready: () => void): A | undefined => {
        if (holding) { waiting.push(ready); return undefined; }
        return read(query, ready);
    });
    const of = (whole: StageView): FullSource => {
        const inner = held(whole);
        const event = whole.events ? (id: number): FullSource => { const one = whole.events!.find(item => item.id === id)!; return of({ ...whole, events: undefined, xs: one.xs, values: one.values }); } : undefined;
        if (!fetched) return event ? { ...inner, event } : inner;
        return { held: 'fetched', line: wait(inner.line?.bind(inner)), cells: wait(inner.cells?.bind(inner)), ...(event ? { event } : {}) };
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
                const plot = paintOverlay(canvas, { layers: [{ view, color: '#36c', label: 'a.wav', full: source.full }] }, on, { x: 'x', y: 'y', ...(view.kind === 'heatmap' ? { colour: 'Level [dBFS]' } : {}) }, { size: { width: W, height: H } });
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
