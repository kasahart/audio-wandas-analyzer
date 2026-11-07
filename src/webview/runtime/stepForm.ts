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
import { channelText, fieldNumber, fromShown, invalidReason } from './stepLabels';

/** The fields a long form shows before its "more" (with every changed one). */
const FORM_FIELDS = 4;

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
        const name = escapeHtml(param.name);
        // None (wandas picks the value itself): "none" in a choice, an empty field reading "auto" for a number or text.
        const nullable = 'nullable' in param && param.nullable;
        const input = param.kind === 'enum'
            ? `<select data-step-param="${name}">${param.options.map(option => `<option${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}${nullable ? `<option value=""${value === null || value === undefined ? ' selected' : ''}>${escapeHtml(strings.stepNone)}</option>` : ''}</select>`
            : param.kind === 'bool' && nullable
                // Three values (on, off, None) are a choice, not a checkbox.
                ? `<select data-step-param="${name}">${['true', 'false'].map(option => `<option${String(value) === option ? ' selected' : ''}>${option}</option>`).join('')}<option value=""${value === null || value === undefined ? ' selected' : ''}>${escapeHtml(strings.stepNone)}</option></select>`
                : param.kind === 'bool'
                ? `<input type="checkbox" data-step-param="${name}"${value === true ? ' checked' : ''}>`
                : param.kind === 'str'
                    ? `<input type="text" data-step-param="${name}" value="${escapeHtml(typeof value === 'string' ? value : '')}"${nullable ? ` data-step-nullable placeholder="${escapeHtml(strings.stepAuto)}"` : ''}>`
                    // An infinite value (normalize's norm) does not fit a number field: typed as text, "inf" or "Infinity".
                    : param.kind === 'float' && typeof value === 'number' && !Number.isFinite(value)
                        ? `<input type="text" inputmode="decimal" data-step-param="${name}" value="${escapeHtml(String(value))}"${nullable ? ` data-step-nullable placeholder="${escapeHtml(strings.stepAuto)}"` : ''}>`
                    : `<input type="number" data-step-param="${name}" value="${value === null || value === undefined ? '' : escapeHtml(param.kind === 'int' && param.channel ? channelText(value, channels) : fieldNumber(value))}" step="${param.kind === 'int' ? 1 : 'any'}"${param.kind === 'int' && param.channel ? ` min="1"${channels ? ` max="${channels}"` : ''}` : ''}${nullable ? ` data-step-nullable placeholder="${escapeHtml(strings.stepAuto)}"` : ''}>`;
        const bad = step.invalid === param.name;
        const label = param.kind === 'int' && param.channel ? (param.channel === 'output' ? strings.stepPairOutput : param.channel === 'input' ? strings.stepPairInput : strings.stepTriggerChannel) : param.name;
        return `<label class="step-field${bad ? ' is-invalid' : ''}${changed(param) ? ' is-changed' : ''}"${bad ? ` ${hintAttr(invalidReason(step, strings))}` : ''}>${escapeHtml(label)} ${input}${param.kind === 'float' && param.unit ? ` ${param.unit}` : ''}</label>`;
    };
    // A value other than wandas' default (None where wandas has none), for the bold mark and to keep it unfolded.
    const changed = (param: StepParam): boolean => {
        const value = step.params[param.name];
        return value !== undefined && value !== ('default' in param && param.default !== undefined ? param.default : null);
    };
    // A long form shows its first fields, the changed ones and the one a value breaks; the rest open from "more".
    const shown = step.editable.filter((param, index) => index < FORM_FIELDS || changed(param) || step.invalid === param.name);
    const folded = step.editable.filter(param => !shown.includes(param));
    const more = folded.length
        ? `<details class="step-more"><summary>${escapeHtml(strings.stepMore.replace('{n}', String(folded.length)).replace('{names}', folded.map(param => param.name).join(', ')))}</summary>${folded.map(field).join('')}</details>`
        : '';
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
    const fields = reference + (step.editable.length ? shown.map(field).join('') + more : reference ? '' : `<div class="step-form-note">${escapeHtml(strings.stepNoSettings)}</div>`);
    const apply = step.editable.length ? `<button type="button" class="entry-primary" data-action="step-apply"${step.invalid ? ' disabled' : ''}>${escapeHtml(strings.stepApply)}</button>` : '';
    const remove = removable(step) ? `<button type="button" data-action="step-remove" data-step="${escapeHtml(step.id)}">${escapeHtml(strings.stepRemove)}</button>` : '';
    return `<div class="step-form" role="dialog" aria-label="${escapeHtml(step.name)}" data-step-form="${escapeHtml(step.id)}">${title}${why}${fields}<div class="step-form-bar">${remove}${apply}</div></div>`;
}

/**
 * What a key does in the open form: Esc closes it, dropping the draft; Enter applies it from one of its fields
 * (input or select) only. On a button (Remove, the reference choice) or on "more", Enter does what that control does.
 */
export function stepFormKey(event: Pick<KeyboardEvent, 'key'> & { target?: EventTarget | null }): 'close' | 'apply' | null {
    if (event.key === 'Escape') return 'close';
    return event.key === 'Enter' && (event.target as Element | null)?.matches?.('input, select') ? 'apply' : null;
}

/** A number as typed: "inf" and "-inf" (as Python writes them) or "Infinity" are infinite. */
const typedNumber = (text: string): number => (/^\s*[+-]?inf(inity)?\s*$/i.test(text) ? (text.trim().startsWith('-') ? -Infinity : Infinity) : Number(text));

/** The Recipe the open form would give, to check it before Apply; null without a step's form. */
export function stepFormDraft(form: HTMLElement | null, recipe: RecipeDocument | null, limits: StepLimits): RecipeDocument | null {
    if (!form || !recipe) return null;
    const step = recipeSteps(recipe, limits).find(item => item.id === form.getAttribute('data-step-form'));
    if (!step) return null;
    let next = recipe;
    for (const param of step.editable) {
        const input = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-step-param="${param.name}"]`);
        if (!input) continue;
        // An untouched field keeps the stored value (or leaves wandas' default unwritten): a pair channel counted from
        // the end stays relative on every recording.
        if (input.tagName === 'SELECT') {
            const option = (input as HTMLSelectElement).selectedOptions[0];
            if (!option || option.defaultSelected) continue;
            const chosen = option.value === '' && 'nullable' in param && param.nullable ? null : option.value;
            next = withParam(next, step.id, param, param.kind === 'bool' && chosen !== null ? chosen === 'true' : chosen);
            continue;
        }
        const box = input as HTMLInputElement;
        if (box.type === 'checkbox') {
            if (box.checked !== box.defaultChecked) next = withParam(next, step.id, param, box.checked);
            continue;
        }
        if (box.value === box.defaultValue) continue;
        // Emptied: None where wandas picks the value itself; otherwise not a value (checkStepForm keeps Apply off).
        if (box.value === '') {
            if (box.hasAttribute('data-step-nullable')) next = withParam(next, step.id, param, null);
            continue;
        }
        next = withParam(next, step.id, param, param.kind === 'str' ? box.value : fromShown(param, typedNumber(box.value)));
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
    const empty = Array.from(form.querySelectorAll<HTMLInputElement>('input[data-step-param]:not([data-step-nullable]):not([type="checkbox"])')).filter(input => input.value.trim() === '');
    empty.forEach(input => { input.closest('.step-field')?.classList.add('is-invalid'); });
    if (empty.length) footer(strings.stepNeedValue);
    applyButton.disabled = !!badParam || empty.length > 0;
}
