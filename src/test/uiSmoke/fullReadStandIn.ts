/**
 * An envelope's points in order of their time: each bucket's lowest and highest at their own places (`minT`, `maxT`),
 * else at `placeOf(bucket, buckets)`. The stand-in answers a signal's reads from these (UI_SMOKE_READS), and a test
 * that expects a point of the signal (plotContract.spec.ts, knownData.ts) takes them from the same raw envelope it posted.
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
 * The ui-smoke pages' stand-in for the backend's reads of full data (R7, python-backend/full_read.py): a plot's
 * readout asks for the points around the pointer and the page answers from what it holds, which for these pages is
 * the full data (a lane's envelope points, its spectrogram's cells, a picture a test posted). The real reads are
 * tested against the real backend (narrowFeatures.spec.ts, test_full_read.py).
 *
 * The script defines `uiSmokeReadAnswer(message)`: the answer to a lane's read ('request-waveform-range' or
 * 'request-track-detail' with `read`, or a line's level read), or null for anything else or when the test answers them
 * (`window.__uiSmokeTestAnswersReads`); `uiSmokeSliceAnswer(message)`: the cursor spectrum's slice (an FFT's every bin)
 * at the cursor asked for, which for these pages is the lane spectrogram's column there, or null for octave bands, a
 * read, or when the test answers them; and `uiSmokeReadPoints(view, read)` for a picture's.
 */
export const UI_SMOKE_READS = `
// What the stand-in served, for the test's expectations (knownData.ts servedBins): each plot's every bin, the latest
// answer for each recording's channel (and length: a row cut for display is not its every bin).
function uiSmokeServe(plot, filePath, channelIndex, values) {
    if (!Array.isArray(values)) return;
    var served = window.__uiSmokeServed || (window.__uiSmokeServed = {});
    served[[plot, filePath, channelIndex, values.length].join('|')] = { plot: plot, filePath: filePath, channelIndex: channelIndex, values: values.slice() };
}
function uiSmokeReadLine(xs, values, read) {
    var x0 = Math.min.apply(null, read.x), x1 = Math.max.apply(null, read.x);
    if (read.level) {
        // A level read (R6's order, full_read.read_level): the mean power of every value in the window.
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
    // Each point's step in the whole data (full_read.source_steps): the readout's digits come of it (display rules R7).
    var steps = [];
    for (var index = first; index < after; index++) {
        var gaps = [xs[index] - xs[index - 1], xs[index + 1] - xs[index]].filter(function(gap) { return isFinite(gap) && gap > 0; });
        steps.push(gaps.length ? Math.min.apply(null, gaps) : null);
    }
    return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < xs.length ? xs[after - 1] : null, complete: true, steps: steps };
}
function uiSmokeNearest(axis, value) {
    var best = 0;
    for (var index = 1; index < axis.length; index++) if (Math.abs(axis[index] - value) < Math.abs(axis[best] - value)) best = index;
    return best;
}
function uiSmokeReadCells(xs, ys, matrix, read) {
    if (!xs.length || !ys.length) return { xs: [], ys: [], matrix: [], start: null, end: null, complete: true };
    var beyond = read.beyond === undefined ? 1 : read.beyond;
    var column = uiSmokeNearest(xs, read.x[0]), row = uiSmokeNearest(ys, read.y ? read.y[0] : ys[0]);
    var c0 = Math.max(0, column - beyond), c1 = Math.min(xs.length, column + beyond + 1);
    var r0 = Math.max(0, row - 2), r1 = Math.min(ys.length, row + 3);
    return {
        xs: xs.slice(c0, c1), ys: ys.slice(r0, r1),
        matrix: matrix.slice(r0, r1).map(function(line) { return line.slice(c0, c1).map(function(value) { return Number.isFinite(value) ? value : null; }); }),
        start: c0 > 0 ? xs[c0] : null, end: c1 < xs.length ? xs[c1 - 1] : null, complete: true,
    };
}
${uiSmokeEnvelopePoints.toString()}
/** A picture's own points for a read (its line, its signal's envelope, one event's line, its image's cells). */
function uiSmokeReadPoints(view, read) {
    if (!view || view.kind === 'none') return null;
    if (view.matrix) return uiSmokeReadCells(view.xs || [], view.ys || [], view.matrix, read);
    if (read.event !== undefined) {
        var event = (view.events || []).find(function(item) { return item.id === read.event; });
        return event ? uiSmokeReadLine(event.xs || [], event.values, read) : null;
    }
    if (read.level && view.events && view.events.length) {
        // A trigger's events' level on screen is every event's samples (stage_combine.read_points), as their levelBins.
        var all = { xs: [], values: [] };
        view.events.forEach(function(item) { (item.xs || []).forEach(function(x, index) { all.xs.push(x); all.values.push(item.values[index]); }); });
        return uiSmokeReadLine(all.xs, all.values, read);
    }
    if (view.waveform) {
        var xs = view.xs || [];
        var line = uiSmokeEnvelopePoints(view.waveform, function(index, count) { return xs.length ? xs[0] + (xs[xs.length - 1] - xs[0]) * (index + 0.5) / count : index; });
        return uiSmokeReadLine(line.xs, line.values, read);
    }
    return uiSmokeReadLine(view.xs || [], view.values || [], read);
}
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
    if (!message || !message.read || (message.type !== 'request-waveform-range' && message.type !== 'request-track-detail')) return null;
    var result = uiSmokeResults().find(function(item) { return item && item.filePath === message.filePath; });
    var channel = result && result.channels ? result.channels[message.read.channel || 0] : null;
    if (message.type === 'request-waveform-range') {
        var envelope = channel && channel.waveform;
        var points = envelope ? (function() {
            var line = uiSmokeEnvelopePoints(envelope, function(index, count) { return index / count; });
            return uiSmokeReadLine(line.xs, line.values, message.read);
        })() : null;
        return Object.assign({ type: 'waveform-range-result', requestId: message.requestId, trackIndex: message.trackIndex, startNorm: message.startNorm, endNorm: message.endNorm, channels: [] }, points ? { points: points } : {});
    }
    var spec = channel && channel.spectrogram;
    var identity = { requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath };
    if (!spec || !spec.timeBins) return Object.assign({ type: 'track-detail-result', channels: [] }, identity);
    var duration = result.durationSeconds || 1;
    var times = Array.from({ length: spec.timeBins }, function(_, column) { return spec.timeCentersSec ? spec.timeCentersSec[column] : (column + 0.5) / spec.timeBins * duration; });
    var lowHz = spec.bandLowHz !== undefined ? spec.bandLowHz : 0, highHz = spec.bandHighHz !== undefined ? spec.bandHighHz : spec.maxFrequencyHz;
    var rows = Array.from({ length: spec.frequencyBins }, function(_, bin) { return lowHz + (spec.frequencyBins > 1 ? bin / (spec.frequencyBins - 1) : 0) * (highHz - lowHz); });
    var matrix = rows.map(function(_, bin) { return times.map(function(_, column) { return spec.values[column] ? spec.values[column][bin] : null; }); });
    return Object.assign({ type: 'track-detail-result', channels: [], points: uiSmokeReadCells(times, rows, matrix, message.read) }, identity);
}
function uiSmokeSliceAnswer(message) {
    if (window.__uiSmokeTestAnswersReads || !message || message.type !== 'request-spectrum-slice' || message.read || message.bandsPerOctave) return null;
    var result = uiSmokeResults().find(function(item) { return item && item.filePath === message.filePath; });
    if (!result || !result.channels) return null;
    var duration = result.durationSeconds || 1;
    var channels = result.channels.map(function(channel, channelIndex) {
        var spec = channel && channel.spectrogram;
        if (!spec || !spec.timeBins || !spec.values) return null;
        var at = 0, best = Infinity;
        for (var column = 0; column < spec.timeBins; column++) {
            var time = spec.timeCentersSec ? spec.timeCentersSec[column] : (column + 0.5) / spec.timeBins * duration;
            var away = Math.abs(time - message.cursorNorm * duration);
            if (away < best) { best = away; at = column; }
        }
        return { channelIndex: channelIndex, values: spec.values[at], bins: spec.values[at], minDb: spec.minDb, maxDb: spec.maxDb, unit: spec.unit, axisLabel: spec.axisLabel };
    });
    if (channels.some(function(channel) { return !channel; })) return null;
    channels.forEach(function(channel) { uiSmokeServe('spectrum', message.filePath, channel.channelIndex, channel.bins); });
    var first = result.channels[0].spectrogram;
    return {
        type: 'spectrum-slice-result', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature,
        trackIndex: message.trackIndex, filePath: message.filePath, channels: channels, frequencyBins: first.frequencyBins, maxFrequencyHz: first.maxFrequencyHz,
        windowStartNorm: message.cursorNorm - 0.01, windowEndNorm: message.cursorNorm + 0.01, window: 'hann',
    };
}
`;
