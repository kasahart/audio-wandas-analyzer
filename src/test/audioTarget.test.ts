import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isSelectTargetMessage,
    isSupportedAudioFile,
    isCompareFilesMessage,
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

test('isCompareFilesMessage validates required shape', () => {
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav', '/b.wav'] }), true);
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav'] }), false, '1件はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: [] }), false, '0件はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files', filePaths: ['/a.wav', ''] }), false, '空文字はNG');
    assert.equal(isCompareFilesMessage({ type: 'compare-files' }), false, 'filePaths欠如');
    assert.equal(isCompareFilesMessage({ type: 'select-target', filePaths: ['/a.wav', '/b.wav'] }), false, '型違い');
    assert.equal(isCompareFilesMessage(null), false);
});