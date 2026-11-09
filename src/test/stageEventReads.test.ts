import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { localLine, type FullSource } from '../webview/runtime/fullRead';
import { eventLayers, paintOverlay, stageHover, stageStep } from '../webview/runtime/stagePanes';

/** A canvas the plot component draws on through a context that draws nothing. */
function plotCanvas(): HTMLCanvasElement {
    const context = new Proxy({}, { get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => undefined), set: () => true });
    return { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
}

test('a trigger\'s event lines are each read at that event\'s every sample, never the points thinned to draw it, and ← / → step its samples (R7)', () => {
    // Three events of 0.1 s at 4.8 kHz (480 samples each); each is drawn thinned to every 12th sample.
    const rate = 4800, n = 480;
    const times = Array.from({ length: n }, (_, index) => index / rate - 0.01);
    const samples = [0, 1, 2].map(id => times.map((time, index) => (0.2 + 0.1 * id) * Math.sin(2 * Math.PI * (60 + 15 * id) * time) + (index % 7 === 3 ? 0.03 : 0)));
    const drawnAt = times.map((_, index) => index).filter(index => index % 12 === 0);
    const view = {
        frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: drawnAt.map(index => times[index]), values: [],
        events: [0, 1, 2].map(id => ({ id, time: 1 + id, values: drawnAt.map(index => samples[id][index]) })),
    } as StageView;
    // The recording's full data: each event's own samples (the backend's read of `event`).
    const full: FullSource = { held: 'inline', event: id => localLine(times, samples[id]) };
    const layers = eventLayers({ view, color: '#ff0', label: 'b.wav', full });
    assert.equal(layers.length, 3);
    const plot = paintOverlay(plotCanvas(), { layers }, { min: -0.6, max: 0.6 }, { x: 'Time [s]', y: 'Amplitude [FS]' });
    assert.ok(plot);
    // A sample of the second event between two drawn points, under the pointer.
    const at = 241;
    assert.ok(!drawnAt.includes(at), 'the sample is thinned out of the line drawn');
    const read = stageHover(plot, plot.xAt(times[at]), plot.yAt(samples[1][at]));
    assert.ok(read?.full, 'read from the event\'s full samples');
    assert.equal(read.layer.label, 'b.wav #2 @ 2.00 s');
    assert.equal(read.at, times[at]);
    assert.equal(read.value, samples[1][at]);
    let step = read;
    for (let k = 1; k <= 6; k++) {
        const next = stageStep(plot, step, 1);
        assert.ok(next);
        assert.equal(next.layer.label, read.layer.label, 'the same event');
        assert.equal(next.at, times[at + k], `step ${k} is the next sample`);
        assert.equal(next.value, samples[1][at + k]);
        step = next;
    }
});
