/**
 * The Tracks screen's rows on the Figure path (src/webview/screens/trackRows.ts) against a stand-in of the host and
 * of the figure service: what the rows ask the host for, which answers each channel is drawn from, and when they are
 * asked again. One channel's Figure is trackRowFigure.test.ts's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload } from '../shared/protocol/generated/backendProtocolSchema';
import { createTrackRows, type TrackRowsDeps, type TrackRowsReply, type TrackRowsRequest, type TrackRowsTrack } from '../webview/screens/trackRows';
import { createFailureHold, FAILED_RETRY_MS } from '../webview/runtime/answerStore';
import { sharedTimeOf } from '../webview/screens/trackRowsScreen';
import { trackRow } from '../webview/charts/trackRow';
import { figurePage, rowPicture, WORDS } from './helpers/figureStandIn';

const TRACK: TrackRowsTrack = { id: 't1', index: 0, filePath: '/a.wav', sourceVersion: 'v1', channels: 2, colour: '#4aa', name: channel => `a.wav ch${channel + 1}`, label: channel => `a.wav · ch${channel + 1} · waveform and spectrogram`, window: [0, 10], durationSeconds: 10 };
const reply = (tag: string, more: Partial<TrackRowsReply> = {}): TrackRowsReply => ({
    channels: [0, 1].map(channelIndex => ({ channelIndex, signal: `sig${channelIndex}`, image: `${tag}${channelIndex}`, signalExtent: `${tag}-samples${channelIndex}`, imageExtent: `${tag}-levels${channelIndex}` })),
    sampleRateHz: 48000, durationSeconds: 10, windowSize: 2048, hopSize: 512, windowed: false, ...more,
});

function rowsOn(more: Partial<TrackRowsDeps> = {}) {
    const page = figurePage();
    const posted: TrackRowsRequest[] = [];
    const said: Array<[number, string | null, string | undefined] | [number, string | null, string | undefined, string]> = [];
    // A box per recording and channel (two channels each).
    const hosts = new Map<string, HTMLElement>();
    const hostOf = (track: string, channel: number): HTMLElement | null => {
        if (channel > 1) return null;
        const key = `${track}/${channel}`;
        if (!hosts.has(key)) { const host = page.document.createElement('div'); page.document.body.appendChild(host); hosts.set(key, host); }
        return hosts.get(key) ?? null;
    };
    const world = { signature: 's1', spec: 100, now: 0, woken: 0, zoom: null as { startNorm: number; endNorm: number } | null };
    let count = 0;
    const rows = createTrackRows({
        document: page.document, answers: page.answers, words: WORDS, axisWidth: 44, laneGap: 4,
        host: (track, channel) => hostOf(track.id, channel), readout: () => null,
        heights: () => ({ wave: 60, spec: world.spec }),
        analysisId: () => 'a1', settingsSignature: () => world.signature,
        requestId: () => `r${++count}`, post: request => { posted.push(request); },
        // The whole file's frames serve until the test zooms (world.zoom: the window the view needs).
        zoomWindow: () => world.zoom,
        serves: (_track, _whole, window) => (world.zoom ? window !== null && window.startNorm === world.zoom.startNorm && window.endNorm === world.zoom.endNorm : true),
        ranges: () => ({ amplitude: [null, null], frequency: [null, null], colour: [null, null] }),
        says: (_track, channel, state, reason, lane) => { said.push(lane ? [channel, state, reason, lane] : [channel, state, reason]); },
        viewed: () => undefined, placed: () => undefined, ranged: () => undefined, shifted: () => undefined, read: () => undefined, reset: () => undefined,
        lanes: () => undefined, drawn: () => undefined,
        // The answer store's hold, as the screen hands it: once a pause is over the rows shown are shown again.
        failures: createFailureHold(() => world.now, () => { world.woken += 1; }),
        ...more,
    });
    /** The keys each Figure asked a picture of, since the last call: a channel's waveform and levels. */
    const drawn = (): string[][] => {
        const out = page.draws().map(draw => (draw.message.payload as FigureDrawPayload).spec.keys.map(key => key.key));
        return out;
    };
    return { rows, posted, said, world, drawn, page };
}

test('a recording\'s rows ask its answers once, say they are on their way, and each channel is drawn from its own kept samples and levels', () => {
    const { rows, posted, said, drawn } = rowsOn();
    rows.show([TRACK]);
    rows.show([TRACK]);
    assert.deepEqual(posted.map(({ type, trackIndex, filePath, sourceVersion, answers, analysisId, settingsSignature, startNorm }) => ({ type, trackIndex, filePath, sourceVersion, answers, analysisId, settingsSignature, startNorm })),
        [{ type: 'request-track-detail', trackIndex: 0, filePath: '/a.wav', sourceVersion: 'v1', answers: 'linear', analysisId: 'a1', settingsSignature: 's1', startNorm: undefined }]);
    assert.deepEqual(said.at(-1), [1, 'pending', undefined]);
    assert.deepEqual(drawn(), []);
    assert.equal(rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') }), true);
    assert.deepEqual(drawn(), [['sig0', 'img0'], ['sig1', 'img1']]);
    assert.deepEqual(said.slice(-2), [[0, null, undefined], [1, null, undefined]]);
    assert.equal(rows.handle({ type: 'track-answers-result', requestId: 'someone-elses' }), false);
});

test('rows showing no spectrogram ask for the samples alone, and asking under other settings forgets the answers before', () => {
    const { rows, posted, world, page } = rowsOn();
    world.spec = 0;
    rows.show([TRACK]);
    assert.equal(posted[0].spectrogram, false);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') });
    const first = page.draws();
    assert.deepEqual(first.map(draw => (draw.message.payload as FigureDrawPayload).spec.keys.map(key => key.key)), [['sig0'], ['sig1']], 'the waveform alone');
    for (const draw of first) draw.answer(rowPicture(draw.message.payload as FigureDrawPayload));
    // The pointer on the first row reads the point there.
    const canvas = page.document.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 60, right: 600, bottom: 60, x: 0, y: 0, toJSON: () => ({}) });
    page.mouse(canvas, 'mousemove', 200, 20);
    assert.equal(page.reads().length, 1, 'a row of the settings shown is read');
    page.mouse(canvas, 'mouseleave', 0, 0);
    world.signature = 's2';
    rows.show([TRACK]);
    assert.equal(posted.length, 2, 'asked again under the new settings');
    assert.equal(rows.held('t1')?.whole, null);
    // Until they are in, the picture before stays, told to its Figure as stale: nothing is read off it (R7).
    assert.deepEqual(page.draws(), [], 'the picture stays as drawn');
    page.mouse(canvas, 'mousemove', 220, 20);
    assert.deepEqual(page.reads(), [], 'and no point of it is read');
    // The answer of the settings before, landing late, is of nothing now.
    assert.equal(rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('old') }), false);
    assert.equal(rows.held('t1')?.whole, null);
});

test('a zoomed row asks for the window on screen once the time stands still, and shows its levels once they are in; until then the whole file\'s stay', () => {
    const { rows, posted, world, page } = rowsOn();
    const answerDraws = (): void => { for (const draw of page.draws()) draw.answer(rowPicture(draw.message.payload as FigureDrawPayload)); };
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') });
    answerDraws();
    world.zoom = { startNorm: 0.4, endNorm: 0.5 };
    const zoomed = { ...TRACK, window: [4, 5] as const };
    rows.show([zoomed]);
    assert.equal(posted.length, 1, 'the time on screen just moved: no window is asked yet');
    // The pictures of this place are in: the time stands still, and the window it lacks is asked.
    answerDraws();
    assert.deepEqual([posted[1].startNorm, posted[1].endNorm], [0.4, 0.5]);
    rows.show([zoomed]);
    assert.equal(posted.length, 2, 'one window on its way at a time');
    rows.handle({ type: 'track-answers-result', requestId: posted[1].requestId, ...reply('zoom', { windowed: true, hopSize: 8 }) });
    assert.deepEqual(rows.held('t1')?.zoom?.startNorm, 0.4);
    answerDraws();
    assert.equal(posted.length, 2, 'the window serves: nothing more is asked');
});

test('while the time on screen moves no window is asked: each would be of a place already left; shown at the same time once more, it is', () => {
    const { rows, posted, world, page } = rowsOn();
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') });
    for (const draw of page.draws()) draw.answer(rowPicture(draw.message.payload as FigureDrawPayload));
    // Scrolled on and on: the window the view needs is another at every showing, and no picture has come yet.
    for (const at of [4, 5, 6, 7]) {
        world.zoom = { startNorm: at / 10, endNorm: (at + 1) / 10 };
        rows.show([{ ...TRACK, window: [at, at + 1] }]);
    }
    assert.equal(posted.length, 1, 'nothing asked on the way');
    // Shown again where it is (the page drew again for another reason): it stands still, and the window is asked.
    rows.show([{ ...TRACK, window: [7, 8] }]);
    assert.deepEqual([posted[1]?.startNorm, posted[1]?.endNorm], [0.7, 0.8]);
});

test('answers the backend\'s store let go are asked again without another gesture: the rows are shown again once the picture told of it', async () => {
    const { rows, posted, page } = rowsOn();
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') });
    assert.equal(posted.length, 1);
    // The service answers a row's draw: its levels are no longer kept (its store made room).
    for (const draw of page.draws()) draw.answer(rowPicture(draw.message.payload as FigureDrawPayload, ['img0']));
    // Nothing else happens on the page: the rows themselves ask the recording's answers again.
    await Promise.resolve();
    assert.equal(posted.length, 2, 'the answers are asked again');
    assert.equal(posted[1].filePath, '/a.wav');
    // Once (a second row told of the same loss asks nothing more).
    await Promise.resolve();
    assert.equal(posted.length, 2);
});

test('recordings that do not fit the store together do not ask each other\'s answers away without end: a row asks again by itself a few times only', async () => {
    // Two recordings with linked scales: each one's answers landing changes what the other's rows name, so the other
    // draws again and finds its own levels let go (the store made room for the one that landed).
    const other: TrackRowsTrack = { ...TRACK, id: 't2', index: 1, filePath: '/b.wav' };
    const { rows, posted, page } = rowsOn({ linked: () => [TRACK, other] });
    const replyOf = (request: TrackRowsRequest): TrackRowsReply => {
        const made = reply(request.filePath === '/a.wav' ? 'a' : 'b');
        return request.filePath === '/a.wav' ? made : { ...made, channels: made.channels.map(channel => ({ ...channel, signal: `b${channel.signal}` })) };
    };
    rows.show([TRACK, other]);
    assert.equal(posted.length, 2);
    let answered = 0;
    for (let round = 0; round < 12 && answered < posted.length; round += 1) {
        const request = posted[answered];
        answered += 1;
        rows.handle({ type: 'track-answers-result', requestId: request.requestId, ...replyOf(request) });
        // The recording that landed is kept; the other's levels were let go for it.
        const lost = request.filePath === '/a.wav' ? ['b0', 'b1'] : ['a0', 'a1'];
        for (let turn = 0; turn < 4; turn += 1) {
            for (const draw of page.draws()) {
                const payload = draw.message.payload as FigureDrawPayload;
                draw.answer(rowPicture(payload, lost.filter(key => payload.spec.lanes.some(lane => lane.lines.some(line => line.of.key === key)))));
            }
            await Promise.resolve();
        }
    }
    assert.equal(answered, posted.length, 'the askings end');
    assert.ok(posted.length <= 2 + 2 * 2, `after a few (${posted.length})`);
    // A showing from outside (a gesture, a scroll) asks what is missing again.
    const missing = ['t1', 't2'].filter(id => rows.held(id)?.whole === null).length;
    const before = posted.length;
    rows.show([TRACK, other]);
    assert.equal(posted.length, before + missing);
});

test('linked, a row shares its scales with every recording, on screen or not: the others\' extents are asked alone, two at a time, and named by every lane', () => {
    // Four recordings linked; the first alone is in view.
    const others: TrackRowsTrack[] = [1, 2, 3].map(index => ({ ...TRACK, id: `t${index + 1}`, index, filePath: `/${index}.wav` }));
    const { rows, posted, page } = rowsOn({ linked: () => [TRACK, ...others] });
    const lanesOf = (): string[][] => {
        // The service answers every picture asked; the last one's lanes.
        const payloads = page.draws().map(draw => { const payload = draw.message.payload as FigureDrawPayload; draw.answer(rowPicture(payload)); return payload; });
        return payloads.at(-1)?.spec.lanes.map(lane => [...(lane.scaleWith ?? [])]) ?? [];
    };
    rows.show([TRACK]);
    // The row's own answers (which name its extents too), and the extents alone of two of the others.
    assert.deepEqual(posted.map(request => [request.filePath, request.extents ?? false]), [['/a.wav', false], ['/1.wav', true], ['/2.wav', true]]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('a') });
    assert.deepEqual(lanesOf(), [['a-samples0', 'a-samples1'], ['a-levels0', 'a-levels1']], 'its own extents, both channels\'');
    // An other's extents land: the rows name them, and the next recording's are asked.
    const extents = (tag: string): TrackRowsReply => ({ ...reply(tag), channels: reply(tag).channels.map(({ channelIndex, signalExtent, imageExtent }) => ({ channelIndex, signalExtent, imageExtent })) });
    rows.handle({ type: 'track-answers-result', requestId: posted[1].requestId, ...extents('b') });
    assert.deepEqual(lanesOf(), [['a-samples0', 'a-samples1', 'b-samples0', 'b-samples1'], ['a-levels0', 'a-levels1', 'b-levels0', 'b-levels1']]);
    assert.deepEqual(posted.slice(3).map(request => [request.filePath, request.extents ?? false]), [['/3.wav', true]]);
    // Nothing of a recording that is not in view is asked but its extents; told once, they are not asked again.
    rows.handle({ type: 'track-answers-result', requestId: posted[2].requestId, ...extents('c') });
    lanesOf();
    rows.handle({ type: 'track-answers-result', requestId: posted[3].requestId, ...extents('d') });
    assert.equal(lanesOf()[0].length, 8, 'every recording\'s, both channels\'');
    rows.show([TRACK]);
    assert.equal(posted.length, 4);
});

test('over thirty linked recordings the levels\' extents are not computed unasked: the samples\' alone are asked of those not in view', () => {
    const many: TrackRowsTrack[] = Array.from({ length: 31 }, (_, index) => ({ ...TRACK, id: `m${index}`, index, filePath: `/${index}.wav` }));
    const { rows, posted } = rowsOn({ linked: () => many });
    rows.show([many[0]]);
    assert.deepEqual(posted.map(request => [request.filePath, request.extents ?? false, request.spectrogram ?? true]), [['/0.wav', false, true], ['/1.wav', true, false], ['/2.wav', true, false]]);
});

test('after the settings change a zoomed row keeps the picture of its window, as stale: no other picture is asked meanwhile', () => {
    const { rows, posted, world, page } = rowsOn();
    /** The service answers every picture asked; the keys each was asked of. */
    const pictures = (): string[][] => page.draws().map(draw => {
        const payload = draw.message.payload as FigureDrawPayload;
        draw.answer(rowPicture(payload));
        return payload.spec.keys.map(key => key.key);
    });
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img') });
    pictures();
    world.zoom = { startNorm: 0.4, endNorm: 0.5 };
    const zoomed = { ...TRACK, window: [4, 5] as const };
    rows.show([zoomed]);
    pictures();
    rows.handle({ type: 'track-answers-result', requestId: posted[1].requestId, ...reply('zoom', { windowed: true, hopSize: 8 }) });
    assert.deepEqual(pictures().at(-1), ['sig1', 'zoom1'], 'drawn from the window\'s levels');
    world.signature = 's2';
    rows.show([zoomed]);
    // The spec of the whole file's levels would be another picture, and one of stale answers has nothing in it.
    assert.deepEqual(pictures(), [], 'the picture of the window stays');
});

test('a lane with nothing to draw from says why in its place while the other lane is drawn: too short for the STFT, or too large to keep', () => {
    const { rows, posted, said, world, drawn } = rowsOn();
    rows.show([TRACK]);
    // The recording is shorter than the STFT's window: its samples are kept, and no levels.
    const short: TrackRowsReply = { ...reply('img'), noLevels: 'too-short', channels: [0, 1].map(channelIndex => ({ channelIndex, signal: `sig${channelIndex}` })) };
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...short });
    assert.deepEqual(drawn(), [['sig0'], ['sig1']], 'the waveform is drawn');
    assert.deepEqual(said.slice(-2), [[0, 'too-short', undefined, 'spectrogram'], [1, 'too-short', undefined, 'spectrogram']]);
    // Zoomed in, no window's levels are asked of it either, and nothing is asked again.
    world.zoom = { startNorm: 0.4, endNorm: 0.5 };
    rows.show([{ ...TRACK, window: [4, 5] }]);
    assert.equal(posted.length, 1);
    // Other settings: the levels of one channel are over what the store keeps.
    world.zoom = null;
    world.signature = 's2';
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[1].requestId, ...reply('img'), channels: [{ channelIndex: 0, signal: 'sig0', image: 'img0' }, { channelIndex: 1, signal: 'sig1' }] });
    assert.deepEqual(said.slice(-2), [[0, null, undefined], [1, 'too-large', undefined, 'spectrogram']]);
});

test('a failed asking says why, is not asked again at once, and is asked again after the answer store\'s pause, which wakes the screen', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rows, posted, said, world } = rowsOn();
    rows.show([TRACK]);
    assert.equal(rows.handle({ type: 'track-detail-error', requestId: posted[0].requestId, error: 'backend gone' }), true);
    assert.deepEqual(said.at(-1), [1, 'failed', 'backend gone']);
    rows.show([TRACK]);
    world.now = FAILED_RETRY_MS - 1;
    rows.show([TRACK]);
    assert.equal(posted.length, 1, 'the pause is the store\'s own (FAILED_RETRY_MS): no time of the rows\'');
    assert.equal(world.woken, 0);
    // The store wakes whoever made the hold once the pause is over; shown again then, the rows ask.
    world.now = FAILED_RETRY_MS + 10;
    t.mock.timers.tick(FAILED_RETRY_MS + 10);
    assert.equal(world.woken, 1, 'the screen is told the pause is over: a failed row does not wait for a gesture');
    rows.show([TRACK]);
    assert.equal(posted.length, 2);
});

test('a channel whose answers the store refused says it is too large; a row out of view loses its Figure and keeps its answers', () => {
    const { rows, posted, said } = rowsOn();
    rows.show([TRACK]);
    rows.handle({ type: 'track-answers-result', requestId: posted[0].requestId, ...reply('img'), channels: [{ channelIndex: 0, signal: 'sig0', image: 'img0' }, { channelIndex: 1 }] });
    assert.deepEqual(said.slice(-2), [[0, null, undefined], [1, 'too-large', undefined]]);
    assert.ok(rows.inspect('t1', 0));
    assert.equal(rows.inspect('t1', 1), null);
    rows.show([]);
    assert.equal(rows.inspect('t1', 0), null);
    rows.show([TRACK]);
    assert.equal(posted.length, 1, 'not asked again');
    assert.ok(rows.inspect('t1', 0));
});

test('linked, each lane names the other rows\' kept answers of its kind for its scale and lists them among its keys; unlinked, it names none', () => {
    const shows = { waveform: true, spectrogram: true };
    const alone = trackRow({ signal: 'sig0', image: 'img0' }, shows);
    assert.deepEqual(alone?.lanes.map(lane => lane.scaleWith), [undefined, undefined]);
    assert.deepEqual(alone?.keys.map(key => key.key), ['sig0', 'img0']);
    // Linked: the waveform lane names the other rows' samples, the spectrogram lane their levels, never its own; which
    // of them are of its unit and what scale they share is the figure service's (python-backend/test_tracks_linked_scales.py).
    const linked = trackRow({ signal: 'sig0', image: 'img0' }, shows, true, { signals: ['sig0', 'sig1', 'sig2'], images: ['img0', 'img1'] });
    assert.deepEqual(linked?.lanes.map(lane => lane.scaleWith), [['sig1', 'sig2'], ['img1']]);
    // Its own answers are stale with its file; the others are named for their scale only, as they are kept.
    assert.deepEqual(linked?.keys.map(key => [key.key, key.state]), [['sig0', 'stale'], ['img0', 'stale'], ['sig1', 'usable'], ['sig2', 'usable'], ['img1', 'usable']]);
    // Linked with nothing else kept: no lane names anything.
    assert.deepEqual(trackRow({ signal: 'sig0' }, shows, false, { signals: ['sig0'], images: [] })?.lanes.map(lane => lane.scaleWith), [undefined]);
});

test('a Figure\'s ends across are the screen\'s shared time: the recording\'s place on it, blank ends its whole, a pan past an end keeps its length', () => {
    // A 10 s recording that starts a quarter along the shared time and takes half of it.
    const row = { start: 0.25, length: 0.5, durationSeconds: 10 };
    assert.deepEqual(sharedTimeOf(row, [2, 6]), { start: 0.35, end: 0.55 });
    assert.deepEqual(sharedTimeOf(row, [null, null]), { start: 0, end: 1 });
    // Before the recording, and past the shared time's end: shifted back inside, as long as asked.
    assert.deepEqual(sharedTimeOf(row, [-7, -1]), { start: 0, end: 0.3 });
    const past = sharedTimeOf(row, [12, 16]);
    assert.ok(Math.abs(past.start - 0.8) < 1e-12 && past.end === 1);
});
