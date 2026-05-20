import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpectrumAtCursor, type SpectrumSource } from '../webview/spectrum/cursorSpectrum';

function makeSource(overrides: Partial<SpectrumSource> = {}): SpectrumSource {
    return {
        durationSeconds: 1.0,
        channels: [{
            spectrogram: {
                values: [
                    [-80, -60, -40, -20],
                    [-70, -50, -30, -10],
                    [-60, -40, -20, 0],
                    [-50, -30, -10, -5],
                ],
                timeBins: 4,
                frequencyBins: 4,
                windowSize: 512,
                hopSize: 256,
                maxFrequencyHz: 22050,
                minDb: -90,
                maxDb: 0,
            },
        }],
        ...overrides,
    };
}

test('extractSpectrumAtCursor: returns slice at correct time bin (cursor at t=0.0)', () => {
    const slice = extractSpectrumAtCursor(makeSource(), 0, 0, { startSec: 0, spanSec: 1 });
    assert.ok(slice);
    assert.deepEqual(slice!.values, [-80, -60, -40, -20]);
    assert.equal(slice!.frequencyBins, 4);
    assert.equal(slice!.maxFrequencyHz, 22050);
});

test('extractSpectrumAtCursor: cursor in middle picks middle bin', () => {
    // dur=1, cursorNorm=0.5 → trackLocalSec=0.5 → tIdx=floor(0.5*4)=2
    const slice = extractSpectrumAtCursor(makeSource(), 0, 0.5, { startSec: 0, spanSec: 1 });
    assert.deepEqual(slice!.values, [-60, -40, -20, 0]);
});

test('extractSpectrumAtCursor: cursor at end clamps to last bin (tIdx=timeBins-1)', () => {
    // dur=1, cursorNorm=1.0 → trackLocalSec=1.0 → tIdx=floor(1.0*4)=4, clamped to 3
    const slice = extractSpectrumAtCursor(makeSource(), 0, 1.0, { startSec: 0, spanSec: 1 });
    assert.deepEqual(slice!.values, [-50, -30, -10, -5]);
});

test('extractSpectrumAtCursor: returns null when cursor is before track start', () => {
    // offset=0.5: track plays from 0.5s to 1.5s. cursor at 0.2s is before start.
    const slice = extractSpectrumAtCursor(makeSource(), 0.5, 0.2, { startSec: 0, spanSec: 1 });
    assert.equal(slice, null);
});

test('extractSpectrumAtCursor: returns null when cursor is past track end', () => {
    // offset=0: track plays from 0 to 1. cursor at 1.5s is past end.
    const slice = extractSpectrumAtCursor(makeSource(), 0, 1.5, { startSec: 0, spanSec: 1 });
    assert.equal(slice, null);
});

test('extractSpectrumAtCursor: offset shifts the time bin selection', () => {
    // offset=0.25, cursor at 0.5s (global) → trackLocalSec=0.25 → tIdx=floor(0.25*4)=1
    const slice = extractSpectrumAtCursor(makeSource(), 0.25, 0.5, { startSec: 0, spanSec: 1 });
    assert.deepEqual(slice!.values, [-70, -50, -30, -10]);
});

test('extractSpectrumAtCursor: returns null when result has error', () => {
    const slice = extractSpectrumAtCursor(makeSource({ error: 'boom' }), 0, 0.5, { startSec: 0, spanSec: 1 });
    assert.equal(slice, null);
});

test('extractSpectrumAtCursor: returns null when result is missing', () => {
    assert.equal(extractSpectrumAtCursor(null, 0, 0, { startSec: 0, spanSec: 1 }), null);
    assert.equal(extractSpectrumAtCursor(undefined, 0, 0, { startSec: 0, spanSec: 1 }), null);
});

test('extractSpectrumAtCursor: returns null when channel has no spectrogram', () => {
    const slice = extractSpectrumAtCursor(
        { durationSeconds: 1, channels: [{ spectrogram: null }] },
        0, 0.5, { startSec: 0, spanSec: 1 },
    );
    assert.equal(slice, null);
});

test('extractSpectrumAtCursor: returns null when durationSeconds is zero', () => {
    const slice = extractSpectrumAtCursor(makeSource({ durationSeconds: 0 }), 0, 0.5, { startSec: 0, spanSec: 1 });
    assert.equal(slice, null);
});

test('extractSpectrumAtCursor: respects globalSpan.startSec offset', () => {
    // globalSpan from 10s..11s. cursorNorm=0 means cursor at 10s.
    // offset=10 → trackLocalSec=0 → tIdx=0
    const slice = extractSpectrumAtCursor(makeSource(), 10, 0, { startSec: 10, spanSec: 1 });
    assert.deepEqual(slice!.values, [-80, -60, -40, -20]);
});

test('extractSpectrumAtCursor: sweeping cursor during playback yields distinct slices', () => {
    // 再生中はカーソルが進むに従ってスペクトルが切り替わる必要がある。
    // 再生ループが各フレームで extractSpectrumAtCursor を呼ぶ前提なので、
    // 異なる再生位置で異なるスライスが返ることを契約として明示する。
    const source = makeSource();
    const cursors = [0.0, 0.3, 0.6, 0.9];
    const slices = cursors.map((c) => extractSpectrumAtCursor(source, 0, c, { startSec: 0, spanSec: 1 }));
    const valuesSeen = slices.map((s) => JSON.stringify(s!.values));
    const uniqueValues = new Set(valuesSeen);
    assert.equal(uniqueValues.size, cursors.length,
        '再生位置ごとに異なる時間ビンが選ばれること');
});
