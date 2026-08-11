import assert from 'node:assert/strict';
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
    assert.match(script, /rmsLevelDb/);
    assert.match(script, /rawPeakFullScale/);
    assert.match(script, /levelReferenceLabel/);
    assert.match(script, /with_calibration/);
    assert.match(script, /Spectrum overlay is unavailable/);
    assert.doesNotMatch(script, /calibration-reload/);
    assert.match(script, /__AWA_ACTIVE_TRACKS__/);
});

test('mismatched persisted calibration is discarded and advances the analysis revision', async () => {
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
    const stored: Record<string, unknown> = {
        [storageKey]: {
            [path.resolve(filePath)]: {
                schemaVersion: 1,
                channels: [{
                    channelIndex: 0,
                    expectedLabel: 'old-channel',
                    status: 'calibrated',
                    source: 'manual',
                    factor: 2,
                    unit: 'Pa',
                    referenceValue: 2e-5,
                }],
            },
        },
    };
    const context = {
        workspaceState: {
            get: <T>(key: string, fallback: T): T => (stored[key] as T | undefined) ?? fallback,
            update: async (key: string, value: unknown): Promise<void> => { stored[key] = value; },
        },
    } as unknown as import('vscode').ExtensionContext;

    assert.equal(await calibrationStore.discardMismatchedCalibrationProfile(
        context,
        filePath,
        new Error('Calibration channel label mismatch'),
    ), true);
    assert.equal(calibrationStore.getCalibrationProfile(context, filePath), undefined);
    assert.equal(calibrationStore.getAnalysisRevision(filePath), 1);
    assert.equal(await calibrationStore.discardMismatchedCalibrationProfile(
        context,
        filePath,
        new Error('unrelated backend failure'),
    ), false);
});
