import * as vscode from 'vscode';
import type { AnalysisResultWithError, SpectrogramSettings } from '../shared/analysis/analysisTypes';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { getCalibrationRenderScript } from '../webview/calibrationRenderScript';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import { PythonBackendServer } from './pythonBackendServer';
import {
    configureCalibrationProfile,
    getAnalysisRevision,
    getCalibrationProfile,
    type CalibrationChannelDescriptor,
} from './calibrationStore';

interface ResultsPanelContext {
    mode: 'results';
    extensionUri: vscode.Uri;
    results: AnalysisResultWithError[];
    spectrogramSettings: SpectrogramSettings;
}

interface DirectoryPanelContext {
    mode: 'directory-selection';
    extensionUri: vscode.Uri;
    rootPath: string;
    allFilePaths: string[];
    selectedFilePaths: string[];
    results: AnalysisResultWithError[];
    pythonEnvironmentState: {
        pythonCommand: string;
        status: 'normal' | 'warning';
        tooltip: string;
    };
    spectrogramSettings: SpectrogramSettings;
}

type PanelContext = ResultsPanelContext | DirectoryPanelContext;

const panelContexts = new WeakMap<vscode.WebviewPanel, PanelContext>();
const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelLifecycleInstalled = new WeakSet<vscode.WebviewPanel>();
const latestResultsByFilePath = new Map<string, AnalysisResultWithError>();
let installed = false;
let backendPatched = false;
let activePanel: vscode.WebviewPanel | undefined;

function isAnalysisResultArray(value: unknown): value is AnalysisResultWithError[] {
    return Array.isArray(value) && value.every((entry) => {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const candidate = entry as Record<string, unknown>;
        return typeof candidate['filePath'] === 'string'
            && typeof candidate['fileName'] === 'string'
            && Array.isArray(candidate['channels']);
    });
}

function rememberResults(results: AnalysisResultWithError[]): AnalysisResultWithError[] {
    return results.map((result) => {
        const latest = latestResultsByFilePath.get(result.filePath);
        const expectedRevision = getAnalysisRevision(result.filePath);
        const incomingRevision = result.analysisRevision ?? 0;
        if (latest && !result.error && incomingRevision < expectedRevision) {
            return latest;
        }
        latestResultsByFilePath.set(result.filePath, result);
        return result;
    });
}

function injectCalibrationRuntime(html: string): string {
    if (html.includes('__AWA_CALIBRATION_RUNTIME__')) {
        return html;
    }
    const stateMarker = '        window.__APP_STATE__ =';
    if (!html.includes(stateMarker)) {
        throw new Error('Comparison Webview state marker was not found');
    }
    const acquireWrapper = [
        '        const __AWA_CALIBRATION_RUNTIME__ = true;',
        '        const __AWA_NATIVE_ACQUIRE_VSCODE_API__ = acquireVsCodeApi;',
        '        window.acquireVsCodeApi = function() {',
        '            if (!window.__AWA_VSCODE_API__) {',
        '                window.__AWA_VSCODE_API__ = __AWA_NATIVE_ACQUIRE_VSCODE_API__();',
        '            }',
        '            return window.__AWA_VSCODE_API__;',
        '        };',
        '',
    ].join('\n');
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Comparison Webview nonce was not found');
    }
    return html
        .replace(stateMarker, acquireWrapper + stateMarker)
        .replace(
            '</body>',
            `    <script nonce="${nonceMatch[1]}">${getCalibrationRenderScript()}</script>\n</body>`,
        );
}

function channelDescriptors(result: AnalysisResultWithError): CalibrationChannelDescriptor[] {
    return (result.channels ?? []).map((channel, channelIndex) => ({
        channelIndex,
        label: channel.label || `Channel ${channelIndex + 1}`,
        measurement: channel.measurement,
    }));
}

async function configureResult(
    extensionContext: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    result: AnalysisResultWithError,
): Promise<void> {
    const changed = await configureCalibrationProfile(
        extensionContext,
        result.filePath,
        channelDescriptors(result),
    );
    if (changed) {
        await panel.webview.postMessage({
            type: 'calibration-configured',
            filePath: result.filePath,
            analysisRevision: getAnalysisRevision(result.filePath),
        });
    }
}

async function configureActivePanel(extensionContext: vscode.ExtensionContext): Promise<void> {
    const panel = activePanel;
    const panelContext = panel && panelContexts.get(panel);
    if (!panel || !panelContext) {
        void vscode.window.showInformationMessage('Open an audio analysis panel before configuring calibration.');
        return;
    }
    const available = panelContext.results.filter((result) => !result.error && result.channels.length > 0);
    if (available.length === 0) {
        void vscode.window.showInformationMessage('The active analysis panel has no calibratable audio channels.');
        return;
    }
    let selected = available[0];
    if (available.length > 1) {
        const picked = await vscode.window.showQuickPick(
            available.map((result) => ({ label: result.fileName, description: result.filePath, result })),
            { placeHolder: 'Select a track to calibrate', matchOnDescription: true },
        );
        if (!picked) {
            return;
        }
        selected = picked.result;
    }
    await configureResult(extensionContext, panel, selected);
}

const originalShow = ComparisonPanel.show.bind(ComparisonPanel);
const originalShowDirectorySelection = ComparisonPanel.showDirectorySelection.bind(ComparisonPanel);
let contextExtension: vscode.ExtensionContext;

function renderPanel(panel: vscode.WebviewPanel, context: PanelContext): void {
    const results = rememberResults(context.results);
    if (context.mode === 'results') {
        originalShow(
            context.extensionUri,
            results,
            panel,
            context.spectrogramSettings,
        );
        installOnPanel(panel, { ...context, results });
        return;
    }
    originalShowDirectorySelection(
        context.extensionUri,
        context.rootPath,
        context.allFilePaths,
        context.selectedFilePaths,
        results,
        context.pythonEnvironmentState,
        panel,
        context.spectrogramSettings,
    );
    installOnPanel(panel, { ...context, results });
}

function installPanelLifecycle(panel: vscode.WebviewPanel): void {
    if (panelLifecycleInstalled.has(panel)) {
        return;
    }
    panelLifecycleInstalled.add(panel);
    panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
            activePanel = event.webviewPanel;
        } else if (activePanel === event.webviewPanel) {
            activePanel = undefined;
        }
    });
    panel.onDidDispose(() => {
        panelMessageDisposables.get(panel)?.dispose();
        panelMessageDisposables.delete(panel);
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });
}

function installOnPanel(panel: vscode.WebviewPanel, context: PanelContext): void {
    if (panel.active) {
        activePanel = panel;
    }
    panelContexts.set(panel, context);
    panel.webview.html = injectCalibrationRuntime(panel.webview.html);
    installPanelLifecycle(panel);

    panelMessageDisposables.get(panel)?.dispose();
    const disposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (isConfigureCalibrationMessage(message)) {
            const result = context.results.find((candidate) => candidate.filePath === message.filePath);
            if (result) {
                await configureResult(contextExtension, panel, result);
            }
            return;
        }
        if (!message || typeof message !== 'object') {
            return;
        }
        const candidate = message as Record<string, unknown>;
        if (candidate['type'] !== 'calibration-reload' || !isAnalysisResultArray(candidate['results'])) {
            return;
        }
        const results = rememberResults(candidate['results']);
        renderPanel(panel, { ...context, results });
    });
    panelMessageDisposables.set(panel, disposable);
}

function patchBackendCalibration(extensionContext: vscode.ExtensionContext): void {
    if (backendPatched) {
        return;
    }
    backendPatched = true;
    const prototype = PythonBackendServer.prototype;
    const analyze = prototype.analyze;
    const requestRange = prototype.requestRange;
    const requestTrackDetail = prototype.requestTrackDetail;
    const requestSpectrumSlice = prototype.requestSpectrumSlice;

    prototype.analyze = function(filePath, options) {
        return analyze.call(this, filePath, {
            ...options,
            calibrationProfile: getCalibrationProfile(extensionContext, filePath),
            analysisRevision: getAnalysisRevision(filePath),
        });
    };
    prototype.requestRange = function(filePath, startNorm, endNorm, points, requestId, calibration = {}) {
        return requestRange.call(
            this,
            filePath,
            startNorm,
            endNorm,
            points,
            requestId,
            {
                ...calibration,
                calibrationProfile: getCalibrationProfile(extensionContext, filePath),
                analysisRevision: getAnalysisRevision(filePath),
            },
        );
    };
    prototype.requestTrackDetail = function(filePath, payload, requestId) {
        return requestTrackDetail.call(this, filePath, {
            ...payload,
            calibrationProfile: getCalibrationProfile(extensionContext, filePath),
            analysisRevision: getAnalysisRevision(filePath),
        }, requestId);
    };
    prototype.requestSpectrumSlice = function(filePath, payload, requestId) {
        return requestSpectrumSlice.call(this, filePath, {
            ...payload,
            calibrationProfile: getCalibrationProfile(extensionContext, filePath),
            analysisRevision: getAnalysisRevision(filePath),
        }, requestId);
    };
}

export function installCalibrationPanelRuntime(extensionContext: vscode.ExtensionContext): void {
    contextExtension = extensionContext;
    patchBackendCalibration(extensionContext);
    if (installed) {
        return;
    }
    installed = true;

    ComparisonPanel.show = function(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings?: SpectrogramSettings,
    ): vscode.WebviewPanel {
        const resolvedSettings = spectrogramSettings ?? {
            auto: true,
            stft: { nFft: 1024, hopSize: 256, window: 'hann' },
            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        };
        const mergedResults = rememberResults(results);
        const panel = originalShow(extensionUri, mergedResults, existingPanel, resolvedSettings);
        installOnPanel(panel, {
            mode: 'results',
            extensionUri,
            results: mergedResults,
            spectrogramSettings: resolvedSettings,
        });
        return panel;
    };

    ComparisonPanel.showDirectorySelection = function(
        extensionUri: vscode.Uri,
        rootPath: string,
        allFilePaths: string[],
        selectedFilePaths: string[],
        results: AnalysisResultWithError[],
        pythonEnvironmentState: DirectoryPanelContext['pythonEnvironmentState'],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings?: SpectrogramSettings,
    ): vscode.WebviewPanel {
        const resolvedSettings = spectrogramSettings ?? {
            auto: true,
            stft: { nFft: 1024, hopSize: 256, window: 'hann' },
            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        };
        const mergedResults = rememberResults(results);
        const panel = originalShowDirectorySelection(
            extensionUri,
            rootPath,
            allFilePaths,
            selectedFilePaths,
            mergedResults,
            pythonEnvironmentState,
            existingPanel,
            resolvedSettings,
        );
        installOnPanel(panel, {
            mode: 'directory-selection',
            extensionUri,
            rootPath,
            allFilePaths,
            selectedFilePaths,
            results: mergedResults,
            pythonEnvironmentState,
            spectrogramSettings: resolvedSettings,
        });
        return panel;
    };

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('audioWandasAnalyzer.configureCalibration', async () => {
            await configureActivePanel(extensionContext);
        }),
    );
}
