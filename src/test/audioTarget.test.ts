import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAnalyzeSelectedFilesMessage,
    isExportWavLoopMessage,
    isRequestSpectrumSliceMessage,
    isRequestTrackDetailMessage,
    isSelectPythonEnvironmentMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
} from '../shared/utils/audioTarget';

test('isSupportedAudioFile accepts supported extensions case-insensitively', () => {
    assert.equal(isSupportedAudioFile('mixdown.WAV'), true);
    assert.equal(isSupportedAudioFile('archive.take.FlAc'), true);
    assert.equal(isSupportedAudioFile('notes.txt'), false);
    assert.equal(isSupportedAudioFile('no-extension'), false);
});

test('isSelectTargetMessage only accepts supported target kinds', () => {
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'file' }), true);
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'directory' }), true);
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'folder' }), false);
    assert.equal(isSelectTargetMessage({ type: 'compare-files', targetKind: 'file' }), false);
    assert.equal(isSelectTargetMessage(undefined), false);
});

test('isAnalyzeSelectedFilesMessage only accepts string file path arrays', () => {
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'analyze-selected-files', requestId: 'req-1', filePaths: ['/tmp/a.wav'] }), true);
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'analyze-selected-files', requestId: 'req-2', filePaths: [] }), true);
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'analyze-selected-files', filePaths: ['/tmp/a.wav'] }), false);
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'analyze-selected-files', requestId: 'req-3', filePaths: ['/tmp/a.wav', 42] }), false);
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'select-target', filePaths: ['/tmp/a.wav'] }), false);
    assert.equal(isAnalyzeSelectedFilesMessage(undefined), false);
});

test('isSelectPythonEnvironmentMessage only accepts the dedicated message type', () => {
    assert.equal(isSelectPythonEnvironmentMessage({ type: 'select-python-environment' }), true);
    assert.equal(isSelectPythonEnvironmentMessage({ type: 'select-target', targetKind: 'file' }), false);
    assert.equal(isSelectPythonEnvironmentMessage(undefined), false);
});


test('isRequestTrackDetailMessage accepts lazy spectrogram detail requests', () => {
    assert.equal(isRequestTrackDetailMessage({
        type: 'request-track-detail',
        requestId: 'detail-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
    }), true);
    assert.equal(isRequestTrackDetailMessage({
        type: 'request-track-detail',
        requestId: 'detail-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: '0',
        filePath: '/tmp/a.wav',
    }), false);
});

test('isRequestSpectrumSliceMessage accepts cursor spectrum slice requests', () => {
    assert.equal(isRequestSpectrumSliceMessage({
        type: 'request-spectrum-slice',
        requestId: 'slice-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        cursorNorm: 0.25,
    }), true);
    assert.equal(isRequestSpectrumSliceMessage({
        type: 'request-spectrum-slice',
        requestId: 'slice-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        cursorNorm: '0.25',
    }), false);
    assert.equal(isRequestSpectrumSliceMessage({
        type: 'request-spectrum-slice',
        requestId: 'slice-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        cursorNorm: undefined,
    }), false);
});


test('WAV export accepts bounded per-file timeline regions and preserves legacy requests', () => {
    const message = { type: 'export-wav-loop', filePaths: ['/a.wav'], startNorm: 0.2, endNorm: 0.8 };
    assert.equal(isExportWavLoopMessage(message), true);
    const region = { filePath: '/a.wav', startNorm: 0.4, endNorm: 1 };
    assert.equal(isExportWavLoopMessage({ ...message, fileRegions: [region] }), true);
    for (const invalid of [{ ...region, filePath: '/b.wav' }, { ...region, startNorm: -1 }, { ...region, endNorm: NaN }, { ...region, endNorm: 0.3 }]) {
        assert.equal(isExportWavLoopMessage({ ...message, fileRegions: [invalid] }), false);
    }
});
