import {
    buildExtensionHostPathPreviewHtml as extensionHostPathPreviewHtml,
    buildResultsPreviewHtml as resultsPreviewHtml,
    buildSelectionPreviewHtml,
} from '../../tools/comparisonPreview';
import { withKnownRecordings } from './knownRecording';
import { getStrings } from '../../shared/i18n/strings';
import { UI_SMOKE_READS } from './fullReadStandIn';

/** The figure service's stand-in for a page of either stub: see the comment it starts with. */
const UI_SMOKE_FIGURES = `
// The figure service (python-backend/figures/) for the pictures a test answers with: the real service run by the test
// (figureStandIn.ts, python-backend/tests/figure_stand_in.py), handed each picture the spec names. The real-backend
// bridge (realBackend.ts) answers instead where the backend scanned the pictures itself (__uiSmokeRealFigures).
if (window.__settle) window.__settle.awaitHost(['figure-request']);
function uiSmokeFigureAnswers(message) {
    const keys = (message.payload && message.payload.spec && message.payload.spec.keys) || [];
    const answers = {};
    const sent = window.__uiSmokeFigureSent || (window.__uiSmokeFigureSent = {});
    keys.forEach(function(entry) {
        // A kept answer a test let go (window.__uiSmokeLetGo: its key), as a backend's store that made room: the
        // service holds nothing under it (or a part of it) any more.
        if (window.__uiSmokeLetGo && window.__uiSmokeLetGo[entry.key.split('#')[0]]) { answers[entry.key] = null; delete sent[entry.key]; return; }
        // One event of a trigger's (or their mean): its step's picture's event of that number (transport/figure_answers.py EVENT_MARK).
        // When a trigger's events fired (transport/figure_answers.py EVENTS_MARK): its step's picture's events' numbers and times.
        if (entry.key.slice(-7) === '#events') {
            const fired = window.__uiSmokeStageData[entry.key.slice(0, -7)];
            if (fired && fired.events) answers[entry.key] = { fired: fired.events.map(function(item) { return { id: item.id, time: item.time }; }) };
            return;
        }
        const mark = entry.key.indexOf('#event:');
        if (mark >= 0) {
            const step = window.__uiSmokeStageData[entry.key.slice(0, mark)], which = entry.key.slice(mark + 7);
            const events = (step && step.events) || [];
            if (!events.length) return;
            const stepInput = window.__uiSmokeStageInput[entry.key.slice(0, mark)] || {};
            const one = which === 'mean' ? null : events.find(function(item) { return String(item.id) === which; });
            if (which !== 'mean' && !one) return;
            const xs = (one && one.xs) || events[0].xs || step.xs;
            const values = one ? one.values : xs.map(function(_, i) { let sum = 0, n = 0; events.forEach(function(item) { const value = item.values[i]; if (value !== null && value !== undefined && isFinite(value)) { sum += value; n += 1; } }); return n ? sum / n : null; });
            answers[entry.key] = { event: true, xs: xs, values: values, quantity: step.quantity, unit: step.unit,
                identity: [stepInput.unit || '', stepInput.ref === undefined || stepInput.ref === null ? 1 : Number(stepInput.ref), stepInput.levelReferenceLabel || ''] };
            return;
        }
        const view = window.__uiSmokeStageData[entry.key];
        if (!view || (view.kind !== 'line' && view.kind !== 'bar' && view.kind !== 'heatmap')) return;
        // A picture the service was handed already (it keeps what it is handed) is not sent again: a figure of many
        // long lines asks often.
        if (sent[entry.key] === view) return;
        sent[entry.key] = view;
        const input = window.__uiSmokeStageInput[entry.key] || {};
        // An image (a spectrogram, a roughness, a cepstrogram): its cells, rows over its ys.
        if (view.kind === 'heatmap') {
            answers[entry.key] = { kind: 'heatmap', xs: view.xs, ys: view.ys, matrix: view.matrix, quantity: view.quantity, unit: view.unit, yAxis: view.yAxis || 'frequency', yLimits: view.yLimits || null,
                yScale: view.yScale || null, xLimits: view.xLimits || null, cellPx: view.cellPx || null,
                identity: [input.unit || '', input.ref === undefined || input.ref === null ? 1 : Number(input.ref), input.levelReferenceLabel || ''] };
            return;
        }
        answers[entry.key] = { xs: view.xs, values: view.values, kind: view.kind, xScale: view.xScale, quantity: view.quantity, xLimits: view.xLimits || null,
            x: view.x, unit: view.unit, measure: view.measure, measureExponent: view.measureExponent, pair: view.pair,
            signal: !!view.waveform, waveform: view.waveform || null, xSource: view.xSource || null,
            identity: [input.unit || '', input.ref === undefined || input.ref === null ? 1 : Number(input.ref), input.levelReferenceLabel || ''] };
    });
    return answers;
}
function uiSmokeFigure(message) {
    if (!window.__uiSmokeFigure) return;
    window.__uiSmokeFigure(JSON.stringify({ command: message.command, payload: message.payload, answers: uiSmokeFigureAnswers(message) })).then(function(line) {
        const reply = JSON.parse(line);
        if (message.command !== 'figure-release') {
            window.postMessage(reply.error !== undefined
                ? { type: 'figure-result', requestId: message.requestId, command: message.command, failed: reply.error }
                : { type: 'figure-result', requestId: message.requestId, command: message.command, result: reply.result }, '*');
        }
        if (window.__settle) window.__settle.answered(message.requestId);
    });
}
`;

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeDownloads = [];
window.__uiSmokeClipboardWrites = [];
window.__uiSmokeState = {};
window.__AWA_TEST_HOOKS__ = true;
// Smoke pages open with the cursor spectrum unfolded (a fresh panel folds it); a test sets __uiSmokeViewState for a fresh one.
// The pictures a test answers with, kept as the backend keeps a step's values: each is taken as the step's full
// resolution and named by a key (the figure service's stand-in below is handed them).
window.__uiSmokeStageData = {};
function uiSmokeSourceAxis(places) {
    const axis = { count: places.length, first: places[0], last: places[places.length - 1] };
    if (places.length > 1) axis.step = places[1] - places[0];
    return axis;
}
// What each picture's levels are in, as its scan read them (the backend keeps it with the values: StageData.calibration).
window.__uiSmokeStageInput = {};
window.addEventListener('message', function(event) {
    const data = event.data;
    const stage = data && data.type === 'compare-scan-result' && data.result && data.result.stage;
    if (!stage) return;
    // A scan is answered as the backend answers it (frames/stage_view.py describe): the test's picture is kept as the
    // step's answer, and the page is told only what it is, with no drawn point.
    // The words of a description (the protocol's StageView): the page refuses a result with any other field.
    const words = ['frame', 'kind', 'x', 'xScale', 'quantity', 'unit', 'yAxis', 'pair', 'signal', 'measure', 'measureExponent', 'data', 'events'];
    const describe = function() {
        const told = data.result.stage;
        if (told.waveform) told.signal = true;
        Object.keys(told).forEach(function(field) { if (words.indexOf(field) < 0) delete told[field]; });
        if (told.events) told.events = told.events.map(function(item) { return { id: item.id, time: item.time }; });
    };
    if (stage.kind === 'none' || stage.data) { describe(); return; }
    const key = 'k:' + data.filePath + ':' + Object.keys(window.__uiSmokeStageData).length;
    stage.data = key;
    window.__uiSmokeStageInput[key] = data.result.input || null;
    // The axis the kept values are on, for the figure stand-in (a signal's samples are placed by it): the points the
    // test gave, unless it gave an axis of its own. The page is told none of this.
    if (!stage.xSource && stage.xs && stage.xs.length) stage.xSource = uiSmokeSourceAxis(stage.xs);
    window.__uiSmokeStageData[key] = Object.assign({}, stage);
    describe();
}, true);
${UI_SMOKE_READS}
${UI_SMOKE_FIGURES}
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
            const read = uiSmokeReadAnswer(message);
            if (read) { window.setTimeout(function() { window.postMessage(read, '*'); }, 0); return; }
            // The cursor spectrum's answers, as the backend gives them: a key a channel, its line kept for the figure stand-in.
            const slice = uiSmokeSliceAnswer(message);
            if (slice) { window.setTimeout(function() { window.postMessage(slice, '*'); }, 0); return; }
            // A row's kept answers on the Figure path (held off where a real backend answers: realBackend.ts).
            const rows = window.__uiSmokeRealFigures ? null : uiSmokeRowAnswers(message);
            if (rows) { window.setTimeout(function() { window.postMessage(rows, '*'); }, 0); return; }
            if (message && message.type === 'figure-request' && !window.__uiSmokeRealFigures) { uiSmokeFigure(message); return; }
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

/**
 * The Extension Host path stub's grids (buildExtensionHostApiStub): a cursor spectrum's every bin (4097, an 8192-point
 * FFT) and a pair view's 129 bins, each from 0 Hz up to `maxHz`. Exported so a test that expects a bin of them
 * (plotContract.spec.ts) takes it from the data the stub answers with, not from the plot.
 */
export const UI_SMOKE_HOST_GRID = { spectrumBins: 4097, pairBins: 129, maxHz: 4000 } as const;

function buildExtensionHostApiStub(nonce: string, responseDelayMs: number): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeState = {};
window.__AWA_TEST_HOOKS__ = true;
window.__uiSmokeStageData = {};
window.__uiSmokeStageInput = {};
${UI_SMOKE_READS}
window.__uiSmokeHostMetrics = {
    requests: [],
    responses: [],
    spectrumPaints: [],
    inFlight: 0,
    maxInFlight: 0,
};
// A cursor spectrum's line is every bin of an 8192-point FFT, as the backend keeps it.
// A test may set window.__uiSmokeSpikeHz: one bin there stands at −2 dB.
const uiSmokeSpectrumValues = function(cursorNorm, channelIndex, bins) {
    const spikeHz = window.__uiSmokeSpikeHz;
    const spike = typeof spikeHz === 'number' ? Math.round(spikeHz / ${UI_SMOKE_HOST_GRID.maxHz} * (bins - 1)) : -1;
    return Array.from({ length: bins }, function(_, index) {
        if (index === spike) return -2;
        const frequencyNorm = index / (bins - 1);
        const ridge = 0.18 + 0.55 * cursorNorm + channelIndex * 0.04;
        return -100 + Math.max(0, 1 - Math.abs(frequencyNorm - ridge) * 8) * 88;
    });
};
const uiSmokeFullScale = { unit: 'FS', ref: 1, label: 'dBFS' };
const uiSmokeThirdOctaveCentersHz = [25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
    1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
const uiSmokeBandResponse = function(message) {
    const centers = message.bandsPerOctave === 1 ? uiSmokeThirdOctaveCentersHz.filter(function(_, index) { return index % 3 === 1; }) : uiSmokeThirdOctaveCentersHz;
    return uiSmokeCursorAnswers(message, [0, 1].map(function(channelIndex) {
        const values = centers.map(function(_, index) { return -60 + index - channelIndex * 6; });
        return { channelIndex: channelIndex, xs: centers, values: values, level: uiSmokeFullScale, x: 'band', xScale: 'log', xLimits: [22.39, 22387.2] };
    }), { windowStartNorm: message.cursorNorm - 0.02, windowEndNorm: message.cursorNorm + 0.02, window: 'boxcar' });
};
const uiSmokeSpectrumResponse = function(message) {
    if (message.bandsPerOctave) {
        return uiSmokeBandResponse(message);
    }
    const bins = ${UI_SMOKE_HOST_GRID.spectrumBins};
    const xs = Array.from({ length: bins }, function(_, index) { return index / (bins - 1) * ${UI_SMOKE_HOST_GRID.maxHz}; });
    return uiSmokeCursorAnswers(message, [0, 1].map(function(channelIndex) {
        const values = uiSmokeSpectrumValues(message.cursorNorm, channelIndex, bins);
        return { channelIndex: channelIndex, xs: xs, values: values, level: uiSmokeFullScale, xLimits: [0, ${UI_SMOKE_HOST_GRID.maxHz}] };
    }), { windowStartNorm: message.cursorNorm - 0.02, windowEndNorm: message.cursorNorm + 0.02 });
};
// A pair's three lines (gain in dB, phase in degrees, coherence), kept by key a response.
const uiSmokePairResponse = function(message) {
    const bins = ${UI_SMOKE_HOST_GRID.pairBins};
    const xs = Array.from({ length: bins }, function(_, bin) { return bin / (bins - 1) * ${UI_SMOKE_HOST_GRID.maxHz}; });
    const plain = { unit: '', ref: 1, label: '' };
    return {
        type: 'pair-answers-result',
        requestId: message.requestId,
        analysisId: message.analysisId,
        settingsSignature: message.settingsSignature,
        filePath: message.reference.filePath,
        channelIndex: message.reference.channelIndex,
        scale: message.answers || 'linear',
        nFft: 256,
        hopLength: 64,
        window: 'hann',
        responses: message.responses.map(function(source, index) {
            const lines = {
                gain: Array.from({ length: bins }, function(_, bin) { return -6 * bin / (bins - 1) - index * 3; }),
                phase: Array.from({ length: bins }, function(_, bin) { return -180 * bin / (bins - 1); }),
                coherence: Array.from({ length: bins }, function(_, bin) { return 1 - 0.5 * bin / (bins - 1); }),
            };
            const keys = {};
            ['gain', 'phase', 'coherence'].forEach(function(part) {
                keys[part] = uiSmokeKeepLine(['pair', message.reference.filePath, message.reference.channelIndex, source.filePath, source.channelIndex, part, message.startSeconds, message.endSeconds, message.settingsSignature].join('|'),
                    Object.assign({ xs: xs, values: lines[part], quantity: part, xLimits: [0, ${UI_SMOKE_HOST_GRID.maxHz}] }, part === 'phase' ? { unit: 'deg' } : {}), part === 'gain' ? uiSmokeFullScale : plain);
            });
            return {
                filePath: source.filePath,
                channelIndex: source.channelIndex,
                status: 'ok',
                startSeconds: message.startSeconds === undefined ? 0 : message.startSeconds,
                endSeconds: message.endSeconds === undefined ? 1 : message.endSeconds,
                averages: index === 0 ? 32 : 6,
                resampled: index === 1,
                keys: keys,
            };
        }),
    };
};
${UI_SMOKE_FIGURES}
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
            const read = uiSmokeReadAnswer(message);
            if (read) { window.setTimeout(function() { window.postMessage(read, '*'); }, ${responseDelayMs}); return; }
            // A row's kept answers on the Figure path, after the host's delay.
            const rows = uiSmokeRowAnswers(message);
            if (rows) { window.setTimeout(function() { window.postMessage(rows, '*'); }, ${responseDelayMs}); return; }
            if (message && message.type === 'figure-request') { uiSmokeFigure(message); return; }
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
    if (this.canvas && this.canvas.closest && this.canvas.closest('#spectrum-overlay-plot')) {
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

export interface PreviewResult {
    filePath: string;
    fileName: string;
    channels: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

export interface PreviewState {
    results: PreviewResult[];
    [key: string]: unknown;
}

/** The app state a page was built with (its results: each track's waveform envelope, spectrogram, duration). */
export function appStateOf(html: string): PreviewState {
    let state: PreviewState | null = null;
    replaceAppState(html, built => { state = JSON.parse(JSON.stringify(built)) as PreviewState; });
    if (!state) throw new Error('no __APP_STATE__ in the page');
    return state;
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

/** The results preview, each channel with its known recording (knownRecording.ts): a waveform and a spectrogram. */
function buildResultsPreviewHtml(): string {
    return replaceAppState(resultsPreviewHtml(), state => withKnownRecordings(state.results));
}

/** The Extension Host path's preview, each channel with its known waveform (its spectrogram is asked for). */
function buildExtensionHostPathPreviewHtml(): string {
    return replaceAppState(extensionHostPathPreviewHtml(), state => withKnownRecordings(state.results, false));
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

/**
 * The results preview with its one track a
 * real file of that sample rate and length, which a real backend answers for (realBackend.ts bridgeComparison).
 * `analysis`: the backend's analysis of that file (its `analyze` reply), whose version and STFT the track then carries.
 */
export function buildUiSmokeRowFiguresHtml(filePath: string, of: { sampleRateHz: number; durationSeconds: number; autoStft?: boolean; analysis?: { sourceVersion?: unknown; stftSignature?: unknown } }): string {
    const html = finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        first.filePath = filePath;
        first.fileName = filePath.split('/').pop() ?? filePath;
        first['sampleRateHz'] = of.sampleRateHz;
        first['durationSeconds'] = of.durationSeconds;
        // What the backend's own analysis of the file names it by, as a host hands it on: the file's version and the
        // STFT of the analysis. The page takes a row's answer only when it is of these (lazyResponses.ts isOfShownVersion).
        if (of.analysis?.sourceVersion !== undefined) first['sourceVersion'] = of.analysis.sourceVersion;
        if (of.analysis?.stftSignature !== undefined) first['stftSignature'] = of.analysis.stftSignature;
        state.results = [first];
        if (of.autoStft) (state['spectrogramSettings'] as { auto: boolean }).auto = true;
    }));
    const hooks = 'window.__AWA_TEST_HOOKS__ = true;';
    if (!html.includes(hooks)) throw new Error('Could not find the test hooks line in the ui-smoke stub');
    // The page's own stand-ins for the rows' answers and the figure service are held off from the start: the backend answers.
    return html.replace(hooks, `${hooks}\nwindow.__uiSmokeRealFigures = true;`);
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

/**
 * Makes a fixture's spectrogram say the truth of its cells: its lowest and highest level (`minDb`, `maxDb`) are the
 * lowest and highest of its cells, as a backend's are. (The figure service decides the colours from the cells it is
 * handed; the old lanes took them from these two numbers.) No cell of the 0 Hz row, which no image counts.
 */
function cellsReachTheirEnds(spectrogram: { values: number[][]; minDb: number; maxDb: number }): void {
    spectrogram.values = spectrogram.values.map(column => column.map(value => Math.min(spectrogram.maxDb, Math.max(spectrogram.minDb, value))));
    const column = spectrogram.values[0];
    if (column && column.length > 2) { column[1] = spectrogram.minDb; column[2] = spectrogram.maxDb; }
}

/** Two takes of the preview file: the second at a quarter of the amplitude, 20 dB down (in `quietUnit` if given) and with the colour scale on auto. */
export function buildUiSmokeTwoLevelsHtml(quietUnit?: string): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        first.channels.forEach((channel) => cellsReachTheirEnds(channel['spectrogram'] as { values: number[][]; minDb: number; maxDb: number }));
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

/**
 * `count` takes of the preview file, every one but the last at a quarter of the amplitude and 20 dB down, with the
 * colour scale on auto: the loudest recording is far below the rows in view.
 */
export function buildUiSmokeLoudLastHtml(count: number): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        const first = state.results[0];
        first.channels.forEach((channel) => cellsReachTheirEnds(channel['spectrogram'] as { values: number[][]; minDb: number; maxDb: number }));
        state.results = Array.from({ length: count }, (_, i) => {
            const copy = JSON.parse(JSON.stringify(first)) as PreviewResult;
            copy.filePath = `/preview/take${String(i).padStart(2, '0')}.wav`;
            copy.fileName = `take${String(i).padStart(2, '0')}.wav`;
            if (i < count - 1) copy.channels.forEach((channel) => {
                const waveform = channel['waveform'] as { min: number[]; max: number[]; absolutePeak: number };
                waveform.min = waveform.min.map((v) => v / 4);
                waveform.max = waveform.max.map((v) => v / 4);
                waveform.absolutePeak /= 4;
                channel['peakAbsolute'] = waveform.absolutePeak;
                const spectrogram = channel['spectrogram'] as { values: number[][]; minDb: number; maxDb: number };
                spectrogram.values = spectrogram.values.map((row) => row.map((v) => v - 20));
                spectrogram.minDb -= 20;
                spectrogram.maxDb -= 20;
            });
            return copy;
        });
        const settings = state['spectrogramSettings'] as { display: Record<string, number | null> };
        settings.display = { dbMin: null, dbMax: null, maxFrequencyHz: null };
    }));
}

/** The preview file with its colour scale on auto over a spectrogram whose extremes are not round (-120…-23.21 dB). */
export function buildUiSmokeFractionalLevelsHtml(): string {
    return finalizeUiSmokeHtml(replaceAppState(buildResultsPreviewHtml(), (state) => {
        state.results.splice(1);
        state.results[0].channels.forEach((channel) => {
            const spectrogram = channel['spectrogram'] as { values: number[][]; minDb: number; maxDb: number };
            spectrogram.minDb = -120;
            spectrogram.maxDb = -23.21;
            cellsReachTheirEnds(spectrogram);
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
