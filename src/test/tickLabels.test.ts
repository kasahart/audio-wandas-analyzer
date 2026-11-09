import assert from 'node:assert/strict';
import { N, R } from './helpers/figure';
import test from 'node:test';
import { held } from './helpers/heldSource';
import type { StageView } from '../shared/protocol/backendProtocol';
import { paintOverlay, paintSideAxis, valueAxisTicks } from '../webview/runtime/stagePanes';

interface Drawn { text: string; x: number; y: number; align: string; baseline: string }

/** A canvas whose context keeps every unturned number it is asked to write, where and how it is aligned. */
function textCanvas(width: number, height: number): { canvas: HTMLCanvasElement; drawn: Drawn[] } {
    const drawn: Drawn[] = [];
    const state = { textAlign: 'start', textBaseline: 'alphabetic', font: '10px sans-serif', turned: false, dx: 0, dy: 0 };
    const stack: Array<typeof state> = [];
    const context = new Proxy({}, {
        get: (_target, key) => {
            if (key === 'measureText') return (text: string) => ({ width: [...text].length * 6 });
            if (key === 'fillText') return (text: string, x: number, y: number) => { if (!state.turned) drawn.push({ text, x: x + state.dx, y: y + state.dy, align: state.textAlign, baseline: state.textBaseline }); };
            if (key === 'save') return () => { stack.push({ ...state }); };
            if (key === 'restore') return () => { Object.assign(state, stack.pop() ?? state); };
            if (key === 'rotate') return () => { state.turned = true; };
            if (key === 'translate') return (x: number, y: number) => { state.dx += x; state.dy += y; };
            if (key === 'setTransform') return () => { state.dx = 0; state.dy = 0; state.turned = false; };
            if (key in state) return state[key as keyof typeof state];
            return () => ({ addColorStop: () => undefined, data: new Uint8ClampedArray(4), width: 1, height: 1 });
        },
        set: (_target, key, value) => { if (key in state) (state as Record<string, unknown>)[key as string] = value; return true; },
    });
    const canvas = { width, height, clientWidth: width, clientHeight: height, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, drawn };
}

const NUMBER = /^[−+-]?\d[\d.]*(e[−+-]?\d+)?k?$/u;

/**
 * Pairs of number labels written in one column (the same alignment and x: one axis's ticks) whose boxes overlap, a
 * label being 10 px tall about its baseline as the canvas places it.
 */
function overlapping(drawn: readonly Drawn[]): string[] {
    const box = (label: Drawn): [number, number] => (label.baseline === 'top' ? [label.y, label.y + 10] : label.baseline === 'bottom' ? [label.y - 10, label.y] : label.baseline === 'middle' ? [label.y - 5, label.y + 5] : [label.y - 8, label.y + 2]);
    const columns = new Map<string, Drawn[]>();
    for (const label of drawn.filter(item => NUMBER.test(item.text))) {
        const key = `${label.align}@${Math.round(label.x)}`;
        columns.set(key, [...(columns.get(key) ?? []), label]);
    }
    const found: string[] = [];
    for (const column of columns.values()) {
        const sorted = column.map(label => ({ label, box: box(label) })).sort((a, b) => a.box[0] - b.box[0]);
        sorted.forEach((item, index) => {
            const next = sorted[index + 1];
            if (next && next.box[0] < item.box[1]) found.push(`"${item.label.text}" and "${next.label.text}"`);
        });
    }
    return found;
}

const RANGES = [{ min: 0, max: 1 }, { min: -180, max: 180 }, { min: -80, max: 0 }, { min: -6, max: 0.5 }, { min: -1, max: 1 }, { min: -0.022, max: 0.022 }, { min: 0, max: 2.5e-6 }];
const line = (range: { min: number; max: number }): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: [0, 1000], values: [range.min, range.max] });
const bark: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'roughness', unit: 'asper', yAxis: 'bark', xs: [0, 1], ys: Array.from({ length: 48 }, (_, i) => i / 2), matrix: Array.from({ length: 48 }, () => [0.1, 0.2]) };

test('no two tick labels on a value axis overlap, on a plot of any height: a short plot gets fewer ticks', () => {
    for (let height = 12; height <= 320; height += 1) {
        for (const range of RANGES) {
            const { canvas, drawn } = textCanvas(400, height);
            // The pair view's margins: the whole canvas height is its plot.
            paintOverlay(canvas, { layers: [{ view: line(range), color: '#0f0', full: held(line(range)) }] }, R(range), N({ x: 'Frequency [Hz]', y: 'Value [Pa]' }), { margins: { left: 52, right: 4, top: 0, bottom: 0 } });
            assert.deepEqual(overlapping(drawn), [], `${height} px, ${range.min} to ${range.max}`);
            if (height >= 40) assert.ok(drawn.filter(item => NUMBER.test(item.text) && item.align === 'right').length >= 2, `${height} px keeps two ticks at least`);
        }
        const heat = textCanvas(400, height);
        paintOverlay(heat.canvas, { layers: [{ view: bark, color: '', full: held(bark) }] }, R({ min: 0, max: 0.3 }), N({ x: 'Time [s]', y: 'Critical band [Bark]', colour: 'Roughness [asper]' }), { margins: { left: 52, right: 4, top: 0, bottom: 0 } });
        assert.deepEqual(overlapping(heat.drawn), [], `heatmap rows, ${height} px`);
        const side = textCanvas(40, height);
        paintSideAxis(side.canvas, valueAxisTicks({ min: -1, max: 1 }), 'Amplitude [Pa]', { muted: '#888', text: '#ddd' });
        assert.deepEqual(overlapping(side.drawn), [], `a lane's own axis canvas, ${height} px`);
    }
});

test('a tall plot keeps its round steps: 0 to 1 in quarters', () => {
    assert.deepEqual(valueAxisTicks({ min: 0, max: 1 }, 300).map(tick => tick.text), ['0.00', '0.25', '0.50', '0.75', '1.00']);
    assert.deepEqual(valueAxisTicks({ min: 0, max: 1 }), valueAxisTicks({ min: 0, max: 1 }, 300), 'an axis of unknown height keeps them all');
    assert.ok(valueAxisTicks({ min: 0, max: 1 }, 38).length < 5, 'a 38 px plot has fewer');
});
