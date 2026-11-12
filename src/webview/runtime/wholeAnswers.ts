/**
 * The backend answers whose numbers are of the full data by the protocol, given their `Whole` type (provenance.ts).
 *
 * A readout, a headline, a range or an order takes only `Whole`. A number becomes one in two places: fullRead.ts
 * (a full read's points; arrays a caller holds every value of) and here, where each function names the protocol
 * field it trusts and why. Add one here when the backend starts sending a new number it takes of every value; say
 * in its comment which Python function takes it. Nothing else may mint (provenanceBoundary.test.ts).
 */
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { PairSpectrumResponse, SpectrumSliceChannel } from '../../shared/protocol/generated/backendProtocolSchema';
import type { Whole, WholeLine } from '../../shared/provenance';
import { claimMint } from '../../shared/wholeMint';

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

/** Where a Δ is largest and its value there (stage_combine.difference_peak): found among every value before thinning (R2). */
export function backendPeak(view: StageView): { x: Whole; y?: Whole; value: Whole; xStep?: number; yStep?: number } | undefined {
    const peak = view.peak;
    if (!peak) return undefined;
    return { x: mint.field(peak, 'x'), value: mint.field(peak, 'value'), ...(peak.y !== undefined ? { y: mint.field(peak, 'y') } : {}), ...(peak.xStep !== undefined ? { xStep: peak.xStep } : {}), ...(peak.yStep !== undefined ? { yStep: peak.yStep } : {}) };
}

/**
 * A cursor-spectrum slice's every bin (or every band), what its readout, order and CSV take: the channel's `bins`,
 * which the schema marks `x-whole` and analysis_service.spectrum_slice sends only for a row it did not cut for
 * display. null for a cut slice (it has no `bins`: read it again at every bin) and for a stand-in (drawn while the
 * real slice is on its way: none of its values is a bin). Never the slice's `values`, which are drawn points
 * (`x-drawn`) even when they happen to be every bin (display rules R7).
 */
export function everyBin(slice: Pick<SpectrumSliceChannel, 'bins'> & { standIn?: string }): WholeLine<Whole> | null {
    if (slice.standIn) return null;
    return mint.every('SpectrumSliceChannel', slice, 'bins') ?? null;
}
