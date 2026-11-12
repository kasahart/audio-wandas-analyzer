import { ranged } from '../helpers/heldSource';
import type { StageView } from '../../shared/protocol/backendProtocol';

/**
 * A step's picture as a UI test's stand-in for the backend sends it: `view`, its line's values changed by `shift`
 * (so two recordings differ), with the `valueRange` the backend sends with every picture. A plot's range is set from
 * `valueRange` alone, so a stub without one would be drawn on the default range, unlike any real picture.
 */
export function stubStage(view: Record<string, unknown>, shift: (value: number) => number = value => value): Record<string, unknown> {
    const values = (view.values as number[] | undefined)?.map(shift);
    return { ...ranged({ ...view, ...(values ? { values } : {}) } as unknown as StageView) };
}
