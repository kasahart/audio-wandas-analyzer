import type { UiStrings } from '../../shared/i18n/strings';
import type { PairSpectrumPublication } from '../../shared/session/comparisonSessionController';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { formatHz, frequencyAxisTicks, type CanvasDrawCtx, type DrawTheme, type FrequencyScale } from '../draw/canvasDrawers';
import { hintAttr } from './hintFooter';
import type { TrackId } from './types';

export type PairSpectrumResultMessage = Extract<PairSpectrumPublication, { type: 'pair-spectrum-result' }>;
export type PairSpectrumResponse = PairSpectrumResultMessage['responses'][number];

export interface PairReference {
    trackId: TrackId;
    channelIndex: number;
}

/** One response channel as the pair view draws and labels it. */
export interface PairCurve {
    label: string;
    color: string;
    /** Set for a second channel of the same track, which shares its colour. */
    dashed?: boolean;
    response: PairSpectrumResponse;
}

export type PairStrings = Pick<UiStrings,
    | 'pairReferenceHint' | 'pairReferenceClearHint' | 'pairReferenceBadge' | 'pairAverages' | 'pairFewAveragesHint'
    | 'pairResampledHint' | 'pairNoOverlapHint' | 'pairTooShortHint' | 'pairOtherUnitHint' | 'pairPhaseLabel' | 'pairCoherenceLabel'>;

/** Below this many averages the γ² estimate is biased high enough to mislead. */
export const PAIR_FEW_AVERAGES = 8;

const REFERENCE_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">'
    + '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
    + '<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

export function referenceButtonHtml(trackId: string, channelIndex: number, strings: PairStrings): string {
    return '<button class="track-btn pair-ref-btn" data-action="set-pair-reference" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"'
        + hintAttr(strings.pairReferenceHint) + ' aria-label="' + escapeHtml(strings.pairReferenceHint) + '" aria-pressed="false">'
        + REFERENCE_ICON + '<span class="pair-ref-badge">' + escapeHtml(strings.pairReferenceBadge) + '</span></button>';
}

/** Marks the reference lane's button and returns whether any button matched. */
export function syncReferenceButtons(root: ParentNode, reference: PairReference | null, strings: PairStrings): boolean {
    let found = false;
    root.querySelectorAll<HTMLElement>('[data-action="set-pair-reference"]').forEach(button => {
        const active = !!reference && button.getAttribute('data-track-id') === reference.trackId
            && button.getAttribute('data-channel-index') === String(reference.channelIndex);
        found = found || active;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        const hint = active ? strings.pairReferenceClearHint : strings.pairReferenceHint;
        button.setAttribute('data-hint', hint);
        button.setAttribute('aria-label', hint);
    });
    return found;
}

/**
 * The responses that share one gain axis: ok ones whose level reference matches the first ok one.
 * A response calibrated to another unit stays in the legend but is not drawn on that axis.
 */
export function drawnPairCurves(curves: readonly PairCurve[]): PairCurve[] {
    const ok = curves.filter(curve => curve.response.status === 'ok');
    const axisLabel = ok[0]?.response.axisLabel;
    return ok.filter(curve => curve.response.axisLabel === axisLabel);
}

function formatSeconds(seconds: number): string {
    return seconds.toFixed(2);
}

export interface PairHeader {
    text: string;
    fewAverages: boolean;
}

/** e.g. `H1 · 32 avg · 1.00–3.00 s`; the averages are the fewest any drawn response used. */
export function pairHeader(curves: readonly PairCurve[], strings: PairStrings): PairHeader | null {
    const ok = drawnPairCurves(curves).map(curve => curve.response);
    if (ok.length === 0) {
        return null;
    }
    const averages = Math.min(...ok.map(response => response.averages));
    const start = Math.min(...ok.map(response => response.startSeconds));
    const end = Math.max(...ok.map(response => response.endSeconds));
    return {
        text: 'H1 · ' + strings.pairAverages.replace('{n}', String(averages)) + ' · ' + formatSeconds(start) + '–' + formatSeconds(end) + ' s',
        fewAverages: averages < PAIR_FEW_AVERAGES,
    };
}

export function pairLegendHtml(curves: readonly PairCurve[], strings: PairStrings): string {
    const drawn = new Set(drawnPairCurves(curves));
    return curves.map(curve => {
        const { response } = curve;
        const empty = !drawn.has(curve);
        const hint = response.status === 'no-overlap' ? strings.pairNoOverlapHint
            : response.status === 'too-short' ? strings.pairTooShortHint
                : empty ? strings.pairOtherUnitHint
                    : response.resampled ? strings.pairResampledHint : '';
        return '<span class="pair-legend-item' + (empty ? ' is-empty' : '') + '"' + (hint ? hintAttr(hint) : '') + '>'
            + '<span class="pair-legend-swatch" style="background:' + escapeHtml(curve.color) + '"></span>'
            + escapeHtml(curve.label) + (response.resampled && !empty ? '<span class="pair-legend-mark">≈</span>' : '')
            + '</span>';
    }).join('');
}

export const PAIR_SPECTRUM_PAD = { left: 40, right: 8, top: 6, bottom: 16, gap: 6 } as const;

interface PairRow {
    label: string;
    min: number;
    max: number;
    values(response: PairSpectrumResponse): readonly (number | null)[];
    format(value: number): string;
}

const DEGREES = 180 / Math.PI;

function gainRange(curves: readonly PairCurve[], bins: readonly number[]): { min: number; max: number } {
    let min = Infinity, max = -Infinity;
    curves.forEach(curve => bins.forEach(bin => {
        const value = curve.response.gainDb[bin];
        if (value !== null && value !== undefined) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }));
    if (!isFinite(min)) {
        return { min: -20, max: 20 };
    }
    // A flat response would otherwise collapse the axis; keep at least 6 dB around it.
    const center = (min + max) / 2;
    const half = Math.max(3, (max - min) / 2 * 1.1);
    return { min: center - half, max: center + half };
}

function pairRows(curves: readonly PairCurve[], bins: readonly number[], strings: PairStrings): PairRow[] {
    const gain = gainRange(curves, bins);
    const gainLabel = curves[0]?.response.axisLabel ?? 'Gain [dB]';
    return [
        { label: gainLabel, ...gain, values: response => response.gainDb, format: value => value.toFixed(1) },
        { label: strings.pairPhaseLabel, min: -180, max: 180, values: response => response.phaseRad.map(value => value === null ? null : value * DEGREES), format: value => value.toFixed(0) + '°' },
        { label: strings.pairCoherenceLabel, min: 0, max: 1, values: response => response.coherence, format: value => value.toFixed(2) },
    ];
}

export interface PairPaintInput {
    frequencyBins: number;
    maxFrequencyHz: number;
    curves: readonly PairCurve[];
}

export interface PairHoverReadout {
    frequencyHz: number;
    text: string;
    color: string;
}

function binFrequency(input: PairPaintInput, bin: number): number {
    return bin / Math.max(input.frequencyBins - 1, 1) * input.maxFrequencyHz;
}

/**
 * Gain, phase and γ² stacked on one shared frequency axis. `hoverFrequencyHz` draws a crosshair at
 * the nearest bin and returns the values of the first drawn response there.
 */
export function paintPairSpectrum(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    input: PairPaintInput,
    visible: FrequencyScale,
    hoverFrequencyHz: number | null,
    strings: PairStrings,
    theme: DrawTheme,
): PairHoverReadout | null {
    ctx.clearRect(0, 0, W, H);
    const pad = PAIR_SPECTRUM_PAD;
    const plotW = W - pad.left - pad.right;
    const rowH = (H - pad.top - pad.bottom - pad.gap * 2) / 3;
    const span = visible.frequencyMax - visible.frequencyMin;
    if (plotW <= 0 || rowH <= 4 || span <= 0 || input.frequencyBins <= 0) {
        return null;
    }
    const xOf = (hz: number) => pad.left + (hz - visible.frequencyMin) / span * plotW;
    const bins: number[] = [];
    for (let bin = 0; bin < input.frequencyBins; bin++) {
        const hz = binFrequency(input, bin);
        if (hz >= visible.frequencyMin && hz <= visible.frequencyMax) {
            bins.push(bin);
        }
    }
    const drawn = drawnPairCurves(input.curves);
    const rows = pairRows(drawn, bins, strings);
    ctx.font = '9px monospace';
    rows.forEach((row, index) => {
        const top = pad.top + index * (rowH + pad.gap);
        const yOf = (value: number) => top + (1 - Math.max(0, Math.min(1, (value - row.min) / (row.max - row.min)))) * rowH;
        ctx.strokeStyle = theme.lineColor;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(pad.left, top, plotW, rowH);
        ctx.fillStyle = theme.mutedColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(row.format(row.max), pad.left - 2, top);
        ctx.textBaseline = 'bottom';
        ctx.fillText(row.format(row.min), pad.left - 2, top + rowH);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(row.label, pad.left + 3, top + 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, top, plotW, rowH);
        ctx.clip();
        drawn.forEach(curve => {
            const values = row.values(curve.response);
            ctx.strokeStyle = curve.color;
            ctx.lineWidth = 1.2;
            ctx.setLineDash(curve.dashed ? [4, 2] : []);
            ctx.beginPath();
            let pen = false;
            bins.forEach(bin => {
                const value = values[bin];
                if (value === null || value === undefined) {
                    pen = false;
                    return;
                }
                const x = xOf(binFrequency(input, bin));
                const y = yOf(value);
                if (pen) {
                    ctx.lineTo(x, y);
                }
                else {
                    ctx.moveTo(x, y);
                    pen = true;
                }
            });
            ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.restore();
    });
    ctx.fillStyle = theme.mutedColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    frequencyAxisTicks(visible).forEach((tick, index, ticks) => {
        ctx.textAlign = index === 0 ? 'left' : index === ticks.length - 1 ? 'right' : 'center';
        ctx.fillText(tick.text, pad.left + tick.fraction * plotW, H - 1);
    });
    if (hoverFrequencyHz === null || bins.length === 0) {
        return null;
    }
    const bin = bins.reduce((best, candidate) =>
        Math.abs(binFrequency(input, candidate) - hoverFrequencyHz) < Math.abs(binFrequency(input, best) - hoverFrequencyHz) ? candidate : best, bins[0]);
    const frequencyHz = binFrequency(input, bin);
    const x = xOf(frequencyHz);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, H - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    const first = drawn[0];
    if (!first) {
        return null;
    }
    const parts = rows.map(row => {
        const value = row.values(first.response)[bin];
        return value === null || value === undefined ? '–' : row.format(value);
    });
    return { frequencyHz, text: first.label + ' / ' + formatHz(frequencyHz) + ' / ' + parts[0] + ' dB / ' + parts[1] + ' / γ² ' + parts[2], color: first.color };
}
