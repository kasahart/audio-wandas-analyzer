import assert from 'node:assert/strict';
import test from 'node:test';
import { createHeaderProbe } from '../webview/runtime/entryHeaders';

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
    assert.deepEqual(probe.info.get('/a'), { durationS: 3 });
    // The host says the file is calibrated now: its information says so, its header as it was.
    probe.calibrated('/a', true);
    assert.deepEqual(probe.info.get('/a'), { durationS: 3, calibrated: true });
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
    assert.equal(probe.channels.size + probe.errors.size + probe.info.size, 0);
});

test('a file written again is read again, and keeps what its header said until the new one is in: its rows and channels do not go and come back', () => {
    const probe = createHeaderProbe();
    let ids = 0;
    const nextId = (): string => `probe-${++ids}`;
    probe.start(['/a', '/b'], nextId);
    probe.take({ type: 'entry-probe-result', requestId: 'probe-1', filePath: '/a', channels: 2, durationS: 3 });
    probe.take({ type: 'entry-probe-result', requestId: 'probe-1', filePath: '/b', channels: 1, durationS: 5 });
    probe.take({ type: 'entry-probe-done', requestId: 'probe-1' });
    probe.forget('/a');
    assert.equal(probe.channels.get('/a'), 2, 'still two channels while it is read again');
    assert.deepEqual(probe.info.get('/a'), { durationS: 3 });
    assert.deepEqual(probe.start(['/a', '/b'], nextId)?.filePaths, ['/a'], 'only the file written again is asked for');
    probe.take({ type: 'entry-probe-result', requestId: 'probe-2', filePath: '/a', channels: 1, durationS: 4 });
    assert.equal(probe.channels.get('/a'), 1, 'the new header');
    assert.deepEqual(probe.info.get('/a'), { durationS: 4 });
    probe.take({ type: 'entry-probe-done', requestId: 'probe-2' });
    assert.equal(probe.start(['/a', '/b'], nextId), null, 'read once: not asked for again');
});
