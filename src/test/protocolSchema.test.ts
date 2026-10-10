import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BACKEND_PROTOCOL_SCHEMA, type SchemaCommand } from '../shared/protocol/generated/backendProtocolSchema';
import { parseBackendResult } from '../shared/protocol/backendProtocol';
import { schemaViolation } from '../shared/protocol/schemaValidation';

interface FixtureCase { command?: string; request: Record<string, unknown>; errorField?: string }
const fixtures = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')) as {
    validRequests: FixtureCase[];
    invalidRequests: FixtureCase[];
};
const commands = BACKEND_PROTOCOL_SCHEMA['x-commands'] as Record<SchemaCommand, { payload: 'RangePayload'; result: 'RangeResult' }>;
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
    assert.throws(() => parseBackendResult('range', { ...result, channels: [{ ...envelope, samples: [0] }] }), /Invalid range success response/);
});
