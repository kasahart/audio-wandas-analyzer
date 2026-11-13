/**
 * The step bar's model: what it is given (StepBarState), the Recipe the scans run from it, and the chain as the bar
 * lays it out (the steps to the time signal, the steps after it). No DOM here.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { chainOutput, recipeChain, recipeNodes, recipeSteps, timeSignalStep, withoutBypassed, withoutSteps, slotReferenced, activeSlotReferenced, REFERENCE_KEY, TIME_SLICE, TRIGGER, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import type { RegionPeak } from './regionPeak';

export type StepBarStrings = Pick<UiStrings, 'stepPeakUnread' | 'stepPeakTooMany' | 'stepAfterBroken' | 'stepOctaveBroken' | 'stepUndo' | 'stepRedo' | 'stepUndone' | 'stepRedone' | 'stepBypass' | 'stepBypassOff' | 'stepBypassed' | 'stepUnbypassed' | 'stepMenuEarlier' | 'stepGoesBefore' | 'stepMenuOff' | 'stepRegionStart' | 'stepRegionEnd' | 'stepRegionPurpose' | 'stepRegionAdded' | 'stepRegionImported' | 'stepRegionCleared' | 'stepRegionClear' | 'stepRegionOrder' | 'stepRegionThere' | 'stepInputHint' | 'stepNeedAbove' | 'stepNeedInteger' | 'stepRegion' | 'stepAll' | 'stepMetrics' | 'stepAverage' | 'stepSettings' | 'stepApply' | 'compareNotEntry' | 'stepNeedBelow' | 'stepNeedPow2' | 'hintStepChip' | 'stepRecipeName' | 'hintSpectrogramGroup' | 'stepNeedValue' | 'hintSpectrogram' | 'stepFrameHint' | 'hintRegionMark' | 'stepOpen' | 'stepClose' | 'stepOutsideHeading' | 'stepOctave' | 'stepHoldHint' | 'stepHintNoHold' | 'stepAdd' | 'entryColLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepNeedFrame' | 'stepFailedOn' | 'stepTapHint' | 'stepNoSettings' | 'stepAuto' | 'stepNone' | 'stepMore' | 'stepRemove' | 'stepMenuTitle' | 'stepMenuFilter' | 'stepOffFrame' | 'stepOffRequired' | 'stepOffRefuses' | 'stepOffUnavailable' | 'stepDefaultsOnly' | 'stepAdded' | 'stepRemoved' | 'btnStage' | 'stepInputFiles' | 'stepInput' | 'uiLocale' | 'stepGroupFilter' | 'stepGroupPrepare' | 'stepGroupTime' | 'stepGroupFrequency' | 'stepGroupOther' | 'stepDragHint' | 'stepMoved' | 'stepRemoveChip' | 'stepHighpass' | 'stepLowpass' | 'stepBandpass' | 'stepAverageFft' | 'stepNeedChannels' | 'stepNeedChannelsRemove' | 'stepNarrowedChannels' | 'stepPairSelf' | 'stepNeedChannel' | 'stepOffChannels' | 'stepPair' | 'stepPairOutput' | 'stepPairInput' | 'stepTrigger' | 'stepTriggerChannel' | 'stepReference' | 'stepReferenceChannel' | 'stepReferenceSlot' | 'stepReferenceSet' | 'stagePairBase' | 'stepOffRate' | 'stepNeedRate' | 'stepPresetButton' | 'stepPresetEdited' | 'stepPresetCustom' | 'stepPresetMenu' | 'stepPresetApplied' | 'presetSpectrumName' | 'presetSpectrumGraph' | 'presetOctaveName' | 'presetOctaveGraph' | 'presetSpectrogramName' | 'presetSpectrogramGraph' | 'presetLevelName' | 'presetLevelGraph' | 'presetLoudnessName' | 'presetLoudnessGraph' | 'presetRoughnessName' | 'presetRoughnessGraph' | 'stageEventsBack'>;

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
    /**
     * Reads the largest peak of the compared channels over the region, in their unit, from every sample
     * (regionPeak.ts): a new trigger fires at half of it. Absent where nothing is compared (the entry table).
     *
     * It is a function, not a value, because calling it asks the backend for the samples. The bar calls it only when
     * a trigger can be added (the ＋ menu opens offering one, or one is added): never on a repaint.
     */
    peak?: () => RegionPeak | undefined;
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

/**
 * What a new step starts with from the files, over its `initial` values: fix_length their length (s), a trigger half
 * the tracks' peak (to two figures), so it fires on the loud events of what is shown whatever the unit.
 *
 * The peak counts only once it is read from every sample ('ready'). While it is pending or its read failed there is
 * no number to start from: the step keeps its own `initial` value, and the bar says so (stepBar.ts, stepPeakUnread).
 * The same when the peak is not read because too many recordings would have to be (stepPeakTooMany).
 */
export function startValues(operation: string, state: { peak?: RegionPeak }, lengthS?: number): Record<string, number> {
    if (operation === 'wandas.audio.fix_length' && lengthS) return { duration: Math.round(lengthS * 1000) / 1000 };
    if (operation === TRIGGER && state.peak?.state === 'ready' && Number.isFinite(state.peak.value) && state.peak.value > 0) return { threshold: Number((state.peak.value / 2).toPrecision(2)) };
    return {};
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
 * do; null when the stage `shown` is not in it any more.
 * `referenced` are the editor's steps measured against the base slot, which a run Recipe no longer names.
 */
export function recipeWithout(recipe: RecipeDocument, id: string, shown: string, limits?: number | StepLimits, referenced: readonly string[] = slotReferenced(recipe)): RecipeDocument | null {
    const rest = withoutSteps(recipe, [id]);
    const without = runnableRecipe(referenced.length ? { ...rest, [REFERENCE_KEY]: [...referenced] } : rest, limits);
    const present = recipeNodes(without).some(node => node.id === shown);
    return present ? without : null;
}

/** The Frame a step passes on: its own, unless it is left out or bypassed. */
export const frameAfter = (step: RecipeStep): string => (step.invalid === undefined && !step.bypassed ? step.output : step.input);
/** Whether the bar shows a step as a chip: the region chip is there only while a region is set. */
export const shownStep = (step: RecipeStep, state: Pick<StepBarState, 'regionRange'>): boolean => step.operation !== TIME_SLICE || !!state.regionRange;
/** Whether a step can be removed, moved and bypassed as itself (the region chip cannot). */
export const removable = (step: RecipeStep): boolean => step.operation !== TIME_SLICE;

/** The chain laid out: the steps to its time signal, and the steps after it. */
export interface StepFlow { chain: RecipeStep[]; tail: RecipeStep[] }

/** The chain as the scan runs it: the steps to its time signal, then the steps after it (a row of their own). */
export function stepFlow(recipe: RecipeDocument, state: StepBarState): StepFlow {
    const limits = stepLimits(state);
    const steps = recipeSteps(recipe, limits);
    const signal = timeSignalStep(recipe, limits);
    const split = signal ? steps.findIndex(step => step.id === signal.id) + 1 : 0;
    return { chain: steps.slice(0, split), tail: steps.slice(split) };
}

/** The steps of the chain in the order they run. */
export function orderedSteps(flow: StepFlow): RecipeStep[] {
    return [...flow.chain, ...flow.tail];
}

/** The last step that runs (a region chip not shown included, so a step added at the end goes after it): ＋ at the end adds after it. */
export function lastRunningStep(recipe: RecipeDocument, state: StepBarState): RecipeStep | undefined {
    const steps = recipeSteps(recipe, stepLimits(state));
    return steps.filter(step => step.invalid === undefined && !step.bypassed).at(-1) ?? steps.at(-1);
}

/** The stage on screen: on the entry table the chain's end, on the comparison the step shown. */
export function currentStepId(recipe: RecipeDocument, state: StepBarState, mode: 'entry' | 'compare'): string | undefined {
    if (mode === 'entry') return lastRunningStep(recipe, state)?.id;
    return state.stage ?? lastRunningStep(recipe, state)?.id;
}

/**
 * A place in the chain before ＋'s: after which step (null: the input), the Frame there, its channels and sampling
 * rate (as far as known), and the chip that follows.
 */
export interface EarlierPlace { after: string | null; frame: string; channels?: number; sampleRate?: number; series?: string; next?: RecipeStep }

/** The places before ＋'s, nearest first. */
export function earlierPlaces(recipe: RecipeDocument, state: StepBarState, after: string | null): EarlierPlace[] {
    const limits = stepLimits(state);
    const steps = recipeSteps(recipe, limits);
    const at = after ? steps.findIndex(step => step.id === after) : -1;
    const places: EarlierPlace[] = [];
    for (let index = at - 1; index >= -1; index--) {
        const before = index >= 0 ? steps[index] : undefined;
        places.push({
            after: before ? before.id : null, frame: before ? frameAfter(before) : INPUT_FRAME,
            channels: before ? before.channels : limits.channels, sampleRate: before ? before.sampleRate : limits.sampleRate,
            ...(before && frameAfter(before) === before.output && before.series ? { series: before.series } : {}),
            next: steps.slice(index + 1).find(step => shownStep(step, state)),
        });
    }
    return places;
}
