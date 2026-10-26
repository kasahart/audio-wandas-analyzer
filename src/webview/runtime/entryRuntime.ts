/**
 * The entry screen: scans a folder's files through the host, shows them as the entry table and lets
 * the user pick up to three to open. Keys while it is open: 0 (tap = make the focused row the base,
 * hold = show Δ), 1–3 (put the focused row in that slot), Enter (open the slotted files), Esc (leave for
 * the lane view and its file tree), ↑/↓ (move the focus). It swallows every other key so the lane view's shortcuts stay quiet behind it.
 */
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { UiStrings } from '../../shared/i18n/strings';
import type { ComparePublication, CompareScanMessage, EntryConditionTable, EntryPublication, EntryScanCancelMessage, EntryScanMessage, EntrySaveConditionsMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { bandLabel, buildEntryModel, canFlagOutliers, derivedKey, entryCsv, fileName, isOutlierRow, type DerivedRow, type EntryModel, type EntrySortColumn } from './entryTable';
import { baseOf, buildCompareModel, sideView, type CompareModel } from './comparePanes';
import { OVERVIEW_MARGINS, paintOverview, paintScatter, SCATTER_MARGINS, scatterAxes, scatterExtent, type ScatterPoint } from './entryPlots';
import { attachPlotInteraction, FULL_PLOT_WINDOW, plotPointIn, type PlotMargins, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, DIFF_COLOR, paintOverlay, ROLE_COLORS, stageAxes, stageDiffRange, stageDifference, stageRange, STAGE_MARGINS, type StageAxes } from './stagePanes';
import { createStageSource, type StageSpec } from './stageSource';
import { HostRequests } from './hostRequests';
import { createDetailPlanner } from './stageDetail';
import type { PaneRange } from './comparePanes';
import { installRangePopover } from '../rangePopover';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { positionPopover } from './settingsPopover';
import { createStepBar, endsInSpectrum, runnableRecipe, stepLimits, OCTAVE_BRANCH } from './stepBar';
import { leqLabel } from './compareReport';
import { isRecipeChain, recipeKey, recipeSteps, timeSignalStep, withoutSteps, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { decodeTableText, isMetadataCandidate, parseTable, resolveTable, withFolderColumns, type MetadataAudit } from '../../shared/analysis/entryMetadata';
import {
    closesEntryDialog, comparedRows, conditionColumnsHtml, entryHeadHtml, entryRowsHtml, entryScreenHtml, entrySlotsHtml,
    type EntryStrings, type EntryView,
} from './entryTableHtml';

/** A tap on 0 shorter than this sets the base; longer is a hold that only shows Δ. */
const TAP_MS = 250;
/** Releasing 0 keeps Δ on screen this long, so a quick look does not flicker. */
const DELTA_RELEASE_MS = 150;
/**
 * Scan results are redrawn at most this often: each redraw sorts and renders every row, so redrawing per
 * result would cost the square of the folder size (1000 files took 45 s just to draw).
 */
const REDRAW_MS = 250;

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
    post(message: EntryScanMessage | EntryScanCancelMessage | EntrySaveConditionsMessage | CompareScanMessage): void;
    loadSlots(): readonly (string | null)[] | undefined;
    saveSlots(slots: (string | null)[]): void;
    /** Differences fixed on the comparison, kept across sessions like the slots. */
    loadDerived?(): readonly DerivedRow[] | undefined;
    saveDerived?(rows: DerivedRow[]): void;
    /** The Recipe edited in the step bar; anything unreadable is dropped with a one-line warning. */
    loadRecipe?(): unknown;
    saveRecipe?(recipe: RecipeDocument | undefined): void;
    /** Leaves the entry screen for the comparison on these files. */
    openFiles(filePaths: string[], comparison: CompareData): void;
    /** New results or conditions while the comparison is open, so it can redraw. */
    compareChanged?(comparison: CompareData): void;
    announce(text: string): void;
    download(csv: string, fileName: string): void;
    /** "? list": the keys and symbols overlay. */
    help?(): void;
    /** Where the table sits while it is not maximized: the track view's side panel (the page's body without one). */
    dock?: HTMLElement | null;
    /** The table was widened to the whole window, or shrunk back into the side panel. */
    maximizedChanged?(maximized: boolean): void;
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
    /** The base's name: the slot-0 file, or "Base group · conditions · n files". */
    baseTitle(comparePath: string, group?: boolean): string;
    /** Turns the "Compared" filter on: the compared files and their base. */
    showCompared(): void;
    /** The Recipe the table scans with (its edited one, else the host's), and the one its scans run; null before either is known. */
    recipes(): { recipe: RecipeDocument; runRecipe?: RecipeDocument } | null;
    /** What the table currently shows, for tests. */
    snapshot(): { open: boolean; docked: boolean; cols: number; rows: number; scanned: number; slots: (string | null)[]; delta: boolean; band: string; outliers: number };
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
    const table = query<HTMLElement>('[data-entry-table]');
    const slotBar = query<HTMLElement>('[data-entry-slots]');
    const keyHints = query<HTMLElement>('[data-entry-keys]');
    const progress = query<HTMLElement>('[data-entry-progress]');
    const dialog = query<HTMLElement>('[data-entry-dialog]');
    const paste = query<HTMLTextAreaElement>('[data-entry-paste]');
    const columnsBox = query<HTMLElement>('[data-entry-columns]');
    const unmatchedBox = query<HTMLElement>('[data-entry-unmatched]');
    const tableWrap = query<HTMLElement>('.entry-table-wrap');
    const scatter = query<HTMLCanvasElement>('[data-entry-scatter]');
    const axisX = query<HTMLSelectElement>('[data-action="entry-axis-x"]');
    const axisY = query<HTMLSelectElement>('[data-action="entry-axis-y"]');
    const held = query<HTMLElement>('[data-entry-held]');
    const heldTitle = query<HTMLElement>('[data-entry-held-title]');
    const heldCanvas = query<HTMLCanvasElement>('[data-entry-held-canvas]');
    const overview = query<HTMLCanvasElement>('[data-entry-overview]');
    const staleBox = query<HTMLElement>('[data-entry-stale]');
    const side = query<HTMLElement>('.entry-side');
    /**
     * The side panel's zoom, as the lanes keep theirs: per plot (scatter, held, overview strip), the part of each
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
    let scatterPlot: { x: [number, number]; y: [number, number]; xLabel: string; yLabel: string } | null = null;
    const stepBar = createStepBar({
        document, strings, mode: 'entry', onChange: recipe => setRecipe(recipe),
        // A step pressed opens the comparison on that step's Frame.
        onStepSelect: step => openSlotted(step.id),
        // On the entry table a hold shows one row: without a step of its time signal, or its spectrum or bands.
        // The region is always the whole file here, and the steps after the spectrum have no picture on the side.
        canHold: step => canHoldStep(step),
        onStepHold: step => holdStep(step),
    });
    // Under the filter band, as in the design: what to look at first, then how it was measured.
    query('.entry-bar').after(stepBar.element);
    /** The host's entry Recipe, and the one edited in the step bar (which the scans then use). */
    let standardRecipe: RecipeDocument | null = null;
    let editedRecipe: RecipeDocument | null = null;
    /** Steps that failed on a file, with wandas' reason: left out of the scans until the Recipe changes. */
    let failed: Record<string, string> = {};

    let filePaths: string[] = [];
    const results = new Map<string, ScanResult>();
    /**
     * The Recipe each result was measured with (recipeKey of the run). A new chain does not scan the folder
     * again by itself: the rows keep the previous chain's values, greyed, until "Scan all" is pressed; only
     * what is on screen (the focused row, the comparison's files) is measured at once.
     */
    const resultKeys = new Map<string, string>();
    /** What the table asked the host for: the folder's scan ('scan', keyed by its chain), a row measured again, a fixed difference measured again. */
    const requests = new HostRequests<undefined>();
    const remeasuring = new HostRequests<{ row: DerivedRow; results: Map<string, ScanResult> }>();
    const currentKey = (): string => recipeKey(runRecipe());
    const isStale = (path: string): boolean => results.has(path) && resultKeys.get(path) !== currentKey();
    function stalePaths(): Set<string> {
        const key = currentKey();
        return new Set(filePaths.filter(path => results.has(path) && resultKeys.get(path) !== key));
    }
    /** Time per file of the last folder scan, for the estimate on "Scan all". */
    let perFileMs = 150;
    let scanStarted = 0;
    let scanCount = 0;
    let rootPath = '';
    /** Files added from elsewhere (＋ Add files, a drop, another folder): their own group, at the top. */
    const added = new Set<string>();
    /** Groups folded in the side panel. */
    const folded = new Set<string>();
    /** A row's group: '0' for an added file, '1' + its folder below the opened one ('1' for the opened folder itself). */
    function groupOf(row: { filePath: string; derived?: { parent: string } }): string {
        const path = row.derived?.parent ?? row.filePath;
        if (added.has(path) || !rootPath) return added.has(path) ? '0' : '1';
        const relative = path.startsWith(rootPath) ? path.slice(rootPath.length).replace(/^[\\/]+/, '') : path;
        const at = Math.max(relative.lastIndexOf('/'), relative.lastIndexOf('\\'));
        return '1' + (at >= 0 ? relative.slice(0, at) : '');
    }
    function groupLabel(key: string): string {
        if (key === '0') return strings.entryAddedGroup;
        if (key === '1') return rootPath.split(/[\\/]/).filter(Boolean).pop() ?? '.';
        return key.slice(1);
    }
    let conditions: EntryConditionTable | null = null;
    /** Condition columns the user checked by their headings, over the columns `effective` shows. */
    let checkedOverride: number[] | undefined;
    let draft: EntryConditionTable | null = null;
    let requestCount = 0;
    let slots: (string | null)[] = [null, null, null, null];
    let focused: string | null = null;
    /** Until the user picks a row, the focus follows the top of the table as results arrive. */
    let focusPicked = false;
    let band: number | undefined;
    let sort: EntrySortColumn = 'band';
    let filter: EntryView['filter'] = 'all';
    let delta = false;
    let expanded = false;
    let derived: DerivedRow[] = [];
    let xAxisId = 'leq';
    let yAxisId = 'band';
    let points: ScatterPoint[] = [];
    let sidePending = false;
    /** The slot key or chip being pressed: a tap acts on release, a hold shows something until then. */
    let pressing: { slot: number; at: number; timer: number; fromChip?: boolean } | undefined;
    let heldSlot: number | null = null;
    let heldTimer: number | undefined;
    /** Rows keep the files' order until every result is in, so they do not move while the user picks. */
    let scanning = false;
    /** The scan that opened the folder: only it reports the folder's conditions and metadata file. */
    let openRequest = '';
    let releaseTimer: number | undefined;
    let model: EntryModel = buildEntryModel([], null);
    let redrawTimer: number | undefined;
    let lastRedraw = 0;
    let redrawCost = 0;
    function scheduleRebuild(): void {
        if (redrawTimer !== undefined) return;
        // A big table takes longer to draw, so it waits longer: drawing stays under a fifth of the time.
        const interval = Math.max(REDRAW_MS, 4 * redrawCost);
        const wait = Math.max(0, interval - (window.performance.now() - lastRedraw));
        redrawTimer = window.setTimeout(() => {
            redrawTimer = undefined;
            const started = window.performance.now();
            if (delta) render(); else rebuild();
            lastRedraw = window.performance.now();
            redrawCost = lastRedraw - started;
        }, wait);
    }

    /** Whether the chain ends in a spectrum or band levels: otherwise the table has Leq only, no band columns. */
    function spectral(): boolean {
        const recipe = editedRecipe ?? standardRecipe;
        return !recipe || endsInSpectrum(recipe, limits());
    }
    /** A result as the table reads it: without a spectral end, its bands (the app's own) are not shown or compared. */
    function shown(result: ScanResult | undefined): ScanResult | undefined {
        if (!result?.ok || spectral()) return result;
        return { ...result, peakHz: result.peakHz?.map(() => 0), thirdOctDb: result.thirdOctDb?.map(row => row.map(() => null)) };
    }
    function rebuild(): void {
        model = buildEntryModel(filePaths.map(filePath => ({ filePath, result: shown(results.get(filePath)) })), effective(),
            { band, sort: spectral() ? sort : 'leq', order: scanning ? 'file' : 'delta', derived });
        if (!focusPicked || !focused || !filePaths.includes(focused)) focused = model.rows[0]?.filePath ?? null;
        render();
        if (!maximized) deps.compareChanged?.(compareData());
    }
    /** The table on screen: the metadata's columns, then the recordings' subfolders, with the checked columns. */
    function effective(): EntryConditionTable | null {
        const table = withFolderColumns(conditions, filePaths, rootPath, level => strings.entryFolderLevel.replace('{n}', String(level)));
        return table && checkedOverride ? { ...table, checked: checkedOverride.filter(index => index < table.columns.length) } : table;
    }
    function auditText(audit: MetadataAudit | undefined): string {
        if (!audit) return '';
        const extra = [[strings.entryMissing, audit.missing], [strings.entryAmbiguous, audit.ambiguous], [strings.entryRepeated, audit.repeated]] as const;
        const count = audit.matched < audit.recordings ? [`${audit.matched} / ${audit.recordings}`] : [];
        return [...count, ...extra.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`)].join(' · ');
    }
    /** What slots 1–3 are compared against: the slot-0 file, else each one's other files of its condition. */
    function comparedBase(): Set<string> {
        const compared = slots.slice(1).filter((path): path is string => !!path && filePaths.includes(path));
        if (!compared.length) return new Set();
        if (slots[0]) return new Set([slots[0]]);
        return new Set(compared.flatMap(path => {
            const row = model.rows.find(item => item.filePath === path);
            return (row?.group ? model.groups.get(row.group) ?? [] : []).filter(member => !member.derived).map(member => member.filePath);
        }).filter(path => !compared.includes(path)));
    }
    function view(): EntryView {
        const baseRow = delta && slots[0] ? model.rows.find(row => row.filePath === slots[0] && row.status === 'ok') : undefined;
        const stale = stalePaths();
        return {
            model, scanned: results.size - stale.size, total: filePaths.length, slots, focused, delta, filter, expanded, baseRow, leqOnly: !spectral(), stale,
            shown: deps.shownTracks?.(), base: comparedBase(), playing: deps.playing?.() ?? null,
            // In the side panel the rows group by subfolder (in place of a folder tree), files added from elsewhere first.
            ...(maximized ? {} : { groups: { of: groupOf, label: groupLabel, folded } }),
        };
    }
    function render(): void {
        const current = view();
        head.innerHTML = entryHeadHtml(current, text);
        body.innerHTML = entryRowsHtml(current, text);
        slotBar.innerHTML = entrySlotsHtml(current, text, heldSlot);
        // The rows' 1 2 3 and the bar's button say how to compare; the keys are one ? away.
        const wanted = `<button type="button" class="entry-key" data-action="entry-key-hint" data-key="help">${escapeHtml(strings.keyHelp)}</button>`;
        if (keyHints.innerHTML !== wanted) keyHints.innerHTML = wanted;
        table.classList.toggle('is-delta', delta);
        progress.textContent = `${current.scanned} / ${current.total}`;
        // A finished count tells nothing: it shows only while files are still to be measured.
        progress.hidden = !scanning && current.scanned >= current.total;
        // A table measured under an earlier chain says so, and offers the scan; a running scan can be stopped.
        const staleCount = current.stale?.size ?? 0;
        const minutes = staleCount * perFileMs / 60000;
        const estimate = minutes >= 1 ? strings.entryMinutes.replace('{n}', String(Math.ceil(minutes))) : strings.entrySeconds.replace('{n}', String(Math.max(1, Math.ceil(minutes * 60))));
        const staleHtml = scanning
            ? `<button type="button" data-action="entry-scan-cancel">${escapeHtml(strings.entryScanCancel)}</button>`
            : staleCount ? `<span class="awa-tag entry-stale-tag">${escapeHtml(strings.entryStaleTag.replace('{n}', String(staleCount)))}</span>`
                + `<button type="button" data-action="entry-scan-all">${escapeHtml(strings.entryScanAll.replace('{n}', String(staleCount)).replace('{time}', estimate))}</button>` : '';
        if (staleBox.innerHTML !== staleHtml) staleBox.innerHTML = staleHtml;
        query('[data-entry-count="outliers"]').closest('.entry-filter')?.classList.toggle('is-stale', staleCount > 0);
        scheduleShownScan();
        stepBar.set({ recipe: editedRecipe ?? standardRecipe, sampleRate: sampleRate(), shortestSamples: shortestSamples(), channels: channelCount(), failed, specVersion: specVersion(), files: model.rows.filter(row => !row.derived).length });
        const source = query('[data-entry-source]');
        const audit = auditText(conditions?.audit);
        source.textContent = conditions?.source ? (audit ? `${conditions.source} · ${audit}` : conditions.source) : strings.entryPasteConditions;
        // No condition with three files: no outlier can be told, which is not the same as none.
        query('[data-entry-count="outliers"]').textContent = canFlagOutliers(model) ? String(model.rows.filter(isOutlierRow).length) : '—';
        // With no condition that can tell an outlier, the outlier filter has nothing to do.
        query<HTMLButtonElement>('[data-action="entry-filter-outliers"]').disabled = !canFlagOutliers(model);
        query('[data-entry-count="failed"]').textContent = String(model.rows.filter(row => row.status === 'failed' || (row.status === 'mismatch' && !row.derived)).length);
        // "Compared" appears once slots 1–3 hold a file: those files and their base, nothing else.
        const comparedCount = comparedRows(current).length;
        const comparedButton = query<HTMLButtonElement>('[data-action="entry-filter-compared"]');
        comparedButton.hidden = !slots.slice(1).some(path => path && filePaths.includes(path));
        if (comparedButton.hidden && filter === 'compared') { filter = 'all'; render(); return; }
        query('[data-entry-count="compared"]').textContent = String(comparedCount);
        screen.querySelectorAll<HTMLElement>('.entry-filter').forEach(button => {
            const kind = button.getAttribute('data-action')!.replace('entry-filter-', '') as EntryView['filter'];
            button.setAttribute('aria-pressed', String(filter === kind));
        });
        body.querySelector('.is-focused')?.scrollIntoView?.({ block: 'nearest' });
        scheduleSide();
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
    function specVersion(): number | undefined {
        for (const result of results.values()) if (result.ok) return result.specVersion;
        return undefined;
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
        return { model, results, slots: slots.slice(), recipe: editedRecipe ?? standardRecipe, runRecipe: runRecipe(), failed, stale: stalePaths(), ...(stage ? { stage } : {}) };
    }
    /** The focused row, measured with the current chain as soon as it shows the previous chain's values. */
    let shownTimer: number | undefined;
    function scheduleShownScan(): void {
        if (shownTimer !== undefined || scanning || screen.hidden) return;
        shownTimer = window.setTimeout(() => {
            shownTimer = undefined;
            const path = focused;
            if (!path || !isStale(path) || requests.pending(`row|${path}`)?.key === currentKey()) return;
            const recipe = runRecipe();
            requests.ask(`row|${path}`, `row-${++requestCount}`, currentKey(), undefined, ({ requestId }) => deps.post({ type: 'compare-scan', requestId, filePaths: [path], ...(recipe ? { recipe } : {}) }));
        }, 250);
    }
    function handleRow(publication: ComparePublication): boolean {
        const key = requests.find(publication.requestId)?.key;
        if (key === undefined || !publication.requestId.startsWith('row-')) return false;
        if (publication.type === 'compare-scan-done') { requests.settle(publication.requestId); return true; }
        // Measured with a chain since replaced: not this chain's value.
        if (key !== currentKey()) return true;
        if (publication.result.failedStep) { stepFailed(publication.result.failedStep, publication.result.reason ?? ''); return true; }
        results.set(publication.filePath, publication.result);
        resultKeys.set(publication.filePath, key);
        scheduleRebuild();
        return true;
    }
    /**
     * A step that failed on a file is left out (orange ! on its chip) and every file is scanned again
     * without it; a step already left out, or one this Recipe does not have, changes nothing.
     */
    function stepFailed(step: string, reason: string): void {
        const recipe = editedRecipe ?? standardRecipe;
        const known = recipe && (recipe as unknown as { nodes?: Array<{ id: string }> }).nodes?.some(node => node.id === step);
        if (!known || failed[step] !== undefined) return;
        failed = { ...failed, [step]: reason };
        // The scan the user started goes on with the step left out; otherwise only what is on screen is measured again.
        if (scanning) scanAll();
        rebuild();
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
    function remeasureStale(): void {
        derived.forEach(row => {
            if (!row.stale || !row.base.paths?.length) return;
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
     * slot 1) in the scatter's frame: its average spectrum, its 1/3-octave levels, or, for a step of the time
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
        const path = focused ?? slots[1];
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
        // A later step that cannot take the Frame without this one is left out too, as the scans do.
        const without = runnableRecipe(withoutSteps(recipe, [step.id]), limits());
        if (!end || !(without as unknown as { nodes: Array<{ id: string }> }).nodes.some(node => node.id === end)) return null;
        return { with: holdSpec(recipe, end), without: holdSpec(without, end) };
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
        const row = buildCompareModel(model, results, path, null, strings);
        const input = results.get(path)?.input;
        const name = step.name === 'welch' ? strings.stepAverage : step.id === OCTAVE_BRANCH ? strings.stepOctave : strings.stepHeldWithout.replace('{step}', step.name.endsWith('_filter') ? step.name.replace('_filter', '').toUpperCase().replace('HIGHPASS', 'HPF').replace('LOWPASS', 'LPF').replace('BANDPASS', 'BPF') : step.name);
        heldTitle.textContent = strings.stepHeldRow.replace('{what}', name).replace('{file}', fileName(path));
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
    function scheduleSide(): void {
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
    /** The scatter (base group blue, outliers orange), the held row's Δ spectrum and the overview strip. */
    function paintSide(): void {
        // The side plots are drawn only while the table is wide enough to show them.
        if (screen.hidden || !side.offsetWidth) return;
        const axes = scatterAxes(model, strings.entryAxisMaxDelta);
        const options = axes.map(axis => `<option value="${axis.id}">${axis.label.replace(/[<&"]/g, '')}</option>`).join('');
        for (const select of [axisX, axisY]) if (select.innerHTML !== options) select.innerHTML = options;
        const x = axes.find(axis => axis.id === xAxisId) ?? axes[0];
        const y = axes.find(axis => axis.id === yAxisId) ?? axes[2];
        axisX.value = x.id;
        axisY.value = y.id;
        const focusedRow = model.rows.find(row => row.filePath === focused);
        scatterPlot = { ...scatterExtent(model, x, y), xLabel: x.label, yLabel: y.label };
        points = paintScatter(scatter, model, x, y, slots[0] ? undefined : focusedRow?.group, focused, slots, keepWindow('scatter', `${x.id}|${y.id}`));
        const levels = new Map<string, (number | null)[]>();
        for (const row of model.rows) {
            const result = results.get(row.filePath);
            if (result?.ok && !row.derived) levels.set(row.filePath, result.thirdOctDb![0].map((_, bandIndex) => {
                const values = result.thirdOctDb!.map(channel => channel[bandIndex]);
                if (values.some(value => value === null)) return null;
                return 10 * Math.log10((values as number[]).reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length);
            }));
        }
        const rowsOnScreen = model.rows.filter(row => !row.derived);
        const rowHeight = (body.querySelector('tr') as HTMLElement | null)?.offsetHeight || 22;
        const first = Math.floor(tableWrap.scrollTop / rowHeight);
        paintOverview(overview, rowsOnScreen, levels, { first, last: first + Math.ceil(tableWrap.clientHeight / rowHeight) - 2 }, focused, keepWindow('overview', String(rowsOnScreen.length)));
        // The zoom on each plot, for tests: "x0-x1|y0-y1".
        for (const [name, canvas] of [['scatter', scatter], ['overview', overview], ['held', heldCanvas]] as const) {
            const window = plotWindow(name);
            canvas.dataset.window = `${window.x.start.toFixed(3)}-${window.x.end.toFixed(3)}|${window.y.start.toFixed(3)}-${window.y.end.toFixed(3)}`;
        }
        if (stepHeld) { paintStepHeld(); return; }
        held.hidden = heldSlot === null;
        held.classList.remove('is-pending');
        if (heldSlot !== null) {
            const path = slots[heldSlot] ?? focused;
            const comparison = buildCompareModel(model, results, path, null, strings);
            heldTitle.textContent = path ? `${heldSlot} · ${fileName(path)}` : '';
            paintHeldDelta(comparison, `slot|${heldSlot}`, path ? results.get(path)?.input : undefined);
        }
    }

    function press(slot: number): void {
        if (pressing) return;
        if (slot === 0) showDelta(true);
        const timer = slot === 0 ? 0 : window.setTimeout(() => {
            if (heldTimer !== undefined) { window.clearTimeout(heldTimer); heldTimer = undefined; }
            heldSlot = slot;
            slotBar.innerHTML = entrySlotsHtml(view(), text, heldSlot);
            scheduleSide();
        }, TAP_MS);
        pressing = { slot, at: window.performance.now(), timer };
    }
    /** A tap puts the focused row in the slot (0: makes it the base); a hold only showed something, which goes 150 ms later. */
    function release(slot: number): void {
        if (!pressing || pressing.slot !== slot) return;
        window.clearTimeout(pressing.timer);
        const tapped = window.performance.now() - pressing.at < TAP_MS;
        const from = pressing.fromChip ? 'chip' : 'key';
        pressing = undefined;
        if (slot === 0) {
            // 0 on the base row, or a click on the base chip, gives the base back to the group median.
            const clears = tapped && !!slots[0] && (from === 'chip' || slots[0] === focused);
            if (clears) {
                slots = slots.slice();
                slots[0] = null;
                deps.saveSlots(slots);
            } else if (tapped && focused && filePaths.includes(focused)) {
                slots = slots.map(path => (path === focused ? null : path));
                slots[0] = focused;
                deps.saveSlots(slots);
            }
            releaseTimer = window.setTimeout(() => { releaseTimer = undefined; delta = false; rebuild(); }, DELTA_RELEASE_MS);
            render();
            return;
        }
        if (tapped) { if (focused && filePaths.includes(focused)) setSlot(slot, focused); return; }
        heldTimer = window.setTimeout(() => { heldTimer = undefined; heldSlot = null; scheduleSide(); }, DELTA_RELEASE_MS);
    }

    function setSlot(slot: number, filePath: string | null, follow = true): void {
        const before = slots;
        const next = slots.map(path => (path === filePath ? null : path));
        next[slot] = slots[slot] === filePath ? null : filePath;
        slots = next;
        deps.saveSlots(slots);
        // The tracks follow the slots: a slotted file is shown, a file that leaves every slot leaves the tracks.
        if (follow) {
            for (const path of next) if (path && !before.includes(path)) deps.setShown?.(path, true);
            for (const path of before) if (path && !next.includes(path)) deps.setShown?.(path, false);
        }
        render();
        // A slotted file is wanted next on the comparison, so the scan takes it before the rest.
        if (scanning && filePath && !results.has(filePath)) scan();
    }
    /** Scans every file without a result, slotted files first; a newer request supersedes the running one. */
    function scan(): void {
        const pending = filePaths.filter(path => !results.has(path));
        post(pending);
    }
    /** "Scan all": every file with the current chain; files the host has stored for it come back at once. */
    function scanAll(): void {
        const order = [...filePaths.filter(path => !results.has(path) || isStale(path)), ...filePaths.filter(path => results.has(path) && !isStale(path))];
        post(order);
    }
    function post(pending: string[]): void {
        const slotted = pending.filter(path => slots.includes(path));
        const { requestId } = requests.ask('scan', `entry-${++requestCount}`, currentKey(), undefined);
        scanning = pending.length > 0;
        scanStarted = window.performance.now();
        scanCount = 0;
        const recipe = runRecipe();
        deps.post({ type: 'entry-scan', requestId, rootPath, filePaths: [...slotted, ...pending.filter(path => !slotted.includes(path))], ...(recipe ? { recipe } : {}) });
    }
    function cancelScan(): void {
        if (!scanning) return;
        deps.post({ type: 'entry-scan-cancel' });
        scanning = false;
        // Rows it reached are this chain's; the rest keep their previous values, greyed.
        rebuild();
    }
    function moveFocus(step: number): void {
        const visible = Array.from(body.querySelectorAll<HTMLElement>('tr[data-file-path]')).map(row => row.getAttribute('data-file-path')!);
        if (!visible.length) return;
        const index = focused ? visible.indexOf(focused) : -1;
        focused = visible[Math.min(visible.length - 1, Math.max(0, index + step))];
        focusPicked = true;
        render();
    }
    function showDelta(on: boolean): void {
        if (releaseTimer !== undefined) { window.clearTimeout(releaseTimer); releaseTimer = undefined; }
        if (delta === on) return;
        delta = on;
        render();
    }
    /**
     * The table is one: in the track view's side panel, or maximized over the whole window. Its width decides what
     * it shows (data-cols 1–6): the name and the sorted number, then Leq, the largest Δ band, the conditions, the
     * band levels, and the side plots; maximized shows everything.
     */
    let maximized = false;
    const sizeButton = query<HTMLButtonElement>('[data-action="entry-maximize"].entry-size');
    const COLUMN_WIDTHS = [0, 300, 380, 480, 560, 900];
    function syncColumns(): void {
        const width = screen.clientWidth;
        const cols = maximized ? 6 : COLUMN_WIDTHS.filter(edge => width >= edge).length;
        if (screen.dataset.cols !== String(cols)) {
            screen.dataset.cols = String(cols);
            if (cols >= 6) scheduleSide();
        }
    }
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) new Observer(() => syncColumns()).observe(screen);
    function setMaximized(next: boolean): void {
        if (!next) stepBar.close();
        maximized = next;
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
        if ((event.target as Element).closest('button, select, input')) return;
        setMaximized(!maximized);
    });
    function openSlotted(stage?: string): void {
        // The comparison compares slots 1–3; slot 0 alone has nothing to compare against.
        if (!slots.slice(1).some(path => path && filePaths.includes(path))) {
            deps.announce(stage ? strings.stepOpenCompare : strings.entryKeySlot);
            // The empty slot that needs filling lights its focus ring once.
            const first = slotBar.querySelector('[data-slot="1"]');
            first?.classList.remove('is-flash'); void (first as HTMLElement | null)?.offsetWidth; first?.classList.add('is-flash');
            return;
        }
        const chosen = slots.filter((path): path is string => !!path && filePaths.includes(path));
        // The tracks are compared in the track view; the table goes back into the side panel beside them.
        setMaximized(false);
        deps.openFiles(Array.from(new Set(chosen)), compareData(stage));
    }
    function exportCsv(): void {
        const csv = entryCsv(model, {
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
            outlier: strings.entryOutliers,
        });
        deps.download(csv, 'entry-table.csv');
    }

    function openDialog(): void {
        draft = conditions;
        paste.value = '';
        showDraft();
        dialog.hidden = false;
        paste.focus();
    }
    function closeDialog(): void {
        dialog.hidden = true;
        draft = null;
        (body.querySelector<HTMLElement>('.is-focused') ?? table).focus?.();
    }
    function showDraft(): void {
        columnsBox.innerHTML = draft ? conditionColumnsHtml(draft.columns, draft.checked) : '';
        unmatchedBox.textContent = auditText(draft?.audit);
    }
    function applyConditions(table: EntryConditionTable | null): void {
        conditions = table;
        checkedOverride = undefined;
        deps.post({ type: 'entry-save-conditions', table });
        rebuild();
    }

    const actions: Record<string, (target: HTMLElement) => void> = {
        'entry-paste-conditions': openDialog,
        'entry-filter-outliers': () => { filter = filter === 'outliers' ? 'all' : 'outliers'; render(); },
        'entry-filter-failed': () => { filter = filter === 'failed' ? 'all' : 'failed'; render(); },
        'entry-filter-compared': () => { filter = filter === 'compared' ? 'all' : 'compared'; render(); tableWrap.scrollTop = 0; },
        'entry-row-play': target => deps.play?.(target.getAttribute('data-path')!),
        'entry-export-csv': exportCsv,
        'entry-open': () => openSlotted(),
        'entry-maximize': () => setMaximized(!maximized),
        'entry-group-toggle': target => {
            const key = target.getAttribute('data-group')!;
            if (!folded.delete(key)) folded.add(key);
            render();
        },
        // A row's 0 1 2 3 put its file in that slot, as the keys do on the focused row (0 again gives the base back to
        // the group median); 👁 hides or shows a track; × takes it off.
        'entry-row-slot': target => {
            const path = target.getAttribute('data-path')!;
            const slot = Number(target.getAttribute('data-slot'));
            focused = path; focusPicked = true;
            if (slot === 0) {
                const wasBase = slots[0] === path;
                slots = slots.map(item => (item === path ? null : item));
                slots[0] = wasBase ? null : path;
                deps.saveSlots(slots);
                rebuild();
                return;
            }
            setSlot(slot, path);
        },
        'entry-row-hide': target => {
            const path = target.getAttribute('data-path')!;
            deps.setHidden?.(path, !(deps.shownTracks?.().get(path) ?? false));
        },
        'entry-row-remove': target => {
            const path = target.getAttribute('data-path')!;
            const slot = slots.indexOf(path);
            if (slot >= 0) setSlot(slot, null, false);
            deps.setShown?.(path, false);
        },
        'entry-scan-all': () => scanAll(),
        'entry-scan-cancel': () => cancelScan(),
        // A new order starts from its top row.
        'entry-sort-leq': () => { sort = 'leq'; rebuild(); tableWrap.scrollTop = 0; },
        'entry-sort-band': () => { sort = 'band'; rebuild(); tableWrap.scrollTop = 0; },
        'entry-key-hint': target => {
            const key = target.getAttribute('data-key');
            if (key === 'open') openSlotted();
            else if (key === 'help') deps.help?.();
            // "1–3 slot" itself is pressed and held like the key: see the pointerdown below.
        },
        // Pointer presses and holds on the chips go through press/release; this is the keyboard's click.
        'entry-slot': () => undefined,
        'entry-conditions-apply': () => { if (draft) applyConditions(draft); closeDialog(); },
        'entry-conditions-clear': () => { applyConditions(null); closeDialog(); },
        'entry-conditions-close': closeDialog,
        'entry-columns-more': () => { expanded = !expanded; render(); },
        // A metadata column's heading checks or unchecks it as part of the condition.
        'entry-column': target => {
            const shown = effective();
            if (!shown) return;
            const index = Number(target.getAttribute('data-column'));
            checkedOverride = shown.checked.includes(index) ? shown.checked.filter(item => item !== index) : [...shown.checked, index];
            // The metadata's own columns are kept for the next session; folder columns follow the folder.
            if (conditions) deps.post({ type: 'entry-save-conditions', table: { ...conditions, checked: checkedOverride.filter(item => item < conditions!.columns.length) } });
            rebuild();
        },
    };
    slotBar.addEventListener('pointerdown', event => {
        const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
        if (chip) { press(Number(chip.getAttribute('data-slot'))); if (pressing) pressing.fromChip = true; }
    });
    // The "1–3 slot" hint does what the key does for the first free slot: a tap slots the row, a hold shows its Δ.
    keyHints.addEventListener('pointerdown', event => {
        if (!(event.target as HTMLElement).closest('[data-key="slot"]')) return;
        const free = [1, 2, 3].find(slot => !slots[slot]) ?? 1;
        press(free);
    });
    // A hold also ends when the pointer is lost or the window loses focus (a key released elsewhere never arrives).
    for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, () => { if (pressing && !screen.hidden) release(pressing.slot); });
    tableWrap.addEventListener('scroll', scheduleSide);
    /** The point under the pointer, if any (within 10 px). */
    function pointAt(event: MouseEvent): ScatterPoint | undefined {
        const box = scatter.getBoundingClientRect();
        const x = event.clientX - box.left, y = event.clientY - box.top;
        return points.reduce<{ point?: ScatterPoint; distance: number }>((best, point) => {
            const distance = Math.hypot(point.x - x, point.y - y);
            return distance < best.distance ? { point, distance } : best;
        }, { distance: 10 }).point;
    }
    // A point names its file where hints go, and as its tooltip.
    // The name sits next to the point at once (a native tooltip waits a second and can be missed).
    const pointTip = query<HTMLElement>('[data-entry-point-tip]');
    scatter.addEventListener('mousemove', event => {
        const point = pointAt(event);
        const name = point ? fileName(point.filePath) : '';
        scatter.title = name;
        pointTip.hidden = !point;
        if (!point) return;
        pointTip.textContent = name;
        pointTip.style.left = `${scatter.offsetLeft + point.x + 8}px`;
        pointTip.style.top = `${scatter.offsetTop + point.y - 18}px`;
        document.getElementById('hint-footer')?.replaceChildren(name);
    });
    scatter.addEventListener('mouseleave', () => { pointTip.hidden = true; });
    // A click on the strip goes to that file's row.
    overview.addEventListener('click', event => {
        const rows = model.rows.filter(row => !row.derived);
        const box = overview.getBoundingClientRect();
        // The strip's rows (top first) over the part of it on screen.
        const window = plotWindow('overview');
        const plotTop = box.top + OVERVIEW_MARGINS.top, plotHeight = box.height - OVERVIEW_MARGINS.top - OVERVIEW_MARGINS.bottom;
        const row = rows[Math.floor(((1 - window.y.end) + (event.clientY - plotTop) / Math.max(1, plotHeight) * (window.y.end - window.y.start)) * rows.length)];
        if (!row) return;
        focused = row.filePath; focusPicked = true; filter = 'all'; render();
        body.querySelector('.is-focused')?.scrollIntoView?.({ block: 'center' });
    });
    // A double click on a row slots it in the first free slot and opens the comparison, like 1 then Enter.
    body.addEventListener('dblclick', event => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('tr[data-file-path]');
        const path = row?.getAttribute('data-file-path');
        if (!path || !filePaths.includes(path)) return;
        if (!slots.slice(1).includes(path)) setSlot([1, 2, 3].find(slot => !slots[slot]) ?? 1, path);
        openSlotted();
    });
    scatter.addEventListener('click', event => {
        const box = scatter.getBoundingClientRect();
        const x = event.clientX - box.left, y = event.clientY - box.top;
        const nearest = points.reduce<{ point?: ScatterPoint; distance: number }>((best, point) => {
            const distance = Math.hypot(point.x - x, point.y - y);
            return distance < best.distance ? { point, distance } : best;
        }, { distance: 10 });
        if (nearest.point) {
            focused = nearest.point.filePath; focusPicked = true; filter = 'all'; render();
            // A point picked on the scatter brings its row to the middle of the table.
            body.querySelector('.is-focused')?.scrollIntoView?.({ block: 'center' });
        }
    });
    // The lanes' gestures on the side panel's plots: box zoom, Ctrl+wheel, Shift+wheel, double-click reset or
    // axis range. A press that stays put (within the lanes' 3 px) is still a click: a point picked, a row gone to.
    const zoomBox = document.createElement('div');
    zoomBox.className = 'entry-zoom-box';
    zoomBox.hidden = true;
    side.append(zoomBox);
    const rangePopover = installRangePopover(document, { rootId: 'entry-range-popover', badgeId: 'entry-range-axis-badge', idPrefix: 'entry-range', strings: rangePopoverStrings(strings), position: positionPopover });
    const plotName = (plot: HTMLElement): string => (plot === scatter ? 'scatter' : plot === overview ? 'overview' : 'held');
    const marginsOf = (plot: HTMLElement): PlotMargins => (plot === scatter ? SCATTER_MARGINS : plot === overview ? OVERVIEW_MARGINS : heldPlot?.margins ?? STAGE_MARGINS);
    const shownNumber = (value: number): string => String(Math.round(value * 1000) / 1000);
    attachPlotInteraction(side, document, '[data-entry-scatter], [data-entry-held-canvas], [data-entry-overview]', {
        locate(target, clientX, clientY) {
            const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-entry-scatter], [data-entry-held-canvas], [data-entry-overview]');
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
            if (!hit || (hit.plot === scatter && pointAt(event))) return;
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
            type Mapping = { at(fraction: number): number; of(value: number): number; label: string };
            const linear = ([low, high]: [number, number], label: string): Mapping => ({ at: f => low + f * (high - low), of: v => (v - low) / (high - low || 1), label });
            const mapping: Mapping | null = name === 'scatter' && scatterPlot ? (hit.axis === 'x' ? linear(scatterPlot.x, scatterPlot.xLabel) : linear(scatterPlot.y, scatterPlot.yLabel))
                : name === 'held' && heldPlot ? (hit.axis === 'x' ? { at: heldPlot.x, of: heldPlot.ofX, label: heldPlot.xLabel } : linear([heldPlot.range.min, heldPlot.range.max], heldPlot.yLabel))
                    : null;
            if (!mapping) return false;
            const window = plotWindow(name);
            const current = hit.axis === 'x' ? window.x : window.y;
            const set = (range: { start: number; end: number }): void => {
                plotWindows.set(name, hit.axis === 'x' ? { ...window, x: range } : { ...window, y: range });
                scheduleSide();
            };
            rangePopover.open({
                axisLabel: mapping.label, horizontal: hit.axis === 'x',
                min: shownNumber(mapping.at(current.start)), max: shownNumber(mapping.at(current.end)),
                clientX, clientY,
                apply(min, max) {
                    const start = min === null ? 0 : mapping.of(min), end = max === null ? 1 : mapping.of(max);
                    if (!(end > start)) return strings.specRangeErrorMinMax;
                    set({ start: Math.max(0, Math.min(1, start)), end: Math.max(0, Math.min(1, end)) });
                },
                auto() { set({ start: 0, end: 1 }); },
            });
            return true;
        },
    });
    screen.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        const chip = target.closest<HTMLElement>('[data-action="entry-slot"]');
        // A click without a pointer (Enter or Space on the chip) is a tap.
        if (chip && (event as MouseEvent).detail === 0) {
            const slot = Number(chip.getAttribute('data-slot'));
            press(slot);
            release(slot);
            return;
        }
        const action = target.closest<HTMLElement>('[data-action]');
        if (action && action.tagName !== 'SELECT' && actions[action.getAttribute('data-action')!]) {
            actions[action.getAttribute('data-action')!](action);
            return;
        }
        const row = target.closest<HTMLElement>('tr[data-file-path]');
        if (row) { focused = row.getAttribute('data-file-path'); focusPicked = true; render(); }
    });
    screen.addEventListener('change', event => {
        const target = event.target as HTMLElement;
        if (target === axisX || target === axisY) {
            if (target === axisX) xAxisId = axisX.value; else yAxisId = axisY.value;
            scheduleSide();
            return;
        }
        if (target.getAttribute('data-action') === 'entry-band') {
            band = Number((target as HTMLSelectElement).value);
            sort = 'band';
            rebuild();
            return;
        }
        const column = target.getAttribute('data-entry-column');
        if (column !== null && draft) {
            const index = Number(column);
            const checked = (target as HTMLInputElement).checked ? [...draft.checked, index].sort((a, b) => a - b) : draft.checked.filter(item => item !== index);
            draft = { ...draft, checked };
            showDraft();
        }
    });
    // A table dropped onto the screen is read like the folder's metadata file; the host never sees it as a source.
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
        void file.arrayBuffer().then(bytes => {
            const parsed = parseTable(decodeTableText(new Uint8Array(bytes)));
            if (parsed) applyConditions(resolveTable(parsed, filePaths, rootPath, file.name).table);
        });
    });
    paste.addEventListener('input', () => {
        const parsed = parseTable(paste.value);
        draft = parsed ? resolveTable(parsed, filePaths, rootPath).table : null;
        showDraft();
    });

    // Capture phase on the window runs before the lane view's document listeners, which never see these keys.
    /** Maximized, the table takes every key; in the side panel, only keys pressed while it has the focus. */
    const keysHere = (event: Event): boolean => !screen.hidden && (maximized || screen.contains(event.target as Node));
    window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (!keysHere(event)) return;
        // The step bar's fields take their own keys (digits, Enter, Esc).
        if ((event.target as Element | null)?.closest?.('[data-step-bar], #entry-range-popover')) return;
        // Immediate, so the other screen's listener does not act on a key that just switched screens.
        event.stopImmediatePropagation();
        if (!dialog.hidden) {
            if (closesEntryDialog(event)) { event.preventDefault(); closeDialog(); }
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^[0-3]$/.test(event.key)) {
            event.preventDefault();
            if (!event.repeat) press(Number(event.key));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            openSlotted();
        } else if (closesEntryDialog(event)) {
            event.preventDefault();
            // Esc closes the innermost thing: the settings form, then a filter; then the maximized table shrinks
            // into the side panel, and the side panel's hands the keys back to the lanes.
            if (stepBar.close()) return;
            if (filter !== 'all') { filter = 'all'; render(); return; }
            if (maximized) { setMaximized(false); return; }
            (document.activeElement as HTMLElement | null)?.blur?.();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        } else if (/^[a-z_]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            typeAhead(event.key);
        }
    }, true);
    /** Letters typed in a row jump to the next file whose name starts with them, as in a file list. */
    let typed = '';
    let typedAt = 0;
    function typeAhead(key: string): void {
        const now = window.performance.now();
        typed = (now - typedAt < 800 ? typed : '') + key.toLowerCase();
        typedAt = now;
        const visible = Array.from(body.querySelectorAll<HTMLElement>('tr[data-file-path]'));
        const names = visible.map(row => row.querySelector('.entry-name')?.textContent?.toLowerCase() ?? '');
        const from = Math.max(0, visible.findIndex(row => row.getAttribute('data-file-path') === focused));
        const order = [...names.keys()].map(offset => (from + (typed.length > 1 ? 0 : 1) + offset) % names.length);
        const hit = order.find(index => names[index].startsWith(typed));
        if (hit === undefined) return;
        focused = visible[hit].getAttribute('data-file-path');
        focusPicked = true;
        render();
    }
    window.addEventListener('keyup', (event: KeyboardEvent) => {
        if (!keysHere(event)) return;
        if ((event.target as Element | null)?.closest?.('[data-step-bar], #entry-range-popover')) return;
        // Immediate, so the other screen's listener does not act on a key that just switched screens.
        event.stopImmediatePropagation();
        if (/^[0-3]$/.test(event.key)) release(Number(event.key));
    }, true);

    return {
        open(paths: string[], root = '', maximize = true): void {
            filePaths = paths.slice();
            rootPath = root;
            added.clear();
            folded.clear();
            knownShortest = undefined;
            conditions = null;
            checkedOverride = undefined;
            results.clear();
            resultKeys.clear();
            knownRate = undefined;
            const saved = deps.loadSlots() ?? [];
            slots = [0, 1, 2, 3].map(slot => (saved[slot] && filePaths.includes(saved[slot]!) ? saved[slot]! : null));
            focused = null; focusPicked = false; band = undefined; filter = 'all'; delta = false; expanded = false;
            derived = (deps.loadDerived?.() ?? []).filter(row => filePaths.includes(row.parentPath));
            const savedRecipe = deps.loadRecipe?.();
            editedRecipe = isRecipeChain(savedRecipe) ? savedRecipe : null;
            if (savedRecipe !== undefined && savedRecipe !== null && !editedRecipe) { deps.saveRecipe?.(undefined); deps.announce(strings.stepRecipeWarning); }
            screen.hidden = false;
            // A folder just opened is looked at first: the table over the whole window.
            setMaximized(maximize);
            scan();
            openRequest = requests.pending('scan')?.requestId ?? '';
            rebuild();
            table.setAttribute('tabindex', '0');
            table.focus?.();
        },
        isOpen: () => !screen.hidden && maximized,
        setMaximized: next => { if (!screen.hidden) setMaximized(next); },
        hasFocus: () => !screen.hidden && screen.contains(document.activeElement),
        addFiles(paths) {
            const fresh = paths.filter(path => !filePaths.includes(path));
            if (!fresh.length) return;
            if (screen.hidden) {
                // Nothing was listed: the table starts in the side panel with these files.
                this.open(fresh, '', false);
                fresh.forEach(path => added.add(path));
                render();
                return;
            }
            fresh.forEach(path => added.add(path));
            filePaths = [...filePaths, ...fresh];
            scan();
            rebuild();
        },
        tracksChanged: () => { if (!screen.hidden) render(); },
        trackRemoved(filePath) {
            const slot = slots.indexOf(filePath);
            if (slot >= 0) setSlot(slot, null, false); else if (!screen.hidden) render();
        },
        setRecipe,
        stepFailed,
        addDerived(row: DerivedRow): void {
            derived = [...derived.filter(item => derivedKey(item) !== derivedKey(row)), row];
            deps.saveDerived?.(derived);
            rebuild();
        },
        removeDerived(parentPath: string, region: string, baseLabel?: string): void {
            derived = derived.filter(item => item.parentPath !== parentPath || item.region !== region || (baseLabel !== undefined && (item.base.label ?? '') !== baseLabel));
            deps.saveDerived?.(derived);
            rebuild();
        },
        show(next: (string | null)[]): void {
            slots = next.slice();
            screen.hidden = false;
            setMaximized(true);
        },
        handle(message): boolean {
            if (message.type.startsWith('compare-')) return handleRow(message as ComparePublication) || holdSource.handle(message) || handleRemeasure(message as ComparePublication);
            if (!message.type.startsWith('entry-')) return false;
            const publication = message as EntryPublication;
            // A scan stopped with "Cancel" sends nothing more that counts.
            if (!requests.answering('scan', publication.requestId) || (!scanning && publication.type !== 'entry-conditions')) return true;
            if (publication.type === 'entry-conditions') {
                if (publication.recipe) standardRecipe = publication.recipe;
                // Only a scan of the whole folder reports its metadata file; a re-ordered rest keeps what it read.
                if (publication.requestId === openRequest) { conditions = publication.table; checkedOverride = undefined; }
                if (publication.metadataPath) filePaths = filePaths.filter(path => path !== publication.metadataPath);
                rebuild();
            }
            else if (publication.type === 'entry-scan-result') {
                results.set(publication.filePath, publication.result);
                resultKeys.set(publication.filePath, requests.find(publication.requestId)?.key ?? currentKey());
                scanCount++;
                if (scanCount >= 5) perFileMs = (window.performance.now() - scanStarted) / scanCount;
                const { failedStep, reason } = publication.result;
                if (failedStep) { stepFailed(failedStep, reason ?? ''); return true; }
                // Holding 0 freezes the order; the new row joins when the key is released.
                scheduleRebuild();
            } else if (publication.type === 'entry-scan-done') {
                if (redrawTimer !== undefined) { window.clearTimeout(redrawTimer); redrawTimer = undefined; }
                requests.settle(publication.requestId);
                scanning = false;
                remeasureStale();
                rebuild();
                // The band the table opened on stays put from now on: a new Recipe or condition does not swap it silently.
                if (band === undefined) band = model.band;
            }
            return true;
        },
        compareData: () => compareData(),
        slots: () => slots.slice(),
        basePaths(comparePath, group = false) {
            if (slots[0] && !group) return [slots[0]];
            const row = model.rows.find(item => item.filePath === comparePath);
            return (row?.group ? model.groups.get(row.group) ?? [] : []).map(member => member.filePath).filter(path => path !== comparePath);
        },
        baseTitle(comparePath, group = false) {
            if (slots[0] && !group) return `${strings.entryBase} · ${fileName(slots[0])}`;
            const row = model.rows.find(item => item.filePath === comparePath);
            const members = (row?.group ? model.groups.get(row.group) ?? [] : []).filter(member => member.filePath !== comparePath);
            return `${strings.entryBaseGroup} ${[...(row?.conditions ?? []), strings.entryBaseMedian.replace('{count}', String(members.length))].join(' · ')}`;
        },
        showCompared() {
            if (!slots.slice(1).some(path => path && filePaths.includes(path))) return;
            filter = 'compared'; render(); tableWrap.scrollTop = 0;
        },
        recipes() {
            const recipe = editedRecipe ?? standardRecipe;
            return recipe ? { recipe, runRecipe: runRecipe() } : null;
        },
        snapshot: () => ({
            open: !screen.hidden && maximized, docked: !screen.hidden && !maximized, cols: Number(screen.dataset.cols ?? 0), rows: model.rows.length, scanned: results.size, slots: slots.slice(), delta,
            band: bandLabel(model.band), outliers: model.rows.filter(isOutlierRow).length,
        }),
    };
}
