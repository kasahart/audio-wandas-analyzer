/**
 * The entry screen: a folder's recordings, one row per recording and channel, with the attributes of the CSV
 * the user picked and what each file's header says. The user picks the value and the grouping, filters
 * and sorts each column like a spreadsheet, and puts rows in slots 0–3 to compare them. The entry analyses
 * nothing: a row put in a slot becomes a track, and the comparison asks for its pictures. Keys while a row has the focus: 0–3 (put the row in that slot), Space (play it),
 * M (its memo), Enter (open the slotted rows), ↑/↓ (move), Esc (close what is open, then leave). Keys on a
 * button or a field are that element's own.
 */
import { createLatestAnswers } from './answerStore';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { rangePopoverStrings, type UiStrings } from '../../shared/i18n/strings';
import { uiNumber } from '../../shared/utils/format';
import type { EntryOpenMessage, EntryProbeCancelMessage, EntryProbeMessage, EntryProbePublication, EntryPublication, EntrySaveSessionMessage } from '../../shared/analysis/entryScan';
import { csvColumnTitle, type ExclusionReason, type FigureSet } from './figureModel';
import { batchBundle, batchCount } from '../../shared/batch/batchBundle';
import { compareGroupNames, groupLabels } from '../../shared/dataset/distribution';
import type { FigureAnswers } from '../answers/figureRequests';
import { BINS_LANE_ID, createDistributionFigure, distributionHeight, distributionLane } from '../screens/distributionFigure';
import { createFilterPopover } from './entryFilterPopover';
import { channelOfRow, createEntryBase } from './entryBase';
import { HostRequests } from './hostRequests';
import { LARGE_BASE } from './trackStageMode';
import { runnableRecipe, stepLimits } from './stepBar';
import type { ReportRow } from './compareReport';
import { activeSlotReferenced, brokenStep, endsInEvents, isRecipeChain, recipeKey, recipeNodes } from '../../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { baseName, isMetadataCandidate } from '../../shared/analysis/entryMetadata';
import { CSVColumnCountError, csvColumnCountMessage } from '../../shared/dataset/csvDiagnostics';
import { keyRouterFor } from '../shell/keyRouter';
import { createHeaderProbe, readCost } from './entryHeaders';
import { createRedraw, createThrottle } from './entryRedraw';
import { createSessionSaver, readStoredSession, SESSION_VERSION } from './entrySession';
import { comparedKeys, settledKey, emptySlots, firstFreeCompareSlot, restoredSlots, roleKey, roleSlot, slotFiles as filesOfSlots, slotsForFiles, slotsOfFile, trackChanges, withoutFile, withSlot, type Slots } from './entrySlots';
import { setHint } from './hintFooter';
import { ENTRY_KEYS, keyAction } from './shortcuts';
import {
    annotatedCsv, datasetRows, filteredRows, fileOfKey, groupOf as datasetGroupOf, isInfo, matchCsv, readDatasetCsv, tableCsv, valueOf, visibleRows,
    type ColumnId, type CsvMatch, type DatasetCsv, type DatasetFilter, type DatasetRow, type FileInfo, type GroupId, type InfoId, type ValueId,
    type ValueRange,
} from '../../shared/dataset/datasetTable';
import {
    closesEntryDialog, filterChipText, rowWindow, tableLines, datasetColsHtml, datasetHeadHtml, datasetRowsHtml, entryScreenHtml, filterChipsHtml, formatValue,
    baseOptionsHtml, distributionLegendHtml, batchPopHtml, groupOptionsHtml, memoPopHtml, slotMenuHtml, unmatchedRowsHtml, valueOptionsHtml, ENTRY_ROW_HEIGHT,
    type DatasetColumn, type DatasetScreenView, type EntryStrings,
} from './entryTableHtml';
import { writeKeptRows } from './keptRows';

/** Scan results are redrawn at most this often (entryRedraw.ts' createThrottle). */
const REDRAW_MS = 250;
/** A lane of the distribution's Figure (CSS px): low above the table, between these on the right. */
const DIST_FIGURE_STRIP_LANE = 40, DIST_FIGURE_LANE_MIN = 64, DIST_FIGURE_LANE_MAX = 150;
/** The table's rows are this tall, exactly (CSS: .entry-table tr.entry-row), so only the rows on screen are drawn. */
const ROW_HEIGHT = ENTRY_ROW_HEIGHT;
/** A CSV larger than this is read but not kept for the next session (the webview's state would grow too large). */
const KEEP_CSV_BYTES = 2 * 1024 ** 2;
/** The session is saved this long after the last change, so typing or dragging saves once. */
const SESSION_SAVE_MS = 600;

/** What the user chose to see: the value, the grouping, the filters and order, which list, and the base group. */
interface EntryChoices {
    value: ValueId;
    group: GroupId;
    filters: DatasetFilter[];
    sort: DatasetScreenView['sort'];
    mode: DatasetScreenView['mode'];
    /** 「トラックのみ」: the table narrowed to the files on a track. */
    tracksOnly: boolean;
    /** The group whose median is the base while slot 0 is empty; null: slot 1's group. */
    baseGroup: string | null;
}

const defaultChoices = (): EntryChoices => ({ value: 'none', group: 'none', filters: [], sort: { column: 'name', descending: false }, mode: 'all', tracksOnly: false, baseGroup: null });

/** What a comparison of the slotted files needs of the entry table (the track view's steps mode, D and the report). */
export interface CompareData {
    slots: (string | null)[];
    /** The step bar's Recipe, and the one the comparison runs (invalid steps left out; undefined = the host's own). */
    recipe?: RecipeDocument | null;
    runRecipe?: RecipeDocument;
    /** Steps that failed on a file, left out of the chain run. */
    failed?: Readonly<Record<string, string>>;
    /** The step the comparison opens on; the chain's end without one. */
    stage?: string;
    /** How many times a file's calibration or the file itself changed while the folder is open: part of what its pictures are of (stageBasis). */
    fileEpoch?(path: string): string;
}

export interface EntryScreenDeps {
    document: Document;
    /** The page's figure requests: for the distribution on the new path, shown to the tests only. */
    figures?: FigureAnswers;
    window: Pick<Window, 'addEventListener' | 'setTimeout' | 'clearTimeout' | 'requestAnimationFrame'> & { performance: Pick<Performance, 'now'> };
    strings: UiStrings;
    post(message: EntryOpenMessage | EntryProbeMessage | EntryProbeCancelMessage | EntrySaveSessionMessage): void;
    loadSlots(): readonly (string | null)[] | undefined;
    saveSlots(slots: (string | null)[]): void;
    /** The attribute CSV the user picked (its name and text), kept for the next session; undefined forgets it. */
    loadCsv?(): { name: string; text: string } | undefined;
    saveCsv?(csv: { name: string; text: string } | undefined): void;
    /** The Recipe edited in the step bar; anything unreadable is dropped with a one-line warning. */
    loadRecipe?(): unknown;
    saveRecipe?(recipe: RecipeDocument | undefined): void;
    /** Leaves the entry screen for the comparison on these files. */
    openFiles(filePaths: string[], comparison: CompareData): void;
    /** New results or conditions while the comparison is open, so it can redraw. */
    compareChanged?(): void;
    announce(text: string): void;
    download(csv: string, fileName: string): void;
    /** Writes a folder of text files where the user picks (a recipe bundle). */
    saveFolder?(folder: string, files: Array<{ name: string; text: string }>): void;
    /** Where the table sits while it is not maximized: the track view's side panel (the page's body without one). */
    dock?: HTMLElement | null;
    /** The table was widened to the whole window, or shrunk back into the side panel. */
    maximizedChanged?(maximized: boolean): void;
    /** A step failed on a file: the step bar that shows the chain marks it. */
    stepsChanged?(): void;
    /** The files shown as tracks in the track view, each with whether it is hidden there (👁). */
    shownTracks?(): ReadonlyMap<string, boolean>;
    /** Shows a file as a track, or takes it off the track view. */
    setShown?(filePath: string, shown: boolean): void;
    /** Shows many files as tracks at once (one analysis request), or takes them all off. */
    setShownMany?(filePaths: readonly string[], shown: boolean): void;
    /** Hides a shown track in the track view, or shows it again. */
    setHidden?(filePath: string, hidden: boolean): void;
    /** ▶ on a row: plays the file alone, shown as a track while it plays; again stops it. */
    play?(filePath: string): void;
    /** The file playing in the track view. */
    playing?(): string | null;
    /** The colour a file's track is drawn in (its role's, else its own); undefined for a file not shown as a track. */
    recordingColor?(filePath: string): string | undefined;
}

export interface EntryScreen {
    /** Lists `filePaths` from the opened folder `rootPath`, below which tables name recordings by path; maximized unless told not to. */
    open(filePaths: string[], rootPath?: string, maximize?: boolean): void;
    /** Files added from elsewhere (＋ Add files, a drop): rows of the "added files" group, scanned like the rest. */
    addFiles(filePaths: string[]): void;
    /** Whether the table covers the window (maximized); in the side panel it is not "open" over the track view. */
    isOpen(): boolean;
    /** Takes off its key context, its plots' gestures and its step bar's keys (the clean-up promise of keyRouter and attachPlotInteraction). */
    dispose(): void;
    /** Widens the table to the whole window, or shrinks it back into the side panel. */
    setMaximized(maximized: boolean): void;
    /** Whether the side panel's table has the keyboard (a key goes to it, not to the lanes). */
    hasFocus(): boolean;
    /** The track view's tracks changed (shown, hidden, taken off): the rows' ＋ / 👁 / × follow. */
    tracksChanged(): void;
    /** A track was taken off in the track view (its lane's ×): the file leaves its slot too. */
    trackRemoved(filePath: string): void;
    /** Takes the host's entry messages; false for anything else. */
    handle(message: { type: string }): boolean;
    /** Shows the table again as it was, without scanning (the comparison's way back). */
    show(slots: (string | null)[]): void;
    /** A Recipe edited on the comparison's step bar: the table keeps it (the folder's session, the bundle). */
    setRecipe(recipe: RecipeDocument): void;
    /** A step that failed on a file (a comparison scan's): it is left out of the chain run. */
    stepFailed(step: string, reason: string): void;
    /** What the comparison needs of the table: its slots and Recipes. */
    compareData(): CompareData;
    /** The slots 0–3: the base file (or null for the group median) and the files to compare. */
    slots(): (string | null)[];
    /** Whether the rows are grouped: with slot 0 empty, the base is then the compared file's group median. */
    grouped(): boolean;
    /** A track's role: the slot its file is in (1–3 first, then 0) and that row's channel (null: the channels together). */
    trackRole(filePath: string): { slot: number; ch: number | null } | undefined;
    /**
     * Puts a track's file in a slot (its slotted row if it has one, else its first row), or takes it out of every
     * slot; the track stays on the track view either way.
     */
    setTrackRole(filePath: string, slot: number | null): void;
    /** What a compared file is measured against: the slot-0 file, or the other files of its group. */
    basePaths(comparePath: string, group?: boolean): string[];
    /** The base's heading over a figure's set of its members (the figure service's counts); none yet: its name alone. */
    /** `each`: its waveforms drawn each, so the set's n is said as "n files" (entryBaseCount), not a median's. */
    baseHeading(comparePath: string, group: boolean, set: FigureSet | null, each?: boolean): string;
    /** The base group's recordings the table knows cannot be drawn with it: fewer channels than the one compared, or a file that could not be read. */
    baseLeft(comparePath: string, group: boolean): Array<{ path: string; reason: ExclusionReason }>;
    /** How many channels a file of the table has (its rows' count); undefined for a file the table does not list. */
    channelCount(path: string): number | undefined;
    /** The channel `path` is drawn with when `comparePath` is compared (null: its channels together). */
    stageChannel(path: string, comparePath: string | null, group?: boolean): number | null;
    /** A compared recording as the report writes it: its name, value on show, memo, channel, base and condition cells. */
    /**
     * `byGroup`: the comparison measures against the group though slot 0 holds a recording (its B switch). `against`:
     * the recording whose base the comparison's figure has (the active one's; every line of the figure shares it).
     */
    reportRow(path: string, byGroup?: boolean, against?: string | null): ReportRow;
    /** The table's condition columns (the CSV's and the folders'), as the report heads them. */
    conditionColumns(): string[];
    /** How much audio these files are and about how long reading them takes, by the lengths their headers say. */
    cost(paths: readonly string[]): { seconds: number; ms: number };
    /** A compared file's name (with its channel), its value on show and its memo. */
    rowInfo(path: string): { label: string; value: string; memo: string };
    /** 「レシピをまとめて書き出す」 from the comparison: its choice of rows, then the bundle. */
    openBatch(): void;
    /** The table's exports, from the toolbar's 書き出し menu. */
    exportTable(): void;
    exportNotes(): void;
    /** What the table is narrowed to, for the report. */
    selection(): { value: string; group: string; filters: string[]; excluded: number };
    /** Turns the "Compared" filter on: the compared files and their base. */
    showCompared(): void;
    /** The chain (the edited one, else the host's), the one that runs, and the steps that failed on a file (with why); `channels`: the fewest of the files they run on, when not the table's. */
    recipes(channels?: number): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
    /** What the table currently shows, for tests. */
    snapshot(): {
        open: boolean; docked: boolean; cols: number; rows: number; visible: number; slots: (string | null)[]; focused: string | null;
        value: string; group: string; filters: DatasetFilter[]; sort: { column: string; descending: boolean }; excluded: string[]; memo: Record<string, string>;
        mode: string; unmatched: number; csv: string | null; playing: string | null; visibleKeys: string[];
        dist: { groups: Array<{ name: string; n: number; inRange: number }>; missing: number; unit: string; low: number; high: number; range: { low: number; high: number } | null; base: string | null; strip: boolean } | null;
    };
}

export function createEntryScreen(deps: EntryScreenDeps): EntryScreen {
    const { document, window, strings } = deps;
    const text: EntryStrings = strings;
    const host = document.createElement('div');
    host.innerHTML = entryScreenHtml(text);
    const screen = host.firstElementChild as HTMLElement;
    (deps.dock ?? document.body).append(screen);
    const query = <T extends Element>(selector: string): T => {
        const element = screen.querySelector<T>(selector);
        if (!element) throw new Error(`entry screen: no ${selector}`);
        return element;
    };
    const head = query<HTMLElement>('[data-entry-head]');
    const body = query<HTMLElement>('[data-entry-rows]');
    const cols = query<HTMLElement>('[data-entry-cols]');
    const table = query<HTMLElement>('[data-entry-table]');
    const chipsBox = query<HTMLElement>('[data-entry-chips]');
    const computeBox = query<HTMLElement>('[data-entry-compute]');
    const valueSelect = query<HTMLSelectElement>('[data-action="entry-value"]');
    const groupSelect = query<HTMLSelectElement>('[data-action="entry-group"]');
    const baseSelect = query<HTMLSelectElement>('[data-action="entry-base"]');
    const basePick = query<HTMLElement>('[data-entry-base-pick]');
    const csvInput = query<HTMLInputElement>('[data-entry-csv-input]');
    const tableWrap = query<HTMLElement>('.entry-table-wrap');
    /** The distribution is drawn on the next frame after a change, once however many changes ask. */
    let distributionAsked = false;
    const scheduleDistribution = (): void => {
        if (distributionAsked) return;
        distributionAsked = true;
        window.requestAnimationFrame(() => { distributionAsked = false; paintColumn(); });
    };
    // A range of the value picked on the distribution: a chip, which narrows the table.
    const pickValueRange = ({ low, high, closed }: ValueRange): (() => void) => {
        const back = tableNow();
        focus.picked = false;
        choose({ filters: [...chosen.filters.filter(filter => filter.column !== chosen.value), { column: chosen.value, kind: 'range', low, high, ...(closed ? { closed: true } : {}) }], mode: 'all' }, true);
        deps.announce(strings.dsDistPicked.replace('{n}', uiNumber(shownRows.length, strings.uiLocale)));
        return back;
    };
    const pickDistributionRow = (key: string): (() => void) => {
        const back = tableNow();
        // The very row the readout read (R7, R13), filters off if they hide it: never another row of its file. A
        // dot of a recording (a value of the file, not of a channel) goes to the file's row (focusFile).
        if (rows.some(row => row.key === key)) {
            if (!shownRows.some(row => row.key === key)) choose({ mode: 'all', filters: [], tracksOnly: false });
            focusRow(key, true);
        } else focusFile(fileOfKey(key));
        return back;
    };
    // The distribution of a CSV column of numbers is the Figure's (screens/distributionFigure.ts): the figure service
    // bins, counts and reads it, in the distribution's own box. The entry computes no value of its own.
    const distBox = query<HTMLElement>('[data-entry-dist]');
    const distHost = query<HTMLElement>('[data-entry-dist-figure]');
    const distReadout = distBox.querySelector<HTMLElement>('.entry-dist-note > [data-plot-readout]');
    const distEmpty = query<HTMLElement>('[data-entry-dist-empty]');
    /** Nothing to draw: the Figure off, and why in its place (nothing said while folded above the table). */
    const noDistribution = (why: string): false => {
        distFigure?.hide();
        distHost.hidden = true;
        for (const part of ['count', 'legend', 'note']) query<HTMLElement>(`[data-entry-dist-${part}]`).textContent = '';
        distEmpty.textContent = why;
        distEmpty.hidden = screen.classList.contains('is-dist-strip');
        return false;
    };
    /** Just folded above the table: its lanes in view go to the compared row's group, once its picture is drawn. */
    let distToSlot = false;
    const distFigure = deps.figures ? createDistributionFigure({
        document, host: distHost, ...(distReadout ? { readout: distReadout } : {}), answers: deps.figures, words: { ...strings, range: rangePopoverStrings(strings) },
        pickRange: range => pickValueRange(range), pickRow: pickDistributionRow,
        drawn: () => {
            if (!distToSlot || !screen.classList.contains('is-dist-strip')) return;
            distToSlot = false;
            const lane = distFigure?.inspect()?.lanes.find(item => item.bins?.marks.length);
            if (lane) distHost.scrollTop = Math.max(0, lane.frame.top - 10);
        },
    }) : null;
    /** The column last handed to the figure service, as text, and its version: another text is another version (compared whole, never by a hash of it). */
    let columnText = '', columnVersion = 0;
    /**
     * The CSV column the distribution shows, through the figure service: the column's value per table row, each
     * group's recordings (one row a recording) and the slots' rows. What is drawn and counted of them is the
     * service's. Whether the Figure shows it (not: no figure service here, no CSV column of numbers, or no number at
     * all, which its place then says).
     */
    const paintColumn = (): boolean => {
        const value = chosen.value;
        if (screen.hidden) { distFigure?.hide(); return false; }
        if (value === 'none') return noDistribution(attached.csv ? strings.dsDistNoNumber : strings.dsDistNoCsv);
        if (!distFigure) return noDistribution(strings.dsDistEmpty);
        const poolRows = distributionRows();
        const values = poolRows.map(row => valueOf(row, value));
        // The column's version: its rows and values as text (a table edited or filtered is another version).
        const text = [value, poolRows.map(row => row.key).join('\n'), values.join(',')].join('\u0000');
        if (text !== columnText) { columnText = text; columnVersion += 1; }
        const groups = new Map<string, string[]>();
        // The row that stands for a recording in a group (its first), by the recording and the group.
        const once = new Map<string, string>();
        // Each row's own stand-in: a slot on another channel of the recording is that recording's line.
        const standIn = new Map<string, string>();
        // The groups with a number at all (no lane of a group with none).
        const numbered = new Set<string>();
        for (const row of poolRows) {
            const name = datasetGroupOf(row, chosen.group);
            if (Number.isFinite(valueOf(row, value))) numbered.add(name);
            // A CSV value is the recording's: each recording once a group (its first row). A row with a blank is the
            // group's too: the service counts it (its `blank`), the screen does not leave it out.
            const first = once.get(`${row.filePath}\u0000${name}`);
            standIn.set(row.key, first ?? row.key);
            if (first !== undefined) continue;
            once.set(`${row.filePath}\u0000${name}`, row.key);
            groups.set(name, [...(groups.get(name) ?? []), row.key]);
        }
        const shown = [...groups.entries()].filter(([name]) => numbered.has(name)).sort(([a], [b]) => compareGroupNames(a, b)).map(([name, keys]) => ({ name, rows: keys }));
        if (!shown.length) return noDistribution(strings.dsDistEmpty);
        distEmpty.hidden = true;
        const range = valueRange();
        const strip = screen.classList.contains('is-dist-strip');
        // The heading: each lane says its own n (the service's count); many groups are said, as before.
        query<HTMLElement>('[data-entry-dist-count]').textContent = shown.length > 4 ? strings.dsDistGroups.replace('{n}', String(shown.length)) : '';
        const legend = query<HTMLElement>('[data-entry-dist-legend]');
        const legendHtml = distributionLegendHtml(slots, strings);
        if (legend.innerHTML !== legendHtml) legend.innerHTML = legendHtml;
        query<HTMLElement>('[data-entry-dist-note]').textContent = !range && !strip ? strings.dsDistDrag : '';
        const labels = groupLabels(shown.map(group => group.name));
        const prefix = chosen.group === 'ch' ? `${strings.dsCh} ` : '';
        // On the right the groups share the height; above the table they stay low, two of them in view (the rest scroll),
        // so the table under it is where it was.
        distHost.hidden = false;
        const available = Math.max(0, query<HTMLElement>('[data-entry-dist-area]').clientHeight - distHost.offsetTop - 16);
        const lane = strip ? DIST_FIGURE_STRIP_LANE : Math.max(DIST_FIGURE_LANE_MIN, Math.min(DIST_FIGURE_LANE_MAX, distributionLane(available, shown.length)));
        distHost.style.height = strip ? `${distributionHeight(Math.min(2, shown.length), lane)}px` : '';
        distHost.style.maxHeight = strip ? '' : `${Math.max(available, distributionHeight(1, DIST_FIGURE_LANE_MIN))}px`;
        distFigure.show({
            column: { key: `column:${value}`, version: `v${columnVersion}`, rows: poolRows.map(row => row.key), values },
            columnName: csvColumnTitle(value.slice(4), strings),
            groups: shown,
            groupLabel: name => (chosen.group === 'none' ? strings.dsDistAll : `${prefix}${labels.get(name) ?? name}` || strings.dsFilterBlank),
            roles: slots.flatMap((key, slot) => { const row = key ? standIn.get(key) : undefined; return row ? [{ row, role: slot === 0 ? 'base' : `compare${slot}` }] : []; }),
            rowName, selection: range, axes: `${value}|${chosen.group}`,
        }, Math.max(240, distHost.clientWidth || distBox.clientWidth || 400), lane);
        return true;
    };
    // The chain is edited where the analysis is decided: the track view's steps (trackStageMode.ts). The table
    // only keeps its state (the folder's session, the bundle it writes).
    const recipeState: {
        /** The host's Recipe, and the one edited in the comparison's step bar. */
        standard: RecipeDocument | null;
        edited: RecipeDocument | null;
        /** Steps that failed on a file, with wandas' reason: the chain is broken until the Recipe changes. */
        failed: Record<string, string>;
    } = { standard: null, edited: null, failed: {} };

    let filePaths: string[] = [];
    /** What the table asked the host for at open: the folder's session and the host's Recipe (only the latest asking is answered). */
    const requests = new HostRequests<undefined>();
    /** Whether the chain cannot run (a step that cannot, and so nothing after it). */
    const broken = (): boolean => { const recipe = recipeState.edited ?? recipeState.standard; return !!recipe && !!brokenStep(recipe, limits()); };
    /** How many times each file's calibration changed while the folder is open (the host says so). */
    const calibrations = createLatestAnswers<number>();
    const calibrationEpoch = (path: string): number => calibrations.get(path) ?? 0;
    /** How many times each file was written on disk while the folder is open (the host's watcher says so). */
    const sources = createLatestAnswers<number>();
    const sourceEpoch = (path: string): number => sources.get(path) ?? 0;
    /** What a file's pictures are asked under beyond the chain: its calibration's and its own changes. */
    const fileEpoch = (path: string): string => `${calibrationEpoch(path)}.${sourceEpoch(path)}`;
    /** The files' headers (channels, length, sample rate), read at open: the entry reads nothing else of a file. */
    // A header that could not be read is read again once its pause is over (the folder's files as they are then).
    const headers = createHeaderProbe(undefined, () => probe(filePaths));
    let rootPath = '';

    // ---- the dataset: the CSV the user picked, and what the user chose to see
    const attached: { csv: DatasetCsv | null; match: CsvMatch | null } = { csv: null, match: null };
    const chosen: EntryChoices = defaultChoices();
    const excluded = new Set<string>();
    const memo = new Map<string, string>();
    const tracks: {
        /** The files a click on the head would show, waiting for the count to be confirmed (more than LARGE_BASE). */
        pending: string[] | null;
        /** The listed files the head last tried to show all of: a second click while they are not all on takes them off. */
        tried: string | null;
        /** The file whose row and lane are lit under the mouse. */
        linked: string | null;
    } = { pending: null, tried: null, linked: null };
    let rows: DatasetRow[] = [];
    let shownRows: DatasetRow[] = [];
    const popovers: {
        /** The slot menu and the memo open (the column filter is filterPop's). */
        slotMenu: string | null;
        memoKey: string | null;
        /** 「レシピをまとめて書き出す」 open: for the filtered rows or all. */
        batch: 'filtered' | 'all' | null;
    } = { slotMenu: null, memoKey: null, batch: null };

    let requestCount = 0;
    /** Row keys in slots 0–3: the base (or null for the group median) and the rows to compare. */
    let slots: Slots = emptySlots();
    /** The focused row; until the user picks one (`picked`), the focus follows the top of the table. */
    const focus: { key: string | null; picked: boolean } = { key: null, picked: false };
    /** The folder's session, kept by the host: saved a moment after each change once the stored one is back. */
    const session = createSessionSaver(window, SESSION_SAVE_MS, () => sessionOf(),
        (stored, csvToSave) => deps.post({ type: 'entry-save-session', rootPath, session: stored, ...(csvToSave !== undefined ? { csv: csvToSave } : {}) }));
    /** The table's condition columns: the CSV's attributes, then the subfolder levels (as the grouping offers them). */
    const conditionColumns = (): string[] => [
        ...(attached.csv?.attributes ?? []),
        ...Array.from({ length: rows.reduce((most, row) => Math.max(most, row.folders.length), 0) }, (_, index) => strings.entryFolderLevel.replace('{n}', String(index + 1))),
    ];
    /** The rows through the filters but the value's own (unsorted), kept until the next rebuild. */
    let pool: DatasetRow[] | null = null;
    /** Whether a recording's header was read: an unreadable one is no row of the table. */
    const readable = (path: string): boolean => !headers.errors.has(path);
    /** The rows are made again only when the files, their headers or the CSV change, not on every redraw. */
    let rowsDirty = true;
    const slotFiles = (): (string | null)[] => filesOfSlots(slots);
    let byKey = new Map<string, DatasetRow>();
    const rowOf = (key: string | null): DatasetRow | undefined => (key ? byKey.get(key) : undefined);
    /** Headers as they arrive: a big table takes longer to draw, so it waits longer. */
    const resultsRedraw = createThrottle(window, () => window.performance.now(), REDRAW_MS, () => rebuild());
    /**
     * The table drawn again (the bar, the head, the rows, the slots) and the comparison told its data changed:
     * once per click, key or change however many things it changes.
     */
    const redraw = createRedraw([['paint', () => paint()], ['compare', () => deps.compareChanged?.()]] as const);
    const render = (): void => redraw.request('paint');
    /** A change from the track view (a lane shown, taken off) redraws the table only while it is on screen. */
    const renderIfOpen = (): void => { if (!screen.hidden) render(); };
    /** The comparison follows the table's data only while the table is in the side panel beside it. */
    const tellCompare = (): void => { if (!maximized) redraw.request('compare'); };
    /** What the user chose to see changed: the rows are listed again (from the top for a new order or filter). */
    function choose(patch: Partial<EntryChoices>, toTop = false): void {
        Object.assign(chosen, patch);
        if (toTop) tableWrap.scrollTop = 0;
        rebuild();
    }
    /**
     * The table as it is now (its choices, the focused row, where it is scrolled) and how to put it back: what a click
     * on a plot changed is taken back by a double click's second press, so a double click resets the zoom only (R13).
     */
    function tableNow(): () => void {
        const before = { chosen: { ...chosen, filters: [...chosen.filters], sort: { ...chosen.sort } }, focus: { ...focus }, scrollTop: tableWrap.scrollTop };
        return () => {
            Object.assign(focus, before.focus);
            // The choices are built again only when the click changed them (a bin's range chip): a row gone to is the focus alone.
            if (JSON.stringify(before.chosen) !== JSON.stringify(chosen)) choose(before.chosen); else render();
            tableWrap.scrollTop = before.scrollTop;
        };
    }
    /** A row the user picked takes the focus. */
    function focusOn(key: string | null): void {
        focus.key = key;
        focus.picked = true;
        render();
    }
    /**
     * New slots, kept for the next session; with `follow`, the tracks follow them: a slotted file is shown, a file
     * that leaves every slot leaves the tracks. The comparison open follows, and stays open.
     */
    function setSlots(next: Slots, follow = false): void {
        const before = slotFiles();
        slots = next;
        deps.saveSlots(slots);
        if (follow) {
            const { show, hide } = trackChanges(before, slotFiles());
            for (const path of show) deps.setShown?.(path, true);
            for (const path of hide) deps.setShown?.(path, false);
        }
        render();
        tellCompare();
    }
    /** The values the table can show: the CSV's columns of numbers (the entry computes none). */
    function valueOptions(): Array<{ id: ValueId; label: string }> {
        const csv = attached.csv;
        return (csv?.attributes ?? []).filter(column => csv?.numeric[column]).map(column => ({ id: `csv:${column}` as ValueId, label: column }));
    }
    /** The columns of a file's own information, as the table names them. */
    const infoColumns = (): Array<DatasetColumn & { id: InfoId }> => [
        { id: 'duration', label: strings.entryColDuration, numeric: true },
        { id: 'fs', label: strings.entryColRate, numeric: true, title: strings.entryColRateTitle },
        { id: 'calibration', label: strings.entryColCalibration, numeric: false },
    ];
    /** A file's own information: what its header says, and whether the host has a calibration for it (in the screen's word). */
    const infoOf = (filePath: string): FileInfo => {
        const info = headers.info.get(filePath);
        return { ...info, ...(info?.calibrated !== undefined ? { calibration: info.calibrated ? strings.entryCalibrated : strings.entryUncalibrated } : {}) };
    };
    function groupOptions(): Array<{ id: GroupId; label: string }> {
        const folders = rows.reduce((most, row) => Math.max(most, row.folders.length), 0);
        return [
            ...(attached.csv?.attributes ?? []).map(column => ({ id: `csv:${column}` as GroupId, label: column })),
            ...Array.from({ length: folders }, (_, index) => ({ id: `folder:${index + 1}` as GroupId, label: strings.entryFolderLevel.replace('{n}', String(index + 1)) })),
            { id: 'ch', label: strings.dsCh },
            { id: 'none', label: strings.dsGroupNone },
        ];
    }
    const valueLabel = (id: ValueId): string => (id === 'none' ? strings.dsValueNone : id.slice(4));
    const groupLabel = (id: GroupId): string => groupOptions().find(option => option.id === id)?.label ?? id;
    const columnLabel = (column: ColumnId): string => (column === 'name' ? strings.entryColFile : column === 'ch' ? strings.dsCh
        : column === 'none' ? strings.dsGroupNone : isInfo(column) ? (infoColumns().find(item => item.id === column)?.label ?? column)
            : column.startsWith('csv:') ? column.slice(4) : groupLabel(column));
    /** A column of numbers (a range filter, numeric order): a CSV column of numbers, a file's length or sample rate. */
    const numericColumn = (column: ColumnId): boolean => (column.startsWith('csv:') ? !!attached.csv?.numeric[column.slice(4)] : column === 'duration' || column === 'fs');
    const formatColumn = (_column: ColumnId, number: number): string => formatValue(number);
    function datasetView(): DatasetScreenView {
        return {
            rows: shownRows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, slots, focused: focus.key, playing: deps.playing?.() ?? null, memo, mode: chosen.mode, shown: shownFiles(), tracksAllOff: tracks.tried !== null && tracks.tried === listedFiles().join('\n'),
            unmatched: attached.match?.unmatched ?? [], filtered: new Set(chosen.filters.map(filter => filter.column)),
            columns: {
                name: { id: 'name', label: strings.entryColFile, numeric: false },
                ch: { id: 'ch', label: strings.dsCh, numeric: true },
                info: infoColumns(),
                ...(chosen.group === 'none' ? {} : { group: { id: chosen.group, label: groupLabel(chosen.group), numeric: false } }),
                ...(chosen.value === 'none' ? {} : { value: { id: chosen.value, label: valueLabel(chosen.value), numeric: true } }),
            },
        };
    }
    function unreadable(): Array<{ filePath: string; reason: string }> {
        return filePaths.flatMap(filePath => { const reason = headers.errors.get(filePath); return reason === undefined ? [] : [{ filePath, reason }]; });
    }
    /** The CSV rows and recordings that did not match; an unreadable recording is listed once, as unreadable. */
    function unmatchedItems(): CsvMatch['unmatched'] {
        if (!attached.csv || !attached.match) return [];
        const broken = new Set(unreadable().map(item => item.filePath));
        return attached.match.unmatched.filter(item => !item.filePath || !broken.has(item.filePath));
    }
    /**
     * A row taken (slotted, left out, noted, focused) before its file's channels were known follows it to its ch 1
     * once they are. A channel the file no longer has (rewritten with fewer) leaves its slot and is no longer left
     * out: ch 1 is never compared in its place. Its memo stays stored, shown again if the channel comes back.
     */
    function followChannels(): void {
        const keys = new Set(rows.map(row => row.key));
        const settled = (key: string): string | null => settledKey(key, keys, headers.channels);
        slots = slots.map(key => (key ? settled(key) : key));
        for (const key of [...excluded]) { const to = settled(key); if (to !== key) { excluded.delete(key); if (to) excluded.add(to); } }
        for (const [key, note] of [...memo]) { const to = settled(key); if (to && to !== key) { memo.delete(key); if (!memo.has(to)) memo.set(to, note); } }
        if (focus.key) focus.key = settled(focus.key) ?? focus.key;
    }
    function rebuild(): void {
        pool = null;
        if (rowsDirty) {
            rowsDirty = false;
            rows = datasetRows(filePaths, rootPath, attached.match?.attributes ?? new Map(), headers.channels, infoOf)
                .filter(row => readable(row.filePath));
            byKey = new Map(rows.map(row => [row.key, row]));
            followChannels();
        }
        // A value or grouping the data no longer has (another CSV, no subfolders) gives way to the first it has; a
        // filter or an order on a column the table no longer has (a session of an earlier version) is dropped.
        const values = valueOptions();
        if (!values.some(option => option.id === chosen.value)) chosen.value = values[0]?.id ?? 'none';
        const known = (column: string): boolean => column === 'name' || column === 'ch' || column === 'none' || isInfo(column) || column.startsWith('folder:') || (column.startsWith('csv:') && !!attached.csv?.columns.includes(column.slice(4)));
        if (!chosen.filters.every(filter => known(filter.column))) chosen.filters = chosen.filters.filter(filter => known(filter.column));
        if (!['name', 'ch', 'group', 'value'].includes(chosen.sort.column) && !isInfo(chosen.sort.column)) chosen.sort = { column: 'name', descending: false };
        const groups = groupOptions();
        if (!groups.some(option => option.id === chosen.group)) chosen.group = groups.find(option => option.id.startsWith('csv:') && !attached.csv?.numeric[option.id.slice(4)])?.id ?? 'none';
        const onTracks = chosen.tracksOnly ? shownFiles() : null;
        shownRows = chosen.mode === 'excluded' ? rows.filter(row => excluded.has(row.key))
            : visibleRows({ rows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, excluded }).filter(row => !onTracks || onTracks.has(row.filePath));
        if (!focus.picked || !focus.key || !rows.some(row => row.key === focus.key)) focus.key = shownRows[0]?.key ?? null;
        // An open question about showing the listed files counts the rows listed now.
        if (tracks.pending) { const adding = chosen.mode === 'all' ? notShown(listedFiles()) : []; tracks.pending = adding.length ? adding : null; }
        render();
        tellCompare();
    }
    /** Redraws the bar, the head and the rows; popovers that are open stay as they are (what is typed in them is kept). */
    function paint(): void {
        const view = datasetView();
        const values = valueOptions();
        if (!values.some(option => option.id === chosen.value)) chosen.value = values[0]?.id ?? 'none';
        const valueHtml = valueOptionsHtml(values, chosen.value, text);
        if (valueSelect.innerHTML !== valueHtml) valueSelect.innerHTML = valueHtml;
        valueSelect.value = chosen.value;
        const groupHtml = groupOptionsHtml(groupOptions(), chosen.group);
        if (groupSelect.innerHTML !== groupHtml) groupSelect.innerHTML = groupHtml;
        groupSelect.value = chosen.group;
        const chips = filterChipsHtml(chosen.filters, columnLabel, formatColumn, text, chosen.mode === 'all' ? { count: new Set(rows.filter(row => view.shown?.has(row.filePath)).map(row => row.filePath)).size, only: chosen.tracksOnly, confirm: tracks.pending?.length } : undefined);
        if (chipsBox.innerHTML !== chips) chipsBox.innerHTML = chips;
        renderProbing();
        const unmatchedButton = query<HTMLButtonElement>('[data-action="entry-view-unmatched"]');
        const unmatchedCount = unmatchedItems().length + unreadable().length;
        unmatchedButton.hidden = unmatchedCount === 0;
        unmatchedButton.textContent = (attached.csv ? strings.dsUnmatched : strings.dsUnreadable).replace('{n}', String(unmatchedCount));
        unmatchedButton.setAttribute('data-hint', attached.csv ? strings.hintUnmatched : strings.hintUnreadable);
        unmatchedButton.setAttribute('aria-pressed', String(chosen.mode === 'unmatched'));
        const excludedButton = query<HTMLButtonElement>('[data-action="entry-view-excluded"]');
        // Shown only when something is taken out (or its list is open, to come back from it).
        excludedButton.hidden = excluded.size === 0 && chosen.mode !== 'excluded';
        excludedButton.textContent = strings.dsExcluded.replace('{n}', String(excluded.size));
        excludedButton.setAttribute('aria-pressed', String(chosen.mode === 'excluded'));
        query('[data-entry-source]').textContent = attached.csv && attached.match ? strings.dsCsvSource.replace('{name}', attached.csv.name).replace('{matched}', String(attached.match.attributes.size)).replace('{total}', String(filePaths.length)) : strings.dsPickCsv;
        writeHtml(cols, datasetColsHtml(view));
        // The head is drawn again only when it changed; then a focus on its ☐/⊟/☑ stays there.
        const headFocused = !!document.activeElement?.closest?.('[data-action="entry-tracks-all"]') && head.contains(document.activeElement);
        if (writeHtml(head, datasetHeadHtml(view, text)) && headFocused) focusHeadMark();
        renderRows(view);
        paintBase();
        screen.dataset.mode = chosen.mode;
        scheduleDistribution();
        session.schedule();
    }
    /** Markup last written to an element by writeHtml, which writes it again only when it changes. */
    const written = new WeakMap<Element, string>();
    function writeHtml(element: Element, html: string): boolean {
        if (written.get(element) === html) return false;
        element.innerHTML = html;
        written.set(element, html);
        return true;
    }
    /** The base select beside the group one: shown while the rows are grouped (a group's median, or slot 0's recording). */
    function paintBase(): void {
        basePick.hidden = chosen.group === 'none';
        markOpenable();
        if (basePick.hidden) return;
        // The chosen group stays offered (and shown) when filters or exclusions leave none of its rows.
        const pool = new Set(distributionPool().map(row => datasetGroupOf(row, chosen.group)));
        if (chosen.baseGroup !== null) pool.add(chosen.baseGroup);
        const names = [...pool].sort(compareGroupNames);
        const labels = groupLabels(names);
        const grouping = groupLabel(chosen.group);
        const html = baseOptionsHtml(names.map(name => ({ name, label: `${grouping} ${labels.get(name) || strings.dsFilterBlank}` })), chosen.baseGroup, slots[0] ? rowName(slots[0]) : null, text);
        if (written.get(baseSelect) !== html) { baseSelect.innerHTML = html; written.set(baseSelect, html); }
        baseSelect.value = slots[0] ? 'row' : chosen.baseGroup === null ? 'auto' : `group:${chosen.baseGroup}`;
    }
    /** The view the rows on screen were drawn from: scrolling and resizing draw more of it instead of building it again. */
    let rowsView: DatasetScreenView | null = null;
    /** The 0–3 button lit to show where a recording goes, and when (performance.now()); FLASH_MS is the .is-flash animation's length. */
    let flash: { key: string; at: number } | null = null;
    const FLASH_MS = 900;
    /** Only the rows on screen are drawn (rowWindow): the rest are spacers. */
    function renderRows(view = rowsView ?? datasetView()): void {
        rowsView = view;
        if (chosen.mode === 'unmatched') { writeKeptRows(body, unmatchedRowsHtml(unmatchedItems(), unreadable(), text)); return; }
        const { first, last } = rowWindow(tableWrap.scrollTop, tableWrap.clientHeight, tableLines(view).length, ROW_HEIGHT);
        // The rows are drawn again: a focus on a row's ☐/☑ stays on a mark, so a second Space toggles it back
        // instead of falling to the body (and, docked, to the lanes' playback). It follows the focused row, so after
        // ↑/↓ the next Space or Enter takes the row that is lit, not the one the keys left.
        const focusedMark = document.activeElement?.closest?.('[data-action="entry-row-track"]');
        const markKey = focusedMark && body.contains(focusedMark) ? focusedMark.getAttribute('data-key') : null;
        // The rows still drawn keep their cells: a header that arrives changes its cells' text only (#781).
        writeKeptRows(body, datasetRowsHtml(view, first, last, ROW_HEIGHT, text));
        if (markKey !== null) body.querySelector<HTMLElement>(`[data-action="entry-row-track"][data-key="${CSS.escape(focus.key ?? markKey)}"]`)?.focus({ preventScroll: true });
        // A 0–3 button still lighting up (openSlotted) goes on with its light where it was: the rows are drawn again on
        // any change of size (a footer line, a header landing), which would put it out at once.
        if (flash) {
            const elapsed = performance.now() - flash.at;
            const button = elapsed < FLASH_MS ? body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(flash.key)}"] [data-action="entry-row-slotmenu"]`) : null;
            if (elapsed >= FLASH_MS) flash = null;
            else if (button) { button.style.animationDelay = `${-Math.round(elapsed)}ms`; button.classList.add('is-flash'); }
        }
        // Redrawn rows keep the light of the lane under the mouse.
        if (tracks.linked && document.querySelector(`.track-row[data-file-path="${CSS.escape(tracks.linked)}"]`)) {
            body.querySelectorAll(`tr.entry-row[data-file-path="${CSS.escape(tracks.linked)}"]`).forEach(row => row.classList.add('is-linked'));
        }
    }
    function rowName(key: string): string {
        const row = rowOf(key);
        return row ? ((row.channels ?? 1) > 1 ? `${row.name} ch${row.ch}` : row.name) : baseName(fileOfKey(key));
    }
    /** The rows a recipe bundle is for: those the table shows through its filters, or every row not excluded. */
    function batchRows(choice: 'filtered' | 'all'): DatasetRow[] {
        return choice === 'filtered' ? visibleRows({ rows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, excluded }) : rows.filter(row => !excluded.has(row.key));
    }
    function openBatch(): void {
        filterPop.close(); popovers.slotMenu = null; popovers.memoKey = null;
        popovers.batch = chosen.filters.length ? 'filtered' : 'all';
        renderPopovers();
    }
    /** The bundle: the Recipe as it runs (per channel when the rows are channels), targets.csv, run_recipe.py, README. */
    function exportBatch(): void {
        const choice = (screen.querySelector<HTMLInputElement>('[data-entry-batch-scope]:checked')?.value as 'filtered' | 'all' | undefined) ?? popovers.batch ?? 'all';
        const recipe = runRecipe() ?? recipeState.standard;
        if (!recipe || broken()) { deps.announce(strings.entryChainBroken); return; }
        if (endsInEvents(recipe, limits())) { deps.announce(strings.entryBatchEvents); return; }
        // A step measured against the base slot needs that one recording beside each: not a bundle of single files.
        if (activeSlotReferenced(recipeState.edited).length) { deps.announce(strings.entryBatchNoBase); return; }
        const targets = batchRows(choice);
        const idColumn = attached.csv && attached.csv.idColumn && attached.csv.idColumn !== attached.csv.audioColumn ? attached.csv.idColumn : undefined;
        // The Web host lists a picked folder as /sources/<name>: the README then asks for the folder instead.
        const runRoot = rootPath.startsWith('/sources/') ? '' : rootPath;
        const { folder, files } = batchBundle({ recipe, recipeName: strings.stepRecipeName, rows: targets, allRows: rows, rootPath, runRoot, idColumn, now: new Date() });
        closePopovers();
        deps.saveFolder?.(folder, files);
        deps.announce(strings.dsBatchSaved.replace('{n}', String(batchCount(targets).recordings)).replace('{folder}', folder));
    }
    function sessionOf(): Record<string, unknown> {
        return {
            version: SESSION_VERSION, value: chosen.value, group: chosen.group, filters: chosen.filters, sort: chosen.sort, baseGroup: chosen.baseGroup, slots, memo: [...memo], excluded: [...excluded],
            ...(recipeState.edited ? { recipe: recipeState.edited } : {}),
        };
    }
    /** The stored session, as it came back at open: anything that no longer fits these files is left out. */
    function applySession(stored: Record<string, unknown> | undefined, storedCsv: { name: string; text: string } | undefined): void {
        if (storedCsv) {
            try { applyCsv(readDatasetCsv(new TextEncoder().encode(storedCsv.text), storedCsv.name)); } catch { /* A CSV that no longer reads is dropped. */ }
        }
        const kept = readStoredSession(stored, new Set(filePaths));
        if (!kept) return;
        if (kept.value !== undefined) chosen.value = kept.value;
        if (kept.group !== undefined) chosen.group = kept.group;
        if (kept.filters) chosen.filters = kept.filters;
        if (kept.sort) chosen.sort = kept.sort;
        chosen.baseGroup = kept.baseGroup;
        if (kept.slots) { slots = kept.slots; deps.saveSlots(slots); }
        memo.clear();
        for (const [key, note] of kept.memo) memo.set(key, note);
        excluded.clear();
        for (const key of kept.excluded) excluded.add(key);
        // A chain saved with the session is the one the comparison opens with.
        const recipe = kept.recipe;
        if (recipe && recipeKey(recipe) !== recipeKey(recipeState.edited ?? undefined)) { recipeState.edited = recipe; deps.saveRecipe?.(recipe); }
    }
    const chipText = (filter: DatasetFilter): string => filterChipText(filter, columnLabel, formatColumn, text);
    /** What a compared row is measured against: the slot-0 recording, else a group's recordings. */
    const entryBase = createEntryBase({
        strings, slots: () => slots, rows: () => rows, rowOf, pool: () => basePool(), group: () => chosen.group, baseGroup: () => chosen.baseGroup,
        narrowedBy: () => chosen.filters.filter(filter => filter.column !== chosen.value).map(chipText),
        groupLabel, rowName: key => rowName(key), fileName: path => rows.find(row => row.filePath === path)?.name ?? baseName(path),
    });
    /** A compared file as the comparison names it: its name and channel, the value on show, its memo. */
    function rowInfo(path: string): { label: string; value: string; memo: string } {
        const row = entryBase.slotRowOf(path) ?? rows.find(item => item.filePath === path);
        if (!row) return { label: baseName(path), value: '', memo: '' };
        const number = valueOf(row, chosen.value);
        return { label: rowName(row.key), value: number === null ? '' : `${valueLabel(chosen.value)} ${formatValue(number)}`, memo: memo.get(row.key) ?? '' };
    }
    /** The rows the distribution draws from: not excluded, through every filter but the one on the value itself. */
    function distributionPool(): DatasetRow[] {
        pool ??= filteredRows({ rows, filters: chosen.filters.filter(filter => filter.column !== chosen.value), excluded });
        return pool;
    }
    /** The rows the distribution counts: the pool, and with "Tracks only" on, its rows on the tracks, as the table lists. */
    function distributionRows(): DatasetRow[] {
        if (!chosen.tracksOnly) return distributionPool();
        const onTracks = shownFiles();
        return distributionPool().filter(row => onTracks.has(row.filePath));
    }
    /** A base group's pool: the distribution's, and the unreadable recordings of its filters (each said failed). */
    function basePool(): DatasetRow[] {
        // A recording that could not be read is no row of the table, but still a member of its base group: the
        // comparison says it failed, with the rest (R4), never leaves it out unsaid. Its rows are made here, held nowhere.
        const unread = filePaths.filter(path => !readable(path));
        if (!unread.length) return distributionPool();
        // The filters an unreadable recording can answer: its name, its folders, its CSV row. Its channels and its
        // header's information are unknown, so a filter on those does not drop it.
        const unreadFilter = (column: string): boolean => column === 'name' || column.startsWith('folder:') || column.startsWith('csv:');
        const failed = filteredRows({ rows: datasetRows(unread, rootPath, attached.match?.attributes ?? new Map(), headers.channels), filters: chosen.filters.filter(filter => filter.column !== chosen.value && unreadFilter(filter.column)), excluded });
        return failed.length ? [...distributionPool(), ...failed] : distributionPool();
    }
    /** The range picked on the value drawn: it marks the distribution and narrows the table. */
    function valueRange(): ValueRange | null {
        const filter = chosen.filters.find(item => item.column === chosen.value);
        return filter?.kind === 'range' ? { low: filter.low, high: filter.high, ...(filter.closed ? { closed: true } : {}) } : null;
    }
    /** Reading the headers: quick, but a large folder takes a moment, and it can be stopped. */
    function renderProbing(): void {
        const probing = headers.progress();
        const html = probing ? `<span class="awa-tag" data-entry-probing>${escapeHtml(strings.dsProbing.replace('{done}', String(probing.done)).replace('{n}', String(probing.total)))}</span>`
            + `<button type="button" data-action="entry-probe-cancel">${escapeHtml(strings.entryScanCancel)}</button>` : '';
        if (computeBox.innerHTML !== html) computeBox.innerHTML = html;
    }
    /** The folder's sample rate (its first file's whose header says one), which the steps are checked against. */
    function sampleRate(): number | undefined {
        for (const path of filePaths) { const rate = headers.info.get(path)?.sampleRate; if (rate) return rate; }
        return undefined;
    }
    /** The shortest file's samples, by the headers. */
    function shortestSamples(): number | undefined {
        let shortest: number | undefined;
        for (const path of filePaths) {
            const info = headers.info.get(path);
            if (info?.durationS === undefined || !info.sampleRate) continue;
            const samples = Math.floor(info.durationS * info.sampleRate);
            shortest = shortest === undefined ? samples : Math.min(shortest, samples);
        }
        return shortest;
    }
    function limits() {
        return stepLimits({ sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed: recipeState.failed });
    }
    /** The fewest channels of the files whose headers were read, which a channel index must stay below. */
    function channelCount(): number | undefined {
        let fewest: number | undefined;
        for (const channels of headers.channels.values()) fewest = Math.min(fewest ?? Infinity, channels);
        return fewest;
    }
    /** The Recipe that runs; undefined is the host's own, unchanged (nothing edited, no step left out). */
    function runRecipe(channels?: number): RecipeDocument | undefined {
        const recipe = recipeState.edited ?? (Object.keys(recipeState.failed).length ? recipeState.standard : null);
        return recipe ? runnableRecipe(recipe, channels ? { ...limits(), channels } : limits()) : undefined;
    }
    function compareData(stage?: string): CompareData {
        return { slots: slotFiles(), recipe: recipeState.edited ?? recipeState.standard, runRecipe: runRecipe(), failed: recipeState.failed, fileEpoch, ...(stage ? { stage } : {}) };
    }
    /**
     * A step that failed on a file breaks the chain (⚠ on its chip and on every step after it) until the steps
     * change; a step already marked, or one this Recipe does not have, changes nothing.
     */
    function stepFailed(step: string, reason: string): void {
        const recipe = recipeState.edited ?? recipeState.standard;
        const known = recipeNodes(recipe).some(node => node.id === step);
        if (!known || recipeState.failed[step] !== undefined) return;
        recipeState.failed = { ...recipeState.failed, [step]: reason };
        rebuild();
        deps.stepsChanged?.();
    }
    /** A new Recipe from the comparison's step bar: kept, and tried whole again. */
    function setRecipe(recipe: RecipeDocument): void {
        recipeState.edited = recipe;
        // A new Recipe is tried whole again: a step that failed under the old one may not now.
        recipeState.failed = {};
        deps.saveRecipe?.(recipe);
        rebuild();
    }
    /** The files shown as tracks now (a hidden track is not). */
    const shownFiles = (): Set<string> => new Set([...deps.shownTracks?.() ?? []].filter(([, hidden]) => !hidden).map(([filePath]) => filePath));
    const focusHeadMark = (): void => { head.querySelector<HTMLElement>('[data-action="entry-tracks-all"]')?.focus(); };
    /** Opens the question about showing many files as tracks (`adding`), or closes it (null); the focus follows. */
    function askTracks(adding: string[] | null): void {
        tracks.pending = adding;
        render();
        redraw.after(adding ? () => screen.querySelector<HTMLElement>('[data-action="entry-tracks-all-go"]')?.focus() : focusHeadMark);
    }
    function toggleTrack(key: string): void {
        tracks.tried = null;
        const filePath = fileOfKey(key);
        if (!shownFiles().has(filePath)) { deps.setShown?.(filePath, true); return; }
        // Off the tracks is out of its slots too, as a lane's × does; the last slot it leaves takes the track off.
        const held = slotsOfFile(slots, filePath);
        if (!held.length) { deps.setShown?.(filePath, false); return; }
        for (const slot of held) setSlot(slot, null);
    }
    /** The head's ☐/⊟/☑: shows every listed file as a track (many only once confirmed), or takes them all off. */
    function toggleAllTracks(): void {
        const listed = listedFiles();
        const missing = notShown(listed);
        // Only a partial result of that try (⊟) turns into taking them off; with none on, ☐ shows them again.
        const tried = tracks.tried === listed.join('\n') && missing.length < listed.length;
        const adding = tried ? [] : missing;
        tracks.pending = null;
        tracks.tried = null;
        if (adding.length > LARGE_BASE) {
            askTracks(adding);
            return;
        }
        if (adding.length) { showAll(listed, adding); return; }
        // Off the tracks is out of the slots too, as a row's ☑ does; Tracks only would be left with no rows.
        const off = new Set(listed);
        slots.forEach((item, slot) => { if (item && off.has(fileOfKey(item))) setSlot(slot, null, false); });
        const wasOnly = chosen.tracksOnly;
        chosen.tracksOnly = false;
        deps.setShownMany?.(listed, false);
        if (wasOnly) rebuild();
    }
    function showAll(listed: readonly string[], adding: readonly string[]): void {
        tracks.tried = listed.join('\n');
        deps.setShownMany?.(adding, true);
    }
    const listedFiles = (): string[] => [...new Set(shownRows.map(row => row.filePath))];
    const notShown = (filePaths: readonly string[]): string[] => { const shown = shownFiles(); return filePaths.filter(filePath => !shown.has(filePath)); };
    /** Puts a row in a slot (out of any other); the same row again takes it out. The comparison open follows, and stays open. */
    function setSlot(slot: number, key: string | null, follow = true): void {
        setSlots(withSlot(slots, slot, key), follow);
    }
    /** Asks the host for the folder's session and its Recipe: nothing of a file is read for it. */
    function askSession(): void {
        requests.ask('open', `entry-${++requestCount}`, rootPath, undefined, ({ requestId }) => deps.post({ type: 'entry-open', requestId, rootPath }));
    }
    /** Reads the files' headers: their channels (rows split by channel), length and sample rate. */
    function probe(paths: readonly string[]): void {
        const message = headers.start(paths, () => `probe-${++requestCount}`);
        if (message) deps.post(message);
    }
    function cancelProbe(): void {
        if (!headers.progress()) return;
        deps.post({ type: 'entry-probe-cancel' });
        headers.cancel();
        render();
    }
    /** Moves the focus to a row and brings it on screen (the rows are drawn only where they are seen). */
    function focusRow(key: string | null, center = false): void {
        if (!key) return;
        const index = tableLines(datasetView()).findIndex(line => line.key === key);
        if (index >= 0) {
            const top = index * ROW_HEIGHT, bottom = top + ROW_HEIGHT, view = tableWrap.clientHeight - ROW_HEIGHT;
            if (center) tableWrap.scrollTop = Math.max(0, top - view / 2);
            else if (top < tableWrap.scrollTop) tableWrap.scrollTop = top;
            else if (bottom > tableWrap.scrollTop + view) tableWrap.scrollTop = bottom - view;
        }
        focusOn(key);
    }
    /** A file picked elsewhere (a point on the scatter, the strip): its first row, filters off if they hide it. */
    function focusFile(filePath: string): void {
        const key = shownRows.find(row => row.filePath === filePath)?.key ?? rows.find(row => row.filePath === filePath)?.key;
        if (!key) return;
        if (!shownRows.some(row => row.key === key)) choose({ mode: 'all', filters: [], tracksOnly: false });
        focusRow(key, true);
    }
    function moveFocus(step: number): void {
        if (!shownRows.length) return;
        const index = focus.key ? shownRows.findIndex(row => row.key === focus.key) : -1;
        focusRow(shownRows[Math.min(shownRows.length - 1, Math.max(0, index + step))].key);
    }
    /**
     * The table is one: in the track view's side panel, or maximized over the whole window. Its width decides what
     * it shows (data-cols 1–6); maximized shows everything, the side plots too.
     */
    let maximized = false;
    const sizeButton = query<HTMLButtonElement>('[data-action="entry-maximize"].entry-size');
    const COLUMN_WIDTHS = [0, 300, 380, 480, 560, 900];
    function syncColumns(): void {
        const width = screen.clientWidth;
        const columns = maximized ? 6 : COLUMN_WIDTHS.filter(edge => width >= edge).length;
        if (screen.dataset.cols !== String(columns)) {
            screen.dataset.cols = String(columns);
            if (columns >= 6) scheduleDistribution();
        }
    }
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) new Observer(() => { syncColumns(); renderRows(); }).observe(screen);
    // The distribution's Figure takes its width of its box and its lanes' height of the room beside the table: asked
    // again when either is another (a window resized).
    const distArea = query<HTMLElement>('[data-entry-dist-area]');
    let distWidth = distBox.clientWidth, distRoom = distArea.clientHeight;
    if (Observer) {
        const resized = new Observer(() => {
            const width = distBox.clientWidth, room = distArea.clientHeight;
            if (width === distWidth && room === distRoom) return;
            distWidth = width;
            distRoom = room;
            if (distFigure?.shown()) scheduleDistribution();
        });
        resized.observe(distBox);
        resized.observe(distArea);
    }
    /** Choosing, the distribution fills the right side; while a comparison is open it folds above the table. */
    function placeDistribution(max: boolean): void {
        const entryBody = query<HTMLElement>('.entry-body');
        if (max) { if (distBox.parentElement !== distArea) distArea.prepend(distBox); }
        else if (distBox.nextElementSibling !== entryBody) entryBody.before(distBox);
        screen.classList.toggle('is-dist-strip', !max);
    }
    placeDistribution(maximized);
    function setMaximized(next: boolean): void {
        // The table's 書き出し menu shows only maximized: it does not come back open.
        if (!next) query<HTMLDetailsElement>('#entry-export-menu').open = false;
        maximized = next;
        if (!next) distToSlot = true;
        placeDistribution(maximized);
        screen.classList.toggle('is-max', next);
        sizeButton.textContent = next ? '⤡' : '⤢';
        sizeButton.setAttribute('aria-pressed', String(next));
        syncColumns();
        deps.maximizedChanged?.(next);
        render();
        scheduleDistribution();
        // Maximized, the table takes the keys; shrunk, they go back to the track view (its lanes, its comparison).
        redraw.after(() => {
            if (next) table.focus?.();
            else if (screen.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur?.();
        });
    }
    // A double click on the bar's empty part widens or shrinks the table, like ⤢ / ⤡.
    query('.entry-bar').addEventListener('dblclick', event => {
        if ((event.target as Element).closest('button, select, input, label')) return;
        setMaximized(!maximized);
    });
    const hasCompared = (): boolean => comparedKeys(slots).some(key => rows.some(row => row.key === key));
    /** Open Compare looks unavailable while slots 1–3 are empty, and its hint says how to fill one; a press still flashes slot 1. */
    function markOpenable(): void {
        const open = query<HTMLButtonElement>('[data-action="entry-open"]');
        const ready = hasCompared();
        open.setAttribute('aria-disabled', String(!ready));
        setHint(open, ready ? strings.entryOpen : strings.compareRefuseSlot.replace('{n}', '1'));
    }
    function openSlotted(stage?: string): void {
        // The comparison compares slots 1–3; slot 0 alone has nothing to compare against.
        if (!hasCompared()) {
            deps.announce(stage ? strings.stepOpenCompare : strings.compareRefuseSlot.replace('{n}', '1'));
            if (!stage) document.getElementById('hint-footer')?.replaceChildren(strings.compareRefuseSlot.replace('{n}', '1'));
            // The selected row's 0–3 button lights up: that is where a recording goes into slot 1.
            // A selected row scrolled out of the drawn window is brought back first.
            const slotButton = (): HTMLElement | null => (focus.key ? body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(focus.key)}"] [data-action="entry-row-slotmenu"]`) : null);
            if (focus.key && !slotButton()) focusRow(focus.key, true);
            redraw.after(() => {
                const button = slotButton();
                flash = focus.key ? { key: focus.key, at: performance.now() } : null;
                if (button) button.style.animationDelay = '';
                button?.classList.remove('is-flash'); void button?.offsetWidth; button?.classList.add('is-flash');
            });
            return;
        }
        const files = slotFiles().filter((path): path is string => !!path && filePaths.includes(path));
        // The tracks are compared in the track view; the table goes back into the side panel beside them.
        setMaximized(false);
        redraw.after(() => deps.openFiles(Array.from(new Set(files)), compareData(stage)));
    }
    /** The table as a CSV: every row with its file's information, the CSV's columns, its slot, its memo and whether it is left out. */
    function exportCsv(): void {
        const slotName = (slot: number): string => (slot === 0 ? strings.entryBase : strings.dsSlotCompare.replace('{n}', String(slot)));
        deps.download(tableCsv(rows, attached.csv?.attributes ?? [], {
            file: strings.entryColFile, ch: strings.dsCh, duration: strings.entryColDuration, rate: strings.entryColRate, calibration: strings.entryColCalibration,
            slot: strings.entryCsvSlot, memo: strings.entryCsvMemo, excluded: strings.entryCsvExcluded,
        }, key => slots.flatMap((item, slot) => (item === key ? [slotName(slot)] : [])).join(' '), memo, excluded), 'entry-table.csv');
    }

    // ---- the CSV: picked (or dropped) by the user, read by asd-insight's rules; nothing is looked for by itself.
    function applyCsv(next: DatasetCsv | null, keep?: { name: string; text: string }): void {
        const had = attached.csv !== null;
        attached.csv = next;
        attached.match = next ? matchCsv(next, filePaths, rootPath) : null;
        rowsDirty = true;
        chosen.filters = chosen.filters.filter(filter => !filter.column.startsWith('csv:') || !!next?.columns.includes(filter.column.slice(4)));
        // A new CSV opens on its first numeric column, grouped by its first column that is not a number.
        if (next) {
            const numeric = next.attributes.find(column => next.numeric[column]);
            chosen.value = numeric ? `csv:${numeric}` : 'none';
            const category = next.attributes.find(column => !next.numeric[column]);
            if (category && (chosen.group === 'none' || chosen.group.startsWith('csv:') || !groupOptions().some(option => option.id === chosen.group))) chosen.group = `csv:${category}`;
        } else {
            chosen.value = 'none';
            if (chosen.group.startsWith('csv:')) chosen.group = 'none';
        }
        if (keep !== undefined) { deps.saveCsv?.(keep.text.length <= KEEP_CSV_BYTES ? keep : undefined); session.keepCsv(keep); }
        if (next === null) { deps.saveCsv?.(undefined); if (had) session.keepCsv(null); }
        rebuild();
    }
    function readCsvFile(file: File): void {
        void file.arrayBuffer().then(buffer => {
            const bytes = new Uint8Array(buffer);
            try {
                const read = readDatasetCsv(bytes, file.name);
                applyCsv(read, { name: file.name, text: new TextDecoder('utf-8').decode(bytes) });
                deps.announce(strings.dsCsvRead.replace('{name}', file.name).replace('{matched}', String(attached.match?.attributes.size ?? 0)).replace('{total}', String(filePaths.length)));
            } catch (error) {
                const reason = error instanceof CSVColumnCountError ? csvColumnCountMessage(error.diagnostic, strings) : error instanceof Error ? error.message : String(error);
                deps.announce(strings.dsCsvError.replace('{reason}', reason));
            }
        });
    }
    csvInput.addEventListener('change', () => {
        const file = csvInput.files?.[0];
        if (file) readCsvFile(file);
        csvInput.value = '';
    });

    // ---- the column filter: like a spreadsheet's ▾ (sort, clear, search + a check list or a range, OK / Cancel)
    const filterPop = createFilterPopover({
        screen, head, chipsBox, text, rows: () => rows, excluded, infoColumns, csv: () => attached.csv, groupOptions,
        filters: () => chosen.filters, sort: () => chosen.sort, group: () => chosen.group, value: () => chosen.value,
        columnLabel, numericColumn, formatColumn, choose, after: fn => redraw.after(fn), renderPopovers: () => renderPopovers(),
        announce: message => deps.announce(message), shownCount: () => shownRows.length,
    });
    function openFilter(column: ColumnId, anchored: boolean): void {
        popovers.slotMenu = null; popovers.memoKey = null;
        filterPop.open(column, anchored);
        renderPopovers();
    }
    function popAnchor(): HTMLElement | null {
        if (filterPop.draft()) return filterPop.anchor();
        if (popovers.slotMenu) return body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(popovers.slotMenu)}"] [data-action="entry-row-slotmenu"]`);
        if (popovers.memoKey) return body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(popovers.memoKey)}"] .entry-nm`);
        // The bundle is offered from the toolbar's 書き出し menu; beside the table's bar when that is not on screen.
        if (popovers.batch) return maximized ? query<HTMLElement>('#entry-export-menu > summary') : document.querySelector<HTMLElement>('#tb-export-menu > summary') ?? query<HTMLElement>('.entry-bar');
        return null;
    }
    /** The open popover, drawn only when it opens or changes, so what is typed in it is kept while the table redraws. */
    function renderPopovers(): void {
        screen.querySelector('[data-entry-pop]')?.remove();
        if (!filterPop.draft() && !popovers.slotMenu && !popovers.memoKey && !popovers.batch) return;
        const pop = document.createElement('div');
        pop.className = 'entry-pop';
        pop.setAttribute('data-entry-pop', '');
        if (filterPop.draft()) pop.innerHTML = filterPop.html();
        else if (popovers.slotMenu) pop.innerHTML = slotMenuHtml(popovers.slotMenu, slots, text);
        else if (popovers.memoKey) pop.innerHTML = memoPopHtml(rowName(popovers.memoKey), memo.get(popovers.memoKey) ?? '', text);
        else if (popovers.batch) pop.innerHTML = batchPopHtml(batchCount(batchRows('filtered')), batchCount(batchRows('all')), popovers.batch, text);
        screen.append(pop);
        const anchor = popAnchor();
        const outer = screen.getBoundingClientRect();
        const box = anchor?.getBoundingClientRect();
        const left = box ? box.left - outer.left : 40;
        pop.style.left = `${Math.max(4, Math.min(left, screen.clientWidth - pop.offsetWidth - 4))}px`;
        const below = box ? box.bottom - outer.top + 2 : 80;
        pop.style.top = `${below + pop.offsetHeight > screen.clientHeight - 4 && box ? Math.max(4, box.top - outer.top - pop.offsetHeight - 2) : below}px`;
        (pop.querySelector<HTMLElement>('[data-entry-memo-text], [data-entry-fsearch], [data-entry-flow], .entry-mi') ?? pop).focus?.();
    }
    function closePopovers(): boolean {
        if (!filterPop.draft() && !popovers.slotMenu && !popovers.memoKey && !popovers.batch) return false;
        filterPop.close(); popovers.slotMenu = null; popovers.batch = null;
        if (popovers.memoKey) closeMemo(); else renderPopovers();
        redraw.after(() => (body.querySelector<HTMLElement>('.is-focused') ?? table).focus?.());
        return true;
    }
    /** The memo popover closes with its text kept, which shows on its row (✎ lit, its text as the hint). */
    function closeMemo(): void {
        saveMemo();
        popovers.memoKey = null;
        renderPopovers();
        render();
    }
    function saveMemo(): void {
        if (!popovers.memoKey) return;
        const textarea = screen.querySelector<HTMLTextAreaElement>('[data-entry-memo-text]');
        if (!textarea) return;
        const note = textarea.value.trim();
        if (note) memo.set(popovers.memoKey, note); else memo.delete(popovers.memoKey);
    }
    function openMemo(key: string): void {
        filterPop.close(); popovers.slotMenu = null;
        popovers.memoKey = key;
        focus.key = key; focus.picked = true;
        renderPopovers();
    }

    /** A row's button: its action on the row's key. */
    const withKey = (act: (key: string, target: HTMLElement) => void) => (target: HTMLElement): void => {
        const key = target.getAttribute('data-key');
        if (key) act(key, target);
    };
    const actions: Record<string, (target: HTMLElement) => void> = {
        'entry-pick-csv': () => csvInput.click(),
        'entry-view-unmatched': () => choose({ mode: chosen.mode === 'unmatched' ? 'all' : 'unmatched' }, true),
        'entry-view-excluded': () => choose({ mode: chosen.mode === 'excluded' ? 'all' : 'excluded' }, true),
        'entry-probe-cancel': () => cancelProbe(),
        'entry-export-csv': exportCsv,
        'entry-export-notes': () => {
            const name = attached.csv ? attached.csv.name.replace(/\.(csv|tsv)$/i, '') : 'recordings';
            deps.download(annotatedCsv(attached.csv, attached.match, filePaths, rootPath, rows, memo, excluded), `${name}-notes.csv`);
        },
        'entry-open': () => openSlotted(),
        'entry-maximize': () => setMaximized(!maximized),
        'entry-fhead': target => { const column = target.getAttribute('data-column') as ColumnId; if (filterPop.draft()?.column === column) closePopovers(); else openFilter(column, true); },
        'entry-fadd': () => openFilter(filterPop.nextColumn(), false),
        'entry-fchip': target => openFilter(target.getAttribute('data-column') as ColumnId, false),
        'entry-fchip-clear': target => filterPop.clear(target.getAttribute('data-column') as ColumnId),
        'entry-fsort': target => filterPop.setSort(target.getAttribute('data-sort') as DatasetScreenView['sort']['column'], target.getAttribute('data-descending') === 'true'),
        'entry-fclear': () => { const draft = filterPop.draft(); if (draft) filterPop.clear(draft.column); },
        'entry-fok': () => filterPop.apply(),
        'entry-fcancel': () => closePopovers(),
        'entry-row-play': withKey(key => deps.play?.(fileOfKey(key))),
        'entry-row-track': withKey(key => { focusOn(key); toggleTrack(key); }),
        'entry-tracks-all': () => { if (chosen.mode === 'all') toggleAllTracks(); },
        // The rows listed now: a filter changed while the question was open counts.
        'entry-tracks-all-go': () => { askTracks(null); const listed = listedFiles(); const files = notShown(listed); if (files.length) showAll(listed, files); },
        'entry-tracks-all-cancel': () => askTracks(null),
        'entry-tracks-only': () => choose({ tracksOnly: !chosen.tracksOnly }, true),
        'entry-row-slotmenu': withKey(key => { filterPop.close(); popovers.memoKey = null; popovers.slotMenu = popovers.slotMenu === key ? null : key; focusOn(key); redraw.after(renderPopovers); }),
        'entry-row-slot': withKey((key, target) => { popovers.slotMenu = null; renderPopovers(); setSlot(Number(target.getAttribute('data-slot')), key); }),
        'entry-row-memo': withKey(openMemo),
        'entry-memo-close': closeMemo,
        'entry-row-exclude': withKey(key => { excluded.add(key); rebuild(); }),
        'entry-row-restore': withKey(key => { excluded.delete(key); if (!excluded.size) chosen.mode = 'all'; rebuild(); }),
        'entry-batch': () => openBatch(),
        'entry-batch-go': () => exportBatch(),
        'entry-batch-cancel': () => closePopovers(),
    };
    tableWrap.addEventListener('scroll', () => { renderRows(); });
    screen.addEventListener('click', event => redraw.batch(() => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>('[data-action]');
        // A choice in the table's 書き出し menu closes it, the focus back on its summary.
        if (action?.closest('#entry-export-menu')) closeExportMenu();
        // The second click of a double click on ☑ does not take the track off again.
        const repeated = event.detail > 1;
        const name = action?.getAttribute('data-action') ?? '';
        const act = actions[name];
        if (action && action.tagName !== 'SELECT' && action.tagName !== 'INPUT' && act) {
            if (!(repeated && name === 'entry-row-track')) act(action);
            return;
        }
        if (target.closest('[data-entry-pop]')) return;
        const row = target.closest<HTMLElement>('tr[data-key]');
        if (!row) return;
        focusOn(row.getAttribute('data-key'));
    }));
    /** The maximized table's 書き出し menu: closed by a press outside it and by Esc, like the toolbar's menus. */
    const exportMenu = query<HTMLDetailsElement>('#entry-export-menu');
    function closeExportMenu(): boolean {
        if (!exportMenu.open) return false;
        // Focus on one of its items would fall to the page as they hide: it goes back to the menu's summary.
        const hadFocus = exportMenu.contains(document.activeElement);
        exportMenu.open = false;
        if (hadFocus) exportMenu.querySelector<HTMLElement>('summary')?.focus();
        return true;
    }
    // A row and its file's lane light up together under the mouse (only a file on a track has a lane).
    document.addEventListener('mouseover', event => {
        const filePath = (event.target as Element).closest?.('tr.entry-row[data-file-path], .track-row[data-file-path]')?.getAttribute('data-file-path') ?? null;
        if (filePath === tracks.linked) return;
        document.querySelectorAll('.entry-row.is-linked, .track-row.is-linked').forEach(element => element.classList.remove('is-linked'));
        const path = filePath && CSS.escape(filePath);
        const lane = path ? document.querySelector(`.track-row[data-file-path="${path}"]`) : null;
        // Remembered only once lit: a row whose track is still being read lights up at the next move.
        tracks.linked = lane ? filePath : null;
        if (!lane) return;
        lane.classList.add('is-linked');
        screen.querySelectorAll(`tr.entry-row[data-file-path="${path}"]`).forEach(row => row.classList.add('is-linked'));
    });
    // A press outside an open popover closes it (a memo is kept).
    document.addEventListener('pointerdown', event => {
        const target = event.target as Element;
        if (!exportMenu.contains(target)) closeExportMenu();
        if (screen.hidden || target.closest?.('[data-entry-pop], [data-action="entry-fhead"], [data-action="entry-fadd"], [data-action="entry-fchip"], [data-action="entry-row-slotmenu"], [data-action="entry-row-memo"], [data-action="entry-batch"], #tb-export-menu, #entry-export-menu')) return;
        closePopovers();
    }, true);
    screen.addEventListener('change', event => redraw.batch(() => {
        const target = event.target as HTMLElement;
        if (target === valueSelect) {
            choose({ value: valueSelect.value as ValueId }, chosen.sort.column === 'value');
            return;
        }
        if (target === groupSelect) {
            const baseBefore = entryBase.text();
            choose({ group: groupSelect.value as GroupId, baseGroup: null });
            // With slot 0 empty the base is slot 1's group median: a new grouping changes it, which is said.
            if (!slots[0] && slots[1] && entryBase.text() !== baseBefore) deps.announce(strings.dsBaseReset);
            return;
        }
        if (target === baseSelect) {
            const value = baseSelect.value;
            if (value === 'row') return;
            const group = value === 'auto' ? null : value.slice('group:'.length);
            if (slots[0]) setSlot(0, null);
            choose({ baseGroup: group });
            deps.announce(group === null ? strings.dsBaseSetAuto : strings.dsBaseSet.replace('{group}', `${groupLabel(chosen.group)} ${group || strings.dsFilterBlank}`));
            return;
        }
        if (target.matches('[data-entry-batch-scope]')) { popovers.batch = (target as HTMLInputElement).value as 'filtered' | 'all'; return; }
        filterPop.change(target);
    }));
    screen.addEventListener('input', event => { filterPop.input(event.target as HTMLInputElement); });
    // A CSV dropped onto the screen is read like one picked with 「CSV を選ぶ」.
    screen.addEventListener('dragover', event => {
        if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
    });
    screen.addEventListener('drop', event => {
        const file = Array.from(event.dataTransfer?.files ?? []).find(item => isMetadataCandidate(item.name));
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        readCsvFile(file);
    });
    // A double click on a row slots it in the first free slot and opens the comparison, like 1 then Enter.
    body.addEventListener('dblclick', event => redraw.batch(() => {
        const target = event.target as HTMLElement;
        const key = target.closest<HTMLElement>('tr[data-key]')?.getAttribute('data-key');
        if (!key || chosen.mode !== 'all' || target.closest('button, [data-action="entry-row-track"]')) return;
        if (!slots.slice(1).includes(key)) setSlot(firstFreeCompareSlot(slots), key);
        openSlotted();
    }));
    /** Maximized, the table takes the keys; in the side panel, only keys pressed while it has the focus. */
    const keysHere = (event: Event): boolean => !screen.hidden && (maximized || screen.contains(event.target as Node));
    /** A button, a field or a popover takes its own keys (Enter, Space, digits): the table's keys act on rows only. */
    const ownKeys = (event: Event): boolean => !!(event.target as Element | null)?.closest?.('button, summary, select, input, textarea, [data-entry-pop], [data-step-bar], #entry-range-popover');
    // In front of the comparison and the lanes: a key the table is given goes no further, so one that just
    // switched screens does not act on the other one too.
    const removeKeys = keyRouterFor(window).add({
        layer: 'entry',
        keydown: event => redraw.batch(() => {
            if (!keysHere(event)) return false;
            if ((event.target as Element | null)?.closest?.('[data-step-bar], #entry-range-popover')) return false;
            if (closesEntryDialog(event)) {
                event.preventDefault();
                // Esc closes the innermost thing: a popover, the step bar's form, the unmatched or excluded list;
                // then the maximized table shrinks into the side panel, and the side panel hands the keys back.
                if (closePopovers()) return true;
                if (tracks.pending) { askTracks(null); return true; }
                if (closeExportMenu()) return true;
                if (chosen.mode !== 'all') { choose({ mode: 'all' }); return true; }
                // The range picked on the distribution goes before the table shrinks.
                if (maximized && valueRange()) { choose({ filters: chosen.filters.filter(filter => filter.column !== chosen.value) }); return true; }
                if (maximized) { setMaximized(false); return true; }
                (document.activeElement as HTMLElement | null)?.blur?.();
                return true;
            }
            // A row's ☐/☑ takes Enter and Space as its press.
            const mark = (event.target as Element | null)?.closest?.<HTMLElement>('[data-action="entry-row-track"]');
            if (mark && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                actions['entry-row-track'](mark);
                return true;
            }
            if (ownKeys(event) || event.ctrlKey || event.metaKey || event.altKey) return true;
            const action = keyAction(ENTRY_KEYS, event.key);
            if (action) event.preventDefault();
            if (action === 'slot') { if (!event.repeat && focus.key && rows.some(row => row.key === focus.key)) setSlot(Number(event.key), focus.key); }
            else if (action === 'open') openSlotted();
            else if (action === 'play') { if (focus.key) deps.play?.(fileOfKey(focus.key)); }
            else if (action === 'memo') { if (focus.key) openMemo(focus.key); }
            else if (action === 'track') { if (focus.key && chosen.mode === 'all') { toggleTrack(focus.key); render(); } }
            else if (action === 'row-up' || action === 'row-down') moveFocus(action === 'row-down' ? 1 : -1);
            return true;
        }),
    });

    return {
        dispose() { removeKeys(); distFigure?.dispose(); },
        open(paths: string[], root = '', maximize = false): void {
            filePaths = paths.filter(path => !isMetadataCandidate(path));
            rootPath = root;
            // The counts of a file's changes are kept over an opening: the comparison's pictures outlive it, and a
            // count that began again at 0 would name a picture taken before the file was rewritten as the file's now.
            requests.clear();
            rowsDirty = true;
            excluded.clear();
            memo.clear();
            chosen.filters = [];
            chosen.tracksOnly = false;
            tracks.pending = null;
            chosen.mode = 'all';
            filterPop.close(); popovers.slotMenu = null; popovers.memoKey = null;
            chosen.baseGroup = null;
            session.reset();
            slots = restoredSlots(deps.loadSlots() ?? [], path => filePaths.includes(path));
            focus.key = null; focus.picked = false;
            const savedRecipe = deps.loadRecipe?.();
            recipeState.edited = isRecipeChain(savedRecipe) ? savedRecipe : null;
            if (savedRecipe !== undefined && savedRecipe !== null && !recipeState.edited) { deps.saveRecipe?.(undefined); deps.announce(strings.stepRecipeWarning); }
            // The CSV picked last time comes back if it still reads (and matches these recordings by its own rules).
            attached.csv = null; attached.match = null; chosen.value = 'none'; chosen.group = rootPath && filePaths.some(path => path.replaceAll('\\', '/').slice(rootPath.length + 1).includes('/')) ? 'folder:1' : 'none';
            const kept = deps.loadCsv?.();
            if (kept) {
                try { attached.csv = readDatasetCsv(new TextEncoder().encode(kept.text), kept.name); } catch { attached.csv = null; deps.saveCsv?.(undefined); }
            }
            screen.hidden = false;
            // A folder just opened keeps the table beside the tracks; ⤢ widens it when asked.
            setMaximized(maximize);
            applyCsv(attached.csv);
            // The folder's session comes back; the headers say each file's channels, length and sample rate. Nothing is computed.
            askSession();
            headers.clear();
            probe(filePaths);
            table.setAttribute('tabindex', '0');
            table.focus?.();
        },
        isOpen: () => !screen.hidden && maximized,
        setMaximized: next => { if (!screen.hidden) setMaximized(next); },
        hasFocus: () => !screen.hidden && screen.contains(document.activeElement),
        addFiles(paths) {
            const fresh = paths.filter(path => !filePaths.includes(path) && !isMetadataCandidate(path));
            if (!fresh.length) return;
            if (screen.hidden) { this.open(fresh, '', false); return; }
            filePaths = [...filePaths, ...fresh];
            rowsDirty = true;
            if (attached.csv) attached.match = matchCsv(attached.csv, filePaths, rootPath);
            // A new probe replaces one still running, so it asks again for every header not read yet.
            probe(filePaths);
            rebuild();
        },
        // With "tracks only" on, the rows follow the tracks.
        tracksChanged: () => { if (chosen.tracksOnly) rebuild(); else renderIfOpen(); },
        trackRemoved: filePath => redraw.batch(() => {
            tracks.tried = null;
            const [slot] = slotsOfFile(slots, filePath);
            if (slot !== undefined) setSlot(slot, null, false); else renderIfOpen();
            // With 「トラックのみ」 on, the row leaves with its lane.
            if (chosen.tracksOnly) rebuild();
        }),
        setRecipe,
        stepFailed,
        show(next: (string | null)[]): void {
            slots = slotsForFiles(next, slots);
            screen.hidden = false;
            setMaximized(true);
        },
        handle(message): boolean {
            if (!message.type.startsWith('entry-')) return false;
            if (message.type === 'entry-calibration-changed') {
                const { filePath, calibrated } = message as Extract<EntryPublication, { type: 'entry-calibration-changed' }>;
                if (!filePaths.includes(filePath)) return true;
                // The calibration column says it at once (the file's header is as it was: not read again).
                if (calibrated !== undefined) headers.calibrated(filePath, calibrated);
                calibrations.set(filePath, calibrationEpoch(filePath) + 1);
                rowsDirty = true;
                resultsRedraw.schedule();
                return true;
            }
            if (message.type === 'entry-source-changed') {
                const { filePath } = message as Extract<EntryPublication, { type: 'entry-source-changed' }>;
                if (!filePaths.includes(filePath)) return true;
                // The file was written on disk: its header is read again (its rows stay as they were until it is in).
                sources.set(filePath, sourceEpoch(filePath) + 1);
                headers.forget(filePath);
                probe(filePaths);
                rowsDirty = true;
                resultsRedraw.schedule();
                return true;
            }
            if (message.type === 'entry-probe-result' || message.type === 'entry-probe-done') {
                const taken = headers.take(message as EntryProbePublication);
                if (taken === 'stale') return true;
                if (taken === 'done') { rebuild(); return true; }
                rowsDirty = true;
                resultsRedraw.schedule();
                return true;
            }
            if (message.type !== 'entry-conditions') return true;
            const publication = message as Extract<EntryPublication, { type: 'entry-conditions' }>;
            // Only the latest asking's answer counts (a folder opened again meanwhile).
            if (!requests.answering('open', publication.requestId)) return true;
            requests.settle(publication.requestId);
            if (publication.recipe) recipeState.standard = publication.recipe;
            // At open the folder's session comes back; from then on, changes are saved.
            const loading = !session.loaded;
            if (loading) {
                applySession(publication.session, publication.csv);
                // A CSV kept by the webview alone (before sessions) goes to the host's store with the next save.
                if (!publication.csv && attached.csv) session.keepCsv(deps.loadCsv?.() ?? undefined);
            }
            rebuild();
            // What the table settled on at open is what is stored: only a change after it is saved.
            if (loading) session.markLoaded();
            return true;
        },
        compareData: () => compareData(),
        slots: () => slotFiles(),
        grouped: () => chosen.group !== 'none',
        trackRole(filePath) {
            const slot = roleSlot(slots, filePath);
            return slot === undefined ? undefined : { slot, ch: channelOfRow(rowOf(slots[slot])) };
        },
        setTrackRole(filePath, slot) {
            // The row trackRole shows (compare slots first), so a chip moves the channel it names.
            const own = roleKey(slots, filePath);
            if (slot === null) {
                if (!own) return;
                setSlots(withoutFile(slots, filePath));
                return;
            }
            const key = own ?? rows.find(row => row.filePath === filePath)?.key ?? filePath;
            if (slots[slot] === key) return;
            // The file the slot held before keeps its track: only the roles change.
            setSlot(slot, key, false);
        },
        // A member whose file could not be read is not asked for at a step (no picture of it can be had): baseLeft says it failed.
        basePaths: (comparePath, byGroup = false) => entryBase.resolve(comparePath, byGroup).members.filter(readable),
        channelCount: path => { const own = rows.filter(row => row.filePath === path); return own.length ? Math.max(...own.map(row => row.channels ?? 1)) : undefined; },
        baseLeft: (comparePath, byGroup) => {
            const base = entryBase.resolve(comparePath, byGroup);
            return [...base.fewer.map(path => ({ path, reason: 'no-channel' as const })), ...base.members.filter(path => !readable(path)).map(path => ({ path, reason: 'failed' as const }))];
        },
        baseHeading: (comparePath, byGroup, set, each = false) => {
            const base = entryBase.resolve(comparePath, byGroup);
            return set ? base.heading(set, each ? strings.entryBaseCount : undefined) : base.name;
        },
        stageChannel: (path, comparePath, byGroup = false) => entryBase.stageChannel(path, comparePath, byGroup),
        reportRow: (path, byGroup = false, against = null) => {
            const row = entryBase.slotRowOf(path) ?? rows.find(item => item.filePath === path);
            const columns = attached.csv?.attributes ?? [];
            return {
                ...rowInfo(path), channel: entryBase.stageChannel(path, against ?? path, byGroup), base: entryBase.resolve(against ?? path, byGroup).definition,
                cells: row ? [...columns.map(column => row.attributes?.[column] ?? ''), ...row.folders] : [],
            };
        },
        conditionColumns,
        rowInfo: path => rowInfo(path),
        cost: paths => readCost(paths, path => headers.info.get(path)?.durationS),
        selection: () => ({
            // Over rows of several references: each value names its own (rowInfo), the heading none.
            value: valueLabel(chosen.value), group: chosen.group === 'none' ? strings.dsGroupNone : groupLabel(chosen.group),
            filters: chosen.filters.map(filter => chipText(filter)), excluded: excluded.size,
        }),
        openBatch: () => openBatch(),
        exportTable: () => actions['entry-export-csv'](screen),
        exportNotes: () => actions['entry-export-notes'](screen),
        showCompared() {
            const compared = comparedKeys(slots);
            if (!compared.length) return;
            // The compared rows and their base: as a filter on the file column, which a chip shows and × takes off.
            const wanted = new Set(compared.map(fileOfKey).flatMap(file => [file, ...this.basePaths(file)]));
            choose({ filters: [{ column: 'name', kind: 'values', values: [...new Set(rows.filter(row => wanted.has(row.filePath)).map(row => row.name))] }], mode: 'all', tracksOnly: false }, true);
        },
        recipes(channels) {
            const recipe = recipeState.edited ?? recipeState.standard;
            return recipe ? { recipe, runRecipe: runRecipe(channels), failed: recipeState.failed } : null;
        },
        snapshot: () => {
            // A table column's distribution, as the Figure drew it: its groups, their n and how many a selected range
            // takes are the picture's counts (the service's), its axis the picture's whole one.
            const seen = distFigure?.shown() ? distFigure.inspect() : null;
            const lanes = seen?.pictureId ? seen.lanes.flatMap(lane => (lane.bins ? [{ id: lane.id, bins: lane.bins }] : [])) : [];
            return {
                open: !screen.hidden && maximized, docked: !screen.hidden && !maximized, cols: Number(screen.dataset.cols ?? 0), rows: rows.length, visible: shownRows.length,
                slots: slots.slice(), focused: focus.key, value: chosen.value, group: chosen.group, filters: chosen.filters.map(filter => ({ ...filter })),
                sort: { ...chosen.sort }, excluded: [...excluded], memo: Object.fromEntries(memo), mode: chosen.mode, unmatched: unmatchedItems().length + unreadable().length,
                csv: attached.csv?.name ?? null, playing: deps.playing?.() ?? null, visibleKeys: shownRows.slice(0, 200).map(row => row.key),
                dist: seen ? {
                    // (No group until its picture is drawn: `waiting` says so.)
                    groups: lanes.map(lane => ({ name: lane.id.slice(BINS_LANE_ID.length), n: lane.bins.n, inRange: lane.bins.nPicked ?? lane.bins.n })),
                    missing: 0, unit: 'recording', low: seen.whole?.[0] ?? 0, high: seen.whole?.[1] ?? 0, range: valueRange(), base: entryBase.groupName(),
                    strip: !maximized, figure: true, waiting: seen.waiting || !seen.pictureId, failure: seen.failure,
                } : null,
            };
        },
    };
}
