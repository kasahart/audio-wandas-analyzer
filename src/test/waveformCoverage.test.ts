import test from 'node:test';
import assert from 'node:assert/strict';
import { trackTimelinePlacement } from '../webview/runtime/waveformCoverage';

test('trackTimelinePlacement: 全体タイムライン上の開始位置と長さの比を返す', () => {
    const span = { startSec: -2, endSec: 8, spanSec: 10 };
    assert.deepEqual(trackTimelinePlacement(3, 4, span), { offsetNorm: 0.5, trackDurRatio: 0.4 });
});

test('trackTimelinePlacement: 長さ 0 のトラックは 1 秒として扱う', () => {
    const span = { startSec: 0, endSec: 10, spanSec: 10 };
    assert.equal(trackTimelinePlacement(0, 0, span).trackDurRatio, 0.1);
});
