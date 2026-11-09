import type { SpectrogramData, SpectrogramSettings } from '../../shared/analysis/analysisTypes';
import type { WaveformCoverage } from './types';

export interface LatestSpectrogramSnapshot {
    windowSize: number | null;
    overlapPercent: number | null;
    hopSize: number | null;
    dbMinApplied: number | null;
    dbMaxApplied: number | null;
    maxFrequencyHzApplied: number | null;
}

export function domSnapshotBase(document: Document) {
    return {
        hasToolbar: !!document.getElementById('toolbar'),
        toolbarActions: Array.from(document.querySelectorAll('#toolbar [data-action]')).map(function (el: Element) {
            return el.getAttribute('data-action');
        }).filter((action: string | null): action is string => !!action),
        trackRowCount: document.querySelectorAll('.track-row').length,
        audioElementCount: document.querySelectorAll('#audio-host audio').length,
        hasRulerCanvas: !!document.getElementById('ruler-canvas'),
        spectrumOverlayPresent: !!document.getElementById('spectrum-overlay-canvas'),
    };
}

function verticalExtent(doc: Document, id: string): { top: number; bottom: number } | null {
    const el = doc.getElementById(id);
    if (!el) {
        return null;
    }
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
}

function fieldValue(doc: Document, id: string): string | null {
    const el = doc.getElementById(id) as HTMLInputElement | null;
    return el ? el.value : null;
}

export function shellSnapshot(doc: Document, audioContextState: string | null) {
    const popover = doc.getElementById('waveform-range-popover');
    return {
        hintFooterText: doc.getElementById('hint-footer')?.textContent ?? null,
        layout: {
            viewportHeight: doc.documentElement.clientHeight,
            tracksWrapper: verticalExtent(doc, 'tracks-wrapper'),
            spectrumSection: verticalExtent(doc, 'spectrum-section'),
            footer: verticalExtent(doc, 'app-footer'),
        },
        waveformRangePopover: popover ? {
            open: popover.style.display === 'block',
            min: fieldValue(doc, 'wave-range-min'),
            max: fieldValue(doc, 'wave-range-max'),
        } : null,
        audioContextState,
        audio: Array.from(doc.querySelectorAll<HTMLAudioElement>('#audio-host audio')).map(function (audio) {
            return {
                trackId: audio.getAttribute('data-track-id'),
                crossOrigin: audio.crossOrigin,
                readyState: audio.readyState,
                paused: audio.paused,
                currentTime: audio.currentTime,
                errorCode: audio.error ? audio.error.code : null,
            };
        }),
    };
}

export function latestSpectrogramSnapshot(
    firstSpec: SpectrogramData | null | undefined,
    settings: SpectrogramSettings | null,
): LatestSpectrogramSnapshot | undefined {
    if (!firstSpec && !settings) {
        return undefined;
    }
    const disp = settings && settings.display ? settings.display : { dbMin: null, dbMax: null, maxFrequencyHz: null };
    const stft = settings && settings.stft ? settings.stft : null;
    return {
        windowSize: stft ? Number(stft.nFft) : (firstSpec ? firstSpec.windowSize : null),
        overlapPercent: stft ? Number(stft.overlapPercent) : null,
        hopSize: firstSpec ? firstSpec.hopSize : null,
        dbMinApplied: disp.dbMin == null ? null : Number(disp.dbMin),
        dbMaxApplied: disp.dbMax == null ? null : Number(disp.dbMax),
        maxFrequencyHzApplied: disp.maxFrequencyHz == null ? null : Number(disp.maxFrequencyHz),
    };
}

export function visibleFileRange(
    zoomStart: number,
    zoomEnd: number,
    placement: { offsetNorm: number; trackDurRatio: number },
): { startNorm: number; endNorm: number } {
    return {
        startNorm: Math.max(0, (zoomStart - placement.offsetNorm) / placement.trackDurRatio),
        endNorm: Math.min(1, (zoomEnd - placement.offsetNorm) / placement.trackDurRatio),
    };
}

export function waveformCoverageSnapshot(coverage: WaveformCoverage | null | undefined) {
    return {
        waveformCoversViewportLeft: !!coverage && coverage.coversLeft,
        waveformCoversViewportRight: !!coverage && coverage.coversRight,
        waveformMinDrawX: coverage ? coverage.minX : null,
        waveformMaxDrawX: coverage ? coverage.maxX : null,
        waveformCanvasWidth: coverage ? coverage.canvasWidth : null,
    };
}
