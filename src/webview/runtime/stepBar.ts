/**
 * The step bar: the scan Recipe as wandas runs it, a chain of wandas methods, the same on the entry table
 * and the comparison. "Steps", the input, then every step as a round chip joined by →, each with a dot in the
 * colour of the Frame it gives; the stage on screen is framed, the steps after it dimmed, the app's
 * 1/3-octave branch beside the chain's end. … adds each step's wandas operation, the Frame on each link
 * and what the app computes outside the Recipe. Pressing a chip shows that step's Frame; holding it shows
 * what the step does; ⚙ (inside the chip on screen) opens its settings and Remove, × removes it, dragging
 * moves it. ＋ (after the chip on screen, at the end, or on a link while … is open) adds any operation of
 * wandas' registry that takes the Frame there, listed by what it does. A step that cannot run (a value out
 * of range, a Frame it cannot take, a failure on a file) is marked and left out of the scans.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { addableOperations, chainOutput, movedStep, recipeSteps, timeSignalStep, withParam, withStep, withoutSteps, TIME_SLICE, type RecipeStep, type StepLimits, type StepParam } from '../../shared/recipe/recipeSteps';
import { OPERATION_GROUPS, operationGroup, operationHint, type OperationGroup } from '../../shared/recipe/operationGuide';
import { catalogOperation, INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { outsideRecipe, reportOctaveRecipe } from './compareReport';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';

export type StepBarStrings = Pick<UiStrings, 'stepNeedAbove' | 'stepNeedInteger' | 'stepRegion' | 'stepAll' | 'stepMetrics' | 'stepAverage' | 'stepSettings' | 'stepApply' | 'compareNotEntry' | 'stepNeedBelow' | 'stepNeedPow2' | 'hintStepChip' | 'stepRecipeName' | 'hintSpectrogramGroup' | 'stepNeedValue' | 'hintSpectrogram' | 'stepFrameHint' | 'hintRegionMark' | 'stepOpen' | 'stepClose' | 'stepOutsideHeading' | 'stepOctave' | 'stepHoldHint' | 'stepHintNoHold' | 'stepAdd' | 'outsideLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepNeedFrame' | 'stepFailedOn' | 'stepTapHint' | 'stepNoSettings' | 'stepRemove' | 'stepMenuTitle' | 'stepMenuFilter' | 'stepOffFrame' | 'stepOffRequired' | 'stepOffRefuses' | 'stepOffUnavailable' | 'stepDefaultsOnly' | 'stepInsertHere' | 'stepAdded' | 'stepRemoved' | 'stepBarLabel' | 'stepInputFiles' | 'stepInput' | 'stepHintLocale' | 'stepGroupFilter' | 'stepGroupPrepare' | 'stepGroupTime' | 'stepGroupFrequency' | 'stepGroupOther' | 'stepDragHint' | 'stepMoved' | 'stepRemoveChip' | 'stepHighpass' | 'stepLowpass' | 'stepBandpass' | 'stepAverageFft' | 'stepOctaveHint'>;

/** A press shorter than this is a tap (see the step's Frame); longer is a hold (what the step does) until release. */
export const STEP_TAP_MS = 250;
/** The app's 1/3-octave branch: not a Recipe node, computed beside the chain's end (reportOctaveRecipe). */
export const OCTAVE_BRANCH = 'node-noct';
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
    return withoutSteps(recipe, recipeSteps(recipe, limits).filter(step => step.invalid !== undefined).map(step => step.id));
}

/** Whether the chain ends in a spectrum or band levels, so the app's 1/3-octave columns and branch apply. */
export function endsInSpectrum(recipe: RecipeDocument, limits?: number | StepLimits): boolean {
    return SPECTRAL_ENDS.includes(chainOutput(recipe, limits));
}

/** The one-line reason a step is left out, shown in the footer while the field or chip has focus or the pointer. */
export function invalidReason(step: RecipeStep, strings: StepBarStrings): string {
    if (!step.reason) return '';
    const limit = Number.isFinite(step.reason.limit) ? String(Math.round(step.reason.limit * 1000) / 1000) : '∞';
    switch (step.reason.kind) {
        case 'pow2': return strings.stepNeedPow2.replace('{max}', limit);
        case 'above': return strings.stepNeedAbove.replace('{min}', limit);
        case 'integer': return strings.stepNeedInteger;
        case 'frame': return strings.stepNeedFrame.replace('{op}', step.name).replace('{frame}', step.reason.text ?? '');
        case 'failed': return strings.stepFailedOn.replace('{reason}', step.reason.text ?? '');
        default: return strings.stepNeedBelow.replace('{max}', limit);
    }
}

const formatNumber = (value: unknown): string => (typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value ?? ''));

const hzText = (value: unknown): string => (typeof value === 'number' ? (value >= 1000 ? `${Math.round(value / 100) / 10} kHz` : `${Math.round(value)} Hz`) : '');
const bandRange = (p: Record<string, unknown>): string => (p['fmin'] !== undefined ? `${hzText(p['fmin'])}–${hzText(p['fmax'])}` : '');

function stepLabel(step: RecipeStep, strings: StepBarStrings, state: StepBarState, expanded: boolean): string {
    const p = step.params;
    switch (step.name) {
        case 'highpass_filter': return `${strings.stepHighpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'lowpass_filter': return `${strings.stepLowpass} ${formatNumber(p['cutoff'])} Hz`;
        case 'bandpass_filter': return `${strings.stepBandpass} ${formatNumber(p['low_cutoff'])}–${formatNumber(p['high_cutoff'])} Hz`;
        case 'time_slice': return `${strings.stepRegion} ${state.region ?? strings.stepAll}`;
        case 'welch': return strings.stepAverageFft.replace('{name}', strings.stepAverage).replace('{n}', formatNumber(p['n_fft']));
        case 'stft': return `STFT ${formatNumber(p['n_fft'])}`;
        case 'resampling': return `→ ${hzText(p['target_sr'])}`;
        case 'noct_spectrum': {
            const octave = p['n'] !== undefined && p['n'] !== 3 ? `1/${formatNumber(p['n'])} oct` : strings.stepOctave;
            return expanded && bandRange(p) ? `${octave} ${bandRange(p)}` : octave;
        }
        default: return step.name;
    }
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
    };
    /**
     * The chain as the scan runs it: the steps to its time signal, then the steps after it (a row of their
     * own) and, when the chain ends in a spectrum or band levels, the app's 1/3-octave branch beside them.
     */
    function flow(): { chain: RecipeStep[]; tail: RecipeStep[]; octave?: RecipeStep } {
        const steps = recipeSteps(state.recipe!, limits());
        const signal = timeSignalStep(state.recipe!, limits());
        const split = signal ? steps.findIndex(step => step.id === signal.id) + 1 : 0;
        if (!endsInSpectrum(state.recipe!, limits())) return { chain: steps.slice(0, split), tail: steps.slice(split) };
        const found = state.sampleRate ? recipeSteps(reportOctaveRecipe(state.recipe!, null, undefined, state.sampleRate)).find(step => step.name === 'noct_spectrum') : undefined;
        // Bands the file cannot give (or no file yet to tell): no branch, rather than a chip that draws nothing.
        if (!found) return { chain: steps.slice(0, split), tail: steps.slice(split) };
        // The branch is the app's, not a Recipe node: nothing on it to set or remove.
        const octave: RecipeStep = { id: OCTAVE_BRANCH, operation: 'wandas.audio.noct_spectrum', name: 'noct_spectrum', params: found?.params ?? {}, editable: [], input: INPUT_FRAME, output: 'NOctFrame' };
        return { chain: steps.slice(0, split), tail: steps.slice(split), octave };
    }
    const all = (): RecipeStep[] => { const { chain, tail, octave } = flow(); return [...chain, ...tail, ...(octave ? [octave] : [])]; };
    /** The last step that runs: ＋ at the end adds after it. */
    function end(): RecipeStep | undefined {
        const steps = recipeSteps(state.recipe!, limits());
        return steps.filter(step => step.invalid === undefined).at(-1) ?? steps.at(-1);
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
        if (open === step.id) classes.push('is-open');
        if (differs) classes.push('is-differs');
        const movable = removable(step);
        // The app's 1/3-octave branch is where the table's band column comes from.
        const why = step.invalid !== undefined ? invalidReason(step, strings) : step.id === OCTAVE_BRANCH ? `${strings.stepOctaveHint} · ${strings.stepTapHint}` : strings.stepTapHint;
        const dot = `<span class="step-dot" data-kind="${escapeHtml(step.invalid === undefined ? step.output : '')}" aria-hidden="true"></span>`;
        const body = `<button type="button" class="step-body" data-step-hold="${escapeHtml(step.id)}" ${hintAttr(`${why} — ${what}${movable ? ` · ${strings.stepDragHint}` : ''}`)}>${dot}${label}</button>`;
        const gearIcon = step.invalid !== undefined ? ICON.invalid : open === step.id ? ICON.open : ICON.slider;
        const gear = removable(step)
            ? `<button type="button" class="step-gear" data-action="step-settings" data-step="${escapeHtml(step.id)}" aria-label="${escapeHtml(strings.stepSettings)}" ${hintAttr(step.invalid !== undefined ? why : strings.stepSettings)}>${gearIcon}</button>` : '';
        const reset = differs ? `<button type="button" class="step-reset" data-step-region ${hintAttr(strings.hintRegionMark)}>↺</button>` : '';
        const cross = removable(step) ? `<button type="button" class="step-x" data-action="step-delete" data-step="${escapeHtml(step.id)}" aria-label="${escapeHtml(strings.stepRemoveChip)}" ${hintAttr(strings.stepRemoveChip)}></button>` : '';
        return `<span class="${classes.join(' ')}" data-step-id="${escapeHtml(step.id)}"${movable ? ' draggable="true"' : ''}>${body}${gear}${reset}${cross}</span>`;
    }
    function outsideTagsHtml(): string {
        const welch = recipeSteps(state.recipe!).find(step => step.name === 'welch');
        return outsideRecipe(strings, welch?.params).map(item => `<span class="awa-tag" ${hintAttr(item.text)}>${escapeHtml(item.tag)}</span>`).join('');
    }
    const addHtml = (after: RecipeStep | undefined, action: 'step-add' | 'step-insert' = 'step-add'): string => `<button type="button" class="step-add" ${action === 'step-add' ? 'data-action="step-add"' : 'data-action="step-insert"'} data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(action === 'step-add' ? strings.stepAdd : strings.stepInsertHere)}" aria-expanded="${!!menu && menu.after === (after?.id ?? null)}" ${hintAttr(strings.stepMenuTitle.replace('{frame}', after ? (after.invalid === undefined ? after.output : after.input) : INPUT_FRAME))}>＋</button>`;
    function chipsHtml(): string {
        if (!state.recipe) return '';
        const { chain, tail, octave } = flow();
        const version = state.specVersion !== undefined ? ` (${strings.stepMetrics} v${state.specVersion})` : '';
        const toggle = `<button type="button" class="step-more" data-action="step-expand" aria-expanded="${expanded}" ${hintAttr(expanded ? strings.stepClose : strings.stepOpen)}>${expanded ? '‹' : '…'}</button>`;
        const name = `<span class="step-label step-name" ${hintAttr(strings.stepRecipeName)}>${escapeHtml(strings.stepBarLabel)}</span>`;
        const input = `<span class="step-input" data-step-input><span class="step-dot" data-kind="${INPUT_FRAME}" aria-hidden="true"></span>${escapeHtml(state.files ? strings.stepInputFiles.replace('{n}', String(state.files)) : strings.stepInput)}</span>`;
        const steps = [...chain, ...tail];
        const last = end();
        const current = currentId();
        // Between two chips: →, and (with … open) ＋ to add a step there.
        const link = (after: RecipeStep | null): string => (expanded
            ? `<span class="step-link"><span class="step-arrow" aria-hidden="true">→</span>`
                + `<button type="button" class="step-insert" data-action="step-insert" data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(strings.stepInsertHere)}" ${hintAttr(strings.stepInsertHere)}>＋</button></span>`
            : '<span class="step-arrow" aria-hidden="true">→</span>');
        const node = (step: RecipeStep): string => chipHtml(step);
        const parts: string[] = [name, input];
        steps.forEach((step, index) => {
            parts.push(link(index ? steps[index - 1] : null), node(step));
            // ＋ right after the chip on screen adds a step there; the one at the end adds after the chain.
            if (!expanded && step.id === current && step.id !== last?.id) parts.push(addHtml(step, 'step-insert'));
        });
        parts.push(addHtml(last));
        // The app's 1/3-octave branch is not the chain's next step: it stands apart at the bar's end.
        const branch = octave ? `<span class="step-branch">${node(octave)}</span>` : '';
        const row = `<div class="step-row">${parts.join('')}<span class="step-gap"></span>${branch}${toggle}</div>`;
        return expanded ? row + `<div class="step-row step-outside-row"><span class="step-outside-heading">${escapeHtml(strings.stepOutsideHeading)}${escapeHtml(version)}</span>${outsideTagsHtml()}</div>` : row;
    }
    function formHtml(step: RecipeStep): string {
        const field = (param: StepParam): string => {
            const value = step.params[param.name];
            const input = param.kind === 'enum'
                ? `<select data-step-param="${param.name}">${param.options.map(option => `<option${option === value ? ' selected' : ''}>${option}</option>`).join('')}</select>`
                : `<input type="number" data-step-param="${param.name}" value="${escapeHtml(formatNumber(value))}" step="${param.kind === 'int' ? 1 : 'any'}">`;
            const bad = step.invalid === param.name;
            return `<label class="step-field${bad ? ' is-invalid' : ''}"${bad ? ` ${hintAttr(invalidReason(step, strings))}` : ''}>${escapeHtml(param.name)} ${input}${param.kind === 'float' && param.unit ? ` ${param.unit}` : ''}</label>`;
        };
        const title = `<div class="step-form-title">${escapeHtml(step.name)}</div>`;
        // A step left out for a reason other than one of its values says why at the top.
        const why = step.invalid === '' ? `<div class="step-form-why">${escapeHtml(invalidReason(step, strings))}</div>` : '';
        const fields = step.editable.length ? step.editable.map(field).join('') : `<div class="step-form-note">${escapeHtml(strings.stepNoSettings)}</div>`;
        const apply = step.editable.length ? `<button type="button" class="entry-primary" data-action="step-apply"${step.invalid ? ' disabled' : ''}>${escapeHtml(strings.stepApply)}</button>` : '';
        const remove = removable(step) ? `<button type="button" data-action="step-remove" data-step="${escapeHtml(step.id)}">${escapeHtml(strings.stepRemove)}</button>` : '';
        return `<div class="step-form" role="dialog" aria-label="${escapeHtml(step.name)}" data-step-form="${escapeHtml(step.id)}">${title}${why}${fields}<div class="step-form-bar">${remove}${apply}</div></div>`;
    }
    function menuHtml(): string {
        if (!menu) return '';
        const needle = menu.filter.trim().toLowerCase();
        const locale = strings.stepHintLocale;
        const items = addableOperations(menu.frame, lacks()).filter(item => !needle || item.name.toLowerCase().includes(needle) || operationHint(item.operation.id, locale).toLowerCase().includes(needle));
        const item = (entry: ReturnType<typeof addableOperations>[number]): string => {
            const output = entry.operation.output === '*' ? menu!.frame : entry.operation.output;
            const why = entry.off === 'frame' ? strings.stepOffFrame.replace('{frame}', menu!.frame)
                : entry.off === 'refuses' ? strings.stepOffRefuses.replace('{frame}', menu!.frame).replace('{reason}', entry.why ?? '')
                : entry.off === 'unavailable' ? strings.stepOffUnavailable.replace('{packages}', entry.why ?? '')
                : entry.off === 'required' ? strings.stepOffRequired.replace('{params}', entry.operation.params.filter(param => param.required).map(param => param.name).join(', ')) : '';
            const tag = !entry.off && !entry.settable ? `<span class="step-menu-tag">${escapeHtml(strings.stepDefaultsOnly)}</span>` : '';
            const hint = operationHint(entry.operation.id, locale);
            return `<button type="button" class="step-menu-item${entry.off ? ' is-off' : ''}" data-action="step-add-op" data-op="${escapeHtml(entry.operation.id)}"${entry.off ? ` aria-disabled="true" ${hintAttr(why)}` : ` ${hintAttr(entry.operation.id)}`}>`
                + `<span class="step-menu-line"><span class="step-dot" data-kind="${escapeHtml(output)}" aria-hidden="true"></span><span class="step-menu-name">${escapeHtml(entry.name)}</span>${tag}</span>`
                + `<small class="step-menu-hint">${hint ? escapeHtml(hint) : ''}</small></button>`;
        };
        const groupName: Record<OperationGroup, string> = { filter: strings.stepGroupFilter, prepare: strings.stepGroupPrepare, time: strings.stepGroupTime, frequency: strings.stepGroupFrequency, other: strings.stepGroupOther };
        // By what they do; within a group, those that can go here first (addableOperations' order).
        const groups = OPERATION_GROUPS.map(group => ({ group, entries: items.filter(entry => operationGroup(entry.operation.id) === group) })).filter(group => group.entries.length);
        return `<div class="step-menu" role="dialog" aria-label="${escapeHtml(strings.stepAdd)}" data-step-menu>`
            + `<div class="step-menu-title">${escapeHtml(strings.stepMenuTitle.replace('{frame}', menu.frame))}</div>`
            + `<input type="search" data-step-menu-filter placeholder="${escapeHtml(strings.stepMenuFilter)}" value="${escapeHtml(menu.filter)}">`
            + `<div class="step-menu-list">${groups.map(({ group, entries }) => `<div class="step-menu-group" data-group="${group}"><span class="step-menu-group-name">${escapeHtml(groupName[group])}</span>${entries.map(item).join('')}</div>`).join('')}</div></div>`;
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
            next = withParam(next, step.id, param, param.kind === 'enum' ? input.value : Number(input.value));
        }
        return next;
    }
    /** Marks the field that the typed values break, with its reason, and keeps Apply off until it is fixed. */
    function checkForm(): void {
        const form = element.querySelector<HTMLElement>('[data-step-form]');
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
        const next = draft();
        const form = element.querySelector<HTMLElement>('[data-step-form]');
        if (!next || !form || !form.querySelector('[data-action="step-apply"]')) return;
        // Invalid values never leave the form: the Recipe the scans run stays valid.
        const blank = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]')).some(input => input.value.trim() === '');
        if (blank || recipeSteps(next, limits()).find(item => item.id === form.getAttribute('data-step-form'))?.invalid) { checkForm(); return; }
        const stepId = form.getAttribute('data-step-form')!;
        open = null;
        deps.onChange(next);
        // Focus goes back to the gear the form came from, so the next Esc stays in the bar instead of leaving the screen.
        element.querySelector<HTMLElement>(`[data-action="step-settings"][data-step="${CSS.escape(stepId)}"]`)?.focus();
    }
    function remove(stepId: string): void {
        if (!state.recipe) return;
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === stepId);
        if (!step || !removable(step)) return;
        open = null;
        deps.onChange(withoutSteps(state.recipe, [stepId]));
        footer(strings.stepRemoved.replace('{op}', step.name));
    }
    function add(operationId: string): void {
        const operation = catalogOperation(operationId);
        if (!menu || !state.recipe || !operation) return;
        const entry = addableOperations(menu.frame, lacks()).find(item => item.operation.id === operationId);
        // An operation that cannot go here says why instead of being added.
        if (!entry || entry.off) { footer(element.querySelector(`[data-op="${CSS.escape(operationId)}"]`)?.getAttribute('data-hint') ?? ''); return; }
        const length = state.lengthS ?? (state.shortestSamples && state.sampleRate ? state.shortestSamples / state.sampleRate : undefined);
        const { recipe, id } = withStep(state.recipe, menu.after, operation, length ? { duration: Math.round(length * 1000) / 1000 } : {});
        menu = null;
        deps.onChange(recipe);
        deps.onStepShown?.(id);
        footer(strings.stepAdded.replace('{op}', entry.name));
    }
    function openMenu(after: string | null): void {
        if (!state.recipe) return;
        const steps = recipeSteps(state.recipe, limits());
        const before = after ? steps.find(step => step.id === after) : undefined;
        const frame = before ? (before.invalid === undefined ? before.output : before.input) : INPUT_FRAME;
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
        else if (action === 'step-add-op') add(target.getAttribute('data-op')!);
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
            if (first) add(first.getAttribute('data-op')!);
        }
        // Delete on a chip takes its step out, as Remove does.
        else if ((event.key === 'Delete' || event.key === 'Backspace') && body) { event.preventDefault(); event.stopPropagation(); remove(body.getAttribute('data-step-hold')!); }
    });
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
        const id = target?.getAttribute('data-step-id');
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
        deps.onChange(next);
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
