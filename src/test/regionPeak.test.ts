/**
 * The peak a new trigger's level starts from (display rules R1): one answer of the backend's, of every sample of the
 * compared channels (AnalysisService.region_peak; python-backend/test_full_read.py holds it to every sample). The
 * webview only asks for it and keeps it: see src/webview/runtime/regionPeak.ts (`peak`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { createRegionPeaks, type PeakOf, type PeakTrack } from '../webview/runtime/regionPeak';

type Asked = { type: string; requestId: string; sources?: Array<{ filePath: string; channels: number[]; startNorm: number; endNorm: number; sourceVersion?: string }> };

const track = (filePath: string, sourceVersion = 'v1'): PeakTrack => ({ filePath, sourceVersion, calibrationSignature: 'c' });
const of = (filePath: string, channels: number[] = [0], stretch: [number, number] = [0.25, 0.375]): PeakOf => ({ filePath, track: track(filePath), channels, startNorm: stretch[0], endNorm: stretch[1] });

test('a region\'s peak is one answer of the backend\'s: asked once with every compared recording\'s channels and stretch, its number kept as sent, nothing computed of it here (R1)', () => {
    const posted: Asked[] = [];
    const reads = createRegionPeaks(message => { posted.push(message); });
    const compared = [of('/base.wav', [0]), of('/compare.wav', [0, 1])];
    assert.deepEqual(reads.peak(compared, 30), { state: 'pending' }, 'asked for, not yet answered');
    assert.equal(posted.length, 1, 'one request for all the recordings: the largest of them is the backend\'s to find');
    assert.equal(posted[0].type, 'request-region-peak');
    assert.deepEqual(posted[0].sources, [
        { filePath: '/base.wav', sourceVersion: 'v1', channels: [0], startNorm: 0.25, endNorm: 0.375 },
        { filePath: '/compare.wav', sourceVersion: 'v1', channels: [0, 1], startNorm: 0.25, endNorm: 0.375 },
    ]);
    // Still on its way: read again, it is not asked again.
    assert.deepEqual(reads.peak(compared, 30), { state: 'pending' });
    assert.equal(posted.length, 1);
    // The backend's number is the peak, as sent.
    assert.equal(reads.handle({ type: 'region-peak-result', requestId: posted[0].requestId, peak: 0.32 } as { type: string; requestId: string }), true);
    assert.deepEqual(reads.peak(compared, 30), { state: 'ready', value: 0.32 });
    assert.equal(posted.length, 1, 'an answer in hand is kept, not asked for again');
    // Another region, other channels or another version of a file is another answer.
    assert.deepEqual(reads.peak([of('/base.wav', [0], [0, 1]), of('/compare.wav', [0, 1], [0, 1])], 30), { state: 'pending' });
    assert.deepEqual(reads.peak([of('/base.wav', [0]), of('/compare.wav', [0])], 30), { state: 'pending' });
    assert.deepEqual(reads.peak([{ ...of('/base.wav', [0]), track: track('/base.wav', 'v2') }, of('/compare.wav', [0, 1])], 30), { state: 'pending' });
    assert.equal(posted.length, 4);
    // Nothing compared: no peak at all (the entry table).
    assert.equal(reads.peak([], 30), undefined);
});

test('while a region\'s peak is being read it is pending, and a failed read is failed until the answer store\'s pause is over: neither carries a number (R1)', () => {
    let clock = 1_000_000;
    const posted: Asked[] = [];
    const reads = createRegionPeaks(message => { posted.push(message); }, () => clock);
    const compared = [of('/base.wav')];
    assert.deepEqual(reads.peak(compared, 30), { state: 'pending' });
    // The read failed: no number, and within the pause it is not asked again.
    reads.handle({ type: 'region-peak-error', requestId: posted[0].requestId });
    assert.deepEqual(reads.peak(compared, 30), { state: 'failed' });
    assert.equal(posted.length, 1, 'a failed read is not asked again before the answer store\'s pause is over (FAILED_RETRY_MS)');
    // Past the pause the same read is asked again, by the store's rule: pending, then the value.
    clock += FAILED_RETRY_MS + 1;
    assert.deepEqual(reads.peak(compared, 30), { state: 'pending' });
    assert.equal(posted.length, 2);
    reads.handle({ type: 'region-peak-result', requestId: posted[1].requestId, peak: 0.9 } as { type: string; requestId: string });
    assert.deepEqual(reads.peak(compared, 30), { state: 'ready', value: 0.9 });
    // An answer that names no number is a failure too: never a peak of 0.
    const other = [of('/other.wav')];
    reads.peak(other, 30);
    reads.handle({ type: 'region-peak-result', requestId: posted[2].requestId });
    assert.deepEqual(reads.peak(other, 30), { state: 'failed' });
    // A recording with no data to read (its file changed since it was analysed) leaves the peak unknown, and nothing is asked.
    const asked = posted.length;
    assert.deepEqual(reads.peak([of('/base.wav'), { ...of('/changed.wav'), track: null }], 30), { state: 'failed' });
    assert.equal(posted.length, asked);
});

test('the peak of more recordings than the limit is not read at all: 31 recordings start no read and say so, 30 are read; channels of one recording count once (R1)', () => {
    const posted: Asked[] = [];
    const reads = createRegionPeaks(message => { posted.push(message); });
    const recordings = (count: number, channels: number[] = [0]): PeakOf[] => Array.from({ length: count }, (_, index) => of(`/${index}.wav`, channels));
    assert.deepEqual(reads.peak(recordings(31), 30), { state: 'tooMany', limit: 30 });
    assert.equal(posted.length, 0, 'over the limit no read may be started (peak must return before asking)');
    assert.deepEqual(reads.peak(recordings(30), 30), { state: 'pending' });
    assert.equal(posted.length, 1, 'at the limit the recordings are read, in one request');
    assert.equal(posted[0].sources?.length, 30);
    // Two channels each of 16 recordings are 16 recordings: under the limit.
    assert.deepEqual(reads.peak(recordings(16, [0, 1]), 30), { state: 'pending' });
    assert.equal(posted.length, 2);
});
