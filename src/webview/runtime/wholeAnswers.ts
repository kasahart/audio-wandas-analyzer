/**
 * The backend answers whose numbers are of the full data by the protocol, given their `Whole` type (provenance.ts).
 *
 * A readout, a headline, a range or an order takes only `Whole`. A number becomes one in two places: fullRead.ts
 * (a full read's points; arrays a caller holds every value of) and here, where each function names the protocol
 * field it trusts and why. Add one here when the backend starts sending a new number it takes of every value; say
 * in its comment which Python function takes it. Nothing else may mint (provenanceBoundary.test.ts).
 */
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { PairSpectrumResponse } from '../../shared/protocol/generated/backendProtocolSchema';
import type { Drawn, Whole } from '../../shared/provenance';
import { claimMint } from '../../shared/wholeMint';
import { localLine, type InlineFullSource } from './fullRead';

/** This module's mint (wholeMint.ts): claimed once, used only in the adapters below, never handed on. */
const mint = claimMint('wholeAnswers');

/**
 * A scan's arrays of every value: each channel's level, every FFT bin (`spectrumBinsDb`) and every 1/3-octave band
 * (`thirdOctDb`), which scan_service takes of the whole recording. Never its `spectrumDb` (192 points to draw).
 */
export function scanWhole<K extends 'leqDbA' | 'peakHz' | 'spectrumBinsDb' | 'thirdOctDb' | 'crest'>(result: Pick<ScanResult, K>, name: K) {
    return mint.every('ScanResult', result, name);
}

/** A pair response's every bin (pair_spectrum sends each curve whole; the webview thins it only to draw). */
export function pairWhole<K extends 'gainDb' | 'phaseRad' | 'coherence'>(response: Pick<PairSpectrumResponse, K>, name: K) {
    return mint.every('PairSpectrumResponse', response, name);
}

/** A band table's bars, which the backend sends whole (every band, none thinned): read from their every value. */
export function wholeBars(view: StageView | null | undefined): InlineFullSource | undefined {
    return view?.kind === 'bar' ? localLine(view.xs ?? [], mint.everyValue(view.values ?? [])) : undefined;
}

/** Where a Δ is largest and its value there (stage_combine.difference_peak): found among every value before thinning (R2). */
export function backendPeak(view: StageView): { x: Whole; y?: Whole; value: Whole; xStep?: number; yStep?: number } | undefined {
    const peak = view.peak;
    if (!peak) return undefined;
    return { x: mint.field(peak, 'x'), value: mint.field(peak, 'value'), ...(peak.y !== undefined ? { y: mint.field(peak, 'y') } : {}), ...(peak.xStep !== undefined ? { xStep: peak.xStep } : {}), ...(peak.yStep !== undefined ? { yStep: peak.yStep } : {}) };
}

/**
 * A cursor-spectrum slice's values when they are every bin of it (or every band): the backend sends a slice whole
 * unless it cut it for display, which it marks with `frequenciesHz`. null for a cut slice and for a stand-in (drawn
 * while the real slice is on its way: none of its values is a bin). What a slice's readout, order and CSV take.
 */
export function everyBin(slice: { values: readonly Drawn[]; frequenciesHz?: readonly number[]; bandCentersHz?: readonly number[]; standIn?: string }): Whole[] | null {
    if (slice.standIn) return null;
    if (slice.frequenciesHz && !slice.bandCentersHz?.length) return null;
    return mint.everyBin(slice.values);
}
