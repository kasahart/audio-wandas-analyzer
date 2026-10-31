import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { RecipeStep } from '../shared/recipe/recipeSteps';
import { attachStepDrag, attachStepHold, STEP_TAP_MS } from '../webview/runtime/stepGestures';
import { OCTAVE_BRANCH } from '../webview/runtime/stepBarModel';

type View = Pick<Window, 'setTimeout' | 'clearTimeout' | 'addEventListener'>;
const step = (id: string): RecipeStep => ({ id, operation: `wandas.x.${id}`, name: id, params: {}, editable: [], input: 'ChannelFrame', output: 'ChannelFrame' });
const chipsHtml = (ids: string[]): string => `<span data-step-input></span>`
    + ids.map(id => `<span class="step-chip" data-step-id="${id}"${id === OCTAVE_BRANCH ? '' : ' draggable="true"'}><button class="step-body" data-step-hold="${id}"></button></span>`).join('');

/** A bar of chips, and a window whose timers run when the test says so. */
function setup(ids: string[]) {
    const dom = new JSDOM(`<!doctype html><nav>${chipsHtml(ids)}</nav>`);
    const element = dom.window.document.querySelector('nav') as HTMLElement;
    const timers = new Map<number, { run: () => void; ms: number }>();
    let nextTimer = 1;
    const listeners = new Map<string, Array<() => void>>();
    const view = {
        setTimeout: (run: () => void, ms: number) => { timers.set(nextTimer, { run, ms }); return nextTimer++; },
        clearTimeout: (id: number) => { timers.delete(id); },
        addEventListener: (type: string, listener: () => void) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    } as unknown as View;
    const elapse = (): void => { const due = [...timers.values()]; timers.clear(); due.forEach(timer => timer.run()); };
    const fire = (type: string): void => (listeners.get(type) ?? []).forEach(listener => listener());
    const press = (id: string, button = 0): void => {
        element.querySelector(`[data-step-hold="${id}"]`)?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button }));
    };
    return { dom, element, view, timers, elapse, fire, press };
}

test('a press held past the tap time shows what the step does until release, and its click is no tap', () => {
    const { element, view, timers, elapse, fire, press } = setup(['a', 'b']);
    const holds: Array<string | null> = [];
    const hold = attachStepHold(element, view, { stepAt: id => (id ? step(id) : undefined), canHold: () => true, onHold: held => holds.push(held?.id ?? null) });
    press('a');
    assert.deepEqual([...timers.values()].map(timer => timer.ms), [STEP_TAP_MS]);
    elapse();
    assert.deepEqual(holds, ['a']);
    assert.ok(element.querySelector('[data-step-id="a"]')?.classList.contains('is-held'));
    fire('pointerup');
    assert.deepEqual(holds, ['a', null]);
    assert.equal(element.querySelector('.is-held'), null);
    assert.equal(hold.swallowed(), true);
    assert.equal(hold.swallowed(), false, 'asking takes the answer');
});

test('a tap is released before the hold starts: nothing is held and its click is a tap', () => {
    const { element, view, timers, fire, press } = setup(['a']);
    const holds: Array<string | null> = [];
    const hold = attachStepHold(element, view, { stepAt: id => (id ? step(id) : undefined), canHold: () => true, onHold: held => holds.push(held?.id ?? null) });
    press('a');
    fire('pointerup');
    assert.equal(timers.size, 0);
    assert.deepEqual(holds, []);
    assert.equal(hold.swallowed(), false);
});

test('a hold that ends without a pointer up (focus lost) lets the next click through; only steps that can be held are', () => {
    const { element, view, timers, elapse, fire, press } = setup(['a', 'b']);
    const holds: Array<string | null> = [];
    const hold = attachStepHold(element, view, { stepAt: id => (id ? step(id) : undefined), canHold: held => held.id === 'a', onHold: held => holds.push(held?.id ?? null) });
    press('a');
    elapse();
    fire('blur');
    assert.deepEqual(holds, ['a', null]);
    assert.equal(hold.swallowed(), false);
    press('b');
    press('a', 2);
    assert.equal(timers.size, 0, 'neither a step that cannot be held nor another button starts a hold');
});

test('a chip dropped on the right half of another goes after it, on the left half before it, on the input first', () => {
    const { dom, element } = setup(['a', 'b', 'c', OCTAVE_BRANCH]);
    const steps = ['a', 'b', 'c'].map(step);
    const moves: Array<[string, string | null]> = [];
    attachStepDrag(element, dom.window.document, { steps: () => steps, move: (moved, after) => moves.push([moved.id, after]) });
    const chip = (id: string): HTMLElement => element.querySelector(`[data-step-id="${id}"]`) as HTMLElement;
    for (const id of ['a', 'b', 'c', OCTAVE_BRANCH]) chip(id).getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) });
    const drag = (type: string, target: Element, clientX = 0): Event => {
        const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX });
        target.dispatchEvent(event);
        return event;
    };
    drag('dragstart', chip('a'));
    assert.ok(chip('a').classList.contains('is-dragging'));
    assert.equal(drag('dragover', chip(OCTAVE_BRANCH), 80).defaultPrevented, false, 'the branch is no place to drop');
    assert.equal(drag('dragover', chip('c'), 80).defaultPrevented, true);
    assert.ok(element.querySelector('.step-drop'));
    drag('drop', chip('c'));
    assert.deepEqual(moves, [['a', 'c']]);
    assert.equal(element.querySelector('.step-drop'), null);
    drag('dragend', chip('a'));
    assert.equal(element.querySelector('.is-dragging'), null);
    drag('dragstart', chip('c'));
    drag('dragover', chip('b'), 20);
    drag('drop', chip('b'));
    drag('dragend', chip('c'));
    drag('dragstart', chip('b'));
    drag('dragover', element.querySelector('[data-step-input]') as Element, 20);
    drag('drop', chip('b'));
    assert.deepEqual(moves, [['a', 'c'], ['c', 'a'], ['b', null]]);
    drag('dragend', chip('b'));
    assert.equal(element.querySelector('.is-dragging'), null);
});

test('without a Recipe nothing is dragged', () => {
    const { dom, element } = setup(['a']);
    const moves: unknown[] = [];
    attachStepDrag(element, dom.window.document, { steps: () => null, move: () => moves.push(1) });
    const chip = element.querySelector('[data-step-id="a"]') as HTMLElement;
    chip.dispatchEvent(new dom.window.MouseEvent('dragstart', { bubbles: true }));
    assert.equal(chip.classList.contains('is-dragging'), false);
});
