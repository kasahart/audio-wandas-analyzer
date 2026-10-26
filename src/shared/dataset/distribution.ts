/**
 * The entry screen's distribution: the chosen value over the rows, one histogram per group. A CSV value
 * belongs to the recording, so each recording counts once per group; a value computed from the sound is per
 * channel. Rows without the value (not computed yet) are counted, not drawn. Pure, so it is unit-tested.
 */
import { groupOf, isComputed, valueOf, type DatasetRow, type GroupId, type Results, type ValueId } from './datasetTable';

/** Bins across the whole x range: the same for every group, so their bars line up. */
export const DISTRIBUTION_BINS = 48;
/** A group with fewer members than this is drawn as one dot per member: a histogram of a few says nothing. */
export const DOTS_BELOW = 12;

export interface DistributionMember { key: string; filePath: string; value: number; inRange: boolean }
export interface DistributionGroup { name: string; members: DistributionMember[] }
export interface Distribution {
    groups: DistributionGroup[];
    /** The x range: the drawn values', padded a little; the range being picked is not part of it, so a drag does not move the axis. */
    low: number;
    high: number;
    /** Rows of the pool without the value: computed values not computed yet. */
    missing: number;
    /** Whether a member is a recording (a CSV value) or a channel (a computed value). */
    unit: 'recording' | 'ch';
}

/** Group names in order: numbers by value (900 before 1500), then the rest as text, the blank last. */
export function compareGroupNames(a: string, b: string): number {
    if (!a || !b) return a === b ? 0 : a ? -1 : 1;
    const x = Number(a), y = Number(b);
    const numeric = (text: string, number: number): boolean => text.trim() !== '' && Number.isFinite(number);
    if (numeric(a, x) && numeric(b, y)) return x - y;
    if (numeric(a, x) !== numeric(b, y)) return numeric(a, x) ? -1 : 1;
    return a.localeCompare(b, undefined, { numeric: true });
}

/** The median; with an even count, the mean of the two in the middle. */
export function median(values: readonly number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * `rows` is the pool: not excluded, through every filter but the one on the value itself (`range`), which
 * only marks the members it takes. `usable` says whether a row's computed value is of the current chain.
 */
export function distribution(rows: readonly DatasetRow[], value: ValueId, group: GroupId, results: Results,
    range: { low: number; high: number } | null, usable: (row: DatasetRow) => boolean = () => true): Distribution {
    const perRecording = !isComputed(value);
    const seen = new Set<string>();
    const groups = new Map<string, DistributionMember[]>();
    let missing = 0;
    for (const row of rows) {
        const number = usable(row) ? valueOf(row, value, results) : null;
        // A CSV value left blank is not drawn either, but nothing computes it: only computed values are "missing".
        if (number === null) { if (!perRecording) missing++; continue; }
        const name = groupOf(row, group);
        if (perRecording) {
            const once = `${row.filePath}\u0000${name}`;
            if (seen.has(once)) continue;
            seen.add(once);
        }
        const members = groups.get(name) ?? [];
        members.push({ key: row.key, filePath: row.filePath, value: number, inRange: !range || (number >= range.low && number <= range.high) });
        groups.set(name, members);
    }
    const all = [...groups.values()].flat().map(member => member.value);
    // A loop, not Math.min(...all): 100,000 arguments overflow the stack.
    let low = all.length ? Infinity : 0, high = all.length ? -Infinity : 1;
    for (const number of all) { if (number < low) low = number; if (number > high) high = number; }
    const pad = high > low ? (high - low) * 0.04 : Math.max(Math.abs(low) * 0.05, 0.5);
    low -= pad; high += pad;
    return {
        groups: [...groups.entries()].sort(([a], [b]) => compareGroupNames(a, b)).map(([name, members]) => ({ name, members })),
        low, high, missing, unit: perRecording ? 'recording' : 'ch',
    };
}

/** A group's bars: members per bin, and how many of them the range takes. */
export function binCounts(members: readonly DistributionMember[], low: number, high: number, bins = DISTRIBUTION_BINS): { counts: number[]; inRange: number[]; max: number } {
    const counts = new Array<number>(bins).fill(0), inRange = new Array<number>(bins).fill(0);
    const width = (high - low) / bins;
    for (const member of members) {
        const bin = Math.max(0, Math.min(bins - 1, Math.floor((member.value - low) / width)));
        counts[bin]++;
        if (member.inRange) inRange[bin]++;
    }
    return { counts, inRange, max: Math.max(0, ...counts) };
}

/**
 * Group names as shown: when they all share a long start or end (LOT-2026-13-東工場-…), the part that differs,
 * with … where the shared part was.
 */
export function groupLabels(names: readonly string[]): Map<string, string> {
    const labels = new Map(names.map(name => [name, name]));
    if (names.length < 2) return labels;
    const shortest = names.reduce((least, name) => Math.min(least, name.length), Infinity);
    let head = 0, tail = 0;
    while (head < shortest && names.every(name => name[head] === names[0][head])) head++;
    while (tail < shortest - head && names.every(name => name[name.length - 1 - tail] === names[0][names[0].length - 1 - tail])) tail++;
    if (head + tail < 6) return labels;
    for (const name of names) labels.set(name, `${head ? '…' : ''}${name.slice(head, name.length - tail)}${tail ? '…' : ''}`);
    return labels;
}

