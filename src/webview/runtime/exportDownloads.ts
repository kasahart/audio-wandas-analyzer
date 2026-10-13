
const EXPORT_BACKGROUND = '#1e1e1e';

export function triggerAnchorDownload(document: Document, href: string, fileName: string): void {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}

export function visibleExportCanvases(wrapper: Element | null): HTMLCanvasElement[] {
    if (!wrapper) {
        return [];
    }
    return Array.from(wrapper.querySelectorAll<HTMLCanvasElement>('canvas:not(.track-axis-canvas)')).filter(canvas =>
        canvas.offsetParent !== null && canvas.getAttribute('data-calibration-hidden') !== 'true');
}

export function composeTrackCanvases(
    document: Document,
    canvases: HTMLCanvasElement[],
    axisCanvasFor: (canvas: HTMLCanvasElement) => Element | null,
    axisWidth: number,
): HTMLCanvasElement | null {
    const plotWidth = canvases.reduce((max, canvas) => Math.max(max, canvas.width), 0);
    const totalHeight = canvases.reduce((sum, canvas) => sum + canvas.height, 0);
    const offscreen = document.createElement('canvas');
    offscreen.width = axisWidth + plotWidth;
    offscreen.height = totalHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
        return null;
    }
    ctx.fillStyle = EXPORT_BACKGROUND;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    let y = 0;
    canvases.forEach(canvas => {
        const axisCanvas = axisCanvasFor(canvas);
        if (axisCanvas) {
            ctx.drawImage(axisCanvas as HTMLCanvasElement, 0, y);
        }
        ctx.drawImage(canvas, axisWidth, y);
        y += canvas.height;
    });
    return offscreen;
}
