import assert from 'node:assert/strict';
import test from 'node:test';
import { contentBoxWidth, readThenWrite, syncCanvasSize, type SizableCanvas } from '../webview/runtime/canvasSizing';

function trackedCanvas(width: number, height: number, styleWidth = '', styleHeight = '') {
    const writes: string[] = [];
    const style = { _w: styleWidth, _h: styleHeight };
    const canvas = {
        _w: width,
        _h: height,
        get width() { return this._w; },
        set width(v: number) { writes.push('width'); this._w = v; },
        get height() { return this._h; },
        set height(v: number) { writes.push('height'); this._h = v; },
        style: {
            get width() { return style._w; },
            set width(v: string) { writes.push('style.width'); style._w = v; },
            get height() { return style._h; },
            set height(v: string) { writes.push('style.height'); style._h = v; },
        },
    };
    return { canvas: canvas as SizableCanvas, writes };
}

test('syncCanvasSize rounds, clamps to 1px and writes bitmap and CSS size', () => {
    const { canvas } = trackedCanvas(10, 10);
    syncCanvasSize(canvas, 120.6, 0.2);
    assert.equal(canvas.width, 121);
    assert.equal(canvas.height, 1);
    assert.equal(canvas.style.width, '121px');
    assert.equal(canvas.style.height, '1px');
});

test('syncCanvasSize skips writes that would not change anything', () => {
    const { canvas, writes } = trackedCanvas(200, 100, '200px', '100px');
    syncCanvasSize(canvas, 200, 100);
    assert.deepEqual(writes, []);
});

test('syncCanvasSize leaves CSS size alone when syncStyle is false', () => {
    const { canvas, writes } = trackedCanvas(10, 10, '50%', 'auto');
    syncCanvasSize(canvas, 300, 150, { syncStyle: false });
    assert.deepEqual(writes, ['width', 'height']);
    assert.equal(canvas.style.width, '50%');
});

test('contentBoxWidth subtracts horizontal padding from clientWidth', () => {
    assert.equal(contentBoxWidth({ clientWidth: 400 }, 800, { paddingLeft: '12px', paddingRight: '8.5px' }), 379.5);
    assert.equal(contentBoxWidth({ clientWidth: 400 }, 800, null), 400);
    assert.equal(contentBoxWidth({ clientWidth: 400 }, 800, { paddingLeft: '', paddingRight: 'bogus' }), 400);
});

test('contentBoxWidth falls back when the element is missing or not laid out', () => {
    assert.equal(contentBoxWidth(null, 800, null), 800);
    assert.equal(contentBoxWidth({ clientWidth: 0 }, 800, { paddingLeft: '4px', paddingRight: '4px' }), 800);
    assert.equal(contentBoxWidth({ clientWidth: 4 }, 800, { paddingLeft: '4px', paddingRight: '4px' }), 1);
});

test('readThenWrite measures every item before writing any', () => {
    const log: string[] = [];
    readThenWrite(['a', 'b', 'c'], item => { log.push('read ' + item); return item.toUpperCase(); }, (item, measured) => { log.push('write ' + item + '=' + measured); });
    assert.deepEqual(log, ['read a', 'read b', 'read c', 'write a=A', 'write b=B', 'write c=C']);
});
