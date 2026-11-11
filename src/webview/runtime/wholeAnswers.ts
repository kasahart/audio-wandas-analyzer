/**
 * The backend answers whose numbers are of the full data by the protocol, given their `Whole` type (provenance.ts).
 *
 * A readout, a headline, a range or an order takes only `Whole`. A number becomes one in two places: fullRead.ts
 * (a full read's points; arrays a caller holds every value of) and here, where each function names the protocol
 * field it trusts and why. Add one here when the backend starts sending a new number it takes of every value; say
 * in its comment which Python function takes it. Nothing else may mint (provenanceBoundary.test.ts).
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { Drawn, Whole } from '../../shared/provenance';
import { mintWhole, mintWholeBins, mintWholeDrawn } from '../../shared/wholeMint';
import { localLine, type InlineFullSource } from './fullRead';

/** A band table's bars, which the backend sends whole (every band, none thinned): read from their every value. */
export function wholeBars(view: StageView | null | undefined): InlineFullSource | undefined {
    return view?.kind === 'bar' ? localLine(view.xs ?? [], mintWholeDrawn(view.values ?? [])) : undefined;
}

/** Where a Δ is largest and its value there (stage_combine.difference_peak): found among every value before thinning (R2). */
export function backendPeak(view: StageView): { x: Whole; y?: Whole; value: Whole; xStep?: number; yStep?: number } | undefined {
    const peak = view.peak;
    if (!peak) return undefined;
    return { x: mintWhole(peak.x), value: mintWhole(peak.value), ...(peak.y !== undefined ? { y: mintWhole(peak.y) } : {}), ...(peak.xStep !== undefined ? { xStep: peak.xStep } : {}), ...(peak.yStep !== undefined ? { yStep: peak.yStep } : {}) };
}

/**
 * A cursor-spectrum slice's values when they are every bin of it (or every band): the backend sends a slice whole
 * unless it cut it for display, which it marks with `frequenciesHz`. null for a cut slice and for a stand-in (drawn
 * while the real slice is on its way: none of its values is a bin). What a slice's readout, order and CSV take.
 */
export function everyBin(slice: { values: readonly Drawn[]; frequenciesHz?: readonly number[]; bandCentersHz?: readonly number[]; standIn?: string }): Whole[] | null {
    if (slice.standIn) return null;
    if (slice.frequenciesHz && !slice.bandCentersHz?.length) return null;
    return mintWholeBins(slice.values);
}
