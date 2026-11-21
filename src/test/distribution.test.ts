import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGroupNames, groupLabels } from '../shared/dataset/distribution';
import { niceRange, niceStep, niceTicks } from '../shared/utils/ticks';

test('groups sort by number when numeric, as text otherwise, the blank last', () => {
    assert.deepEqual(['1500', '', '900', 'L2', '1200'].sort(compareGroupNames), ['900', '1200', '1500', 'L2', '']);
});

test('names that share a long start or end are shown by the part that differs', () => {
    const labels = groupLabels(['LOT-2026-01-東工場-第二組立', 'LOT-2026-13-東工場-第二組立']);
    assert.equal(labels.get('LOT-2026-13-東工場-第二組立'), '…13…');
    assert.equal(groupLabels(['L1', 'L2']).get('L1'), 'L1');
    assert.equal(niceStep(0.17), 0.2);
    assert.equal(niceStep(4), 5);
});

test('ticks fall on round values without floating-point drift', () => {
    assert.deepEqual(niceTicks(-80, 0, 4), [-80, -60, -40, -20, 0]);
    assert.deepEqual(niceTicks(-5, 15, 4), [-5, 0, 5, 10, 15]);
    assert.deepEqual(niceTicks(0.1, 0.7, 6), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    assert.deepEqual(niceTicks(-73.4, -12.1, 4), [-60, -40, -20]);
});

test('niceRange: 自動レンジの端を、各端の広がりが幅の 8% 以内で最も粗い 1・2・5 刻みで外側に丸める', () => {
    assert.deepEqual(niceRange(-120, -23.21), { low: -120, high: -20 });
    // 10 dB steps would leave 9.9 dB unused at the top; 5 dB steps leave 4.9.
    assert.deepEqual(niceRange(-120, -19.9), { low: -120, high: -15 });
    assert.deepEqual(niceRange(-120, -20.1), { low: -120, high: -20 });
    assert.deepEqual(niceRange(-63.4, -23.2), { low: -65, high: -20 });
    assert.deepEqual(niceRange(-35.3, -23.3), { low: -36, high: -23 });
});

test('niceRange: 小さな幅や正の値でも丸め、丸めた値に浮動小数の誤差を残さない', () => {
    assert.deepEqual(niceRange(-3.04, -0.12), { low: -3.2, high: 0 });
    assert.deepEqual(niceRange(0.013, 0.087), { low: 0.01, high: 0.09 });
    assert.deepEqual(niceRange(12, 112), { low: 10, high: 120 });
    assert.deepEqual(niceRange(-100, 0.1), { low: -100, high: 5 });
    // Already round ends stay where they are.
    assert.deepEqual(niceRange(-90, -10), { low: -90, high: -10 });
    assert.deepEqual(niceRange(-110, 0), { low: -110, high: 0 });
});

test('niceRange: 幅がないか有限でない範囲はそのまま返す', () => {
    assert.deepEqual(niceRange(-40, -40), { low: -40, high: -40 });
    assert.deepEqual(niceRange(-Infinity, 0), { low: -Infinity, high: 0 });
    assert.deepEqual(niceRange(-120, -120 + 1e-12), { low: -120, high: -120 + 1e-12 });
});

