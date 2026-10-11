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
    items?: SchemaNode;
}

const DEFINITIONS = BACKEND_PROTOCOL_SCHEMA.$defs as unknown as Readonly<Record<string, SchemaNode>>;

function resolve(node: SchemaNode): SchemaNode {
    let current = node;
    while (current.$ref) current = DEFINITIONS[current.$ref.replace('#/$defs/', '')]!;
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
    if (node.type !== undefined && !matchesType(node.type, value)) return path;
    if (node.const !== undefined && value !== node.const) return path;
    if (node.enum !== undefined && !node.enum.some(item => item === value)) return path;
    const numeric = typeof value === 'number';
    if (numeric && node.minimum !== undefined && value < node.minimum) return path;
    if (numeric && node.maximum !== undefined && value > node.maximum) return path;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        for (const key of node.required ?? []) {
            if (!(key in record)) return path ? `${path}.${key}` : key;
        }
        for (const [key, child] of Object.entries(node.properties ?? {})) {
            if (!(key in record)) continue;
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

/** Dotted path of the first value that breaks an inline `schema` (`$ref`s resolve to the protocol definitions), or null. */
export function inlineSchemaViolation(schema: SchemaNode, value: unknown): string | null {
    return firstViolation(schema, value, '');
}

/** Dotted path of the first value that breaks the named definition (`''` for the root), or null. */
export function schemaViolation(definition: DefinitionName, value: unknown): string | null {
    return firstViolation({ $ref: `#/$defs/${definition}` }, value, '');
}
