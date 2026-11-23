/**
 * An export takes, when it is asked, the
 * declaration, the names, the base, the colours and the data id, and writes only from that and its own reply; an export
 * that will never be answered (a newer one took its place, or its Figure or screen went) settles its promise, rejected
 * with the reason, and ends its long computation: it never hangs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FigureDrawPayload, FigureDrawResult, FigureExportPayload, FigureSpec } from '../shared/protocol/generated/backendProtocolSchema';
import { FigureExportDropped, type Figure, type FigureInspection } from '../webview/figure/figure';
import { createCompareOverlayScreen, type OverlayPaint } from '../webview/screens/compareOverlay';
import { figurePage, SCENE_SIZE, scenePicture, sceneSpec, WORDS, type FigurePage } from './helpers/figureStandIn';
import type { Scene } from './helpers/figureOverlayRun';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE = path.join(path.resolve(__dirname, '..', '..'), 'python-backend', 'tests', 'fixtures', 'figure_overlay_cases.json');
const SCENE = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { scenes: Record<string, Scene> }).scenes.spectrum;

/** How a promise stands after the replies so far: resolved, rejected (with its reason), or still pending. */
async function standing<T>(promise: Promise<T>): Promise<{ resolved: T } | { rejected: unknown } | 'pending'> {
    const pending = Symbol('pending');
    const got = await Promise.race([promise.then(value => ({ resolved: value }), (error: unknown) => ({ rejected: error })), new Promise<symbol>(resolve => { setTimeout(() => resolve(pending), 5); })]);
    return got === pending ? 'pending' : got as { resolved: T } | { rejected: unknown };
}

/** The service's export reply for the scene's lines, every answer, of `dataId`. */
function exportReply(payload: FigureExportPayload, keys: Record<string, string | undefined>): unknown {
    const column = (lane: string, line: string) => ({ lane, line, ...(keys[line] ? { key: keys[line] } : {}), quantity: lane === 'delta' ? 'delta' : 'level', xs: SCENE.lines[line as keyof Scene['lines']].xs.slice(0, 2), values: [-40, -30] });
    return { status: 'rows', dataId: payload.dataId, requestNumber: payload.requestNumber, axes: [], columns: [column('overlay', 'median'), column('overlay', 'compare')], headlines: [], members: { shown: { used: [], n: 0, excluded: [] }, combined: { used: [], n: 0, excluded: [] }, calibration: 'uncalibrated', lines: [] } };
}

function drawnFigure(page: FigurePage, names: Record<string, string>): Figure {
    const figure = page.figure(undefined, { ...SCENE_SIZE, lineLabel: line => names[line.id] ?? line.id });
    figure.show(sceneSpec(), null);
    for (const draw of page.draws()) draw.answer(scenePicture(SCENE, draw.message.payload as never, 'shown'));
    return figure;
}

test('class 4 (F): the CSV is named as the picture was when it was asked, never as the screen names its lines when the reply comes', async () => {
    const page = figurePage();
    const names: Record<string, string> = { median: 'base of 3', compare: 'recording A' };
    const figure = drawnFigure(page, names);
    const table = figure.exportTable();
    // While the export is on its way, the screen names its lines otherwise (another recording slotted, another base).
    names.compare = 'recording B';
    names.median = 'base of 5';
    const [asked] = page.take(message => message.command === 'figure-export');
    asked.answer(exportReply(asked.message.payload as FigureExportPayload, { compare: 'cmp' }));
    const got = await table;
    assert.equal(got.status, 'rows');
    if (got.status !== 'rows') return;
    assert.deepEqual(got.header.slice(0, 4), ['base of 3 Frequency [Hz]', 'base of 3 Level (uncalibrated) [dBFS]', 'recording A Frequency [Hz]', 'recording A Level (uncalibrated) [dBFS]']);
    figure.dispose();
});

test('class 4 (F): a CSV reply whose line is of another recording than the picture asked of is refused as changed', async () => {
    const page = figurePage();
    const figure = drawnFigure(page, {});
    const table = figure.exportTable();
    const [asked] = page.take(message => message.command === 'figure-export');
    asked.answer(exportReply(asked.message.payload as FigureExportPayload, { compare: 'cmp-b' }));
    assert.deepEqual(await table, { status: 'changed' });
    figure.dispose();
});

test('class 4 (J): an export a newer one took the place of while it waited, and one on its way when its Figure is disposed, settle rejected with the reason; the long computation ends', async () => {
    const page = figurePage({ holds: true });
    const figure = drawnFigure(page, {});
    const first = figure.exportTable();
    const second = figure.exportTable();
    const third = figure.exportTable();
    const reasonOf = (got: Awaited<ReturnType<typeof standing>>): unknown => (got !== 'pending' && 'rejected' in got && got.rejected instanceof FigureExportDropped ? got.rejected.reason : got);
    assert.equal(reasonOf(await standing(second)), 'superseded', 'the waiting export a newer one replaced');
    assert.equal(await standing(first), 'pending', 'the one on its way still waits for its reply');
    figure.dispose();
    assert.equal(reasonOf(await standing(first)), 'disposed');
    assert.equal(reasonOf(await standing(third)), 'disposed');
    assert.equal(page.answers.computations.count(), 0, 'no long computation is left counted (spec 4: reads are not held forever)');
});

// ── The screen's PNG ───────────────────────────────────────────────────────────────────────────────────────────

/** A picture of whatever spec a draw asks for: every line two points, each of its key (one base recording: that one). */
function pictureFor(payload: FigureDrawPayload, picture: string, dataId: string): FigureDrawResult {
    const spec = payload.spec;
    const keyOf = (of: FigureSpec['lanes'][number]['lines'][number]['of']): string | undefined => ('key' in of ? of.key : 'median' in of && of.median?.length === 1 ? of.median[0] : undefined);
    return {
        status: 'picture', figureId: payload.figureId, generation: payload.generation, requestNumber: payload.requestNumber, pictureId: picture, dataId,
        lanes: spec.lanes.map(lane => ({
            id: lane.id, axis: { quantity: lane.id === 'delta' ? 'delta' : 'level', unit: 'FS', reference: 1, referenceLabel: 'dBFS', calibration: 'uncalibrated', xScale: 'log', yScale: 'linear' },
            range: { x: [20, 20000], y: [-60, -10] }, whole: { x: [20, 20000], y: [-60, -10] },
            lines: lane.lines.map(line => ({ id: line.id, ...(line.role ? { role: line.role } : {}), ...(keyOf(line.of) ? { key: keyOf(line.of)! } : {}), xs: [100, 1000], values: [-40, -30] as never })),
        })),
        headlines: [],
        members: { shown: { used: [], n: 0, excluded: [] }, combined: { used: [], n: 0, excluded: [] }, calibration: 'uncalibrated', lines: [] },
    };
}

function overlayScreen(page: FigurePage) {
    const doc = page.document;
    const el = (): HTMLElement => { const made = doc.createElement('div'); doc.body.append(made); return made; };
    const host = el();
    Object.defineProperty(host, 'clientWidth', { get: () => 600 });
    Object.defineProperty(host, 'clientHeight', { get: () => 300 });
    page.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    const screen = createCompareOverlayScreen({
        document: doc, host, readout: el(), headlineHost: el(), zoomAttributes: el(), drawnAttribute: el(), legendElement: el(), answers: page.answers, words: WORDS, label: 'overlay',
        zoom: () => ZOOM, freshZoom: () => ZOOM, rerender: () => undefined,
    });
    // The off-page Figure the PNG is drawn by: its canvas, caught as the screen makes it.
    const made: HTMLCanvasElement[] = [];
    const create = doc.createElement.bind(doc);
    doc.createElement = ((name: string) => { const out = create(name); if (name === 'canvas') made.push(out as HTMLCanvasElement); return out; });
    return { screen, made };
}
const ZOOM = {};
/** The comparison's paint: names and colours by recording, as the legend has them now. */
function paintOf(colours: Record<string, string>): OverlayPaint {
    return {
        keyOf: filePath => ({ key: filePath, state: 'usable', version: 'v1' }),
        name: filePath => `name of ${filePath}`,
        baseName: () => 'the base',
        style: (filePath, kind) => ({ colour: filePath ? colours[filePath] ?? '#000000' : kind === 'base' ? '#9aa0a6' : '#555555', width: 1.5 }),
        legend: () => 0,
    };
}

test('class 4 (F): the PNG is drawn with the names and colours taken when it was asked, never with what the screen shows when its picture comes; hidden meanwhile, it settles rejected', async () => {
    const page = figurePage();
    const { screen, made } = overlayScreen(page);
    screen.show({ others: [], base: ['/d/base.wav'], compare: ['/d/a.wav'], delta: false }, paintOf({ '/d/a.wav': '#ff0000' }));
    for (const draw of page.draws()) draw.answer(pictureFor(draw.message.payload as FigureDrawPayload, 'screen-a', 'data-a'));
    const png = screen.exportPng({ width: 800, height: 400 });
    const canvas = made.at(-1)!;
    const [pngDraw, ...rest] = page.draws();
    assert.equal(rest.length, 0, 'the PNG asks one draw');
    // While it is on its way, the comparison slots another recording in compare 1, coloured otherwise.
    screen.show({ others: [], base: ['/d/base.wav'], compare: ['/d/a.wav'], delta: false }, paintOf({ '/d/a.wav': '#0000ff' }));
    pngDraw.answer(pictureFor(pngDraw.message.payload as FigureDrawPayload, 'png-a', 'data-a'));
    const got = await png;
    assert.equal(got.status, 'png');
    const inspect = (canvas as HTMLCanvasElement & { __figureInspect: () => FigureInspection }).__figureInspect();
    assert.equal(inspect.lanes[0].lines.find(line => line.id === 'compare1')?.colour, '#ff0000', 'compare 1 in the colour it had when the PNG was asked');
    // An export the screen is hidden under settles, rejected: never a promise left hanging.
    const again = screen.exportPng({ width: 800, height: 400 });
    screen.hide();
    const settled = await standing(again);
    assert.ok(settled !== 'pending' && 'rejected' in settled && settled.rejected instanceof FigureExportDropped && settled.rejected.reason === 'disposed', 'rejected, the screen gone');
    assert.equal(page.answers.computations.count(), 0, 'its long computation ended');
});
