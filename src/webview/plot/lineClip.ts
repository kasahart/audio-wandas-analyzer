/**
 * Lines are clipped, not clamped (docs/display-rules.md R2): the one rule every stroked line of values is cut to its
 * plot by. Each point is placed at its exact y (never held at an edge or a few spans past it), and each segment is cut
 * where it crosses the plot's box grown by the line's width. So the part of a line on the plot is exactly its
 * segments, however far the next point is past the axis and at every zoom; and a line wholly on the plot is the same
 * moveTo/lineTo path it is without clipping (the painters make those calls; this module only cuts). The caller's canvas clip to the plot then trims the width's margin, so a
 * cut end (and its cap) is never seen.
 *
 * Its users: stagePanes.strokeStageLine (every line, step and bar edge of a pane) and
 * waveformRenderer.paintDecimatedPoints (a signal drawn as itself). Enforced by src/test/lineClip.test.ts.
 */

/** A box on the canvas by its edges. */
export interface ClipBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** A canvas y past which double arithmetic stops (an overflowed exact y): the crossing is then the end's x to the last bit. */
const FAR_PX = 1e300;

/**
 * The part of the segment (x0, y0)–(x1, y1) inside `box` (Liang–Barsky): the segment itself between the points where
 * it crosses the box's edges, never a point moved onto the box. Null when no part of it is inside. A cut end is on the
 * edge it crosses, and its other coordinate is taken from the segment's end nearer that edge, so a far end (zoomed in,
 * a million spans past the axis) costs no precision. A y past ±1e300 px (an exact y that overflowed) is taken at
 * ±1e300: the crossing then differs from the true one by less than 1e-290 px.
 */
export function clippedSegment(box: ClipBox, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
    const far = (y: number): number => Math.max(-FAR_PX, Math.min(FAR_PX, y));
    const ay = far(y0), by = far(y1);
    const dx = x1 - x0, dy = by - ay;
    let enter = 0, leave = 1;
    let enterEdge = -1, leaveEdge = -1;
    // Each edge (left, right, top, bottom): p·t ≤ q keeps the segment's point at t inside.
    const edges: ReadonlyArray<readonly [number, number]> = [[-dx, x0 - box.left], [dx, box.right - x0], [-dy, ay - box.top], [dy, box.bottom - ay]];
    for (let edge = 0; edge < 4; edge++) {
        const [p, q] = edges[edge];
        if (p === 0) { if (q < 0) return null; continue; }
        const t = q / p;
        if (p < 0) { if (t > leave) return null; if (t > enter) { enter = t; enterEdge = edge; } } else { if (t < enter) return null; if (t < leave) { leave = t; leaveEdge = edge; } }
    }
    /** The point where the segment crosses `edge`: on it, the other coordinate from the end nearer it. */
    const on = (edge: number): [number, number] => {
        if (edge < 2) {
            const x = edge === 0 ? box.left : box.right;
            const [nx, ny] = Math.abs(x - x0) <= Math.abs(x - x1) ? [x0, ay] : [x1, by];
            return [x, ny + (x - nx) * (dy / dx)];
        }
        const y = edge === 2 ? box.top : box.bottom;
        const [nx, ny] = Math.abs(y - ay) <= Math.abs(y - by) ? [x0, ay] : [x1, by];
        return [nx + (y - ny) * (dx / dy), y];
    };
    const [sx, sy] = enterEdge < 0 ? [x0, ay] : on(enterEdge);
    const [ex, ey] = leaveEdge < 0 ? [x1, by] : on(leaveEdge);
    return [sx, sy, ex, ey];
}

/**
 * Where a clipped line's path goes: `start` begins a run (the painter's moveTo), `to` continues it (its lineTo). This
 * module only cuts; the painters (scripts/lint-webview-patterns.js CANVAS_DRAWING_FILES) put the path on the canvas.
 */
export interface PathSink {
    start(x: number, y: number): void;
    to(x: number, y: number): void;
}

/** A path of segments cut to a plot (clippedSegment): `segment` adds one, `lift` ends the run (a gap in the line). */
export interface ClippedPath {
    segment(x0: number, y0: number, x1: number, y1: number): void;
    lift(): void;
}

/**
 * Segments added to `sink`'s path, each cut to `plot` grown by `lineWidth`: a segment that starts where the last one
 * ended continues the run (`to`), one cut at its start or after a gap starts a new run (`start`).
 */
export function clippedPath(sink: PathSink, plot: { left: number; top: number; width: number; height: number }, lineWidth: number): ClippedPath {
    const grow = Math.max(0, lineWidth);
    const box: ClipBox = { left: plot.left - grow, top: plot.top - grow, right: plot.left + plot.width + grow, bottom: plot.top + plot.height + grow };
    let pen: [number, number] | null = null;
    return {
        segment(x0, y0, x1, y1) {
            const cut = clippedSegment(box, x0, y0, x1, y1);
            if (!cut) { pen = null; return; }
            if (!pen || pen[0] !== cut[0] || pen[1] !== cut[1]) sink.start(cut[0], cut[1]);
            sink.to(cut[2], cut[3]);
            pen = cut[2] === x1 && cut[3] === y1 ? [x1, y1] : null;
        },
        lift() { pen = null; },
    };
}

/** Whether (x, y) is within `plot` grown by `margin`: a mark wholly past it (a dot) is not drawn. */
export function nearPlot(plot: { left: number; top: number; width: number; height: number }, x: number, y: number, margin: number): boolean {
    return x >= plot.left - margin && x <= plot.left + plot.width + margin && y >= plot.top - margin && y <= plot.top + plot.height + margin;
}
