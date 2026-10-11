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
