/** Calibration badges, the Cal button, calibrated peak text and the overlay guard that the comparison runtime draws. */
import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import { channelsForResult, formatMeasuredLevel } from '../../shared/utils/format';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { ComparisonTrackState } from './types';

interface CalibrationSummary {
    text: string;
    title: string;
}

type Channel = ChannelSummary | null | undefined;

function measurementFor(channel: Channel) {
    return channel && channel.measurement ? channel.measurement : null;
}

/** Calibrated peak text (`Peak 5.00 Pa / 80.0 dB SPL`), or null for an uncalibrated channel. */
export function peakText(channel: Channel): string | null {
    const measurement = measurementFor(channel);
    const text = measurement && channel && formatMeasuredLevel(channel.peakAbsolute, Number(channel.peakLevelDb), measurement);
    return text ? 'Peak ' + text : null;
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

/** The calibration badge drawn in a track's title row. */
export function calibrationBadgeHtml(channels: Channel[]): string {
    const summary = calibrationSummary(channels);
    return '<span class="calibration-badge" title="' + escapeHtml(summary.title) + '">' + escapeHtml(summary.text) + '</span>';
}

/** The Cal button drawn in a track's button row; the runtime's click delegation posts {@link calibrationRequest}. */
export function calibrationButtonHtml(trackId: string): string {
    return '<button class="track-btn" data-action="configure-calibration" data-track-id="' + escapeHtml(trackId) + '"'
        + ' title="Configure per-channel calibration" aria-label="Configure calibration">Cal</button>';
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

/** True when the visible tracks' channels use more than one level reference, so one shared dB axis would mislead. */
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

/** Hides the shared spectrum overlay behind a warning while the visible level references are incompatible. */
export function applyOverlayCompatibility(document: Document, incompatible: boolean): void {
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
        warning.textContent = 'Spectrum overlay is unavailable because visible channels use incompatible level references. Per-channel spectra remain available.';
        wrap.appendChild(warning);
    }
}
