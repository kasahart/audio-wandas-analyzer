import { levelIdentityOf, type LevelInput } from './comparePanes';

/**
 * Every place that puts lines on one level axis, range or colour scale groups them here, by their level identity
 * (R1, R4: levelIdentityOf — unit, reference value, level reference name; calibration status is not part of it).
 * Nothing groups levels by an axis title, a label or a unit string alone: src/test/levelGrouping.test.ts scans the
 * webview for that.
 */
export type LevelOf = Pick<LevelInput, 'unit' | 'ref' | 'levelReferenceLabel'>;

/**
 * The key lines share an axis by. `shownAs` is what a picture's own axis says its levels are in (a slice's or a
 * spectrogram's bracketed reference): lines whose pictures say different things never share an axis either, even
 * where their recordings' identity agrees. A line without an input is keyed by `shownAs` alone, '' by nothing.
 */
export function levelKeyOf(input: LevelOf | null | undefined, shownAs?: string): string {
    const identity = input ? levelIdentityOf(input) : '';
    return shownAs === undefined ? identity : JSON.stringify([identity, shownAs]);
}

/** The items by level key (levelKeyOf), in the order each key first appears. */
export function byLevelKey<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        const group = groups.get(key);
        if (group) group.push(item); else groups.set(key, [item]);
    }
    return groups;
}

/**
 * The word each item's legend name and readout carry (R1, R4, A49): where items of one level key differ in
 * calibration status, each uncalibrated one says `word`, since the axis they share is named by a calibrated one
 * (axisInputOf); '' elsewhere, where the axis' own name says it.
 */
export function calibrationWordsBy<T>(items: readonly T[], keyOf: (item: T) => string, calibrated: (item: T) => boolean, word: string): (item: T) => string {
    const statuses = new Map<string, Set<boolean>>();
    for (const item of items) {
        const key = keyOf(item);
        statuses.set(key, (statuses.get(key) ?? new Set()).add(calibrated(item)));
    }
    return item => (!calibrated(item) && (statuses.get(keyOf(item))?.size ?? 0) > 1 ? word : '');
}

/**
 * The input an axis shared by `inputs` (all of one level key) is named by: a calibrated one's where any is, so the
 * axis says uncalibrated only when every line on it is (R4); each uncalibrated line then says so itself.
 */
export function axisInputOf<I extends { calibrationStatus?: string } | null | undefined>(inputs: readonly I[]): I | undefined {
    return inputs.find(input => input?.calibrationStatus === 'calibrated') ?? inputs.find(input => !!input);
}

/**
 * What a picture's own level axis says its levels are in: its bracketed reference ("dB SPL re 20 µPa"), else its
 * unit; '' when it says neither (never a bare "dB" standing for a reference nobody gave, R4, A50).
 */
export function shownLevelOf(reading: { axisLabel?: string; unit?: string }): string {
    const bracket = reading.axisLabel ? /\[([^\]]+)\]\s*$/.exec(reading.axisLabel) : null;
    return bracket ? bracket[1] : reading.unit ?? '';
}

/**
 * The level key of a picture the backend sent with its reference (a spectrogram): its reference unit and value as
 * wandas gave them, and its axis as drawn (unit and title), so two pictures share a colour scale only when both agree.
 */
export function levelKeyOfReading(reading: { referenceUnit?: string; referenceValue?: number; axisLabel?: string; unit?: string }): string {
    return levelKeyOf({ unit: reading.referenceUnit ?? '', ref: reading.referenceValue ?? 1, levelReferenceLabel: shownLevelOf(reading) }, `${reading.unit ?? ''}|${reading.axisLabel ?? ''}`);
}
