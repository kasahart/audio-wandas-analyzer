import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRenderHtml } from '../helpers/comparisonScriptLoader';

const WAVEFORM_PIPELINE_JS = readFileSync(
    join(__dirname, '..', '..', '..', 'dist', 'webview', 'comparisonWaveform.js'),
    'utf8',
);

const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export function buildUiSmokeHtml(): string {
    const html = getRenderHtml({
        mode: 'results',
        results: [
            {
                filePath: '/tmp/a.wav',
                fileName: 'a.wav',
                audioSource: SILENT_WAV_DATA_URI,
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
                            values: Array.from({ length: 24 }, (_, rowIndex) => {
                                return Array.from({ length: 48 }, (_, columnIndex) => {
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
    });
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    const nonce = nonceMatch[1];
    const vscodeApiStub = `<script nonce="${nonce}">
window.acquireVsCodeApi = function() {
    return {
        postMessage() {},
        setState() {},
        getState() { return null; },
    };
};
</script>`;
    return html
        .replace('<div id="app"></div>', `<div id="app"></div>\n    ${vscodeApiStub}`)
        .replace(
            '<script src="__WAVEFORM_PIPELINE__"></script>',
            `<script nonce="${nonce}">${WAVEFORM_PIPELINE_JS}</script>`,
        );
}
