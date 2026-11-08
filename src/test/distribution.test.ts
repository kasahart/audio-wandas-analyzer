import assert from 'node:assert/strict';
import test from 'node:test';
import { binCounts, compareGroupNames, distribution, groupLabels, median } from '../shared/dataset/distribution';
import { niceRange, niceStep, niceTicks } from '../shared/utils/ticks';
import { datasetRows } from '../shared/dataset/datasetTable';
import type { ScanResult } from '../shared/protocol/backendProtocol';

const ok = (leq: number[]): ScanResult => (({ ok: true, input: { id: 'x', fs: 48000, channels: leq.map((_, index) => index), durationS: 1, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true }, leqDbA: leq }));

test('groups sort by number when numeric, as text otherwise, the blank last; the median of an even count is the mean of the middle two', () => {
    assert.deepEqual(['1500', '', '900', 'L2', '1200'].sort(compareGroupNames), ['900', '1200', '1500', 'L2', '']);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([]), null);
});

test('a CSV value counts each recording once per group; a computed one counts channels and says how many are not computed', () => {
    const attributes = new Map([
        ['/d/a.wav', { rpm: '900', score: '0.2' }], ['/d/b.wav', { rpm: '900', score: '0.4' }], ['/d/c.wav', { rpm: '1500', score: '0.9' }],
    ]);
    const results = new Map([['/d/a.wav', ok([-30, -35])], ['/d/c.wav', ok([-20])]]);
    const rows = datasetRows(['/d/a.wav', '/d/b.wav', '/d/c.wav'], '/d', attributes, results, new Map([['/d/b.wav', 2]]));
    assert.equal(rows.length, 5);
    const csv = distribution(rows, 'csv:score', 'csv:rpm', results, { low: 0.3, high: 1 });
    assert.equal(csv.unit, 'recording');
    assert.deepEqual(csv.groups.map(group => [group.name, group.members.map(member => member.value)]), [['900', [0.2, 0.4]], ['1500', [0.9]]]);
    assert.deepEqual(csv.groups.flatMap(group => group.members.filter(member => member.inRange).map(member => member.filePath)), ['/d/b.wav', '/d/c.wav']);
    assert.equal(csv.missing, 0);
    const leq = distribution(rows, 'leq', 'csv:rpm', results, null);
    assert.equal(leq.unit, 'ch');
    assert.deepEqual(leq.groups.map(group => [group.name, group.members.length]), [['900', 2], ['1500', 1]]);
    assert.equal(leq.missing, 2);
    // The x range covers the values, padded, so the extremes are not on the edge.
    assert.ok(leq.low < -35 && leq.high > -20);
    // A result of another chain does not count.
    assert.equal(distribution(rows, 'leq', 'none', results, null, row => row.filePath !== '/d/c.wav').missing, 3);
});

test('bins line up across groups; the range marks what it takes', () => {
    const members = [0, 0.1, 0.5, 0.99].map((value, index) => ({ key: String(index), filePath: String(index), value, inRange: value > 0.4 }));
    const { counts, inRange, max } = binCounts(members, 0, 1, 10);
    assert.deepEqual(counts, [1, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    assert.deepEqual(inRange, [0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    assert.equal(max, 1);
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

test('160,000 channel rows give their distribution (no spread of every value into Math.min)', () => {
    const files = Array.from({ length: 2500 }, (_, index) => `/d/f${index}.wav`);
    const results = new Map(files.map((file, index) => [file, ok(Array.from({ length: 64 }, (_, ch) => -40 + ((index + ch) % 20))) ] as const));
    const rows = datasetRows(files, '/d', new Map(), results, new Map());
    assert.equal(rows.length, 160_000);
    const leq = distribution(rows, 'leq', 'none', results, null);
    assert.ok(leq.low < -40 && leq.high > -21);
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

test('the distribution\'s value axis opens at round ends, as every automatic range does (R9)', () => {
    const results = new Map([['/d/a.wav', ok([-42.7, -31.2])], ['/d/b.wav', ok([-18.3])]]);
    const rows = datasetRows(['/d/a.wav', '/d/b.wav'], '/d', new Map(), results, new Map());
    const leq = distribution(rows, 'leq', 'none', results, null);
    // −42.7…−18.3 padded by 4% each side, then widened to round values.
    assert.deepEqual({ low: leq.low, high: leq.high }, { low: -44, high: -16 });
    assert.ok(leq.low < -42.7 && leq.high > -18.3, 'the extremes stay off the edge');
});
