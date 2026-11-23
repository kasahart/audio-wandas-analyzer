/**
 * A figure's PNG names its lines on a strip above the figure (src/webview/figure/pngLegend.ts): the page's legend is
 * beside the canvas, so the image alone would not say which line is which recording.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withLegend } from '../webview/figure/pngLegend';

function fakeDocument() {
    const texts: Array<[string, number, number]> = [];
    const strokes: Array<[string, number, number]> = [];
    const draws: Array<[unknown, number, number]> = [];
    let scale = 1;
    const ctx = {
        font: '', textBaseline: '', textAlign: '', lineWidth: 0, strokeStyle: '', fillStyle: '',
        // Every character 6 px wide.
        measureText: (text: string) => ({ width: text.length * 6 }),
        scale: (x: number) => { scale = x; },
        setTransform: () => { scale = 1; },
        beginPath: () => undefined,
        moveTo(x: number, y: number) { strokes.push([this.strokeStyle, x, y]); },
        lineTo: () => undefined,
        stroke: () => undefined,
        fillText: (text: string, x: number, y: number) => { texts.push([text, x, y]); },
        drawImage: (image: unknown, x: number, y: number) => { draws.push([image, x, y]); },
    };
    const out = { width: 0, height: 0, getContext: () => ctx };
    return { document: { createElement: () => out } as unknown as Document, out, texts, strokes, draws, scaleNow: () => scale };
}

test('the figure goes under a strip that names each line after a stroke of its colour, in the order given', () => {
    const page = fakeDocument();
    // Drawn for 400 CSS px at two device pixels each.
    const figure = { width: 800, height: 300 } as unknown as HTMLCanvasElement;
    const made = withLegend(page.document, figure, [{ name: 'base · a.wav', colour: '#00f' }, { name: 'b.wav', colour: '#fc0' }], 400);
    assert.equal(made, page.out as unknown as HTMLCanvasElement);
    // One row of 18 CSS px (36 device px) above the figure, which is copied as it is.
    assert.deepEqual([page.out.width, page.out.height], [800, 336]);
    assert.deepEqual(page.draws, [[figure, 0, 36]]);
    assert.deepEqual(page.strokes, [['#00f', 8, 9], ['#fc0', 8 + 18 + 6 + 12 * 6 + 16, 9]]);
    assert.deepEqual(page.texts, [['base · a.wav', 32, 9], ['b.wav', 8 + 18 + 6 + 12 * 6 + 16 + 24, 9]]);
});

test('names that do not fit one row go on the next; with nothing to name the figure is handed back as it is', () => {
    const page = fakeDocument();
    const figure = { width: 200, height: 100 } as unknown as HTMLCanvasElement;
    // 200 CSS px: each entry is 24 + 20 × 6 = 144 px wide, so the second starts a row.
    const names = ['a'.repeat(20), 'b'.repeat(20)];
    withLegend(page.document, figure, names.map(name => ({ name, colour: '#fff' })), 200);
    assert.equal(page.out.height, 2 * 18 + 100);
    assert.deepEqual(page.texts.map(([, x, y]) => [x, y]), [[32, 9], [32, 27]]);
    assert.equal(withLegend(page.document, figure, [], 200), figure);
});

test('a name wider than the whole strip is written with its middle left out, its end kept, inside the image', () => {
    const page = fakeDocument();
    const figure = { width: 200, height: 100 } as unknown as HTMLCanvasElement;
    // 200 CSS px: 200 - 16 (the sides) - 24 (the stroke and its gap) = 160 px for a name, 26 characters of 6 px.
    const long = 'measurement_2026-11-20_line3_' + 'x'.repeat(40) + '_ch2';
    withLegend(page.document, figure, [{ name: long, colour: '#fff' }, { name: 'b.wav', colour: '#fc0' }], 200);
    const [written] = page.texts[0];
    assert.ok(written.length * 6 <= 160, `the name fits the strip: ${written}`);
    assert.ok(written.startsWith('measurement_') && written.endsWith('_ch2') && written.includes('…'), written);
    // The next name is on its own row, as before.
    assert.deepEqual(page.texts[1], ['b.wav', 32, 27]);
});
