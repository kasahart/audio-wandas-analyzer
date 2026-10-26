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
import { recipeKey, recipeSteps, withoutSteps, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { createStepBar, endsInSpectrum, runnableRecipe, stepLimits, OCTAVE_BRANCH } from './stepBar';
import { createStageSource, type StageSpec } from './stageSource';
import { createDetailPlanner } from './stageDetail';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, DIFF_COLOR, medianView, paintOverlay, paintStage, rowFractionOf, rowValueAt, STAGE_MARGINS, stageAxes, stageDiffRange, stageDifference, stageHeadline, stageLevelsHeadline, stagePlotPoint, stageRange, stageReadout, type StageAxes, type StageLayer, ROLE_COLORS } from './stagePanes';
import { zoomNormalizedRange, ZOOM_IN_FACTOR } from './waveformInteraction';
import { installRangePopover } from '../rangePopover';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { positionPopover } from './settingsPopover';
import { legendHtml, type LegendItem, type PaneRange } from './comparePanes';
import { fileName, regionLabel } from './entryTable';

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
    recipe(): { recipe: RecipeDocument; runRecipe?: RecipeDocument } | null;
    recipeChanged(recipe: RecipeDocument): void;
    /** The tracks on screen, in display order. */
    tracks(): StageTrack[];
    /** The entry table's slots 0–3, the base of a compared file and its name. */
    slots(): (string | null)[];
    basePaths(comparePath: string, group?: boolean): string[];
    baseTitle(comparePath: string, group?: boolean): string;
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
    /** 報告に: the comparison written as a report folder (over the region, from `measured`). */
    report(showDiff: boolean, region: EntryRegion | null, measured: ReadonlyMap<string, ScanResult>): void;
    sampleRate(): number | undefined;
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
    /** The part of the files compared (s; null: the whole file), and the step held to see the chain without it. */
    let region: EntryRegion | null = null;
    let heldStep: RecipeStep | null = null;
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
    });
    stepBar.element.classList.add('track-stage-bar');
    const root = document.createElement('div');
    root.className = 'track-stage';
    root.hidden = true;
    root.innerHTML = `<div class="track-stage-controls">`
        + `<button type="button" class="tb-btn" data-action="stage-layout" aria-pressed="true">${escapeHtml(strings.stageLayoutSide)}</button>`
        + `<button type="button" class="tb-btn" data-action="stage-diff" aria-pressed="false">${escapeHtml(strings.compareDiffShow)}</button>`
        + `<button type="button" class="tb-btn" data-action="stage-report">${escapeHtml(strings.compareReport)}</button>`
        + `<span class="track-stage-region">${escapeHtml(strings.stepRegion)} <input type="number" step="0.01" min="0" data-stage-region="start" aria-label="start s"> – <input type="number" step="0.01" min="0" data-stage-region="end" aria-label="end s"> s</span>`
        + `<span class="compare-value track-stage-headline" data-stage-headline></span></div>`
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
    root.addEventListener('click', event => {
        const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
        if (action === 'stage-layout') { overlaid = !overlaid; deps.rerender(); }
        else if (action === 'stage-diff') { showDiff = !showDiff; deps.rerender(); }
        else if (action === 'stage-report') deps.report(showDiff, region, measured());
        // The base group's ▾ says how its curve is made; "list" shows its files on the table.
        else if (action === 'stage-base-info') { const info = query<HTMLElement>('[data-stage-base-info]'); info.hidden = !info.hidden; }
        else if (action === 'stage-base-list') { query<HTMLElement>('[data-stage-base-info]').hidden = true; deps.showCompared(); }

    });
    // The region: typed and applied with Enter (or on leaving the field); both emptied is the whole file again.
    const regionInputs = (): HTMLInputElement[] => Array.from(root.querySelectorAll<HTMLInputElement>('[data-stage-region]'));
    function readRegion(): void {
        const [start, end] = regionInputs().map(input => input.value.trim() === '' ? NaN : Math.round(Number(input.value) * 100) / 100);
        const next = Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0 ? { start, end } : null;
        if (regionInputs().every(input => input.value.trim() === '') || next) {
            if (regionLabel(next) !== regionLabel(region)) { region = next; window_ = FULL_PLOT_WINDOW; deps.rerender(); }
        } else {
            regionInputs().forEach(input => input.classList.add('is-invalid'));
            deps.hint(strings.compareRegionInvalid.replace('{end}', '—'));
        }
    }
    root.addEventListener('keydown', event => {
        if ((event.target as HTMLElement).matches('[data-stage-region]') && event.key === 'Enter') { event.preventDefault(); readRegion(); }
    });
    root.addEventListener('change', event => { if ((event.target as HTMLElement).matches('[data-stage-region]')) readRegion(); });
    /** The files' scans over the region (their metrics), for D and the report; asked for while a region is set. */
    function regionSpec(): StageSpec {
        const run = deps.recipe()?.runRecipe;
        return { key: `region|${recipeKey(run)}|${regionLabel(region)}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}) } };
    }
    function measured(): ReadonlyMap<string, ScanResult> {
        if (!region) return new Map();
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
            const refused = !path ? strings.compareRefuseSlot.replace('{n}', String(compared))
                : region && !measured().has(path) ? strings.compareRefuseFix.replace('{why}', strings.comparePending)
                    : deps.fix(path, groupBase, region, measured());
            deps.hint(refused ?? strings.compareFixedHint);
        } else if (event.key === 'Escape') {
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
        const limits = stepLimits({ sampleRate: deps.sampleRate() });
        const steps = recipeSteps(recipe, limits).filter(step => step.invalid === undefined);
        // The app's 1/3-octave branch stands beside a chain that ends in a spectrum: its bands are a step to show too.
        // A comparison opens on it, as the table's band column reads it, so the headline and the table agree.
        if ((stage ?? OCTAVE_BRANCH) === OCTAVE_BRANCH && endsInSpectrum(recipe, limits)) return OCTAVE_BRANCH;
        return stage && steps.some(step => step.id === stage) ? stage : steps.at(-1)?.id ?? null;
    }
    function spec(id: string): StageSpec {
        const run = deps.recipe()?.runRecipe;
        return { key: `stage|${recipeKey(run)}|${regionLabel(region)}|${id}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), stage: id } };
    }
    /** What holding `step` draws: the chain without it (and the steps that then cannot run), on the step on screen. */
    function holdSpec(step: RecipeStep): StageSpec | undefined {
        const recipe = deps.recipe();
        const id = chosen();
        if (!recipe || !id || step.id === OCTAVE_BRANCH || step.operation === TIME_SLICE) return undefined;
        const limits = stepLimits({ sampleRate: deps.sampleRate() });
        const steps = recipeSteps(recipe.recipe, limits).filter(item => item.invalid === undefined);
        const at = steps.findIndex(item => item.id === id);
        const shownOf = step.id === id ? steps[at - 1]?.id : id;
        if (!shownOf) return undefined;
        const without = runnableRecipe(withoutSteps(recipe.runRecipe ?? recipe.recipe, [step.id]), limits);
        // The 1/3-octave branch is not a node: it is there while the chain without the step still ends in a spectrum.
        const present = shownOf === OCTAVE_BRANCH ? endsInSpectrum(without, limits) : (without as unknown as { nodes: Array<{ id: string }> }).nodes.some(node => node.id === shownOf);
        if (!present) return undefined;
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
    function plotsOf(views: (path: string) => StageView | null | undefined, tracks: StageTrack[], comparePath: string | null, basePaths: readonly string[]) {
        const baseViews = basePaths.map(views).filter((view): view is StageView => !!view);
        const base = baseViews.length && baseViews.length === basePaths.length ? medianView(baseViews) : null;
        const compare = comparePath ? views(comparePath) ?? null : null;
        const others = tracks.filter(track => track.filePath !== comparePath && !basePaths.includes(track.filePath)).map(track => ({ track, view: views(track.filePath) ?? null }));
        return { base, compare, others, diff: comparePath && !basePaths.includes(comparePath) ? stageDifference(base, compare) : null };
    }
    return {
        root,
        bar: stepBar.element,
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
            stepBar.set({ recipe: recipe?.recipe ?? null, sampleRate: deps.sampleRate(), stage: id ?? undefined });
            const tracks = deps.tracks();
            painted = false;
            stepBar.element.dataset.drawn = '0';
            if (!recipe || !id) {
                deps.showLanes(true);
                panel.hidden = true;
                for (const track of tracks) if (track.canvas) paintStage(track.canvas, null, { min: 0, max: 1 }, track.color, { x: '', y: '' }, { empty: strings.stepOpenCompare });
                return;
            }
            // The compared file (the slot tapped or held); its base: slot 0, or the others of its condition (0 switches).
            const comparePath = comparedPath(tracks);
            const basePaths = comparePath ? deps.basePaths(comparePath, groupBase) : [];
            const files = [...new Set([...tracks.map(track => track.filePath), ...basePaths])];
            // A step held: the picture without it, as scanned for that (the lanes and the plot framed green meanwhile).
            const held_ = heldStep ? holdSpec(heldStep) : undefined;
            const coarseSpec = held_ ?? spec(id);
            root.classList.toggle('is-step-held', !!held_);
            root.dataset.held = held_ ? heldStep!.id : '';
            const waiting = source.ensure(coarseSpec, files);
            // Over a region, the files' metrics over it too, for D and the report.
            if (region && !waiting) source.ensure(regionSpec(), files);
            const [startInput, endInput] = regionInputs();
            if (deps.document.activeElement !== startInput && deps.document.activeElement !== endInput) {
                startInput.value = region ? region.start.toFixed(2) : '';
                endInput.value = region ? region.end.toFixed(2) : '';
                regionInputs().forEach(input => input.classList.remove('is-invalid'));
            }
            root.dataset.region = regionLabel(region);
            const coarse = (path: string) => source.view(coarseSpec, path);
            const picture = tracks.map(track => coarse(track.filePath)).find((view): view is StageView => !!view) ?? null;
            const images = !picture || picture.kind === 'heatmap' || picture.kind === 'none';
            const overlay = overlaid && !images;
            deps.showLanes(!overlay);
            panel.hidden = !overlay;
            const layout = query<HTMLButtonElement>('[data-action="stage-layout"]');
            layout.textContent = overlaid ? strings.stageLayoutSide : strings.stageLayoutOverlay;
            layout.setAttribute('aria-pressed', String(overlaid));
            layout.disabled = images;
            const diffButton = query<HTMLButtonElement>('[data-action="stage-diff"]');
            diffButton.textContent = showDiff ? strings.compareDiffHide : strings.compareDiffShow;
            diffButton.setAttribute('aria-pressed', String(showDiff));
            diffButton.hidden = !overlay;
            // Zoomed, the plots draw from the Frames' full resolution once it is in, the coarse pictures until then.
            const width = (overlay ? query<HTMLCanvasElement>('[data-stage-canvas="overlay"]') : tracks.find(track => track.canvas)?.canvas)?.clientWidth || 600;
            const fineSpec = !waiting && !held_ && picture && picture.kind !== 'bar' && picture.kind !== 'none' ? detail.spec(coarseSpec, picture, window_.x, window_.y, width) : null;
            const fine = fineSpec && !source.ensure(fineSpec, files) ? (path: string) => source.view(fineSpec, path) : null;
            const shown = (path: string) => (fine ? fine(path) : undefined) ?? coarse(path);
            stepBar.element.dataset.stage = id;
            stepBar.element.dataset.detail = String(!!fine);
            root.dataset.layout = overlay ? 'overlay' : 'lanes';
            // The zoom, for tests: "start–end" of the horizontal axis.
            root.dataset.xWindow = `${window_.x.start.toFixed(3)}-${window_.x.end.toFixed(3)}`;
            painted = true;
            const coarsePlots = plotsOf(coarse, tracks, comparePath, basePaths);
            shownCompare = { path: comparePath, view: comparePath && !waiting ? coarse(comparePath) : undefined };
            const headline = query<HTMLElement>('[data-stage-headline]');
            headline.textContent = waiting ? strings.comparePending : comparePath ? stageLevelsHeadline(coarsePlots.base, coarsePlots.compare, coarsePlots.diff, strings) : '';
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
                        { empty, window: { x: window_.x, ...(heat ? { y: window_.y } : {}) }, axisView: coarse(track.filePath) ?? picture });
                    if (view) drawn++;
                });
                stepBar.element.dataset.drawn = String(drawn);
                return;
            }
            // Overlaid: the base, the other tracks and the compared one on one plot, as the comparison draws them.
            const plots = plotsOf(shown, tracks, comparePath, basePaths);
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
                ...(comparePath ? [{ color: colorOf(comparePath, ROLE_COLORS[1]), label: `${role(comparePath)} · ${fileName(comparePath)}`, active: true, held: held !== null }] : []),
                ...plots.others.map(item => ({ color: colorOf(item.track.filePath, item.track.color), label: `${role(item.track.filePath) ?? '·'} · ${fileName(item.track.filePath)}` })),
            ];
            const legend = query<HTMLElement>('[data-stage-legend]');
            // A base group (not a slot-0 file) has a ▾ that says how its curve is made.
            const groupInfo = comparePath && (groupBase || !deps.slots()[0]);
            const html = legendHtml(items, strings).replace('</span></span>', groupInfo ? `</span><button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(strings.stageBaseAggregate)}">▾</button></span>` : '</span></span>');
            if (legend.innerHTML !== html) legend.innerHTML = html;
            const range = stageRange([coarsePlots.base, coarsePlots.compare, ...coarsePlots.others.map(item => item.view)]);
            const axes = stageAxes(strings, picture, tracks[0]?.input);
            const empty = waiting ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
            drawnOn.set(query('[data-stage-canvas="overlay"]'), { picture, range, axes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff } });
            paintOverlay(query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers }, narrowed(range, window_.y), axes, { empty, window: { x: window_.x }, axisView: picture });
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
            const shownNumber = (value: number): string => String(Math.round(value * 1000) / 1000);
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
                    const mapping = hit.axis === 'x'
                        ? { at: (f: number) => axisValueAt(picture, f), of: (v: number) => (axisFractionOf(picture, v)), label: drawn.axes.x }
                        : heat ? { at: (f: number) => rowValueAt(picture, f), of: (v: number) => rowFractionOf(picture, v), label: drawn.axes.y }
                            : { at: (f: number) => drawn.range.min + f * (drawn.range.max - drawn.range.min), of: (v: number) => (v - drawn.range.min) / (drawn.range.max - drawn.range.min || 1), label: drawn.axes.y };
                    const current = hit.axis === 'x' ? window_.x : window_.y;
                    const set = (part: { start: number; end: number }): void => {
                        window_ = hit.axis === 'x' ? { ...window_, x: part } : { ...window_, y: part };
                        detail.moved();
                        deps.rerender();
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
            gestures('.track-canvas', surface);
            gestures('[data-stage-canvas]', root);
        },
    };
}
