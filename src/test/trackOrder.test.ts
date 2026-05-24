/**
 * displayOrder 配列の並び替えロジックのユニットテスト。
 * reorderInPlace は入力配列を破壊的に更新して返す。
 * comparisonRenderScript.ts はテンプレートリテラルとして Webview に
 * インジェクトされるため外部モジュールを import できない。
 * そのため、同一アルゴリズムをここに複製してテストする。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/** displayOrder 配列を破壊的に並び替えて返す */
function reorderInPlace(order: number[], fromStateIdx: number, toStateIdx: number): number[] {
    const fromPos = order.indexOf(fromStateIdx);
    const toPos   = order.indexOf(toStateIdx);
    if (fromPos === -1 || toPos === -1) { return order; }
    order.splice(fromPos, 1);
    order.splice(toPos, 0, fromStateIdx);
    return order;
}

test('先頭から末尾に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 0, 3), [1,2,3,0]);
});

test('末尾から先頭に移動', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 3, 0), [3,0,1,2]);
});

test('隣接要素の交換', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 1, 2), [0,2,1,3]);
});

test('同一要素は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2,3], 2, 2), [0,1,2,3]);
});

test('fromStateIdx が存在しない場合は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2], 5, 1), [0,1,2]);
});

test('toStateIdx が存在しない場合は変化なし', () => {
    assert.deepEqual(reorderInPlace([0,1,2], 0, 5), [0,1,2]);
});

test('2要素の交換', () => {
    assert.deepEqual(reorderInPlace([0,1], 0, 1), [1,0]);
});
