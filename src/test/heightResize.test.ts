import assert from 'node:assert/strict';
import test from 'node:test';
import { clampHeight, createHeightResize, heightInputRequest, type HeightKind } from '../webview/runtime/heightResize';

test('clampHeight keeps values inside the bounds', () => {
    assert.equal(clampHeight(10, 40, 400), 40);
    assert.equal(clampHeight(900, 40, 400), 400);
    assert.equal(clampHeight(120, 40, 400), 120);
});

test('heightInputRequest maps height inputs and ignores other actions or invalid values', () => {
    assert.deepEqual(heightInputRequest('track-height-input', '120'), { kind: 'track', height: 120 });
    assert.deepEqual(heightInputRequest('spectrum-height-input', 80), { kind: 'spectrum', height: 80 });
    assert.equal(heightInputRequest('track-height-input', null), null);
    assert.equal(heightInputRequest('track-height-input', 'abc'), null);
    assert.equal(heightInputRequest('zoom-in', '120'), null);
});

test('height drag grows tracks downward and the spectrum upward, and toggles the active state', () => {
    const heights: Record<HeightKind, number> = { track: 100, spectrum: 200 };
    const active: boolean[] = [];
    const resize = createHeightResize({
        currentHeight: kind => heights[kind],
        setHeight: (kind, height) => { heights[kind] = height; },
        onActiveChange: value => { active.push(value); },
    });
    resize.update(50);
    assert.equal(heights.track, 100);
    resize.begin('track', 10);
    resize.update(40);
    assert.equal(heights.track, 130);
    resize.end();
    resize.begin('spectrum', 100);
    resize.update(70);
    assert.equal(heights.spectrum, 230);
    assert.equal(resize.isActive(), true);
    resize.end();
    resize.end();
    assert.equal(resize.isActive(), false);
    assert.deepEqual(active, [true, false, true, false]);
});

test('height drag does not start on a panel that refuses it', () => {
    const heights: Record<HeightKind, number> = { track: 100, spectrum: 200 };
    const resize = createHeightResize({
        currentHeight: kind => heights[kind],
        canBegin: kind => kind === 'track',
        setHeight: (kind, height) => { heights[kind] = height; },
        onActiveChange: () => {},
    });
    resize.begin('spectrum', 100);
    resize.update(40);
    assert.equal(resize.isActive(), false);
    assert.equal(heights.spectrum, 200);
});
