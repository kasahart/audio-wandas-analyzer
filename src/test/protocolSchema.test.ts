import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BACKEND_PROTOCOL_SCHEMA, type SchemaCommand } from '../shared/protocol/generated/backendProtocolSchema';
import { parseBackendResult } from '../shared/protocol/backendProtocol';
import { inlineSchemaViolation, schemaViolation, type SchemaNode } from '../shared/protocol/schemaValidation';
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
    ajv.validate({ ...schema, $defs: BACKEND_PROTOCOL_SCHEMA.$defs }, value) as boolean;
const commands = BACKEND_PROTOCOL_SCHEMA['x-commands'];
const schemaCases = (cases: FixtureCase[]): Array<FixtureCase & { command: SchemaCommand }> =>
    cases.filter((entry): entry is FixtureCase & { command: SchemaCommand } => typeof entry.command === 'string' && entry.command in commands);

test('schema commands accept the shared valid request fixtures', () => {
    const cases = schemaCases(fixtures.validRequests);
    assert.ok(cases.length > 0);
    for (const { command, request } of cases) {
        assert.equal(schemaViolation(commands[command].payload, request), null, command);
    }
});

test('schema commands report the same invalid field as the Python validator', () => {
    const cases = schemaCases(fixtures.invalidRequests);
    assert.ok(cases.length > 0);
    for (const { command, request, errorField } of cases) {
        assert.equal(schemaViolation(commands[command].payload, request), errorField, JSON.stringify(request));
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
    const result = { trackIndex: 0, analysisId: 'a', settingsSignature: 's', filePath: 'tone.wav', channels: [channel], frequencyBins: 2, maxFrequencyHz: 8000, computeMs: 1 };
    assert.deepEqual(parseBackendResult('spectrum-slice', result), result);
    assert.equal(schemaViolation('SpectrumSliceResult', { ...result, channels: [{ ...channel, referenceValue: 0 }] }), 'channels[0].referenceValue');
    assert.throws(() => parseBackendResult('spectrum-slice', { ...result, channels: [] }), /Invalid spectrum-slice success response/);
    assert.throws(() => parseBackendResult('spectrum-slice', { ...result, frequencyBins: 3 }), /Invalid spectrum-slice success response/);
});

test('invalid response fixtures report the same path as Python and fail ajv', () => {
    assert.ok(fixtures.invalidResponses.length > 0);
    for (const { command, response, violation } of fixtures.invalidResponses) {
        const definition = commands[command].result;
        assert.equal(schemaViolation(definition, response), violation, JSON.stringify(response));
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, response), false, JSON.stringify(response));
        assert.throws(() => parseBackendResult(command, response), /success response/);
    }
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
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, request), schemaViolation(definition, request) === null, JSON.stringify(request));
    }
    for (const { command, response } of fixtures.validResponses) {
        if (!(command in commands)) continue;
        const definition = commands[command as SchemaCommand].result;
        assert.equal(referenceIsValid({ $ref: `#/$defs/${definition}` }, response), schemaViolation(definition, response) === null, command);
    }
});
