/**
 * R9: a colour bar's end numbers are its colour scale, and a value axis' range fields are the ends it is drawn with.
 * What is written, read back (the true minus undone), is the number the colours or the axis are painted from, on
 * every path: an automatic range (widened out to the numbers written), a typed one (kept exactly), levels, values not
 * in dB, signed pictures (a difference, a cepstrum), large magnitudes with .5 fractions, tiny spans, negative ends,
 * and the report's fixed-size figure as well as the screen's.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { N, R } from './helpers/figure';
import { held } from './helpers/heldSource';
import { paintOverlay, type StagePlot } from '../webview/runtime/stagePanes';
import { dataRange, diffRange, heatmapRange, narrowedRange, type FigureRange } from '../webview/runtime/figureModel';
import { spacingDecimals } from '../webview/plot/plotText';
import { linearAxis, openAxisPart, type RangePopover, type RangePopoverRequest } from '../webview/rangePopover';
import { spectrogramDisplayBounds } from '../webview/runtime/spectrogramRaster';
import * as figureModel from '../webview/runtime/figureModel';

/** A number as the plot writes it, read back: the true minus (U+2212) a plot writes is a hyphen to Number. */
const parsed = (text: string): number => Number(text.replace(/−/gu, '-'));
const decimalsOf = (text: string): number => text.split('.')[1]?.length ?? 0;
/** The decimals a colour bar's span asks for (R7's spacing rule for an eighth of the span, none from 8 up). */
const spanDecimals = (span: number): number => (span >= 8 ? 0 : spacingDecimals(span / 8, 1, 12));

/** A canvas that keeps the texts drawn on it (with where) and the image of cells put on it. */
function imageCanvas(): { canvas: HTMLCanvasElement; texts: Array<{ text: string; x: number; y: number }>; image: () => readonly number[] } {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    let pixels: readonly number[] = [];
    const state = { font: '10px sans-serif', textAlign: 'left' };
    const context = new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'fillText' ? (text: string, x: number, y: number) => { texts.push({ text, x, y }); }
            : key === 'putImageData' ? (image: { data: Uint8ClampedArray }) => { pixels = Array.from(image.data); }
            : key === 'font' || key === 'textAlign' ? state[key]
            : key === 'createImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => { if (key === 'font' || key === 'textAlign') state[key] = String(value); return true; },
    });
    const canvas = { width: 0, height: 0, clientWidth: 360, clientHeight: 160, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, texts, image: () => pixels };
}

type Kind = 'level' | 'roughness' | 'cepstrum' | 'diff';
/** An image whose cells run from `low` to `high` (and between), of a kind with a colour scale. */
function picture(kind: Kind, low: number, high: number): StageView {
    const values = [low, low + (high - low) * 0.3, (low + high) / 2, low + (high - low) * 0.85, high];
    return {
        frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', yAxis: 'frequency',
        quantity: kind === 'diff' ? 'level' : kind, ...(kind === 'roughness' ? { unit: 'asper' } : {}),
        xs: values.map((_, index) => index), ys: [100, 1000], matrix: [values, [...values].reverse()],
    };
}

/** A range the user typed (both ends): painted and written exactly as typed. */
const typedRange = (min: number, max: number): FigureRange => ({ ...R({ min, max }), typed: { min: true, max: true } });

/** Paints `kind` over `range`: the colour bar's two end texts as drawn, and the cells' image. */
function painted(kind: Kind, view: StageView, range: FigureRange, report: boolean): { ends: string[]; image: readonly number[]; plot: StagePlot | null } {
    const { canvas, texts, image } = imageCanvas();
    const plot = paintOverlay(canvas, { layers: [{ view, color: '', full: held(view) }] }, range, N({ x: 'Time [s]', y: 'Frequency [Hz]', colour: kind === 'roughness' ? 'Roughness [asper]' : 'Level [dBFS]' }),
        { ...(kind === 'diff' ? { diff: true } : {}), ...(report ? { size: { width: 360, height: 160 } } : {}) });
    assert.ok(plot, 'the image is drawn');
    // The colour bar's ends: two numbers drawn one after the other on one line at the plot's top (its strip between them).
    const number = (index: number): boolean => !!texts[index] && /^[−-]?\d[\d.]*(e[−-]?\d+)?$/u.test(texts[index].text) && texts[index].y < plot.frame.top + 40;
    const at = texts.findIndex((item, index) => number(index) && number(index + 1) && texts[index + 1].y === item.y);
    return { ends: at < 0 ? [] : [texts[at].text, texts[at + 1].text], image: image(), plot };
}

/** Ranges a colour scale is reachable with: from the range popover (any finite numbers) and from the data. */
function ranges(): Array<{ low: number; high: number }> {
    const fixed = [
        [1000000.5, 1000020.5], [-23.5, 0], [-80.37, -12.04], [-0.0001, 0.0003], [1000000.25, 1000000.75], [-1000000.5, -999992.5],
        [0.0123, 0.4567], [12345.678, 12399.5], [3.14159, 3.14161], [0.002, 0.006], [-120.5, -20.5], [999999.5, 1000000.5], [7.95, 15.95],
        [0.1 + 0.2, 0.9], [-0.35, 0.65],
    ].map(([low, high]) => ({ low, high }));
    // And a grid: large and small magnitudes, .5 fractions, wide and tiny spans, both signs.
    let seed = 7;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const grid: Array<{ low: number; high: number }> = [];
    for (const magnitude of [1e-6, 1e-3, 0.5, 1, 37, 1e3, 1e6]) {
        for (const relative of [1e-6, 1e-3, 0.02, 0.5, 3]) {
            const sign = next() < 0.5 ? -1 : 1, low = sign * magnitude * (1 + next()) + (next() < 0.5 ? 0.5 : 0);
            const span = Math.max(magnitude * relative, 1e-9);
            grid.push({ low, high: low + span * (1 + next()) });
        }
    }
    return [...fixed, ...grid];
}

test('a colour bar\'s end numbers are its colour scale: each, read back, is the end the colours are painted from, auto or typed, on the screen and in a report (R9)', () => {
    const failures: string[] = [];
    for (const { low, high } of ranges()) {
        for (const kind of ['level', 'roughness', 'cepstrum', 'diff'] as const) {
            const view = picture(kind, low, high);
            for (const report of [false, true]) {
                const where = `${kind} ${low}…${high}${report ? ' (report)' : ''}`;
                // Automatic: the scale is widened out to the numbers written; painting from those numbers typed gives the same image.
                const auto = painted(kind, view, R({ min: low, max: high }), report);
                assert.ok(auto.image.some(byte => byte !== 0), `${where}: the cells are painted`);
                if (auto.ends.length !== 2) { failures.push(`${where}: no two end numbers: ${JSON.stringify(auto.ends)}`); continue; }
                const [lowEnd, highEnd] = auto.ends.map(parsed);
                const same = painted(kind, view, typedRange(lowEnd, highEnd), report);
                if (JSON.stringify(same.image) !== JSON.stringify(auto.image)) failures.push(`${where}: written ${auto.ends.join(' to ')}, but its colours are painted from another scale`);
                const signed = kind === 'cepstrum' || kind === 'diff';
                const edge = Math.max(Math.abs(low), Math.abs(high));
                if (signed ? lowEnd !== -highEnd || highEnd < edge : lowEnd > low || highEnd < high) failures.push(`${where}: the scale ${auto.ends.join(' to ')} does not hold every value`);
                // No longer than the span asks for.
                const span = signed ? 2 * edge : high - low;
                if (auto.ends.some(text => decimalsOf(text) > spanDecimals(span))) failures.push(`${where}: ${auto.ends.join(' to ')} written with more decimals than the span needs (${spanDecimals(span)})`);
                // Typed: exactly the typed numbers, written so that they read back as typed.
                const typed = painted(kind, view, typedRange(signed ? -edge : low, signed ? edge : high), report);
                const typedEnds = typed.ends.map(parsed);
                if (typedEnds[0] !== (signed ? -edge : low) || typedEnds[1] !== (signed ? edge : high)) failures.push(`${where}: typed, written ${typed.ends.join(' to ')}`);
            }
        }
    }
    assert.deepEqual(failures, [], 'R9 (docs/display-rules.md): a colour bar writes the very numbers its colours are painted from. '
        + 'Make the scale where ranges are made (figureModel.colourScale: automatic ends widened out to the decimals written, typed ends kept) and write it with stagePanes.colourEndText, which only formats');
});

test('every place that makes a colour range gives a scale whose ends are written exactly: the comparison\'s images, their differences, the entry strip and the spectrogram lanes (R9)', () => {
    const failures: string[] = [];
    for (const { low, high } of ranges()) {
        const view = { ...picture('level', low, high), valueRange: { min: low, max: high } } as StageView;
        const lanes = spectrogramDisplayBounds({ minDb: low, maxDb: high, maxFrequencyHz: 8000 }, { dbMin: null, dbMax: null, maxFrequencyHz: null });
        const typedLane = spectrogramDisplayBounds({ minDb: low, maxDb: high, maxFrequencyHz: 8000 }, { dbMin: low, dbMax: high, maxFrequencyHz: null });
        const made: Array<[string, Kind, FigureRange]> = [
            ['stage image (dataRange)', 'level', dataRange([view])], ['stage difference (diffRange)', 'diff', diffRange({ ...view, valueRange: { min: low, max: high } })],
            ['entry strip (heatmapRange)', 'level', heatmapRange(low, high)],
            ['spectrogram lane', 'level', figureModel.typedColourRange(lanes.dbLo, lanes.dbHi, lanes.dbTyped)],
            ['spectrogram lane, typed', 'level', figureModel.typedColourRange(typedLane.dbLo, typedLane.dbHi, typedLane.dbTyped)],
        ];
        for (const [name, kind, range] of made) {
            const shown = painted(kind, view, range, false);
            const scale = shown.plot?.colourScale;
            if (!scale || shown.ends.length !== 2 || parsed(shown.ends[0]) !== scale.low || parsed(shown.ends[1]) !== scale.high) failures.push(`${name} ${low}…${high}: written ${shown.ends.join(' to ')}, painted ${scale ? `${scale.low} to ${scale.high}` : 'from no scale'}`);
        }
        const typedScale = painted('level', view, figureModel.typedColourRange(typedLane.dbLo, typedLane.dbHi, typedLane.dbTyped), false).plot?.colourScale;
        if (typedScale?.low !== low || typedScale.high !== high) failures.push(`spectrogram lane typed ${low}…${high} is painted from ${typedScale?.low} to ${typedScale?.high}`);
    }
    assert.deepEqual(failures, [], 'R9: every colour range is painted and written from figureModel.colourScale; a typed end is kept exactly');
});

test('floorTo and ceilTo leave a number already written with that many decimals as it is, and otherwise step out to the next one (R9)', () => {
    const { floorTo, ceilTo } = figureModel;
    assert.equal(floorTo(-23.5, 1), -23.5);
    assert.equal(ceilTo(-23.5, 1), -23.5);
    assert.equal(floorTo(0.3, 1), 0.3, '0.3 is not 3 / 10 in binary, and still is 0.3 to one decimal');
    assert.equal(ceilTo(0.1 + 0.2, 1), 0.4);
    assert.equal(floorTo(0.1 + 0.2, 1), 0.3);
    assert.equal(floorTo(1000000.5, 0), 1000000);
    assert.equal(ceilTo(1000000.5, 0), 1000001);
    assert.equal(floorTo(-1000000.5, 0), -1000001);
    assert.equal(ceilTo(-1000000.5, 0), -1000000);
    assert.equal(floorTo(2.675, 2), 2.67, '2.675 is 2.67499… in binary');
    assert.equal(ceilTo(2.675, 2), 2.68);
    assert.equal(floorTo(1e-7, 7), 1e-7);
    assert.ok(Object.is(ceilTo(-0.0001, 1), 0), 'never −0');
    let seed = 3;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let index = 0; index < 4000; index++) {
        const digits = Math.floor(next() * 8), value = (next() - 0.5) * 10 ** Math.floor(next() * 14 - 6);
        const low = floorTo(value, digits), high = ceilTo(value, digits);
        const written = (x: number): boolean => Number(x.toFixed(digits)) === x;
        assert.ok(low <= value && value <= high && written(low) && written(high), `${value} at ${digits}: ${low} … ${high}`);
        assert.ok(high - low <= 10 ** -digits * (1 + 1e-9) + Math.abs(value) * 1e-15, `${value} at ${digits}: ${low} … ${high} is more than one step`);
        const exact = Number(value.toFixed(digits));
        assert.ok(floorTo(exact, digits) === exact && ceilTo(exact, digits) === exact, `${exact} at ${digits} is already written so`);
    }
});

test('a value axis\'s range fields are the ends it is painted with, zoomed or typed: each, read back, is the end drawn (R9)', () => {
    const failures: string[] = [];
    for (const { low, high } of ranges()) {
        const whole = R({ min: low, max: high });
        for (const part of [{ start: 0, end: 1 }, { start: 0.123456, end: 0.876543 }, { start: 0, end: 0.3333333 }, { start: 0.71, end: 1 }]) {
            const range = narrowedRange(whole, part);
            const { canvas } = imageCanvas();
            const line = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 1], values: [low, high] } as StageView;
            const plot = paintOverlay(canvas, { layers: [{ view: line, color: 'a', full: held(line) }] }, range, N({ x: 'Time [s]', y: 'Level [dBFS]' }));
            let request: RangePopoverRequest | null = null;
            const popover: RangePopover = { open(given) { request = given; }, close() { /* nothing open */ } };
            const set: Array<{ start: number; end: number }> = [];
            openAxisPart(popover, { mapping: linearAxis(low, high, 'Level [dBFS]'), horizontal: false, current: part, clientX: 0, clientY: 0, invalid: '', set: next => { set.push(next); }, shown: plot?.valueRange ?? { min: NaN, max: NaN } });
            const opened = request as RangePopoverRequest | null;
            if (!opened) { failures.push('no popover'); continue; }
            if (Number(opened.min) !== range.min || Number(opened.max) !== range.max) failures.push(`${low}…${high} part ${part.start}–${part.end}: fields ${opened.min} to ${opened.max}, drawn ${range.min} to ${range.max}`);
            // Applied unchanged, the axis stays the range it was.
            opened.apply(Number(opened.min), Number(opened.max));
            const again = set.length ? narrowedRange(whole, set[set.length - 1]) : null;
            if (!again || again.min !== range.min || again.max !== range.max) failures.push(`${low}…${high} part ${part.start}–${part.end}: applied unchanged, drawn ${again?.min} to ${again?.max}, not ${range.min} to ${range.max}`);
        }
    }
    assert.deepEqual(failures, [], 'R9: the range popover writes a value axis\'s ends as drawn (openAxisPart `shown`: StagePlot.valueRange), and a zoom\'s ends are the numbers it writes (figureModel.windowEnds)');
});
