import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BACKEND_PROTOCOL_SCHEMA, type SchemaCommand } from '../shared/protocol/generated/backendProtocolSchema';
import { BACKEND_ERROR_CODES, parseBackendErrorPayload, parseBackendNotification, parseBackendResult } from '../shared/protocol/backendProtocol';
import { inlineSchemaViolation, schemaViolation, withoutRequestEnvelope, withoutResponseEnvelope, type SchemaNode } from '../shared/protocol/schemaValidation';
import Ajv2020 from 'ajv/dist/2020';

interface FixtureCase { command?: string; request: Record<string, unknown>; errorField?: string }
interface SchemaCase { schema: SchemaNode; value: unknown; violation: string | null }
const fixtures = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')) as {
    validRequests: FixtureCase[];
    invalidRequests: FixtureCase[];
    validResponses: Array<{ command: string; response: Record<string, unknown> }>;
    invalidResponses: Array<{ command: SchemaCommand; response: unknown; violation: string }>;
    schemaCases: SchemaCase[];
};
// Reference implementation for the cross-check; strict: false lets it ignore the x-* annotations.
const ajv = new Ajv2020({ strict: false });
const referenceIsValid = (schema: object, value: unknown): boolean =>
    ajv.validate<unknown>({ ...schema, $defs: BACKEND_PROTOCOL_SCHEMA.$defs }, value);
const commands = BACKEND_PROTOCOL_SCHEMA['x-commands'];
const schemaCases = (cases: FixtureCase[]): Array<FixtureCase & { command: SchemaCommand }> =>
    cases.filter((entry): entry is FixtureCase & { command: SchemaCommand } => typeof entry.command === 'string' && entry.command in commands);

test('schema commands accept the shared valid request fixtures', () => {
    const cases = schemaCases(fixtures.validRequests);
    assert.ok(cases.length > 0);
    for (const { command, request } of cases) {
        assert.equal(schemaViolation(commands[command].payload, withoutRequestEnvelope(request)), null, command);
    }
});

test('schema commands report the same invalid field as the Python validator', () => {
    const cases = schemaCases(fixtures.invalidRequests);
    assert.ok(cases.length > 0);
    for (const { command, request, errorField } of cases) {
        assert.equal(schemaViolation(commands[command].payload, withoutRequestEnvelope(request)), errorField, JSON.stringify(request));
    }
});

test('range results are checked by the schema plus the envelope length invariant', () => {
    const envelope = { min: [0, 1], max: [1, 2], samples: [0.5, 1.5], absolutePeak: 2 };
    const result = { startNorm: 0, endNorm: 1, channels: [envelope] };
    assert.deepEqual(parseBackendResult('range', result), result);
    assert.equal(schemaViolation('RangeResult', { ...result, channels: [{ ...envelope, absolutePeak: Number.NaN }] }), 'channels[0].absolutePeak');
    assert.equal(schemaViolation('RangeResult', { ...result, analysisRevision: 1.5 }), 'analysisRevision');
    assert.equal(schemaViolation('RangeResult', { ...result, analysisRevision: -1 }), 'analysisRevision', 'results keep the non-negative revision check');
    assert.throws(() => parseBackendResult('range', { ...result, channels: [{ ...envelope, samples: [0] }] }), /Invalid range success response/);
});

test('spectrum-slice results are checked by the schema plus the per-channel bin invariant', () => {
    const channel = { channelIndex: 0, values: [-10, -20], minDb: -20, maxDb: -10, referenceValue: 2e-5 };
    const result = { trackIndex: 0, analysisId: 'a', settingsSignature: 's', filePath: 'tone.wav', channels: [channel], frequencyBins: 2, maxFrequencyHz: 8000, windowStartNorm: 0.4, windowEndNorm: 0.6, window: 'hann', computeMs: 1 };
    assert.deepEqual(parseBackendResult('spectrum-slice', result), result);
    assert.equal(schemaViolation('SpectrumSliceResult', { ...result, channels: [{ ...channel, referenceValue: 0 }] }), 'channels[0].referenceValue');
    assert.throws(() => parseBackendResult('spectrum-slice', { ...result, channels: [] }), /Invalid spectrum-slice success response/);
    assert.throws(() => parseBackendResult('spectrum-slice', { ...result, frequencyBins: 3 }), /Invalid spectrum-slice success response/);
});

test('invalid response fixtures report the same path as Python and fail ajv', () => {
    assert.ok(fixtures.invalidResponses.length > 0);
    for (const { command, response, violation } of fixtures.invalidResponses) {
        const definition = commands[command].result;
        const result = withoutResponseEnvelope(response);
        assert.equal(schemaViolation(definition, result), violation, JSON.stringify(response));
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, result), false, JSON.stringify(response));
        assert.throws(() => parseBackendResult(command, result), /success response/);
    }
});

test('scan results are either a one-line failure or a full per-channel result', () => {
    const ok = {
        ok: true, conditionId: 'c', input: { id: 'i', fs: 16000, channels: [0, 1], durationS: 2, unit: 'FS', ref: 1 },
        leqDbA: [-9, -21], peakHz: [1000, 3150], spectrumDb: [[-9], [-21]], thirdOctDb: [[null], [-23]], crest: [1.4, 1.4],
        specVersion: 1, wandasVersion: '0.9.0', elapsedMs: 80,
    };
    assert.deepEqual(parseBackendResult('scan', ok), ok);
    assert.deepEqual(parseBackendResult('scan', { ok: false, reason: 'Unable to read audio' }), { ok: false, reason: 'Unable to read audio' });
    assert.throws(() => parseBackendResult('scan', { ok: false }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ok: false, reason: 'x', leqDbA: [] }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...ok, reason: 'x' }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...ok, crest: undefined }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...ok, leqDbA: [-9] }), /Invalid scan success response/);
    // A step's picture comes alone: the input and the picture, none of the metrics.
    const stage = { ok: true, input: ok.input, stage: { frame: 'NOctFrame', kind: 'bar', xs: [25], values: [-40] }, specVersion: 4, wandasVersion: '0.9.0', elapsedMs: 9 };
    assert.deepEqual(parseBackendResult('scan', stage), stage);
    assert.throws(() => parseBackendResult('scan', { ...stage, conditionId: 'c' }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...stage, input: undefined }), /Invalid scan success response/);
});

test('analyze and track-detail results keep the invariants the schema cannot express', () => {
    const envelope = { min: [0, 1], max: [1, 2], samples: [0.5, 1.5], absolutePeak: 2 };
    const spectrogram = { values: [[-10, -20]], timeBins: 1, frequencyBins: 2, windowSize: 64, hopSize: 32, maxFrequencyHz: 8000, minDb: -20, maxDb: -10 };
    const channel = { label: 'ch0', peakAbsolute: 2, waveform: envelope, spectrogram: null };
    const result = { filePath: 'tone.wav', fileName: 'tone.wav', sampleRateHz: 16000, durationSeconds: 1, channelCount: 1, sampleCount: 16000, channels: [channel] };
    const detail = { trackIndex: 0, analysisId: 'a', settingsSignature: 's', filePath: 'tone.wav', channels: [{ ...channel, spectrogram }] };
    assert.deepEqual(parseBackendResult('analyze', result), result);
    assert.deepEqual(parseBackendResult('track-detail', detail), detail);
    const invalidAnalyze = [
        { ...result, channelCount: 2 },
        { ...result, channels: [{ ...channel, waveform: { ...envelope, samples: [0] } }] },
        { ...result, channels: [{ ...channel, spectrogram: { ...spectrogram, timeBins: 2 } }] },
        { ...result, calibrationProfile: { schemaVersion: 1, channels: 'none' } },
    ];
    for (const value of invalidAnalyze) {
        assert.throws(() => parseBackendResult('analyze', value), /Invalid analyze success response/, JSON.stringify(value));
    }
    assert.throws(() => parseBackendResult('track-detail', { ...detail, channels: [{ ...channel, spectrogram: { ...spectrogram, frequencyBins: 3 } }] }), /Invalid track-detail success response/);
});

test('error payloads, notifications and Worker limits come from the schema', () => {
    assert.deepEqual([...BACKEND_ERROR_CODES], ['input-error', 'stale-calibration', 'internal-error']);
    assert.deepEqual(parseBackendErrorPayload({ code: 'stale-calibration', message: 'm' }), { code: 'stale-calibration', message: 'm' });
    assert.equal(parseBackendErrorPayload({ code: 'stale-calibration', message: 'm', extra: 1 }), null, 'keys the schema does not list are rejected');
    assert.equal(parseBackendNotification({ type: 'ready', version: 2 }), null);
    assert.equal(parseBackendErrorPayload({ code: 'unknown', message: 'm' }), null);
    assert.deepEqual(parseBackendNotification({ type: 'heartbeat', ts: 1.5 }), { type: 'heartbeat', ts: 1.5 });
    assert.equal(parseBackendNotification({ type: 'heartbeat', ts: Number.NaN }), null);
    assert.deepEqual(parseBackendNotification({ type: 'ready' }), { type: 'ready' });
    assert.deepEqual(parseBackendNotification({ type: 'started', requestId: 'r1' }), { type: 'started', requestId: 'r1' });
    assert.equal(parseBackendNotification({ type: 'started' }), null);
    const limits = { maxInputBytes: 1, maxSources: 1, maxTotalInputBytes: 1, maxExportBytes: 1 };
    assert.equal(schemaViolation('BrowserLimits', limits), null);
    assert.equal(schemaViolation('BrowserLimits', { ...limits, maxSources: 0 }), 'maxSources');
    assert.equal(schemaViolation('BrowserLimits', { ...limits, maxExportBytes: 2 ** 53 }), 'maxExportBytes');
    assert.equal(schemaViolation('BrowserLimits', { ...limits, maxChannels: 0 }), 'maxChannels');
});

test('undefined properties count as absent, as after JSON serialization', () => {
    const envelope = { min: [0], max: [1], samples: [0.5], absolutePeak: 1 };
    const result = { startNorm: 0, endNorm: 1, channels: [envelope], calibrationSignature: undefined, analysisRevision: undefined };
    assert.equal(schemaViolation('RangeResult', result), null);
    assert.equal(schemaViolation('RangeResult', { ...result, startNorm: undefined }), 'startNorm');
});

test('schema cases report the same path as Python and agree with ajv', () => {
    assert.ok(fixtures.schemaCases.length > 0);
    for (const { schema, value, violation } of fixtures.schemaCases) {
        const label = JSON.stringify({ schema, value });
        assert.equal(inlineSchemaViolation(schema, value), violation, label);
        assert.equal(referenceIsValid(schema, value), violation === null, label);
    }
});

test('schema commands agree with ajv on the protocol fixtures', () => {
    for (const { command, request } of [...schemaCases(fixtures.validRequests), ...schemaCases(fixtures.invalidRequests)]) {
        const definition = commands[command].payload;
        const payload = withoutRequestEnvelope(request);
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, payload), schemaViolation(definition, payload) === null, JSON.stringify(request));
    }
    for (const { command, response } of fixtures.validResponses) {
        if (!(command in commands)) continue;
        const definition = commands[command as SchemaCommand].result;
        const result = withoutResponseEnvelope(response);
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, result), schemaViolation(definition, result) === null, command);
    }
});

test('run-recipe results allow only charts at the top level', () => {
    const chart = { kind: 'line', title: 'Level', extension: true };
    assert.deepEqual(parseBackendResult('run-recipe', { charts: [chart] }), { charts: [chart] });
    assert.throws(() => parseBackendResult('run-recipe', { charts: [], unexpected: 1 }), /Invalid run-recipe success response/);
});
