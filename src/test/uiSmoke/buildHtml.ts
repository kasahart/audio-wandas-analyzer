import {
    buildExtensionHostPathPreviewHtml,
    buildResultsPreviewHtml,
    buildSelectionPreviewHtml,
} from '../../tools/comparisonPreview';
import { getStrings } from '../../shared/i18n/strings';

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeDownloads = [];
window.__uiSmokeClipboardWrites = [];
window.__uiSmokeState = {};
window.__AWA_TEST_HOOKS__ = true;
// Smoke pages open with the cursor spectrum unfolded (a fresh panel folds it); a test sets __uiSmokeViewState for a fresh one.
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
        },
        setState() {},
        getState() { return window.__uiSmokeViewState === undefined ? { spectrumCollapsed: false } : window.__uiSmokeViewState; },
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

function buildExtensionHostApiStub(nonce: string, responseDelayMs: number): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeState = {};
window.__AWA_TEST_HOOKS__ = true;
window.__uiSmokeHostMetrics = {
    requests: [],
    responses: [],
    spectrumPaints: [],
    inFlight: 0,
    maxInFlight: 0,
};
const uiSmokeSpectrumValues = function(cursorNorm, channelIndex) {
    return Array.from({ length: 192 }, function(_, index) {
        const frequencyNorm = index / 191;
        const ridge = 0.18 + 0.55 * cursorNorm + channelIndex * 0.04;
        return -100 + Math.max(0, 1 - Math.abs(frequencyNorm - ridge) * 8) * 88;
    });
};
const uiSmokeThirdOctaveCentersHz = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
    1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
const uiSmokeBandResponse = function(message) {
    const centers = message.bandsPerOctave === 1 ? uiSmokeThirdOctaveCentersHz.filter(function(_, index) { return index % 3 === 1; }) : uiSmokeThirdOctaveCentersHz;
    return {
        type: 'spectrum-slice-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex,
        filePath: message.filePath,
        frequencyBins: centers.length,
        maxFrequencyHz: 22387.2,
        minFrequencyHz: 22.39,
        bandsPerOctave: message.bandsPerOctave,
        bandCentersHz: centers,
        windowStartNorm: message.cursorNorm - 0.02,
        windowEndNorm: message.cursorNorm + 0.02,
        window: 'boxcar',
        channels: [0, 1].map(function(channelIndex) {
            return {
                channelIndex: channelIndex,
                values: centers.map(function(_, index) { return -60 + index - channelIndex * 6; }),
                minDb: -66,
                maxDb: -60 + centers.length,
            };
        }),
        computeMs: 7.1,
    };
};
const uiSmokeSpectrumResponse = function(message) {
    if (message.bandsPerOctave) {
        return uiSmokeBandResponse(message);
    }
    const identity = {
        type: 'spectrum-slice-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex,
        filePath: message.filePath,
        frequencyBins: 192,
        maxFrequencyHz: 4000,
        windowStartNorm: message.cursorNorm - 0.02,
        windowEndNorm: message.cursorNorm + 0.02,
        window: 'hann',
    };
    if (Number.isInteger(message.channelIndex)) {
        return Object.assign(identity, {
            channelIndex: message.channelIndex,
            values: uiSmokeSpectrumValues(message.cursorNorm, message.channelIndex),
            minDb: -100,
            maxDb: 0,
        });
    }
    return Object.assign(identity, {
        channels: [0, 1].map(function(channelIndex) {
            return {
                channelIndex: channelIndex,
                values: uiSmokeSpectrumValues(message.cursorNorm, channelIndex),
                minDb: -100,
                maxDb: 0,
            };
        }),
        computeMs: 7.1,
    });
};
const uiSmokePairResponse = function(message) {
    const bins = 129;
    return {
        type: 'pair-spectrum-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        filePath: message.reference.filePath,
        channelIndex: message.reference.channelIndex,
        frequencyBins: bins,
        maxFrequencyHz: 4000,
        nFft: 256,
        hopLength: 64,
        window: 'hann',
        computeMs: 3.2,
        responses: message.responses.map(function(source, index) {
            return {
                filePath: source.filePath,
                channelIndex: source.channelIndex,
                status: 'ok',
                startSeconds: message.startSeconds === undefined ? 0 : message.startSeconds,
                endSeconds: message.endSeconds === undefined ? 1 : message.endSeconds,
                averages: index === 0 ? 32 : 6,
                resampled: index === 1,
                gainDb: Array.from({ length: bins }, function(_, bin) { return -6 * bin / (bins - 1) - index * 3; }),
                phaseRad: Array.from({ length: bins }, function(_, bin) { return -Math.PI * bin / (bins - 1); }),
                coherence: Array.from({ length: bins }, function(_, bin) { return 1 - 0.5 * bin / (bins - 1); }),
                unit: 'FS',
                axisLabel: 'Gain [dB]',
            };
        }),
    };
};
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
            if (message && message.type === 'request-pair-spectrum') {
                window.setTimeout(function() { window.postMessage(uiSmokePairResponse(message), '*'); }, ${responseDelayMs});
                return;
            }
            if (!message || message.type !== 'request-spectrum-slice') {
                return;
            }
            const metrics = window.__uiSmokeHostMetrics;
            metrics.requests.push({
                at: performance.now(),
                requestId: message.requestId,
                cursorNorm: message.cursorNorm,
                channelIndex: message.channelIndex,
            });
            metrics.inFlight += 1;
            metrics.maxInFlight = Math.max(metrics.maxInFlight, metrics.inFlight);
            window.setTimeout(function() {
                metrics.inFlight -= 1;
                metrics.responses.push({
                    at: performance.now(),
                    requestId: message.requestId,
                    cursorNorm: message.cursorNorm,
                });
                window.postMessage(uiSmokeSpectrumResponse(message), '*');
            }, ${responseDelayMs});
        },
        setState() {},
        getState() { return window.__uiSmokeViewState === undefined ? { spectrumCollapsed: false } : window.__uiSmokeViewState; },
    };
};
const originalClearRect = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function() {
    if (this.canvas && this.canvas.id === 'track-spectrum-0') {
        window.__uiSmokeHostMetrics.spectrumPaints.push(performance.now());
    }
    return originalClearRect.apply(this, arguments);
};
</script>`;
}

function finalizeUiSmokeHtml(html: string, apiStub = buildVsCodeApiStub): string {
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    const nonce = nonceMatch[1];
    return html.replace('<div id="app"></div>', `<div id="app"></div>\n    ${apiStub(nonce)}`);
}

interface PreviewResult {
    filePath: string;
    fileName: string;
    channels: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

interface PreviewState {
    results: PreviewResult[];
    [key: string]: unknown;
}

function replaceAppState(html: string, mutate: (state: PreviewState) => void): string {
    const marker = 'window.__APP_STATE__ = ';
    const start = html.indexOf(marker);
    if (start < 0) {
        throw new Error('Could not find __APP_STATE__ in preview HTML');
    }
    const valueStart = start + marker.length;
    const valueEnd = html.indexOf(';\n', valueStart);
    if (valueEnd < 0) {
        throw new Error('Could not find the end of __APP_STATE__ in preview HTML');
    }
    const state = JSON.parse(html.slice(valueStart, valueEnd)) as PreviewState;
    mutate(state);
    return html.slice(0, valueStart) + JSON.stringify(state) + html.slice(valueEnd);
}

function measurement(
    linearUnit: string,
    levelUnit: string,
    referenceValue: number,
    levelReferenceLabel: string,
    factor: number,
): Record<string, unknown> {
    return {
        calibrationStatus: 'calibrated',
        calibrationSource: 'manual',
        factor,
        linearUnit,
        referenceValue,
        referenceUnit: linearUnit,
        levelUnit,
        levelReferenceLabel,
    };
}

function buildCalibrationStateHtml(): string {
    return replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        const firstChannel = first.channels[0];
        firstChannel['unit'] = 'Pa';
        firstChannel['measurement'] = measurement('Pa', 'dB SPL', 2e-5, 'dB SPL re 20 µPa', 2.0);
        firstChannel['peakAbsolute'] = 5.0;
        firstChannel['peakLevelDb'] = 80.0;
        firstChannel['rawPeakFullScale'] = 0.5;
        delete firstChannel['clipped'];

        const second = JSON.parse(JSON.stringify(first)) as PreviewResult;
        second.filePath = '/preview/acceleration.wav';
        second.fileName = 'acceleration.wav';
        const secondChannel = second.channels[0];
        secondChannel['unit'] = 'm/s^2';
        secondChannel['measurement'] = measurement('m/s^2', 'dB', 1, 'dB re 1 m/s^2', 9.81);
        secondChannel['peakAbsolute'] = 4.0;
        secondChannel['peakLevelDb'] = 12.04;
        secondChannel['rawPeakFullScale'] = 0.4;
        secondChannel['clipped'] = false;
        state.results.push(second);
    });
}

export function buildUiSmokeHtml(): string {
    return finalizeUiSmokeHtml(buildResultsPreviewHtml());
}

/** The results preview with `count` copies of its first file, none of them with a spectrogram yet (they ask for it) unless kept. */
export function buildUiSmokeManyTracksHtml(count: number, keepSpectrograms = false): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        state.results = Array.from({ length: count }, (_, i) => {
            const copy = JSON.parse(JSON.stringify(first)) as PreviewResult;
            copy.filePath = `/preview/take${String(i).padStart(2, '0')}.wav`;
            copy.fileName = `take${String(i).padStart(2, '0')}.wav`;
            if (!keepSpectrograms) copy.channels.forEach((channel) => { delete channel['spectrogram']; });
            return copy;
        });
    }));
}

/** Two takes of the preview file: the second at a quarter of the amplitude, 20 dB down (in `quietUnit` if given) and with the colour scale on auto. */
export function buildUiSmokeTwoLevelsHtml(quietUnit?: string): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        const quiet = JSON.parse(JSON.stringify(first)) as PreviewResult;
        quiet.filePath = '/preview/quiet.wav';
        quiet.fileName = 'quiet.wav';
        quiet.channels.forEach((channel) => {
            const waveform = channel['waveform'] as { min: number[]; max: number[]; absolutePeak: number };
            waveform.min = waveform.min.map((v) => v / 4);
            waveform.max = waveform.max.map((v) => v / 4);
            waveform.absolutePeak /= 4;
            channel['peakAbsolute'] = waveform.absolutePeak;
            const spectrogram = channel['spectrogram'] as { values: number[][]; minDb: number; maxDb: number };
            spectrogram.values = spectrogram.values.map((row) => row.map((v) => v - 20));
            spectrogram.minDb -= 20;
            spectrogram.maxDb -= 20;
            if (quietUnit) {
                channel['unit'] = quietUnit;
                (spectrogram as Record<string, unknown>)['referenceUnit'] = quietUnit;
            }
        });
        state.results.push(quiet);
        const settings = state['spectrogramSettings'] as { display: Record<string, number | null> };
        settings.display = { dbMin: null, dbMax: null, maxFrequencyHz: null };
    }));
}

export function buildUiSmokeCalibrationHtml(): string {
    return finalizeUiSmokeHtml(buildCalibrationStateHtml());
}

export function buildUiSmokeSelectionHtml(): string {
    return finalizeUiSmokeHtml(buildSelectionPreviewHtml());
}

export function buildExtensionHostPathUiSmokeHtml(responseDelayMs = 12): string {
    return finalizeUiSmokeHtml(
        buildExtensionHostPathPreviewHtml(),
        (nonce) => buildExtensionHostApiStub(nonce, responseDelayMs),
    );
}

function replaceAppStrings(html: string, language: string): string {
    const marker = 'window.__APP_STRINGS__ = ';
    const start = html.indexOf(marker);
    if (start < 0) throw new Error('Could not find __APP_STRINGS__ in preview HTML');
    const valueStart = start + marker.length;
    const valueEnd = html.indexOf(';\n', valueStart);
    return html.slice(0, valueStart) + JSON.stringify(getStrings(language)) + html.slice(valueEnd);
}

/** A folder opened on the entry table: the webview posts `entry-scan` and the test answers it. */
export function buildUiSmokeEntryHtml(filePaths: string[], language = 'en'): string {
    const html = replaceAppState(buildSelectionPreviewHtml(), (state) => {
        state['entry'] = true;
        state['rootPath'] = '/entry100';
        state['allFilePaths'] = filePaths;
    });
    return finalizeUiSmokeHtml(language === 'en' ? html : replaceAppStrings(html, language));
}
