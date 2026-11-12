/**
 * The track lanes' axes follow the plot component's rules (R3): each amplitude tick sits where the waveform is drawn at
 * that value, zoomed or not, and the ticks, their text and the titles are the ones Compare's plots use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneAmplitudeTicks, laneTimeTicks } from '../webview/runtime/laneAxes';
import { laneAmplitudeRange } from '../webview/runtime/figureModel';
import { makeCoordTransform } from '../webview/waveform/waveformRenderer';
import { fontPixels } from '../webview/plot/axisTitle';
import { valueAxisTicks, alongAxisTicks, amplitudeAxisTitle, paintSideAxis } from '../webview/runtime/stagePanes';
import { getStrings } from '../shared/i18n/strings';

const H = 120;

test('a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not', () => {
    for (const viewport of [undefined, { minNorm: -0.3, maxNorm: 0.7 }]) {
        for (const peak of [1, 0.005, 16383, 2e-5, 1e-6, 1e-9]) {
            const range = laneAmplitudeRange(peak, viewport);
            // As the lane paints its signal (waveformLayer over the lane's range, in the channel's unit).
            const transform = makeCoordTransform(0, 1, 0, 800, H, 1, 1, { minNorm: range.min, maxNorm: range.max });
            // Unzoomed, the peak is inside it; zoomed, it is the window (at the range field's numbers, R9).
            if (!viewport) assert.ok(range.max >= peak / 0.88 && range.min === -range.max, `${peak}: ${range.min}…${range.max}`);
            else assert.ok(Math.abs(range.min - viewport.minNorm * peak) <= (range.max - range.min) / 1000 && Math.abs(range.max - viewport.maxNorm * peak) <= (range.max - range.min) / 1000);
            assert.ok(Math.abs(transform.toY(range.max)) < 1e-9, 'the top edge');
            assert.ok(Math.abs(transform.toY(range.min) - H) < 1e-9, 'the bottom edge');
            const ticks = laneAmplitudeTicks(range);
            assert.ok(ticks.length >= 2);
            // A quiet signal's ticks read their own values, not all "0".
            assert.equal(new Set(ticks.map(tick => tick.text)).size, ticks.length, `${peak}: ${ticks.map(tick => tick.text).join(' ')}`);
            for (const tick of ticks) {
                const value = range.min + tick.fraction * (range.max - range.min);
                assert.ok(Math.abs(transform.toY(value) - (1 - tick.fraction) * H) < 1e-6, `${tick.text} at its value`);
                assert.ok(Math.abs(Number(tick.text.replaceAll('−', '-')) - value) <= Math.abs(value) * 1e-9 + (range.max - range.min) * 1e-3, `${tick.text} reads ${value}`);
            }
        }
    }
});

test('the lanes take the ticks and their text from the rules every plot uses', () => {
    const range = laneAmplitudeRange(0.5);
    assert.deepEqual(laneAmplitudeTicks(range), valueAxisTicks(range));
    assert.deepEqual(laneTimeTicks(1.5, 9.5, 800).map(tick => tick.text), alongAxisTicks(1.5, 9.5).map(tick => tick.text));
    for (const tick of laneTimeTicks(1.5, 9.5, 800)) assert.ok(Math.abs(tick.x - (Number(tick.text) - 1.5) / 8 * 800) < 1e-9);
});

test('a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does', () => {
    const texts: Array<{ text: string; color: unknown }> = [];
    let cleared = 0;
    const context = {
        fillStyle: '' as unknown, strokeStyle: '' as unknown, font: '', lineWidth: 1, textAlign: 'left' as const, textBaseline: 'alphabetic' as const,
        save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
        fillText(text: string) { texts.push({ text, color: context.fillStyle }); },
        measureText(text: string) { return { width: text.length * 3 }; },
        clearRect() { cleared++; }, setTransform() {},
    };
    const strings = getStrings('en');
    const title = amplitudeAxisTitle(strings, undefined, undefined);
    assert.match(title, /\[.+\]$/, 'a unit in brackets');
    const ticks = laneAmplitudeTicks(laneAmplitudeRange(1));
    paintSideAxis({ width: 64, height: H, getContext: () => context } as unknown as HTMLCanvasElement, ticks, title, { muted: 'grey', text: 'white' });
    assert.equal(cleared, 1);
    assert.deepEqual(texts.filter(item => item.color === 'grey').map(item => item.text), ticks.map(tick => tick.text));
    assert.deepEqual(texts.filter(item => item.color === 'white').map(item => item.text), [title]);
});

/**
 * docs/display-rules.md R4, "軸名はキャンバスの中に": a value axis's name is turned up the gutter, so across the gutter
 * it takes one line's height, or two for a name on two lines. Its lines stay between the canvas's edge and the plot
 * whatever the axis's height: the shared painter moves the name's centre in from the edge as far as its lines need.
 */
test('a value axis\'s name stays inside its canvas across the gutter too, on one line and on two, at every height (R4)', () => {
    for (let height = 12; height <= 240; height += 6) {
        let font = '10px sans-serif', centre = NaN;
        const lines: Array<{ offset: number; size: number; length: number }> = [];
        let turned = false;
        const context = {
            fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic',
            get font() { return font; }, set font(value: string) { font = value; },
            save() {}, restore() { turned = false; }, translate(x: number) { centre = x; }, rotate() { turned = true; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
            // Turned, a text's y runs across the gutter and its length up the axis.
            fillText(text: string, _x: number, y: number) { if (turned) lines.push({ offset: y, size: fontPixels(font), length: [...text].length * 0.56 * fontPixels(font) }); },
            measureText(text: string) { return { width: [...text].length * 0.56 * fontPixels(font) }; },
            clearRect() {}, setTransform() {},
        };
        paintSideAxis({ width: 64, height, getContext: () => context } as unknown as HTMLCanvasElement, [], 'Sound pressure level [dB SPL re 20 µPa]', { muted: 'grey', text: 'white' });
        assert.ok(lines.length >= 1, `at ${height} px the axis draws no name: it must always draw its quantity and unit (R4)`);
        const fix = 'Fix in the shared painter (stagePanes.ts paintValueTitle and axisTitle.ts fitAxisTitle), which every plot\'s value axis goes through; see docs/display-rules.md R4.';
        for (const line of lines) {
            assert.ok(centre + line.offset - line.size / 2 >= -1e-9, `at ${height} px a line of the axis name starts ${(centre + line.offset - line.size / 2).toFixed(1)} px left of the canvas's edge. ${fix}`);
            assert.ok(centre + line.offset + line.size / 2 <= 64 + 1e-9, `at ${height} px a line of the axis name ends past the canvas's right edge. ${fix}`);
            assert.ok(line.length <= height + 1e-9, `at ${height} px a line of the axis name is ${line.length.toFixed(1)} px long, longer than the axis: it runs off the canvas's top and bottom. ${fix}`);
        }
    }
});
