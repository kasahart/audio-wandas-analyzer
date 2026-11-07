import type { Locator } from './canvasAudit';

/** Where a spectrogram lane's colour bar is, in CSS pixels on its canvas (the middle of the box last painted there). */
export async function colourBarAt(target: Locator): Promise<{ x: number; y: number }> {
    return target.evaluate((canvas: HTMLCanvasElement) => {
        const [x, y, width, height] = (canvas.dataset.colourBar ?? '').split(' ').map(Number);
        const rect = canvas.getBoundingClientRect();
        return { x: (x + width / 2) * rect.width / canvas.width, y: (y + height / 2) * rect.height / canvas.height };
    });
}
