import { testLine } from './helpers/whole';
import assert from 'node:assert/strict';
import test from 'node:test';
import { held } from './helpers/heldSource';
import { JSDOM } from 'jsdom';
import { STEP_AHEAD, type FullSource, fullSource } from '../webview/runtime/fullRead';
import { createPlotHoverLayer } from '../webview/runtime/plotHoverLayer';
import type { StageLayer, StagePlot } from '../webview/runtime/stagePanes';

/** A plot 100 px wide from x 50, its levels 0–10 over 100 px from y 10, with `lines` (and `right` on a right-hand axis). */
function plotWith(lines: StageLayer[], right: StageLayer[] = []): StagePlot {
    const frame = { left: 50, top: 10, width: 100, height: 100 };
    const base = { frame, xAt: (x: number) => 50 + x * 10, xOf: (x: number) => (x - 50) / 10, ratioStep: 1, diff: false };
    const plot: StagePlot = { ...base, yAt: (v: number) => 110 - v * 10, lines };
    if (right.length) plot.secondary = { ...base, yAt: (v: number) => 110 - (v + 100) * 10, lines: right };
    return plot;
}
const line = (label: string, color: string, values: number[]): StageLayer => ({ view: { frame: 'spectrum', kind: 'line', x: 'frequency', quantity: 'value', xs: values.map((_, i) => i), values }, color, label, full: held({ frame: 'spectrum', kind: 'line', x: 'frequency', quantity: 'value', xs: values.map((_, i) => i), values }) });

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

test('with two level axes a line a level zoom clips off the plot is not read over a point on it within the pick radius', () => {
    const { plot, slot, layer } = setup();
    const drawn = plotWith([line('shown', '#00f', [8, 8, 8, 8, 8, 8, 8, 8, 8, 8])], [line('clipped', '#ff0', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
    // The right-hand axis is zoomed so its line is far above the plot: drawn off it, its point held at the top edge (y 10).
    const secondary = drawn.secondary!;
    secondary.lineYAt = secondary.yAt;
    secondary.yAt = (v: number) => Math.max(10, Math.min(110, 110 - (v + 100) * 10));
    // The pointer 5 px under the top edge, 15 px over the shown line (at y 30): that line's point is read.
    layer.show(plot, drawn, 100, 15, slot);
    assert.equal(layer.reading()?.layer.label, 'shown');
    assert.match(slot!.textContent ?? '', /^shown \/ /u);
});

test('an arrow key steps to a point above or below the level axis as the pointer reads it there, held at the plot\'s edge (R7)', () => {
    const { plot, slot, layer } = setup();
    // Levels 0–10 on the plot; from the fourth point on the line is far below it (a floor at −100).
    const drawn = plotWith([line('a', '#f00', [5, 5, 5, -100, -100, -100, -100, -100, -100, -100])]);
    drawn.lineYAt = drawn.yAt;
    drawn.yAt = (v: number) => Math.max(10, Math.min(110, 110 - v * 10));
    layer.show(plot, drawn, 70, 60, slot);
    assert.equal(layer.reading()?.index, 2);
    // The next point is at the bottom edge, where the pointer would read it.
    assert.deepEqual(layer.stepFrom(plot, drawn, 1), { clientX: 80, clientY: 110 });
    layer.show(plot, drawn, 80, 110, slot);
    assert.equal(layer.reading()?.index, 3);
    assert.deepEqual(layer.stepFrom(plot, drawn, 1), { clientX: 90, clientY: 110 });
});

test('a step that waits for its points is taken, once they are in, through the owner\'s hover, so the place it keeps is the new one (R7)', () => {
    const { plot, slot, layer } = setup();
    const xs = Array.from({ length: 10 }, (_, i) => i), values = xs.map(i => i + 0.5);
    const whole = testLine(xs, values);
    let later: (() => void) | null = null;
    let held = true;
    // The hover's points are at hand; a step's (STEP_AHEAD) come later.
    const full: FullSource = fullSource('fetched', {
        line(query, ready) {
            if (query.beyond === STEP_AHEAD && held) { later = ready; return undefined; }
            return whole.line({ ...query, beyond: Math.min(query.beyond, 1) }, ready);
        },
    });
    const drawn: StagePlot = { ...plotWith([{ ...line('a', '#f00', values), full }]), xOf: (x: number) => (x - 50) / 10, levelOf: (y: number) => (110 - y) / 10 };
    layer.show(plot, drawn, 80, 75, slot);
    assert.equal(layer.reading()?.at, 3);
    const owner: Array<{ clientX: number; clientY: number }> = [];
    const at = layer.stepFrom(plot, drawn, 1, place => { owner.push(place); layer.show(plot, drawn, place.clientX, place.clientY, slot); });
    assert.deepEqual(at, { clientX: 80, clientY: 75 }, 'meanwhile, the point read');
    // A redraw at the point read meanwhile (a repaint) does not drop the step.
    layer.show(plot, drawn, 80, 75, slot);
    held = false;
    (later as (() => void) | null)?.();
    assert.deepEqual(owner, [{ clientX: 90, clientY: 65 }], 'the owner is told where the step went');
    assert.equal(layer.reading()?.at, 4);
});

test('keys pressed while a step waits for its next points add up: three keys, three points, however late the points come (R7)', () => {
    for (const keys of [1, 2, 3] as const) {
        const { plot, slot, layer } = setup();
        const xs = Array.from({ length: 10 }, (_, i) => i), values = xs.map(i => i + 0.5);
        const whole = testLine(xs, values);
        const later: Array<() => void> = [];
        let held = true;
        const full: FullSource = fullSource('fetched', {
            line(query, ready) {
                if (query.beyond === STEP_AHEAD && held) { later.push(ready); return undefined; }
                return whole.line(query, ready);
            },
        });
        const drawn: StagePlot = { ...plotWith([{ ...line('a', '#f00', values), full }]), xOf: (x: number) => (x - 50) / 10, levelOf: (y: number) => (110 - y) / 10 };
        layer.show(plot, drawn, 80, 75, slot);
        assert.equal(layer.reading()?.at, 3);
        const arrived = (place: { clientX: number; clientY: number }): void => { layer.show(plot, drawn, place.clientX, place.clientY, slot); };
        for (let key = 0; key < keys; key++) {
            const at = layer.stepFrom(plot, drawn, 1, arrived);
            assert.deepEqual(at, { clientX: 80, clientY: 75 }, 'meanwhile, the point read');
            if (at) layer.show(plot, drawn, at.clientX, at.clientY, slot);
        }
        held = false;
        for (const ready of later.splice(0)) ready();
        assert.equal(layer.reading()?.at, 3 + keys, `${keys} keys, ${keys} points`);
    }
});

test('an arrow key pressed while the readout waits for its points is taken once they are in: the point it steps to, never lost and never an empty readout; two keys, two points (A42, R7)', () => {
    for (const keys of [1, 2] as const) {
        const { plot, slot, layer } = setup();
        const xs = Array.from({ length: 10 }, (_, i) => i), values = xs.map(i => i + 0.5);
        const whole = testLine(xs, values);
        const waiting: Array<() => void> = [];
        let held = true;
        // Every read waits until the points come in.
        const full: FullSource = fullSource('fetched', { line(query, ready) { if (held) { waiting.push(ready); return undefined; } return whole.line(query, ready); } });
        const drawn: StagePlot = { ...plotWith([{ ...line('a', '#f00', values), full }]), xOf: (x: number) => (x - 50) / 10, levelOf: (y: number) => (110 - y) / 10 };
        layer.show(plot, drawn, 80, 75, slot);
        assert.equal(layer.reading(), null, 'pending: no number yet');
        // The keys while pending: the place stays the pointer's, and the owner shows there, as any step.
        const owner: Array<{ clientX: number; clientY: number }> = [];
        const arrived = (place: { clientX: number; clientY: number }): void => { owner.push(place); layer.show(plot, drawn, place.clientX, place.clientY, slot); };
        for (let key = 0; key < keys; key++) {
            const at = layer.stepFrom(plot, drawn, 1, arrived);
            assert.deepEqual(at, { clientX: 80, clientY: 75 }, 'meanwhile, the pointer\'s place');
            if (at) layer.show(plot, drawn, at.clientX, at.clientY, slot);
        }
        assert.equal(layer.reading(), null, 'still no number');
        held = false;
        for (const ready of waiting.splice(0)) ready();
        // The point under the pointer is 3: the keys step from it once it is read.
        assert.equal(layer.reading()?.at, 3 + keys, `${keys} key(s): the point stepped to once the points are in`);
        assert.ok(slot?.textContent?.includes(`${3 + keys}.5`), `the readout shows it: ${slot?.textContent}`);
        assert.equal(owner.length, 1, 'the owner is told where the steps went');
    }
});

test('keys pressed while the readout waits are dropped when the pointer moves on before the points are in (R7)', () => {
    const { plot, slot, layer } = setup();
    const xs = Array.from({ length: 10 }, (_, i) => i), values = xs.map(i => i + 0.5);
    const whole = testLine(xs, values);
    const waiting: Array<() => void> = [];
    let held = true;
    const full: FullSource = fullSource('fetched', { line(query, ready) { if (held) { waiting.push(ready); return undefined; } return whole.line(query, ready); } });
    const drawn: StagePlot = { ...plotWith([{ ...line('a', '#f00', values), full }]), xOf: (x: number) => (x - 50) / 10, levelOf: (y: number) => (110 - y) / 10 };
    layer.show(plot, drawn, 80, 75, slot);
    layer.stepFrom(plot, drawn, 1);
    layer.show(plot, drawn, 60, 75, slot);
    held = false;
    for (const ready of waiting.splice(0)) ready();
    // (60, 75) reads the point at 2 (14 px away, nearer than the one at 1 below it): no key taken from it.
    assert.equal(layer.reading()?.at, 2, 'the point under the pointer where it went');
});

test('a point stepped to above the level axis stays read when the plot is drawn again there, never the neighbour on the plot (A46, R7)', () => {
    const { plot, slot, layer } = setup();
    // Levels 0–10 on the plot; a narrow peak at the fourth point is far above it, its neighbours on it.
    const values = [5, 5, 9, 100, 9, 5, 5, 5, 5, 5];
    const draw = (): StagePlot => {
        const drawn = plotWith([line('a', '#f00', values)]);
        drawn.lineYAt = drawn.yAt;
        drawn.yAt = (v: number) => Math.max(10, Math.min(110, 110 - v * 10));
        return drawn;
    };
    const first = draw();
    layer.show(plot, first, 70, 20, slot);
    assert.equal(layer.reading()?.at, 2);
    const at = layer.stepFrom(plot, first, 1);
    assert.deepEqual(at, { clientX: 80, clientY: 10 });
    layer.show(plot, first, 80, 10, slot);
    assert.equal(layer.reading()?.at, 3, 'the peak, held at the top edge');
    // The cursor spectrum draws itself again after a hover: the same place, a new drawing.
    const again = draw();
    layer.show(plot, again, 80, 10, slot);
    assert.equal(layer.reading()?.at, 3, 'still the peak after the redraw');
    assert.deepEqual(layer.stepFrom(plot, again, 1), { clientX: 90, clientY: 20 }, 'and the next key goes past it');
    // A pointer move reads where it is again.
    layer.show(plot, again, 60, 60, slot);
    assert.equal(layer.reading()?.at, 1);
});

/** A line over 0..9 whose full data is held, on its way (`pending`) or failed (`failed`, its readers told once it recovers). */
function gatedLine(values: number[]) {
    const xs = values.map((_, i) => i);
    const whole = testLine(xs, values);
    const waiting: Array<() => void> = [];
    const gate = { mode: 'held' as 'held' | 'pending' | 'failed' };
    const full: FullSource = fullSource('fetched', {
        line(query, ready) {
            if (gate.mode === 'pending') { waiting.push(ready); return undefined; }
            if (gate.mode === 'failed') { waiting.push(ready); return null; }
            return whole.line(query, ready);
        },
    });
    const set = (mode: typeof gate.mode): void => { gate.mode = mode; if (mode === 'held') for (const ready of waiting.splice(0)) ready(); };
    const draw = (): StagePlot => ({ ...plotWith([{ ...line('a', '#f00', values), full }]), xOf: (x: number) => (x - 50) / 10, levelOf: (y: number) => (110 - y) / 10 });
    return { draw, set, waiting };
}

test('the point stepped to is read again on every drawing: an empty one reads nothing (never its old value or line), the next with data reads it again (R7)', () => {
    const { plot, slot, layer, segments } = setup();
    const { draw } = gatedLine([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    const first = draw();
    // The pointer stays at (80, 75); the owner shows a step there, at the true pointer.
    layer.show(plot, first, 80, 75, slot);
    assert.equal(layer.reading()?.at, 3);
    const at = layer.stepFrom(plot, first, 1);
    assert.deepEqual(at, { clientX: 90, clientY: 65 });
    layer.show(plot, first, 80, 75, slot);
    assert.equal(layer.reading()?.at, 4, 'the point stepped to, read at the pointer');
    // Drawn anew with nothing on it (a step computing): no number, no line, the point kept.
    segments.length = 0;
    layer.show(plot, null, 80, 75, slot);
    assert.equal(layer.reading(), null, 'an empty drawing reads nothing');
    assert.equal(plot.dataset.plotRead, 'pending');
    assert.equal(slot?.querySelector('span:last-child')?.textContent ?? '', '', 'its old value is not shown');
    const again = draw();
    layer.show(plot, again, 80, 75, slot);
    assert.equal(layer.reading()?.at, 4, 'read again on the drawing with its data');
});

test('a key while the point stepped to is read again on a new drawing waits for that read: it steps from the new data, never the old drawing (R7)', () => {
    const { plot, slot, layer } = setup();
    const old = gatedLine([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    const next = gatedLine([0.25, 1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25]);
    const first = old.draw();
    layer.show(plot, first, 80, 75, slot);
    layer.stepFrom(plot, first, 1);
    layer.show(plot, first, 80, 75, slot);
    assert.equal(layer.reading()?.at, 4);
    // Redrawn with new data whose points are on their way: the key waits for them.
    next.set('pending');
    const redrawn = next.draw();
    // The key comes before the owner shows the new drawing (a lane shows on its next frame), and again after it.
    for (const before of [true, false]) {
        if (!before) { layer.hide(); layer.show(plot, first, 80, 75, slot); layer.stepFrom(plot, first, 1); layer.show(plot, first, 80, 75, slot); }
        if (!before) layer.show(plot, redrawn, 80, 75, slot);
        if (!before) assert.equal(layer.reading(), null, 'pending: no number');
        const key = layer.stepFrom(plot, redrawn, 1);
        assert.ok(key, 'the key is kept');
        layer.show(plot, redrawn, 80, 75, slot);
        assert.equal(layer.reading(), null, `still no number, no step from the old drawing (${before ? 'before' : 'after'} the owner shows)`);
        if (before) { next.set('held'); assert.equal(layer.reading()?.at, 5); assert.equal(layer.reading()?.value, 5.25); next.set('pending'); }
    }
    next.set('held');
    assert.equal(layer.reading()?.at, 5, 'one step from the point read again');
    assert.equal(layer.reading()?.value, 5.25, 'of the new data');
});

test('a re-read on a new drawing that fails keeps the point stepped to and reads it once the backend answers again (R7)', () => {
    const { plot, slot, layer } = setup();
    const source = gatedLine([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    const first = source.draw();
    layer.show(plot, first, 80, 75, slot);
    layer.stepFrom(plot, first, 1);
    layer.show(plot, first, 80, 75, slot);
    assert.equal(layer.reading()?.at, 4);
    source.set('failed');
    const redrawn = source.draw();
    layer.show(plot, redrawn, 80, 75, slot);
    assert.equal(layer.reading(), null, 'failed: no number');
    assert.equal(plot.dataset.plotRead, 'failed');
    source.set('held');
    assert.equal(layer.reading()?.at, 4, 'the point stepped to, not the one under the pointer (3)');
});

test('keys waiting for a seek whose read fails are kept and taken once the backend answers again: three keys, three points (R7)', () => {
    const { plot, slot, layer } = setup();
    const source = gatedLine([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    const drawn = source.draw();
    layer.show(plot, drawn, 80, 75, slot);
    assert.equal(layer.reading()?.at, 3);
    const arrived = (): void => { layer.show(plot, drawn, 80, 75, slot); };
    source.set('pending');
    for (let key = 0; key < 3; key++) layer.stepFrom(plot, drawn, 1, arrived);
    // The backend fails the seek: the keys stay; it answers after its pause.
    source.set('failed');
    for (const ready of source.waiting.splice(0)) ready();
    assert.equal(layer.reading()?.at, 3, 'nothing taken meanwhile');
    source.set('held');
    assert.equal(layer.reading()?.at, 6, 'three keys, three points');
});

test('the true pointer and the point stepped to are kept apart: a step the new drawing no longer shows is let go and the true pointer read, wherever the owner shows (R7)', () => {
    const { plot, slot, layer } = setup();
    const values = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5];
    const source = gatedLine(values);
    const first = source.draw();
    layer.show(plot, first, 80, 75, slot);
    const at = layer.stepFrom(plot, first, 1)!;
    // An owner that shows at the step's place: the step is read there too.
    layer.show(plot, first, at.clientX, at.clientY, slot);
    assert.equal(layer.reading()?.at, 4);
    // Zoomed so the point stepped to is off the window (x 4 is left of the frame): let go, the true pointer read.
    const zoomed: StagePlot = { ...source.draw(), xAt: (x: number) => 50 + (x - 4.5) * 20, xOf: (x: number) => (x - 50) / 20 + 4.5 };
    layer.show(plot, zoomed, at.clientX, at.clientY, slot);
    const fresh = createPlotHoverLayer(plot.ownerDocument);
    fresh.show(plot, zoomed, 80, 75, null);
    assert.ok(layer.reading(), 'a point is read');
    assert.equal(layer.reading()?.at, fresh.reading()?.at, 'the point at the true pointer, not at the step\'s place');
});

test('keys pressed while the plot has no drawing (its picture on its way) wait with the point read: two keys, two points once it is drawn (R7)', () => {
    const { plot, slot, layer } = setup();
    const source = gatedLine([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    const first = source.draw();
    layer.show(plot, first, 80, 75, slot);
    layer.stepFrom(plot, first, 1);
    layer.show(plot, first, 80, 75, slot);
    assert.equal(layer.reading()?.at, 4);
    // The picture is made anew: no drawing yet. The owner's keys come before it shows that, and after.
    assert.ok(layer.stepFrom(plot, null, 1), 'the key is kept');
    layer.show(plot, null, 80, 75, slot);
    assert.ok(layer.stepFrom(plot, null, 1), 'and the next');
    layer.show(plot, null, 80, 75, slot);
    assert.equal(layer.reading(), null, 'nothing read meanwhile');
    layer.show(plot, source.draw(), 80, 75, slot);
    assert.equal(layer.reading()?.at, 6, 'two keys, two points from the point stepped to');
});
