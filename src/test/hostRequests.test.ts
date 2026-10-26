import test from 'node:test';
import assert from 'node:assert/strict';
import { HostRequests, nextRequestId } from '../webview/runtime/hostRequests';

test('a new request supersedes its slot: the old answer is stale for the slot but still known until settled', () => {
    const requests = new HostRequests<{ cursor: number }>();
    const sent: string[] = [];
    requests.ask('slice', 'a', '0.1', { cursor: 0.1 }, request => sent.push(request.requestId));
    requests.ask('slice', 'b', '0.2', { cursor: 0.2 });
    assert.deepEqual(sent, ['a']);
    assert.equal(requests.pending('slice')?.requestId, 'b');
    assert.equal(requests.answering('slice', 'a'), undefined);
    assert.equal(requests.find('a')?.key, '0.1');
    assert.equal(requests.answering('slice', 'b')?.meta.cursor, 0.2);
    requests.settle('a');
    assert.equal(requests.pending('slice')?.requestId, 'b', 'settling a superseded request leaves the slot to the newer one');
    requests.settle('b');
    assert.equal(requests.pending('slice'), undefined);
    assert.equal(requests.find('b'), undefined);
});

test('drop and clear make answers stale; slots are independent', () => {
    const requests = new HostRequests();
    requests.ask('range', 'r1', 'x', undefined);
    requests.ask('detail', 'd1', 'y', undefined);
    requests.drop('range');
    assert.equal(requests.answering('range', 'r1'), undefined);
    assert.equal(requests.answering('detail', 'd1')?.key, 'y');
    requests.clear();
    assert.equal(requests.pending('detail'), undefined);
});

test('request ids are unique and carry their prefix and owner', () => {
    const a = nextRequestId('slice', 2), b = nextRequestId('slice', 2);
    assert.notEqual(a, b);
    assert.match(a, /^slice-2-\d+-[0-9a-z]+$/);
});
