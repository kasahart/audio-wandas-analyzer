import type { PaneRange } from '../../webview/runtime/comparePanes';
import { backendTitle, plainNames, plainRange, type FigureNames, type FigureRange, type FigureTitle } from '../../webview/runtime/figureModel';
import type { StageAxes } from '../../webview/runtime/stagePanes';

/** A test's own range and names, given as the figure model would give them (figureModel's brands). */
export const R = (range: PaneRange): FigureRange => plainRange(range.min, range.max);
export const N = (axes: StageAxes): FigureNames => plainNames(axes.x, axes.y, axes.colour);
export const T = (title: string): FigureTitle => backendTitle(title);
