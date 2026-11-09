import type { PaneRange } from '../../webview/runtime/comparePanes';
import { backendTitle, plainNames, plainRange, plainTitle, type FigureNames, type FigureRange, type FigureTitle, type PlainTitle } from '../../webview/runtime/figureModel';
import type { StageAxes } from '../../webview/runtime/stagePanes';

/** A test's own range and names, given as the figure model would give them (figureModel's brands). */
export const R = (range: PaneRange): FigureRange => plainRange(range.min, range.max);
export const N = (axes: StageAxes): FigureNames => plainNames(T(axes.x), T(axes.y), axes.colour === undefined ? undefined : T(axes.colour));
export const T = (title: string): FigureTitle => backendTitle(title);
/** A test's own name of an axis that is not a level, as the figure model brands it. */
export const P = (title: string): PlainTitle => plainTitle({ axisTime: title }, 'axisTime');
