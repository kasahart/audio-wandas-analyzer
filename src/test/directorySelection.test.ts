import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisResultWithError, DirectoryTreeNode } from '../panels/analysisTypes';
import {
    collectAudioFilePaths,
    collectSelectedResults,
    diffSelectedAudioFilePaths,
    sanitizeSelectedAudioFilePaths,
} from '../utils/directorySelection';

const TREE: DirectoryTreeNode[] = [
    {
        type: 'directory',
        name: 'set-a',
        relativePath: 'set-a',
        children: [
            {
                type: 'file',
                name: 'kick.wav',
                relativePath: 'set-a/kick.wav',
                filePath: '/tmp/set-a/kick.wav',
            },
            {
                type: 'directory',
                name: 'nested',
                relativePath: 'set-a/nested',
                children: [
                    {
                        type: 'file',
                        name: 'snare.flac',
                        relativePath: 'set-a/nested/snare.flac',
                        filePath: '/tmp/set-a/nested/snare.flac',
                    },
                ],
            },
        ],
    },
    {
        type: 'file',
        name: 'ambient.ogg',
        relativePath: 'ambient.ogg',
        filePath: '/tmp/ambient.ogg',
    },
];

test('collectAudioFilePaths flattens supported files in tree order', () => {
    assert.deepEqual(collectAudioFilePaths(TREE), [
        '/tmp/set-a/kick.wav',
        '/tmp/set-a/nested/snare.flac',
        '/tmp/ambient.ogg',
    ]);
});

test('sanitizeSelectedAudioFilePaths keeps only files present in the tree and removes duplicates', () => {
    assert.deepEqual(
        sanitizeSelectedAudioFilePaths(TREE, [
            '/tmp/missing.wav',
            '/tmp/set-a/nested/snare.flac',
            '/tmp/set-a/nested/snare.flac',
            '/tmp/ambient.ogg',
        ]),
        [
            '/tmp/set-a/nested/snare.flac',
            '/tmp/ambient.ogg',
        ],
    );
});

test('diffSelectedAudioFilePaths returns only newly added and removed file paths', () => {
    assert.deepEqual(
        diffSelectedAudioFilePaths(
            ['/tmp/set-a/kick.wav', '/tmp/ambient.ogg'],
            ['/tmp/ambient.ogg', '/tmp/set-a/nested/snare.flac'],
        ),
        {
            addedFilePaths: ['/tmp/set-a/nested/snare.flac'],
            removedFilePaths: ['/tmp/set-a/kick.wav'],
        },
    );
});

test('collectSelectedResults keeps selected file order and skips uncached entries', () => {
    const cachedResults = new Map<string, AnalysisResultWithError>([
        ['/tmp/ambient.ogg', {
            filePath: '/tmp/ambient.ogg',
            fileName: 'ambient.ogg',
            sampleRateHz: 44100,
            durationSeconds: 1,
            channelCount: 1,
            sampleCount: 44100,
            channels: [],
        }],
        ['/tmp/set-a/kick.wav', {
            filePath: '/tmp/set-a/kick.wav',
            fileName: 'kick.wav',
            sampleRateHz: 48000,
            durationSeconds: 2,
            channelCount: 2,
            sampleCount: 96000,
            channels: [],
        }],
    ]);

    assert.deepEqual(
        collectSelectedResults(
            ['/tmp/set-a/kick.wav', '/tmp/set-a/nested/snare.flac', '/tmp/ambient.ogg'],
            cachedResults,
        ).map((result) => result.filePath),
        ['/tmp/set-a/kick.wav', '/tmp/ambient.ogg'],
    );
});