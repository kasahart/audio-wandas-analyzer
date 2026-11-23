import type { UiStrings } from '../../shared/i18n/strings';
import type { PairSpectrumPublication } from '../../shared/session/comparisonSessionController';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { secondsSpanText } from '../shell/numberText';
import type { TrackId } from './types';

/** The pair figure's answers as the host tells them: each response's three kept lines' keys, no value of a line. */
export type PairAnswersMessage = Extract<PairSpectrumPublication, { type: 'pair-answers-result' }>;
export type PairAnswer = PairAnswersMessage['responses'][number];

export interface PairReference {
    trackId: TrackId;
    channelIndex: number;
}

/** One response channel as the pair view names it beside its figure. */
export interface PairCurve {
    /** The channel's id in the figure's spec (charts/cursorSpectrum.ts cursorLineId). */
    id: string;
    label: string;
    color: string;
    response: PairAnswer;
    /**
     * Whether the figure has its gain line: false for a response with no lines (no overlap, too short) and for one the
     * figure service left off the gain axis (another unit's ratio than the axis's). Read from what the Figure drew.
     */
    drawn: boolean;
}

export type PairStrings = Pick<UiStrings,
    | 'pairReferenceHint' | 'pairReferenceClearHint' | 'pairReferenceBadge' | 'pairAverages' | 'pairFewAveragesHint'
    | 'pairResampledHint' | 'pairNoOverlapHint' | 'pairTooShortHint' | 'pairOtherUnitHint'>;

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
 * The responses on the gain axis. One the figure service left off it (another unit's ratio) stays in the legend,
 * not drawn on the axis's numbers.
 */
export function drawnPairCurves(curves: readonly PairCurve[]): PairCurve[] {
    return curves.filter(curve => curve.response.status === 'ok' && curve.drawn);
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
