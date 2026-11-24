/**
 * The comparison (the track view's "steps" mode): the tracks shown as one step of the scan Recipe, the step chosen
 * on a step bar above them. Tracks keep the entry table's roles: slot 0 (or the compared file's condition, as a
 * median) is the base, blue; slots 1–3 yellow, purple, magenta.
 *
 * Every figure here is a Figure (docs/figure-list.md): this file decides WHAT is compared
 * (the step, the recordings, their roles, the scans to ask) and hands it to screens/compareOverlay.ts and
 * screens/triggerLanes.ts, which declare the figure (charts/) and show the figure service's one picture in a Figure
 * (figure/). Overlaid (the default) the base and the tracks are lines of one Figure with their Δ lane under it on
 * request; a lane a recording otherwise; images are always a lane a recording. With no figure to show it says why in
 * one message line. It draws nothing itself and reads no value.
 *
 * Each recording's scan (stageSource.ts) describes the step's result (stage_view.py `describe`: its Frame, kind,
 * axes, events, level identity) and names the key of its kept answer (`data`), with no drawn point.
 */
import { secondsSpanText } from '../shell/numberText';
import type { UiStrings } from '../../shared/i18n/strings';
import type { CompareScanMessage } from '../../shared/analysis/entryScan';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import type { ReportFigure } from './compareReport';
import { brokenStep, recipeChain, recipeKey, recipeSteps, TIME_SLICE, TRIGGER, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { eventsKey, excludedOf, withDroppedEvents, withEventExcluded, type EventDrop } from '../../shared/recipe/eventExclusion';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { createStepBar, invalidReason, stepChipLabel, stepLimits, INPUT_STAGE } from './stepBar';
import { createStageSource, type StageSpec } from './stageSource';
import { pictureSummary } from './pictureSummary';
import { chosenStage, comparedPath as comparedPathOf, enterStageState, holdStageSpec, initialStageState, liveRegion as liveRegionOf, openStageState, stageSpec, watchedChannel, WHOLE_ZOOM } from './trackStageModel';
import { colorOf, emptyStageText, overlayLegendItems, paintBaseGate, paintStageControls, stageDom, stageModeHeadline, writeStageLegend, type StageTrack } from './trackStagePainter';

export type { StageTrack } from './trackStagePainter';
import { pairLevelFrame, pictureLevelOf, type ExclusionReason, type FigureSet } from './figureModel';
import { zoomNormalizedRange, ZOOM_IN_FACTOR } from './waveformInteraction';
import { keyRouterFor } from '../shell/keyRouter';
import { COMPARE_KEYS, keyAction } from './shortcuts';
import { legendHtml, type LegendItem } from './comparePanes';
import type { LevelInput } from './figureModel';
import { regionLabel } from './compareBasics';
import { baseName } from '../../shared/analysis/entryMetadata';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import type { RegionPeak } from './regionPeak';
import type { FigureAnswers } from '../answers/figureRequests';
import { figureKey } from '../answers/figureKeys';
import { createTriggerLanesScreen } from '../screens/triggerLanes';

/** The least height (px) a recording's lane under a trigger's events has, with the gap to the next. */
const LANE_ROOM_PX = 122;
import { createCompareOverlayScreen } from '../screens/compareOverlay';
import { FigureExportDropped, type FigureKey } from '../figure/index';
import { uncalibratedUnits } from '../../shared/utils/format';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { countedSet } from './figureModel';
import { csvFile } from '../../shared/utils/csv';

/** How many pictures in a row that lack a kept answer have its scan asked again (trackStageMode `askedAgain`). */
const LET_GO_ROUNDS = 2;

/** The size the spectrum overlay's PNG is drawn at (CSS px; with Δ, its lane takes its share of the height). */
const FIGURE_PNG_SIZE = { width: 1200, height: 700 };
import { rangePopoverStrings } from '../../shared/i18n/strings';

/** The roles' colours: the base blue, slots 1–3 yellow, purple, magenta (as their cards and badges). */

/** What a line the new path's Figure draws is over, and what it measures (transport/figure_answers.py LINE_MODES). */
const FIGURE_ACROSS = ['frequency', 'time', 'quefrency', 'lag', 'band'];
const FIGURE_QUANTITIES = ['level', 'gain', 'value', 'coherence', 'cepstrum', 'correlation'];
/**
 * The steps the new path's Figure draws overlaid: lines over one axis (a spectrum, a metric or a level over time, a
 * cepstrum, and a channel pair's coherence, transfer function, cross spectrum and cross-correlation), and the sound
 * itself (time signals, a band each), and the levels of 1/N-octave bands (bars). Not yet: a trigger's events.
 */
/** A time signal: a description says so (`signal`); it carries no waveform to tell it by. */
const isSignal = (view: StageView): boolean => !!view.signal;
const figureSignal = (view: StageView): boolean => view.kind === 'line' && isSignal(view) && !view.events && !/Segments$/.test(view.frame);
const figureLines = (view: StageView): boolean => figureSignal(view) || ((view.kind === 'line' || view.kind === 'bar') && !isSignal(view) && !view.events && !/Segments$/.test(view.frame)
    && FIGURE_ACROSS.includes(view.x ?? '') && FIGURE_QUANTITIES.includes(view.quantity ?? ''));
/** The Frames that are such lines whatever their picture, known before any picture is in (a ChannelFrame is the sound itself or a series over time: its picture says which, and both are the Figure's). */
const FIGURE_FRAMES = new Set([INPUT_FRAME, 'SpectralFrame', 'NOctFrame', 'CepstralFrame', 'CoherenceFrame', 'TransferFunctionFrame', 'CrossSpectralFrame', 'CrossCorrelationFrame']);


export interface TrackStageDeps {
    document: Document;
    window: Pick<Window, 'setTimeout' | 'requestAnimationFrame' | 'clearTimeout' | 'addEventListener'> & { performance: Pick<Performance, 'now'> };
    /** Watches the plots' own size: any layout change that resizes one (Δ, the step bar, a wrapped legend) draws it again. */
    ResizeObserver?: typeof ResizeObserver;
    strings: UiStrings;
    /** Scans only: the comparison asks for no combination here (its median, Δ and reads are the figure service's). */
    post(message: CompareScanMessage): void;
    /** The Recipe the entry table scans with, and the one its scans run (the steps that cannot run left out). */
    recipe(): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
    recipeChanged(recipe: RecipeDocument): void;
    /** The tracks on screen, in display order. */
    tracks(): StageTrack[];
    /** The entry table's slots 0–3, the base of a compared file and its name. */
    slots(): (string | null)[];
    basePaths(comparePath: string, group?: boolean): string[];
    /** The base group's recordings left out by the table's answers (another reference or axis), with why. */
    baseLeft?(comparePath: string, group: boolean): ReadonlyArray<{ path: string; reason: ExclusionReason }>;
    /** How many channels a file has (the table's rows of it): the spectrum overlay's keys say it to the figure service. */
    channelCount?(path: string): number | undefined;
    /** The base's title, with `more` of its recordings left out (a step picture failed, empty or on its way). */
    /**
     * The base's heading for the step figure's one set (entryBase.heading): its name and n, and who is left out why;
     * null while the group is not analysed here (gated): the base's name alone.
     */
    baseHeading(comparePath: string, group: boolean, set: FigureSet | null, each?: boolean): string;
    /** The channel a file is drawn with when `comparePath` is compared: a slot's channel row, the base's members of that channel. */
    stageChannel?(path: string, comparePath: string | null, group?: boolean): number | null;
    /** How much audio these files are (seconds) and about how long analysing them takes (ms). */
    cost?(paths: readonly string[]): { seconds: number; ms: number };
    /** A file's name as the table has it (with its channel), its value on show and its memo, for the legend. */
    rowInfo?(path: string): { label: string; value: string; memo: string };
    /** A file's role chip for the legend (roleChip.ts): its role set from the comparison. */
    roleChip?(path: string): string;
    /** Lists the compared files and their base on the entry table (its "Compared" filter). */
    showCompared(): void;
    /** Whether the track view is the screen in front (the entry table not over it). */
    inFront(): boolean;
    /** Esc: back to where the comparison was opened from (the tracks, or the entry table). */
    back(): void;
    /** ▶ in the legend, or Space: plays the recording itself, over the region when one is set (■ stops it). */
    play?(path: string, region: EntryRegion | null): void;
    /** The recording playing, for the legend's ■. */
    playing?(): string | null;
    /** 「レシピをまとめて書き出す」: the chain taken out for the table's rows (its choice of rows opens on the table). */
    batch?(): void;
    /**
     * 報告に: the comparison written as a report folder (its slots, bases, memos and chain, over the region). Called at
     * the click with what the figure on show is of (the base it is measured against, the step it shows): the words
     * are taken then, and the function it returns writes the folder with the figure once its exports have come
     * (null: none is drawn, a folder of words). So the words and the figure of a folder are of one moment.
     */
    report(region: EntryRegion | null, shown: { groupBase: boolean; stage: string | null; compared: string | null }): (figure: ReportFigure | null) => void;
    sampleRate(): number | undefined;
    /**
     * What a file's pictures depend on beyond their spec: its version and calibration (stageSource.stageBasis). A
     * change asks its pictures again, so a picture of an earlier calibration or version is never drawn or read.
     */
    basis?(filePath: string): string;
    /**
     * The largest peak of the compared channels over the region, in their unit, read from every sample (regionPeak.ts):
     * where a new trigger starts (half of it). Calling it asks the backend for the samples, so it is called only when
     * the step bar can add a trigger (StepBarState.peak), never on a repaint.
     */
    peak?(region: EntryRegion | null): RegionPeak | undefined;
    /**
     * A step failed on a file (the scan names it): its chip is marked ⚠ with wandas' reason, as when the entry
     * table's scan fails there, so the plot says why rather than drawing nothing.
     */
    stepFailed?(step: string, reason: string): void;
    /** The fewest channels of the compared files: a step that compares two channels needs two. */
    channels?(): number | undefined;
    /** Shows or hides the track lanes (hidden while overlaid). */
    showLanes(visible: boolean): void;
    /**
     * The page's figure requests (answers/): every figure of the comparison is drawn by a Figure through them
     * (figure-design.md 第 4 節).
     */
    figures: FigureAnswers;
    rerender(): void;
    hint(text: string): void;
    /** A short notice that stays a moment (the task status): what an edit did besides what was asked. */
    notify?(text: string): void;
    /** The task status while something asked for runs (the report's files measured), until the next notice. */
    busy?(text: string): void;
    /** The task status when what was asked could not be done (a report whose files could not be measured). */
    failed?(text: string): void;
    /** Hands the user a file of the comparison (the spectrum overlay's PNG, a data URL, or its CSV text). */
    saveFile?(file: { name: string; kind: 'png'; dataUrl: string } | { name: string; kind: 'csv'; text: string }): void;
}

export interface TrackStageMode {
    /** The step bar, the layout controls and the overlaid plot, shown above the tracks while the mode is on. */
    root: HTMLElement;
    /** The step bar alone (kept for tests). */
    bar: HTMLElement;
    active(): boolean;
    setActive(on: boolean): void;
    paint(): void;
    handle(message: { type: string }): boolean;
    attach(surface: HTMLElement): void;
    /** Takes off its key context, its plots' gestures and its step bar's keys (the clean-up promise of keyRouter and attachPlotInteraction). */
    dispose(): void;
    /** The track's role: 0 the base, 1–3 a slot; undefined for a track not slotted. */
    role(filePath: string): number | undefined;
    /** Opens the mode for a comparison from the entry table, on `stage` (the chain's end without one). */
    open(stage?: string): void;
    /** The tracks' selection (s) taken as the region, once, when the chain has none yet. */
    importRegion(range: EntryRegion): void;
    /** Puts an opened Recipe in the step bar as one edit (↶ brings the chain before it back) and shows its end. */
    openRecipe(recipe: RecipeDocument, said: string): void;
    /** Writes the comparison as a report folder. */
    report(): void;
    /**
     * The spectrum overlay's PNG or CSV, from the figure service (the new path); a hint where there is none. Reached from
     * the tests only (the test action `export-figure`): offering it in the menu waits for a product decision (the
     * comparison screen's feature freeze).
     */
    exportFigure(kind: 'png' | 'csv'): void;
    /** What the comparison shows, for tests. */
    snapshot(): TrackStageSnapshot;
}

export interface TrackStageSnapshot {
    open: boolean;
    comparing: string | null;
    base: string | null;
    headline: string;
    stage: string | null;
    frame: string | null;
    kind: string | null;
    /** The compared file's picture: how many points have a value, and their median. */
    stageValues: number;
    stageMedian: number | null;
    /** Steps of the chain marked as left out (orange !). */
    invalidSteps: number;
}

/** A press shorter than this is a tap (compare that slot); longer is a hold (compare it until released), as on the entry table. */
const TAP_MS = 250;

/** A base group of more recordings than this, or more audio (s), is not scanned for the comparison's pictures until the user asks. */
export const LARGE_BASE = 30;
export const LARGE_BASE_S = 30 * 60;

/** The Frames drawn as images (stage_view.py's heatmaps): they are not overlaid, each stays in its track's lane. */
const IMAGE_FRAMES = new Set(['SpectrogramFrame', 'CepstrogramFrame', 'RoughnessFrame']);


export function createTrackStageMode(deps: TrackStageDeps): TrackStageMode {
    const { strings, document } = deps;
    const state = initialStageState();
    const limits = (): StepLimits => stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.(), failed: deps.recipe()?.failed });
    /** The part of the files compared: the region chip's, unless it is bypassed. */
    const liveRegion = (): EntryRegion | null => liveRegionOf(deps.recipe()?.recipe, state.regionSet);
    const basis = (filePath: string): string => deps.basis?.(filePath) ?? '';
    const source = createStageSource('track-stage', message => deps.post(message), () => deps.rerender(), basis);
    const stepBar = createStepBar({
        document, strings, mode: 'compare',
        onChange: recipe => deps.recipeChanged(recipe),
        notify: text => deps.notify?.(text),
        onStepSelect: step => { state.stage = step.id; Object.assign(state, WHOLE_ZOOM); deps.rerender(); },
        // A step added or moved is shown at once: its result is what the user wants to see next.
        onStepShown: id => { state.stage = id; Object.assign(state, WHOLE_ZOOM); deps.rerender(); },
        // Holding a step shows the picture on screen without it (the step before it, when it is the one on screen).
        canHold: step => !!holdSpec(step),
        onStepHold: step => { state.heldStep = step; deps.rerender(); },
        onRegionSet: next => { state.regionSet = next; Object.assign(state, WHOLE_ZOOM); deps.rerender(); },
        onInputSelect: () => { state.stage = INPUT_STAGE; Object.assign(state, WHOLE_ZOOM); deps.rerender(); },
        presets: true,
    });
    stepBar.element.classList.add('track-stage-bar');
    const root = document.createElement('div');
    root.className = 'track-stage';
    root.hidden = true;
    root.innerHTML = `<div class="track-stage-controls">`
        + `<button type="button" class="tb-btn" data-action="stage-layout" aria-pressed="true">${escapeHtml(strings.stageLayoutSide)}</button>`
        + `<button type="button" class="tb-btn" data-action="stage-diff" aria-pressed="false">${escapeHtml(strings.compareDiffShow)}</button>`
        + `<span class="compare-value track-stage-headline" data-stage-headline></span>`
        + `<span class="track-stage-gate" data-stage-base-gate hidden><button type="button" class="tb-btn" data-action="stage-base-scan"></button></span>`
        // The pointer's readout on the plots below (R7): in this row above them, as the cursor spectrum's is in its header.
        + `<span class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span></div>`
        + `<div class="track-stage-panel" data-stage-panel>`
        + `<div class="compare-pane-head compare-legend" data-stage-legend></div>`
        + `<div class="track-stage-base-info" data-stage-base-info hidden><div data-stage-base-aggregate>${escapeHtml(strings.stageBaseAggregate)}</div>`
        + `<button type="button" class="tb-link" data-action="stage-base-list">${escapeHtml(strings.stageBaseList)}</button></div>`
        // Where the Figure draws nothing (files on their way, a step that cannot run, a trigger with no event): the reason, in words.
        + `<div class="track-stage-message" data-stage-message role="status" hidden></div>`
        // The spectrum overlay and its Δ lane, one Figure (screens/compareOverlay.ts), in place of the two canvases.
        + `<div class="track-stage-figure-head" data-stage-figure-head hidden><span class="compare-value" data-stage-figure-headline></span></div>`
        + `<div class="track-stage-figure" data-stage-figure hidden></div>`
        // Under a trigger's events, each recording as the trigger takes it: a Figure of its own (screens/triggerLanes.ts),
        // its readout row just above it (R7, R13) and each event's controls over it.
        + `<div class="track-stage-lanes-row" data-stage-lanes-figure-head hidden><span class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span></div>`
        + `<div class="track-stage-figure track-stage-lanes-figure" data-stage-lanes-figure hidden></div>`
        + `</div>`;
    root.prepend(stepBar.element);
    const dom = stageDom(root, stepBar.element);
    const { query, panel } = dom;
    // The comparison's Figure (screens/compareOverlay.ts): the overlay and its Δ lane, or a lane a recording; under a
    // trigger's events, a second Figure of the recordings as the trigger takes them (screens/triggerLanes.ts).
    /** The event's line the Figure's pointer reads now (a trigger's events on the new path), or none. */
    let figureEvent: { out: boolean } | null = null;
    /**
     * A picture counted kept answers as let go (the backend's store made room): the scans they came with are forgotten
     * and asked again, for at most LET_GO_ROUNDS pictures in a row that lack an answer (answers too many to be kept
     * together would otherwise be asked for in turn, for ever); a picture that holds every answer it declares starts
     * the count again. The recording stays counted as left out meanwhile.
     */
    const askedAgain = (): ((keys: readonly string[]) => void) => {
        let rounds = 0;
        return keys => {
            if (!keys.length) { rounds = 0; return; }
            if (rounds >= LET_GO_ROUNDS) return;
            rounds += 1;
            source.forgetData(keys);
            deps.rerender();
        };
    };
    const overlayScreen = createCompareOverlayScreen({
        document, host: query<HTMLElement>('[data-stage-figure]'), readout: query<HTMLElement>('.track-stage-controls [data-plot-readout]'), headlineHost: query<HTMLElement>('[data-stage-figure-headline]'),
        zoomAttributes: root, drawnAttribute: stepBar.element, legendElement: query<HTMLElement>('[data-stage-legend]'),
        // Where the pointer is says what it can do there, as on every plot of the comparison.
        // (On an event's line of a trigger's, what a click on it does.)
        hint: where => { if (where) deps.hint(where !== 'plot' ? strings.compareHintAxis : figureEvent ? (figureEvent.out ? strings.stageEventClickIn : strings.stageEventClickOut) : strings.compareHintPlot); },
        // The UI's strings, by the names the Figure's words have (figure.ts FigureWords).
        answers: deps.figures, words: { ...strings, range: rangePopoverStrings(strings) }, leftOtherReference: strings.stageLeftOtherReference, label: strings.ariaStageOverlayCanvas, ...(deps.ResizeObserver ? { ResizeObserver: deps.ResizeObserver } : {}),
        // The Figure's range goes with the comparison's zoom it was set under: a zoom of every plot back to the whole
        // (WHOLE_ZOOM: a step or the region changed, the comparison opened) puts another window in its place.
        zoom: () => state.window,
        freshZoom: () => { state.window = { ...state.window }; return state.window; },
        wholeZoom: () => { Object.assign(state, WHOLE_ZOOM); lanesScreen.reset(); deps.rerender(); },
        rerender: () => deps.rerender(),
        letGo: askedAgain(),
    });
    /** The lanes under a trigger's events on the new path: a Figure of its own (the recording's time across). */
    let figureLanesWindow = '0.000-1.000 0.000-1.000';
    const lanesScreen = createTriggerLanesScreen({
        document, host: query<HTMLElement>('[data-stage-lanes-figure]'), readout: query<HTMLElement>('[data-stage-lanes-figure-head] [data-plot-readout]'),
        hint: where => { if (where) deps.hint(where !== 'plot' ? strings.compareHintAxis : strings.compareHintPlot); },
        answers: deps.figures, words: { ...strings, range: rangePopoverStrings(strings) }, strings, label: strings.ariaStageOverlayCanvas, ...(deps.ResizeObserver ? { ResizeObserver: deps.ResizeObserver } : {}),
        // A reset is every plot's (R13): the events' plot above goes back to its whole too.
        wholeZoom: () => { Object.assign(state, WHOLE_ZOOM); deps.rerender(); },
        letGo: askedAgain(),
        drawn: (lanes, part) => { figureLanesWindow = `${part.x} ${part.y}`; if (lanesScreen.shown()) { root.dataset.lanesMarked = String(lanes); root.dataset.lanesWindow = figureLanesWindow; } },
    });
    /** What the panel says where the Figure has nothing to draw: files on their way, or why there is no picture. */
    const said = query<HTMLElement>('[data-stage-message]');
    const say = (text: string): void => { said.textContent = text; said.hidden = false; };
    const sayNothing = (): void => { said.hidden = true; said.textContent = ''; };
    /**
     * The spectrum overlay's PNG or CSV, of the picture on screen (its data id, in the file's name): the PNG drawn by a
     * Figure of its own at a fixed size, the CSV every answer unthinned (第 6 節). Answers changed since the picture: the
     * comparison is drawn again and nothing is written.
     */
    /** An export that wrote nothing says why (and the comparison is drawn again when its answers changed). */
    const refused = (status: string): void => {
        if (status === 'changed') { deps.failed?.(strings.stageExportChanged); deps.rerender(); return; }
        deps.failed?.(status === 'none' ? strings.stageExportNone : status === 'too-large' ? strings.stageTooLarge : strings.stageCombineFailed);
    };
    // An export never answered: a newer one took its place, whose own word follows,
    // so nothing is said of this one; or the Figure went with the overlay (the step changed, the screen left):
    // nothing is drawn to write. Any other failure is the export's failure. None is left unhandled.
    const dropped = (error: unknown): void => {
        if (error instanceof FigureExportDropped && error.reason === 'superseded') return;
        refused(error instanceof FigureExportDropped ? 'none' : 'failed');
    };
    function exportFigure(kind: 'png' | 'csv'): void {
        const screen = overlayScreen;
        if (!screen.shown() || !deps.saveFile) { deps.failed?.(strings.stageExportNone); return; }
        deps.busy?.(kind === 'png' ? strings.exportPngBusy : strings.exportCsvBusy);
        const named = (dataId: string, extension: string): string => `spectrum-overlay_${dataId}.${extension}`;
        if (kind === 'png') {
            void screen.exportPng(FIGURE_PNG_SIZE).then(result => {
                if (result.status !== 'png') { refused(result.status); return; }
                const name = named(result.dataId, 'png');
                deps.saveFile?.({ name, kind: 'png', dataUrl: result.dataUrl });
                deps.notify?.(strings.exportPngDone.replace('{name}', name));
            }, dropped);
            return;
        }
        void screen.exportCsv().then(result => {
            if (result.status !== 'rows') { refused(result.status); return; }
            const name = named(result.dataId, 'csv');
            deps.saveFile?.({ name, kind: 'csv', text: csvFile(result.header, result.rows) });
            deps.notify?.(strings.exportCsvDone.replace('{name}', name));
        }, dropped);
    }
    /** The Figure let go (nothing for it to draw, or the comparison left): disposed, its holdings released. */
    const leaveFigure = (): void => {
        root.dataset.figure = 'false';
        root.dataset.figureRows = 'false';
        if (!overlayScreen.shown()) return;
        overlayScreen.hide();
        query<HTMLElement>('[data-stage-figure-head]').hidden = true;
    };
    /**
     * The comparison written as a folder (the toolbar's 書き出し menu): a chain that cannot run has no values to report.
     * With the figure on show, as its own exports write it (exportFigure): its PNG and the table of its lines, of the
     * one data id the screen's picture has. A figure that cannot be written (not drawn yet, its answers changed, too
     * large) writes no folder and says why, as its own export does; no figure on show, a folder of words.
     */
    function report(): void {
        const recipe = deps.recipe()?.recipe;
        if (recipe && brokenStep(recipe, limits())) { deps.hint(strings.stepOctaveBroken); return; }
        const screen = overlayScreen;
        // The words now (the slots, the base, the chain and its step shown): never those of a later comparison.
        // (The figure's lines share one base, the active comparison's: every row of the report is written against it.
        // The input shown is no step of the Recipe: said as none.)
        const stage = chosen();
        const write = deps.report(liveRegion(), { groupBase: state.groupBase, stage: stage === INPUT_STAGE ? null : stage, compared: comparedPath(deps.tracks()) });
        if (!screen.shown()) { write(null); return; }
        deps.busy?.(strings.exportPngBusy);
        void Promise.all([screen.exportPng(FIGURE_PNG_SIZE, 'report'), screen.exportCsv()]).then(([png, table]) => {
            if (png.status !== 'png') { refused(png.status); return; }
            if (table.status !== 'rows') { refused(table.status); return; }
            if (table.dataId !== png.dataId) { refused('changed'); return; }
            write({
                dataId: png.dataId,
                png: png.dataUrl.slice(png.dataUrl.indexOf(',') + 1),
                table: table.header.length ? { header: table.header, rows: table.rows } : null,
            });
        }, dropped);
    }
    root.addEventListener('click', event => {
        const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
        if (action === 'stage-layout') { state.overlaid = !state.overlaid; deps.rerender(); }
        else if (action === 'stage-diff') { state.showDiff = !state.showDiff; deps.rerender(); }
        else if (action === 'compare-play') { const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path; if (path) deps.play?.(path, liveRegion()); }
        // A large base group is scanned only when asked (a folder of 10,000 files is not analysed by opening a comparison).
        else if (action === 'stage-base-scan') { if (state.gateKey) state.baseAllowed.add(state.gateKey); deps.rerender(); }
        // The base group's ▾ says how its curve is made; "list" shows its files on the table.
        else if (action === 'stage-base-info') { const info = query<HTMLElement>('[data-stage-base-info]'); info.hidden = !info.hidden; }
        else if (action === 'stage-base-list') { query<HTMLElement>('[data-stage-base-info]').hidden = true; deps.showCompared(); }

    });
    // A lane's event mark: ▶ plays that event of the recording (its length from its pre-trigger), × leaves it out, ↺ puts it back.
    document.addEventListener('click', event => {
        const button = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-action="stage-event-play"], [data-action="stage-event-toggle"]');
        const path = button?.dataset.path;
        const id = Number(button?.dataset.event);
        if (!state.on || !button || !marks || !path || !Number.isInteger(id)) return;
        if (button.dataset.action === 'stage-event-toggle') { toggleEvent({ id, source: path, out: button.dataset.out === 'true' })?.(); return; }
        const cut = marks.events(path)?.find(item => item.id === id);
        if (!cut || !deps.play) return;
        const start = Math.max(0, cut.time - marks.trigger.pre);
        deps.play(path, { start, end: start + marks.trigger.duration });
    });
    /** The compared file: the slot held or tapped, else the first slot among the tracks. */
    const comparedPath = (tracks: readonly StageTrack[]): string | null => comparedPathOf(deps.slots(), tracks.map(track => track.filePath), state.held, state.compared);
    // The comparison's keys (COMPARE_KEYS): 1–3 tap = compare that slot, hold = compare it until released; B switches
    // the base between the slot-0 file and the group median; + / − / 0 zoom as on the lanes; D fixes the difference
    // as a row of the entry table; Esc goes back to the entry table.
    let pressing: { slot: number; at: number; timer: number } | null = null;
    const keysLive = (event: KeyboardEvent): boolean => state.on && deps.inFront() && !(event.target as Element | null)?.closest?.('input, select, textarea, [data-step-bar], #track-stage-range-popover, details.role-chip');
    const router = keyRouterFor(deps.window);
    const removeKeys = router.add({
        layer: 'stage',
        keydown(event) {
            if (!keysLive(event) || event.ctrlKey || event.metaKey || event.altKey) return false;
            const action = keyAction(COMPARE_KEYS, event.key);
            if (action === 'slot') {
                event.preventDefault();
                if (event.repeat || pressing) return true;
                const slot = Number(event.key);
                pressing = { slot, at: deps.window.performance.now(), timer: deps.window.setTimeout(() => { state.held = slot; deps.rerender(); }, TAP_MS) };
            } else if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
                // With the pointer on no plot (over one, the shared plot gestures zoom that plot, plotInteraction.ts): the
                // shared window, about the horizontal axis's middle as on the lanes. A reset is every plot's.
                event.preventDefault();
                if (action === 'zoom-reset') { Object.assign(state, WHOLE_ZOOM); lanesScreen.reset(); }
                else state.window = { ...state.window, x: zoomNormalizedRange(state.window.x, action === 'zoom-out' ? 1 / ZOOM_IN_FACTOR : ZOOM_IN_FACTOR) };
                // The spectrum overlay's Figure zooms its own axis across (its range is in values, R9).
                if (action !== 'zoom-reset') overlayScreen.zoomKey(action === 'zoom-out' ? 'out' : 'in');
                deps.rerender();
            } else if (action === 'toggle-base') {
                event.preventDefault();
                state.groupBase = !state.groupBase;
                deps.rerender();
            } else if (action === 'play' && (event.target as Element | null)?.closest?.('button, summary, a')) {
                // A focused button (a legend ▶ among them) takes Space as its own press: the tracks' playback key leaves it alone.
                return true;
            } else if (action === 'play') {
                // Space plays the recording compared (the legend's ▶ plays any of them).
                const path = comparedPath(deps.tracks());
                if (!path || !deps.play) return false;
                event.preventDefault();
                deps.play(path, liveRegion());
            } else if (action === 'back') {
                event.preventDefault();
                deps.back();
            } else {
                return false;
            }
            return true;
        },
        keyup(event) {
            if (!pressing || event.key !== String(pressing.slot)) return false;
            deps.window.clearTimeout?.(pressing.timer);
            if (state.held !== null) state.held = null;
            else state.compared = pressing.slot;
            pressing = null;
            deps.rerender();
            return true;
        },
    });
    function role(filePath: string): number | undefined {
        const at = deps.slots().indexOf(filePath);
        return at >= 0 ? at : undefined;
    }
    function chosen(): string | null {
        const recipe = deps.recipe()?.recipe;
        return recipe ? chosenStage(recipe, limits(), state.stage) : null;
    }
    const spec = (id: string, ch: number | null = null): StageSpec => stageSpec(deps.recipe(), liveRegion(), id, ch);
    /** What holding `step` draws: the chain without it (and the steps that then cannot run), on the step on screen. */
    const holdSpec = (step: RecipeStep, ch: number | null = null): StageSpec | undefined => holdStageSpec(deps.recipe(), chosen(), step, limits(), liveRegion(), ch);
    /** The compared file's picture, for tests. */
    let shownCompare: { path: string | null; view: StageView | null | undefined } = { path: null, view: undefined };
    /** The channel each file was last drawn as, and the trigger whose events are on show, whose events a click leaves out. */
    let channelOf = (_path: string): number | null => null;
    let shownTrigger: string | null = null;
    /** A click on an event's line: that event of that recording left out of the steps after the trigger, or put back (↶ too). */
    // The events' trigger and channel are taken when the line is clicked; the edit is returned for the click to make,
    // and it returns how to take it back as if never made (a double click's second press, R13).
    function toggleEvent(event: { id: number; source: string; out: boolean }): (() => (() => void) | undefined) | undefined {
        if (!shownTrigger) return undefined;
        const key = eventsKey(shownTrigger, event.source, channelOf(event.source));
        return () => {
            const editor = deps.recipe()?.recipe;
            if (!editor) return undefined;
            const next = withEventExcluded(editor, key, event.id, !event.out);
            const said = (event.out ? strings.stageEventIn : strings.stageEventOut).replace('{name}', named(event.source, role(event.source)).label).replace('{n}', String(event.id + 1));
            const takeBack = stepBar.edit(next, said);
            // The footer is the pointer's: the notice stays a moment where the pointer does not write.
            deps.notify?.(said);
            return takeBack;
        };
    }
    /** A recording's ▶ in the legend (■ while it plays); the base group has none. */
    /** The legend's markup as last written. */
    let legendWritten = '';
    function playable(path: string): Pick<LegendItem, 'path' | 'playing'> {
        return deps.play ? { path, playing: deps.playing?.() === path } : {};
    }
    /** A file in the legend: its role, name and channel, its value on show, ✎ with its memo. */
    function named(path: string, slot: number | undefined): Pick<LegendItem, 'label' | 'value' | 'memo' | 'chipHtml'> {
        const info = deps.rowInfo?.(path) ?? { label: baseName(path), value: '', memo: '' };
        const chipHtml = deps.roleChip?.(path);
        // With its role chip in front, the label is the file's name alone.
        return { label: chipHtml ? info.label : `${slot ?? '·'} · ${info.label}`, ...(info.value ? { value: info.value } : {}), ...(info.memo ? { memo: info.memo } : {}), ...(chipHtml ? { chipHtml } : {}) };
    }
    /** The tracks under a trigger's events, while they are drawn: its settings and each file's events, for ▶. */
    let marks: { trigger: { threshold: number; channel: number; duration: number; pre: number }; events: (path: string) => NonNullable<StageView['events']> | undefined } | null = null;
    let lanesMarked = false;
    function paintNow(): void {
        if (!state.on) return;
        const recipe = deps.recipe();
        const id = chosen();
        const shownStage = state.stage && recipe && recipeSteps(recipe.recipe).find(step => step.id === state.stage)?.bypassed ? state.stage : id;
        stepBar.set({ recipe: recipe?.recipe ?? null, sampleRate: deps.sampleRate(), channels: deps.channels?.(), peak: deps.peak ? () => deps.peak?.(liveRegion()) : undefined, stage: shownStage ?? undefined, regionRange: state.regionSet, failed: recipe?.failed });
        // The tracks' selection becomes the region chip once the bar has the chain; a region already there stays.
        if (state.pendingRegion) {
            const range = state.pendingRegion;
            state.pendingRegion = null;
            if (recipe && !state.regionSet && stepBar.importRegion(range)) return;
        }
        const allTracks = deps.tracks();
        stepBar.element.dataset.drawn = '0';
        if (!recipe || !id) {
            // No chain to show yet: the panel says how to start.
            leaveFigure();
            deps.showLanes(false);
            panel.hidden = false;
            root.dataset.pending = '';
            query<HTMLElement>('[data-stage-headline]').textContent = '';
            say(strings.stepOpenCompare);
            return;
        }
        const steps = recipeSteps(recipe.recipe, limits());
        // A step that cannot run has no picture: the plot says why, and how to fix it.
        const cannot = steps.find(step => step.id === id && step.invalid !== undefined);
        // A step measured against the base slot's recording (at or before the one shown): each other recording is
        // paired with it there, so the base is one recording, and it is the reference rather than a curve of its own.
        const shownIndex = steps.findIndex(step => step.id === id);
        const slotStep = steps.find((step, index) => step.reference === 'slot' && !step.bypassed && step.invalid === undefined && index <= shownIndex);
        const referencePath = slotStep && !state.groupBase ? deps.slots()[0] ?? null : null;
        const needBase = !!slotStep && !referencePath;
        if (cannot || needBase) {
            leaveFigure();
            deps.showLanes(false);
            // Dragging fixes a step in the wrong place; the other reasons say themselves what to do.
            const movable = cannot?.reason?.kind === 'frame' || cannot?.reason?.kind === 'after';
            panel.hidden = false;
            root.dataset.pending = '';
            query<HTMLElement>('[data-stage-headline]').textContent = '';
            stepBar.element.dataset.stage = id;
            say(cannot ? `${strings.stepCannotShow.replace('{why}', invalidReason(cannot, strings, steps))}${movable ? ` — ${strings.stepCannotShowFix}` : ''}` : strings.stageNeedBaseFile);
            return;
        }
        const tracks = referencePath ? allTracks.filter(track => track.filePath !== referencePath) : allTracks;
        // The compared file (the slot tapped or held); its base: slot 0, or the others of its condition (0 switches).
        const comparePath = comparedPath(tracks);
        // A pair's step (a transfer function, a cross spectrum) is counted by its pictures' own identity, the pair's
        // unit ratio or reference (R1): the table's answers, of the channels' levels and the scan's axis, say nothing of
        // it, so every member the table left out on another reference or axis is asked for and counted by its picture.
        const pairStage = pairLevelFrame(id === INPUT_STAGE ? INPUT_FRAME : steps.find(step => step.id === id)?.output);
        const tableLeft = comparePath && !referencePath ? deps.baseLeft?.(comparePath, state.groupBase) ?? [] : [];
        // A step held: the picture without it, as scanned for that (the lanes and the plot framed green meanwhile).
        const heldStep = state.heldStep;
        const held_ = heldStep ? holdSpec(heldStep) : undefined;
        // Each file is drawn as the channel it is compared as (a channel row's slot, and its base's members of that channel).
        const channelFor = (path: string): number | null => deps.stageChannel?.(path, comparePath, state.groupBase) ?? null;
        const plain = (ch: number | null): StageSpec => (held_ && heldStep ? holdSpec(heldStep, ch) : undefined) ?? spec(id, ch);
        // Measured against the base slot: the base recording's chain up to that step goes with the request.
        const specOf = (ch: number | null): StageSpec => {
            const own = plain(ch);
            const theirs = referencePath ? plain(channelFor(referencePath)).message.recipe : undefined;
            if (!referencePath || !slotStep || !theirs || !recipeChain(theirs).some(node => node.id === slotStep.id)) return own;
            return { key: `${own.key}|vs|${referencePath}|${recipeKey(theirs)}`, message: { ...own.message, reference: { filePath: referencePath, step: slotStep.id, recipe: theirs } } };
        };
        // A step after a trigger that takes its events together runs without the ones left out of each recording's
        // (wandas.segments.drop after that trigger): the files are asked for by their channel and those events. The
        // events on show (a step that still gives them) are the last trigger's, all drawn, the ones left out faint.
        const triggersHere = steps.slice(0, shownIndex + 1).filter(step => step.operation === TRIGGER && step.invalid === undefined && !step.bypassed);
        const eventsShown = /Segments$/.test(steps[shownIndex]?.output ?? '');
        const viewTrigger = eventsShown ? triggersHere.at(-1)?.id : undefined;
        const dropping = triggersHere.filter(step => step.id !== viewTrigger).map(step => step.id);
        const dropsOf = (path: string): EventDrop[] => dropping.map(trigger => ({ trigger, ids: excludedOf(recipe.recipe, eventsKey(trigger, path, channelFor(path))) }));
        const dropsKey = (drops: readonly EventDrop[]): string => drops.filter(drop => drop.ids.length).map(drop => `${drop.trigger}:${drop.ids.join(',')}`).join(';');
        const groupOf = (path: string): string => `${channelFor(path) ?? '*'}|${dropsKey(dropsOf(path))}`;
        const specFor = (path: string): StageSpec => {
            const own = specOf(channelFor(path));
            const drops = dropsOf(path);
            const reference = own.message.reference;
            // Paired with the base slot's recording later on: both Recipes have the drops (each its own events).
            const theirs = reference ? dropsOf(reference.filePath) : [];
            const run = own.message.recipe;
            if (!run || (!dropsKey(drops) && !dropsKey(theirs))) return own;
            const paired = reference ? { reference: { ...reference, recipe: withDroppedEvents(reference.recipe, theirs, true) } } : {};
            return { key: `${own.key}|drop|${dropsKey(drops)}|${dropsKey(theirs)}`, message: { ...own.message, recipe: withDroppedEvents(run, drops, !!reference), ...paired } };
        };
        shownTrigger = viewTrigger ?? null;
        // The spectrum overlay on the new path (its step a spectrum, overlaid, nothing held: as `onFigure` below decides
        // it once a picture is in): its base group is declared whole, every recording with its key, state and version,
        // and the figure service alone leaves one out, by the step's own answers, and counts it with why (計算ア,
        // python-backend/figures/members.py). So the ones the table's answers put on another
        // reference, axis or channel count are asked for here too, never left out beforehand. Those whose file could not
        // be read at all are declared failed, as the answer store has them (their scan failed: no step's picture can be
        // had of them, and asking again would only hold the median while they are re-asked). Those without the channel
        // compared are declared too, not asked for (no picture of that channel can be had): every key of the group
        // carries the channel it is compared as and its file's channel count, and the service counts them no-channel.
        // Whether the step is one: by a picture of it already in (any recording's on screen), else by its Frame.
        const early = tracks.map(track => source.view(specFor(track.filePath), track.filePath)).find((view): view is StageView => !!view);
        const figureStage = state.overlaid && (early ? figureLines(early) : FIGURE_FRAMES.has((id === INPUT_STAGE ? INPUT_FRAME : steps.find(step => step.id === id)?.output) ?? ''));
        const relevel = pairStage || figureStage
            ? tableLeft.filter(item => item.reason === 'other-reference' || item.reason === 'other-axis' || (figureStage && item.reason === 'other-channels')).map(item => item.path)
            : [];
        const unreadable = figureStage ? tableLeft.filter(item => item.reason === 'failed' || item.reason === 'no-channel').map(item => item.path) : [];
        const allBase = comparePath && !referencePath ? [...new Set([...deps.basePaths(comparePath, state.groupBase), ...relevel])] : [];
        // A base group of more than LARGE_BASE recordings is not scanned until 「基準の群 n 本を解析する」.
        const gateKey = comparePath ? `${comparePath}|${state.groupBase}|${allBase.length}|${allBase[0] ?? ''}|${allBase.at(-1) ?? ''}` : null;
        state.gateKey = gateKey;
        const cost = deps.cost?.(allBase) ?? { seconds: 0, ms: allBase.length * 150 };
        const gated = (allBase.length > LARGE_BASE || cost.seconds > LARGE_BASE_S) && !(gateKey !== null && state.baseAllowed.has(gateKey));
        const allowed = gated ? [] : allBase;
        const files = [...new Set([...tracks.map(track => track.filePath), ...allowed])];
        const byChannel = new Map<string, { spec: StageSpec; ch: number | null; paths: string[] }>();
        for (const path of files) {
            const group = byChannel.get(groupOf(path)) ?? { spec: specFor(path), ch: channelFor(path), paths: [] };
            group.paths.push(path);
            byChannel.set(groupOf(path), group);
        }
        root.classList.toggle('is-step-held', !!held_);
        root.dataset.held = held_ && heldStep ? heldStep.id : '';
        root.dataset.channels = files.map(path => `${baseName(path)}:${channelFor(path) ?? '*'}`).join(',');
        // The pictures share one request: asked for one after another, the tracks on screen before a base group's
        // recordings and the whole pictures before the zoom's detail, the region's metrics before the base group's
        // detail. No spec supersedes another on every repaint, which would leave both unfinished.
        let asking = false;
        const lacks = (wanted: StageSpec, paths: readonly string[]): boolean => paths.some(path => source.result(wanted, path) === undefined);
        const want = (wanted: StageSpec, paths: readonly string[]): boolean => {
            const lacking = lacks(wanted, paths);
            if (lacking && !asking) asking = source.ensure(wanted, paths);
            return lacking;
        };
        const onScreen = new Set(tracks.map(track => track.filePath));
        const ownOf = (paths: readonly string[]): string[] => paths.filter(path => onScreen.has(path));
        const waiting = [...byChannel.values()].some(({ spec: wanted, paths }) => lacks(wanted, paths));
        for (const { spec: wanted, paths } of byChannel.values()) want(wanted, ownOf(paths));
        // A step that failed on a file is the chain's to mark (⚠, wandas' reason), then the plot says so; a held
        // step's preview runs another chain, whose failure is not the chain's.
        if (!held_) for (const { spec: wanted, paths } of byChannel.values()) {
            for (const path of paths) {
                const scanned = source.result(wanted, path);
                if (scanned && !scanned.ok && scanned.failedStep && deps.recipe()?.failed?.[scanned.failedStep] === undefined) deps.stepFailed?.(scanned.failedStep, scanned.reason ?? '');
            }
        }
        const region = liveRegion();
        root.dataset.region = regionLabel(region);
        // The region on the plots: its part of a whole-file picture (a step before the region's), else a corner tag.
        const sliceAt = steps.findIndex(step => step.operation === TIME_SLICE);
        const shownAt = id === INPUT_STAGE ? -1 : steps.findIndex(step => step.id === id);
        const regionMark = region ? { start: region.start, end: region.end, mark: shownAt < sliceAt ? 'range' as const : 'tag' as const, label: `${strings.stepRegion} ${secondsSpanText(region.start, region.end)}` } : undefined;
        root.dataset.regionMark = regionMark?.mark ?? '';
        const coarse = (path: string) => source.view(specFor(path), path);
        // Each level axis names the reference of the channels drawn, as their step's scan read them: a file
        // calibrated on one channel only reads that channel's calibration when it is the one drawn.
        for (const track of tracks) {
            const scanned = source.result(specFor(track.filePath), track.filePath);
            if (scanned?.ok && scanned.input) track.input = scanned.input;
            // The picture's own values are what its axis is grouped and named by (a gain: its pair's unit ratio, R1).
            track.input = pictureLevelOf(coarse(track.filePath), track.input);
        }
        const picture = tracks.map(track => coarse(track.filePath)).find((view): view is StageView => !!view) ?? null;
        // Before any picture is in, the step's Frame says whether it is an image: the comparison is shown at once,
        // computing, rather than the lanes until the first file is in.
        const frameShown = id === INPUT_STAGE ? INPUT_FRAME : steps.find(step => step.id === id)?.output;
        // (A step held draws the chain without it, another Frame: the lanes until its first picture, as before.)
        const images = picture ? picture.kind === 'heatmap' || picture.kind === 'none' : !waiting || !!held_ || IMAGE_FRAMES.has(frameShown ?? '');
        // The files in of all asked for, said on the plots while any is missing.
        const done = files.filter(path => coarse(path) !== undefined).length;
        const pending = waiting ? { done, total: files.length, label: strings.dsComputing.replace('{done}', String(done)).replace('{n}', String(files.length)) } : undefined;
        root.dataset.pending = pending ? `${done}/${files.length}` : '';
        const overlay = state.overlaid && !images;
        // A trigger's events overlaid: the tracks stay under them, each recording as the trigger takes it (the step
        // before it), with the trigger's level, where each event was cut and a mark per event to play or leave out.
        const triggerShown = steps[shownIndex]?.operation === TRIGGER && !held_ ? steps[shownIndex] : undefined;
        const signalStage = triggerShown ? steps.slice(0, shownIndex).reverse().find(step => step.invalid === undefined && !step.bypassed)?.id ?? INPUT_STAGE : null;
        const marked = overlay && !!signalStage;
        // Lines over one axis overlaid (figureLines: not bands, an image, a signal or events, nor one
        // measured against the base slot): the new path's Figure draws them and their Δ.
        const linesOnFigure = overlay && !marked && (picture ? figureLines(picture) : FIGURE_FRAMES.has(frameShown ?? ''));
        // Images (a spectrogram, a roughness, a cepstrogram) are a lane a recording on screen of the same Figure:
        // never overlaid, looked at together by the figure service (the same part, one colour range).
        const imagesOnFigure = (picture ? picture.kind === 'heatmap' : waiting && IMAGE_FRAMES.has(frameShown ?? ''));
        // A trigger's events: each event of each recording a line of the Figure over the time from its
        // trigger, once some recording's events are in (the tracks stay under them, marked).
        const eventPaths = [...new Set([...(comparePath ? [comparePath] : []), ...tracks.map(track => track.filePath)])];
        const eventsOnFigure = overlay && !!picture?.events && eventPaths.some(path => !!source.view(specFor(path), path)?.events?.length);
        // Not overlaid (「One lane per track」): the same lines, sounds and events, a lane a recording on
        // screen of the same Figure, as the images are (the tracks' own rows are not drawn on).
        const apartOnFigure = !state.overlaid && !images && (picture
            ? figureLines(picture) || (!!picture.events && eventPaths.some(path => !!source.view(specFor(path), path)?.events?.length))
            : FIGURE_FRAMES.has(frameShown ?? ''));
        const lanesOnFigure = imagesOnFigure || apartOnFigure;
        const onFigure = linesOnFigure || lanesOnFigure || eventsOnFigure;
        // The comparison is the panel's alone: the tracks' own rows are not drawn on (the recordings under a trigger's
        // events are lanes of a Figure in the panel too).
        deps.showLanes(false);
        panel.hidden = false;
        // A lane a recording (an image, or a line not overlaid) keeps a height to be read at: with many recordings the
        // steps' view grows and scrolls.
        root.dataset.figureRows = String(lanesOnFigure);
        query<HTMLElement>('[data-stage-figure]').style.flexBasis = lanesOnFigure ? `${tracks.length * LANE_ROOM_PX + 40}px` : '';
        // Without a compared file there is no difference to show.
        // A base group of waveforms is drawn each as it is (also while gated or still coming in): its title counts
        // its files rather than naming a median, and no level difference is measured against it.
        // Before any picture is in, the step's Frame says whether it is a time signal (drawn as waveforms).
        const each = (picture ? isSignal(picture) : frameShown === INPUT_FRAME) && allBase.length > 1;
        // The step figure's base set, built once: of the base's recordings, those whose picture
        // is in, kept its values and (a median) is on the compared file's axis. The drawn lines, the median asked of the
        // backend, the heading's n and the legend's words are all of this one set; a recording still on its way is
        // pending in it, and no median is asked until none is. A level is the step's own scan's, never a guess.
        // A recording's levels are those of the version its picture is of: the picture's own scan, else its track.
        const levelPaths = [...new Set([...allTracks.map(track => track.filePath), ...allowed, ...(comparePath ? [comparePath] : [])])];
        const levels = levelPaths.map((path): LevelInput | undefined => {
            const scanned = source.result(specFor(path), path);
            // A gain is re its pair's unit ratio, a cross spectrum against the base slot re the pair's reference (R1).
            // A pair's step: its identity is its picture's, unknown (pending) until the picture is in, never its channels'.
            return pictureLevelOf(coarse(path), (scanned?.ok ? scanned.input : undefined) ?? allTracks.find(track => track.filePath === path)?.input, pairStage);
        });
        const levelOf = (path: string): LevelInput | undefined => { const at = levelPaths.indexOf(path); return at < 0 ? undefined : levels[at]; };
        paintStageControls(dom, strings, { overlaid: state.overlaid, images, showDiff: state.showDiff, overlay, measuredAgainstBase: !!referencePath, nothingCompared: !comparedPath(tracks), baseEach: each, events: !!picture?.events || /Segments$/.test(picture?.frame ?? '') || /Segments$/.test(frameShown ?? '') });
        for (const { spec: wanted, paths } of byChannel.values()) want(wanted, paths);
        // The tracks under a trigger: each file as the trigger takes it, once the events are in.
        // A whole file (no channel compared) is drawn as the trigger's channel, the one held against its level.
        // An earlier trigger's events left out are left out here too, as the trigger shown takes them.
        const signalSpec = (path: string): StageSpec | undefined => {
            if (!marked || !signalStage) return undefined;
            const own = spec(signalStage, watchedChannel(channelFor(path), triggerShown?.params.channel));
            const drops = dropsOf(path);
            const run = own.message.recipe;
            if (!run || !dropsKey(drops)) return own;
            return { key: `${own.key}|drop|${dropsKey(drops)}`, message: { ...own.message, recipe: withDroppedEvents(run, drops) } };
        };
        // (The part on screen is the figure service's to draw at full resolution: no detail is asked.)
        if (marked && !waiting) {
            const asked = new Map<string, { wanted: StageSpec; paths: string[] }>();
            for (const path of ownOf(files)) {
                const wanted = signalSpec(path);
                if (wanted) asked.set(wanted.key, { wanted, paths: [...(asked.get(wanted.key)?.paths ?? []), path] });
            }
            for (const { wanted, paths } of asked.values()) want(wanted, paths);
        }
        stepBar.element.dataset.stage = id;
        root.dataset.layout = overlay ? 'overlay' : 'lanes';
        // The part of each whole axis shown, for tests: the Figure's own once it draws (screens/compareOverlay.ts).
        root.dataset.xWindow = root.dataset.yWindow = root.dataset.diffYWindow = '0.000-1.000';
        root.dataset.lanesWindow = figureLanesWindow;
        paintBaseGate(dom, strings, { gated, count: allBase.length, ms: cost.ms });
        shownCompare = { path: comparePath, view: comparePath && !waiting ? coarse(comparePath) : undefined };
        // The events left out of each recording's, on the trigger's picture (and a step after it that keeps them).
        const excluded = (path: string): readonly number[] => (viewTrigger ? excludedOf(recipe.recipe, eventsKey(viewTrigger, path, channelFor(path))) : []);
        channelOf = channelFor;
        const bypassed = steps.filter(step => step.bypassed).map(step => stepChipLabel(step, strings, state.regionSet));
        query<HTMLElement>('[data-stage-headline]').textContent = stageModeHeadline({ strings, waiting, referencePath, comparePath, named }, bypassed, region);
        root.dataset.compared = comparePath ? String(role(comparePath) ?? '') : '';
        root.dataset.base = state.groupBase || !deps.slots()[0] ? 'group' : 'file';
        const aggregate = each ? strings.stageBaseEach : strings.stageBaseAggregate;
        query<HTMLElement>('[data-stage-base-aggregate]').textContent = aggregate;
        if (onFigure) {
            sayNothing();
            // A recording too large to keep is on no line: the headline says how many (the base's heading counts its own).
            const tooLarge = [...new Set([...(comparePath ? [comparePath] : []), ...tracks.map(track => track.filePath), ...allowed])].filter(path => !!source.result(specFor(path), path)?.stageDataTooLarge).length;
            if (tooLarge) query<HTMLElement>('[data-stage-headline]').textContent = strings.stageFigureTooLarge.replace('{n}', String(tooLarge));
            root.dataset.tooLarge = String(tooLarge || '');
            const eventLines = eventsOnFigure || (apartOnFigure && !!picture?.events);
            // (A recording too large to keep has no event line: its notice stays in place of the counts.)
            // (The counts are the trigger step's own answer's: its events by number, as the scan describes them.)
            if (eventLines && !tooLarge) query<HTMLElement>('[data-stage-headline]').textContent = strings.stageEventCounts.replace('{base}', allowed.length === 1 && coarse(allowed[0])?.events ? String(coarse(allowed[0])?.events?.length) : '—').replace('{compare}', comparePath && coarse(comparePath)?.events ? String(coarse(comparePath)?.events?.length) : '—');
            paintFigure({ signals: !imagesOnFigure && !eventLines && (picture ? isSignal(picture) : frameShown === INPUT_FRAME), images: imagesOnFigure, apart: apartOnFigure, ...(eventLines ? { events: { of: (path: string) => coarse(path)?.events?.map(event => ({ id: event.id, time: event.time })) ?? [], out: excluded } } : {}), tracks, comparePath, referencePath, allowed, unreadable, baseChannel: comparePath ? channelFor(comparePath) : null, channelOf: channelFor, gated, count: allBase.length, playable, aggregate, specFor, levelOf });
        } else {
            // Nothing the Figure draws yet: the files on their way (how many are in), or why there is no picture (a
            // trigger that found no event, a step whose Frame is not drawn).
            leaveFigure();
            say(waiting ? pending?.label ?? '' : emptyStageText(strings, picture));
        }
        // Under a trigger's events (or the word that there are none yet): each recording as the trigger takes it.
        if (!marked || !triggerShown) return;
        const params = triggerShown.params;
        const number = (name: string, fallback: number): number => (typeof params[name] === 'number' ? params[name] : fallback);
        const duration = number('duration', 0);
        const trigger = { threshold: number('threshold', 0), channel: number('channel', 0), duration, pre: number('pre', 0) };
        const events = (path: string) => coarse(path)?.events;
        marks = { trigger, events };
        lanesMarked = true;
        // A band lane a recording, in a Figure of its own under the events'.
        {
            query<HTMLElement>('[data-stage-lanes-figure-head]').hidden = false;
            // Each lane keeps a height to be read at: with many recordings the steps' view grows and scrolls (the CSS's rule).
            root.dataset.lanesFigure = 'true';
            query<HTMLElement>('[data-stage-lanes-figure]').style.flexBasis = `${tracks.length * LANE_ROOM_PX + 40}px`;
            const keyed = (wanted: StageSpec, path: string): FigureKey => {
                const answer = source.answer(wanted, path);
                const data = answer.state === 'ready' ? answer.value.data : undefined;
                return figureKey(data ?? `${answer.state}|${wanted.key}|${path}`, answer.state === 'ready' && !data ? 'failed' : answer.state, data ?? '0');
            };
            lanesScreen.show(tracks.map(track => {
                const path = track.filePath, signal = signalSpec(path) ?? specFor(path);
                return {
                    path, name: named(path, role(path)).label, colour: colorOf(role, path, track.color),
                    ...(allowed.includes(path) ? { role: 'base' } : path === comparePath ? { role: 'compare1' } : {}),
                    signal: keyed(signal, path), step: keyed(specFor(path), path), out: excluded(path),
                    unit: source.view(signal, path)?.unit || uncalibratedUnits(!track.input || track.input.fullScale).linear,
                };
            }), trigger);
        }
    }
    /**
     * The spectrum overlay on the new path (screens/compareOverlay.ts): the spec's keys with the state and version the
     * answer store gives each (answers/figureKeys.ts), the lines named and coloured as the legend has them, and the
     * legend's n and calibration words from what the figure service counted (計算ア), never counted here.
     */
    /**
     * The spectrum overlay on the new path (screens/compareOverlay.ts): the comparison's recordings in their roles, each
     * one's key with the state and version the answer store gives it (answers/figureKeys.ts), its name and colour as the
     * legend has them, and the legend written from what the figure service counted (計算ア), never counted here.
     */
    function paintFigure(at: { signals: boolean; images: boolean; apart: boolean; events?: { of(path: string): ReadonlyArray<{ id: number; time: number }>; out(path: string): readonly number[] }; tracks: readonly StageTrack[]; comparePath: string | null; referencePath: string | null; allowed: readonly string[]; unreadable: readonly string[]; baseChannel: number | null; channelOf: (path: string) => number | null; gated: boolean; count: number; playable: (path: string) => Pick<LegendItem, 'path' | 'playing'>; aggregate: string; specFor: (path: string) => StageSpec; levelOf: (path: string) => LevelInput | undefined }): void {
        const screen = overlayScreen;
        const { tracks, comparePath, allowed } = at;
        const others = tracks.filter(track => track.filePath !== comparePath && !allowed.includes(track.filePath));
        const slotted = others.filter(track => role(track.filePath) !== undefined).sort((a, b) => (role(a.filePath) ?? 0) - (role(b.filePath) ?? 0));
        const compared = !!comparePath && !allowed.includes(comparePath);
        // Sounds have a Δ against one recording only (no median is taken of them).
        const withDiff = !at.images && !at.apart && !at.events && state.showDiff && compared && allowed.length > 0 && (!at.signals || allowed.length + at.unreadable.length === 1);
        root.dataset.figure = 'true';
        query<HTMLElement>('[data-stage-figure-head]').hidden = !withDiff;
        const trackOf = (path: string): StageTrack | undefined => tracks.find(track => track.filePath === path);
        screen.show({
            others: others.filter(track => role(track.filePath) === undefined).map(track => track.filePath),
            // Every recording of the base group (the table's left-out ones too: asked for above, or not askable), judged by the service.
            // Images are of the recordings on screen only (a lane each): of the base, those that are tracks.
            // (A lane a recording likewise: of the recordings on screen.)
            base: at.images || at.apart ? allowed.filter(path => tracks.some(track => track.filePath === path)) : at.gated ? [] : [...allowed, ...at.unreadable],
            compare: [...(comparePath ? [comparePath] : []), ...slotted.map(track => track.filePath)],
            delta: withDiff,
            ...(at.signals ? { signals: true } : {}),
            ...(at.images ? { images: true } : {}),
            ...(at.apart ? { apart: tracks.map(track => track.filePath) } : {}),
            ...(at.events ? { events: at.events } : {}),
        }, {
            // A click on an event's line leaves it out of what follows the trigger, or puts it back (the Recipe's).
            eventPicked: (path, id, out) => toggleEvent({ id, source: path, out })?.(),
            eventRead: (event, moved) => { figureEvent = event; if (event && moved) deps.hint(event.out ? strings.stageEventClickIn : strings.stageEventClickOut); },
            keyOf(path) {
                // Its kept values' key (the scan's data key, its version), or its state's while it has none.
                const wanted = at.specFor(path);
                // A base member is compared as the base's channel; any other recording as its own row's. With its file's
                // channel count, the service knows a recording without that channel (no-channel).
                const inBase = at.allowed.includes(path) || at.unreadable.includes(path);
                const channels = { channel: inBase ? at.baseChannel : at.channelOf(path), channels: deps.channelCount?.(path) };
                // Not askable at the step (its file could not be read, or has not the channel compared): failed, as no
                // picture of it can be had; the service says which (its file's state, or no-channel by the counts).
                if (at.unreadable.includes(path)) return figureKey(`failed|${wanted.key}|${path}`, 'failed', '0', channels);
                const answer = source.answer(wanted, path);
                // Its values are over what the backend keeps (the scan said so): declared too large, and the service
                // leaves it out with that reason (the budget is a cap; nothing more is asked of it).
                if (source.result(wanted, path)?.stageDataTooLarge) return figureKey(`too-large|${wanted.key}|${path}`, 'too-large', '0', channels);
                // Not in under the file's basis now, but in under an earlier one (the file changed): stale, its key and
                // version the earlier answer's, so the picture stays and its line is not read until the new one comes.
                const earlier = answer.state === 'ready' ? undefined : source.previous(wanted, path);
                const data = answer.state === 'ready' ? answer.value.data : earlier?.stage?.data;
                const freshness = data && earlier ? 'stale' : answer.state === 'ready' && !data ? 'failed' : answer.state;
                // What its levels are in: the earlier scan's for a stale one, else as the paint knows it (the step's own
                // scan, else its track, else the table's answer).
                const level = (data && earlier ? earlier.input : undefined) ?? at.levelOf(path);
                return figureKey(data ?? `${freshness}|${wanted.key}|${path}`, freshness, data ?? '0', {
                    ...(level ? { level: { unit: level.unit ?? '', ref: Number(level.ref ?? 1), label: level.levelReferenceLabel ?? '' } } : {}),
                    ...(level?.calibrationStatus ? { calibrated: level.calibrationStatus === 'calibrated' } : {}),
                    ...channels,
                });
            },
            name: path => named(path, role(path)).label,
            // The base's heading: its n and who it left out why, as the figure service counted them; the table's while a
            // picture is on its way.
            // Sounds of a base group are drawn each as it is: its heading counts its files, and names no median.
            baseName: counts => (comparePath ? deps.baseHeading(comparePath, state.groupBase, counts && !at.gated ? countedSet(counts.used, counts.excluded) : null, at.signals && at.count > 1) : ''),
            style(path, line) {
                if (line === 'delta') return { colour: DIFF_COLOR, width: 1.5 };
                if (line === 'base') return { colour: ROLE_COLORS[0], width: 2 };
                const own = (path ? trackOf(path)?.color : undefined) ?? ROLE_COLORS[1];
                if (line === 'compare1') return { colour: colorOf(role, path ?? '', own), width: 2.2 };
                return line === 'other' ? { colour: own, width: 1.2 } : { colour: colorOf(role, path ?? '', own), width: 1.8 };
            },
            legend({ baseTitle, word }) {
                const namedOnFigure = (path: string, slot: number | undefined): ReturnType<typeof named> => { const name = named(path, slot); const said = word(path); return said ? { ...name, label: `${name.label}${said}` } : name; };
                const items = overlayLegendItems({ comparePath, referencePath: at.referencePath, role, named: namedOnFigure, strings }, others, {
                    title: comparePath ? baseTitle : '',
                    group: !!comparePath && (state.groupBase || !deps.slots()[0]),
                    aggregate: at.aggregate, gated: at.gated, count: at.count, held: state.held !== null, playable: at.playable,
                });
                legendWritten = writeStageLegend(query<HTMLElement>('[data-stage-legend]'), legendHtml(items, strings), legendWritten, document);
                return items.filter(item => item.memo).length;
            },
        });
    }
    return {
        root,
        bar: stepBar.element,
        report,
        exportFigure,
        active: () => state.on,
        role,
        importRegion(range) {
            state.pendingRegion = range;
            deps.rerender();
        },
        open(next) {
            openStageState(state, next);
            this.setActive(true);
        },
        openRecipe(recipe, said) {
            // Open first, so the bar holds the chain on screen and ↶ can bring it back.
            if (!state.on) this.open();
            // The screen redraws later: the bar is handed the chain on screen now, for ↶ to keep.
            paintNow();
            stepBar.edit(recipe, said);
            this.open(typeof recipe.output === 'string' ? recipe.output : undefined);
        },
        setActive(next) {
            if (next) enterStageState(state);
            state.on = next;
            root.hidden = !state.on;
            if (!state.on) deps.showLanes(true);
            // The Figure lives while the comparison is shown: left, it is disposed and its holdings released (第 6 節).
            if (!state.on) leaveFigure();
            // The plain tracks are not repainted by the comparison: its marks on them go when it closes.
            if (!state.on) { root.dataset.lanesMarked = ''; marks = null; lanesScreen.hide(); query<HTMLElement>('[data-stage-lanes-figure-head]').hidden = true; root.dataset.lanesFigure = 'false'; }
            if (!state.on) document.querySelectorAll<HTMLElement>('[data-lane-label]').forEach(canvas => { canvas.setAttribute('aria-label', canvas.dataset.laneLabel ?? ''); delete canvas.dataset.laneLabel; });
            // A selection not yet taken as the region is not taken later, when the comparison is opened some other way.
            if (!state.on) state.pendingRegion = null;
            deps.rerender();
        },
        paint() {
            lanesMarked = false;
            paintNow();
            if (!lanesMarked) { root.dataset.lanesMarked = ''; marks = null; lanesScreen.hide(); query<HTMLElement>('[data-stage-lanes-figure-head]').hidden = true; root.dataset.lanesFigure = 'false'; }
        },
        handle: message => source.handle(message),
        snapshot() {
            const view = shownCompare.view;
            return {
                open: state.on,
                comparing: shownCompare.path,
                base: deps.slots()[0] ?? null,
                headline: query<HTMLElement>('[data-stage-headline]').textContent ?? '',
                stage: state.on ? chosen() : null,
                frame: view?.frame ?? null,
                kind: view ? (isSignal(view) ? 'line' : view.kind) : null,
                ...pictureSummary(overlayScreen.inspect()),
                invalidSteps: stepBar.element.querySelectorAll('.step-chip.is-invalid').length,
            };
        },
        dispose() { removeKeys(); overlayScreen.hide(); lanesScreen.hide(); stepBar.dispose(); },
        // The plots are the Figure's own (its gestures are attached to its canvas): nothing is attached to the tracks' surface.
        attach() { /* nothing of the tracks' surface is the comparison's */ },
    };
}

