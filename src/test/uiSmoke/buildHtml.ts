import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRenderHtml } from '../helpers/comparisonScriptLoader';

function readWaveformPipelineJs(): string {
    try {
        return readFileSync(
            join(__dirname, '..', '..', '..', 'dist', 'webview', 'comparisonWaveform.js'),
            'utf8',
        );
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new Error('Cannot read dist/webview/comparisonWaveform.js — run `npm run compile` first');
        }
        throw error;
    }
}

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeDownloads = [];
window.__uiSmokeClipboardWrites = [];
window.__uiSmokeState = {};
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
        },
        setState() {},
        getState() { return null; },
    };
};
if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {},
    });
}
navigator.clipboard.writeText = async function(text) {
    window.__uiSmokeClipboardWrites.push(String(text));
};
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
    window.__uiSmokeDownloads.push({
        download: this.download || '',
        href: this.href || '',
    });
    return originalAnchorClick.call(this);
};
HTMLMediaElement.prototype.play = function() {
    return Promise.resolve();
};
</script>`;
}

function finalizeUiSmokeHtml(html: string): string {
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    const nonce = nonceMatch[1];
    return html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\n/u, '')
        .replace('<div id="app"></div>', `<div id="app"></div>\n    ${buildVsCodeApiStub(nonce)}`)
        .replace(
            '<script src="__WAVEFORM_PIPELINE__"></script>',
            `<script nonce="${nonce}">${readWaveformPipelineJs()}</script>`,
        );
}

function finalizePreviewHtml(html: string): string {
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    const nonce = nonceMatch[1];
    return html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\n/u, '')
        .replace(
            '<script src="__WAVEFORM_PIPELINE__"></script>',
            `<script nonce="${nonce}">${readWaveformPipelineJs()}</script>`,
        );
}

export function buildResultsPreviewHtml(): string {
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
    }));
}

export function buildSelectionPreviewHtml(): string {
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
    }));
}

export function buildUiSmokeHtml(): string {
    return finalizeUiSmokeHtml(getRenderHtml({
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
    }));
}

export function buildUiSmokeSelectionHtml(): string {
    return finalizeUiSmokeHtml(getRenderHtml({
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
    }));
}
