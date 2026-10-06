import { rasterize, viridis, type RasterPlan } from '../../shared/gui-core/index';
import type { SpectrogramData } from '../../shared/analysis/analysisTypes';
export interface SpectrogramRasterView {
    zoomStart: number;
    zoomEnd: number;
    trackStart: number;
    trackDurRatio: number;
    dbLo: number;
    dbHi: number;
    maxFrequencyHz: number;
}
export function paintSpectrogramRaster(spec: SpectrogramData, width: number, height: number, view: SpectrogramRasterView, destination?: Uint8ClampedArray) {
    const columns: RasterPlan['columns'] = Array.from({ length: width }, (_, px) => {
        const globalStart = view.zoomStart + (px / width) * (view.zoomEnd - view.zoomStart);
        const globalEnd = view.zoomStart + ((px + 1) / width) * (view.zoomEnd - view.zoomStart);
        const localStart = (globalStart - view.trackStart) / view.trackDurRatio;
        const localEnd = (globalEnd - view.trackStart) / view.trackDurRatio;
        const first = Math.max(0, Math.floor(localStart * spec.timeBins));
        const after = Math.min(spec.timeBins, Math.max(first + 1, Math.ceil(localEnd * spec.timeBins)));
        return localEnd <= 0 || localStart >= 1 || first >= spec.timeBins || after <= 0 ? null : [first, after];
    });
    const ratio = Math.max(0, Math.min(1, view.maxFrequencyHz / Math.max(spec.maxFrequencyHz, 1)));
    const rows: RasterPlan['rows'] = Array.from({ length: height }, (_, row) => {
        const py = height - row - 1;
        const high = (1 - py / height) * ratio;
        const low = (1 - (py + 1) / height) * ratio;
        const intervals = Math.max(spec.frequencyBins - 1, 0);
        const first = Math.max(0, Math.floor(low * intervals + 0.5));
        return [first, Math.min(spec.frequencyBins, Math.max(first + 1, Math.ceil(high * intervals + 0.5)))];
    });
    return rasterize({ layout: 'rows', values: spec.values, bins: spec.frequencyBins, level: { quantity: 'STFT amplitude', unit: spec.unit ?? 'dB', axisLabel: spec.axisLabel ?? 'STFT amplitude level', referenceValue: spec.referenceValue, referenceUnit: spec.referenceUnit, levelReferenceLabel: spec.levelReferenceLabel } }, { columns, rows, peakMode: 'comparison' }, { min: view.dbLo, max: view.dbHi }, viridis, destination);
}
