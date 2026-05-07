import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAnalyzeFileMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
} from '../utils/audioTarget';

test('isSupportedAudioFile accepts supported extensions case-insensitively', () => {
    assert.equal(isSupportedAudioFile('mixdown.WAV'), true);
    assert.equal(isSupportedAudioFile('archive.take.FlAc'), true);
    assert.equal(isSupportedAudioFile('notes.txt'), false);
    assert.equal(isSupportedAudioFile('no-extension'), false);
});

test('isAnalyzeFileMessage validates required shape', () => {
    assert.equal(isAnalyzeFileMessage({ type: 'analyze-file', filePath: '/tmp/take.wav' }), true);
    assert.equal(isAnalyzeFileMessage({ type: 'analyze-file', filePath: '' }), false);
    assert.equal(isAnalyzeFileMessage({ type: 'analyze-file' }), false);
    assert.equal(isAnalyzeFileMessage({ type: 'select-target', filePath: '/tmp/take.wav' }), false);
    assert.equal(isAnalyzeFileMessage(null), false);
});

test('isSelectTargetMessage only accepts supported target kinds', () => {
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'file' }), true);
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'directory' }), true);
    assert.equal(isSelectTargetMessage({ type: 'select-target', targetKind: 'folder' }), false);
    assert.equal(isSelectTargetMessage({ type: 'analyze-file', targetKind: 'file' }), false);
    assert.equal(isSelectTargetMessage(undefined), false);
});