import type { SpectrogramData, SpectrogramDisplaySettings, SpectrogramSettings } from '../../shared/analysis/analysisTypes';
import { formatDbLevel, formatHz } from '../draw/canvasDrawers';
import type { RuntimeDocument, RuntimeElement } from './types';

export interface LatestSpectrogramSnapshot {
    windowSize: number | null;
    hopSize: number | null;
    dbMinApplied: number | null;
    dbMaxApplied: number | null;
    maxFrequencyHzApplied: number | null;
}

export function domSnapshotBase(document: RuntimeDocument) {
    return {
        hasToolbar: !!document.getElementById('toolbar'),
        toolbarActions: Array.from(document.querySelectorAll('#toolbar [data-action]')).map(function (el: RuntimeElement) {
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
): string[] {
    return [
        formatDbLevel(dbMax, source),
        formatDbLevel((dbMax + dbMin) / 2, source),
        formatDbLevel(dbMin, source),
        formatHz(freqMin), formatHz((freqMin + freqMax) / 2), formatHz(freqMax),
    ];
}

export function spectrogramAxisLabelTexts(
    spec: SpectrogramData | null | undefined,
    display: SpectrogramDisplaySettings,
    fallbackMaxFrequencyHz: number,
): string[] {
    const dbLo = display.dbMin != null ? display.dbMin : (spec ? spec.minDb : -120);
    const dbHi = display.dbMax != null ? display.dbMax : (spec ? spec.maxDb : 0);
    const originalMaxF = spec ? spec.maxFrequencyHz : fallbackMaxFrequencyHz;
    const maxF = display.maxFrequencyHz != null ? Math.min(display.maxFrequencyHz, originalMaxF) : originalMaxF;
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
