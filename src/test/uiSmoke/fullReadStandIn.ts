/**
 * An envelope's points in order of their time: each bucket's lowest and highest at their own places (`minT`, `maxT`),
 * else at `placeOf(bucket, buckets)`. The stand-in answers a signal's reads from these (UI_SMOKE_READS), and a test
 * that expects a point of the signal takes them from the same raw envelope it posted.
 */
export function uiSmokeEnvelopePoints(envelope: { min: number[]; max: number[]; minT?: number[]; maxT?: number[] }, placeOf: (index: number, count: number) => number): { xs: number[]; values: number[] } {
    const points: Array<[number, number]> = [];
    const count = Math.max(envelope.min.length, envelope.max.length);
    for (let index = 0; index < count; index++) {
        const middle = placeOf(index, count);
        points.push([envelope.minT?.[index] ?? middle, envelope.min[index]]);
        points.push([envelope.maxT?.[index] ?? middle, envelope.max[index]]);
    }
    points.sort((a, b) => a[0] - b[0]);
    return { xs: points.map(point => point[0]), values: points.map(point => point[1]) };
}

/**
 * The ui-smoke pages' stand-in for the backend's answers from full data (display rules R7). A page's known data is
 * its fixture's `waveform` envelope and `spectrogram` cells on each channel: fields of the fixture only (the backend's
 * analysis sends neither), from which this stand-in answers as the backend would from the recording. The real answers
 * are tested against the real backend (narrowFeatures.spec.ts, trackRowFigures.spec.ts, test_track_lane_answers.py).
 *
 * The script defines `uiSmokeReadAnswer(message)`: the answer to a region's peak ('request-region-peak'), or null for
 * anything else or when the test answers them (`window.__uiSmokeTestAnswersReads`); `uiSmokeSliceAnswer(message)`: the
 * cursor spectrum's answers at the cursor asked for (`cursor-answers-result`: a key a channel, no value of a line),
 * which for these pages are the fixture spectrogram's column there, kept for the figure stand-in under the key
 * (`uiSmokeKeepLine`), or null for octave bands or when the test answers them; `uiSmokeRowAnswers(message)`: a Tracks
 * row's answers ('request-track-detail').
 */
export const UI_SMOKE_READS = `
function uiSmokeReadLine(xs, values, read) {
    var x0 = Math.min.apply(null, read.x), x1 = Math.max.apply(null, read.x);
    if (read.level) {
        // A level read (R6's order): the mean power of every value in the window.
        // A signal's ('square') also has its peak, the largest |sample| of the window (where a new trigger starts).
        var power = 0, count = 0, peak = 0;
        xs.forEach(function(x, index) {
            var value = values[index];
            if (x < x0 || x > x1 || value === null || value === undefined || !isFinite(value)) return;
            power += read.level === 'square' ? value * value : value <= -250 ? 0 : Math.pow(10, value / 10);
            peak = Math.max(peak, Math.abs(value));
            count += 1;
        });
        var level = { power: count ? power / count : 0, count: count };
        if (read.level === 'square') level.peak = peak;
        return { xs: [], start: null, end: null, complete: false, level: level };
    }
    var beyond = read.beyond === undefined ? 1 : read.beyond;
    var low = 0;
    while (low < xs.length && xs[low] < x0) low++;
    var high = low;
    while (high < xs.length && xs[high] <= x1) high++;
    var first = Math.max(0, low - beyond), after = Math.min(xs.length, high + beyond);
    // Each point's step in the whole data: the readout's digits come of it (display rules R7).
    var steps = [];
    for (var index = first; index < after; index++) {
        var gaps = [xs[index] - xs[index - 1], xs[index + 1] - xs[index]].filter(function(gap) { return isFinite(gap) && gap > 0; });
        steps.push(gaps.length ? Math.min.apply(null, gaps) : null);
    }
    return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < xs.length ? xs[after - 1] : null, complete: true, steps: steps };
}
${uiSmokeEnvelopePoints.toString()}
function uiSmokeResults() {
    return (window.__uiSmokeReadResults || (window.__APP_STATE__ && window.__APP_STATE__.results) || []);
}
window.addEventListener('message', function(event) {
    var data = event.data;
    if (data && data.type === 'analysis-update' && Array.isArray(data.results)) window.__uiSmokeReadResults = data.results;
}, true);
function uiSmokeReadAnswer(message) {
    // A test whose own stand-in answers the lane's requests answers its reads too.
    if (window.__uiSmokeTestAnswersReads) return null;
    // A region's peak (AnalysisService.region_peak): the largest |value| of each source's channels over its stretch,
    // one answer for them all. For these pages a lane's full data is its envelope's points.
    if (message && message.type === 'request-region-peak') {
        var largest = 0;
        (message.sources || []).forEach(function(source) {
            var of = uiSmokeResults().find(function(item) { return item && item.filePath === source.filePath; });
            ((of && of.channels) || []).forEach(function(one, index) {
                if ((source.channels.length && source.channels.indexOf(index) < 0) || !one.waveform) return;
                var line = uiSmokeEnvelopePoints(one.waveform, function(at, count) { return at / count; });
                var level = uiSmokeReadLine(line.xs, line.values, { x: [source.startNorm, source.endNorm], level: 'square' }).level;
                largest = Math.max(largest, (level && level.peak) || 0);
            });
        });
        return { type: 'region-peak-result', requestId: message.requestId, peak: largest };
    }
    return null;
}
// The tracks' answers kept by key (the cursor spectrum's lines, the pair figure's), as the backend keeps them
// (python-backend/services/tracks_answers.py): a line under its key among the figure stand-in's pictures
// (window.__uiSmokeStageData, buildHtml.ts), its level identity beside it. The page is told the key, never the values.
function uiSmokeKeepLine(key, line, level) {
    window.__uiSmokeStageData = window.__uiSmokeStageData || {};
    window.__uiSmokeStageInput = window.__uiSmokeStageInput || {};
    window.__uiSmokeStageData[key] = Object.assign({ kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level' }, line);
    window.__uiSmokeStageInput[key] = { unit: level.unit, ref: level.ref, levelReferenceLabel: level.label };
    return key;
}
// What a channel's levels are in, as the backend says it: its calibration's unit and reference, else full scale.
function uiSmokeLevelOf(channel) {
    var measurement = channel && channel.measurement, spec = channel && channel.spectrogram;
    if (measurement && measurement.calibrationStatus === 'calibrated') return { unit: measurement.linearUnit, ref: measurement.referenceValue, label: measurement.levelReferenceLabel };
    if (spec && spec.referenceUnit) return { unit: spec.referenceUnit, ref: 1, label: 'dB re 1 ' + spec.referenceUnit };
    return { unit: 'FS', ref: 1, label: 'dBFS' };
}
// A cursor-answers-result for a request, each of lines ({ channelIndex, xs, values, level, x?, xScale?, xLimits? }) kept under a key.
function uiSmokeCursorAnswers(message, lines, extra) {
    return Object.assign({
        type: 'cursor-answers-result', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex, filePath: message.filePath, cursorNorm: message.cursorNorm, scale: message.answers || 'linear',
        channels: lines.map(function(line) {
            var key = ['cursor', message.filePath, line.channelIndex, message.cursorNorm, message.bandsPerOctave || 0, message.settingsSignature].join('|');
            uiSmokeKeepLine(key, { xs: line.xs, values: line.values, x: line.x || 'frequency', xScale: line.xScale || 'linear', xLimits: line.xLimits || [line.xs[0], line.xs[line.xs.length - 1]] }, line.level);
            return { channelIndex: line.channelIndex, level: line.level, key: key };
        }),
        windowStartNorm: Math.max(0, message.cursorNorm - 0.01), windowEndNorm: Math.min(1, message.cursorNorm + 0.01), window: 'hann',
    }, extra || {});
}
function uiSmokeSliceAnswer(message) {
    if (window.__uiSmokeTestAnswersReads || !message || message.type !== 'request-spectrum-slice' || message.bandsPerOctave) return null;
    var result = uiSmokeResults().find(function(item) { return item && item.filePath === message.filePath; });
    if (!result || !result.channels) return null;
    var duration = result.durationSeconds || 1;
    var lines = result.channels.map(function(channel, channelIndex) {
        var spec = channel && channel.spectrogram;
        if (!spec || !spec.timeBins || !spec.values) return null;
        var at = 0, best = Infinity;
        for (var column = 0; column < spec.timeBins; column++) {
            var time = spec.timeCentersSec ? spec.timeCentersSec[column] : (column + 0.5) / spec.timeBins * duration;
            var away = Math.abs(time - message.cursorNorm * duration);
            if (away < best) { best = away; at = column; }
        }
        var values = spec.values[at];
        var lowHz = spec.bandLowHz !== undefined ? spec.bandLowHz : 0, highHz = spec.bandHighHz !== undefined ? spec.bandHighHz : spec.maxFrequencyHz;
        var xs = values.map(function(_, bin) { return lowHz + (values.length > 1 ? bin / (values.length - 1) : 0) * (highHz - lowHz); });
        return { channelIndex: channelIndex, xs: xs, values: values, level: uiSmokeLevelOf(channel), xLimits: [0, spec.maxFrequencyHz] };
    });
    if (lines.some(function(line) { return !line; })) return null;
    return uiSmokeCursorAnswers(message, lines);
}
// A Tracks row's answers on the Figure path (a 'request-track-detail' with \`answers\`), as the backend gives them
// (python-backend/services/tracks_answers.py): a key a channel for its samples and one for its spectrogram's levels, each kept
// among the figure stand-in's pictures. The samples are the line through the page's waveform envelope at every
// sample's time; the levels are the page's spectrogram cells, rows up a linear frequency axis. Null when the test
// answers them itself (window.__uiSmokeTestAnswersRows) or the page has no such recording.
function uiSmokeRowAnswers(message) {
    if (window.__uiSmokeTestAnswersRows || !message || message.type !== 'request-track-detail' || !message.answers) return null;
    var result = uiSmokeResults().find(function(item) { return item && item.filePath === message.filePath; });
    if (!result || !result.channels) return null;
    var duration = result.durationSeconds || 1, rate = result.sampleRateHz || 8000, sizes = null;
    window.__uiSmokeStageData = window.__uiSmokeStageData || {};
    window.__uiSmokeStageInput = window.__uiSmokeStageInput || {};
    var channels = result.channels.map(function(channel, channelIndex) {
        var level = uiSmokeLevelOf(channel), out = { channelIndex: channelIndex, level: level, unit: level.unit };
        var base = ['row', message.filePath, channelIndex, message.settingsSignature].join('|');
        var input = { unit: level.unit, ref: level.ref, levelReferenceLabel: level.label };
        var envelope = channel && channel.waveform;
        if (envelope && envelope.min && envelope.min.length) {
            var count = Math.max(envelope.min.length, envelope.max.length);
            var seconds = function(norms) { return Array.from({ length: count }, function(_, index) { return (norms && norms[index] !== undefined ? norms[index] : (index + 0.5) / count) * duration; }); };
            var wave = { min: envelope.min, max: envelope.max, minT: seconds(envelope.minT), maxT: seconds(envelope.maxT) };
            window.__uiSmokeStageData[base + '|signal'] = { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: level.unit, xs: wave.maxT, values: envelope.max,
                waveform: wave, xSource: { count: Math.round(duration * rate), first: 0, step: 1 / rate } };
            window.__uiSmokeStageInput[base + '|signal'] = input;
            out.signal = base + '|signal';
        }
        var spec = channel && channel.spectrogram;
        // (window.__uiSmokeNoLevels: the test's recording is too short for the STFT, and the reply says so.)
        if (message.spectrogram !== false && !window.__uiSmokeNoLevels && spec && spec.timeBins && spec.values) {
            var times = Array.from({ length: spec.timeBins }, function(_, column) { return spec.timeCentersSec ? spec.timeCentersSec[column] : (column + 0.5) / spec.timeBins * duration; });
            var lowHz = spec.bandLowHz !== undefined ? spec.bandLowHz : 0, highHz = spec.bandHighHz !== undefined ? spec.bandHighHz : spec.maxFrequencyHz;
            var rows = Array.from({ length: spec.frequencyBins }, function(_, bin) { return lowHz + (spec.frequencyBins > 1 ? bin / (spec.frequencyBins - 1) : 0) * (highHz - lowHz); });
            var matrix = rows.map(function(_, bin) { return times.map(function(_, column) { return spec.values[column] ? spec.values[column][bin] : null; }); });
            window.__uiSmokeStageData[base + '|image'] = { kind: 'heatmap', xs: times, ys: rows, matrix: matrix, quantity: 'level', yAxis: 'frequency', yScale: 'linear',
                yLimits: [0, spec.maxFrequencyHz], xLimits: [0, duration], cellPx: 1 };
            window.__uiSmokeStageInput[base + '|image'] = input;
            out.image = base + '|image';
            sizes = sizes || spec;
        }
        // The channel's extents (what the other rows share their scale with): this stand-in names the answers
        // themselves, whose least and most are the extent. Asked alone, the extents are all the reply names.
        if (out.signal !== undefined) out.signalExtent = out.signal;
        if (out.image !== undefined) out.imageExtent = out.image;
        if (message.extents === true) { delete out.signal; delete out.image; }
        return out;
    });
    var timed = message.startNorm !== undefined && message.endNorm !== undefined ? { startNorm: message.startNorm, endNorm: message.endNorm } : {};
    return Object.assign({ type: 'track-answers-result', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex, filePath: message.filePath, scale: message.answers, channels: channels, sampleRateHz: rate, durationSeconds: duration,
        windowSize: sizes ? sizes.windowSize : 512, hopSize: sizes ? sizes.hopSize : 128, windowed: false },
        message.spectrogram !== false && window.__uiSmokeNoLevels ? { noLevels: window.__uiSmokeNoLevels } : {}, timed);
}
`;
