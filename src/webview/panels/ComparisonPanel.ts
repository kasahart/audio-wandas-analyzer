import * as path from 'path';
import * as vscode from 'vscode';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type AnalysisResultWithError,
    type SpectrogramSettings,
} from '../../shared/analysis/analysisTypes';
import type {
    ComparisonResultsState,
    ComparisonState,
    DirectorySelectionState,
} from '../runtime/types';
import { renderComparisonDocument } from './comparisonDocument';
export { renderComparisonStyles } from './comparisonDocument';

export type { ComparisonState } from '../runtime/types';

interface ComparisonPanelTestSnapshot {
    title: string;
    html: string;
    fileNames: string[];
    resultCount: number;
    lastActionId?: string;
    renderedUi?: ComparisonPanelRenderedUi;
}

interface ComparisonPanelRenderedUi {
    hasToolbar: boolean;
    toolbarActions: string[];
    trackRowCount: number;
    audioElementCount: number;
    hasRulerCanvas: boolean;
    zoomStart: number;
    zoomEnd: number;
    cursorNorm: number;
    spectrumOverlayPresent: boolean;
    spectrumTrackCanvasCount: number;
    visibleSpectrumTrackCount: number;
    contentType: 'waveform' | 'spectrogram';
    reanalyzeBusy: boolean;
    latestSpectrogram?: {
        windowSize: number;
        hopSize: number;
        dbMinApplied: number | null;
        dbMaxApplied: number | null;
        maxFrequencyHzApplied: number | null;
    };
    axisLabels: {
        spectrumOverlay: string[];
        spectrogramPerTrack: string[][];
        spectrumPerTrack: string[][];
        waveformPerTrack: string[][];
    };
    displayOrder: string[];
    specFreqStart: number;
    specFreqEnd: number;
    waveformMode: 'loop' | 'rect-zoom';
    lastAnnounce: string;
    tracks: Array<{
        trackId: string;
        trackIndex: number;
        filePath: string;
        offsetSeconds: number;
        visibleFileStartNorm: number;
        visibleFileEndNorm: number;
        waveformFullyVisible: boolean;
        waveformCoversViewportLeft: boolean;
        waveformCoversViewportRight: boolean;
        waveformMinDrawX: number | null;
        waveformMaxDrawX: number | null;
        waveformCanvasWidth: number | null;
        resultError: string | null;
        spectrumCanvasPresent: boolean;
        spectrumSlicePresent: boolean;
    }>;
}

interface ComparisonPanelRenderedUiMessage {
    type: 'comparison-panel-test-snapshot';
    renderedUi: ComparisonPanelRenderedUi;
    actionId?: string;
}

interface ComparisonPanelTestActionMessage {
    type: 'comparison-panel-test-action';
    actionId: string;
    actions: Array<string | { action: string; trackIndex?: number; payload?: Record<string, unknown> }>;
}

export class ComparisonPanel {
    private static testSnapshot: ComparisonPanelTestSnapshot | undefined;
    private static testSnapshotsByActionId = new Map<string, ComparisonPanelTestSnapshot>();
    private static activePanel: vscode.WebviewPanel | undefined;
    private static testMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
    private static resultsByPanel = new WeakMap<object, AnalysisResultWithError[]>();

    public static updateResults(panel: object, results: AnalysisResultWithError[]): void {
        ComparisonPanel.resultsByPanel.set(panel, [...results]);
    }

    public static getResults(panel: object): AnalysisResultWithError[] {
        return ComparisonPanel.resultsByPanel.get(panel) ?? [];
    }

    public static replaceResult(
        panel: object,
        replacement: AnalysisResultWithError,
    ): AnalysisResultWithError[] | undefined {
        const current = ComparisonPanel.resultsByPanel.get(panel);
        if (!current?.some((result) => result.filePath === replacement.filePath)) {
            return undefined;
        }
        const next = current.map((result) => (
            result.filePath === replacement.filePath ? replacement : result
        ));
        ComparisonPanel.resultsByPanel.set(panel, next);
        return [...next];
    }

    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings: SpectrogramSettings = DEFAULT_SPECTROGRAM_SETTINGS,
    ): vscode.WebviewPanel {
        const title = results.length === 1
            ? `Audio Analyzer: ${results[0].fileName}`
            : `Audio Compare: ${results.map((r) => r.fileName).join(', ')}`;

        const localResourceRoots = ComparisonPanel.buildLocalResourceRoots(extensionUri, results);
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots,
            },
        );

        panel.title = title;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots,
        };
        panel.reveal(vscode.ViewColumn.One, true);
        ComparisonPanel.activePanel = panel;
        ComparisonPanel.updateResults(panel, results);
        panel.onDidDispose(() => {
            ComparisonPanel.resultsByPanel.delete(panel);
            if (ComparisonPanel.activePanel === panel) {
                ComparisonPanel.activePanel = undefined;
            }
        });
        ComparisonPanel.testMessageDisposables.get(panel)?.dispose();
        const testMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
            ComparisonPanel.captureRenderedUiSnapshot(message);
        });
        ComparisonPanel.testMessageDisposables.set(panel, testMessageDisposable);

        const state: ComparisonResultsState = {
            mode: 'results',
            results: results.map((result) => ({
                ...result,
                audioSource: panel.webview.asWebviewUri(vscode.Uri.file(result.filePath)).toString(),
            })),
            spectrogramSettings,
        };
        const html = renderComparisonHtml(panel.webview, state, extensionUri);
        panel.webview.html = html;
        ComparisonPanel.testSnapshot = {
            title,
            html,
            fileNames: state.results.map((result) => result.fileName),
            resultCount: state.results.length,
        };
        return panel;
    }

    public static showDirectorySelection(
        extensionUri: vscode.Uri,
        rootPath: string,
        allFilePaths: string[],
        selectedFilePaths: string[],
        results: AnalysisResultWithError[],
        pythonEnvironmentState: DirectorySelectionState['pythonEnvironmentState'],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings: SpectrogramSettings = DEFAULT_SPECTROGRAM_SETTINGS,
    ): vscode.WebviewPanel {
        const title = `Audio Analyzer: ${path.basename(rootPath) || rootPath}`;
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: ComparisonPanel.buildLocalResourceRoots(extensionUri, results),
            },
        );

        panel.title = title;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: ComparisonPanel.buildLocalResourceRoots(extensionUri, results),
        };
        panel.reveal(vscode.ViewColumn.One, true);
        ComparisonPanel.activePanel = panel;
        ComparisonPanel.updateResults(panel, results);
        panel.onDidDispose(() => {
            ComparisonPanel.resultsByPanel.delete(panel);
            if (ComparisonPanel.activePanel === panel) {
                ComparisonPanel.activePanel = undefined;
            }
        });
        ComparisonPanel.testMessageDisposables.get(panel)?.dispose();
        const testMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
            ComparisonPanel.captureRenderedUiSnapshot(message);
        });
        ComparisonPanel.testMessageDisposables.set(panel, testMessageDisposable);

        const state: DirectorySelectionState = {
            mode: 'directory-selection',
            results: results.map((result) => ({
                ...result,
                audioSource: panel.webview.asWebviewUri(vscode.Uri.file(result.filePath)).toString(),
            })),
            rootPath,
            allFilePaths,
            selectedFilePaths,
            pythonEnvironmentState,
            spectrogramSettings,
        };
        const html = renderComparisonHtml(panel.webview, state, extensionUri);
        panel.webview.html = html;
        ComparisonPanel.testSnapshot = {
            title,
            html,
            fileNames: state.results.map((result) => result.fileName),
            resultCount: state.results.length,
        };
        return panel;
    }

    public static getTestSnapshot(): ComparisonPanelTestSnapshot | undefined {
        return ComparisonPanel.testSnapshot;
    }

    public static getTestSnapshotForAction(actionId: string): ComparisonPanelTestSnapshot | undefined {
        return ComparisonPanel.testSnapshotsByActionId.get(actionId);
    }

    public static clearTestSnapshot(): void {
        ComparisonPanel.testSnapshot = undefined;
        ComparisonPanel.testSnapshotsByActionId.clear();
    }

    public static async postTestActions(
        actionId: string,
        actions: Array<string | { action: string; trackId?: string; trackIndex?: number; payload?: Record<string, unknown> }>,
    ): Promise<void> {
        if (!ComparisonPanel.activePanel) {
            throw new Error('No active ComparisonPanel is available for test actions');
        }

        const delivered = await ComparisonPanel.activePanel.webview.postMessage({
            type: 'comparison-panel-test-action',
            actionId,
            actions,
        } satisfies ComparisonPanelTestActionMessage);

        if (!delivered) {
            throw new Error('ComparisonPanel test actions could not be delivered to the webview');
        }
    }

    private static captureRenderedUiSnapshot(message: unknown): void {
        if (!ComparisonPanel.isRenderedUiMessage(message) || !ComparisonPanel.testSnapshot) {
            return;
        }

        const snapshot = {
            ...ComparisonPanel.testSnapshot,
            lastActionId: message.actionId,
            renderedUi: message.renderedUi,
        };
        ComparisonPanel.testSnapshot = snapshot;

        if (message.actionId) {
            ComparisonPanel.testSnapshotsByActionId.set(message.actionId, snapshot);
            if (ComparisonPanel.testSnapshotsByActionId.size > 50) {
                const oldest = ComparisonPanel.testSnapshotsByActionId.keys().next().value;
                if (oldest) {
                    ComparisonPanel.testSnapshotsByActionId.delete(oldest);
                }
            }
        }
    }

    private static isRenderedUiMessage(message: unknown): message is ComparisonPanelRenderedUiMessage {
        if (!message || typeof message !== 'object') {
            return false;
        }

        const candidate = message as Partial<ComparisonPanelRenderedUiMessage>;
        return candidate.type === 'comparison-panel-test-snapshot'
            && !!candidate.renderedUi
            && Array.isArray(candidate.renderedUi.toolbarActions)
            && typeof candidate.renderedUi.trackRowCount === 'number';
    }

    private static buildLocalResourceRoots(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[] = [],
    ): vscode.Uri[] {
        const roots = new Map<string, vscode.Uri>();
        const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
        roots.set(mediaRoot.toString(), mediaRoot);
        const webviewBuiltRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
        roots.set(webviewBuiltRoot.toString(), webviewBuiltRoot);

        results.forEach((result) => {
            const audioDir = vscode.Uri.file(path.dirname(result.filePath));
            roots.set(audioDir.toString(), audioDir);
        });

        return Array.from(roots.values());
    }

}

export function renderComparisonHtml(webview: vscode.Webview, state: ComparisonState, extensionUri: vscode.Uri): string {
    return renderComparisonDocument(state, {
        waveformScriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'comparisonWaveform.js')).toString(),
        runtimeScriptUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'comparisonRuntime.js')).toString(),
        cspSource: webview.cspSource,
        language: typeof vscode.env?.language === 'string' ? vscode.env.language : 'en',
    });
}
