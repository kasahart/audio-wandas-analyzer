import assert from 'node:assert/strict';
import test from 'node:test';
import { reorderInPlace } from '../webview/runtime/stateStore';

test('先頭を末尾へ移動', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2, 3], 0, 3), [1, 2, 3, 0]);
});

test('末尾を先頭へ移動', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2, 3], 3, 0), [3, 0, 1, 2]);
});

test('隣接要素を入れ替え', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2, 3], 1, 2), [0, 2, 1, 3]);
});

test('同じ位置への移動は不変', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2, 3], 2, 2), [0, 1, 2, 3]);
});

test('存在しない from は不変', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2], 5, 1), [0, 1, 2]);
});

test('存在しない to は不変', () => {
    assert.deepEqual(reorderInPlace([0, 1, 2], 0, 5), [0, 1, 2]);
});

test('2要素の入れ替え', () => {
    assert.deepEqual(reorderInPlace([0, 1], 0, 1), [1, 0]);
});
