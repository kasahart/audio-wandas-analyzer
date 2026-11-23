/**
 * A bins lane of a Figure (one group of a distribution): its bars, dots, ticks and role lines painted where the picture
 * says they are (配置: the bins' edges and each dot's place are layer 2's, figures/thinning.py) at the counts layer 2
 * counted (計算ア). Layer 3's alone: places on the canvas and colours. Nothing is counted, binned or stacked here.
 */
import type { AxisScale, ValueScale } from './axisScale';
import type { PictureBins } from './picturePoints';

type Box = { left: number; top: number; width: number; height: number };

/** The neutral colours of a distribution (only the rows holding a role carry colour): a bar, and its part a selected range takes. */
export const BINS_COLOURS = { bar: '#6b7280', picked: '#c4c9d2', tick: '#9aa0a6' };
const DOT_RADIUS = 3.5;
const TICK_HEIGHT = 5;

/** A bins lane as placed on the canvas (CSS px), for the painter and for the tests. */
export interface PlacedBins {
    /** Each bin with a row: its bar's box, its count, and how much of it a selected range takes (absent: none selected). */
    bars: Array<{ bin: number; left: number; right: number; top: number; bottom: number; count: number; picked?: number; pickedTop?: number }>;
    /** Each row drawn as a dot (a group of few), or as a tick at the lane's foot under the bars. */
    dots: Array<{ key: string; px: number; py: number; picked: boolean }>;
    ticks: Array<{ key: string; px: number }>;
    /** Each row holding a role: a line the lane's height at its value. */
    marks: Array<{ id: string; role?: string; key: string; px: number }>;
    /** The group's rows with no number, as the picture counts them (not drawn). */
    blank: number;
    /** The group's rows with a number, and those a selected range takes (absent: none selected), as the picture counts them. */
    n: number;
    nPicked?: number;
}

/** Where a bins lane's picture falls in `frame` on the axes `x` (the value axis) and `y` (the count axis). */
export function placeBins(bins: PictureBins, frame: Box, x: AxisScale, y: ValueScale): PlacedBins {
    const px = (value: number): number => frame.left + x.fraction(value) * frame.width;
    const foot = y.yOf(0);
    const bars = (bins.counts ?? []).flatMap((count, bin) => {
        if (!count) return [];
        const picked = bins.countsPicked?.[bin];
        return [{
            bin, left: px(bins.edges[bin]), right: px(bins.edges[bin + 1]), top: y.yOf(count), bottom: foot, count,
            ...(picked !== undefined ? { picked, pickedTop: y.yOf(picked) } : {}),
        }];
    });
    const dotted = bins.counts === null;
    return {
        bars,
        dots: dotted ? bins.members.map(member => ({ key: member.key, px: px(member.value), py: y.yOf(member.at ?? 0), picked: member.picked === true })) : [],
        ticks: dotted ? [] : bins.members.map(member => ({ key: member.key, px: px(member.value) })),
        blank: bins.blank,
        n: bins.n,
        ...(bins.nPicked !== undefined ? { nPicked: bins.nPicked } : {}),
        marks: bins.marks.map(mark => ({ id: mark.id, ...(mark.role !== undefined ? { role: mark.role } : {}), key: mark.key, px: px(mark.value) })),
    };
}

/** Paints a placed bins lane; the caller clips to the frame. `markColour`: a role line's colour (its role's). */
export function paintBins(ctx: CanvasRenderingContext2D, placed: PlacedBins, frame: Box, markColour: (mark: PlacedBins['marks'][number]) => string): void {
    for (const bar of placed.bars) {
        const left = Math.round(bar.left), width = Math.max(1, Math.round(bar.right) - left - 1);
        ctx.fillStyle = BINS_COLOURS.bar;
        ctx.fillRect(left, bar.top, width, bar.bottom - bar.top);
        if (bar.picked && bar.pickedTop !== undefined) {
            // The part of the bar the selected range takes, lighter over it.
            ctx.fillStyle = BINS_COLOURS.picked;
            ctx.fillRect(left, bar.pickedTop, width, bar.bottom - bar.pickedTop);
        }
    }
    ctx.strokeStyle = BINS_COLOURS.tick;
    ctx.lineWidth = 1;
    for (const tick of placed.ticks) {
        ctx.beginPath();
        ctx.moveTo(tick.px, frame.top + frame.height);
        ctx.lineTo(tick.px, frame.top + frame.height - TICK_HEIGHT);
        ctx.stroke();
    }
    for (const dot of placed.dots) {
        ctx.fillStyle = dot.picked ? BINS_COLOURS.picked : BINS_COLOURS.bar;
        ctx.beginPath();
        ctx.arc(dot.px, dot.py, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.lineWidth = 2;
    for (const mark of placed.marks) {
        ctx.strokeStyle = markColour(mark);
        ctx.beginPath();
        ctx.moveTo(mark.px, frame.top);
        ctx.lineTo(mark.px, frame.top + frame.height);
        ctx.stroke();
    }
}
