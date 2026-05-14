import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'audio-wandas-analyzer-vscode-e2e-'));

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                extensionDevelopmentPath,
                '--disable-workspace-trust',
                '--new-window',
                '--user-data-dir', userDataDir,
            ],
            extensionTestsEnv: {
                AUDIO_WANDAS_E2E: '1',
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