/**
 * Spec 4's long computations (src/webview/answers/longComputations.ts, figure-design.md 第 6 節「読む要求の上限」):
 * a newer scan of the same asker takes the older one's place without the count ever passing 0, so the readout is held
 * without a gap and the Figures are not told to read again in the middle of it (the comparison asks a compare-scan
 * anew after each recording's result while its base group is scanned).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFigureAnswers } from '../webview/answers/figureRequests';
import { watchLongComputations } from '../webview/answers/longComputations';

test('a newer scan of the same asker takes the older one\'s place without the long computations ever ending in between (spec 4)', () => {
    const answers = createFigureAnswers({ post: () => undefined, cancels: false, holdsReadsWhileComputing: true });
    const told: boolean[] = [];
    answers.computations.onChange(computing => told.push(computing));
    const watch = watchLongComputations(answers.computations);
    watch.posted({ type: 'compare-scan', requestId: 'track-stage-1' });
    for (let n = 2; n <= 9; n++) watch.posted({ type: 'compare-scan', requestId: `track-stage-${n}` });
    assert.equal(answers.computations.count(), 1, 'one scan under way: the newest');
    assert.deepEqual(told, [true], 'held once, never let go in between');
    watch.received({ type: 'compare-scan-done', requestId: 'track-stage-8' });
    assert.equal(answers.computations.count(), 1, 'the done of a scan taken over ends nothing');
    watch.received({ type: 'compare-scan-done', requestId: 'track-stage-9' });
    assert.equal(answers.computations.count(), 0);
    assert.deepEqual(told, [true, false], 'let go once, when the newest is done');
});

test('a reanalysis begun again while one runs is one long computation without a gap', () => {
    const answers = createFigureAnswers({ post: () => undefined, cancels: false, holdsReadsWhileComputing: true });
    const told: boolean[] = [];
    answers.computations.onChange(computing => told.push(computing));
    const watch = watchLongComputations(answers.computations);
    watch.received({ type: 'reanalyze-start' });
    watch.received({ type: 'reanalyze-start' });
    assert.equal(answers.computations.count(), 1);
    watch.received({ type: 'reanalyze-end' });
    assert.equal(answers.computations.count(), 0);
    assert.deepEqual(told, [true, false]);
});
