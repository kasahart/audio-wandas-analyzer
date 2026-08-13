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
            rms: 0.1,
            peakAbsolute: 0.2,
            rmsLevelDb: 74,
            peakLevelDb: 80,
            rawPeakFullScale: 0.1,
            clipped: false,
            dominantFrequencies: [{ frequencyHz: 1_000, magnitude: 0.1 }],
            peaks: [{ freqHz: 1_000, amplitudeDb: 74, magnitude: 0.1, levelDb: 74 }],
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
        ['RMS level', (candidate) => {
            const channels = candidate['channels'] as Array<{ rmsLevelDb: unknown }>;
            channels[0].rmsLevelDb = '74';
        }],
        ['clipping state', (candidate) => {
            const channels = candidate['channels'] as Array<{ clipped: unknown }>;
            channels[0].clipped = 'false';
        }],
        ['spectrum magnitude', (candidate) => {
            const channels = candidate['channels'] as Array<{ peaks: Array<{ magnitude: unknown }> }>;
            channels[0].peaks[0].magnitude = '0.1';
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
