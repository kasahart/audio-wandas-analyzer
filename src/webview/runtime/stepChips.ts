/**
 * The step bar's row of chips: ↶ ↷, the Recipe's name, the input, every step as a round chip joined by → and ＋, the
 * ＋ at the end, the app's 1/3-octave branch apart at the end, and … (opened, the row of what the app computes
 * outside the Recipe). Markup only: the bar answers the buttons.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeSteps, TIME_SLICE, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { outsideRecipe } from './compareReport';
import { titledHintAttr as hintAttr } from './hintFooter';
import { currentStepId, INPUT_STAGE, lastRunningStep, OCTAVE_BRANCH, orderedSteps, removable, shownStep, stepFlow, stepLimits, type StepBarState, type StepBarStrings } from './stepBarModel';
import { invalidReason, stepLabel } from './stepLabels';
import type { StepMenuState } from './stepMenu';

/** What the chips are drawn from: the Recipe and the bar's state, and what is open on it. */
export interface StepChipsContext {
    recipe: RecipeDocument;
    state: StepBarState;
    strings: StepBarStrings;
    mode: 'entry' | 'compare';
    /** The bar opened with …. */
    expanded: boolean;
    /** The step whose settings form is open. */
    open: string | null;
    menu: StepMenuState | null;
    /** Comparison only: the region chip is set and cleared from the bar. */
    regionSettable: boolean;
    /** Comparison only: the input is a chip, pressed to show the files' waveforms. */
    inputSelectable: boolean;
    canUndo: boolean;
    canRedo: boolean;
}

/** Icons drawn in the text colour of the chip they sit in. */
const ICON = {
    slider: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3h10M1 9h10"/><circle cx="4" cy="3" r="1.6"/><circle cx="8" cy="9" r="1.6"/></svg>',
    open: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 5l3 3 3-3"/></svg>',
    invalid: '<svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v5M6 9.5v.5"/></svg>',
    // An effect pedal's bypass: the signal's path arcs over the block.
    bypass: '<svg class="step-icon step-bypass-icon" viewBox="0 0 16 14" aria-hidden="true"><rect x="5.5" y="8" width="5" height="4.5" rx=".8"/><path d="M2 12V6Q2 3 5 3H11Q14 3 14 6V12"/><path d="M12 10l2 2 2-2"/></svg>',
};

/**
 * One step: a round chip with a dot in its Frame's colour. Its body is pressed to see the step's Frame and
 * held to see what the step does; ⚙ (shown on the chip on screen) opens its settings and Remove; × (on
 * hover) removes it; the chip is dragged to move it. On the comparison a region other than the entry table's has ↺.
 */
export function stepChipHtml(step: RecipeStep, context: StepChipsContext): string {
    const { recipe, state, strings, open } = context;
    const comparison = context.mode === 'compare';
    const region = step.operation === TIME_SLICE && context.regionSettable;
    const differs = comparison && step.operation === TIME_SLICE && !!state.regionDiffers;
    const what = strings.stepFrameHint.replace('{op}', step.name).replace('{frame}', step.output);
    const label = escapeHtml(stepLabel(step, strings, state, context.expanded));
    const current = currentStepId(recipe, state, context.mode);
    const order = orderedSteps(stepFlow(recipe, state));
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
    const why = step.invalid !== undefined ? invalidReason(step, strings, recipeSteps(recipe, stepLimits(state))) : step.id === OCTAVE_BRANCH ? `${strings.stepOctaveHint} · ${strings.stepTapHint}` : strings.stepTapHint;
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

function outsideTagsHtml(recipe: RecipeDocument, strings: StepBarStrings): string {
    const welch = recipeSteps(recipe).find(step => step.name === 'welch');
    return outsideRecipe(strings, welch?.params).map(item => `<span class="awa-tag" ${hintAttr(item.text)}>${escapeHtml(item.tag)}</span>`).join('');
}

const addHtml = (after: RecipeStep | undefined, context: StepChipsContext, action: 'step-add' | 'step-insert' = 'step-add'): string => {
    const { strings, menu } = context;
    return `<button type="button" class="step-add" ${action === 'step-add' ? 'data-action="step-add"' : 'data-action="step-insert"'} data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(action === 'step-add' ? strings.stepAdd : strings.stepMenuTitle)}" aria-expanded="${!!menu && menu.after === (after?.id ?? null)}" ${hintAttr(strings.stepMenuTitle.replace('{frame}', after ? (after.invalid === undefined ? after.output : after.input) : INPUT_FRAME))}>＋</button>`;
};

/** The bar's row of chips, and the row of what the app computes outside the Recipe while the bar is opened. */
export function stepChipsHtml(context: StepChipsContext): string {
    const { recipe, state, strings, expanded } = context;
    const { chain, tail, octave } = stepFlow(recipe, state);
    const version = state.specVersion !== undefined ? ` (${strings.stepMetrics} v${state.specVersion})` : '';
    const toggle = `<button type="button" class="step-more" data-action="step-expand" aria-expanded="${expanded}" ${hintAttr(expanded ? strings.stepClose : strings.stepOpen)}>${expanded ? '‹' : '…'}</button>`;
    const name = `<span class="step-label step-name" ${hintAttr(strings.stepRecipeName)}>${escapeHtml(strings.btnStage)}</span>`;
    const current = currentStepId(recipe, state, context.mode);
    const inputText = `<span class="step-dot" data-kind="${INPUT_FRAME}" aria-hidden="true"></span>${escapeHtml(state.files ? strings.stepInputFiles.replace('{n}', String(state.files)) : strings.stepInput)}`;
    // On the comparison the input is a chip too: pressed, it shows the files as they come in.
    const input = context.inputSelectable
        ? `<span class="step-chip step-input${current === INPUT_STAGE ? ' is-current' : ''}" data-step-input data-step-id="${INPUT_STAGE}"><button type="button" class="step-body" data-step-hold="${INPUT_STAGE}" ${hintAttr(strings.stepInputHint)}>${inputText}</button></span>`
        : `<span class="step-input" data-step-input>${inputText}</span>`;
    const steps = [...chain, ...tail].filter(step => shownStep(step, state));
    const last = lastRunningStep(recipe, state);
    // Between two chips: → and ＋ to add a step there.
    const link = (after: RecipeStep | null): string => `<span class="step-link"><span class="step-arrow" aria-hidden="true">→</span>`
        + `<button type="button" class="step-insert" data-action="step-insert" data-after="${escapeHtml(after?.id ?? '')}" aria-label="${escapeHtml(strings.stepMenuTitle)}" ${hintAttr(strings.stepMenuTitle)}>＋</button></span>`;
    const node = (step: RecipeStep): string => stepChipHtml(step, context);
    const history = `<span class="step-history">`
        + `<button type="button" class="step-undo" data-action="step-undo" aria-label="${escapeHtml(strings.stepUndo)}" ${hintAttr(strings.stepUndo)}${context.canUndo ? '' : ' disabled'}>↶</button>`
        + `<button type="button" class="step-redo" data-action="step-redo" aria-label="${escapeHtml(strings.stepRedo)}" ${hintAttr(strings.stepRedo)}${context.canRedo ? '' : ' disabled'}>↷</button></span>`;
    const parts: string[] = [history, name, input];
    // A link adds right before the chip after it, behind a region chip that is not shown too.
    const full = [...chain, ...tail];
    steps.forEach(step => { const at = full.findIndex(item => item.id === step.id); parts.push(link(at > 0 ? full[at - 1] : null), node(step)); });
    parts.push('<span class="step-arrow" aria-hidden="true">→</span>', addHtml(last, context));
    // The app's 1/3-octave branch is not the chain's next step: it stands apart at the bar's end.
    const branch = octave ? `<span class="step-branch">${node(octave)}</span>` : '';
    const row = `<div class="step-row">${parts.join('')}<span class="step-gap"></span>${branch}${toggle}</div>`;
    return expanded ? row + `<div class="step-row step-outside-row"><span class="step-outside-heading">${escapeHtml(strings.stepOutsideHeading)}${escapeHtml(version)}</span>${outsideTagsHtml(recipe, strings)}</div>` : row;
}
