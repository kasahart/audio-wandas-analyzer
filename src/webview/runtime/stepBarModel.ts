/**
 * The step bar's model: what it is given (StepBarState), the Recipe the scans run from it, and the chain as the bar
 * lays it out (the steps to the time signal, the steps after it, the app's 1/3-octave branch). No DOM here.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { brokenStep, chainEnd, chainOutput, recipeChain, recipeNodes, recipeSteps, timeSignalStep, withoutBypassed, withoutSteps, slotReferenced, activeSlotReferenced, REFERENCE_KEY, TIME_SLICE, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { reportOctaveRecipe } from './compareReport';

export type StepBarStrings = Pick<UiStrings, 'stepAfterBroken' | 'stepOctaveBroken' | 'stepUndo' | 'stepRedo' | 'stepUndone' | 'stepRedone' | 'stepBypass' | 'stepBypassOff' | 'stepBypassed' | 'stepUnbypassed' | 'stepMenuEarlier' | 'stepGoesBefore' | 'stepMenuOff' | 'stepRegionStart' | 'stepRegionEnd' | 'stepRegionPurpose' | 'stepRegionAdded' | 'stepRegionImported' | 'stepRegionCleared' | 'stepRegionClear' | 'stepRegionOrder' | 'stepRegionThere' | 'stepInputHint' | 'stepNeedAbove' | 'stepNeedInteger' | 'stepRegion' | 'stepAll' | 'stepMetrics' | 'stepAverage' | 'stepSettings' | 'stepApply' | 'compareNotEntry' | 'stepNeedBelow' | 'stepNeedPow2' | 'hintStepChip' | 'stepRecipeName' | 'hintSpectrogramGroup' | 'stepNeedValue' | 'hintSpectrogram' | 'stepFrameHint' | 'hintRegionMark' | 'stepOpen' | 'stepClose' | 'stepOutsideHeading' | 'stepOctave' | 'stepHoldHint' | 'stepHintNoHold' | 'stepAdd' | 'entryColLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepNeedFrame' | 'stepFailedOn' | 'stepTapHint' | 'stepNoSettings' | 'stepRemove' | 'stepMenuTitle' | 'stepMenuFilter' | 'stepOffFrame' | 'stepOffRequired' | 'stepOffRefuses' | 'stepOffUnavailable' | 'stepDefaultsOnly' | 'stepAdded' | 'stepRemoved' | 'btnStage' | 'stepInputFiles' | 'stepInput' | 'stepHintLocale' | 'stepGroupFilter' | 'stepGroupPrepare' | 'stepGroupTime' | 'stepGroupFrequency' | 'stepGroupOther' | 'stepDragHint' | 'stepMoved' | 'stepRemoveChip' | 'stepHighpass' | 'stepLowpass' | 'stepBandpass' | 'stepAverageFft' | 'stepOctaveHint' | 'stepNeedChannels' | 'stepNarrowedChannels' | 'stepPairSelf' | 'stepNeedChannel' | 'stepOffChannels' | 'stepPair' | 'stepPairOutput' | 'stepPairInput' | 'stepReference' | 'stepReferenceChannel' | 'stepReferenceSlot' | 'stepReferenceSet' | 'stagePairBase'>;

/** The app's 1/3-octave branch: not a Recipe node, computed beside the chain's end (reportOctaveRecipe). */
export const OCTAVE_BRANCH = 'node-noct';
/** The input as a stage: the files' waveforms as they come in (scan_service.py's INPUT_STAGE). */
export const INPUT_STAGE = 'node-input';
/** A region of the files, in seconds. */
export interface RegionRange { start: number; end: number }
export const SPECTRAL_ENDS = ['SpectralFrame', 'NOctFrame'];

export interface StepBarState {
    recipe: RecipeDocument | null;
    sampleRate?: number;
    /** Samples in the folder's shortest file, which bounds the FFT length. */
    shortestSamples?: number;
    /** Channels of the files, which bound a channel index. */
    channels?: number;
    /** Seconds measured (the region's, else the shortest file's): where fix_length starts. */
    lengthS?: number;
    /** Steps that failed on a file, with wandas' reason: marked and left out. */
    failed?: Readonly<Record<string, string>>;
    /** "0.50–1.50 s"; undefined is the whole file. */
    region?: string;
    /** Comparison only: the region set with the region chip (null: the whole file, and no chip). */
    regionRange?: RegionRange | null;
    regionDiffers?: boolean;
    specVersion?: number;
    /** Comparison only: the base is a group median, so there is no single file's spectrogram to hold. */
    groupBase?: boolean;
    /** Comparison only: the step whose Frame the panes show (white frame); undefined is the chain's end. */
    stage?: string;
    /** How many files the chain runs on, for the input chip. */
    files?: number;
}

/** The limits a Recipe's steps are checked against: the folder's, and the steps that failed on a file. */
export function stepLimits(state: Pick<StepBarState, 'sampleRate' | 'shortestSamples' | 'failed' | 'channels'>): StepLimits {
    return { sampleRate: state.sampleRate, shortestSamples: state.shortestSamples, ...(state.channels ? { channels: state.channels } : {}), ...(state.failed ? { failed: state.failed } : {}) };
}

/** The Recipe the scans run: the bar's Recipe without the steps that cannot run. */
export function runnableRecipe(recipe: RecipeDocument, limits?: number | StepLimits): RecipeDocument {
    const run = withoutBypassed(recipe);
    // A step measured against the base slot needs no second channel: judged with its reference still on.
    const slotted = slotReferenced(recipe);
    const judged = slotted.length ? { ...run, [REFERENCE_KEY]: slotted } as RecipeDocument : run;
    return withoutSteps(run, recipeSteps(judged, limits).filter(step => step.invalid !== undefined).map(step => step.id));
}

/**
 * What a scan without the base recording runs (the table's metrics and a region's): the run Recipe before its first
 * step measured against the base slot, which pairs nothing there. `editor` is the bar's Recipe, which names them.
 */
export function unpairedRecipe(run: RecipeDocument | undefined, editor: RecipeDocument | null | undefined): RecipeDocument | undefined {
    const referenced = new Set(activeSlotReferenced(editor));
    if (!run || !referenced.size) return run;
    const chain = recipeChain(run).map(node => node.id);
    const at = chain.findIndex(id => referenced.has(id));
    return at < 0 ? run : withoutSteps(run, chain.slice(at).reverse());
}

/** Whether the chain ends in a spectrum or band levels, so the app's 1/3-octave columns and branch apply. */
export function endsInSpectrum(recipe: RecipeDocument, limits?: number | StepLimits): boolean {
    return SPECTRAL_ENDS.includes(chainOutput(recipe, limits));
}

/**
 * What holding step `id` runs: the Recipe without it and the later steps that then cannot run, as the scans
 * do; null when the stage `shown` is not in it any more (the 1/3-octave branch is, while it ends in a spectrum).
 * `referenced` are the editor's steps measured against the base slot, which a run Recipe no longer names.
 */
export function recipeWithout(recipe: RecipeDocument, id: string, shown: string, limits?: number | StepLimits, referenced: readonly string[] = slotReferenced(recipe)): RecipeDocument | null {
    const rest = withoutSteps(recipe, [id]);
    const without = runnableRecipe(referenced.length ? { ...rest, [REFERENCE_KEY]: [...referenced] } : rest, limits);
    const present = shown === OCTAVE_BRANCH ? endsInSpectrum(without, limits) : recipeNodes(without).some(node => node.id === shown);
    return present ? without : null;
}

/** The Frame a step passes on: its own, unless it is left out or bypassed. */
export const frameAfter = (step: RecipeStep): string => (step.invalid === undefined && !step.bypassed ? step.output : step.input);
/** Whether the bar shows a step as a chip: the region chip is there only while a region is set. */
export const shownStep = (step: RecipeStep, state: Pick<StepBarState, 'regionRange'>): boolean => step.operation !== TIME_SLICE || !!state.regionRange;
/** Whether a step can be removed, moved and bypassed as itself (the app's branch and the region chip cannot). */
export const removable = (step: RecipeStep): boolean => step.id !== OCTAVE_BRANCH && step.operation !== TIME_SLICE;

/** The chain laid out: the steps to its time signal, the steps after it, and the app's 1/3-octave branch. */
export interface StepFlow { chain: RecipeStep[]; tail: RecipeStep[]; octave?: RecipeStep }

/**
 * The chain as the scan runs it: the steps to its time signal, then the steps after it (a row of their
 * own) and, when the chain ends in a spectrum or band levels, the app's 1/3-octave branch beside them.
 */
export function stepFlow(recipe: RecipeDocument, state: StepBarState): StepFlow {
    const limits = stepLimits(state);
    const steps = recipeSteps(recipe, limits);
    const signal = timeSignalStep(recipe, limits);
    const split = signal ? steps.findIndex(step => step.id === signal.id) + 1 : 0;
    // A broken chain that would end in a spectrum keeps its branch, which cannot run either.
    const broken = brokenStep(recipe, limits);
    if (broken && SPECTRAL_ENDS.includes(chainEnd(recipe, limits))) {
        const octave: RecipeStep = { id: OCTAVE_BRANCH, operation: 'wandas.audio.noct_spectrum', name: 'noct_spectrum', params: {}, editable: [], input: INPUT_FRAME, output: 'NOctFrame', invalid: '', reason: { kind: 'after', limit: 0, text: broken.id } };
        return { chain: steps.slice(0, split), tail: steps.slice(split), octave };
    }
    if (!endsInSpectrum(recipe, limits)) return { chain: steps.slice(0, split), tail: steps.slice(split) };
    const found = state.sampleRate ? recipeSteps(reportOctaveRecipe(recipe, null, undefined, state.sampleRate)).find(step => step.name === 'noct_spectrum') : undefined;
    // Bands the file cannot give (or no file yet to tell): no branch, rather than a chip that draws nothing.
    if (!found) return { chain: steps.slice(0, split), tail: steps.slice(split) };
    // The branch is the app's, not a Recipe node: nothing on it to set or remove.
    const octave: RecipeStep = { id: OCTAVE_BRANCH, operation: 'wandas.audio.noct_spectrum', name: 'noct_spectrum', params: found?.params ?? {}, editable: [], input: INPUT_FRAME, output: 'NOctFrame' };
    return { chain: steps.slice(0, split), tail: steps.slice(split), octave };
}

/** The steps of the chain in the order they run, then the app's 1/3-octave branch. */
export function orderedSteps(flow: StepFlow): RecipeStep[] {
    return [...flow.chain, ...flow.tail, ...(flow.octave ? [flow.octave] : [])];
}

/** The last step that runs (a region chip not shown included, so a step added at the end goes after it): ＋ at the end adds after it. */
export function lastRunningStep(recipe: RecipeDocument, state: StepBarState): RecipeStep | undefined {
    const steps = recipeSteps(recipe, stepLimits(state));
    return steps.filter(step => step.invalid === undefined && !step.bypassed).at(-1) ?? steps.at(-1);
}

/** The stage on screen: on the entry table the 1/3-octave levels (or the chain's end), on the comparison the step shown. */
export function currentStepId(recipe: RecipeDocument, state: StepBarState, mode: 'entry' | 'compare'): string | undefined {
    const { octave } = stepFlow(recipe, state);
    if (mode === 'entry') return octave?.id ?? lastRunningStep(recipe, state)?.id;
    return state.stage ?? lastRunningStep(recipe, state)?.id;
}

/** A place in the chain before ＋'s: after which step (null: the input), the Frame there, and the chip that follows. */
export interface EarlierPlace { after: string | null; frame: string; next?: RecipeStep }

/** The places before ＋'s, nearest first. */
export function earlierPlaces(recipe: RecipeDocument, state: StepBarState, after: string | null): EarlierPlace[] {
    const steps = recipeSteps(recipe, stepLimits(state));
    const at = after ? steps.findIndex(step => step.id === after) : -1;
    const places: EarlierPlace[] = [];
    for (let index = at - 1; index >= -1; index--) {
        places.push({ after: index >= 0 ? steps[index].id : null, frame: index >= 0 ? frameAfter(steps[index]) : INPUT_FRAME, next: steps.slice(index + 1).find(step => shownStep(step, state)) });
    }
    return places;
}
