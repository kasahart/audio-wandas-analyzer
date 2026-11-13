import { testLine, testCells } from './whole';
import { drawableLine, drawableRows } from '../../shared/drawnPoints';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { type InlineFullSource } from '../../webview/runtime/fullRead';

/** A test picture's own values as its full data: a picture whose every point is in hand (R7, StageLayer.full). */
export function held(view: StageView): InlineFullSource {
    return view.matrix ? testCells(view.xs ?? [], view.ys ?? [], drawableRows(view.matrix)) : testLine(view.xs ?? [], drawableLine(view.values ?? []));
}

/**
 * A test picture with the `valueRange` the backend sends with every picture (stage_combine.value_range): the lowest
 * and highest of its every value, which for a test picture are the values it holds. A plot's range is set from
 * `valueRange` alone (R1), so a test that checks a range gives its picture one, as the backend does.
 * `diff`: of a difference, which has no silent floor.
 */
export function ranged(view: StageView, diff = false): StageView {
    // A cepstrum's zero-quefrency coefficient is left out of its range, as the backend leaves it.
    const skip = view.quantity === 'cepstrum' ? 1 : 0;
    const values = view.events ? view.events.flatMap(event => drawableLine(event.values)) : view.matrix ? drawableRows(view.matrix).slice(skip).flat() : drawableLine(view.values ?? []).slice(skip);
    const floored = !diff && !view.waveform && ['level', 'gain'].includes(view.quantity ?? 'level');
    const kept = values.filter((value): value is number => value !== null && Number.isFinite(value) && !(floored && value <= -250));
    return kept.length ? { ...view, valueRange: { min: Math.min(...kept), max: Math.max(...kept) } } : view;
}
