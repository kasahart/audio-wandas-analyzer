import assert from 'node:assert/strict';
import test from 'node:test';
import { niceTimeStep, rulerTicks } from '../webview/runtime/timeRuler';

test('niceTimeStep: picks the smallest step that keeps at most eight ticks', () => {
    assert.equal(niceTimeStep(0.05), 0.01);
    assert.equal(niceTimeStep(4), 0.5);
    assert.equal(niceTimeStep(16), 2);
    assert.equal(niceTimeStep(240), 30);
    assert.equal(niceTimeStep(600), 60);
});

test('rulerTicks: places step-aligned ticks across the visible window', () => {
    const offset = rulerTicks(1.5, 9.5, 800);
    assert.equal(offset.length, 8);
    assert.deepEqual(offset[0], { x: 50, label: '0:02.00' });
    assert.deepEqual(offset[7], { x: 750, label: '0:09.00' });
    const full = rulerTicks(0, 4, 400);
    assert.equal(full.length, 9);
    assert.deepEqual(full[0], { x: 0, label: '0:00.00' });
    assert.deepEqual(full[8], { x: 400, label: '0:04.00' });
});
