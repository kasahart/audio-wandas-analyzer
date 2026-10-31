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
import { addableOperations, CROSS_CHANNEL, PAIRED_ON_ADD, SLOT_REFERABLE, SELECT_PAIR, movedStep, recipeNodes, recipeSteps, withStep, withoutSteps, withBypass, withSlotReference, TIME_SLICE, type RecipeStep, type StepLimits } from '../../shared/recipe/recipeSteps';
import { catalogOperation, INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { outsideRecipe } from './compareReport';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { keyRouterFor } from './keyRouter';
import { currentStepId, frameAfter, INPUT_STAGE, lastRunningStep, OCTAVE_BRANCH, orderedSteps, removable, shownStep as chipShown, stepFlow, stepLimits, type RegionRange, type StepBarState, type StepFlow } from './stepBarModel';
import { invalidReason, stepLabel } from './stepLabels';
import { createStepHistory } from './stepHistory';
import { checkStepForm, regionFormDraft, regionLength, stepFormDraft, stepFormHtml, stepFormKey } from './stepForm';
import { stepMenuAt, stepMenuHtml, stepMenuKey, stepMenuListHtml, type StepMenuContext, type StepMenuState } from './stepMenu';

export { endsInSpectrum, INPUT_STAGE, OCTAVE_BRANCH, recipeWithout, runnableRecipe, stepLimits, unpairedRecipe, type RegionRange, type StepBarState, type StepBarStrings } from './stepBarModel';
export { invalidReason, stepChipLabel } from './stepLabels';

/** A press shorter than this is a tap (see the step's Frame); longer is a hold (what the step does) until release. */
export const STEP_TAP_MS = 250;

export interface StepBar {
    element: HTMLElement;
    set(state: StepBarState): void;
    /** Closes an open settings form or menu; true when there was one, so Esc stops there. */
    close(): boolean;
    /** The region chip set from outside (the tracks' selection), as an edit × and ↶ take back; false when one is there already. */
    importRegion(range: RegionRange): boolean;
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
    /** ＋'s menu, while it is open. */
    let menu: StepMenuState | null = null;
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
    /** The region chip is there only while a region is set. */
    const shownStep = (step: RecipeStep): boolean => chipShown(step, state);

    // ---- undo / redo: every edit from the bar keeps what was there before (the Recipe and the region).
    type Snapshot = { recipe: RecipeDocument; region: RegionRange | null };
    const edits = createStepHistory<Snapshot>();
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
        if (here) edits.record(here);
        applySnapshot({ recipe, region });
    }
    function travel(target: Snapshot | undefined, said: string): void {
        if (!target) return;
        open = null;
        applySnapshot(target);
        footer(said);
    }
    const undo = (): void => travel(edits.undo(now()), strings.stepUndone);
    const redo = (): void => travel(edits.redo(now()), strings.stepRedone);
    function flow(): StepFlow { return stepFlow(state.recipe!, state); }
    const all = (): RecipeStep[] => orderedSteps(flow());
    function end(): RecipeStep | undefined { return lastRunningStep(state.recipe!, state); }
    function currentId(): string | undefined { return currentStepId(state.recipe!, state, deps.mode); }
    const ordered = all;
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
            + `<button type="button" class="step-undo" data-action="step-undo" aria-label="${escapeHtml(strings.stepUndo)}" ${hintAttr(strings.stepUndo)}${edits.canUndo() ? '' : ' disabled'}>↶</button>`
            + `<button type="button" class="step-redo" data-action="step-redo" aria-label="${escapeHtml(strings.stepRedo)}" ${hintAttr(strings.stepRedo)}${edits.canRedo() ? '' : ' disabled'}>↷</button></span>`;
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
    const formHtml = (step: RecipeStep): string => stepFormHtml(step, state, strings);
    function menuContext(recipe: RecipeDocument): StepMenuContext {
        return { recipe, state, strings, expanded, lacks: lacks(), regionSettable: !!deps.onRegionSet };
    }
    const menuListHtml = (): string => (menu && state.recipe ? stepMenuListHtml(menu, menuContext(state.recipe)) : '');
    const menuHtml = (): string => (menu && state.recipe ? stepMenuHtml(menu, menuContext(state.recipe)) : '');
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
    const formElement = (): HTMLElement | null => element.querySelector<HTMLElement>('[data-step-form]');
    const draft = (): RecipeDocument | null => stepFormDraft(formElement(), state.recipe, limits());
    const lengthOf = (): number | undefined => regionLength(state);
    const regionDraft = (): RegionRange | null => regionFormDraft(element, lengthOf());
    const checkForm = (): void => checkStepForm(formElement(), { recipe: state.recipe, state, strings, footer });
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
    /** A cross-channel step's reference: the base slot's recording, or a channel of the same one (with its pair chip). */
    function setReference(stepId: string, slot: boolean): void {
        if (!state.recipe) return;
        const step = recipeSteps(state.recipe, limits()).find(item => item.id === stepId);
        if (!step || (step.reference === 'slot') === slot) return;
        emit(withSlotReference(state.recipe, stepId, slot));
        footer(strings.stepReferenceSet.replace('{op}', step.name).replace('{reference}', slot ? strings.stepReferenceSlot : strings.stepReferenceChannel));
        element.querySelector<HTMLElement>(`[data-action="step-reference"][data-step="${CSS.escape(stepId)}"][data-mode="${slot ? 'slot' : 'channel'}"]`)?.focus();
    }
    /** The select_pair step that reads `stepId`, if one does. */
    function pairAfter(stepId: string): string | undefined {
        return recipeNodes(state.recipe).find(node => node.operation === SELECT_PAIR && node.inputs[0] === stepId)?.id;
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
    function importRegion(range: RegionRange): boolean {
        if (!state.recipe || state.regionRange || !deps.onRegionSet) return false;
        const slice = recipeSteps(state.recipe, limits()).find(step => step.operation === TIME_SLICE);
        const operation = catalogOperation(TIME_SLICE);
        const placed = slice ? { recipe: state.recipe } : operation ? withStep(state.recipe, null, operation) : null;
        if (!placed) return false;
        emit(placed.recipe, range);
        footer(strings.stepRegionImported);
        return true;
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
        const channels = before ? before.channels : limits().channels;
        const entry = addableOperations(before ? frameAfter(before) : INPUT_FRAME, lacks(), channels).find(item => item.operation.id === operationId);
        // An operation that cannot go there says why instead of being added.
        if (!entry || entry.off) { footer(element.querySelector(`[data-op="${CSS.escape(operationId)}"]`)?.getAttribute('data-hint') ?? ''); return; }
        const length = state.lengthS ?? (state.shortestSamples && state.sampleRate ? state.shortestSamples / state.sampleRate : undefined);
        let { recipe, id } = withStep(state.recipe, after, operation, length ? { duration: Math.round(length * 1000) / 1000 } : {});
        // A cross-channel step compares one pair, named in the chain: ch2 over the reference ch1 to start with; where
        // there is one channel, the recording over the base slot's.
        const select = PAIRED_ON_ADD.has(operationId) ? catalogOperation(SELECT_PAIR) : undefined;
        if (SLOT_REFERABLE.has(operationId) && channels !== undefined && channels < 2) recipe = withSlotReference(recipe, id, true);
        else if (select) ({ recipe, id } = withStep(recipe, id, select));
        menu = null;
        emit(recipe);
        deps.onStepShown?.(id);
        footer(strings.stepAdded.replace('{op}', entry.name));
    }
    function openMenu(after: string | null): void {
        if (!state.recipe) return;
        menu = menu && menu.after === after ? null : stepMenuAt(state.recipe, state, after);
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
        else if (action === 'step-reference') setReference(target.getAttribute('data-step')!, target.getAttribute('data-mode') === 'slot');
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
        // In the open form or menu, the keys are theirs (stepFormKey, stepMenuKey).
        const formKey = open ? stepFormKey(event) : null;
        const menuKey = menu ? stepMenuKey(event) : null;
        if (formKey === 'close' || menuKey === 'close') { event.stopPropagation(); close(); }
        // Esc on a chip only leaves the bar; the screen's own Esc needs focus outside it.
        else if (event.key === 'Escape') { event.stopPropagation(); (document.activeElement as HTMLElement | null)?.blur?.(); }
        else if (formKey === 'apply') { event.preventDefault(); event.stopPropagation(); apply(); }
        // The menu's filter: Enter adds the first operation that can go here.
        else if (menuKey === 'add-first') {
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
    keyRouterFor(view).add({
        layer: 'step-bar',
        keydown(event) {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
            const key = event.key.toLowerCase();
            if (key !== 'z' && key !== 'y') return false;
            const active = document.activeElement as HTMLElement | null;
            const inBar = !!active && element.contains(active);
            if (!inBar) {
                if (!element.isConnected || !element.getClientRects().length || (active && active !== document.body && active.closest('input, select, textarea, [contenteditable]'))) return false;
                const front = document.querySelector<HTMLElement>('[data-step-bar="compare"]');
                if (deps.mode === 'entry' && front && front.getClientRects().length) return false;
            } else if (active?.closest('input, select, textarea')) return false;
            event.preventDefault();
            if (key === 'y' || event.shiftKey) redo(); else undo();
            return true;
        },
    });
    element.addEventListener('input', event => {
        if ((event.target as HTMLElement).matches('[data-step-menu-filter]') && menu) {
            // Only the list is drawn again: the field keeps its focus, its caret and an IME composition in progress.
            menu.filter = (event.target as HTMLInputElement).value;
            const list = element.querySelector<HTMLElement>('[data-step-menu] .step-menu-list');
            if (list) list.innerHTML = menuListHtml();
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
        importRegion,
    };
}
