import test from 'node:test';
import assert from 'node:assert/strict';
import { exceedsDragThreshold, loopRegionClockText } from '../webview/runtime/waveformInteraction';

test('exceedsDragThreshold: どちらかの軸で 3px を超えたらドラッグとみなす', () => {
    assert.equal(exceedsDragThreshold(3, -3), false);
    assert.equal(exceedsDragThreshold(-4, 0), true);
    assert.equal(exceedsDragThreshold(0, 4), true);
});

test('loopRegionClockText: 正規化区間をグローバル時間軸の時刻範囲に変換する', () => {
    assert.equal(loopRegionClockText({ start: 0.25, end: 0.5 }, { startSec: 10, spanSec: 120 }), '0:40.00 – 1:10.00');
    assert.equal(loopRegionClockText({ start: 0, end: 1 }, { startSec: 0, spanSec: 5.5 }), '0:00.00 – 0:05.50');
});

