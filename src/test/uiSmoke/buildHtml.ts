import { buildResultsPreviewHtml, buildSelectionPreviewHtml } from '../../tools/comparisonPreview';
import { getCalibrationRenderScript } from '../../webview/calibrationRenderScript';

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
    return html.replace('<div id="app"></div>', `<div id="app"></div>\n    ${buildVsCodeApiStub(nonce)}`);
}

function injectCalibrationRuntime(html: string): string {
    const marker = '    </script>\n    <div id="canvas-tooltip">';
    if (!html.includes(marker)) {
        throw new Error('Could not find the comparison Webview script boundary');
    }
    return html.replace(
        marker,
        `${getCalibrationRenderScript()}\n    </script>\n    <div id="canvas-tooltip">`,
    );
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
    const marker = 'const __APP_STATE__ = ';
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
        firstChannel['rms'] = 0.063;
        firstChannel['peakAbsolute'] = 5.0;
        firstChannel['rmsLevelDb'] = 70.0;
        firstChannel['peakLevelDb'] = 80.0;
        firstChannel['rawPeakFullScale'] = 0.5;
        firstChannel['clipped'] = false;
        firstChannel['peaks'] = [
            { freqHz: 1000, magnitude: 0.2, levelDb: 80, amplitudeDb: 80 },
        ];

        const second = JSON.parse(JSON.stringify(first)) as PreviewResult;
        second.filePath = '/preview/acceleration.wav';
        second.fileName = 'acceleration.wav';
        const secondChannel = second.channels[0];
        secondChannel['unit'] = 'm/s^2';
        secondChannel['measurement'] = measurement('m/s^2', 'dB', 1, 'dB re 1 m/s^2', 9.81);
        secondChannel['rms'] = 1.25;
        secondChannel['peakAbsolute'] = 4.0;
        secondChannel['rmsLevelDb'] = 1.94;
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
    return finalizeUiSmokeHtml(injectCalibrationRuntime(buildCalibrationStateHtml()));
}

export function buildUiSmokeSelectionHtml(): string {
    return finalizeUiSmokeHtml(buildSelectionPreviewHtml());
}
