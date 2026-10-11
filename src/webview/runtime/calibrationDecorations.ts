import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import { channelsForResult, formatMeasuredLevel } from '../../shared/utils/format';
import type { ComparisonTrackState, WebviewHostApi } from './types';

export interface CalibrationDecorationDeps {
    window: Window & typeof globalThis;
    document: Document;
    host: WebviewHostApi;
    activeTracks(): Array<{ trackIndex: number; result: ComparisonTrackState }>;
}

interface CalibrationSummary {
    text: string;
    title: string;
}

type Channel = ChannelSummary | null | undefined;

function measurementFor(channel: Channel) {
    return channel && channel.measurement ? channel.measurement : null;
}

function setText(element: Element | null, text: string): void {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

function peakText(channel: Channel): string | null {
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

/**
 * Decorates the rows the runtime draws with calibration badges, the Cal button and calibrated peak text.
 * It still re-applies them through a MutationObserver after each runtime render (#228 follow-up: draw them
 * in the runtime's own row rendering instead).
 */
export function installCalibrationDecorations(deps: CalibrationDecorationDeps): void {
    const { window, document, host } = deps;
    const app = document.getElementById('app');
    let decorationPending = false;

    function ensureStyles(): void {
        if (document.getElementById('calibration-runtime-styles')) { return; }
        const style = document.createElement('style');
        style.id = 'calibration-runtime-styles';
        style.textContent = [
            '.calibration-badge{display:inline-block;border:1px solid var(--line);border-radius:2px;padding:0 3px;margin-left:3px;font-size:8px;font-weight:700;color:var(--accent);white-space:nowrap}',
            '.calibration-overlay-warning{position:absolute;inset:6px 10px;z-index:4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;background:var(--track-bg);color:var(--muted);font-size:11px;border:1px dashed var(--line);border-radius:4px}',
        ].join('');
        document.head.appendChild(style);
    }

    function updateMetricSpans(container: Element | null, channel: Channel, labelOffset: number): void {
        if (!container) { return; }
        const spans = Array.from(container.children).filter(child => child.tagName === 'SPAN');
        const text = peakText(channel);
        if (text && spans[labelOffset]) { setText(spans[labelOffset], text); }
    }

    function ensureCalibrationButton(buttons: Element | null, result: ComparisonTrackState, trackIndex: number, channels: Channel[]): void {
        if (!buttons || buttons.querySelector('[data-action="configure-calibration"]')) { return; }
        const button = document.createElement('button');
        button.className = 'track-btn';
        button.setAttribute('data-action', 'configure-calibration');
        button.title = 'Configure per-channel calibration';
        button.setAttribute('aria-label', 'Configure calibration');
        button.textContent = 'Cal';
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            host.postMessage({
                type: 'configure-calibration',
                trackIndex: trackIndex,
                filePath: result.filePath,
                channels: channels.map((channel, channelIndex) => ({
                    channelIndex: channelIndex,
                    label: (channel && channel.label) || 'Channel ' + (channelIndex + 1),
                })),
            });
        });
        buttons.appendChild(button);
    }

    function updateBadges(titleRow: Element | null, channels: Channel[]): void {
        if (!titleRow) { return; }
        const summary = calibrationSummary(channels);
        let calibrationBadge = titleRow.querySelector<HTMLElement>('.calibration-badge');
        if (!calibrationBadge) {
            calibrationBadge = document.createElement('span');
            calibrationBadge.className = 'calibration-badge';
            titleRow.appendChild(calibrationBadge);
        }
        setText(calibrationBadge, summary.text);
        if (calibrationBadge.title !== summary.title) {
            calibrationBadge.title = summary.title;
        }

        let clipBadge = titleRow.querySelector<HTMLElement>('.clip-badge');
        if (!isClipped(channels)) {
            if (clipBadge) { clipBadge.remove(); }
            return;
        }
        if (!clipBadge) {
            clipBadge = document.createElement('span');
            clipBadge.className = 'clip-badge';
            titleRow.appendChild(clipBadge);
        }
        setText(clipBadge, 'CLIP');
        clipBadge.title = 'Raw source peak reached the full-scale clipping threshold';
    }

    function decorateTrack(result: ComparisonTrackState, trackIndex: number): void {
        const row = document.getElementById('track-row-' + trackIndex);
        if (!row || !result) { return; }
        const channels: Channel[] = channelsForResult(result);
        ensureCalibrationButton(row.querySelector('.track-btns'), result, trackIndex, channels);
        updateBadges(row.querySelector('.track-title-row'), channels);

        if (channels.length === 1) {
            updateMetricSpans(row.querySelector('.track-meta'), channels[0], 0);
            return;
        }
        channels.forEach(function (channel, channelIndex) {
            const lane = row.querySelector('.track-channel-lane[data-channel-index="' + channelIndex + '"]');
            updateMetricSpans(lane && lane.querySelector('.track-channel-lane-header'), channel, 1);
        });
    }

    function visibleLevelReferences(): string[] {
        const references: string[] = [];
        document.querySelectorAll<HTMLElement>('.track-row').forEach(function (row) {
            if (row.style.display === 'none') { return; }
            const match = /^track-row-(\d+)$/.exec(row.id);
            if (!match) { return; }
            const trackIndex = Number(match[1]);
            const track = deps.activeTracks().find(candidate => candidate.trackIndex === trackIndex);
            channelsForResult(track && track.result).forEach(function (channel: Channel) {
                const measurement = measurementFor(channel);
                if (!measurement) { return; }
                references.push([
                    measurement.levelUnit,
                    measurement.referenceValue,
                    measurement.referenceUnit,
                    measurement.levelReferenceLabel,
                ].join('|'));
            });
        });
        return Array.from(new Set(references));
    }

    function updateOverlayCompatibility(): void {
        const wrap = document.getElementById('spectrum-overlay-wrap');
        const canvas = document.getElementById('spectrum-overlay-canvas');
        if (!wrap || !canvas) { return; }
        let warning = wrap.querySelector('.calibration-overlay-warning');
        const incompatible = visibleLevelReferences().length > 1;
        canvas.setAttribute('data-calibration-hidden', incompatible ? 'true' : 'false');
        if (canvas.style.visibility !== (incompatible ? 'hidden' : '')) {
            canvas.style.visibility = incompatible ? 'hidden' : '';
        }
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

    function observeApp(): void {
        if (app) {
            observer.observe(app, { childList: true, subtree: true });
        }
    }

    function decorate(): void {
        decorationPending = false;
        observer.disconnect();
        try {
            ensureStyles();
            deps.activeTracks().forEach(track => decorateTrack(track.result, track.trackIndex));
            updateOverlayCompatibility();
        } finally {
            observeApp();
        }
    }

    function scheduleDecoration(): void {
        if (decorationPending) { return; }
        decorationPending = true;
        window.requestAnimationFrame(decorate);
    }

    function onHostMessage(message: unknown): void {
        if (message && (message as { type?: unknown }).type === 'analysis-update') {
            scheduleDecoration();
        }
    }

    const observer = new window.MutationObserver(scheduleDecoration);
    if (host.onMessage) { host.onMessage(onHostMessage); }
    else { window.addEventListener('message', event => onHostMessage(event.data)); }
    observeApp();
    scheduleDecoration();
}
