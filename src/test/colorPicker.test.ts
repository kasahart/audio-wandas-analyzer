import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installColorPicker } from '../webview/runtime/colorPicker';
import type { RuntimeDocument, RuntimeElement, TrackId } from '../webview/runtime/types';

function setup() {
    const dom = new JSDOM('<body><button id="anchor" data-action="pick-color" data-track-id="t1"></button><div id="outside"></div></body>');
    const document = dom.window.document;
    const picks: Array<[TrackId, string | null]> = [];
    const picker = installColorPicker(document as unknown as RuntimeDocument, {
        colors: ['#111111', '#222222'],
        resetLabel: 'Reset <default>',
        onPick: (trackId, color) => picks.push([trackId, color]),
    });
    const popover = document.getElementById('color-picker-popover')!;
    const anchor = document.getElementById('anchor') as unknown as RuntimeElement;
    const trackId = 't1' as TrackId;
    return { dom, document, picks, picker, popover, anchor, trackId };
}

test('installColorPicker renders a hidden popover with one swatch per color and an escaped reset label', () => {
    const { document, popover } = setup();
    assert.ok(popover.hasAttribute('hidden'));
    assert.deepEqual(
        Array.from(popover.querySelectorAll('.color-palette-swatch')).map(el => el.getAttribute('data-color')),
        ['#111111', '#222222'],
    );
    assert.equal(document.getElementById('color-reset-btn')!.textContent, 'Reset <default>');
});

test('open shows the popover below the anchor and close refocuses the anchor', () => {
    const { document, picker, popover, anchor, trackId } = setup();
    anchor.getBoundingClientRect = () => ({ bottom: 20, left: 30 }) as DOMRect;
    picker.open(trackId, anchor);
    assert.equal(picker.target(), trackId);
    assert.equal(popover.hasAttribute('hidden'), false);
    assert.equal(popover.style.top, '24px');
    assert.equal(popover.style.left, '30px');
    assert.equal(document.activeElement, popover);
    picker.close();
    assert.equal(picker.target(), null);
    assert.ok(popover.hasAttribute('hidden'));
    assert.equal(document.activeElement, anchor);
});

test('clicking a swatch picks its color and the reset button picks null', () => {
    const { picks, picker, popover, anchor, trackId } = setup();
    picker.open(trackId, anchor);
    (popover.querySelector('[data-color="#222222"]') as HTMLElement).click();
    assert.deepEqual(picks, [[trackId, '#222222']]);
    assert.ok(popover.hasAttribute('hidden'));
    picker.open(trackId, anchor);
    (popover.querySelector('#color-reset-btn') as HTMLElement).click();
    assert.deepEqual(picks, [[trackId, '#222222'], [trackId, null]]);
    assert.equal(picker.target(), null);
});

test('Enter on a swatch picks it and Escape closes without picking', () => {
    const { dom, picks, picker, popover, anchor, trackId } = setup();
    picker.open(trackId, anchor);
    const swatch = popover.querySelector('[data-color="#111111"]')!;
    swatch.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(picks, [[trackId, '#111111']]);
    picker.open(trackId, anchor);
    popover.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual(picks, [[trackId, '#111111']]);
    assert.ok(popover.hasAttribute('hidden'));
});

test('clicks outside close the popover but clicks on a color trigger do not', () => {
    const { document, picks, picker, popover, anchor, trackId } = setup();
    picker.open(trackId, anchor);
    (anchor as unknown as HTMLElement).click();
    assert.equal(popover.hasAttribute('hidden'), false);
    (document.getElementById('outside') as HTMLElement).click();
    assert.ok(popover.hasAttribute('hidden'));
    assert.deepEqual(picks, []);
});

test('picks are ignored when no track is targeted', () => {
    const { picks, popover } = setup();
    (popover.querySelector('[data-color="#111111"]') as HTMLElement).click();
    assert.deepEqual(picks, []);
});
