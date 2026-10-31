/**
 * A step's settings form on the step bar (⚙): its fields, the Recipe or region they would give, and the check that
 * marks the field the typed values break and keeps Apply off until it is fixed. The region chip has a form of its
 * own: where the region starts and ends.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeSteps, SLOT_REFERABLE, TIME_SLICE, withParam, type RecipeStep, type StepLimits, type StepParam } from '../../shared/recipe/recipeSteps';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { removable, stepLimits, type RegionRange, type StepBarState, type StepBarStrings } from './stepBarModel';
import { channelText, formatNumber, fromShown, invalidReason } from './stepLabels';

/** The form of `step`: the region chip's (start, end), or the step's fields, its reference and Remove / Apply. */
export function stepFormHtml(step: RecipeStep, state: StepBarState, strings: StepBarStrings): string {
    // The region chip's form: where the region starts and ends; Remove gives the whole file back.
    if (step.operation === TIME_SLICE) {
        const range = state.regionRange ?? { start: 0, end: 1 };
        const field = (name: 'start' | 'end', label: string, value: number): string => `<label class="step-field">${escapeHtml(label)} <input type="number" data-step-region-param="${name}" value="${value.toFixed(2)}" step="0.01" min="0"></label>`;
        return `<div class="step-form" role="dialog" aria-label="${escapeHtml(strings.stepRegion)}" data-step-form="${escapeHtml(step.id)}" data-step-form-region><div class="step-form-title">${escapeHtml(strings.stepRegion)}</div>`
            + field('start', strings.stepRegionStart, range.start) + field('end', strings.stepRegionEnd, range.end)
            + `<div class="step-form-bar"><button type="button" data-action="step-region-clear">${escapeHtml(strings.stepRemove)}</button><button type="button" class="entry-primary" data-action="step-apply">${escapeHtml(strings.stepApply)}</button></div></div>`;
    }
    // The channels at this step (a selection before it may leave fewer than the files have).
    const channels = step.channels ?? state.channels;
    const field = (param: StepParam): string => {
        const value = step.params[param.name];
        const input = param.kind === 'enum'
            ? `<select data-step-param="${param.name}">${param.options.map(option => `<option${option === value ? ' selected' : ''}>${option}</option>`).join('')}</select>`
            : `<input type="number" data-step-param="${param.name}" value="${escapeHtml(param.kind === 'int' && param.channel ? channelText(value, channels) : formatNumber(value))}" step="${param.kind === 'int' ? 1 : 'any'}"${param.kind === 'int' && param.channel ? ` min="1"${channels ? ` max="${channels}"` : ''}` : ''}>`;
        const bad = step.invalid === param.name;
        const name = param.kind === 'int' && param.channel ? (param.channel === 'output' ? strings.stepPairOutput : strings.stepPairInput) : param.name;
        return `<label class="step-field${bad ? ' is-invalid' : ''}"${bad ? ` ${hintAttr(invalidReason(step, strings))}` : ''}>${escapeHtml(name)} ${input}${param.kind === 'float' && param.unit ? ` ${param.unit}` : ''}</label>`;
    };
    const title = `<div class="step-form-title">${escapeHtml(step.name)}</div>`;
    // A step left out for a reason other than one of its values says why at the top.
    const why = step.invalid === '' ? `<div class="step-form-why">${escapeHtml(invalidReason(step, strings, state.recipe ? recipeSteps(state.recipe, stepLimits(state)) : []))}</div>` : '';
    // A cross-channel step's reference: a channel of the same recording (its pair chip) or the base slot's recording.
    const choice = (mode: 'channel' | 'slot', label: string): string => {
        const on = (mode === 'slot') === (step.reference === 'slot');
        return `<button type="button" class="step-reference-choice" data-action="step-reference" data-step="${escapeHtml(step.id)}" data-mode="${mode}" aria-pressed="${on}">${escapeHtml(label)}</button>`;
    };
    const reference = SLOT_REFERABLE.has(step.operation)
        ? `<div class="step-field step-reference" role="group" aria-label="${escapeHtml(strings.stepReference)}">${escapeHtml(strings.stepReference)} ${choice('channel', strings.stepReferenceChannel)}${choice('slot', strings.stepReferenceSlot)}</div>`
        : '';
    const fields = reference + (step.editable.length ? step.editable.map(field).join('') : reference ? '' : `<div class="step-form-note">${escapeHtml(strings.stepNoSettings)}</div>`);
    const apply = step.editable.length ? `<button type="button" class="entry-primary" data-action="step-apply"${step.invalid ? ' disabled' : ''}>${escapeHtml(strings.stepApply)}</button>` : '';
    const remove = removable(step) ? `<button type="button" data-action="step-remove" data-step="${escapeHtml(step.id)}">${escapeHtml(strings.stepRemove)}</button>` : '';
    return `<div class="step-form" role="dialog" aria-label="${escapeHtml(step.name)}" data-step-form="${escapeHtml(step.id)}">${title}${why}${fields}<div class="step-form-bar">${remove}${apply}</div></div>`;
}

/** What a key does in the open form: Esc closes it, dropping the draft; Enter applies it. */
export function stepFormKey(event: Pick<KeyboardEvent, 'key'>): 'close' | 'apply' | null {
    return event.key === 'Escape' ? 'close' : event.key === 'Enter' ? 'apply' : null;
}

/** The Recipe the open form would give, to check it before Apply; null without a step's form. */
export function stepFormDraft(form: HTMLElement | null, recipe: RecipeDocument | null, limits: StepLimits): RecipeDocument | null {
    if (!form || !recipe) return null;
    const step = recipeSteps(recipe, limits).find(item => item.id === form.getAttribute('data-step-form'));
    if (!step) return null;
    let next = recipe;
    for (const param of step.editable) {
        const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-step-param="${param.name}"]`);
        // An untouched field keeps the stored value: a pair channel counted from the end stays relative on every recording.
        if (!input || input.value === '' || (input.tagName === 'INPUT' && input.value === (input as HTMLInputElement).defaultValue)) continue;
        next = withParam(next, step.id, param, param.kind === 'enum' ? input.value : fromShown(param, Number(input.value)));
    }
    return next;
}

/** The files' length (s): a region must end within it. */
export const regionLength = (state: Pick<StepBarState, 'shortestSamples' | 'sampleRate' | 'lengthS'>): number | undefined => (state.shortestSamples && state.sampleRate ? state.shortestSamples / state.sampleRate : state.lengthS);

/** The region the region chip's form would give, or null when it is not one (start < end, within the file). */
export function regionFormDraft(root: ParentNode, length: number | undefined): RegionRange | null {
    const [start, end] = ['start', 'end'].map(name => root.querySelector<HTMLInputElement>(`[data-step-region-param="${name}"]`)?.value.trim() ?? '').map(text => (text === '' ? NaN : Math.round(Number(text) * 100) / 100));
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && (length === undefined || end <= length) ? { start, end } : null;
}

/** Marks the field that the typed values break, with its reason, and keeps Apply off until it is fixed. */
export function checkStepForm(form: HTMLElement | null, context: { recipe: RecipeDocument | null; state: StepBarState; strings: StepBarStrings; footer: (text: string) => void }): void {
    const { state, strings, footer } = context;
    const limits = stepLimits(state);
    if (form?.hasAttribute('data-step-form-region')) {
        const ok = !!regionFormDraft(form, regionLength(state));
        form.querySelectorAll('.step-field').forEach(label => label.classList.toggle('is-invalid', !ok));
        const regionApply = form.querySelector<HTMLButtonElement>('[data-action="step-apply"]');
        if (regionApply) regionApply.disabled = !ok;
        if (!ok) footer(strings.stepRegionOrder);
        return;
    }
    const next = stepFormDraft(form, context.recipe, limits);
    const applyButton = form?.querySelector<HTMLButtonElement>('[data-action="step-apply"]');
    if (!form || !next || !applyButton) return;
    const step = recipeSteps(next, limits).find(item => item.id === form.getAttribute('data-step-form'));
    const badParam = step?.invalid ? step.invalid : undefined;
    form.querySelectorAll<HTMLElement>('.step-field').forEach(label => {
        // The reference's choice is a field of its own, without a value to check.
        const input = label.querySelector('[data-step-param]');
        if (!input) return;
        const name = input.getAttribute('data-step-param');
        const bad = !!step && !!badParam && badParam === name;
        label.classList.toggle('is-invalid', bad);
        const text = bad ? invalidReason(step, strings) : '';
        label.setAttribute('data-hint', text);
        input.setAttribute('aria-description', text);
        if (bad) footer(text);
    });
    // An emptied field is not a value: Apply waits for one instead of quietly keeping the old.
    const empty = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]')).filter(input => input.value.trim() === '');
    empty.forEach(input => { input.closest('.step-field')?.classList.add('is-invalid'); });
    if (empty.length) footer(strings.stepNeedValue);
    applyButton.disabled = !!badParam || empty.length > 0;
}
