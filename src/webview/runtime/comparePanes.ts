/**
 * The comparison's model and panes: the base (a condition's median or one file), the compared
 * file and their difference, each as a region-average spectrum on one frequency axis. Pure apart
 * from `paintPane`, which only draws.
 */
import { scanWhole } from './wholeAnswers';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import type { Drawn, Whole, WholeLine } from '../../shared/provenance';
import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { uncalibratedUnits } from '../../shared/utils/format';
import { BAND_CENTERS_HZ, bandLabel, HEADLINE_WITHIN_DB, quantile, levelDelta } from './entryTable';
import { baseName } from '../../shared/analysis/entryMetadata';
import { median } from '../../shared/dataset/distribution';
import { powerMeanDb, powerMeanOrNull } from '../../shared/utils/levels';
import { axisValueAt, levelBinsOf } from './stagePanes';
import { computedLine, gapsLine, heldValueRange, localLine, type InlineFullSource } from './fullRead';
import { noNegativeZero, signedNumberText, withMinus } from '../plot/plotText';
import { excludedFor, levelKeyOf, medianInputOf, setExclusionText, type FigureSet } from './figureModel';
import type { Answer } from './answerTypes';

type ScanOk = ScanResult & { ok: true };

/** Every FFT bin of a spectrum (no gaps), held whole. */
type BinLine = WholeLine<Whole>;

export interface CompareSide {
    /** Card and pane title: the file name, or "Base group · L3 · 900rpm · 7 files". */
    title: string;
    filePaths: string[];
    /** The Welch spectrum's every bin (channels power-averaged), when the scan gave them: the median and Δ are taken of these. */
    bins?: BinLine;
    leq: number;
    /** Every 1/3-octave band's level, of the scan's every band (full data: what the bars read, R7). */
    bands: WholeLine;
    /** Its levels' reference as wandas names it ("dBFS", "dB SPL re 20 µPa"): one for a group, whose median is of one unit. */
    levelLabel?: string;
    /** Its levels' identity (levelIdentityOf: unit, reference value, label): two sides share a reference only by this. */
    levelKey?: string;
    /** Uncalibrated: its scan's (a group: any of its recordings') calibration status is not calibrated (R4). */
    uncalibrated?: boolean;
    /** A group of three or more files: its lower and upper quartiles, band by band. */
    spread?: { bands: [(number | null)[], (number | null)[]] };
}

export interface CompareModel {
    base: CompareSide | null;
    compare: CompareSide | null;
    /**
     * Whether the two sides have a difference: both are there and nothing blocks it. The scans' 192-point spectra are
     * drawn points (scan_service.log_spectrum), so no median or Δ is ever taken of them: only of `bins` and the bands.
     */
    comparable: boolean;
    /**
     * The same at full resolution, bin by bin (bin k at k × hz): the base (one file, or the median per bin of a group),
     * the compared file and their difference. Drawn by `binsView`, which decimates only the result. Null where a
     * scan did not give its bins or the files' bins differ (another sample rate or n_fft).
     */
    bins: { hz: number; nyquist: number; base: BinLine | null; compare: BinLine | null; diff: BinLine | null } | null;
    /** Frequency of each of the scan's SPECTRUM_POINTS spectrum points: log-spaced from 20 Hz to Nyquist (analysis spec v4). */
    frequencies: number[];
    /** Both levels and their difference, taken of the levels before any rounding (R1: only writing rounds). */
    leq: { base: number; compare: number; delta: number } | null;
    /** The three 1/3-octave bands that differ most, largest |Δ| first; only peaks, not a peak's neighbours. */
    topBands: Array<{ band: number; delta: number }>;
    /** Δ per 1/3-octave band (null where either side has none), drawn as steps under the Δ curve. */
    bandDeltas: WholeLine;
    /**
     * Why there is no Δ to read: the base is the compared file itself, a group of that one file, or
     * a base averaged over the entry region while the compare is over the comparison's, or a base in another unit,
     * level reference or calibration than the compared file (levels of two units have no difference, as the
     * backend's noDelta 'unit'). D and the report are off while it is set.
     */
    /** 'empty': the base's set counts no recording, each one left out with why (never said as a group of one). */
    blocked?: 'self' | 'single' | 'region' | 'unit' | 'empty';
    /** A file of the compare or its base has no result yet (a scan is running): nothing here is settled. */
    pending?: boolean;
    /** The base's one figure set: its n, files and what it left out with why (null: no base asked). */
    baseSet: FigureSet<ScanOk> | null;
    /** The compared recording's value as compared (its ready answer's). */
    compareResult?: ScanOk;
}

export type CompareStrings = Pick<UiStrings, 'axisUncalibrated' | 'axisUnitUnknown' | 'compareLevelsAt' | 'compareDiffShow' | 'compareDiffHide' | 'hintDiffToggle' | 'entryBaseGroup' | 'entryBase' | 'entryCount' | 'compareKeyHold' | 'compareKeyBack' | 'comparePlay' | 'compareDelta' | 'compareNotEntry' | 'comparePending' | 'compareBaseEntryRegion' | 'compareReport' | 'reportSaved' | 'compareSelfBase' | 'compareSingleBase' | 'compareEmptyBase' | 'dsBaseFailed' | 'dsBaseEmpty' | 'dsBaseOtherChannels' | 'dsBaseMissing' | 'dsBasePending' | 'dsBaseStale' | 'dsBaseOtherUnits' | 'dsBaseOtherBins' | 'dsBaseNoIdentity' | 'compareRegionDiffers' | 'compareUnitDiffers' | 'hintBaseCard' | 'hintSlotCard' | 'hintRegionMark' | 'hintCompareMark' | 'compareNoSignificant' | 'slotEmpty'>;

/** A band's |Δ| under this (dB) reads 0.0 at the tenth a level is shown to: no difference to head the list. */
const SHOWN_ZERO_DB = 0.05;

/** A band's Δ must exceed this (dB), or 3 MAD of the condition's files where there are enough, to head the list. */
export const MIN_HEADLINE_DB = 1.5;

/** The median of levels there are some of (NaN for none, which callers never pass). */
const medianOfSome = (values: readonly number[]): number => median(values) ?? Number.NaN;

/** Per band, 3 MAD of these files' levels (scaled to σ), at least MIN_HEADLINE_DB. */
function spreadOf(memberBands: ReadonlyArray<readonly (number | null)[]>): number[] {
    return BAND_CENTERS_HZ.map((_, band) => {
        const levels = memberBands.map(bands => bands[band]).filter((level): level is number => level !== null);
        if (levels.length < 2) return MIN_HEADLINE_DB;
        const center = medianOfSome(levels);
        return Math.max(3 * medianOfSome(levels.map(level => Math.abs(level - center))) * 1.4826, MIN_HEADLINE_DB);
    });
}

/** The spectrum's lowest edge (analysis_spec.SPECTRUM_MIN_HZ); its points are log-spaced up to Nyquist. */
export const SPECTRUM_MIN_HZ = 20;
/** How many log-spaced points a scan's spectrum has (analysis_spec.SPECTRUM_POINTS). */
export const SPECTRUM_POINTS = 192;

/** Each spectrum point's frequency: the geometric centre of its log-spaced edges. */
export function spectrumFrequencies(nyquist: number, points: number): number[] {
    if (!(nyquist > SPECTRUM_MIN_HZ) || points < 1) return [];
    const ratio = (nyquist / SPECTRUM_MIN_HZ) ** (1 / points);
    return Array.from({ length: points }, (_, index) => SPECTRUM_MIN_HZ * ratio ** (index + 0.5));
}

/** Nyquist back from the points' centres, for the axis' right edge. */
function topEdge(frequencies: readonly number[]): number {
    const n = frequencies.length;
    if (!n) return 0;
    return SPECTRUM_MIN_HZ * (frequencies[n - 1] / SPECTRUM_MIN_HZ) ** (n / (n - 0.5));
}

/** One spectrum, Leq and band row per file: channels are power-averaged, as in the entry table. */
function fileSide(result: ScanOk): Omit<CompareSide, 'title' | 'filePaths'> {
    // A scan that succeeded carries its metrics; one without them has no levels to give. Its 192-point spectrum is
    // drawn points (scan_service.log_spectrum) and is never read: every level here is of full data (R1).
    // Its bins and bands come in as full data (wholeAnswers.scanWhole: the schema's x-whole arrays), and a mean over
    // channels of them is full data too (computedLine maps every bin of the first channel, reading the others at it).
    const [binRow, ...binRows] = scanWhole(result, 'spectrumBinsDb') ?? [];
    const [bandRow, ...bandRows] = scanWhole(result, 'thirdOctDb') ?? [];
    return {
        ...(binRow ? { bins: computedLine(binRow, (level, bin) => powerMeanDb([level, ...binRows.map(row => row[bin])])) } : {}),
        leq: powerMeanDb(result.leqDbA ?? []),
        // One level per band of the scan's band table (scan_service: one per THIRD_OCTAVE_CENTERS_HZ, the app's
        // BAND_CENTERS_HZ), a band it has none for a gap: the line is as long as the row it is computed of (R7).
        bands: bandRow ? computedLine(bandRow, (level, band) => powerMeanOrNull([level, ...bandRows.map(row => row[band])])) : gapsLine(BAND_CENTERS_HZ.length),
        ...(result.input ? { levelLabel: result.input.levelReferenceLabel, levelKey: levelKeyOf(result.input) } : {}),
        ...(result.input && result.input.calibrationStatus !== 'calibrated' ? { uncalibrated: true } : {}),
    };
}

/**
 * What levels are in (display-rules R1, R4): the unit, the reference value and the level reference's label, the one
 * definition the backend keeps too (python-backend/level_identity.py; both held to
 * src/test/fixtures/levelIdentityCases.json). Calibration status is not part of it: a gain-corrected file in FS and a
 * raw one are both in dBFS and compare; each line still says its own status where it is read.
 */
export function levelIdentityOf(input: Pick<LevelInput, 'unit' | 'ref' | 'levelReferenceLabel'>): string {
    return JSON.stringify([input.unit ?? '', Number(input.ref ?? 1), input.levelReferenceLabel ?? '']);
}

/**
 * The median of a figure set's recordings as a base: each one spectrum, Leq and band row (channels power-averaged),
 * and the median of those; null when the set has none. It takes only a FigureSet, so the median is of the very
 * recordings the set counts, names and writes: the comparison's base, the distribution's base line and a fixed Δ.
 */
export function setMedian(set: FigureSet<ScanOk>): Omit<CompareSide, 'title' | 'filePaths'> | null {
    const sides = set.used.map(item => fileSide(item.value));
    // What the median is in, and whether it is calibrated, is the figure model's (medianInputOf: calibrated only when
    // every recording it is of is), never decided here.
    return sides.length ? sides.length === 1 ? sides[0] : medianSide(sides, medianInputOf(set.used.map(item => item.value.input))) : null;
}

function medianSide(sides: Array<Omit<CompareSide, 'title' | 'filePaths'>>, input: LevelInput | undefined): Omit<CompareSide, 'title' | 'filePaths'> {
    const bandsAt = (p: number): (number | null)[] => BAND_CENTERS_HZ.map((_, band) => {
        const levels = sides.map(side => side.bands[band]);
        return levels.some(level => level === null) ? null : quantile(levels as number[], p);
    });
    const spread = sides.length >= 3 ? {
        bands: [bandsAt(0.25), bandsAt(0.75)] as [(number | null)[], (number | null)[]],
    } : undefined;
    // Every bin's median, where every file has the same bins (the same sample rate and n_fft).
    const first = sides[0].bins;
    const everyBins = sides.flatMap(side => (side.bins && side.bins.length === first?.length ? [side.bins] : []));
    const bins = first && everyBins.length === sides.length ? computedLine(first, (value, bin) => medianOfSome([value, ...everyBins.slice(1).map(line => line[bin])])) : undefined;
    return {
        ...(spread ? { spread } : {}),
        ...(bins ? { bins } : {}),
        ...(input ? { levelLabel: input.levelReferenceLabel, levelKey: levelKeyOf(input) } : {}),
        ...(input?.calibrationStatus !== 'calibrated' ? { uncalibrated: true } : {}),
        leq: medianOfSome(sides.map(side => side.leq)),
        bands: computedLine(sides[0].bands, (level, band) => {
            const levels = [level, ...sides.slice(1).map(side => side.bands[band] ?? null)];
            return levels.some(each => each === null) ? null : medianOfSome(levels as number[]);
        }),
    };
}

/**
 * What a comparison is of, each part one figure set (figureModel.figureUsed) of the compared recording's identity:
 * the compared recording's answer, and its base: one file (slot 0: its own answer, the set it is counted in and the
 * set of its condition's other recordings, which tell how far files differ by chance), or a group's set.
 */
export interface CompareInput {
    compared: Answer<ScanOk> | undefined;
    base:
        | { kind: 'file'; answer: Answer<ScanOk>; set: FigureSet<ScanOk>; peers: FigureSet<ScanOk> }
        | { kind: 'group'; set: FigureSet<ScanOk>; title: string }
        | null;
}

/**
 * The comparison for one compared file against its base. Every number of it (the base's median, its n and files,
 * the band spread that picks the headline bands, the bins) is of the sets it is given: none is gathered here.
 */
export function buildCompareModel(
    input: CompareInput,
    strings: CompareStrings,
    /** The base group kept the entry table's region while the compared file has the comparison's. */
    entryRegionBase = false,
    /** How far below the loudest band a band may be and still head the list (Infinity: no limit). */
    headlineWithinDb = HEADLINE_WITHIN_DB,
): CompareModel {
    const comparedAnswer = input.compared;
    const comparePath = comparedAnswer?.identity.path ?? null;
    const compared = comparedAnswer?.state === 'ready' ? comparedAnswer.value : undefined;
    const compare: CompareSide | null = compared && comparePath ? { title: baseName(comparePath), filePaths: [comparePath], ...fileSide(compared) } : null;
    let base: CompareSide | null = null;
    let baseSet: FigureSet<ScanOk> | null = null;
    /** The compared file is the only one of its condition: there is nothing to measure it against. */
    let loneGroup = false;
    /** Per band, how far a file of the base's condition typically sits from it by chance (3 MAD, at least 1.5 dB). */
    let bandSpread: number[] | null = null;
    const spreadFrom = (set: FigureSet<ScanOk>): number[] => (set.n >= 3 ? spreadOf(set.used.map(item => fileSide(item.value).bands)) : BAND_CENTERS_HZ.map(() => MIN_HEADLINE_DB));
    let single: ScanOk | undefined;
    let basePath: string | null = null;
    const of = input.base;
    if (of?.kind === 'file') {
        basePath = of.answer.identity.path;
        baseSet = of.set;
        // Slot 0's own value is shown even when its reference differs (a blocked Δ still shows both levels), never counted then.
        single = of.answer.state === 'ready' ? of.answer.value : undefined;
        // Its file is named (its reference too, on its own axis); what it counts is its set's (n 0 when withheld).
        if (single) base = { title: `${strings.entryBase} · ${baseName(basePath)}`, filePaths: [basePath], ...fileSide(single) };
        if (single) bandSpread = spreadFrom(of.peers);
    } else if (of?.kind === 'group' && comparePath) {
        baseSet = of.set;
        const middle = setMedian(of.set);
        if (middle) {
            bandSpread = spreadFrom(of.set);
            // The base names the recordings its median is of: its set's, never a failed, stale or still-scanning one.
            base = { title: of.title, filePaths: [...of.set.paths], ...middle };
        // n=1 only when the compared recording is truly the only one of its group: none left out for any reason.
        } else loneGroup = !of.set.excluded.length;
    }
    const otherReference = !!baseSet && excludedFor(baseSet, 'other-reference') > 0 && (of?.kind === 'file' || !baseSet.n);
    // Nothing settled while the compared recording or a base recording is still being asked for.
    const waiting = (state: string | undefined): boolean => state === 'pending' || state === 'missing';
    const pending = !!comparePath && (waiting(comparedAnswer?.state) || (!!baseSet && excludedFor(baseSet, 'pending', 'missing') > 0));
    const fs = (compared ?? single)?.input?.fs ?? 0;
    const frequencies = spectrumFrequencies(fs / 2, SPECTRUM_POINTS);
    const sameFile: CompareModel['blocked'] = loneGroup && compare ? 'single'
        : !base || !compare ? undefined
            : single && basePath === comparePath ? 'self'
                : !single && entryRegionBase ? 'region' : undefined;
    // Levels of another level identity than the compared file's have no difference (nor a median): blocked 'unit'.
    // A group whose set counts none, each left out with why (failed, another axis, stale …): no base, said so.
    const emptyGroup = of?.kind === 'group' && !base && !loneGroup && !otherReference && !pending && !!compare;
    // Slot 0 shown but not counted for any other reason (another frequency axis, R1): its set's n is 0, so there is no
    // Δ of it either, said with why, as a group's empty set is; never a Δ beside an n of 0.
    const withheldFile = of?.kind === 'file' && !!single && !!baseSet && !baseSet.n && !otherReference && !pending && !!compare;
    const blocked: CompareModel['blocked'] = sameFile ?? (compared && otherReference ? 'unit' : emptyGroup || withheldFile ? 'empty' : undefined);
    const baseSide: CompareSide | null = base;
    const comparable = !blocked && !!baseSide && !!compare;
    const baseValues = single ? [single] : baseSet ? baseSet.used.map(item => item.value) : [];
    const bins = binsOf(compared, baseValues, base, compare, comparable, fs / 2);
    const leq = comparable ? { base: baseSide.leq, compare: compare.leq, delta: levelDelta(compare.leq, baseSide.leq) } : null;
    const bandDeltas = comparable
        ? computedLine(compare.bands, (level, band) => {
            const reference = baseSide.bands[band] ?? null;
            return level === null || reference === null ? null : levelDelta(level, reference);
        })
        : gapsLine();
    // A strong tone leaks into the filters of the bands beside it; a band whose neighbour differs more
    // is that leak, so only the peaks of |Δ| across bands are headline material.
    const size = (band: number): number => Math.abs(bandDeltas[band] ?? 0);
    // A band where both files are far below the loudest band is not what is heard: 20 → 30 dB under a
    // 60 dB band does not head the list, 60 → 65 dB does.
    const louder = (band: number): number => Math.max(base?.bands[band] ?? -Infinity, compare?.bands[band] ?? -Infinity);
    const loudest = comparable ? Math.max(...BAND_CENTERS_HZ.map((_, band) => (bandDeltas[band] === null ? -Infinity : louder(band)))) : -Infinity;
    const quiet = (band: number): boolean => louder(band) < loudest - headlineWithinDb;
    // Against a group, a band within the group's own spread is noise, not a finding: it is not headline material.
    const withinSpread = (band: number): boolean => !!bandSpread && size(band) <= bandSpread[band];
    const topBands = bandDeltas.flatMap((delta, band) => (delta === null || size(band) < SHOWN_ZERO_DB || withinSpread(band) || quiet(band) || size(band) < size(band - 1) || size(band) < size(band + 1) ? [] : [{ band, delta }]))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    // A blocked Δ still shows both levels; only the difference is withheld.
    const levels = blocked && base && compare ? { base: base.leq, compare: compare.leq, delta: Number.NaN } : blocked ? null : leq;
    return {
        base, compare, comparable, bins, frequencies, leq: levels, topBands, bandDeltas, baseSet, ...(compared ? { compareResult: compared } : {}),
        ...(blocked ? { blocked } : {}), ...(pending ? { pending } : {}),
    };
}

/**
 * The comparison's bins: the base's and the compared file's, and their difference bin by bin. Every file's bins must
 * be in and alike (one spacing, one count), else there are none, and the 192 points are drawn instead.
 */
function binsOf(compared: ScanOk | undefined, baseValues: readonly ScanOk[], base: CompareSide | null, compare: CompareSide | null, comparable: boolean, nyquist: number): CompareModel['bins'] {
    const read = [...(compared ? [compared] : []), ...baseValues];
    const spacings = read.flatMap(result => (result.spectrumBinsDb ? [result.spectrumBinHz ?? 0] : []));
    const hz = spacings[0];
    if (!hz || spacings.length < read.length || !(nyquist > SPECTRUM_MIN_HZ) || spacings.some(spacing => Math.abs(spacing - hz) > 1e-9 * hz)) return null;
    const baseBins = base?.bins ?? null, compareBins = compare?.bins ?? null;
    if ((base && !baseBins) || (compare && !compareBins) || (baseBins && compareBins && baseBins.length !== compareBins.length)) return null;
    const diff = comparable && baseBins && compareBins ? computedLine(compareBins, (level, bin) => level - baseBins[bin]) : null;
    return { hz, nyquist, base: baseBins, compare: compareBins, diff };
}

/**
 * Whether two scans measured the same thing: the same version of the file, region, channels, calibration, unit and
 * Recipe (the backend's conditionId). Never judged from drawn values: equal 192 points say nothing of the bins.
 */
export function sameCondition(a: ScanResult | undefined, b: ScanResult | undefined): boolean {
    return !!a?.ok && !!b?.ok && typeof a.conditionId === 'string' && a.conditionId === b.conditionId;
}


/** The comparison draws a spectrum in this many log-spaced buckets from 20 Hz to Nyquist (stage_view.SPECTRUM_LINE_BUCKETS). */
export const SPECTRUM_LINE_BUCKETS = 640;

/**
 * A line in at most `buckets` buckets between `span`: each bucket's lowest and highest value, each at its own x
 * (stage_view.min_max_line), so a peak or a narrow difference keeps its height. The buckets are made in the scale of
 * the axis the line is drawn on (`scale`, the axis's own, never assumed: display rules R2): log-spaced on a log axis,
 * equally wide on a linear one, so a narrow peak high up a linear axis keeps its own pixel. Fewer values than two
 * per bucket are all kept; on a log axis x ≤ 0 is off the axis. A non-finite value is a gap, never joined across
 * (R2): between two points kept with a gap between them, the gap's first point is kept too, as a break (null).
 */
export function minMaxLine(xs: readonly number[], values: readonly number[], buckets: number, span: readonly [number, number], scale: 'linear' | 'log'): { xs: number[]; values: Array<Drawn | null> } {
    const count = Math.max(1, buckets);
    const [low, high] = [Math.min(...span), Math.max(...span)];
    const log = scale === 'log';
    const kept: number[] = [], gaps: number[] = [];
    for (let index = 0; index < xs.length; index++) {
        if (!(xs[index] >= low && xs[index] <= high) || (log && !(xs[index] > 0))) continue;
        (Number.isFinite(values[index]) ? kept : gaps).push(index);
    }
    let picked = kept;
    if (kept.length > 2 * count) {
        const width = log ? Math.log(high / low) : high - low;
        const bucketOf = (x: number): number => Math.min(count - 1, Math.max(0, Math.floor(count * (log ? Math.log(x / low) : x - low) / width)));
        const lowest = new Array<number>(count).fill(-1), highest = new Array<number>(count).fill(-1);
        for (const index of kept) {
            const bucket = bucketOf(xs[index]);
            const min = lowest[bucket], max = highest[bucket];
            if (min < 0 || values[index] < values[min]) lowest[bucket] = index;
            if (max < 0 || values[index] >= values[max]) highest[bucket] = index;
        }
        picked = [...new Set([...lowest, ...highest].filter(index => index >= 0))].sort((a, b) => a - b);
    }
    const drawn = withBreaks(picked, gaps);
    return { xs: drawn.map(index => xs[index]), values: drawn.map(index => (Number.isFinite(values[index]) ? values[index] : null)) };
}

/**
 * `picked` (ascending indices of points with values) with, between each two of them that have a gap (`gaps`,
 * ascending) between them, that gap's first index: the break the line is drawn with there (R2, as stage_view._with_breaks).
 */
function withBreaks(picked: readonly number[], gaps: readonly number[]): number[] {
    if (!gaps.length || picked.length < 2) return [...picked];
    const out: number[] = [];
    let gap = 0;
    for (let at = 0; at < picked.length; at++) {
        out.push(picked[at]);
        if (at + 1 === picked.length) break;
        while (gap < gaps.length && gaps[gap] <= picked[at]) gap++;
        if (gap < gaps.length && gaps[gap] < picked[at + 1]) out.push(gaps[gap]);
    }
    return out;
}

/**
 * One of the comparison's full-resolution spectra (`CompareModel.bins`) as drawn: between `bounds` Hz and a bin beyond
 * each (20 Hz to Nyquist for the whole view) in `buckets` buckets of their lowest and highest bin. Decimated only to be drawn.
 */
export function binsView(bins: NonNullable<CompareModel['bins']>, which: 'base' | 'compare' | 'diff', bounds?: readonly [number, number], buckets = SPECTRUM_LINE_BUCKETS): StageView | null {
    const values = bins[which];
    if (!values?.length) return null;
    // A zoomed range keeps the bin beyond each end, so the line still crosses a range between two bins (the plot clips it).
    const span: [number, number] = bounds
        ? [Math.max(bins.hz, Math.min(bounds[0], bounds[1]) - bins.hz), Math.max(bounds[0], bounds[1]) + bins.hz]
        : [SPECTRUM_MIN_HZ, bins.nyquist];
    const xs = values.map((_, bin) => bin * bins.hz);
    // The comparison's spectra are on a log frequency axis (the view below says so).
    const line = minMaxLine(xs, values, buckets, span, 'log');
    // The range is every bin's in the span (R1), not the drawn line's; a silent bin (the −300 dB floor) is a gap.
    let min = Infinity, max = -Infinity;
    for (let bin = 0; bin < values.length; bin++) {
        const x = xs[bin], value = values[bin];
        if (!(x > 0) || x < span[0] || x > span[1] || !Number.isFinite(value) || (which !== 'diff' && value <= -250)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return {
        frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level',
        xs: line.xs, xLimits: [SPECTRUM_MIN_HZ, bins.nyquist], values: line.values,
        ...(max >= min ? { valueRange: { min, max } } : {}),
        // Ordered among overlaid lines by every bin's power, not the drawn ones (R6); a Δ is not ordered.
        ...(which !== 'diff' ? { levelBins: levelBinsOf(xs, values, span, true) } : {}),
        ...(bounds ? { detail: true } : {}),
    };
}

/** Every 1/3-octave band up to Nyquist of `bands` (a side's levels, or the Δ per band), held whole: what their bars read (R7). */
export function bandsSource(bands: WholeLine, frequencies: number[]): InlineFullSource {
    // The whole line with the places up to Nyquist: only the bands that have a place are read (localLine).
    return localLine(BAND_CENTERS_HZ.slice(0, bandCount(frequencies)), bands);
}

/** Every bin of one of the comparison's spectra, held whole (R7): what a plot drawing its binsView reads and orders by. */
export function binsSource(bins: NonNullable<CompareModel['bins']>, which: 'base' | 'compare' | 'diff'): InlineFullSource | null {
    const values = bins[which];
    return values?.length ? localLine(values.map((_, bin) => bin * bins.hz), values) : null;
}

/**
 * The comparison's Δ spectrum to draw (R1, R3): from the full-resolution bins when the scans gave them, decimated
 * only to be drawn, and with the x window `zoom` (fractions of the whole Δ's axis) narrower than the whole, drawn
 * again from the bins between its ends, so zooming in shows every bin there. `picture` is the whole Δ, for the axis.
 * Without the bins, the 1/3-octave bands' Δ (each band's level is the scan's own, from every bin), never a Δ of the
 * scans' 192-point spectra: a Δ is taken only of full-resolution values (R1, R2).
 */
export function deltaViews(comparison: Pick<CompareModel, 'bins' | 'bandDeltas' | 'frequencies'>, zoom?: { start: number; end: number }): { picture: StageView | null; view: StageView | null } {
    const bandsDelta = (): StageView | null => {
        const count = bandCount(comparison.frequencies);
        const values = comparison.bandDeltas.slice(0, count);
        return values.some(value => value !== null) ? { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: BAND_CENTERS_HZ.slice(0, count), values, ...heldValueRange(comparison.bandDeltas, false) } : null;
    };
    const picture = comparison.bins?.diff ? binsView(comparison.bins, 'diff') : bandsDelta();
    if (!picture || !comparison.bins || !zoom || (zoom.start <= 0 && zoom.end >= 1)) return { picture, view: picture };
    const low = axisValueAt(picture, Math.max(0, zoom.start)), high = axisValueAt(picture, Math.min(1, zoom.end));
    return { picture, view: high > low ? binsView(comparison.bins, 'diff', [low, high]) ?? picture : picture };
}

/**
 * The full data of deltaViews' band Δ (the bars drawn without bins): every band of the table's per-band Δ, a
 * WholeLine computed of the scans' band levels, at the band centres up to Nyquist. Never the bars' values, which
 * are drawn points (R7).
 */
export function bandsDeltaSource(comparison: Pick<CompareModel, 'bandDeltas' | 'frequencies'>): InlineFullSource {
    return localLine(BAND_CENTERS_HZ.slice(0, bandCount(comparison.frequencies)), comparison.bandDeltas);
}

const signed = (value: number): string => signedNumberText(value);
const level = (value: number): string => noNegativeZero(withMinus(value.toFixed(1)));

/** "3.15 kHz +23.7 · 25 Hz +13.9 · 4 kHz +3.9 · Leq +1.4 dB" */
export function diffHeadline(comparison: CompareModel, strings?: CompareStrings): string {
    if (!comparison.blocked && comparison.leq && !comparison.topBands.length && strings) {
        // Nothing beyond chance: said in words rather than an empty list.
        return [strings.compareNoSignificant, `Leq ${signed(comparison.leq.delta)} dB`].join(' · ');
    }
    if (comparison.blocked) {
        const baseSet = comparison.baseSet;
        const why = comparison.blocked === 'self' ? strings?.compareSelfBase : comparison.blocked === 'single' ? strings?.compareSingleBase
            : comparison.blocked === 'empty' ? (strings && baseSet ? strings.compareEmptyBase.replace('{left}', () => setExclusionText(baseSet, strings)) : undefined)
            : comparison.blocked === 'unit' ? strings?.compareUnitDiffers : strings?.compareRegionDiffers;
        return why ? `— · ${why}` : '—';
    }
    if (!comparison.leq) return '—';
    return [...comparison.topBands.map(item => `${bandLabel(item.band)} ${signed(item.delta)}`), `Leq ${signed(comparison.leq.delta)} dB`].join(' · ');
}

/**
 * The comparison's headline, with both levels rather than their difference alone: the headline bands (as
 * diffHeadline picks them), then Leq. "3.15 kHz base −45.2 / compare −31.1 · Leq base −34.6 / compare −28.6 dB"
 */
export function levelsHeadline(comparison: CompareModel, strings: CompareStrings): string {
    // Absolute levels name their reference (R4): once after the pair when both sides share it, after each level when not.
    // By the levels' identity (levelIdentityOf), never by their names' text; a side whose reference is not known says
    // so, never a bare number (R4).
    const unitOf = (side: CompareSide | null): string => side?.levelLabel || `[${strings.axisUnitUnknown}]`;
    const baseUnit = unitOf(comparison.base), compareUnit = comparison.compare ? unitOf(comparison.compare) : baseUnit;
    const apart = !!comparison.compare && (comparison.base?.levelKey ?? '') !== (comparison.compare.levelKey ?? '') || !comparison.base?.levelKey;
    // Where the two sides differ in calibration status, the uncalibrated one says so itself (R4), as its legend does.
    const mixed = !!comparison.base && !!comparison.compare && !!comparison.base.uncalibrated !== !!comparison.compare.uncalibrated;
    const word = (side: CompareSide | null): string => (mixed && side?.uncalibrated ? strings.axisUncalibrated : '');
    const shown = (value: number | null | undefined, unit: string, side: CompareSide | null): string => (value === null || value === undefined ? '—' : `${level(value)}${apart ? ` ${unit}` : ''}${word(side)}`);
    const pair = (at: string, base: number | null | undefined, compare: number | null | undefined): string => strings.compareLevelsAt
        .replace('{at}', at).replace('{base}', shown(base, baseUnit, comparison.base)).replace('{compare}', shown(compare, compareUnit, comparison.compare)) + (apart ? '' : ` ${baseUnit}`);
    if (!comparison.leq) return '—';
    const leq = pair('Leq', comparison.leq.base, comparison.leq.compare);
    if (comparison.blocked) return [leq, diffHeadline(comparison, strings)].join(' · ');
    if (!comparison.topBands.length) return [strings.compareNoSignificant, leq].join(' · ');
    return [...comparison.topBands.map(item => pair(bandLabel(item.band), comparison.base?.bands[item.band], comparison.compare?.bands[item.band])), leq].join(' · ');
}

/**
 * A side's 1/3-octave levels (each the scan's own, from every bin) as a picture on the comparison's axes, for drawing
 * it over others where the scans gave no bins. Never the scan's 192 points: they are drawn points, of no number (R1).
 */
export function sideView(side: Pick<CompareSide, 'bands'> | null | undefined, frequencies: number[]): StageView | null {
    if (!side) return null;
    // Only the bands up to Nyquist: the rest are empty for every file.
    const count = bandCount(frequencies);
    const xs = BAND_CENTERS_HZ.slice(0, count), values = side.bands.slice(0, count);
    return { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs, values, ...heldValueRange(side.bands, true), levelBins: levelBinsOf(xs, side.bands, [xs[0] ?? 1, xs[xs.length - 1] ?? 1], true) };
}

/** How many 1/3-octave bands lie below the spectra's top edge (Nyquist). */
function bandCount(frequencies: readonly number[]): number {
    const top = topEdge(frequencies);
    return Math.max(1, BAND_CENTERS_HZ.filter(center => center * 2 ** (1 / 6) <= top).length);
}


/** One entry of the overlay's legend: a line in its colour and dash, a name, its Leq, and ▶ for one file. */
export interface LegendItem {
    color: string;
    label: string;
    value?: string;
    /** ▶ plays this file. */
    path?: string;
    active?: boolean;
    held?: boolean;
    /** The file's memo: ✎, with the memo as its hint. */
    memo?: string;
    /** The file's role chip (roleChip.ts), before its line. */
    chipHtml?: string;
    /** Its ▶ shows ■ while it plays. */
    playing?: boolean;
    /** Said in the hint footer over its label. */
    hint?: string;
    /** Markup of the caller's own at the item's end (the base group's ▾); interpolated values in it are escaped by the caller. */
    trailingHtml?: string;
}

export function legendHtml(items: readonly LegendItem[], strings: Pick<UiStrings, 'comparePlay'>): string {
    return items.map(item => {
        const mark = `<svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke="${item.color}" stroke-width="${item.active ? 3 : 2}"/></svg>`;
        const play = item.path ? `<button type="button" class="compare-play" data-action="compare-play" data-path="${escapeHtml(item.path)}" aria-label="${escapeHtml(strings.comparePlay + ': ' + item.label)}" aria-pressed="${item.playing ? 'true' : 'false'}">${item.playing ? '■' : '▶'}</button>` : '';
        const value = item.value ? ` <span class="compare-value">${escapeHtml(item.value)}</span>` : '';
        const memo = item.memo ? ` <span class="compare-memo" data-memo title="${escapeHtml(item.memo)}" data-hint="${escapeHtml(item.memo)}">✎</span>` : '';
        return `<span class="compare-legend-item${item.active ? ' is-active' : ''}${item.held ? ' is-held' : ''}">${item.chipHtml ?? ''}${mark}<span class="compare-legend-label"${item.hint ? ` title="${escapeHtml(item.hint)}" data-hint="${escapeHtml(item.hint)}"` : ''}>${escapeHtml(item.label)}</span>${value}${memo}${play}${item.trailingHtml ?? ''}</span>`;
    }).join('');
}

export interface PaneRange { min: number; max: number }

/** The plot's left edge: room for the tick numbers and the level axis' name written up the side. */
export { PANE_LEFT } from './paneLayout';

/** Axis names (and the Δ pane's legend), the same on screen, in the report figures and the summary. */
export interface PaneAxes {
    x: string;
    y: string;
    legend?: { headline: string; leak: string; line: string };
}

/** A scanned file's level reference as wandas gave it: its unit, reference value and name, its calibration status, and whether its source has a full scale. */
export type LevelInput = Pick<NonNullable<ScanResult['input']>, 'unit' | 'ref' | 'levelReferenceLabel' | 'calibrationStatus' | 'fullScale'>;

/** Uncalibrated levels as wandas names them: relative to full scale (audio), or to 1 input unit (a CSV, which has none). */
export function uncalibratedLevelInput(fullScale: boolean): LevelInput {
    return { unit: fullScale ? 'FS' : '', ref: 1, levelReferenceLabel: uncalibratedUnits(fullScale).level, calibrationStatus: 'uncalibrated', fullScale };
}

/**
 * A track's level reference for the steps view: as the entry table scanned it, else from the track's own analysis
 * (a file opened on its own, or a folder not rescanned yet): its channels' reference when they share one, as the scan
 * judges it (calibrated only if every channel is: a gain correction in FS shares dBFS with an uncalibrated channel),
 * else plain dB (channels calibrated apart share no reference).
 */
export function trackLevelInput(channels: ReadonlyArray<ChannelSummary | null | undefined>, scanned: (LevelInput & { channelCalibration?: ReadonlyArray<LevelInput['calibrationStatus']> }) | undefined, channel: number | null = null): LevelInput {
    // A channel read on its own names that channel's calibration (a file calibrated channel by channel), R4.
    const own = channel ? scanned?.channelCalibration?.[channel - 1] : undefined;
    if (scanned) return { unit: scanned.unit, ref: scanned.ref, levelReferenceLabel: scanned.levelReferenceLabel, calibrationStatus: own ?? scanned.calibrationStatus, fullScale: scanned.fullScale };
    const fullScale = channels.every(channel => !channel || channel.fullScale);
    const measured = channels.map(channel => channel?.measurement);
    const first = measured[0];
    // One level identity (figureModel.levelKeyOf: unit, reference value, level reference name) across the channels.
    const keyOf = (measurement: typeof first): string | null => (measurement ? levelKeyOf({ unit: measurement.referenceUnit, ref: measurement.referenceValue, levelReferenceLabel: measurement.levelReferenceLabel }) : null);
    const shared = !!first && measured.every(measurement => keyOf(measurement) === keyOf(first));
    if (first && shared) {
        const calibrationStatus = medianInputOf(measured)?.calibrationStatus === 'calibrated' ? 'calibrated' : 'uncalibrated';
        return { unit: first.referenceUnit, ref: first.referenceValue, levelReferenceLabel: first.levelReferenceLabel, calibrationStatus, fullScale };
    }
    // Channels of other references read together: named by the first one's, never a bare "dB" (C1). (A picture is
    // of one channel: its caller passes that one.)
    const calibrated = measured.find(measurement => measurement?.calibrationStatus === 'calibrated');
    return calibrated
        ? { unit: calibrated.referenceUnit, ref: calibrated.referenceValue, levelReferenceLabel: calibrated.levelReferenceLabel, calibrationStatus: calibrated.calibrationStatus, fullScale }
        : uncalibratedLevelInput(fullScale);
}

/**
 * The comparison's axis names. The level axis is named by wandas' level reference for the file: "uncalibrated"
 * while it is (dBFS, or dB re 1 input unit for a source without a full scale), its calibration's reference otherwise.
 */
export function paneAxes(strings: Pick<UiStrings, 'axisFrequency' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'axisUnitUnknown'>, input: LevelInput | undefined): { level: PaneAxes; delta: PaneAxes } {
    // Without an input no reference is known: the level says so, never a default dBFS (R4).
    const y = input ? (input.calibrationStatus === 'calibrated' ? strings.axisLevelCal : strings.axisLevelUncal).replace('{label}', input.levelReferenceLabel)
        : strings.axisLevelCal.replace('{label}', strings.axisUnitUnknown);
    return {
        level: { x: strings.axisFrequency, y },
        delta: { x: strings.axisFrequency, y: strings.axisDelta, legend: { headline: strings.legendHeadline, leak: strings.legendLeak, line: strings.legendLine } },
    };
}


export { level as levelDb };
