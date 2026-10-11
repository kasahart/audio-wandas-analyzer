// Markdown and Jupyter Notebook report builders for the comparison view's "Export report".
// Pure functions of the active tracks, so the runtime only gathers its state and posts the result.
import type { AnalysisResultWithError, ChannelSummary } from '../analysis/analysisTypes';
import { channelLabel, channelsForResult, formatMeasuredLevel, formatMeasurementNumber, formatReportDuration } from '../utils/format';

export interface ReportTrack {
    result: AnalysisResultWithError & { reportSourcePath?: string };
    /** Offset of the track on the global comparison timeline, in seconds. */
    offsetSeconds: number;
}

/** Loop region on the global (offset-adjusted) comparison timeline, in seconds. */
export interface ReportLoopRegion {
    globalStartSec: number;
    globalEndSec: number;
}

function markdownInline(value: unknown): string {
    return String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function markdownTableCell(value: unknown): string {
    return markdownInline(value).split('|').join('\\|');
}

function reportLevel(channel: ChannelSummary, linearValue: number, levelValue: number | undefined): string {
    return formatMeasuredLevel(linearValue, levelValue, channel.measurement) ?? '—';
}

function formatReportDb(value: number | undefined, unit: string): string {
    return Number.isFinite(value) ? Number(value).toFixed(1) + ' ' + markdownTableCell(unit) : '—';
}

function pythonString(value: string): string {
    return JSON.stringify(value);
}

export function buildMarkdownReport(tracks: readonly ReportTrack[], loop: ReportLoopRegion | undefined, generatedAt: Date): string {
    const now = generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const lines = [
        '# Audio Analysis Report',
        '',
        '**Generated:** ' + now,
        '',
        '## Tracks',
        '',
        '| File | Channel | Sample Rate | Duration | Channels | Peak |',
        '|------|---------|-------------|----------|----------|------|',
    ];
    tracks.forEach(function (track) {
        const r = track.result;
        const dur = r.durationSeconds ? formatReportDuration(r.durationSeconds) : '-';
        channelsForResult(r).forEach(function (ch: ChannelSummary, channelIndex: number) {
            const peak = ch ? markdownTableCell(reportLevel(ch, ch.peakAbsolute, ch.peakLevelDb)) : '-';
            lines.push('| ' + markdownTableCell(r.fileName) + ' | ' + markdownTableCell(channelLabel(r, channelIndex)) + ' | ' + r.sampleRateHz + ' Hz | ' + dur + ' | ' + r.channelCount + ' | ' + peak + ' |');
        });
    });
    lines.push('');
    const measuredTracks = tracks.filter(function (track) {
        return channelsForResult(track.result).some(function (channel) {
            return !!channel.measurement;
        });
    });
    if (measuredTracks.length > 0) {
        lines.push('## Calibration', '');
        lines.push('| File | Channel | State | Factor | Linear Unit | Level Reference | Source |');
        lines.push('|------|---------|-------|--------|-------------|-----------------|--------|');
        measuredTracks.forEach(function (track) {
            const r = track.result;
            channelsForResult(r).forEach(function (channel, channelIndex) {
                const measurement = channel.measurement;
                if (!measurement) { return; }
                lines.push('| ' + markdownTableCell(r.fileName)
                    + ' | ' + markdownTableCell(channelLabel(r, channelIndex))
                    + ' | ' + markdownTableCell(measurement.calibrationStatus)
                    + ' | ' + formatMeasurementNumber(measurement.factor)
                    + ' | ' + markdownTableCell(measurement.linearUnit)
                    + ' | ' + markdownTableCell(measurement.levelReferenceLabel)
                    + ' | ' + markdownTableCell(measurement.calibrationSource) + ' |');
            });
        });
        lines.push('', '## Measurements', '');
        lines.push('| File | Channel | Peak | Peak Level | Raw Peak | Clipped |');
        lines.push('|------|---------|------|------------|----------|---------|');
        measuredTracks.forEach(function (track) {
            const r = track.result;
            channelsForResult(r).forEach(function (channel, channelIndex) {
                const measurement = channel.measurement;
                if (!measurement) { return; }
                lines.push('| ' + markdownTableCell(r.fileName)
                    + ' | ' + markdownTableCell(channelLabel(r, channelIndex))
                    + ' | ' + formatMeasurementNumber(channel.peakAbsolute) + ' ' + markdownTableCell(measurement.linearUnit)
                    + ' | ' + formatReportDb(channel.peakLevelDb, measurement.levelUnit)
                    + ' | ' + formatMeasurementNumber(channel.rawPeakFullScale) + ' FS'
                    + ' | ' + (channel.clipped ? 'Yes' : 'No') + ' |');
            });
        });
        lines.push('');
    }
    if (loop && tracks.length > 0) {
        const globalStartSec = loop.globalStartSec;
        const globalEndSec = loop.globalEndSec;
        const globalDurationSec = Math.max(0, globalEndSec - globalStartSec);
        lines.push('## Loop Region');
        lines.push('');
        lines.push('- Time basis: global comparison timeline (offset-adjusted)');
        lines.push('- Global Start: ' + globalStartSec.toFixed(3) + ' s');
        lines.push('- Global End: ' + globalEndSec.toFixed(3) + ' s');
        lines.push('- Global Duration: ' + globalDurationSec.toFixed(3) + ' s');
        lines.push('');
        lines.push('| Track | Offset | Local Start | Local End | Local Duration | Status |');
        lines.push('|-------|--------|-------------|-----------|----------------|--------|');
        tracks.forEach(function (track) {
            const r = track.result;
            const dur = r.durationSeconds || 0;
            const offset = track.offsetSeconds;
            const localStart = globalStartSec - offset;
            const localEnd = globalEndSec - offset;
            const coveredStart = Math.max(0, localStart);
            const coveredEnd = Math.min(dur, localEnd);
            const inRange = dur > 0 && coveredEnd > coveredStart;
            const status = inRange
                ? ((localStart < 0 || localEnd > dur) ? 'Partial' : 'In range')
                : 'Out of range';
            const localStartText = inRange ? coveredStart.toFixed(3) + ' s' : '-';
            const localEndText = inRange ? coveredEnd.toFixed(3) + ' s' : '-';
            const localDurationText = inRange ? (coveredEnd - coveredStart).toFixed(3) + ' s' : '-';
            lines.push('| ' + markdownTableCell(r.fileName) + ' | ' + offset.toFixed(3) + ' s | ' + localStartText + ' | ' + localEndText + ' | ' + localDurationText + ' | ' + status + ' |');
        });
        lines.push('');
    }
    lines.push('', '## Source paths', '', 'Source audio is not embedded; make these paths available when running the notebook.', '');
    tracks.forEach(track => lines.push('- ' + markdownTableCell(track.result.fileName) + ': ' + markdownTableCell(track.result.reportSourcePath ?? track.result.filePath)));
    return lines.join('\n');
}

export function buildNotebook(tracks: readonly ReportTrack[]): string {
    const loadCode = tracks.map(function (track, resultIndex) {
        const result = track.result;
        const channels = channelsForResult(result);
        const variable = 'signal_' + (resultIndex + 1);
        const code = [variable + ' = wd.read(' + pythonString(result.reportSourcePath ?? result.filePath) + ')'];
        if (channels.some(function (channel) {
            return channel.measurement?.calibrationStatus === 'calibrated';
        })) {
            code.push(variable + ' = ' + variable + '.with_calibration([');
            channels.forEach(function (channel) {
                const measurement = channel.measurement;
                const calibrated = measurement?.calibrationStatus === 'calibrated';
                code.push('    wd.ChannelCalibration(factor=' + (calibrated ? measurement.factor : 1)
                    + ', unit=' + pythonString(calibrated ? measurement.linearUnit : '')
                    + ', ref=' + (calibrated ? measurement.referenceValue : 1) + '),');
            });
            code.push('])');
        }
        code.push(variable + '.describe()');
        return code.join('\n');
    }).join('\n\n');
    const nb = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
            kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
            language_info: { name: 'python', version: '3.11' }
        },
        cells: [
            {
                cell_type: 'markdown',
                id: 'title',
                metadata: {},
                source: ['# Audio Analysis Report\n', '\nGenerated by Audio Wandas Analyzer\n', '\nSource audio is not embedded. Place audio at the paths listed below; browser exports use numbered file aliases.\n']
            },
            {
                cell_type: 'code',
                id: 'imports',
                metadata: {},
                outputs: [],
                source: ['import wandas as wd\n']
            },
            {
                cell_type: 'markdown',
                id: 'files-header',
                metadata: {},
                source: ['## Files\n']
            },
            {
                cell_type: 'code',
                id: 'load-files',
                metadata: {},
                outputs: [],
                source: [loadCode]
            }
        ]
    };
    return JSON.stringify(nb, null, 2);
}
