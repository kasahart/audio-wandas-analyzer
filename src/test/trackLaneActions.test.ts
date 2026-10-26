import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachTrackLaneActions, type TrackLaneAction, type TrackLaneContext, type TrackLaneHandlers } from '../webview/runtime/trackLaneActions';
import type { TrackId } from '../webview/runtime/types';

function setup() {
    const dom = new JSDOM(`<!doctype html><body><div id="wrap">
        <button id="play" data-action="toggle-playback" data-track-id="t1"></button>
        <button id="up" data-action="offset-up" data-track-id="t2"></button>
        <button id="gone" data-action="remove-track" data-track-id="missing"></button>
        <button id="unknown" data-action="constructor" data-track-id="t1"></button>
    </div></body>`);
    const doc = dom.window.document;
    const calls: Array<{ action: TrackLaneAction; trackId: TrackId; trackIndex: number | null }> = [];
    const record = (action: TrackLaneAction) => (ctx: TrackLaneContext): void => { calls.push({ action, trackId: ctx.trackId, trackIndex: ctx.trackIndex }); };
    const actions: TrackLaneAction[] = ['toggle-playback', 'toggle-mute', 'stop-playback', 'remove-track', 'configure-calibration', 'offset-up', 'offset-down'];
    const handlers = Object.fromEntries(actions.map((a) => [a, record(a)])) as TrackLaneHandlers;
    const indexes = new Map<string, number | null>([['t1', 0], ['t2', null]]);
    attachTrackLaneActions(doc.getElementById('wrap') as unknown as HTMLElement, {
        trackIdFromElement: (el) => {
            const id = el.getAttribute('data-track-id');
            return id && indexes.has(id) ? id as TrackId : null;
        },
        trackIndexForId: (id) => indexes.get(id) ?? null,
    }, handlers);
    const click = (id: string) => doc.getElementById(id)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    return { calls, click };
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


test('a used … item and a press elsewhere close the track\'s … menu', () => {
    const dom = new JSDOM(`<body><div id="wrap"><details id="menu" class="track-more" open><summary>…</summary>
        <button id="up" data-action="offset-up" data-track-id="t1"></button></details></div><div id="outside"></div></body>`);
    const doc = dom.window.document;
    const calls: string[] = [];
    const handlers = { 'offset-up': () => calls.push('up') } as unknown as TrackLaneHandlers;
    attachTrackLaneActions(doc.getElementById('wrap') as unknown as HTMLElement, {
        trackIdFromElement: el => (el.getAttribute('data-track-id') as TrackId | null),
        trackIndexForId: () => 0,
    }, handlers);
    const menu = doc.getElementById('menu') as HTMLDetailsElement;
    doc.getElementById('up')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(calls, ['up']);
    assert.equal(menu.open, false);
    menu.open = true;
    doc.getElementById('outside')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(menu.open, false);
});
