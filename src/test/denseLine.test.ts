/**
 * A dense line painted as the pixels its strokes cover (src/webview/figure/denseLine.ts): what a round pen of the
 * line's width covers, column by column, with the background left between parts a column's segments do not reach.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { capsuleAt, coveredPixels, isDense, pixelOf } from '../webview/figure/denseLine';

const RED = pixelOf('#ff0000')!;
const frame = { left: 0, top: 0, width: 20, height: 20 };
const columnOf = (pixels: Uint32Array, column: number): boolean[] => Array.from({ length: frame.height }, (_, row) => pixels[row * frame.width + column] !== 0);

test('a capsule crosses a vertical line from its top to its bottom: a level segment as wide as the pen, a round end narrower past its end', () => {
    assert.deepEqual(capsuleAt(2, 10, 18, 10, 1, 8), [9, 11]);
    const end = capsuleAt(2, 10, 18, 10, 1, 18.6)!;
    assert.ok(Math.abs(end[0] - (10 - 0.8)) < 1e-9 && Math.abs(end[1] - (10 + 0.8)) < 1e-9, `the round end at 0.6 past it: ±0.8, not ${end.join(', ')}`);
    assert.equal(capsuleAt(2, 10, 18, 10, 1, 19.5), null);
    // A vertical segment: its whole length and the pen's half past each end.
    assert.deepEqual(capsuleAt(5, 4, 5, 16, 1, 5), [3, 17]);
});

test('a line through a column twice, apart, leaves the background between: the parts are not joined into one', () => {
    // Down from the top to row 4 and back up, then a separate visit at row 15 in the same columns.
    const pixels = coveredPixels([{ points: [[9, 2], [10, 4], [11, 2], null, [9, 15], [11, 15]], colour: '#ff0000', width: 1, from: 0, to: 20 }], frame, 1);
    const column = columnOf(pixels, 10);
    assert.ok(column.slice(2, 5).some(Boolean) && column[15], 'both parts are covered');
    assert.ok(!column[9], 'the background between them shows');
    assert.equal(pixels[15 * frame.width + 10], RED, 'in the line\'s colour');
});

test('a gap breaks the line: nothing is drawn between the points on each side of it', () => {
    const pixels = coveredPixels([{ points: [[2, 10], [4, 10], null, [16, 10], [18, 10]], colour: '#ff0000', width: 1, from: 0, to: 20 }], frame, 1);
    assert.ok(columnOf(pixels, 3)[10] && columnOf(pixels, 17)[10]);
    assert.ok(!columnOf(pixels, 10)[10], 'not joined across the gap');
});

test('only the stretch across asked is painted, and a later line is over an earlier one', () => {
    const level = (y: number): Array<[number, number]> => [[0, y], [20, y]];
    const pixels = coveredPixels([
        { points: level(10), colour: '#ff0000', width: 2, from: 5, to: 15 },
        { points: level(10), colour: '#0000ff', width: 2, from: 10, to: 20 },
    ], frame, 1);
    assert.equal(pixels[10 * frame.width + 2], 0, 'left of its stretch: nothing');
    assert.equal(pixels[10 * frame.width + 7], RED);
    assert.equal(pixels[10 * frame.width + 12], pixelOf('#0000ff'), 'the later line over the earlier');
});

test('a line is dense with two points a pixel across or more; a colour other than #rrggbb is not painted here', () => {
    assert.equal(isDense(Array.from({ length: 40 }, (_, at): [number, number] => [at / 2, 0])), true);
    assert.equal(isDense(Array.from({ length: 40 }, (_, at): [number, number] => [at, 0])), false);
    assert.equal(pixelOf('rgba(1, 2, 3, 0.5)'), null);
    assert.equal(pixelOf('#abc'), pixelOf('#aabbcc'));
});
