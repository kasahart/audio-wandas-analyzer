/**
 * A summary of what the comparison's Figure has on its canvas, for the end-to-end tests' state hook only
 * (trackStageMode.ts `snapshot`): no plot, readout or export shows it. It is taken of the Figure's own inspection
 * (the places its one picture's points were drawn at), so it holds nothing the picture does not.
 */
import type { FigureInspection } from '../figure/index';

/**
 * How many points (or an image's cells) the Figure's first lane draws, and the median of its lines' points as placed
 * on the lane's value axis (null for an image, and while nothing is drawn).
 */
export function pictureSummary(seen: FigureInspection | null | undefined): { stageValues: number; stageMedian: number | null } {
    const lane = seen && !seen.waiting ? seen.lanes[0] : undefined;
    if (!lane) return { stageValues: 0, stageMedian: null };
    if (lane.image) return { stageValues: lane.image.rows * lane.image.columns, stageMedian: null };
    const [low, high] = lane.range?.y ?? [0, 0];
    const { top, height } = lane.frame;
    const values = lane.lines.flatMap(line => line.points).filter((point): point is [number, number] => point !== null)
        .map(([, py]) => high - (height > 0 ? (py - top) / height : 0) * (high - low));
    const sorted = [...values].sort((a, b) => a - b);
    return { stageValues: values.length, stageMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
}
