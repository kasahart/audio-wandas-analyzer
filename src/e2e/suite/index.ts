import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ComparisonPanel } from '../../webview/panels/ComparisonPanel';

const EXTENSION_ID = 'audio-wandas-analyzer.audio-wandas-analyzer';
const SINGLE_TRACK_DEBUG_AUDIO_PATH = 'media/debug/sine-440.wav';
const MULTI_TRACK_DEBUG_AUDIO_PATH = 'media/debug';
const COMMAND_TIMEOUT_MS = 60000;

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
        displayOrder: number[];
        lastAnnounce: string;
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

/**
 * 各ケースが要求する読み込み済み状態。
 *
 * - `single-track`: SINGLE_TRACK_DEBUG_AUDIO_PATH を解析した結果が表示済み
 * - `multi-track-all`: MULTI_TRACK_DEBUG_AUDIO_PATH の全ファイルを選択済み
 * - `any`: 特に要件なし。直前の状態をそのまま引き継ぐ
 *   (ケース冒頭で何も保証されない。必要なら自前で analyze する)
 */
type FixturePreset = 'single-track' | 'multi-track-all' | 'any';

interface E2ETestCase {
    name: string;
    /** 開始前に保証されるフィクスチャ。省略時は 'any' (前ケースの状態を引き継ぐ)。 */
    requires?: FixturePreset;
    run: (ctx: { snapshot: TestSnapshot }) => Promise<void>;
}

function formatProgress(passed: number, total: number): string {
    return `[${passed}/${total}]`;
}

/**
 * 直近で読み込んだフィクスチャを記録し、同じものが要求されたら再解析しない。
 *
 * これによりケース間に明示的な前提が宣言され、順序や挿入で壊れにくくなる。
 * 異なるフィクスチャが要求された場合は確実に再 analyze する。
 */
let currentFixture: FixturePreset | null = null;
let currentSnapshot: TestSnapshot | null = null;

async function ensureFixture(preset: FixturePreset): Promise<TestSnapshot> {
    // 'any' は要件なし — 何もロードせず、現在の webview スナップショットを返す。
    // 何もロードされていない場合は single-track を保証する (E2E の出発点)。
    if (preset === 'any') {
        if (currentFixture === null) {
            currentFixture = 'single-track';
            currentSnapshot = await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
            return currentSnapshot;
        }
        return refreshSnapshot();
    }
    // フィクスチャが変わったときだけ再 analyze。同じなら最新スナップショットを取得し直す
    // (直前ケースが UI を変更していても、requires が同じなら元の fixture 状態を保ちたい)。
    if (currentFixture === preset && currentSnapshot) {
        return currentSnapshot;
    }
    currentFixture = preset;
    if (preset === 'single-track') {
        currentSnapshot = await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
    } else {
        currentSnapshot = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
    }
    return currentSnapshot;
}

/** 最新の webview スナップショットを取得 (キャッシュも更新)。 */
async function refreshSnapshot(): Promise<TestSnapshot> {
    const latest = await waitForSnapshot();
    currentSnapshot = latest;
    return latest;
}

function invalidateFixtureCache(): void {
    currentFixture = null;
    currentSnapshot = null;
}

/**
 * E2E_SHUFFLE_SEED=<n> が設定されていればケースをそのシードで決定論的にシャッフルする。
 * 暗黙の順序依存が残っていた場合に検出するため。CI には混入させず、ローカル検証用。
 */
function maybeShuffle<T extends { name: string }>(items: T[]): T[] {
    const seedStr = process.env.E2E_SHUFFLE_SEED;
    if (!seedStr) { return items; }
    let seed = Number(seedStr);
    if (!Number.isFinite(seed)) { return items; }
    const out = items.slice();
    // 簡易 LCG (xorshift32 でも可) — 決定論的ならなんでもよい
    const rand = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    console.log(`E2E shuffled with seed ${seedStr}: ${out.map((c) => c.name).join(' / ')}`);
    return out;
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
            requires: 'single-track',
            run: async ({ snapshot }) => {
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
                    'select-python-environment',
                    'content-waveform',
                    'content-spectrogram',
                    'spectrogram-settings',
                    'zoom-out',
                    'zoom-in',
                    'zoom-reset',
                    'wave-mode-rect-zoom',
                    'zoom-to-selection',
                    'toggle-follow-cursor',
                    'run-recipe',
                    'copy-spec',
                    'export-png',
                    'export-csv',
                    'export-wav',
                    'export-report',
                ]);
                assert.deepEqual(
                    snapshot.renderedUi.displayOrder,
                    snapshot.renderedUi.tracks.map((_: unknown, i: number) => i),
                    'Initial displayOrder should be [0, 1, ..., N-1]'
                );
                assert.strictEqual(
                    snapshot.renderedUi.lastAnnounce,
                    '',
                    'Initial lastAnnounce should be empty'
                );
            },
        },
        {
            name: 'zoom recovery returns to full-track view',
            requires: 'single-track',
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
            requires: 'single-track',
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
            requires: 'single-track',
            run: async () => {
                const spectrogramSnapshot = await runViewModeScenario(['content-spectrogram']);
                assert.ok(spectrogramSnapshot.renderedUi, 'Rendered UI snapshot should exist after spectrogram switch');
            },
        },
        {
            name: 'spectrogram settings popover roundtrip',
            run: async () => {
                await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
                await runViewModeScenario(['content-spectrogram']);

                const openId = `spec-open-${Date.now()}`;
                await ComparisonPanel.postTestActions(openId, ['open-spectrogram-settings']);
                await waitForSnapshot(openId);

                const applyId = `spec-apply-${Date.now()}`;
                await ComparisonPanel.postTestActions(applyId, [
                    {
                        action: 'apply-spectrogram-settings',
                        payload: { auto: false, nFft: 512, hopSize: 128, window: 'hamming' },
                    },
                ]);
                const applied = await waitForSnapshotWhere((snapshot) => {
                    return !!snapshot.renderedUi?.latestSpectrogram
                        && snapshot.renderedUi.latestSpectrogram.windowSize === 512
                        && snapshot.renderedUi.latestSpectrogram.hopSize === 128;
                });
                assert.equal(applied.renderedUi?.latestSpectrogram?.windowSize, 512);
                assert.equal(applied.renderedUi?.latestSpectrogram?.hopSize, 128);

                const displayId = `spec-display-${Date.now()}`;
                await ComparisonPanel.postTestActions(displayId, [
                    {
                        action: 'set-spectrogram-display',
                        payload: { dbMin: -60, dbMax: 0, maxFrequencyHz: null },
                    },
                ]);
                const displayed = await waitForSnapshotWhere((snapshot) => {
                    return snapshot.renderedUi?.latestSpectrogram?.dbMinApplied === -60
                        && snapshot.renderedUi?.latestSpectrogram?.dbMaxApplied === 0;
                });
                assert.equal(displayed.renderedUi?.latestSpectrogram?.dbMinApplied, -60);
                assert.equal(displayed.renderedUi?.latestSpectrogram?.dbMaxApplied, 0);
                assert.equal(displayed.renderedUi?.latestSpectrogram?.maxFrequencyHzApplied, null);
                assert.equal(
                    displayed.renderedUi?.latestSpectrogram?.windowSize,
                    512,
                    'changing display range should not re-analyze STFT',
                );
                const reopened = await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
                assert.equal(
                    reopened.renderedUi?.latestSpectrogram?.windowSize,
                    512,
                    'reopened panel should restore persisted spectrogram window size',
                );
                assert.equal(
                    reopened.renderedUi?.latestSpectrogram?.hopSize,
                    128,
                    'reopened panel should restore persisted spectrogram hop size',
                );
                assert.equal(
                    reopened.renderedUi?.latestSpectrogram?.dbMinApplied,
                    -60,
                    'reopened panel should restore persisted spectrogram min dB',
                );
                assert.equal(
                    reopened.renderedUi?.latestSpectrogram?.dbMaxApplied,
                    0,
                    'reopened panel should restore persisted spectrogram max dB',
                );
                assert.equal(
                    reopened.renderedUi?.latestSpectrogram?.maxFrequencyHzApplied,
                    null,
                    'reopened panel should restore persisted spectrogram max frequency',
                );
            },
        },
        {
            name: 'directory selection toolbar can select all and clear all tracks',
            run: async () => {
                const initial = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH);
                assert.equal(initial.resultCount, 0, 'directory selection should start with no analyzed tracks');
                assert.ok(initial.renderedUi, 'directory selection snapshot should include rendered UI');
                assert.equal(initial.renderedUi.trackRowCount, 0, 'directory selection should start with no track rows');

                const selected = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.equal(selected.resultCount, 3, 'select-all should analyze every track in the folder');
                assert.equal(selected.renderedUi?.trackRowCount, 3, 'select-all should render every track row');

                const clearId = `selection-clear-all-${Date.now()}`;
                await ComparisonPanel.postTestActions(clearId, ['selection-clear-all']);
                const cleared = await waitForSnapshotWhere((snapshot) => {
                    return snapshot.resultCount === 0
                        && !!snapshot.renderedUi
                        && snapshot.renderedUi.trackRowCount === 0;
                });
                assert.equal(cleared.resultCount, 0, 'clear-all should remove analyzed tracks from the panel');
                assert.equal(cleared.renderedUi?.trackRowCount, 0, 'clear-all should remove track rows from the panel');
            },
        },
        {
            name: 'multi-track folder analysis loads all tracks',
            requires: 'multi-track-all',
            run: async ({ snapshot }) => {
                assert.equal(snapshot.resultCount, 3);
                assert.ok(snapshot.renderedUi, 'Rendered UI snapshot should exist for multi-track analysis');
                assert.equal(snapshot.renderedUi.trackRowCount, 3);
            },
        },
        {
            name: 'cursor power spectrum section is rendered for each track',
            requires: 'multi-track-all',
            run: async ({ snapshot }) => {
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
            name: 'track offset changes visible range on multi-track view',
            requires: 'multi-track-all',
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
        {
            name: 'axis labels with units are emitted for waveform / spectrogram / spectrum',
            requires: 'single-track',
            run: async ({ snapshot }) => {
                assert.ok(snapshot.renderedUi, 'Rendered UI snapshot should exist');
                const axes = snapshot.renderedUi.axisLabels;
                assert.ok(axes, 'axisLabels must be present in snapshot');

                const wf = axes.waveformPerTrack[0] ?? [];
                assert.ok(wf.includes('+1.0') && wf.includes('-1.0') && wf.includes('0'),
                    `waveform axis labels missing: ${JSON.stringify(wf)}`);
                assert.ok(wf.some((s) => s.includes('Amp')),
                    `waveform axis title (Amp) missing: ${JSON.stringify(wf)}`);

                const sg = axes.spectrogramPerTrack[0] ?? [];
                assert.ok(sg.includes('0 Hz'),
                    `spectrogram should include "0 Hz": ${JSON.stringify(sg)}`);
                assert.ok(sg.some((s) => /Hz$/.test(s) && s !== '0 Hz'),
                    `spectrogram should include a non-zero frequency label: ${JSON.stringify(sg)}`);
                assert.ok(sg.some((s) => /dB$/.test(s)),
                    `spectrogram colorbar dB label missing: ${JSON.stringify(sg)}`);

                const sp = axes.spectrumPerTrack[0] ?? [];
                assert.ok(sp.includes('0 Hz'),
                    `per-track spectrum should include "0 Hz": ${JSON.stringify(sp)}`);
                assert.ok(sp.some((s) => /dB$/.test(s)),
                    `per-track spectrum dB label missing: ${JSON.stringify(sp)}`);

                const overlay = axes.spectrumOverlay;
                assert.ok(overlay.includes('0 Hz'),
                    `overlay spectrum should include "0 Hz": ${JSON.stringify(overlay)}`);
                assert.ok(overlay.some((s) => /dB$/.test(s)),
                    `overlay spectrum dB label missing: ${JSON.stringify(overlay)}`);
            },
        },
    ];
    let passedCount = 0;

    await config.update('pythonCommand', pythonCommand, vscode.ConfigurationTarget.Global);

    const orderedCases = maybeShuffle(testCases);

    try {
        console.log(`Running ${orderedCases.length} VS Code E2E checks...`);
        for (const testCase of orderedCases) {
            const snapshot = await ensureFixture(testCase.requires ?? 'any');
            await testCase.run({ snapshot });
            passedCount += 1;
            console.log(`${formatProgress(passedCount, testCases.length)} PASS ${testCase.name}`);
        }
        console.log(`VS Code E2E summary: ${passedCount}/${testCases.length} passed`);
    } catch (error) {
        console.error(`VS Code E2E summary: ${passedCount}/${testCases.length} passed before failure`);
        throw error;
    } finally {
        invalidateFixtureCache();
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
        const snapshotAfterAction = await waitForSnapshot(actionId);
        if (
            snapshotAfterAction.resultCount > 0
            && !!snapshotAfterAction.renderedUi
            && snapshotAfterAction.renderedUi.trackRowCount > 0
        ) {
            return snapshotAfterAction;
        }
        return waitForSnapshotWhere((snapshot) => {
            return snapshot.resultCount > 0
                && !!snapshot.renderedUi
                && snapshot.renderedUi.trackRowCount > 0;
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
