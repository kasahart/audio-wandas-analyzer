import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const VSCODE_VERSION = 'stable';
const SUPPRESSED_STDERR_PATTERNS = [
    /ERROR:dbus\/bus\.cc:408/u,
    /ERROR:dbus\/object_proxy\.cc:573/u,
];
const DEVCONTAINER_EXTENSION_HOST_ENV_KEYS = [
    'ELECTRON_RUN_AS_NODE',
    'VSCODE_ESM_ENTRYPOINT',
    'VSCODE_IPC_HOOK_CLI',
    'VSCODE_HANDLES_UNCAUGHT_ERRORS',
    'VSCODE_HANDLES_SIGPIPE',
    'VSCODE_CWD',
];

function resolveNlsMessagesFile(vscodeExecutablePath: string): string | undefined {
    const candidatePaths = [
        path.join(path.dirname(vscodeExecutablePath), 'resources', 'app', 'out', 'nls.messages.json'),
        path.resolve(vscodeExecutablePath, '..', '..', 'Resources', 'app', 'out', 'nls.messages.json'),
    ];

    return candidatePaths.find((candidatePath) => existsSync(candidatePath));
}

function withFilteredStderr<T>(action: () => Promise<T>): Promise<T> {
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

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'audio-wandas-analyzer-vscode-e2e-'));

    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);
    const nlsMessagesFile = resolveNlsMessagesFile(vscodeExecutablePath);
    const nlsConfig = nlsMessagesFile
        ? JSON.stringify({ defaultMessagesFile: nlsMessagesFile, resolvedLanguage: 'en', userLocale: 'en', osLocale: 'en' })
        : undefined;
    const previousDevcontainerEnv = new Map<string, string | undefined>();
    // Remove devcontainer extension host vars that cause VS Code to run as Node.js
    // instead of launching the full Electron desktop app.
    for (const key of DEVCONTAINER_EXTENSION_HOST_ENV_KEYS) {
        previousDevcontainerEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    // Set on parent process.env so the Electron main process sees it at startup.
    const previousNlsConfig = process.env['VSCODE_NLS_CONFIG'];
    if (nlsConfig) {
        process.env['VSCODE_NLS_CONFIG'] = nlsConfig;
    }

    try {
        console.log('Running VS Code E2E tests...');
        await withFilteredStderr(() => runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                extensionDevelopmentPath,
                '--disable-workspace-trust',
                '--new-window',
                '--no-sandbox',
                '--disable-gpu',
                '--user-data-dir', userDataDir,
            ],
            extensionTestsEnv: {
                AUDIO_WANDAS_E2E: '1',
                ...(nlsConfig ? { VSCODE_NLS_CONFIG: nlsConfig } : {}),
            },
        }));
        console.log('VS Code E2E tests passed.');
    } finally {
        for (const [key, value] of previousDevcontainerEnv) {
            if (value === undefined) {
                delete process.env[key];
                continue;
            }

            process.env[key] = value;
        }
        if (previousNlsConfig === undefined) {
            delete process.env['VSCODE_NLS_CONFIG'];
        } else {
            process.env['VSCODE_NLS_CONFIG'] = previousNlsConfig;
        }
        rmSync(userDataDir, { recursive: true, force: true });
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
