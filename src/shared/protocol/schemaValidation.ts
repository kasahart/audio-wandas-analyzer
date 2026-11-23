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
    /** A definition the generated types take from the hand-written contracts; it carries no constraint. */
    'x-tsType'?: string;
    /** A number thinned to be drawn: generated as `FigureDrawn` in a figure picture; it carries no constraint. */
    'x-drawn'?: boolean;
    /** Every value of the data, none thinned (protocol_schema.py); it carries no constraint. */
    'x-whole'?: boolean;
    /** A place along an axis or a limit, not a data value (protocol_schema.py); it carries no constraint. */
    'x-place'?: boolean;
}

const DEFINITIONS: Readonly<Record<string, SchemaNode>> = BACKEND_PROTOCOL_SCHEMA.$defs;

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

/** What an array's items are when they are plain numbers (or null): the one check each needs, made in a loop of its own. */
interface NumberItems { nullable: boolean; integer: boolean; minimum: number | undefined; maximum: number | undefined }

/** `items` as numbers (or null) and nothing else, or null where an item is anything more (an object, an array, an enum). */
function numberItems(items: SchemaNode): NumberItems | null {
    let node = resolve(items), nullable = false;
    if (node.anyOf && Object.keys(node).every(key => key === 'anyOf' || key.startsWith('x-'))) { nullable = true; node = resolve(node.anyOf[0]); }
    const plain = (node.type === 'number' || node.type === 'integer')
        && Object.keys(node).every(key => key === 'type' || key === 'minimum' || key === 'maximum' || key.startsWith('x-'));
    return plain ? { nullable, integer: node.type === 'integer', minimum: node.minimum, maximum: node.maximum } : null;
}

/**
 * Where under `value` the first break of `schema` is, written from the value itself (`''`: the value, `.key`, `[3]`,
 * `.key[3].other`), or null. The path is written only on the way back from a break: a picture's reply has hundreds of
 * thousands of numbers, and writing each one's path to check it took longer than drawing the picture.
 */
function violationUnder(schema: SchemaNode, value: unknown): string | null {
    const node = resolve(schema);
    if (node.anyOf) return value === null ? null : violationUnder(node.anyOf[0], value);
    if (node.type !== undefined && !matchesType(node.type, value)) return '';
    if (node.const !== undefined && value !== node.const) return '';
    if (node.enum !== undefined && !node.enum.some(item => item === value)) return '';
    if (typeof value === 'number') {
        if (node.minimum !== undefined && value < node.minimum) return '';
        if (node.maximum !== undefined && value > node.maximum) return '';
        return null;
    }
    if (typeof value !== 'object' || value === null) return null;
    if (Array.isArray(value)) {
        if (!node.items) return null;
        const items = resolve(node.items);
        // An array of numbers (a line's points, a row of an image's cells): the same check as below, with no call an item.
        const numbers = numberItems(node.items);
        if (numbers) {
            const { nullable, integer, minimum, maximum } = numbers;
            for (let index = 0; index < value.length; index++) {
                const item: unknown = value[index];
                if (item === null && nullable) continue;
                if (typeof item !== 'number' || !Number.isFinite(item) || (integer && !Number.isInteger(item))) return `[${index}]`;
                if ((minimum !== undefined && item < minimum) || (maximum !== undefined && item > maximum)) return `[${index}]`;
            }
            return null;
        }
        for (let index = 0; index < value.length; index++) {
            const found = violationUnder(items, value[index]);
            if (found !== null) return `[${index}]${found}`;
        }
        return null;
    }
    const record = value as Record<string, unknown>;
    // An undefined property is absent, as JSON.stringify drops it; postMessage results can carry one.
    if (node.additionalProperties === false) {
        for (const [key, item] of Object.entries(record)) {
            if (item !== undefined && !Object.hasOwn(node.properties ?? {}, key)) return `.${key}`;
        }
    }
    for (const key of node.required ?? []) {
        if (record[key] === undefined) return `.${key}`;
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (record[key] === undefined) continue;
        const found = violationUnder(child, record[key]);
        if (found !== null) return `.${key}${found}`;
    }
    return null;
}

/** Dotted path of the first value that breaks `schema` (`''` for the root), or null. */
function firstViolation(schema: SchemaNode, value: unknown): string | null {
    const found = violationUnder(schema, value);
    return found === null ? null : found.replace(/^\./, '');
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
    return firstViolation(schema, value);
}

/** Dotted path of the first value that breaks the named definition (`''` for the root), or null. */
export function schemaViolation(definition: DefinitionName, value: unknown): string | null {
    return firstViolation({ $ref: `#/$defs/${definition}` }, value);
}
