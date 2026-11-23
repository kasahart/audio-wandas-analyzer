import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { channelsForResult, formatMeasuredLevel, uncalibratedUnits } from '../../shared/utils/format';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { levelText as dbText } from '../shell/numberText';
import { hintAttr } from './hintFooter';
import type { ComparisonTrackState } from './types';

interface CalibrationSummary {
    text: string;
    title: string;
}

type Channel = ChannelSummary | null | undefined;

type CalibrationButtonStrings = Pick<UiStrings, 'calibrationButtonLabel' | 'calibrationButtonTitle' | 'calibrationButtonAria'>;
export type CalibrationBadgeStrings = Pick<UiStrings, 'calibrationBadgeUncalibratedHint' | 'calibrationBadgeRawHint' | 'calibrationBadgePartialHint' | 'calibrationFactorLabel'>;

function measurementFor(channel: Channel) {
    return channel && channel.measurement ? channel.measurement : null;
}

export function peakText(channel: Channel, peakLabel: string): string | null {
    const measurement = measurementFor(channel);
    const text = measurement && channel && formatMeasuredLevel(channel.peakAbsolute, Number(channel.peakLevelDb), measurement);
    return text ? peakLabel + ' ' + text : null;
}

function levelText(channel: ChannelSummary, levelDb: number | undefined): string {
    if (!Number.isFinite(levelDb)) { return '—'; }
    // Named by its reference, as the level axes are (R7): never bare dB for an absolute level.
    // Without a reference sent, an uncalibrated channel's is known by its source (full scale or raw units), never guessed.
    const reference = channel.measurement?.levelReferenceLabel ?? channel.sourceLevelReferenceLabel ?? (typeof channel.fullScale === 'boolean' ? uncalibratedUnits(channel.fullScale).level : undefined);
    return reference ? dbText(Number(levelDb), reference) : '—';
}

export function channelMetricSummaryHtml(channel: Channel, peakLabel: string): string {
    const peakDb = channel ? levelText(channel, channel.peakLevelDb) : '—';
    return '<span>' + escapeHtml(peakText(channel, peakLabel) ?? peakLabel + ' ' + peakDb) + '</span>';
}

export function calibrationSummary(channels: Channel[], strings: CalibrationBadgeStrings): CalibrationSummary {
    const calibrated = channels.flatMap(channel => {
        const measurement = measurementFor(channel);
        return measurement?.calibrationStatus === 'calibrated' ? [measurement] : [];
    });
    if (calibrated.length === 0) {
        // A source without a full scale (CSV) is uncalibrated in raw input units, not FS.
        return channels.every(channel => !channel || channel.fullScale)
            ? { text: 'FS', title: strings.calibrationBadgeUncalibratedHint }
            : { text: 'RAW', title: strings.calibrationBadgeRawHint };
    }
    if (calibrated.length !== channels.length) {
        return { text: 'PARTIAL', title: strings.calibrationBadgePartialHint };
    }
    const units = Array.from(new Set(calibrated.map(measurement => measurement.linearUnit)));
    return {
        text: units.length === 1 ? 'CAL: ' + units[0] : 'CAL',
        title: calibrated.map(function (measurement) {
            return measurement.linearUnit + '; ' + strings.calibrationFactorLabel + ' ' + measurement.factor + '; ' + measurement.levelReferenceLabel;
        }).join(' | '),
    };
}

export function isClipped(channels: Channel[]): boolean {
    return channels.some(function (channel) {
        if (!channel) { return false; }
        if (channel.clipped !== undefined) { return channel.clipped === true; }
        const rawPeak = Number(channel.rawPeakFullScale);
        if (Number.isFinite(rawPeak)) { return rawPeak >= 0.99; }
        const measurement = measurementFor(channel);
        return (!measurement || measurement.calibrationStatus === 'uncalibrated') && Number(channel.peakAbsolute) >= 0.99;
    });
}

const CALIBRATION_STYLES = [
    '.calibration-badge{display:inline-block;border:1px solid var(--line);border-radius:2px;padding:0 3px;margin-left:3px;font-size:8px;font-weight:700;color:var(--accent);white-space:nowrap}',
    '.calibration-overlay-warning{position:absolute;inset:6px 10px;z-index:4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;background:var(--track-bg);color:var(--muted);font-size:11px;border:1px dashed var(--line);border-radius:4px}',
].join('');

export function ensureCalibrationStyles(document: Document): void {
    if (document.getElementById('calibration-runtime-styles')) { return; }
    const style = document.createElement('style');
    style.id = 'calibration-runtime-styles';
    style.textContent = CALIBRATION_STYLES;
    document.head.appendChild(style);
}

export function calibrationBadgeHtml(channels: Channel[], strings: CalibrationBadgeStrings): string {
    const summary = calibrationSummary(channels, strings);
    return '<span class="calibration-badge"' + hintAttr(summary.title) + '>' + escapeHtml(summary.text) + '</span>';
}

// The button has no listener of its own: the runtime's click delegation posts calibrationRequest().
export function calibrationButtonHtml(trackId: string, strings: CalibrationButtonStrings): string {
    return '<button class="track-btn" data-action="configure-calibration" data-track-id="' + escapeHtml(trackId) + '"'
        + hintAttr(strings.calibrationButtonTitle) + ' aria-label="' + escapeHtml(strings.calibrationButtonAria) + '">'
        + escapeHtml(strings.calibrationButtonLabel) + '</button>';
}

export function calibrationRequest(trackIndex: number, result: ComparisonTrackState) {
    return {
        type: 'configure-calibration' as const,
        trackIndex,
        filePath: result.filePath,
        channels: channelsForResult(result).map((channel: Channel, channelIndex: number) => ({
            channelIndex,
            label: (channel && channel.label) || 'Channel ' + (channelIndex + 1),
        })),
    };
}
