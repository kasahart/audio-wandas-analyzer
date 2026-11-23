/**
 * The Tracks screen's two bottom figures (the cursor spectrum, the pair figure) as a ui-smoke test sees them: each is
 * one Figure (src/webview/figure/), so a test reads what it drew from the Figure's own inspection and points at a
 * place on one of its lanes.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { FigureInspection } from '../../webview/figure/figure';

/** The cursor spectrum's Figure's canvas. */
export const CURSOR_FIGURE = '#spectrum-overlay-plot canvas[data-figure]';
/** The pair figure's canvas (gain, phase and γ² are its lanes). */
export const PAIR_FIGURE = '#pair-spectrum-figure canvas[data-figure]';

export type Seen = FigureInspection;
export type SeenLane = Seen['lanes'][number];

/** What the Figure drew now. */
export const seenFigure = (page: Page, figure: string = CURSOR_FIGURE): Promise<Seen> =>
    page.locator(figure).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => FigureInspection }).__figureInspect());

/** What the Figure drew once it has a picture and waits for no other; `lines`: with at least so many lines on its first lane. */
export async function drawnFigure(page: Page, figure: string = CURSOR_FIGURE, lines = 1): Promise<Seen> {
    await page.locator(figure).waitFor();
    await page.waitForFunction(([selector, least]) => {
        const canvas = document.querySelector<HTMLCanvasElement & { __figureInspect?: () => FigureInspection }>(selector);
        const seen = canvas?.__figureInspect?.();
        return !!seen && !seen.waiting && seen.pictureId !== null && (seen.lanes[0]?.lines.length ?? 0) >= (least);
    }, [figure, lines] as const);
    return seenFigure(page, figure);
}

/** The lane of that id (the first lane with none given). */
export function laneOf(seen: Seen, lane?: string): SeenLane {
    const found = lane === undefined ? seen.lanes[0] : seen.lanes.find(item => item.id === lane);
    if (!found) throw new Error(`the figure has no lane ${lane ?? '(first)'}: ${seen.lanes.map(item => item.id).join(', ')}`);
    return found;
}

/** The place on the page of a point of a lane's plot: `across` and `up` are fractions of its frame (0, 0 = bottom left). */
export async function pointOnLane(page: Page, figure: string, lane: string | undefined, across: number, up = 0.5): Promise<{ x: number; y: number }> {
    const box = await page.locator(figure).boundingBox();
    if (!box) throw new Error(`${figure} has no layout box`);
    const { frame } = laneOf(await seenFigure(page, figure), lane);
    return { x: box.x + frame.left + across * frame.width, y: box.y + frame.top + (1 - up) * frame.height };
}

/** Moves the pointer to a point of a lane's plot (fractions of its frame). */
export async function hoverLane(page: Page, figure: string, lane: string | undefined, across: number, up = 0.5): Promise<void> {
    const at = await pointOnLane(page, figure, lane, across, up);
    await page.mouse.move(at.x, at.y);
}

/** A Tracks row's Figure on the Figure path: the canvas of a recording's channel, its waveform lane over its spectrogram lane. */
export const rowFigure = (track = 0, channel = 0): string => `#track-row-figure-${track}${channel ? `-${channel}` : ''} canvas[data-figure]`;
export const ROW_WAVE = 'wave';
export const ROW_SPECTROGRAM = 'spectrogram';

/** What a row's Figure drew once it has a picture of its waveform (and its spectrogram, unless `waveOnly`) and waits for no other. */
export async function drawnRow(page: Page, track = 0, channel = 0, waveOnly = false): Promise<Seen> {
    const figure = rowFigure(track, channel);
    await page.locator(figure).waitFor();
    await page.waitForFunction(([selector, wave]) => {
        const canvas = document.querySelector<HTMLCanvasElement & { __figureInspect?: () => FigureInspection }>(selector);
        const seen = canvas?.__figureInspect?.();
        return !!seen && !seen.waiting && seen.pictureId !== null && (seen.lanes[0]?.lines.length ?? 0) > 0 && (wave || seen.lanes.some(lane => !!lane.image));
    }, [figure, waveOnly] as const);
    return seenFigure(page, figure);
}

/** A row's axis with a range of its own: the amplitudes (left of the waveform), the frequencies (left of the spectrogram), the colours (the colour bar). */
export type RowAxis = 'amplitude' | 'frequency' | 'colour';

/** Where a row's axis is on the page (its middle), once the row is drawn. */
export async function pointOnRowAxis(page: Page, axis: RowAxis, track = 0, channel = 0): Promise<{ x: number; y: number }> {
    const seen = await drawnRow(page, track, channel, axis === 'amplitude');
    const frame = laneOf(seen, axis === 'amplitude' ? ROW_WAVE : ROW_SPECTROGRAM).frame;
    const figure = page.locator(rowFigure(track, channel));
    await figure.scrollIntoViewIfNeeded();
    const box = (await figure.boundingBox())!;
    return { x: box.x + (axis === 'colour' ? frame.left + frame.width + 12 : frame.left - 12), y: box.y + frame.top + frame.height / 2 };
}

/** Opens the range of a row's axis by a double click on it: the Figure's own popover, with its Min, Max and Apply. */
export async function openRowRange(page: Page, axis: RowAxis, track = 0, channel = 0): Promise<{ popover: Locator; min: Locator; max: Locator; apply: Locator }> {
    const at = await pointOnRowAxis(page, axis, track, channel);
    await page.mouse.dblclick(at.x, at.y);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    return { popover, min: popover.locator('input[id$="-min"]'), max: popover.locator('input[id$="-max"]'), apply: popover.locator('button[id$="-apply"]') };
}

/** The Min and Max a row's axis offers (its range popover opened, read and closed). */
export async function rowRange(page: Page, axis: RowAxis, track = 0, channel = 0): Promise<{ min: string; max: string }> {
    const { popover, min, max } = await openRowRange(page, axis, track, channel);
    const range = { min: await min.inputValue(), max: await max.inputValue() };
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    return range;
}
