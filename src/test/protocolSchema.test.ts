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

const CHANNEL = { label: 'ch0', peakAbsolute: 2, fullScale: true, sourceUnit: 'FS', sourceLevelReferenceLabel: 'dBFS' };
const ANALYSIS = { filePath: 'tone.wav', fileName: 'tone.wav', sampleRateHz: 16000, durationSeconds: 1, channelCount: 1, sampleCount: 16000, channels: [CHANNEL] };

test('results are checked by the schema', () => {
    assert.deepEqual(parseBackendResult('region-peak', { peak: 2 }), { peak: 2 });
    assert.equal(schemaViolation('RegionPeakResult', { peak: Number.NaN }), 'peak');
    assert.equal(schemaViolation('AnalysisResult', { ...ANALYSIS, channels: [{ ...CHANNEL, peakAbsolute: Number.NaN }] }), 'channels[0].peakAbsolute');
    assert.equal(schemaViolation('AnalysisResult', { ...ANALYSIS, analysisRevision: 1.5 }), 'analysisRevision');
    assert.equal(schemaViolation('AnalysisResult', { ...ANALYSIS, analysisRevision: -1 }), 'analysisRevision', 'results keep the non-negative revision check');
    assert.throws(() => parseBackendResult('region-peak', { peak: 'loud' }), /Invalid region-peak success response/);
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

test('a scan result is a one-line failure or one step\'s description, with no drawn point and nothing measured beside it', () => {
    const input = { id: 'i', fs: 16000, channels: [0, 1], durationS: 2, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
    const stage = { ok: true, input, stage: { frame: 'NOctFrame', kind: 'bar', x: 'band', quantity: 'level', unit: 'Pa', data: 'k1' }, specVersion: 4, wandasVersion: '0.9.0', elapsedMs: 9 };
    assert.deepEqual(parseBackendResult('scan', stage), stage);
    assert.deepEqual(parseBackendResult('scan', { ok: false, reason: 'Unable to read audio' }), { ok: false, reason: 'Unable to read audio' });
    assert.throws(() => parseBackendResult('scan', { ok: false }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ok: false, reason: 'x', input }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...stage, reason: 'x' }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...stage, stage: undefined }), /Invalid scan success response/);
    assert.throws(() => parseBackendResult('scan', { ...stage, input: undefined }), /Invalid scan success response/);
});

test('analyze results keep the invariants the schema cannot express, and carry no picture', () => {
    assert.deepEqual(parseBackendResult('analyze', ANALYSIS), ANALYSIS);
    const invalidAnalyze = [
        { ...ANALYSIS, channelCount: 2 },
        // A row's waveform and spectrogram are figures: an analysis that carries one is not the protocol's.
        { ...ANALYSIS, channels: [{ ...CHANNEL, waveform: { min: [0], max: [1], absolutePeak: 1 } }] },
        { ...ANALYSIS, channels: [{ ...CHANNEL, spectrogram: null }] },
        { ...ANALYSIS, calibrationProfile: { schemaVersion: 1, channels: 'none' } },
    ];
    for (const value of invalidAnalyze) {
        assert.throws(() => parseBackendResult('analyze', value), /Invalid analyze success response/, JSON.stringify(value));
    }
});

test('error payloads, notifications and Worker limits come from the schema', () => {
    assert.deepEqual([...BACKEND_ERROR_CODES], ['input-error', 'stale-calibration', 'stale-source', 'internal-error']);
    assert.deepEqual(parseBackendErrorPayload({ code: 'stale-calibration', kind: 'invalid-input', message: 'm' }), { code: 'stale-calibration', kind: 'invalid-input', message: 'm' });
    assert.equal(parseBackendErrorPayload({ code: 'stale-calibration', kind: 'invalid-input', message: 'm', extra: 1 }), null, 'keys the schema does not list are rejected');
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
    const result = { ...ANALYSIS, calibrationSignature: undefined, analysisRevision: undefined };
    assert.equal(schemaViolation('AnalysisResult', result), null);
    assert.equal(schemaViolation('AnalysisResult', { ...result, fileName: undefined }), 'fileName');
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

test('an array of numbers is checked item by item, and the break is named by its place: a picture\'s cells too', () => {
    const cells: SchemaNode = { type: 'object', properties: { cells: { type: 'array', items: { type: 'array', items: { anyOf: [{ type: 'number', 'x-drawn': true }, { type: 'null' }] } } } } };
    assert.equal(inlineSchemaViolation(cells, { cells: [[1, null, -3.5], [0, 2, null]] }), null);
    assert.equal(inlineSchemaViolation(cells, { cells: [[1, null, -3.5], [0, Number.NaN, null]] }), 'cells[1][1]');
    assert.equal(inlineSchemaViolation(cells, { cells: [[1, 'x']] }), 'cells[0][1]');
    const counts: SchemaNode = { type: 'array', items: { type: 'integer', minimum: 0, maximum: 9 } };
    assert.equal(inlineSchemaViolation(counts, [0, 9, 4]), null);
    assert.equal(inlineSchemaViolation(counts, [0, null]), '[1]', 'null only where the schema says so');
    assert.equal(inlineSchemaViolation(counts, [0, 1.5]), '[1]');
    assert.equal(inlineSchemaViolation(counts, [0, 10]), '[1]');
    assert.equal(inlineSchemaViolation(counts, [-1]), '[0]');
});
