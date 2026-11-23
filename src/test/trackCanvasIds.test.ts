import assert from 'node:assert/strict';
import test from 'node:test';
import { trackRowFigureId } from '../webview/runtime/trackCanvasIds';

test('a row Figure\'s box id omits the channel suffix for the first channel and appends the channel index for later ones', () => {
    assert.equal(trackRowFigureId(2, 0), 'track-row-figure-2');
    assert.equal(trackRowFigureId(2, 1), 'track-row-figure-2-1');
});
