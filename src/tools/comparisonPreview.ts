import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { getRenderHtml } from '../shared/helpers/comparisonScriptLoader';

export type ComparisonPreviewMode = 'results' | 'selection';

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.acquireVsCodeApi = function() {
    return {
        postMessage() {},
        getState() { return null; },
        setState() {},
    };
};
</script>`;
}

function extractNonce(html: string): string {
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    return nonceMatch[1];
}

function readWaveformPipelineJs(): string {
    try {
        return readFileSync(
            join(__dirname, '..', '..', 'dist', 'webview', 'comparisonWaveform.js'),
            'utf8',
        );
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new Error('Cannot read dist/webview/comparisonWaveform.js — run `npm run compile` first');
        }
        throw error;
    }
}

function finalizePreviewHtml(html: string, injectVsCodeApiStub = false): string {
    const nonce = extractNonce(html);
    let finalizedHtml = html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\n/u, '')
        .replace(
            '<script src="__WAVEFORM_PIPELINE__"></script>',
            `<script nonce="${nonce}">${readWaveformPipelineJs()}</script>`,
        );
    if (injectVsCodeApiStub) {
        finalizedHtml = finalizedHtml.replace(
            '<div id="app"></div>',
            `<div id="app"></div>\n    ${buildVsCodeApiStub(nonce)}`,
        );
    }
    return finalizedHtml;
}

function buildResultsPreviewHtmlInternal(injectVsCodeApiStub = false): string {
    return finalizePreviewHtml(getRenderHtml({
        mode: 'results',
        results: [
            {
                filePath: '/tmp/a.wav',
                fileName: 'a.wav',
                audioSource: '',
                sampleRateHz: 44100,
                durationSeconds: 1,
                channelCount: 1,
                sampleCount: 44100,
                channels: [
                    {
                        label: 'L',
                        rms: 0.1,
                        peakAbsolute: 0.5,
                        dominantFrequencies: [],
                        waveform: {
                            min: [-0.5, -0.4, -0.3, -0.25],
                            max: [0.5, 0.4, 0.35, 0.3],
                            minT: [0.0, 0.25, 0.5, 0.75],
                            maxT: [0.125, 0.375, 0.625, 0.875],
                            samples: [0, 0, 0, 0],
                            absolutePeak: 0.5,
                        },
                        spectrogram: {
                            values: Array.from({ length: 48 }, (_, rowIndex) => {
                                return Array.from({ length: 24 }, (_, columnIndex) => {
                                    return -90 + ((rowIndex * 3 + columnIndex * 2) % 18) * 5;
                                });
                            }),
                            timeBins: 48,
                            frequencyBins: 24,
                            windowSize: 512,
                            hopSize: 128,
                            maxFrequencyHz: 22050,
                            minDb: -90,
                            maxDb: 0,
                        },
                    },
                ],
            },
        ],
        spectrogramSettings: {
            auto: false,
            stft: { nFft: 512, hopSize: 128, window: 'hamming' },
            display: { dbMin: -60, dbMax: 0, maxFrequencyHz: null },
        },
    }), injectVsCodeApiStub);
}

function buildSelectionPreviewHtmlInternal(injectVsCodeApiStub = false): string {
    return finalizePreviewHtml(getRenderHtml({
        mode: 'directory-selection',
        results: [],
        rootPath: '/tmp/session',
        allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
        selectedFilePaths: [],
        pythonEnvironmentState: {
            pythonCommand: 'python3',
            status: 'normal',
            tooltip: 'Click to select Python interpreter',
        },
        directoryTree: [
            {
                type: 'file',
                name: 'a.wav',
                relativePath: 'a.wav',
                filePath: '/tmp/session/a.wav',
            },
            {
                type: 'directory',
                name: 'sub',
                relativePath: 'sub',
                children: [
                    {
                        type: 'file',
                        name: 'b.flac',
                        relativePath: 'sub/b.flac',
                        filePath: '/tmp/session/sub/b.flac',
                    },
                ],
            },
        ],
    }), injectVsCodeApiStub);
}

export function buildResultsPreviewHtml(): string {
    return buildResultsPreviewHtmlInternal();
}

export function buildSelectionPreviewHtml(): string {
    return buildSelectionPreviewHtmlInternal();
}

export function buildComparisonPreviewHtml(mode: ComparisonPreviewMode): string {
    if (mode === 'results') {
        return buildResultsPreviewHtmlInternal(true);
    }
    if (mode === 'selection') {
        return buildSelectionPreviewHtmlInternal(true);
    }
    throw new Error(`Unsupported preview mode: ${String(mode)}`);
}

export function resolvePreviewOutputPath(mode: ComparisonPreviewMode): string {
    return join(os.tmpdir(), `comparison-preview-${mode}.html`);
}

export function buildBrowserOpenCommand(
    platform: NodeJS.Platform,
    targetPath: string,
): { command: string; args: string[] } {
    if (platform === 'darwin') {
        return { command: 'open', args: [targetPath] };
    }
    if (platform === 'win32') {
        return { command: 'cmd', args: ['/c', 'start', '', targetPath] };
    }
    return { command: 'xdg-open', args: [targetPath] };
}

export function writeComparisonPreviewHtml(mode: ComparisonPreviewMode): string {
    const filePath = resolvePreviewOutputPath(mode);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, buildComparisonPreviewHtml(mode), 'utf8');
    return filePath;
}
