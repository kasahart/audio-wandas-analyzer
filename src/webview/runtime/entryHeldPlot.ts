/**
 * The entry table's held plot, beside the distribution: what a held slot key (or slot chip) or a held step chip
 * shows until it is let go. A slot held shows that slot's row's Δ spectrum against its group, from the table's
 * own scan. A step chip held shows what the step does to one row (the focused one, else slot 1): its average
 * spectrum, its 1/3-octave levels, or, for a step of the time signal, the spectrum without it − with it. Those
 * pictures come as the steps view's do (stageSource, the Frame's full resolution once zoomed) and are drawn by
 * its painter. Let go, the picture stays 150 ms, so a quick look does not flicker.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeKey, recipeNodes, recipeSteps, slotReferenced, timeSignalStep, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { baseName } from '../../shared/analysis/entryMetadata';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { buildCompareModel, sideView, type CompareModel, type PaneRange } from './comparePanes';
import type { EntryModel } from './entryTable';
import type { PlotMargins, PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, paintOverlay, stageAxes, stageDiffRange, stageDifference, stageRange, STAGE_MARGINS, type StageAxes } from './stagePanes';
import { createDetailPlanner } from './stageDetail';
import { createStageSource, type StageSpec } from './stageSource';
import { recipeWithout, stepChipLabel, stepLimits, OCTAVE_BRANCH } from './stepBar';

/** A tap on a slot key shorter than this puts the row in; longer is a hold that shows the slot's Δ on the side. */
export const TAP_MS = 250;
/** Releasing a held slot keeps its picture on screen this long, so a quick look does not flicker. */
export const DELTA_RELEASE_MS = 150;

/** What the held plot last drew, to place the pointer on it and to map an axis's values to its window. */
export interface HeldPicture {
    margins: PlotMargins;
    x: (fraction: number) => number;
    ofX: (value: number) => number;
    range: PaneRange;
    xLabel: string;
    yLabel: string;
}

export interface HeldPlotDeps {
    document: Document;
    window: Pick<Window, 'setTimeout' | 'clearTimeout'> & { performance: Pick<Performance, 'now'> };
    strings: UiStrings;
    /** The held plot's box, its title and its canvas. */
    held: HTMLElement;
    title: HTMLElement;
    canvas: HTMLCanvasElement;
    post(message: CompareScanMessage): void;
    /** The side plots drawn again on the next frame. */
    scheduleSide(): void;
    /** The plot's zoom, kept while it shows the same thing (`key`), whole again for another. */
    keepWindow(name: string, key: string): PlotWindow;
    entryModel(): EntryModel;
    results: ReadonlyMap<string, ScanResult>;
    focusedFile(): string | null;
    slotFiles(): (string | null)[];
    /** The table's Recipe (its edited one, else the host's), and the one its scans run (undefined: the host's own). */
    recipe(): RecipeDocument | null;
    runRecipe(): RecipeDocument | undefined;
    limits(): ReturnType<typeof stepLimits>;
    /** Whether the chain ends in a spectrum or band levels. */
    spectral(): boolean;
    /** A slot key began or stopped showing its Δ: the slot chips light it. */
    slotHeld(): void;
    /** A slot key tapped (not held). */
    tapped(slot: number): void;
}

export interface HeldPlot {
    /** A slot key (or chip) pressed: held past TAP_MS, its Δ shows until it is let go. */
    press(slot: number): void;
    /** Let go: a tap is the screen's (`tapped`); a hold's picture goes 150 ms later. */
    release(slot: number): void;
    /** The slot whose Δ is shown. */
    slot(): number | null;
    /** A step chip held (null: let go). */
    holdStep(step: RecipeStep | null): void;
    /** Whether a hold shows something here: a step of the chain's time signal (not the region), its spectrum, and the app's bands. */
    canHold(step: RecipeStep): boolean;
    /** What the plot last drew, for the pointer and an axis's range. */
    picture(): HeldPicture | null;
    /** Draws what is held, or hides the plot when nothing is. */
    paint(): void;
    /** Takes the pictures the host sends for a held step; false for anything else. */
    handle(message: { type: string }): boolean;
}

/** A level range narrowed to a window's vertical part. */
export const narrowed = (range: PaneRange, window: PlotWindow): PaneRange => ({ min: range.min + window.y.start * (range.max - range.min), max: range.min + window.y.end * (range.max - range.min) });

export function createHeldPlot(deps: HeldPlotDeps): HeldPlot {
    const { document, window, strings, held, title, canvas } = deps;
    const hold: {
        /** The slot key or chip being pressed: a tap acts on release, a hold shows the slot's Δ until then. */
        pressing?: { slot: number; at: number; timer: number };
        /** The slot whose Δ is shown, and the timer that takes it away after a release. */
        slot: number | null;
        releaseTimer?: number;
        /** A step chip held (its picture of one row), and the timer that takes it away after a release. */
        step: { step: RecipeStep; path: string } | null;
        stepRelease?: number;
        plot: HeldPicture | null;
    } = { slot: null, step: null, plot: null };
    const source = createStageSource('entry-hold', message => deps.post(message), () => deps.scheduleSide());
    const detail = createDetailPlanner(window.performance, window, () => deps.scheduleSide());

    /** The step `id`'s picture under `recipe` (the whole file, as the table scans it). */
    function holdSpec(recipe: RecipeDocument, id: string): StageSpec {
        return { key: `hold|${recipeKey(recipe)}|${id}`, message: { recipe, stage: id } };
    }
    /** The specs a held step draws from: its own picture (the average spectrum), or the chain's end with and without it. */
    function heldSpecs(step: RecipeStep): { with: StageSpec; without?: StageSpec } | null {
        const recipe = deps.runRecipe() ?? deps.recipe();
        if (!recipe) return null;
        if (step.name === 'welch') return { with: holdSpec(recipe, step.id) };
        const limits = deps.limits();
        const end = recipeSteps(recipe, limits).filter(item => item.invalid === undefined).at(-1)?.id;
        const without = end ? recipeWithout(recipe, step.id, end, limits, slotReferenced(deps.recipe())) : null;
        return end && without ? { with: holdSpec(recipe, end), without: holdSpec(without, end) } : null;
    }
    /** The held plot's picture and what it was drawn on, for its readout and an axis's range. */
    function paintView(view: StageView | null, picture: StageView | null, range: PaneRange, axes: StageAxes, zoom: PlotWindow, options: { diff?: boolean; color: string; empty?: string }): void {
        hold.plot = picture ? { margins: STAGE_MARGINS, x: f => axisValueAt(picture, f), ofX: number => axisFractionOf(picture, number), range, xLabel: axes.x, yLabel: axes.y } : null;
        paintOverlay(canvas, { layers: view ? [{ view, color: options.color, width: 2 }] : [] }, narrowed(range, zoom), axes,
            { diff: options.diff, empty: options.empty ?? '', window: { x: zoom.x }, axisView: picture });
    }
    function paintStep({ step, path }: { step: RecipeStep; path: string }): void {
        held.hidden = false;
        const row = buildCompareModel(deps.entryModel(), deps.results, path, null, strings);
        const input = deps.results.get(path)?.input;
        const name = step.name === 'welch' ? strings.stepAverage : step.id === OCTAVE_BRANCH ? strings.stepOctave : strings.stepHeldWithout.replace('{step}', stepChipLabel(step, strings));
        title.textContent = strings.stepHeldRow.replace('{what}', name).replace('{file}', baseName(path));
        held.classList.remove('is-pending');
        const zoom = deps.keepWindow('held', step.id);
        if (step.id === OCTAVE_BRANCH) {
            // The app's bands, from the table's own scan.
            const bands = sideView(row.compare, row.frequencies, true);
            paintView(bands, bands, stageRange([bands]), stageAxes(strings, bands, input), zoom, { color: ROLE_COLORS[1] });
            return;
        }
        const specs = heldSpecs(step);
        const waiting = !!specs && [specs.with, specs.without].some(spec => spec && source.ensure(spec, [path]));
        const coarse = specs ? source.view(specs.with, path) ?? null : null;
        const coarseWithout = specs?.without ? source.view(specs.without, path) ?? null : null;
        if (!specs || waiting || !coarse || (specs.without && !coarseWithout)) {
            if (waiting) { held.classList.add('is-pending'); title.textContent += ` · ${strings.comparePending}`; }
            paintView(null, null, { min: 0, max: 1 }, stageAxes(strings, null, input), zoom, { color: ROLE_COLORS[1], empty: waiting ? '' : strings.stepNotDrawable.replace('{frame}', coarse?.frame ?? '') });
            return;
        }
        // Zoomed, from the Frame's full resolution once it is in (the coarse picture until then).
        const fine = (spec: StageSpec): StageView | null => {
            if (coarse.kind === 'bar' || coarse.kind === 'none') return null;
            const finer = detail.spec(spec, coarse, zoom.x, zoom.y, canvas.clientWidth || 300);
            return finer && !source.ensure(finer, [path]) ? source.view(finer, path) ?? null : null;
        };
        if (!specs.without) {
            paintView(fine(specs.with) ?? coarse, coarse, stageRange([coarse]), stageAxes(strings, coarse, input), zoom, { color: ROLE_COLORS[1] });
            return;
        }
        // Without the step − with it, point by point: what the step takes away (negative where it cuts).
        const delta = stageDifference(coarse, coarseWithout);
        const fineWith = fine(specs.with), fineWithout = fine(specs.without);
        const shown = fineWith && fineWithout ? stageDifference(fineWith, fineWithout) ?? delta : delta;
        paintView(shown, delta, stageDiffRange(delta), stageAxes(strings, delta, input, true), zoom, { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta });
    }
    /** The held row's Δ spectrum (from the table's own scan), zoomed as its window says. */
    function paintDelta(comparison: CompareModel, key: string, input: { unit?: string; ref?: number } | undefined): void {
        const zoom = deps.keepWindow('held', `delta|${key}`);
        const delta = comparison.diffDb ? sideView({ spectrumDb: comparison.diffDb, bands: [] }, comparison.frequencies) : null;
        paintView(delta, delta, stageDiffRange(delta), stageAxes(strings, delta, input, true), zoom, { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta });
    }

    return {
        press(slot: number): void {
            if (hold.pressing) return;
            const timer = window.setTimeout(() => {
                if (hold.releaseTimer !== undefined) { window.clearTimeout(hold.releaseTimer); hold.releaseTimer = undefined; }
                hold.slot = slot;
                deps.slotHeld();
                deps.scheduleSide();
            }, TAP_MS);
            hold.pressing = { slot, at: window.performance.now(), timer };
        },
        release(slot: number): void {
            if (!hold.pressing || hold.pressing.slot !== slot) return;
            window.clearTimeout(hold.pressing.timer);
            const tapped = window.performance.now() - hold.pressing.at < TAP_MS;
            hold.pressing = undefined;
            if (tapped) { deps.tapped(slot); return; }
            hold.releaseTimer = window.setTimeout(() => { hold.releaseTimer = undefined; hold.slot = null; deps.scheduleSide(); }, DELTA_RELEASE_MS);
        },
        slot: () => hold.slot,
        holdStep(step: RecipeStep | null): void {
            if (!step) {
                hold.stepRelease = window.setTimeout(() => { hold.stepRelease = undefined; hold.step = null; deps.scheduleSide(); }, DELTA_RELEASE_MS);
                return;
            }
            if (hold.stepRelease !== undefined) { window.clearTimeout(hold.stepRelease); hold.stepRelease = undefined; }
            const path = deps.focusedFile() ?? deps.slotFiles()[1];
            if (!path || !deps.results.get(path)?.ok) { document.getElementById('hint-footer')?.replaceChildren(strings.stepHeldNoRow); return; }
            hold.step = { step, path };
            deps.scheduleSide();
        },
        canHold(step: RecipeStep): boolean {
            if (step.operation === TIME_SLICE) return false;
            if (step.id === OCTAVE_BRANCH) return true;
            const recipe = deps.recipe();
            if (!recipe) return false;
            const steps = recipeNodes(recipe).map(node => node.id);
            const signal = timeSignalStep(recipe, deps.limits());
            // The average spectrum the table reads (the chain's end), or a step up to the time signal.
            if (step.name === 'welch') return deps.spectral();
            return !!signal && steps.indexOf(step.id) <= steps.indexOf(signal.id);
        },
        picture: () => hold.plot,
        paint(): void {
            if (hold.step) { paintStep(hold.step); return; }
            held.hidden = hold.slot === null;
            held.classList.remove('is-pending');
            if (hold.slot !== null) {
                const path = deps.slotFiles()[hold.slot] ?? deps.focusedFile();
                const comparison = buildCompareModel(deps.entryModel(), deps.results, path, null, strings);
                title.textContent = path ? `${hold.slot} · ${baseName(path)}` : '';
                paintDelta(comparison, `slot|${hold.slot}`, path ? deps.results.get(path)?.input : undefined);
            }
        },
        handle: message => source.handle(message),
    };
}
