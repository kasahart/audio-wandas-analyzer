import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

export const VSCODE_VERSION = process.env['AUDIO_WANDAS_E2E_VSCODE_VERSION'] || '1.122.1';
const VSCODE_DOWNLOAD_ATTEMPTS = 3;

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

export async function downloadVSCodeForE2E(): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= VSCODE_DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            return await downloadAndUnzipVSCode(VSCODE_VERSION);
        } catch (error) {
            lastError = error;
            if (attempt === VSCODE_DOWNLOAD_ATTEMPTS) {
                break;
            }
            const delayMs = attempt * 2000;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`VS Code download failed on attempt ${attempt}/${VSCODE_DOWNLOAD_ATTEMPTS}: ${message}`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}
