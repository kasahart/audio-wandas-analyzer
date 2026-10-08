import {
    settleBackendRequest,
    type PendingBackendRequest,
    isJsonObject,
    parseBackendNotification,
    type BackendCommand,
    type BackendNotification,
} from '../shared/protocol/backendProtocol';

export interface PendingRequest extends PendingBackendRequest<{ [key: string]: unknown }> {
    command: BackendCommand;
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


export interface CancellationSignal {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

export class BackendStartupCancelledError extends Error {
    constructor() {
        super('Python backend startup cancelled');
        this.name = 'BackendStartupCancelledError';
    }
}

export async function waitForBackendStartup(
    startup: Promise<void>,
    cancellation?: CancellationSignal,
): Promise<void> {
    if (!cancellation) {
        await startup;
        return;
    }
    if (cancellation.isCancellationRequested) {
        throw new BackendStartupCancelledError();
    }
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let disposable: { dispose(): void } | undefined;
        const cancel = (): void => {
            if (settled) { return; }
            settled = true;
            disposable?.dispose();
            reject(new BackendStartupCancelledError());
        };
        disposable = cancellation.onCancellationRequested(cancel);
        if (cancellation.isCancellationRequested) { cancel(); }
        void startup.then(
            () => {
                if (settled) { return; }
                settled = true;
                disposable.dispose();
                resolve();
            },
            (error: unknown) => {
                if (settled) { return; }
                settled = true;
                disposable.dispose();
                reject(error);
            },
        );
    });
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

        const diagnostic = settleBackendRequest(pending, requestId, parsed, parsed['error']);
        if (diagnostic) handlers.onDiagnostic?.({ ...diagnostic, rawLine: line });
    }
}
