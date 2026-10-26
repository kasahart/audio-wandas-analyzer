import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ExportFlows, type ExportHost } from '../../extension/exportFlows';
import * as vscode from 'vscode';
import { ComparisonPanel } from '../../webview/panels/ComparisonPanel';

const EXTENSION_ID = 'audio-wandas-analyzer.audio-wandas-analyzer';
const SINGLE_TRACK_DEBUG_AUDIO_PATH = 'media/debug/sine-440.wav';
const MULTI_TRACK_DEBUG_AUDIO_PATH = 'media/debug';
const COMMAND_TIMEOUT_MS = 60000;

interface VerticalExtent {
    top: number;
    bottom: number;
}

interface TestSnapshot {
    title: string;
    html: string;
    fileNames: string[];
    resultCount: number;
    lastActionId?: string;
    renderedUi?: {
        /** The entry table and the comparison, as their own snapshots report them. */
        entry?: { open: boolean; rows: number; scanned: number; slots: (string | null)[] };
        comparison?: { open: boolean; stage: string | null; frame: string | null; kind: string | null; stageValues: number; stageMedian: number | null; invalidSteps: number };
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
            overlapPercent: number | null;
            hopSize: number | null;
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
        lastAnnounce: string;
        amplitudeZoomMinNorm: number;
        amplitudeZoomMaxNorm: number;
        hintFooterText: string | null;
        layout: {
            viewportHeight: number;
            tracksWrapper: VerticalExtent | null;
            spectrumSection: VerticalExtent | null;
            hintFooter: VerticalExtent | null;
        };
        waveformRangePopover: { open: boolean; min: string | null; max: string | null } | null;
        audioContextState: string | null;
        lastPlayRejection: string | null;
        audio: Array<{
            trackId: string | null;
            crossOrigin: string | null;
            readyState: number;
            paused: boolean;
            currentTime: number;
            errorCode: number | null;
        }>;
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
                assert.match(snapshot.html, /comparisonRuntime\.js/u);
                assert.match(snapshot.html, /id="app"/u);
                assert.ok(snapshot.renderedUi, 'Rendered UI snapshot should be captured');
                assert.equal(snapshot.renderedUi.hasToolbar, true);
                assert.equal(snapshot.renderedUi.trackRowCount, 1);
                assert.equal(snapshot.renderedUi.audioElementCount, 1);
                assert.equal(snapshot.renderedUi.hasRulerCanvas, true);
                const errored = snapshot.renderedUi.tracks.filter((t) => t.resultError);
                assert.equal(errored.length, 0, `Tracks should not have analysis errors: ${errored.map((t) => `${t.trackIndex}=${t.resultError}`).join(', ')}`);
                assert.deepEqual(snapshot.renderedUi.toolbarActions, [
                    'content-waveform',
                    'content-spectrogram',
                    'content-stage',
                    'spectrogram-settings',
                    'zoom-out',
                    'zoom-in',
                    'zoom-reset',
                    'wave-mode-rect-zoom',
                    'zoom-to-selection',
                    'toggle-follow-cursor',
                    // Track and spectrum heights are set by dragging their edges; there is no spec-copy button.
                    'export-png',
                    'export-csv',
                    'export-wav',
                    'export-report',
                    'save-recipe',
                    'run-recipe',
                ]);
                assert.deepEqual(
                    snapshot.renderedUi.displayOrder,
                    snapshot.renderedUi.tracks.map((track) => track.trackId),
                    'Initial displayOrder should contain the rendered TrackIds'
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
                await postActionsAndWait(openId, ['open-spectrogram-settings']);

                const applyId = `spec-apply-${Date.now()}`;
                await postActionsAndWait(applyId, [
                    {
                        action: 'apply-spectrogram-settings',
                        payload: { auto: false, nFft: 512, overlapPercent: 50, window: 'hamming' },
                    },
                ]);
                const applied = await waitForSnapshotWhere((snapshot) => {
                    return !!snapshot.renderedUi?.latestSpectrogram
                        && snapshot.renderedUi.latestSpectrogram.windowSize === 512
                        && snapshot.renderedUi.latestSpectrogram.hopSize === 256
                        && snapshot.renderedUi.reanalyzeBusy === false;
                });
                assert.equal(applied.renderedUi?.latestSpectrogram?.windowSize, 512);
                assert.equal(applied.renderedUi?.latestSpectrogram?.overlapPercent, 50);
                assert.equal(applied.renderedUi?.latestSpectrogram?.hopSize, 256);

                const displayId = `spec-display-${Date.now()}`;
                const displayed = await postActionsAndWait(displayId, [
                    {
                        action: 'set-spectrogram-display',
                        payload: { dbMin: -60, dbMax: 0, maxFrequencyHz: null },
                    },
                ], (snapshot) => {
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
                    reopened.renderedUi?.latestSpectrogram?.overlapPercent,
                    50,
                    'reopened panel should restore persisted spectrogram overlap',
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
            name: 'async directory analysis does not restore a cleared selection',
            run: async () => {
                const initial = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH);
                assert.equal(initial.resultCount, 0, 'directory selection should start empty');

                const actionId = `selection-race-${Date.now()}`;
                await ComparisonPanel.postTestActions(actionId, [
                    { action: 'set-all-files-selected', payload: { selected: true } },
                    { action: 'set-all-files-selected', payload: { selected: false } },
                ]);
                await delay(2000);
                const settled = await waitForSnapshotWhere((snapshot) => {
                    return snapshot.resultCount === 0
                        && !!snapshot.renderedUi
                        && snapshot.renderedUi.trackRowCount === 0;
                });
                assert.equal(settled.resultCount, 0, 'stale analysis completion must not restore cleared tracks');
                assert.equal(settled.renderedUi?.trackRowCount, 0, 'cleared selection must remain empty');
            },
        },
        {
            name: 'directory file removal and re-add retain other track offset and cursor',
            run: async () => {
                const initial = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.equal(initial.resultCount, 3);
                const retainedPath = initial.renderedUi!.tracks[0].filePath;
                const otherPath = initial.renderedUi!.tracks[1].filePath;
                const configured = await postActionsAndWait(`selection-state-${Date.now()}`, [
                    { action: 'set-track-offset', trackIndex: 0, payload: { offsetSeconds: 0.01 } },
                    { action: 'set-cursor', payload: { cursorNorm: 0.437 } },
                ]);
                for (const selected of [false, true]) {
                    const updated = await postActionsAndWait(`selection-retain-${selected}-${Date.now()}`, [
                        { action: 'set-file-selected', payload: { filePath: otherPath, selected } },
                    ], (snapshot) => snapshot.renderedUi?.trackRowCount === (selected ? 3 : 2));
                    const retained = updated.renderedUi!.tracks.find(track => track.filePath === retainedPath)!;
                    assert.equal(retained.offsetSeconds, 0.01);
                    assert.equal(retained.trackId, configured.renderedUi!.tracks[0].trackId);
                    assert.equal(updated.renderedUi!.cursorNorm, 0.437);
                    assert.equal(updated.renderedUi!.zoomStart, configured.renderedUi!.zoomStart);
                    assert.equal(updated.renderedUi!.zoomEnd, configured.renderedUi!.zoomEnd);
                }
            },
        },
        {
            name: 'directory selection can show every listed file and take them all off',
            run: async () => {
                const initial = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH);
                assert.equal(initial.resultCount, 0, 'directory selection should start with no analyzed tracks');
                assert.ok(initial.renderedUi, 'directory selection snapshot should include rendered UI');
                assert.equal(initial.renderedUi.trackRowCount, 0, 'directory selection should start with no track rows');

                const selected = await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH, { selectAllDirectoryFiles: true });
                assert.equal(selected.resultCount, 3, 'select-all should analyze every track in the folder');
                assert.equal(selected.renderedUi?.trackRowCount, 3, 'select-all should render every track row');

                const clearId = `selection-clear-all-${Date.now()}`;
                await ComparisonPanel.postTestActions(clearId, [{ action: 'set-all-files-selected', payload: { selected: false } }]);
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
            name: 'HPSS steps added from the comparison run in the VS Code backend (wandas[effects] brings librosa)',
            run: async () => {
                invalidateFixtureCache();
                // A folder opens on the entry table, which scans its files with the chain.
                await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH);
                const scanned = await pollSnapshot('entry-scanned', snapshot => {
                    const entry = snapshot.renderedUi?.entry;
                    return !!entry?.open && entry.rows > 0 && entry.scanned === entry.rows;
                }, COMMAND_TIMEOUT_MS);
                assert.ok(scanned.renderedUi?.entry?.rows, `entry table did not scan: ${JSON.stringify(scanned.renderedUi?.entry)}`);
                // The first row into slot 1, then the comparison.
                await postActionsAndWait(`hpss-open-${Date.now()}`, [
                    { action: 'press-key', payload: { key: '1' } },
                    { action: 'press-key', payload: { key: 'Enter' } },
                ]);
                const click = (selector: string) => ({ action: 'mouse-event', payload: { type: 'click', selector } });
                /** Presses a chip and waits for the comparison to draw that step's Frame for the compared file. */
                const showStep = async (id: string): Promise<NonNullable<TestSnapshot['renderedUi']>['comparison']> => {
                    await postActionsAndWait(`hpss-show-${id}-${Date.now()}`, [click(`.track-stage-bar [data-step-hold="${id}"]`)]);
                    const shown = await pollSnapshot(`hpss-shown-${id}`, snapshot => {
                        const comparison = snapshot.renderedUi?.comparison;
                        return comparison?.stage === id && comparison.frame !== null && comparison.stageValues > 0;
                    }, COMMAND_TIMEOUT_MS);
                    return shown.renderedUi?.comparison;
                };
                // ＋ on the link after the region adds each HPSS step there (node-3, then node-4 between the region and it).
                for (const operation of ['wandas.audio.hpss_harmonic', 'wandas.audio.hpss_percussive']) {
                    await postActionsAndWait(`hpss-add-${operation}-${Date.now()}`, [
                        click('.track-stage-bar [data-action="step-expand"]'),
                        click('.track-stage-bar [data-action="step-insert"][data-after="node-1"]'),
                        click(`.track-stage-bar .step-menu-item[data-op="${operation}"]`),
                        click('.track-stage-bar [data-action="step-expand"]'),
                    ]);
                }
                const region = await showStep('node-1');
                const harmonic = await showStep('node-3');
                const percussive = await showStep('node-4');
                for (const [name, comparison] of [['harmonic', harmonic], ['percussive', percussive]] as const) {
                    assert.equal(comparison?.invalidSteps, 0, `${name}: a step failed: ${JSON.stringify(comparison)}`);
                    assert.equal(comparison?.frame, 'ChannelFrame');
                    assert.equal(comparison?.kind, 'line');
                    // A part of the signal: it has a level, and no more than the whole signal's.
                    assert.ok(comparison!.stageMedian! > -200, `${name} is silent: ${JSON.stringify(comparison)}`);
                    assert.ok(comparison!.stageMedian! <= region!.stageMedian! + 1, `${name} ${comparison!.stageMedian} dB is louder than the signal ${region!.stageMedian} dB`);
                }
                invalidateFixtureCache();
            },
        },
        {
            name: 'a cepstrum and a cepstrogram added from the comparison are drawn as their plot() draws them',
            run: async () => {
                invalidateFixtureCache();
                await analyzeDebugPath(MULTI_TRACK_DEBUG_AUDIO_PATH);
                await pollSnapshot('entry-scanned', snapshot => {
                    const entry = snapshot.renderedUi?.entry;
                    return !!entry?.open && entry.rows > 0 && entry.scanned === entry.rows;
                }, COMMAND_TIMEOUT_MS);
                await postActionsAndWait(`cepstrum-open-${Date.now()}`, [
                    { action: 'press-key', payload: { key: '1' } },
                    { action: 'press-key', payload: { key: 'Enter' } },
                ]);
                const click = (selector: string) => ({ action: 'mouse-event', payload: { type: 'click', selector } });
                /** Waits for the comparison to draw the chain's end, a Frame of `frame`, for the compared file. */
                const drawn = async (frame: string): Promise<NonNullable<TestSnapshot['renderedUi']>['comparison']> => {
                    const shown = await pollSnapshot(`cepstrum-shown-${frame}`, snapshot => {
                        const comparison = snapshot.renderedUi?.comparison;
                        return comparison?.frame === frame && comparison.stageValues > 0;
                    }, COMMAND_TIMEOUT_MS);
                    return shown.renderedUi?.comparison;
                };
                const remove = (id: string) => postActionsAndWait(`cepstrum-remove-${id}-${Date.now()}`, [
                    click(`.track-stage-bar [data-action="step-settings"][data-step="${id}"]`),
                    click(`.track-stage-bar [data-action="step-remove"][data-step="${id}"]`),
                ]);
                const add = (operation: string) => postActionsAndWait(`cepstrum-add-${operation}-${Date.now()}`, [
                    click('.track-stage-bar [data-action="step-add"]'),
                    click(`.track-stage-bar .step-menu-item[data-op="${operation}"]`),
                ]);
                // The chain ends at the region (a time signal) without the average spectrum; a cepstrum follows it.
                await postActionsAndWait(`cepstrum-expand-${Date.now()}`, [click('.track-stage-bar [data-action="step-expand"]')]);
                await remove('node-2');
                await add('wandas.audio.cepstrum');
                const cepstrum = await drawn('CepstralFrame');
                assert.equal(cepstrum?.invalidSteps, 0, `a step failed: ${JSON.stringify(cepstrum)}`);
                assert.equal(cepstrum?.kind, 'line', JSON.stringify(cepstrum));
                // An STFT's cepstrum is a cepstrogram, an image over time and quefrency.
                await remove(cepstrum!.stage!);
                await add('wandas.audio.stft');
                await drawn('SpectrogramFrame');
                await add('wandas.spectrogram.cepstrum');
                const cepstrogram = await drawn('CepstrogramFrame');
                assert.equal(cepstrogram?.invalidSteps, 0, `a step failed: ${JSON.stringify(cepstrogram)}`);
                assert.equal(cepstrogram?.kind, 'heatmap');
                invalidateFixtureCache();
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
            run: async () => {
                const spectrumSnapshot = await waitForSnapshotWhere((snapshot) => {
                    const ui = snapshot.renderedUi;
                    return !!ui
                        && ui.spectrumOverlayPresent === true
                        && ui.spectrumTrackCanvasCount === ui.trackRowCount
                        && ui.visibleSpectrumTrackCount >= 1
                        && ui.tracks.every((track) => track.spectrumCanvasPresent === true);
                });
                const ui = spectrumSnapshot.renderedUi;
                assert.ok(ui, 'Rendered UI snapshot should exist');
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
            run: async () => {
                await runViewModeScenario(['content-spectrogram']);
                const axisSnapshot = await waitForSnapshotWhere((snapshot) => {
                    const axes = snapshot.renderedUi?.axisLabels;
                    if (!axes) { return false; }
                    const wf = axes.waveformPerTrack[0] ?? [];
                    const sg = axes.spectrogramPerTrack[0] ?? [];
                    const sp = axes.spectrumPerTrack[0] ?? [];
                    const overlay = axes.spectrumOverlay;
                    return wf.some((s) => /^\+/.test(s))
                        && wf.some((s) => /^-/.test(s))
                        && wf.includes('0')
                        && wf.some((s) => s.includes('Amp'))
                        && sg.includes('0 Hz')
                        && sg.some((s) => /Hz$/.test(s) && s !== '0 Hz')
                        && sg.some((s) => s.includes('dB'))
                        && sp.includes('0 Hz')
                        && sp.some((s) => s.includes('dB'))
                        && overlay.includes('0 Hz')
                        && overlay.some((s) => s.includes('dB'));
                });
                assert.ok(axisSnapshot.renderedUi, 'Rendered UI snapshot should exist');
                const axes = axisSnapshot.renderedUi.axisLabels;
                assert.ok(axes, 'axisLabels must be present in snapshot');

                const wf = axes.waveformPerTrack[0] ?? [];
                assert.ok(wf.some((s) => /^\+/.test(s)) && wf.some((s) => /^-/.test(s)) && wf.includes('0'),
                    `waveform axis labels missing: ${JSON.stringify(wf)}`);
                assert.ok(wf.some((s) => s.includes('Amp')),
                    `waveform axis title (Amp) missing: ${JSON.stringify(wf)}`);

                const sg = axes.spectrogramPerTrack[0] ?? [];
                assert.ok(sg.includes('0 Hz'),
                    `spectrogram should include "0 Hz": ${JSON.stringify(sg)}`);
                assert.ok(sg.some((s) => /Hz$/.test(s) && s !== '0 Hz'),
                    `spectrogram should include a non-zero frequency label: ${JSON.stringify(sg)}`);
                assert.ok(sg.some((s) => s.includes('dB')),
                    `spectrogram colorbar dB label missing: ${JSON.stringify(sg)}`);

                const sp = axes.spectrumPerTrack[0] ?? [];
                assert.ok(sp.includes('0 Hz'),
                    `per-track spectrum should include "0 Hz": ${JSON.stringify(sp)}`);
                assert.ok(sp.some((s) => s.includes('dB')),
                    `per-track spectrum dB label missing: ${JSON.stringify(sp)}`);

                const overlay = axes.spectrumOverlay;
                assert.ok(overlay.includes('0 Hz'),
                    `overlay spectrum should include "0 Hz": ${JSON.stringify(overlay)}`);
                assert.ok(overlay.some((s) => s.includes('dB')),
                    `overlay spectrum dB label missing: ${JSON.stringify(overlay)}`);
            },
        },
        {
            name: 'short WAV cursor and loop export writes exact selected PCM to a temporary folder',
            requires: 'single-track',
            run: async () => {
                const outputFolder = mkdtempSync(path.join(os.tmpdir(), 'awa-vscode-export-'));
                const originalExport = ExportFlows.prototype.wavExport;
                let finished = false;
                const errors: string[] = [];
                ExportFlows.prototype.wavExport = async function (message) {
                    const instance = this as unknown as { host: ExportHost };
                    const originalHost = instance.host;
                    instance.host = {
                        ...originalHost,
                        pickOutputFolder: async () => vscode.Uri.file(outputFolder),
                        showInformation: () => undefined,
                        showError: (message) => { errors.push(message); },
                    };
                    const finish = (): void => { instance.host = originalHost; finished = true; };
                    let plan;
                    try {
                        plan = await originalExport.call(this, message);
                    } catch (error) {
                        errors.push(String(error));
                        finish();
                        throw error;
                    }
                    if (!plan) { finish(); return plan; }
                    return { ...plan, complete: async () => { try { await plan.complete?.(); } finally { finish(); } } };
                };
                try {
                    invalidateFixtureCache();
                    const snapshot = await analyzeDebugPath('src/test/fixtures/short-stereo.wav');
                    assert.deepEqual(snapshot.fileNames, ['short-stereo.wav']);
                    const cursor = await postActionsAndWait(`loop-cursor-${Date.now()}`, [
                        'content-spectrogram',
                        { action: 'set-cursor', payload: { cursorNorm: 0.437 } },
                    ]);
                    assert.equal(cursor.renderedUi?.contentType, 'spectrogram');
                    assert.equal(cursor.renderedUi?.cursorNorm, 0.437);
                    await postActionsAndWait(`loop-export-${Date.now()}`, [
                        { action: 'set-loop-region', payload: { start: 0.25, end: 0.75 } },
                        'export-wav',
                    ]);
                    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
                    while (!finished && Date.now() < deadline) { await delay(100); }
                    assert.equal(finished, true, 'VS Code export did not finish');
                    assert.deepEqual(errors, []);
                    const outputFile = path.join(outputFolder, 'short-stereo_loop.wav');
                    execFileSync(pythonCommand, ['-c', [
                        'import sys, soundfile as sf, numpy as np',
                        'source, rate = sf.read(sys.argv[1], always_2d=True)',
                        'output, output_rate = sf.read(sys.argv[2], always_2d=True)',
                        'assert output_rate == rate == 8000',
                        'assert output.shape == (4000, 2)',
                        'assert sf.info(sys.argv[2]).subtype == "PCM_16"',
                        'assert np.array_equal(output, source[2000:6000])',
                    ].join('\n'), path.join(workspaceFolder.uri.fsPath, 'src/test/fixtures/short-stereo.wav'), outputFile]);
                } finally {
                    ExportFlows.prototype.wavExport = originalExport;
                    invalidateFixtureCache();
                    rmSync(outputFolder, { recursive: true, force: true });
                }
            },
        },
        {
            name: 'hovering a toolbar button shows its hint in the footer',
            run: async () => {
                await analyzeSingleTrackInWaveformMode();
                const hovered = await postActionsAndWait(`hint-hover-${Date.now()}`, [
                    { action: 'mouse-event', payload: { selector: '#toolbar [data-action="zoom-in"]', type: 'mouseover' } },
                ], (snapshot) => !!snapshot.renderedUi?.hintFooterText);
                assert.equal(hovered.renderedUi?.hintFooterText, 'Zoom in in time (key: +)');
                const left = await postActionsAndWait(`hint-leave-${Date.now()}`, [
                    { action: 'mouse-event', payload: { selector: '#toolbar [data-action="zoom-in"]', type: 'mouseout' } },
                ], (snapshot) => snapshot.renderedUi?.hintFooterText === '');
                assert.equal(left.renderedUi?.hintFooterText, '');
            },
        },
        {
            name: 'power spectrum is docked between the tracks and the hint footer',
            run: async () => {
                const snapshot = await analyzeSingleTrackInWaveformMode();
                const layout = snapshot.renderedUi?.layout;
                assert.ok(layout?.tracksWrapper && layout.spectrumSection && layout.hintFooter, `layout boxes missing: ${JSON.stringify(layout)}`);
                const diag = JSON.stringify(layout);
                assert.ok(layout.tracksWrapper.bottom <= layout.spectrumSection.top + 1, `tracks overlap the spectrum: ${diag}`);
                assert.equal(Math.round(layout.spectrumSection.bottom), Math.round(layout.hintFooter.top), `spectrum is not docked on the footer: ${diag}`);
                assert.ok(Math.abs(layout.hintFooter.bottom - layout.viewportHeight) <= 1, `footer is not at the bottom: ${diag}`);
            },
        },
        {
            name: 'double-clicking the waveform amplitude axis sets the vertical range',
            run: async () => {
                await analyzeSingleTrackInWaveformMode();
                const opened = await postActionsAndWait(`wave-range-open-${Date.now()}`, [
                    { action: 'mouse-event', payload: { selector: '.track-axis-canvas', type: 'dblclick' } },
                ], (snapshot) => snapshot.renderedUi?.waveformRangePopover?.open === true);
                const peak = Number(opened.renderedUi?.waveformRangePopover?.max);
                assert.ok(peak > 0, `popover should start at the painted peak: ${JSON.stringify(opened.renderedUi?.waveformRangePopover)}`);
                const applied = await postActionsAndWait(`wave-range-apply-${Date.now()}`, [
                    { action: 'set-input-value', payload: { selector: '#wave-range-min', value: String(-peak / 2) } },
                    { action: 'set-input-value', payload: { selector: '#wave-range-max', value: String(peak / 2) } },
                    { action: 'mouse-event', payload: { selector: '#wave-range-apply', type: 'click' } },
                ], (snapshot) => snapshot.renderedUi?.waveformRangePopover?.open === false);
                const maxNorm = applied.renderedUi?.amplitudeZoomMaxNorm ?? NaN;
                const minNorm = applied.renderedUi?.amplitudeZoomMinNorm ?? NaN;
                assert.ok(maxNorm > 0 && maxNorm < 1 && Math.abs(maxNorm + minNorm) < 1e-9, `applied range should narrow symmetrically: ${minNorm}..${maxNorm}`);
                const reopened = await postActionsAndWait(`wave-range-reopen-${Date.now()}`, [
                    { action: 'mouse-event', payload: { selector: '.track-axis-canvas', type: 'dblclick' } },
                ], (snapshot) => snapshot.renderedUi?.waveformRangePopover?.open === true);
                const shownMax = Number(reopened.renderedUi?.waveformRangePopover?.max);
                assert.ok(Math.abs(shownMax - peak / 2) <= peak * 1e-3, `reopened popover should show the applied max ${peak / 2}, got ${shownMax}`);
                const restored = await postActionsAndWait(`wave-range-auto-${Date.now()}`, [
                    { action: 'mouse-event', payload: { selector: '#wave-range-auto', type: 'click' } },
                ], (snapshot) => snapshot.renderedUi?.amplitudeZoomMaxNorm === 1);
                assert.equal(restored.renderedUi?.amplitudeZoomMinNorm, -1);
            },
        },
        {
            name: 'Space plays the track through Web Audio and pauses it',
            run: async () => {
                if (!canSendXInput() && !process.env.CI) {
                    console.log('xdotool or DISPLAY unavailable; playback is only checked under xvfb (CI)');
                    return;
                }
                await analyzeSingleTrackInWaveformMode();
                await postActionsAndWait(`play-${Date.now()}`, [{ action: 'set-cursor', payload: { cursorNorm: 0 } }]);
                await pressSpaceInPanel();
                const playing = await pollSnapshot('playing', (snapshot) => {
                    const audio = snapshot.renderedUi?.audio[0];
                    return !!audio && !audio.paused && audio.currentTime > 0.3;
                });
                const audio = playing.renderedUi?.audio[0];
                const diag = JSON.stringify({ audio, context: playing.renderedUi?.audioContextState, playRejection: playing.renderedUi?.lastPlayRejection });
                assert.equal(audio?.errorCode, null, `audio failed to load: ${diag}`);
                assert.equal(audio?.crossOrigin, 'anonymous', diag);
                assert.ok(audio && !audio.paused && audio.currentTime > 0.3, `playback did not advance: ${diag}`);
                assert.equal(playing.renderedUi?.audioContextState, 'running', `Web Audio is not running: ${diag}`);
                await pressSpaceInPanel();
                const paused = await pollSnapshot('paused', (snapshot) => snapshot.renderedUi?.audio[0]?.paused === true);
                assert.equal(paused.renderedUi?.audio[0]?.paused, true, `pause did not stop playback: ${JSON.stringify(paused.renderedUi?.audio)}`);
                invalidateFixtureCache();
            },
        },
    ];
    let passedCount = 0;

    assertNoWorkspaceOverrides(config);
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

/**
 * The checks set the files to open and the interpreter as user settings; a workspace or folder setting of
 * the same name (e.g. a local .vscode/settings.json) would win over them, and every check would then wait
 * for a panel that opens something else. Say so at once instead.
 */
function assertNoWorkspaceOverrides(config: vscode.WorkspaceConfiguration): void {
    const overridden = ['debugFilePath', 'pythonCommand'].flatMap(key => {
        const values = config.inspect(key);
        const value = values?.workspaceFolderValue ?? values?.workspaceValue;
        return value === undefined ? [] : [`audioWandasAnalyzer.${key} = ${JSON.stringify(value)}`];
    });
    assert.deepEqual(overridden, [],
        `The workspace's settings override what the E2E checks set: ${overridden.join(', ')}. `
        + 'Remove them from .vscode/settings.json (or the workspace file) and run again.');
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
        await waitForSnapshotWhere(snapshot => snapshot.resultCount === 0
            && snapshot.renderedUi?.trackRowCount === 0);
        const actionId = `selection-select-all-${Date.now()}`;
        return postActionsAndWait(actionId, [{ action: 'set-all-files-selected', payload: { selected: true } }], (snapshot) => {
            return snapshot.resultCount > 0
                && !!snapshot.renderedUi
                && snapshot.renderedUi.trackRowCount > 0;
        });
    }

    return waitForSnapshot();
}

async function analyzeSingleTrackInWaveformMode(): Promise<TestSnapshot> {
    invalidateFixtureCache();
    await analyzeDebugPath(SINGLE_TRACK_DEBUG_AUDIO_PATH);
    return postActionsAndWait(`waveform-mode-${Date.now()}`, ['content-waveform'], (snapshot) => {
        return snapshot.renderedUi?.contentType === 'waveform' && snapshot.renderedUi.trackRowCount === 1;
    });
}

/**
 * Playback state changes without a render, so ask for fresh snapshots until the predicate holds,
 * then return the last one for the caller to assert on with its own diagnostics.
 */
async function pollSnapshot(label: string, predicate: (snapshot: TestSnapshot) => boolean, timeoutMs = 10000): Promise<TestSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let latest: TestSnapshot;
    let attempt = 0;
    do {
        latest = await postActionsAndWait(`${label}-poll-${Date.now()}-${attempt++}`, []);
        if (predicate(latest)) {
            return latest;
        }
        await delay(250);
    } while (Date.now() < deadline);
    return latest;
}

/**
 * The webview only lets a trusted input start playback, so the key goes through X (xdotool) rather than a test action.
 * Without a window manager, windowfocus is what routes the key to VS Code.
 */
async function pressSpaceInPanel(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await delay(200);
    execFileSync('xdotool', ['search', '--onlyvisible', '--class', 'code', 'windowfocus', '--sync', 'key', 'space']);
}

function canSendXInput(): boolean {
    try {
        execFileSync('xdotool', ['version'], { stdio: 'ignore' });
        return !!process.env.DISPLAY;
    } catch {
        return false;
    }
}

async function runZoomRecoveryScenario(): Promise<TestSnapshot> {
    const actionId = `zoom-recovery-${Date.now()}`;
    await ComparisonPanel.postTestActions(actionId, [
        'zoom-in',
        'zoom-in',
        'zoom-out',
        'zoom-out',
    ]);
    await delay(250);
    return waitForSnapshotWhere((snapshot) => {
        const track = snapshot.renderedUi?.tracks[0];
        return !!snapshot.renderedUi
            && snapshot.renderedUi.zoomStart === 0
            && snapshot.renderedUi.zoomEnd === 1
            && !!track
            && track.visibleFileStartNorm === 0
            && track.visibleFileEndNorm === 1
            && track.waveformFullyVisible === true;
    });
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
    await delay(250);
    return waitForSnapshotWhere((snapshot) => {
        const track = snapshot.renderedUi?.tracks[0];
        return !!snapshot.renderedUi
            && snapshot.renderedUi.zoomStart > 0
            && snapshot.renderedUi.zoomEnd < 1
            && !!track
            && track.visibleFileStartNorm > 0
            && track.visibleFileEndNorm < 1
            && track.waveformCoversViewportLeft === true
            && track.waveformCoversViewportRight === true;
    });
}

async function runViewModeScenario(actions: string[]): Promise<TestSnapshot> {
    const actionId = `view-mode-${Date.now()}-${actions.join('-')}`;
    if (actions.includes('content-spectrogram')) {
        return postActionsAndWait(actionId, actions, (snapshot) => snapshot.renderedUi?.contentType === 'spectrogram');
    }
    return postActionsAndWait(actionId, actions);
}

async function runMultiTrackOffsetScenario(): Promise<TestSnapshot> {
    const actionId = `offset-range-${Date.now()}`;
    await ComparisonPanel.postTestActions(actionId, [
        { action: 'offset-up', trackIndex: 1 },
        { action: 'offset-up', trackIndex: 1 },
    ]);
    return waitForSnapshot(actionId);
}

type TestAction = string | { action: string; trackId?: string; trackIndex?: number; payload?: Record<string, unknown> };

async function postActionsAndWait(
    actionId: string,
    actions: TestAction[],
    predicate?: (snapshot: TestSnapshot) => boolean,
): Promise<TestSnapshot> {
    await ComparisonPanel.postTestActions(actionId, actions);
    const acknowledged = await waitForSnapshot(actionId);
    if (!predicate) {
        return acknowledged;
    }
    if (predicate(acknowledged)) {
        return acknowledged;
    }
    return waitForSnapshotWhere((snapshot) => {
        return !!snapshot.renderedUi && predicate(snapshot);
    }, actionId);
}

async function waitForSnapshot(expectedActionId?: string): Promise<TestSnapshot> {
    if (!expectedActionId) {
        return waitForSnapshotWhere((snapshot) => !!snapshot.renderedUi);
    }

    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const snapshot: TestSnapshot | undefined = ComparisonPanel.getTestSnapshotForAction(expectedActionId)
            ?? ComparisonPanel.getTestSnapshot();
        if (snapshot && snapshot.renderedUi && snapshot.lastActionId === expectedActionId) {
            return snapshot;
        }
        await delay(250);
    }
    throwSnapshotTimeout(expectedActionId);
}

async function waitForSnapshotWhere(
    predicate: (snapshot: TestSnapshot) => boolean,
    expectedActionId?: string,
): Promise<TestSnapshot> {
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const snapshot = ComparisonPanel.getTestSnapshot();
        if (snapshot && predicate(snapshot)) {
            return snapshot;
        }
        await delay(250);
    }

    throwSnapshotTimeout(expectedActionId);
}

function throwSnapshotTimeout(expectedActionId?: string): never {
    const snapshot: TestSnapshot | undefined = expectedActionId
        ? ComparisonPanel.getTestSnapshotForAction(expectedActionId) ?? ComparisonPanel.getTestSnapshot()
        : ComparisonPanel.getTestSnapshot();
    const latest = snapshot?.renderedUi?.latestSpectrogram;
    throw new Error(
        `ComparisonPanel snapshot was not captured within ${COMMAND_TIMEOUT_MS}ms; `
        + `title=${snapshot?.title ?? 'none'} resultCount=${snapshot?.resultCount ?? 'none'} `
        + `expectedActionId=${expectedActionId ?? 'none'} `
        + `lastActionId=${snapshot?.lastActionId ?? 'none'} `
        + `contentType=${snapshot?.renderedUi?.contentType ?? 'none'} `
        + `reanalyzeBusy=${snapshot?.renderedUi?.reanalyzeBusy ?? 'none'} `
        + `trackRowCount=${snapshot?.renderedUi?.trackRowCount ?? 'none'} `
        + `latestSpectrogram=${JSON.stringify(latest ?? null)}`
    );
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
