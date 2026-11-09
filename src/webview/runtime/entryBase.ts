/**
 * What a compared row of the entry table is measured against: the slot-0 recording, else the median of a group
 * (the one chosen on the base chip, else the compared row's) over the table's filters (not the value's own range),
 * of the compared row's channel. The comparison, a fixed difference, the report and the slot chips all ask here,
 * so they name and measure the same base.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { baseGroupMembers, fileOfKey, groupOf, isComputed, valueOf, type DatasetRow, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { median } from '../../shared/dataset/distribution';
import { channelResult } from '../../shared/recipe/channelSelection';
import { buildCompareModel, groupMedian, ofOneUnit, type CompareModel } from './comparePanes';
import { comparedKeys, roleKey } from './entrySlots';
import { type BaseDefinition, type EntryModel } from './entryTable';

/** A channel row of a recording of several channels is compared as that channel; otherwise the channels together. */
export const channelOfRow = (row: DatasetRow | undefined): number | null => (row && (row.channels ?? 1) > 1 ? row.ch : null);

/** A base: its recordings, its name, what it is (for the report and a fixed difference) and the channel it is of. */
export interface EntryBaseOf {
    paths: string[];
    title: string;
    definition: BaseDefinition;
    channel: number | null;
}

export interface EntryBaseDeps {
    strings: UiStrings;
    /** Row keys in slots 0–3. */
    slots(): readonly (string | null)[];
    rows(): readonly DatasetRow[];
    rowOf(key: string | null): DatasetRow | undefined;
    /** The rows a group's median is taken over: not excluded, through every filter but the one on the value. */
    pool(): readonly DatasetRow[];
    /** The table's grouping, and the group chosen on the base chip (null: the compared row's). */
    group(): GroupId;
    baseGroup(): string | null;
    /** The filters the base is narrowed by (all but the value's own), as their chips say them. */
    narrowedBy(): string[];
    groupLabel(id: GroupId): string;
    rowName(key: string): string;
    results: ReadonlyMap<string, ScanResult>;
    /** Whether a file's result is of an earlier chain. */
    isStale(path: string): boolean;
    entryModel(): EntryModel;
}

export interface EntryBase {
    /** The slotted row of a file the comparison shows (slots 1–3 first, then 0). */
    slotRowOf(filePath: string): DatasetRow | undefined;
    /**
     * What `comparePath` is measured against; `byGroup`: a group's median even with slot 0 filled; `asChannel`: the
     * channel it is compared as (null: its channels together, as the entry CSV's per-file rows are), else its row's.
     */
    resolve(comparePath: string, byGroup?: boolean, asChannel?: number | null): EntryBaseOf;
    /** The channel a file is drawn and measured with in the comparison of `comparePath`. */
    stageChannel(path: string, comparePath: string | null, byGroup?: boolean): number | null;
    /** The comparison of `comparePath` with its base (over `over` when given), each file as the channel it is compared as. */
    comparison(comparePath: string, byGroup?: boolean, over?: ReadonlyMap<string, ScanResult>, entryRegionBase?: boolean): CompareModel;
    /** The comparison of a whole recording (its channels together) with the base it has now: the entry CSV's Δ columns. */
    fileComparison(comparePath: string): CompareModel;
    /**
     * The base group's value of `value` where the comparison measures from it (slot 0 empty, a group chosen or slot 1's):
     * the median of the very recordings `resolve` names, of their levels as the Δ takes them; null otherwise. The
     * distribution draws its base line here. `onAxis` keeps a level only when the axis it is drawn on is its reference.
     */
    groupBase(value: ValueId, onAxis?: (path: string) => boolean): { group: string; value: number | null } | null;
    /** The base chip's text: slot 0's row, else the group whose median is the base. */
    text(): string;
    /** The group whose median is the base: the one chosen, else slot 1's (slot 0 empty, a grouping chosen). */
    groupName(): string | null;
}

export function createEntryBase(deps: EntryBaseDeps): EntryBase {
    const { strings, results } = deps;
    const slotRowOf = (filePath: string): DatasetRow | undefined => deps.rowOf(roleKey(deps.slots(), filePath) ?? null);
    /**
     * The base group's recordings: `name`'s rows of the pool (every row when not grouped), of `channel`, without the
     * compared recording and the other compared slots (1–3), of the compared recording's unit, reference and
     * calibration (`comparePath` null: the first measured one's). The one definition every base group is taken from.
     */
    function groupMembers(comparePath: string | null, name: string, channel: number | null): { paths: string[]; fewerChannels: number; otherUnits: number } {
        const group = deps.group();
        // The other compared recordings (slots 1–3) are compared themselves: not part of anyone's base.
        const compared = new Set(comparedKeys(deps.slots()).map(fileOfKey));
        const members = baseGroupMembers(deps.pool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath ?? '', group, name, channel);
        // A median is of one unit, reference and calibration: the group's recordings in another than the compared one's are left out and counted.
        const paths = ofOneUnit(results, members.paths, path => path, comparePath ? results.get(comparePath) : undefined);
        return { paths, fewerChannels: members.fewerChannels, otherUnits: members.paths.length - paths.length };
    }
    function resolve(comparePath: string, byGroup = false, asChannel?: number | null): EntryBaseOf {
        const slots = deps.slots();
        const group = deps.group();
        const compareRow = slotRowOf(comparePath) ?? deps.rows().find(row => row.filePath === comparePath);
        const channel = asChannel !== undefined ? asChannel : channelOfRow(compareRow);
        const narrowedBy = deps.narrowedBy();
        const within = narrowedBy.length ? strings.dsBaseNarrowed.replace('{filters}', narrowedBy.join('・')) : '';
        const single = slots[0];
        if (single && !byGroup) {
            const ch = channelOfRow(deps.rowOf(single));
            return {
                paths: [fileOfKey(single)], title: `${strings.entryBase} · ${deps.rowName(single)}`, channel: ch,
                definition: { kind: 'file', file: deps.rowName(single), count: 1, channel: ch, filters: narrowedBy, fewerChannels: 0 },
            };
        }
        const name = group === 'none' ? '' : deps.baseGroup() ?? (compareRow ? groupOf(compareRow, group) : '');
        const { paths, fewerChannels, otherUnits } = groupMembers(comparePath, name, channel);
        const where = group === 'none' ? strings.dsDistAll : `${deps.groupLabel(group)} ${name || '—'}`;
        const title = `${strings.entryBaseGroup} ${where} · ${strings.entryBaseMedian.replace('{count}', String(paths.length))}${channel ? ` · ${strings.dsCh}${channel}` : ''}`
            + (fewerChannels ? strings.dsBaseFewer.replace('{n}', String(fewerChannels)).replace('{ch}', String(channel)) : '')
            + (otherUnits ? strings.dsBaseOtherUnits.replace('{n}', String(otherUnits)) : '') + within;
        return {
            paths, title, channel,
            definition: { kind: 'group', group: { column: group === 'none' ? '' : deps.groupLabel(group), name }, count: paths.length, channel, filters: narrowedBy, fewerChannels, ...(otherUnits ? { otherUnits } : {}) },
        };
    }
    /** `source`'s results with each of `paths` as `channel` (when one channel is compared). */
    function picked(source: ReadonlyMap<string, ScanResult>, paths: readonly string[], channel: number | null): Map<string, ScanResult> {
        const out = new Map(source);
        if (!channel) return out;
        for (const path of paths) {
            const result = channelResult(source.get(path), channel);
            if (result) out.set(path, result);
        }
        return out;
    }
    function compareWith(comparePath: string, base: EntryBaseOf, compareChannel: number | null, byGroup: boolean, over?: ReadonlyMap<string, ScanResult>, entryRegionBase = false): CompareModel {
        const source = over ?? results;
        const chosen = picked(picked(source, base.paths, base.channel), [comparePath], compareChannel);
        const slot0 = deps.slots()[0];
        const single = slot0 && !byGroup ? fileOfKey(slot0) : null;
        return buildCompareModel(deps.entryModel(), chosen, comparePath, single, strings, entryRegionBase, undefined, single ? undefined : { paths: base.paths, title: base.title });
    }
    function groupName(): string | null {
        const slots = deps.slots();
        const group = deps.group();
        if (slots[0] || group === 'none') return null;
        const chosen = deps.baseGroup();
        if (chosen !== null) return chosen;
        const anchor = deps.rowOf(slots[1]);
        return anchor ? groupOf(anchor, group) : null;
    }

    return {
        slotRowOf,
        resolve,
        stageChannel(path: string, comparePath: string | null, byGroup = false): number | null {
            if (comparePath && path !== comparePath) {
                const base = resolve(comparePath, byGroup);
                if (base.paths.includes(path)) return base.channel;
            }
            // A recording without a role is drawn as the row its legend names (the table's first of that file).
            return channelOfRow(slotRowOf(path) ?? deps.rows().find(row => row.filePath === path));
        },
        comparison(comparePath: string, byGroup = false, over?: ReadonlyMap<string, ScanResult>, entryRegionBase = false): CompareModel {
            return compareWith(comparePath, resolve(comparePath, byGroup), channelOfRow(slotRowOf(comparePath)), byGroup, over, entryRegionBase);
        },
        fileComparison(comparePath: string): CompareModel {
            return compareWith(comparePath, resolve(comparePath, false, null), null, false);
        },
        groupBase(value: ValueId, onAxis: (path: string) => boolean = () => true): { group: string; value: number | null } | null {
            const name = groupName();
            if (name === null) return null;
            const anchor = deps.slots()[1];
            const comparePath = anchor ? fileOfKey(anchor) : null;
            const base = comparePath ? resolve(comparePath) : { paths: groupMembers(null, name, null).paths, channel: null };
            if (!isComputed(value) || value === 'peak' || value === 'crest') {
                // Not a level: the median of the members' own values (a CSV value once per recording, else per channel row).
                const members = deps.pool().filter(row => base.paths.includes(row.filePath) && (!base.channel || row.ch === base.channel));
                const once = isComputed(value) ? members : members.filter((row, index) => members.findIndex(other => other.filePath === row.filePath) === index);
                return { group: name, value: median(once.map(row => valueOf(row, value, results)).filter((number): number is number => number !== null)) };
            }
            // A level: the median the comparison measures its Δ from, of the members whose reference the axis is.
            const levels = groupMedian(picked(results, base.paths, base.channel), base.paths.filter(onAxis));
            const level = !levels ? null : value === 'leq' ? levels.leq : levels.bands[Number(value.slice(5))] ?? null;
            return { group: name, value: level };
        },
        text(): string {
            const slots = deps.slots();
            if (slots[0]) return deps.rowName(slots[0]);
            if (slots[1]) return resolve(fileOfKey(slots[1])).title;
            const name = groupName();
            if (name === null) return strings.entryBaseGroup;
            // The group's recordings as a base: the same members a compared row would be measured against.
            const members = groupMembers(null, name, null).paths;
            return `${deps.groupLabel(deps.group())} ${name || '—'} · ${strings.entryBaseMedian.replace('{count}', String(members.length))}`;
        },
        groupName,
    };
}
