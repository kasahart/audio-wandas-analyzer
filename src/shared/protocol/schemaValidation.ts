// Runtime check against the generated protocol schema; mirrors protocol_schema.first_violation
// in python-backend and supports the same keyword subset (enum/const values are JSON scalars).
import { BACKEND_PROTOCOL_SCHEMA } from './generated/backendProtocolSchema';

type DefinitionName = keyof typeof BACKEND_PROTOCOL_SCHEMA['$defs'];
type Scalar = string | number | boolean | null;
export interface SchemaNode {
    $ref?: string;
    type?: string;
    enum?: readonly Scalar[];
    const?: Scalar;
    minimum?: number;
    maximum?: number;
    required?: readonly string[];
    properties?: Readonly<Record<string, SchemaNode>>;
    /** Only `false`, beside `properties`: keys the node does not list are rejected. */
    additionalProperties?: false;
    items?: SchemaNode;
    /** Only the nullable form `[schema, { type: 'null' }]`; see protocol_schema.py. */
    anyOf?: readonly [SchemaNode, SchemaNode];
}

const DEFINITIONS = BACKEND_PROTOCOL_SCHEMA.$defs as unknown as Readonly<Record<string, SchemaNode>>;

function resolve(node: SchemaNode): SchemaNode {
    let current = node;
    while (current.$ref) {
        const definition = DEFINITIONS[current.$ref.replace('#/$defs/', '')];
        if (!definition) throw new Error(`Unknown protocol schema reference: ${current.$ref}`);
        current = definition;
    }
    return current;
}

function matchesType(expected: string, value: unknown): boolean {
    switch (expected) {
        case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'string': return typeof value === 'string';
        case 'boolean': return typeof value === 'boolean';
        case 'null': return value === null;
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return Number.isInteger(value);
        default: return false;
    }
}

function firstViolation(schema: SchemaNode, value: unknown, path: string): string | null {
    const node = resolve(schema);
    if (node.anyOf) return value === null ? null : firstViolation(node.anyOf[0], value, path);
    if (node.type !== undefined && !matchesType(node.type, value)) return path;
    if (node.const !== undefined && value !== node.const) return path;
    if (node.enum !== undefined && !node.enum.some(item => item === value)) return path;
    const numeric = typeof value === 'number';
    if (numeric && node.minimum !== undefined && value < node.minimum) return path;
    if (numeric && node.maximum !== undefined && value > node.maximum) return path;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        // An undefined property is absent, as JSON.stringify drops it; postMessage results can carry one.
        if (node.additionalProperties === false) {
            for (const [key, item] of Object.entries(record)) {
                if (item !== undefined && !Object.hasOwn(node.properties ?? {}, key)) return path ? `${path}.${key}` : key;
            }
        }
        for (const key of node.required ?? []) {
            if (record[key] === undefined) return path ? `${path}.${key}` : key;
        }
        for (const [key, child] of Object.entries(node.properties ?? {})) {
            if (record[key] === undefined) continue;
            const found = firstViolation(child, record[key], path ? `${path}.${key}` : key);
            if (found !== null) return found;
        }
    }
    if (Array.isArray(value) && node.items) {
        for (let index = 0; index < value.length; index++) {
            const found = firstViolation(node.items, value[index], `${path}[${index}]`);
            if (found !== null) return found;
        }
    }
    return null;
}

const REQUEST_ENVELOPE_KEYS: ReadonlySet<string> = new Set(BACKEND_PROTOCOL_SCHEMA['x-requestEnvelopeKeys']);
const RESPONSE_ENVELOPE_KEYS: ReadonlySet<string> = new Set(BACKEND_PROTOCOL_SCHEMA['x-responseEnvelopeKeys']);

function withoutKeys(message: unknown, keys: ReadonlySet<string>): unknown {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return message;
    return Object.fromEntries(Object.entries(message).filter(([key]) => !keys.has(key)));
}

/** Drops `cmd` and `requestId`, which travel beside the payload fields but belong to no definition. */
export function withoutRequestEnvelope(message: unknown): unknown {
    return withoutKeys(message, REQUEST_ENVELOPE_KEYS);
}

/** Drops `requestId`; replies carry no `cmd`, so one is left for the result schema to reject. */
export function withoutResponseEnvelope(message: Record<string, unknown>): Record<string, unknown>;
export function withoutResponseEnvelope(message: unknown): unknown;
export function withoutResponseEnvelope(message: unknown): unknown {
    return withoutKeys(message, RESPONSE_ENVELOPE_KEYS);
}

/** Dotted path of the first value that breaks an inline `schema` (`$ref`s resolve to the protocol definitions), or null. */
export function inlineSchemaViolation(schema: SchemaNode, value: unknown): string | null {
    return firstViolation(schema, value, '');
}

/** Dotted path of the first value that breaks the named definition (`''` for the root), or null. */
export function schemaViolation(definition: DefinitionName, value: unknown): string | null {
    return firstViolation({ $ref: `#/$defs/${definition}` }, value, '');
}
