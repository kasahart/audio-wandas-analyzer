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
import { buildCompareModel, groupMedian, type CompareModel } from './comparePanes';
import { comparedKeys, roleKey } from './entrySlots';
import { scanAnswer, type ScanAnswer } from './answerStore';
import { excludedFor, figureUsed, scanFigureOf, type ExclusionReason, type FigureSet } from './figureModel';
import { type BaseDefinition, type EntryModel } from './entryTable';

/** A channel row of a recording of several channels is compared as that channel; otherwise the channels together. */
export const channelOfRow = (row: DatasetRow | undefined): number | null => (row && (row.channels ?? 1) > 1 ? row.ch : null);

/** A base: its recordings, its name, what it is (for the report and a fixed difference) and the channel it is of. */
export interface EntryBaseOf {
    /** The recordings its median is of: its figure set's (figureModel.figureUsed), never one pending, stale, failed or of another reference. */
    paths: string[];
    /**
     * The recordings the base asks for and draws with its channel: its members of the compared one's reference, those
     * still pending, stale or failed too (a scan or a step picture comes of them). Never what is counted: `paths` is.
     */
    members: string[];
    title: string;
    definition: BaseDefinition;
    channel: number | null;
    /** The figure set every count of this base is of: its n, its files and what it left out with why. */
    set: FigureSet<ScanResult & { ok: true }>;
    /** The title and n with more left out (a step figure's recordings whose picture failed or is on its way). */
    titleWith(more: ReadonlyArray<{ path: string; reason: ExclusionReason }>): { title: string; n: number };
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
    /** Files' scans as the answer store hands them (state and identity: stale when of an earlier chain); the answer store's alone, so no base is measured from results it has not judged. */
    answersOf(paths: readonly string[]): ScanAnswer[];
    /** The results of the current chain and calibration (the answer store's). */
    fresh(): ReadonlyMap<string, ScanResult>;
    entryModel(): EntryModel;
}

export interface EntryBase {
    /** The slotted row of a file the comparison shows (slots 1–3 first, then 0). */
    slotRowOf(filePath: string): DatasetRow | undefined;
    /**
     * What `comparePath` is measured against; `byGroup`: a group's median even with slot 0 filled; `asChannel`: the
     * channel it is compared as (null: its channels together, as the entry CSV's per-file rows are), else its row's.
     */
    resolve(comparePath: string, byGroup?: boolean, asChannel?: number | null, over?: ReadonlyMap<string, ScanResult>): EntryBaseOf;
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

/**
 * Results the comparison measured now over a region, under the current chain (its own compare-scan): a file's answer
 * over them is its value there, never the table's state (a table result of an earlier chain does not make it stale).
 */
export type RegionResults = ReadonlyMap<string, ScanResult> & { readonly measuredNow: true };
export function regionResults(measured: Iterable<readonly [string, ScanResult]>): RegionResults {
    return Object.assign(new Map(measured), { measuredNow: true as const });
}
const isRegionResults = (over: ReadonlyMap<string, ScanResult>): over is RegionResults => (over as Partial<RegionResults>).measuredNow === true;

export function createEntryBase(deps: EntryBaseDeps): EntryBase {
    const { strings } = deps;
    const answersOf = (paths: readonly string[]): ScanAnswer[] => deps.answersOf(paths);
    /**
     * The results a base is measured from: the table's, without those of an earlier chain or calibration (stale: shown
     * greyed, never in a median, an n or a Δ). Every median, count and Δ here is taken over these alone.
     */
    const current = (): ReadonlyMap<string, ScanResult> => deps.fresh();
    const slotRowOf = (filePath: string): DatasetRow | undefined => deps.rowOf(roleKey(deps.slots(), filePath) ?? null);
    /**
     * A file's answer for a figure: the table's (the answer store's state and identity), stale when of an earlier chain;
     * over results measured now over a region (regionResults), the region's value whatever the table's state (none
     * yet: pending); over the table's own results with more in them (withBins), the table's state with their value.
     */
    function answerOf(path: string, over?: ReadonlyMap<string, ScanResult>): ScanAnswer {
        // The answer store's (stale when of an earlier chain or calibration): never judged here.
        const fresh = answersOf([path])[0];
        if (over && isRegionResults(over)) return scanAnswer(path, over.get(path), { recipeKey: fresh.identity.recipeKey, region: 'over' });
        if (!over || fresh.state !== 'ready' || over === deps.results) return fresh;
        return scanAnswer(path, over.get(path), { recipeKey: fresh.identity.recipeKey, region: 'over' });
    }
    /**
     * The base group's set: `name`'s rows of the pool (every row when not grouped), of `channel`, without the compared
     * recording and the other compared slots (1–3), counted by the figure model against the compared recording's level
     * identity and spectrum axis (`comparePath` null: the first measured one's). The one set every base group, its
     * heading, n, files, median and Δ are of.
     */
    function groupSet(comparePath: string | null, name: string, channel: number | null, over?: ReadonlyMap<string, ScanResult>): { set: FigureSet<ScanResult & { ok: true }>; fewerChannels: number; asked: string[] } {
        const group = deps.group();
        // The other compared recordings (slots 1–3) are compared themselves: not part of anyone's base.
        const compared = new Set(comparedKeys(deps.slots()).map(fileOfKey));
        const members = baseGroupMembers(deps.pool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath ?? '', group, name, channel);
        const like = comparePath ? answerOf(comparePath, over) : undefined;
        const set = figureUsed(members.paths.filter(path => path !== comparePath).map(path => answerOf(path, over)), scanFigureOf(like?.state === 'ready' ? like.value : undefined));
        // What is asked for and drawn: every member but those of another reference or axis, in the table's order.
        const other = new Set(set.excluded.filter(item => item.reason === 'other-reference' || item.reason === 'other-axis').map(item => item.path));
        return { set, fewerChannels: members.fewerChannels, asked: members.paths.filter(path => path !== comparePath && !other.has(path)) };
    }
    /** "median of 3 · 1 failed left out · 1 still computing · …": the count every base title and its definition say. */
    function medianText(set: Pick<FigureSet<unknown>, 'n' | 'excluded'>): string {
        const say = (template: string, n: number): string => (n ? template.replace('{n}', String(n)) : '');
        return strings.entryBaseMedian.replace('{count}', String(set.n))
            + say(strings.dsBaseFailed, excludedFor(set, 'failed', 'empty', 'missing')) + say(strings.dsBasePending, excludedFor(set, 'pending'))
            + say(strings.dsBaseStale, excludedFor(set, 'stale')) + say(strings.dsBaseOtherUnits, excludedFor(set, 'other-reference')) + say(strings.dsBaseOtherBins, excludedFor(set, 'other-axis'));
    }
    function resolve(comparePath: string, byGroup = false, asChannel?: number | null, over?: ReadonlyMap<string, ScanResult>): EntryBaseOf {
        const slots = deps.slots();
        const group = deps.group();
        const compareRow = slotRowOf(comparePath) ?? deps.rows().find(row => row.filePath === comparePath);
        const channel = asChannel !== undefined ? asChannel : channelOfRow(compareRow);
        const narrowedBy = deps.narrowedBy();
        const within = narrowedBy.length ? strings.dsBaseNarrowed.replace('{filters}', narrowedBy.join('・')) : '';
        const single = slots[0];
        if (single && !byGroup) {
            const ch = channelOfRow(deps.rowOf(single));
            const path = fileOfKey(single);
            const set = figureUsed([answerOf(path, over)], { level: null });
            const title = `${strings.entryBase} · ${deps.rowName(single)}`;
            return {
                paths: [path], members: [path], title, channel: ch, set, titleWith: () => ({ title, n: 1 }),
                definition: { kind: 'file', file: deps.rowName(single), count: 1, channel: ch, filters: narrowedBy, fewerChannels: 0 },
            };
        }
        const name = group === 'none' ? '' : deps.baseGroup() ?? (compareRow ? groupOf(compareRow, group) : '');
        const { set, fewerChannels, asked } = groupSet(comparePath, name, channel, over);
        const where = group === 'none' ? strings.dsDistAll : `${deps.groupLabel(group)} ${name || '—'}`;
        const titleOf = (of: Pick<FigureSet<unknown>, 'n' | 'excluded'>): string => `${strings.entryBaseGroup} ${where} · ${medianText(of)}${channel ? ` · ${strings.dsCh}${channel}` : ''}`
            + (fewerChannels ? strings.dsBaseFewer.replace('{n}', String(fewerChannels)).replace('{ch}', String(channel)) : '') + within;
        const otherUnits = excludedFor(set, 'other-reference', 'other-axis'), failed = excludedFor(set, 'failed', 'empty', 'missing'), pending = excludedFor(set, 'pending'), stale = excludedFor(set, 'stale');
        return {
            paths: set.paths, members: asked, title: titleOf(set), channel, set,
            titleWith(more) {
                const gone = new Set(more.map(item => item.path));
                const of = { n: set.paths.filter(path => !gone.has(path)).length, excluded: [...set.excluded, ...more.filter(item => set.paths.includes(item.path))] };
                return { title: titleOf(of), n: of.n };
            },
            definition: {
                kind: 'group', group: { column: group === 'none' ? '' : deps.groupLabel(group), name }, count: set.n, channel, filters: narrowedBy, fewerChannels,
                ...(otherUnits ? { otherUnits } : {}), ...(failed ? { failed } : {}), ...(pending ? { pending } : {}), ...(stale ? { stale } : {}),
            },
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
        const source = over ?? current();
        const chosen = picked(picked(source, base.paths, base.channel), [comparePath], compareChannel);
        const slot0 = deps.slots()[0];
        const single = slot0 && !byGroup ? fileOfKey(slot0) : null;
        return buildCompareModel(deps.entryModel(), chosen, comparePath, single, strings, entryRegionBase, undefined, single ? undefined : { paths: base.paths, title: base.title, pending: base.set.excluded.filter(item => item.reason === 'pending').map(item => item.path) });
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
                if (base.members.includes(path)) return base.channel;
            }
            // A recording without a role is drawn as the row its legend names (the table's first of that file).
            return channelOfRow(slotRowOf(path) ?? deps.rows().find(row => row.filePath === path));
        },
        comparison(comparePath: string, byGroup = false, over?: ReadonlyMap<string, ScanResult>, entryRegionBase = false): CompareModel {
            return compareWith(comparePath, resolve(comparePath, byGroup, undefined, over), channelOfRow(slotRowOf(comparePath)), byGroup, over, entryRegionBase);
        },
        fileComparison(comparePath: string): CompareModel {
            return compareWith(comparePath, resolve(comparePath, false, null), null, false);
        },
        groupBase(value: ValueId, onAxis: (path: string) => boolean = () => true): { group: string; value: number | null } | null {
            const name = groupName();
            if (name === null) return null;
            const anchor = deps.slots()[1];
            const comparePath = anchor ? fileOfKey(anchor) : null;
            const base = comparePath ? resolve(comparePath) : { paths: groupSet(null, name, null).set.paths, channel: null };
            const results = current();
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
            return `${deps.groupLabel(deps.group())} ${name || '—'} · ${medianText(groupSet(null, name, null).set)}`;
        },
        groupName,
    };
}
