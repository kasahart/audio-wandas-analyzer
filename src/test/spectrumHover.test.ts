import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrumHover } from '../webview/runtime/spectrumHover';

test('focus without a prior position seeds the cursor and clears the mouse flag', () => {
    const hover = new SpectrumHover();
    hover.hasMouse = true;
    hover.focus();
    assert.deepEqual({ ...hover }, { norm: 0, yFrac: 0.5, target: 'overlay', hasMouse: false, stepped: false });
});

test('focus keeps an existing cursor position', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.3, yFrac: 0.8 });
    hover.focus();
    assert.equal(hover.norm, 0.3);
    assert.equal(hover.yFrac, 0.8);
});

test('move records the point and marks the mouse as present', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.25, yFrac: 0.1 });
    assert.deepEqual({ ...hover }, { norm: 0.25, yFrac: 0.1, target: 'overlay', hasMouse: true, stepped: false });
});

test('clear hides the cursor but leaves the mouse flag alone', () => {
    const hover = new SpectrumHover();
    hover.move({ hoverNorm: 0.5, yFrac: 0.5 });
    hover.clear();
    assert.deepEqual({ ...hover }, { norm: null, yFrac: null, target: null, hasMouse: true, stepped: false });
});

test('an arrow-key step marks the hover stepped until the pointer moves again', () => {
    const hover = new SpectrumHover();
    hover.stepped = true;
    hover.move({ hoverNorm: 0.25, yFrac: 0.1 });
    assert.equal(hover.stepped, false);
});
