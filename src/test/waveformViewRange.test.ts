import test from 'node:test';
import assert from 'node:assert/strict';
import {
    centerRangeOn,
    normAtPlotX,
    panNormalizedRange,
    panNormalizedRangeBy,
    wheelPanPixels,
    rangeAroundRegion,
    zoomRangeAroundPivot,
} from '../webview/runtime/waveformInteraction';

function assertRange(actual: { start: number; end: number }, start: number, end: number) {
    assert.ok(Math.abs(actual.start - start) < 1e-12, `start ${actual.start} != ${start}`);
    assert.ok(Math.abs(actual.end - end) < 1e-12, `end ${actual.end} != ${end}`);
}

test('zoomRangeAroundPivot keeps the pivot at the same position in the view', () => {
    assertRange(zoomRangeAroundPivot({ start: 0.2, end: 0.6 }, 0.3, 0.5), 0.25, 0.45);
    assertRange(zoomRangeAroundPivot({ start: 0.5, end: 0.5 }, 0.5, 2), 0.5, 0.5);
});

test('zoomRangeAroundPivot clamps the zoomed view into [0, 1]', () => {
    assertRange(zoomRangeAroundPivot({ start: 0.6, end: 1 }, 0.9, 2), 0.2, 1);
    assertRange(zoomRangeAroundPivot({ start: 0, end: 0.4 }, 0.1, 2), 0, 0.8);
    assertRange(zoomRangeAroundPivot({ start: 0, end: 0.8 }, 0.4, 2), 0, 1);
});

test('normAtPlotX maps a plot x position into the view and rejects positions outside the plot', () => {
    assert.equal(normAtPlotX({ start: 0.2, end: 0.6 }, 50, 100), 0.4);
    assert.equal(normAtPlotX({ start: 0.2, end: 0.6 }, -1, 100), null);
    assert.equal(normAtPlotX({ start: 0.2, end: 0.6 }, 101, 100), null);
    assert.equal(normAtPlotX({ start: 0.2, end: 0.6 }, 0, 0), null);
});

test('panNormalizedRange moves by a tenth of the span and stops at the edges', () => {
    assertRange(panNormalizedRange({ start: 0.4, end: 0.6 }, 1), 0.42, 0.62);
    assertRange(panNormalizedRange({ start: 0.4, end: 0.6 }, -1), 0.38, 0.58);
    assertRange(panNormalizedRange({ start: 0.01, end: 0.51 }, -1), 0, 0.5);
    assertRange(panNormalizedRange({ start: 0.49, end: 0.99 }, 1), 0.5, 1);
});

test('panNormalizedRangeBy moves by any fraction of the span and stops at the edges', () => {
    assertRange(panNormalizedRangeBy({ start: 0.4, end: 0.6 }, 0.25), 0.45, 0.65);
    assertRange(panNormalizedRangeBy({ start: 0.4, end: 0.6 }, -3), 0, 0.2);
    assertRange(panNormalizedRangeBy({ start: 0, end: 1 }, 0.5), 0, 1);
});

test('wheelPanPixels takes the sideways part of a swipe when it leads, else the turn, in pixels', () => {
    // A two-finger sideways swipe (with a little vertical drift).
    assert.equal(wheelPanPixels({ deltaX: -12, deltaY: 3, deltaMode: 0 }, 800), -12);
    // Shift+wheel turned sideways by the system (macOS), and a plain Shift+wheel notch.
    assert.equal(wheelPanPixels({ deltaX: 100, deltaY: 0, deltaMode: 0 }, 800), 100);
    assert.equal(wheelPanPixels({ deltaX: 0, deltaY: -100, deltaMode: 0 }, 800), -100);
    // Lines and pages (Firefox) in pixels.
    assert.equal(wheelPanPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800), 120);
    assert.equal(wheelPanPixels({ deltaX: 1, deltaY: 0, deltaMode: 2 }, 800), 800);
});

test('centerRangeOn follows a cursor without changing the span', () => {
    assertRange(centerRangeOn({ start: 0, end: 0.2 }, 0.5), 0.4, 0.6);
    assertRange(centerRangeOn({ start: 0.4, end: 0.6 }, 0.05), 0, 0.2);
    assertRange(centerRangeOn({ start: 0.4, end: 0.6 }, 0.95), 0.8, 1);
});

test('rangeAroundRegion pads the region and clamps into [0, 1]', () => {
    assertRange(rangeAroundRegion({ start: 0.4, end: 0.6 }, 0.05), 0.39, 0.61);
    assertRange(rangeAroundRegion({ start: 0, end: 1 }, 0.05), 0, 1);
});
