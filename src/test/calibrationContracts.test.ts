import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { getCalibrationRenderScript } from '../webview/calibrationRenderScript';

test('configure-calibration message guard accepts exact channel metadata', () => {
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 2,
        filePath: '/tmp/audio.wav',
        channels: [
            { channelIndex: 0, label: 'microphone' },
            { channelIndex: 1, label: 'accelerometer' },
        ],
    }), true);
});

test('configure-calibration message guard rejects malformed payloads', () => {
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '',
        channels: [],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/tmp/audio.wav',
        channels: [],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0.5,
        filePath: '/tmp/audio.wav',
        channels: [{ channelIndex: 0, label: 'microphone' }],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/tmp/audio.wav',
        channels: [{ channelIndex: -1, label: 'microphone' }],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/tmp/audio.wav',
        channels: [{ channelIndex: 0, label: '   ' }],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/tmp/audio.wav',
        channels: [{ channelIndex: '0', label: 'microphone' }],
    }), false);
});

test('calibration webview runtime exposes the GUI and calibrated evidence output', () => {
    const script = getCalibrationRenderScript();

    assert.match(script, /data-action="configure-calibration"/);
    assert.match(script, /peakLevelDb/);
    assert.doesNotMatch(script, /rmsLevelDb/);
    assert.match(script, /rawPeakFullScale/);
    assert.match(script, /levelReferenceLabel/);
    assert.match(script, /Spectrum overlay is unavailable/);
    assert.doesNotMatch(script, /calibration-reload/);
    assert.doesNotMatch(script, /stopImmediatePropagation/);
    assert.match(script, /__AWA_ACTIVE_TRACKS__/);
    assert.doesNotMatch(script, /request-calibration-refresh/);
});

test('production calibration wrapper forwards analysis cancellation and exposes per-file revisions', () => {
    const source = readFileSync(
        path.resolve(process.cwd(), 'src/extension/calibrationPanelRuntime.ts'),
        'utf8',
    );

    assert.match(source, /prototype\.analysisRevisionFor = function\(filePath\)/u);
    assert.match(source, /prototype\.analyze = async function\(filePath, options, cancellation\)/u);
    assert.equal(source.match(/\}, cancellation\);/gu)?.length, 2);
});

test('ComparisonPanel result ownership follows accepted in-place reanalysis', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') { return {}; }
        return originalLoad.call(this, request, parent, isMain);
    };

    let ComparisonPanel: typeof import('../webview/panels/ComparisonPanel').ComparisonPanel;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ComparisonPanel = require('../webview/panels/ComparisonPanel').ComparisonPanel;
    } finally {
        NodeModule._load = originalLoad;
    }

    const panel = {};
    const original = {
        filePath: '/tmp/replaced.wav',
        fileName: 'replaced.wav',
        sampleRateHz: 8_000,
        durationSeconds: 1,
        channelCount: 1,
        sampleCount: 8_000,
        analysisRevision: 0,
        channels: [],
    };
    const updated = { ...original, channelCount: 2, analysisRevision: 1 };

    ComparisonPanel.updateResults(panel, [original]);
    ComparisonPanel.updateResults(panel, [updated]);

    assert.equal(ComparisonPanel.getResults(panel)[0], updated);

    const retained = { ...updated, filePath: '/tmp/retained.wav', fileName: 'retained.wav' };
    ComparisonPanel.updateResults(panel, [updated, retained]);
    const replacement = { ...updated, analysisRevision: 2 };
    assert.deepEqual(ComparisonPanel.replaceResult(panel, replacement), [replacement, retained]);
    assert.deepEqual(ComparisonPanel.getResults(panel), [replacement, retained]);
});

test('calibration inputs reject values that can overflow or underflow analysis', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') { return {}; }
        return originalLoad.call(this, request, parent, isMain);
    };

    let calibrationStore: typeof import('../extension/calibrationStore');
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        calibrationStore = require('../extension/calibrationStore');
    } finally {
        NodeModule._load = originalLoad;
    }

    const { validateCalibrationFactorInput, validateCalibrationValueInput } = calibrationStore;
    assert.equal(validateCalibrationValueInput('1e-150'), undefined);
    assert.equal(validateCalibrationValueInput('1e150'), undefined);
    assert.match(validateCalibrationValueInput('1e-151') ?? '', /1e-150/);
    assert.match(validateCalibrationValueInput('1e151') ?? '', /1e150/);
    assert.equal(validateCalibrationFactorInput('1e24', 1e10), undefined);
    assert.match(validateCalibrationFactorInput('1.1e24', 1e10) ?? '', /source peak/);
});

test('calibration profile writes serialize read-modify-write updates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const calibrationStore = require('../extension/calibrationStore') as typeof import('../extension/calibrationStore');
    const storageKey = 'audioWandasAnalyzer.calibrationProfiles.v1';
    const firstPath = path.resolve('/tmp/concurrent-a.wav');
    const secondPath = path.resolve('/tmp/concurrent-b.wav');
    const profile = (label: string) => ({
        schemaVersion: 1 as const,
        channels: [{
            channelIndex: 0,
            expectedLabel: label,
            status: 'calibrated' as const,
            source: 'manual' as const,
            factor: 2,
            unit: 'Pa',
            referenceValue: 2e-5,
        }],
    });
    const firstProfile = profile('a');
    const secondProfile = profile('b');
    const stored: Record<string, unknown> = {
        [storageKey]: {
            [firstPath]: firstProfile,
            [secondPath]: secondProfile,
        },
    };
    let releaseFirst: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let updateCalls = 0;
    const context = {
        workspaceState: {
            get: <T>(key: string, fallback: T): T => (stored[key] as T | undefined) ?? fallback,
            update: async (key: string, value: unknown): Promise<void> => {
                updateCalls += 1;
                if (updateCalls === 1) {
                    await firstWriteGate;
                }
                stored[key] = value;
            },
        },
    } as unknown as import('vscode').ExtensionContext;

    const first = calibrationStore.discardStaleCalibrationProfile(
        context,
        firstPath,
        new Error('Calibration channel label mismatch'),
        firstProfile,
    );
    const second = calibrationStore.discardStaleCalibrationProfile(
        context,
        secondPath,
        new Error('Calibration channel label mismatch'),
        secondProfile,
    );
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(updateCalls, 1);
    releaseFirst?.();
    await Promise.all([first, second]);

    assert.equal(updateCalls, 2);
    assert.deepEqual(stored[storageKey], {});
});

test('stale persisted calibration is discarded and advances the analysis revision', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') { return {}; }
        return originalLoad.call(this, request, parent, isMain);
    };

    let calibrationStore: typeof import('../extension/calibrationStore');
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        calibrationStore = require('../extension/calibrationStore');
    } finally {
        NodeModule._load = originalLoad;
    }

    const filePath = '/tmp/replaced.wav';
    const storageKey = 'audioWandasAnalyzer.calibrationProfiles.v1';
    const profile = {
        schemaVersion: 1 as const,
        channels: [{
            channelIndex: 0,
            expectedLabel: 'old-channel',
            status: 'calibrated' as const,
            source: 'manual' as const,
            factor: 2,
            unit: 'Pa',
            referenceValue: 2e-5,
        }],
    };
    const stored: Record<string, unknown> = {
        [storageKey]: {
            [path.resolve(filePath)]: profile,
        },
    };
    const context = {
        workspaceState: {
            get: <T>(key: string, fallback: T): T => (stored[key] as T | undefined) ?? fallback,
            update: async (key: string, value: unknown): Promise<void> => { stored[key] = value; },
        },
    } as unknown as import('vscode').ExtensionContext;

    assert.equal(await calibrationStore.discardStaleCalibrationProfile(
        context,
        filePath,
        new Error('Calibration channel label mismatch'),
        profile,
    ), true);
    assert.equal(calibrationStore.getCalibrationProfile(context, filePath), undefined);
    assert.equal(calibrationStore.getAnalysisRevision(filePath), 1);
    stored[storageKey] = { [path.resolve(filePath)]: profile };
    assert.equal(await calibrationStore.discardStaleCalibrationProfile(
        context,
        filePath,
        new Error('Calibration factor for channel 0 exceeds the safe limit 1e+24 for source peak 1e+10'),
        profile,
    ), true);
    const replacementProfile = {
        ...profile,
        channels: [{ ...profile.channels[0], factor: 3 }],
    };
    stored[storageKey] = { [path.resolve(filePath)]: replacementProfile };
    assert.equal(await calibrationStore.discardStaleCalibrationProfile(
        context,
        filePath,
        new Error('Calibration factor for channel 0 exceeds the safe limit 1e+24 for source peak 1e+10'),
        profile,
    ), false);
    assert.deepEqual(calibrationStore.getCalibrationProfile(context, filePath), replacementProfile);
    assert.equal(await calibrationStore.discardStaleCalibrationProfile(
        context,
        filePath,
        new Error('unrelated backend failure'),
        replacementProfile,
    ), false);
    assert.deepEqual(calibrationStore.getCalibrationProfile(context, filePath), replacementProfile);
});

test('calibration profile lookup uses the same real filesystem path as the backend', (context) => {
    if (process.platform === 'win32') {
        context.skip('Symlink creation requires elevated privileges on Windows.');
        return;
    }
    const directory = mkdtempSync(path.join(os.tmpdir(), 'awa-calibration-'));
    context.after(() => { rmSync(directory, { recursive: true, force: true }); });
    const targetPath = path.join(directory, 'target.wav');
    const symlinkPath = path.join(directory, 'alias.wav');
    writeFileSync(targetPath, 'fixture');
    symlinkSync(targetPath, symlinkPath);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const calibrationStore = require('../extension/calibrationStore') as typeof import('../extension/calibrationStore');
    const profile = {
        schemaVersion: 1 as const,
        channels: [{
            channelIndex: 0,
            expectedLabel: 'input',
            status: 'calibrated' as const,
            source: 'manual' as const,
            factor: 2,
            unit: 'Pa',
            referenceValue: 2e-5,
        }],
    };
    const storageKey = 'audioWandasAnalyzer.calibrationProfiles.v1';
    const extensionContext = {
        workspaceState: {
            get: <T>(_key: string, _fallback: T): T => ({
                [realpathSync.native(targetPath)]: profile,
            } as T),
        },
    } as unknown as import('vscode').ExtensionContext;

    assert.deepEqual(calibrationStore.getCalibrationProfile(extensionContext, symlinkPath), profile);
});
