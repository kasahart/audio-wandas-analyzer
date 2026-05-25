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
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'uxAudit.js');
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'audio-wandas-analyzer-vscode-ux-audit-'));

    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);
    const nlsMessagesFile = resolveNlsMessagesFile(vscodeExecutablePath);
    const nlsConfig = nlsMessagesFile
        ? JSON.stringify({ defaultMessagesFile: nlsMessagesFile, resolvedLanguage: 'en', userLocale: 'en', osLocale: 'en' })
        : undefined;
    const previousDevcontainerEnv = new Map<string, string | undefined>();

    for (const key of DEVCONTAINER_EXTENSION_HOST_ENV_KEYS) {
        previousDevcontainerEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    const previousNlsConfig = process.env['VSCODE_NLS_CONFIG'];
    if (nlsConfig) {
        process.env['VSCODE_NLS_CONFIG'] = nlsConfig;
    }

    try {
        console.log('Running VS Code Electron UX Audit...');
        const cdpPort = process.env.UX_AUDIT_CDP_PORT || '9222';
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
                `--remote-debugging-port=${cdpPort}`, // Expose CDP port for Playwright
                '--user-data-dir', userDataDir,
            ],
            extensionTestsEnv: {
                AUDIO_WANDAS_E2E: '1',
                UX_AUDIT_CDP_PORT: cdpPort,
                ...(nlsConfig ? { VSCODE_NLS_CONFIG: nlsConfig } : {}),
            },
        }));
        console.log('VS Code UX Audit run finished.');
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
