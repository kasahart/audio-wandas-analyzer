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
import { brokenStep, chainEnd, recipeKey, recipeSteps, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { createStepBar, endsInSpectrum, invalidReason, recipeWithout, stepChipLabel, stepLimits, INPUT_STAGE, OCTAVE_BRANCH } from './stepBar';
import { createStageSource, type StageSpec } from './stageSource';
import { createDetailPlanner } from './stageDetail';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, medianView, paintOverlay, paintStage, rowFractionOf, rowValueAt, STAGE_MARGINS, stageAxes, stageDiffRange, stageDifference, stageHeadline, stageLevelsHeadline, stagePlotPoint, stageRange, stageReadout, type StageAxes, type StageLayer } from './stagePanes';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { zoomNormalizedRange, ZOOM_IN_FACTOR } from './waveformInteraction';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { positionPopover } from './settingsPopover';
import { legendHtml, type LegendItem, type PaneRange } from './comparePanes';
import { regionLabel } from './entryTable';
import { baseName } from '../../shared/analysis/entryMetadata';
import { withChannel } from '../../shared/recipe/channelSelection';

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
    /** Lists the compared files and their base on the entry table (its "Compared" filter). */
    showCompared(): void;
    /** Whether the track view is the screen in front (the entry table not over it). */
    inFront(): boolean;
    /** Esc: back to the entry table. */
    back(): void;
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
        + `<span class="track-stage-gate" data-stage-base-gate hidden><span data-stage-base-gate-why></span> <button type="button" class="tb-btn" data-action="stage-base-scan"></button></span></div>`
        + `<div class="track-stage-panel" data-stage-panel>`
        + `<div class="compare-pane-head compare-legend" data-stage-legend></div>`
        + `<div class="track-stage-base-info" data-stage-base-info hidden><div>${escapeHtml(strings.stageBaseAggregate)}</div>`
        + `<button type="button" class="tb-link" data-action="stage-base-list">${escapeHtml(strings.stageBaseList)}</button></div>`
        + `<canvas data-stage-canvas="overlay"></canvas>`
        + `<div class="track-stage-diff" data-stage-diff hidden><span class="compare-value" data-stage-diff-headline></span><canvas data-stage-canvas="diff"></canvas></div>`
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
        // A large base group is scanned only when asked (a folder of 10,000 files is not analysed by opening a comparison).
        else if (action === 'stage-base-scan') { if (gateKey) baseAllowed.add(gateKey); deps.rerender(); }
        // The base group's ▾ says how its curve is made; "list" shows its files on the table.
        else if (action === 'stage-base-info') { const info = query<HTMLElement>('[data-stage-base-info]'); info.hidden = !info.hidden; }
        else if (action === 'stage-base-list') { query<HTMLElement>('[data-stage-base-info]').hidden = true; deps.showCompared(); }

    });
    /** The files' scans over the region (their metrics), for D and the report; asked for while a region is set. */
    function regionSpec(): StageSpec {
        const region = liveRegion();
        const run = deps.recipe()?.runRecipe;
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
    // The comparison's keys, as on the entry table and the old comparison screen: 1–3 tap = compare that slot, hold = compare
    // it until released; 0 switches the base between the slot-0 file and the group median; D fixes the
    // difference as a row of the entry table; Esc goes back to the entry table.
    let pressing: { slot: number; at: number; timer: number } | null = null;
    const keysLive = (event: KeyboardEvent): boolean => on && deps.inFront() && !(event.target as Element | null)?.closest?.('input, select, textarea, [data-step-bar], #track-stage-range-popover');
    deps.window.addEventListener?.('keydown', ((event: KeyboardEvent) => {
        if (!keysLive(event) || event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^[1-3]$/.test(event.key)) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.repeat || pressing) return;
            const slot = Number(event.key);
            pressing = { slot, at: deps.window.performance.now(), timer: deps.window.setTimeout(() => { held = slot; deps.rerender(); }, TAP_MS) };
        } else if (event.key === '+' || event.key === '=' || event.key === '-') {
            // + / − zoom the horizontal axis about its middle, as on the lanes (a double-click resets).
            event.preventDefault(); event.stopImmediatePropagation();
            window_ = { ...window_, x: zoomNormalizedRange(window_.x, event.key === '-' ? 1 / ZOOM_IN_FACTOR : ZOOM_IN_FACTOR) };
            detail.moved();
            deps.rerender();
        } else if (event.key === '0') {
            event.preventDefault(); event.stopImmediatePropagation();
            groupBase = !groupBase;
            deps.rerender();
        } else if (event.key === 'd' || event.key === 'D') {
            event.preventDefault(); event.stopImmediatePropagation();
            const path = comparedPath(deps.tracks());
            const region = liveRegion();
            const recipe = deps.recipe()?.recipe;
            const refused = recipe && brokenStep(recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() })) ? strings.stepOctaveBroken
                : !path ? strings.compareRefuseSlot.replace('{n}', String(compared))
                : region && !measured().has(path) ? strings.compareRefuseFix.replace('{why}', strings.comparePending)
                    : deps.fix(path, groupBase, region, measured());
            deps.hint(refused ?? strings.compareFixedHint);
        } else if (event.key === 'Escape') {
            // An open toolbar menu takes Esc first: it closes, and the comparison stays.
            if (root.ownerDocument?.querySelector?.('details.tb-menu[open]')) return;
            event.preventDefault(); event.stopImmediatePropagation();
            deps.back();
        }
    }) as EventListener, true);
    deps.window.addEventListener?.('keyup', ((event: KeyboardEvent) => {
        if (!pressing || event.key !== String(pressing.slot)) return;
        event.stopImmediatePropagation();
        deps.window.clearTimeout?.(pressing.timer);
        if (held !== null) held = null;
        else compared = pressing.slot;
        pressing = null;
        deps.rerender();
    }) as EventListener, true);
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
        return own ? withChannel(own, ch) : undefined;
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
        const unselected = recipeWithout(recipe.runRecipe ?? recipe.recipe, step.id, shownOf, limits);
        if (!unselected) return undefined;
        const without = channelRecipe(unselected, ch)!;
        const region = liveRegion();
        return { key: `hold|${recipeKey(without)}|${regionLabel(region)}|${shownOf}`, message: { recipe: without, ...(region ? { region } : {}), stage: shownOf } };
    }
    /** What the plots last drew, for placing the pointer on them, and the compared file's picture for tests. */
    let painted = false;
    /**
     * What each plot last drew, for the pointer's readout and an axis's range: the whole picture whose axes it
     * uses, its level range before the vertical zoom, its axes' names, and the pictures read under the pointer.
     */
    type Drawn = { picture: StageView | null; range: PaneRange; axes: StageAxes; views: { base: StageView | null; compare: StageView | null; diff: StageView | null } };
    const drawnOn = new Map<Element, Drawn>();
    let shownCompare: { path: string | null; view: StageView | null | undefined } = { path: null, view: undefined };
    /** A file in the legend: its role, name and channel, its value on show, ✎ with its memo. */
    function named(path: string, slot: number | undefined): Pick<LegendItem, 'label' | 'value' | 'memo'> {
        const info = deps.rowInfo?.(path) ?? { label: baseName(path), value: '', memo: '' };
        return { label: `${slot ?? '·'} · ${info.label}`, ...(info.value ? { value: info.value } : {}), ...(info.memo ? { memo: info.memo } : {}) };
    }
    function plotsOf(views: (path: string) => StageView | null | undefined, tracks: StageTrack[], comparePath: string | null, basePaths: readonly string[], fallback: StageView | null = null) {
        const baseViews = basePaths.map(views).filter((view): view is StageView => !!view);
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
        open(next) {
            stage = next ?? null;
            compared = 1;
            held = null;
            groupBase = false;
            heldStep = null;
            window_ = FULL_PLOT_WINDOW;
            overlaid = true;
            this.setActive(true);
        },
        setActive(next) {
            on = next;
            root.hidden = !on;
            if (!on) deps.showLanes(true);
            deps.rerender();
        },
        paint() {
            if (!on) return;
            const recipe = deps.recipe();
            const id = chosen();
            const shownStage = stage && recipe && recipeSteps(recipe.recipe).find(step => step.id === stage)?.bypassed ? stage : id;
            stepBar.set({ recipe: recipe?.recipe ?? null, sampleRate: deps.sampleRate(), channels: deps.channels?.(), stage: shownStage ?? undefined, regionRange: regionSet, failed: recipe?.failed });
            const tracks = deps.tracks();
            painted = false;
            stepBar.element.dataset.drawn = '0';
            if (!recipe || !id) {
                deps.showLanes(true);
                panel.hidden = true;
                for (const track of tracks) if (track.canvas) paintStage(track.canvas, null, { min: 0, max: 1 }, track.color, { x: '', y: '' }, { empty: strings.stepOpenCompare });
                return;
            }
            const steps = recipeSteps(recipe.recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() }));
            // A step that cannot run has no picture: the plot says why, and how to fix it.
            const broken = brokenStep(recipe.recipe, stepLimits({ sampleRate: deps.sampleRate(), channels: deps.channels?.() }));
            const cannot = steps.find(step => step.id === id && step.invalid !== undefined) ?? (id === OCTAVE_BRANCH && broken ? { ...broken, id: OCTAVE_BRANCH } : undefined);
            if (cannot) {
                deps.showLanes(false);
                panel.hidden = false;
                query<HTMLElement>('[data-stage-headline]').textContent = '';
                query<HTMLElement>('[data-stage-diff]').hidden = true;
                stepBar.element.dataset.drawn = '0';
                stepBar.element.dataset.stage = id;
                painted = false;
                paintOverlay(query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers: [] }, { min: 0, max: 1 }, { x: '', y: '' },
                    { empty: `${strings.stepCannotShow.replace('{why}', invalidReason(cannot, strings, steps))} — ${strings.stepCannotShowFix}` });
                return;
            }
            // The compared file (the slot tapped or held); its base: slot 0, or the others of its condition (0 switches).
            const comparePath = comparedPath(tracks);
            const allBase = comparePath ? deps.basePaths(comparePath, groupBase) : [];
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
            const specOf = (ch: number | null): StageSpec => (held_ ? holdSpec(heldStep!, ch) : undefined) ?? spec(id, ch);
            const byChannel = new Map<number | null, string[]>();
            for (const path of files) byChannel.set(channelFor(path), [...(byChannel.get(channelFor(path)) ?? []), path]);
            root.classList.toggle('is-step-held', !!held_);
            root.dataset.held = held_ ? heldStep!.id : '';
            root.dataset.channels = files.map(path => `${baseName(path)}:${channelFor(path) ?? '*'}`).join(',');
            let waiting = false;
            for (const [ch, paths] of byChannel) waiting = source.ensure(specOf(ch), paths) || waiting;
            // Over a region, the files' metrics over it too, for D and the report.
            const region = liveRegion();
            if (region && !waiting && !broken) source.ensure(regionSpec(), files);
            root.dataset.region = regionLabel(region);
            // The region on the plots: its part of a whole-file picture (a step before the region's), else a corner tag.
            const sliceAt = steps.findIndex(step => step.operation === TIME_SLICE);
            const shownAt = id === INPUT_STAGE ? -1 : id === OCTAVE_BRANCH ? steps.length : steps.findIndex(step => step.id === id);
            const regionMark = region ? { start: region.start, end: region.end, mark: shownAt < sliceAt ? 'range' as const : 'tag' as const, label: `${strings.stepRegion} ${region.start.toFixed(2)}–${region.end.toFixed(2)} s` } : undefined;
            root.dataset.regionMark = regionMark?.mark ?? '';
            const coarse = (path: string) => source.view(specOf(channelFor(path)), path);
            const picture = tracks.map(track => coarse(track.filePath)).find((view): view is StageView => !!view) ?? null;
            const images = !picture || picture.kind === 'heatmap' || picture.kind === 'none';
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
            diffButton.hidden = !overlay;
            // Zoomed, the plots draw from the Frames' full resolution once it is in, the coarse pictures until then.
            const width = (overlay ? query<HTMLCanvasElement>('[data-stage-canvas="overlay"]') : tracks.find(track => track.canvas)?.canvas)?.clientWidth || 600;
            const fineSpecs = new Map<number | null, StageSpec | null>();
            if (!waiting && !held_ && picture && picture.kind !== 'bar' && picture.kind !== 'none') {
                for (const [ch, paths] of byChannel) {
                    const fineSpec = detail.spec(specOf(ch), picture, window_.x, window_.y, width);
                    fineSpecs.set(ch, fineSpec && !source.ensure(fineSpec, paths) ? fineSpec : null);
                }
            }
            const fineReady = fineSpecs.size > 0 && [...fineSpecs.values()].every(item => !!item);
            const fine = fineReady ? (path: string) => source.view(fineSpecs.get(channelFor(path))!, path) : null;
            const shown = (path: string) => (fine ? fine(path) : undefined) ?? coarse(path);
            stepBar.element.dataset.stage = id;
            stepBar.element.dataset.detail = String(!!fine);
            root.dataset.layout = overlay ? 'overlay' : 'lanes';
            // The zoom, for tests: "start–end" of the horizontal axis.
            root.dataset.xWindow = `${window_.x.start.toFixed(3)}-${window_.x.end.toFixed(3)}`;
            painted = true;
            // Gated, the 1/3-octave picture still has a base: the group's levels the table has computed, on the compared file's bands.
            const tableBands = gated && comparePath && id === OCTAVE_BRANCH ? deps.tableBaseBands?.(comparePath, groupBase) ?? null : null;
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
                query<HTMLElement>('[data-stage-base-gate-why]').textContent = tableBase
                    ? strings.stageBaseFromTable.replace('{m}', String(tableBands!.count)).replaceAll('{n}', String(allBase.length))
                    : strings.stageBaseGated.replace('{n}', String(allBase.length));
                query<HTMLElement>('[data-action="stage-base-scan"]').textContent = strings.stageBaseScan.replace('{n}', String(allBase.length)).replace('{time}', time);
            }
            const coarsePlots = plotsOf(coarse, tracks, comparePath, basePaths, tableBase);
            shownCompare = { path: comparePath, view: comparePath && !waiting ? coarse(comparePath) : undefined };
            const headline = query<HTMLElement>('[data-stage-headline]');
            headline.textContent = waiting ? strings.comparePending : comparePath ? stageLevelsHeadline(coarsePlots.base, coarsePlots.compare, coarsePlots.diff, strings) : '';
            // The steps bypassed are named: what is drawn is the chain without them.
            const bypassed = steps.filter(step => step.bypassed).map(step => stepChipLabel(step, strings, regionSet));
            if (bypassed.length && !waiting) headline.textContent += strings.stepBypassing.replace('{ops}', bypassed.join(', '));
            const colorOf = (path: string, fallback: string): string => ROLE_COLORS[role(path) ?? -1] ?? fallback;
            if (!overlay) {
                // Side by side: every track's lane, on one range so the tracks compare at a glance.
                const range = stageRange(tracks.map(track => coarse(track.filePath) ?? null));
                const heat = picture?.kind === 'heatmap';
                let drawn = 0;
                tracks.forEach(track => {
                    track.axis?.getContext('2d')?.clearRect(0, 0, track.axis.width, track.axis.height);
                    if (!track.canvas) return;
                    const view = shown(track.filePath) ?? null;
                    const empty = coarse(track.filePath) === undefined ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
                    const axes = stageAxes(strings, coarse(track.filePath) ?? picture, track.input);
                    drawnOn.set(track.canvas, { picture: coarse(track.filePath) ?? picture, range, axes, views: { base: coarsePlots.base, compare: coarse(track.filePath) ?? null, diff: null } });
                    // A lane holds one picture, drawn as it is (1/3-octave levels as steps, without a fill).
                    paintOverlay(track.canvas, { layers: view ? [{ view, color: colorOf(track.filePath, track.color), width: 2 }] : [] }, heat ? range : narrowed(range, window_.y), axes,
                        { empty, window: { x: window_.x, ...(heat ? { y: window_.y } : {}) }, axisView: coarse(track.filePath) ?? picture, ...(regionMark ? { region: regionMark } : {}) });
                    if (view) drawn++;
                });
                stepBar.element.dataset.drawn = String(drawn);
                return;
            }
            // Overlaid: the base, the other tracks and the compared one on one plot, as the comparison draws them.
            const plots = plotsOf(shown, tracks, comparePath, basePaths, tableBase);
            root.dataset.compared = comparePath ? String(role(comparePath) ?? '') : '';
            root.dataset.base = groupBase || !deps.slots()[0] ? 'group' : 'file';
            const layers: StageLayer[] = [
                ...(plots.base ? [{ view: plots.base, color: ROLE_COLORS[0], width: 2 }] : []),
                ...plots.others.flatMap(item => (item.view ? [{ view: item.view, color: colorOf(item.track.filePath, item.track.color), width: 1.8 }] : [])),
                ...(plots.compare && comparePath ? [{ view: plots.compare, color: colorOf(comparePath, ROLE_COLORS[1]), width: 2.2 }] : []),
            ];
            stepBar.element.dataset.drawn = String(layers.length);
            const items: LegendItem[] = [
                ...(comparePath ? [{ color: ROLE_COLORS[0], label: deps.baseTitle(comparePath, groupBase) }] : []),
                ...(comparePath ? [{ color: colorOf(comparePath, ROLE_COLORS[1]), ...named(comparePath, role(comparePath)), active: true, held: held !== null }] : []),
                ...plots.others.map(item => ({ color: colorOf(item.track.filePath, item.track.color), ...named(item.track.filePath, role(item.track.filePath)) })),
            ];
            const legend = query<HTMLElement>('[data-stage-legend]');
            legend.dataset.memos = items.filter(item => item.memo).length.toString();
            // A base group (not a slot-0 file) has a ▾ that says how its curve is made.
            const groupInfo = comparePath && (groupBase || !deps.slots()[0]);
            const html = legendHtml(items, strings).replace('</span></span>', groupInfo ? `</span><button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(strings.stageBaseAggregate)}">▾</button></span>` : '</span></span>');
            if (legend.innerHTML !== html) legend.innerHTML = html;
            const range = stageRange([coarsePlots.base, coarsePlots.compare, ...coarsePlots.others.map(item => item.view)]);
            const axes = stageAxes(strings, picture, tracks[0]?.input);
            const empty = waiting ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
            drawnOn.set(query('[data-stage-canvas="overlay"]'), { picture, range, axes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff } });
            paintOverlay(query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers }, narrowed(range, window_.y), axes, { empty, window: { x: window_.x }, axisView: picture, ...(regionMark ? { region: regionMark } : {}) });
            const diffBox = query<HTMLElement>('[data-stage-diff]');
            diffBox.hidden = !showDiff;
            if (showDiff) {
                query<HTMLElement>('[data-stage-diff-headline]').textContent = waiting ? strings.comparePending : stageHeadline(plots.diff, strings);
                const diffAxes = stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true);
                drawnOn.set(query('[data-stage-canvas="diff"]'), { picture: coarsePlots.diff, range: stageDiffRange(coarsePlots.diff), axes: diffAxes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff } });
                paintStage(query<HTMLCanvasElement>('[data-stage-canvas="diff"]'), plots.diff, stageDiffRange(coarsePlots.diff), DIFF_COLOR, stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true),
                    { diff: true, empty: waiting ? '' : strings.stageNoDelta, window: { x: window_.x }, axisView: coarsePlots.diff });
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
            // The lanes' cursor line and readout, the box being dragged and an axis's range, for any plot of the mode.
            const cursor = document.createElement('div');
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
                    if (!hit || hit.axis || !drawn) { cursor.hidden = true; readout.hidden = true; if (hit) deps.hint(strings.compareHintAxis); return; }
                    deps.hint(strings.compareHintPlot);
                    // The cursor line across the plot, and the pictures' values where it is (the lanes' readout).
                    const rect = plotBox(hit.plot);
                    Object.assign(cursor.style, { left: `${event.clientX}px`, top: `${rect.top}px`, height: `${rect.height}px` });
                    cursor.hidden = false;
                    const text = drawn.picture?.kind === 'heatmap' ? '' : stageReadout(drawn.views, across(hit.point.fx));
                    readout.textContent = text;
                    Object.assign(readout.style, { left: `${event.clientX + 12}px`, top: `${rect.top + 4}px` });
                    readout.hidden = !text;
                },
                clearHover() { cursor.hidden = true; readout.hidden = true; },
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
