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
import type { UiStrings } from '../../shared/i18n/strings';
import type { CompareScanMessage } from '../../shared/analysis/entryScan';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { activeSlotReferenced, brokenStep, chainEnd, recipeChain, recipeKey, recipeSteps, slotReferenced, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { createStepBar, endsInSpectrum, invalidReason, recipeWithout, stepChipLabel, unpairedRecipe, stepLimits, INPUT_STAGE, OCTAVE_BRANCH } from './stepBar';
import { createStageSource, type StageSpec } from './stageSource';
import { createDetailPlanner } from './stageDetail';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, medianView, paintOverlay, paintStage, rowFractionOf, rowValueAt, STAGE_MARGINS, stageAxes, stageDiffRange, stageDifference, stageHeadline, stageLevelsHeadline, stagePlotPoint, stageRange, stageReadout, stageHover, strokeStageLine, type StageAxes, type StageLayer, type StagePlot } from './stagePanes';
import { paintHoverMarks } from './plotHover';
import { DIFF_COLOR, NO_ROLE_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { zoomNormalizedRange, ZOOM_IN_FACTOR } from './waveformInteraction';
import { keyRouterFor } from './keyRouter';
import { COMPARE_KEYS, keyAction } from './shortcuts';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { positionPopover } from './settingsPopover';
import { legendHtml, type LegendItem, type PaneRange } from './comparePanes';
import { regionLabel } from './entryTable';
import { baseName } from '../../shared/analysis/entryMetadata';
import { withChannel } from '../../shared/recipe/channelSelection';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';

/** The roles' colours: the base blue, slots 1–3 yellow, purple, magenta (as their cards and badges). */

export interface StageTrack {
    filePath: string;
    color: string;
    canvas: HTMLCanvasElement | null;
    /** The lane's own axis canvas: cleared, the stage painter draws its axes on the lane. */
    axis: HTMLCanvasElement | null;
    input?: { unit?: string; ref?: number };
}

export interface TrackStageDeps {
    document: Document;
    window: Pick<Window, 'setTimeout' | 'requestAnimationFrame' | 'clearTimeout' | 'addEventListener'> & { performance: Pick<Performance, 'now'> };
    strings: UiStrings;
    post(message: CompareScanMessage): void;
    /** The Recipe the entry table scans with, and the one its scans run (the steps that cannot run left out). */
    recipe(): { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> } | null;
    recipeChanged(recipe: RecipeDocument): void;
    /** The tracks on screen, in display order. */
    tracks(): StageTrack[];
    /** The entry table's slots 0–3, the base of a compared file and its name. */
    slots(): (string | null)[];
    basePaths(comparePath: string, group?: boolean): string[];
    baseTitle(comparePath: string, group?: boolean): string;
    /** The channel a file is drawn with when `comparePath` is compared: a slot's channel row, the base's members of that channel. */
    stageChannel?(path: string, comparePath: string | null, group?: boolean): number | null;
    /**
     * A base group too large to scan unasked: its median 1/3-octave levels from what the table has computed
     * (the channel compared), and how many of its recordings have them; null when none do.
     */
    tableBaseBands?(comparePath: string, group?: boolean): { centers: number[]; values: (number | null)[]; count: number } | null;
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
    report(showDiff: boolean, region: EntryRegion | null, measured: ReadonlyMap<string, ScanResult>): void;
    sampleRate(): number | undefined;
    /** The fewest channels of the compared files: a step that compares two channels needs two. */
    channels?(): number | undefined;
    /** Shows or hides the track lanes (hidden while overlaid). */
    showLanes(visible: boolean): void;
    rerender(): void;
    hint(text: string): void;
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

/** How many points of a picture have a level (silence floors at −300 dB), and their median. */
function pictureSummary(view: StageView | null | undefined): { stageValues: number; stageMedian: number | null } {
    const values = (view?.values ?? view?.matrix?.flat() ?? []).filter((value): value is number => value !== null && value > -250);
    const sorted = [...values].sort((a, b) => a - b);
    return { stageValues: values.length, stageMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
}

/** A press shorter than this is a tap (compare that slot); longer is a hold (compare it until released), as on the entry table. */
const TAP_MS = 250;

/** A base group of more recordings than this, or more audio (s), is not scanned for the comparison's pictures until the user asks. */
export const LARGE_BASE = 30;
export const LARGE_BASE_S = 30 * 60;

/** The Frames drawn as images (stage_view.py's heatmaps): they are not overlaid, each stays in its track's lane. */
const IMAGE_FRAMES = new Set(['SpectrogramFrame', 'CepstrogramFrame', 'RoughnessFrame']);

const narrowed = (range: PaneRange, y: { start: number; end: number }): PaneRange => ({ min: range.min + y.start * (range.max - range.min), max: range.min + y.end * (range.max - range.min) });

export function createTrackStageMode(deps: TrackStageDeps): TrackStageMode {
    const { strings, document } = deps;
    let on = false;
    let stage: string | null = null;
    let overlaid = true;
    let showDiff = false;
    let window_: PlotWindow = FULL_PLOT_WINDOW;
    /** The slot compared (1–3), the one held for a moment, and whether the base is the group median though slot 0 is set (0). */
    let compared = 1;
    let held: number | null = null;
    let groupBase = false;
    /** The region set with the step bar's region chip (s; null: the whole file), and the step held to see the chain without it. */
    let regionSet: EntryRegion | null = null;
    /** The tracks' selection waiting to be the region chip (set as the comparison opens from the tracks). */
    let pendingRegion: EntryRegion | null = null;
    /** The part of the files compared: the region chip's, unless it is bypassed. */
    function liveRegion(): EntryRegion | null {
        const recipe = deps.recipe()?.recipe;
        const slice = recipe ? recipeSteps(recipe).find(step => step.operation === TIME_SLICE) : undefined;
        return slice?.bypassed ? null : regionSet;
    }
    let heldStep: RecipeStep | null = null;
    /** Large base groups the user asked to scan, and the one on screen. */
    const baseAllowed = new Set<string>();
    let gateKey: string | null = null;
    const source = createStageSource('track-stage', message => deps.post(message), () => deps.rerender());
    const detail = createDetailPlanner(deps.window.performance, deps.window, () => deps.rerender());
    const stepBar = createStepBar({
        document, strings, mode: 'compare',
        onChange: recipe => deps.recipeChanged(recipe),
        onStepSelect: step => { stage = step.id; window_ = FULL_PLOT_WINDOW; deps.rerender(); },
        // A step added or moved is shown at once: its result is what the user wants to see next.
        onStepShown: id => { stage = id; window_ = FULL_PLOT_WINDOW; deps.rerender(); },
        // Holding a step shows the picture on screen without it (the step before it, when it is the one on screen).
        canHold: step => !!holdSpec(step),
        onStepHold: step => { heldStep = step; deps.rerender(); },
        onRegionSet: next => { regionSet = next; window_ = FULL_PLOT_WINDOW; deps.rerender(); },
        onInputSelect: () => { stage = INPUT_STAGE; window_ = FULL_PLOT_WINDOW; deps.rerender(); },
    });
    stepBar.element.classList.add('track-stage-bar');
    const root = document.createElement('div');
    root.className = 'track-stage';
    root.hidden = true;
    root.innerHTML = `<div class="track-stage-controls">`
        + `<button type="button" class="tb-btn" data-action="stage-layout" aria-pressed="true">${escapeHtml(strings.stageLayoutSide)}</button>`
        + `<button type="button" class="tb-btn" data-action="stage-diff" aria-pressed="false">${escapeHtml(strings.compareDiffShow)}</button>`
        + `<span class="compare-value track-stage-headline" data-stage-headline></span>`
        + `<span class="track-stage-gate" data-stage-base-gate hidden><button type="button" class="tb-btn" data-action="stage-base-scan"></button></span></div>`
        + `<div class="track-stage-panel" data-stage-panel>`
        + `<div class="compare-pane-head compare-legend" data-stage-legend></div>`
        + `<div class="track-stage-base-info" data-stage-base-info hidden><div>${escapeHtml(strings.stageBaseAggregate)}</div>`
        + `<button type="button" class="tb-link" data-action="stage-base-list">${escapeHtml(strings.stageBaseList)}</button></div>`
        + `<canvas data-stage-canvas="overlay" role="img" aria-label="${escapeHtml(strings.ariaStageOverlayCanvas)}"></canvas>`
        + `<div class="track-stage-diff" data-stage-diff hidden><span class="compare-value" data-stage-diff-headline></span><canvas data-stage-canvas="diff" role="img" aria-label="${escapeHtml(strings.ariaStageDiffCanvas)}"></canvas></div>`
        + `</div>`;
    root.prepend(stepBar.element);
    const query = <T extends Element>(selector: string): T => root.querySelector<T>(selector)!;
    const panel = query<HTMLElement>('[data-stage-panel]');
    /** The comparison written as a folder (the toolbar's 書き出し menu): a chain that cannot run has no values to report. */
    function report(): void {
        const recipe = deps.recipe()?.recipe;
        if (recipe && brokenStep(recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() }))) deps.hint(strings.stepOctaveBroken);
        else deps.report(showDiff, liveRegion(), measured());
    }
    root.addEventListener('click', event => {
        const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
        if (action === 'stage-layout') { overlaid = !overlaid; deps.rerender(); }
        else if (action === 'stage-diff') { showDiff = !showDiff; deps.rerender(); }
        else if (action === 'compare-play') { const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path; if (path) deps.play?.(path, liveRegion()); }
        // A large base group is scanned only when asked (a folder of 10,000 files is not analysed by opening a comparison).
        else if (action === 'stage-base-scan') { if (gateKey) baseAllowed.add(gateKey); deps.rerender(); }
        // The base group's ▾ says how its curve is made; "list" shows its files on the table.
        else if (action === 'stage-base-info') { const info = query<HTMLElement>('[data-stage-base-info]'); info.hidden = !info.hidden; }
        else if (action === 'stage-base-list') { query<HTMLElement>('[data-stage-base-info]').hidden = true; deps.showCompared(); }

    });
    /** The files' scans over the region (their metrics), for D and the report; asked for while a region is set. */
    function regionSpec(): StageSpec {
        const region = liveRegion();
        // The metrics: the base recording is not paired in this scan, so the steps measured against it are left out.
        const run = unpairedRecipe(deps.recipe()?.runRecipe, deps.recipe()?.recipe);
        return { key: `region|${recipeKey(run)}|${regionLabel(region)}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}) } };
    }
    function measured(): ReadonlyMap<string, ScanResult> {
        if (!liveRegion()) return new Map();
        const files = [...new Set([...deps.tracks().map(track => track.filePath), ...deps.tracks().flatMap(track => deps.basePaths(track.filePath, groupBase))])];
        const spec = regionSpec();
        return new Map(files.flatMap(path => { const result = source.result(spec, path); return result ? [[path, result] as [string, ScanResult]] : []; }));
    }
    /** The compared file: the slot held or tapped, else the first slot among the tracks. */
    function comparedPath(tracks: readonly StageTrack[]): string | null {
        const slots = deps.slots();
        const present = (slot: number): boolean => !!slots[slot] && tracks.some(track => track.filePath === slots[slot]);
        const slot = held !== null && present(held) ? held : present(compared) ? compared : [1, 2, 3].find(present);
        return slot === undefined ? null : slots[slot]!;
    }
    // The comparison's keys (COMPARE_KEYS): 1–3 tap = compare that slot, hold = compare it until released; B switches
    // the base between the slot-0 file and the group median; + / − / 0 zoom as on the lanes; D fixes the difference
    // as a row of the entry table; Esc goes back to the entry table.
    let pressing: { slot: number; at: number; timer: number } | null = null;
    const keysLive = (event: KeyboardEvent): boolean => on && deps.inFront() && !(event.target as Element | null)?.closest?.('input, select, textarea, [data-step-bar], #track-stage-range-popover, details.role-chip');
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
                pressing = { slot, at: deps.window.performance.now(), timer: deps.window.setTimeout(() => { held = slot; deps.rerender(); }, TAP_MS) };
            } else if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
                // About the horizontal axis's middle, as on the lanes (a double-click resets too).
                event.preventDefault();
                window_ = { ...window_, x: action === 'zoom-reset' ? FULL_PLOT_WINDOW.x : zoomNormalizedRange(window_.x, action === 'zoom-out' ? 1 / ZOOM_IN_FACTOR : ZOOM_IN_FACTOR) };
                detail.moved();
                deps.rerender();
            } else if (action === 'toggle-base') {
                event.preventDefault();
                groupBase = !groupBase;
                deps.rerender();
            } else if (action === 'fix') {
                event.preventDefault();
                const path = comparedPath(deps.tracks());
                const region = liveRegion();
                const recipe = deps.recipe()?.recipe;
                const refused = recipe && brokenStep(recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() })) ? strings.stepOctaveBroken
                    : !path ? strings.compareRefuseSlot.replace('{n}', String(compared))
                    : region && !measured().has(path) ? strings.compareRefuseFix.replace('{why}', strings.comparePending)
                        : deps.fix(path, groupBase, region, measured());
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
            if (held !== null) held = null;
            else compared = pressing.slot;
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
        if (!recipe) return null;
        const limits = stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() });
        const all = recipeSteps(recipe, limits);
        const steps = all.filter(step => step.invalid === undefined && !step.bypassed);
        if (stage === INPUT_STAGE) return INPUT_STAGE;
        // The app's 1/3-octave branch stands beside a chain that ends in a spectrum: its bands are a step to show too.
        // A comparison opens on it, as the table's band column reads it, so the headline and the table agree.
        const spectral = endsInSpectrum(recipe, limits) || (!!brokenStep(recipe, limits) && ['SpectralFrame', 'NOctFrame'].includes(chainEnd(recipe, limits)));
        if ((stage ?? OCTAVE_BRANCH) === OCTAVE_BRANCH && spectral) return OCTAVE_BRANCH;
        const at = all.findIndex(step => step.id === stage);
        // A step that cannot run is shown as such (paint says why); a bypassed one, as the chain gives it there: the step before.
        if (at >= 0 && all[at].invalid !== undefined) return stage;
        if (at >= 0 && all[at].bypassed) return all.slice(0, at).reverse().find(step => step.invalid === undefined && !step.bypassed)?.id ?? INPUT_STAGE;
        return stage && steps.some(step => step.id === stage) ? stage : steps.at(-1)?.id ?? null;
    }
    /** The Recipe a picture is scanned with: the run Recipe, with a get_channel step for one channel. */
    function channelRecipe(recipe: RecipeDocument | undefined, ch: number | null): RecipeDocument | undefined {
        if (!ch) return recipe;
        const own = recipe ?? deps.recipe()?.recipe;
        // A step measured against the base slot pairs one channel of each recording: the channel row's goes on.
        return own ? withChannel(own, ch, activeSlotReferenced(deps.recipe()?.recipe).length > 0) : undefined;
    }
    function spec(id: string, ch: number | null = null): StageSpec {
        const region = liveRegion();
        const run = channelRecipe(deps.recipe()?.runRecipe, ch);
        return { key: `stage|${recipeKey(run)}|${regionLabel(region)}|${id}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), stage: id } };
    }
    /** What holding `step` draws: the chain without it (and the steps that then cannot run), on the step on screen. */
    function holdSpec(step: RecipeStep, ch: number | null = null): StageSpec | undefined {
        const recipe = deps.recipe();
        const id = chosen();
        if (!recipe || !id || step.id === OCTAVE_BRANCH || step.operation === TIME_SLICE) return undefined;
        const limits = stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() });
        const steps = recipeSteps(recipe.recipe, limits).filter(item => item.invalid === undefined);
        const at = steps.findIndex(item => item.id === id);
        const shownOf = step.id === id ? steps[at - 1]?.id : id;
        if (!shownOf) return undefined;
        const unselected = recipeWithout(recipe.runRecipe ?? recipe.recipe, step.id, shownOf, limits, slotReferenced(recipe.recipe));
        if (!unselected) return undefined;
        const without = channelRecipe(unselected, ch)!;
        const region = liveRegion();
        return { key: `hold|${recipeKey(without)}|${regionLabel(region)}|${shownOf}`, message: { recipe: without, ...(region ? { region } : {}), stage: shownOf } };
    }
    /** What the plots last drew, for placing the pointer on them, and the compared file's picture for tests. */
    let painted = false;
    /**
     * What each plot last drew, for the pointer's readout and an axis's range: the whole picture whose axes it
     * uses, its level range before the vertical zoom, its axes' names, the pictures read under the pointer, and
     * where its lines are (the line nearest the pointer is picked from them).
     */
    type Drawn = { picture: StageView | null; range: PaneRange; axes: StageAxes; views: { base: StageView | null; compare: StageView | null; diff: StageView | null }; plot?: StagePlot | null };
    const drawnOn = new Map<Element, Drawn>();
    /** Where the pointer is over a plot, so its marks follow a plot drawn anew under a still pointer. */
    let hovered: { plot: HTMLElement; clientX: number; clientY: number; fx: number } | null = null;
    let redrawHover = (): void => {};
    let redrawing = false;
    let shownCompare: { path: string | null; view: StageView | null | undefined } = { path: null, view: undefined };
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
    function plotsOf(views: (path: string) => StageView | null | undefined, tracks: StageTrack[], comparePath: string | null, basePaths: readonly string[], fallback: StageView | null = null, baseOf = views) {
        const baseViews = basePaths.map(baseOf).filter((view): view is StageView => !!view);
        const base = baseViews.length && baseViews.length === basePaths.length ? medianView(baseViews) : fallback;
        const compare = comparePath ? views(comparePath) ?? null : null;
        const others = tracks.filter(track => track.filePath !== comparePath && !basePaths.includes(track.filePath)).map(track => ({ track, view: views(track.filePath) ?? null }));
        return { base, compare, others, diff: comparePath && !basePaths.includes(comparePath) ? stageDifference(base, compare) : null };
    }
    return {
        root,
        bar: stepBar.element,
        report,
        active: () => on,
        role,
        importRegion(range) {
            pendingRegion = range;
            deps.rerender();
        },
        open(next) {
            stage = next ?? null;
            compared = 1;
            held = null;
            groupBase = false;
            heldStep = null;
            window_ = FULL_PLOT_WINDOW;
            overlaid = true;
            pendingRegion = null;
            this.setActive(true);
        },
        setActive(next) {
            on = next;
            root.hidden = !on;
            if (!on) deps.showLanes(true);
            if (!on) document.querySelectorAll<HTMLElement>('[data-lane-label]').forEach(canvas => { canvas.setAttribute('aria-label', canvas.dataset.laneLabel!); delete canvas.dataset.laneLabel; });
            // A selection not yet taken as the region is not taken later, when the comparison is opened some other way.
            if (!on) pendingRegion = null;
            deps.rerender();
        },
        paint() {
            if (!on) return;
            // A plot drawn anew under a still pointer: its hover marks are drawn again on what it now shows.
            if (hovered && !redrawing) {
                redrawing = true;
                deps.window.requestAnimationFrame(() => { redrawing = false; redrawHover(); });
            }
            const recipe = deps.recipe();
            const id = chosen();
            const shownStage = stage && recipe && recipeSteps(recipe.recipe).find(step => step.id === stage)?.bypassed ? stage : id;
            stepBar.set({ recipe: recipe?.recipe ?? null, sampleRate: deps.sampleRate(), channels: deps.channels?.(), stage: shownStage ?? undefined, regionRange: regionSet, failed: recipe?.failed });
            // The tracks' selection becomes the region chip once the bar has the chain; a region already there stays.
            if (pendingRegion) {
                const range = pendingRegion;
                pendingRegion = null;
                if (recipe && !regionSet && stepBar.importRegion(range)) return;
            }
            const allTracks = deps.tracks();
            painted = false;
            // Each plot drawn below says again what it holds: one drawn empty keeps no lines to hover.
            drawnOn.clear();
            stepBar.element.dataset.drawn = '0';
            if (!recipe || !id) {
                deps.showLanes(true);
                panel.hidden = true;
                for (const track of allTracks) if (track.canvas) paintStage(track.canvas, null, { min: 0, max: 1 }, track.color, { x: '', y: '' }, { empty: strings.stepOpenCompare });
                return;
            }
            const steps = recipeSteps(recipe.recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() }));
            // A step that cannot run has no picture: the plot says why, and how to fix it.
            const broken = brokenStep(recipe.recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() }));
            const cannot = steps.find(step => step.id === id && step.invalid !== undefined) ?? (id === OCTAVE_BRANCH && broken ? { ...broken, id: OCTAVE_BRANCH } : undefined);
            // A step measured against the base slot's recording (at or before the one shown): each other recording is
            // paired with it there, so the base is one recording, and it is the reference rather than a curve of its own.
            const shownIndex = id === OCTAVE_BRANCH ? steps.length : steps.findIndex(step => step.id === id);
            const slotStep = steps.find((step, index) => step.reference === 'slot' && !step.bypassed && step.invalid === undefined && index <= shownIndex);
            const referencePath = slotStep && !groupBase ? deps.slots()[0] ?? null : null;
            const needBase = !!slotStep && !referencePath;
            if (cannot || needBase) {
                root.dataset.pending = '';
                deps.showLanes(false);
                panel.hidden = false;
                query<HTMLElement>('[data-stage-headline]').textContent = '';
                query<HTMLElement>('[data-stage-diff]').hidden = true;
                stepBar.element.dataset.drawn = '0';
                stepBar.element.dataset.stage = id;
                painted = false;
                paintOverlay(query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers: [] }, { min: 0, max: 1 }, { x: '', y: '' },
                    { empty: cannot ? `${strings.stepCannotShow.replace('{why}', invalidReason(cannot, strings, steps))} — ${strings.stepCannotShowFix}` : strings.stageNeedBaseFile });
                return;
            }
            const tracks = referencePath ? allTracks.filter(track => track.filePath !== referencePath) : allTracks;
            // The compared file (the slot tapped or held); its base: slot 0, or the others of its condition (0 switches).
            const comparePath = comparedPath(tracks);
            const allBase = comparePath && !referencePath ? deps.basePaths(comparePath, groupBase) : [];
            // A base group of more than LARGE_BASE recordings is not scanned until 「基準の群 n 本を解析する」.
            gateKey = comparePath ? `${comparePath}|${groupBase}|${allBase.length}|${allBase[0] ?? ''}|${allBase.at(-1) ?? ''}` : null;
            const cost = deps.cost?.(allBase) ?? { seconds: 0, ms: allBase.length * 150 };
            const gated = (allBase.length > LARGE_BASE || cost.seconds > LARGE_BASE_S) && !baseAllowed.has(gateKey!);
            const basePaths = gated ? [] : allBase;
            const files = [...new Set([...tracks.map(track => track.filePath), ...basePaths])];
            // A step held: the picture without it, as scanned for that (the lanes and the plot framed green meanwhile).
            const held_ = heldStep ? holdSpec(heldStep) : undefined;
            // Each file is drawn as the channel it is compared as (a channel row's slot, and its base's members of that channel).
            const channelFor = (path: string): number | null => deps.stageChannel?.(path, comparePath, groupBase) ?? null;
            const plain = (ch: number | null): StageSpec => (held_ ? holdSpec(heldStep!, ch) : undefined) ?? spec(id, ch);
            // Measured against the base slot: the base recording's chain up to that step goes with the request.
            const specOf = (ch: number | null): StageSpec => {
                const own = plain(ch);
                const theirs = referencePath ? plain(channelFor(referencePath)).message.recipe : undefined;
                if (!referencePath || !slotStep || !theirs || !recipeChain(theirs).some(node => node.id === slotStep.id)) return own;
                return { key: `${own.key}|vs|${referencePath}|${recipeKey(theirs)}`, message: { ...own.message, reference: { filePath: referencePath, step: slotStep.id, recipe: theirs } } };
            };
            const byChannel = new Map<number | null, string[]>();
            for (const path of files) byChannel.set(channelFor(path), [...(byChannel.get(channelFor(path)) ?? []), path]);
            root.classList.toggle('is-step-held', !!held_);
            root.dataset.held = held_ ? heldStep!.id : '';
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
            const waiting = [...byChannel].some(([ch, paths]) => lacks(specOf(ch), paths));
            for (const [ch, paths] of byChannel) want(specOf(ch), ownOf(paths));
            const region = liveRegion();
            root.dataset.region = regionLabel(region);
            // The region on the plots: its part of a whole-file picture (a step before the region's), else a corner tag.
            const sliceAt = steps.findIndex(step => step.operation === TIME_SLICE);
            const shownAt = id === INPUT_STAGE ? -1 : id === OCTAVE_BRANCH ? steps.length : steps.findIndex(step => step.id === id);
            const regionMark = region ? { start: region.start, end: region.end, mark: shownAt < sliceAt ? 'range' as const : 'tag' as const, label: `${strings.stepRegion} ${region.start.toFixed(2)}–${region.end.toFixed(2)} s` } : undefined;
            root.dataset.regionMark = regionMark?.mark ?? '';
            const coarse = (path: string) => source.view(specOf(channelFor(path)), path);
            const picture = tracks.map(track => coarse(track.filePath)).find((view): view is StageView => !!view) ?? null;
            // Before any picture is in, the step's Frame says whether it is an image: the comparison is shown at once,
            // computing, rather than the lanes until the first file is in.
            const frameShown = id === INPUT_STAGE ? INPUT_FRAME : id === OCTAVE_BRANCH ? 'NOctFrame' : steps.find(step => step.id === id)?.output;
            // (A step held draws the chain without it, another Frame: the lanes until its first picture, as before.)
            const images = picture ? picture.kind === 'heatmap' || picture.kind === 'none' : !waiting || !!held_ || IMAGE_FRAMES.has(frameShown ?? '');
            // The files in of all asked for, said on the plots while any is missing.
            const done = files.filter(path => coarse(path) !== undefined).length;
            const pending = waiting ? { done, total: files.length, label: strings.dsComputing.replace('{done}', String(done)).replace('{n}', String(files.length)) } : undefined;
            root.dataset.pending = pending ? `${done}/${files.length}` : '';
            const overlay = overlaid && !images;
            deps.showLanes(!overlay);
            panel.hidden = !overlay;
            const layout = query<HTMLButtonElement>('[data-action="stage-layout"]');
            layout.textContent = overlaid ? strings.stageLayoutSide : strings.stageLayoutOverlay;
            layout.setAttribute('aria-pressed', String(overlaid));
            // Images cannot be overlaid: the toggle has nothing to offer then.
            layout.hidden = images;
            const diffButton = query<HTMLButtonElement>('[data-action="stage-diff"]');
            diffButton.textContent = showDiff ? strings.compareDiffHide : strings.compareDiffShow;
            diffButton.setAttribute('aria-pressed', String(showDiff));
            diffButton.hidden = !overlay || !!referencePath;
            // Without a compared file there is no difference to show.
            const nothingCompared = !comparedPath(tracks);
            diffButton.disabled = nothingCompared;
            // Zoomed, the plots draw from the Frames' full resolution once it is in, the coarse pictures until then.
            const width = (overlay ? query<HTMLCanvasElement>('[data-stage-canvas="overlay"]') : tracks.find(track => track.canvas)?.canvas)?.clientWidth || 600;
            // Each line is drawn from its own detail as soon as that is in, while a base group's recordings are still
            // being asked for (its median switches once all of them have their detail).
            const fineSpecs = new Map<number | null, StageSpec>();
            let fineMissing = false;
            if (!held_ && picture && picture.kind !== 'bar' && picture.kind !== 'none') {
                for (const [ch, paths] of byChannel) {
                    const fineSpec = detail.spec(specOf(ch), picture, window_.x, window_.y, width);
                    if (!fineSpec) continue;
                    fineSpecs.set(ch, fineSpec);
                    fineMissing = want(fineSpec, ownOf(paths)) || fineMissing;
                }
            }
            for (const [ch, paths] of byChannel) want(specOf(ch), paths);
            // Over a region, the files' metrics over it too, for D and the report (before a base group's detail, which a
            // new zoom asks for again); the base recording measured against is not a track here, but D and the report
            // read its region values too.
            if (region && !waiting && !broken) want(regionSpec(), referencePath ? [...files, referencePath] : files);
            for (const [ch, paths] of byChannel) {
                const fineSpec = fineSpecs.get(ch);
                if (fineSpec) fineMissing = want(fineSpec, paths) || fineMissing;
            }
            const fine = (path: string): StageView | null | undefined => {
                const fineSpec = fineSpecs.get(channelFor(path));
                return fineSpec ? source.view(fineSpec, path) : undefined;
            };
            const shown = (path: string) => fine(path) ?? coarse(path);
            // A base group's median: of its recordings' detail once every one has it, of their whole pictures until then.
            const baseShown = basePaths.every(path => fine(path)) ? shown : coarse;
            stepBar.element.dataset.stage = id;
            stepBar.element.dataset.detail = String(fineSpecs.size > 0 && !fineMissing);
            // How many of the tracks are drawn from their detail, for tests.
            stepBar.element.dataset.detailLines = String(tracks.filter(track => fine(track.filePath)).length);
            root.dataset.layout = overlay ? 'overlay' : 'lanes';
            // The zoom, for tests: "start–end" of the horizontal axis.
            root.dataset.xWindow = `${window_.x.start.toFixed(3)}-${window_.x.end.toFixed(3)}`;
            painted = true;
            // Gated, the 1/3-octave picture still has a base: the group's levels the table has computed, on the compared file's bands.
            // The table's values are of the whole files: over a region they are not the base, nor on another step.
            const tableBands = gated && comparePath && id === OCTAVE_BRANCH && !region ? deps.tableBaseBands?.(comparePath, groupBase) ?? null : null;
            const compareCoarse = comparePath ? coarse(comparePath) ?? null : null;
            const tableBase = tableBands && compareCoarse?.values && compareCoarse.xs
                ? { ...compareCoarse, waveform: undefined, values: compareCoarse.xs.map(x => { const at = tableBands.centers.findIndex(center => Math.abs(center - x) / x < 0.06); return at >= 0 ? tableBands.values[at] : null; }) } as StageView
                : null;
            const gate = query<HTMLElement>('[data-stage-base-gate]');
            gate.hidden = !gated;
            root.dataset.baseGate = gated ? String(allBase.length) : '';
            if (gated) {
                const seconds = Math.ceil(cost.ms / 1000);
                const time = seconds >= 60 ? strings.entryMinutes.replace('{n}', String(Math.ceil(seconds / 60))) : strings.entrySeconds.replace('{n}', String(seconds));
                query<HTMLElement>('[data-action="stage-base-scan"]').textContent = strings.stageBaseScan.replace('{n}', String(allBase.length)).replace('{time}', time);
            }
            const coarsePlots = plotsOf(coarse, tracks, comparePath, basePaths, tableBase);
            shownCompare = { path: comparePath, view: comparePath && !waiting ? coarse(comparePath) : undefined };
            const headline = query<HTMLElement>('[data-stage-headline]');
            // While computing, the plots say so (with the files in): the headline waits for the levels.
            headline.textContent = waiting ? ''
                : referencePath ? strings.stageVsBase.replace('{file}', named(referencePath, 0).label)
                // Which difference is shown: the compared slot against the base.
                : comparePath ? (role(comparePath) ? strings.stageCompareMinusBase.replace('{n}', String(role(comparePath))) : '')
                    + stageLevelsHeadline(coarsePlots.base, coarsePlots.compare, coarsePlots.diff, strings)
                // No compare role yet: the lines are there, but nothing to measure against a base; the legend's chips set one.
                : strings.stageChooseRoles;
            // The steps bypassed are named: what is drawn is the chain without them.
            const bypassed = steps.filter(step => step.bypassed).map(step => stepChipLabel(step, strings, regionSet));
            if (bypassed.length && !waiting) headline.textContent += strings.stepBypassing.replace('{ops}', bypassed.join(', '));
            // The part of the files compared, while a region is set.
            if (region && !waiting && comparePath) headline.textContent += ` · ${strings.stepRegion} ${region.start.toFixed(2)}–${region.end.toFixed(2)} s`;
            // Colour is the role's: a recording without one is grey, its name in the legend telling it apart.
            const colorOf = (path: string, fallback = NO_ROLE_COLOR): string => ROLE_COLORS[role(path) ?? -1] ?? fallback;
            const widthOf = (path: string, width: number): number => (role(path) === undefined ? 1.2 : width);
            if (!overlay) {
                // Side by side: every track's lane, on one range so the tracks compare at a glance.
                const range = stageRange(tracks.map(track => coarse(track.filePath) ?? null));
                const heat = picture?.kind === 'heatmap';
                let drawn = 0;
                // Every lane in while the base group is still computed: the first lane says so, in its corner.
                const anyMissing = tracks.some(track => track.canvas && coarse(track.filePath) === undefined);
                const progressLane = anyMissing ? null : tracks.find(track => track.canvas)?.filePath;
                tracks.forEach(track => {
                    track.axis?.getContext('2d')?.clearRect(0, 0, track.axis.width, track.axis.height);
                    if (!track.canvas) return;
                    // The lane shows the step now, not its waveform: its name says so until the comparison closes.
                    track.canvas.dataset.laneLabel ??= track.canvas.getAttribute('aria-label') ?? '';
                    track.canvas.setAttribute('aria-label', strings.ariaStageLaneCanvas.replace('{file}', baseName(track.filePath)));
                    const view = shown(track.filePath) ?? null;
                    const missing = coarse(track.filePath) === undefined;
                    const empty = missing ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
                    const axes = stageAxes(strings, coarse(track.filePath) ?? picture, track.input);
                    // A lane holds one picture, drawn as it is (1/3-octave levels as steps, without a fill).
                    const lanePlot = paintOverlay(track.canvas, { layers: view ? [{ view, color: colorOf(track.filePath), width: widthOf(track.filePath, 2), label: named(track.filePath, role(track.filePath)).label }] : [] }, heat ? range : narrowed(range, window_.y), axes,
                        { empty, window: { x: window_.x, ...(heat ? { y: window_.y } : {}) }, axisView: coarse(track.filePath) ?? picture, ...(regionMark ? { region: regionMark } : {}), ...((missing || track.filePath === progressLane) && pending ? { pending } : {}) });
                    drawnOn.set(track.canvas, { picture: coarse(track.filePath) ?? picture, range, axes, views: { base: coarsePlots.base, compare: coarse(track.filePath) ?? null, diff: null }, plot: lanePlot });
                    if (view) drawn++;
                });
                // The base slot's lane: the reference the others are measured against, not a picture of its own.
                const referenceTrack = referencePath ? allTracks.find(track => track.filePath === referencePath) : undefined;
                if (referenceTrack?.canvas) paintStage(referenceTrack.canvas, null, { min: 0, max: 1 }, referenceTrack.color, { x: '', y: '' }, { empty: strings.stageBaseLane.replace('{file}', named(referencePath!, 0).label) });
                stepBar.element.dataset.drawn = String(drawn);
                return;
            }
            // Overlaid: the base, the other tracks and the compared one on one plot, as the comparison draws them.
            const finePlots = plotsOf(shown, tracks, comparePath, basePaths, tableBase, baseShown);
            // The difference of a line's detail and a base still whole is no difference (their points are at other places
            // even where there are as many): the whole pictures' until both sides have their detail.
            const bothFine = !!comparePath && !!fine(comparePath) && basePaths.length > 0 && baseShown === shown;
            const plots = { ...finePlots, diff: bothFine ? finePlots.diff : coarsePlots.diff };
            root.dataset.compared = comparePath ? String(role(comparePath) ?? '') : '';
            root.dataset.base = groupBase || !deps.slots()[0] ? 'group' : 'file';
            // Each line carries its legend name, for the readout of the line under the pointer.
            const nameOf = (path: string): string => named(path, role(path)).label;
            const layers: StageLayer[] = [
                // The grey lines (no role) under the roles' ones.
                ...plots.others.filter(item => role(item.track.filePath) === undefined).flatMap(item => (item.view ? [{ view: item.view, color: NO_ROLE_COLOR, width: 1.2, label: nameOf(item.track.filePath) }] : [])),
                ...(plots.base ? [{ view: plots.base, color: ROLE_COLORS[0], width: 2, ...(comparePath ? { label: deps.baseTitle(comparePath, groupBase) } : basePaths.length === 1 ? { label: nameOf(basePaths[0]) } : {}) }] : []),
                ...plots.others.filter(item => role(item.track.filePath) !== undefined).flatMap(item => (item.view ? [{ view: item.view, color: colorOf(item.track.filePath), width: 1.8, label: nameOf(item.track.filePath) }] : [])),
                ...(plots.compare && comparePath ? [{ view: plots.compare, color: colorOf(comparePath, ROLE_COLORS[1]), width: 2.2, label: nameOf(comparePath) }] : []),
            ];
            stepBar.element.dataset.drawn = String(layers.length);
            // A base group (not a slot-0 file) has a ▾ that says how its curve is made.
            const groupInfo = comparePath && (groupBase || !deps.slots()[0]);
            const items: LegendItem[] = [
                // A base group not analysed: drawn from the table's whole-file values, or not drawn at all, as its entry says.
                ...(comparePath && !referencePath ? [{ color: ROLE_COLORS[0], label: deps.baseTitle(comparePath, groupBase) + (!gated ? '' : tableBase ? strings.stageBaseTableNote : strings.stageBaseNoLine),
                    ...(gated && tableBase && tableBands ? { hint: strings.stageBaseTableHint.replace('{m}', String(tableBands.count)).replace('{n}', String(allBase.length)) } : {}),
                    ...(groupInfo ? { trailingHtml: `<button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(strings.stageBaseAggregate)}">▾</button>` } : {}) }] : []),
                ...(comparePath ? [{ color: colorOf(comparePath, ROLE_COLORS[1]), ...named(comparePath, role(comparePath)), active: true, held: held !== null, ...playable(comparePath) }] : []),
                ...plots.others.map(item => ({ color: colorOf(item.track.filePath), ...named(item.track.filePath, role(item.track.filePath)), ...playable(item.track.filePath) })),
            ];
            const legend = query<HTMLElement>('[data-stage-legend]');
            legend.dataset.memos = items.filter(item => item.memo).length.toString();
            const html = legendHtml(items, strings);
            // An open role chip's menu stays open: the legend is drawn again once it closes.
            // Compared with what was written, not with innerHTML (which the browser serializes its own way): a redraw while
            // playing leaves the legend's buttons, and the focus on them, in place.
            if (legendWritten !== html && !legend.querySelector('details.role-chip[open]')) {
                // A focused ▶ or role chip is focused again once drawn anew (its ■ / role changed under the keyboard).
                const focused = legend.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
                const path = focused?.closest<HTMLElement>('[data-path], [data-file-path]');
                const again = path ? (path.dataset.path !== undefined ? `[data-action="compare-play"][data-path="${CSS.escape(path.dataset.path)}"]` : `details.role-chip[data-file-path="${CSS.escape(path.dataset.filePath ?? '')}"] > summary`) : null;
                legend.innerHTML = html;
                legendWritten = html;
                if (again) legend.querySelector<HTMLElement>(again)?.focus();
            }
            const range = stageRange([coarsePlots.base, coarsePlots.compare, ...coarsePlots.others.map(item => item.view)]);
            const axes = stageAxes(strings, picture, tracks[0]?.input);
            const empty = waiting ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
            const overlayPlot = paintOverlay(query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers }, narrowed(range, window_.y), axes, { empty, window: { x: window_.x }, axisView: picture, ...(regionMark ? { region: regionMark } : {}), ...(pending ? { pending } : {}) });
            drawnOn.set(query('[data-stage-canvas="overlay"]'), { picture, range, axes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff }, plot: overlayPlot });
            const diffBox = query<HTMLElement>('[data-stage-diff]');
            diffBox.hidden = !showDiff || !!referencePath || !comparePath;
            if (showDiff && !referencePath && comparePath) {
                query<HTMLElement>('[data-stage-diff-headline]').textContent = waiting ? '' : stageHeadline(plots.diff, strings);
                const diffAxes = stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true);
                const diffPlot = paintStage(query<HTMLCanvasElement>('[data-stage-canvas="diff"]'), plots.diff, stageDiffRange(coarsePlots.diff), DIFF_COLOR, stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true),
                    { diff: true, empty: waiting ? '' : strings.stageNoDelta, window: { x: window_.x }, axisView: coarsePlots.diff, ...(pending ? { pending } : {}) });
                drawnOn.set(query('[data-stage-canvas="diff"]'), { picture: coarsePlots.diff, range: stageDiffRange(coarsePlots.diff), axes: diffAxes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff }, plot: diffPlot });
            }
        },
        handle: message => source.handle(message),
        snapshot() {
            const view = shownCompare.view;
            return {
                open: on,
                comparing: shownCompare.path,
                base: deps.slots()[0] ?? null,
                headline: query<HTMLElement>('[data-stage-headline]').textContent ?? '',
                stage: on ? chosen() : null,
                frame: view?.frame ?? null,
                kind: view ? (view.waveform ? 'line' : view.kind) : null,
                ...pictureSummary(view),
                invalidSteps: stepBar.element.querySelectorAll('.step-chip.is-invalid').length,
            };
        },
        attach(surface) {
            // The pointer's marks (plotHover.ts: the nearest line thicker, the cursor at its point), its readout, the
            // box being dragged and an axis's range, for any plot of the mode. The marks are drawn on a canvas laid
            // over the plot, so a hover does not draw the plot again.
            const cursor = document.createElement('canvas');
            cursor.className = 'track-stage-cursor';
            const readout = document.createElement('div');
            readout.className = 'compare-readout track-stage-readout';
            const box = document.createElement('div');
            box.className = 'compare-zoom-box track-stage-box';
            for (const element of [cursor, readout, box]) { element.hidden = true; document.body.append(element); }
            const rangePopover = installRangePopover(document, { rootId: 'track-stage-range-popover', badgeId: 'track-stage-range-axis-badge', idPrefix: 'track-stage-range', strings: rangePopoverStrings(strings), position: positionPopover });
            /** The plot's rectangle on screen (inside its canvas's axis margins). */
            const plotBox = (plot: HTMLElement): { left: number; top: number; width: number; height: number } => {
                const rect = plot.getBoundingClientRect();
                return { left: rect.left + STAGE_MARGINS.left, top: rect.top + STAGE_MARGINS.top, width: Math.max(1, rect.width - STAGE_MARGINS.left - STAGE_MARGINS.right), height: Math.max(1, rect.height - STAGE_MARGINS.top - STAGE_MARGINS.bottom) };
            };
            const across = (fx: number): number => window_.x.start + fx * (window_.x.end - window_.x.start);
            const hideHover = (): void => { cursor.hidden = true; readout.hidden = true; };
            /**
             * The hover as the spectrum overlay under the tracks draws it: the line nearest the pointer thicker, a dashed
             * cursor at its point and a dashed level line in its colour, its name, where and its value in the readout.
             * An image has no lines: the cursor alone. A signal drawn as itself keeps its levels' readout (base, compare, Δ).
             */
            const showHover = (): void => {
                const drawn = hovered ? drawnOn.get(hovered.plot) : undefined;
                if (!hovered || !drawn || !hovered.plot.isConnected || hovered.plot.closest('[hidden]')) { hideHover(); return; }
                const rect = hovered.plot.getBoundingClientRect();
                const ratio = document.defaultView?.devicePixelRatio || 1;
                Object.assign(cursor.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
                cursor.width = Math.round(rect.width * ratio);
                cursor.height = Math.round(rect.height * ratio);
                const context = cursor.getContext('2d');
                if (!context) return;
                context.setTransform(ratio, 0, 0, ratio, 0, 0);
                context.clearRect(0, 0, rect.width, rect.height);
                const x = hovered.clientX - rect.left, y = hovered.clientY - rect.top;
                const plot = drawn.plot;
                const hit = plot ? stageHover(plot, x, y) : null;
                const frame = plot?.frame ?? { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: plotBox(hovered.plot).width, height: plotBox(hovered.plot).height };
                paintHoverMarks(context, frame, hit ? hit.x : x, hit ? hit.y : null, hit?.layer.color ?? '', hit && plot ? (ctx, width) => strokeStageLine(ctx as CanvasRenderingContext2D, plot, hit.layer, width) : undefined);
                cursor.hidden = false;
                const text = hit ? hit.text : drawn.picture?.waveform ? stageReadout(drawn.views, across(hovered.fx)) : '';
                readout.textContent = text;
                readout.style.color = hit?.layer.color ?? '';
                readout.hidden = !text;
                // Beside the pointer, on its left where the right of the plot has no room for it.
                // Kept in the window: a plot scrolled partly out of view still shows it.
                const right = hovered.clientX + 12 + readout.offsetWidth > rect.right;
                Object.assign(readout.style, { left: `${Math.max(0, right ? hovered.clientX - 12 - readout.offsetWidth : hovered.clientX + 12)}px`, top: `${Math.max(4, rect.top + frame.top + 4)}px` });
            };
            redrawHover = showHover;
            // The marks sit where the plot was on screen: a scroll under a still pointer takes them away.
            document.addEventListener('scroll', () => { if (hovered) { hovered = null; hideHover(); } }, true);
            const gestures = (selector: string, container: HTMLElement): void => attachPlotInteraction(container, document, selector, {
                locate(target, clientX, clientY): PlotHit | null {
                    const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>(selector);
                    if (!on || !plot || !painted || plot.closest('[hidden]')) return null;
                    const { fx, fy, axis } = stagePlotPoint(plot, clientX, clientY);
                    return { plot, point: { fx, fy }, axis };
                },
                pointOn(plot, clientX, clientY) { const { fx, fy } = stagePlotPoint(plot, clientX, clientY); return { fx, fy }; },
                window: () => window_,
                setWindow(_plot, next) { window_ = next ?? FULL_PLOT_WINDOW; detail.moved(); deps.rerender(); },
                hover(event, hit) {
                    // The lanes' surface holds the overlaid plot too: a miss there is the other plot's to answer.
                    if (!hit && (event.target as Element | null)?.closest?.('.track-canvas, [data-stage-canvas]')) return;
                    const drawn = hit ? drawnOn.get(hit.plot) : undefined;
                    if (!hit || hit.axis || !drawn) { hovered = null; hideHover(); if (hit) deps.hint(strings.compareHintAxis); return; }
                    deps.hint(strings.compareHintPlot);
                    hovered = { plot: hit.plot, clientX: event.clientX, clientY: event.clientY, fx: hit.point.fx };
                    showHover();
                },
                clearHover() { hovered = null; hideHover(); },
                showBox(plot, from, to) {
                    const rect = plotBox(plot);
                    const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
                    Object.assign(box.style, { left: `${rect.left + x0 * rect.width}px`, top: `${rect.top + (1 - y1) * rect.height}px`, width: `${(x1 - x0) * rect.width}px`, height: `${(y1 - y0) * rect.height}px` });
                    box.hidden = false;
                },
                hideBox() { box.hidden = true; },
                openAxisRange(hit, clientX, clientY) {
                    const drawn = drawnOn.get(hit.plot);
                    if (!drawn?.picture) return false;
                    const picture = drawn.picture;
                    const heat = picture.kind === 'heatmap';
                    // An axis's values for a part of it (0–1), and the part for typed values: the picture's own axes.
                    const mapping: AxisMapping = hit.axis === 'x'
                        ? { at: f => axisValueAt(picture, f), of: v => axisFractionOf(picture, v), label: drawn.axes.x }
                        : heat ? { at: f => rowValueAt(picture, f), of: v => rowFractionOf(picture, v), label: drawn.axes.y }
                            : linearAxis(drawn.range.min, drawn.range.max, drawn.axes.y);
                    openAxisPart(rangePopover, {
                        mapping, horizontal: hit.axis === 'x', current: hit.axis === 'x' ? window_.x : window_.y, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                        set(part) { window_ = hit.axis === 'x' ? { ...window_, x: part } : { ...window_, y: part }; detail.moved(); deps.rerender(); },
                    });
                    return true;
                },
            });
            gestures('.track-canvas', surface);
            gestures('[data-stage-canvas]', root);
        },
    };
}
