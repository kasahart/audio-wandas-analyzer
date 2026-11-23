/**
 * The track view's "steps" mode without its DOM: what it remembers (TrackStageState), which step it shows, which
 * file it compares, the region it compares over, and the scans (StageSpec) its pictures are asked for with.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { activeSlotReferenced, recipeKey, recipeSteps, slotReferenced, TIME_SLICE, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { withChannel } from '../../shared/recipe/channelSelection';
import { INPUT_STAGE, recipeWithout } from './stepBarModel';
import type { StageSpec } from './stageSource';
import { FULL_PLOT_WINDOW, type PlotWindow } from './plotInteraction';
import type { NormalizedRange } from './waveformInteraction';
import { regionKey } from './compareBasics';

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

/**
 * The channel (from 1, as `stageSpec` and `withChannel` count) of the recording drawn under a trigger's events: the
 * compared channel row's, else the one the trigger watches. The trigger's own `channel` counts from 0 (wandas'
 * index): the channel held against its level is that index + 1, never the recording's channels averaged (what "no
 * channel" would ask for).
 */
export function watchedChannel(row: number | null, triggerChannel: unknown): number {
    return row ?? (typeof triggerChannel === 'number' && triggerChannel >= 0 ? Math.floor(triggerChannel) : 0) + 1;
}

/**
 * The scan for step `id` over `region`, one channel or all: it describes the step's result (what it is, its events,
 * the key of its kept answer), with no drawn point. The comparison's figures are the figure service's.
 */
export function stageSpec(recipe: StageRecipe | null, region: EntryRegion | null, id: string, ch: number | null = null): StageSpec {
    const run = channelRecipe(recipe?.runRecipe, ch, recipe?.recipe);
    return { key: `stage|${recipeKey(run)}|${regionKey(region)}|${id}`, message: { ...(run ? { recipe: run } : {}), ...(region ? { region } : {}), stage: id } };
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

