import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import {
    processStdoutChunk,
    rejectPendingRequests,
    type BackendDiagnostic,
    type PendingRequest,
} from '../extension/backendIpc';
import {
    BackendProtocolError,
    isBackendCommand,
    isJsonObject,
    parseBackendResult,
    type BackendCommand,
    type BackendNotification,
} from '../extension/backendProtocol';

function loadValidResponseFixtures(): Array<{
    command: BackendCommand;
    response: { [key: string]: unknown };
}> {
    const fixturePath = path.resolve(process.cwd(), 'src/test/fixtures/backendProtocol.json');
    const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (!isJsonObject(parsed) || !Array.isArray(parsed['validResponses'])) {
        throw new Error('Invalid backend protocol fixture file');
    }
    return parsed['validResponses'].map((entry) => {
        if (!isJsonObject(entry) || !isBackendCommand(entry['command']) || !isJsonObject(entry['response'])) {
            throw new Error('Invalid backend response fixture');
        }
        return { command: entry['command'], response: entry['response'] };
    });
}

function makePending(
    command: BackendCommand,
    resolved: unknown[],
    rejected: Error[],
): PendingRequest {
    return {
        command,
        complete: (response) => { resolved.push(parseBackendResult(command, response)); },
        reject: (error) => { rejected.push(error); },
    };
}

test('processStdoutChunk validates and resolves every command response', () => {
    for (const { command, response } of loadValidResponseFixtures()) {
        const pending = new Map<string, PendingRequest>();
        const resolved: unknown[] = [];
        const rejected: Error[] = [];
        pending.set(command, makePending(command, resolved, rejected));

        processStdoutChunk({ value: '' }, `${JSON.stringify(response)}\n`, pending);

        assert.equal(resolved.length, 1, command);
        assert.equal(rejected.length, 0, command);
        assert.equal(pending.size, 0, command);
    }
});

test('processStdoutChunk buffers partial lines and handles multiple responses', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('range', resolved, rejected));
    pending.set('r2', makePending('export-wav-loop', resolved, rejected));
    const buffer = { value: '' };

    processStdoutChunk(buffer, '{"requestId":"r1","startNorm":0,', pending);
    assert.equal(resolved.length, 0);
    processStdoutChunk(
        buffer,
        '"endNorm":1,"channels":[]}\n{"requestId":"r2","wavBase64":"UklGRg==","sampleRate":16000}\n',
        pending,
    );

    assert.equal(resolved.length, 2);
    assert.equal(rejected.length, 0);
    assert.equal(pending.size, 0);
    assert.equal(buffer.value, '');
});

test('processStdoutChunk rejects an error response and removes the pending request', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('analyze', resolved, rejected));

    processStdoutChunk({ value: '' }, '{"requestId":"r1","error":"boom"}\n', pending);

    assert.equal(resolved.length, 0);
    assert.equal(rejected[0]?.message, 'boom');
    assert.equal(pending.size, 0);
});

test('processStdoutChunk diagnoses malformed JSON', () => {
    const diagnostics: BackendDiagnostic[] = [];

    processStdoutChunk(
        { value: '' },
        'not json\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'malformed-json');
});

test('processStdoutChunk handles ready and heartbeat as typed notifications', () => {
    const notifications: BackendNotification[] = [];

    processStdoutChunk(
        { value: '' },
        '{"type":"ready"}\n{"type":"heartbeat","ts":1234567890}\n',
        new Map(),
        { onNotification: (notification) => { notifications.push(notification); } },
    );

    assert.deepEqual(notifications, [
        { type: 'ready' },
        { type: 'heartbeat', ts: 1234567890 },
    ]);
});

test('processStdoutChunk diagnoses unknown notifications', () => {
    const diagnostics: BackendDiagnostic[] = [];

    processStdoutChunk(
        { value: '' },
        '{"type":"mystery","value":1}\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'unknown-notification');
});

test('processStdoutChunk diagnoses orphan responses', () => {
    const diagnostics: BackendDiagnostic[] = [];

    processStdoutChunk(
        { value: '' },
        '{"requestId":"missing","startNorm":0,"endNorm":1,"channels":[]}\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'orphan-response');
    assert.equal(diagnostics[0]?.requestId, 'missing');
});

test('processStdoutChunk rejects a wrong-command result without leaking pending state', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    const diagnostics: BackendDiagnostic[] = [];
    pending.set('r1', makePending('range', resolved, rejected));

    processStdoutChunk(
        { value: '' },
        '{"requestId":"r1","wavBase64":"UklGRg==","sampleRate":16000}\n',
        pending,
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(resolved.length, 0);
    assert.ok(rejected[0] instanceof BackendProtocolError);
    assert.equal(diagnostics[0]?.kind, 'protocol-validation-error');
    assert.equal(pending.size, 0);
});

test('processStdoutChunk rejects non-finite numeric fields', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('range', resolved, rejected));

    processStdoutChunk(
        { value: '' },
        '{"requestId":"r1","startNorm":1e999,"endNorm":1,"channels":[]}\n',
        pending,
    );

    assert.equal(resolved.length, 0);
    assert.ok(rejected[0] instanceof BackendProtocolError);
    assert.equal(pending.size, 0);
});

test('processStdoutChunk rejects malformed error envelopes', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('analyze', resolved, rejected));

    processStdoutChunk(
        { value: '' },
        '{"requestId":"r1","error":{"message":"boom"}}\n',
        pending,
    );

    assert.equal(resolved.length, 0);
    assert.ok(rejected[0] instanceof BackendProtocolError);
    assert.equal(pending.size, 0);
});

test('rejectPendingRequests rejects and clears every request on backend exit or restart', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('analyze', resolved, rejected));
    pending.set('r2', makePending('range', resolved, rejected));
    const error = new Error('backend exited');

    rejectPendingRequests(pending, error);

    assert.deepEqual(rejected, [error, error]);
    assert.equal(pending.size, 0);
});
