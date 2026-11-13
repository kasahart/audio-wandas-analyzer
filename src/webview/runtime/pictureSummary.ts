/**
 * A summary of the points a step's picture draws, for the end-to-end tests' state hook only (trackStageMode.ts
 * `snapshot`): no plot, readout or export shows it. It is taken of drawn points on purpose (it says what is on the
 * canvas), which is why it lives apart from the model and is one of the few modules allowed to unwrap `Drawn`.
 */
import { drawableLine, drawableRows } from '../../shared/drawnPoints';
import type { StageView } from '../../shared/protocol/backendProtocol';

/** How many drawn points of a picture have a level (silence floors at −300 dB), and their median. */
export function pictureSummary(view: StageView | null | undefined): { stageValues: number; stageMedian: number | null } {
    const values = (view?.values ? drawableLine(view.values) : drawableRows(view?.matrix ?? []).flat()).filter((value): value is number => value !== null && value > -250);
    const sorted = [...values].sort((a, b) => a - b);
    return { stageValues: values.length, stageMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
}
