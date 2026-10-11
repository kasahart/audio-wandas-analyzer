import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installTrackReorderDrag } from '../webview/runtime/trackReorderDrag';
import type { RuntimeDocument, RuntimeElement, TrackId } from '../webview/runtime/types';

function setup() {
    const dom = new JSDOM('<div id="wrap">'
        + '<div class="track-row" id="row-a" data-track-id="a"><span class="track-drag-handle" id="handle-a" data-track-id="a"></span><span id="label-a"></span></div>'
        + '<div class="track-row" id="row-b" data-track-id="b"><span class="track-drag-handle" data-track-id="b"></span><span id="label-b"></span></div>'
        + '<div class="track-row" id="row-x" data-track-id="unknown"></div>'
        + '</div>');
    const document = dom.window.document;
    const reorders: Array<[TrackId, TrackId]> = [];
    installTrackReorderDrag(document as unknown as RuntimeDocument, document.getElementById('wrap') as unknown as RuntimeElement, {
        trackIdFromElement: el => {
            const id = el.getAttribute('data-track-id');
            return id === 'a' || id === 'b' ? id as TrackId : null;
        },
        rowFor: id => document.getElementById('row-' + id) as unknown as RuntimeElement | null,
        onReorder: (from, to) => reorders.push([from, to]),
    });
    const fire = (type: string, id: string) => {
        const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
        document.getElementById(id)!.dispatchEvent(event);
        return event;
    };
    return { document, reorders, fire };
}

test('dragging a handle onto another row reorders and clears drag styling', () => {
    const { document, reorders, fire } = setup();
    assert.equal(fire('dragstart', 'handle-a').defaultPrevented, false);
    assert.equal(document.getElementById('row-a')!.style.opacity, '0.4');
    assert.equal(fire('dragover', 'label-b').defaultPrevented, true);
    assert.ok(document.getElementById('row-b')!.classList.contains('drag-over'));
    fire('drop', 'label-b');
    assert.deepEqual(reorders, [['a', 'b']]);
    assert.equal(document.getElementById('row-a')!.style.opacity, '');
    assert.equal(document.querySelectorAll('.drag-over').length, 0);
});

test('dragstart outside a handle is cancelled and later drag events are ignored', () => {
    const { reorders, fire } = setup();
    assert.equal(fire('dragstart', 'label-a').defaultPrevented, true);
    assert.equal(fire('dragover', 'label-b').defaultPrevented, false);
    fire('drop', 'label-b');
    assert.deepEqual(reorders, []);
});

test('hovering or dropping on the source row or an unknown row does not reorder', () => {
    const { document, reorders, fire } = setup();
    fire('dragstart', 'handle-a');
    fire('dragover', 'label-a');
    assert.equal(document.querySelectorAll('.drag-over').length, 0);
    fire('drop', 'row-x');
    assert.deepEqual(reorders, []);
    assert.equal(document.getElementById('row-a')!.style.opacity, '');
});

test('dragend without a drop resets the drag state', () => {
    const { document, reorders, fire } = setup();
    fire('dragstart', 'handle-a');
    fire('dragover', 'label-b');
    fire('dragend', 'handle-a');
    assert.equal(document.getElementById('row-a')!.style.opacity, '');
    assert.equal(document.querySelectorAll('.drag-over').length, 0);
    fire('drop', 'label-b');
    assert.deepEqual(reorders, []);
});
