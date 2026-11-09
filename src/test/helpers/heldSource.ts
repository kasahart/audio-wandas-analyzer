import type { StageView } from '../../shared/protocol/backendProtocol';
import { localCells, localLine, type InlineFullSource } from '../../webview/runtime/fullRead';

/** A test picture's own values as its full data: a picture whose every point is in hand (R7, StageLayer.full). */
export function held(view: StageView): InlineFullSource {
    return view.matrix ? localCells(view.xs ?? [], view.ys ?? [], view.matrix) : localLine(view.xs ?? [], view.values ?? []);
}
