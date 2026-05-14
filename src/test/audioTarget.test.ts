import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAnalyzeSelectedFilesMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
} from '../utils/audioTarget';

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