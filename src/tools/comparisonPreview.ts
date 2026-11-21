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
        const playButton = document.querySelector('[data-action="toggle-playback"][data-track-id="track-1"]');
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

function readComparisonRuntimeJs(): string {
    try {
        return readFileSync(
            join(__dirname, '..', '..', 'dist', 'webview', 'comparisonRuntime.js'),
            'utf8',
        );
    } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            throw new Error('Cannot read dist/webview/comparisonRuntime.js — run `npm run compile` first');
        }
        throw error;
    }
}

function finalizePreviewHtml(html: string, options?: { injectVsCodeApiStub?: boolean; injectPreviewDemo?: boolean }): string {
    const nonce = extractNonce(html);
    let finalizedHtml = html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\n/u, '')
        .replace(
            '<script src="__COMPARISON_RUNTIME__"></script>',
            `<script nonce="${nonce}">${readComparisonRuntimeJs()}</script>`,
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
    channelCount?: number;
}): string {
    const channelCount = options?.channelCount ?? 1;
    return finalizePreviewHtml(getRenderHtml({
        mode: 'results',
        results: [
            {
                filePath: '/preview/demo-tone.wav',
                fileName: 'demo-tone.wav',
                audioSource: options?.includeDemoAudio ? DUMMY_AUDIO_DATA_URI : '',
                sampleRateHz: DUMMY_AUDIO_SAMPLE_RATE,
                durationSeconds: DUMMY_AUDIO_DURATION_SECONDS,
                channelCount,
                sampleCount: DUMMY_AUDIO_SAMPLE_RATE * DUMMY_AUDIO_DURATION_SECONDS,
                channels: Array.from({ length: channelCount }, (_, channelIndex) => {
                    return {
                        label: channelIndex === 0 ? 'L' : 'R',
                        peakAbsolute: 0.96, fullScale: true,
                        // As the backend names every channel's level reference.
                        sourceUnit: 'FS', sourceLevelReferenceLabel: 'dBFS',
                    };
                }),
            },
        ],
        spectrogramSettings: {
            auto: false,
            stft: { nFft: 512, overlapPercent: 75, window: 'hamming' },
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
            tooltip: 'Click to select Python environment',
        },
    }), options);
}

export function buildResultsPreviewHtml(): string {
    return buildResultsPreviewHtmlInternal({ includeDemoAudio: false });
}

export function buildSelectionPreviewHtml(): string {
    return buildSelectionPreviewHtmlInternal();
}

export function buildExtensionHostPathPreviewHtml(): string {
    return buildResultsPreviewHtmlInternal({
        includeDemoAudio: true,
        channelCount: 2,
    });
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
