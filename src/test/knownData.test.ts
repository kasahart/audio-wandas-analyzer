/**
 * The arrow keys' expectation in the ui-smoke contract (src/test/uiSmoke/knownData.ts, docs/display-rules.md R7) is
 * taken from the raw data the test posted, never from the plot. A line made of several recordings (the base group's
 * median, the Δ) is known from every member's values, by the rule (R1: the median of the members' values point by
 * point, none where any has none; the Δ the compared recording's values minus it), never from the first member alone:
 * a median's readable points are not its first recording's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { binGrid, differenceFromMedian, postedPictures, servedBins, stepOf, type ReadOf } from './uiSmoke/knownData';

const xs = [100, 1000, 5000];
const picture = (values: Array<number | null>): Record<string, unknown> => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs, values });
const read = (stage: string, label: string | null): ReadOf => ({
    id: '', stage, attrs: ['data-stage-canvas'], label, frame: 'SpectralFrame', image: false, filePath: null, ends: [xs[0], xs[xs.length - 1]], trackIndex: null, channelIndex: null,
});
const from = { at: xs[0], row: null, index: 0, identity: null };

test('the base group\'s median is stepped on its own readable points, not on its first recording\'s: of A −300, −300, 0 dB and B 0, 0, 0 dB the median −150 dB is a point (R7)', () => {
    const known = postedPictures([
        { filePath: '/data/a.wav', picture: picture([-300, -300, 0]) },
        { filePath: '/data/b.wav', picture: picture([0, 0, 0]) },
    ], { base: ['/data/a.wav', '/data/b.wav'], compare: null })(read('overlay', 'Base (median of 2)'));
    assert.ok(known && known.kind === 'line');
    // A level line has a silent floor (−250 dB): A's second bin is silent, the median's is not.
    assert.equal((stepOf(from, known, 1, false) as { index: number }).index, 1);
    assert.deepEqual(known.values, [-150, -150, 0]);
});

test('a Δ is the compared recording minus the base group\'s median, none where any member has none, and a line naming a recording or in its lane is its own (R7)', () => {
    const posted = [
        { filePath: '/data/a.wav', picture: picture([0, 0, 0]) },
        { filePath: '/data/b.wav', picture: picture([0, null, 0]) },
        { filePath: '/data/c.wav', picture: picture([-10, -10, -10]) },
    ];
    const known = postedPictures(posted, { base: ['/data/a.wav', '/data/b.wav'], compare: '/data/c.wav' });
    const delta = known(read('diff', null));
    assert.ok(delta && delta.kind === 'line');
    // No floor on a Δ, but no value at the second bin: → from the first goes to the third.
    assert.equal((stepOf(from, delta, 1, true) as { index: number }).index, 2);
    assert.deepEqual(delta.values, [-10, null, -10]);
    const own = known(read('overlay', 'compare 1 · c.wav'));
    assert.ok(own && own.kind === 'line');
    assert.deepEqual(own.values, [-10, -10, -10]);
    // A recording's lane, unnamed, is that recording's own line, never the first one posted.
    const lane = known({ ...read('overlay', null), filePath: '/data/b.wav' });
    assert.ok(lane && lane.kind === 'line');
    assert.deepEqual(lane.values, [0, null, 0]);
});

test('a spectrum\'s bins are stepped on the values the stand-in served the line read: a level line skips a −260 dB bin and a gap, a plain one steps onto −260 dB (R7)', () => {
    const served = [
        { plot: 'spectrum', filePath: '/p/tone.wav', channelIndex: 0, values: [-20, -260, null, -30] },
        { plot: 'spectrum', filePath: '/p/tone.wav', channelIndex: 1, values: [-20, -20, -20, -20] },
    ];
    const spectrum = binGrid(line => line.id === 'spectrum-overlay-canvas', 4, 3000, (line, bins) => servedBins(served, 'spectrum', line, bins));
    const line = { ...read('overlay', 'tone.wav / Channel 1 (L)'), id: 'spectrum-overlay-canvas', frame: 'spectrum', ends: [0, 3000] as const };
    const known = spectrum(line);
    assert.ok(known && known.kind === 'line');
    const start = { at: 0, row: null, index: 0, identity: null };
    assert.equal((stepOf(start, known, 1, false) as { index: number }).index, 3);
    assert.equal((stepOf(start, known, 1, true) as { index: number }).index, 1);
    assert.equal((stepOf({ at: 1000, row: null, index: 1, identity: null }, known, 1, true) as { index: number }).index, 3);
    // The other channel's line is its own values; a line no served answer names is not known (never every bin readable).
    assert.deepEqual((spectrum({ ...line, label: 'tone.wav / Channel 2 / 2 (R)' }) as { values: unknown }).values, [-20, -20, -20, -20]);
    assert.equal(spectrum({ ...line, label: 'other.wav / Channel 1 (L)' }), null);
});

test('a held Δ is the held row\'s bins minus the median of its base\'s, none where any has none (R1, R7)', () => {
    assert.deepEqual(differenceFromMedian([-10, -10, -10], [[-20, null, -20], [-40, -40, -30]]), [20, null, 15]);
});
