import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { channelsForResult, formatMeasuredLevel } from '../../shared/utils/format';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { ComparisonTrackState } from './types';

interface CalibrationSummary {
    text: string;
    title: string;
}

type Channel = ChannelSummary | null | undefined;

type CalibrationButtonStrings = Pick<UiStrings, 'calibrationButtonLabel' | 'calibrationButtonTitle' | 'calibrationButtonAria'>;

function measurementFor(channel: Channel) {
    return channel && channel.measurement ? channel.measurement : null;
}

export function peakText(channel: Channel): string | null {
    const measurement = measurementFor(channel);
    const text = measurement && channel && formatMeasuredLevel(channel.peakAbsolute, Number(channel.peakLevelDb), measurement);
    return text ? 'Peak ' + text : null;
}

function levelText(channel: ChannelSummary, levelDb: number | undefined): string {
    if (!Number.isFinite(levelDb)) { return '—'; }
    return Number(levelDb).toFixed(1) + ' ' + (channel.measurement?.levelUnit ?? 'dB');
}

export function channelMetricSummaryHtml(channel: Channel): string {
    const peakDb = channel ? levelText(channel, channel.peakLevelDb) : '—';
    return '<span>' + escapeHtml(peakText(channel) ?? 'Peak ' + peakDb) + '</span>';
}

export function calibrationSummary(channels: Channel[]): CalibrationSummary {
    const calibrated = channels.filter(channel => measurementFor(channel)?.calibrationStatus === 'calibrated') as ChannelSummary[];
    if (calibrated.length === 0) {
        return { text: 'FS', title: 'Uncalibrated full scale (dBFS)' };
    }
    if (calibrated.length !== channels.length) {
        return { text: 'PARTIAL', title: 'Some channels use physical calibration' };
    }
    const units = Array.from(new Set(calibrated.map(channel => measurementFor(channel)!.linearUnit)));
    return {
        text: units.length === 1 ? 'CAL: ' + units[0] : 'CAL',
        title: calibrated.map(function (channel) {
            const measurement = measurementFor(channel)!;
            return measurement.linearUnit + '; factor ' + measurement.factor + '; ' + measurement.levelReferenceLabel;
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

export function calibrationBadgeHtml(channels: Channel[]): string {
    const summary = calibrationSummary(channels);
    return '<span class="calibration-badge" data-hint="' + escapeHtml(summary.title) + '">' + escapeHtml(summary.text) + '</span>';
}

// The button has no listener of its own: the runtime's click delegation posts calibrationRequest().
export function calibrationButtonHtml(trackId: string, strings: CalibrationButtonStrings): string {
    return '<button class="track-btn" data-action="configure-calibration" data-track-id="' + escapeHtml(trackId) + '"'
        + ' data-hint="' + escapeHtml(strings.calibrationButtonTitle) + '" aria-label="' + escapeHtml(strings.calibrationButtonAria) + '">'
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

// More than one level reference would put incomparable dB values on the shared overlay axis.
export function hasIncompatibleLevelReferences(results: ComparisonTrackState[]): boolean {
    const references = new Set<string>();
    results.forEach(result => channelsForResult(result).forEach(function (channel: Channel) {
        const measurement = measurementFor(channel);
        if (!measurement) { return; }
        references.add([
            measurement.levelUnit,
            measurement.referenceValue,
            measurement.referenceUnit,
            measurement.levelReferenceLabel,
        ].join('|'));
    }));
    return references.size > 1;
}

export function applyOverlayCompatibility(document: Document, incompatible: boolean, message: string): void {
    const wrap = document.getElementById('spectrum-overlay-wrap');
    const canvas = document.getElementById('spectrum-overlay-canvas');
    if (!wrap || !canvas) { return; }
    canvas.setAttribute('data-calibration-hidden', incompatible ? 'true' : 'false');
    canvas.style.visibility = incompatible ? 'hidden' : '';
    let warning = wrap.querySelector('.calibration-overlay-warning');
    if (!incompatible) {
        if (warning) { warning.remove(); }
        return;
    }
    if (!warning) {
        warning = document.createElement('div');
        warning.className = 'calibration-overlay-warning';
        wrap.appendChild(warning);
    }
    warning.textContent = message;
}
