import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { attachOffsetEditing, isOffsetEditorOpen, openOffsetEditor } from '../webview/runtime/offsetInlineEditor';

const LABELS = { placeholder: 'ms', ariaLabel: 'Offset (ms)' };

function setup() {
    const dom = new JSDOM('<!doctype html><body><div id="row"><span class="track-offset-val">+0 ms</span></div></body>');
    const doc = dom.window.document;
    const span = doc.querySelector('.track-offset-val') as HTMLElement;
    const commits: Array<number | null> = [];
    const key = (input: HTMLElement, k: string) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, cancelable: true }));
    const blur = (input: HTMLElement) => input.dispatchEvent(new dom.window.FocusEvent('blur'));
    return { doc, span, commits, key, blur };
}

test('openOffsetEditor replaces the span with a prefilled number input', () => {
    const { doc, span, commits } = setup();
    openOffsetEditor(doc, span, 120, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input') as HTMLInputElement;
    assert.ok(input);
    assert.equal(input.type, 'number');
    assert.equal(input.value, '120');
    assert.equal(input.placeholder, 'ms');
    assert.equal(input.getAttribute('aria-label'), 'Offset (ms)');
    assert.equal(input.nextElementSibling, span);
    assert.equal(isOffsetEditorOpen(span), true);
    assert.equal(doc.activeElement, input);
});

test('Enter commits the parsed value once and restores the span', () => {
    const { doc, span, commits, key, blur } = setup();
    openOffsetEditor(doc, span, 0, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input') as HTMLInputElement;
    input.value = '-35.5';
    key(input, 'Enter');
    blur(input);
    assert.deepEqual(commits, [-35.5]);
    assert.equal(doc.querySelector('.track-offset-input'), null);
    assert.equal(isOffsetEditorOpen(span), false);
});

test('blur commits null for a non-numeric value', () => {
    const { doc, span, commits, blur } = setup();
    openOffsetEditor(doc, span, 10, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input') as HTMLInputElement;
    input.value = '';
    blur(input);
    assert.deepEqual(commits, [null]);
});

test('Escape closes without committing, and a second open while editing is ignored', () => {
    const { doc, span, commits, key } = setup();
    openOffsetEditor(doc, span, 10, LABELS, (ms) => commits.push(ms));
    openOffsetEditor(doc, span, 99, LABELS, (ms) => commits.push(ms));
    assert.equal(doc.querySelectorAll('.track-offset-input').length, 1);
    key(doc.querySelector('.track-offset-input') as HTMLElement, 'Escape');
    assert.deepEqual(commits, []);
    assert.equal(doc.querySelector('.track-offset-input'), null);
    assert.equal(isOffsetEditorOpen(span), false);
});

function setupWrapper() {
    const dom = new JSDOM('<!doctype html><body><div id="wrap"><span class="track-offset-val" data-index="1">+0 ms</span><span class="other">x</span></div></body>');
    const doc = dom.window.document;
    const wrapper = doc.getElementById('wrap') as HTMLElement;
    const span = doc.querySelector('.track-offset-val') as HTMLElement;
    const calls: string[] = [];
    attachOffsetEditing(wrapper, doc, LABELS, {
        trackIndexFromElement: (el) => (el.dataset.index ? Number(el.dataset.index) : null),
        currentOffsetMs: () => 250,
        onReset: (idx) => calls.push('reset:' + idx),
        onEdited: (idx, ms) => calls.push('edited:' + idx + ':' + ms),
    });
    const fire = (el: Element, type: string, detail = 1) => el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, detail }));
    /** One press as the browser tells it: `detail` is its count of presses in a row (2: a double click's second). */
    const press = (el: Element, detail: number) => { fire(el, 'mousedown', detail); fire(el, 'mouseup', detail); fire(el, 'click', detail); };
    /** A double click as the browser tells it, its second press landing where the first one's click left `second`. */
    const doubleClick = (first: Element, second: () => Element, between?: () => void) => {
        press(first, 1);
        between?.();
        const at = second();
        press(at, 2);
        fire(doc.querySelector('.track-offset-input') ?? at, 'dblclick', 2);
    };
    const editor = () => doc.querySelector<HTMLInputElement>('.track-offset-input');
    return { doc, span, calls, fire, press, doubleClick, editor, other: doc.querySelector('.other') as HTMLElement };
}

test('a click on the offset opens its editor at once, with no wait, and reports the edit (R13)', () => {
    const { span, calls, press, editor } = setupWrapper();
    press(span, 1);
    assert.equal(isOffsetEditorOpen(span), true, 'the editor opens on the click itself');
    const input = editor();
    assert.ok(input);
    assert.equal(input.value, '250');
    input.value = '-40';
    input.dispatchEvent(new (input.ownerDocument.defaultView as unknown as { FocusEvent: typeof FocusEvent }).FocusEvent('blur'));
    assert.deepEqual(calls, ['edited:1:-40']);
});

test('a double click on the offset resets it to 0 and leaves no editor, however slow: the browser decides it is one (R13)', () => {
    // Timers mocked: a click that waited on a timer of its own to tell a double click would open its editor here,
    // when the time between the presses (longer than any wait of ours, still a double click to the browser) is ticked.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { span, calls, doubleClick, editor } = setupWrapper();
        doubleClick(span, () => editor() ?? span, () => mock.timers.tick(1000));
        mock.timers.tick(1000);
        assert.equal(editor(), null, 'no editor is left open');
        assert.equal(isOffsetEditorOpen(span), false);
        assert.deepEqual(calls, ['reset:1'], 'the offset is reset once, and the opening took back commits nothing');
    } finally {
        mock.timers.reset();
    }
});

test('a double click on the offset resets it whether its second press lands on the editor or beside it (R13)', () => {
    const { span, calls, doubleClick, editor, other } = setupWrapper();
    doubleClick(span, () => other);
    assert.equal(editor(), null);
    assert.deepEqual(calls, ['reset:1']);
});

test('a press between a click and a second press makes it no double click: the editor the click opened stays (R13)', () => {
    const { span, calls, press, editor, other, fire } = setupWrapper();
    press(span, 1);
    fire(other, 'mousedown', 1);
    press(editor() ?? span, 2);
    assert.ok(editor(), 'the editor stays open');
    assert.deepEqual(calls, []);
});

test('attachOffsetEditing ignores clicks outside the offset label', () => {
    const { other, calls, press, fire, editor } = setupWrapper();
    press(other, 1);
    press(other, 2);
    fire(other, 'dblclick', 2);
    assert.equal(editor(), null);
    assert.deepEqual(calls, []);
});

test('the offset editor waits on no timer of its own: a click opens it, the browser tells a double click (R13)', () => {
    const source = readFileSync(path.resolve(__dirname, '..', '..', 'src', 'webview', 'runtime', 'offsetInlineEditor.ts'), 'utf8');
    assert.doesNotMatch(source, /\bset(?:Timeout|Interval)\s*\(|requestAnimationFrame\s*\(/, 'no timer decides a click from a double click');
});
