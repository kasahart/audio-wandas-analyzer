/**
 * The pick rule of docs/display-rules.md R7 on the webview's side: every case of
 * python-backend/tests/fixtures/pick_cases.json, the one table the backend's implementation runs too
 * (python-backend/test_pick_cases.py), against the objects the app reads with: a plot painted by paintOverlay on the
 * case's view, its line held whole (localLine), read by stageHover (fullLineNear: the point nearest the pointer on
 * screen within the pick radius, else the point under it) and stepped by stageStep (from the point read, by place).
 * A case the webview cannot express says so in the table (`not_on.ts`, with why) and is listed here, never skipped
 * unsaid; a case the code does not follow yet records what it does today (`today`) and which work changes it, and
 * fails here once the code follows the rule, so the record is taken off.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { N, R } from './helpers/figure';
import { testLine } from './helpers/whole';
import { HOVER_PICK_RADIUS_PX } from '../webview/runtime/plotHover';
import { paintOverlay, stageHover, stageStep, type StageLayer, type StagePlot, type StageRead } from '../webview/runtime/stagePanes';
import type { StageView } from '../shared/protocol/backendProtocol';

const repoRoot = path.resolve(__dirname, '..', '..');
const TABLE_PATH = path.join(repoRoot, 'python-backend', 'tests', 'fixtures', 'pick_cases.json');

type Value = number | null | 'nan' | 'inf' | '-inf';
type View = { x: [number, number]; xScale: 'linear' | 'log'; y: [number, number]; box: { width: number; height: number } };
type Case = {
    name: string; mode: 'nearest' | 'under' | 'step+' | 'step-'; view: View; plain: boolean; points: Array<[number, Value]>;
    pointer?: { x: number; y: number }; from?: number; expect: number | null;
    not_on?: { ts?: string; py?: string }; today?: { ts?: number | null; py?: number | null; handoff: string };
};
const TABLE = JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as { radius: number; cannot: Record<string, string>; cases: Case[] };

const FIX = 'R7 (docs/display-rules.md, the pick table) broke in the webview: stagePanes.stageHover / fullLineNear or stageStep '
    + 'no longer answers this case of python-backend/tests/fixtures/pick_cases.json as the table says. Change the rule only by '
    + 'changing the table, fullLineNear / stageStep and full_read.py together (python-backend/test_pick_cases.py runs the same table).';

const NON_FINITE: Record<string, number> = { nan: NaN, inf: Infinity, '-inf': -Infinity };

/** A canvas that draws nothing, of `width` × `height` CSS px. */
function canvas(width: number, height: number): HTMLCanvasElement {
    const state = new Map<PropertyKey, unknown>([['font', '10px sans-serif']]);
    const context = new Proxy({}, {
        get: (_target, key) => (state.has(key) ? state.get(key) : key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => undefined),
        set: (_target, key, value) => { state.set(key, value); return true; },
    });
    return { width: 0, height: 0, clientWidth: width, clientHeight: height, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
}

/**
 * The case's plot as the app paints it: its view's x range and scale, its value range, a frame of the case's box
 * (the canvas sized so the painted frame is exactly that box), the line held whole.
 */
function painted(item: Case): { plot: StagePlot; layer: StageLayer } {
    const xs = item.points.map(point => point[0]);
    const values = item.points.map(([, value]) => (value === null ? null : typeof value === 'string' ? NON_FINITE[value] : value));
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: item.view.xScale, quantity: item.plain ? 'value' : 'level', xs: item.view.x, values: item.view.y, ...(item.view.xScale === 'log' ? { xLimits: item.view.x } : {}) } as unknown as StageView;
    const layer: StageLayer = { view, color: '#08f', label: 'line', full: testLine(xs, values) };
    const axes = N({ x: 'Frequency [Hz]', y: item.plain ? 'Value [Pa]' : 'Level [dBFS]' });
    let size = { width: item.view.box.width + 100, height: item.view.box.height + 60 };
    for (let tries = 0; tries < 4; tries++) {
        const plot = paintOverlay(canvas(size.width, size.height), { layers: [layer] }, R({ min: item.view.y[0], max: item.view.y[1] }), axes);
        assert.ok(plot, `${item.name}: painted`);
        const { width, height } = plot.frame;
        if (width === item.view.box.width && height === item.view.box.height) {
            const ends = [plot.xAt(item.view.x[0]) - plot.frame.left, plot.xAt(item.view.x[1]) - plot.frame.left];
            assert.ok(Math.abs(ends[0]) < 1e-9 && Math.abs(ends[1] - width) < 1e-9, `${item.name}: the x range spans the box (${ends.join(', ')})`);
            assert.ok(Math.abs(plot.yOf(item.view.y[1]) - plot.frame.top) < 1e-9 && Math.abs(plot.yOf(item.view.y[0]) - plot.frame.top - height) < 1e-9, `${item.name}: the value range spans the box`);
            return { plot, layer };
        }
        size = { width: size.width + item.view.box.width - width, height: size.height + item.view.box.height - height };
    }
    throw new Error(`${item.name}: no canvas paints a frame of ${item.view.box.width} × ${item.view.box.height}`);
}

/** The index the webview reads for `item`, with the read's distance for a hover. */
function answer(item: Case): number | null {
    const { plot } = painted(item);
    const { left, top } = plot.frame;
    if (item.mode === 'nearest' || item.mode === 'under') {
        assert.ok(item.pointer, `${item.name}: a hover case gives the pointer`);
        const read = stageHover(plot, left + item.pointer.x, top + item.pointer.y);
        assert.ok(!read?.pending, `${item.name}: a line held whole is read at once`);
        if (!read) return null;
        // Within the radius by its place on screen: a read under the pointer at its height is `away` the radius too.
        const near = (read.away ?? Infinity) <= HOVER_PICK_RADIUS_PX && Math.hypot(read.x - left - item.pointer.x, read.y - top - item.pointer.y) <= HOVER_PICK_RADIUS_PX;
        // `nearest`: the point read within the pick radius; `under`: the point read with none within it.
        if (item.mode === 'nearest') return near ? read.index ?? null : null;
        assert.ok(!near, `${item.name}: an "under" case has no point within the radius (it read ${read.index} ${read.away} px away)`);
        return read.index ?? null;
    }
    assert.ok(item.from !== undefined, `${item.name}: a step case gives the point it steps from`);
    const [x, value] = item.points[item.from];
    assert.ok(typeof value === 'number', `${item.name}: steps from a point with a value`);
    // The point read as the pointer on it reads it, at its index (a point beside it at the same x is another).
    const hovered = stageHover(plot, plot.xAt(x), Math.min(top + plot.frame.height, Math.max(top, plot.yOf(value))));
    assert.ok(hovered && hovered.at === x, `${item.name}: the pointer on point ${item.from} reads it`);
    const read: StageRead = { ...hovered, index: item.from };
    const stepped = stageStep(plot, read, item.mode === 'step+' ? 1 : -1);
    assert.notEqual(stepped, undefined, `${item.name}: a line held whole steps at once`);
    return stepped?.index ?? null;
}

test('every pick case of the table is read by the webview as the table says: nearest, under, ← and → (R7)', () => {
    assert.equal(TABLE.radius, HOVER_PICK_RADIUS_PX, 'the table\'s pick radius is the webview\'s (plotHover.HOVER_PICK_RADIUS_PX)');
    const broken: string[] = [];
    for (const item of TABLE.cases) {
        const cannot = item.not_on?.ts;
        if (cannot) { assert.ok(TABLE.cannot[cannot], `${item.name}: a case left out of the webview's run names its reason, a key of \`cannot\``); continue; }
        try {
            const got = answer(item);
            const today = item.today;
            if (today && 'ts' in today) {
                assert.equal(got, today.ts, `${item.name}: the webview now reads ${got}, not ${today.ts} as recorded under \`today\`; if it follows the rule (${item.expect}), take \`today.ts\` off the case. ${today.handoff}`);
                assert.notEqual(got, item.expect, `${item.name}: follows the rule now: take \`today.ts\` off the case`);
                continue;
            }
            assert.equal(got, item.expect, `${item.name}: the webview reads ${got}, the table says ${item.expect}`);
        } catch (error) {
            broken.push(error instanceof Error ? error.message.split('\n')[0] : String(error));
        }
    }
    assert.deepEqual(broken, [], FIX);
});

test('the pick cases the webview cannot express are listed with why (R7)', () => {
    // A new case left out of the webview's run is a finding: name it here, as the backend's test names its own.
    assert.deepEqual(TABLE.cases.filter(item => item.not_on?.ts).map(item => item.name), []);
});
