// Captured from merged main 24334d682d70e221e2f01269f0e8109290cafe02; preserves pre-extraction arithmetic.
import type { SpectrogramData } from '../../shared/analysis/analysisTypes';
import type { Range } from '../../shared/gui-core/index';
export function legacyAnalyzer(spec: SpectrogramData, plotW: number, H: number, view: {
    time: Range;
    frequency: Range;
    color: Range;
    trackStart?: number;
    trackDurRatio?: number;
}) {
    const tBins = spec.timeBins, fBins = spec.frequencyBins, dbLo = view.color.min, dbHi = view.color.max, maxFreq = view.frequency.max;
    const zoomStart = view.time.min, zoomEnd = view.time.max, trackStart = view.trackStart ?? 0, trackDurRatio = view.trackDurRatio ?? 1;
    const data = new Uint8ClampedArray(plotW * H * 4);
    const visibleFreqRatio = Math.max(0, Math.min(1, maxFreq / Math.max(spec.maxFrequencyHz, 1)));
    const range = dbHi - dbLo;
    for (let px = 0; px < plotW; px++) {
        const globalStart = zoomStart + (px / plotW) * (zoomEnd - zoomStart);
        const globalEnd = zoomStart + ((px + 1) / plotW) * (zoomEnd - zoomStart);
        const localStart = (globalStart - trackStart) / trackDurRatio;
        const localEnd = (globalEnd - trackStart) / trackDurRatio;
        const t0 = Math.max(0, Math.floor(localStart * tBins));
        const t1 = Math.min(tBins, Math.max(t0 + 1, Math.ceil(localEnd * tBins)));
        if (localEnd <= 0 || localStart >= 1 || t0 >= tBins || t1 <= 0) {
            continue;
        }
        for (let py = 0; py < H; py++) {
            const highRatio = (1 - py / H) * visibleFreqRatio;
            const lowRatio = (1 - (py + 1) / H) * visibleFreqRatio;
            const f0 = Math.max(0, Math.floor(lowRatio * fBins));
            const f1 = Math.min(fBins, Math.max(f0 + 1, Math.ceil(highRatio * fBins)));
            let peakDb = -Infinity;
            for (let ti = t0; ti < t1; ti++) {
                const row = spec.values[ti];
                if (!row) {
                    continue;
                }
                for (let fi = f0; fi < f1; fi++) {
                    const value = row[fi];
                    if (value !== undefined && value > peakDb) {
                        peakDb = value;
                    }
                }
            }
            const value = Number.isFinite(peakDb) ? peakDb : dbLo;
            const norm = range !== 0 ? Math.max(0, Math.min(1, (value - dbLo) / range)) : 0;
            const off = (py * plotW + px) * 4;
            const rgb = dbToRgb(norm);
            data[off] = rgb[0];
            data[off + 1] = rgb[1];
            data[off + 2] = rgb[2];
            data[off + 3] = 255;
        }
    }
    return { width: plotW, height: H, pixels: data };
}
function dbToRgb(norm: number) {
    if (norm < 0.25) {
        const t = norm / 0.25;
        return [Math.floor(68 + t * (59 - 68)), Math.floor(1 + t * (82 - 1)), Math.floor(84 + t * (139 - 84))];
    }
    if (norm < 0.5) {
        const t = (norm - 0.25) / 0.25;
        return [Math.floor(59 + t * (33 - 59)), Math.floor(82 + t * (145 - 82)), Math.floor(139 + t * (140 - 139))];
    }
    if (norm < 0.75) {
        const t = (norm - 0.5) / 0.25;
        return [Math.floor(33 + t * (94 - 33)), Math.floor(145 + t * (201 - 145)), Math.floor(140 + t * (98 - 140))];
    }
    const t = (norm - 0.75) / 0.25;
    return [Math.floor(94 + t * (253 - 94)), Math.floor(201 + t * (231 - 201)), Math.floor(98 + t * (37 - 98))];
}
