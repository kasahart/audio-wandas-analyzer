import { existsSync } from 'node:fs';
import * as path from 'node:path';

export const VSCODE_VERSION = 'stable';

export const SUPPRESSED_STDERR_PATTERNS = [
    /ERROR:dbus\/bus\.cc:408/u,
    /ERROR:dbus\/object_proxy\.cc:573/u,
];

export const DEVCONTAINER_EXTENSION_HOST_ENV_KEYS = [
    'ELECTRON_RUN_AS_NODE',
    'VSCODE_ESM_ENTRYPOINT',
    'VSCODE_IPC_HOOK_CLI',
    'VSCODE_HANDLES_UNCAUGHT_ERRORS',
    'VSCODE_HANDLES_SIGPIPE',
    'VSCODE_CWD',
];

export function resolveNlsMessagesFile(vscodeExecutablePath: string): string | undefined {
    const candidatePaths = [
        path.join(path.dirname(vscodeExecutablePath), 'resources', 'app', 'out', 'nls.messages.json'),
        path.resolve(vscodeExecutablePath, '..', '..', 'Resources', 'app', 'out', 'nls.messages.json'),
    ];

    return candidatePaths.find((candidatePath) => existsSync(candidatePath));
}

export function withFilteredStderr<T>(action: () => Promise<T>): Promise<T> {
    const originalWrite = process.stderr.write.bind(process.stderr);

    process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
        const text = typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : undefined);
        if (SUPPRESSED_STDERR_PATTERNS.some((pattern) => pattern.test(text))) {
            if (typeof encoding === 'function') {
                encoding();
            } else {
                callback?.();
            }
            return true;
        }

        if (typeof encoding === 'function') {
            return originalWrite(chunk, encoding);
        }
        return originalWrite(chunk, encoding as BufferEncoding, callback);
    }) as typeof process.stderr.write;

    return action().finally(() => {
        process.stderr.write = originalWrite;
    });
}
