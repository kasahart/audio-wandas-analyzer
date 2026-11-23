import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import type { PairAnswersResult } from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { isRequestPairSpectrumMessage, type PairSpectrumRequest } from '../shared/utils/audioTarget';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import { pairHeader, pairLegendHtml, referenceButtonHtml, syncReferenceButtons, type PairAnswer, type PairAnswersMessage, type PairCurve } from '../webview/runtime/pairSpectrum';
import { PAIR_REQUEST_DELAY_MS, PairSpectrumPanel, type PairChannelSource, type PairPanelHost } from '../webview/runtime/pairSpectrumPanel';
import type { AcrossRange, SettingsRange, TracksFigureDeps, TracksFigureScreen } from '../webview/screens/tracksFigure';
import type { FigureInspection, FigureSpec } from '../webview/figure/index';
import type { TrackId } from '../webview/runtime/types';

const en = getStrings('en');
const ja = getStrings('ja');

/** One response of the answers kept by key: its three lines' keys when it has lines. */
function answer(overrides: Partial<PairAnswer> = {}): PairAnswer {
    return {
        filePath: '/b.wav', channelIndex: 0, status: 'ok', startSeconds: 1, endSeconds: 3, averages: 32, resampled: false,
        keys: { gain: 'k-gain', phase: 'k-phase', coherence: 'k-coherence' }, calibrationStatus: 'uncalibrated', sourceVersion: 'v',
        ...overrides,
    } as PairAnswer;
}

function curve(overrides: Partial<PairAnswer> = {}, label = 'b.wav', drawn = true): PairCurve {
    const response = answer(overrides);
    return { id: 't2:0', label, color: '#f00', response, drawn: drawn && response.status === 'ok' };
}

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
        curve({ status: 'no-overlap', keys: undefined }, 'c.wav'),
        curve({ resampled: true }, 'd.wav'),
    ], en);
    assert.ok(html.includes('pair-legend-item is-empty" data-hint="' + en.pairNoOverlapHint + '"'));
    assert.ok(html.includes('d.wav<span class="pair-legend-mark">≈</span>'));
    assert.ok(!html.includes('c.wav<span class="pair-legend-mark">'));
});

test('a response the figure left off the gain axis (another unit\'s ratio) is listed but not counted with those on it', () => {
    const curves = [curve({}, 'p.wav'), curve({ averages: 4 }, 'a.wav', false)];
    const html = pairLegendHtml(curves, en);
    assert.ok(html.includes('pair-legend-item is-empty" data-hint="' + en.pairOtherUnitHint + '"'));
    assert.equal(pairHeader(curves, en)?.fewAverages, false);
});

test('pair requests and results pass their validators', () => {
    const request: PairSpectrumRequest = {
        type: 'request-pair-spectrum', requestId: 'r', analysisId: 'a', settingsSignature: 's',
        reference: { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 },
        responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 1, offsetSeconds: 0.25 }],
        startSeconds: 1, endSeconds: 3, answers: 'log',
    };
    assert.equal(isRequestPairSpectrumMessage(request), true);
    assert.equal(isRequestPairSpectrumMessage({ ...request, answers: undefined }), false, 'a request names how its axis is drawn: there is no other reply');
    assert.equal(parsePanelMessage(request)?.type, 'request-pair-spectrum');
    assert.equal(isRequestPairSpectrumMessage({ ...request, startSeconds: Number.NaN }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, reference: { filePath: '', channelIndex: 0, offsetSeconds: 0 } }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: -1, offsetSeconds: 0 }] }), false);

    assert.equal(isHostInboundMessage({ type: 'pair-spectrum-result', requestId: 'r', analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0,
        frequencyBins: 3, maxFrequencyHz: 1000, nFft: 4, hopLength: 1, window: 'hann', computeMs: 1, responses: [] }), false, 'the old reply with values is no message of the host');
    assert.equal(isHostInboundMessage({ type: 'pair-spectrum-error', requestId: 'r', analysisId: 'a', settingsSignature: 's', error: 'x' }), true);
    assert.equal(isHostInboundMessage({ type: 'pair-spectrum-error', requestId: 'r', analysisId: 'a', settingsSignature: 's' }), false);

    // The answers kept by key: each response's three keys, or none (no lines); never a value of a line.
    const kept = { type: 'pair-answers-result', requestId: 'r', analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0,
        nFft: 4, hopLength: 1, window: 'hann', responses: [answer()] };
    assert.equal(isRequestPairSpectrumMessage({ ...request, answers: 'linear' }), true);
    assert.equal(isHostInboundMessage(kept), true);
    assert.equal(isHostInboundMessage({ ...kept, responses: [answer({ status: 'too-short', keys: undefined })] }), true);
    assert.equal(isHostInboundMessage({ ...kept, responses: [{ ...answer(), keys: { gain: 'k' } }] }), false);
    assert.equal(isHostInboundMessage({ ...kept, responses: [answer({ averages: 0.5 })] }), false);
    assert.equal(isHostInboundMessage({ ...kept, responses: [answer({ channelIndex: -1 })] }), false);
    assert.equal(isHostInboundMessage({ ...kept, nFft: 4.5 }), false);
});

function pairResult(overrides: Partial<PairAnswersResult> = {}): PairAnswersResult {
    return {
        filePath: '/a.wav', channelIndex: 0, nFft: 4, hopLength: 1, window: 'hann', analysisRevision: 2, calibrationSignature: 'cal',
        sourceVersion: 'v', stftSignature: '4/1/hann',
        responses: [{ ...answer(), calibrationSignature: 'cal', analysisRevision: 5 }], ...overrides,
    };
}

function controllerWith(
    result: () => Promise<PairAnswersResult>,
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
        client: { requestPairAnswers: (...args: unknown[]) => { calls.push(args); return result(); } },
    } as unknown as ComparisonSessionPorts;
    return { controller: new ComparisonSessionController(ports), published, calls };
}

const pairRequest: PairSpectrumRequest = {
    type: 'request-pair-spectrum', requestId: 'r1', analysisId: 'a', settingsSignature: 's',
    reference: { filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0 },
    responses: [{ filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5 }],
    answers: 'log',
};

test('the session controller publishes a pair result with the stft options and the request id', async () => {
    const { controller, published, calls } = controllerWith(async () => pairResult(), () => true);
    await controller.handle(pairRequest);
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0][0] as { stftOptions: unknown }).stftOptions, { nFft: 4096, hopLength: 1024, window: 'hann' });
    assert.equal(published.length, 1);
    const message = published[0] as Extract<SessionPublication, { type: 'pair-answers-result' }>;
    assert.equal(message.type, 'pair-answers-result');
    assert.equal((calls[0][0] as { scale: unknown }).scale, 'log', 'how the axis is drawn, which the kept lines are of');
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
    + '<div id="pair-spectrum-plot"><div id="pair-spectrum-figure" class="tracks-figure"></div><div id="pair-spectrum-message"></div></div></div></div></div>';

/**
 * The panel with a stand-in for its figure's screen (screens/tracksFigure.ts, which has its own tests): what the panel
 * shows it, hides, and passes between it and the power spectrum is recorded.
 */
function panelFixture() {
    const dom = new JSDOM(PANEL_DOM + referenceButtonHtml('t1', 0, en) + referenceButtonHtml('t2', 0, en));
    const doc = dom.window.document;
    const posted: PairSpectrumRequest[] = [];
    const references: Array<unknown> = [];
    let channels: PairChannelSource[] = [
        { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
        { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0.5, label: 'b.wav', color: '#f00' },
    ];
    let range: { startSeconds: number; endSeconds: number } | null = null;
    let requestCount = 0;
    const figure = {
        made: 0,
        deps: null as Pick<TracksFigureDeps, 'host' | 'readout' | 'empty' | 'ranged' | 'read' | 'drawn'> | null,
        shown: [] as Array<{ spec: FigureSpec; names: string[]; colours: string[]; settings: SettingsRange | undefined }>,
        hidden: 0,
        across: [] as AcrossRange[],
        follow: [] as Array<number | null>,
        /** The gain lines the Figure drew, as its inspection lists them (null: no picture yet). */
        gain: null as string[] | null,
    };
    const screen: TracksFigureScreen = {
        show(spec, paint, settings) {
            if (!spec) { figure.hidden += 1; return; }
            const lines = spec.lanes[0].lines.map(line => line.id);
            figure.shown.push({ spec, names: lines.map(line => paint.name(line)), colours: lines.map(line => paint.colour(line)), settings });
        },
        hide() { figure.hidden += 1; },
        shown: () => figure.shown.length > 0,
        across(x) { figure.across.push(x); },
        follow(x) { figure.follow.push(x); },
        whole: () => undefined,
        zoomKey: () => true,
        inspect: () => (figure.gain ? { lanes: [{ id: 'gain', lines: figure.gain.map(id => ({ id })) }] } as unknown as FigureInspection : null),
        exportCsv: () => Promise.resolve({ status: 'none' as const }),
    };
    const ranged: AcrossRange[] = [];
    const read: Array<number | null> = [];
    const host: PairPanelHost = {
        channels: () => channels,
        range: () => range,
        analysisId: () => 'a',
        settingsSignature: () => 's',
        nextRequestId: () => 'pair-' + (++requestCount),
        post: request => { posted.push(request); },
        figure: deps => { figure.made += 1; figure.deps = deps; return screen; },
        settingsRange: () => ({ across: [null, 8000] }),
        onRanged: x => { ranged.push(x); },
        onRead: hz => { read.push(hz); },
        onDrawn: () => undefined,
        plotHeight: () => 140,
        onReferenceChange: reference => { references.push(reference); },
        onLayoutChange: () => undefined,
    };
    const panel = new PairSpectrumPanel(doc, host, en);
    return {
        doc, panel, posted, references, figure, ranged, read,
        setChannels(next: PairChannelSource[]) { channels = next; },
        setRange(next: typeof range) { range = next; },
    };
}

function resultFor(requestId: string, overrides: Partial<PairAnswersMessage> = {}): PairAnswersMessage {
    return {
        type: 'pair-answers-result', requestId, analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0,
        nFft: 4, hopLength: 1, window: 'hann', sourceVersion: 'v', stftSignature: 'stft', responses: [answer()], ...overrides,
    };
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
        assert.equal(fixture.posted[0].answers, 'linear', 'the answers kept by key are asked for, on the power spectrum\'s linear axis');
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

/** The panel with a reference set and its answer in. */
function shownFixture(result: PairAnswersMessage = resultFor('pair-1')) {
    const fixture = panelFixture();
    fixture.panel.attach();
    fixture.panel.toggleReference('t1' as TrackId, 0);
    mock.timers.tick(0);
    fixture.panel.handleMessage(result);
    return fixture;
}

test('the pair figure is one Figure of three lanes, a line a response with lines, named and coloured as its lane; no value of a line is in the page', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = shownFixture(resultFor('pair-1', { responses: [answer(), answer({ filePath: '/c.wav', status: 'no-overlap', keys: undefined })] }));
        assert.equal(fixture.figure.made, 1, 'one Figure for the pane');
        const shown = fixture.figure.shown.at(-1);
        assert.deepEqual(shown?.spec.lanes.map(lane => [lane.id, lane.axis, lane.lines.map(line => line.id)]), [
            ['gain', 'own', ['gain|t2:0']], ['phase', 'own', ['phase|t2:0']], ['coherence', 'own', ['coherence|t2:0']],
        ]);
        assert.deepEqual(shown?.spec.keys.map(key => key.key), ['k-gain', 'k-phase', 'k-coherence']);
        assert.deepEqual([shown?.names, shown?.colours], [['b.wav'], ['#f00']]);
        // The display settings' top frequency is the pair figure's too (it shares the power spectrum's axis).
        assert.deepEqual(shown?.settings, { across: [null, 8000] });
        assert.equal(fixture.doc.getElementById('pair-spectrum-plot')?.style.height, '140px');
    }
    finally {
        mock.timers.reset();
    }
});

test('while the answer to what is asked now is not in, the figure is taken away and the pane says why (R7)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        assert.equal(fixture.figure.shown.length, 0);
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairWaiting);
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.figure.shown.length, 1);
        // Another range: the first range's lines are not shown under it.
        const hidden = fixture.figure.hidden;
        fixture.setRange({ startSeconds: 1, endSeconds: 3 });
        fixture.panel.render();
        assert.ok(fixture.figure.hidden > hidden, 'the figure is taken away');
        assert.equal(fixture.figure.shown.length, 1);
        // Only responses with no lines: no figure, and the legend says why of each.
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        fixture.panel.handleMessage(resultFor('pair-2', { responses: [answer({ status: 'too-short', keys: undefined })] }));
        assert.equal(fixture.figure.shown.length, 1);
        assert.ok(fixture.doc.getElementById('pair-spectrum-legend')?.innerHTML.includes(en.pairTooShortHint));
    }
    finally {
        mock.timers.reset();
    }
});

test('a response the Figure drew no gain line of is greyed in the legend once the picture is drawn, and left out of the summary', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.setChannels([
            { trackId: 't1' as TrackId, filePath: '/a.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
            { trackId: 't2' as TrackId, filePath: '/b.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'b.wav', color: '#f00' },
            { trackId: 't3' as TrackId, filePath: '/c.wav', sourceVersion: undefined, channelIndex: 0, offsetSeconds: 0, label: 'c.wav', color: '#00f' },
        ]);
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.panel.handleMessage(resultFor('pair-1', { responses: [answer(), answer({ filePath: '/c.wav', averages: 4 })] }));
        const legend = fixture.doc.getElementById('pair-spectrum-legend')!;
        const summary = fixture.doc.getElementById('pair-spectrum-summary')!;
        assert.ok(!legend.innerHTML.includes('is-empty'), 'before a picture, every response with lines is listed as drawn');
        assert.ok(summary.classList.contains('is-warning'));
        // The figure service left c.wav off the gain axis (another unit's ratio): the Figure drew b.wav's gain alone.
        fixture.figure.gain = ['gain|t2:0'];
        fixture.figure.deps?.drawn?.();
        assert.ok(legend.innerHTML.includes('pair-legend-item is-empty" data-hint="' + en.pairOtherUnitHint + '"'));
        assert.equal(summary.textContent, 'H1 · 32 avg · 1.00–3.00 s');
        assert.ok(!summary.classList.contains('is-warning'));
    }
    finally {
        mock.timers.reset();
    }
});

test('the pair figure and the power spectrum share the range across and the frequency read, both ways (R7, R8)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        // Set before the pane's figure is made: the figure starts with them.
        const fixture = panelFixture();
        fixture.panel.across([100, 2000]);
        fixture.panel.follow(440);
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.deepEqual([fixture.figure.across, fixture.figure.follow], [[[100, 2000]], [440]]);
        // From the power spectrum to the pair figure.
        fixture.panel.across([null, null]);
        fixture.panel.follow(null);
        assert.deepEqual([fixture.figure.across.at(-1), fixture.figure.follow.at(-1)], [[null, null], null]);
        // From the pair figure to the power spectrum: a zoom on it, the point its pointer reads.
        fixture.figure.deps?.ranged?.([500, 900]);
        fixture.figure.deps?.read?.(700);
        fixture.figure.deps?.read?.(null);
        assert.deepEqual([fixture.ranged, fixture.read], [[[500, 900]], [700, null]]);
        // Closing the pane takes its figure away (the screen then tells the power spectrum it reads nothing).
        const hidden = fixture.figure.hidden;
        fixture.panel.toggleReference('t1' as TrackId, 0);
        assert.ok(fixture.figure.hidden > hidden);
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
            requestTrackAnswers: (_filePath: string, _payload: unknown, requestId: string,
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
        type: 'request-track-detail' as const, requestId, analysisId: 'a', settingsSignature: 's', trackIndex, filePath: '/a.wav', sourceVersion: undefined, answers: 'log' as const,
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
