import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { processStdoutChunk } from '../extension/backendIpc';

test('processStdoutChunk: dispatches a complete line to the matching pending request', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let resolved: unknown = null;
    pending.set('r1', { resolve: (v) => { resolved = v; }, reject: () => { /* unused */ } });

    const buf = { value: '' };
    processStdoutChunk(buf, '{"requestId":"r1","ok":true}\n', pending);

    assert.deepEqual(resolved, { requestId: 'r1', ok: true });
    assert.equal(pending.size, 0);
    assert.equal(buf.value, '');
});

test('processStdoutChunk: buffers a partial line until the newline arrives', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let resolved: unknown = null;
    pending.set('r1', { resolve: (v) => { resolved = v; }, reject: () => { /* unused */ } });

    const buf = { value: '' };
    processStdoutChunk(buf, '{"requestId":"r1",', pending);
    assert.equal(resolved, null);
    processStdoutChunk(buf, '"ok":true}\n', pending);
    assert.deepEqual(resolved, { requestId: 'r1', ok: true });
});

test('processStdoutChunk: error field rejects the pending promise', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let rejected: Error | null = null;
    pending.set('r1', { resolve: () => { /* unused */ }, reject: (e) => { rejected = e; } });

    const buf = { value: '' };
    processStdoutChunk(buf, '{"requestId":"r1","error":"boom"}\n', pending);

    assert.ok(rejected);
    assert.equal((rejected as Error).message, 'boom');
});

test('processStdoutChunk: ignores malformed JSON lines without throwing', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const buf = { value: '' };
    processStdoutChunk(buf, 'not json\n', pending);
    assert.equal(buf.value, '');
});

test('processStdoutChunk: heartbeat line calls onUnhandled and leaves pending intact', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let resolved: unknown = null;
    pending.set('r1', { resolve: (v) => { resolved = v; }, reject: () => { /* unused */ } });

    const unhandled: Array<Record<string, unknown>> = [];
    const buf = { value: '' };
    processStdoutChunk(buf, '{"type":"heartbeat","ts":1234567890}\n', pending, (msg) => { unhandled.push(msg); });

    assert.equal(unhandled.length, 1, 'onUnhandled should be called once for the heartbeat');
    assert.equal(unhandled[0]!['type'], 'heartbeat');
    assert.equal(unhandled[0]!['ts'], 1234567890);
    assert.equal(resolved, null, 'pending request should be unaffected');
    assert.equal(pending.size, 1, 'pending map should still contain r1');
});

test('processStdoutChunk: onUnhandled not called for ready message', () => {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const unhandled: Array<Record<string, unknown>> = [];
    const buf = { value: '' };
    processStdoutChunk(buf, '{"type":"ready"}\n', pending, (msg) => { unhandled.push(msg); });

    assert.equal(unhandled.length, 0, 'ready message should not reach onUnhandled');
});
