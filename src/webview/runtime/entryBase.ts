/**
 * What a compared row of the entry table is measured against: the slot-0 recording, else a group's recordings (the
 * group chosen on the base select, else the compared row's) over the table's filters (not the value's own range),
 * of the compared row's channel. The comparison, the report and the base select all ask here, so they name the same
 * base. The entry only says which recordings a base is: it holds no answer of them. What is counted, drawn and left
 * out of a base is the figure service's (its picture's set), which a heading is written with.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { baseGroupMembers, fileOfKey, groupOf, type DatasetRow, type GroupId } from '../../shared/dataset/datasetTable';
import { comparedKeys, roleKey } from './entrySlots';
import { setCountText, setExclusionText, type FigureSet } from './figureModel';
import { csvNumber } from '../../shared/utils/csv';
import { spacingDecimals } from '../shell/numberText';

/** A channel row of a recording of several channels is compared as that channel; otherwise the channels together. */
export const channelOfRow = (row: DatasetRow | undefined): number | null => (row && (row.channels ?? 1) > 1 ? row.ch : null);

/** What a base is, in the table's words (the report's 基準の定義 and 定義.json). */
export interface BaseDefinition {
    kind: 'file' | 'group';
    /** The slot-0 recording ("name ch2"), for a file base. */
    file?: string;
    /** The grouping column and the group's value, for a group base ('' when not grouped). */
    group?: { column: string; name: string };
    channel: number | null;
    /** The filters applied, as their chips say them. */
    filters: string[];
    /** The base's recordings, by name. */
    files: string[];
}

/**
 * A region as two cells, start and end in seconds; both empty for the whole file. To 10 ms, finer where the region
 * is so short its ends would read alike (to a tenth of its length, as secondsSpanText writes it).
 */
export function regionCells(region: { start: number; end: number } | null | undefined): [string, string] {
    if (!region) return ['', ''];
    const digits = spacingDecimals(Math.abs(region.end - region.start) / 10, 2, 6);
    return [csvNumber(region.start, digits), csvNumber(region.end, digits)];
}

export interface EntryBaseOf {
    /** The recordings the base asks for and draws with its channel. */
    members: string[];
    /** The group's recordings that cannot be a member: they have fewer channels than the one compared. */
    fewer: string[];
    /** The base's name without a count ("Base · run001", "Base group · line L1 · ch2 (within …)"). */
    name: string;
    /**
     * The base's heading over a figure's set of its members (the figure service's counts of them): its n and what it
     * left out with why; `count`: how the n is said when its recordings are drawn each.
     */
    heading(set: FigureSet, count?: string): string;
    definition: BaseDefinition;
    channel: number | null;
}

export interface EntryBaseDeps {
    strings: UiStrings;
    /** Row keys in slots 0–3. */
    slots(): readonly (string | null)[];
    rows(): readonly DatasetRow[];
    rowOf(key: string | null): DatasetRow | undefined;
    /** The rows a group is taken from: not excluded, through every filter but the one on the value. */
    pool(): readonly DatasetRow[];
    /** The table's grouping, and the group chosen on the base select (null: the compared row's). */
    group(): GroupId;
    baseGroup(): string | null;
    /** The filters the base is narrowed by (all but the value's own), as their chips say them. */
    narrowedBy(): string[];
    groupLabel(id: GroupId): string;
    rowName(key: string): string;
    /** A recording's name as the table lists it (no row of it: its file's name). */
    fileName(path: string): string;
}

export interface EntryBase {
    /** The slotted row of a file the comparison shows (slots 1–3 first, then 0). */
    slotRowOf(filePath: string): DatasetRow | undefined;
    /** What `comparePath` is measured against; `byGroup`: a group's recordings even with slot 0 filled. */
    resolve(comparePath: string, byGroup?: boolean): EntryBaseOf;
    /** The channel a file is drawn and measured with in the comparison of `comparePath`. */
    stageChannel(path: string, comparePath: string | null, byGroup?: boolean): number | null;
    /** The base select's text: slot 0's row, else the group that is the base. */
    text(): string;
    /** The group that is the base: the one chosen, else slot 1's (slot 0 empty, a grouping chosen). */
    groupName(): string | null;
}

export function createEntryBase(deps: EntryBaseDeps): EntryBase {
    const { strings } = deps;
    const slotRowOf = (filePath: string): DatasetRow | undefined => deps.rowOf(roleKey(deps.slots(), filePath) ?? null);
    /** The row a recording is compared as: its slot's, else the table's first of that file (a focused, unslotted one). */
    const compareRowOf = (filePath: string): DatasetRow | undefined => slotRowOf(filePath) ?? deps.rows().find(row => row.filePath === filePath);
    /** The recording the comparison is of: slot 1, else the first of slots 2–3 compared (the anchor of a group base). */
    const anchorSlot = (): string | null => deps.slots().slice(1).find((key): key is string => !!key) ?? null;
    function resolve(comparePath: string, byGroup = false): EntryBaseOf {
        const slots = deps.slots();
        const group = deps.group();
        const compareRow = compareRowOf(comparePath);
        const channel = channelOfRow(compareRow);
        const narrowedBy = deps.narrowedBy();
        const within = narrowedBy.length ? strings.dsBaseNarrowed.replace('{filters}', narrowedBy.join('・')) : '';
        const single = slots[0];
        if (single && !byGroup) {
            const ch = channelOfRow(deps.rowOf(single));
            const path = fileOfKey(single);
            const name = `${strings.entryBase} · ${deps.rowName(single)}`;
            return {
                members: [path], fewer: [], name, heading: of => name + setExclusionText(of, strings), channel: ch,
                definition: { kind: 'file', file: deps.rowName(single), channel: ch, filters: narrowedBy, files: [deps.fileName(path)] },
            };
        }
        const name = group === 'none' ? '' : deps.baseGroup() ?? (compareRow ? groupOf(compareRow, group) : '');
        // The group's rows of the pool (every row when not grouped), of the channel compared, without the compared
        // recording and the other compared slots (1–3).
        const compared = new Set(comparedKeys(slots).map(fileOfKey));
        const members = baseGroupMembers(deps.pool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath, group, name, channel);
        const where = group === 'none' ? strings.dsDistAll : `${deps.groupLabel(group)} ${name || '—'}`;
        const tail = `${channel ? ` · ${strings.dsCh}${channel}` : ''}${within}`;
        return {
            members: members.paths, fewer: members.fewerPaths, name: `${strings.entryBaseGroup} ${where}${tail}`, channel,
            heading: (of, count) => `${strings.entryBaseGroup} ${where} · ${setCountText(of, strings, count, channel)}${tail}`,
            definition: { kind: 'group', group: { column: group === 'none' ? '' : deps.groupLabel(group), name }, channel, filters: narrowedBy, files: members.paths.map(path => deps.fileName(path)) },
        };
    }
    function groupName(): string | null {
        const slots = deps.slots();
        const group = deps.group();
        if (slots[0] || group === 'none') return null;
        const chosen = deps.baseGroup();
        if (chosen !== null) return chosen;
        const anchor = deps.rowOf(anchorSlot());
        return anchor ? groupOf(anchor, group) : null;
    }

    return {
        slotRowOf,
        resolve,
        stageChannel(path: string, comparePath: string | null, byGroup = false): number | null {
            if (comparePath && path !== comparePath) {
                const base = resolve(comparePath, byGroup);
                if (base.members.includes(path)) return base.channel;
            }
            // A recording without a role is drawn as the row its legend names (the table's first of that file).
            return channelOfRow(slotRowOf(path) ?? deps.rows().find(row => row.filePath === path));
        },
        text(): string {
            const slots = deps.slots();
            if (slots[0]) return deps.rowName(slots[0]);
            if (slots[1]) return resolve(fileOfKey(slots[1])).name;
            const name = groupName();
            return name === null ? strings.entryBaseGroup : `${deps.groupLabel(deps.group())} ${name || '—'}`;
        },
        groupName,
    };
}
