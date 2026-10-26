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
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { BAND_CENTERS_HZ, bandLabel, buildEntryModel, derivedKey, entryCsv, type BaseDefinition, type DerivedRow, type EntryModel } from './entryTable';
import { channelResult } from '../../shared/recipe/channelSelection';
import { batchBundle, batchCount } from '../../shared/batch/batchBundle';
import { baseOf, buildCompareModel, sideView, type CompareModel } from './comparePanes';
import { OVERVIEW_MARGINS, paintOverview } from './entryPlots';
import { compareGroupNames, distribution, DISTRIBUTION_BINS, groupLabels, median, type Distribution } from '../../shared/dataset/distribution';
import { DIST_ROW_MAX, DIST_ROW_MIN, DIST_STRIP_ROW, distributionSvg, type DistributionScale } from './entryDistribution';
import { attachPlotInteraction, FULL_PLOT_WINDOW, plotPointIn, type PlotMargins, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, paintOverlay, stageAxes, stageDiffRange, stageDifference, stageRange, STAGE_MARGINS, type StageAxes } from './stagePanes';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { createStageSource, type StageSpec } from './stageSource';
import { HostRequests } from './hostRequests';
import { createDetailPlanner } from './stageDetail';
import type { PaneRange } from './comparePanes';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { positionPopover } from './settingsPopover';
import { LARGE_BASE, LARGE_BASE_S } from './trackStageMode';
import { createStepBar, endsInSpectrum, recipeWithout, runnableRecipe, stepChipLabel, stepLimits, OCTAVE_BRANCH } from './stepBar';
import { leqLabel } from './compareReport';
import { brokenStep, chainEnd, isRecipeChain, recipeKey, recipeSteps, timeSignalStep, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { baseName, isMetadataCandidate, withFolderColumns } from '../../shared/analysis/entryMetadata';
import { powerMeanDb, powerMeanOrNull } from '../../shared/utils/levels';
import { finiteNumber } from '../../shared/dataset/asdData';
import {
    annotatedCsv, baseGroupMembers, columnValues, datasetRows, filteredRows, fileOfKey, rowKey, groupOf as datasetGroupOf, isComputed, matchCsv, readDatasetCsv, valueOf, visibleRows,
    type ColumnId, type CsvMatch, type DatasetCsv, type DatasetFilter, type DatasetRow, type GroupId, type ValueId,
} from '../../shared/dataset/datasetTable';
import {
    closesEntryDialog, filterChipText, tableLines, type DerivedItem, datasetColsHtml, datasetHeadHtml, datasetRowsHtml, entryScreenHtml, entrySlotsHtml, filterChipsHtml, filterPopHtml, checkListHtml, formatValue,
    baseMenuHtml, batchPopHtml, groupOptionsHtml, memoPopHtml, slotMenuHtml, unmatchedRowsHtml, valueOptionsHtml,
    type DatasetColumn, type DatasetScreenView, type EntryStrings,
} from './entryTableHtml';

/** A tap on a slot key shorter than this puts the row in; longer is a hold that shows the slot's Δ on the side. */
const TAP_MS = 250;
/** Releasing a held slot keeps its picture on screen this long, so a quick look does not flicker. */
const DELTA_RELEASE_MS = 150;
/**
 * Scan results are redrawn at most this often: each redraw sorts every row, so redrawing per result would
 * cost the square of the folder size.
 */
const REDRAW_MS = 250;
/** The table's rows are this tall (CSS: .entry-table tr), so only the rows on screen are drawn. */
const ROW_HEIGHT = 24;
/** A CSV larger than this is read but not kept for the next session (the webview's state would grow too large). */
const KEEP_CSV_BYTES = 2 * 1024 ** 2;
/** The session is saved this long after the last change, so typing or dragging saves once. */
const SESSION_SAVE_MS = 600;

/** What a comparison of the slotted files needs of the entry table (the track view's steps mode, D and the report). */
export interface CompareData {
    model: EntryModel;
    results: ReadonlyMap<string, ScanResult>;
    slots: (string | null)[];
    /** The step bar's Recipe, and the one scans run (invalid steps left out; undefined = the host's own). */
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
    /** The chain the table measures with, the one its scans run, and the steps that failed on a file (with why). */
    recipes(): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
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
    const query = <T extends Element>(selector: string): T => screen.querySelector<T>(selector)!;
    const head = query<HTMLElement>('[data-entry-head]');
    const body = query<HTMLElement>('[data-entry-rows]');
    const cols = query<HTMLElement>('[data-entry-cols]');
    const table = query<HTMLElement>('[data-entry-table]');
    const slotBar = query<HTMLElement>('[data-entry-slots]');
    const keyHints = query<HTMLElement>('[data-entry-keys]');
    const chipsBox = query<HTMLElement>('[data-entry-chips]');
    const computeBox = query<HTMLElement>('[data-entry-compute]');
    const valueSelect = query<HTMLSelectElement>('[data-action="entry-value"]');
    const groupSelect = query<HTMLSelectElement>('[data-action="entry-group"]');
    const csvInput = query<HTMLInputElement>('[data-entry-csv-input]');
    const tableWrap = query<HTMLElement>('.entry-table-wrap');
    const distBox = query<HTMLElement>('[data-entry-dist]');
    const distArea = query<HTMLElement>('[data-entry-dist-area]');
    const distGroups = query<HTMLElement>('[data-entry-dist-groups]');
    const distAxis = query<HTMLElement>('[data-entry-dist-axis]');
    const distEmpty = query<HTMLElement>('[data-entry-dist-empty]');
    const distNote = query<HTMLElement>('[data-entry-dist-note]');
    const distCount = query<HTMLElement>('[data-entry-dist-count]');
    const distLegend = query<HTMLElement>('[data-entry-dist-legend]');
    const entryBody = query<HTMLElement>('.entry-body');
    const held = query<HTMLElement>('[data-entry-held]');
    const heldTitle = query<HTMLElement>('[data-entry-held-title]');
    const heldCanvas = query<HTMLCanvasElement>('[data-entry-held-canvas]');
    const overview = query<HTMLCanvasElement>('[data-entry-overview]');
    const side = query<HTMLElement>('.entry-side');
    /**
     * The side panel's zoom, as the lanes keep theirs: per plot (held, overview strip), the part of each
     * axis on screen. A plot on other axes (another column, another held picture) starts whole again.
     */
    const plotWindows = new Map<string, PlotWindow>();
    const windowKeys = new Map<string, string>();
    const plotWindow = (name: string): PlotWindow => plotWindows.get(name) ?? FULL_PLOT_WINDOW;
    function keepWindow(name: string, key: string): PlotWindow {
        if (windowKeys.get(name) !== key) { windowKeys.set(name, key); plotWindows.delete(name); }
        return plotWindow(name);
    }
    /** A level range narrowed to a window's vertical part. */
    const narrowed = (range: PaneRange, window: PlotWindow): PaneRange => ({ min: range.min + window.y.start * (range.max - range.min), max: range.min + window.y.end * (range.max - range.min) });
    /** What the held plot last drew, to place the pointer on it and to map an axis's values to its window. */
    let heldPlot: { margins: PlotMargins; x: (fraction: number) => number; ofX: (value: number) => number; range: PaneRange; xLabel: string; yLabel: string } | null = null;
    /** The axis strip below the groups, and the room it needs. */
    const DIST_AXIS_SPACE = 44;
    /** What the distribution last drew, to map a drag on it to the value's range. */
    let distScale: DistributionScale | null = null;
    let lastDistribution: Distribution | null = null;
    const stepBar = createStepBar({
        document, strings, mode: 'entry', onChange: recipe => setRecipe(recipe),
        // A step pressed opens the comparison on that step's Frame.
        onStepSelect: step => openSlotted(step.id),
        // On the entry table a hold shows one row: without a step of its time signal, or its spectrum or bands.
        canHold: step => canHoldStep(step),
        onStepHold: step => holdStep(step),
    });
    // The chain is edited where the analysis is decided: the track view's steps (trackStageMode.ts). The table
    // only keeps its state, so its values are measured with the same chain.
    /** The host's entry Recipe, and the one edited in the step bar (which the scans then use). */
    let standardRecipe: RecipeDocument | null = null;
    let editedRecipe: RecipeDocument | null = null;
    /** Steps that failed on a file, with wandas' reason: the chain is broken until the Recipe changes. */
    let failed: Record<string, string> = {};

    let filePaths: string[] = [];
    const results = new Map<string, ScanResult>();
    /** Each scanned recording's bands (its channels' power mean) and the calibrated ones, kept as results arrive so scrolling does not redo them. */
    const overviewLevels = new Map<string, (number | null)[]>();
    const calibratedFiles = new Set<string>();
    let overviewVersion = 0;
    function noteResult(filePath: string, result: ScanResult): void {
        results.set(filePath, result);
        overviewVersion++;
        if (result.ok && result.thirdOctDb?.length) overviewLevels.set(filePath, result.thirdOctDb[0].map((_, bandIndex) => powerMeanOrNull(result.thirdOctDb!.map(channel => channel[bandIndex]))));
        else overviewLevels.delete(filePath);
        if (result.ok && result.input?.unit !== undefined && result.input.unit !== 'FS') calibratedFiles.add(filePath);
        else calibratedFiles.delete(filePath);
    }
    /** The Recipe each result was measured with (recipeKey of the run): a result of another chain is greyed. */
    const resultKeys = new Map<string, string>();
    /** What the table asked the host for: the folder's stored results or a computation ('scan'), a fixed difference measured again. */
    const requests = new HostRequests<undefined>();
    const remeasuring = new HostRequests<{ row: DerivedRow; results: Map<string, ScanResult> }>();
    /** Whether the chain cannot run (a step that cannot, and so nothing after it): the table then has no values for it. */
    const broken = (): boolean => { const recipe = editedRecipe ?? standardRecipe; return !!recipe && !!brokenStep(recipe, limits()); };
    const currentKey = (): string => (broken() ? 'broken' : recipeKey(runRecipe()));
    const isStale = (path: string): boolean => results.has(path) && resultKeys.get(path) !== currentKey();
    function stalePaths(): Set<string> {
        const key = currentKey();
        return new Set(filePaths.filter(path => results.has(path) && resultKeys.get(path) !== key));
    }
    /**
     * What a computation takes, for the estimate on 「計算」: a fixed part per file and a part per second of audio
     * (a 10-minute recording takes far longer than a 2-second one). The per-second part is measured once a
     * computation has done a few files. A file whose length is not known yet counts as UNKNOWN_DURATION_S.
     */
    const PER_FILE_MS = 100, UNKNOWN_DURATION_S = 10;
    let perAudioSecondMs = 35;
    let scanStarted = 0;
    let scanCount = 0;
    let scannedSeconds = 0;
    /** Each file's length: from its result, else from its header (WAV, FLAC). */
    const headerDurations = new Map<string, number>();
    const durationOf = (path: string): number | undefined => results.get(path)?.input?.durationS ?? headerDurations.get(path);
    function estimateMs(paths: readonly string[]): number {
        return paths.reduce((sum, path) => sum + PER_FILE_MS + perAudioSecondMs * (durationOf(path) ?? UNKNOWN_DURATION_S), 0);
    }
    /** The files of the running computation, for its progress. */
    let computingFiles = 0;
    let rootPath = '';

    // ---- the dataset: the CSV the user picked, and what the user chose to see
    let csv: DatasetCsv | null = null;
    let match: CsvMatch | null = null;
    let value: ValueId = 'leq';
    let group: GroupId = 'none';
    let filters: DatasetFilter[] = [];
    let sort: DatasetScreenView['sort'] = { column: 'name', descending: false };
    const excluded = new Set<string>();
    const memo = new Map<string, string>();
    let mode: DatasetScreenView['mode'] = 'all';
    /** Channels read from the files' headers at open (no audio decoded), and the files whose header could not be read. */
    const headerChannels = new Map<string, number>();
    const headerErrors = new Map<string, string>();
    let probing: { requestId: string; done: number; total: number } | null = null;
    let rows: DatasetRow[] = [];
    let shownRows: DatasetRow[] = [];
    /** The column filter open (its column, whether it hangs from that column's header, its draft), the slot menu and the memo. */
    let fpop: { column: ColumnId; anchored: boolean; search: string; checked: Set<string> | null } | null = null;
    let slotMenu: string | null = null;
    let memoKey: string | null = null;

    let requestCount = 0;
    /** Row keys in slots 0–3: the base (or null for the group median) and the rows to compare. */
    let slots: (string | null)[] = [null, null, null, null];
    let focused: string | null = null;
    /** Until the user picks a row, the focus follows the top of the table. */
    let focusPicked = false;
    let derived: DerivedRow[] = [];
    /** The group whose median is the base while slot 0 is empty; null: slot 1's group. */
    let baseGroup: string | null = null;
    /**
     * The folder's session, kept by the host (its workspace storage, IndexedDB on the Web): saved a moment after
     * each change once the stored one has come back at open (so the defaults of a fresh open never overwrite it).
     */
    let sessionLoaded = false;
    let sessionTimer: number | undefined;
    let savedSession = '';
    /** The CSV to save with the next session: undefined when unchanged since the last. */
    let csvToSave: { name: string; text: string } | null | undefined;
    /** Just folded above the table: its two rows in view go to the compared row's group. */
    let stripToSlot = false;
    let baseMenu = false;
    /** 「レシピをまとめて書き出す」 open: for the filtered rows or all. */
    let batchChoice: 'filtered' | 'all' | null = null;
    let sidePending = false;
    /** The slot key or chip being pressed: a tap acts on release, a hold shows the slot's Δ until then. */
    let pressing: { slot: number; at: number; timer: number } | undefined;
    let heldSlot: number | null = null;
    let heldTimer: number | undefined;
    /** A computation the user started is running. */
    let scanning = false;
    /**
     * The comparison's model of the files (their conditions, Δ, groups): built when the comparison, the overview
     * strip or the CSV export reads it, not on every redraw of the table (it costs a pass over every file).
     */
    let builtModel: EntryModel | null = null;
    function entryModel(): EntryModel {
        if (builtModel) return builtModel;
        // The CSV's attributes and the subfolders as its condition table, grouped by the column the table groups by.
        const attributes = csv?.attributes ?? [];
        const own: EntryConditionTable | null = csv && match ? {
            columns: attributes, checked: [],
            rows: Object.fromEntries([...match.attributes].map(([filePath, row]) => [filePath, attributes.map(column => row[column] ?? '')])),
            numeric: attributes.map(column => csv!.numeric[column] ?? false), source: csv.name,
        } : null;
        const folders = withFolderColumns(own, filePaths, rootPath, level => strings.entryFolderLevel.replace('{n}', String(level)));
        const checked = group.startsWith('csv:') ? [attributes.indexOf(group.slice(4))] : group.startsWith('folder:') ? [attributes.length + Number(group.slice(7)) - 1] : [];
        const table = folders && { ...folders, checked: checked.filter(index => index >= 0 && index < folders.columns.length) };
        builtModel = buildEntryModel(filePaths.map(filePath => ({ filePath, result: results.get(filePath) })), table, { derived });
        return builtModel;
    }
    /** The rows through the filters but the value's own (unsorted), kept until the next rebuild. */
    let pool: DatasetRow[] | null = null;
    /** The rows are made again only when the files, their results, their headers or the CSV change, not on every redraw. */
    let rowsDirty = true;
    let redrawTimer: number | undefined;
    let lastRedraw = 0;
    let redrawCost = 0;
    const focusedFile = (): string | null => (focused ? fileOfKey(focused) : null);
    const slotFiles = (): (string | null)[] => slots.map(key => (key ? fileOfKey(key) : null));
    let byKey = new Map<string, DatasetRow>();
    const rowOf = (key: string | null): DatasetRow | undefined => (key ? byKey.get(key) : undefined);
    function scheduleRebuild(): void {
        if (redrawTimer !== undefined) return;
        // A big table takes longer to draw, so it waits longer: drawing stays under a fifth of the time.
        const interval = Math.max(REDRAW_MS, 4 * redrawCost);
        const wait = Math.max(0, interval - (window.performance.now() - lastRedraw));
        redrawTimer = window.setTimeout(() => {
            redrawTimer = undefined;
            const started = window.performance.now();
            rebuild();
            lastRedraw = window.performance.now();
            redrawCost = lastRedraw - started;
        }, wait);
    }

    /** Whether the chain ends in a spectrum or band levels, so there are band values and a peak. */
    function spectral(): boolean {
        const recipe = editedRecipe ?? standardRecipe;
        return !recipe || endsInSpectrum(recipe, limits()) || (!!brokenStep(recipe, limits()) && ['SpectralFrame', 'NOctFrame'].includes(chainEnd(recipe, limits())));
    }
    /** The values the table can show: the CSV's numeric columns, then those computed from the sound. */
    function valueOptions(): Array<{ id: ValueId; label: string; computed: boolean; ready: boolean }> {
        const own = (csv?.attributes ?? []).filter(column => csv!.numeric[column]).map(column => ({ id: `csv:${column}` as ValueId, label: column, computed: false, ready: true }));
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
            ...(csv?.attributes ?? []).map(column => ({ id: `csv:${column}` as GroupId, label: column })),
            ...Array.from({ length: folders }, (_, index) => ({ id: `folder:${index + 1}` as GroupId, label: strings.entryFolderLevel.replace('{n}', String(index + 1)) })),
            { id: 'ch' as GroupId, label: strings.dsCh },
            { id: 'none' as GroupId, label: strings.dsGroupNone },
        ];
    }
    const valueLabel = (id: ValueId): string => valueOptions().find(option => option.id === id)?.label ?? id;
    const groupLabel = (id: GroupId): string => groupOptions().find(option => option.id === id)?.label ?? id;
    const columnLabel = (column: ColumnId): string => (column === 'name' ? strings.entryColFile : column === 'ch' ? strings.dsCh
        : column === 'none' ? strings.dsGroupNone : column.startsWith('csv:') || column.startsWith('folder:') ? (valueOptions().find(option => option.id === column)?.label ?? groupLabel(column as GroupId)) : valueLabel(column as ValueId));
    /** A column's numbers: the CSV's numeric columns and the computed values (a range filter, numeric sort). */
    const numericColumn = (column: ColumnId): boolean => (column.startsWith('csv:') ? !!csv?.numeric[column.slice(4)] : column === 'ch' ? false : column !== 'name' && column !== 'none' && !column.startsWith('folder:'));
    const formatColumn = (column: ColumnId, number: number): string => (column.startsWith('csv:') ? String(+number.toPrecision(6)) : formatValue(column as ValueId, number));
    function datasetView(): DatasetScreenView {
        const stale = stalePaths();
        const ready = !isComputed(value) || shownRows.every(row => results.has(row.filePath) && !stale.has(row.filePath));
        return {
            rows: shownRows, derived: derived.length ? derivedItems : undefined, results, group, value, filters, sort, slots, focused, playing: deps.playing?.() ?? null, memo, valueReady: ready, stale, mode, shown: new Set(deps.shownTracks?.().keys() ?? []),
            unmatched: match?.unmatched ?? [], filtered: new Set(filters.map(filter => filter.column)),
            columns: {
                name: { id: 'name', label: strings.entryColFile, numeric: false },
                ch: { id: 'ch', label: strings.dsCh, numeric: true },
                ...(group === 'none' ? {} : { group: { id: group, label: groupLabel(group), numeric: false } }),
                value: { id: value, label: valueLabel(value), numeric: true },
            },
        };
    }
    function unreadable(): Array<{ filePath: string; reason: string }> {
        return filePaths.flatMap(filePath => {
            const result = results.get(filePath);
            if (headerErrors.has(filePath) && !result?.ok) return [{ filePath, reason: headerErrors.get(filePath)! }];
            return result && !result.ok && !result.failedStep ? [{ filePath, reason: result.reason ?? '' }] : [];
        });
    }
    /** The CSV rows and recordings that did not match; an unreadable recording is listed once, as unreadable. */
    function unmatchedItems(): CsvMatch['unmatched'] {
        if (!csv || !match) return [];
        const broken = new Set(unreadable().map(item => item.filePath));
        return match.unmatched.filter(item => !item.filePath || !broken.has(item.filePath));
    }
    /** A row taken (slotted, left out, noted, focused) before its file's channels were known follows it to its ch 1 once they are. */
    function followChannels(): void {
        const keys = new Set(rows.map(row => row.key));
        const moved = (key: string): string | null => (!keys.has(key) && fileOfKey(key) === key && keys.has(rowKey(key, 1, 2)) ? rowKey(key, 1, 2) : null);
        slots = slots.map(key => (key && moved(key)) || key);
        for (const key of [...excluded]) { const to = moved(key); if (to) { excluded.delete(key); excluded.add(to); } }
        for (const [key, note] of [...memo]) { const to = moved(key); if (to) { memo.delete(key); if (!memo.has(to)) memo.set(to, note); } }
        if (focused) focused = moved(focused) ?? focused;
    }
    function rebuild(): void {
        builtModel = null;
        pool = null;
        if (rowsDirty) {
            rowsDirty = false;
            rows = datasetRows(filePaths, rootPath, match?.attributes ?? new Map(), results, headerChannels)
                .filter(row => !(headerErrors.has(row.filePath) && !results.get(row.filePath)?.ok) && (results.get(row.filePath)?.ok !== false || !!results.get(row.filePath)?.failedStep));
            byKey = new Map(rows.map(row => [row.key, row]));
            followChannels();
        }
        // A value or grouping the data no longer has (another CSV, no subfolders) gives way to the first it has.
        const values = valueOptions();
        if (!values.some(option => option.id === value)) value = values[0]?.id ?? 'leq';
        const groups = groupOptions();
        if (!groups.some(option => option.id === group)) group = groups.find(option => option.id.startsWith('csv:') && !csv?.numeric[option.id.slice(4)])?.id ?? 'none';
        shownRows = mode === 'excluded' ? rows.filter(row => excluded.has(row.key))
            : visibleRows({ rows, group, value, filters, sort, excluded }, results);
        if (!focusPicked || !focused || !rows.some(row => row.key === focused)) focused = shownRows[0]?.key ?? null;
        render();
        if (!maximized) deps.compareChanged?.();
    }
    /** Redraws the bar, the head and the rows; popovers that are open stay as they are (what is typed in them is kept). */
    function render(): void {
        const view = datasetView();
        const values = valueOptions();
        if (!values.some(option => option.id === value)) value = values[0]?.id ?? 'leq';
        const valueHtml = valueOptionsHtml(values.map(option => ({ ...option, label: option.computed && !view.valueReady && option.id === value ? option.label : option.label })), value, text);
        if (valueSelect.innerHTML !== valueHtml) valueSelect.innerHTML = valueHtml;
        valueSelect.value = value;
        const groupHtml = groupOptionsHtml(groupOptions(), group);
        if (groupSelect.innerHTML !== groupHtml) groupSelect.innerHTML = groupHtml;
        groupSelect.value = group;
        const chips = filterChipsHtml(filters, columnLabel, formatColumn, text);
        if (chipsBox.innerHTML !== chips) chipsBox.innerHTML = chips;
        renderCompute(view);
        const unmatchedButton = query<HTMLButtonElement>('[data-action="entry-view-unmatched"]');
        const unmatchedCount = unmatchedItems().length + unreadable().length;
        unmatchedButton.hidden = unmatchedCount === 0;
        unmatchedButton.textContent = (csv ? strings.dsUnmatched : strings.dsUnreadable).replace('{n}', String(unmatchedCount));
        unmatchedButton.setAttribute('data-hint', csv ? strings.hintUnmatched : strings.hintUnreadable);
        unmatchedButton.setAttribute('aria-pressed', String(mode === 'unmatched'));
        const excludedButton = query<HTMLButtonElement>('[data-action="entry-view-excluded"]');
        // Shown only when something is taken out (or its list is open, to come back from it).
        excludedButton.hidden = excluded.size === 0 && mode !== 'excluded';
        excludedButton.textContent = strings.dsExcluded.replace('{n}', String(excluded.size));
        excludedButton.setAttribute('aria-pressed', String(mode === 'excluded'));
        query('[data-entry-source]').textContent = csv && match ? strings.dsCsvSource.replace('{name}', csv.name).replace('{matched}', String(match.attributes.size)).replace('{total}', String(filePaths.length)) : strings.dsPickCsv;
        cols.innerHTML = datasetColsHtml(view);
        head.innerHTML = datasetHeadHtml(view, text);
        renderRows(view);
        // One file in two slots as different channels: it is one track, drawn as the first slot's channel (1–3, then 0).
        const notes = slots.map(key => {
            const shown = key ? slotRowOf(fileOfKey(key)) : undefined;
            return key && shown && shown.key !== key && (shown.channels ?? 1) > 1 ? strings.dsSlotTrackChannel.replace('{ch}', String(shown.ch)) : null;
        });
        slotBar.innerHTML = entrySlotsHtml(slots, key => rowName(key), baseText(), text, heldSlot, notes);
        notes.forEach((note, slot) => slotBar.querySelector(`[data-action="entry-slot"][data-slot="${slot}"]`)?.setAttribute('data-track-note', note ?? ''));
        const wanted = `<button type="button" class="entry-key" data-action="entry-key-hint" data-key="help">${escapeHtml(strings.keyHelp)}</button>`;
        if (keyHints.innerHTML !== wanted) keyHints.innerHTML = wanted;
        stepBar.set({ recipe: editedRecipe ?? standardRecipe, sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed, files: filePaths.length });
        screen.dataset.mode = mode;
        scheduleSide();
        scheduleSessionSave();
    }
    /** Only the rows on screen are drawn: the rest are spacers, so 100,000 rows scroll as 40 do. */
    function renderRows(view = datasetView()): void {
        if (mode === 'unmatched') { body.innerHTML = unmatchedRowsHtml(unmatchedItems(), unreadable(), text); return; }
        const first = Math.max(0, Math.floor(tableWrap.scrollTop / ROW_HEIGHT) - 10);
        const last = Math.min(tableLines(view).length, first + Math.ceil((tableWrap.clientHeight || 600) / ROW_HEIGHT) + 20);
        body.innerHTML = datasetRowsHtml(view, first, last, ROW_HEIGHT, text);
    }
    function rowName(key: string): string {
        const row = rowOf(key);
        return row ? ((row.channels ?? 1) > 1 ? `${row.name} ch${row.ch}` : row.name) : baseName(fileOfKey(key));
    }
    /** The rows a recipe bundle is for: those the table shows through its filters, or every row not excluded. */
    function batchRows(choice: 'filtered' | 'all'): DatasetRow[] {
        return choice === 'filtered' ? visibleRows({ rows, group, value, filters, sort, excluded }, results) : rows.filter(row => !excluded.has(row.key));
    }
    function openBatch(): void {
        fpop = null; slotMenu = null; memoKey = null; baseMenu = false;
        batchChoice = filters.length ? 'filtered' : 'all';
        renderPopovers();
    }
    /** The bundle: the Recipe as it runs (per channel when the rows are channels), targets.csv, run_recipe.py, README. */
    function exportBatch(): void {
        const choice = (screen.querySelector<HTMLInputElement>('[data-entry-batch-scope]:checked')?.value as 'filtered' | 'all' | undefined) ?? batchChoice ?? 'all';
        const recipe = runRecipe() ?? standardRecipe;
        if (!recipe || broken()) { deps.announce(strings.entryChainBroken); return; }
        const targets = batchRows(choice);
        const idColumn = csv && csv.idColumn && csv.idColumn !== csv.audioColumn ? csv.idColumn : undefined;
        // The Web host lists a picked folder as /sources/<name>: the README then asks for the folder instead.
        const runRoot = rootPath.startsWith('/sources/') ? '' : rootPath;
        const { folder, files } = batchBundle({ recipe, recipeName: strings.stepRecipeName, rows: targets, allRows: rows, rootPath, runRoot, idColumn, now: new Date() });
        closePopovers();
        deps.saveFolder?.(folder, files);
        deps.announce(strings.dsBatchSaved.replace('{n}', String(batchCount(targets).recordings)).replace('{folder}', folder));
    }
    function sessionOf(): Record<string, unknown> {
        return {
            version: 1, value, group, filters, sort, baseGroup, slots, memo: [...memo], excluded: [...excluded], derived,
            ...(editedRecipe ? { recipe: editedRecipe } : {}),
        };
    }
    function scheduleSessionSave(): void {
        if (!sessionLoaded || sessionTimer !== undefined) return;
        sessionTimer = window.setTimeout(() => {
            sessionTimer = undefined;
            const session = sessionOf();
            const text = JSON.stringify(session);
            if (text === savedSession && csvToSave === undefined) return;
            savedSession = text;
            deps.post({ type: 'entry-save-session', rootPath, session, ...(csvToSave !== undefined ? { csv: csvToSave } : {}) });
            csvToSave = undefined;
        }, SESSION_SAVE_MS);
    }
    /** The stored session, as it came back at open: anything that no longer fits these files is left out. */
    function applySession(session: Record<string, unknown> | undefined, stored: { name: string; text: string } | undefined): void {
        if (stored) {
            try { applyCsv(readDatasetCsv(new TextEncoder().encode(stored.text), stored.name)); } catch { /* A CSV that no longer reads is dropped. */ }
        }
        if (!session || session['version'] !== 1) return;
        const files = new Set(filePaths);
        const keyOk = (key: unknown): key is string => typeof key === 'string' && files.has(fileOfKey(key));
        if (typeof session['value'] === 'string') value = session['value'] as ValueId;
        if (typeof session['group'] === 'string') group = session['group'] as GroupId;
        if (Array.isArray(session['filters'])) filters = (session['filters'] as DatasetFilter[]).filter(filter => !!filter && typeof filter.column === 'string' && (filter.kind === 'values' ? Array.isArray(filter.values) : filter.kind === 'range' && typeof filter.low === 'number' && typeof filter.high === 'number'));
        const savedSort = session['sort'] as DatasetScreenView['sort'] | undefined;
        if (savedSort && ['name', 'ch', 'group', 'value'].includes(savedSort.column)) sort = { column: savedSort.column, descending: !!savedSort.descending };
        baseGroup = typeof session['baseGroup'] === 'string' ? session['baseGroup'] : null;
        if (Array.isArray(session['slots'])) { slots = [0, 1, 2, 3].map(slot => { const key = (session['slots'] as unknown[])[slot]; return keyOk(key) ? key : null; }); deps.saveSlots(slots); }
        memo.clear();
        if (Array.isArray(session['memo'])) for (const item of session['memo'] as unknown[]) if (Array.isArray(item) && keyOk(item[0]) && typeof item[1] === 'string') memo.set(item[0], item[1]);
        excluded.clear();
        if (Array.isArray(session['excluded'])) for (const key of session['excluded'] as unknown[]) if (keyOk(key)) excluded.add(key);
        if (Array.isArray(session['derived'])) { derived = (session['derived'] as DerivedRow[]).filter(row => !!row && files.has(row.parentPath) && !!row.result && !!row.base); deps.saveDerived?.(derived); }
        // A chain saved with the session is the one its stored values are of: they are asked for again under it.
        const recipe = session['recipe'];
        if (isRecipeChain(recipe) && recipeKey(recipe) !== recipeKey(editedRecipe ?? undefined)) { editedRecipe = recipe; deps.saveRecipe?.(recipe); loadStored(); }
    }
    /** The slotted row of a file the comparison shows (slots 1–3 first, then 0). */
    function slotRowOf(filePath: string): DatasetRow | undefined {
        const key = [1, 2, 3, 0].map(slot => slots[slot]).find(item => item && fileOfKey(item) === filePath);
        return rowOf(key ?? null);
    }
    /** A channel row of a recording of several channels is compared as that channel; otherwise the channels together. */
    const channelOfRow = (row: DatasetRow | undefined): number | null => (row && (row.channels ?? 1) > 1 ? row.ch : null);
    const chipText = (filter: DatasetFilter): string => filterChipText(filter, columnLabel, formatColumn, text);
    /**
     * What `comparePath` is measured against: the slot-0 recording (its channel when it is a channel row), else
     * the median of a group (the one chosen on the base chip, else the compared row's) over the table's filters
     * (not the value's own range), of the compared row's channel: recordings without it are left out and said.
     */
    function resolveBase(comparePath: string, byGroup = false): { paths: string[]; title: string; definition: BaseDefinition; channel: number | null } {
        const compareRow = slotRowOf(comparePath) ?? rows.find(row => row.filePath === comparePath);
        const channel = channelOfRow(compareRow);
        const narrowedBy = filters.filter(filter => filter.column !== value).map(chipText);
        const within = narrowedBy.length ? strings.dsBaseNarrowed.replace('{filters}', narrowedBy.join('・')) : '';
        if (slots[0] && !byGroup) {
            const row = rowOf(slots[0]);
            const ch = channelOfRow(row);
            return {
                paths: [fileOfKey(slots[0])], title: `${strings.entryBase} · ${rowName(slots[0])}`, channel: ch,
                definition: { kind: 'file', file: rowName(slots[0]), count: 1, channel: ch, filters: narrowedBy, fewerChannels: 0 },
            };
        }
        const name = group === 'none' ? '' : baseGroup ?? (compareRow ? datasetGroupOf(compareRow, group) : '');
        // The other compared recordings (slots 1–3) are compared themselves: not part of anyone's base.
        const compared = new Set(slots.slice(1).filter((key): key is string => !!key).map(fileOfKey));
        const { paths, fewerChannels } = baseGroupMembers(distributionPool().filter(row => row.filePath === comparePath || !compared.has(row.filePath)), comparePath, group, name, channel);
        const where = group === 'none' ? strings.dsDistAll : `${groupLabel(group)} ${name || '—'}`;
        const title = `${strings.entryBaseGroup} ${where} · ${strings.entryBaseMedian.replace('{count}', String(paths.length))}${channel ? ` · ${strings.dsCh}${channel}` : ''}`
            + (fewerChannels ? strings.dsBaseFewer.replace('{n}', String(fewerChannels)).replace('{ch}', String(channel)) : '') + within;
        return {
            paths, title, channel,
            definition: { kind: 'group', group: { column: group === 'none' ? '' : groupLabel(group), name }, count: paths.length, channel, filters: narrowedBy, fewerChannels },
        };
    }
    /** The channel a file is drawn and measured with in the comparison of `comparePath`. */
    function stageChannel(path: string, comparePath: string | null, byGroup = false): number | null {
        if (comparePath && path !== comparePath) {
            const base = resolveBase(comparePath, byGroup);
            if (base.paths.includes(path)) return base.channel;
        }
        return channelOfRow(slotRowOf(path));
    }
    /** The comparison of `comparePath` with its base, each file as the channel it is compared as. */
    function comparisonOf(comparePath: string, byGroup = false, over?: ReadonlyMap<string, ScanResult>, entryRegionBase = false): CompareModel {
        const base = resolveBase(comparePath, byGroup);
        const source = over ?? results;
        const picked = new Map(source);
        const pick = (path: string, ch: number | null): void => { if (ch) picked.set(path, channelResult(source.get(path), ch)!); };
        pick(comparePath, channelOfRow(slotRowOf(comparePath)));
        for (const path of base.paths) pick(path, base.channel);
        const single = slots[0] && !byGroup ? fileOfKey(slots[0]) : null;
        return buildCompareModel(entryModel(), picked, comparePath, single, strings, entryRegionBase, undefined, single ? undefined : { paths: base.paths, title: base.title });
    }
    /** A compared file as the comparison names it: its name and channel, the value on show, its memo. */
    function rowInfo(path: string): { label: string; value: string; memo: string } {
        const row = slotRowOf(path) ?? rows.find(item => item.filePath === path);
        if (!row) return { label: baseName(path), value: '', memo: '' };
        const number = usable(row) ? valueOf(row, value, results) : null;
        return { label: rowName(row.key), value: number === null ? '' : `${valueLabel(value)} ${formatColumn(value, number)}`, memo: memo.get(row.key) ?? '' };
    }
    function removeDerived(parentPath: string, region: string, baseLabel?: string): void {
        derived = derived.filter(item => item.parentPath !== parentPath || item.region !== region || (baseLabel !== undefined && (item.base.label ?? '') !== baseLabel));
        deps.saveDerived?.(derived);
        rebuild();
    }
    /** The differences fixed on a row (D), under it: their Δ of the value on show when it is Leq or a band. */
    function derivedItems(row: DatasetRow): DerivedItem[] {
        return derived.filter(item => item.parentPath === row.filePath && (item.ch ? item.ch === row.ch : row.ch === 1)).map(item => {
            const result = item.result;
            let delta: number | null = null;
            if (result.ok && value === 'leq' && result.leqDbA?.length) delta = powerMeanDb(result.leqDbA) - item.base.leq;
            else if (result.ok && value.startsWith('band:')) {
                const band = Number(value.slice(5));
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
    /** Slot 0 empty: the base is the median of a group (by the table's grouping): the one chosen, else slot 1's. */
    function baseText(): string {
        if (slots[0]) return rowName(slots[0]);
        if (slots[1]) return resolveBase(fileOfKey(slots[1])).title;
        const name = baseGroupName();
        if (name === null) return strings.entryBaseGroup;
        const members = baseMembers(name).filter(item => item.key !== slots[1]);
        return `${groupLabel(group)} ${name || '—'} · ${strings.entryBaseMedian.replace('{count}', String(members.length))}`;
    }
    /** The group whose median is the base: the one chosen, else slot 1's (slot 0 empty, a grouping chosen). */
    function baseGroupName(): string | null {
        if (slots[0] || group === 'none') return null;
        if (baseGroup !== null) return baseGroup;
        const anchor = rowOf(slots[1]);
        return anchor ? datasetGroupOf(anchor, group) : null;
    }
    /** A group's rows (the table's grouping, its filters and exclusions applied, not the range on the value). */
    function baseMembers(name: string): DatasetRow[] {
        return distributionPool().filter(item => datasetGroupOf(item, group) === name);
    }
    /** The rows the distribution draws from: not excluded, through every filter but the one on the value itself. */
    function distributionPool(): DatasetRow[] {
        pool ??= filteredRows({ rows, filters: filters.filter(filter => filter.column !== value), excluded }, results);
        return pool;
    }
    /** The range picked on the value drawn: it marks the distribution and narrows the table. */
    function valueRange(): { low: number; high: number } | null {
        const filter = filters.find(item => item.column === value);
        return filter?.kind === 'range' ? { low: filter.low, high: filter.high } : null;
    }
    /** A computed value counts only when it is of the current chain. */
    const usable = (row: DatasetRow): boolean => !isComputed(value) || (results.has(row.filePath) && !isStale(row.filePath));
    /** 「計算」 for the rows on screen without a value of this chain; while it runs, its progress and 中止. */
    function renderCompute(view: DatasetScreenView): void {
        let html = '';
        // Reading the headers (channels) comes first; it is quick but a large folder takes a moment, and it can be stopped.
        if (probing) html += `<span class="awa-tag" data-entry-probing>${escapeHtml(strings.dsProbing.replace('{done}', String(probing.done)).replace('{n}', String(probing.total)))}</span>`
            + `<button type="button" data-action="entry-probe-cancel">${escapeHtml(strings.entryScanCancel)}</button>`;
        if (scanning) {
            html += `<span class="awa-tag" data-entry-progress>${escapeHtml(strings.dsComputing.replace('{done}', String(scanCount)).replace('{n}', String(computingFiles)))}</span>`
                + `<button type="button" data-action="entry-compute-cancel">${escapeHtml(strings.entryScanCancel)}</button>`;
        } else if (broken()) {
            html += `<span class="awa-tag entry-stale-tag is-broken">${escapeHtml(strings.entryChainBroken)}</span>`;
        } else {
            const pending = computeTargets();
            if (pending.length) {
                const minutes = estimateMs(pending) / 60000;
                const estimate = minutes >= 1 ? strings.entryMinutes.replace('{n}', String(Math.ceil(minutes))) : strings.entrySeconds.replace('{n}', String(Math.max(1, Math.ceil(minutes * 60))));
                // Some rows have the value: the rest is said in channels and offered (never started by itself).
                const pool = isComputed(value) ? distributionPool() : view.rows;
                const missing = pool.filter(row => !usable(row)).length;
                const partial = isComputed(value) && missing < pool.length;
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
        const pool = isComputed(value) ? distributionPool() : mode === 'all' ? shownRows : visibleRows({ rows, group, value, filters, sort, excluded }, results);
        return [...new Set(pool.map(row => row.filePath))].filter(path => !results.has(path) || isStale(path));
    }
    /** The folder's sample rate, kept when a new Recipe clears the results so its steps are still checked against it. */
    let knownRate: number | undefined;
    function sampleRate(): number | undefined {
        for (const result of results.values()) if (result.ok) return knownRate = result.input!.fs;
        return knownRate;
    }
    /** Samples in the shortest scanned file, kept across a new Recipe like the sample rate. */
    let knownShortest: number | undefined;
    function shortestSamples(): number | undefined {
        let shortest: number | undefined;
        for (const result of results.values()) {
            if (!result.ok) continue;
            const samples = Math.floor(result.input!.durationS * result.input!.fs);
            shortest = shortest === undefined ? samples : Math.min(shortest, samples);
        }
        if (shortest !== undefined) knownShortest = shortest;
        return knownShortest;
    }
    function limits() {
        return stepLimits({ sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed });
    }
    /** The fewest channels of the scanned files, which a channel index must stay below. */
    function channelCount(): number | undefined {
        let fewest: number | undefined;
        for (const result of results.values()) if (result.ok) fewest = Math.min(fewest ?? Infinity, result.input!.channels.length);
        return fewest;
    }
    /** The Recipe the scans run; undefined is the host's own, unchanged (nothing edited, no step left out). */
    function runRecipe(): RecipeDocument | undefined {
        const recipe = editedRecipe ?? (Object.keys(failed).length ? standardRecipe : null);
        return recipe ? runnableRecipe(recipe, limits()) : undefined;
    }
    function compareData(stage?: string): CompareData {
        return { model: entryModel(), results, slots: slotFiles(), recipe: editedRecipe ?? standardRecipe, runRecipe: runRecipe(), failed, stale: stalePaths(), ...(stage ? { stage } : {}) };
    }
    /**
     * A step that failed on a file breaks the chain (⚠ on its chip and on every step after it): the computation
     * stops and the table keeps its values until the steps change; a step already marked, or one this Recipe does
     * not have, changes nothing.
     */
    function stepFailed(step: string, reason: string): void {
        const recipe = editedRecipe ?? standardRecipe;
        const known = recipe && (recipe as unknown as { nodes?: Array<{ id: string }> }).nodes?.some(node => node.id === step);
        if (!known || failed[step] !== undefined) return;
        failed = { ...failed, [step]: reason };
        if (scanning) { deps.post({ type: 'entry-scan-cancel' }); scanning = false; }
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
        return { ...row, result, base: { ...row.base, ...base }, recipeKey: recipeKey(runRecipe()), stale: false };
    }
    /**
     * Fixed differences of an earlier chain, measured again after a computation the user started (never at open);
     * one over a region whose base is a large group stays ≠ rather than scanning that group unasked.
     */
    function remeasureStale(): void {
        if (broken()) return;
        derived.forEach(row => {
            if (!row.stale || !row.base.paths?.length) return;
            if (row.region !== 'all' && (row.base.paths.length > LARGE_BASE || row.base.paths.reduce((sum, path) => sum + (durationOf(path) ?? UNKNOWN_DURATION_S), 0) > LARGE_BASE_S)) return;
            if (row.region === 'all') {
                const next = remeasured(row, results);
                if (next) derived = derived.map(item => (item === row ? next : item));
                return;
            }
            const [start, end] = row.region.split('–').map(Number);
            const recipe = runRecipe();
            const id = `derived-${++requestCount}`;
            remeasuring.ask(id, id, derivedKey(row), { row, results: new Map() }, () => deps.post({ type: 'compare-scan', requestId: id, filePaths: [row.parentPath, ...row.base.paths!], region: { start, end }, ...(recipe ? { recipe } : {}) }));
        });
        deps.saveDerived?.(derived);
    }
    /**
     * Holding a step chip on the entry table shows what the step does to one row (the focused one, else
     * slot 1) in the distribution's frame: its average spectrum, its 1/3-octave levels, or, for a step of the time
     * signal, the spectrum without it − with it. The pictures come as the steps view's do (stageSource, the
     * Frame's full resolution once zoomed) and are drawn by its painter. Released, it goes 150 ms later.
     */
    let stepHeld: { step: RecipeStep; path: string } | null = null;
    let stepRelease: number | undefined;
    const holdSource = createStageSource('entry-hold', message => deps.post(message), () => scheduleSide());
    const holdDetail = createDetailPlanner(window.performance, window, () => scheduleSide());
    function holdStep(step: RecipeStep | null): void {
        if (!step) {
            stepRelease = window.setTimeout(() => { stepRelease = undefined; stepHeld = null; scheduleSide(); }, DELTA_RELEASE_MS);
            return;
        }
        if (stepRelease !== undefined) { window.clearTimeout(stepRelease); stepRelease = undefined; }
        const path = focusedFile() ?? slotFiles()[1];
        if (!path || !results.get(path)?.ok) { document.getElementById('hint-footer')?.replaceChildren(strings.stepHeldNoRow); return; }
        stepHeld = { step, path };
        scheduleSide();
    }
    /** The step `id`'s picture under `recipe` (the whole file, as the table scans it). */
    function holdSpec(recipe: RecipeDocument, id: string): StageSpec {
        return { key: `hold|${recipeKey(recipe)}|${id}`, message: { recipe, stage: id } };
    }
    /** The specs a held step draws from: its own picture (the average spectrum), or the chain's end with and without it. */
    function heldSpecs(step: RecipeStep): { with: StageSpec; without?: StageSpec } | null {
        const recipe = runRecipe() ?? editedRecipe ?? standardRecipe;
        if (!recipe) return null;
        if (step.name === 'welch') return { with: holdSpec(recipe, step.id) };
        const end = recipeSteps(recipe, limits()).filter(item => item.invalid === undefined).at(-1)?.id;
        const without = end ? recipeWithout(recipe, step.id, end, limits()) : null;
        return end && without ? { with: holdSpec(recipe, end), without: holdSpec(without, end) } : null;
    }
    /** The held plot's picture and what it was drawn on, for its readout and an axis's range. */
    function paintHeldView(view: StageView | null, picture: StageView | null, range: PaneRange, axes: StageAxes, window: PlotWindow, options: { diff?: boolean; color: string; empty?: string }): void {
        heldPlot = picture ? { margins: STAGE_MARGINS, x: f => axisValueAt(picture, f), ofX: value => axisFractionOf(picture, value), range, xLabel: axes.x, yLabel: axes.y } : null;
        paintOverlay(heldCanvas, { layers: view ? [{ view, color: options.color, width: 2 }] : [] }, narrowed(range, window), axes,
            { diff: options.diff, empty: options.empty ?? '', window: { x: window.x }, axisView: picture });
    }
    function paintStepHeld(): void {
        const { step, path } = stepHeld!;
        held.hidden = false;
        const row = buildCompareModel(entryModel(), results, path, null, strings);
        const input = results.get(path)?.input;
        const name = step.name === 'welch' ? strings.stepAverage : step.id === OCTAVE_BRANCH ? strings.stepOctave : strings.stepHeldWithout.replace('{step}', stepChipLabel(step, strings));
        heldTitle.textContent = strings.stepHeldRow.replace('{what}', name).replace('{file}', baseName(path));
        held.classList.remove('is-pending');
        const window = keepWindow('held', step.id);
        if (step.id === OCTAVE_BRANCH) {
            // The app's bands, from the table's own scan.
            const bands = sideView(row.compare, row.frequencies, true);
            paintHeldView(bands, bands, stageRange([bands]), stageAxes(strings, bands, input), window, { color: ROLE_COLORS[1] });
            return;
        }
        const specs = heldSpecs(step);
        const waiting = !!specs && [specs.with, specs.without].some(spec => spec && holdSource.ensure(spec, [path]));
        const coarse = specs ? holdSource.view(specs.with, path) ?? null : null;
        const coarseWithout = specs?.without ? holdSource.view(specs.without, path) ?? null : null;
        if (!specs || waiting || !coarse || (specs.without && !coarseWithout)) {
            if (waiting) { held.classList.add('is-pending'); heldTitle.textContent += ` · ${strings.comparePending}`; }
            paintHeldView(null, null, { min: 0, max: 1 }, stageAxes(strings, null, input), window, { color: ROLE_COLORS[1], empty: waiting ? '' : strings.stepNotDrawable.replace('{frame}', coarse?.frame ?? '') });
            return;
        }
        // Zoomed, from the Frame's full resolution once it is in (the coarse picture until then).
        const fine = (spec: StageSpec): StageView | null => {
            if (coarse.kind === 'bar' || coarse.kind === 'none') return null;
            const detail = holdDetail.spec(spec, coarse, window.x, window.y, heldCanvas.clientWidth || 300);
            return detail && !holdSource.ensure(detail, [path]) ? holdSource.view(detail, path) ?? null : null;
        };
        if (!specs.without) {
            paintHeldView(fine(specs.with) ?? coarse, coarse, stageRange([coarse]), stageAxes(strings, coarse, input), window, { color: ROLE_COLORS[1] });
            return;
        }
        // Without the step − with it, point by point: what the step takes away (negative where it cuts).
        const delta = stageDifference(coarse, coarseWithout);
        const fineWith = fine(specs.with), fineWithout = fine(specs.without);
        const shown = fineWith && fineWithout ? stageDifference(fineWith, fineWithout) ?? delta : delta;
        paintHeldView(shown, delta, stageDiffRange(delta), stageAxes(strings, delta, input, true), window, { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta });
    }
    function handleRemeasure(publication: ComparePublication): boolean {
        const pending = remeasuring.find(publication.requestId)?.meta;
        if (!pending) return false;
        if (publication.type === 'compare-scan-result') { pending.results.set(publication.filePath, publication.result); return true; }
        remeasuring.settle(publication.requestId);
        const next = remeasured(pending.row, pending.results);
        if (next) { derived = derived.map(item => (item === pending.row ? next : item)); deps.saveDerived?.(derived); rebuild(); }
        return true;
    }
    /** A hold shows something on this screen for a step of the chain's time signal (not the region), its spectrum, and the app's bands. */
    function canHoldStep(step: RecipeStep): boolean {
        if (step.operation === TIME_SLICE) return false;
        if (step.id === OCTAVE_BRANCH) return true;
        const recipe = editedRecipe ?? standardRecipe;
        if (!recipe) return false;
        const steps = (recipe as unknown as { nodes: Array<{ id: string }> }).nodes.map(node => node.id);
        const signal = timeSignalStep(recipe, limits());
        // The average spectrum the table reads (the chain's end), or a step up to the time signal.
        if (step.name === 'welch') return spectral();
        return !!signal && steps.indexOf(step.id) <= steps.indexOf(signal.id);
    }
    function setRecipe(recipe: RecipeDocument): void {
        editedRecipe = recipe;
        // A new Recipe is tried whole again: a step that failed under the old one may not now.
        failed = {};
        deps.saveRecipe?.(recipe);
        // The folder is not scanned again by itself: the table keeps the previous chain's values, greyed,
        // until "Scan all"; the focused row and the comparison's files are measured at once.
        if (scanning) { deps.post({ type: 'entry-scan-cancel' }); scanning = false; }
        // The row on screen keeps the focus: re-sorted by its new value, the top row would take it and be measured next, and so on down the folder.
        if (focused) focusPicked = true;
        // Differences fixed under another Recipe stay, marked ≠ until measured again under this one
        // (after the scan); one fixed under this very Recipe needs nothing.
        const key = recipeKey(runRecipe());
        derived = derived.map(row => ({ ...row, stale: row.recipeKey !== key }));
        deps.saveDerived?.(derived);
        rebuild();
    }
    /** Whether the next side paint draws the distribution again; scrolling the table moves only the strip's window. */
    let distPending = true;
    function scheduleSide(distribution = true): void {
        distPending ||= distribution;
        if (sidePending) return;
        sidePending = true;
        window.requestAnimationFrame(() => { sidePending = false; paintSide(); });
    }
    /** The held row's Δ spectrum (from the table's own scan), zoomed as its window says. */
    function paintHeldDelta(comparison: CompareModel, key: string, input: { unit?: string; ref?: number } | undefined): void {
        const window = keepWindow('held', `delta|${key}`);
        const delta = comparison.diffDb ? sideView({ spectrumDb: comparison.diffDb, bands: [] }, comparison.frequencies) : null;
        paintHeldView(delta, delta, stageDiffRange(delta), stageAxes(strings, delta, input, true), window, { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta });
    }
    /**
     * The distribution of the value over the groups: on the right while choosing, folded above the table (low
     * rows, two in view) while a comparison is open. Rows without the value are counted, not drawn.
     */
    function paintDistribution(): void {
        if (screen.hidden) return;
        const pool = distributionPool();
        const range = valueRange();
        const dist = distribution(pool, value, group, results, range, usable);
        lastDistribution = dist;
        const drawn = dist.groups.reduce((sum, item) => sum + item.members.length, 0);
        const strip = !maximized;
        const unit = dist.unit === 'ch' ? strings.dsCh : strings.dsUnitRecording;
        const labels = groupLabels(dist.groups.map(item => item.name));
        if (group === 'none') labels.set('', strings.dsDistAll);
        const prefix = group === 'ch' ? `${strings.dsCh} ` : '';
        distCount.textContent = drawn
            ? `${drawn.toLocaleString()} ${unit}${dist.groups.length > 4 ? ` · ${strings.dsDistGroups.replace('{n}', String(dist.groups.length))}` : ''}`
            : strings.dsRows.replace('{n}', pool.length.toLocaleString());
        // The legend: what the coloured ticks are (only the slots carry colour).
        const base = baseGroupName();
        const swatch = (slot: number, dashed = false): string => `<span class="entry-dist-swatch slot-${slot}${dashed ? ' is-dashed' : ''}"></span>`;
        const legend = drawn ? [
            slots[0] ? `${swatch(0)}${escapeHtml(strings.entryBase)}` : base !== null ? `${swatch(0, true)}${escapeHtml(strings.dsLegendBaseMedian.replace('{group}', `${prefix}${labels.get(base) ?? base}`))}` : '',
            ...[1, 2, 3].filter(slot => slots[slot]).map(slot => `${swatch(slot)}${escapeHtml(strings.dsSlotCompare.replace('{n}', String(slot)))}`),
        ].filter(Boolean).map(item => `<span class="entry-dist-key">${item}</span>`).join('') : '';
        if (distLegend.innerHTML !== legend) distLegend.innerHTML = legend;
        distNote.textContent = drawn && !range && !strip ? strings.dsDistDrag : '';
        distBox.dataset.groups = String(dist.groups.length);
        distBox.dataset.drawn = String(drawn);
        distBox.dataset.missing = String(dist.missing);
        distBox.dataset.unit = dist.unit;
        if (!drawn) {
            distGroups.innerHTML = ''; distAxis.innerHTML = ''; distScale = null;
            // Folded beside the tracks, nothing drawn says nothing: 「計算」 in the head is the way on.
            distEmpty.hidden = strip;
            distEmpty.textContent = isComputed(value) && dist.missing ? strings.dsDistNotComputed.replace('{value}', valueLabel(value)) : strings.dsDistEmpty;
            return;
        }
        distEmpty.hidden = true;
        // On the right the groups share the height (taller bars read better); above the table they stay low.
        const available = Math.max(0, distArea.clientHeight - distGroups.offsetTop - DIST_AXIS_SPACE);
        const rowHeight = strip ? DIST_STRIP_ROW : Math.max(DIST_ROW_MIN, Math.min(DIST_ROW_MAX, Math.floor(available / dist.groups.length)));
        distGroups.style.maxHeight = `${strip ? 2 * DIST_STRIP_ROW + 8 : Math.max(available, 2 * DIST_ROW_MIN)}px`;
        const width = Math.max(240, distGroups.clientWidth || distBox.clientWidth || 400);
        const keys = new Set(pool.map(row => row.key));
        const slotted = slots.flatMap((key, slot) => {
            const row = rowOf(key);
            const number = row && keys.has(row.key) && usable(row) ? valueOf(row, value, results) : null;
            return row && number !== null ? [{ slot, key: row.key, group: datasetGroupOf(row, group), value: number }] : [];
        });
        const picture = distributionSvg(dist, {
            width, rowHeight, strip, range, slots: slotted, baseGroup: base, labels, groupPrefix: prefix, unitLabel: unit,
            axisLabel: value.startsWith('csv:') ? strings.dsDistCsvAxis.replace('{col}', value.slice(4)) : valueLabel(value),
            format: number => formatColumn(value, number), name: key => rowName(key),
        }, strings);
        distScale = picture.scale;
        distGroups.innerHTML = picture.plot;
        distAxis.innerHTML = picture.axis;
        if (strip && stripToSlot) {
            stripToSlot = false;
            const compared = slotted.find(item => item.slot > 0) ?? slotted[0];
            const index = compared ? dist.groups.findIndex(item => item.name === compared.group) : -1;
            if (index >= 0) distGroups.scrollTop = Math.max(0, index * rowHeight - 4);
        }
    }
    /** The distribution, the held row's Δ spectrum and the overview strip. */
    function paintSide(): void {
        if (distPending) { distPending = false; paintDistribution(); }
        // The side plots are drawn only while the table is wide enough to show them.
        if (screen.hidden || !side.offsetWidth) return;
        // The strip is the table's rows in the table's order (one per channel), each its recording's bands.
        const rowsOnScreen = shownRows;
        const rowHeight = (body.querySelector('tr') as HTMLElement | null)?.offsetHeight || 22;
        const first = Math.floor(tableWrap.scrollTop / rowHeight);
        paintOverview(overview, rowsOnScreen, overviewLevels, { first, last: first + Math.ceil(tableWrap.clientHeight / rowHeight) - 2 }, focusedFile(), keepWindow('overview', String(rowsOnScreen.length)),
            calibratedFiles.size > 0, overviewVersion);
        // The zoom on each plot, for tests: "x0-x1|y0-y1".
        for (const [name, canvas] of [['overview', overview], ['held', heldCanvas]] as const) {
            const window = plotWindow(name);
            canvas.dataset.window = `${window.x.start.toFixed(3)}-${window.x.end.toFixed(3)}|${window.y.start.toFixed(3)}-${window.y.end.toFixed(3)}`;
        }
        if (stepHeld) { paintStepHeld(); return; }
        held.hidden = heldSlot === null;
        held.classList.remove('is-pending');
        if (heldSlot !== null) {
            const path = slotFiles()[heldSlot] ?? focusedFile();
            const comparison = buildCompareModel(entryModel(), results, path, null, strings);
            heldTitle.textContent = path ? `${heldSlot} · ${baseName(path)}` : '';
            paintHeldDelta(comparison, `slot|${heldSlot}`, path ? results.get(path)?.input : undefined);
        }
    }

    function press(slot: number): void {
        if (pressing) return;
        const timer = window.setTimeout(() => {
            if (heldTimer !== undefined) { window.clearTimeout(heldTimer); heldTimer = undefined; }
            heldSlot = slot;
            slotBar.innerHTML = entrySlotsHtml(slots, key => rowName(key), baseText(), text, heldSlot);
            scheduleSide();
        }, TAP_MS);
        pressing = { slot, at: window.performance.now(), timer };
    }
    /** A tap puts the focused row in the slot (in it already: takes it out); a hold only showed the slot's Δ, which goes 150 ms later. */
    function release(slot: number): void {
        if (!pressing || pressing.slot !== slot) return;
        window.clearTimeout(pressing.timer);
        const tapped = window.performance.now() - pressing.at < TAP_MS;
        pressing = undefined;
        if (tapped) { if (focused && rows.some(row => row.key === focused)) setSlot(slot, focused); return; }
        heldTimer = window.setTimeout(() => { heldTimer = undefined; heldSlot = null; scheduleSide(); }, DELTA_RELEASE_MS);
    }

    /** Puts a row in a slot (out of any other); the same row again takes it out. The comparison open follows, and stays open. */
    function setSlot(slot: number, key: string | null, follow = true): void {
        const before = slotFiles();
        const next = slots.map(item => (item === key ? null : item));
        if (slot >= 0) next[slot] = slots[slot] === key ? null : key;
        slots = next;
        deps.saveSlots(slots);
        // The tracks follow the slots: a slotted file is shown, a file that leaves every slot leaves the tracks.
        if (follow) {
            const after = slotFiles();
            for (const path of after) if (path && !before.includes(path)) deps.setShown?.(path, true);
            for (const path of before) if (path && !after.includes(path)) deps.setShown?.(path, false);
        }
        render();
        if (!maximized) deps.compareChanged?.();
    }
    /** 「計算」: the value for the rows on screen that have none of this chain, slotted rows first. */
    function compute(): void {
        if (broken()) return;
        const pending = computeTargets();
        if (!pending.length) return;
        const slotted = pending.filter(path => slotFiles().includes(path));
        const { requestId } = requests.ask('scan', `entry-${++requestCount}`, currentKey(), undefined);
        scanning = true;
        scanStarted = window.performance.now();
        scanCount = 0;
        scannedSeconds = 0;
        computingFiles = pending.length;
        const recipe = runRecipe();
        deps.post({ type: 'entry-scan', requestId, rootPath, filePaths: [...slotted, ...pending.filter(path => !slotted.includes(path))], ...(recipe ? { recipe } : {}) });
        render();
    }
    /** The results stored for this chain come back without computing anything. */
    function loadStored(): void {
        const recipe = runRecipe();
        requests.ask('scan', `entry-${++requestCount}`, currentKey(), undefined, ({ requestId }) => deps.post({ type: 'entry-scan', requestId, rootPath, filePaths, cachedOnly: true, ...(recipe ? { recipe } : {}) }));
    }
    /** Reads the files' headers for their channels, so rows split by channel before anything is computed. */
    function probe(paths: readonly string[]): void {
        const pending = paths.filter(path => !headerChannels.has(path) && !headerErrors.has(path));
        if (!pending.length) return;
        const requestId = `probe-${++requestCount}`;
        probing = { requestId, done: 0, total: pending.length };
        deps.post({ type: 'entry-probe', requestId, filePaths: [...pending] });
    }
    function cancelProbe(): void {
        if (!probing) return;
        deps.post({ type: 'entry-probe-cancel' });
        probing = null;
        render();
    }
    /** 中止: what was computed stays; the rest keeps no value until computed. */
    function cancelCompute(): void {
        if (!scanning) return;
        deps.post({ type: 'entry-scan-cancel' });
        scanning = false;
        requests.settle(requests.pending('scan')?.requestId ?? '');
        rebuild();
    }
    /** Moves the focus to a row and brings it on screen (the rows are drawn only where they are seen). */
    function focusRow(key: string | null, center = false): void {
        if (!key) return;
        focused = key;
        focusPicked = true;
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
        if (!shownRows.some(row => row.key === key)) { mode = 'all'; filters = []; rebuild(); }
        focusRow(key, true);
    }
    function moveFocus(step: number): void {
        if (!shownRows.length) return;
        const index = focused ? shownRows.findIndex(row => row.key === focused) : -1;
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
            if (columns >= 6) scheduleSide();
        }
    }
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) new Observer(() => { syncColumns(); renderRows(); }).observe(screen);
    /** Choosing, the distribution fills the right side; while a comparison is open it folds above the table. */
    function placeDistribution(): void {
        if (maximized) { if (distBox.parentElement !== distArea) distArea.prepend(distBox); }
        else if (distBox.nextElementSibling !== entryBody) entryBody.before(distBox);
        if (!maximized && !screen.classList.contains('is-dist-strip')) stripToSlot = true;
        screen.classList.toggle('is-dist-strip', !maximized);
    }
    placeDistribution();
    function setMaximized(next: boolean): void {
        if (!next) stepBar.close();
        // The table's 書き出し menu shows only maximized: it does not come back open.
        if (!next) query<HTMLDetailsElement>('#entry-export-menu').open = false;
        maximized = next;
        placeDistribution();
        screen.classList.toggle('is-max', next);
        sizeButton.textContent = next ? '⤡' : '⤢';
        sizeButton.setAttribute('aria-pressed', String(next));
        syncColumns();
        deps.maximizedChanged?.(next);
        render();
        scheduleSide();
        // Maximized, the table takes the keys; shrunk, they go back to the track view (its lanes, its comparison).
        if (next) table.focus?.();
        else if (screen.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    }
    // A double click on the bar's empty part widens or shrinks the table, like ⤢ / ⤡.
    query('.entry-bar').addEventListener('dblclick', event => {
        if ((event.target as Element).closest('button, select, input, label')) return;
        setMaximized(!maximized);
    });
    function openSlotted(stage?: string): void {
        // The comparison compares slots 1–3; slot 0 alone has nothing to compare against.
        if (!slots.slice(1).some(key => key && rows.some(row => row.key === key))) {
            deps.announce(stage ? strings.stepOpenCompare : strings.entryKeySlot);
            const first = slotBar.querySelector('[data-slot="1"]');
            first?.classList.remove('is-flash'); void (first as HTMLElement | null)?.offsetWidth; first?.classList.add('is-flash');
            return;
        }
        const chosen = slotFiles().filter((path): path is string => !!path && filePaths.includes(path));
        // The tracks are compared in the track view; the table goes back into the side panel beside them.
        setMaximized(false);
        deps.openFiles(Array.from(new Set(chosen)), compareData(stage));
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
        const had = csv !== null;
        csv = next;
        match = next ? matchCsv(next, filePaths, rootPath) : null;
        rowsDirty = true;
        filters = filters.filter(filter => !filter.column.startsWith('csv:') || !!next?.columns.includes(filter.column.slice(4)));
        // A new CSV opens on its first numeric column, grouped by its first column that is not a number.
        if (next) {
            const numeric = next.attributes.find(column => next.numeric[column]);
            if (numeric && (value.startsWith('csv:') || !results.size)) value = `csv:${numeric}`;
            const category = next.attributes.find(column => !next.numeric[column]);
            if (category && (group === 'none' || group.startsWith('csv:') || !groupOptions().some(option => option.id === group))) group = `csv:${category}`;
        } else {
            if (value.startsWith('csv:')) value = 'leq';
            if (group.startsWith('csv:')) group = 'none';
        }
        if (keep !== undefined) { deps.saveCsv?.(keep.text.length <= KEEP_CSV_BYTES ? keep : undefined); csvToSave = keep; }
        if (next === null) { deps.saveCsv?.(undefined); if (had) csvToSave = null; }
        rebuild();
    }
    function readCsvFile(file: File): void {
        void file.arrayBuffer().then(buffer => {
            const bytes = new Uint8Array(buffer);
            try {
                const read = readDatasetCsv(bytes, file.name);
                applyCsv(read, { name: file.name, text: new TextDecoder('utf-8').decode(bytes) });
                deps.announce(strings.dsCsvRead.replace('{name}', file.name).replace('{matched}', String(match?.attributes.size ?? 0)).replace('{total}', String(filePaths.length)));
            } catch (error) {
                deps.announce(strings.dsCsvError.replace('{reason}', error instanceof Error ? error.message : String(error)));
            }
        });
    }
    csvInput.addEventListener('change', () => {
        const file = csvInput.files?.[0];
        if (file) readCsvFile(file);
        csvInput.value = '';
    });

    // ---- the column filter: like a spreadsheet's ▾ (sort, clear, search + a check list or a range, OK / Cancel)
    const sortKeyOf = (column: ColumnId): DatasetScreenView['sort']['column'] | undefined => (column === 'name' ? 'name' : column === 'ch' ? 'ch' : column === group ? 'group' : column === value ? 'value' : undefined);
    function filterColumns(): DatasetColumn[] {
        const own = (csv?.attributes ?? []).map(column => ({ id: `csv:${column}` as ColumnId, label: column, numeric: !!csv?.numeric[column] }));
        const folders = groupOptions().filter(option => option.id.startsWith('folder:')).map(option => ({ id: option.id as ColumnId, label: option.label, numeric: false }));
        const computed = valueOptions().filter(option => option.computed && rows.some(row => valueOf(row, option.id, results) !== null)).map(option => ({ id: option.id as ColumnId, label: option.label, numeric: true }));
        return [{ id: 'name', label: strings.entryColFile, numeric: false }, { id: 'ch', label: strings.dsCh, numeric: false }, ...own, ...folders, ...computed];
    }
    function openFilter(column: ColumnId, anchored: boolean): void {
        slotMenu = null; memoKey = null;
        const existing = filters.find(filter => filter.column === column);
        fpop = { column, anchored, search: '', checked: existing?.kind === 'values' ? new Set(existing.values) : null };
        renderPopovers();
    }
    function popAnchor(): HTMLElement | null {
        if (fpop) return (fpop.anchored ? head.querySelector<HTMLElement>(`th[data-column="${CSS.escape(fpop.column)}"]`) : chipsBox.querySelector<HTMLElement>('[data-action="entry-fadd"]'));
        if (slotMenu) return body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(slotMenu)}"] [data-action="entry-row-slotmenu"]`);
        if (memoKey) return body.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(memoKey)}"] .entry-nm`);
        if (baseMenu) return slotBar.querySelector<HTMLElement>('[data-action="entry-slot"][data-slot="0"]');
        // The bundle is offered from the toolbar's 書き出し menu; beside the table's bar when that is not on screen.
        if (batchChoice) return maximized ? query<HTMLElement>('#entry-export-menu > summary') : document.querySelector<HTMLElement>('#tb-export-menu > summary') ?? query<HTMLElement>('.entry-bar');
        return null;
    }
    /** The open popover, drawn only when it opens or changes, so what is typed in it is kept while the table redraws. */
    function renderPopovers(): void {
        screen.querySelector('[data-entry-pop]')?.remove();
        if (!fpop && !slotMenu && !memoKey && !baseMenu && !batchChoice) return;
        const pop = document.createElement('div');
        pop.className = 'entry-pop';
        pop.setAttribute('data-entry-pop', '');
        if (fpop) {
            const column = filterColumns().find(item => item.id === fpop!.column) ?? { id: fpop.column, label: columnLabel(fpop.column), numeric: numericColumn(fpop.column) };
            const existing = filters.find(filter => filter.column === fpop!.column);
            const pool = rows.filter(row => !excluded.has(row.key));
            if (column.numeric) {
                const numbers = pool.map(row => (fpop!.column.startsWith('csv:') ? finiteNumber(row.attributes?.[fpop!.column.slice(4)] ?? '') : valueOf(row, fpop!.column as ValueId, results))).filter((item): item is number => item !== null);
                const min = numbers.length ? formatColumn(fpop.column, numbers.reduce((least, item) => Math.min(least, item))) : '', max = numbers.length ? formatColumn(fpop.column, numbers.reduce((most, item) => Math.max(most, item))) : '';
                pop.innerHTML = filterPopHtml({ column, anchored: fpop.anchored, columns: filterColumns(), sortKey: sortKeyOf(fpop.column), sort, filter: existing, search: '',
                    range: { low: existing?.kind === 'range' ? formatColumn(fpop.column, existing.low) : '', high: existing?.kind === 'range' ? formatColumn(fpop.column, existing.high) : '', min, max } }, text);
            } else {
                const values = columnValues(pool, fpop.column, results);
                fpop.checked ??= new Set(values.map(([item]) => item));
                pop.innerHTML = filterPopHtml({ column, anchored: fpop.anchored, columns: filterColumns(), sortKey: sortKeyOf(fpop.column), sort, filter: existing, search: fpop.search, values, checked: fpop.checked }, text);
            }
        } else if (slotMenu) pop.innerHTML = slotMenuHtml(slotMenu, slots, text);
        else if (memoKey) pop.innerHTML = memoPopHtml(rowName(memoKey), memo.get(memoKey) ?? '', text);
        else if (batchChoice) pop.innerHTML = batchPopHtml(batchCount(batchRows('filtered')), batchCount(batchRows('all')), batchChoice, text);
        else if (baseMenu) {
            const names = [...new Set(distributionPool().map(row => datasetGroupOf(row, group)))].sort(compareGroupNames);
            const labels = groupLabels(names);
            pop.innerHTML = baseMenuHtml(names.map(name => ({ name, label: `${groupLabel(group)} ${labels.get(name) || strings.dsFilterBlank}` })), baseGroup, !!focused, text);
        }
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
    function redrawCheckList(): void {
        if (!fpop?.checked) return;
        const list = screen.querySelector('[data-entry-flist]');
        if (list) list.innerHTML = checkListHtml(columnValues(rows.filter(row => !excluded.has(row.key)), fpop.column, results), fpop.checked, fpop.search, text);
        const all = screen.querySelector<HTMLInputElement>('[data-entry-fall]');
        if (all) all.indeterminate = all.getAttribute('aria-checked') === 'mixed';
    }
    function closePopovers(): boolean {
        if (!fpop && !slotMenu && !memoKey && !baseMenu && !batchChoice) return false;
        const hadMemo = !!memoKey;
        if (memoKey) saveMemo();
        fpop = null; slotMenu = null; memoKey = null; baseMenu = false; batchChoice = null;
        renderPopovers();
        // A memo kept shows on its row (✎ lit, its text as the hint).
        if (hadMemo) render();
        (body.querySelector<HTMLElement>('.is-focused') ?? table).focus?.();
        return true;
    }
    function applyFilter(): void {
        if (!fpop) return;
        const column = fpop.column;
        let next: DatasetFilter | null = null;
        if (numericColumn(column)) {
            const low = parseFloat(screen.querySelector<HTMLInputElement>('[data-entry-flow]')?.value ?? ''), high = parseFloat(screen.querySelector<HTMLInputElement>('[data-entry-fhigh]')?.value ?? '');
            if (!(Number.isNaN(low) && Number.isNaN(high))) {
                next = { column, kind: 'range', low: Number.isNaN(low) ? -Infinity : low, high: Number.isNaN(high) ? Infinity : high };
                if (next.low > next.high) next = { ...next, low: next.high, high: next.low };
            }
        } else {
            const all = columnValues(rows.filter(row => !excluded.has(row.key)), column, results).map(([item]) => item);
            const needle = fpop.search.trim().toLowerCase();
            const keep = all.filter(item => (!needle || item.toLowerCase().includes(needle)) && fpop!.checked?.has(item));
            if (!keep.length) { deps.announce(strings.dsFilterPickOne); return; }
            if (keep.length < all.length) next = { column, kind: 'values', values: keep };
        }
        filters = [...filters.filter(filter => filter.column !== column), ...(next ? [next] : [])];
        fpop = null;
        mode = 'all';
        tableWrap.scrollTop = 0;
        rebuild();
        renderPopovers();
        deps.announce(next ? strings.dsFilterApplied.replace('{n}', String(shownRows.length)) : strings.dsFilterRemoved.replace('{col}', columnLabel(column)));
    }
    function clearFilter(column: ColumnId): void {
        filters = filters.filter(filter => filter.column !== column);
        fpop = null;
        rebuild();
        renderPopovers();
        deps.announce(strings.dsFilterRemoved.replace('{col}', columnLabel(column)));
    }
    function setSort(column: DatasetScreenView['sort']['column'], descending: boolean): void {
        sort = { column, descending };
        fpop = null;
        tableWrap.scrollTop = 0;
        rebuild();
        renderPopovers();
    }
    function saveMemo(): void {
        if (!memoKey) return;
        const textarea = screen.querySelector<HTMLTextAreaElement>('[data-entry-memo-text]');
        if (!textarea) return;
        const note = textarea.value.trim();
        if (note) memo.set(memoKey, note); else memo.delete(memoKey);
    }
    function openMemo(key: string): void {
        fpop = null; slotMenu = null;
        memoKey = key;
        focused = key; focusPicked = true;
        renderPopovers();
    }

    const actions: Record<string, (target: HTMLElement) => void> = {
        'entry-pick-csv': () => csvInput.click(),
        'entry-view-unmatched': () => { mode = mode === 'unmatched' ? 'all' : 'unmatched'; tableWrap.scrollTop = 0; rebuild(); },
        'entry-view-excluded': () => { mode = mode === 'excluded' ? 'all' : 'excluded'; tableWrap.scrollTop = 0; rebuild(); },
        'entry-compute': () => compute(),
        'entry-compute-cancel': () => cancelCompute(),
        'entry-probe-cancel': () => cancelProbe(),
        'entry-export-csv': exportCsv,
        'entry-export-notes': () => {
            const name = csv ? csv.name.replace(/\.(csv|tsv)$/i, '') : 'recordings';
            deps.download(annotatedCsv(csv, match, filePaths, rootPath, rows, memo, excluded), `${name}-notes.csv`);
        },
        'entry-open': () => openSlotted(),
        'entry-maximize': () => setMaximized(!maximized),
        'entry-fhead': target => { const column = target.getAttribute('data-column') as ColumnId; if (fpop?.column === column) closePopovers(); else openFilter(column, true); },
        'entry-fadd': () => openFilter(filterColumns().find(column => !filters.some(filter => filter.column === column.id) && column.id !== 'name')?.id ?? 'name', false),
        'entry-fchip': target => openFilter(target.getAttribute('data-column') as ColumnId, false),
        'entry-fchip-clear': target => clearFilter(target.getAttribute('data-column') as ColumnId),
        'entry-fsort': target => setSort(target.getAttribute('data-sort') as DatasetScreenView['sort']['column'], target.getAttribute('data-descending') === 'true'),
        'entry-fclear': () => { if (fpop) clearFilter(fpop.column); },
        'entry-fok': () => applyFilter(),
        'entry-fcancel': () => closePopovers(),
        'entry-row-play': target => deps.play?.(fileOfKey(target.getAttribute('data-key')!)),
        'entry-row-slotmenu': target => { const key = target.getAttribute('data-key')!; fpop = null; memoKey = null; slotMenu = slotMenu === key ? null : key; focused = key; focusPicked = true; render(); renderPopovers(); },
        'entry-row-slot': target => { const key = target.getAttribute('data-key')!; slotMenu = null; renderPopovers(); setSlot(Number(target.getAttribute('data-slot')), key); },
        'entry-row-memo': target => openMemo(target.getAttribute('data-key')!),
        'entry-memo-close': () => { saveMemo(); memoKey = null; renderPopovers(); render(); },
        'entry-row-exclude': target => { excluded.add(target.getAttribute('data-key')!); rebuild(); },
        'entry-row-restore': target => { excluded.delete(target.getAttribute('data-key')!); if (!excluded.size) mode = 'all'; rebuild(); },
        // An empty slot takes the selected row; a filled one goes to its row (it is never overwritten by a press); × empties it.
        'entry-slot': target => {
            const slot = Number(target.getAttribute('data-slot'));
            const key = slots[slot];
            if (key) { focusFile(fileOfKey(key)); focusRow(key, true); }
            // The empty base is a group's median: its chip says which and offers the others (or the selected row).
            else if (slot === 0 && group !== 'none') { fpop = null; slotMenu = null; memoKey = null; baseMenu = !baseMenu; renderPopovers(); }
            else if (focused) setSlot(slot, focused);
        },
        'entry-base-group': target => {
            baseGroup = target.getAttribute('data-auto') === 'true' ? null : target.getAttribute('data-group') ?? '';
            baseMenu = false;
            renderPopovers();
            rebuild();
            deps.announce(baseGroup === null ? strings.dsBaseSetAuto : strings.dsBaseSet.replace('{group}', `${groupLabel(group)} ${baseGroup || strings.dsFilterBlank}`));
        },
        'entry-base-row': () => { baseMenu = false; renderPopovers(); if (focused) setSlot(0, focused); },
        'entry-batch': () => openBatch(),
        'entry-batch-go': () => exportBatch(),
        'entry-batch-cancel': () => closePopovers(),
        'entry-derived-remove': target => removeDerived(target.getAttribute('data-parent')!, target.getAttribute('data-region')!, target.getAttribute('data-base') ?? undefined),
        'entry-slot-clear': target => setSlot(Number(target.getAttribute('data-slot')), null),
        'entry-key-hint': target => { if (target.getAttribute('data-key') === 'help') deps.help?.(); },
    };
    tableWrap.addEventListener('scroll', () => { renderRows(); scheduleSide(false); });
    screen.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        const action = target.closest<HTMLElement>('[data-action]');
        // A choice in the table's 書き出し menu closes it.
        if (action?.closest('#entry-export-menu')) action.closest('details')?.removeAttribute('open');
        if (action && action.tagName !== 'SELECT' && action.tagName !== 'INPUT' && actions[action.getAttribute('data-action')!]) {
            actions[action.getAttribute('data-action')!](action);
            return;
        }
        if (target.closest('[data-entry-pop]')) return;
        const row = target.closest<HTMLElement>('tr[data-key]');
        if (row) { focused = row.getAttribute('data-key'); focusPicked = true; render(); }
    });
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
    // A press outside an open popover closes it (a memo is kept).
    document.addEventListener('pointerdown', event => {
        const target = event.target as Element;
        if (!exportMenu.contains(target)) closeExportMenu();
        if (screen.hidden || target.closest?.('[data-entry-pop], [data-action="entry-fhead"], [data-action="entry-fadd"], [data-action="entry-fchip"], [data-action="entry-row-slotmenu"], [data-action="entry-row-memo"], [data-action="entry-slot"][data-slot="0"], [data-action="entry-batch"], #tb-export-menu, #entry-export-menu')) return;
        closePopovers();
    }, true);
    screen.addEventListener('change', event => {
        const target = event.target as HTMLElement;
        if (target === valueSelect) {
            value = valueSelect.value as ValueId;
            if (sort.column === 'value') tableWrap.scrollTop = 0;
            rebuild();
            return;
        }
        if (target === groupSelect) {
            const baseBefore = baseText();
            group = groupSelect.value as GroupId;
            baseGroup = null;
            rebuild();
            // With slot 0 empty the base is slot 1's group median: a new grouping changes it, which is said.
            if (!slots[0] && slots[1] && baseText() !== baseBefore) deps.announce(strings.dsBaseReset);
            return;
        }
        if (target.matches('[data-entry-batch-scope]')) { batchChoice = (target as HTMLInputElement).value as 'filtered' | 'all'; return; }
        if (target.matches('[data-action="entry-fcol"]') && fpop) {
            const column = (target as HTMLSelectElement).value as ColumnId;
            const existing = filters.find(filter => filter.column === column);
            fpop = { column, anchored: false, search: '', checked: existing?.kind === 'values' ? new Set(existing.values) : null };
            renderPopovers();
            return;
        }
        if (target.matches('[data-entry-fall]') && fpop?.checked) {
            const needle = fpop.search.trim().toLowerCase();
            for (const [item] of columnValues(rows.filter(row => !excluded.has(row.key)), fpop.column, results)) {
                if (needle && !item.toLowerCase().includes(needle)) continue;
                if ((target as HTMLInputElement).checked) fpop.checked.add(item); else fpop.checked.delete(item);
            }
            redrawCheckList();
            return;
        }
        const item = target.getAttribute('data-entry-fvalue');
        if (item !== null && fpop?.checked) {
            if ((target as HTMLInputElement).checked) fpop.checked.add(item); else fpop.checked.delete(item);
            redrawCheckList();
        }
    });
    // The filter's search narrows the check list to what it finds, all of it checked, as a spreadsheet's does.
    screen.addEventListener('input', event => {
        const target = event.target as HTMLInputElement;
        if (!target.matches('[data-entry-fsearch]') || !fpop) return;
        fpop.search = target.value;
        const needle = fpop.search.trim().toLowerCase();
        const values = columnValues(rows.filter(row => !excluded.has(row.key)), fpop.column, results).map(([item]) => item);
        fpop.checked = new Set(needle ? values.filter(item => item.toLowerCase().includes(needle)) : values);
        redrawCheckList();
    });
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
    // A click on the strip goes to that file's row.
    overview.addEventListener('click', event => {
        const rows = shownRows;
        const box = overview.getBoundingClientRect();
        // The strip's rows (top first) over the part of it on screen.
        const window = plotWindow('overview');
        const plotTop = box.top + OVERVIEW_MARGINS.top, plotHeight = box.height - OVERVIEW_MARGINS.top - OVERVIEW_MARGINS.bottom;
        const row = rows[Math.floor(((1 - window.y.end) + (event.clientY - plotTop) / Math.max(1, plotHeight) * (window.y.end - window.y.start)) * rows.length)];
        if (!row) return;
        focusRow(row.key, true);
    });
    // A double click on a row slots it in the first free slot and opens the comparison, like 1 then Enter.
    body.addEventListener('dblclick', event => {
        const target = event.target as HTMLElement;
        const key = target.closest<HTMLElement>('tr[data-key]')?.getAttribute('data-key');
        if (!key || mode !== 'all' || target.closest('button')) return;
        if (!slots.slice(1).includes(key)) setSlot([1, 2, 3].find(slot => !slots[slot]) ?? 1, key);
        openSlotted();
    });
    // A drag on the distribution picks a range of the value (a chip, which narrows the table); a press that
    // stays put picks that bin; on a dot, it goes to that recording's row.
    let distDrag: { x0: number; left: number; moved: boolean; dot: string | null } | null = null;
    distGroups.addEventListener('pointerdown', event => {
        const plot = (event.target as Element).closest?.('[data-entry-dist-plot]');
        if (!plot || !distScale || event.button !== 0) return;
        const box = plot.getBoundingClientRect();
        distDrag = { x0: event.clientX - box.left, left: box.left, moved: false, dot: (event.target as Element).closest?.('[data-dist-dot]')?.getAttribute('data-key') ?? null };
        (plot as Element & { setPointerCapture?(id: number): void }).setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    distGroups.addEventListener('pointermove', event => {
        if (!distDrag) return;
        const x = event.clientX - distDrag.left;
        if (Math.abs(x - distDrag.x0) >= 4) distDrag.moved = true;
        const brush = distGroups.querySelector('[data-dist-brush]');
        brush?.setAttribute('x', String(Math.min(x, distDrag.x0)));
        brush?.setAttribute('width', String(Math.abs(x - distDrag.x0)));
        brush?.setAttribute('visibility', distDrag.moved ? 'visible' : 'hidden');
    });
    distGroups.addEventListener('pointerup', event => {
        const drag = distDrag, scale = distScale;
        distDrag = null;
        if (!drag || !scale) return;
        if (!drag.moved && drag.dot) {
            if (shownRows.some(row => row.key === drag.dot)) focusRow(drag.dot, true); else focusFile(fileOfKey(drag.dot));
            return;
        }
        const x = event.clientX - drag.left;
        let low = scale.at(Math.min(x, drag.x0)), high = scale.at(Math.max(x, drag.x0));
        if (!drag.moved) {
            const width = (scale.high - scale.low) / DISTRIBUTION_BINS;
            low = scale.low + Math.floor((low - scale.low) / width) * width;
            high = low + width;
        }
        low = Math.max(low, scale.low); high = Math.min(high, scale.high);
        if (!(high > low)) return;
        filters = [...filters.filter(filter => filter.column !== value), { column: value, kind: 'range', low, high }];
        mode = 'all';
        tableWrap.scrollTop = 0;
        focusPicked = false;
        rebuild();
        deps.announce(strings.dsDistPicked.replace('{n}', shownRows.length.toLocaleString()));
    });
    distGroups.addEventListener('pointercancel', () => { distDrag = null; scheduleSide(); });
    // The lanes' gestures on the side panel's plots: box zoom, Ctrl+wheel, Shift+wheel, double-click reset or
    // axis range. A press that stays put (within the lanes' 3 px) is still a click: a point picked, a row gone to.
    const zoomBox = document.createElement('div');
    zoomBox.className = 'entry-zoom-box';
    zoomBox.hidden = true;
    side.append(zoomBox);
    const rangePopover = installRangePopover(document, { rootId: 'entry-range-popover', badgeId: 'entry-range-axis-badge', idPrefix: 'entry-range', strings: rangePopoverStrings(strings), position: positionPopover });
    const plotName = (plot: HTMLElement): string => (plot === overview ? 'overview' : 'held');
    const marginsOf = (plot: HTMLElement): PlotMargins => (plot === overview ? OVERVIEW_MARGINS : heldPlot?.margins ?? STAGE_MARGINS);
    attachPlotInteraction(side, document, '[data-entry-held-canvas], [data-entry-overview]', {
        locate(target, clientX, clientY) {
            const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-entry-held-canvas], [data-entry-overview]');
            if (!plot || plot.closest('[hidden]')) return null;
            const { fx, fy, axis } = plotPointIn(plot, marginsOf(plot), clientX, clientY);
            return { plot, point: { fx, fy }, axis };
        },
        pointOn(plot, clientX, clientY) {
            const { fx, fy } = plotPointIn(plot, marginsOf(plot), clientX, clientY);
            return { fx, fy };
        },
        window: plot => plotWindow(plotName(plot)),
        setWindow(plot, next) {
            if (next) plotWindows.set(plotName(plot), next); else plotWindows.delete(plotName(plot));
            scheduleSide();
        },
        hover(event, hit) {
            // A point's name stays where hints go while the pointer is on it.
            if (!hit) return;
            // A plot that says what it is (the strip) keeps saying it, before the gestures.
            const own = hit.plot.getAttribute('data-hint');
            const gestures = hit.axis ? strings.compareHintAxis : strings.compareHintPlot;
            document.getElementById('hint-footer')?.replaceChildren(own ? `${own} · ${gestures}` : gestures);
        },
        clearHover() { /* the panel's own hints stay */ },
        showBox(plot, from, to) {
            const box = plot.getBoundingClientRect(), outer = side.getBoundingClientRect(), margins = marginsOf(plot);
            const width = box.width - margins.left - margins.right, height = box.height - margins.top - margins.bottom;
            const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
            Object.assign(zoomBox.style, { left: `${box.left - outer.left + margins.left + x0 * width}px`, top: `${box.top - outer.top + margins.top + (1 - y1) * height}px`, width: `${(x1 - x0) * width}px`, height: `${(y1 - y0) * height}px` });
            zoomBox.hidden = false;
        },
        hideBox() { zoomBox.hidden = true; },
        openAxisRange(hit, clientX, clientY) {
            const name = plotName(hit.plot);
            const mapping: AxisMapping | null = name === 'held' && heldPlot ? (hit.axis === 'x' ? { at: heldPlot.x, of: heldPlot.ofX, label: heldPlot.xLabel } : linearAxis(heldPlot.range.min, heldPlot.range.max, heldPlot.yLabel))
                    : null;
            if (!mapping) return false;
            const window = plotWindow(name);
            openAxisPart(rangePopover, {
                mapping, horizontal: hit.axis === 'x', current: hit.axis === 'x' ? window.x : window.y, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                set(range) { plotWindows.set(name, hit.axis === 'x' ? { ...window, x: range } : { ...window, y: range }); scheduleSide(); },
            });
            return true;
        },
    });

    // Capture phase on the window runs before the lane view's document listeners, which never see these keys.
    /** Maximized, the table takes the keys; in the side panel, only keys pressed while it has the focus. */
    const keysHere = (event: Event): boolean => !screen.hidden && (maximized || screen.contains(event.target as Node));
    /** A button, a field or a popover takes its own keys (Enter, Space, digits): the table's keys act on rows only. */
    const ownKeys = (event: Event): boolean => !!(event.target as Element | null)?.closest?.('button, summary, select, input, textarea, [data-entry-pop], [data-step-bar], #entry-range-popover');
    window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (!keysHere(event)) return;
        if ((event.target as Element | null)?.closest?.('[data-step-bar], #entry-range-popover')) return;
        // Immediate, so the other screen's listener does not act on a key that just switched screens.
        event.stopImmediatePropagation();
        if (closesEntryDialog(event)) {
            event.preventDefault();
            // Esc closes the innermost thing: a popover, the step bar's form, the unmatched or excluded list;
            // then the maximized table shrinks into the side panel, and the side panel hands the keys back.
            if (closePopovers()) return;
            if (closeExportMenu()) return;
            if (stepBar.close()) return;
            if (mode !== 'all') { mode = 'all'; rebuild(); return; }
            // The range picked on the distribution goes before the table shrinks.
            if (maximized && valueRange()) { filters = filters.filter(filter => filter.column !== value); rebuild(); return; }
            if (maximized) { setMaximized(false); return; }
            (document.activeElement as HTMLElement | null)?.blur?.();
            return;
        }
        if (ownKeys(event) || event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^[0-3]$/.test(event.key)) {
            event.preventDefault();
            if (!event.repeat) press(Number(event.key));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            openSlotted();
        } else if (event.key === ' ') {
            event.preventDefault();
            if (focused) deps.play?.(fileOfKey(focused));
        } else if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            if (focused) openMemo(focused);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        }
    }, true);
    window.addEventListener('keyup', (event: KeyboardEvent) => {
        if (!keysHere(event) || ownKeys(event)) return;
        event.stopImmediatePropagation();
        if (/^[0-3]$/.test(event.key)) release(Number(event.key));
    }, true);

    return {
        open(paths: string[], root = '', maximize = false): void {
            filePaths = paths.filter(path => !isMetadataCandidate(path));
            rootPath = root;
            knownShortest = undefined;
            results.clear();
            overviewLevels.clear();
            calibratedFiles.clear();
            overviewVersion++;
            resultKeys.clear();
            rowsDirty = true;
            knownRate = undefined;
            excluded.clear();
            memo.clear();
            filters = [];
            mode = 'all';
            fpop = null; slotMenu = null; memoKey = null;
            baseGroup = null;
            sessionLoaded = false; savedSession = ''; csvToSave = undefined;
            if (sessionTimer !== undefined) { window.clearTimeout(sessionTimer); sessionTimer = undefined; }
            const saved = deps.loadSlots() ?? [];
            slots = [0, 1, 2, 3].map(slot => (saved[slot] && filePaths.includes(fileOfKey(saved[slot]!)) ? saved[slot]! : null));
            focused = null; focusPicked = false;
            derived = (deps.loadDerived?.() ?? []).filter(row => filePaths.includes(row.parentPath));
            const savedRecipe = deps.loadRecipe?.();
            editedRecipe = isRecipeChain(savedRecipe) ? savedRecipe : null;
            if (savedRecipe !== undefined && savedRecipe !== null && !editedRecipe) { deps.saveRecipe?.(undefined); deps.announce(strings.stepRecipeWarning); }
            // The CSV picked last time comes back if it still reads (and matches these recordings by its own rules).
            csv = null; match = null; value = 'leq'; group = rootPath && filePaths.some(path => path.replaceAll('\\', '/').slice(rootPath.length + 1).includes('/')) ? 'folder:1' : 'none';
            const kept = deps.loadCsv?.();
            if (kept) {
                try { csv = readDatasetCsv(new TextEncoder().encode(kept.text), kept.name); } catch { csv = null; deps.saveCsv?.(undefined); }
            }
            screen.hidden = false;
            // A folder just opened keeps the table beside the tracks; ⤢ widens it when asked.
            setMaximized(maximize);
            applyCsv(csv);
            // What is stored for this chain comes back; nothing is computed until 「計算」. The headers say each file's channels.
            loadStored();
            headerChannels.clear(); headerErrors.clear(); headerDurations.clear(); probing = null;
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
            if (csv) match = matchCsv(csv, filePaths, rootPath);
            // A new probe replaces one still running, so it asks again for every header not read yet.
            probe(filePaths);
            rebuild();
        },
        tracksChanged: () => { if (!screen.hidden) render(); },
        trackRemoved(filePath) {
            const slot = slots.findIndex(key => key && fileOfKey(key) === filePath);
            if (slot >= 0) setSlot(slot, null, false); else if (!screen.hidden) render();
        },
        setRecipe,
        stepFailed,
        addDerived(row: DerivedRow): void {
            derived = [...derived.filter(item => derivedKey(item) !== derivedKey(row)), row];
            deps.saveDerived?.(derived);
            rebuild();
        },
        removeDerived: (parentPath: string, region: string, baseLabel?: string) => removeDerived(parentPath, region, baseLabel),
        show(next: (string | null)[]): void {
            slots = next.map(path => (path ? slots.find(key => key && fileOfKey(key) === path) ?? path : null));
            screen.hidden = false;
            setMaximized(true);
        },
        handle(message): boolean {
            if (message.type.startsWith('compare-')) return holdSource.handle(message) || handleRemeasure(message as ComparePublication);
            if (!message.type.startsWith('entry-')) return false;
            if (message.type === 'entry-probe-result' || message.type === 'entry-probe-done') {
                const header = message as EntryProbePublication;
                if (!probing || header.requestId !== probing.requestId) return true;
                if (header.type === 'entry-probe-done') { probing = null; rebuild(); return true; }
                probing.done++;
                if (header.durationS !== undefined) headerDurations.set(header.filePath, header.durationS);
                if (header.channels) headerChannels.set(header.filePath, header.channels);
                else if (header.error) headerErrors.set(header.filePath, header.error);
                rowsDirty = true;
                scheduleRebuild();
                return true;
            }
            const publication = message as EntryPublication;
            // A computation stopped with 中止 sends nothing more that counts.
            if (!requests.answering('scan', publication.requestId)) return true;
            if (publication.type === 'entry-conditions') {
                if (publication.recipe) standardRecipe = publication.recipe;
                // At open the folder's session comes back with what is stored; from then on, changes are saved.
                const loading = !sessionLoaded;
                if (loading) {
                    applySession(publication.session, publication.csv);
                    // A CSV kept by the webview alone (before sessions) goes to the host's store with the next save.
                    if (!publication.csv && csv) csvToSave = deps.loadCsv?.() ?? undefined;
                }
                rebuild();
                // What the table settled on at open is what is stored: only a change after it is saved.
                if (loading) { savedSession = JSON.stringify(sessionOf()); sessionLoaded = true; }
            } else if (publication.type === 'entry-scan-result') {
                noteResult(publication.filePath, publication.result);
                resultKeys.set(publication.filePath, requests.find(publication.requestId)?.key ?? currentKey());
                rowsDirty = true;
                if (scanning) {
                    scanCount++;
                    scannedSeconds += durationOf(publication.filePath) ?? UNKNOWN_DURATION_S;
                    const elapsed = window.performance.now() - scanStarted;
                    if (scanCount >= 5 && scannedSeconds > 0) perAudioSecondMs = Math.max(1, (elapsed - PER_FILE_MS * scanCount) / scannedSeconds);
                }
                const { failedStep, reason } = publication.result;
                if (failedStep) { stepFailed(failedStep, reason ?? ''); return true; }
                if (csv && !match?.attributes.size) match = matchCsv(csv, filePaths, rootPath);
                scheduleRebuild();
            } else if (publication.type === 'entry-scan-done') {
                if (redrawTimer !== undefined) { window.clearTimeout(redrawTimer); redrawTimer = undefined; }
                requests.settle(publication.requestId);
                // Only a computation the user started measures fixed differences again; reading what is stored does not.
                const started = scanning;
                scanning = false;
                if (started) remeasureStale();
                rebuild();
            }
            return true;
        },
        compareData: () => compareData(),
        slots: () => slotFiles(),
        basePaths: (comparePath, byGroup = false) => resolveBase(comparePath, byGroup).paths,
        baseTitle: (comparePath, byGroup = false) => resolveBase(comparePath, byGroup).title,
        baseDefinition: (comparePath, byGroup = false) => resolveBase(comparePath, byGroup).definition,
        stageChannel: (path, comparePath, byGroup = false) => stageChannel(path, comparePath, byGroup),
        comparison: (comparePath, byGroup = false, over, entryRegionBase = false) => comparisonOf(comparePath, byGroup, over, entryRegionBase),
        rowInfo: path => rowInfo(path),
        cost: paths => ({ seconds: paths.reduce((sum, path) => sum + (durationOf(path) ?? UNKNOWN_DURATION_S), 0), ms: estimateMs(paths) }),
        tableBaseBands: (comparePath, byGroup = false) => {
            const base = resolveBase(comparePath, byGroup);
            const levels = base.paths.flatMap(path => {
                const result = base.channel ? channelResult(results.get(path), base.channel) : results.get(path);
                if (!result?.ok || isStale(path) || !result.thirdOctDb?.length) return [];
                // A recording's channels together, power-averaged, as the comparison's sides are.
                return [result.thirdOctDb[0].map((_, band) => powerMeanOrNull(result.thirdOctDb!.map(channel => channel[band])))];
            });
            if (!levels.length) return null;
            const values = levels[0].map((_, band) => median(levels.map(item => item[band]).filter((value): value is number => value !== null)));
            return { centers: BAND_CENTERS_HZ.slice(0, values.length), values, count: levels.length };
        },
        selection: () => ({
            value: valueLabel(value), group: group === 'none' ? strings.dsGroupNone : groupLabel(group),
            filters: filters.map(filter => chipText(filter)), excluded: excluded.size,
        }),
        derivedRows: () => derived.slice(),
        openBatch: () => openBatch(),
        exportTable: () => actions['entry-export-csv'](screen),
        exportNotes: () => actions['entry-export-notes'](screen),
        showCompared() {
            const compared = slots.slice(1).filter((key): key is string => !!key);
            if (!compared.length) return;
            // The compared rows and their base: as a filter on the file column, which a chip shows and × takes off.
            const wanted = new Set(compared.map(fileOfKey).flatMap(file => [file, ...this.basePaths(file)]));
            filters = [{ column: 'name', kind: 'values', values: [...new Set(rows.filter(row => wanted.has(row.filePath)).map(row => row.name))] }];
            mode = 'all'; tableWrap.scrollTop = 0; rebuild();
        },
        recipes() {
            const recipe = editedRecipe ?? standardRecipe;
            return recipe ? { recipe, runRecipe: runRecipe(), failed } : null;
        },
        snapshot: () => ({
            open: !screen.hidden && maximized, docked: !screen.hidden && !maximized, cols: Number(screen.dataset.cols ?? 0), rows: rows.length, visible: shownRows.length,
            scanned: [...results.values()].filter(result => result.ok).length, slots: slots.slice(), focused, value, group, filters: filters.map(filter => ({ ...filter })),
            sort: { ...sort }, excluded: [...excluded], memo: Object.fromEntries(memo), mode, unmatched: unmatchedItems().length + unreadable().length,
            csv: csv?.name ?? null, playing: deps.playing?.() ?? null, visibleKeys: shownRows.slice(0, 200).map(row => row.key), scanning,
            dist: lastDistribution ? {
                groups: lastDistribution.groups.map(item => ({ name: item.name, n: item.members.length, inRange: item.members.filter(member => member.inRange).length })),
                missing: lastDistribution.missing, unit: lastDistribution.unit, low: lastDistribution.low, high: lastDistribution.high, range: valueRange(), base: baseGroupName(),
                strip: !maximized,
            } : null,
        }),
    };
}
