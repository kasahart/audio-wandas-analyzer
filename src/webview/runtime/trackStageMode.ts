/**
 * The track view's "steps" mode: the tracks shown as one step of the scan Recipe, that step's Frame
 * (stage_view.py), the step chosen on a step bar above the tracks, through the same painter as the comparison
 * (stagePanes.ts; a time signal as its waveform, plot/waveformLayer.ts). Tracks keep the entry table's roles:
 * slot 0 (or the compared file's condition, as a median) is the base, blue; slots 1–3 yellow, purple, magenta.
 *
 * Overlaid (the default) the base and the tracks are lines on one large plot, headed by both levels where
 * they differ most among what is loud enough to hear, with their difference under it on request; side by side
 * each track keeps its lane. Images cannot be overlaid: they stay in the lanes. All plots share one zoom,
 * answered by the shared plot gestures (plotInteraction.ts); zoomed in, they draw from the Frames' full
 * resolution once it is in (stageDetail.ts), as the waveform lanes do.
 */
import { secondsSpanText } from '../plot/plotText';
import { ownColor } from '../../shared/gui/roleColors';
import { redrawWhenResized } from './canvasResize';
import type { UiStrings } from '../../shared/i18n/strings';
import type { CompareCombineMessage, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { brokenStep, recipeChain, recipeKey, recipeSteps, TIME_SLICE, TRIGGER, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { eventsKey, excludedOf, withDroppedEvents, withEventExcluded, type EventDrop } from '../../shared/recipe/eventExclusion';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { createStepBar, invalidReason, stepChipLabel, stepLimits, INPUT_STAGE } from './stepBar';
import { createStageSource, type StageSpec } from './stageSource';
import { createCombineSource, createLastFine, NOTHING_COMBINED, TOO_LARGE_COMBINED } from './combineSource';
import { createStageReader } from './stageReader';
import type { FullRead } from './fullRead';
import { chosenStage, combineRequest, comparedPath as comparedPathOf, eachBaseTitle, enterStageState, holdStageSpec, initialStageState, liveRegion as liveRegionOf, openStageState, pictureSummary, plotsOf, regionStageSpec, stageSpec, WHOLE_ZOOM } from './trackStageModel';
import { createDetailPlanner, onOneRange } from './stageDetail';
import { attachStageGestures, type StageGestures } from './trackStageGestures';
import { colorOf, overlayLayers, overlayLegendItems, paintBaseGate, paintNoPicture, paintNoStage, paintStageControls, paintStageLanes, paintStageOverlay, stageDom, stageModeHeadline, writeStageLegend, type Drawn, type StageFrame, type StageTrack } from './trackStagePainter';

export type { StageTrack } from './trackStagePainter';
import { axisValueAt, isEventsView, rowValueAt } from './stagePanes';
import { axisInputOf, legendWords, pictureSet, stageNames, type ExclusionReason } from './figureModel';
import { clearTriggerLanes, paintTriggerLanes, type TriggerSettings } from './triggerLanes';
import { zoomNormalizedRange, ZOOM_IN_FACTOR } from './waveformInteraction';
import { keyRouterFor } from './keyRouter';
import { COMPARE_KEYS, keyAction } from './shortcuts';
import { legendHtml, type LegendItem, type LevelInput } from './comparePanes';
import { regionLabel } from './entryTable';
import { baseName } from '../../shared/analysis/entryMetadata';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';

/** The roles' colours: the base blue, slots 1–3 yellow, purple, magenta (as their cards and badges). */

export interface TrackStageDeps {
    document: Document;
    window: Pick<Window, 'setTimeout' | 'requestAnimationFrame' | 'clearTimeout' | 'addEventListener'> & { performance: Pick<Performance, 'now'> };
    /** Watches the plots' own size: any layout change that resizes one (Δ, the step bar, a wrapped legend) draws it again. */
    ResizeObserver?: typeof ResizeObserver;
    strings: UiStrings;
    post(message: CompareScanMessage | CompareCombineMessage): void;
    /** The Recipe the entry table scans with, and the one its scans run (the steps that cannot run left out). */
    recipe(): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
    recipeChanged(recipe: RecipeDocument): void;
    /** The tracks on screen, in display order. */
    tracks(): StageTrack[];
    /** The entry table's slots 0–3, the base of a compared file and its name. */
    slots(): (string | null)[];
    basePaths(comparePath: string, group?: boolean): string[];
    /** The base's title, with `more` of its recordings left out (a step picture failed, empty or on its way). */
    baseTitle(comparePath: string, group?: boolean, more?: ReadonlyArray<{ path: string; reason: ExclusionReason }>): string;
    /** What a recording's levels are in (its scan's input): a base recording that is no track has its own reference too. */
    levelOf?(path: string): LevelInput | undefined;
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
    /**
     * D: the compared file's difference from its base fixed as a row of the entry table; a reason when it cannot
     * be. Over a region, `measured` holds the files' results over it (metrics, not the entry table's).
     */
    fix(comparePath: string, groupBase: boolean, region: EntryRegion | null, measured: ReadonlyMap<string, ScanResult>): string | null;
    /** 「レシピをまとめて書き出す」: the chain taken out for the table's rows (its choice of rows opens on the table). */
    batch?(): void;
    /** 報告に: the comparison written as a report folder (over the region, from `measured`). */
    report(showDiff: boolean, region: EntryRegion | null, measured: ReadonlyMap<string, ScanResult>, binned: ReadonlyMap<string, ScanResult>): void;
    sampleRate(): number | undefined;
    /**
     * What a file's pictures depend on beyond their spec: its version and calibration (stageSource.stageBasis). A
     * change asks its pictures again, so a picture of an earlier calibration or version is never drawn or read.
     */
    basis?(filePath: string): string;
    /** The largest peak of the compared channels' waveforms over the region, in their unit: where a new trigger starts (half of it). */
    peak?(region: EntryRegion | null): number | undefined;
    /**
     * A step failed on a file (the scan names it): its chip is marked ⚠ with wandas' reason, as when the entry
     * table's scan fails there, so the plot says why rather than drawing nothing.
     */
    stepFailed?(step: string, reason: string): void;
    /** The fewest channels of the compared files: a step that compares two channels needs two. */
    channels?(): number | undefined;
    /** Shows or hides the track lanes (hidden while overlaid). */
    showLanes(visible: boolean): void;
    rerender(): void;
    hint(text: string): void;
    /** A short notice that stays a moment (the task status): what an edit did besides what was asked. */
    notify?(text: string): void;
    /** The task status while something asked for runs (the report's files measured), until the next notice. */
    busy?(text: string): void;
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
    const combine = createCombineSource('track-combine', message => deps.post(message), () => deps.rerender());
    // Every number read off the plots comes from the pictures' full data the backend keeps (R7), not their lines.
    // A read of values the backend let go: their pictures are scanned again, then read anew.
    const reader = createStageReader('read-stage', message => deps.post(message), keys => { source.forgetData(keys); deps.rerender(); });
    // The report's files with every Welch bin, asked for on 報告に only (a stored result keeps the 192 points alone).
    const reportSource = createStageSource('report-scan', message => deps.post(message), () => writeReport(), basis);
    /** 報告に pressed: the report waits for its files' bins (with Δ shown or not, as when it was pressed). */
    let pendingReport: { showDiff: boolean; region: EntryRegion | null } | null = null;
    /** The last zoomed combination of each comparison, drawn until the next zoom's is in. */
    const lastFine = createLastFine();
    const detail = createDetailPlanner(deps.window.performance, deps.window, () => deps.rerender());
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
        + `<canvas data-stage-canvas="overlay" role="img" aria-label="${escapeHtml(strings.ariaStageOverlayCanvas)}"></canvas>`
        + `<div class="track-stage-diff" data-stage-diff hidden><div class="track-stage-diff-head"><span class="compare-value" data-stage-diff-headline></span>`
        // The Δ pane's own readout row, just above it (R7, R13).
        + `<span class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span></div><canvas data-stage-canvas="diff" role="img" aria-label="${escapeHtml(strings.ariaStageDiffCanvas)}"></canvas></div>`
        + `</div>`
        // The lanes' own readout row, just above them, while they sit under a trigger's events plot (R7, R13).
        + `<div class="track-stage-lanes-head" data-stage-lanes-head><span class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span></div>`;
    root.prepend(stepBar.element);
    const dom = stageDom(root, stepBar.element);
    const { query, panel } = dom;
    // Whatever resizes a plot (Δ shown, the step bar grown), it is drawn again at its new size (canvasResize.ts).
    redrawWhenResized(deps.ResizeObserver, root.querySelectorAll<HTMLCanvasElement>('[data-stage-canvas]'), () => { if (state.on) deps.rerender(); });
    /** The comparison written as a folder (the toolbar's 書き出し menu): a chain that cannot run has no values to report. */
    function report(): void {
        const recipe = deps.recipe()?.recipe;
        if (recipe && brokenStep(recipe, limits())) { deps.hint(strings.stepOctaveBroken); return; }
        // The region as it was pressed: changed meanwhile, the report is still of the comparison asked for.
        pendingReport = { showDiff: state.showDiff, region: liveRegion() };
        // Measured afresh on each 報告に: a file recorded again since the last report is not drawn from its old bins.
        const spec = regionStageSpec(deps.recipe(), pendingReport.region);
        for (const path of reportPaths()) reportSource.forget(spec, path);
        writeReport();
    }
    /** The report's files: the slot-0 file and each compared slot with its base as the report defines it (the table's: slot 0, else the condition's group; not the B switch's). */
    function reportPaths(): string[] {
        const slots = deps.slots();
        return [...new Set([...(slots[0] ? [slots[0]] : []), ...slots.slice(1).flatMap(path => (path ? [path, ...deps.basePaths(path, false)] : []))])];
    }
    /**
     * Writes the pending report once its files' scans with every Welch bin are in: the compared slots, their bases and
     * the slot-0 file. Over a region they are the region's metrics (asked for already); without one, the whole files'.
     */
    function writeReport(): void {
        if (!pendingReport) return;
        const { showDiff, region } = pendingReport;
        const paths = reportPaths();
        const spec = regionStageSpec(deps.recipe(), region);
        // Read from the report's own measuring alone: the comparison's pictures (source) may be of a version since recorded again.
        const lacking = paths.filter(path => reportSource.result(spec, path) === undefined);
        if (lacking.length) {
            reportSource.ensure(spec, lacking);
            deps.busy?.(strings.reportMeasuring.replace('{count}', String(lacking.length)));
            return;
        }
        pendingReport = null;
        const binned = new Map(paths.flatMap(path => {
            const result = reportSource.result(spec, path);
            return result ? [[path, result] as [string, ScanResult]] : [];
        }));
        deps.report(showDiff, region, region ? binned : new Map(), binned);
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
    /** The files' scans over the region (their metrics), for D and the report; asked for while a region is set. */
    const regionSpec = (): StageSpec => regionStageSpec(deps.recipe(), liveRegion());
    function measured(): ReadonlyMap<string, ScanResult> {
        if (!liveRegion()) return new Map();
        const files = [...new Set([...deps.tracks().map(track => track.filePath), ...deps.tracks().flatMap(track => deps.basePaths(track.filePath, state.groupBase))])];
        const spec = regionSpec();
        return new Map(files.flatMap(path => { const result = source.result(spec, path); return result ? [[path, result] as [string, ScanResult]] : []; }));
    }
    /** The compared file: the slot held or tapped, else the first slot among the tracks. */
    const comparedPath = (tracks: readonly StageTrack[]): string | null => comparedPathOf(deps.slots(), tracks.map(track => track.filePath), state.held, state.compared);
    // The comparison's keys (COMPARE_KEYS): 1–3 tap = compare that slot, hold = compare it until released; B switches
    // the base between the slot-0 file and the group median; + / − / 0 zoom as on the lanes; D fixes the difference
    // as a row of the entry table; Esc goes back to the entry table.
    let pressing: { slot: number; at: number; timer: number } | null = null;
    const keysLive = (event: KeyboardEvent): boolean => state.on && deps.inFront() && !(event.target as Element | null)?.closest?.('input, select, textarea, [data-step-bar], #track-stage-range-popover, details.role-chip');
    const router = keyRouterFor(deps.window);
    router.add({
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
                if (action === 'zoom-reset') Object.assign(state, WHOLE_ZOOM);
                else state.window = { ...state.window, x: zoomNormalizedRange(state.window.x, action === 'zoom-out' ? 1 / ZOOM_IN_FACTOR : ZOOM_IN_FACTOR) };
                detail.moved();
                deps.rerender();
            } else if (action === 'toggle-base') {
                event.preventDefault();
                state.groupBase = !state.groupBase;
                deps.rerender();
            } else if (action === 'fix') {
                event.preventDefault();
                const path = comparedPath(deps.tracks());
                const region = liveRegion();
                const recipe = deps.recipe()?.recipe;
                const refused = recipe && brokenStep(recipe, limits()) ? strings.stepOctaveBroken
                    : !path ? strings.compareRefuseSlot.replace('{n}', String(state.compared))
                    : region && !measured().has(path) ? strings.compareRefuseFix.replace('{why}', strings.comparePending)
                        : deps.fix(path, state.groupBase, region, measured());
                deps.hint(refused ?? strings.compareFixedHint);
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
    /** What the plots last drew, for placing the pointer on them, and the compared file's picture for tests. */
    let painted = false;
    /** What each plot last drew, for the pointer's readout and an axis's range. */
    const drawnOn = new Map<Element, Drawn>();
    /** The plots' pointer gestures once attached: their hover marks follow a plot drawn anew under a still pointer. */
    let stageGestures: StageGestures | null = null;
    let redrawing = false;
    let shownCompare: { path: string | null; view: StageView | null | undefined } = { path: null, view: undefined };
    /** The channel each file was last drawn as, and the trigger whose events are on show, whose events a click leaves out. */
    let channelOf = (_path: string): number | null => null;
    let shownTrigger: string | null = null;
    /** A click on an event's line: that event of that recording left out of the steps after the trigger, or put back (↶ too). */
    // The events' trigger and channel are taken when the line is clicked: the edit itself waits out a double-click.
    function toggleEvent(event: { id: number; source: string; out: boolean }): (() => void) | undefined {
        if (!shownTrigger) return undefined;
        const key = eventsKey(shownTrigger, event.source, channelOf(event.source));
        return () => {
            const editor = deps.recipe()?.recipe;
            if (!editor) return;
            const next = withEventExcluded(editor, key, event.id, !event.out);
            const said = (event.out ? strings.stageEventIn : strings.stageEventOut).replace('{name}', named(event.source, role(event.source)).label).replace('{n}', String(event.id + 1));
            stepBar.edit(next, said);
            // The footer is the pointer's: the notice stays a moment where the pointer does not write.
            deps.notify?.(said);
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
    let marks: { trigger: TriggerSettings; events: (path: string) => NonNullable<StageView['events']> | undefined } | null = null;
    let lanesMarked = false;
    function paintNow(): void {
        if (!state.on) return;
        // A plot drawn anew under a still pointer: its hover marks are drawn again on what it now shows.
        if (stageGestures?.hovering() && !redrawing) {
            redrawing = true;
            deps.window.requestAnimationFrame(() => { redrawing = false; stageGestures?.redraw(); });
        }
        const recipe = deps.recipe();
        const id = chosen();
        const shownStage = state.stage && recipe && recipeSteps(recipe.recipe).find(step => step.id === state.stage)?.bypassed ? state.stage : id;
        stepBar.set({ recipe: recipe?.recipe ?? null, sampleRate: deps.sampleRate(), channels: deps.channels?.(), peak: deps.peak?.(liveRegion()), stage: shownStage ?? undefined, regionRange: state.regionSet, failed: recipe?.failed });
        // The tracks' selection becomes the region chip once the bar has the chain; a region already there stays.
        if (state.pendingRegion) {
            const range = state.pendingRegion;
            state.pendingRegion = null;
            if (recipe && !state.regionSet && stepBar.importRegion(range)) return;
        }
        const allTracks = deps.tracks();
        painted = false;
        // Until a trigger's events are drawn over the tracks again, the stage takes the space it is given.
        root.dataset.marked = 'false';
        // Each plot drawn below says again what it holds: one drawn empty keeps no lines to hover.
        drawnOn.clear();
        stepBar.element.dataset.drawn = '0';
        if (!recipe || !id) {
            deps.showLanes(true);
            paintNoStage(dom, allTracks, strings);
            return;
        }
        const steps = recipeSteps(recipe.recipe, limits());
        // A step that cannot run has no picture: the plot says why, and how to fix it.
        const broken = brokenStep(recipe.recipe, limits());
        const cannot = steps.find(step => step.id === id && step.invalid !== undefined);
        // A step measured against the base slot's recording (at or before the one shown): each other recording is
        // paired with it there, so the base is one recording, and it is the reference rather than a curve of its own.
        const shownIndex = steps.findIndex(step => step.id === id);
        const slotStep = steps.find((step, index) => step.reference === 'slot' && !step.bypassed && step.invalid === undefined && index <= shownIndex);
        const referencePath = slotStep && !state.groupBase ? deps.slots()[0] ?? null : null;
        const needBase = !!slotStep && !referencePath;
        if (cannot || needBase) {
            deps.showLanes(false);
            // Dragging fixes a step in the wrong place; the other reasons say themselves what to do.
            const movable = cannot?.reason?.kind === 'frame' || cannot?.reason?.kind === 'after';
            paintNoPicture(dom, id, cannot ? `${strings.stepCannotShow.replace('{why}', invalidReason(cannot, strings, steps))}${movable ? ` — ${strings.stepCannotShowFix}` : ''}` : strings.stageNeedBaseFile);
            return;
        }
        const tracks = referencePath ? allTracks.filter(track => track.filePath !== referencePath) : allTracks;
        // The compared file (the slot tapped or held); its base: slot 0, or the others of its condition (0 switches).
        const comparePath = comparedPath(tracks);
        const allBase = comparePath && !referencePath ? deps.basePaths(comparePath, state.groupBase) : [];
        // A base group of more than LARGE_BASE recordings is not scanned until 「基準の群 n 本を解析する」.
        const gateKey = comparePath ? `${comparePath}|${state.groupBase}|${allBase.length}|${allBase[0] ?? ''}|${allBase.at(-1) ?? ''}` : null;
        state.gateKey = gateKey;
        const cost = deps.cost?.(allBase) ?? { seconds: 0, ms: allBase.length * 150 };
        const gated = (allBase.length > LARGE_BASE || cost.seconds > LARGE_BASE_S) && !(gateKey !== null && state.baseAllowed.has(gateKey));
        const allowed = gated ? [] : allBase;
        const files = [...new Set([...tracks.map(track => track.filePath), ...allowed])];
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
        // The step figure's base set (figureModel.pictureSet): of the base's recordings, those whose picture is in and
        // kept its values. Once every picture is in, a failed or empty one is left out with why, so the median, the
        // drawn waveforms and the heading's n are of the same recordings; while one is on its way, all are asked.
        const levelOf = (path: string): LevelInput | undefined => allTracks.find(track => track.filePath === path)?.input ?? deps.levelOf?.(path);
        const compareInput = comparePath ? levelOf(comparePath) : undefined;
        const stageSet = pictureSet(allowed, coarse, levelOf, compareInput);
        const waitingBase = stageSet.excluded.some(item => item.reason === 'pending');
        const basePaths = waitingBase ? allowed : stageSet.paths;
        // Each level axis names the reference of the channels drawn, as their step's scan read them: a file
        // calibrated on one channel only reads that channel's calibration when it is the one drawn.
        for (const track of tracks) {
            const scanned = source.result(specFor(track.filePath), track.filePath);
            if (scanned?.ok && scanned.input) track.input = scanned.input;
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
        deps.showLanes(!overlay || marked);
        panel.hidden = !overlay;
        // Without a compared file there is no difference to show.
        // A base group of waveforms is drawn each as it is (also while gated or still coming in): its title counts
        // its files rather than naming a median, and no level difference is measured against it.
        // Before any picture is in, the step's Frame says whether it is a time signal (drawn as waveforms).
        const each = (picture ? !!picture.waveform : frameShown === INPUT_FRAME) && allBase.length > 1;
        paintStageControls(dom, strings, { overlaid: state.overlaid, images, showDiff: state.showDiff, overlay, measuredAgainstBase: !!referencePath, nothingCompared: !comparedPath(tracks), baseEach: each, events: isEventsView(picture) || /Segments$/.test(frameShown ?? '') });
        // Zoomed, the plots draw from the Frames' full resolution once it is in, the coarse pictures until then.
        const width = (overlay ? query<HTMLCanvasElement>('[data-stage-canvas="overlay"]') : tracks.find(track => track.canvas)?.canvas)?.clientWidth || 600;
        // Each line is drawn from its own detail as soon as that is in, while a base group's recordings are still
        // being asked for (its median switches once all of them have their detail).
        const fineSpecs = new Map<string, StageSpec>();
        // A line over time panned or zoomed past its detail: the detail already in, until the next one is.
        const drawnSpecs = new Map<string, StageSpec[]>();
        let fineMissing = false;
        if (!held_ && picture && picture.kind !== 'bar' && picture.kind !== 'none') {
            for (const [group, { spec: wanted, paths }] of byChannel) {
                drawnSpecs.set(group, detail.drawn(wanted, picture, state.window.x));
                const fineSpec = detail.spec(wanted, picture, state.window.x, state.window.y, width);
                if (!fineSpec) continue;
                fineSpecs.set(group, fineSpec);
                fineMissing = want(fineSpec, ownOf(paths)) || fineMissing;
            }
        }
        for (const { spec: wanted, paths } of byChannel.values()) want(wanted, paths);
        // The tracks under a trigger: each file as the trigger takes it, once the events are in.
        // A whole file (no channel compared) is drawn as the trigger's channel, the one held against its level.
        const triggerChannel = typeof triggerShown?.params.channel === 'number' ? triggerShown.params.channel : 0;
        // An earlier trigger's events left out are left out here too, as the trigger shown takes them.
        const signalSpec = (path: string): StageSpec | undefined => {
            if (!marked || !signalStage) return undefined;
            const own = spec(signalStage, channelFor(path) ?? triggerChannel);
            const drops = dropsOf(path);
            const run = own.message.recipe;
            if (!run || !dropsKey(drops)) return own;
            return { key: `${own.key}|drop|${dropsKey(drops)}`, message: { ...own.message, recipe: withDroppedEvents(run, drops) } };
        };
        // Zoomed, each lane under the trigger draws its signal's detail over the part on screen (R3): the one the
        // zoom asked for once in, else one already in that covers it, else the whole signal.
        const laneDetail = new Map<string, StageSpec[]>();
        if (marked && !waiting) {
            const asked = new Map<string, { wanted: StageSpec; paths: string[] }>();
            const laneWidth = tracks.find(track => track.canvas)?.canvas?.clientWidth || 600;
            for (const path of ownOf(files)) {
                const wanted = signalSpec(path);
                if (!wanted) continue;
                asked.set(wanted.key, { wanted, paths: [...(asked.get(wanted.key)?.paths ?? []), path] });
                const whole = source.view(wanted, path);
                if (!whole || whole.kind !== 'line') continue;
                // Planned per recording: the window is a part of each one's own time axis, and recordings differ in length.
                const own = { key: `${wanted.key}|${path}`, message: wanted.message };
                const finer = detail.spec(own, whole, state.lanesWindow.x, null, laneWidth);
                laneDetail.set(path, [finer, ...detail.drawn(own, whole, state.lanesWindow.x)].filter((item): item is StageSpec => !!item));
                if (finer) asked.set(finer.key, { wanted: finer, paths: [...(asked.get(finer.key)?.paths ?? []), path] });
            }
            for (const { wanted, paths } of asked.values()) want(wanted, paths);
        }
        // Over a region, the files' metrics over it too, for D and the report (before a base group's detail, which a
        // new zoom asks for again); the base recording measured against is not a track here, but D and the report
        // read its region values too.
        if (region && !waiting && !broken) want(regionSpec(), referencePath ? [...files, referencePath] : files);
        for (const [group, { paths }] of byChannel) {
            const fineSpec = fineSpecs.get(group);
            if (fineSpec) fineMissing = want(fineSpec, paths) || fineMissing;
        }
        const fine = (path: string): StageView | null | undefined => {
            const fineSpec = fineSpecs.get(groupOf(path));
            const own = fineSpec ? source.view(fineSpec, path) : undefined;
            if (own !== undefined) return own;
            for (const drawnSpec of drawnSpecs.get(groupOf(path)) ?? []) {
                const view = source.view(drawnSpec, path);
                if (view) return view;
            }
            return undefined;
        };
        const shown = (path: string) => fine(path) ?? coarse(path);
        // A median or a difference is taken of pictures over one range: a line panned along draws its newer detail
        // as soon as it is in, but a member's newer detail is never set beside another's older one.
        const fineOf = (path: string): StageSpec[] => [fineSpecs.get(groupOf(path)), ...(drawnSpecs.get(groupOf(path)) ?? [])].filter((item): item is StageSpec => !!item);
        const together = (paths: readonly string[]): ((path: string) => StageView | undefined) | null => {
            const views = onOneRange(paths, fineOf, (fineSpec, path) => source.view(fineSpec, path));
            return views ? (path: string) => views.get(path) : null;
        };
        // A base of one recording: its detail once in, its whole picture until then (a group's median is combined).
        const baseShown = (basePaths.length === 1 ? together(basePaths) : null) ?? coarse;
        stepBar.element.dataset.stage = id;
        stepBar.element.dataset.detail = String(fineSpecs.size > 0 && !fineMissing);
        // How many of the tracks are drawn from their detail, for tests.
        stepBar.element.dataset.detailLines = String(tracks.filter(track => fine(track.filePath)).length);
        root.dataset.layout = overlay ? 'overlay' : 'lanes';
        // A trigger's events over the tracks: the plot keeps its height above them rather than spill over them.
        root.dataset.marked = String(marked);
        // The zoom, for tests: "start–end" of the horizontal axis.
        const span = (range: { start: number; end: number }): string => `${range.start.toFixed(3)}-${range.end.toFixed(3)}`;
        root.dataset.xWindow = span(state.window.x);
        // Each plot's own vertical zoom, and the lanes' own zoom under a trigger, for tests.
        root.dataset.yWindow = span(state.window.y);
        root.dataset.diffYWindow = span(state.diffY);
        root.dataset.lanesWindow = `${span(state.lanesWindow.x)} ${span(state.lanesWindow.y)}`;
        painted = true;
        paintBaseGate(dom, strings, { gated, count: allBase.length, ms: cost.ms });
        // A base group's median and the compared file's difference, taken by the backend from the Frames' full
        // resolution (combineSource.ts): of the whole pictures (the headline and the axes), and once zoomed of the
        // part on screen. Their pictures' values are scanned again once if the backend no longer keeps them.
        const combined = [...basePaths, ...(comparePath && !basePaths.includes(comparePath) ? [comparePath] : [])];
        const combineIdentity = [comparePath ?? '', ...basePaths, ...combined.map(path => specFor(path).key)].join('|');
        const forget = (keys: readonly string[]): void => {
            for (const path of combined) {
                const key = coarse(path)?.data;
                if (key && keys.includes(key)) source.forget(specFor(path), path);
            }
            deps.rerender();
        };
        const ask = held_ && !picture ? undefined : combineRequest(coarse, comparePath, basePaths, path => !!source.result(specFor(path), path)?.stageDataTooLarge);
        const asked = ask === 'tooLarge' ? null : ask;
        const coarseCombined = ask === 'tooLarge' ? TOO_LARGE_COMBINED : asked === null ? NOTHING_COMBINED : asked ? combine.get(combineIdentity, asked, forget) : undefined;
        const fineDetail = fineSpecs.get(groupOf(comparePath ?? basePaths[0] ?? ''))?.message.detail;
        // Once the zoom settles, the window on screen itself: the Δ headline's peak is looked for in it alone (C4).
        const peakWindow = fineDetail && picture && detail.settled() ? {
            peakX: [axisValueAt(picture, state.window.x.start), axisValueAt(picture, state.window.x.end)],
            ...(picture.kind === 'heatmap' ? { peakY: [rowValueAt(picture, state.window.y.start), rowValueAt(picture, state.window.y.end)] } : {}),
        } : undefined;
        const fineAsk = fineDetail ? { ...fineDetail, ...peakWindow } : undefined;
        const fineCombined = asked && fineAsk ? combine.get(`${combineIdentity}|${JSON.stringify(fineAsk)}`, { ...asked, detail: fineAsk }, forget) : undefined;
        // The last zoomed answer, for the pictures it was taken of only (createLastFine, A35).
        if (fineCombined && asked) lastFine.keep(combineIdentity, asked, fineCombined);
        const shownCombined = fineCombined ?? (fineDetail && asked ? lastFine.of(combineIdentity, asked) : undefined) ?? coarseCombined;
        const combining = !waiting && asked != null && coarseCombined === undefined;
        const coarsePlots = plotsOf(coarse, tracks, comparePath, basePaths, coarseCombined);
        // Where each picture's numbers are read (R7): a recording's own full data, or the median and the difference
        // taken again from the recordings' full data around the pointer.
        const medians = new Set([coarseCombined?.base, fineCombined?.base, shownCombined?.base].filter(Boolean));
        const diffs = new Set([coarseCombined?.diff, fineCombined?.diff, shownCombined?.diff].filter(Boolean));
        const fullOf = (view: StageView | null | undefined): FullRead | undefined => {
            // Read with the compared recording, which the median was aligned with (stage_combine.read_points).
            if (view && asked && medians.has(view)) return reader.combined(asked.base, asked.compare ?? null, 'base');
            if (view && asked?.compare && diffs.has(view)) return reader.combined(asked.base, asked.compare, 'diff');
            return reader.of(view);
        };
        shownCompare = { path: comparePath, view: comparePath && !waiting ? coarse(comparePath) : undefined };
        // The events left out of each recording's, on the trigger's picture (and a step after it that keeps them).
        const excluded = (path: string): readonly number[] => (viewTrigger ? excludedOf(recipe.recipe, eventsKey(viewTrigger, path, channelFor(path))) : []);
        channelOf = channelFor;
        // Each recording's legend name and readout say uncalibrated where its axis does not (R1, R4: legendWords).
        const { word, baseWord } = legendWords(strings, allTracks, [comparePath, ...tracks.map(track => track.filePath)], basePaths, levelOf);
        // The base's line is on the axis of its own recordings' reference (R1): never a track's it is not of.
        const baseInput = axisInputOf(basePaths.map(levelOf)) ?? compareInput;
        const namedHere = (path: string, slot: number | undefined): ReturnType<typeof named> => { const name = named(path, slot); const said = word(path); return said ? { ...name, label: `${name.label}${said}` } : name; };
        const frame: StageFrame = { strings, tracks, allTracks, referencePath, comparePath, coarse, shown, picture, coarsePlots, fullOf, window: state.window, diffY: state.diffY, diffOfWindow: !!fineCombined && !!peakWindow, regionMark, pending, waiting: waiting || combining, role, named: namedHere, drawnOn, baseEach: each, excluded, levelOf, ...(baseInput ? { baseInput } : {}), ...(coarseCombined?.tooLarge ? { tooLarge: true } : {}), ...(coarseCombined?.noDelta ? { noDelta: coarseCombined.noDelta } : {}), ...(coarseCombined?.failed ? { failed: true } : {}) };
        const bypassed = steps.filter(step => step.bypassed).map(step => stepChipLabel(step, strings, state.regionSet));
        query<HTMLElement>('[data-stage-headline]').textContent = stageModeHeadline(frame, bypassed, region);
        if (!overlay) {
            stepBar.element.dataset.drawn = String(paintStageLanes(frame));
            return;
        }
        // Overlaid: the base, the other tracks and the compared one on one plot, as the comparison draws them.
        const plots = plotsOf(shown, tracks, comparePath, basePaths, shownCombined, baseShown);
        root.dataset.compared = comparePath ? String(role(comparePath) ?? '') : '';
        root.dataset.base = state.groupBase || !deps.slots()[0] ? 'group' : 'file';
        // The heading's n is the step figure's set's: the base's recordings left out here (failed, empty) are said so.
        const leftOut = waitingBase ? [] : stageSet.excluded;
        const baseTitle = (path: string): string => { const title = deps.baseTitle(path, state.groupBase, leftOut) + baseWord; return each ? eachBaseTitle(title, strings) : title; };
        const aggregate = each ? strings.stageBaseEach : strings.stageBaseAggregate;
        query<HTMLElement>('[data-stage-base-aggregate]').textContent = aggregate;
        const baseLabel = comparePath ? baseTitle(comparePath) : basePaths.length === 1 ? namedHere(basePaths[0], role(basePaths[0])).label : undefined;
        const layers = overlayLayers(frame, plots, baseLabel, basePaths.length === 1 ? basePaths[0] : undefined);
        stepBar.element.dataset.drawn = String(layers.length);
        const items = overlayLegendItems(frame, plots, {
            title: comparePath && !referencePath ? baseTitle(comparePath) : '',
            // A base group (not a slot-0 file) has a ▾ that says how its curve is made.
            group: !!comparePath && (state.groupBase || !deps.slots()[0]),
            aggregate,
            gated, count: allBase.length, held: state.held !== null, playable,
        });
        const legend = query<HTMLElement>('[data-stage-legend]');
        legend.dataset.memos = items.filter(item => item.memo).length.toString();
        // An open role chip's menu stays open: the legend is drawn again once it closes.
        legendWritten = writeStageLegend(legend, legendHtml(items, strings), legendWritten, document);
        paintStageOverlay(dom, frame, plots, layers, state.showDiff);
        if (marked && triggerShown) {
            const params = triggerShown.params;
            const number = (name: string, fallback: number): number => (typeof params[name] === 'number' ? params[name] : fallback);
            const duration = number('duration', 0);
            const trigger = { threshold: number('threshold', 0), channel: number('channel', 0), duration, pre: number('pre', 0) };
            const events = (path: string) => coarse(path)?.events;
            marks = { trigger, events };
            lanesMarked = true;
            const lanesDrawn = paintTriggerLanes({
                strings, tracks, trigger, excluded, drawnOn, window: state.lanesWindow, events, fullOf: view => reader.of(view),
                signal: path => { const wanted = signalSpec(path); return wanted ? source.view(wanted, path) : undefined; },
                detail: path => (laneDetail.get(path) ?? []).map(wanted => source.view(wanted, path)).find(view => !!view),
                color: path => colorOf(role, path, tracks.find(track => track.filePath === path)?.color ?? ownColor(0)),
                axes: (view, path) => stageNames(strings, view, tracks.find(track => track.filePath === path)?.input),
            });
            root.dataset.lanesMarked = String(lanesDrawn);
        }
    }
    return {
        root,
        bar: stepBar.element,
        report,
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
            // The plain tracks are not repainted by the comparison: its marks on them go when it closes.
            if (!state.on) { clearTriggerLanes(document); root.dataset.lanesMarked = ''; marks = null; }
            if (!state.on) document.querySelectorAll<HTMLElement>('[data-lane-label]').forEach(canvas => { canvas.setAttribute('aria-label', canvas.dataset.laneLabel ?? ''); delete canvas.dataset.laneLabel; });
            // A selection not yet taken as the region is not taken later, when the comparison is opened some other way.
            if (!state.on) state.pendingRegion = null;
            deps.rerender();
        },
        paint() {
            lanesMarked = false;
            paintNow();
            if (!lanesMarked) { clearTriggerLanes(document); root.dataset.lanesMarked = ''; marks = null; }
        },
        handle: message => source.handle(message) || combine.handle(message) || reader.handle(message) || reportSource.handle(message),
        snapshot() {
            const view = shownCompare.view;
            return {
                open: state.on,
                comparing: shownCompare.path,
                base: deps.slots()[0] ?? null,
                headline: query<HTMLElement>('[data-stage-headline]').textContent ?? '',
                stage: state.on ? chosen() : null,
                frame: view?.frame ?? null,
                kind: view ? (view.waveform ? 'line' : view.kind) : null,
                ...pictureSummary(view),
                invalidSteps: stepBar.element.querySelectorAll('.step-chip.is-invalid').length,
            };
        },
        attach(surface) {
            stageGestures = attachStageGestures(surface, root, document, { strings, state, drawnOn, painted: () => painted, moved: () => detail.moved(), rerender: () => deps.rerender(), hint: text => deps.hint(text), lanesApart: () => lanesMarked, toggleEvent });
        },
    };
}

