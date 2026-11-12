import { getStrings } from '../../shared/i18n/strings';
import type { PaneRange } from '../../webview/runtime/comparePanes';
import { backendTitle, plainNames, plainRange, plainTitle, type FigureNames, type FigureRange, type FigureTitle, type PlainTitle } from '../../webview/runtime/figureModel';
import type { StageAxes, StagePlot } from '../../webview/runtime/stagePanes';

/** A test's own range and names, given as the figure model would give them (figureModel's brands). */
export const R = (range: PaneRange): FigureRange => plainRange(range.min, range.max);
export const N = (axes: StageAxes): FigureNames => plainNames(T(axes.x), T(axes.y), axes.colour === undefined ? undefined : T(axes.colour));
export const T = (title: string): FigureTitle => backendTitle(title);
/** A test's own name of an axis that is not a level, as the figure model brands it. */
export const P = (title: string): PlainTitle => plainTitle({ axisTime: title }, 'axisTime');

/**
 * A hand-made plot's value axis (display rules R14): `yOf` its exact y, `pixelsPerUnit` its exact scale (what the
 * pick, the backend's dense window and the read mark take), and `yAt` the mark's place (yOf unless the test holds it).
 */
export const Y = (yOf: (value: number) => number, pixelsPerUnit: number, yAt: (value: number) => number = yOf): Pick<StagePlot, 'yAt' | 'yOf' | 'pixelsPerUnit'> => ({ yAt, yOf, pixelsPerUnit });

/** The words a test's hover layer writes over a gap of a line (R7): the app's own, so a test reads what a user does. */
export const NO_VALUE = { noValue: getStrings('en').plotNoValue };
