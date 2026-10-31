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
import { keyRouterFor } from './keyRouter';
import { frameAfter, INPUT_STAGE, OCTAVE_BRANCH, orderedSteps, removable, stepFlow, stepLimits, type RegionRange, type StepBarState } from './stepBarModel';
import { stepLabel } from './stepLabels';
import { createStepHistory } from './stepHistory';
import { stepChipsHtml } from './stepChips';
import { attachStepDrag, attachStepHold } from './stepGestures';
import { checkStepForm, regionFormDraft, regionLength, stepFormDraft, stepFormHtml, stepFormKey } from './stepForm';
import { stepMenuAt, stepMenuHtml, stepMenuKey, stepMenuListHtml, type StepMenuContext, type StepMenuState } from './stepMenu';

export { endsInSpectrum, INPUT_STAGE, OCTAVE_BRANCH, recipeWithout, runnableRecipe, stepLimits, unpairedRecipe, type RegionRange, type StepBarState, type StepBarStrings } from './stepBarModel';
export { invalidReason, stepChipLabel } from './stepLabels';

export { STEP_TAP_MS } from './stepGestures';

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
    /** The chain's steps in the order they run, then the app's 1/3-octave branch. */
    const all = (recipe: RecipeDocument): RecipeStep[] => orderedSteps(stepFlow(recipe, state));
    const chipsHtml = (): string => (state.recipe
        ? stepChipsHtml({ recipe: state.recipe, state, strings, mode: deps.mode, expanded, open, menu, regionSettable: !!deps.onRegionSet, inputSelectable: !!deps.onInputSelect, canUndo: edits.canUndo(), canRedo: edits.canRedo() })
        : '');
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
        const form = formElement();
        const stepId = form?.getAttribute('data-step-form');
        if (!form || stepId == null) return;
        if (form.hasAttribute('data-step-form-region')) {
            const range = regionDraft();
            if (!range || !state.recipe) { checkForm(); return; }
            open = null;
            emit(state.recipe, range);
            element.querySelector<HTMLElement>(`[data-action="step-settings"][data-step="${CSS.escape(stepId)}"]`)?.focus();
            return;
        }
        const next = draft();
        if (!next || !form.querySelector('[data-action="step-apply"]')) return;
        // Invalid values never leave the form: the Recipe the scans run stays valid.
        const blank = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]')).some(input => input.value.trim() === '');
        if (blank || recipeSteps(next, limits()).find(item => item.id === stepId)?.invalid) { checkForm(); return; }
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

    const view = document.defaultView;
    if (!view) throw new Error('createStepBar: the document has no window');
    element.addEventListener('click', event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-step-hold], [data-step-region]');
        if (!target) return;
        const action = target.getAttribute('data-action');
        // A button without the step (or operation) it names finds none: the edit's own lookup does nothing then.
        const named = (attribute: string): string => target.getAttribute(attribute) ?? '';
        if (target.hasAttribute('data-step-hold')) {
            if (hold.swallowed()) return;
            if (target.getAttribute('data-step-hold') === INPUT_STAGE) { deps.onInputSelect?.(); return; }
            const step = state.recipe ? all(state.recipe).find(item => item.id === target.getAttribute('data-step-hold')) : undefined;
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
        else if (action === 'step-remove' || action === 'step-delete') remove(named('data-step'));
        else if (action === 'step-reference') setReference(named('data-step'), target.getAttribute('data-mode') === 'slot');
        else if (action === 'step-add' || action === 'step-insert') openMenu(target.getAttribute('data-after') || null);
        else if (action === 'step-add-op') add(named('data-op'), target.hasAttribute('data-after') ? target.getAttribute('data-after') || null : undefined);
        else if (action === 'step-bypass') bypass(named('data-step'));
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
            if (first) add(first.getAttribute('data-op') ?? '', first.hasAttribute('data-after') ? first.getAttribute('data-after') || null : undefined);
        }
        // Delete on a chip takes its step out, as Remove does.
        else if ((event.key === 'Delete' || event.key === 'Backspace') && body) { event.preventDefault(); event.stopPropagation(); remove(body.getAttribute('data-step-hold') ?? ''); }
        // M on a chip bypasses its step (or brings it back).
        else if ((event.key === 'm' || event.key === 'M') && body && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); bypass(body.getAttribute('data-step-hold') ?? ''); }
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
    const hold = attachStepHold(element, view, {
        stepAt: id => (state.recipe ? all(state.recipe).find(item => item.id === id) : undefined),
        canHold: step => deps.canHold?.(step) ?? false,
        onHold: step => deps.onStepHold?.(step),
    });
    attachStepDrag(element, document, {
        steps: () => (state.recipe ? recipeSteps(state.recipe, limits()) : null),
        move(step, after) {
            if (!state.recipe) return;
            emit(movedStep(state.recipe, step.id, after));
            deps.onStepShown?.(step.id);
            footer(strings.stepMoved.replace('{op}', step.name));
        },
    });
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
