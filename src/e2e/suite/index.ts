import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ComparisonPanel } from '../../webview/panels/ComparisonPanel';

const EXTENSION_ID = 'audio-wandas-analyzer.audio-wandas-analyzer';
const SINGLE_TRACK_DEBUG_AUDIO_PATH = 'media/debug/sine-440.wav';
const MULTI_TRACK_DEBUG_AUDIO_PATH = 'media/debug';
const COMMAND_TIMEOUT_MS = 30000;

interface TestSnapshot {
    title: string;
    html: string;
    fileNames: string[];
    resultCount: number;
    lastActionId?: string;
    renderedUi?: {
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
        tracks: Array<{
            trackIndex: number;
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
    };
}

interface E2ETestCase {
    name: string;
    run: () => Promise<void>;
}

function formatProgress(passed: number, total: number): string {
    return `[${passed}/${total}]`;
}

export async function run(): Promise<void> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Extension ${EXTENSION_ID} must be available`);

    await extension.activate();

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder is required for VS Code E2E tests');

    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = path.join(workspaceFolder.uri.fsPath, '.venv', 'bin', 'python');
    const testCases: E2ETestCase[] = [
        {
            name: 'single-track analysis renders expected UI',
            run: async () => {
                const snapshot = await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
                assert.equal(snapshot.title, 'Audio Analyzer: sine-440.wav');
                assert.equal(snapshot.resultCount, 1);
                assert.deepEqual(snapshot.fileNames, ['sine-440.wav']);
                assert.match(snapshot.html, /comparisonWaveform\.js/u);
                assert.match(snapshot.html, /id="app"/u);
                assert.ok(snapshot.renderedUi, 'Rendered UI snapshot should be captured');
                assert.equal(snapshot.renderedUi.hasToolbar, true);
                assert.equal(snapshot.renderedUi.trackRowCount, 1);
                assert.equal(snapshot.renderedUi.audioElementCount, 1);
                assert.equal(snapshot.renderedUi.hasRulerCanvas, true);
                const errored = snapshot.renderedUi.tracks.filter((t) => t.resultError);
                assert.equal(errored.length, 0, `Tracks should not have analysis errors: ${errored.map((t) => `${t.trackIndex}=${t.resultError}`).join(', ')}`);
                assert.deepEqual(snapshot.renderedUi.toolbarActions, [
                    'open-file',
                    'open-folder',
                    'content-waveform',
                    'content-spectrogram',
                    'zoom-out',
                    'zoom-in',
                ]);
            },
        },
        {
            name: 'zoom recovery returns to full-track view',
            run: async () => {
                const zoomRecoverySnapshot = await runZoomRecoveryScenario();
                assert.ok(zoomRecoverySnapshot.renderedUi, 'Rendered UI snapshot should exist after zoom recovery');
                const zoomRecoveryUi = zoomRecoverySnapshot.renderedUi;
                assert.equal(zoomRecoveryUi.zoomStart, 0);
                assert.equal(zoomRecoveryUi.zoomEnd, 1);
                assert.equal(zoomRecoveryUi.tracks.length, 1);
                assert.equal(zoomRecoveryUi.tracks[0].trackIndex, 0);
                assert.equal(zoomRecoveryUi.tracks[0].visibleFileStartNorm, 0);
                assert.equal(zoomRecoveryUi.tracks[0].visibleFileEndNorm, 1);
                assert.equal(zoomRecoveryUi.tracks[0].waveformFullyVisible, true);
            },
        },
        {
            name: 'zoomed waveform still covers viewport edges',
            run: async () => {
                const zoomInEdgeCoverageSnapshot = await runZoomInEdgeCoverageScenario();
                assert.ok(zoomInEdgeCoverageSnapshot.renderedUi, 'Rendered UI snapshot should exist after repeated zoom-in');
                const zoomInEdgeCoverageUi = zoomInEdgeCoverageSnapshot.renderedUi;
                assert.equal(zoomInEdgeCoverageUi.tracks.length, 1);
                assert.ok(zoomInEdgeCoverageUi.zoomStart > 0, 'zoomStart should move forward after repeated zoom-in');
                assert.ok(zoomInEdgeCoverageUi.zoomEnd < 1, 'zoomEnd should move backward after repeated zoom-in');
                assert.ok(zoomInEdgeCoverageUi.tracks[0].visibleFileStartNorm > 0, 'Visible file start should move inside the track');
                assert.ok(zoomInEdgeCoverageUi.tracks[0].visibleFileEndNorm < 1, 'Visible file end should move inside the track');
                const edgeTrack = zoomInEdgeCoverageUi.tracks[0];
                const edgeDiag = `minX=${edgeTrack.waveformMinDrawX} maxX=${edgeTrack.waveformMaxDrawX} W=${edgeTrack.waveformCanvasWidth} visStart=${edgeTrack.visibleFileStartNorm} visEnd=${edgeTrack.visibleFileEndNorm} zoom=[${zoomInEdgeCoverageUi.zoomStart},${zoomInEdgeCoverageUi.zoomEnd}]`;
                assert.equal(edgeTrack.waveformCoversViewportLeft, true, `Left edge not covered: ${edgeDiag}`);
                assert.equal(edgeTrack.waveformCoversViewportRight, true, `Right edge not covered: ${edgeDiag}`);
            },
        },
        {
            name: 'spectrogram mode renders successfully',
            run: async () => {
                const spectrogramSnapshot = await runViewModeScenario(['content-spectrogram']);
                assert.ok(spectrogramSnapshot.renderedUi, 'Rendered UI snapshot should exist after spectrogram switch');
            },
        },
        {
            name: 'multi-track folder analysis loads all tracks',
            run: async () => {
                const multiTrackSnapshot = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.equal(multiTrackSnapshot.resultCount, 3);
                assert.ok(multiTrackSnapshot.renderedUi, 'Rendered UI snapshot should exist for multi-track analysis');
                assert.equal(multiTrackSnapshot.renderedUi.trackRowCount, 3);
            },
        },
        {
            name: 'cursor power spectrum section is rendered for each track',
            run: async () => {
                const snapshot = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.ok(snapshot.renderedUi, 'Rendered UI snapshot should exist');
                const ui = snapshot.renderedUi;
                assert.equal(ui.spectrumOverlayPresent, true, 'overlay spectrum canvas should be rendered');
                assert.equal(ui.spectrumTrackCanvasCount, ui.trackRowCount,
                    'each visible track row should have a spectrum canvas');
                assert.ok(ui.visibleSpectrumTrackCount >= 1,
                    'at least one track should contribute a spectrum slice at the default cursor');
                ui.tracks.forEach((t) => {
                    assert.equal(t.spectrumCanvasPresent, true,
                        `track ${t.trackIndex} should have its per-track spectrum canvas`);
                });
            },
        },
        {
            name: 'muting a track removes it from the cursor spectrum overlay',
            run: async () => {
                const baseline = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.ok(baseline.renderedUi);
                const baselineVisible = baseline.renderedUi.visibleSpectrumTrackCount;
                assert.ok(baselineVisible >= 1, 'baseline should have at least one visible spectrum slice');

                const muteActionId = `spectrum-mute-${Date.now()}`;
                await ComparisonPanel.postTestActions(muteActionId, [
                    { action: 'toggle-mute', trackIndex: 0 },
                ]);
                const muted = await waitForSnapshot(muteActionId);
                assert.ok(muted.renderedUi);
                assert.equal(
                    muted.renderedUi.visibleSpectrumTrackCount,
                    Math.max(0, baselineVisible - 1),
                    'muting one track should drop the overlay slice count by one',
                );
            },
        },
        {
            name: 'track offset changes visible range on multi-track view',
            run: async () => {
                const multiTrackZoomBaselineSnapshot = await runViewModeScenario(['zoom-in']);
                assert.ok(multiTrackZoomBaselineSnapshot.renderedUi, 'Rendered UI snapshot should exist for multi-track zoom baseline');

                const multiTrackOffsetSnapshot = await runMultiTrackOffsetScenario();
                assert.ok(multiTrackOffsetSnapshot.renderedUi, 'Rendered UI snapshot should exist after offset adjustments');
                const baselineTrack = multiTrackZoomBaselineSnapshot.renderedUi.tracks[1];
                const offsetTrack = multiTrackOffsetSnapshot.renderedUi.tracks[1];
                assert.ok(offsetTrack.offsetSeconds > baselineTrack.offsetSeconds, 'Track offset should increase after offset-up actions');
                assert.ok(offsetTrack.visibleFileStartNorm < baselineTrack.visibleFileStartNorm, 'Visible range should shift after offset increase');
                assert.ok(offsetTrack.visibleFileEndNorm < baselineTrack.visibleFileEndNorm, 'Visible range end should also shift after offset increase');
            },
        },
    ];
    let passedCount = 0;

    await config.update('pythonCommand', pythonCommand, vscode.ConfigurationTarget.Global);

    try {
        console.log(`Running ${testCases.length} VS Code E2E checks...`);
        for (const testCase of testCases) {
            await testCase.run();
            passedCount += 1;
            console.log(`${formatProgress(passedCount, testCases.length)} PASS ${testCase.name}`);
        }
        console.log(`VS Code E2E summary: ${passedCount}/${testCases.length} passed`);
    } catch (error) {
        console.error(`VS Code E2E summary: ${passedCount}/${testCases.length} passed before failure`);
        throw error;
    } finally {
        await config.update('debugFilePath', undefined, vscode.ConfigurationTarget.Global);
        await config.update('pythonCommand', undefined, vscode.ConfigurationTarget.Global);
    }
}

async function analyzeDebugPath(
    debugPath: string,
    options?: { selectAllDirectoryFiles?: boolean },
): Promise<TestSnapshot> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    await config.update('debugFilePath', debugPath, vscode.ConfigurationTarget.Global);
    ComparisonPanel.clearTestSnapshot();
    await vscode.commands.executeCommand('audioWandasAnalyzer.analyzeDebugFile');

    if (options?.selectAllDirectoryFiles) {
        await waitForSnapshot();
        const actionId = `selection-select-all-${Date.now()}`;
        await ComparisonPanel.postTestActions(actionId, ['selection-select-all']);
        await waitForSnapshot(actionId);
        return waitForSnapshotWhere((snapshot) => {
            return snapshot.resultCount > 0
                && !!snapshot.renderedUi
                && snapshot.renderedUi.trackRowCount > 0
                && snapshot.lastActionId !== actionId;
        });
    }

    return waitForSnapshot();
}

async function runZoomRecoveryScenario(): Promise<TestSnapshot> {
    const actionId = `zoom-recovery-${Date.now()}`;
    await ComparisonPanel.postTestActions(actionId, [
        'zoom-in',
        'zoom-in',
        'zoom-out',
        'zoom-out',
    ]);
    return waitForSnapshot(actionId);
}

async function runZoomInEdgeCoverageScenario(): Promise<TestSnapshot> {
    const actionId = `zoom-in-edge-${Date.now()}`;
    await ComparisonPanel.postTestActions(actionId, [
        'zoom-out',
        'zoom-out',
        'zoom-out',
        'zoom-in',
        'zoom-in',
        'zoom-in',
        'zoom-in',
        'zoom-in',
    ]);
    return waitForSnapshot(actionId);
}

async function runViewModeScenario(actions: string[]): Promise<TestSnapshot> {
    const actionId = `view-mode-${Date.now()}-${actions.join('-')}`;
    await ComparisonPanel.postTestActions(actionId, actions);
    return waitForSnapshot(actionId);
}

async function runMultiTrackOffsetScenario(): Promise<TestSnapshot> {
    const actionId = `offset-range-${Date.now()}`;
    await ComparisonPanel.postTestActions(actionId, [
        { action: 'offset-up', trackIndex: 1 },
        { action: 'offset-up', trackIndex: 1 },
    ]);
    return waitForSnapshot(actionId);
}

async function waitForSnapshot(expectedActionId?: string): Promise<TestSnapshot> {
    return waitForSnapshotWhere((snapshot) => {
        return !!snapshot.renderedUi && (!expectedActionId || snapshot.lastActionId === expectedActionId);
    });
}

async function waitForSnapshotWhere(predicate: (snapshot: TestSnapshot) => boolean): Promise<TestSnapshot> {
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const snapshot = ComparisonPanel.getTestSnapshot();
        if (snapshot && predicate(snapshot)) {
            return snapshot;
        }
        await delay(250);
    }

    throw new Error(`ComparisonPanel snapshot was not captured within ${COMMAND_TIMEOUT_MS}ms`);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
