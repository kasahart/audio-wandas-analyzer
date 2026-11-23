/**
 * The spectrum overlay's Figure is drawn at the size its host is shown at (the browser checks' canvas audit: no canvas
 * left drawn at another size than it is shown at). The size comes from the host's ResizeObserver only: a ResizeObserver
 * tells a size it has not told before, so a size read by hand in the middle of a paint (a row of the page hidden for a
 * moment and shown again before the next frame) would leave the Figure at a size the observer never corrects
 * (the flake of figureBaseGroup.spec.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult } from '../shared/protocol/generated/backendProtocolSchema';
import { createCompareOverlayScreen, type OverlayPaint } from '../webview/screens/compareOverlay';
import { figurePage, WORDS } from './helpers/figureStandIn';

/** A ResizeObserver as the browser's: at each frame, it tells each element it watches whose size is not the one it last told. */
function fakeObserver(sizeOf: (element: Element) => { width: number; height: number }) {
    const observers: Array<{ callback: ResizeObserverCallback; watched: Map<Element, string> }> = [];
    class FakeResizeObserver {
        private readonly entry: { callback: ResizeObserverCallback; watched: Map<Element, string> };
        constructor(callback: ResizeObserverCallback) { this.entry = { callback, watched: new Map() }; observers.push(this.entry); }
        // The size last told starts at none (0 × 0): the first frame tells the size the element has.
        observe(element: Element): void { this.entry.watched.set(element, '0x0'); }
        unobserve(element: Element): void { this.entry.watched.delete(element); }
        disconnect(): void { this.entry.watched.clear(); }
    }
    return {
        ResizeObserver: FakeResizeObserver as unknown as typeof ResizeObserver,
        frame(): void {
            for (const observer of observers) {
                const changed = [...observer.watched].filter(([element, told]) => { const now = sizeOf(element); return `${now.width}x${now.height}` !== told; });
                if (!changed.length) continue;
                for (const [element] of changed) { const now = sizeOf(element); observer.watched.set(element, `${now.width}x${now.height}`); }
                observer.callback([], observer as unknown as ResizeObserver);
            }
        },
    };
}

function pictureFor(payload: FigureDrawPayload): FigureDrawResult {
    return {
        status: 'picture', figureId: payload.figureId, generation: payload.generation, requestNumber: payload.requestNumber, pictureId: `p${payload.generation}`, dataId: 'd',
        lanes: payload.spec.lanes.map(lane => ({
            id: lane.id, axis: { quantity: lane.id === 'delta' ? 'delta' : 'level', unit: 'FS', reference: 1, referenceLabel: 'dBFS', calibration: 'uncalibrated', xScale: 'log', yScale: 'linear' },
            range: { x: [20, 20000], y: [-60, -10] }, whole: { x: [20, 20000], y: [-60, -10] },
            lines: lane.lines.map(line => ({ id: line.id, ...(line.role ? { role: line.role } : {}), xs: [100, 1000], values: [-40, -30] as never })),
        })),
        headlines: [],
        members: { shown: { used: [], n: 0, excluded: [] }, combined: { used: [], n: 0, excluded: [] }, calibration: 'uncalibrated', lines: [] },
    };
}
const paint: OverlayPaint = {
    keyOf: filePath => ({ key: filePath, state: 'usable', version: 'v1' }),
    name: filePath => filePath, baseName: () => 'the base', style: () => ({ colour: '#888888', width: 1.5 }), legend: () => 0,
};

test('the overlay\'s Figure follows its host\'s size as the ResizeObserver tells it: a size read by hand in the middle of a paint never leaves it drawn at another size than it is shown at', () => {
    const page = figurePage();
    const doc = page.document;
    const el = (): HTMLElement => { const made = doc.createElement('div'); doc.body.append(made); return made; };
    const host = el();
    let height = 682;
    Object.defineProperty(host, 'clientWidth', { get: () => 1034 });
    Object.defineProperty(host, 'clientHeight', { get: () => height });
    const observer = fakeObserver(() => ({ width: 1034, height }));
    const screen = createCompareOverlayScreen({
        document: doc, host, readout: el(), headlineHost: el(), zoomAttributes: el(), drawnAttribute: el(), legendElement: el(), answers: page.answers, words: WORDS, label: 'overlay',
        zoom: () => ({}), freshZoom: () => ({}), rerender: () => undefined, ResizeObserver: observer.ResizeObserver,
    });
    const answer = (): void => { for (const draw of page.draws()) draw.answer(pictureFor(draw.message.payload as FigureDrawPayload)); };
    const canvas = (): HTMLCanvasElement => host.querySelector('canvas[data-figure]')!;
    screen.show({ others: [], base: ['/d/base.wav'], compare: ['/d/a.wav'], delta: false }, paint);
    observer.frame();
    answer();
    assert.equal(canvas().height, 682, 'drawn at the size shown');
    // The comparison paints again (Δ shown): a row above the host is hidden while it paints, so the host is taller
    // for a moment when the screen is shown, and is back before the next frame. The observer has nothing new to tell.
    height = 705;
    screen.show({ others: [], base: ['/d/base.wav'], compare: ['/d/a.wav'], delta: true }, paint);
    height = 682;
    observer.frame();
    answer();
    observer.frame();
    assert.equal(canvas().height, host.clientHeight, 'the Figure is drawn at the size its host is shown at');
    // A size the host really takes is told, and followed.
    height = 600;
    observer.frame();
    answer();
    assert.equal(canvas().height, 600);
    screen.hide();
});
