import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { composeTrackCanvases, triggerAnchorDownload, visibleExportCanvases } from '../webview/runtime/exportDownloads';
import type { RuntimeElement } from '../webview/runtime/types';

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

test('visibleExportCanvases skips axis canvases, hidden canvases and calibration-blanked canvases', () => {
    const dom = new JSDOM('<div id="w"><canvas id="a"></canvas><canvas id="b" class="track-axis-canvas"></canvas>'
        + '<canvas id="c" data-calibration-hidden="true"></canvas><canvas id="d"></canvas></div>');
    const wrapper = dom.window.document.getElementById('w');
    const parents: Record<string, unknown> = { a: wrapper, b: wrapper, c: wrapper, d: null };
    wrapper!.querySelectorAll('canvas').forEach(canvas => {
        Object.defineProperty(canvas, 'offsetParent', { get: () => parents[canvas.id] });
    });
    assert.deepEqual(visibleExportCanvases(wrapper).map(canvas => canvas.id), ['a']);
    assert.deepEqual(visibleExportCanvases(null), []);
});

test('composeTrackCanvases stacks tracks below each other behind their axis gutter', () => {
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
        { id: 'track-canvas-1', width: 300, height: 40 },
        { id: 'track-canvas-2', width: 200, height: 60 },
    ] as unknown as RuntimeElement[];
    const composed = composeTrackCanvases(fakeDocument, canvases, canvas => (canvas.id === 'track-canvas-1' ? { id: 'axis-1' } as unknown as Element : null), 50);
    assert.equal(composed, offscreen);
    assert.equal(offscreen.width, 350);
    assert.equal(offscreen.height, 100);
    assert.deepEqual(fills, [[0, 0, 350, 100]]);
    assert.deepEqual(draws, [['axis-1', 0, 0], ['track-canvas-1', 50, 0], ['track-canvas-2', 50, 40]]);
});

test('composeTrackCanvases reports failure when no 2D context is available', () => {
    const fakeDocument = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
    assert.equal(composeTrackCanvases(fakeDocument, [], () => null, 50), null);
});
