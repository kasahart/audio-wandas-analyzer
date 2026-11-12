/**
 * The peak a new trigger's level starts from (display rules R1): read from every sample of the compared channels
 * through their full data, never taken from the envelope a lane draws. See src/webview/runtime/regionPeak.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { fetchedSource, localLine, NO_FULL_DATA } from '../webview/runtime/fullRead';
import { regionPeak } from '../webview/runtime/regionPeak';

/** One second at 1 kHz: a quiet tone (±0.1) with one sample of 0.9 at 0.5005 s and one of −0.6 at 0.2 s. */
const RATE = 1000;
const TIMES = Array.from({ length: RATE }, (_, n) => n / RATE);
const SAMPLES = TIMES.map((_, n) => (n === 500 ? 0.9 : n === 200 ? -0.6 : 0.1 * Math.sin(n * 0.37)));

/** The largest |sample| of SAMPLES from time `from` to `to`, both in: the answer, worked out here from every sample. */
function truePeak(from: number, to: number): number {
    return Math.max(...SAMPLES.filter((_, n) => TIMES[n] >= from && TIMES[n] <= to).map(Math.abs));
}

/**
 * What the envelope a lane draws would give: SAMPLES thinned to `buckets` min/max pairs, each extreme kept with its
 * time, and the largest |extreme| whose time is inside the region. This is the old calculation (envelopePeak.ts,
 * deleted); it is here only to prove the test's region is one where it is wrong.
 */
function thinnedPeak(buckets: number, from: number, to: number): number {
    const size = SAMPLES.length / buckets;
    let peak = 0;
    for (let bucket = 0; bucket < buckets; bucket++) {
        const first = bucket * size, block = SAMPLES.slice(first, first + size);
        for (const extreme of [Math.min(...block), Math.max(...block)]) {
            const at = TIMES[first + block.indexOf(extreme)];
            if (at >= from && at <= to) peak = Math.max(peak, Math.abs(extreme));
        }
    }
    return peak;
}

test('a region\'s peak is read from every sample: a region that cuts a drawn bucket reads its own largest sample, which the thinned envelope does not hold (R1)', () => {
    const full = localLine(TIMES, SAMPLES);
    // 0.452–0.458 s: seven samples inside the drawn bucket 0.4–0.499 s (of 10 buckets). The envelope keeps only that
    // bucket's two extremes, which are elsewhere in it: the region's own largest sample lies between the thinned points.
    const [from, to] = [0.452, 0.458];
    const peak = regionPeak([{ full, x0: from, x1: to }], () => undefined);
    assert.deepEqual(peak, { state: 'ready', value: truePeak(from, to) }, 'regionPeak must give the largest sample inside the region (FullSource.level → peak)');
    assert.notEqual(thinnedPeak(10, from, to), truePeak(from, to), 'this region is one the thinned envelope gets wrong; if this fails the fixture no longer proves anything: pick another region');
    // The spike just outside is not counted; a region holding it reads it.
    assert.ok(peak?.state === 'ready' && peak.value < 0.2);
    assert.deepEqual(regionPeak([{ full, x0: 0.45, x1: 0.5005 }], () => undefined), { state: 'ready', value: 0.9 });
    // A negative sample counts by its size, and of several channels the largest is taken.
    assert.deepEqual(regionPeak([{ full, x0: 0.15, x1: 0.25 }], () => undefined), { state: 'ready', value: 0.6 });
    assert.deepEqual(regionPeak([{ full, x0: 0.15, x1: 0.25 }, { full, x0: 0.45, x1: 0.55 }], () => undefined), { state: 'ready', value: 0.9 });
    // Nothing compared: no peak at all (the entry table).
    assert.equal(regionPeak([], () => undefined), undefined);
});

test('while a channel\'s peak is being read it is pending, and a failed read is failed until the answer store\'s pause is over: neither carries a number (R1)', async () => {
    let clock = 1_000_000, failing = true, asked = 0;
    // A channel the backend holds: its level read answers with the peak of the window (full_read.read_level).
    const full = fetchedSource((read, done) => {
        asked++;
        const answer = failing ? null : { xs: [], start: null, end: null, complete: false, level: { power: 0.01, count: 100, peak: truePeak(read.x[0], read.x[1]) } };
        setTimeout(() => { done(answer); }, 0);
    }, {}, () => clock);
    let woken = 0;
    const read = () => regionPeak([{ full, x0: 0.45, x1: 0.5005 }], () => { woken++; });
    assert.deepEqual(read(), { state: 'pending' }, 'asked for, not yet answered');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(woken, 1, 'the caller is told when the answer is in, to read again');
    // The read failed: no number, and within the pause it is not asked again.
    assert.deepEqual(read(), { state: 'failed' });
    assert.equal(asked, 1, 'a failed read is not asked again before the answer store\'s pause is over (FAILED_RETRY_MS)');
    // Past the pause the same read is asked again, by the store's rule: pending, then the value.
    failing = false;
    clock += FAILED_RETRY_MS + 1;
    assert.deepEqual(read(), { state: 'pending' });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(asked, 2);
    assert.deepEqual(read(), { state: 'ready', value: 0.9 });
    assert.equal(asked, 2, 'an answer in hand is kept, not asked for again');
    // A channel with no full data to read, and an answer that names no peak, are failures too: never a peak of 0.
    assert.deepEqual(regionPeak([{ full: { ...NO_FULL_DATA, level: () => null }, x0: 0, x1: 1 }], () => undefined), { state: 'failed' });
    assert.deepEqual(regionPeak([{ full: NO_FULL_DATA, x0: 0, x1: 1 }], () => undefined), { state: 'failed' });
});
