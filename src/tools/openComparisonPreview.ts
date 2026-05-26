import { spawn } from 'node:child_process';
import {
    type ComparisonPreviewMode,
    buildBrowserOpenCommand,
    writeComparisonPreviewHtml,
} from './comparisonPreview';

function parseMode(argv: string[]): ComparisonPreviewMode {
    const modeIndex = argv.indexOf('--mode');
    if (modeIndex < 0) {
        return 'results';
    }
    const modeValue = argv[modeIndex + 1];
    if (modeValue === undefined || modeValue.startsWith('--')) {
        throw new Error('--mode requires a value (results | selection)');
    }
    if (modeValue === 'results' || modeValue === 'selection') {
        return modeValue;
    }
    throw new Error(`Unknown preview mode: ${modeValue}`);
}

const SKIP_BROWSER_OPEN_ENV = 'AUDIO_WANDAS_SKIP_BROWSER_OPEN';

function shouldSkipBrowserOpen(env: NodeJS.ProcessEnv): boolean {
    // Set AUDIO_WANDAS_SKIP_BROWSER_OPEN=1 to write the preview HTML without launching a browser.
    return env[SKIP_BROWSER_OPEN_ENV] === '1';
}

async function main(): Promise<void> {
    const mode = parseMode(process.argv.slice(2));
    const filePath = writeComparisonPreviewHtml(mode);
    if (shouldSkipBrowserOpen(process.env)) {
        console.log(`Preview HTML written to: ${filePath}`);
        return;
    }
    const { command, args } = buildBrowserOpenCommand(process.platform, filePath);
    const child = spawn(command, args, { stdio: 'ignore', detached: false });

    child.once('error', (error) => {
        console.error(`Failed to open browser automatically: ${error.message}`);
        console.error(`Preview HTML written to: ${filePath}`);
        process.exitCode = 1;
    });

    child.once('spawn', () => {
        console.log(`Opened ${mode} preview: ${filePath}`);
    });

    child.unref();
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
