/**
 * The track lanes' axes follow the plot component's rules (R3): each amplitude tick sits where the waveform is drawn at
 * that value, zoomed or not, and the ticks, their text and the titles are the ones Compare's plots use.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneAmplitudeRange, laneAmplitudeTicks, laneTimeTicks } from '../webview/runtime/laneAxes';
import { makeCoordTransform } from '../webview/waveform/waveformRenderer';
import { valueAxisTicks, alongAxisTicks, amplitudeAxisTitle, paintSideAxis } from '../webview/runtime/stagePanes';
import { getStrings } from '../shared/i18n/strings';

const H = 120;

test('a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not', () => {
    for (const viewport of [undefined, { minNorm: -0.3, maxNorm: 0.7 }]) {
        for (const peak of [1, 0.005, 16383, 2e-5, 1e-6, 1e-9]) {
            const range = laneAmplitudeRange(peak, viewport);
            const transform = makeCoordTransform(0, 1, 0, 800, H, peak, 1, viewport);
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
