/**
 * One channel of a Tracks row (src/webview/charts/trackRow.ts, src/webview/screens/trackRowFigure.ts) against a
 * stand-in of the figure service: the spec it declares, the box it asks a picture for, and what it tells the screen.
 * The Figure's own behaviour is figureComponent.test.ts's and figureImageLane.test.ts's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureView } from '../shared/protocol/generated/backendProtocolSchema';
import { TRACK_SPECTROGRAM_LANE, TRACK_WAVE_LANE, trackRow } from '../webview/charts/trackRow';
import { createTrackRowFigure, type TrackRowFigureDeps } from '../webview/screens/trackRowFigure';
import { COLOUR_BAR_ROOM } from '../webview/figure/imageLane';
import { figurePage, rowPicture, WORDS } from './helpers/figureStandIn';

const BOTH = { waveform: true, spectrogram: true };
const AXIS = { left: 44, right: 0 };
const GAP = 4;
/** The row's box: the axis column, 600 px of plot, the colour bar's room; 60 px of waveform over 100 px of spectrogram. */
const BOX = { width: AXIS.left + 600 + COLOUR_BAR_ROOM, height: 60 + GAP + 100 };

function rowOn(page: ReturnType<typeof figurePage>, more: Partial<TrackRowFigureDeps> = {}, boxHeight = BOX.height) {
    const views: FigureView[] = [];
    const letGo: string[][] = [];
    Object.defineProperty(page.host, 'clientWidth', { value: BOX.width });
    Object.defineProperty(page.host, 'clientHeight', { value: boxHeight });
    const row = createTrackRowFigure({
        document: page.document, host: page.host, answers: page.answers, words: WORDS, label: 'take.wav, channel 1',
        margin: AXIS, laneGap: GAP, laneHeights: () => ({ [TRACK_WAVE_LANE]: 60, [TRACK_SPECTROGRAM_LANE]: 100 }),
        colour: () => '#4aa', name: () => 'take.wav ch1',
        viewed: view => { views.push(view); }, letGo: keys => { letGo.push([...keys]); },
        ...more,
    });
    return { row, views, letGo };
}
const answerAll = (page: ReturnType<typeof figurePage>, evicted: string[] = []): FigureDrawPayload[] => {
    const asked: FigureDrawPayload[] = [];
    for (let draws = page.draws(); draws.length; draws = page.draws()) {
        for (const draw of draws) { const payload = draw.message.payload as FigureDrawPayload; asked.push(payload); draw.answer(rowPicture(payload, evicted)); }
    }
    return asked;
};

test('a channel\'s spec is its waveform (a band lane) over its spectrogram (an image lane), each of its kept answer; a lane not shown or not kept is left out', () => {
    const spec = trackRow({ signal: 'sig', image: 'img' }, BOTH);
    assert.deepEqual(spec?.lanes.map(lane => [lane.id, lane.kind, lane.lines?.map(line => line.of)]), [[TRACK_WAVE_LANE, 'band', [{ key: 'sig' }]], [TRACK_SPECTROGRAM_LANE, 'image', [{ key: 'img' }]]]);
    assert.deepEqual(spec?.keys, [{ key: 'sig', state: 'usable', version: 'sig' }, { key: 'img', state: 'usable', version: 'img' }]);
    assert.deepEqual(trackRow({ signal: 'sig', image: 'img' }, { waveform: true, spectrogram: false })?.lanes.map(lane => lane.id), [TRACK_WAVE_LANE]);
    assert.deepEqual(trackRow({ signal: 'sig' }, BOTH)?.lanes.map(lane => lane.id), [TRACK_WAVE_LANE], 'the levels are not kept (yet): the waveform alone');
    assert.equal(trackRow({}, BOTH), null);
    // R4: the row's own answers say whether the channel is calibrated, so its axes say when it is not.
    assert.deepEqual(trackRow({ signal: 'sig', image: 'img', calibrated: false }, BOTH)?.keys.map(key => key.calibrated), [false, false]);
    assert.deepEqual(trackRow({ signal: 'sig', image: 'img', calibrated: true }, BOTH)?.keys.map(key => key.calibrated), [true, true]);
    assert.deepEqual(trackRow({ signal: 'sig' }, BOTH)?.keys.map(key => 'calibrated' in key), [false], 'not known: not said');
    assert.equal(trackRow({ signal: 'sig', image: 'img' }, { waveform: false, spectrogram: false }), null);
});

test('the row\'s Figure fills its box: the plots start at the rows\' axis column, each lane has the height the split gives, and nothing is ticked across', () => {
    const page = figurePage();
    const { row } = rowOn(page);
    row.show(trackRow({ signal: 'sig', image: 'img' }, BOTH), { x: [2, 6] });
    const [asked] = answerAll(page);
    assert.equal(asked.width, 600);
    assert.deepEqual(asked.view?.x, [2, 6], 'the time asked for is the recording\'s own, as handed');
    assert.deepEqual(asked.laneHeights, [{ lane: TRACK_WAVE_LANE, height: 60 }, { lane: TRACK_SPECTROGRAM_LANE, height: 100 }]);
    const lanes = row.inspect()?.lanes ?? [];
    assert.deepEqual(lanes.map(lane => lane.frame), [{ left: 44, top: 0, width: 600, height: 60 }, { left: 44, top: 60 + GAP, width: 600, height: 100 }]);
    assert.deepEqual(lanes.map(lane => lane.xTicks), [[], []]);
});

test('a box still shorter than the lanes set for it (read before the page laid the row out again) is drawn as tall as its lanes: no lane past the canvas (R4)', () => {
    const page = figurePage();
    // The box as the page had it for the waveform alone, while the row already shows both lanes.
    const { row } = rowOn(page, {}, 60);
    row.show(trackRow({ signal: 'sig', image: 'img' }, BOTH), { x: [2, 6] });
    answerAll(page);
    const canvas = page.document.querySelector('canvas')!;
    const lanes = row.inspect()?.lanes ?? [];
    assert.equal(lanes.length, 2);
    for (const lane of lanes) {
        assert.ok(lane.frame.top + lane.frame.height <= canvas.height, `the ${lane.id} lane ends at ${lane.frame.top + lane.frame.height} px on a canvas ${canvas.height} px high. Fix: the row's box is never taken shorter than its lanes (sizeOf in src/webview/screens/trackRowFigure.ts)`);
    }
});

test('the row keeps no range: a gesture is told to the screen, and what is shown next is what the screen hands', () => {
    const page = figurePage();
    const { row, views } = rowOn(page);
    const spec = trackRow({ signal: 'sig', image: 'img' }, BOTH);
    row.show(spec, { x: [0, 10] });
    answerAll(page);
    const figure = page.document.querySelector('canvas')!;
    figure.getBoundingClientRect = () => ({ left: 0, top: 0, width: BOX.width, height: BOX.height, right: BOX.width, bottom: BOX.height, x: 0, y: 0, toJSON: () => ({}) });
    page.mouse(figure, 'mousedown', 44 + 150, 30);
    page.mouse(page.document, 'mousemove', 44 + 450, 30, { buttons: 1 });
    page.mouse(page.document, 'mouseup', 44 + 450, 30);
    assert.equal(views.length, 1);
    assert.deepEqual(views[0].x?.map(end => Math.round((end ?? NaN) * 100) / 100), [2.5, 7.5]);
    assert.deepEqual(answerAll(page), [], 'nothing is asked until the screen shows the row again');
    row.show(spec, { x: [1, 9] });
    assert.deepEqual(answerAll(page).at(-1)?.view?.x, [1, 9]);
});

test('a click tells its time, Alt+drag a stretch of time, Shift+drag how far: the cursor, the loop and the offset are the screen\'s', () => {
    const page = figurePage();
    const placed: number[] = [], ranged: number[][] = [], shifted: Array<[number | null, boolean]> = [];
    const { row, views } = rowOn(page, { placed: seconds => { placed.push(seconds); }, ranged: (from, to) => { ranged.push([from, to]); }, shifted: (by, done) => { shifted.push([by, done]); } });
    row.show(trackRow({ signal: 'sig', image: 'img' }, BOTH), { x: [0, 10] });
    answerAll(page);
    const figure = page.document.querySelector('canvas')!;
    figure.getBoundingClientRect = () => ({ left: 0, top: 0, width: BOX.width, height: BOX.height, right: BOX.width, bottom: BOX.height, x: 0, y: 0, toJSON: () => ({}) });
    const round = (value: number | null): number => Math.round((value ?? NaN) * 100) / 100;
    page.mouse(figure, 'mousedown', 44 + 300, 100);
    page.mouse(page.document, 'mouseup', 44 + 300, 100);
    // The click acts on what the press read: nothing is read there, so the time under the pointer.
    for (const read of page.reads()) {
        const asked = read.message.payload as { figureId: string; pictureId: string; requestNumber: number };
        read.answer({ status: 'no-point', figureId: asked.figureId, pictureId: asked.pictureId, requestNumber: asked.requestNumber, lane: 'spectrogram' });
    }
    assert.deepEqual(placed.map(round), [5]);
    page.mouse(figure, 'mousedown', 44 + 60, 30, { altKey: true });
    page.mouse(page.document, 'mousemove', 44 + 180, 30, { buttons: 1, altKey: true });
    page.mouse(page.document, 'mouseup', 44 + 180, 30, { altKey: true });
    assert.deepEqual(ranged.map(range => range.map(round)), [[1, 3]]);
    page.mouse(figure, 'mousedown', 44 + 60, 30, { shiftKey: true });
    page.mouse(page.document, 'mousemove', 44 + 180, 30, { buttons: 1, shiftKey: true });
    page.mouse(page.document, 'mouseup', 44 + 180, 30, { shiftKey: true });
    assert.deepEqual(shifted.map(([by, done]) => [round(by), done]), [[2, false], [2, true]]);
    assert.deepEqual(views, [], 'none of them zooms');
});

test('an answer the backend let go is told to the screen, and the picture is asked once more when the row is shown again', () => {
    const page = figurePage();
    const { row, letGo } = rowOn(page);
    const spec = trackRow({ signal: 'sig', image: 'img' }, BOTH);
    row.show(spec, { x: [0, 10] });
    answerAll(page, ['img']);
    assert.deepEqual(letGo, [['img']]);
    // The screen asked the answer again (the same key) and shows the same spec: the Figure asks for its picture.
    row.show(spec, { x: [0, 10] });
    assert.equal(answerAll(page).length, 1);
    row.hide();
    assert.equal(row.shown(), false);
});
