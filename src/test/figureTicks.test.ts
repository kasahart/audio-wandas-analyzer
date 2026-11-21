import assert from 'node:assert/strict';
import test from 'node:test';
import { TICK_LABEL_PX, valueAxisTicks } from '../webview/figure/ticks';

/**
 * docs/display-rules.md R4: a value axis writes no two tick labels over each other, however short the plot is; a
 * short plot has fewer ticks. The Figure takes every value axis's and colour bar's ticks from valueAxisTicks
 * (src/webview/figure/ticks.ts), so the rule is held here for every lane height.
 */
const RANGES = [{ min: -100, max: 0 }, { min: -87.25, max: -20.125 }, { min: -1, max: 1 }, { min: 0, max: 1 }, { min: 0.0896, max: 0.0898 }, { min: -3e-7, max: 5e-7 }, { min: 0, max: 1234567 }];
const HEIGHTS = [600, 300, 160, 100, 72, 48, 36, 24, 14];

/** Where a label's ink is, from the axis's top, as the Figure draws it: the top tick hangs under the top edge, the bottom one stands on the bottom edge, the others are centred. */
function inkOf(fraction: number, height: number): [number, number] {
    const y = (1 - fraction) * height;
    if (fraction >= 1) return [y, y + TICK_LABEL_PX];
    if (fraction <= 0) return [y - TICK_LABEL_PX, y];
    return [y - TICK_LABEL_PX / 2, y + TICK_LABEL_PX / 2];
}

test('a value axis writes no two tick labels over each other, however short the plot: fewer ticks on a short one, each still at its own value (R4)', () => {
    for (const range of RANGES) {
        let before = Infinity;
        for (const height of HEIGHTS) {
            const ticks = valueAxisTicks(range, height);
            const where = `${range.min} to ${range.max} on ${height} px`;
            const inks = ticks.map(tick => inkOf(tick.fraction, height)).sort((a, b) => a[0] - b[0]);
            inks.forEach((ink, index) => {
                if (index > 0) assert.ok(ink[0] > inks[index - 1][1], `${where}: two tick labels touch (${ticks.map(tick => tick.text).join(', ')}). Fix: valueAxisTicks must return only ticks whose labels fit (ticksFit).`);
            });
            assert.equal(new Set(ticks.map(tick => tick.text)).size, ticks.length, `${where}: two ticks read the same (${ticks.map(tick => tick.text).join(', ')})`);
            for (const tick of ticks) assert.ok(Math.abs(tick.fraction - (tick.value - range.min) / (range.max - range.min)) < 1e-12, `${where}: the tick ${tick.text} is not at its value's place`);
            assert.ok(ticks.length <= before, `${where}: a shorter plot has more ticks (${ticks.length}) than a taller one (${before})`);
            before = ticks.length;
        }
        assert.ok(valueAxisTicks(range, 600).length >= 2, `${range.min} to ${range.max}: a tall plot has at least two ticks`);
    }
});
