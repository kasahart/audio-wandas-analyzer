/**
 * 比較パネル webview 用の純粋描画関数群。
 *
 * - すべての関数は CanvasRenderingContext2D 互換オブジェクトと入力データのみで動作する。
 * - DOM へのアクセスは行わない (テーマ色は呼び出し側が渡す)。
 * - これにより jsdom を介さない決定論的な単体テストが可能になる。
 *
 * webview からは scripts/build-webview.js が生成する
 * dist/webview/comparisonWaveform.js 経由で `window.drawXxx` として呼ばれる
 * (再生時の renderScript IIFE が利用)。
 */

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
}

export interface SpectrogramSpecLike {
    minDb: number;
    maxDb: number;
    maxFrequencyHz: number;
}

export function formatHz(hz: number): string {
    if (hz >= 1000) {
        return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
    }
    return Math.round(hz) + ' Hz';
}

/** dB を 0..1 に正規化したスペクトル値を Viridis 風の RGB に変換する。 */
export function dbToRgb(norm: number): [number, number, number] {
    if (norm < 0.25) {
        const t = norm / 0.25;
        return [
            Math.floor(68 + t * (59 - 68)),
            Math.floor(1 + t * (82 - 1)),
            Math.floor(84 + t * (139 - 84)),
        ];
    }
    if (norm < 0.5) {
        const t = (norm - 0.25) / 0.25;
        return [
            Math.floor(59 + t * (33 - 59)),
            Math.floor(82 + t * (145 - 82)),
            Math.floor(139 + t * (140 - 139)),
        ];
    }
    if (norm < 0.75) {
        const t = (norm - 0.5) / 0.25;
        return [
            Math.floor(33 + t * (94 - 33)),
            Math.floor(145 + t * (201 - 145)),
            Math.floor(140 + t * (98 - 140)),
        ];
    }
    const t = (norm - 0.75) / 0.25;
    return [
        Math.floor(94 + t * (253 - 94)),
        Math.floor(201 + t * (231 - 201)),
        Math.floor(98 + t * (37 - 98)),
    ];
}

/** 波形キャンバスの左端に振幅軸 (+1.0 / 0 / -1.0 と 'Amp (FS)') を描画する。 */
export function drawWaveformAmplitudeAxis(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    theme: DrawTheme = DEFAULT_THEME,
): void {
    void W;
    const labelW = 30;
    ctx.save();
    ctx.fillStyle = theme.bgColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, labelW, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('+1.0', labelW - 2, 1);
    ctx.textBaseline = 'middle';
    ctx.fillText('0', labelW - 2, H / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText('-1.0', labelW - 2, H - 1);
    ctx.save();
    ctx.translate(8, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Amp (FS)', 0, 0);
    ctx.restore();
    ctx.restore();
}

/** スペクトログラムの上に左軸 (Hz) と右側カラーバー (dB) をオーバーレイ描画する。 */
export function drawSpectrogramAxes(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    spec: SpectrogramSpecLike,
    theme: DrawTheme = DEFAULT_THEME,
): void {
    const labelW = 36;
    const cbStripW = 50;
    const maxHz = spec.maxFrequencyHz;

    ctx.save();
    ctx.fillStyle = theme.bgColor;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, labelW, H);
    ctx.fillRect(W - cbStripW, 0, cbStripW, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(formatHz(maxHz), labelW - 2, 1);
    ctx.textBaseline = 'middle';
    ctx.fillText(formatHz(maxHz / 2), labelW - 2, H / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText('0 Hz', labelW - 2, H - 1);
    ctx.save();
    ctx.translate(9, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Freq', 0, 0);
    ctx.restore();

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
            grad.data[off] = rgb[0]; grad.data[off + 1] = rgb[1]; grad.data[off + 2] = rgb[2]; grad.data[off + 3] = 255;
        }
    }
    ctx.putImageData(grad, cbX, cbY);
    ctx.fillStyle = theme.mutedColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(spec.maxDb.toFixed(0) + ' dB', cbX + cbW + 2, cbY);
    ctx.textBaseline = 'bottom';
    ctx.fillText(spec.minDb.toFixed(0) + ' dB', cbX + cbW + 2, cbY + cbH);
    ctx.restore();
}

export interface SpectrumLineOpts {
    padL?: number;
    padR?: number;
    padT?: number;
    padB?: number;
    lineWidth?: number;
}

export function drawSpectrumLine(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    slice: SpectrumSliceLike,
    color: string,
    opts?: SpectrumLineOpts,
): void {
    const fBins = slice.frequencyBins;
    const range = slice.maxDb - slice.minDb;
    if (range <= 0) { return; }
    const padL = opts?.padL ?? 0;
    const padR = opts?.padR ?? 0;
    const padT = opts?.padT ?? 0;
    const padB = opts?.padB ?? 0;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    ctx.strokeStyle = color;
    ctx.lineWidth = opts?.lineWidth ?? 1.2;
    ctx.beginPath();
    for (let i = 0; i < fBins; i++) {
        const x = padL + (i / Math.max(fBins - 1, 1)) * plotW;
        const v = slice.values[i];
        const norm = Math.max(0, Math.min(1, (v - slice.minDb) / range));
        const y = padT + (1 - norm) * plotH;
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
}

export function drawSpectrumAxes(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    slice: SpectrumSliceLike,
    padL: number,
    padR: number,
    padT: number,
    padB: number,
    theme: DrawTheme = DEFAULT_THEME,
): void {
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB);
    ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB);
    ctx.stroke();
    ctx.fillStyle = theme.mutedColor;
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(slice.maxDb.toFixed(0) + ' dB', padL - 2, padT);
    ctx.textBaseline = 'middle';
    ctx.fillText(((slice.maxDb + slice.minDb) / 2).toFixed(0) + ' dB', padL - 2, padT + plotH / 2);
    ctx.textBaseline = 'bottom';
    ctx.fillText(slice.minDb.toFixed(0) + ' dB', padL - 2, H - padB);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0 Hz', padL, H - 1);
    ctx.fillText(formatHz(slice.maxFrequencyHz / 2), padL + plotW / 2, H - 1);
    ctx.fillText(formatHz(slice.maxFrequencyHz), W - padR, H - 1);
}
