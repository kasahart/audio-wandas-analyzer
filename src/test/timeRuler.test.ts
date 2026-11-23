/**
 * The time ruler above the Tracks rows (src/webview/runtime/timeRuler.ts): the one axis the screen draws itself. Its
 * ticks are the Figure's (figure/ticks.ts), its name is fitted as every axis name is (figure/axisTitle.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { alongAxisTicks } from '../webview/figure/ticks';
import { linearWindowEnds, paintTimeRuler, timeRulerTicks } from '../webview/runtime/timeRuler';

test('the ruler\'s ticks are the Figure\'s time ticks, each at its time\'s place over the rows\' width', () => {
    const ticks = timeRulerTicks(2, 12, 500);
    const figure = alongAxisTicks(2, 12);
    assert.ok(figure.length >= 3, 'the Figure ticks a time axis of 10 s');
    assert.deepEqual(ticks.map(tick => tick.text), figure.map(tick => tick.text), 'the numbers are the Figure\'s own (figure/ticks.ts alongAxisTicks): the ruler makes none');
    // Each at its time: 50 px a second from 2 s.
    for (const [index, tick] of ticks.entries()) assert.ok(Math.abs(tick.x - (figure[index].value - 2) * 50) < 1e-9, `the tick ${tick.text} is at ${tick.x}px, not at its time ${figure[index].value} s`);
    // A zoomed part's ends are the ends its range popover writes (figureModel.fieldWindow, R9); the whole axis keeps its own.
    assert.deepEqual(linearWindowEnds(0, 10, { start: 0, end: 1 }), { min: 0, max: 10 });
    const zoomed = linearWindowEnds(0, 10, { start: 0.25, end: 0.5 });
    assert.ok(Math.abs(zoomed.min - 2.5) < 1e-9 && Math.abs(zoomed.max - 5) < 1e-9, JSON.stringify(zoomed));
});

/** A canvas that records the text written on it, each with its font; a character is 6 px wide at 10 px. */
function recordingCanvas(width: number): { canvas: HTMLCanvasElement; texts: Array<{ text: string; x: number; font: string }> } {
    const texts: Array<{ text: string; x: number; font: string }> = [];
    const context = {
        font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        measureText(text: string) { return { width: [...text].length * 6 * (parseFloat(/([\d.]+)px/u.exec(this.font)?.[1] ?? '10') / 10) }; },
        fillText(text: string, x: number) { texts.push({ text, x, font: this.font }); },
    };
    const canvas = { width, height: 20, dataset: {} as Record<string, string>, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, texts };
}

test('the ruler names its axis at its right end, fitted as every axis name is, and leaves out a number the name would cover', () => {
    const colors = { muted: '#888', line: '#444', text: '#ccc' };
    const ticks = [0, 100, 200, 300, 400, 480].map(x => ({ x, text: String(x / 100) }));
    const { canvas, texts } = recordingCanvas(500);
    paintTimeRuler(canvas, ticks, 'Time [s]', 500, colors);
    const name = texts[texts.length - 1];
    assert.equal(name.text, 'Time [s]', 'the name is written whole: quantity and unit (R4)');
    assert.ok(Math.abs(name.x + 8 * 6 + 2 - 500) < 1e-9, `the name ends at the right end of the rows' width (${name.x})`);
    // The tick at 480 px would be written under the name: its number is left out, its line is not this test's.
    assert.deepEqual(texts.slice(0, -1).map(item => item.text), ['0', '1', '2', '3', '4']);
    assert.equal((canvas as unknown as { dataset: Record<string, string> }).dataset.plotAxisCanvas, '', 'the canvas is marked as an axis canvas for the browser audit (canvasAudit.ts)');
    // In a narrow strip the name is made smaller or its quantity shortened, never dropped, and never longer than half the strip.
    const narrow = recordingCanvas(60);
    paintTimeRuler(narrow.canvas, [], 'Time [s]', 60, colors);
    const fitted = narrow.texts[narrow.texts.length - 1];
    assert.ok(fitted.text.includes('[s]'), `the unit stays (${fitted.text})`);
    const size = parseFloat(/([\d.]+)px/u.exec(fitted.font)?.[1] ?? '10');
    assert.ok([...fitted.text].length * 6 * (size / 10) <= 30 + 1e-9, `"${fitted.text}" at ${size}px is longer than half the strip`);
    // Numbers that would touch are not both written.
    const dense = recordingCanvas(500);
    paintTimeRuler(dense.canvas, [{ x: 0, text: '0.001' }, { x: 20, text: '0.002' }, { x: 60, text: '0.003' }], 'Time [s]', 500, colors);
    assert.deepEqual(dense.texts.slice(0, -1).map(item => item.text), ['0.001', '0.003']);
});
