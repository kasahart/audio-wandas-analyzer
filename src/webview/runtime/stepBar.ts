/**
 * The step bar: the scan Recipe as wandas runs it, a chain of wandas methods, the same on the entry table
 * and the comparison. "Steps", the input, then every step as a round chip joined by →, each with a dot in the
 * colour of the Frame it gives; the stage on screen is framed, the steps after it dimmed, the app's
 * 1/3-octave branch beside the chain's end. … adds what the app computes outside the Recipe. Pressing a chip
 * shows that step's Frame (the input chip, the files' waveforms); holding it shows what the step does; ⚙
 * opens its settings and Remove, the bypass button skips the step while keeping it in place, × removes it,
 * dragging moves it, ↶ ↷ (Ctrl+Z, Ctrl+Shift+Z) undo and redo. ＋ on every link and at the end adds an
 * operation of wandas' registry: those that take the Frame there first, then those that fit an earlier place
 * (added there), then the rest with why. On the comparison the region is a chip of its own, only while one is
 * set: 区間 in ＋'s menu sets it, its ⚙ changes it, its × gives the whole file back. A step that cannot run
 * (a value out of range, a Frame it cannot take, a failure on a file) is marked and left out of the scans.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { addableOperations, brokenStep, CROSS_CHANNEL, SELECT_PAIR, chainEnd, chainOutput, movedStep, recipeSteps, timeSignalStep, withParam, withStep, withoutSteps, withoutBypassed, withBypass, TIME_SLICE, type RecipeStep, type StepLimits, type StepParam } from '../../shared/recipe/recipeSteps';
import { OPERATION_GROUPS, operationGroup, operationHint, type OperationGroup } from '../../shared/recipe/operationGuide';
import { catalogOperation, INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { outsideRecipe, reportOctaveRecipe } from './compareReport';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';

export type StepBarStrings = Pick<UiStrings, 'stepAfterBroken' | 'stepOctaveBroken' | 'stepUndo' | 'stepRedo' | 'stepUndone' | 'stepRedone' | 'stepBypass' | 'stepBypassOff' | 'stepBypassed' | 'stepUnbypassed' | 'stepMenuEarlier' | 'stepGoesBefore' | 'stepMenuOff' | 'stepRegionStart' | 'stepRegionEnd' | 'stepRegionPurpose' | 'stepRegionAdded' | 'stepRegionCleared' | 'stepRegionClear' | 'stepRegionOrder' | 'stepRegionThere' | 'stepInputHint' | 'stepNeedAbove' | 'stepNeedInteger' | 'stepRegion' | 'stepAll' | 'stepMetrics' | 'stepAverage' | 'stepSettings' | 'stepApply' | 'compareNotEntry' | 'stepNeedBelow' | 'stepNeedPow2' | 'hintStepChip' | 'stepRecipeName' | 'hintSpectrogramGroup' | 'stepNeedValue' | 'hintSpectrogram' | 'stepFrameHint' | 'hintRegionMark' | 'stepOpen' | 'stepClose' | 'stepOutsideHeading' | 'stepOctave' | 'stepHoldHint' | 'stepHintNoHold' | 'stepAdd' | 'entryColLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepNeedFrame' | 'stepFailedOn' | 'stepTapHint' | 'stepNoSettings' | 'stepRemove' | 'stepMenuTitle' | 'stepMenuFilter' | 'stepOffFrame' | 'stepOffRequired' | 'stepOffRefuses' | 'stepOffUnavailable' | 'stepDefaultsOnly' | 'stepMenuTitle' | 'stepAdded' | 'stepRemoved' | 'btnStage' | 'stepInputFiles' | 'stepInput' | 'stepHintLocale' | 'stepGroupFilter' | 'stepGroupPrepare' | 'stepGroupTime' | 'stepGroupFrequency' | 'stepGroupOther' | 'stepDragHint' | 'stepMoved' | 'stepRemoveChip' | 'stepHighpass' | 'stepLowpass' | 'stepBandpass' | 'stepAverageFft' | 'stepOctaveHint' | 'stepNeedChannels' | 'stepPairSelf' | 'stepNeedChannel' | 'stepOffChannels' | 'stepPair' | 'stepPairOutput' | 'stepPairInput'>;

/** A press shorter than this is a tap (see the step's Frame); longer is a hold (what the step does) until release. */
export const STEP_TAP_MS = 250;
/** The app's 1/3-octave branch: not a Recipe node, computed beside the chain's end (reportOctaveRecipe). */
export const OCTAVE_BRANCH = 'node-noct';
/** The input as a stage: the files' waveforms as they come in (scan_service.py's INPUT_STAGE). */
export const INPUT_STAGE = 'node-input';
/** A region of the files, in seconds. */
export interface RegionRange { start: number; end: number }
const SPECTRAL_ENDS = ['SpectralFrame', 'NOctFrame'];

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

export interface StepBar {
    element: HTMLElement;
    set(state: StepBarState): void;
    /** Closes an open settings form or menu; true when there was one, so Esc stops there. */
    close(): boolean;
}

/** The limits a Recipe's steps are checked against: the folder's, and the steps that failed on a file. */
export function stepLimits(state: Pick<StepBarState, 'sampleRate' | 'shortestSamples' | 'failed' | 'channels'>): StepLimits {
    return { sampleRate: state.sampleRate, shortestSamples: state.shortestSamples, ...(state.channels ? { channels: state.channels } : {}), ...(state.failed ? { failed: state.failed } : {}) };
}

/** The Recipe the scans run: the bar's Recipe without the steps that cannot run. */
export function runnableRecipe(recipe: RecipeDocument, limits?: number | StepLimits): RecipeDocument {
    const run = withoutBypassed(recipe);
    return withoutSteps(run, recipeSteps(run, limits).filter(step => step.invalid !== undefined).map(step => step.id));
}

/** Whether the chain ends in a spectrum or band levels, so the app's 1/3-octave columns and branch apply. */
export function endsInSpectrum(recipe: RecipeDocument, limits?: number | StepLimits): boolean {
    return SPECTRAL_ENDS.includes(chainOutput(recipe, limits));
}

/**
 * What holding step `id` runs: the Recipe without it and the later steps that then cannot run, as the scans
 * do; null when the stage `shown` is not in it any more (the 1/3-octave branch is, while it ends in a spectrum).
 */
export function recipeWithout(recipe: RecipeDocument, id: string, shown: string, limits?: number | StepLimits): RecipeDocument | null {
    const without = runnableRecipe(withoutSteps(recipe, [id]), limits);
    const present = shown === OCTAVE_BRANCH ? endsInSpectrum(without, limits) : (without as unknown as { nodes: Array<{ id: string }> }).nodes.some(node => node.id === shown);
    return present ? without : null;
}

/**
 * The one-line reason a step cannot run, shown in the footer while the field or chip has focus or the pointer.
 * Steps are named by their chips' labels; `steps` names the step a later one cannot run after.
 */
export function invalidReason(step: RecipeStep, strings: StepBarStrings, steps: readonly RecipeStep[] = []): string {
    if (step.id === OCTAVE_BRANCH && step.invalid !== undefined) return strings.stepOctaveBroken;
    if (!step.reason) return '';
    const limit = Number.isFinite(step.reason.limit) ? String(Math.round(step.reason.limit * 1000) / 1000) : '∞';
    // A channel is shown from 1: one below `limit` (wandas' index from 0) is the last channel there is.
    if (step.reason.kind === 'below' && step.editable.some(param => param.kind === 'int' && param.channel && param.name === step.invalid)) {
        return strings.stepNeedChannel.replace('{n}', limit);
    }
    switch (step.reason.kind) {
        case 'channels': return strings.stepNeedChannels;
        case 'pair': return strings.stepPairSelf;
        case 'pow2': return strings.stepNeedPow2.replace('{max}', limit);
        case 'above': return strings.stepNeedAbove.replace('{min}', limit);
        case 'integer': return strings.stepNeedInteger;
        case 'frame': return strings.stepNeedFrame.replace('{op}', stepChipLabel(step, strings)).replace('{frame}', step.reason.text ?? '');
        case 'after': { const before = steps.find(item => item.id === step.reason!.text); return strings.stepAfterBroken.replace('{op}', before ? stepChipLabel(before, strings) : step.reason.text ?? ''); }
        case 'failed': return strings.stepFailedOn.replace('{reason}', step.reason.text ?? '');
        default: return strings.stepNeedBelow.replace('{max}', limit);
    }
}

const formatNumber = (value: unknown): string => (typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value ?? ''));

/** A wandas channel index (from 0) as the bar shows it, from 1. */
const channelText = (value: unknown): string => (typeof value === 'number' ? String(value + 1) : '?');
/** A channel parameter's value as typed (from 1), back to wandas' index (from 0). */
const fromShown = (param: StepParam, value: number): number => (param.kind === 'int' && param.channel ? value - 1 : value);

const hzText = (value: unknown): string => (typeof value === 'number' ? (value >= 1000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`) : '');
const bandRange = (p: Record<string, unknown>): string => (p['fmin'] !== undefined ? `${hzText(p['fmin'])}–${hzText(p['fmax'])}` : '');

function stepLabel(step: RecipeStep, strings: StepBarStrings, state: StepBarState, expanded: boolean): string {
    const p = step.params;
    switch (step.name) {
        case 'highpass_filter': return `${strings.stepHighpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'lowpass_filter': return `${strings.stepLowpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'bandpass_filter': return `${strings.stepBandpass} ${formatNumber(p['low_cutoff'])}–${formatNumber(p['high_cutoff'])} Hz`;
        case 'time_slice': return `${strings.stepRegion} ${state.regionRange ? `${state.regionRange.start.toFixed(2)}–${state.regionRange.end.toFixed(2)} s` : state.region ?? strings.stepAll}`;
        case 'welch': return strings.stepAverageFft.replace('{name}', strings.stepAverage).replace('{n}', formatNumber(p['n_fft']));
        case 'stft': return `STFT ${formatNumber(p['n_fft'])}`;
        case 'resampling': return `→ ${hzText(p['target_sr'])}`;
        case 'select_pair': return strings.stepPair.replace('{output}', channelText(p['output'])).replace('{input}', channelText(p['input']));
        case 'noct_spectrum': {
            const octave = p['n'] !== undefined && p['n'] !== 3 ? `1/${formatNumber(p['n'])} oct` : strings.stepOctave;
            return expanded && bandRange(p) ? `${octave} ${bandRange(p)}` : octave;
        }
        default: return step.name;
    }
}

/** A step's chip label, as the bar names it (the comparison's headline names bypassed steps by it too). */
export function stepChipLabel(step: RecipeStep, strings: StepBarStrings, regionRange?: RegionRange | null): string {
    return stepLabel(step, strings, { recipe: null, regionRange }, false);
}

export function createStepBar(deps: {
    document: Document;
    strings: UiStrings;
    mode: 'entry' | 'compare';
    /** A new Recipe from the settings, ＋ or Remove; the caller scans with `runnableRecipe(recipe)`. */
    onChange(recipe: RecipeDocument): void;
    /** A chip's body pressed (a tap): show that step's Frame. */
    onStepSelect?(step: RecipeStep): void;
    /** A step just added or moved: the comparison shows its result. */
    onStepShown?(stepId: string): void;
    /**
     * A chip's body held: show what that step does (the result without it, its output); null on release.
     * Which steps a hold shows something for is `canHold`; holding any other is a tap.
     */
    onStepHold?(step: RecipeStep | null): void;
    /** Whether holding this step shows something on this screen now. */
    canHold?(step: RecipeStep): boolean;
    /** A click on the region chip's ↺ (comparison only): back to the entry table's region. */
    onRegion?(): void;
    /** Comparison only: the region set, changed or removed (null) from the bar. */
    onRegionSet?(region: RegionRange | null): void;
    /** Comparison only: the input chip pressed, to show the files' waveforms. */
    onInputSelect?(): void;
}): StepBar {
    const { document, strings } = deps;
    const element = document.createElement('nav');
    element.className = 'step-bar';
    element.setAttribute('data-step-bar', deps.mode);
    let state: StepBarState = { recipe: null };
    let expanded = false;
    let open: string | null = null;
    /** ＋'s menu: after which step (null: before the first), the Frame there, and the typed filter. */
    let menu: { after: string | null; frame: string; filter: string } | null = null;
    const limits = (): StepLimits => stepLimits(state);
    /** The optional packages the runtime cannot import, where its host says (the Web version). */
    const lacks = (): ReadonlySet<string> => new Set((document.defaultView as unknown as { __AWA_RUNTIME_LACKS__?: readonly string[] } | null)?.__AWA_RUNTIME_LACKS__ ?? []);
    const footer = (text: string): void => { document.getElementById('hint-footer')?.replaceChildren(text); };

    /** Icons drawn in the text colour of the chip they sit in. */
    const ICON = {
        slider: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3h10M1 9h10"/><circle cx="4" cy="3" r="1.6"/><circle cx="8" cy="9" r="1.6"/></svg>',
        open: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 5l3 3 3-3"/></svg>',
        invalid: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v5M6 9.5v.5"/></svg>',
        // An effect pedal's bypass: the signal's path arcs over the block.
        bypass: '<svg class="step-icon step-bypass-icon" viewBox="0 0 16 14" aria-hidden="true"><rect x="5.5" y="8" width="5" height="4.5" rx=".8"/><path d="M2 12V6Q2 3 5 3H11Q14 3 14 6V12"/><path d="M12 10l2 2 2-2"/></svg>',
    };
    /** The Frame a step passes on: its own, unless it is left out or bypassed. */
    const frameAfter = (step: RecipeStep): string => (step.invalid === undefined && !step.bypassed ? step.output : step.input);
    const regionText = (range: RegionRange): string => `${range.start.toFixed(2)}–${range.end.toFixed(2)} s`;
    /** The region chip is there only while a region is set. */
    const shownStep = (step: RecipeStep): boolean => step.operation !== TIME_SLICE || !!state.regionRange;

    // ---- undo / redo: every edit from the bar keeps what was there before (the Recipe and the region).
    type Snapshot = { recipe: RecipeDocument; region: RegionRange | null };
    const past: Snapshot[] = [], future: Snapshot[] = [];
    const now = (): Snapshot | null => (state.recipe ? { recipe: state.recipe, region: state.regionRange ?? null } : null);
    function applySnapshot(next: Snapshot): void {
        const recipeChanged = JSON.stringify(next.recipe) !== JSON.stringify(state.recipe);
        const regionChanged = JSON.stringify(next.region) !== JSON.stringify(state.regionRange ?? null);
        // Taken at once, so the bar draws the edit even before the screen hands the new state back.
        state = { ...state, recipe: next.recipe, regionRange: next.region };
        menu = null;
        if (recipeChanged) deps.onChange(next.recipe);
        if (regionChanged) deps.onRegionSet?.(next.region);
        render();
    }
    function emit(recipe: RecipeDocument, region: RegionRange | null = state.regionRange ?? null): void {
        const here = now();
        if (here) { past.push(here); if (past.length > 50) past.shift(); future.length = 0; }
        applySnapshot({ recipe, region });
    }
    function travel(from: Snapshot[], to: Snapshot[], said: string): void {
        const target = from.pop();
        const here = now();
        if (!target || !here) return;
        to.push(here);
        open = null;
        applySnapshot(target);
        footer(said);
    }
    const undo = (): void => travel(past, future, strings.stepUndone);
    const redo = (): void => travel(future, past, strings.stepRedone);
    /**
     * The chain as the scan runs it: the steps to its time signal, then the steps after it (a row of their
     * own) and, when the chain ends in a spectrum or band levels, the app's 1/3-octave branch beside them.
     */
    function flow(): { chain: RecipeStep[]; tail: RecipeStep[]; octave?: RecipeStep } {
        const steps = recipeSteps(state.recipe!, limits());
        const signal = timeSignalStep(state.recipe!, limits());
        const split = signal ? steps.findIndex(step => step.id === signal.id) + 1 : 0;
        // A broken chain that would end in a spectrum keeps its branch, which cannot run either.
        const broken = brokenStep(state.recipe!, limits());
        if (broken && SPECTRAL_ENDS.includes(chainEnd(state.recipe!, limits()))) {
            const octave: RecipeStep = { id: OCTAVE_BRANCH, operation: 'wandas.audio.noct_spectrum', name: 'noct_spectrum', params: {}, editable: [], input: INPUT_FRAME, output: 'NOctFrame', invalid: '', reason: { kind: 'after', limit: 0, text: broken.id } };
            return { chain: steps.slice(0, split), tail: steps.slice(split), octave };
        }
        if (!endsInSpectrum(state.recipe!, limits())) return { chain: steps.slice(0, split), tail: steps.slice(split) };
        const found = state.sampleRate ? recipeSteps(reportOctaveRecipe(state.recipe!, null, undefined, state.sampleRate)).find(step => step.name === 'noct_spectrum') : undefined;
        // Bands the file cannot give (or no file yet to tell): no branch, rather than a chip that draws nothing.
        if (!found) return { chain: steps.slice(0, split), tail: steps.slice(split) };
        // The branch is the app's, not a Recipe node: nothing on it to set or remove.
        const octave: RecipeStep = { id: OCTAVE_BRANCH, operation: 'wandas.audio.noct_spectrum', name: 'noct_spectrum', params: found?.params ?? {}, editable: [], input: INPUT_FRAME, output: 'NOctFrame' };
        return { chain: steps.slice(0, split), tail: steps.slice(split), octave };
    }
    const all = (): RecipeStep[] => { const { chain, tail, octave } = flow(); return [...chain, ...tail, ...(octave ? [octave] : [])]; };
    /** The last step that runs (a region chip not shown included, so a step added at the end goes after it): ＋ at the end adds after it. */
    function end(): RecipeStep | undefined {
        const steps = recipeSteps(state.recipe!, limits());
        return steps.filter(step => step.invalid === undefined && !step.bypassed).at(-1) ?? steps.at(-1);
    }
    /** The stage on screen: on the entry table the 1/3-octave levels (or the chain's end), on the comparison the step shown. */
    function currentId(): string | undefined {
        const { octave } = flow();
        if (deps.mode === 'entry') return octave?.id ?? end()?.id;
        return state.stage ?? end()?.id;
    }
    const removable = (step: RecipeStep): boolean => step.id !== OCTAVE_BRANCH && step.operation !== TIME_SLICE;
    /** The steps of the chain in the order they run, then the app's 1/3-octave branch. */
    function ordered(): RecipeStep[] {
        const { chain, tail, octave } = flow();
        return [...chain, ...tail, ...(octave ? [octave] : [])];
    }
    /**
     * One step: a round chip with a dot in its Frame's colour. Its body is pressed to see the step's Frame and
     * held to see what the step does; ⚙ (shown on the chip on screen) opens its settings and Remove; × (on
     * hover) removes it; the chip is dragged to move it. On the comparison a region other than the entry table's has ↺.
     */
    function chipHtml(step: RecipeStep): string {
        const comparison = deps.mode === 'compare';
        const region = step.operation === TIME_SLICE && !!deps.onRegionSet;
        const differs = comparison && step.operation === TIME_SLICE && !!state.regionDiffers;
        const what = strings.stepFrameHint.replace('{op}', step.name).replace('{frame}', step.output);
        const label = escapeHtml(stepLabel(step, strings, state, expanded));
        const current = currentId();
        const order = ordered();
        const classes = ['step-chip'];
        if (step.id === current) classes.push('is-current');
        // The steps after the one on screen are dimmed; the app's branch stands beside the chain, not after it.
        else if (step.id !== OCTAVE_BRANCH && current !== OCTAVE_BRANCH && order.findIndex(item => item.id === step.id) > order.findIndex(item => item.id === current)) classes.push('is-after');
        if (step.invalid !== undefined) classes.push('is-invalid');
        if (step.bypassed) classes.push('is-bypassed');
        if (open === step.id) classes.push('is-open');
        if (differs) classes.push('is-differs');
        const movable = removable(step);
        // The app's 1/3-octave branch is where the table's band column comes from.
        const why = step.invalid !== undefined ? invalidReason(step, strings, recipeSteps(state.recipe!, limits())) : step.id === OCTAVE_BRANCH ? `${strings.stepOctaveHint} · ${strings.stepTapHint}` : strings.stepTapHint;
        const dot = `<span class="step-dot" data-kind="${escapeHtml(step.invalid === undefined ? step.output : '')}" aria-hidden="true"></span>`;
        const body = `<button type="button" class="step-body" data-step-hold="${escapeHtml(step.id)}" ${hintAttr(`${why} — ${what}${movable ? ` · ${strings.stepDragHint}` : ''}`)}>${dot}${label}</button>`;
        const gearIcon = step.invalid !== undefined ? ICON.invalid : open === step.id ? ICON.open : ICON.slider;
        const gear = removable(step) || region
            ? `<button type="button" class="step-gear" data-action="step-settings" data-step="${escapeHtml(step.id)}" aria-label="${escapeHtml(strings.stepSettings)}" ${hintAttr(step.invalid !== undefined ? why : strings.stepSettings)}>${gearIcon}</button>` : '';
        const reset = differs ? `<button type="button" class="step-reset" data-step-region ${hintAttr(strings.hintRegionMark)}>↺</button>` : '';
        const cross = removable(step) ? `<button type="button" class="step-x" data-action="step-delete" data-step="${escapeHtml(step.id)}" aria-label="${escapeHtml(strings.stepRemoveChip)}" ${hintAttr(strings.stepRemoveChip)}></button>`
            : region ? `<button type="button" class="step-x" data-action="step-region-clear" aria-label="${escapeHtml(strings.stepRegionClear)}" ${hintAttr(strings.stepRegionClear)}></button>` : '';
        // Bypass sits beside ×: the step stays where it is but the chain runs without it.
        const bypassHint = step.bypassed ? strings.stepBypassOff : strings.stepBypass;
        const bypass = step.id !== OCTAVE_BRANCH && (removable(step) || region)
            ? `<button type="button" class="step-bypass" data-action="step-bypass" data-step="${escapeHtml(step.id)}" aria-pressed="${!!step.bypassed}" aria-label="${escapeHtml(bypassHint)}" ${hintAttr(bypassHint)}>${ICON.bypass}</button>` : '';
        return `<span class="${classes.join(' ')}" data-step-id="${escapeHtml(step.id)}"${movable ? ' draggable="true"' : ''}>${body}${gear}${reset}${bypass}${cross}</span>`;
    }
    function outsideTagsHtml(): string {
        const welch = recipeSteps(state.recipe!).find(step => step.name === 'welch');
        return outsideRecipe(strings, welch?.params).map(item => `<span class="awa-tag" ${hintAttr(item.text)}>${escapeHtml(item.tag)}</span>`).join('');
    }
    const addHtml = (after: RecipeStep | undefined, action: 'step-add' | 'step-insert' = 'step-add'): string => `<button type="button" class="step-add" ${action === 'step-add' ? 'data-action="step-add"' : 'data-action="step-insert"'} data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(action === 'step-add' ? strings.stepAdd : strings.stepMenuTitle)}" aria-expanded="${!!menu && menu.after === (after?.id ?? null)}" ${hintAttr(strings.stepMenuTitle.replace('{frame}', after ? (after.invalid === undefined ? after.output : after.input) : INPUT_FRAME))}>＋</button>`;
    function chipsHtml(): string {
        if (!state.recipe) return '';
        const { chain, tail, octave } = flow();
        const version = state.specVersion !== undefined ? ` (${strings.stepMetrics} v${state.specVersion})` : '';
        const toggle = `<button type="button" class="step-more" data-action="step-expand" aria-expanded="${expanded}" ${hintAttr(expanded ? strings.stepClose : strings.stepOpen)}>${expanded ? '‹' : '…'}</button>`;
        const name = `<span class="step-label step-name" ${hintAttr(strings.stepRecipeName)}>${escapeHtml(strings.btnStage)}</span>`;
        const current = currentId();
        const inputText = `<span class="step-dot" data-kind="${INPUT_FRAME}" aria-hidden="true"></span>${escapeHtml(state.files ? strings.stepInputFiles.replace('{n}', String(state.files)) : strings.stepInput)}`;
        // On the comparison the input is a chip too: pressed, it shows the files as they come in.
        const input = deps.onInputSelect
            ? `<span class="step-chip step-input${current === INPUT_STAGE ? ' is-current' : ''}" data-step-input data-step-id="${INPUT_STAGE}"><button type="button" class="step-body" data-step-hold="${INPUT_STAGE}" ${hintAttr(strings.stepInputHint)}>${inputText}</button></span>`
            : `<span class="step-input" data-step-input>${inputText}</span>`;
        const steps = [...chain, ...tail].filter(shownStep);
        const last = end();
        // Between two chips: → and ＋ to add a step there.
        const link = (after: RecipeStep | null): string => `<span class="step-link"><span class="step-arrow" aria-hidden="true">→</span>`
            + `<button type="button" class="step-insert" data-action="step-insert" data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(strings.stepMenuTitle)}" ${hintAttr(strings.stepMenuTitle)}>＋</button></span>`;
        const node = (step: RecipeStep): string => chipHtml(step);
        const history = `<span class="step-history">`
            + `<button type="button" class="step-undo" data-action="step-undo" aria-label="${escapeHtml(strings.stepUndo)}" ${hintAttr(strings.stepUndo)}${past.length ? '' : ' disabled'}>↶</button>`
            + `<button type="button" class="step-redo" data-action="step-redo" aria-label="${escapeHtml(strings.stepRedo)}" ${hintAttr(strings.stepRedo)}${future.length ? '' : ' disabled'}>↷</button></span>`;
        const parts: string[] = [history, name, input];
        // A link adds right before the chip after it, behind a region chip that is not shown too.
        const full = [...chain, ...tail];
        steps.forEach(step => { const at = full.findIndex(item => item.id === step.id); parts.push(link(at > 0 ? full[at - 1] : null), node(step)); });
        parts.push('<span class="step-arrow" aria-hidden="true">→</span>', addHtml(last));
        // The app's 1/3-octave branch is not the chain's next step: it stands apart at the bar's end.
        const branch = octave ? `<span class="step-branch">${node(octave)}</span>` : '';
        const row = `<div class="step-row">${parts.join('')}<span class="step-gap"></span>${branch}${toggle}</div>`;
        return expanded ? row + `<div class="step-row step-outside-row"><span class="step-outside-heading">${escapeHtml(strings.stepOutsideHeading)}${escapeHtml(version)}</span>${outsideTagsHtml()}</div>` : row;
    }
    function formHtml(step: RecipeStep): string {
        // The region chip's form: where the region starts and ends; Remove gives the whole file back.
        if (step.operation === TIME_SLICE) {
            const range = state.regionRange ?? { start: 0, end: 1 };
            const field = (name: 'start' | 'end', label: string, value: number): string => `<label class="step-field">${escapeHtml(label)} <input type="number" data-step-region-param="${name}" value="${value.toFixed(2)}" step="0.01" min="0"></label>`;
            return `<div class="step-form" role="dialog" aria-label="${escapeHtml(strings.stepRegion)}" data-step-form="${escapeHtml(step.id)}" data-step-form-region><div class="step-form-title">${escapeHtml(strings.stepRegion)}</div>`
                + field('start', strings.stepRegionStart, range.start) + field('end', strings.stepRegionEnd, range.end)
                + `<div class="step-form-bar"><button type="button" data-action="step-region-clear">${escapeHtml(strings.stepRemove)}</button><button type="button" class="entry-primary" data-action="step-apply">${escapeHtml(strings.stepApply)}</button></div></div>`;
        }
        const field = (param: StepParam): string => {
            const value = step.params[param.name];
            const input = param.kind === 'enum'
                ? `<select data-step-param="${param.name}">${param.options.map(option => `<option${option === value ? ' selected' : ''}>${option}</option>`).join('')}</select>`
                : `<input type="number" data-step-param="${param.name}" value="${escapeHtml(param.kind === 'int' && param.channel ? channelText(value) : formatNumber(value))}" step="${param.kind === 'int' ? 1 : 'any'}"${param.kind === 'int' && param.channel ? ' min="1"' : ''}>`;
            const bad = step.invalid === param.name;
            const name = param.kind === 'int' && param.channel ? (param.channel === 'output' ? strings.stepPairOutput : strings.stepPairInput) : param.name;
            return `<label class="step-field${bad ? ' is-invalid' : ''}"${bad ? ` ${hintAttr(invalidReason(step, strings))}` : ''}>${escapeHtml(name)} ${input}${param.kind === 'float' && param.unit ? ` ${param.unit}` : ''}</label>`;
        };
        const title = `<div class="step-form-title">${escapeHtml(step.name)}</div>`;
        // A step left out for a reason other than one of its values says why at the top.
        const why = step.invalid === '' ? `<div class="step-form-why">${escapeHtml(invalidReason(step, strings, state.recipe ? recipeSteps(state.recipe, limits()) : []))}</div>` : '';
        const fields = step.editable.length ? step.editable.map(field).join('') : `<div class="step-form-note">${escapeHtml(strings.stepNoSettings)}</div>`;
        const apply = step.editable.length ? `<button type="button" class="entry-primary" data-action="step-apply"${step.invalid ? ' disabled' : ''}>${escapeHtml(strings.stepApply)}</button>` : '';
        const remove = removable(step) ? `<button type="button" data-action="step-remove" data-step="${escapeHtml(step.id)}">${escapeHtml(strings.stepRemove)}</button>` : '';
        return `<div class="step-form" role="dialog" aria-label="${escapeHtml(step.name)}" data-step-form="${escapeHtml(step.id)}">${title}${why}${fields}<div class="step-form-bar">${remove}${apply}</div></div>`;
    }
    /** The places before ＋'s, nearest first: after which step (null: the input), the Frame there, and the chip that follows. */
    function earlierPlaces(after: string | null): Array<{ after: string | null; frame: string; next?: RecipeStep }> {
        const steps = recipeSteps(state.recipe!, limits());
        const at = after ? steps.findIndex(step => step.id === after) : -1;
        const places: Array<{ after: string | null; frame: string; next?: RecipeStep }> = [];
        for (let index = at - 1; index >= -1; index--) {
            places.push({ after: index >= 0 ? steps[index].id : null, frame: index >= 0 ? frameAfter(steps[index]) : INPUT_FRAME, next: steps.slice(index + 1).find(shownStep) });
        }
        return places;
    }
    /**
     * ＋'s menu: the operations that take the Frame here, by what they do; then those that cannot but fit an
     * earlier place, which go there ("goes in before …"); then the rest, greyed, with why.
     */
    function menuHtml(): string {
        if (!menu || !state.recipe) return '';
        const needle = menu.filter.trim().toLowerCase();
        const locale = strings.stepHintLocale;
        const matches = (name: string, id: string, extra = ''): boolean => !needle || name.toLowerCase().includes(needle) || operationHint(id, locale).toLowerCase().includes(needle) || extra.toLowerCase().includes(needle);
        const byFrame = new Map<string, ReturnType<typeof addableOperations>>();
        const placed = menu.after ? recipeSteps(state.recipe, limits()).find(step => step.id === menu!.after) : undefined;
        const channels = placed ? placed.channels : limits().channels;
        const at = (frame: string): ReturnType<typeof addableOperations> => { if (!byFrame.has(frame)) byFrame.set(frame, addableOperations(frame, lacks(), channels)); return byFrame.get(frame)!; };
        const places = earlierPlaces(menu.after);
        type Entry = ReturnType<typeof addableOperations>[number];
        const here: Entry[] = [], earlier: Array<{ entry: Entry; after: string | null; next?: RecipeStep }> = [], off: Entry[] = [];
        for (const entry of at(menu.frame)) {
            if (!matches(entry.name, entry.operation.id)) continue;
            if (!entry.off) { here.push(entry); continue; }
            const place = entry.off === 'frame' ? places.find(item => !at(item.frame).find(other => other.operation.id === entry.operation.id)?.off) : undefined;
            if (place) earlier.push({ entry: at(place.frame).find(other => other.operation.id === entry.operation.id)!, after: place.after, next: place.next });
            else off.push(entry);
        }
        const item = (entry: Entry, after?: { after: string | null; next?: RecipeStep }): string => {
            const output = entry.operation.output === '*' ? menu!.frame : entry.operation.output;
            const why = entry.off === 'frame' ? strings.stepOffFrame.replace('{frame}', menu!.frame)
                : entry.off === 'refuses' ? strings.stepOffRefuses.replace('{frame}', menu!.frame).replace('{reason}', entry.why ?? '')
                : entry.off === 'channels' ? strings.stepOffChannels
                : entry.off === 'unavailable' ? strings.stepOffUnavailable.replace('{packages}', entry.why ?? '')
                : entry.off === 'required' ? strings.stepOffRequired.replace('{params}', entry.operation.params.filter(param => param.required).map(param => param.name).join(', ')) : '';
            const tag = !entry.off && !entry.settable ? `<span class="step-menu-tag">${escapeHtml(strings.stepDefaultsOnly)}</span>` : '';
            const hint = after ? strings.stepGoesBefore.replace('{step}', after.next ? stepLabel(after.next, strings, state, expanded) : '') : entry.off ? why : operationHint(entry.operation.id, locale);
            const place = after ? ` data-after="${escapeHtml(after.after ?? '')}"` : '';
            return `<button type="button" class="step-menu-item${entry.off ? ' is-off' : ''}${after ? ' is-earlier' : ''}" data-action="step-add-op" data-op="${escapeHtml(entry.operation.id)}"${place}${entry.off ? ` aria-disabled="true" ${hintAttr(why)}` : ` ${hintAttr(entry.operation.id)}`}>`
                + `<span class="step-menu-line"><span class="step-dot" data-kind="${escapeHtml(output)}" aria-hidden="true"></span><span class="step-menu-name">${escapeHtml(entry.name)}</span>${tag}</span>`
                + `<small class="step-menu-hint">${hint ? escapeHtml(hint) : ''}</small></button>`;
        };
        // The region (comparison only): one per chain, set from here while the whole file is compared.
        let regionHere = '', regionEarlier = '', regionOff = '';
        if (deps.onRegionSet && matches(strings.stepRegion, TIME_SLICE, `${strings.stepRegionPurpose} time_slice`)) {
            const button = (attrs: string, hint: string, classes = ''): string => `<button type="button" class="step-menu-item${classes}" data-action="step-add-op" data-op="${TIME_SLICE}"${attrs}>`
                + `<span class="step-menu-line"><span class="step-dot" data-kind="${INPUT_FRAME}" aria-hidden="true"></span><span class="step-menu-name">${escapeHtml(strings.stepRegion)}</span></span><small class="step-menu-hint">${escapeHtml(hint)}</small></button>`;
            const place = places.find(item => item.frame === INPUT_FRAME);
            if (state.regionRange) regionOff = button(` aria-disabled="true" ${hintAttr(strings.stepRegionThere)}`, strings.stepRegionThere, ' is-off');
            else if (menu.frame === INPUT_FRAME) regionHere = button(` ${hintAttr(strings.stepRegionPurpose)}`, strings.stepRegionPurpose);
            else if (place) regionEarlier = button(` data-after="${escapeHtml(place.after ?? '')}" ${hintAttr(strings.stepRegionPurpose)}`, strings.stepGoesBefore.replace('{step}', place.next ? stepLabel(place.next, strings, state, expanded) : ''), ' is-earlier');
        }
        const groupName: Record<OperationGroup, string> = { filter: strings.stepGroupFilter, prepare: strings.stepGroupPrepare, time: strings.stepGroupTime, frequency: strings.stepGroupFrequency, other: strings.stepGroupOther };
        const groups = OPERATION_GROUPS.map(group => ({ group, html: (group === 'prepare' ? regionHere : '') + here.filter(entry => operationGroup(entry.operation.id) === group).map(entry => item(entry)).join('') })).filter(group => group.html);
        const section = (key: string, title: string, html: string): string => (html ? `<div class="step-menu-group" data-group="${key}"><span class="step-menu-group-name">${escapeHtml(title)}</span>${html}</div>` : '');
        return `<div class="step-menu" role="dialog" aria-label="${escapeHtml(strings.stepAdd)}" data-step-menu>`
            + `<div class="step-menu-title">${escapeHtml(strings.stepMenuTitle.replace('{frame}', menu.frame))}</div>`
            + `<input type="search" data-step-menu-filter placeholder="${escapeHtml(strings.stepMenuFilter)}" value="${escapeHtml(menu.filter)}">`
            + `<div class="step-menu-list">${groups.map(({ group, html }) => section(group, groupName[group], html)).join('')}`
            + section('earlier', strings.stepMenuEarlier, regionEarlier + earlier.map(({ entry, after, next }) => item(entry, { after, next })).join(''))
            + section('off', strings.stepMenuOff, regionOff + off.map(entry => item(entry)).join(''))
            + `</div></div>`;
    }
    function render(): void {
        const steps = state.recipe ? recipeSteps(state.recipe, limits()) : [];
        const form = open ? steps.find(step => step.id === open) : undefined;
        element.innerHTML = chipsHtml() + (form ? formHtml(form) : '') + menuHtml();
        if (form) place(`[data-step-id="${CSS.escape(form.id)}"]`, '[data-step-form]');
        if (menu) place(`[data-after="${CSS.escape(menu.after ?? '')}"]`, '[data-step-menu]');
    }
    /** A form or menu opens under what opened it, not at the bar's start. */
    function place(anchorSelector: string, popupSelector: string): void {
        const anchor = element.querySelector<HTMLElement>(anchorSelector);
        const popup = element.querySelector<HTMLElement>(popupSelector);
        if (!anchor || !popup) return;
        const left = anchor.getBoundingClientRect().left - element.getBoundingClientRect().left;
        popup.style.left = `${Math.max(0, Math.min(left, element.clientWidth - popup.offsetWidth))}px`;
    }
    /** The Recipe the open form would give, to check it before Apply. */
    function draft(): RecipeDocument | null {
        const form = element.querySelector<HTMLElement>('[data-step-form]');
        if (!form || !state.recipe) return null;
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === form.getAttribute('data-step-form'));
        if (!step) return null;
        let next = state.recipe;
        for (const param of step.editable) {
            const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-step-param="${param.name}"]`);
            if (!input || input.value === '') continue;
            next = withParam(next, step.id, param, param.kind === 'enum' ? input.value : fromShown(param, Number(input.value)));
        }
        return next;
    }
    /** The files' length (s): a region must end within it. */
    const lengthOf = (): number | undefined => (state.shortestSamples && state.sampleRate ? state.shortestSamples / state.sampleRate : state.lengthS);
    /** The region the region chip's form would give, or null when it is not one (start < end, within the file). */
    function regionDraft(): RegionRange | null {
        const [start, end] = ['start', 'end'].map(name => element.querySelector<HTMLInputElement>(`[data-step-region-param="${name}"]`)?.value.trim() ?? '').map(text => (text === '' ? NaN : Math.round(Number(text) * 100) / 100));
        const length = lengthOf();
        return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && (length === undefined || end <= length) ? { start, end } : null;
    }
    /** Marks the field that the typed values break, with its reason, and keeps Apply off until it is fixed. */
    function checkForm(): void {
        const form = element.querySelector<HTMLElement>('[data-step-form]');
        if (form?.hasAttribute('data-step-form-region')) {
            const ok = !!regionDraft();
            form.querySelectorAll('.step-field').forEach(label => label.classList.toggle('is-invalid', !ok));
            form.querySelector<HTMLButtonElement>('[data-action="step-apply"]')!.disabled = !ok;
            if (!ok) footer(strings.stepRegionOrder);
            return;
        }
        const next = draft();
        const applyButton = form?.querySelector<HTMLButtonElement>('[data-action="step-apply"]');
        if (!form || !next || !applyButton) return;
        const step = recipeSteps(next, limits()).find(item => item.id === form.getAttribute('data-step-form'));
        const badParam = step?.invalid ? step.invalid : undefined;
        form.querySelectorAll<HTMLElement>('.step-field').forEach(label => {
            const name = label.querySelector('[data-step-param]')!.getAttribute('data-step-param');
            const bad = !!badParam && badParam === name;
            label.classList.toggle('is-invalid', bad);
            const text = bad ? invalidReason(step!, strings) : '';
            label.setAttribute('data-hint', text);
            label.querySelector('[data-step-param]')!.setAttribute('aria-description', text);
            if (bad) footer(text);
        });
        // An emptied field is not a value: Apply waits for one instead of quietly keeping the old.
        const empty = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]')).filter(input => input.value.trim() === '');
        empty.forEach(input => { input.closest('.step-field')?.classList.add('is-invalid'); });
        if (empty.length) footer(strings.stepNeedValue);
        applyButton.disabled = !!badParam || empty.length > 0;
    }
    function apply(): void {
        const form = element.querySelector<HTMLElement>('[data-step-form]');
        if (form?.hasAttribute('data-step-form-region')) {
            const range = regionDraft();
            if (!range || !state.recipe) { checkForm(); return; }
            const stepId = form.getAttribute('data-step-form')!;
            open = null;
            emit(state.recipe, range);
            element.querySelector<HTMLElement>(`[data-action="step-settings"][data-step="${CSS.escape(stepId)}"]`)?.focus();
            return;
        }
        const next = draft();
        if (!next || !form || !form.querySelector('[data-action="step-apply"]')) return;
        // Invalid values never leave the form: the Recipe the scans run stays valid.
        const blank = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]')).some(input => input.value.trim() === '');
        if (blank || recipeSteps(next, limits()).find(item => item.id === form.getAttribute('data-step-form'))?.invalid) { checkForm(); return; }
        const stepId = form.getAttribute('data-step-form')!;
        open = null;
        emit(next);
        // Focus goes back to the gear the form came from, so the next Esc stays in the bar instead of leaving the screen.
        element.querySelector<HTMLElement>(`[data-action="step-settings"][data-step="${CSS.escape(stepId)}"]`)?.focus();
    }
    function remove(stepId: string): void {
        if (!state.recipe) return;
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === stepId);
        if (!step || !removable(step)) return;
        open = null;
        // A cross-channel step takes the pair it was added with along.
        const pair = CROSS_CHANNEL.has(step.operation) ? pairAfter(stepId) : undefined;
        emit(withoutSteps(state.recipe, pair ? [stepId, pair] : [stepId]));
        footer(strings.stepRemoved.replace('{op}', step.name));
    }
    /** The select_pair step that reads `stepId`, if one does. */
    function pairAfter(stepId: string): string | undefined {
        const nodes = (state.recipe as unknown as { nodes?: Array<{ id: string; operation: string; inputs: string[] }> } | null)?.nodes ?? [];
        return nodes.find(node => node.operation === SELECT_PAIR && node.inputs[0] === stepId)?.id;
    }
    /** Bypass on or off: the step stays in place; the chain runs without it meanwhile. */
    function bypass(stepId: string): void {
        if (!state.recipe) return;
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === stepId);
        if (!step || step.id === OCTAVE_BRANCH || (!removable(step) && step.operation !== TIME_SLICE)) return;
        // A cross-channel step's pair goes with it: alone, it would have no pairs to pick from.
        const pair = CROSS_CHANNEL.has(step.operation) ? pairAfter(stepId) : undefined;
        const bypassed = withBypass(state.recipe, stepId, !step.bypassed);
        emit(pair ? withBypass(bypassed, pair, !step.bypassed) : bypassed);
        const name = stepLabel(step, strings, state, expanded);
        footer(step.bypassed ? strings.stepUnbypassed.replace('{op}', name) : strings.stepBypassed.replace('{op}', name));
        element.querySelector<HTMLElement>(`[data-action="step-bypass"][data-step="${CSS.escape(stepId)}"]`)?.focus();
    }
    /** The region chip set from ＋: the Recipe's time slice moved to `after`, a region in the middle of the files, its form open. */
    function addRegion(after: string | null): void {
        if (!state.recipe) return;
        const slice = recipeSteps(state.recipe, limits()).find(step => step.operation === TIME_SLICE);
        const operation = catalogOperation(TIME_SLICE);
        const placed = slice ? { recipe: movedStep(state.recipe, slice.id, after), id: slice.id } : operation ? withStep(state.recipe, after, operation) : null;
        if (!placed) return;
        const length = lengthOf() ?? 2;
        const range = { start: Math.round(length * 25) / 100, end: Math.round(length * 75) / 100 };
        menu = null;
        open = placed.id;
        emit(placed.recipe, range);
        deps.onStepShown?.(placed.id);
        footer(strings.stepRegionAdded);
        element.querySelector<HTMLElement>('[data-step-region-param]')?.focus();
    }
    function clearRegion(): void {
        if (!state.recipe || !state.regionRange) return;
        open = null;
        // A bypassed region goes with it: the next region starts in use.
        const slice = recipeSteps(state.recipe, limits()).find(step => step.operation === TIME_SLICE);
        emit(slice?.bypassed ? withBypass(state.recipe, slice.id, false) : state.recipe, null);
        footer(strings.stepRegionCleared);
    }
    /** Adds an operation from ＋'s menu: at ＋, or at the earlier place the menu named (`after`). */
    function add(operationId: string, placeAfter?: string | null): void {
        if (!menu || !state.recipe) return;
        const after = placeAfter === undefined ? menu.after : placeAfter;
        if (operationId === TIME_SLICE) { if (deps.onRegionSet && !state.regionRange) addRegion(after); return; }
        const operation = catalogOperation(operationId);
        if (!operation) return;
        const steps = recipeSteps(state.recipe, limits());
        const before = after ? steps.find(step => step.id === after) : undefined;
        const entry = addableOperations(before ? frameAfter(before) : INPUT_FRAME, lacks(), before ? before.channels : limits().channels).find(item => item.operation.id === operationId);
        // An operation that cannot go there says why instead of being added.
        if (!entry || entry.off) { footer(element.querySelector(`[data-op="${CSS.escape(operationId)}"]`)?.getAttribute('data-hint') ?? ''); return; }
        const length = state.lengthS ?? (state.shortestSamples && state.sampleRate ? state.shortestSamples / state.sampleRate : undefined);
        let { recipe, id } = withStep(state.recipe, after, operation, length ? { duration: Math.round(length * 1000) / 1000 } : {});
        // A cross-channel step compares one pair, named in the chain: ch2 over the reference ch1 to start with.
        const select = CROSS_CHANNEL.has(operationId) ? catalogOperation(SELECT_PAIR) : undefined;
        if (select) ({ recipe, id } = withStep(recipe, id, select));
        menu = null;
        emit(recipe);
        deps.onStepShown?.(id);
        footer(strings.stepAdded.replace('{op}', entry.name));
    }
    function openMenu(after: string | null): void {
        if (!state.recipe) return;
        const steps = recipeSteps(state.recipe, limits());
        const before = after ? steps.find(step => step.id === after) : undefined;
        const frame = before ? frameAfter(before) : INPUT_FRAME;
        menu = menu && menu.after === after ? null : { after, frame, filter: '' };
        open = null;
        render();
        element.querySelector<HTMLElement>('[data-step-menu-filter]')?.focus();
    }
    function close(): boolean {
        if (!open && !menu) return false;
        open = null;
        menu = null;
        render();
        return true;
    }

    // Tap or hold on a chip's body: a press shorter than STEP_TAP_MS shows the step's Frame (the click that
    // follows); a longer one shows what the step does until release, and its click is swallowed.
    const view = document.defaultView!;
    let pressing: { step: RecipeStep; timer: number } | null = null;
    let held: RecipeStep | null = null;
    let swallowClick = false;
    element.addEventListener('click', event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-step-hold], [data-step-region]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        if (target.hasAttribute('data-step-hold')) {
            if (swallowClick) { swallowClick = false; return; }
            if (target.getAttribute('data-step-hold') === INPUT_STAGE) { deps.onInputSelect?.(); return; }
            const step = state.recipe ? all().find(item => item.id === target.getAttribute('data-step-hold')) : undefined;
            if (step) deps.onStepSelect?.(step);
        }
        else if (action === 'step-expand') { expanded = !expanded; render(); }
        else if (action === 'step-settings') {
            open = open === target.getAttribute('data-step') ? null : target.getAttribute('data-step');
            menu = null;
            render();
            // The keyboard goes straight to the first field, or to Remove when there is none.
            element.querySelector<HTMLElement>('[data-step-param], [data-action="step-remove"]')?.focus();
        }
        else if (action === 'step-apply') apply();
        else if (action === 'step-remove' || action === 'step-delete') remove(target.getAttribute('data-step')!);
        else if (action === 'step-add' || action === 'step-insert') openMenu(target.getAttribute('data-after') || null);
        else if (action === 'step-add-op') add(target.getAttribute('data-op')!, target.hasAttribute('data-after') ? target.getAttribute('data-after') || null : undefined);
        else if (action === 'step-bypass') bypass(target.getAttribute('data-step')!);
        else if (action === 'step-region-clear') clearRegion();
        else if (action === 'step-undo') undo();
        else if (action === 'step-redo') redo();
        else if (target.hasAttribute('data-step-region')) deps.onRegion?.();
    });
    element.addEventListener('keydown', event => {
        const body = (event.target as HTMLElement).closest?.('[data-step-hold]');
        if (event.key === 'Escape' && (open || menu)) { event.stopPropagation(); close(); }
        // Esc on a chip only leaves the bar; the screen's own Esc needs focus outside it.
        else if (event.key === 'Escape') { event.stopPropagation(); (document.activeElement as HTMLElement | null)?.blur?.(); }
        else if (event.key === 'Enter' && open) { event.preventDefault(); event.stopPropagation(); apply(); }
        // The menu's filter: Enter adds the first operation that can go here.
        else if (event.key === 'Enter' && menu && (event.target as HTMLElement).matches('[data-step-menu-filter]')) {
            event.preventDefault();
            event.stopPropagation();
            const first = element.querySelector<HTMLElement>('.step-menu-item:not(.is-off)');
            if (first) add(first.getAttribute('data-op')!, first.hasAttribute('data-after') ? first.getAttribute('data-after') || null : undefined);
        }
        // Delete on a chip takes its step out, as Remove does.
        else if ((event.key === 'Delete' || event.key === 'Backspace') && body) { event.preventDefault(); event.stopPropagation(); remove(body.getAttribute('data-step-hold')!); }
        // M on a chip bypasses its step (or brings it back).
        else if ((event.key === 'm' || event.key === 'M') && body && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); bypass(body.getAttribute('data-step-hold')!); }
    });
    // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo and redo the bar's edits: with the focus in the bar, or nowhere in
    // particular while this bar is the one in front (the comparison's over the table's).
    document.addEventListener('keydown', event => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        const active = document.activeElement as HTMLElement | null;
        const inBar = !!active && element.contains(active);
        if (!inBar) {
            if (!element.isConnected || !element.getClientRects().length || (active && active !== document.body && active.closest('input, select, textarea, [contenteditable]'))) return;
            const front = document.querySelector<HTMLElement>('[data-step-bar="compare"]');
            if (deps.mode === 'entry' && front && front.getClientRects().length) return;
        } else if (active?.closest('input, select, textarea')) return;
        event.preventDefault();
        event.stopPropagation();
        if (key === 'y' || event.shiftKey) redo(); else undo();
    }, true);
    element.addEventListener('input', event => {
        if ((event.target as HTMLElement).matches('[data-step-menu-filter]') && menu) {
            menu.filter = (event.target as HTMLInputElement).value;
            const at = (event.target as HTMLInputElement).selectionStart;
            render();
            const filter = element.querySelector<HTMLInputElement>('[data-step-menu-filter]')!;
            filter.focus();
            filter.setSelectionRange(at, at);
            return;
        }
        checkForm();
    });
    element.addEventListener('change', event => { if (!(event.target as HTMLElement).matches('[data-step-menu-filter]')) checkForm(); });
    // A click anywhere else drops the draft and the menu, like Esc.
    document.addEventListener('pointerdown', event => { if ((open || menu) && !element.contains(event.target as Node)) close(); }, true);
    element.addEventListener('pointerdown', event => {
        const body = (event.target as HTMLElement).closest<HTMLElement>('[data-step-hold]');
        swallowClick = false;
        if (!body || !state.recipe || event.button !== 0) return;
        const step = all().find(item => item.id === body.getAttribute('data-step-hold'));
        if (!step || !(deps.canHold?.(step) ?? false)) return;
        pressing = {
            step,
            timer: view.setTimeout(() => {
                pressing = null;
                held = step;
                body.closest('.step-chip')?.classList.add('is-held');
                deps.onStepHold?.(step);
            }, STEP_TAP_MS),
        };
    });
    // A hold also ends when the pointer is lost or the window loses focus, so nothing stays held.
    for (const type of ['pointerup', 'pointercancel', 'blur']) view.addEventListener(type, () => {
        if (pressing) { view.clearTimeout(pressing.timer); pressing = null; }
        if (!held) return;
        held = null;
        swallowClick = type === 'pointerup';
        element.querySelector('.step-chip.is-held')?.classList.remove('is-held');
        deps.onStepHold?.(null);
    });
    // Dragging a chip moves its step: the mark shows where it lands (before or after the chip under the pointer).
    let dragged: string | null = null;
    let dropAfter: string | null | undefined;
    const dropMark = (): HTMLElement => {
        let mark = element.querySelector<HTMLElement>('.step-drop');
        if (!mark) { mark = document.createElement('span'); mark.className = 'step-drop'; element.append(mark); }
        return mark;
    };
    const clearDrop = (): void => { element.querySelector('.step-drop')?.remove(); dropAfter = undefined; };
    element.addEventListener('dragstart', event => {
        const chip = (event.target as HTMLElement).closest?.<HTMLElement>('.step-chip[draggable="true"]');
        if (!chip || !state.recipe) return;
        dragged = chip.getAttribute('data-step-id');
        event.dataTransfer?.setData('text/plain', dragged ?? '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        chip.classList.add('is-dragging');
    });
    element.addEventListener('dragover', event => {
        if (!dragged || !state.recipe) return;
        const target = (event.target as HTMLElement).closest?.<HTMLElement>('.step-chip, [data-step-input]');
        const steps = recipeSteps(state.recipe, limits());
        const id = target?.matches('[data-step-input]') ? null : target?.getAttribute('data-step-id');
        if (!target || id === OCTAVE_BRANCH) return;
        event.preventDefault();
        const box = target.getBoundingClientRect();
        const before = !!id && event.clientX < box.left + box.width / 2;
        const index = id ? steps.findIndex(step => step.id === id) : -1;
        dropAfter = !id ? null : before ? (index > 0 ? steps[index - 1].id : null) : id;
        const mark = dropMark();
        const bar = element.getBoundingClientRect();
        mark.style.left = `${(before ? box.left - 4 : box.right + 1) - bar.left}px`;
        mark.style.top = `${box.top - bar.top + 2}px`;
        mark.style.height = `${box.height - 4}px`;
    });
    element.addEventListener('dragleave', event => { if (!element.contains(event.relatedTarget as Node | null)) clearDrop(); });
    element.addEventListener('drop', event => {
        if (!dragged || dropAfter === undefined || !state.recipe) return;
        event.preventDefault();
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === dragged);
        const after = dropAfter;
        clearDrop();
        if (!step || after === dragged) return;
        const next = movedStep(state.recipe, dragged, after);
        dragged = null;
        emit(next);
        deps.onStepShown?.(step.id);
        footer(strings.stepMoved.replace('{op}', step.name));
    });
    element.addEventListener('dragend', () => { dragged = null; clearDrop(); element.querySelector('.is-dragging')?.classList.remove('is-dragging'); });
    return {
        element,
        set(next: StepBarState): void {
            state = next;
            // Re-rendering would wipe what the user is typing into an open form or the menu's filter.
            if (!open && !menu) render();
        },
        close,
    };
}
