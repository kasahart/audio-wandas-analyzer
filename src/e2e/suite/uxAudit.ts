import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { chromium } from '@playwright/test';
import { ComparisonPanel } from '../../webview/panels/ComparisonPanel';

const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-audit-screenshots');
const SINGLE_TRACK_DEBUG_AUDIO_PATH = 'media/debug.wav';
const MULTI_TRACK_DEBUG_AUDIO_PATH = 'media/debug';
const COMMAND_TIMEOUT_MS = 20000;

function ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(): Promise<void> {
    console.log('Starting UX Cognitive Audit E2E Suite...');
    ensureDirectoryExists(SCREENSHOT_DIR);

    const extension = vscode.extensions.getExtension('audio-wandas-analyzer.audio-wandas-analyzer');
    assert.ok(extension, 'Extension must be available');
    await extension.activate();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder is required');

    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = path.join(workspaceFolder.uri.fsPath, '.venv', 'bin', 'python');
    await config.update('pythonCommand', pythonCommand, vscode.ConfigurationTarget.Global);

    // 1. Connect to VS Code over CDP
    console.log('Connecting Playwright to VS Code CDP...');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    assert.ok(contexts.length > 0, 'Should find browser contexts');
    const context = contexts[0];
    const pages = context.pages();
    assert.ok(pages.length > 0, 'Should find pages');
    const page = pages[0];

    try {
        // Step 1: Initial State / Welcome View
        console.log('Scenario 1: Opening Directory Selection sidebar...');
        await config.update('debugFilePath', MULTI_TRACK_DEBUG_AUDIO_PATH, vscode.ConfigurationTarget.Global);
        ComparisonPanel.clearTestSnapshot();
        await vscode.commands.executeCommand('audioWandasAnalyzer.analyzeDebugFile');
        await delay(3000);

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_directory_selection.png'), fullPage: true });
        console.log('Saved screenshot 01_directory_selection.png');

        // Step 2: Load Single Track Results
        console.log('Scenario 2: Loading Single Track Results (sine-440.wav)...');
        await config.update('debugFilePath', SINGLE_TRACK_DEBUG_AUDIO_PATH, vscode.ConfigurationTarget.Global);
        ComparisonPanel.clearTestSnapshot();
        await vscode.commands.executeCommand('audioWandasAnalyzer.analyzeDebugFile');
        await delay(3000);

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_single_track_results.png'), fullPage: true });
        console.log('Saved screenshot 02_single_track_results.png');

        // Step 3: Interactive operations - Zoomed Waveform view & settings popover
        console.log('Scenario 3: Zooming in & showing Spectrogram settings popover...');
        const actionId = `ux-audit-actions-${Date.now()}`;
        await ComparisonPanel.postTestActions(actionId, [
            'zoom-in',
            'zoom-in',
            'content-spectrogram',
            'open-spectrogram-settings'
        ]);
        await delay(3000);

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_interactive_spectrogram_settings.png'), fullPage: true });
        console.log('Saved screenshot 03_interactive_spectrogram_settings.png');

        console.log('UX Cognitive Audit simulation finished successfully.');
    } finally {
        await browser.close();
        await config.update('debugFilePath', undefined, vscode.ConfigurationTarget.Global);
        await config.update('pythonCommand', undefined, vscode.ConfigurationTarget.Global);
    }
}
