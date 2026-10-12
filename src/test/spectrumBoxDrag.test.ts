import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectrumBoxDrag } from '../webview/runtime/spectrumBoxDrag';

test('a new drag is inactive and ignores updates', () => {
    const drag = new SpectrumBoxDrag();
    assert.equal(drag.active, false);
    drag.update({ freqNorm: 0.1, dbNorm: 0.1 });
    assert.equal(drag.box, null);
    assert.equal(drag.finish(), null);
});

test('begin copies the anchor into the current point', () => {
    const drag = new SpectrumBoxDrag();
    const anchor = { freqNorm: 0.1, dbNorm: 0.2 };
    drag.begin(anchor);
    assert.equal(drag.active, true);
    assert.deepEqual(drag.box, { anchor, current: { freqNorm: 0.1, dbNorm: 0.2 } });
    assert.notEqual(drag.box?.current, anchor);
});

test('update moves the current point and finish ends the drag', () => {
    const drag = new SpectrumBoxDrag();
    drag.begin({ freqNorm: 0.1, dbNorm: 0.2 });
    drag.update({ freqNorm: 0.3, dbNorm: 0.5 });
    assert.deepEqual(drag.finish(), { anchor: { freqNorm: 0.1, dbNorm: 0.2 }, current: { freqNorm: 0.3, dbNorm: 0.5 } });
    assert.equal(drag.active, false);
    assert.equal(drag.finish(), null);
});
