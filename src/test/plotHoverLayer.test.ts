import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPlotHoverLayer } from '../webview/runtime/plotHoverLayer';
import type { StageLayer, StagePlot } from '../webview/runtime/stagePanes';

/** A plot 100 px wide from x 50, its levels 0–10 over 100 px from y 10, with `lines` (and `right` on a right-hand axis). */
function plotWith(lines: StageLayer[], right: StageLayer[] = []): StagePlot {
    const frame = { left: 50, top: 10, width: 100, height: 100 };
    const base = { frame, xAt: (x: number) => 50 + x * 10, ratioStep: 1, diff: false };
    const plot: StagePlot = { ...base, yAt: (v: number) => 110 - v * 10, lines };
    if (right.length) plot.secondary = { ...base, yAt: (v: number) => 110 - (v + 100) * 10, lines: right };
    return plot;
}
const line = (label: string, color: string, values: number[]): StageLayer => ({ view: { frame: 'spectrum', kind: 'line', x: 'frequency', quantity: 'value', xs: values.map((_, i) => i), values }, color, label });

function setup() {
    const { window } = new JSDOM('<!doctype html><body><div class="plot-readout" hidden><span></span><span></span></div><canvas id="plot"></canvas></body>');
    const segments: Array<[number, number, number, number]> = [];
    let from: [number, number] = [0, 0];
    const context = new Proxy({}, { get(_t, prop) {
        if (prop === 'moveTo') return (x: number, y: number) => { from = [x, y]; };
        if (prop === 'lineTo') return (x: number, y: number) => { segments.push([from[0], from[1], x, y]); };
        return () => undefined;
    }, set: () => true });
    window.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    const plot = window.document.getElementById('plot') as HTMLElement;
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 120, right: 200, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
    const slot = window.document.querySelector<HTMLElement>('.plot-readout');
    return { window, plot, slot, segments, layer: createPlotHoverLayer(window.document) };
}

test('an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)', () => {
    const { plot, slot, layer } = setup();
    const drawn = plotWith([line('a', '#f00', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]);
    assert.deepEqual(layer.stepFrom(plot, drawn, 1), { clientX: 50, clientY: 60 });
    layer.show(plot, drawn, 82, 70, slot);
    assert.equal(layer.reading()?.index, 3);
    const next = layer.stepFrom(plot, drawn, 1);
    assert.ok(next);
    assert.deepEqual(next, { clientX: 90, clientY: 60 });
    layer.show(plot, drawn, next.clientX, next.clientY, slot);
    assert.equal(layer.reading()?.index, 4);
    assert.match(slot!.textContent ?? '', /^a \/ /u);
    assert.deepEqual(layer.stepFrom(plot, drawn, 0), next, '0 reads the point it reads');
    // Past the line's end there is no point to step to.
    layer.show(plot, drawn, 140, 10, slot);
    assert.equal(layer.stepFrom(plot, drawn, 1), null);
    layer.hide();
    assert.equal(layer.reading(), null);
});

test('with two level axes a point is read on either, and the level guide runs only to the axis it is read on', () => {
    const { plot, slot, layer, segments } = setup();
    const drawn = plotWith([line('left', '#00f', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])], [line('right', '#ff0', [-91, -91, -91, -91, -91, -91, -91, -91, -91, -91])]);
    // The right-hand axis' line is drawn at y 20, the left one's at y 100.
    layer.show(plot, drawn, 100, 22, slot);
    assert.equal(layer.reading()?.layer.label, 'right');
    const has = (segment: number[]): boolean => segments.some(drawnSegment => drawnSegment.join() === segment.join());
    assert.ok(has([100, 20, 150, 20]) && !has([50, 20, 150, 20]), 'from the point to the right-hand axis');
    segments.length = 0;
    layer.show(plot, drawn, 100, 98, slot);
    assert.equal(layer.reading()?.layer.label, 'left');
    assert.ok(has([50, 100, 100, 100]) && !has([50, 100, 150, 100]), 'from the left-hand axis to the point');
});
