/**
 * The entry screen: a folder's recordings, one row per recording and channel, with the attributes of the CSV
 * the user picked and the values computed from their sound. The user picks the value and the grouping, filters
 * and sorts each column like a spreadsheet, and puts rows in slots 0–3 to compare them. Nothing is computed
 * until 「計算」 is pressed. Keys while a row has the focus: 0–3 (put the row in that slot), Space (play it),
 * M (its memo), Enter (open the slotted rows), ↑/↓ (move), Esc (close what is open, then leave). Keys on a
 * button or a field are that element's own.
 */
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { UiStrings } from '../../shared/i18n/strings';
import type { ComparePublication, CompareScanMessage, EntryConditionTable, EntryProbeCancelMessage, EntryProbeMessage, EntryProbePublication, EntryPublication, EntryScanCancelMessage, EntryScanMessage, EntrySaveSessionMessage } from '../../shared/analysis/entryScan';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { BAND_CENTERS_HZ, bandLabel, buildEntryModel, derivedKey, entryCsv, type BaseDefinition, type DerivedRow, type EntryModel } from './entryTable';
import { batchBundle, batchCount } from '../../shared/batch/batchBundle';
import { baseOf, type CompareModel } from './comparePanes';
import { compareGroupNames, groupLabels } from '../../shared/dataset/distribution';
import { createDistributionPane } from './entryDistributionPane';
import { createFilterPopover } from './entryFilterPopover';
import { createHeldPlot } from './entryHeldPlot';
import { createSidePlots } from './entrySidePlots';
import { channelOfRow, createEntryBase } from './entryBase';
import { HostRequests } from './hostRequests';
import { LARGE_BASE, LARGE_BASE_S } from './trackStageMode';
import { createStepBar, endsInSpectrum, runnableRecipe, stepLimits, unpairedRecipe } from './stepBar';
import { leqLabel } from './compareReport';
import { activeSlotReferenced, brokenStep, chainEnd, isRecipeChain, recipeKey, recipeNodes } from '../../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { baseName, isMetadataCandidate, withFolderColumns } from '../../shared/analysis/entryMetadata';
import { powerMeanDb, powerMeanOrNull } from '../../shared/utils/levels';
import { CSVColumnCountError, csvColumnCountMessage } from '../../shared/dataset/csvDiagnostics';
import { keyRouterFor } from './keyRouter';
import { createHeaderProbe, createScanProgress } from './entryScanQueue';
import { createRedraw, createThrottle } from './entryRedraw';
import { createSessionSaver, readStoredSession, SESSION_VERSION } from './entrySession';
import { channelRowKey, comparedKeys, emptySlots, firstFreeCompareSlot, restoredSlots, roleKey, roleSlot, slotFiles as filesOfSlots, slotsForFiles, slotsOfFile, trackChanges, withoutFile, withSlot, type Slots } from './entrySlots';
import { setHint } from './hintFooter';
import { ENTRY_KEYS, keyAction } from './shortcuts';
import {
    annotatedCsv, datasetRows, filteredRows, fileOfKey, groupOf as datasetGroupOf, isComputed, matchCsv, readDatasetCsv, valueOf, visibleRows,
    type ColumnId, type CsvMatch, type DatasetCsv, type DatasetFilter, type DatasetRow, type GroupId, type ValueId,
} from '../../shared/dataset/datasetTable';
import {
    closesEntryDialog, filterChipText, rowWindow, tableLines, type DerivedItem, datasetColsHtml, datasetHeadHtml, datasetRowsHtml, entryScreenHtml, filterChipsHtml, formatValue,
    baseOptionsHtml, batchPopHtml, groupOptionsHtml, memoPopHtml, slotMenuHtml, unmatchedRowsHtml, valueOptionsHtml,
    type DatasetScreenView, type EntryStrings,
} from './entryTableHtml';

/** Scan results are redrawn at most this often (entryRedraw.ts' createThrottle). */
const REDRAW_MS = 250;
/** The table's rows are this tall (CSS: .entry-table tr), so only the rows on screen are drawn. */
const ROW_HEIGHT = 24;
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

const defaultChoices = (): EntryChoices => ({ value: 'leq', group: 'none', filters: [], sort: { column: 'name', descending: false }, mode: 'all', tracksOnly: false, baseGroup: null });

/** What a comparison of the slotted files needs of the entry table (the track view's steps mode, D and the report). */
export interface CompareData {
    model: EntryModel;
    results: ReadonlyMap<string, ScanResult>;
    slots: (string | null)[];
    /**
     * The step bar's Recipe, and the one the table's scans run (invalid steps and steps measured against the base
     * slot left out; undefined = the host's own).
     */
    recipe?: RecipeDocument | null;
    runRecipe?: RecipeDocument;
    /** Steps that failed on a file, left out of the scans. */
    failed?: Readonly<Record<string, string>>;
    /** The step the comparison opens on (a chip pressed on the entry table); the chain's end without one. */
    stage?: string;
    /** Files whose entry-table results are of an earlier chain. */
    stale?: ReadonlySet<string>;
}

export interface EntryScreenDeps {
    document: Document;
    window: Pick<Window, 'addEventListener' | 'setTimeout' | 'clearTimeout' | 'requestAnimationFrame'> & { performance: Pick<Performance, 'now'> };
    strings: UiStrings;
    post(message: EntryScanMessage | EntryScanCancelMessage | EntryProbeMessage | EntryProbeCancelMessage | EntrySaveSessionMessage | CompareScanMessage): void;
    loadSlots(): readonly (string | null)[] | undefined;
    saveSlots(slots: (string | null)[]): void;
    /** Differences fixed on the comparison, kept across sessions like the slots. */
    loadDerived?(): readonly DerivedRow[] | undefined;
    saveDerived?(rows: DerivedRow[]): void;
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
    /** "? list": the keys and symbols overlay. */
    help?(): void;
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
}

export interface EntryScreen {
    /** Lists `filePaths` from the opened folder `rootPath`, below which tables name recordings by path; maximized unless told not to. */
    open(filePaths: string[], rootPath?: string, maximize?: boolean): void;
    /** Files added from elsewhere (＋ Add files, a drop): rows of the "added files" group, scanned like the rest. */
    addFiles(filePaths: string[]): void;
    /** Whether the table covers the window (maximized); in the side panel it is not "open" over the track view. */
    isOpen(): boolean;
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
    /** A difference fixed on the comparison (D): one derived row under its parent. */
    addDerived(row: DerivedRow): void;
    /** Takes a fixed difference back out (a click on its card on the comparison). */
    removeDerived(parentPath: string, region: string, baseLabel?: string): void;
    /** A Recipe edited on the comparison's step bar: the table scans again with it. */
    setRecipe(recipe: RecipeDocument): void;
    /** A step that failed on a file (a comparison scan's): it is left out and the table scans again without it. */
    stepFailed(step: string, reason: string): void;
    /** What the comparison needs of the table: its conditions, results, slots and Recipes. */
    compareData(): CompareData;
    /** The slots 0–3: the base file (or null for the group median) and the files to compare. */
    slots(): (string | null)[];
    /** A track's role: the slot its file is in (1–3 first, then 0) and that row's channel (null: the channels together). */
    trackRole(filePath: string): { slot: number; ch: number | null } | undefined;
    /**
     * Puts a track's file in a slot (its slotted row if it has one, else its first row), or takes it out of every
     * slot; the track stays on the track view either way.
     */
    setTrackRole(filePath: string, slot: number | null): void;
    /** What a compared file is measured against: the slot-0 file, or the other files of its condition. */
    basePaths(comparePath: string, group?: boolean): string[];
    /** The base's name: the slot-0 file, or "Base group · rpm 1500 · median of n · ch2 (within ch = 2)". */
    baseTitle(comparePath: string, group?: boolean): string;
    /** What the base is, for the report and a fixed difference. */
    baseDefinition(comparePath: string, group?: boolean): BaseDefinition;
    /** The channel `path` is drawn with when `comparePath` is compared (null: its channels together). */
    stageChannel(path: string, comparePath: string | null, group?: boolean): number | null;
    /** The comparison of a file with its base, as the table defines the base (over `results` when given, e.g. a region's). */
    comparison(comparePath: string, group?: boolean, results?: ReadonlyMap<string, ScanResult>, entryRegionBase?: boolean): CompareModel;
    /** A base group's median 1/3-octave levels from the table's computed values (the compared channel), for a base too large to scan unasked. */
    tableBaseBands(comparePath: string, group?: boolean): { centers: number[]; values: (number | null)[]; count: number } | null;
    /** How much audio these files are and about how long computing them takes, by the files' lengths. */
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
    /** The differences fixed with D. */
    derivedRows(): DerivedRow[];
    /** Turns the "Compared" filter on: the compared files and their base. */
    showCompared(): void;
    /** The Recipe the table scans with (its edited one, else the host's), and the one its scans run; null before either is known. */
    /** The chain the table measures with, the one its scans run, and the steps that failed on a file (with why); `channels`: the fewest of the files they run on, when not the table's. */
    recipes(channels?: number): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
    /** What the table currently shows, for tests. */
    snapshot(): {
        open: boolean; docked: boolean; cols: number; rows: number; visible: number; scanned: number; slots: (string | null)[]; focused: string | null;
        value: string; group: string; filters: DatasetFilter[]; sort: { column: string; descending: boolean }; excluded: string[]; memo: Record<string, string>;
        mode: string; unmatched: number; csv: string | null; playing: string | null; visibleKeys: string[]; scanning: boolean;
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
    const keyHints = query<HTMLElement>('[data-entry-keys]');
    const chipsBox = query<HTMLElement>('[data-entry-chips]');
    const computeBox = query<HTMLElement>('[data-entry-compute]');
    const valueSelect = query<HTMLSelectElement>('[data-action="entry-value"]');
    const groupSelect = query<HTMLSelectElement>('[data-action="entry-group"]');
    const baseSelect = query<HTMLSelectElement>('[data-action="entry-base"]');
    const basePick = query<HTMLElement>('[data-entry-base-pick]');
    const csvInput = query<HTMLInputElement>('[data-entry-csv-input]');
    const tableWrap = query<HTMLElement>('.entry-table-wrap');
    const held = query<HTMLElement>('[data-entry-held]');
    const heldTitle = query<HTMLElement>('[data-entry-held-title]');
    const heldCanvas = query<HTMLCanvasElement>('[data-entry-held-canvas]');
    const overview = query<HTMLCanvasElement>('[data-entry-overview]');
    const side = query<HTMLElement>('.entry-side');
    /** The overview strip and the held plot beside the distribution, each zoomed as the lanes are. */
    const sidePlots = createSidePlots({
        document, window, strings, screen, side, body, tableWrap, overview, heldCanvas,
        rows: () => shownRows, focusedFile: () => focusedFile(), paintDistribution: () => paintDistribution(),
        paintHeld: () => heldPlot.paint(), heldPicture: () => heldPlot.picture(), pickRow: key => redraw.batch(() => focusRow(key, true)),
    });
    const distPane = createDistributionPane({
        screen, strings,
        // A range of the value: a chip, which narrows the table.
        pick({ low, high }) {
            focus.picked = false;
            choose({ filters: [...chosen.filters.filter(filter => filter.column !== chosen.value), { column: chosen.value, kind: 'range', low, high }], mode: 'all' }, true);
            deps.announce(strings.dsDistPicked.replace('{n}', shownRows.length.toLocaleString()));
        },
        dot(key) { if (shownRows.some(row => row.key === key)) focusRow(key, true); else focusFile(fileOfKey(key)); },
        cancelled: () => sidePlots.schedule(),
    });
    const stepBar = createStepBar({
        document, strings, mode: 'entry', onChange: recipe => setRecipe(recipe),
        // A step pressed opens the comparison on that step's Frame.
        onStepSelect: step => openSlotted(step.id),
        // On the entry table a hold shows one row: without a step of its time signal, or its spectrum or bands.
        canHold: step => heldPlot.canHold(step),
        onStepHold: step => heldPlot.holdStep(step),
    });
    // The chain is edited where the analysis is decided: the track view's steps (trackStageMode.ts). The table
    // only keeps its state, so its values are measured with the same chain.
    const recipeState: {
        /** The host's entry Recipe, and the one edited in the step bar (which the scans then use). */
        standard: RecipeDocument | null;
        edited: RecipeDocument | null;
        /** Steps that failed on a file, with wandas' reason: the chain is broken until the Recipe changes. */
        failed: Record<string, string>;
        /** The folder's sample rate and its shortest file's samples, kept when a new Recipe clears the results so its steps are still checked against them. */
        knownRate?: number;
        knownShortest?: number;
    } = { standard: null, edited: null, failed: {} };

    let filePaths: string[] = [];
    const results = new Map<string, ScanResult>();
    function noteResult(filePath: string, result: ScanResult): void {
        results.set(filePath, result);
        sidePlots.noteResult(filePath, result);
    }
    /** The Recipe each result was measured with (recipeKey of the run): a result of another chain is greyed. */
    const resultKeys = new Map<string, string>();
    /** What the table asked the host for: the folder's stored results or a computation ('scan'), a fixed difference measured again. */
    const requests = new HostRequests<undefined>();
    const remeasuring = new HostRequests<{ row: DerivedRow; results: Map<string, ScanResult> }>();
    /** Whether the chain cannot run (a step that cannot, and so nothing after it): the table then has no values for it. */
    const broken = (): boolean => { const recipe = recipeState.edited ?? recipeState.standard; return !!recipe && !!brokenStep(recipe, limits()); };
    const currentKey = (): string => (broken() ? 'broken' : recipeKey(scanRecipe()));
    const isStale = (path: string): boolean => results.has(path) && resultKeys.get(path) !== currentKey();
    function stalePaths(): Set<string> {
        const key = currentKey();
        return new Set(filePaths.filter(path => results.has(path) && resultKeys.get(path) !== key));
    }
    /** The files' headers (channels, lengths), read at open; then the computation the user started, and what one costs. */
    const headers = createHeaderProbe();
    /** Each file's length: from its result, else from its header (WAV, FLAC). */
    const durationOf = (path: string): number | undefined => results.get(path)?.input?.durationS ?? headers.durations.get(path);
    const progress = createScanProgress(() => window.performance.now(), durationOf);
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
    let derived: DerivedRow[] = [];
    /** The folder's session, kept by the host: saved a moment after each change once the stored one is back. */
    const session = createSessionSaver(window, SESSION_SAVE_MS, () => sessionOf(),
        (stored, csvToSave) => deps.post({ type: 'entry-save-session', rootPath, session: stored, ...(csvToSave !== undefined ? { csv: csvToSave } : {}) }));
    /**
     * The comparison's model of the files (their conditions, Δ, groups): built when the comparison, the overview
     * strip or the CSV export reads it, not on every redraw of the table (it costs a pass over every file).
     */
    let builtModel: EntryModel | null = null;
    function entryModel(): EntryModel {
        if (builtModel) return builtModel;
        // The CSV's attributes and the subfolders as its condition table, grouped by the column the table groups by.
        const { csv, match } = attached;
        const attributes = csv?.attributes ?? [];
        const own: EntryConditionTable | null = csv && match ? {
            columns: attributes, checked: [],
            rows: Object.fromEntries([...match.attributes].map(([filePath, row]) => [filePath, attributes.map(column => row[column] ?? '')])),
            numeric: attributes.map(column => csv.numeric[column] ?? false), source: csv.name,
        } : null;
        const folders = withFolderColumns(own, filePaths, rootPath, level => strings.entryFolderLevel.replace('{n}', String(level)));
        const checked = chosen.group.startsWith('csv:') ? [attributes.indexOf(chosen.group.slice(4))] : chosen.group.startsWith('folder:') ? [attributes.length + Number(chosen.group.slice(7)) - 1] : [];
        const table = folders && { ...folders, checked: checked.filter(index => index >= 0 && index < folders.columns.length) };
        builtModel = buildEntryModel(filePaths.map(filePath => ({ filePath, result: results.get(filePath) })), table, { derived });
        return builtModel;
    }
    /** The rows through the filters but the value's own (unsorted), kept until the next rebuild. */
    let pool: DatasetRow[] | null = null;
    /** The rows are made again only when the files, their results, their headers or the CSV change, not on every redraw. */
    let rowsDirty = true;
    const focusedFile = (): string | null => (focus.key ? fileOfKey(focus.key) : null);
    const slotFiles = (): (string | null)[] => filesOfSlots(slots);
    let byKey = new Map<string, DatasetRow>();
    const rowOf = (key: string | null): DatasetRow | undefined => (key ? byKey.get(key) : undefined);
    /** Results and headers as they arrive: a big table takes longer to draw, so it waits longer. */
    const resultsRedraw = createThrottle(window, () => window.performance.now(), REDRAW_MS, () => rebuild());
    /**
     * The table drawn again (the bar, the head, the rows, the slots) and the comparison told its data changed:
     * once per click, key or change however many things it changes.
     */
    const redraw = createRedraw([['paint', () => paint()], ['compare', () => deps.compareChanged?.()]] as const);
    const render = (): void => redraw.request('paint');
    /** The comparison follows the table's data only while the table is in the side panel beside it. */
    const tellCompare = (): void => { if (!maximized) redraw.request('compare'); };
    /** What the user chose to see changed: the rows are listed again (from the top for a new order or filter). */
    function choose(patch: Partial<EntryChoices>, toTop = false): void {
        Object.assign(chosen, patch);
        if (toTop) tableWrap.scrollTop = 0;
        rebuild();
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
    /** The differences fixed with D changed: kept, and their rows drawn. */
    function setDerived(next: DerivedRow[]): void {
        derived = next;
        deps.saveDerived?.(derived);
        rebuild();
    }

    /** Whether the chain ends in a spectrum or band levels, so there are band values and a peak. */
    function spectral(): boolean {
        const recipe = recipeState.edited ?? recipeState.standard;
        return !recipe || endsInSpectrum(recipe, limits()) || (!!brokenStep(recipe, limits()) && ['SpectralFrame', 'NOctFrame'].includes(chainEnd(recipe, limits())));
    }
    /** The values the table can show: the CSV's numeric columns, then those computed from the sound. */
    function valueOptions(): Array<{ id: ValueId; label: string; computed: boolean; ready: boolean }> {
        const csv = attached.csv;
        const own = (csv?.attributes ?? []).filter(column => csv?.numeric[column]).map(column => ({ id: `csv:${column}` as ValueId, label: column, computed: false, ready: true }));
        const computed: Array<{ id: ValueId; label: string }> = [
            { id: 'leq', label: strings.dsLeq },
            ...(spectral() ? [{ id: 'peak' as ValueId, label: strings.dsPeak }] : []),
            { id: 'crest', label: strings.dsCrest },
            ...(spectral() ? BAND_CENTERS_HZ.map((_, band) => ({ id: `band:${band}` as ValueId, label: strings.dsBand.replace('{band}', bandLabel(band)) })) : []),
        ];
        return [...own, ...computed.map(item => ({ ...item, computed: true, ready: false }))];
    }
    function groupOptions(): Array<{ id: GroupId; label: string }> {
        const folders = rows.reduce((most, row) => Math.max(most, row.folders.length), 0);
        return [
            ...(attached.csv?.attributes ?? []).map(column => ({ id: `csv:${column}` as GroupId, label: column })),
            ...Array.from({ length: folders }, (_, index) => ({ id: `folder:${index + 1}` as GroupId, label: strings.entryFolderLevel.replace('{n}', String(index + 1)) })),
            { id: 'ch', label: strings.dsCh },
            { id: 'none', label: strings.dsGroupNone },
        ];
    }
    const valueLabel = (id: ValueId): string => valueOptions().find(option => option.id === id)?.label ?? id;
    const groupLabel = (id: GroupId): string => groupOptions().find(option => option.id === id)?.label ?? id;
    const columnLabel = (column: ColumnId): string => (column === 'name' ? strings.entryColFile : column === 'ch' ? strings.dsCh
        : column === 'none' ? strings.dsGroupNone : column.startsWith('csv:') || column.startsWith('folder:') ? (valueOptions().find(option => option.id === column)?.label ?? groupLabel(column as GroupId)) : valueLabel(column as ValueId));
    /** A column's numbers: the CSV's numeric columns and the computed values (a range filter, numeric sort). */
    const numericColumn = (column: ColumnId): boolean => (column.startsWith('csv:') ? !!attached.csv?.numeric[column.slice(4)] : column === 'ch' ? false : column !== 'name' && column !== 'none' && !column.startsWith('folder:'));
    const formatColumn = (column: ColumnId, number: number): string => (column.startsWith('csv:') ? String(+number.toPrecision(6)) : formatValue(column as ValueId, number));
    function datasetView(): DatasetScreenView {
        const stale = stalePaths();
        const ready = !isComputed(chosen.value) || shownRows.every(row => results.has(row.filePath) && !stale.has(row.filePath));
        return {
            rows: shownRows, derived: derived.length ? derivedItems : undefined, results, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, slots, focused: focus.key, playing: deps.playing?.() ?? null, memo, valueReady: ready, stale, mode: chosen.mode, shown: shownFiles(), tracksAllOff: tracks.tried !== null && tracks.tried === listedFiles().join('\n'),
            unmatched: attached.match?.unmatched ?? [], filtered: new Set(chosen.filters.map(filter => filter.column)),
            columns: {
                name: { id: 'name', label: strings.entryColFile, numeric: false },
                ch: { id: 'ch', label: strings.dsCh, numeric: true },
                ...(chosen.group === 'none' ? {} : { group: { id: chosen.group, label: groupLabel(chosen.group), numeric: false } }),
                value: { id: chosen.value, label: valueLabel(chosen.value), numeric: true },
            },
        };
    }
    function unreadable(): Array<{ filePath: string; reason: string }> {
        return filePaths.flatMap(filePath => {
            const result = results.get(filePath);
            const headerError = headers.errors.get(filePath);
            if (headerError !== undefined && !result?.ok) return [{ filePath, reason: headerError }];
            return result && !result.ok && !result.failedStep ? [{ filePath, reason: result.reason ?? '' }] : [];
        });
    }
    /** The CSV rows and recordings that did not match; an unreadable recording is listed once, as unreadable. */
    function unmatchedItems(): CsvMatch['unmatched'] {
        if (!attached.csv || !attached.match) return [];
        const broken = new Set(unreadable().map(item => item.filePath));
        return attached.match.unmatched.filter(item => !item.filePath || !broken.has(item.filePath));
    }
    /** A row taken (slotted, left out, noted, focused) before its file's channels were known follows it to its ch 1 once they are. */
    function followChannels(): void {
        const keys = new Set(rows.map(row => row.key));
        const moved = (key: string): string | null => channelRowKey(key, keys);
        slots = slots.map(key => (key && moved(key)) || key);
        for (const key of [...excluded]) { const to = moved(key); if (to) { excluded.delete(key); excluded.add(to); } }
        for (const [key, note] of [...memo]) { const to = moved(key); if (to) { memo.delete(key); if (!memo.has(to)) memo.set(to, note); } }
        if (focus.key) focus.key = moved(focus.key) ?? focus.key;
    }
    function rebuild(): void {
        builtModel = null;
        pool = null;
        if (rowsDirty) {
            rowsDirty = false;
            rows = datasetRows(filePaths, rootPath, attached.match?.attributes ?? new Map(), results, headers.channels)
                .filter(row => !(headers.errors.has(row.filePath) && !results.get(row.filePath)?.ok) && (results.get(row.filePath)?.ok !== false || !!results.get(row.filePath)?.failedStep));
            byKey = new Map(rows.map(row => [row.key, row]));
            followChannels();
        }
        // A value or grouping the data no longer has (another CSV, no subfolders) gives way to the first it has.
        const values = valueOptions();
        if (!values.some(option => option.id === chosen.value)) chosen.value = values[0]?.id ?? 'leq';
        const groups = groupOptions();
        if (!groups.some(option => option.id === chosen.group)) chosen.group = groups.find(option => option.id.startsWith('csv:') && !attached.csv?.numeric[option.id.slice(4)])?.id ?? 'none';
        const onTracks = chosen.tracksOnly ? shownFiles() : null;
        shownRows = chosen.mode === 'excluded' ? rows.filter(row => excluded.has(row.key))
            : visibleRows({ rows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, excluded }, results).filter(row => !onTracks || onTracks.has(row.filePath));
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
        if (!values.some(option => option.id === chosen.value)) chosen.value = values[0]?.id ?? 'leq';
        const valueHtml = valueOptionsHtml(values.map(option => ({ ...option, label: option.computed && !view.valueReady && option.id === chosen.value ? option.label : option.label })), chosen.value, text);
        if (valueSelect.innerHTML !== valueHtml) valueSelect.innerHTML = valueHtml;
        valueSelect.value = chosen.value;
        const groupHtml = groupOptionsHtml(groupOptions(), chosen.group);
        if (groupSelect.innerHTML !== groupHtml) groupSelect.innerHTML = groupHtml;
        groupSelect.value = chosen.group;
        const chips = filterChipsHtml(chosen.filters, columnLabel, formatColumn, text, chosen.mode === 'all' ? { count: new Set(rows.filter(row => view.shown?.has(row.filePath)).map(row => row.filePath)).size, only: chosen.tracksOnly, confirm: tracks.pending?.length } : undefined);
        if (chipsBox.innerHTML !== chips) chipsBox.innerHTML = chips;
        renderCompute(view);
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
        const wanted = `<button type="button" class="entry-key" data-action="entry-key-hint" data-key="help">${escapeHtml(strings.keyHelp)}</button>`;
        if (keyHints.innerHTML !== wanted) keyHints.innerHTML = wanted;
        stepBar.set({ recipe: recipeState.edited ?? recipeState.standard, sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed: recipeState.failed, files: filePaths.length });
        screen.dataset.mode = chosen.mode;
        sidePlots.schedule();
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
    /** Only the rows on screen are drawn (rowWindow): the rest are spacers. */
    function renderRows(view = rowsView ?? datasetView()): void {
        rowsView = view;
        if (chosen.mode === 'unmatched') { body.innerHTML = unmatchedRowsHtml(unmatchedItems(), unreadable(), text); return; }
        const { first, last } = rowWindow(tableWrap.scrollTop, tableWrap.clientHeight, tableLines(view).length, ROW_HEIGHT);
        // The rows are drawn again: a focus on a row's ☐/☑ stays on a mark, so a second Space toggles it back
        // instead of falling to the body (and, docked, to the lanes' playback). It follows the focused row, so after
        // ↑/↓ the next Space or Enter takes the row that is lit, not the one the keys left.
        const focusedMark = document.activeElement?.closest?.('[data-action="entry-row-track"]');
        const markKey = focusedMark && body.contains(focusedMark) ? focusedMark.getAttribute('data-key') : null;
        body.innerHTML = datasetRowsHtml(view, first, last, ROW_HEIGHT, text);
        if (markKey !== null) body.querySelector<HTMLElement>(`[data-action="entry-row-track"][data-key="${CSS.escape(focus.key ?? markKey)}"]`)?.focus({ preventScroll: true });
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
        return choice === 'filtered' ? visibleRows({ rows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, excluded }, results) : rows.filter(row => !excluded.has(row.key));
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
            version: SESSION_VERSION, value: chosen.value, group: chosen.group, filters: chosen.filters, sort: chosen.sort, baseGroup: chosen.baseGroup, slots, memo: [...memo], excluded: [...excluded], derived,
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
        if (kept.derived) { derived = kept.derived; deps.saveDerived?.(derived); }
        // A chain saved with the session is the one its stored values are of: they are asked for again under it.
        const recipe = kept.recipe;
        if (recipe && recipeKey(recipe) !== recipeKey(recipeState.edited ?? undefined)) { recipeState.edited = recipe; deps.saveRecipe?.(recipe); loadStored(); }
    }
    const chipText = (filter: DatasetFilter): string => filterChipText(filter, columnLabel, formatColumn, text);
    /** What a compared row is measured against: the slot-0 recording, else a group's median. */
    const entryBase = createEntryBase({
        strings, slots: () => slots, rows: () => rows, rowOf, pool: () => distributionPool(), group: () => chosen.group, baseGroup: () => chosen.baseGroup,
        narrowedBy: () => chosen.filters.filter(filter => filter.column !== chosen.value).map(chipText),
        groupLabel, rowName: key => rowName(key), results, isStale, entryModel,
    });
    /** A compared file as the comparison names it: its name and channel, the value on show, its memo. */
    function rowInfo(path: string): { label: string; value: string; memo: string } {
        const row = entryBase.slotRowOf(path) ?? rows.find(item => item.filePath === path);
        if (!row) return { label: baseName(path), value: '', memo: '' };
        const number = usable(row) ? valueOf(row, chosen.value, results) : null;
        return { label: rowName(row.key), value: number === null ? '' : `${valueLabel(chosen.value)} ${formatColumn(chosen.value, number)}`, memo: memo.get(row.key) ?? '' };
    }
    function removeDerived(parentPath: string, region: string, baseLabel?: string): void {
        setDerived(derived.filter(item => item.parentPath !== parentPath || item.region !== region || (baseLabel !== undefined && (item.base.label ?? '') !== baseLabel)));
    }
    /** The differences fixed on a row (D), under it: their Δ of the value on show when it is Leq or a band. */
    function derivedItems(row: DatasetRow): DerivedItem[] {
        return derived.filter(item => item.parentPath === row.filePath && (item.ch ? item.ch === row.ch : row.ch === 1)).map(item => {
            const result = item.result;
            let delta: number | null = null;
            if (result.ok && chosen.value === 'leq' && result.leqDbA?.length) delta = powerMeanDb(result.leqDbA) - item.base.leq;
            else if (result.ok && chosen.value.startsWith('band:')) {
                const band = Number(chosen.value.slice(5));
                const level = powerMeanOrNull((result.thirdOctDb ?? []).map(channel => channel[band]));
                const reference = item.base.bands[band];
                if (level !== null && reference !== null && reference !== undefined) delta = level - reference;
            }
            const label = [item.region === 'all' ? '└ Δ' : `└ Δ ${item.region} s`, ...(item.base.label ? [item.base.label] : [])].join(' · ');
            return {
                key: derivedKey(item), label, value: delta === null ? '—' : `Δ ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`, stale: !!item.stale,
                title: label, parentPath: item.parentPath, region: item.region, baseLabel: item.base.label ?? '',
            };
        });
    }
    /** The rows the distribution draws from: not excluded, through every filter but the one on the value itself. */
    function distributionPool(): DatasetRow[] {
        pool ??= filteredRows({ rows, filters: chosen.filters.filter(filter => filter.column !== chosen.value), excluded }, results);
        return pool;
    }
    /** The range picked on the value drawn: it marks the distribution and narrows the table. */
    function valueRange(): { low: number; high: number } | null {
        const filter = chosen.filters.find(item => item.column === chosen.value);
        return filter?.kind === 'range' ? { low: filter.low, high: filter.high } : null;
    }
    /** A computed value counts only when it is of the current chain. */
    const usable = (row: DatasetRow): boolean => !isComputed(chosen.value) || (results.has(row.filePath) && !isStale(row.filePath));
    /** 「計算」 for the rows on screen without a value of this chain; while it runs, its progress and 中止. */
    function renderCompute(view: DatasetScreenView): void {
        let html = '';
        // Reading the headers (channels) comes first; it is quick but a large folder takes a moment, and it can be stopped.
        const probing = headers.progress();
        if (probing) html += `<span class="awa-tag" data-entry-probing>${escapeHtml(strings.dsProbing.replace('{done}', String(probing.done)).replace('{n}', String(probing.total)))}</span>`
            + `<button type="button" data-action="entry-probe-cancel">${escapeHtml(strings.entryScanCancel)}</button>`;
        if (progress.running) {
            html += `<span class="awa-tag" data-entry-progress>${escapeHtml(strings.dsComputing.replace('{done}', String(progress.done)).replace('{n}', String(progress.total)))}</span>`
                + `<button type="button" data-action="entry-compute-cancel">${escapeHtml(strings.entryScanCancel)}</button>`;
        } else if (broken()) {
            html += `<span class="awa-tag entry-stale-tag is-broken">${escapeHtml(strings.entryChainBroken)}</span>`;
        } else {
            const pending = computeTargets();
            if (pending.length) {
                const minutes = progress.estimateMs(pending) / 60000;
                const estimate = minutes >= 1 ? strings.entryMinutes.replace('{n}', String(Math.ceil(minutes))) : strings.entrySeconds.replace('{n}', String(Math.max(1, Math.ceil(minutes * 60))));
                // Some rows have the value: the rest is said in channels and offered (never started by itself).
                const pool = isComputed(chosen.value) ? distributionPool() : view.rows;
                const missing = pool.filter(row => !usable(row)).length;
                const partial = isComputed(chosen.value) && missing < pool.length;
                const label = partial ? strings.dsComputeRest.replace('{time}', estimate) : strings.dsCompute.replace('{n}', String(pending.length)).replace('{time}', estimate);
                html += (partial ? `<span class="awa-tag" data-entry-uncomputed>${escapeHtml(strings.dsUncomputed.replace('{n}', String(missing)))}</span>` : '')
                    + `<button type="button" data-action="entry-compute"${` data-hint="${escapeHtml(strings.hintCompute)}"`}>${escapeHtml(label)}</button>`;
            }
        }
        if (computeBox.innerHTML !== html) computeBox.innerHTML = html;
    }
    /** The files of the rows on screen (filters applied) that have no value of this chain yet. */
    function computeTargets(): string[] {
        // A computed value: the distribution's rows (a range on the value takes only computed rows, so it is not applied).
        const pool = isComputed(chosen.value) ? distributionPool() : chosen.mode === 'all' ? shownRows : visibleRows({ rows, group: chosen.group, value: chosen.value, filters: chosen.filters, sort: chosen.sort, excluded }, results);
        // 「トラックのみ」 computes only the files on a track, as the table shows.
        const onTracks = chosen.tracksOnly && chosen.mode === 'all' ? shownFiles() : null;
        return [...new Set(pool.map(row => row.filePath))].filter(path => (!onTracks || onTracks.has(path)) && (!results.has(path) || isStale(path)));
    }
    function sampleRate(): number | undefined {
        for (const result of results.values()) if (result.ok && result.input) return recipeState.knownRate = result.input.fs;
        return recipeState.knownRate;
    }
    function shortestSamples(): number | undefined {
        let shortest: number | undefined;
        for (const result of results.values()) {
            if (!result.ok || !result.input) continue;
            const samples = Math.floor(result.input.durationS * result.input.fs);
            shortest = shortest === undefined ? samples : Math.min(shortest, samples);
        }
        if (shortest !== undefined) recipeState.knownShortest = shortest;
        return recipeState.knownShortest;
    }
    function limits() {
        return stepLimits({ sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed: recipeState.failed });
    }
    /** The fewest channels of the scanned files, which a channel index must stay below. */
    function channelCount(): number | undefined {
        let fewest: number | undefined;
        for (const result of results.values()) if (result.ok && result.input) fewest = Math.min(fewest ?? Infinity, result.input.channels.length);
        return fewest;
    }
    /** The Recipe the scans run; undefined is the host's own, unchanged (nothing edited, no step left out). */
    function runRecipe(channels?: number): RecipeDocument | undefined {
        const recipe = recipeState.edited ?? (Object.keys(recipeState.failed).length ? recipeState.standard : null);
        return recipe ? runnableRecipe(recipe, channels ? { ...limits(), channels } : limits()) : undefined;
    }
    /** What the table's scans run: without the steps measured against the base slot, which they do not pair. */
    function scanRecipe(): RecipeDocument | undefined {
        return unpairedRecipe(runRecipe(), recipeState.edited);
    }
    function compareData(stage?: string): CompareData {
        return { model: entryModel(), results, slots: slotFiles(), recipe: recipeState.edited ?? recipeState.standard, runRecipe: scanRecipe(), failed: recipeState.failed, stale: stalePaths(), ...(stage ? { stage } : {}) };
    }
    /**
     * A step that failed on a file breaks the chain (⚠ on its chip and on every step after it): the computation
     * stops and the table keeps its values until the steps change; a step already marked, or one this Recipe does
     * not have, changes nothing.
     */
    function stepFailed(step: string, reason: string): void {
        const recipe = recipeState.edited ?? recipeState.standard;
        const known = recipeNodes(recipe).some(node => node.id === step);
        if (!known || recipeState.failed[step] !== undefined) return;
        recipeState.failed = { ...recipeState.failed, [step]: reason };
        if (progress.running) { deps.post({ type: 'entry-scan-cancel' }); progress.stop(); }
        rebuild();
        deps.stepsChanged?.();
    }
    /** A new Recipe from a step bar: every number changes, so the table scans again from the start. */
    /**
     * Fixed differences marked ≠ are measured again under the current Recipe once its scan is done: the
     * whole-file ones from the table's results, a region by a scan of its file and base over that region.
     */
    function remeasured(row: DerivedRow, results: ReadonlyMap<string, ScanResult>): DerivedRow | null {
        const result = results.get(row.parentPath);
        const base = baseOf(results, row.base.paths ?? []);
        if (!result?.ok || !base) return null;
        return { ...row, result, base: { ...row.base, ...base }, recipeKey: recipeKey(scanRecipe()), stale: false };
    }
    /**
     * Fixed differences of an earlier chain, measured again after a computation the user started (never at open);
     * one over a region whose base is a large group stays ≠ rather than scanning that group unasked.
     */
    function remeasureStale(): void {
        if (broken()) return;
        derived.forEach(row => {
            const basePaths = row.base.paths;
            if (!row.stale || !basePaths?.length) return;
            if (row.region !== 'all' && (basePaths.length > LARGE_BASE || progress.seconds(basePaths) > LARGE_BASE_S)) return;
            if (row.region === 'all') {
                const next = remeasured(row, results);
                if (next) derived = derived.map(item => (item === row ? next : item));
                return;
            }
            const [start, end] = row.region.split('–').map(Number);
            const recipe = scanRecipe();
            const id = `derived-${++requestCount}`;
            remeasuring.ask(id, id, derivedKey(row), { row, results: new Map() }, () => deps.post({ type: 'compare-scan', requestId: id, filePaths: [row.parentPath, ...basePaths], region: { start, end }, ...(recipe ? { recipe } : {}) }));
        });
        deps.saveDerived?.(derived);
    }
    /** The held plot: a slot key or chip held shows its row's Δ, a step chip held what the step does to one row. */
    const heldPlot = createHeldPlot({
        document, window, strings, held, title: heldTitle, canvas: heldCanvas, post: message => deps.post(message), scheduleSide: () => sidePlots.schedule(),
        keepWindow: (name, key) => sidePlots.keepWindow(name, key), entryModel, results, focusedFile, slotFiles, recipe: () => recipeState.edited ?? recipeState.standard, runRecipe: () => runRecipe(), limits, spectral,
        tapped(slot) { if (focus.key && rows.some(row => row.key === focus.key)) setSlot(slot, focus.key); },
    });
    function handleRemeasure(publication: ComparePublication): boolean {
        const pending = remeasuring.find(publication.requestId)?.meta;
        if (!pending) return false;
        if (publication.type === 'compare-scan-result') { pending.results.set(publication.filePath, publication.result); return true; }
        remeasuring.settle(publication.requestId);
        const next = remeasured(pending.row, pending.results);
        if (next) setDerived(derived.map(item => (item === pending.row ? next : item)));
        return true;
    }
    function setRecipe(recipe: RecipeDocument): void {
        recipeState.edited = recipe;
        // A new Recipe is tried whole again: a step that failed under the old one may not now.
        recipeState.failed = {};
        deps.saveRecipe?.(recipe);
        // The folder is not scanned again by itself: the table keeps the previous chain's values, greyed,
        // until "Scan all"; the focused row and the comparison's files are measured at once.
        if (progress.running) { deps.post({ type: 'entry-scan-cancel' }); progress.stop(); }
        // The row on screen keeps the focus: re-sorted by its new value, the top row would take it and be measured next, and so on down the folder.
        if (focus.key) focus.picked = true;
        // Differences fixed under another Recipe stay, marked ≠ until measured again under this one
        // (after the scan); one fixed under this very Recipe needs nothing.
        const key = recipeKey(scanRecipe());
        derived = derived.map(row => ({ ...row, stale: row.recipeKey !== key }));
        deps.saveDerived?.(derived);
        rebuild();
    }
    function paintDistribution(): void {
        distPane.paint({
            pool: distributionPool(), value: chosen.value, group: chosen.group, results, range: valueRange(), usable, slots, rowOf, baseGroup: entryBase.groupName(),
            valueLabel: valueLabel(chosen.value), format: number => formatColumn(chosen.value, number), rowName: key => rowName(key),
        });
    }
    /** The files shown as tracks now (a hidden track is not). */
    const shownFiles = (): Set<string> => new Set([...deps.shownTracks?.() ?? []].filter(([, hidden]) => !hidden).map(([filePath]) => filePath));
    const focusHeadMark = (): void => { head.querySelector<HTMLElement>('[data-action="entry-tracks-all"]')?.focus(); };
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
            tracks.pending = adding;
            render();
            redraw.after(() => screen.querySelector<HTMLElement>('[data-action="entry-tracks-all-go"]')?.focus());
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
    /** 「計算」: the value for the rows on screen that have none of this chain, slotted rows first. */
    function compute(): void {
        if (broken()) return;
        const pending = computeTargets();
        if (!pending.length) return;
        const slotted = pending.filter(path => slotFiles().includes(path));
        const { requestId } = requests.ask('scan', `entry-${++requestCount}`, currentKey(), undefined);
        progress.start(pending.length);
        const recipe = scanRecipe();
        deps.post({ type: 'entry-scan', requestId, rootPath, filePaths: [...slotted, ...pending.filter(path => !slotted.includes(path))], ...(recipe ? { recipe } : {}) });
        render();
    }
    /** The results stored for this chain come back without computing anything. */
    function loadStored(): void {
        const recipe = scanRecipe();
        requests.ask('scan', `entry-${++requestCount}`, currentKey(), undefined, ({ requestId }) => deps.post({ type: 'entry-scan', requestId, rootPath, filePaths, cachedOnly: true, ...(recipe ? { recipe } : {}) }));
    }
    /** Reads the files' headers for their channels, so rows split by channel before anything is computed. */
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
    /** 中止: what was computed stays; the rest keeps no value until computed. */
    function cancelCompute(): void {
        if (!progress.running) return;
        deps.post({ type: 'entry-scan-cancel' });
        progress.stop();
        requests.settle(requests.pending('scan')?.requestId ?? '');
        rebuild();
    }
    /** Moves the focus to a row and brings it on screen (the rows are drawn only where they are seen). */
    function focusRow(key: string | null, center = false): void {
        if (!key) return;
        focus.key = key;
        focus.picked = true;
        // Its line in the table: fixed differences under rows above it take lines too.
        const index = tableLines(datasetView()).findIndex(line => 'key' in line && line.key === key && !('baseLabel' in line));
        if (index >= 0) {
            const top = index * ROW_HEIGHT, bottom = top + ROW_HEIGHT, view = tableWrap.clientHeight - ROW_HEIGHT;
            if (center) tableWrap.scrollTop = Math.max(0, top - view / 2);
            else if (top < tableWrap.scrollTop) tableWrap.scrollTop = top;
            else if (bottom > tableWrap.scrollTop + view) tableWrap.scrollTop = bottom - view;
        }
        render();
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
            if (columns >= 6) sidePlots.schedule();
        }
    }
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) new Observer(() => { syncColumns(); renderRows(); }).observe(screen);
    /** Choosing, the distribution fills the right side; while a comparison is open it folds above the table. */
    distPane.place(maximized);
    function setMaximized(next: boolean): void {
        if (!next) stepBar.close();
        // The table's 書き出し menu shows only maximized: it does not come back open.
        if (!next) query<HTMLDetailsElement>('#entry-export-menu').open = false;
        maximized = next;
        distPane.place(maximized);
        screen.classList.toggle('is-max', next);
        sizeButton.textContent = next ? '⤡' : '⤢';
        sizeButton.setAttribute('aria-pressed', String(next));
        syncColumns();
        deps.maximizedChanged?.(next);
        render();
        sidePlots.schedule();
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
            redraw.after(() => {
                const button = focus.key ? body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(focus.key)}"] [data-action="entry-row-slotmenu"]`) : null;
                button?.classList.remove('is-flash'); void button?.offsetWidth; button?.classList.add('is-flash');
            });
            return;
        }
        const files = slotFiles().filter((path): path is string => !!path && filePaths.includes(path));
        // The tracks are compared in the track view; the table goes back into the side panel beside them.
        setMaximized(false);
        redraw.after(() => deps.openFiles(Array.from(new Set(files)), compareData(stage)));
    }
    function exportCsv(): void {
        const model = entryModel();
        const csvText = entryCsv(model, {
            file: strings.entryColFile,
            condition: n => strings.entryColCondition.replace('{n}', String(n)),
            regionStart: strings.reportRegionStart,
            regionEnd: strings.reportRegionEnd,
            leq: leqLabel(model, strings),
            peak: strings.entryColPeak,
            band: `${bandLabel(model.band)} dB`,
            deltaLeq: `Δ ${strings.entryColLeq}`,
            deltaBand: `Δ ${bandLabel(model.band)} dB`,
            groupSize: strings.entryCsvGroupSize,
            status: strings.dsReason,
        });
        deps.download(csvText, 'entry-table.csv');
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
            if (numeric && (chosen.value.startsWith('csv:') || !results.size)) chosen.value = `csv:${numeric}`;
            const category = next.attributes.find(column => !next.numeric[column]);
            if (category && (chosen.group === 'none' || chosen.group.startsWith('csv:') || !groupOptions().some(option => option.id === chosen.group))) chosen.group = `csv:${category}`;
        } else {
            if (chosen.value.startsWith('csv:')) chosen.value = 'leq';
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
        screen, head, chipsBox, text, rows: () => rows, excluded, results, csv: () => attached.csv, groupOptions, valueOptions,
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
        const hadMemo = !!popovers.memoKey;
        if (popovers.memoKey) saveMemo();
        filterPop.close(); popovers.slotMenu = null; popovers.memoKey = null; popovers.batch = null;
        renderPopovers();
        // A memo kept shows on its row (✎ lit, its text as the hint).
        if (hadMemo) render();
        redraw.after(() => (body.querySelector<HTMLElement>('.is-focused') ?? table).focus?.());
        return true;
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
        'entry-compute': () => compute(),
        'entry-compute-cancel': () => cancelCompute(),
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
        'entry-tracks-all-go': () => { tracks.pending = null; const listed = listedFiles(); const files = notShown(listed); if (files.length) showAll(listed, files); render(); redraw.after(focusHeadMark); },
        'entry-tracks-all-cancel': () => { tracks.pending = null; render(); redraw.after(focusHeadMark); },
        'entry-tracks-only': () => choose({ tracksOnly: !chosen.tracksOnly }, true),
        'entry-row-slotmenu': withKey(key => { filterPop.close(); popovers.memoKey = null; popovers.slotMenu = popovers.slotMenu === key ? null : key; focusOn(key); redraw.after(renderPopovers); }),
        'entry-row-slot': withKey((key, target) => { popovers.slotMenu = null; renderPopovers(); setSlot(Number(target.getAttribute('data-slot')), key); }),
        'entry-row-memo': withKey(openMemo),
        'entry-memo-close': () => { saveMemo(); popovers.memoKey = null; renderPopovers(); render(); },
        'entry-row-exclude': withKey(key => { excluded.add(key); rebuild(); }),
        'entry-row-restore': withKey(key => { excluded.delete(key); if (!excluded.size) chosen.mode = 'all'; rebuild(); }),
        'entry-batch': () => openBatch(),
        'entry-batch-go': () => exportBatch(),
        'entry-batch-cancel': () => closePopovers(),
        'entry-derived-remove': target => {
            const parent = target.getAttribute('data-parent'), region = target.getAttribute('data-region');
            if (parent !== null && region !== null) removeDerived(parent, region, target.getAttribute('data-base') ?? undefined);
        },
        'entry-key-hint': target => { if (target.getAttribute('data-key') === 'help') deps.help?.(); },
    };
    tableWrap.addEventListener('scroll', () => { renderRows(); sidePlots.schedule(false); });
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
    // The lanes' gestures on the side panel's plots: box zoom, Ctrl+wheel, Shift+wheel, double-click reset or
    // axis range. A press that stays put (within the lanes' 3 px) is still a click: a point picked, a row gone to.
    sidePlots.attach();

    /** Maximized, the table takes the keys; in the side panel, only keys pressed while it has the focus. */
    const keysHere = (event: Event): boolean => !screen.hidden && (maximized || screen.contains(event.target as Node));
    /** A button, a field or a popover takes its own keys (Enter, Space, digits): the table's keys act on rows only. */
    const ownKeys = (event: Event): boolean => !!(event.target as Element | null)?.closest?.('button, summary, select, input, textarea, [data-entry-pop], [data-step-bar], #entry-range-popover');
    // In front of the comparison and the lanes: a key the table is given goes no further, so one that just
    // switched screens does not act on the other one too.
    keyRouterFor(window).add({
        layer: 'entry',
        keydown: event => redraw.batch(() => {
            if (!keysHere(event)) return false;
            if ((event.target as Element | null)?.closest?.('[data-step-bar], #entry-range-popover')) return false;
            if (closesEntryDialog(event)) {
                event.preventDefault();
                // Esc closes the innermost thing: a popover, the step bar's form, the unmatched or excluded list;
                // then the maximized table shrinks into the side panel, and the side panel hands the keys back.
                if (closePopovers()) return true;
                if (tracks.pending) { tracks.pending = null; render(); redraw.after(focusHeadMark); return true; }
                if (closeExportMenu()) return true;
                if (stepBar.close()) return true;
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
            if (action === 'slot') { if (!event.repeat) heldPlot.press(Number(event.key)); }
            else if (action === 'open') openSlotted();
            else if (action === 'play') { if (focus.key) deps.play?.(fileOfKey(focus.key)); }
            else if (action === 'memo') { if (focus.key) openMemo(focus.key); }
            else if (action === 'track') { if (focus.key && chosen.mode === 'all') { toggleTrack(focus.key); render(); } }
            else if (action === 'row-up' || action === 'row-down') moveFocus(action === 'row-down' ? 1 : -1);
            return true;
        }),
        keyup: event => redraw.batch(() => {
            if (!keysHere(event) || ownKeys(event)) return false;
            if (keyAction(ENTRY_KEYS, event.key) === 'slot') heldPlot.release(Number(event.key));
            return true;
        }),
    });

    return {
        open(paths: string[], root = '', maximize = false): void {
            filePaths = paths.filter(path => !isMetadataCandidate(path));
            rootPath = root;
            recipeState.knownShortest = undefined;
            results.clear();
            sidePlots.clear();
            resultKeys.clear();
            rowsDirty = true;
            recipeState.knownRate = undefined;
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
            derived = (deps.loadDerived?.() ?? []).filter(row => filePaths.includes(row.parentPath));
            const savedRecipe = deps.loadRecipe?.();
            recipeState.edited = isRecipeChain(savedRecipe) ? savedRecipe : null;
            if (savedRecipe !== undefined && savedRecipe !== null && !recipeState.edited) { deps.saveRecipe?.(undefined); deps.announce(strings.stepRecipeWarning); }
            // The CSV picked last time comes back if it still reads (and matches these recordings by its own rules).
            attached.csv = null; attached.match = null; chosen.value = 'leq'; chosen.group = rootPath && filePaths.some(path => path.replaceAll('\\', '/').slice(rootPath.length + 1).includes('/')) ? 'folder:1' : 'none';
            const kept = deps.loadCsv?.();
            if (kept) {
                try { attached.csv = readDatasetCsv(new TextEncoder().encode(kept.text), kept.name); } catch { attached.csv = null; deps.saveCsv?.(undefined); }
            }
            screen.hidden = false;
            // A folder just opened keeps the table beside the tracks; ⤢ widens it when asked.
            setMaximized(maximize);
            applyCsv(attached.csv);
            // What is stored for this chain comes back; nothing is computed until 「計算」. The headers say each file's channels.
            loadStored();
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
        tracksChanged: () => { if (chosen.tracksOnly) rebuild(); else if (!screen.hidden) render(); },
        trackRemoved: filePath => redraw.batch(() => {
            tracks.tried = null;
            const [slot] = slotsOfFile(slots, filePath);
            if (slot !== undefined) setSlot(slot, null, false); else if (!screen.hidden) render();
            // With 「トラックのみ」 on, the row leaves with its lane.
            if (chosen.tracksOnly) rebuild();
        }),
        setRecipe,
        stepFailed,
        addDerived(row: DerivedRow): void {
            setDerived([...derived.filter(item => derivedKey(item) !== derivedKey(row)), row]);
        },
        removeDerived: (parentPath: string, region: string, baseLabel?: string) => removeDerived(parentPath, region, baseLabel),
        show(next: (string | null)[]): void {
            slots = slotsForFiles(next, slots);
            screen.hidden = false;
            setMaximized(true);
        },
        handle(message): boolean {
            if (message.type.startsWith('compare-')) return heldPlot.handle(message) || handleRemeasure(message as ComparePublication);
            if (!message.type.startsWith('entry-')) return false;
            if (message.type === 'entry-probe-result' || message.type === 'entry-probe-done') {
                const taken = headers.take(message as EntryProbePublication);
                if (taken === 'stale') return true;
                if (taken === 'done') { rebuild(); return true; }
                rowsDirty = true;
                resultsRedraw.schedule();
                return true;
            }
            const publication = message as EntryPublication;
            // A computation stopped with 中止 sends nothing more that counts.
            if (!requests.answering('scan', publication.requestId)) return true;
            if (publication.type === 'entry-conditions') {
                if (publication.recipe) recipeState.standard = publication.recipe;
                // At open the folder's session comes back with what is stored; from then on, changes are saved.
                const loading = !session.loaded;
                if (loading) {
                    applySession(publication.session, publication.csv);
                    // A CSV kept by the webview alone (before sessions) goes to the host's store with the next save.
                    if (!publication.csv && attached.csv) session.keepCsv(deps.loadCsv?.() ?? undefined);
                }
                rebuild();
                // What the table settled on at open is what is stored: only a change after it is saved.
                if (loading) session.markLoaded();
            } else if (publication.type === 'entry-scan-result') {
                noteResult(publication.filePath, publication.result);
                resultKeys.set(publication.filePath, requests.find(publication.requestId)?.key ?? currentKey());
                rowsDirty = true;
                progress.fileDone(publication.filePath);
                const { failedStep, reason } = publication.result;
                if (failedStep) { stepFailed(failedStep, reason ?? ''); return true; }
                if (attached.csv && !attached.match?.attributes.size) attached.match = matchCsv(attached.csv, filePaths, rootPath);
                resultsRedraw.schedule();
            } else if (publication.type === 'entry-scan-done') {
                resultsRedraw.cancel();
                requests.settle(publication.requestId);
                // Only a computation the user started measures fixed differences again; reading what is stored does not.
                const started = progress.stop();
                if (started) remeasureStale();
                rebuild();
            }
            return true;
        },
        compareData: () => compareData(),
        slots: () => slotFiles(),
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
        basePaths: (comparePath, byGroup = false) => entryBase.resolve(comparePath, byGroup).paths,
        baseTitle: (comparePath, byGroup = false) => entryBase.resolve(comparePath, byGroup).title,
        baseDefinition: (comparePath, byGroup = false) => entryBase.resolve(comparePath, byGroup).definition,
        stageChannel: (path, comparePath, byGroup = false) => entryBase.stageChannel(path, comparePath, byGroup),
        comparison: (comparePath, byGroup = false, over, entryRegionBase = false) => entryBase.comparison(comparePath, byGroup, over, entryRegionBase),
        rowInfo: path => rowInfo(path),
        cost: paths => ({ seconds: progress.seconds(paths), ms: progress.estimateMs(paths) }),
        tableBaseBands: (comparePath, byGroup = false) => entryBase.tableBands(comparePath, byGroup),
        selection: () => ({
            value: valueLabel(chosen.value), group: chosen.group === 'none' ? strings.dsGroupNone : groupLabel(chosen.group),
            filters: chosen.filters.map(filter => chipText(filter)), excluded: excluded.size,
        }),
        derivedRows: () => derived.slice(),
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
            const last = distPane.last();
            return {
                open: !screen.hidden && maximized, docked: !screen.hidden && !maximized, cols: Number(screen.dataset.cols ?? 0), rows: rows.length, visible: shownRows.length,
                scanned: [...results.values()].filter(result => result.ok).length, slots: slots.slice(), focused: focus.key, value: chosen.value, group: chosen.group, filters: chosen.filters.map(filter => ({ ...filter })),
                sort: { ...chosen.sort }, excluded: [...excluded], memo: Object.fromEntries(memo), mode: chosen.mode, unmatched: unmatchedItems().length + unreadable().length,
                csv: attached.csv?.name ?? null, playing: deps.playing?.() ?? null, visibleKeys: shownRows.slice(0, 200).map(row => row.key), scanning: progress.running,
                dist: last ? {
                    groups: last.groups.map(item => ({ name: item.name, n: item.members.length, inRange: item.members.filter(member => member.inRange).length })),
                    missing: last.missing, unit: last.unit, low: last.low, high: last.high, range: valueRange(), base: entryBase.groupName(),
                    strip: !maximized,
                } : null,
            };
        },
    };
}
