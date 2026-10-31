import assert from 'node:assert/strict';
import test from 'node:test';
import { createHeaderProbe, createScanProgress, PER_FILE_MS, UNKNOWN_DURATION_S } from '../webview/runtime/entryScanQueue';

test('the estimate counts each file and its seconds of audio; a file of unknown length counts as UNKNOWN_DURATION_S', () => {
    const lengths = new Map([['/a', 2], ['/b', 600]]);
    const progress = createScanProgress(() => 0, path => lengths.get(path));
    assert.equal(progress.seconds(['/a', '/b', '/c']), 2 + 600 + UNKNOWN_DURATION_S);
    assert.equal(progress.estimateMs(['/a']), PER_FILE_MS + 35 * 2);
    assert.equal(progress.running, false);
});

test('a computation counts its files and, after five, measures its own pace per second of audio', () => {
    let now = 1000;
    const progress = createScanProgress(() => now, () => 10);
    progress.fileDone('/x');
    assert.equal(progress.done, 0, 'nothing counts while no computation runs');
    progress.start(6);
    assert.deepEqual([progress.running, progress.done, progress.total], [true, 0, 6]);
    for (let file = 0; file < 4; file++) progress.fileDone(`/f${file}`);
    assert.equal(progress.estimateMs(['/next']), PER_FILE_MS + 35 * 10, 'four files are too few to measure the pace');
    now += 5 * PER_FILE_MS + 50 * 20;
    progress.fileDone('/f4');
    assert.equal(progress.done, 5);
    assert.equal(progress.estimateMs(['/next']), PER_FILE_MS + 20 * 10);
    assert.equal(progress.stop(), true);
    assert.equal(progress.stop(), false);
    assert.equal(progress.running, false);
});

test('headers are asked for once per file not read yet; answers of another request are stale', () => {
    const probe = createHeaderProbe();
    let ids = 0;
    const nextId = (): string => `probe-${++ids}`;
    assert.deepEqual(probe.start(['/a', '/b'], nextId), { type: 'entry-probe', requestId: 'probe-1', filePaths: ['/a', '/b'] });
    assert.deepEqual(probe.progress(), { done: 0, total: 2 });
    assert.equal(probe.take({ type: 'entry-probe-result', requestId: 'probe-0', filePath: '/a', channels: 2 }), 'stale');
    assert.equal(probe.take({ type: 'entry-probe-result', requestId: 'probe-1', filePath: '/a', channels: 2, durationS: 3 }), 'result');
    assert.equal(probe.take({ type: 'entry-probe-result', requestId: 'probe-1', filePath: '/b', error: 'not audio' }), 'result');
    assert.deepEqual(probe.progress(), { done: 2, total: 2 });
    assert.equal(probe.channels.get('/a'), 2);
    assert.equal(probe.durations.get('/a'), 3);
    assert.equal(probe.errors.get('/b'), 'not audio');
    assert.equal(probe.take({ type: 'entry-probe-done', requestId: 'probe-1' }), 'done');
    assert.equal(probe.progress(), null);
    assert.equal(probe.start(['/a', '/b'], nextId), null, 'every header is read: nothing is asked');
    assert.equal(ids, 1, 'no request id is spent on nothing');
    assert.deepEqual(probe.start(['/a', '/c'], nextId)?.filePaths, ['/c']);
    assert.equal(probe.cancel(), true);
    assert.equal(probe.cancel(), false);
    assert.equal(probe.take({ type: 'entry-probe-result', requestId: 'probe-2', filePath: '/c', channels: 1 }), 'stale');
    probe.clear();
    assert.equal(probe.channels.size + probe.errors.size + probe.durations.size, 0);
});
