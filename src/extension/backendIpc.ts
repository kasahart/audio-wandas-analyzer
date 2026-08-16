import {
    BackendProtocolError,
    isJsonObject,
    parseBackendNotification,
    type BackendCommand,
    type BackendNotification,
} from './backendProtocol';

export interface PendingRequest {
    command: BackendCommand;
    complete: (response: { [key: string]: unknown }) => void;
    reject: (error: Error) => void;
}

export type BackendDiagnosticKind =
    | 'malformed-json'
    | 'unknown-notification'
    | 'orphan-response'
    | 'protocol-validation-error';

export interface BackendDiagnostic {
    kind: BackendDiagnosticKind;
    message: string;
    requestId?: string;
    rawLine?: string;
}

export interface BackendStdoutHandlers {
    onNotification?: (notification: BackendNotification) => void;
    onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
}

export function rejectPendingRequests(pending: Map<string, PendingRequest>, error: Error): void {
    for (const request of pending.values()) {
        request.reject(error);
    }
    pending.clear();
}

export class BackendStartupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackendStartupError';
    }
}

export function backendStartupError(message: string, stderr: string): BackendStartupError {
    const details = stderr.trim();
    return new BackendStartupError(details ? `${message}: ${details}` : message);
}

export function formatPythonImportTiming(line: string, minimumCumulativeMs = 100): string | null {
    const match = /^import time:\s+(\d+)\s+\|\s+(\d+)\s+\|\s+(.+)$/u.exec(line);
    if (!match) { return null; }
    const selfMs = Number(match[1]) / 1000;
    const cumulativeMs = Number(match[2]) / 1000;
    if (cumulativeMs < minimumCumulativeMs) { return null; }
    return `[import] module=${match[3].trim()} self_ms=${selfMs.toFixed(2)} cumulative_ms=${cumulativeMs.toFixed(2)}`;
}

function protocolError(message: string): BackendProtocolError {
    return new BackendProtocolError(message);
}

export function processStdoutChunk(
    buffer: { value: string },
    chunk: string,
    pending: Map<string, PendingRequest>,
    handlers: BackendStdoutHandlers = {},
): void {
    buffer.value += chunk;
    const lines = buffer.value.split('\n');
    buffer.value = lines.pop() ?? '';
    for (const line of lines) {
        if (!line.trim()) { continue; }

        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            handlers.onDiagnostic?.({
                kind: 'malformed-json',
                message: 'Backend emitted malformed JSON',
                rawLine: line,
            });
            continue;
        }

        const notification = parseBackendNotification(parsed);
        if (notification) {
            handlers.onNotification?.(notification);
            continue;
        }
        if (!isJsonObject(parsed)) {
            handlers.onDiagnostic?.({
                kind: 'unknown-notification',
                message: 'Backend emitted a non-object message',
                rawLine: line,
            });
            continue;
        }
        if (parsed['type'] !== undefined) {
            handlers.onDiagnostic?.({
                kind: 'unknown-notification',
                message: `Backend emitted unknown notification: ${String(parsed['type'])}`,
                rawLine: line,
            });
            continue;
        }

        const requestId = parsed['requestId'];
        if (typeof requestId !== 'string') {
            handlers.onDiagnostic?.({
                kind: 'unknown-notification',
                message: 'Backend message has neither a notification type nor requestId',
                rawLine: line,
            });
            continue;
        }

        const request = pending.get(requestId);
        if (!request) {
            handlers.onDiagnostic?.({
                kind: 'orphan-response',
                message: `Backend response has no pending request: ${requestId}`,
                requestId,
                rawLine: line,
            });
            continue;
        }
        pending.delete(requestId);

        if (parsed['error'] !== undefined) {
            if (typeof parsed['error'] === 'string') {
                request.reject(new Error(parsed['error']));
            } else {
                const error = protocolError(`Invalid error response for ${request.command}`);
                request.reject(error);
                handlers.onDiagnostic?.({
                    kind: 'protocol-validation-error',
                    message: error.message,
                    requestId,
                    rawLine: line,
                });
            }
            continue;
        }

        try {
            request.complete(parsed);
        } catch (cause) {
            const error = cause instanceof BackendProtocolError
                ? cause
                : protocolError(`Invalid ${request.command} response: ${String(cause)}`);
            request.reject(error);
            handlers.onDiagnostic?.({
                kind: 'protocol-validation-error',
                message: error.message,
                requestId,
                rawLine: line,
            });
        }
    }
}
