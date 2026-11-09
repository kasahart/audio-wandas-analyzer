import type { UiStrings } from '../../shared/i18n/strings';
import type { PairSpectrumPublication } from '../../shared/session/comparisonSessionController';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { FrequencyScale } from '../draw/canvasDrawers';
import { hintAttr } from './hintFooter';
import { levelBinsOf, type StageLayer } from './stagePanes';
import { dataRange, gainAxisLines, gainAxisName, gainUnit, plainNames, plainRange, plainTitle, type FigureNames, type FigureRange } from './figureModel';
import { localLine } from './fullRead';
import { secondsSpanText } from '../plot/plotText';
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
    | 'pairResampledHint' | 'pairNoOverlapHint' | 'pairTooShortHint' | 'pairOtherUnitHint' | 'pairPhaseLabel' | 'pairCoherenceLabel' | 'axisFrequency'
    | 'axisGain' | 'axisTransferLevel'>;

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
    return gainAxisLines(curves.filter(curve => curve.response.status === 'ok'));
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
        text: 'H1 · ' + strings.pairAverages.replace('{n}', String(averages)) + ' · ' + secondsSpanText(start, end),
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

const DEGREES = 180 / Math.PI;

function gainRange(curves: readonly PairCurve[], bins: readonly number[]): FigureRange {
    let min = Infinity, max = -Infinity;
    curves.forEach(curve => bins.forEach(bin => {
        const value = curve.response.gainDb[bin];
        if (value !== null && value !== undefined) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }));
    if (!isFinite(min)) {
        return plainRange(-20, 20);
    }
    // The dB line rule every level and gain axis keeps (R9: 5, 10, 20 or 25 dB steps, at most 100 dB under the top),
    // the very function the comparison's step of the same transfer function is ranged by, from every bin on screen.
    return dataRange([gainSpan(min, max)]);
}

/** A gain line's span as stageRange reads it: every bin's lowest and highest. */
export function gainSpan(min: number, max: number): StageView {
    return { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'gain', xs: [], values: [], valueRange: { min, max } };
}

export interface PairPaintInput {
    frequencyBins: number;
    maxFrequencyHz: number;
    curves: readonly PairCurve[];
}

/** Which of the pair view's plots: the gain, the phase and γ², stacked on one frequency axis. */
export const PAIR_LANES = ['gain', 'phase', 'coherence'] as const;
export type PairLaneKey = typeof PAIR_LANES[number];

/** One of the pair view's plots, as the plot component draws it (stagePanes.paintOverlay): its axes, range and lines. */
export interface PairLane {
    key: PairLaneKey;
    axes: FigureNames;
    range: FigureRange;
    layers: StageLayer[];
}

function binFrequency(input: PairPaintInput, bin: number): number {
    return bin / Math.max(input.frequencyBins - 1, 1) * input.maxFrequencyHz;
}

/**
 * The gain, phase and γ² of each drawn response, as three plots on one linear frequency axis (0 to the
 * reference's Nyquist). The gain axis fits the gains in `visible`; the phase is ±180°, γ² 0 to 1. Every bin is
 * kept and the lines join them all, so each pixel column shows its lowest and highest bin (R1, R2).
 */
export function pairLanes(input: PairPaintInput, visible: FrequencyScale, strings: PairStrings): PairLane[] {
    const drawn = drawnPairCurves(input.curves);
    const xs = Array.from({ length: input.frequencyBins }, (_, bin) => binFrequency(input, bin));
    const shown = xs.flatMap((hz, bin) => (hz >= visible.frequencyMin && hz <= visible.frequencyMax ? [bin] : []));
    const lines = (values: (response: PairSpectrumResponse) => readonly (number | null)[], quantity: StageView['quantity'], unit: string): StageLayer[] =>
        drawn.map(curve => ({
            view: {
                frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity, unit, xs, values: [...values(curve.response)],
                // A gain is ordered among the responses by every bin's power (R6); a phase or γ² is not a level.
                // Over the frequencies on screen: every bin is in hand, so it is measured again at every zoom.
                ...(quantity === 'gain' && xs.length ? { levelBins: levelBinsOf(xs, values(curve.response), visible.frequencyMax > visible.frequencyMin ? [visible.frequencyMin, visible.frequencyMax] : [xs[0], xs[xs.length - 1]], false) } : {}),
            },
            color: curve.color,
            label: curve.label,
            // Read from every bin of the response, which the webview holds (R7).
            full: localLine(xs, [...values(curve.response)]),
            ...(curve.dashed ? { dash: [4, 2] } : {}),
        }));
    return [
        { key: 'gain', axes: plainNames(plainTitle(strings, 'axisFrequency'), gainAxisName(drawn[0]?.response, strings)), range: gainRange(drawn, shown), layers: lines(response => response.gainDb, 'gain', gainUnit(drawn[0]?.response)) },
        { key: 'phase', axes: plainNames(plainTitle(strings, 'axisFrequency'), plainTitle(strings, 'pairPhaseLabel')), range: plainRange(-180, 180), layers: lines(response => response.phaseRad.map(value => (value === null ? null : value * DEGREES)), 'value', '°') },
        { key: 'coherence', axes: plainNames(plainTitle(strings, 'axisFrequency'), plainTitle(strings, 'pairCoherenceLabel')), range: plainRange(0, 1), layers: lines(response => response.coherence, 'coherence', 'γ²') },
    ];
}
