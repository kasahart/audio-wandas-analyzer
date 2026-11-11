import assert from 'node:assert/strict';
import { assertNotDrawn, averagedInto, peaksInto } from './fullNotDrawn';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import type { PairSpectrumResult, StageView } from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { isRequestPairSpectrumMessage, type PairSpectrumRequest } from '../shared/utils/audioTarget';
import { DEFAULT_THEME } from '../webview/draw/canvasDrawers';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import {
    PAIR_LANES, pairLanes, pairHeader, type PairLaneKey, pairLegendHtml, referenceButtonHtml, syncReferenceButtons,
    type PairCurve, type PairSpectrumResponse, type PairSpectrumResultMessage,
} from '../webview/runtime/pairSpectrum';
import { byLevel, stageRange, STAGE_MARGINS } from '../webview/runtime/stagePanes';
import { pairMargins, PAIR_REQUEST_DELAY_MS, PairSpectrumPanel, type PairChannelSource, type PairPanelHost } from '../webview/runtime/pairSpectrumPanel';
import type { TrackId } from '../webview/runtime/types';

const en = getStrings('en');
const ja = getStrings('ja');

function response(overrides: Partial<PairSpectrumResponse> = {}): PairSpectrumResponse {
    return {
        filePath: '/b.wav', channelIndex: 0, status: 'ok', startSeconds: 1, endSeconds: 3, averages: 32, resampled: false,
        gainDb: [0, -6, -12], phaseRad: [0, Math.PI / 2, -Math.PI / 2], coherence: [1, 0.99, 0.5], unit: 'Pa', axisLabel: 'Gain [dB]',
        ...overrides,
    };
}

function curve(overrides: Partial<PairSpectrumResponse> = {}, label = 'b.wav'): PairCurve {
    return { label, color: '#f00', response: response(overrides) };
}

test('pair strings exist in English and Japanese', () => {
    assert.equal(en.pairReferenceHint, 'Transfer function reference');
    assert.equal(ja.pairReferenceHint, '伝達関数の参照');
    assert.equal(en.pairReferenceBadge, 'Ref');
    assert.equal(ja.pairReferenceBadge, '参照');
    assert.ok(ja.pairAverages.includes('{n}'));
});

test('the reference button marks only the lane that is the reference', () => {
    const dom = new JSDOM('<div>' + referenceButtonHtml('t1', 0, en) + referenceButtonHtml('t1', 1, en) + '</div>');
    const root = dom.window.document;
    assert.equal(syncReferenceButtons(root, { trackId: 't1' as TrackId, channelIndex: 1 }, en), true);
    const [first, second] = Array.from(root.querySelectorAll('button'));
    assert.equal(first.getAttribute('aria-pressed'), 'false');
    assert.equal(second.getAttribute('aria-pressed'), 'true');
    assert.ok(second.classList.contains('is-active'));
    assert.equal(second.getAttribute('data-hint'), en.pairReferenceClearHint);
    assert.equal(syncReferenceButtons(root, null, en), false);
    assert.equal(second.getAttribute('aria-pressed'), 'false');
});

test('the header shows the fewest averages and the whole averaged range, warning below 8', () => {
    assert.deepEqual(pairHeader([curve({ averages: 32 }), curve({ averages: 40, startSeconds: 0.5, endSeconds: 2 })], ja),
        { text: 'H1 · 32平均 · 0.50–3.00 s', fewAverages: false });
    assert.equal(pairHeader([curve({ averages: 7 })], en)?.fewAverages, true);
    assert.equal(pairHeader([curve({ status: 'no-overlap', averages: 0 })], en), null);
});

test('the legend greys a response with no overlap and marks a resampled one', () => {
    const html = pairLegendHtml([
        curve({ status: 'no-overlap', gainDb: [], phaseRad: [], coherence: [] }, 'c.wav'),
        curve({ resampled: true }, 'd.wav'),
    ], en);
    assert.ok(html.includes('pair-legend-item is-empty" data-hint="' + en.pairNoOverlapHint + '"'));
    assert.ok(html.includes('d.wav<span class="pair-legend-mark">≈</span>'));
    assert.ok(!html.includes('c.wav<span class="pair-legend-mark">'));
});

test('a response calibrated to another unit is listed but not drawn on the shared gain axis', () => {
    const curves = [curve({ axisLabel: 'Gain [dB re 1 Pa/(m/s²)]' }, 'p.wav'), curve({ axisLabel: 'Gain [dB]', averages: 4 }, 'a.wav')];
    const html = pairLegendHtml(curves, en);
    assert.ok(html.includes('pair-legend-item is-empty" data-hint="' + en.pairOtherUnitHint + '"'));
    assert.equal(pairHeader(curves, en)?.fewAverages, false);
    const lanes = pairLanes({ frequencyBins: 3, maxFrequencyHz: 1000, curves }, { frequencyMin: 0, frequencyMax: 1000 }, en);
    assert.deepEqual(lanes.map(lane => lane.layers.map(layer => layer.label)), [['p.wav'], ['p.wav'], ['p.wav']]);
    assert.equal(lanes[0].axes.y, 'Transfer level [dB re 1 Pa/(m/s²)]');
});

test('the gain plot names its axis in the UI\'s language, never the backend\'s English: a gain in dB, else the transfer level re the units\' ratio (R4)', () => {
    const plain = pairLanes({ frequencyBins: 3, maxFrequencyHz: 1000, curves: [curve()] }, { frequencyMin: 0, frequencyMax: 1000 }, ja);
    assert.equal(plain[0].axes.y, '利得 [dB]');
    const ratio = pairLanes({ frequencyBins: 3, maxFrequencyHz: 1000, curves: [curve({ axisLabel: 'Transfer level [dB re 1 Pa/(m/s²)]', levelReferenceLabel: 'dB re 1 Pa/(m/s²)' })] }, { frequencyMin: 0, frequencyMax: 1000 }, ja);
    assert.equal(ratio[0].axes.y, '伝達レベル [dB re 1 Pa/(m/s²)]');
    assert.doesNotMatch(ratio[0].axes.y, /Transfer|Gain/u);
});

test('the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only', () => {
    const lanes = pairLanes({
        frequencyBins: 3, maxFrequencyHz: 1000,
        curves: [curve(), curve({ status: 'no-overlap', gainDb: [], phaseRad: [], coherence: [] }, 'c.wav'), { ...curve({}, 'b ch2'), dashed: true }],
    }, { frequencyMin: 0, frequencyMax: 1000 }, en);
    assert.deepEqual(lanes.map(lane => lane.key), [...PAIR_LANES]);
    assert.deepEqual(lanes.map(lane => lane.axes), [
        { x: en.axisFrequency, y: 'Gain [dB]' }, { x: en.axisFrequency, y: en.pairPhaseLabel }, { x: en.axisFrequency, y: en.pairCoherenceLabel },
    ]);
    assert.deepEqual(lanes.map(lane => lane.layers.map(layer => layer.label)), [['b.wav', 'b ch2'], ['b.wav', 'b ch2'], ['b.wav', 'b ch2']]);
    // A second channel of the same track is dashed; every bin is kept (the plot component thins for display only, R4).
    assert.deepEqual(lanes[0].layers.map(layer => layer.dash), [undefined, [4, 2]]);
    assert.deepEqual(lanes[0].layers[0].view.xs, [0, 500, 1000]);
    assert.deepEqual(lanes[1].layers[0].view.values, [0, 90, -90]);
    assert.deepEqual(lanes[1].layers[0].view.unit, '°');
    // Phase ±180°, γ² 0 to 1; the gain fits the visible bins by the dB line rule (a flat 0 dB: one 5 dB step under it).
    assert.deepEqual(lanes[1].range, { min: -180, max: 180 });
    assert.deepEqual(lanes[2].range, { min: 0, max: 1 });
    const gain = lanes[0].range;
    assert.ok(gain.min <= -12 && gain.max >= 0);
    const near = pairLanes({ frequencyBins: 3, maxFrequencyHz: 1000, curves: [curve()] }, { frequencyMin: 0, frequencyMax: 100 }, en)[0].range;
    assert.deepEqual(near, { min: -5, max: 0 });
});

test('pair requests and results pass their validators', () => {
    const request: PairSpectrumRequest = {
        type: 'request-pair-spectrum', requestId: 'r', analysisId: 'a', settingsSignature: 's',
        reference: { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 },
        responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 1, offsetSeconds: 0.25 }],
        startSeconds: 1, endSeconds: 3,
    };
    assert.equal(isRequestPairSpectrumMessage(request), true);
    assert.equal(parsePanelMessage(request)?.type, 'request-pair-spectrum');
    assert.equal(isRequestPairSpectrumMessage({ ...request, startSeconds: Number.NaN }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, reference: { filePath: '', channelIndex: 0, offsetSeconds: 0 } }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: -1, offsetSeconds: 0 }] }), false);

    const result = { type: 'pair-spectrum-result', requestId: 'r', analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0,
        frequencyBins: 3, maxFrequencyHz: 1000, nFft: 4, hopLength: 1, window: 'hann', computeMs: 1, responses: [response()] };
    assert.equal(isHostInboundMessage(result), true);
    assert.equal(isHostInboundMessage({ ...result, responses: [response({ gainDb: [0] })] }), false);
    assert.equal(isHostInboundMessage({ ...result, responses: [response({ averages: 0.5 })] }), false);
    assert.equal(isHostInboundMessage({ ...result, responses: [response({ channelIndex: -1 })] }), false);
    assert.equal(isHostInboundMessage({ ...result, nFft: 4.5 }), false);
    assert.equal(isHostInboundMessage({ ...result, responses: [response({ status: 'too-short', gainDb: [], phaseRad: [], coherence: [] })] }), true);
    assert.equal(isHostInboundMessage({ type: 'pair-spectrum-error', requestId: 'r', analysisId: 'a', settingsSignature: 's', error: 'x' }), true);
    assert.equal(isHostInboundMessage({ type: 'pair-spectrum-error', requestId: 'r', analysisId: 'a', settingsSignature: 's' }), false);
});

function pairResult(overrides: Partial<PairSpectrumResult> = {}): PairSpectrumResult {
    return {
        analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0, frequencyBins: 3, maxFrequencyHz: 1000,
        nFft: 4, hopLength: 1, window: 'hann', computeMs: 1, analysisRevision: 2, calibrationSignature: 'cal',
        responses: [{ ...response(), analysisRevision: 5 }], ...overrides,
    };
}

function controllerWith(
    result: () => Promise<PairSpectrumResult>,
    canPublish: (filePath: string, revision: number | undefined) => boolean,
    lazyContext = (filePath: string): { analysisRevision: number } | undefined => ({ analysisRevision: filePath === '/a.wav' ? 2 : 5 }),
) {
    const published: SessionPublication[] = [];
    const calls: unknown[][] = [];
    const ports = {
        scope: () => ({ isCurrent: () => true, canPublish }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => ({ nFft: 4096, hopLength: 1024, window: 'hann' }),
        lazyContext,
        client: { requestPairSpectrum: (...args: unknown[]) => { calls.push(args); return result(); } },
    } as unknown as ComparisonSessionPorts;
    return { controller: new ComparisonSessionController(ports), published, calls };
}

const pairRequest: PairSpectrumRequest = {
    type: 'request-pair-spectrum', requestId: 'r1', analysisId: 'a', settingsSignature: 's',
    reference: { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 },
    responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5 }],
};

test('the session controller publishes a pair result with the stft options and the request id', async () => {
    const { controller, published, calls } = controllerWith(async () => pairResult(), () => true);
    await controller.handle(pairRequest);
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0][0] as { stftOptions: unknown }).stftOptions, { nFft: 4096, hopLength: 1024, window: 'hann' });
    assert.equal(published.length, 1);
    const message = published[0] as PairSpectrumResultMessage;
    assert.equal(message.type, 'pair-spectrum-result');
    assert.equal(message.requestId, 'r1');
    assert.equal('analysisRevision' in message, false);
    assert.equal('calibrationSignature' in message, false);
});

test('the session controller drops a pair result once any source was reanalyzed', async () => {
    const seen: Array<[string, number | undefined]> = [];
    const { controller, published } = controllerWith(async () => pairResult(), (filePath, revision) => {
        seen.push([filePath, revision]);
        return filePath !== '/b.wav';
    });
    await controller.handle(pairRequest);
    assert.equal(published.length, 0);
    assert.deepEqual(seen.find(([filePath]) => filePath === '/b.wav'), ['/b.wav', 5]);
});

test('the session controller ignores a pair request for a source the host no longer displays', async () => {
    const { controller, published, calls } = controllerWith(async () => pairResult(), () => true,
        filePath => filePath === '/gone.wav' ? undefined : { analysisRevision: 2 });
    await controller.handle({ ...pairRequest, responses: [{ filePath: '/gone.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 }] });
    assert.equal(calls.length, 0);
    assert.equal(published.length, 0);
});

test('the session controller reports a failed pair request', async () => {
    const { controller, published } = controllerWith(async () => { throw new Error('too long'); }, () => true);
    await controller.handle(pairRequest);
    assert.deepEqual(published, [{ type: 'pair-spectrum-error', requestId: 'r1', analysisId: 'a', settingsSignature: 's', error: 'too long' }]);
});

const PANEL_DOM = '<div id="spectrum-section"><div id="spectrum-split"><div id="spectrum-overlay-wrap"></div>'
    + '<div id="pair-divider"></div><div id="pair-spectrum-wrap"><span id="pair-spectrum-summary"></span><span id="pair-spectrum-legend"></span>'
    + '<span id="pair-spectrum-readout" class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span>'
    + '<div id="pair-spectrum-plot">'
    + PAIR_LANES.map(key => '<canvas class="pair-lane-canvas" data-pair-lane="' + key + '"></canvas>').join('')
    + '<div id="pair-spectrum-message"></div></div></div></div></div>';

/** A 2D context that draws nothing: JSDOM has none, and the panel only needs the plots laid out. */
function silentContext(): CanvasRenderingContext2D {
    const target: Record<string | symbol, unknown> = {
        measureText: (text: string) => ({ width: text.length * 5 }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    };
    return new Proxy(target, { get: (object, key) => (key in object ? object[key] : () => undefined) }) as unknown as CanvasRenderingContext2D;
}

/** Each plot is 600 × 120 CSS pixels: the plot component's size for a canvas with no layout. */
const LANE_HEIGHT = 120;

function panelFixture() {
    const dom = new JSDOM(PANEL_DOM + referenceButtonHtml('t1', 0, en) + referenceButtonHtml('t2', 0, en));
    const doc = dom.window.document;
    const canvasPrototype = dom.window.HTMLCanvasElement.prototype;
    canvasPrototype.getContext = (() => silentContext()) as never;
    // The plots stacked one under another, as the page lays them out.
    canvasPrototype.getBoundingClientRect = function (this: HTMLCanvasElement) {
        const index = PAIR_LANES.indexOf(this.getAttribute('data-pair-lane') as never);
        const top = Math.max(0, index) * LANE_HEIGHT;
        return { left: 0, top, right: 600, bottom: top + LANE_HEIGHT, width: 600, height: LANE_HEIGHT, x: 0, y: top, toJSON: () => ({}) };
    };
    const posted: PairSpectrumRequest[] = [];
    const references: Array<unknown> = [];
    const hoverFrequencies: Array<number | null> = [];
    let channels: PairChannelSource[] = [
        { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
        { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5, label: 'b.wav', color: '#f00' },
    ];
    let range: { startSeconds: number; endSeconds: number } | null = null;
    let visible: { frequencyMin: number; frequencyMax: number } | null = null;
    // The power spectrum's linear axis: 0 to its top (null: a log axis, which the pair view does not share).
    let axisMax: number | null = 1000;
    let requestCount = 0;
    let synced: number | null = null;
    const windows: Array<{ min: number; max: number } | null> = [];
    const opened: string[] = [];
    const levelRequests: Array<Parameters<PairPanelHost['openLevelRange']>[0]> = [];
    const host: PairPanelHost = {
        channels: () => channels,
        range: () => range,
        analysisId: () => 'a',
        settingsSignature: () => 's',
        nextRequestId: () => 'pair-' + (++requestCount),
        post: request => { posted.push(request); },
        frequencyAxisHz: () => (axisMax === null ? null : {
            maxFrequencyHz: axisMax, window: visible ? { start: visible.frequencyMin / axisMax, end: visible.frequencyMax / axisMax } : { start: 0, end: 1 },
        }),
        plotHeight: () => 140,
        hoverFrequencyHz: () => synced,
        onHoverFrequency: hz => { hoverFrequencies.push(hz); },
        theme: () => DEFAULT_THEME,
        onReferenceChange: reference => { references.push(reference); },
        onLayoutChange: () => undefined,
        setFrequencyWindowHz: range => { windows.push(range); visible = range && { frequencyMin: range.min, frequencyMax: range.max }; },
        openFrequencyRange: () => { opened.push('frequency'); },
        openLevelRange: request => { opened.push(request.label); levelRequests.push(request); },
    };
    const panel = new PairSpectrumPanel(doc, host, en);
    return {
        doc, panel, posted, references, hoverFrequencies, windows, opened, levelRequests,
        setSynced(next: number | null) { synced = next; },
        /** The pointer at (x, y) on one plot, in its CSS pixels. */
        hover(key: string, x: number, y: number) {
            const lane = doc.querySelector<HTMLCanvasElement>('[data-pair-lane="' + key + '"]')!;
            const top = lane.getBoundingClientRect().top;
            lane.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: top + y }));
        },
        readout() { return doc.getElementById('pair-spectrum-readout')!; },
        lane(key: string) { return doc.querySelector<HTMLCanvasElement>('[data-pair-lane="' + key + '"]')!; },
        cursors() { return [...doc.querySelectorAll<HTMLCanvasElement>('.pair-cursor')].map(layer => !layer.hidden); },
        setChannels(next: PairChannelSource[]) { channels = next; },
        setRange(next: typeof range) { range = next; },
        setVisible(next: typeof visible) { visible = next; },
        setAxisMax(next: number | null) { axisMax = next; },
    };
}

function resultFor(requestId: string, overrides: Partial<PairSpectrumResultMessage> = {}): PairSpectrumResultMessage {
    const { analysisRevision: _revision, calibrationSignature: _signature, ...rest } = pairResult();
    return { type: 'pair-spectrum-result', requestId, ...rest, ...overrides };
}

test('a pair answer is of its sources\' calibration too: a track calibrated anew is asked again, its old answer not drawn', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        const calibrated = (signature: string) => fixture.setChannels([
            { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: 'v1', calibrationSignature: signature, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
            { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: 'v1', channelIndex: 0, offsetSeconds: 0.5, label: 'b.wav', color: '#f00' },
        ]);
        calibrated('cal-1');
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.panel.curves().length, 1);
        // The same request to the host (file versions, offsets, range, settings), another calibration of a.wav.
        calibrated('cal-2');
        fixture.panel.render();
        assert.equal(fixture.panel.curves().length, 0, 'the answer of the old calibration is not drawn');
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 2, 'asked again');
        fixture.panel.handleMessage(resultFor('pair-2'));
        assert.equal(fixture.panel.curves().length, 1);
    } finally {
        mock.timers.reset();
    }
});

test('the pair panel requests once per change of sources or range, never for a repeat', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        assert.equal(fixture.posted.length, 1);
        assert.deepEqual(fixture.posted[0].reference, { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 });
        assert.deepEqual(fixture.posted[0].responses, [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5 }]);
        assert.equal('startSeconds' in fixture.posted[0], false);
        assert.ok(fixture.doc.getElementById('spectrum-section')?.classList.contains('has-pair'));
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairWaiting);

        // A cursor move re-renders with the same sources and range.
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 1);

        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.panel.curves().length, 1);

        fixture.setRange({ startSeconds: 1, endSeconds: 3 });
        // From the moment the range changes (before the request even goes out) the first range's answer is not drawn
        // or read under it: the plots say they wait (R7).
        fixture.panel.render();
        assert.equal(fixture.panel.curves().length, 0);
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairWaiting);
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 2);
        assert.equal(fixture.panel.curves().length, 0);
        assert.equal(fixture.posted[1].startSeconds, 1);
        assert.equal(fixture.posted[1].endSeconds, 3);

        // A late answer to the first request is ignored.
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.panel.waiting, true);
        fixture.panel.handleMessage(resultFor('pair-2'));
        assert.equal(fixture.panel.lastResult?.requestId, 'pair-2');
        assert.equal(fixture.panel.curves().length, 1);
        assert.equal(fixture.doc.getElementById('pair-spectrum-summary')?.textContent, 'H1 · 32 avg · 1.00–3.00 s');
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, '');
    }
    finally {
        mock.timers.reset();
    }
});

test('the pair panel waits for a dragged offset to rest before it requests', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        assert.equal(fixture.posted.length, 1);
        for (let step = 1; step <= 10; step++) {
            fixture.setChannels([
                { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
                { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5 + step * 0.01, label: 'b.wav', color: '#f00' },
            ]);
            fixture.panel.sync();
            mock.timers.tick(PAIR_REQUEST_DELAY_MS - 50);
        }
        assert.equal(fixture.posted.length, 1);
        mock.timers.tick(50);
        assert.equal(fixture.posted.length, 2);
        assert.equal(fixture.posted[1].responses[0].offsetSeconds, 0.6);
    }
    finally {
        mock.timers.reset();
    }
});

test('an answer computed for another time offset is never drawn under the shifted lane\'s name', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.panel.curves().length, 1);
        // The response track is shifted by 0.5 s: the same file and channel, another pairing in time.
        fixture.setChannels([
            { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
            { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 1, label: 'b.wav', color: '#f00' },
        ]);
        fixture.panel.render();
        assert.equal(fixture.panel.curves().length, 0, 'the 0.5 s answer is not the 1 s pairing');
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairWaiting);
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        fixture.panel.handleMessage(resultFor('pair-2'));
        assert.equal(fixture.panel.curves().length, 1);
    }
    finally {
        mock.timers.reset();
    }
});

test('the pair panel clears the reference with its lane and reports failures', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.panel.handleMessage({ type: 'pair-spectrum-error', requestId: 'pair-1', analysisId: 'a', settingsSignature: 's', error: 'boom' });
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairFailed.replace('{error}', 'boom'));

        fixture.setChannels([{ trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' }]);
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 1);
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairNoResponses);

        fixture.setChannels([]);
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.panel.reference, null);
        assert.deepEqual(fixture.references, [{ trackId: 't1', channelIndex: 0 }, null]);
        assert.equal(fixture.doc.getElementById('spectrum-section')?.classList.contains('has-pair'), false);
    }
    finally {
        mock.timers.reset();
    }
});

/** The plot component's frame on a 600 × 120 plot: where 0 Hz and the reference's Nyquist sit, and each lane's top and height. */
const FRAME = { left: STAGE_MARGINS.left, width: 600 - STAGE_MARGINS.left - STAGE_MARGINS.right };
const xOfHz = (hz: number, axisMax = 1000) => FRAME.left + hz / axisMax * FRAME.width;
/** Up a plot's frame: only the bottom plot has the frequency axis's numbers under it. */
const yOf = (fraction: number, key: PairLaneKey = 'gain') => {
    const margins = pairMargins(key);
    return margins.top + (1 - fraction) * (LANE_HEIGHT - margins.top - margins.bottom);
};

function shownFixture(result: PairSpectrumResultMessage = resultFor('pair-1')) {
    const fixture = panelFixture();
    fixture.panel.attach();
    fixture.panel.toggleReference('t1' as TrackId, 0);
    mock.timers.tick(0);
    fixture.panel.handleMessage(result);
    return fixture;
}

test('closing the pair pane under the pointer clears the synced power spectrum cursor', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        fixture.hover('gain', xOfHz(500), yOf(0.5));
        assert.notEqual(fixture.hoverFrequencies.at(-1), null);
        assert.deepEqual(fixture.cursors(), [true, true, true]);
        fixture.hoverFrequencies.length = 0;

        fixture.setChannels([]);
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.panel.reference, null);
        assert.deepEqual(fixture.hoverFrequencies, [null]);
        // The marks are laid over the page: they go with the pane.
        assert.deepEqual(fixture.cursors(), [false, false, false]);
    }
    finally {
        mock.timers.reset();
    }
});

test('the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const base = resultFor('pair-1');
        const fixture = shownFixture({
            ...base,
            responses: [
                { ...base.responses[0], gainDb: [0, -6, -12], phaseRad: [0, Math.PI / 2, -Math.PI / 2], coherence: [1, 0.99, 0.5] },
            ],
        });
        // 90° sits three quarters of the way up the phase plot.
        fixture.hover('phase', xOfHz(500), yOf(0.75, 'phase'));
        assert.equal(fixture.readout().hidden, false);
        assert.match(fixture.readout().textContent ?? '', /500 Hz.*90\.0°/);
        assert.deepEqual(fixture.cursors(), [true, true, true], 'every plot shows the cursor line');
        assert.deepEqual(fixture.hoverFrequencies.at(-1), 500);
        fixture.hover('coherence', xOfHz(500), yOf(0.99, 'coherence'));
        assert.match(fixture.readout().textContent ?? '', /500 Hz.*0\.990 γ²$/);
        fixture.doc.getElementById('pair-spectrum-plot')!.dispatchEvent(new fixture.doc.defaultView!.MouseEvent('mouseleave'));
        assert.equal(fixture.readout().hidden, true);
        assert.deepEqual(fixture.cursors(), [false, false, false]);
        assert.equal(fixture.hoverFrequencies.at(-1), null);
    }
    finally {
        mock.timers.reset();
    }
});

test('a cursor synced from past the reference Nyquist is not drawn on the pair plots', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        fixture.setSynced(3000);
        fixture.panel.render();
        assert.deepEqual(fixture.cursors(), [false, false, false]);
        fixture.setSynced(900);
        fixture.panel.render();
        assert.deepEqual(fixture.cursors(), [true, true, true]);
        assert.equal(fixture.readout().hidden, true, 'a followed cursor reads nothing');
    }
    finally {
        mock.timers.reset();
    }
});

test('the pair plots lie on the power spectrum\'s frequency axis past the reference Nyquist, and sync it no further than their last bin', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        // A faster track takes the power spectrum to 4 kHz; the pair (a 2 kHz reference) ends at 1 kHz on the same axis.
        fixture.setAxisMax(4000);
        fixture.panel.render();
        fixture.hover('gain', xOfHz(3000, 4000), yOf(0.5));
        fixture.hover('gain', xOfHz(0, 4000), yOf(0.5));
        assert.deepEqual(fixture.hoverFrequencies.filter(hz => hz !== null), [1000, 0]);
        // A box on the pair view zooms the power spectrum in its own Hz.
        const lane = fixture.lane('gain'), mouse = fixture.doc.defaultView!.MouseEvent;
        lane.dispatchEvent(new mouse('mousedown', { bubbles: true, button: 0, clientX: xOfHz(1000, 4000), clientY: yOf(1) }));
        fixture.doc.dispatchEvent(new mouse('mousemove', { bubbles: true, buttons: 1, clientX: xOfHz(3000, 4000), clientY: yOf(0) }));
        fixture.doc.dispatchEvent(new mouse('mouseup', { bubbles: true, clientX: xOfHz(3000, 4000), clientY: yOf(0) }));
        const zoomed = fixture.windows.at(-1)!;
        assert.ok(Math.abs(zoomed.min - 1000) < 5 && Math.abs(zoomed.max - 3000) < 5, JSON.stringify(zoomed));
    }
    finally {
        mock.timers.reset();
    }
});

test('on a log power spectrum the pair view zooms on its own and leaves the power spectrum\'s range', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        fixture.setAxisMax(null);
        fixture.panel.render();
        const lane = fixture.lane('gain');
        lane.dispatchEvent(new fixture.doc.defaultView!.WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -240, clientX: xOfHz(500), clientY: yOf(0.5) }));
        assert.deepEqual(fixture.windows, []);
        assert.notEqual(lane.dataset.plotWindow, '0.000 1.000 0.000 1.000');
        lane.dispatchEvent(new fixture.doc.defaultView!.MouseEvent('dblclick', { bubbles: true, clientX: xOfHz(500), clientY: yOf(0.5) }));
        assert.equal(lane.dataset.plotWindow, '0.000 1.000 0.000 1.000');
        assert.deepEqual(fixture.windows, []);
    }
    finally {
        mock.timers.reset();
    }
});

test('a pointer resting on the pair plot syncs the power spectrum once the result arrives', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.attach();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.hover('gain', xOfHz(0), yOf(0.5));
        assert.deepEqual(fixture.hoverFrequencies, [null]);
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.deepEqual(fixture.hoverFrequencies, [null, 0]);
    }
    finally {
        mock.timers.reset();
    }
});

test('the pair plots zoom with every plot\'s gestures: the frequency shared with the power spectrum, the level per plot', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        const mouse = fixture.doc.defaultView!.MouseEvent;
        const lane = fixture.lane('gain');
        // A box from 250 to 750 Hz over the gain plot's upper half.
        lane.dispatchEvent(new mouse('mousedown', { bubbles: true, button: 0, clientX: xOfHz(250), clientY: yOf(1) }));
        fixture.doc.dispatchEvent(new mouse('mousemove', { bubbles: true, buttons: 1, clientX: xOfHz(750), clientY: yOf(0.5) }));
        fixture.doc.dispatchEvent(new mouse('mouseup', { bubbles: true, clientX: xOfHz(750), clientY: yOf(0.5) }));
        const zoomed = fixture.windows.at(-1)!;
        assert.ok(Math.abs(zoomed.min - 250) < 1 && Math.abs(zoomed.max - 750) < 1, JSON.stringify(zoomed));
        // The level part is of the whole range refitted to the bins now on screen, so it is not the box's 0.5–1 (see below).
        assert.match(lane.dataset.plotWindow ?? '', /^0\.250 0\.750 /);
        assert.notEqual(lane.dataset.plotWindow?.endsWith('0.000 1.000'), true);
        // A double-click on the plot resets every axis; on an axis it opens that axis's range.
        lane.dispatchEvent(new mouse('dblclick', { bubbles: true, clientX: xOfHz(500), clientY: yOf(0.5) }));
        assert.equal(fixture.windows.at(-1), null);
        lane.dispatchEvent(new mouse('dblclick', { bubbles: true, clientX: 2, clientY: yOf(0.5) }));
        lane.dispatchEvent(new mouse('dblclick', { bubbles: true, clientX: xOfHz(500), clientY: LANE_HEIGHT - 2 }));
        assert.deepEqual(fixture.opened, ['Gain [dB]', 'frequency']);

    }
    finally {
        mock.timers.reset();
    }
});

test('a boxed level zoom keeps the values boxed when the frequency zoom refits the plot\'s whole range', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture();
        const mouse = fixture.doc.defaultView!.MouseEvent;
        const lane = fixture.lane('gain');
        // The gain (0, −6, −12 dB) opens at the round ends −15 to 0 dB (R9, 5 dB steps); the box takes its upper half
        // (−7.5 to 0 dB) up to 600 Hz, which leaves 0 and −6 dB on screen, so the whole range is refitted to −10 to 0 dB
        // and the box is kept inside it.
        lane.dispatchEvent(new mouse('mousedown', { bubbles: true, button: 0, clientX: xOfHz(0), clientY: yOf(1) }));
        fixture.doc.dispatchEvent(new mouse('mousemove', { bubbles: true, buttons: 1, clientX: xOfHz(600), clientY: yOf(0.5) }));
        fixture.doc.dispatchEvent(new mouse('mouseup', { bubbles: true, clientX: xOfHz(600), clientY: yOf(0.5) }));
        lane.dispatchEvent(new mouse('dblclick', { bubbles: true, clientX: 2, clientY: yOf(0.5) }));
        const request = fixture.levelRequests.at(-1)!;
        const span = request.max - request.min;
        assert.ok(Math.abs(request.min - -10) < 0.01 && Math.abs(request.max - 0) < 0.01, JSON.stringify(request));
        assert.ok(Math.abs(request.min + request.current.start * span - -7.5) < 0.05, JSON.stringify(request));
        assert.ok(Math.abs(request.min + request.current.end * span - 0) < 0.05, JSON.stringify(request));
    }
    finally {
        mock.timers.reset();
    }
});

test('toggling the reference lane again clears it', () => {
    const fixture = panelFixture();
    fixture.panel.toggleReference('t2' as TrackId, 0);
    assert.equal(fixture.doc.querySelector('[data-track-id="t2"]')?.getAttribute('aria-pressed'), 'true');
    fixture.panel.toggleReference('t2' as TrackId, 0);
    assert.equal(fixture.panel.reference, null);
    assert.equal(fixture.doc.querySelector('[data-track-id="t2"]')?.getAttribute('aria-pressed'), 'false');
    fixture.panel.dispose();
});

test('a newer lazy request for the same track cancels the older one in flight, and only that one', async () => {
    const signals = new Map<string, { isCancellationRequested: boolean }>();
    const failed: string[] = [];
    const published: SessionPublication[] = [];
    const ports = {
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => undefined,
        lazyContext: () => ({ analysisRevision: 0 }),
        lazyFailed: (request: { requestId: string }) => { failed.push(request.requestId); },
        client: {
            requestRange: (_filePath: string, _start: number, _end: number, _points: number, requestId: string, _context: unknown,
                cancellation: { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): unknown }) => {
                signals.set(requestId, cancellation);
                return new Promise((resolve, reject) => {
                    cancellation.onCancellationRequested(() => reject(new Error('cancelled')));
                    if (requestId !== 'old') setImmediate(() => resolve({ analysisRevision: 0, channels: [] }));
                });
            },
        },
    } as unknown as ComparisonSessionPorts;
    const controller = new ComparisonSessionController(ports);
    const range = (requestId: string, trackIndex: number) => ({
        type: 'request-waveform-range' as const, requestId, trackIndex, filePath: '/a.wav', sourceVersion: undefined, startNorm: 0, endNorm: 1, points: 4,
    });

    const old = controller.handle(range('old', 0));
    const otherTrack = controller.handle(range('other-track', 1));
    const latest = controller.handle(range('new', 0));
    await Promise.all([old, otherTrack, latest]);

    assert.equal(signals.get('old')?.isCancellationRequested, true);
    assert.equal(signals.get('other-track')?.isCancellationRequested, false);
    assert.equal(signals.get('new')?.isCancellationRequested, false);
    assert.deepEqual(failed, [], 'a superseded request is not a failure');
    assert.deepEqual(published.map(message => 'requestId' in message ? message.requestId : ''), ['other-track', 'new']);
});

test('the pair view\'s gain axis opens at round ends holding every bin on screen, a one-bin notch too, and only those (R9)', () => {
    // 4097 bins, a smooth gain with a one-bin notch and a one-bin peak; the bins past the zoom are louder still.
    const bins = 4097;
    const gainDb = Array.from({ length: bins }, (_, bin) => -3 + 2 * Math.sin(bin / 300));
    gainDb[1500] = -37.3;
    gainDb[2600] = 8.4;
    gainDb[4000] = 40;
    const visible = { frequencyMin: 0, frequencyMax: 20000 };
    const gain = pairLanes({ frequencyBins: bins, maxFrequencyHz: 24000, curves: [curve({ gainDb, phaseRad: gainDb.map(() => 0), coherence: gainDb.map(() => 1) })] }, visible, en)[0].range;
    const shown = gainDb.filter((_, bin) => bin / (bins - 1) * 24000 <= visible.frequencyMax);
    assert.ok(gain.min <= Math.min(...shown) && gain.max >= Math.max(...shown), `${gain.min}..${gain.max} holds every bin on screen`);
    assert.ok(gain.max < 40, 'a bin off screen does not stretch it');
    // Round ends by the dB line rule (R9): 10 dB steps here.
    assert.deepEqual(gain, { min: -40, max: 10 });
    // A line thinned by averaging loses the one-bin notch: a range of it would open at −10.
    assertNotDrawn(gain.min, Math.floor(Math.min(...averagedInto(shown, 200)) / 10) * 10, 'the range holds the notch');
});

test('the pair view\'s gain axis keeps the dB line rule the comparison\'s transfer-function step keeps: the same range for the same gains, never wider than 100 dB (R9)', () => {
    const bins = 1025;
    for (const [low, high] of [[-3.2, 12.7], [-160, 4], [-0.4, 0.3], [-37.3, 8.4], [10, 10], [-61, -2]] as const) {
        const gainDb = Array.from({ length: bins }, (_, bin) => low + (high - low) * bin / (bins - 1));
        const range = pairLanes({ frequencyBins: bins, maxFrequencyHz: 24000, curves: [curve({ gainDb, phaseRad: gainDb.map(() => 0), coherence: gainDb.map(() => 1) })] }, { frequencyMin: 0, frequencyMax: 24000 }, en)[0].range;
        const step: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'gain', xs: [0, 24000], values: [low, high] };
        assert.deepEqual({ min: range.min, max: range.max }, stageRange([step]), `${low}..${high}`);
        assert.ok(range.max - range.min <= 100, `${low}..${high}: at most 100 dB`);
        assert.ok(range.max >= high, `${low}..${high}: the top holds the loudest bin`);
    }
});

test('the pair view orders its gains by every bin on screen: the quieter response is drawn last, on top (R6)', () => {
    // The quieter response by power has one narrow loud bin a drawn-point measure would weigh as much as the rest.
    const bins = 2049;
    const loud = Array.from({ length: bins }, () => -6);
    const quiet = Array.from({ length: bins }, (_, bin) => (bin === 700 ? 20 : -30));
    const lanes = pairLanes({
        frequencyBins: bins, maxFrequencyHz: 24000,
        curves: [curve({ gainDb: quiet, phaseRad: quiet.map(() => 0), coherence: quiet.map(() => 1) }, 'quiet'), curve({ gainDb: loud, phaseRad: loud.map(() => 0), coherence: loud.map(() => 1) }, 'loud')],
    }, { frequencyMin: 0, frequencyMax: 24000 }, en);
    const [quietLayer, loudLayer] = lanes[0].layers;
    const bucketed = (layer: typeof quietLayer) => layer.view.levelBins?.count.reduce((sum, n) => sum + n, 0);
    assert.equal(bucketed(quietLayer), bins, 'every bin is measured');
    assert.equal(bucketed(loudLayer), bins);
    const order = byLevel([quietLayer, loudLayer], lanes[0].layers[0].view).map(layer => layer.label);
    assert.deepEqual(order, ['loud', 'quiet']);
    // Judged on a line thinned to each bucket's peak, the one loud bin would make the quiet response the louder.
    const drawnPower = (values: number[]): number => peaksInto(values, 32).reduce((sum, value) => sum + 10 ** (value / 10), 0) / 32;
    const byDrawn = [{ label: 'quiet', values: quiet }, { label: 'loud', values: loud }].sort((a, b) => drawnPower(b.values) - drawnPower(a.values)).map(item => item.label);
    assertNotDrawn(order, byDrawn, 'not the order of the points drawn');
});
