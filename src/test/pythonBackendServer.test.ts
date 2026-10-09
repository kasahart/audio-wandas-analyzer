import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import {
    backendStartupError,
    BackendStartupError,
    BackendStartupCancelledError,
    formatPythonImportTiming,
    processStdoutLine,
    type BackendStdoutHandlers,
    waitForBackendStartup,
    type BackendDiagnostic,
    type PendingRequest,
} from '../extension/backendIpc';
import {
    BackendProtocolError,
    isBackendCommand,
    isJsonObject,
    parseBackendResult,
    rejectPendingRequests,
    type BackendCommand,
    type BackendNotification,
} from '../shared/protocol/backendProtocol';

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

test('backendStartupError includes stderr when Python exits before ready', () => {
    const error = backendStartupError(
        'Python backend exited before ready (code 1)',
        'Traceback\nModuleNotFoundError: No module named numpy\n',
    );

    assert.equal(
        error.message,
        'Python backend exited before ready (code 1): Traceback\nModuleNotFoundError: No module named numpy',
    );
    assert.ok(error instanceof BackendStartupError);
});

test('formatPythonImportTiming keeps only slow imports as structured milliseconds', () => {
    assert.equal(
        formatPythonImportTiming('import time:     23157 |   15918135 | wandas'),
        '[import] module=wandas self_ms=23.16 cumulative_ms=15918.14',
    );
    assert.equal(formatPythonImportTiming('import time:       100 |       9999 | small_module'), null);
    assert.equal(formatPythonImportTiming('import time: self [us] | cumulative | imported package'), null);
});

test('waitForBackendStartup lets cancellation interrupt a pending startup', async () => {
    let cancel: (() => void) | undefined;
    let resolveStartup: (() => void) | undefined;
    const startup = new Promise<void>((resolve) => { resolveStartup = resolve; });
    const waiting = waitForBackendStartup(startup, {
        isCancellationRequested: false,
        onCancellationRequested: (listener) => {
            cancel = listener;
            return { dispose: () => { cancel = undefined; } };
        },
    });

    cancel?.();

    await assert.rejects(waiting, BackendStartupCancelledError);
    resolveStartup?.();
});

test('heartbeat restart rejects requests owned by the killed backend before replacing it', () => {
    const source = readFileSync(
        path.resolve(process.cwd(), 'src/extension/pythonBackendServer.ts'),
        'utf8',
    );

    assert.match(
        source,
        /this\.stopWatchdog\(\);[\s\S]*this\.rejectAll\(error\);[\s\S]*child\?\.kill\(\);[\s\S]*this\.ensureRunning\(\)/u,
    );
});

function calibratedAnalyzeResponse(): { [key: string]: unknown } {
    const measurement = {
        calibrationStatus: 'calibrated',
        calibrationSource: 'manual',
        factor: 2,
        linearUnit: 'Pa',
        referenceValue: 2e-5,
        referenceUnit: 'Pa',
        levelUnit: 'dB SPL',
        levelReferenceLabel: 're 20 µPa',
    };
    const scale = {
        unit: 'dB SPL',
        axisLabel: 'Amplitude level [re 20 µPa]',
        referenceValue: 2e-5,
        referenceUnit: 'Pa',
        levelReferenceLabel: 're 20 µPa',
    };
    return {
        schemaVersion: 2,
        filePath: '/tmp/calibrated.wav',
        fileName: 'calibrated.wav',
        sampleRateHz: 48_000,
        durationSeconds: 1,
        channelCount: 1,
        sampleCount: 48_000,
        calibrationSignature: 'cal-v1',
        analysisRevision: 3,
        calibrationProfile: {
            schemaVersion: 1,
            channels: [{
                channelIndex: 0,
                expectedLabel: 'microphone',
                status: 'calibrated',
                source: 'manual',
                factor: 2,
                unit: 'Pa',
                referenceValue: 2e-5,
            }],
        },
        units: { amplitudeLevel: scale, spectrumLevel: scale, spectrogramLevel: scale },
        channels: [{
            label: 'microphone',
            unit: 'Pa',
            measurement,
            peakAbsolute: 0.2,
            peakLevelDb: 80,
            rawPeakFullScale: 0.1,
            clipped: false,
            waveform: { min: [-0.1], max: [0.1], samples: [0], absolutePeak: 0.1 },
            spectrogram: {
                values: [[74]],
                timeBins: 1,
                frequencyBins: 1,
                windowSize: 1024,
                hopSize: 256,
                maxFrequencyHz: 24_000,
                minDb: 74,
                maxDb: 74,
                ...scale,
            },
        }],
    };
}

function cloneRecord(value: { [key: string]: unknown }): { [key: string]: unknown } {
    return JSON.parse(JSON.stringify(value)) as { [key: string]: unknown };
}

test('parseBackendResult accepts a complete calibrated analysis response', () => {
    assert.doesNotThrow(() => parseBackendResult('analyze', calibratedAnalyzeResponse()));
});

test('parseBackendResult rejects malformed calibration analysis fields', () => {
    const mutations: Array<[string, (candidate: { [key: string]: unknown }) => void]> = [
        ['schema version', (candidate) => { candidate['schemaVersion'] = 1; }],
        ['analysis revision', (candidate) => { candidate['analysisRevision'] = -1; }],
        ['calibration signature', (candidate) => { candidate['calibrationSignature'] = 2; }],
        ['profile factor', (candidate) => {
            const profile = candidate['calibrationProfile'] as { channels: Array<{ factor: unknown }> };
            profile.channels[0].factor = 1e308;
        }],
        ['measurement source', (candidate) => {
            const channels = candidate['channels'] as Array<{ measurement: { calibrationSource: unknown } }>;
            channels[0].measurement.calibrationSource = 'unknown';
        }],
        ['measurement reference', (candidate) => {
            const channels = candidate['channels'] as Array<{ measurement: { referenceValue: unknown } }>;
            channels[0].measurement.referenceValue = 0;
        }],
        ['peak level', (candidate) => {
            const channels = candidate['channels'] as Array<{ peakLevelDb: unknown }>;
            channels[0].peakLevelDb = '80';
        }],
        ['clipping state', (candidate) => {
            const channels = candidate['channels'] as Array<{ clipped: unknown }>;
            channels[0].clipped = 'false';
        }],
        ['spectrogram reference', (candidate) => {
            const channels = candidate['channels'] as Array<{ spectrogram: { referenceValue: unknown } }>;
            channels[0].spectrogram.referenceValue = -1;
        }],
        ['shared unit metadata', (candidate) => {
            const units = candidate['units'] as { amplitudeLevel: { referenceValue: unknown } };
            units.amplitudeLevel.referenceValue = '2e-5';
        }],
    ];

    for (const [label, mutate] of mutations) {
        const candidate = cloneRecord(calibratedAnalyzeResponse());
        mutate(candidate);
        assert.throws(() => parseBackendResult('analyze', candidate), BackendProtocolError, label);
    }
});

test('parseBackendResult validates calibration identity on lazy results', () => {
    assert.throws(() => parseBackendResult('range', {
        startNorm: 0,
        endNorm: 1,
        channels: [],
        calibrationSignature: 1,
    }), BackendProtocolError);
    assert.throws(() => parseBackendResult('track-detail', {
        trackIndex: 0,
        analysisId: 'analysis',
        settingsSignature: 'settings',
        filePath: '/tmp/calibrated.wav',
        channels: [],
        analysisRevision: -1,
    }), BackendProtocolError);
    assert.throws(() => parseBackendResult('spectrum-slice', {
        trackIndex: 0,
        analysisId: 'analysis',
        settingsSignature: 'settings',
        filePath: '/tmp/calibrated.wav',
        channels: [{ channelIndex: 0, values: [74], minDb: 74, maxDb: 74, referenceValue: 0 }],
        frequencyBins: 1,
        maxFrequencyHz: 24_000,
    }), BackendProtocolError);
});

function feedStdoutChunk(
    buffer: { input?: PassThrough },
    chunk: string,
    pending: Map<string, PendingRequest>,
    handlers: BackendStdoutHandlers = {},
): void {
    if (!buffer.input) {
        buffer.input = new PassThrough();
        const reader = createInterface({ input: buffer.input, crlfDelay: Infinity });
        reader.on('line', line => { processStdoutLine(line, pending, handlers); });
    }
    buffer.input.write(chunk);
    if (chunk.endsWith('\n')) { buffer.input.end(); }
}

test('feedStdoutChunk validates and resolves every command response', () => {
    for (const { command, response } of loadValidResponseFixtures()) {
        const pending = new Map<string, PendingRequest>();
        const resolved: unknown[] = [];
        const rejected: Error[] = [];
        pending.set(command, makePending(command, resolved, rejected));

        feedStdoutChunk({}, `${JSON.stringify(response)}\n`, pending);

        assert.equal(resolved.length, 1, command);
        assert.equal(rejected.length, 0, command);
        assert.equal(pending.size, 0, command);
    }
});

test('feedStdoutChunk buffers partial lines and handles multiple responses', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('range', resolved, rejected));
    pending.set('r2', makePending('export-wav-loop', resolved, rejected));
    const buffer: { input?: PassThrough } = {};

    feedStdoutChunk(buffer, '{"requestId":"r1","startNorm":0,', pending);
    assert.equal(resolved.length, 0);
    feedStdoutChunk(
        buffer,
        '"endNorm":1,"channels":[]}\n{"requestId":"r2","wavBase64":"UklGRg==","sampleRate":16000}\n',
        pending,
    );

    assert.equal(resolved.length, 2);
    assert.equal(rejected.length, 0);
    assert.equal(pending.size, 0);
});

test('feedStdoutChunk rejects an error response and removes the pending request', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('analyze', resolved, rejected));

    feedStdoutChunk({}, '{"requestId":"r1","error":"boom"}\n', pending);

    assert.equal(resolved.length, 0);
    assert.equal(rejected[0]?.message, 'boom');
    assert.equal(pending.size, 0);
});

test('feedStdoutChunk diagnoses malformed JSON', () => {
    const diagnostics: BackendDiagnostic[] = [];

    feedStdoutChunk(
        {},
        'not json\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'malformed-json');
});

test('feedStdoutChunk handles ready and heartbeat as typed notifications', () => {
    const notifications: BackendNotification[] = [];

    feedStdoutChunk(
        {},
        '{"type":"ready"}\n{"type":"heartbeat","ts":1234567890}\n',
        new Map(),
        { onNotification: (notification) => { notifications.push(notification); } },
    );

    assert.deepEqual(notifications, [
        { type: 'ready' },
        { type: 'heartbeat', ts: 1234567890 },
    ]);
});

test('feedStdoutChunk diagnoses unknown notifications', () => {
    const diagnostics: BackendDiagnostic[] = [];

    feedStdoutChunk(
        {},
        '{"type":"mystery","value":1}\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'unknown-notification');
});

test('feedStdoutChunk diagnoses orphan responses', () => {
    const diagnostics: BackendDiagnostic[] = [];

    feedStdoutChunk(
        {},
        '{"requestId":"missing","startNorm":0,"endNorm":1,"channels":[]}\n',
        new Map(),
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(diagnostics[0]?.kind, 'orphan-response');
    assert.equal(diagnostics[0]?.requestId, 'missing');
});

test('feedStdoutChunk rejects a wrong-command result without leaking pending state', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    const diagnostics: BackendDiagnostic[] = [];
    pending.set('r1', makePending('range', resolved, rejected));

    feedStdoutChunk(
        {},
        '{"requestId":"r1","wavBase64":"UklGRg==","sampleRate":16000}\n',
        pending,
        { onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } },
    );

    assert.equal(resolved.length, 0);
    assert.ok(rejected[0] instanceof BackendProtocolError);
    assert.equal(diagnostics[0]?.kind, 'protocol-validation-error');
    assert.equal(pending.size, 0);
});

test('feedStdoutChunk rejects non-finite numeric fields', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('range', resolved, rejected));

    feedStdoutChunk(
        {},
        '{"requestId":"r1","startNorm":1e999,"endNorm":1,"channels":[]}\n',
        pending,
    );

    assert.equal(resolved.length, 0);
    assert.ok(rejected[0] instanceof BackendProtocolError);
    assert.equal(pending.size, 0);
});

test('feedStdoutChunk rejects malformed error envelopes', () => {
    const pending = new Map<string, PendingRequest>();
    const resolved: unknown[] = [];
    const rejected: Error[] = [];
    pending.set('r1', makePending('analyze', resolved, rejected));

    feedStdoutChunk(
        {},
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

test('shared reply correlation consumes a request once and isolates completion failures', async () => {
    const { settleBackendRequest, rejectPendingRequests } = await import('../shared/protocol/backendProtocol');
    const completed: unknown[] = [], rejected: Error[] = [];
    const pending = new Map<string, import('../shared/protocol/backendProtocol').PendingBackendRequest<Record<string, unknown>>>();
    pending.set('r', { command: 'analyze', complete: value => { completed.push(value); }, reject: error => { rejected.push(error); } });
    assert.equal(settleBackendRequest(pending, 'r', { ok: true }), undefined);
    assert.equal(settleBackendRequest(pending, 'r', { late: true })?.kind, 'orphan-response');
    assert.deepEqual(completed, [{ ok: true }]);
    pending.set('bad', { command: 'range', complete: () => { throw new Error('bad shape'); }, reject: error => { rejected.push(error); } });
    assert.equal(settleBackendRequest(pending, 'bad', {})?.kind, 'protocol-validation-error');
    assert.equal(pending.size, 0);
    pending.set('cancelled', { command: 'range', complete: () => assert.fail('cancelled request must not complete'), reject: error => { rejected.push(error); } });
    rejectPendingRequests(pending, new Error('cancelled'));
    assert.equal(pending.size, 0);
    assert.equal(rejected.length, 2);
});


test('readline preserves split UTF-8, CRLF and a final response without newline', async () => {
    const input = new PassThrough();
    const reader = createInterface({ input, crlfDelay: Infinity });
    const closed = once(reader, 'close');
    const rejected: Error[] = [];
    const pending = new Map<string, PendingRequest>([
        ['r1', makePending('analyze', [], rejected)],
        ['r2', makePending('analyze', [], rejected)],
    ]);
    reader.on('line', line => { processStdoutLine(line, pending); });
    const bytes = Buffer.from('{"requestId":"r1","error":"校正"}\r\n{"requestId":"r2","error":"終了"}');
    for (const byte of bytes) { input.write(Buffer.from([byte])); }
    input.end();
    await closed;
    assert.deepEqual(rejected.map(error => error.message), ['校正', '終了']);
    assert.equal(pending.size, 0);
});

for (const fails of [false, true]) {
    test(`startup ${fails ? 'failure' : 'success'} disposes its cancellation listener`, async () => {
        let disposals = 0;
        const startup = fails ? Promise.reject(new Error('startup failed')) : Promise.resolve();
        const waiting = waitForBackendStartup(startup, {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => { disposals++; } }),
        });
        if (fails) { await assert.rejects(waiting, /startup failed/); }
        else { await waiting; }
        assert.equal(disposals, 1);
    });
}
