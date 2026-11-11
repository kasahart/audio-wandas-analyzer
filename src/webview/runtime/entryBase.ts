/**
 * What a compared row of the entry table is measured against: the slot-0 recording, else the median of a group
 * (the one chosen on the base chip, else the compared row's) over the table's filters (not the value's own range),
 * of the compared row's channel. The comparison, a fixed difference, the report and the slot chips all ask here,
 * so they name and measure the same base. Every base is one figure set (figureModel.figureUsed) of the answer
 * store's answers: nothing here reads a map of results, so no stale or unjudged value is ever counted.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { baseGroupMembers, fileOfKey, groupOf, isComputed, valueOf, type DatasetRow, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { median } from '../../shared/dataset/distribution';
import { buildCompareModel, setMedian, type CompareInput, type CompareModel } from './comparePanes';
import { comparedKeys, roleKey } from './entrySlots';
import { scanAnswer, type ScanAnswer } from './answerStore';
import { channelAnswer, EXCLUSION_REASONS, excludedFor, figureUsed, referenceIdentity, scanIdentity, setCountText, setExclusionText, type FigureSet, type FolderReference, type ReadScan } from './figureModel';
import { type BaseDefinition } from './entryTable';

/** A channel row of a recording of several channels is compared as that channel; otherwise the channels together. */
export const channelOfRow = (row: DatasetRow | undefined): number | null => (row && (row.channels ?? 1) > 1 ? row.ch : null);

/** Where a base's answers come from: the answer store's (default), a region's scans made now, or the store's with bins. */
export interface AnswerSource {
    answers(paths: readonly string[]): ScanAnswer[];
}

/**
 * The answers of scans the comparison made now over a region, under the current chain (its own compare-scan): a
 * file's answer is its value there (none yet: pending), never the table's state.
 */
export function regionAnswers(measured: ReadonlyMap<string, ScanResult>): AnswerSource {
    return { answers: paths => paths.map(path => scanAnswer(path, measured.get(path), { region: 'over' })) };
}

/**
 * The store's answers, with the files `measured` now (the held plot's and the report's own scans of them, under the
 * current chain and their version now, with every Welch bin) standing for the store's: such a file's answer is its scan
 * now, ready, never the table's state (a table scan of an earlier chain does not make it stale); every other file's is
 * the store's.
 */
export function binnedAnswers(source: AnswerSource, measured: ReadonlyMap<string, ScanResult>): AnswerSource {
    return {
        answers: paths => {
            const own = source.answers(paths);
            return paths.map((path, index) => { const scan = measured.get(path); return scan?.ok ? scanAnswer(path, scan) : own[index]; });
        },
    };
}

export interface EntryBaseOf {
    /** The figure set every count, median, file list and heading of this base is of. */
    set: FigureSet<ReadScan>;
    /** Its files: the set's. */
    paths: readonly string[];
    /**
     * The recordings the base asks for and draws with its channel: its members not known to be of another reference
     * or axis (those still pending, stale or failed too: a scan or a step picture comes of them). Never counted: `set` is.
     */
    members: string[];
    title: string;
    /** This base's heading for another figure's set of its members (a step figure's, of their pictures). */
    heading(set: FigureSet<unknown>, count?: string): string;
    definition: BaseDefinition;
    channel: number | null;
    /** What the comparison is measured against, as its sets. */
    compareBase: CompareInput['base'];
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
    /** Files' scans as the answer store hands them (state and identity: stale when of an earlier chain or calibration). */
    answersOf(paths: readonly string[]): ScanAnswer[];
    /** The folder's one level reference (figureModel.folderReference): a group base with nothing compared is of it. */
    reference(): FolderReference;
}

export interface EntryBase {
    /** The slotted row of a file the comparison shows (slots 1–3 first, then 0). */
    slotRowOf(filePath: string): DatasetRow | undefined;
    /**
     * What `comparePath` is measured against; `byGroup`: a group's median even with slot 0 filled; `asChannel`: the
     * channel it is compared as (null: its channels together, as the entry CSV's per-file rows are), else its row's.
     */
    resolve(comparePath: string, byGroup?: boolean, asChannel?: number | null, over?: AnswerSource): EntryBaseOf;
    /** The channel a file is drawn and measured with in the comparison of `comparePath`. */
    stageChannel(path: string, comparePath: string | null, byGroup?: boolean): number | null;
    /** The comparison of `comparePath` with its base (of `over`'s answers when given), each file as the channel it is compared as. */
    comparison(comparePath: string, byGroup?: boolean, over?: AnswerSource, entryRegionBase?: boolean): CompareModel;
    /** The comparison of a whole recording (its channels together) with the base it has now: the entry CSV's Δ columns. */
    fileComparison(comparePath: string): CompareModel;
    /**
     * The base group's value of `value` where the comparison measures from it (slot 0 empty, a group chosen or slot 1's):
     * the median of its one set; null otherwise. The distribution draws its base line here. A level is given only
     * when the axis it is drawn on (`onLevel`, the distribution's reference) is the set's identity.
     */
    groupBase(value: ValueId, onLevel?: string | null): { group: string; value: number | null } | null;
    /** The base chip's text: slot 0's row, else the group whose median is the base. */
    text(): string;
    /** The group whose median is the base: the one chosen, else slot 1's (slot 0 empty, a grouping chosen). */
    groupName(): string | null;
    /**
     * The set of the folder's reference over `paths` (the distribution's recordings): what its heading counts and what
     * it says it left out, with why (R1, as every base heading says it).
     */
    /** `hasValue`: whether a ready recording has the value drawn (a band beyond its Nyquist has none: empty, with why). */
    folderSet(paths: readonly string[], hasValue?: (path: string) => boolean): FigureSet<ReadScan>;
}

export function createEntryBase(deps: EntryBaseDeps): EntryBase {
    const { strings } = deps;
    const store: AnswerSource = { answers: paths => deps.answersOf(paths) };
    const slotRowOf = (filePath: string): DatasetRow | undefined => deps.rowOf(roleKey(deps.slots(), filePath) ?? null);
    /** The row a recording is compared as: its slot's, else the table's first of that file (a focused, unslotted one). */
    const compareRowOf = (filePath: string): DatasetRow | undefined => slotRowOf(filePath) ?? deps.rows().find(row => row.filePath === filePath);
    /** The recording the comparison is of: slot 1, else the first of slots 2–3 compared (the anchor of a group base). */
    const anchorSlot = (): string | null => deps.slots().slice(1).find((key): key is string => !!key) ?? null;
    /**
     * The base group: `name`'s rows of the pool (every row when not grouped), of `channel`, without the compared
     * recording and the other compared slots (1–3); its set is counted against the compared recording's ready answer
     * (none compared: the folder's reference). The one set every base group, its heading, n, files, median and Δ are of.
     */
    function groupSet(comparePath: string | null, name: string, channel: number | null, over: AnswerSource): { set: FigureSet<ReadScan>; asked: string[] } {
        const group = deps.group();
        const compared = new Set(comparedKeys(deps.slots()).map(fileOfKey));
        const members = baseGroupMembers(deps.pool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath ?? '', group, name, channel);
        const others = members.paths.filter(path => path !== comparePath);
        // One ask for the compared recording and every member (the current chain is worked out once).
        const ask = (source: AnswerSource): ScanAnswer[] => source.answers(comparePath ? [comparePath, ...others] : others).map(answer => channelAnswer(answer, channel));
        const identityOf = (answers: ScanAnswer[]) => (comparePath ? scanIdentity(answers[0]) : referenceIdentity<ReadScan>(deps.reference()));
        const tableAnswers = ask(store);
        const table = figureUsed(identityOf(tableAnswers), comparePath ? tableAnswers.slice(1) : tableAnswers, members.fewerPaths.map(path => ({ path, reason: 'no-channel' as const })));
        // Those of another reference or axis by the table's answers are not asked for (nor measured over a region):
        // they stay in the set's left-out list with why, so every heading, CSV and report says them.
        const known = table.excluded.filter(item => item.reason === 'other-reference' || item.reason === 'other-channels' || item.reason === 'other-axis');
        // Members without the channel compared are left out with why, in the set as every other reason (one count).
        const left = [...known, ...members.fewerPaths.map(path => ({ path, reason: 'no-channel' as const }))];
        const other = known.map(item => item.path);
        const askedNow = over === store ? tableAnswers : ask({ answers: paths => over.answers(paths.filter(path => !other.includes(path))) });
        const set = over === store ? table : figureUsed(identityOf(askedNow), (comparePath ? askedNow.slice(1) : askedNow), left);
        return { set, asked: others.filter(path => !other.includes(path)) };
    }
    /** The base's count and every recording it left out, each reason apart, as the set says them (the heading's own). */
    function definitionOf(set: FigureSet<ReadScan>): Pick<BaseDefinition, 'count' | 'left'> {
        const left = Object.fromEntries(EXCLUSION_REASONS.map(reason => [reason, excludedFor(set, reason)] as const).filter(([, n]) => n > 0));
        return { count: set.n, ...(Object.keys(left).length ? { left } : {}) };
    }
    function resolve(comparePath: string, byGroup = false, asChannel?: number | null, over: AnswerSource = store): EntryBaseOf {
        const slots = deps.slots();
        const group = deps.group();
        const compareRow = compareRowOf(comparePath);
        const channel = asChannel !== undefined ? asChannel : channelOfRow(compareRow);
        const narrowedBy = deps.narrowedBy();
        const within = narrowedBy.length ? strings.dsBaseNarrowed.replace('{filters}', narrowedBy.join('・')) : '';
        const single = slots[0];
        if (single && !byGroup) {
            // Compared as all its channels (asChannel null: a file's row of the entry table), slot 0 is too: the same
            // channels on both sides, never all of one against a channel of the other.
            const ch = asChannel === null ? null : channelOfRow(deps.rowOf(single));
            const path = fileOfKey(single);
            const [compared, answer] = over.answers([comparePath, path]);
            const own = channelAnswer(answer, ch);
            // Slot 0 is counted (n 1) only when it is ready and of the compared recording's identity: never "n=1" blindly.
            const set = figureUsed(scanIdentity(channelAnswer(compared, channel)), [own]);
            // Its condition's other recordings, of its own identity: how far files of it differ by chance (the headline bands).
            const baseRow = deps.rowOf(single);
            // Never a compared slot's (1–3): those are what is measured, as a group base leaves them out.
            const slotted = new Set(comparedKeys(slots).map(fileOfKey));
            const peerPaths = group === 'none' || !baseRow ? [] : baseGroupMembers(deps.pool(), path, group, groupOf(baseRow, group), ch).paths.filter(other => other !== comparePath && !slotted.has(other));
            const peers = figureUsed(scanIdentity(own), over.answers(peerPaths).map(peer => channelAnswer(peer, ch)));
            const name = `${strings.entryBase} · ${deps.rowName(single)}`;
            const heading = (of: FigureSet<unknown>): string => name + setExclusionText(of, strings);
            return {
                set, paths: set.paths, members: [path], title: heading(set), heading, channel: ch,
                compareBase: { kind: 'file', answer: own, set, peers },
                definition: { kind: 'file', file: deps.rowName(single), channel: ch, filters: narrowedBy, fewerChannels: 0, ...definitionOf(set) },
            };
        }
        const name = group === 'none' ? '' : deps.baseGroup() ?? (compareRow ? groupOf(compareRow, group) : '');
        const { set, asked } = groupSet(comparePath, name, channel, over);
        const where = group === 'none' ? strings.dsDistAll : `${deps.groupLabel(group)} ${name || '—'}`;
        const heading = (of: FigureSet<unknown>, count?: string): string => `${strings.entryBaseGroup} ${where} · ${setCountText(of, strings, count, channel)}${channel ? ` · ${strings.dsCh}${channel}` : ''}` + within;
        const title = heading(set);
        return {
            set, paths: set.paths, members: asked, title, heading, channel,
            compareBase: { kind: 'group', set, title },
            definition: { kind: 'group', group: { column: group === 'none' ? '' : deps.groupLabel(group), name }, channel, filters: narrowedBy, fewerChannels: excludedFor(set, 'no-channel'), ...definitionOf(set) },
        };
    }
    function compareWith(comparePath: string, base: EntryBaseOf, compareChannel: number | null, over: AnswerSource = store, entryRegionBase = false): CompareModel {
        const compared = channelAnswer(over.answers([comparePath])[0], compareChannel);
        return buildCompareModel({ compared, base: base.compareBase }, strings, entryRegionBase);
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
    /** The group base's set: the compared slot's base (1, else 2 or 3), else the chosen group's of the folder's reference. */
    function groupBaseOf(name: string): { set: FigureSet<ReadScan>; channel: number | null } {
        const anchor = anchorSlot();
        if (anchor) { const base = resolve(fileOfKey(anchor)); return { set: base.set, channel: base.channel }; }
        // Grouped by channel, the group is that channel's rows: its median is of that channel, not the files' together.
        const channel = deps.group() === 'ch' && Number(name) > 0 ? Number(name) : null;
        return { set: groupSet(null, name, channel, store).set, channel };
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
        comparison(comparePath: string, byGroup = false, over: AnswerSource = store, entryRegionBase = false): CompareModel {
            // The compared side is the channel its base is resolved for (the same row: a slot's, else the focused file's).
            return compareWith(comparePath, resolve(comparePath, byGroup, undefined, over), channelOfRow(compareRowOf(comparePath)), over, entryRegionBase);
        },
        folderSet(paths: readonly string[], hasValue: (path: string) => boolean = () => true): FigureSet<ReadScan> {
            const answers = deps.answersOf([...new Set(paths)]).map((answer): ScanAnswer => (answer.state === 'ready' && !hasValue(answer.identity.path) ? { state: 'empty', identity: answer.identity } : answer));
            return figureUsed(referenceIdentity<ReadScan>(deps.reference()), answers);
        },
        fileComparison(comparePath: string): CompareModel {
            return compareWith(comparePath, resolve(comparePath, false, null), null);
        },
        groupBase(value: ValueId, onLevel?: string | null): { group: string; value: number | null } | null {
            const name = groupName();
            if (name === null) return null;
            const { set, channel } = groupBaseOf(name);
            if (!isComputed(value)) {
                // A CSV value needs no scan: the median of the group's recordings' own values, each once.
                // The group's recordings as every base group counts them: never a compared slot (1–3) or the compared one.
                const compared = comparedKeys(deps.slots()).map(fileOfKey);
                const members = deps.pool().filter(row => groupOf(row, deps.group()) === name && !compared.includes(row.filePath));
                const once = members.filter((row, index) => members.findIndex(other => other.filePath === row.filePath) === index);
                return { group: name, value: median(once.map(row => valueOf(row, value, new Map())).filter((number): number is number => number !== null)) };
            }
            if (value === 'peak' || value === 'crest') {
                // Not a level: the median of the set's own values, per channel row of the set's channel.
                const results = new Map(set.used.map(item => [item.path, item.value]));
                const members = deps.pool().filter(row => results.has(row.filePath) && (!channel || row.ch === channel));
                const once = isComputed(value) ? members : members.filter((row, index) => members.findIndex(other => other.filePath === row.filePath) === index);
                // Of one channel the set's values are that channel's alone (channelAnswer): read at their one index,
                // by the channel picked, never at the row's ch − 1.
                return { group: name, value: median(once.map(row => valueOf(channel ? { ...row, ch: 1 } : row, value, results)).filter((number): number is number => number !== null)) };
            }
            // A level: the median the comparison measures its Δ from, drawn only on an axis of the set's own identity.
            if (onLevel !== undefined && onLevel !== set.level) return { group: name, value: null };
            const levels = setMedian(set);
            const level = !levels ? null : value === 'leq' ? levels.leq : levels.bands[Number(value.slice(5))] ?? null;
            return { group: name, value: level };
        },
        text(): string {
            const slots = deps.slots();
            if (slots[0]) return deps.rowName(slots[0]);
            if (slots[1]) return resolve(fileOfKey(slots[1])).title;
            const name = groupName();
            if (name === null) return strings.entryBaseGroup;
            // The group's recordings as a base: the same set the distribution's base line is of.
            return `${deps.groupLabel(deps.group())} ${name || '—'} · ${setCountText(groupBaseOf(name).set, strings)}`;
        },
        groupName,
    };
}
