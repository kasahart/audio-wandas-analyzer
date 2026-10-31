import {
    BackendProtocolError, isBackendCommand, isJsonObject, parseBackendResult, type BackendCommand, type BackendResult,
} from '../../shared/protocol/backendProtocol';
import type { BrowserLimits } from '../../shared/protocol/generated/backendProtocolSchema';
import { schemaViolation, withoutResponseEnvelope } from '../../shared/protocol/schemaValidation';

/** Commands only the audio Worker answers (browser/audio.worker.js → browser_service.py), beside the shared ten. */
export interface WorkerOnlyResults {
    load: { filePath: string };
    unload: Record<never, never>;
    clear: Record<never, never>;
    'export-plan': Record<never, never>;
    limits: BrowserLimits;
}
export type WorkerCommand = BackendCommand | keyof WorkerOnlyResults;
export type WorkerResult<K extends WorkerCommand> = K extends BackendCommand ? BackendResult<K>
    : K extends keyof WorkerOnlyResults ? WorkerOnlyResults[K] : never;
export type WorkerRequest<K extends WorkerCommand = WorkerCommand> = { cmd: K } & Record<string, unknown>;

/** An undefined property is absent, as postMessage results can carry one. */
const isEmptyReply = (value: unknown): value is Record<never, never> => isJsonObject(value) && Object.values(value).every(item => item === undefined);

const WORKER_ONLY_VALIDATORS: { [K in keyof WorkerOnlyResults]: (value: unknown) => value is WorkerOnlyResults[K] } = {
    load: (value): value is { filePath: string } => isJsonObject(value) && typeof value['filePath'] === 'string' && value['filePath'] !== ''
        && Object.keys(value).every(key => key === 'filePath' || value[key] === undefined),
    unload: isEmptyReply,
    clear: isEmptyReply,
    'export-plan': isEmptyReply,
    limits: (value): value is BrowserLimits => schemaViolation('BrowserLimits', value) === null,
};

/** The Worker's success result for `command`, through the shared validator for the shared commands. */
export function parseWorkerResult<K extends WorkerCommand>(command: K, value: unknown): WorkerResult<K>;
export function parseWorkerResult(command: WorkerCommand, value: unknown): unknown {
    if (isBackendCommand(command)) return parseBackendResult(command, value);
    if (!WORKER_ONLY_VALIDATORS[command](value)) {
        throw new BackendProtocolError(command === 'limits' ? 'Invalid limits response from the audio Worker' : `Invalid ${command} success response`);
    }
    return value;
}

export type WorkerMessage =
    /** Sent once when Pyodide has booted or failed to; `lacks` names the optional packages it cannot import. */
    | { kind: 'ready'; ready: boolean; lacks?: string[] }
    /** `{requestId, result}` or `{requestId, error}`; `wellFormed` is false when anything else sits beside them. */
    | { kind: 'reply'; requestId: string; result: unknown; error: unknown; envelope: Record<string, unknown>; wellFormed: boolean };

/** Reads a message posted by the audio Worker; anything that is neither a boot report nor a reply is undefined. */
export function parseWorkerMessage(data: unknown): WorkerMessage | undefined {
    if (!isJsonObject(data)) return undefined;
    if (data['ready'] !== undefined) {
        if (typeof data['ready'] !== 'boolean') return undefined;
        const lacks = data['lacks'];
        return { kind: 'ready', ready: data['ready'], ...(Array.isArray(lacks) ? { lacks: lacks.filter((name): name is string => typeof name === 'string') } : {}) };
    }
    const requestId = data['requestId'];
    if (typeof requestId !== 'string') return undefined;
    const envelope = withoutResponseEnvelope(data);
    const wellFormed = Object.keys(envelope).every(key => key === 'result' || envelope[key] === undefined);
    return { kind: 'reply', requestId, result: data['result'], error: data['error'], envelope, wellFormed };
}
