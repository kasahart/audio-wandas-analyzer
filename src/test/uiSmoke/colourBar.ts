import type { Locator } from './canvasAudit';

/**
 * Where a heatmap's colour bar is, in CSS pixels on its canvas: the middle of the box the plot component last painted
 * there (data-plot-colour-bar, CSS pixels on the canvas, the one place it is named).
 */
export async function colourBarAt(target: Locator): Promise<{ x: number; y: number }> {
    return target.evaluate((canvas: HTMLCanvasElement) => {
        const [x, y, width, height] = (canvas.dataset.plotColourBar ?? '').split(' ').map(Number);
        return { x: x + width / 2, y: y + height / 2 };
    });
}
