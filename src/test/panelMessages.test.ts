import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../shared/analysis/analysisTypes';
import { parsePanelMessage } from '../extension/panelMessages';

test('parsePanelMessage returns discriminated messages for controller dispatch', () => {
    const messages: unknown[] = [
        { type: 'analyze-selected-files', requestId: 'r1', filePaths: ['/tmp/a.wav'] },
        { type: 'select-python-environment' },
        { type: 'select-target', targetKind: 'directory' },
        { type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS },
        { type: 'update-spectrogram-settings', settings: DEFAULT_SPECTROGRAM_SETTINGS },
        {
            type: 'request-waveform-range',
            requestId: 'r1',
            trackIndex: 0,
            filePath: '/tmp/a.wav',
            startNorm: 0,
            endNorm: 1,
            points: 100,
        },
        {
            type: 'request-track-detail',
            requestId: 'r1',
            analysisId: 'a1',
            settingsSignature: 's1',
            trackIndex: 0,
            filePath: '/tmp/a.wav',
        },
        {
            type: 'release-track-detail',
            analysisId: 'a1',
            settingsSignature: 's1',
            trackIndex: 0,
            filePath: '/tmp/a.wav',
        },
        {
            type: 'request-spectrum-slice',
            requestId: 'r1',
            analysisId: 'a1',
            settingsSignature: 's1',
            trackIndex: 0,
            channelIndex: 0,
            cursorNorm: 0.5,
            filePath: '/tmp/a.wav',
        },
        { type: 'export-wav-loop', filePaths: ['/tmp/a.wav'], startNorm: 0, endNorm: 1 },
        {
            type: 'export-report-options',
            defaultName: 'report',
            markdownContent: '# Report',
            notebookContent: '{}',
        },
        { type: 'run-recipe' },
        { type: 'show-info', message: 'done' },
    ];

    assert.deepEqual(
        messages.map((message) => parsePanelMessage(message)?.type),
        messages.map((message) => (message as { type: string }).type),
    );
});

test('parsePanelMessage rejects malformed and unknown messages', () => {
    assert.equal(parsePanelMessage(null), undefined);
    assert.equal(parsePanelMessage({ type: 'select-target', targetKind: 'other' }), undefined);
    assert.equal(parsePanelMessage({ type: 'show-info', message: 1 }), undefined);
    assert.equal(parsePanelMessage({ type: 'unknown' }), undefined);
});
