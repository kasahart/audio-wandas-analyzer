import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrumHover } from '../webview/runtime/spectrumHover';
import type { TrackId } from '../webview/runtime/types';

const trackA = 'track-1' as TrackId;

test('focus without a prior position seeds the cursor and clears the mouse flag', () => {
    const hover = new SpectrumHover();
    hover.hasMouse = true;
    hover.focus(trackA, 2);
    assert.deepEqual({ ...hover }, { norm: 0, yFrac: 0.5, target: trackA, channelIndex: 2, hasMouse: false });
});

test('focus keeps an existing cursor position', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.3, yFrac: 0.8 }, 'overlay', null);
    hover.focus(trackA, 0);
    assert.equal(hover.norm, 0.3);
    assert.equal(hover.yFrac, 0.8);
});

test('move records the point and marks the mouse as present', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.25, yFrac: 0.1 }, trackA, 1);
    assert.deepEqual({ ...hover }, { norm: 0.25, yFrac: 0.1, target: trackA, channelIndex: 1, hasMouse: true });
});

test('non-integer channel indices are stored as null', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.5, yFrac: 0.5 }, 'overlay', Number.NaN);
    assert.equal(hover.channelIndex, null);
    hover.focus(trackA, 1.5);
    assert.equal(hover.channelIndex, null);
});

test('clear hides the cursor but leaves the mouse flag alone', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.5, yFrac: 0.5 }, trackA, 0);
    hover.clear();
    assert.deepEqual({ ...hover }, { norm: null, yFrac: null, target: null, channelIndex: null, hasMouse: true });
});
