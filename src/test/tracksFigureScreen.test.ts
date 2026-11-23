/**
 * The Tracks screen's two bottom figures on screen (src/webview/screens/tracksFigure.ts) against a stand-in of the
 * figure service: what the screen keeps and tells beside the Figure. The Figure's own behaviour is
 * figureComponent.test.ts's; the link of the two figures in a real browser is uiSmoke/pairSpectrum.spec.ts's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult } from '../shared/protocol/generated/backendProtocolSchema';
import { cursorSpectrum, type CursorSpectrumLine } from '../webview/charts/cursorSpectrum';
import { createTracksFigureScreen, laneLevel, rangesKept, type AcrossRange } from '../webview/screens/tracksFigure';
import { figurePage, WORDS } from './helpers/figureStandIn';

const PA = { unit: 'Pa', ref: 2e-5, label: 'dB SPL' };
const FS = { unit: 'FS', ref: 1, label: 'dBFS' };
const line = (track: string, level: typeof PA, key = `k-${track}`): CursorSpectrumLine => ({ id: `${track}:0`, key, level, calibrated: level === PA });
const PAINT = { name: (id: string) => id, colour: () => '#888' };

function screenOn(page: ReturnType<typeof figurePage>) {
    const ranged: AcrossRange[] = [];
    const letGo: string[][] = [];
    const screen = createTracksFigureScreen({
        document: page.document, host: page.host, answers: page.answers, words: WORDS, label: 'spectrum',
        empty: () => undefined, ranged: x => { ranged.push(x); }, letGo: keys => { letGo.push([...keys]); },
    });
    return { screen, ranged, letGo };
}
/** A picture of the lanes the draw's spec has, with no line, counting `evicted` as let go by the backend. */
function pictureOf(draw: FigureDrawPayload, evicted: string[]): FigureDrawResult {
    const axis = { quantity: 'level' as const, unit: 'FS', reference: 1, referenceLabel: 'dBFS', calibration: 'uncalibrated' as const, xScale: 'log' as const, yScale: 'linear' as const };
    return {
        status: 'picture', figureId: draw.figureId, generation: draw.generation, requestNumber: draw.requestNumber, pictureId: `p-${draw.generation}`, dataId: `d-${draw.generation}`,
        lanes: draw.spec.lanes.map(lane => ({ id: lane.id, axis, range: { x: [20, 20000], y: [-100, 0] }, whole: { x: [20, 20000], y: [-100, 0] }, lines: [] })),
        headlines: [],
        members: {
            shown: { used: [], n: 0, excluded: evicted.map(key => ({ key, reason: 'evicted' as const })) }, combined: { used: [], n: 0, excluded: [] }, calibration: 'uncalibrated',
            lines: [],
        },
    };
}

/** Answers every draw asked so far (a newer one is sent once the one before is answered); the range across the last asked for. */
function acrossAsked(page: ReturnType<typeof figurePage>): Array<number | null> | undefined {
    let last: Array<number | null> | undefined;
    for (let draws = page.draws(); draws.length; draws = page.draws()) {
        for (const draw of draws) {
            const payload = draw.message.payload as FigureDrawPayload;
            last = payload.view?.x ?? [null, null];
            draw.answer(pictureOf(payload, []));
        }
    }
    return last;
}

test('a range up is kept only while its lane is of the unit and reference it was set in: a lane\'s id is its place, and another unit can take it', () => {
    const both = cursorSpectrum([line('t1', PA), line('t2', FS)])!;
    assert.deepEqual(both.lanes.map(lane => lane.id), ['spectrum', 'spectrum-2']);
    const lanes = [{ lane: 'spectrum', y: [20, 90] }, { lane: 'spectrum-2', y: [-80, 0] }];
    const was = new Map(lanes.map(lane => [lane.lane, laneLevel(both, lane.lane)]));
    // The same tracks, another cursor (other keys): both ranges stay.
    const moved = cursorSpectrum([line('t1', PA, 'k2-t1'), line('t2', FS, 'k2-t2')])!;
    assert.deepEqual(rangesKept(lanes, was, moved), lanes);
    // The Pa track hidden: the first lane is the dBFS one now. The Pa range is not sent for it, and the dBFS range
    // (set on the second lane) has no lane left.
    const alone = cursorSpectrum([line('t2', FS)])!;
    assert.deepEqual(alone.lanes.map(lane => lane.id), ['spectrum']);
    assert.deepEqual(rangesKept(lanes, was, alone), []);
    // The rows the other way round: each place is the other unit's, so neither range is sent.
    const swapped = cursorSpectrum([line('t2', FS), line('t1', PA)])!;
    assert.deepEqual(rangesKept(lanes, was, swapped), []);
    // A lane of keys that declare no level (the pair figure's) keeps its range.
    assert.deepEqual(rangesKept([{ lane: 'gain', y: [-20, 20] }], new Map(), { lanes: [{ id: 'gain', kind: 'lines', lines: [{ id: 'a', of: { key: 'g' } }] }], keys: [{ key: 'g', state: 'usable', version: 'g' }] }), [{ lane: 'gain', y: [-20, 20] }]);
});

test('forgetting the range (bands for bins, log for linear) tells the figure sharing the axis, once, and only when a range across was set', () => {
    const page = figurePage();
    const { screen, ranged } = screenOn(page);
    screen.show(cursorSpectrum([line('t1', FS)]), PAINT);
    screen.whole();
    assert.deepEqual(ranged, [], 'no range was set: nothing to forget');
    // The range the other figure set here is not told back to it; forgetting it is.
    screen.across([100, 2000]);
    assert.deepEqual(ranged, []);
    assert.deepEqual(acrossAsked(page), [100, 2000]);
    screen.whole();
    assert.deepEqual(ranged, [[null, null]]);
    assert.deepEqual(acrossAsked(page), [null, null]);
    screen.hide();
});

/** Answers every draw asked so far with a picture that counts `evicted` as let go; how many were asked, and the last one's range. */
function answerAll(page: ReturnType<typeof figurePage>, evicted: string[] = []): { asked: number; view: FigureDrawPayload['view'] | undefined } {
    let asked = 0, view: FigureDrawPayload['view'] | undefined;
    for (let draws = page.draws(); draws.length; draws = page.draws()) {
        for (const draw of draws) {
            const payload = draw.message.payload as FigureDrawPayload;
            asked += 1;
            view = payload.view;
            draw.answer(pictureOf(payload, evicted));
        }
    }
    return { asked, view };
}
/** A box dragged over the first lane's plot (the host is 600 by 140: two lanes of about 46 px, the first from 10 px down). */
function boxOnFirstLane(page: ReturnType<typeof figurePage>): void {
    const canvas = page.document.querySelector('canvas') as HTMLCanvasElement;
    page.mouse(canvas, 'mousedown', 150, 18);
    page.mouse(canvas, 'mousemove', 300, 44, { buttons: 1 });
    page.mouse(canvas, 'mouseup', 300, 44);
}

test('a range up set while the picture of a new spec is on its way is of the lane on show: it is not sent for the unit that took its place', () => {
    const page = figurePage();
    const { screen } = screenOn(page);
    const both = cursorSpectrum([line('t1', PA), line('t2', FS)]);
    screen.show(both, PAINT);
    answerAll(page);
    // On the picture of both: the box sets the Pa lane's range, and it is sent with the next draw.
    boxOnFirstLane(page);
    const set = answerAll(page).view;
    assert.equal(set?.lanes?.length, 1);
    assert.equal(set?.lanes?.[0].lane, 'spectrum');
    screen.whole();
    answerAll(page);
    // The Pa track is hidden: the first lane is the dBFS one now, and its picture is on its way. The picture on
    // show is still the one of both, and the box is drawn on its Pa lane: no range up is sent for the dBFS lane.
    screen.show(cursorSpectrum([line('t2', FS)]), PAINT);
    boxOnFirstLane(page);
    const waited = answerAll(page).view;
    assert.ok(waited?.x?.some(end => end !== null), 'the range across is no lane\'s: it is kept');
    assert.deepEqual(waited?.lanes ?? [], []);
    // Another cursor meanwhile (other keys, the same units): the range set on the lane on show is that lane's.
    screen.whole();
    screen.show(both, PAINT);
    answerAll(page);
    screen.show(cursorSpectrum([line('t1', PA, 'k2-t1'), line('t2', FS, 'k2-t2')]), PAINT);
    boxOnFirstLane(page);
    assert.equal(answerAll(page).view?.lanes?.[0].lane, 'spectrum');
    screen.hide();
});

test('kept answers a picture counts as let go by the backend are told to the screen\'s owner; asked again under the same key, the picture is asked once more', () => {
    const page = figurePage();
    const { screen, letGo } = screenOn(page);
    const spec = () => cursorSpectrum([line('t1', FS), line('t2', FS)]);
    screen.show(spec(), PAINT);
    assert.equal(answerAll(page, ['k-t2']).asked, 1);
    assert.deepEqual(letGo, [['k-t2']]);
    // The owner asked again and shows the same spec (a kept answer's key is of what it was made from): the Figure
    // would only paint, so its picture is asked once more. It holds every answer now: nothing more is told or asked.
    screen.show(spec(), PAINT);
    assert.equal(answerAll(page).asked, 1);
    assert.equal(letGo.length, 1);
    screen.show(spec(), PAINT);
    assert.equal(answerAll(page).asked, 0);
    screen.hide();
});

test('an answer let go again every time (a store too small to keep it) is asked again twice and then left: no request without end', () => {
    const page = figurePage();
    const { screen, letGo } = screenOn(page);
    const spec = () => cursorSpectrum([line('t1', FS), line('t2', FS)]);
    let asked = 0;
    for (let round = 0; round < 6; round += 1) {
        screen.show(spec(), PAINT);
        asked += answerAll(page, ['k-t2']).asked;
    }
    assert.deepEqual(letGo, [['k-t2'], ['k-t2']]);
    assert.equal(asked, 3, 'the first picture and one more after each asking');
    // Another key (the cursor moved): it is told again.
    screen.show(cursorSpectrum([line('t1', FS), line('t2', FS, 'k9-t2')]), PAINT);
    answerAll(page, ['k9-t2']);
    assert.deepEqual(letGo[2], ['k9-t2']);
    screen.hide();
});
