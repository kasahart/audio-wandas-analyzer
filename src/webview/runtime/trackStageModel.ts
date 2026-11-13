/**
 * The track view's "steps" mode without its DOM: what it remembers (TrackStageState), which step it shows, which
 * file it compares, the region it compares over, and the scans (StageSpec) its pictures are asked for with.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { activeSlotReferenced, recipeKey, recipeSteps, slotReferenced, TIME_SLICE, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { withChannel } from '../../shared/recipe/channelSelection';
import { INPUT_STAGE, recipeWithout, unpairedRecipe } from './stepBarModel';
import type { StageSpec } from './stageSource';
import { FULL_PLOT_WINDOW, type PlotWindow } from './plotInteraction';
import type { NormalizedRange } from './waveformInteraction';
import type { Combined } from './combineSource';
import { regionKey } from './entryTable';

/** The Recipe the entry table scans with, the one its scans run (the steps that cannot run left out), and the failures. */
export interface StageRecipe { recipe: RecipeDocument; runRecipe?: RecipeDocument; failed?: Readonly<Record<string, string>> }

/** What the mode remembers between paints. */
export interface TrackStageState {
    on: boolean;
    /** The step chosen on the bar (null: the chain's end). */
    stage: string | null;
    /** Whether the comparison has been opened before: the first time it shows the input, after that the step shown last. */
    opened: boolean;
    overlaid: boolean;
    showDiff: boolean;
    /** The plots' shared zoom (the overlay's, the lanes' side by side, and the Δ pane's horizontal part). */
    window: PlotWindow;
    /** The Δ pane's own vertical zoom: its axis is the difference, not the overlay's level. */
    diffY: NormalizedRange;
    /** The lanes' own zoom while they sit under a trigger's events: their time is the recording's, not the trigger's. */
    lanesWindow: PlotWindow;
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

/** Every plot of the mode zoomed out to the whole of each axis. */
export const WHOLE_ZOOM: Pick<TrackStageState, 'window' | 'diffY' | 'lanesWindow'> = { window: FULL_PLOT_WINDOW, diffY: FULL_PLOT_WINDOW.y, lanesWindow: FULL_PLOT_WINDOW };

export function initialStageState(): TrackStageState {
    return { on: false, stage: null, opened: false, overlaid: true, showDiff: false, ...WHOLE_ZOOM, compared: 1, held: null, groupBase: false, regionSet: null, pendingRegion: null, heldStep: null, baseAllowed: new Set(), gateKey: null };
}

/**
 * The mode opened for a comparison, on `stage`; without one, on the input the first time (the recordings as they are,
 * before any analysis is chosen), else on the step shown last. The rest of what it showed before is forgotten.
 */
export function openStageState(state: TrackStageState, stage: string | undefined): void {
    Object.assign(state, { stage: stage ?? (state.opened ? state.stage : INPUT_STAGE), opened: true, compared: 1, held: null, groupBase: false, heldStep: null, ...WHOLE_ZOOM, overlaid: true, pendingRegion: null });
}

/** The mode shown (from the tracks, which keep what it showed): the first time, on the input. */
export function enterStageState(state: TrackStageState): void {
    if (state.opened) return;
    state.stage = INPUT_STAGE;
    state.opened = true;
}

/** The part of the files compared: the region chip's, unless it is bypassed. */
export function liveRegion(recipe: RecipeDocument | undefined, regionSet: EntryRegion | null): EntryRegion | null {
    const slice = recipe ? recipeSteps(recipe).find(step => step.operation === TIME_SLICE) : undefined;
    return slice?.bypassed ? null : regionSet;
}

/**
 * The step shown: the input, a step that cannot run (shown as such), the step before a bypassed one, else the step
 * chosen, or the chain's end.
 */
export function chosenStage(recipe: RecipeDocument, limits: StepLimits, stage: string | null): string | null {
    const all = recipeSteps(recipe, limits);
    const steps = all.filter(step => step.invalid === undefined && !step.bypassed);
    if (stage === INPUT_STAGE) return INPUT_STAGE;
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
    return { key: `stage|${recipeKey(run)}|${regionKey(region)}|${id}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), stage: id } };
}

/**
 * The files' scans over the region (their metrics), for D and the report: with every Welch bin (spectrumBins), of
 * which the report takes its median and Δ. Without a region, the whole files', asked for by the report only.
 */
export function regionStageSpec(recipe: StageRecipe | null, region: EntryRegion | null): StageSpec {
    // The metrics: the base recording is not paired in this scan, so the steps measured against it are left out.
    const run = unpairedRecipe(recipe?.runRecipe, recipe?.recipe);
    return { key: `region|${recipeKey(run)}|${regionKey(region)}|bins`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), spectrumBins: true } };
}

/** What holding `step` draws: the chain without it (and the steps that then cannot run), on the step on screen `id`. */
export function holdStageSpec(recipe: StageRecipe | null, id: string | null, step: RecipeStep, limits: StepLimits, region: EntryRegion | null, ch: number | null = null): StageSpec | undefined {
    if (!recipe || !id || step.operation === TIME_SLICE) return undefined;
    const steps = recipeSteps(recipe.recipe, limits).filter(item => item.invalid === undefined);
    const at = steps.findIndex(item => item.id === id);
    const shownOf = step.id === id ? steps[at - 1]?.id : id;
    if (!shownOf) return undefined;
    const unselected = recipeWithout(recipe.runRecipe ?? recipe.recipe, step.id, shownOf, limits, slotReferenced(recipe.recipe));
    if (!unselected) return undefined;
    // With a channel there is a Recipe to pick it from: the one without the step.
    const without = channelRecipe(unselected, ch, recipe.recipe) ?? unselected;
    return { key: `hold|${recipeKey(without)}|${regionKey(region)}|${shownOf}`, message: { recipe: without, ...(region ? { region } : {}), stage: shownOf } };
}

/**
 * The pictures of one paint: the base, the compared file's, the other tracks' and the compared file's difference from
 * the base. A base group of signals has no median signal: `baseMembers` are its files' own
 * waveforms, drawn each (named, for the line under the pointer).
 */
export interface StagePlots<T> { base: StageView | null; baseMembers: Array<{ path: string; view: StageView }>; compare: StageView | null; others: Array<{ track: T; view: StageView | null }>; diff: StageView | null }

/**
 * The base is one file's picture (`baseOf`, else `views`), or a group's median once `combined` (taken from the
 * Frames' full resolution, combineSource.ts); the difference is `combined`'s too. A group's
 * waveforms are its members, each drawn as it is.
 */
export function plotsOf<T extends { filePath: string }>(views: (path: string) => StageView | null | undefined, tracks: readonly T[], comparePath: string | null, basePaths: readonly string[], combined: Combined | undefined, baseOf = views): StagePlots<T> {
    const base = basePaths.length === 1 ? baseOf(basePaths[0]) ?? null : basePaths.length > 1 ? combined?.base ?? null : null;
    const members = basePaths.map(path => ({ path, view: baseOf(path) })).filter((item): item is { path: string; view: StageView } => !!item.view);
    const baseMembers = members.length > 1 && members.every(item => item.view.waveform) ? members : [];
    const compare = comparePath ? views(comparePath) ?? null : null;
    const others = tracks.filter(track => track.filePath !== comparePath && !basePaths.includes(track.filePath)).map(track => ({ track, view: views(track.filePath) ?? null }));
    const compared = !!comparePath && !basePaths.includes(comparePath);
    return { base, baseMembers, compare, others, diff: compared ? combined?.diff ?? null : null };
}

/**
 * What to ask the backend to combine for a paint: the base's pictures' kept values (`data`) and the compared
 * file's. Undefined while a picture is not in; null when there is nothing to combine (one base file and nothing
 * compared, or a picture without kept values: a step not drawn, a trigger that found no event); 'tooLarge' when a
 * picture's values were over what the backend keeps (`tooLarge`, its scan's stageDataTooLarge): nothing is asked,
 * and nothing scanned again, for a combination that cannot be made.
 */
export function combineRequest(views: (path: string) => StageView | null | undefined, comparePath: string | null, basePaths: readonly string[], tooLarge: (path: string) => boolean = () => false): { base: string[]; compare: string | null } | 'tooLarge' | null | undefined {
    const compared = !!comparePath && !basePaths.includes(comparePath);
    if (!basePaths.length || (basePaths.length === 1 && !compared)) return null;
    const paths = [...basePaths, ...(compared && comparePath ? [comparePath] : [])];
    const pictures = paths.map(views);
    if (pictures.some(view => view === undefined)) return undefined;
    if (paths.some(tooLarge)) return 'tooLarge';
    const keys = pictures.map(view => view?.data);
    const base = keys.slice(0, basePaths.length);
    if (base.some(key => !key)) return null;
    // A compared picture without kept values has no difference; the base group's median is still taken.
    const compare = compared ? keys[basePaths.length] ?? null : null;
    if (!compare && base.length === 1) return null;
    return { base: base as string[], compare };
}

