/**
 * ＋'s menu on the step bar: the operations that take the Frame here, by what they do; then those that cannot but
 * fit an earlier place, which go there ("goes in before …"); then the rest, greyed, with why. The filter narrows
 * the list; only the list is drawn again as it is typed into (stepMenuListHtml), so the field keeps its IME.
 */
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { addableOperations, recipeSteps, TIME_SLICE, type AddableOperation, type RecipeStep } from '../../shared/recipe/recipeSteps';
import { OPERATION_GROUPS, operationGroup, operationHint, type OperationGroup } from '../../shared/recipe/operationGuide';
import { INPUT_FRAME } from '../../shared/recipe/recipeCatalog';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { earlierPlaces, frameAfter, stepLimits, type StepBarState, type StepBarStrings } from './stepBarModel';
import { stepLabel } from './stepLabels';

/** An open ＋ menu: after which step (null: before the first), the Frame there, and the typed filter. */
export interface StepMenuState { after: string | null; frame: string; filter: string }

export interface StepMenuContext {
    recipe: RecipeDocument;
    state: StepBarState;
    strings: StepBarStrings;
    /** The bar opened with …: chips name more (a hint names the chip an earlier place goes before). */
    expanded: boolean;
    /** The optional packages the runtime cannot import. */
    lacks: ReadonlySet<string>;
    /** Comparison only: the region is set from the menu. */
    regionSettable: boolean;
}

/** The menu ＋ after `after` opens: the Frame there, no filter yet. */
export function stepMenuAt(recipe: RecipeDocument, state: StepBarState, after: string | null): StepMenuState {
    const before = after ? recipeSteps(recipe, stepLimits(state)).find(step => step.id === after) : undefined;
    return { after, frame: before ? frameAfter(before) : INPUT_FRAME, filter: '' };
}

/**
 * What a key does in the open menu: Esc closes it; Enter in the filter adds the first operation that can go here,
 * except the Enter that ends an IME composition, which only confirms the text.
 */
export function stepMenuKey(event: Pick<KeyboardEvent, 'key' | 'target' | 'isComposing' | 'keyCode'>): 'close' | 'add-first' | null {
    if (event.key === 'Escape') return 'close';
    if (event.key === 'Enter' && (event.target as HTMLElement | null)?.matches?.('[data-step-menu-filter]') && !event.isComposing && event.keyCode !== 229) return 'add-first';
    return null;
}

/** The menu's list, by group, then the earlier places and the operations that cannot go here. */
export function stepMenuListHtml(menu: StepMenuState, context: StepMenuContext): string {
    const { recipe, state, strings, expanded, lacks } = context;
    const limits = stepLimits(state);
    const needle = menu.filter.trim().toLowerCase();
    const locale = strings.stepHintLocale;
    const matches = (name: string, id: string, extra = ''): boolean => !needle || name.toLowerCase().includes(needle) || operationHint(id, locale).toLowerCase().includes(needle) || extra.toLowerCase().includes(needle);
    const byFrame = new Map<string, AddableOperation[]>();
    const placed = menu.after ? recipeSteps(recipe, limits).find(step => step.id === menu.after) : undefined;
    const channels = placed ? placed.channels : limits.channels;
    const at = (frame: string): AddableOperation[] => {
        let entries = byFrame.get(frame);
        if (!entries) { entries = addableOperations(frame, lacks, channels); byFrame.set(frame, entries); }
        return entries;
    };
    const places = earlierPlaces(recipe, state, menu.after);
    const here: AddableOperation[] = [], earlier: Array<{ entry: AddableOperation; after: string | null; next?: RecipeStep }> = [], off: AddableOperation[] = [];
    for (const entry of at(menu.frame)) {
        if (!matches(entry.name, entry.operation.id)) continue;
        if (!entry.off) { here.push(entry); continue; }
        const place = entry.off === 'frame' ? places.find(item => !at(item.frame).find(other => other.operation.id === entry.operation.id)?.off) : undefined;
        const there = place ? at(place.frame).find(other => other.operation.id === entry.operation.id) : undefined;
        if (place && there) earlier.push({ entry: there, after: place.after, next: place.next });
        else off.push(entry);
    }
    const item = (entry: AddableOperation, after?: { after: string | null; next?: RecipeStep }): string => {
        const output = entry.operation.output === '*' ? menu.frame : entry.operation.output;
        const why = entry.off === 'frame' ? strings.stepOffFrame.replace('{frame}', menu.frame)
            : entry.off === 'refuses' ? strings.stepOffRefuses.replace('{frame}', menu.frame).replace('{reason}', entry.why ?? '')
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
    if (context.regionSettable && matches(strings.stepRegion, TIME_SLICE, `${strings.stepRegionPurpose} time_slice`)) {
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
    return groups.map(({ group, html }) => section(group, groupName[group], html)).join('')
        + section('earlier', strings.stepMenuEarlier, regionEarlier + earlier.map(({ entry, after, next }) => item(entry, { after, next })).join(''))
        + section('off', strings.stepMenuOff, regionOff + off.map(entry => item(entry)).join(''));
}

/** The menu: its title (the Frame here), the filter and the list. */
export function stepMenuHtml(menu: StepMenuState, context: StepMenuContext): string {
    const { strings } = context;
    return `<div class="step-menu" role="dialog" aria-label="${escapeHtml(strings.stepAdd)}" data-step-menu>`
        + `<div class="step-menu-title">${escapeHtml(strings.stepMenuTitle.replace('{frame}', menu.frame))}</div>`
        + `<input type="search" data-step-menu-filter placeholder="${escapeHtml(strings.stepMenuFilter)}" value="${escapeHtml(menu.filter)}">`
        + `<div class="step-menu-list">${stepMenuListHtml(menu, context)}</div></div>`;
}
