import test from 'node:test';
import assert from 'node:assert/strict';
import { wavLoopName, reportArtifact } from '../shared/utils/exportArtifact';
import { savedSpectrogramSettings } from '../shared/analysis/savedSpectrogramSettings';

test('both hosts share flat Unicode output names, collision suffixes and report bytes', () => {
    const used = new Set<string>();
    assert.equal(wavLoopName('C:\\音声\\測定.wav', used), '測定_loop.wav');
    assert.equal(wavLoopName('/another/測定.wav', used), '測定_loop_2.wav');
    const message = { type: 'export-report-options' as const, defaultName: '測定', markdownContent: '# 音声\n', notebookContent: '{"nbformat":4}' };
    assert.deepEqual(reportArtifact(message, 'markdown'), { name: '測定.md', content: '# 音声\n', type: 'text/markdown;charset=utf-8' });
    assert.equal(JSON.parse(reportArtifact(message, 'notebook').content).nbformat, 4);
});

test('corrupt persisted settings fall back without accepting expensive invalid STFT allocations', () => {
    assert.equal(savedSpectrogramSettings({ auto: false, stft: { nFft: 1e9 }, display: {} }).auto, true);
    const settings = savedSpectrogramSettings(undefined);
    settings.stft.nFft = 64;
    assert.equal(savedSpectrogramSettings(undefined).stft.nFft, 1024);
});
