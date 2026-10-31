/**
 * What a compared row of the entry table is measured against: the slot-0 recording, else the median of a group
 * (the one chosen on the base chip, else the compared row's) over the table's filters (not the value's own range),
 * of the compared row's channel. The comparison, a fixed difference, the report and the slot chips all ask here,
 * so they name and measure the same base.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { baseGroupMembers, fileOfKey, groupOf, type DatasetRow, type GroupId } from '../../shared/dataset/datasetTable';
import { median } from '../../shared/dataset/distribution';
import { channelResult } from '../../shared/recipe/channelSelection';
import { powerMeanOrNull } from '../../shared/utils/levels';
import { buildCompareModel, type CompareModel } from './comparePanes';
import { comparedKeys, roleKey } from './entrySlots';
import { BAND_CENTERS_HZ, type BaseDefinition, type EntryModel } from './entryTable';

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
    /** What `comparePath` is measured against; `byGroup`: a group's median even with slot 0 filled. */
    resolve(comparePath: string, byGroup?: boolean): EntryBaseOf;
    /** The channel a file is drawn and measured with in the comparison of `comparePath`. */
    stageChannel(path: string, comparePath: string | null, byGroup?: boolean): number | null;
    /** The comparison of `comparePath` with its base (over `over` when given), each file as the channel it is compared as. */
    comparison(comparePath: string, byGroup?: boolean, over?: ReadonlyMap<string, ScanResult>, entryRegionBase?: boolean): CompareModel;
    /** The base chip's text: slot 0's row, else the group whose median is the base. */
    text(): string;
    /** The group whose median is the base: the one chosen, else slot 1's (slot 0 empty, a grouping chosen). */
    groupName(): string | null;
    /** A base group's median 1/3-octave levels from the table's computed values (the compared channel). */
    tableBands(comparePath: string, byGroup?: boolean): { centers: number[]; values: (number | null)[]; count: number } | null;
}

export function createEntryBase(deps: EntryBaseDeps): EntryBase {
    const { strings, results } = deps;
    const slotRowOf = (filePath: string): DatasetRow | undefined => deps.rowOf(roleKey(deps.slots(), filePath) ?? null);
    function resolve(comparePath: string, byGroup = false): EntryBaseOf {
        const slots = deps.slots();
        const group = deps.group();
        const compareRow = slotRowOf(comparePath) ?? deps.rows().find(row => row.filePath === comparePath);
        const channel = channelOfRow(compareRow);
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
        // The other compared recordings (slots 1–3) are compared themselves: not part of anyone's base.
        const compared = new Set(comparedKeys(slots).map(fileOfKey));
        const { paths, fewerChannels } = baseGroupMembers(deps.pool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath, group, name, channel);
        const where = group === 'none' ? strings.dsDistAll : `${deps.groupLabel(group)} ${name || '—'}`;
        const title = `${strings.entryBaseGroup} ${where} · ${strings.entryBaseMedian.replace('{count}', String(paths.length))}${channel ? ` · ${strings.dsCh}${channel}` : ''}`
            + (fewerChannels ? strings.dsBaseFewer.replace('{n}', String(fewerChannels)).replace('{ch}', String(channel)) : '') + within;
        return {
            paths, title, channel,
            definition: { kind: 'group', group: { column: group === 'none' ? '' : deps.groupLabel(group), name }, count: paths.length, channel, filters: narrowedBy, fewerChannels },
        };
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
            return channelOfRow(slotRowOf(path));
        },
        comparison(comparePath: string, byGroup = false, over?: ReadonlyMap<string, ScanResult>, entryRegionBase = false): CompareModel {
            const base = resolve(comparePath, byGroup);
            const source = over ?? results;
            const picked = new Map(source);
            const pick = (path: string, ch: number | null): void => {
                const result = ch ? channelResult(source.get(path), ch) : undefined;
                if (result) picked.set(path, result);
            };
            pick(comparePath, channelOfRow(slotRowOf(comparePath)));
            for (const path of base.paths) pick(path, base.channel);
            const slot0 = deps.slots()[0];
            const single = slot0 && !byGroup ? fileOfKey(slot0) : null;
            return buildCompareModel(deps.entryModel(), picked, comparePath, single, strings, entryRegionBase, undefined, single ? undefined : { paths: base.paths, title: base.title });
        },
        text(): string {
            const slots = deps.slots();
            if (slots[0]) return deps.rowName(slots[0]);
            if (slots[1]) return resolve(fileOfKey(slots[1])).title;
            const name = groupName();
            if (name === null) return strings.entryBaseGroup;
            const group = deps.group();
            // The group's rows (the table's grouping, its filters and exclusions applied, not the range on the value).
            const members = deps.pool().filter(item => groupOf(item, group) === name && item.key !== slots[1]);
            return `${deps.groupLabel(group)} ${name || '—'} · ${strings.entryBaseMedian.replace('{count}', String(members.length))}`;
        },
        groupName,
        tableBands(comparePath: string, byGroup = false) {
            const base = resolve(comparePath, byGroup);
            const levels = base.paths.flatMap(path => {
                const result = base.channel ? channelResult(results.get(path), base.channel) : results.get(path);
                const bands = result?.ok ? result.thirdOctDb : undefined;
                if (!bands?.length || deps.isStale(path)) return [];
                // A recording's channels together, power-averaged, as the comparison's sides are.
                return [bands[0].map((_, band) => powerMeanOrNull(bands.map(channel => channel[band])))];
            });
            if (!levels.length) return null;
            const values = levels[0].map((_, band) => median(levels.map(item => item[band]).filter((level): level is number => level !== null)));
            return { centers: BAND_CENTERS_HZ.slice(0, values.length), values, count: levels.length };
        },
    };
}
