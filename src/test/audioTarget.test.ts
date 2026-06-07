import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAnalyzeSelectedFilesMessage,
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
        channelIndex: 1,
    }), true);
    assert.equal(isRequestSpectrumSliceMessage({
        type: 'request-spectrum-slice',
        requestId: 'slice-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        cursorNorm: '0.25',
        channelIndex: 1,
    }), false);
    assert.equal(isRequestSpectrumSliceMessage({
        type: 'request-spectrum-slice',
        requestId: 'slice-1',
        analysisId: 'analysis-1',
        settingsSignature: 'settings-1',
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        cursorNorm: 0.25,
        channelIndex: '1',
    }), false);
});
