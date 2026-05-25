import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import {
    VSCODE_VERSION,
    DEVCONTAINER_EXTENSION_HOST_ENV_KEYS,
    resolveNlsMessagesFile,
    withFilteredStderr,
} from './runnerHelpers';


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
                '--disable-telemetry',
                '--disable-updates',
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
