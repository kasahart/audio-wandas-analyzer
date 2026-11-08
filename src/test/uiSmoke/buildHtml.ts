import {
    buildExtensionHostPathPreviewHtml,
    buildResultsPreviewHtml,
    buildSelectionPreviewHtml,
} from '../../tools/comparisonPreview';
import { getStrings } from '../../shared/i18n/strings';
import { UI_SMOKE_READS } from './fullReadStandIn';

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeDownloads = [];
window.__uiSmokeClipboardWrites = [];
window.__uiSmokeState = {};
window.__AWA_TEST_HOOKS__ = true;
// Smoke pages open with the cursor spectrum unfolded (a fresh panel folds it); a test sets __uiSmokeViewState for a fresh one.
// The backend's stage-combine for the pictures a test answers with: each picture is taken as the step's full
// resolution, named by a key as the backend names the values it keeps, and combined point by point.
window.__uiSmokeStageData = {};
// The backend's levelBins (stage_combine.level_bins) for a picture a test answers with, its values taken as every
// value: a level's power mean of 10^(dB/10), a waveform's mean square, in stretches of its axis (R6's order).
function uiSmokeLevelBins(view) {
    const xs = view.xs || [];
    const db = view.quantity === 'level' || view.quantity === 'gain';
    if ((view.kind !== 'line' && view.kind !== 'bar') || (!db && !view.waveform) || !xs.length) return null;
    const powers = view.waveform
        ? view.waveform.max.map(function(high, i) { const low = view.waveform.min[i] || 0; return ((high || 0) * (high || 0) + low * low) / 2; })
        : (view.values || []).map(function(value) { return value === null ? null : value <= -250 ? 0 : Math.pow(10, value / 10); });
    const at = view.waveform
        ? view.waveform.max.map(function(_, i) { return ((view.waveform.minT[i] || 0) + (view.waveform.maxT[i] || 0)) / 2; })
        : xs;
    const low = Math.min.apply(null, at), high = Math.max.apply(null, at);
    const edges = [low, high > low ? high : low + 1];
    let power = 0, count = 0;
    powers.forEach(function(value) { if (value !== null && isFinite(value)) { power += value; count += 1; } });
    return { edges: edges, power: [count ? power / count : 0], count: [count] };
}
window.addEventListener('message', function(event) {
    const data = event.data;
    const stage = data && data.type === 'compare-scan-result' && data.result && data.result.stage;
    if (!stage || stage.kind === 'none' || stage.data) return;
    const key = 'k:' + data.filePath + ':' + Object.keys(window.__uiSmokeStageData).length;
    stage.data = key;
    const bins = stage.levelBins || uiSmokeLevelBins(stage);
    if (bins) stage.levelBins = bins;
    window.__uiSmokeStageData[key] = stage;
}, true);
${UI_SMOKE_READS}
function uiSmokeCombine(message) {
    const combined = uiSmokeCombined(message);
    if (!message.read || !combined.ok) return combined;
    // A readout's read (R7): the points of the picture it reads, around the place asked for.
    const read = message.read;
    const view = read.of === 'diff' ? combined.diff : message.base.length > 1 ? combined.base : window.__uiSmokeStageData[message.base[0]];
    const points = uiSmokeReadPoints(view, read);
    return points ? { ok: true, points: points } : { ok: true };
}
function uiSmokeCombined(message) {
    const views = message.base.map(function(key) { return window.__uiSmokeStageData[key]; });
    const compare = message.compare ? window.__uiSmokeStageData[message.compare] : null;
    if (views.some(function(view) { return !view; }) || (message.compare && !compare)) {
        return { ok: false, missing: message.base.concat(message.compare ? [message.compare] : []).filter(function(key) { return !window.__uiSmokeStageData[key]; }) };
    }
    const first = views[0];
    const same = function(view) { return view.kind === first.kind && view.x === first.x && view.quantity === first.quantity && (view.xs || []).length === (first.xs || []).length && (view.ys || []).length === (first.ys || []).length; };
    if (!views.every(same) || (compare && !same(compare))) return { ok: true };
    const median = function(values) {
        if (values.some(function(value) { return value === null || value === undefined; })) return null;
        const sorted = values.slice().sort(function(a, b) { return a - b; });
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const strip = function(view) { const out = Object.assign({}, view); delete out.waveform; delete out.events; delete out.data; delete out.levelBins; return out; };
    const base = first.matrix
        ? Object.assign(strip(first), { matrix: first.matrix.map(function(row, r) { return row.map(function(_, c) { return median(views.map(function(view) { return view.matrix[r][c]; })); }); }) })
        : Object.assign(strip(first), { values: (first.values || []).map(function(_, i) { return median(views.map(function(view) { return view.values[i]; })); }) });
    const result = { ok: true };
    delete base.levelBins;
    const baseBins = uiSmokeLevelBins(base);
    if (baseBins) base.levelBins = baseBins;
    if (views.length > 1) result.base = base;
    if (!compare || /Segments$/.test(first.frame)) return result;
    const minus = function(a, b) { return a === null || b === null ? null : Math.round((a - b) * 100) / 100; };
    const diff = compare.matrix
        ? Object.assign(strip(compare), { matrix: compare.matrix.map(function(row, r) { return row.map(function(value, c) { return minus(value, base.matrix[r][c]); }); }) })
        : Object.assign(strip(compare), { values: (compare.values || []).map(function(value, i) { return minus(value, base.values[i]); }) });
    result.diff = diff;
    return result;
}
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
            const read = uiSmokeReadAnswer(message);
            if (read) { window.setTimeout(function() { window.postMessage(read, '*'); }, 0); return; }
            if (message && message.type === 'compare-combine' && !window.__uiSmokeHoldCombine) {
                const answer = uiSmokeCombine(message);
                window.setTimeout(function() { window.postMessage({ type: 'compare-combine-result', requestId: message.requestId, result: answer }, '*'); }, 0);
            }
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
${UI_SMOKE_READS}
window.__uiSmokeHostMetrics = {
    requests: [],
    responses: [],
    spectrumPaints: [],
    inFlight: 0,
    maxInFlight: 0,
};
// A cursor spectrum is a row cut for display (192 points); the CSV export asks for every bin of an 8192-point FFT.
const uiSmokeSpectrumBins = function(message) {
    return message.fullResolution ? 4097 : 192;
};
// A test may set window.__uiSmokeSpikeHz: one bin there stands at −2 dB in an answer at full resolution only, a
// line a spectrum cut for display (192 points) does not have.
const uiSmokeSpectrumValues = function(cursorNorm, channelIndex, bins) {
    const spikeHz = window.__uiSmokeSpikeHz;
    const spike = bins > 192 && typeof spikeHz === 'number' ? Math.round(spikeHz / 4000 * (bins - 1)) : -1;
    return Array.from({ length: bins }, function(_, index) {
        if (index === spike) return -2;
        const frequencyNorm = index / (bins - 1);
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
    const bins = uiSmokeSpectrumBins(message);
    const identity = {
        type: 'spectrum-slice-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex,
        filePath: message.filePath,
        frequencyBins: bins,
        maxFrequencyHz: 4000,
        ...(message.fullResolution ? {} : { frequenciesHz: Array.from({ length: bins }, function(_, index) { return index / (bins - 1) * 4000; }) }),
        windowStartNorm: message.cursorNorm - 0.02,
        windowEndNorm: message.cursorNorm + 0.02,
        window: 'hann',
    };
    if (Number.isInteger(message.channelIndex)) {
        return Object.assign(identity, {
            channelIndex: message.channelIndex,
            values: uiSmokeSpectrumValues(message.cursorNorm, message.channelIndex, bins),
            minDb: -100,
            maxDb: 0,
        });
    }
    return Object.assign(identity, {
        channels: [0, 1].map(function(channelIndex) {
            return {
                channelIndex: channelIndex,
                values: uiSmokeSpectrumValues(message.cursorNorm, channelIndex, bins),
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
            const read = uiSmokeReadAnswer(message);
            if (read) { window.setTimeout(function() { window.postMessage(read, '*'); }, ${responseDelayMs}); return; }
            // A readout's read of a slice at every bin (R7) is answered beside the cursor spectrum's own requests.
            if (message && message.type === 'request-spectrum-slice' && message.read) {
                window.setTimeout(function() { window.postMessage(uiSmokeSpectrumResponse(message), '*'); }, ${responseDelayMs});
                return;
            }
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
    if (this.canvas && this.canvas.id === 'spectrum-overlay-canvas') {
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

/**
 * As the backend does: a calibrated channel's spectrogram (and the cursor spectrum cut from it) reads its own reference.
 * `shiftTimeBins` moves the picture in time, so two copies of one file show different spectra at the cursor.
 */
function readInReference(channel: Record<string, unknown>, levelUnit: string, levelReferenceLabel: string, shiftTimeBins = 0): void {
    const spectrogram = channel['spectrogram'] as Record<string, unknown> | undefined;
    if (!spectrogram) return;
    spectrogram['unit'] = levelUnit;
    spectrogram['axisLabel'] = 'STFT amplitude level [' + levelReferenceLabel + ']';
    spectrogram['levelReferenceLabel'] = levelReferenceLabel;
    const rows = spectrogram['values'] as unknown[];
    spectrogram['values'] = [...rows.slice(shiftTimeBins), ...rows.slice(0, shiftTimeBins)];
}

function buildCalibrationStateHtml(voltTrack = false): string {
    return replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        const firstChannel = first.channels[0];
        firstChannel['unit'] = 'Pa';
        firstChannel['measurement'] = measurement('Pa', 'dB SPL', 2e-5, 'dB SPL re 20 µPa', 2.0);
        readInReference(firstChannel, 'dB SPL', 'dB SPL re 20 µPa');
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
        readInReference(secondChannel, 'dB', 'dB re 1 m/s^2', 16);
        state.results.push(second);
        if (voltTrack) {
            const third = JSON.parse(JSON.stringify(second)) as PreviewResult;
            third.filePath = '/preview/voltage.wav';
            third.fileName = 'voltage.wav';
            third.channels[0]['unit'] = 'V';
            third.channels[0]['measurement'] = measurement('V', 'dB', 1, 'dB re 1 V', 1);
            readInReference(third.channels[0], 'dB', 'dB re 1 V');
            state.results.push(third);
        }
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

/** The preview file with its colour scale on auto over a spectrogram whose extremes are not round (-120…-23.21 dB). */
export function buildUiSmokeFractionalLevelsHtml(): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        state.results.splice(1);
        state.results[0].channels.forEach((channel) => {
            const spectrogram = channel['spectrogram'] as { minDb: number; maxDb: number };
            spectrogram.minDb = -120;
            spectrogram.maxDb = -23.21;
        });
        const settings = state['spectrogramSettings'] as { display: Record<string, number | null> };
        settings.display = { dbMin: null, dbMax: null, maxFrequencyHz: null };
    }));
}

/** A Pa track and an m/s^2 track; `voltTrack` adds a third track calibrated to V, a third level reference. */
export function buildUiSmokeCalibrationHtml(voltTrack = false): string {
    return finalizeUiSmokeHtml(buildCalibrationStateHtml(voltTrack));
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

/** The Extension Host path with `count` takes of its file, each cursor spectrum answered after `responseDelayMs`. */
export function buildExtensionHostPathManyTracksHtml(count: number, responseDelayMs = 12): string {
    return finalizeUiSmokeHtml(
        replaceAppState(buildExtensionHostPathPreviewHtml(), (state) => {
            const first = state.results[0];
            state.results = Array.from({ length: count }, (_, i) => {
                const copy = JSON.parse(JSON.stringify(first)) as PreviewResult;
                copy.filePath = `/preview/take${String(i).padStart(2, '0')}.wav`;
                copy.fileName = `take${String(i).padStart(2, '0')}.wav`;
                return copy;
            });
        }),
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

/** Two takes of the preview file, the second at half the sample rate (its spectrogram's top half as high), on auto display ranges. */
export function buildUiSmokeTwoRatesHtml(): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        const half = JSON.parse(JSON.stringify(first)) as PreviewResult;
        half.filePath = '/preview/half-rate.wav';
        half.fileName = 'half-rate.wav';
        half['sampleRateHz'] = Number(first['sampleRateHz']) / 2;
        half.channels.forEach((channel) => {
            const spectrogram = channel['spectrogram'] as { maxFrequencyHz: number } | undefined;
            if (spectrogram) spectrogram.maxFrequencyHz /= 2;
        });
        state.results = [first, half];
        const settings = state['spectrogramSettings'] as { display: Record<string, number | null> };
        settings.display = { dbMin: null, dbMax: null, maxFrequencyHz: null };
    }));
}
