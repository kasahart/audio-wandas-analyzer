import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { composeTrackCanvases, fittedText, rowSays, rowSaysPlaced, triggerAnchorDownload, visibleExportCanvases } from '../webview/runtime/exportDownloads';

test('triggerAnchorDownload clicks a temporary anchor and removes it', () => {
    const dom = new JSDOM('<body></body>');
    const document = dom.window.document;
    const clicked: Array<{ href: string; download: string }> = [];
    dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
    };
    triggerAnchorDownload(document, 'data:text/csv,a', 'spectrum-export.csv');
    assert.deepEqual(clicked, [{ href: 'data:text/csv,a', download: 'spectrum-export.csv' }]);
    assert.equal(document.querySelectorAll('a').length, 0);
});

test('visibleExportCanvases skips a row\'s layer of lines (laid over its Figure by the composer) and hidden canvases', () => {
    const dom = new JSDOM('<div id="w"><canvas id="a"></canvas><canvas id="b" class="track-row-layer"></canvas>'
        + '<canvas id="c"></canvas><canvas id="d"></canvas><canvas id="e" class="track-row-layer"></canvas></div>');
    const wrapper = dom.window.document.getElementById('w');
    const parents: Record<string, unknown> = { a: wrapper, b: wrapper, c: wrapper, d: null, e: wrapper };
    wrapper!.querySelectorAll('canvas').forEach(canvas => {
        Object.defineProperty(canvas, 'offsetParent', { get: () => parents[canvas.id] });
    });
    assert.deepEqual(visibleExportCanvases(wrapper).map(canvas => canvas.id), ['a', 'c']);
    assert.deepEqual(visibleExportCanvases(null), []);
});

test('composeTrackCanvases stacks the ruler and the rows below each other, each at its own width from the left', () => {
    const draws: Array<[string, number, number]> = [];
    const fills: number[][] = [];
    const offscreen = {
        width: 0,
        height: 0,
        getContext: () => ({
            set fillStyle(_value: string) {},
            fillRect: (...args: number[]) => { fills.push(args); },
            drawImage: (image: { id: string }, x: number, y: number) => { draws.push([image.id, x, y]); },
        }),
    };
    const fakeDocument = { createElement: () => offscreen } as unknown as Document;
    const canvases = [
        { id: 'ruler', width: 300, height: 40 },
        { id: 'row', width: 200, height: 60 },
    ] as unknown as HTMLCanvasElement[];
    const composed = composeTrackCanvases(fakeDocument, canvases);
    assert.equal(composed, offscreen);
    assert.equal(offscreen.width, 300);
    assert.equal(offscreen.height, 100);
    assert.deepEqual(fills, [[0, 0, 300, 100]]);
    assert.deepEqual(draws, [['ruler', 0, 0], ['row', 0, 40]]);
});

test('composeTrackCanvases writes a named row\'s recording and channel on a line above it, and puts the ruler over the rows\' plots as the page has it', () => {
    const draws: Array<[string, number, number]> = [];
    const texts: Array<[string, number, number]> = [];
    const offscreen = {
        width: 0,
        height: 0,
        getContext: () => ({
            fillStyle: '', font: '', textBaseline: '',
            fillRect: () => undefined,
            fillText: (text: string, x: number, y: number) => { texts.push([text, x, y]); },
            drawImage: (image: { id: string }, x: number, y: number) => { draws.push([image.id, x, y]); },
        }),
    };
    const fakeDocument = { createElement: () => offscreen } as unknown as Document;
    // The rows are drawn at two device pixels a CSS px: their name lines are 36 device px high. The ruler starts
    // 50 CSS px right of the rows (over their plots, past their axis room): 100 device px in the image.
    const at = (left: number) => ({ getBoundingClientRect: () => ({ left }) });
    const canvases = [
        { id: 'ruler', width: 500, height: 80, clientWidth: 250, ...at(350) },
        { id: 'a', width: 600, height: 120, clientWidth: 300, ...at(300) },
        { id: 'b', width: 600, height: 120, clientWidth: 300, ...at(300) },
    ] as unknown as HTMLCanvasElement[];
    const names: Record<string, string> = { a: 'run1.wav · ch1', b: 'run2.wav' };
    composeTrackCanvases(fakeDocument, canvases, canvas => names[canvas.id] ?? '');
    assert.equal(offscreen.height, 80 + 36 + 120 + 36 + 120);
    assert.equal(offscreen.width, 600);
    assert.deepEqual(draws, [['ruler', 100, 0], ['a', 0, 116], ['b', 0, 272]]);
    assert.deepEqual(texts, [['run1.wav · ch1', 16, 98], ['run2.wav', 16, 254]]);
});

test('composeTrackCanvases reports failure when no 2D context is available', () => {
    const fakeDocument = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
    assert.equal(composeTrackCanvases(fakeDocument, []), null);
});

test('a row with no Figure that says why (failed, still waiting) keeps its place in the image: its box is a piece, with its words', () => {
    const dom = new JSDOM('<div id="w"><canvas id="ruler"></canvas>'
        + '<div class="track-row-figure" id="drawn"><canvas id="fig"></canvas><canvas class="track-row-layer"></canvas><div class="track-row-says" hidden></div></div>'
        + '<div class="track-row-figure" id="failed"><canvas class="track-row-layer"></canvas><div class="track-row-says">Could not read the file</div></div>'
        + '<div class="track-row-figure" id="empty"><canvas class="track-row-layer"></canvas><div class="track-row-says" hidden></div></div></div>');
    const wrapper = dom.window.document.getElementById('w')!;
    wrapper.querySelectorAll<HTMLElement>('*').forEach(element => Object.defineProperty(element, 'offsetParent', { get: () => wrapper }));
    const pieces = visibleExportCanvases(wrapper);
    assert.deepEqual(pieces.map(piece => piece.id), ['ruler', 'fig', 'failed']);
    assert.deepEqual(pieces.map(rowSays), ['', '', 'Could not read the file']);
});

test('composeTrackCanvases writes a piece\'s words in its middle, a box of a row with no Figure at the canvases\' pixel ratio', () => {
    const texts: Array<[string, number, number, string]> = [];
    const draws: string[] = [];
    const ctx = {
        fillStyle: '', font: '', textBaseline: '', textAlign: '',
        measureText: (text: string) => ({ width: text.length * 6 }),
        fillRect: () => undefined,
        fillText(text: string, x: number, y: number) { texts.push([text, x, y, this.textAlign]); },
        drawImage: (image: { id: string }) => { draws.push(image.id); },
    };
    const offscreen = { width: 0, height: 0, getContext: () => ctx };
    const fakeDocument = { createElement: () => offscreen } as unknown as Document;
    const at = (left: number) => ({ getBoundingClientRect: () => ({ left }) });
    const pieces = [
        { id: 'a', width: 600, height: 120, clientWidth: 300, ...at(0) },
        // A row's box, no canvas: 300 × 60 CSS px, drawn at the canvases' two device pixels a CSS px.
        { id: 'failed', clientWidth: 300, clientHeight: 60, ...at(0) },
    ] as unknown as HTMLElement[];
    const says: Record<string, string> = { failed: 'Could not read the file\n  Press R to try again ' };
    composeTrackCanvases(fakeDocument, pieces, piece => `${piece.id}.wav`, piece => says[piece.id] ?? '');
    assert.deepEqual([offscreen.width, offscreen.height], [600, 36 + 120 + 36 + 120]);
    assert.deepEqual(draws, ['a'], 'a box draws no canvas');
    // The name lines at the left, the words centred in the box (192..312), a line each 30 device px apart.
    assert.deepEqual(texts, [
        ['a.wav', 16, 18, 'left'],
        ['failed.wav', 16, 174, 'left'],
        ['Could not read the file', 300, 252 - 15, 'center'],
        ['Press R to try again', 300, 252 + 15, 'center'],
    ]);
});

test('composeTrackCanvases writes one lane\'s words over that lane, where the page has them, not over the row\'s middle', () => {
    const texts: Array<[string, number, number]> = [];
    const ctx = {
        fillStyle: '', font: '', textBaseline: '', textAlign: '',
        measureText: (text: string) => ({ width: text.length * 6 }),
        fillRect: () => undefined, drawImage: () => undefined,
        fillText: (text: string, x: number, y: number) => { texts.push([text, x, y]); },
    };
    const offscreen = { width: 0, height: 0, getContext: () => ctx };
    const fakeDocument = { createElement: () => offscreen } as unknown as Document;
    // A row of 200 CSS px at two device pixels each: a waveform of 140 px over a spectrogram of 50 px, which says why it is not drawn.
    const row = { id: 'row', width: 600, height: 400, clientWidth: 300, getBoundingClientRect: () => ({ left: 0 }) } as unknown as HTMLElement;
    composeTrackCanvases(fakeDocument, [row], undefined, () => ({ text: 'Too short for a spectrogram', top: 150, height: 50 }));
    assert.deepEqual(texts, [['Too short for a spectrogram', 300, (150 + 25) * 2]]);
});

test('rowSaysPlaced reads where the page laid a lane\'s words (none: over the whole box)', () => {
    const dom = new JSDOM('<div class="track-row-figure" id="a"><canvas id="fig"></canvas><div class="track-row-says" style="top: 150px; height: 50px; bottom: auto">Too short</div></div>'
        + '<div class="track-row-figure" id="b"><div class="track-row-says">Failed</div></div>');
    assert.deepEqual(rowSaysPlaced(dom.window.document.getElementById('fig')!), { text: 'Too short', top: 150, height: 50 });
    assert.deepEqual(rowSaysPlaced(dom.window.document.getElementById('b')!), { text: 'Failed', top: null, height: null });
});

test('fittedText leaves the middle out of a text wider than its room and keeps its end', () => {
    const ctx = { measureText: (text: string) => ({ width: text.length * 6 }) } as unknown as CanvasRenderingContext2D;
    assert.equal(fittedText(ctx, 'short.wav', 100), 'short.wav');
    const fitted = fittedText(ctx, 'a_very_long_recording_name_for_line_3.wav · ch2', 120);
    assert.ok(fitted.length * 6 <= 120 && fitted.endsWith('ch2') && fitted.startsWith('a_very') && fitted.includes('…'), fitted);
    // Room for less than a character and the mark: the mark alone, never a text wider than its room; a pair of code units is kept whole.
    assert.equal(fittedText(ctx, 'ab', 6), '…');
    assert.equal(fittedText(ctx, '𝄞𝄞𝄞𝄞𝄞𝄞𝄞𝄞', 60).replace(/[𝄞…]/gu, ''), '');
});
