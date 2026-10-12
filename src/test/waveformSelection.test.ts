import test from 'node:test';
import assert from 'node:assert/strict';
import {
    exceedsDragThreshold,
    loopRegionClockText,
    loopRegionForDrag,
    loopRegionFromDrag,
    MIN_SELECTION_SPAN,
    moveLoopEdge,
    rectZoomTarget,
} from '../webview/runtime/waveformInteraction';

test('loopRegionFromDrag: アンカーとポインタの前後に関係なく昇順の区間を返し、幅 0 は null', () => {
    assert.deepEqual(loopRegionFromDrag(0.6, 0.2), { start: 0.2, end: 0.6 });
    assert.deepEqual(loopRegionFromDrag(0.2, 0.6), { start: 0.2, end: 0.6 });
    assert.equal(loopRegionFromDrag(0.4, 0.4), null);
});

test('moveLoopEdge: 始端は 0 と終端 - 最小幅の間にクランプする', () => {
    const region = { start: 0.3, end: 0.5 };
    assert.deepEqual(moveLoopEdge(region, 'start', 0.1), { start: 0.1, end: 0.5 });
    assert.deepEqual(moveLoopEdge(region, 'start', -0.2), { start: 0, end: 0.5 });
    assert.deepEqual(moveLoopEdge(region, 'start', 0.9), { start: 0.5 - MIN_SELECTION_SPAN, end: 0.5 });
});

test('moveLoopEdge: 終端は始端 + 最小幅と 1 の間にクランプする', () => {
    const region = { start: 0.3, end: 0.5 };
    assert.deepEqual(moveLoopEdge(region, 'end', 0.8), { start: 0.3, end: 0.8 });
    assert.deepEqual(moveLoopEdge(region, 'end', 1.4), { start: 0.3, end: 1 });
    assert.deepEqual(moveLoopEdge(region, 'end', 0.1), { start: 0.3, end: 0.3 + MIN_SELECTION_SPAN });
});

test('rectZoomTarget: 逆方向に引いた矩形も昇順に正規化し、時間範囲を [0, 1] にクランプする', () => {
    assert.deepEqual(
        rectZoomTarget({ startNorm: 0.7, endNorm: 0.2, startAmpNorm: -0.1, endAmpNorm: 0.5 }),
        { zoomStart: 0.2, zoomEnd: 0.7, amplitudeMin: -0.1, amplitudeMax: 0.5 },
    );
    assert.deepEqual(
        rectZoomTarget({ startNorm: -0.1, endNorm: 1.2, startAmpNorm: 0.5, endAmpNorm: -0.5 }),
        { zoomStart: 0, zoomEnd: 1, amplitudeMin: -0.5, amplitudeMax: 0.5 },
    );
});

test('rectZoomTarget: 時間または振幅の幅が最小幅以下なら null', () => {
    assert.equal(rectZoomTarget({ startNorm: 0.4, endNorm: 0.4 + MIN_SELECTION_SPAN / 2, startAmpNorm: 0, endAmpNorm: 0.5 }), null);
    assert.equal(rectZoomTarget({ startNorm: 0.2, endNorm: 0.6, startAmpNorm: 0.3, endAmpNorm: 0.3 }), null);
});

test('exceedsDragThreshold: どちらかの軸で 3px を超えたらドラッグとみなす', () => {
    assert.equal(exceedsDragThreshold(3, -3), false);
    assert.equal(exceedsDragThreshold(-4, 0), true);
    assert.equal(exceedsDragThreshold(0, 4), true);
});

test('loopRegionForDrag: loop はアンカーから区間を作り、グリップは既存区間の端を動かす', () => {
    const region = { start: 0.3, end: 0.5 };
    assert.deepEqual(loopRegionForDrag('loop', 0.6, region, 0.2), { start: 0.2, end: 0.6 });
    assert.equal(loopRegionForDrag('loop', 0.4, region, 0.4), null);
    assert.deepEqual(loopRegionForDrag('gripStart', 0, region, 0.1), { start: 0.1, end: 0.5 });
    assert.deepEqual(loopRegionForDrag('gripEnd', 0, region, 0.8), { start: 0.3, end: 0.8 });
    assert.equal(loopRegionForDrag('gripStart', 0, null, 0.1), null);
    assert.equal(loopRegionForDrag('gripEnd', 0, null, 0.8), null);
});

test('loopRegionClockText: 正規化区間をグローバル時間軸の時刻範囲に変換する', () => {
    assert.equal(loopRegionClockText({ start: 0.25, end: 0.5 }, { startSec: 10, spanSec: 120 }), '0:40.00 – 1:10.00');
    assert.equal(loopRegionClockText({ start: 0, end: 1 }, { startSec: 0, spanSec: 5.5 }), '0:00.00 – 0:05.50');
});
