import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const VSCODE_VERSION = '1.96.0';

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'audio-wandas-analyzer-vscode-e2e-'));

    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);
    const vscodeDir = path.dirname(vscodeExecutablePath);
    const nlsMessagesFile = path.join(vscodeDir, 'resources', 'app', 'out', 'nls.messages.json');
    const nlsConfig = existsSync(nlsMessagesFile)
        ? JSON.stringify({ defaultMessagesFile: nlsMessagesFile, resolvedLanguage: 'en', userLocale: 'en', osLocale: 'en' })
        : undefined;
    if (nlsConfig) {
        process.env['VSCODE_NLS_CONFIG'] = nlsConfig;
    }
    // Remove devcontainer extension host vars that cause VS Code to run as Node.js
    // instead of launching the full Electron desktop app.
    for (const key of [
        'ELECTRON_RUN_AS_NODE',
        'VSCODE_ESM_ENTRYPOINT',
        'VSCODE_IPC_HOOK_CLI',
        'VSCODE_HANDLES_UNCAUGHT_ERRORS',
        'VSCODE_HANDLES_SIGPIPE',
        'VSCODE_CWD',
    ]) {
        delete process.env[key];
    }

    try {
        await runTests({
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
        });
    } finally {
        rmSync(userDataDir, { recursive: true, force: true });
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});