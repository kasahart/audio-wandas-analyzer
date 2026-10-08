import { normalizedColor, viridis } from '../../shared/gui-core/index';

export interface DrawTheme {
    /** 軸ラベル文字色 (--muted) */
    mutedColor: string;
    /** ラベル背景色 (--track-bg) */
    bgColor: string;
    /** 罫線色 (--line) */
    lineColor: string;
}

export const DEFAULT_THEME: DrawTheme = {
    mutedColor: '#888',
    bgColor: 'rgba(0,0,0,0.55)',
    lineColor: '#444',
};

export interface CanvasDrawCtx {
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    globalAlpha: number;
    lineWidth: number;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    rect(x: number, y: number, w: number, h: number): void;
    clip(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
    createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
    putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void;
}

export interface SpectrumSliceLike {
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    originalMaxFrequencyHz?: number;
    unit?: string;
    axisLabel?: string;
}

export interface SpectrogramSpecLike {
    minDb: number;
    maxDb: number;
    maxFrequencyHz: number;
    unit?: string;
    axisLabel?: string;
}

export interface SpectrogramAxesOpts {
    dbLo?: number;
    dbHi?: number;
    maxFreq?: number;
}

export function formatAmplitudeValue(value: number): string {
    const absValue = Math.abs(value);
    if (absValue >= 100) {
        return absValue.toFixed(0);
    }
    if (absValue >= 1) {
        return absValue.toFixed(1);
    }
    if (absValue >= 0.01) {
        return absValue.toFixed(2);
    }
    return absValue.toPrecision(2);
}

export function formatWaveformAxisLabels(absolutePeak: number | null | undefined, unit: string | null | undefined) {
    const rawPeak = typeof absolutePeak === 'number' ? absolutePeak : NaN;
    const peak = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 1;
    const value = formatAmplitudeValue(peak);
    const unitText = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
    return ['+' + value, '0', '-' + value, unitText ? 'Amp (' + unitText + ')' : 'Amp'];
}

export function formatHz(hz: number) {
    if (hz >= 1000) {
        return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
    }
    return Math.round(hz) + ' Hz';
}

export function dbToRgb(norm: number) {
    return normalizedColor(norm, viridis);
}

export function dbLevelUnitFor(value: { unit?: string } | null): string {
    return value && value.unit ? value.unit : 'dB';
}

export function formatDbLevel(value: number, source: { unit?: string } | null): string {
    return value.toFixed(0) + ' ' + dbLevelUnitFor(source);
}

export function drawWaveformAmplitudeAxis(ctx: CanvasDrawCtx, W: number, H: number, labels: string[] = formatWaveformAxisLabels(null, null), theme: DrawTheme = DEFAULT_THEME): void {
    const mutedColor = theme.mutedColor;
    const bgColor = theme.bgColor;
    const axisLabels = labels || formatWaveformAxisLabels(null, null);
    const labelW = Math.max(30, Math.min(W, 64));
    ctx.save();
    ctx.fillStyle = bgColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, labelW, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(axisLabels[0], labelW - 2, 1);
    ctx.textBaseline = 'middle';
    ctx.fillText(axisLabels[1], labelW - 2, H / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(axisLabels[2], labelW - 2, H - 1);
    ctx.save();
    ctx.translate(8, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(axisLabels[3], 0, 0);
    ctx.restore();
    ctx.restore();
}

export function drawSpectrogramFrequencyAxis(ctx: CanvasDrawCtx, W: number, H: number, spec: SpectrogramSpecLike, opts: { maxFreq?: number } = {}, theme: DrawTheme = DEFAULT_THEME): void {
    const mutedColor = theme.mutedColor;
    const bgColor = theme.bgColor;
    const o = opts || {};
    const maxHz = (o.maxFreq != null) ? o.maxFreq : spec.maxFrequencyHz;
    ctx.save();
    ctx.fillStyle = bgColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(formatHz(maxHz), W - 2, 1);
    ctx.textBaseline = 'middle';
    ctx.fillText(formatHz(maxHz / 2), W - 2, H / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0 Hz', W - 2, H - 1);
    ctx.save();
    ctx.translate(9, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Freq', 0, 0);
    ctx.restore();
    ctx.restore();
}

export function drawSpectrogramColorbar(ctx: CanvasDrawCtx, W: number, H: number, spec: SpectrogramSpecLike, opts: { dbLo?: number; dbHi?: number } = {}, theme: DrawTheme = DEFAULT_THEME): void {
    const mutedColor = theme.mutedColor;
    const bgColor = theme.bgColor;
    const cbStripW = 50;
    const o = opts || {};
    const dbLo = (o.dbLo != null) ? o.dbLo : spec.minDb;
    const dbHi = (o.dbHi != null) ? o.dbHi : spec.maxDb;
    ctx.save();
    ctx.fillStyle = bgColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(W - cbStripW, 0, cbStripW, H);
    ctx.globalAlpha = 1;
    const cbW = 10;
    const cbX = W - cbStripW + 6;
    const cbY = 2;
    const cbH = Math.max(1, H - 4);
    const grad = ctx.createImageData(cbW, cbH);
    for (let y = 0; y < cbH; y++) {
        const norm = 1 - y / Math.max(cbH - 1, 1);
        const rgb = dbToRgb(norm);
        for (let x = 0; x < cbW; x++) {
            const off = (y * cbW + x) * 4;
            grad.data[off] = rgb[0];
            grad.data[off + 1] = rgb[1];
            grad.data[off + 2] = rgb[2];
            grad.data[off + 3] = 255;
        }
    }
    ctx.putImageData(grad, cbX, cbY);
    ctx.fillStyle = mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const unit = dbLevelUnitFor(spec);
    ctx.fillText(dbHi.toFixed(0) + ' ' + unit, cbX + cbW + 2, cbY);
    ctx.textBaseline = 'bottom';
    ctx.fillText(dbLo.toFixed(0) + ' ' + unit, cbX + cbW + 2, cbY + cbH);
    ctx.restore();
}

export function drawSpectrumLine(ctx: CanvasDrawCtx, W: number, H: number, slice: SpectrumSliceLike, color: string, opts: { padL?: number; padR?: number; padT?: number; padB?: number; lineWidth?: number } = {}, visFreqMin?: number | null, visFreqMax?: number | null, visDbMin?: number | null, visDbMax?: number | null): void {
    const fBins = slice.frequencyBins;
    const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
    const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
    const _visDbMin = (visDbMin != null) ? visDbMin : slice.minDb;
    const _visDbMax = (visDbMax != null) ? visDbMax : slice.maxDb;
    const range = _visDbMax - _visDbMin;
    if (range <= 0) {
        return;
    }
    const padL = (opts && opts.padL) || 0;
    const padR = (opts && opts.padR) || 0;
    const padT = (opts && opts.padT) || 0;
    const padB = (opts && opts.padB) || 0;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
    ctx.beginPath();
    const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
    const visFreqRange = _visFreqMax - _visFreqMin;
    if (visFreqRange <= 0) {
        ctx.restore();
        return;
    }
    for (let i = 0; i < fBins; i++) {
        const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
        if (fHz > slice.maxFrequencyHz) {
            break;
        }
        const x = padL + ((fHz - _visFreqMin) / visFreqRange) * plotW;
        const v = slice.values[i];
        const norm = (v - _visDbMin) / range;
        const y = padT + (1 - norm) * plotH;
        if (i === 0) {
            ctx.moveTo(x, y);
        }
        else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    ctx.restore();
}

export function drawSpectrumAxes(ctx: CanvasDrawCtx, W: number, H: number, slice: SpectrumSliceLike, padL: number, padR: number, padT: number, padB: number, visFreqMin?: number | null, visFreqMax?: number | null, visDbMin?: number | null, visDbMax?: number | null, theme: DrawTheme = DEFAULT_THEME) {
    const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
    const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
    const _visDbMin = (visDbMin != null) ? visDbMin : slice.minDb;
    const _visDbMax = (visDbMax != null) ? visDbMax : slice.maxDb;
    const mutedColor = theme.mutedColor;
    const lineColor = theme.lineColor;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, H - padB);
    ctx.moveTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();
    ctx.fillStyle = mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(formatDbLevel(_visDbMax, slice), padL - 2, padT);
    ctx.textBaseline = 'middle';
    ctx.fillText(formatDbLevel((_visDbMax + _visDbMin) / 2, slice), padL - 2, padT + plotH / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatDbLevel(_visDbMin, slice), padL - 2, H - padB);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(formatHz(_visFreqMin), padL, H - 1);
    ctx.fillText(formatHz((_visFreqMin + _visFreqMax) / 2), padL + plotW / 2, H - 1);
    ctx.fillText(formatHz(_visFreqMax), W - padR, H - 1);
}
