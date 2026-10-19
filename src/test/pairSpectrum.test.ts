import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import type { PairSpectrumResult } from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { isRequestPairSpectrumMessage, type PairSpectrumRequest } from '../shared/utils/audioTarget';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { isHostInboundMessage } from '../webview/runtime/hostMessaging';
import {
    paintPairSpectrum, pairHeader, pairLegendHtml, referenceButtonHtml, syncReferenceButtons,
    type PairCurve, type PairSpectrumResponse, type PairSpectrumResultMessage,
} from '../webview/runtime/pairSpectrum';
import { PAIR_REQUEST_DELAY_MS, PairSpectrumPanel, type PairChannelSource, type PairPanelHost } from '../webview/runtime/pairSpectrumPanel';
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
    assert.equal(en.pairReferenceHint, 'Set as reference');
    assert.equal(ja.pairReferenceHint, '基準にする');
    assert.equal(en.pairReferenceBadge, 'Ref');
    assert.equal(ja.pairReferenceBadge, '基準');
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

function recordingContext(): CanvasDrawCtx & { lines: number } {
    const ctx = {
        lines: 0,
        fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: 'top', globalAlpha: 1, lineWidth: 1,
        setLineDash() { }, save() { }, restore() { }, translate() { }, rotate() { }, beginPath() { }, moveTo() { },
        lineTo() { ctx.lines += 1; }, stroke() { }, rect() { }, clip() { }, clearRect() { }, fillRect() { }, strokeRect() { }, fillText() { },
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData() { },
    };
    return ctx as unknown as CanvasDrawCtx & { lines: number };
}

test('the pair plot draws ok responses only and reads out the hovered bin', () => {
    const ctx = recordingContext();
    const readout = paintPairSpectrum(ctx, 400, 180, {
        frequencyBins: 3, maxFrequencyHz: 1000,
        curves: [curve(), curve({ status: 'no-overlap', gainDb: [], phaseRad: [], coherence: [] }, 'c.wav')],
    }, { frequencyMin: 0, frequencyMax: 1000 }, 520, en, DEFAULT_THEME);
    // Two segments in each of the three rows for the one drawn response, plus the crosshair.
    assert.equal(ctx.lines, 3 * 2 + 1);
    assert.equal(readout?.frequencyHz, 500);
    assert.equal(readout?.text, 'b.wav / 500 Hz / -6.0 dB / 90° / γ² 0.99');
});

test('pair requests and results pass their validators', () => {
    const request: PairSpectrumRequest = {
        type: 'request-pair-spectrum', requestId: 'r', analysisId: 'a', settingsSignature: 's',
        reference: { filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0 },
        responses: [{ filePath: '/b.wav', channelIndex: 1, offsetSeconds: 0.25 }],
        startSeconds: 1, endSeconds: 3,
    };
    assert.equal(isRequestPairSpectrumMessage(request), true);
    assert.equal(parsePanelMessage(request)?.type, 'request-pair-spectrum');
    assert.equal(isRequestPairSpectrumMessage({ ...request, startSeconds: Number.NaN }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, reference: { filePath: '', channelIndex: 0, offsetSeconds: 0 } }), false);
    assert.equal(isRequestPairSpectrumMessage({ ...request, responses: [{ filePath: '/b.wav', channelIndex: -1, offsetSeconds: 0 }] }), false);

    const result = { type: 'pair-spectrum-result', requestId: 'r', analysisId: 'a', settingsSignature: 's', filePath: '/a.wav', channelIndex: 0,
        frequencyBins: 3, maxFrequencyHz: 1000, nFft: 4, hopLength: 1, window: 'hann', computeMs: 1, responses: [response()] };
    assert.equal(isHostInboundMessage(result), true);
    assert.equal(isHostInboundMessage({ ...result, responses: [response({ gainDb: [0] })] }), false);
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

function controllerWith(result: () => Promise<PairSpectrumResult>, canPublish: (filePath: string, revision: number | undefined) => boolean) {
    const published: SessionPublication[] = [];
    const calls: unknown[][] = [];
    const ports = {
        scope: () => ({ isCurrent: () => true, canPublish }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => ({ nFft: 4096, hopLength: 1024, window: 'hann' }),
        lazyContext: (filePath: string) => ({ analysisRevision: filePath === '/a.wav' ? 2 : 5 }),
        client: { requestPairSpectrum: (...args: unknown[]) => { calls.push(args); return result(); } },
    } as unknown as ComparisonSessionPorts;
    return { controller: new ComparisonSessionController(ports), published, calls };
}

const pairRequest: PairSpectrumRequest = {
    type: 'request-pair-spectrum', requestId: 'r1', analysisId: 'a', settingsSignature: 's',
    reference: { filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0 },
    responses: [{ filePath: '/b.wav', channelIndex: 0, offsetSeconds: 0.5 }],
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

test('the session controller reports a failed pair request', async () => {
    const { controller, published } = controllerWith(async () => { throw new Error('too long'); }, () => true);
    await controller.handle(pairRequest);
    assert.deepEqual(published, [{ type: 'pair-spectrum-error', requestId: 'r1', analysisId: 'a', settingsSignature: 's', error: 'too long' }]);
});

const PANEL_DOM = '<div id="spectrum-section"><div id="spectrum-split"><div id="spectrum-overlay-wrap"></div>'
    + '<div id="pair-divider"></div><div id="pair-spectrum-wrap"><span id="pair-spectrum-summary"></span><span id="pair-spectrum-legend"></span>'
    + '<span id="pair-spectrum-readout"></span><div id="pair-spectrum-plot"><canvas id="pair-spectrum-canvas"></canvas>'
    + '<div id="pair-spectrum-message"></div></div></div></div></div>';

function panelFixture() {
    const dom = new JSDOM(PANEL_DOM + referenceButtonHtml('t1', 0, en) + referenceButtonHtml('t2', 0, en));
    const doc = dom.window.document;
    (doc.getElementById('pair-spectrum-canvas') as HTMLCanvasElement).getContext = (() => null) as never;
    const posted: PairSpectrumRequest[] = [];
    const references: Array<unknown> = [];
    let channels: PairChannelSource[] = [
        { trackId: 't1' as TrackId, filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' },
        { trackId: 't2' as TrackId, filePath: '/b.wav', channelIndex: 0, offsetSeconds: 0.5, label: 'b.wav', color: '#f00' },
    ];
    let range: { startSeconds: number; endSeconds: number } | null = null;
    let requestCount = 0;
    const host: PairPanelHost = {
        channels: () => channels,
        range: () => range,
        analysisId: () => 'a',
        settingsSignature: () => 's',
        nextRequestId: () => 'pair-' + (++requestCount),
        post: request => { posted.push(request); },
        visibleFraction: () => ({ start: 0, end: 1 }),
        plotHeight: () => 140,
        theme: () => DEFAULT_THEME,
        onReferenceChange: reference => { references.push(reference); },
        onLayoutChange: () => undefined,
    };
    const panel = new PairSpectrumPanel(doc, host, en);
    return {
        doc, panel, posted, references,
        setChannels(next: PairChannelSource[]) { channels = next; },
        setRange(next: typeof range) { range = next; },
    };
}

function resultFor(requestId: string, overrides: Partial<PairSpectrumResultMessage> = {}): PairSpectrumResultMessage {
    const { analysisRevision: _revision, calibrationSignature: _signature, ...rest } = pairResult();
    return { type: 'pair-spectrum-result', requestId, ...rest, ...overrides };
}

test('the pair panel requests once per change of sources or range, never for a repeat', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const fixture = panelFixture();
        fixture.panel.toggleReference('t1' as TrackId, 0);
        mock.timers.tick(0);
        assert.equal(fixture.posted.length, 1);
        assert.deepEqual(fixture.posted[0].reference, { filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0 });
        assert.deepEqual(fixture.posted[0].responses, [{ filePath: '/b.wav', channelIndex: 0, offsetSeconds: 0.5 }]);
        assert.equal('startSeconds' in fixture.posted[0], false);
        assert.ok(fixture.doc.getElementById('spectrum-section')?.classList.contains('has-pair'));
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, en.pairWaiting);

        // A cursor move re-renders with the same sources and range.
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 1);

        fixture.setRange({ startSeconds: 1, endSeconds: 3 });
        fixture.panel.sync();
        mock.timers.tick(PAIR_REQUEST_DELAY_MS);
        assert.equal(fixture.posted.length, 2);
        assert.equal(fixture.posted[1].startSeconds, 1);
        assert.equal(fixture.posted[1].endSeconds, 3);

        // The first answer arrives after the second request went out.
        fixture.panel.handleMessage(resultFor('pair-1'));
        assert.equal(fixture.panel.waiting, true);
        fixture.panel.handleMessage(resultFor('pair-2'));
        assert.equal(fixture.panel.lastResult?.requestId, 'pair-2');
        assert.equal(fixture.doc.getElementById('pair-spectrum-summary')?.textContent, 'H1 · 32 avg · 1.00–3.00 s');
        assert.equal(fixture.doc.getElementById('pair-spectrum-message')?.textContent, '');
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

        fixture.setChannels([{ trackId: 't1' as TrackId, filePath: '/a.wav', channelIndex: 0, offsetSeconds: 0, label: 'a.wav', color: '#0f0' }]);
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

test('toggling the reference lane again clears it', () => {
    const fixture = panelFixture();
    fixture.panel.toggleReference('t2' as TrackId, 0);
    assert.equal(fixture.doc.querySelector('[data-track-id="t2"]')?.getAttribute('aria-pressed'), 'true');
    fixture.panel.toggleReference('t2' as TrackId, 0);
    assert.equal(fixture.panel.reference, null);
    assert.equal(fixture.doc.querySelector('[data-track-id="t2"]')?.getAttribute('aria-pressed'), 'false');
    fixture.panel.dispose();
});
