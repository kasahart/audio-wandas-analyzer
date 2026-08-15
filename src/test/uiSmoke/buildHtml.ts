import {
    buildExtensionHostPathPreviewHtml,
    buildResultsPreviewHtml,
    buildSelectionPreviewHtml,
} from '../../tools/comparisonPreview';

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

function buildExtensionHostApiStub(nonce: string, responseDelayMs: number): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeState = {};
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
const uiSmokeSpectrumResponse = function(message) {
    const identity = {
        type: 'spectrum-slice-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex,
        filePath: message.filePath,
        frequencyBins: 192,
        maxFrequencyHz: 4000,
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
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
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
        getState() { return null; },
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
