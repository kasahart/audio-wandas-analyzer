import type { SpectrogramData, SpectrogramDisplaySettings, SpectrogramSettings } from '../../shared/analysis/analysisTypes';
import { formatDbLevel, formatHz, frequencyAxisTicks } from '../draw/canvasDrawers';
import { spectrogramDisplayBounds } from './spectrogramRaster';
import { sliceLogMinFrequencyHz, spectrumSeriesRange, spectrumVisibleWindow, type SpectrumViewState } from './spectrumRuntime';
import type { SpectrumSlice, WaveformCoverage } from './types';

export interface LatestSpectrogramSnapshot {
    windowSize: number | null;
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
        spectrumTrackCanvasCount: document.querySelectorAll('.track-spectrum-canvas').length,
    };
}

export function spectrumAxisLabelTexts(
    dbMin: number,
    dbMax: number,
    freqMin: number,
    freqMax: number,
    source: { unit?: string } | null,
    logFrequency = false,
): string[] {
    return [
        formatDbLevel(dbMax, source),
        formatDbLevel((dbMax + dbMin) / 2, source),
        formatDbLevel(dbMin, source),
        ...frequencyAxisTicks({ frequencyMin: freqMin, frequencyMax: freqMax, logFrequency }).map(tick => tick.text),
    ];
}

export function sliceSpectrumAxisLabels(slice: SpectrumSlice | null, view: SpectrumViewState): string[] {
    if (!slice) {
        return [];
    }
    const vis = spectrumVisibleWindow(slice.maxFrequencyHz, slice.minDb, slice.maxDb, view, sliceLogMinFrequencyHz(slice));
    return spectrumAxisLabelTexts(vis.dbMin, vis.dbMax, vis.frequencyMin, vis.frequencyMax, slice, vis.logFrequency);
}

export function overlaySpectrumAxisLabels(slices: readonly SpectrumSlice[], view: SpectrumViewState): string[] {
    const range = spectrumSeriesRange(slices.map(slice => ({ slice })));
    if (slices.length === 0 || !isFinite(range.minDb)) {
        return [];
    }
    const vis = spectrumVisibleWindow(range.maxFrequencyHz, range.minDb, range.maxDb, view, range.logMinFrequencyHz);
    return spectrumAxisLabelTexts(vis.dbMin, vis.dbMax, vis.frequencyMin, vis.frequencyMax, slices[0], vis.logFrequency);
}

export function spectrogramAxisLabelTexts(
    spec: SpectrogramData | null | undefined,
    display: SpectrogramDisplaySettings,
    fallbackMaxFrequencyHz: number,
): string[] {
    const { dbLo, dbHi, maxFrequencyHz: maxF } = spectrogramDisplayBounds(
        spec ?? { minDb: -120, maxDb: 0, maxFrequencyHz: fallbackMaxFrequencyHz },
        display,
    );
    return maxF > 0
        ? ['0 Hz', formatHz(maxF / 2), formatHz(maxF), formatDbLevel(dbLo, spec ?? null), formatDbLevel(dbHi, spec ?? null), 'Freq']
        : [];
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
        hopSize: stft ? Number(stft.hopSize) : (firstSpec ? firstSpec.hopSize : null),
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
