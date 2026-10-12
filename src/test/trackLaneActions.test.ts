import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachTrackLaneActions, type TrackLaneAction, type TrackLaneContext, type TrackLaneHandlers } from '../webview/runtime/trackLaneActions';
import type { RuntimeElement, TrackId } from '../webview/runtime/types';

function setup() {
    const dom = new JSDOM(`<!doctype html><body><div id="wrap">
        <button id="play" data-action="toggle-playback" data-track-id="t1"></button>
        <button id="up" data-action="offset-up" data-track-id="t2"></button>
        <button id="gone" data-action="remove-track" data-track-id="missing"></button>
        <button id="unknown" data-action="constructor" data-track-id="t1"></button>
        <span id="color" data-action="pick-color" data-track-id="t1" tabindex="0"></span>
    </div></body>`);
    const doc = dom.window.document;
    const calls: Array<{ action: TrackLaneAction; trackId: TrackId; trackIndex: number | null }> = [];
    const record = (action: TrackLaneAction) => (ctx: TrackLaneContext): void => { calls.push({ action, trackId: ctx.trackId, trackIndex: ctx.trackIndex }); };
    const actions: TrackLaneAction[] = ['toggle-playback', 'toggle-mute', 'stop-playback', 'remove-track', 'configure-calibration', 'offset-up', 'offset-down', 'pick-color'];
    const handlers = Object.fromEntries(actions.map((a) => [a, record(a)])) as TrackLaneHandlers;
    const indexes = new Map<string, number | null>([['t1', 0], ['t2', null]]);
    attachTrackLaneActions(doc.getElementById('wrap') as unknown as RuntimeElement, {
        trackIdFromElement: (el) => {
            const id = el.getAttribute('data-track-id');
            return id && indexes.has(id) ? id as TrackId : null;
        },
        trackIndexForId: (id) => indexes.get(id) ?? null,
    }, handlers);
    const click = (id: string) => doc.getElementById(id)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const key = (id: string, k: string) => {
        const event = new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
        doc.getElementById(id)!.dispatchEvent(event);
        return event.defaultPrevented;
    };
    return { calls, click, key };
}

test('click dispatches the target action with its resolved track id and index', () => {
    const { calls, click } = setup();
    click('play');
    click('up');
    assert.deepEqual(calls, [
        { action: 'toggle-playback', trackId: 't1', trackIndex: 0 },
        { action: 'offset-up', trackId: 't2', trackIndex: null },
    ]);
});

test('click ignores unknown tracks and inherited action names', () => {
    const { calls, click } = setup();
    click('gone');
    click('unknown');
    assert.deepEqual(calls, []);
});

test('Enter or Space on the color swatch opens the picker; other keys and actions do nothing', () => {
    const { calls, key } = setup();
    assert.equal(key('color', 'Enter'), true);
    assert.equal(key('color', ' '), true);
    assert.equal(key('color', 'a'), false);
    assert.equal(key('play', 'Enter'), false);
    assert.deepEqual(calls.map((c) => c.action), ['pick-color', 'pick-color']);
});
