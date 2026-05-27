import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { getRenderHtml } from '../shared/helpers/comparisonScriptLoader';

export type ComparisonPreviewMode = 'results' | 'selection';

const DUMMY_AUDIO_SAMPLE_RATE = 8000;
const DUMMY_AUDIO_DURATION_SECONDS = 2;

function buildDummyAudioDataUri(): string {
    const sampleCount = DUMMY_AUDIO_SAMPLE_RATE * DUMMY_AUDIO_DURATION_SECONDS;
    const pcm = Buffer.alloc(sampleCount * 2);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const timeSeconds = sampleIndex / DUMMY_AUDIO_SAMPLE_RATE;
        const envelope = 0.55 + 0.45 * Math.sin((2 * Math.PI * timeSeconds) / DUMMY_AUDIO_DURATION_SECONDS);
        const tone = Math.sin(2 * Math.PI * 220 * timeSeconds) + 0.5 * Math.sin(2 * Math.PI * 440 * timeSeconds);
        const amplitude = Math.max(-1, Math.min(1, 0.18 * envelope * tone));
        pcm.writeInt16LE(Math.round(amplitude * 0x7fff), sampleIndex * 2);
    }

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(DUMMY_AUDIO_SAMPLE_RATE, 24);
    header.writeUInt32LE(DUMMY_AUDIO_SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString('base64')}`;
}

function buildDummyWaveform(pointCount: number, phase: number) {
    const min: number[] = [];
    const max: number[] = [];
    const minT: number[] = [];
    const maxT: number[] = [];
    const samples: number[] = [];

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const center = (pointIndex + 0.5) / pointCount;
        const slow = Math.sin(2 * Math.PI * (center * 1.5 + phase));
        const fast = Math.sin(2 * Math.PI * (center * 7 + phase));
        const envelope = 0.35 + 0.3 * ((1 + Math.sin(2 * Math.PI * (center + phase))) / 2);
        const peak = Math.min(0.96, envelope * (0.45 + 0.35 * Math.abs(fast)) + 0.08 * Math.abs(slow));
        const bias = 0.08 * slow;
        min.push(Number((bias - peak).toFixed(4)));
        max.push(Number((bias + peak).toFixed(4)));
        minT.push(Number(Math.max(0, center - 0.4 / pointCount).toFixed(4)));
        maxT.push(Number(Math.min(1, center + 0.4 / pointCount).toFixed(4)));
        samples.push(Math.round((0.5 + 0.5 * fast) * 255));
    }

    return { min, max, minT, maxT, samples, absolutePeak: 0.96 };
}

function buildDummySpectrogram(timeBins: number, frequencyBins: number, phase: number): number[][] {
    return Array.from({ length: timeBins }, (_, timeIndex) => {
        return Array.from({ length: frequencyBins }, (_, frequencyIndex) => {
            const timeNorm = timeIndex / Math.max(1, timeBins - 1);
            const freqNorm = frequencyIndex / Math.max(1, frequencyBins - 1);
            const ridge = Math.sin(2 * Math.PI * (timeNorm * 1.8 + phase)) * 0.18 + 0.45;
            const distance = Math.abs(freqNorm - ridge);
            const bandEnergy = Math.max(0, 1 - distance * 3.5);
            const shimmer = 0.5 + 0.5 * Math.sin(2 * Math.PI * (timeNorm * 6 + freqNorm * 2 + phase));
            return Math.round(-92 + bandEnergy * 70 + shimmer * 12);
        });
    });
}

const DUMMY_AUDIO_DATA_URI = buildDummyAudioDataUri();

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

function buildPreviewDemoScript(nonce: string): string {
    return `<script nonce="${nonce}">
window.__comparisonPreviewDemo = true;
function startPreviewDemoWhenReady() {
    window.setTimeout(function startPreviewDemo() {
        const audio = document.getElementById('track-audio-0');
        const playButton = document.querySelector('[data-action="toggle-playback"][data-track-index="0"]');
        if (!(audio instanceof HTMLAudioElement) || !(playButton instanceof HTMLButtonElement)) { return; }
        audio.muted = true;
        audio.loop = true;
        playButton.click();
    }, 150);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPreviewDemoWhenReady, { once: true });
} else {
    startPreviewDemoWhenReady();
}
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

function finalizePreviewHtml(html: string, options?: { injectVsCodeApiStub?: boolean; injectPreviewDemo?: boolean }): string {
    const nonce = extractNonce(html);
    let finalizedHtml = html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\n/u, '')
        .replace(
            '<script src="__WAVEFORM_PIPELINE__"></script>',
            `<script nonce="${nonce}">${readWaveformPipelineJs()}</script>`,
        );
    const injections: string[] = [];
    if (options?.injectVsCodeApiStub) {
        injections.push(buildVsCodeApiStub(nonce));
    }
    if (options?.injectPreviewDemo) {
        injections.push(buildPreviewDemoScript(nonce));
    }
    if (injections.length > 0) {
        finalizedHtml = finalizedHtml.replace(
            '<div id="app"></div>',
            `<div id="app"></div>\n    ${injections.join('\n    ')}`,
        );
    }
    return finalizedHtml;
}

function buildResultsPreviewHtmlInternal(options?: {
    injectVsCodeApiStub?: boolean;
    injectPreviewDemo?: boolean;
    includeDemoAudio?: boolean;
}): string {
    return finalizePreviewHtml(getRenderHtml({
        mode: 'results',
        results: [
            {
                filePath: '/preview/demo-tone.wav',
                fileName: 'demo-tone.wav',
                audioSource: options?.includeDemoAudio ? DUMMY_AUDIO_DATA_URI : '',
                sampleRateHz: DUMMY_AUDIO_SAMPLE_RATE,
                durationSeconds: DUMMY_AUDIO_DURATION_SECONDS,
                channelCount: 1,
                sampleCount: DUMMY_AUDIO_SAMPLE_RATE * DUMMY_AUDIO_DURATION_SECONDS,
                channels: [
                    {
                        label: 'L',
                        rms: 0.24,
                        peakAbsolute: 0.96,
                        dominantFrequencies: [],
                        waveform: buildDummyWaveform(96, 0.08),
                        spectrogram: {
                            values: buildDummySpectrogram(64, 32, 0.1),
                            timeBins: 64,
                            frequencyBins: 32,
                            windowSize: 512,
                            hopSize: 128,
                            maxFrequencyHz: DUMMY_AUDIO_SAMPLE_RATE / 2,
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
    }), options);
}

function buildSelectionPreviewHtmlInternal(options?: { injectVsCodeApiStub?: boolean; injectPreviewDemo?: boolean }): string {
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
    }), options);
}

export function buildResultsPreviewHtml(): string {
    return buildResultsPreviewHtmlInternal({ includeDemoAudio: false });
}

export function buildSelectionPreviewHtml(): string {
    return buildSelectionPreviewHtmlInternal();
}

export function buildComparisonPreviewHtml(mode: ComparisonPreviewMode): string {
    if (mode === 'results') {
        return buildResultsPreviewHtmlInternal({
            injectVsCodeApiStub: true,
            injectPreviewDemo: true,
            includeDemoAudio: true,
        });
    }
    if (mode === 'selection') {
        return buildSelectionPreviewHtmlInternal({ injectVsCodeApiStub: true });
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
