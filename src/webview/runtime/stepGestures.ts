/** The step bar's pointer gestures: a chip's body tapped or held, and a chip dragged to move its step. */
import type { RecipeStep } from '../../shared/recipe/recipeSteps';
import { OCTAVE_BRANCH } from './stepBarModel';

/** A press shorter than this is a tap (see the step's Frame); longer is a hold (what the step does) until release. */
export const STEP_TAP_MS = 250;

export interface StepHold {
    /** Whether the click now arriving ends a hold, so is not a tap; asking takes the answer. */
    swallowed(): boolean;
}

/**
 * Tap or hold on a chip's body: a press shorter than STEP_TAP_MS shows the step's Frame (the click that follows,
 * which the bar answers); a longer one shows what the step does until release, and its click is swallowed.
 */
export function attachStepHold(element: HTMLElement, view: Pick<Window, 'setTimeout' | 'clearTimeout' | 'addEventListener'>, deps: {
    /** The chip's step pressed, or undefined when there is none to hold (no Recipe yet, or not a step). */
    stepAt(id: string | null): RecipeStep | undefined;
    canHold(step: RecipeStep): boolean;
    onHold(step: RecipeStep | null): void;
}): StepHold {
    let pressing: { step: RecipeStep; timer: number } | null = null;
    let held: RecipeStep | null = null;
    let swallowClick = false;
    element.addEventListener('pointerdown', event => {
        const body = (event.target as HTMLElement).closest<HTMLElement>('[data-step-hold]');
        swallowClick = false;
        if (!body || event.button !== 0) return;
        const step = deps.stepAt(body.getAttribute('data-step-hold'));
        if (!step || !deps.canHold(step)) return;
        pressing = {
            step,
            timer: view.setTimeout(() => {
                pressing = null;
                held = step;
                body.closest('.step-chip')?.classList.add('is-held');
                deps.onHold(step);
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
        deps.onHold(null);
    });
    return {
        swallowed() {
            const swallow = swallowClick;
            swallowClick = false;
            return swallow;
        },
    };
}

/**
 * Dragging a chip moves its step: the mark shows where it lands (before or after the chip under the pointer, or
 * first when over the input). `steps` are the Recipe's steps, empty while there is none.
 */
export function attachStepDrag(element: HTMLElement, document: Document, deps: {
    steps(): RecipeStep[] | null;
    move(step: RecipeStep, after: string | null): void;
}): void {
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
        if (!chip || !deps.steps()) return;
        dragged = chip.getAttribute('data-step-id');
        event.dataTransfer?.setData('text/plain', dragged ?? '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        chip.classList.add('is-dragging');
    });
    element.addEventListener('dragover', event => {
        const steps = deps.steps();
        if (!dragged || !steps) return;
        const target = (event.target as HTMLElement).closest?.<HTMLElement>('.step-chip, [data-step-input]');
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
        const steps = deps.steps();
        if (!dragged || dropAfter === undefined || !steps) return;
        event.preventDefault();
        const step = steps.find(item => item.id === dragged);
        const after = dropAfter;
        clearDrop();
        if (!step || after === dragged) return;
        dragged = null;
        deps.move(step, after);
    });
    element.addEventListener('dragend', () => { dragged = null; clearDrop(); element.querySelector('.is-dragging')?.classList.remove('is-dragging'); });
}
