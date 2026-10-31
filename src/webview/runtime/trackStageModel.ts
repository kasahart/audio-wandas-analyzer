/**
 * The track view's "steps" mode without its DOM: what it remembers (TrackStageState), which step it shows, which
 * file it compares, the region it compares over, and the scans (StageSpec) its pictures are asked for with.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { activeSlotReferenced, brokenStep, chainEnd, recipeKey, recipeSteps, slotReferenced, TIME_SLICE, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { withChannel } from '../../shared/recipe/channelSelection';
import { endsInSpectrum, INPUT_STAGE, OCTAVE_BRANCH, recipeWithout, unpairedRecipe } from './stepBarModel';
import type { StageSpec } from './stageSource';
import { FULL_PLOT_WINDOW, type PlotWindow } from './plotInteraction';
import { medianView, stageDifference } from './stagePanes';
import { regionLabel } from './entryTable';

/** The Recipe the entry table scans with, the one its scans run (the steps that cannot run left out), and the failures. */
export interface StageRecipe { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> }

/** What the mode remembers between paints. */
export interface TrackStageState {
    on: boolean;
    /** The step chosen on the bar (null: the chain's end, or its 1/3-octave branch). */
    stage: string | null;
    overlaid: boolean;
    showDiff: boolean;
    /** The plots' shared zoom. */
    window: PlotWindow;
    /** The slot compared (1–3), the one held for a moment, and whether the base is the group median though slot 0 is set (0). */
    compared: number;
    held: number | null;
    groupBase: boolean;
    /** The region set with the step bar's region chip (s; null: the whole file). */
    regionSet: EntryRegion | null;
    /** The tracks' selection waiting to be the region chip (set as the comparison opens from the tracks). */
    pendingRegion: EntryRegion | null;
    /** The step held to see the chain without it. */
    heldStep: RecipeStep | null;
    /** Large base groups the user asked to scan, and the one on screen. */
    baseAllowed: Set<string>;
    gateKey: string | null;
}

export function initialStageState(): TrackStageState {
    return { on: false, stage: null, overlaid: true, showDiff: false, window: FULL_PLOT_WINDOW, compared: 1, held: null, groupBase: false, regionSet: null, pendingRegion: null, heldStep: null, baseAllowed: new Set(), gateKey: null };
}

/** The mode opened for a comparison, on `stage` (the chain's end without one): what it showed before is forgotten. */
export function openStageState(state: TrackStageState, stage: string | undefined): void {
    Object.assign(state, { stage: stage ?? null, compared: 1, held: null, groupBase: false, heldStep: null, window: FULL_PLOT_WINDOW, overlaid: true, pendingRegion: null });
}

/** The part of the files compared: the region chip's, unless it is bypassed. */
export function liveRegion(recipe: RecipeDocument | undefined, regionSet: EntryRegion | null): EntryRegion | null {
    const slice = recipe ? recipeSteps(recipe).find(step => step.operation === TIME_SLICE) : undefined;
    return slice?.bypassed ? null : regionSet;
}

/**
 * The step shown: the input, the app's 1/3-octave branch (where a comparison opens while the chain ends in a spectrum,
 * as the table's band column reads it), a step that cannot run (shown as such), the step before a bypassed one, else
 * the step chosen, or the chain's end.
 */
export function chosenStage(recipe: RecipeDocument, limits: StepLimits, stage: string | null): string | null {
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

/** The compared file: the slot held or tapped, else the first slot among the tracks. */
export function comparedPath(slots: readonly (string | null)[], trackPaths: readonly string[], held: number | null, compared: number): string | null {
    const present = (slot: number): boolean => !!slots[slot] && trackPaths.includes(slots[slot]);
    const slot = held !== null && present(held) ? held : present(compared) ? compared : [1, 2, 3].find(present);
    return slot === undefined ? null : slots[slot] ?? null;
}

/** The Recipe a picture is scanned with: the run Recipe, with a get_channel step for one channel. `editor` is the bar's. */
export function channelRecipe(recipe: RecipeDocument | undefined, ch: number | null, editor: RecipeDocument | undefined): RecipeDocument | undefined {
    if (!ch) return recipe;
    const own = recipe ?? editor;
    // A step measured against the base slot pairs one channel of each recording: the channel row's goes on.
    return own ? withChannel(own, ch, activeSlotReferenced(editor).length > 0) : undefined;
}

/** The scan for step `id`'s pictures over `region`, one channel or all. */
export function stageSpec(recipe: StageRecipe | null, region: EntryRegion | null, id: string, ch: number | null = null): StageSpec {
    const run = channelRecipe(recipe?.runRecipe, ch, recipe?.recipe);
    return { key: `stage|${recipeKey(run)}|${regionLabel(region)}|${id}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), stage: id } };
}

/** The files' scans over the region (their metrics), for D and the report. */
export function regionStageSpec(recipe: StageRecipe | null, region: EntryRegion | null): StageSpec {
    // The metrics: the base recording is not paired in this scan, so the steps measured against it are left out.
    const run = unpairedRecipe(recipe?.runRecipe, recipe?.recipe);
    return { key: `region|${recipeKey(run)}|${regionLabel(region)}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}) } };
}

/** What holding `step` draws: the chain without it (and the steps that then cannot run), on the step on screen `id`. */
export function holdStageSpec(recipe: StageRecipe | null, id: string | null, step: RecipeStep, limits: StepLimits, region: EntryRegion | null, ch: number | null = null): StageSpec | undefined {
    if (!recipe || !id || step.id === OCTAVE_BRANCH || step.operation === TIME_SLICE) return undefined;
    const steps = recipeSteps(recipe.recipe, limits).filter(item => item.invalid === undefined);
    const at = steps.findIndex(item => item.id === id);
    const shownOf = step.id === id ? steps[at - 1]?.id : id;
    if (!shownOf) return undefined;
    const unselected = recipeWithout(recipe.runRecipe ?? recipe.recipe, step.id, shownOf, limits, slotReferenced(recipe.recipe));
    if (!unselected) return undefined;
    // With a channel there is a Recipe to pick it from: the one without the step.
    const without = channelRecipe(unselected, ch, recipe.recipe) ?? unselected;
    return { key: `hold|${recipeKey(without)}|${regionLabel(region)}|${shownOf}`, message: { recipe: without, ...(region ? { region } : {}), stage: shownOf } };
}

/** How many points of a picture have a level (silence floors at −300 dB), and their median. */
export function pictureSummary(view: StageView | null | undefined): { stageValues: number; stageMedian: number | null } {
    const values = (view?.values ?? view?.matrix?.flat() ?? []).filter((value): value is number => value !== null && value > -250);
    const sorted = [...values].sort((a, b) => a - b);
    return { stageValues: values.length, stageMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
}

/** The pictures of one paint: the base, the compared file's, the other tracks' and the compared file's difference from the base. */
export interface StagePlots<T> { base: StageView | null; compare: StageView | null; others: Array<{ track: T; view: StageView | null }>; diff: StageView | null }

/** The base is the median of its files' pictures once all are in, else `fallback`. */
export function plotsOf<T extends { filePath: string }>(views: (path: string) => StageView | null | undefined, tracks: readonly T[], comparePath: string | null, basePaths: readonly string[], fallback: StageView | null = null): StagePlots<T> {
    const baseViews = basePaths.map(views).filter((view): view is StageView => !!view);
    const base = baseViews.length && baseViews.length === basePaths.length ? medianView(baseViews) : fallback;
    const compare = comparePath ? views(comparePath) ?? null : null;
    const others = tracks.filter(track => track.filePath !== comparePath && !basePaths.includes(track.filePath)).map(track => ({ track, view: views(track.filePath) ?? null }));
    return { base, compare, others, diff: comparePath && !basePaths.includes(comparePath) ? stageDifference(base, compare) : null };
}

/** A gated base group's 1/3-octave levels from the table, on the compared file's bands (a band within 6 %); null without them. */
export function tableBaseView(compare: StageView | null, bands: { centers: number[]; values: (number | null)[] } | null): StageView | null {
    if (!bands || !compare?.values || !compare.xs) return null;
    return { ...compare, waveform: undefined, values: compare.xs.map(x => { const at = bands.centers.findIndex(center => Math.abs(center - x) / x < 0.06); return at >= 0 ? bands.values[at] : null; }) };
}
