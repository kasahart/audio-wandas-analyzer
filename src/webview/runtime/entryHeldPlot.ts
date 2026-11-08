/**
 * The entry table's held plot, beside the distribution: what a held slot key (or slot chip) or a held step chip
 * shows until it is let go. A slot held shows that slot's row's Δ spectrum against its base, as the rest of the screen
 * compares it (the row's channel, the same base: entryBase.ts), of every Welch bin of the file and its base (asked
 * for when the hold starts; the table's 192 points until they are in). A step chip held shows what the step does to one row (the focused one, else slot 1): its average
 * spectrum, its 1/3-octave levels, or, for a step of the time signal, the spectrum without it − with it. Those
 * pictures come as the steps view's do (stageSource, the Frame's full resolution once zoomed) and are drawn by
 * its painter. Let go, the picture stays 150 ms, so a quick look does not flicker.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { CompareCombineMessage, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeKey, recipeNodes, recipeSteps, slotReferenced, timeSignalStep, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { baseName } from '../../shared/analysis/entryMetadata';
import { DIFF_COLOR } from '../../shared/gui/roleColors';
import { deltaViews, withBins, type CompareModel, type LevelInput, type PaneRange } from './comparePanes';
import type { PlotMargins, PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, paintOverlay, stageAxes, stageDiffRange, stageRange, STAGE_MARGINS, type StageAxes, type StagePlot } from './stagePanes';
import { createDetailPlanner } from './stageDetail';
import { createCombineSource, noDeltaNote, type Combined } from './combineSource';
import { createStageSource, type StageSpec } from './stageSource';
import { createStageReader } from './stageReader';
import { localLine, type FullRead } from './fullRead';
import { recipeWithout, stepChipLabel, stepLimits } from './stepBar';
import { withChannel } from '../../shared/recipe/channelSelection';

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
    /** What the plot component drew, which the pointer reads (R7). */
    drawn: StagePlot | null;
}

export interface HeldPlotDeps {
    document: Document;
    window: Pick<Window, 'setTimeout' | 'clearTimeout'> & { performance: Pick<Performance, 'now'> };
    strings: UiStrings;
    /** The held plot's box, its title and its canvas. */
    held: HTMLElement;
    title: HTMLElement;
    canvas: HTMLCanvasElement;
    post(message: CompareScanMessage | CompareCombineMessage): void;
    /** The side plots drawn again on the next frame. */
    scheduleSide(): void;
    /** The plot's zoom, kept while it shows the same thing (`key`), whole again for another. */
    keepWindow(name: string, key: string): PlotWindow;
    results: ReadonlyMap<string, ScanResult>;
    /** The comparison of `comparePath` with its base over `over`, each file as the channel it is compared as (entryBase.comparison). */
    comparison(comparePath: string, over: ReadonlyMap<string, ScanResult>): CompareModel;
    /** The recordings `comparePath` is measured against. */
    basePaths(comparePath: string): readonly string[];
    /** The Recipe the table's scans run (undefined: the host's own), which the held Δ's bins are scanned with too. */
    scanRecipe(): RecipeDocument | undefined;
    focusedFile(): string | null;
    slotFiles(): (string | null)[];
    /** The channel the held row compares `filePath` as (its row's, R11), or null for a one-channel file: a held step draws that channel. */
    channelOf(filePath: string): number | null;
    /** The colour a file is drawn in: its role's, else its own (R5). */
    colorOf(filePath: string): string;
    /** The table's Recipe (its edited one, else the host's), and the one its scans run (undefined: the host's own). */
    recipe(): RecipeDocument | null;
    runRecipe(): RecipeDocument | undefined;
    limits(): ReturnType<typeof stepLimits>;
    /** Whether the chain ends in a spectrum or band levels. */
    spectral(): boolean;
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
        step: { step: RecipeStep; path: string; ch: number | null } | null;
        stepRelease?: number;
        plot: HeldPicture | null;
    } = { slot: null, step: null, plot: null };
    const source = createStageSource('entry-hold', message => deps.post(message), () => deps.scheduleSide());
    // Every Welch bin of a held slot's file and its base: the table's own scans carry only the 192 points.
    const bins = createStageSource('held-bins', message => deps.post(message), () => deps.scheduleSide());
    /** The table spectrum each file's bins were last asked for with (by spec and file). */
    const binsAskedFor = new Map<string, string>();
    // Without the step − with it, taken by the backend from the Frames' full resolution (combineSource.ts).
    const combine = createCombineSource('held-combine', message => deps.post(message), () => deps.scheduleSide());
    // Every number read off the held plot comes from the full data, never its thinned line (R7).
    const reader = createStageReader('read-held', message => deps.post(message));
    /** The last zoomed difference of each held step, drawn until the next zoom's is in. */
    const lastFine = new Map<string, Combined>();
    const detail = createDetailPlanner(window.performance, window, () => deps.scheduleSide());

    /** The step `id`'s picture under `recipe` (the whole file, as the table scans it). */
    function holdSpec(recipe: RecipeDocument, id: string): StageSpec {
        return { key: `hold|${recipeKey(recipe)}|${id}`, message: { recipe, stage: id } };
    }
    /**
     * The specs a held step draws from: its own picture (the average spectrum), or the chain's end with and without
     * it, of the channel `ch` the row is compared as (R11: the row's channel, as the table and the comparison read it).
     */
    function heldSpecs(step: RecipeStep, ch: number | null): { with: StageSpec; without?: StageSpec } | null {
        const recipe = deps.runRecipe() ?? deps.recipe();
        if (!recipe) return null;
        const paired = slotReferenced(deps.recipe()).length > 0;
        // The channel is picked (or not) by the whole chain, once, for both pictures: a chain that compares the
        // recording's channels (an unpaired channel_difference) keeps them all, with or without the step held, so
        // its Δ is the step's alone and not one channel against all of them.
        const withRow = ch ? withChannel(recipe, ch, paired) : recipe;
        const picks = withRow !== recipe;
        if (step.name === 'welch') return { with: holdSpec(withRow, step.id) };
        const limits = deps.limits();
        const end = recipeSteps(recipe, limits).filter(item => item.invalid === undefined).at(-1)?.id;
        const without = end ? recipeWithout(recipe, step.id, end, limits, slotReferenced(deps.recipe())) : null;
        return end && without ? { with: holdSpec(withRow, end), without: holdSpec(picks && ch ? withChannel(without, ch, true) : without, end) } : null;
    }
    /** The held plot's picture and what it was drawn on, for its readout and an axis's range. */
    function paintView(view: StageView | null, picture: StageView | null, range: PaneRange, axes: StageAxes, zoom: PlotWindow, options: { diff?: boolean; color: string; empty?: string; full?: FullRead }): void {
        const drawn = paintOverlay(canvas, { layers: view ? [{ view, color: options.color, width: 2, ...(options.full ? { full: options.full } : {}) }] : [] }, narrowed(range, zoom), axes,
            { diff: options.diff, empty: options.empty ?? '', window: { x: zoom.x }, axisView: picture });
        hold.plot = picture ? { margins: STAGE_MARGINS, x: f => axisValueAt(picture, f), ofX: number => axisFractionOf(picture, number), range, xLabel: axes.x, yLabel: axes.y, drawn: view ? drawn : null } : null;
    }
    function paintStep({ step, path, ch }: { step: RecipeStep; path: string; ch: number | null }): void {
        held.hidden = false;
        const input = deps.results.get(path)?.input;
        const name = step.name === 'welch' ? strings.stepAverage : strings.stepHeldWithout.replace('{step}', stepChipLabel(step, strings));
        title.textContent = strings.stepHeldRow.replace('{what}', name).replace('{file}', baseName(path));
        held.classList.remove('is-pending');
        const zoom = deps.keepWindow('held', step.id);
        const specs = heldSpecs(step, ch);
        const waiting = !!specs && [specs.with, specs.without].some(spec => spec && source.ensure(spec, [path]));
        const coarse = specs ? source.view(specs.with, path) ?? null : null;
        const coarseWithout = specs?.without ? source.view(specs.without, path) ?? null : null;
        if (!specs || waiting || !coarse || (specs.without && !coarseWithout)) {
            if (waiting) { held.classList.add('is-pending'); title.textContent += ` · ${strings.comparePending}`; }
            paintView(null, null, { min: 0, max: 1 }, stageAxes(strings, null, input), zoom, { color: deps.colorOf(path), empty: waiting ? '' : strings.stepNotDrawable.replace('{frame}', coarse?.frame ?? '') });
            return;
        }
        // Zoomed, from the Frame's full resolution once it is in (the coarse picture until then).
        // A line over time panned or zoomed past its detail: the detail already in too, until the next one is.
        const fineOf = (spec: StageSpec): StageSpec[] => {
            if (coarse.kind === 'bar' || coarse.kind === 'none') return [];
            const finer = detail.spec(spec, coarse, zoom.x, zoom.y, canvas.clientWidth || 300);
            if (finer) source.ensure(finer, [path]);
            return [finer, ...detail.drawn(spec, coarse, zoom.x)].filter((item): item is StageSpec => !!item);
        };
        if (!specs.without) {
            const fine = fineOf(specs.with).map(spec => source.view(spec, path)).find(view => !!view);
            paintView(fine ?? coarse, coarse, stageRange([coarse]), stageAxes(strings, coarse, input), zoom, { color: deps.colorOf(path), full: reader.of(coarse) });
            return;
        }
        // Without the step − with it, at full resolution: what the step takes away (negative where it cuts), the
        // whole picture's for the axes, the part on screen's once zoomed.
        const without = specs.without;
        const identity = `${specs.with.key}|${without.key}|${path}`;
        const forget = (keys: readonly string[]): void => {
            for (const spec of [specs.with, without]) {
                const key = source.view(spec, path)?.data;
                if (key && keys.includes(key)) source.forget(spec, path);
            }
            deps.scheduleSide();
        };
        const asked = coarse.data && coarseWithout?.data ? { base: [coarse.data], compare: coarseWithout.data } : null;
        const whole = asked ? combine.get(identity, asked, forget) : { diff: null, tooLarge: false };
        if (!whole) {
            held.classList.add('is-pending');
            title.textContent += ` · ${strings.comparePending}`;
            paintView(null, null, { min: 0, max: 1 }, stageAxes(strings, null, input), zoom, { color: DIFF_COLOR, empty: '' });
            return;
        }
        const finer = coarse.kind === 'bar' || coarse.kind === 'none' ? null : detail.spec(specs.with, coarse, zoom.x, zoom.y, canvas.clientWidth || 300);
        const fineDetail = finer?.message.detail;
        const zoomed = asked && fineDetail ? combine.get(`${identity}|${JSON.stringify(fineDetail)}`, { ...asked, detail: fineDetail }, forget) : undefined;
        if (zoomed) lastFine.set(identity, zoomed);
        const delta = whole.diff;
        const shown = (zoomed ?? (fineDetail ? lastFine.get(identity) : undefined))?.diff ?? delta;
        paintView(shown, delta, stageDiffRange(delta), stageAxes(strings, delta, input, true), zoom, { diff: true, color: DIFF_COLOR, empty: noDeltaNote(whole, strings), ...(asked ? { full: reader.combined(asked.base, asked.compare, 'diff') } : {}) });
    }
    /** The held row's Δ spectrum (from the table's own scan), zoomed as its window says. */
    function paintDelta(comparison: CompareModel, key: string, input: LevelInput | undefined): void {
        const zoom = deps.keepWindow('held', `delta|${key}`);
        // From every bin, zoomed or not (R1, R3): the table's per-band Δ only where the scans gave no bins.
        const { picture, view } = deltaViews(comparison, zoom.x);
        // Read from every bin of the Δ (R7); without the bins, the table's per-band Δ is drawn whole.
        const bins = comparison.bins?.diff;
        const full: FullRead = bins?.length && comparison.bins ? localLine(bins.map((_, bin) => bin * (comparison.bins?.hz ?? 0)), bins) : 'drawn';
        paintView(view, picture, stageDiffRange(picture), stageAxes(strings, picture, input, true), zoom, { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta, full });
    }

    /**
     * A held slot's Δ: the comparison the screen makes of its row (the row's channel, its base), of every bin of the
     * file and its base, scanned as the table's own spectra are (its Recipe, the whole files) when the hold starts;
     * the table's 192 points until they are in. Without a base to measure against there is nothing to ask for.
     */
    function paintSlot(path: string, slot: number): void {
        const table = deps.comparison(path, deps.results);
        const run = deps.scanRecipe();
        const spec: StageSpec = { key: `held-bins|${recipeKey(run)}`, message: { ...(run ? { recipe: run } : {}), spectrumBins: true } };
        const files = [path, ...deps.basePaths(path)].filter(file => deps.results.get(file)?.ok);
        // A file scanned again since (changed on disk, the folder opened anew): its kept bins are of the old
        // spectrum, so they are asked for again, once for each table spectrum (one that never matches is not asked forever).
        for (const file of files) {
            const kept = bins.result(spec, file);
            const scanned = deps.results.get(file);
            const own = JSON.stringify(scanned?.ok ? scanned.spectrumDb : null);
            const key = `${spec.key}|${file}`;
            if (kept?.ok && JSON.stringify(kept.spectrumDb) !== own && binsAskedFor.get(key) !== own) bins.forget(spec, file);
            if (!kept || bins.result(spec, file) === undefined) binsAskedFor.set(key, own);
        }
        const waiting = !!table.diffDb && bins.ensure(spec, files);
        if (waiting) { held.classList.add('is-pending'); title.textContent += ` · ${strings.comparePending}`; }
        const binned = new Map(files.flatMap(file => { const result = bins.result(spec, file); return result ? [[file, result] as [string, ScanResult]] : []; }));
        paintDelta(binned.size ? deps.comparison(path, withBins(deps.results, binned)) : table, `slot|${slot}`, deps.results.get(path)?.input);
    }

    return {
        press(slot: number): void {
            if (hold.pressing) return;
            const timer = window.setTimeout(() => {
                if (hold.releaseTimer !== undefined) { window.clearTimeout(hold.releaseTimer); hold.releaseTimer = undefined; }
                hold.slot = slot;
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
            hold.step = { step, path, ch: deps.channelOf(path) };
            deps.scheduleSide();
        },
        canHold(step: RecipeStep): boolean {
            if (step.operation === TIME_SLICE) return false;
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
                title.textContent = path ? `${hold.slot} · ${baseName(path)}` : '';
                if (path) paintSlot(path, hold.slot);
                else paintView(null, null, { min: 0, max: 1 }, stageAxes(strings, null, undefined, true), deps.keepWindow('held', `delta|slot|${hold.slot}`), { diff: true, color: DIFF_COLOR, empty: strings.stageNoDelta });
            }
        },
        handle: message => source.handle(message) || bins.handle(message) || combine.handle(message) || reader.handle(message),
    };
}
