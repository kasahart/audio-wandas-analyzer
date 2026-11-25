/**
 * The Figure (figure-design.md 第 4 節): one figure's drawing and every gesture on it. It sends the spec to the
 * figure service, draws the picture it gets back, and tells the screen what the user did (pick, view, range). It
 * makes no value, counts nothing and picks no point: the points it draws and the point it reads are layer 2's.
 *
 * What it does itself, all layer 3's: the transform between values and places (axisScale.ts, one per lane, log across
 * for a spectrum), the ticks (ticks.ts) from the picture's confirmed range, the axis words (axisNames.ts) from the
 * picture's quantity, unit, reference and calibration, the readout's rounding (shell/numberText.ts), the read mark at
 * the point read, and the ends of a specified range (fieldWindow.ts, R9). Presses go through the page's one
 * arbitration (pressArbiter.ts, R13); a click waiting for its read follows pendingClick.ts.
 *
 * The rules of 第 6 節 it follows:
 * - Every change of the spec (its keys' states and versions too), the specified range or the size advances the
 *   generation and asks for a picture; until it comes nothing is read and no read mark is shown. A change of the
 *   range or the size alone draws the previous picture's points on the new view meanwhile (only the transform
 *   changes; an end not specified keeps the previous confirmed one); a change of the spec draws nothing old
 *   (unless the screen asks to keep the last picture meanwhile: `keepWhileWaiting`; it is not read either way).
 *   While the range or the size keeps changing (a scroll or a zoom held on), a picture asked for a moment ago that
 *   comes meanwhile takes the last picture's place: drawn on the newest view, read by nothing, until the newest comes.
 * - Answers that only went stale (no new answer yet) do not redraw: the picture stays and their lines are not read.
 * - The readout is the reply to the newest read on the current picture; after an arrow key, older hover replies are
 *   not used. A read stays shown until the next one comes.
 * - The selected point is one object (Selected): its name (lane, line, recording key, answer version, index), the
 *   readout of it and the picture it was read from (picture id, data id, generation). The readout, the mark, a step,
 *   a late reply and a click all go through one check of it (`valid`): of another picture, data or generation, of a
 *   line now of another recording, or of an answer gone stale, it is not shown and not acted on.
 * - The Webview holds no list of points: an arrow key is a read (b) answered by the service on the current picture,
 *   from the selected point's name, a signed count of points on. While one is on its way further keys add to the
 *   count, sent as one step when it comes.
 * - After a redraw a point the arrow keys selected is read again by its name (with its recording key), else the
 *   pointer's place is read; keys pressed meanwhile wait for it, so its reply never moves the point back.
 * - Web (spec 4): during a long computation the readout says so, nothing is read, and a click does nothing; after it
 *   the pointer's place is read once.
 */
import { isDense, isThinnedAsDrawn, paintDenseLines, pixelOf, type DenseLine } from './denseLine';
import type { ExportDropReason, FigureRequests } from '../answers/figureRequests';
import { keysChange, unusableKeys } from '../answers/figureKeys';
import type { FigureDrawResult, FigureExportResult, FigureMembers, FigurePoint, FigureReadPayload, FigureReadResult, FigureSpec, FigureView } from '../answers/protocol';
import { isTextEntryTarget, keyRouterFor } from '../shell/keyRouter';
import { amountText, exactFieldText, frequencyText, lagText, levelText, quefrencyText, secondsText, signedText, spacingDecimals, tableValueText } from '../shell/numberText';
import { zoomKeyAction } from '../shell/zoomKeys';
import { installRangePopover, openAxisPart, type RangePopover, type RangePopoverStrings } from '../shell/rangePopover';
import { axisScale, valueScale, windowedScale, type AxisPart, type AxisScale, type ValueScale } from './axisScale';
import { inDb, levelAxisName, levelUnitOfName, lineAxisNames, type LineAxisWords, colourAxisName, deltaAxisName, rowsAxisName } from './axisNames';
import { BINS_COLOURS, paintBins, placeBins, type PlacedBins } from './binsLane';
import { fieldWindow } from './fieldWindow';
import { colourBarBox, COLOUR_BAR, COLOUR_BAR_ROOM, emptyColourOf, imagePixelsOf, paintColourBar, upScale, type ImagePalette } from './imageLane';
import { waitingClick } from './pendingClick';
import { pictureOf, type DrawnImage, type DrawnLine, type Picture, type PictureBins, type PictureLane } from './picturePoints';
import { clickReleased, exceedsDragThreshold, forgetClick, pagePresses, pressBegan, secondPress, type PressClick } from './pressArbiter';
import { alongAxisTicks, valueAxisTicks } from './ticks';
import { fitAxisTitle, fontPixels, scaledFont } from './axisTitle';
import { PAN_STEP_RATIO, SWIPE_PAUSE_MS, wheelPanPixels, wheelStepDirection, wheelZoomFactor, ZOOM_IN_FACTOR, zoomRangeAroundPivot, panNormalizedRangeBy, type NormalizedRange } from './zoomSteps';

/**
 * The words a Figure writes: axis names, the readout's states, the Δ headline, the range popover's. Named as the UI's
 * strings name them (UiStrings), so a screen hands the strings on as they are.
 */
export interface FigureWords extends LineAxisWords {
    axisFrequency: string;
    /** An image lane's and a band lane's axis across (a spectrogram's and a time signal's time). */
    axisTime: string;
    /** A band lane of a trigger's events: the time from their trigger. */
    axisTriggerTime: string;
    /** A band lane's axis up (a time signal's values), named with its unit where it has one. */
    waveRangeAxisAmplitude: string;
    axisDelta: string;
    /** What a Δ is the difference of (compare 1 − base), said on every Δ axis (#848). */
    deltaPair: string;
    /** A bins lane's axis up (a distribution's counts: {unit}) and what is counted (recordings). */
    dsDistCountAxis: string;
    dsUnitRecording: string;
    /** The readout during a long computation (spec 4). */
    pairWaiting: string;
    /** The picture could not be made. */
    stageCombineFailed: string;
    /** The picture is over what the service may hold. */
    stageTooLarge: string;
    /** The picture did not fit beside the requests running, asked twice (the process's one budget). */
    stageBusy: string;
    /** A read with no value at the place. */
    plotNoValue: string;
    /** Said after the name of a line uncalibrated on an axis named calibrated (R4: the picture's calibration words). */
    axisUncalibrated: string;
    /** The Δ lane's headline: where the difference is largest in the confirmed range ({at}, {delta}), or why there is none. */
    stageMaxDelta: string;
    stageNoDelta: string;
    /** No Δ: the recordings are at other sample rates (a sample-by-sample Δ), or in other units or references. */
    stageNoDeltaRate: string;
    stageNoDeltaUnit: string;
    range: RangePopoverStrings;
}

/** A line as a style is asked of: its id, its role, and the recording a line of one key is of. */
export interface FigureLineName { id: string; role?: string; key?: string }

/** What a pick carries: the read the click acted on (its lane, line, role and point: index, place, answer, key). */
export interface FigurePick {
    lane: string;
    line: string;
    role?: string;
    point: FigurePoint;
    /** The pointer was on the point itself (the service's: within its radius), or the keys read it; not only over its place across. */
    near: boolean;
}

/** A lane as drawn, for the screen's own controls on it (FigureSignals.placed). */
export interface FigurePlacedLane {
    id: string;
    frame: { left: number; top: number; width: number; height: number };
    guides: Array<{ axis: 'x' | 'y'; at: number; px: number; id?: string; out?: boolean }>;
    /** `missing`: no events' answer is held, and why (the counts are of nothing then). */
    events?: { used: number; total: number; missing?: 'pending' | 'stale' | 'failed' | 'evicted' | 'too-large' };
}

/** Alt+drag: a stretch of the axis across, in its values. */
export interface FigureRange {
    lane: string;
    x: [number, number];
    /** Where a drag began, of a range dragged out (one of `x`'s ends); not said of a bin clicked. */
    from?: number;
    /** It reaches the top of the lane's whole axis across, and takes the values on it (a distribution's last bin holds the top). */
    closed?: boolean;
}

/**
 * A distribution's selected value range: its low end, its high end, and whether it takes the values on its high end
 * (a range picked up to the top of the axis: FigureRange.closed). The figure service lights the rows it takes.
 */
export type FigureSelection = readonly [number, number, boolean?];

export interface FigureSignals {
    /** A click on a point; the screen may return how to take it back (the second press of a double click). */
    pick: (read: FigurePick) => (() => void) | void;
    /**
     * The specified range asked for (a box zoom, a double click's reset, the range popover). `typed`: the range popover
     * of that lane's axis asked for it (its fields applied, or its Auto), for a screen that keeps a typed range as a
     * setting apart from a zoom.
     */
    view: (view: FigureView, typed?: FigureTypedAxis) => void;
    /**
     * The point read changed to one of another line, or to none: the line a click would pick now (its lane and id),
     * for the screen to say what a click on it does (a hint, a pointer cursor). Told when it changes only. `near`: the
     * pointer is on the point itself (FigurePick.near).
     */
    read: (line: { lane: string; line: string; near: boolean } | null) => void;
    /**
     * The place across of the point the pointer (or an arrow key) reads changed, or none is read now: for the screen
     * to hand a figure of the same axis across (Figure.follow), which marks it. Told when it changes only.
     */
    across: (x: number | null) => void;
    /** The 0 key over the Figure put every axis back to its whole: a reset is every plot's (R13), the screen's others too. */
    reset: () => void;
    /**
     * The lanes were drawn at other places than told last (a picture, a size, a zoom): each lane's frame, its guide
     * lines where they are drawn and its events' count, for the screen to put its own controls at them (a trigger's
     * events: play, leave out). Places only; nothing here is read.
     */
    placed: (lanes: FigurePlacedLane[]) => void;
    /**
     * A stretch of the axis across picked: an Alt+drag, or on a distribution a click on a bar (its bin) or where no
     * point is read (the bin under the pointer). The screen may return how to take it back, as for a pick.
     */
    range: (range: FigureRange) => (() => void) | void;
    /**
     * A Shift+drag across a lane, where the screen takes one (a Tracks row moved along the time axis): how far the
     * pointer is from where it was pressed, in the axis across's values, at every move and once more at the release
     * (`done`; `by` null when the drag was abandoned). The Figure tells it only: what moves is the screen's.
     */
    shift: (drag: { lane: string; by: number | null; done: boolean }) => void;
    /**
     * An Alt+drag under way, where the screen takes a range and listens to this too (a Tracks row's loop): the stretch
     * from the press to the pointer, in the axis across's values, at every move, so the screen shows what it will pick
     * while it is dragged; no box is drawn for it (it zooms nothing). The release then tells `range` as before; null when
     * the drag ends picking nothing (let go too near the press, or the release lost), for the screen to put back what it
     * showed.
     */
    ranging: (drag: { lane: string; from: number; to: number } | null) => void;
    /**
     * A click on a lane's plot, where the screen takes its place rather than a point (a Tracks row: the cursor is put
     * at the time clicked, on the recording or beside it): the place across of the point read at the press, and where
     * nothing is read the place under the pointer. With a listener a click picks no point. The screen may return how
     * to take it back (the second press of a double click).
     */
    place: (at: { lane: string; x: number }) => (() => void) | void;
    /**
     * A picture was drawn, or none could be: what it showed and counted (計算ア's sets, as the service returned them),
     * for the screen to write beside it (a legend's n); null while there is none.
     */
    picture: (members: FigureMembers | null) => void;
}

/** The axis a range popover is of: a lane's axis up or of its colours, or the axis across. */
export interface FigureTypedAxis { lane: string; axis: 'x' | 'y' | 'colour' }

/** Where the pointer is on a Figure, for the page's hint. */
export type FigureHintPlace = 'plot' | 'axis' | 'colour';

export interface FigureOptions {
    document: Document;
    /** Where the canvas and the readout are put. */
    host: HTMLElement;
    requests: FigureRequests;
    words: FigureWords;
    /** The size in CSS px (a PNG's is fixed); the canvas's own size otherwise. */
    size?: { width: number; height: number };
    /** Each lane's plot height (CSS px), by lane id, or by the Figure's height; lanes not named share what is left. */
    laneHeights?: Readonly<Record<string, number>> | ((height: number) => Readonly<Record<string, number>>);
    /**
     * How much of the range's length the picture's time lanes (a band, an image) are drawn past each end (the
     * service's `ahead`): a range moved across shows that part of the last picture at once, while the next is on its
     * way. The picture's confirmed range, and so every read, is the range itself. None by default.
     */
    ahead?: number;
    /** What the readout calls a line (its legend's name); its id by default. */
    lineLabel?: (line: FigureLineName) => string;
    /** A line's colour and width (its role's, as the screen's legend shows them); the Figure's own by role otherwise. */
    lineStyle?: (line: FigureLineName) => { colour: string; width: number };
    /** What the readout calls a bins lane (its group's name); its id by default. */
    laneLabel?: (lane: string) => string;
    /**
     * Whose a lane of lines is, written in its corner as an image lane's recording is (「One lane per track」: a lane a
     * recording, which the lanes' colours alone did not tell apart); nothing for a lane it gives nothing for.
     */
    laneTitle?: (lane: string) => string | undefined;
    /** What is written at a guide line (a trigger's level: its value and unit, the screen's words); nothing by default. */
    guideLabel?: (lane: string, guide: { axis: 'x' | 'y'; at: number; id?: string }) => string | undefined;
    /** The name of a bins lane's axis across: its table column's, the user's own words (its key by default). */
    columnName?: (column: string) => string;
    /** Where the readout is put (a row above the plot, R7); beside the canvas otherwise. */
    readoutHost?: HTMLElement;
    /**
     * The readout element itself, where the page has one for the row (its first two children take the name and the
     * rest, as every plot's readout row writes them); one of its own in `readoutHost` otherwise.
     */
    readout?: HTMLElement;
    /**
     * Told where the pointer is, for the page's hint: over the plot, over an axis, over an image lane's colour bar
     * (a double click there sets the colours' range: the pointer says so too), or off the Figure (null).
     */
    hint?: (where: FigureHintPlace | null) => void;
    /** Where the Δ lane's headline is written (第 5 節 オ, in the readout's form); none otherwise. */
    headlineHost?: HTMLElement;
    /** The canvas's accessible name. */
    label?: string;
    /**
     * The canvas fills its host (the page's stylesheet sizes it, so it follows the layout at once); the Figure is told
     * its size by resize() and draws its bitmap at that size. Without it the Figure sets the canvas's size itself.
     */
    fill?: boolean;
    /**
     * The room between two lanes (CSS px), where the screen's lanes need less than the Figure's own (LANE_GAP, which
     * leaves room for a lane's headline): lanes of lines over one axis across in a short panel (the pair figure's
     * three, the cursor spectrum's lane a unit).
     */
    laneGap?: number;
    /**
     * While the picture of a changed spec is on its way, the last picture stays drawn (on the view asked for), and
     * nothing is read of it. Without it a changed spec draws nothing old. For a figure whose answers change several
     * times a second (the Tracks screen's cursor spectrum during playback), where a plot emptied between two
     * pictures would flicker. The lines kept are of the answers before: the screen's caption says what they are of.
     */
    keepWhileWaiting?: boolean;
    /**
     * The room around the plots (CSS px), where the screen's differs from the Figure's own: a Tracks row's Figure
     * starts its plots where the rows' shared time ruler does, and has no room under them (`acrossAxis` false).
     */
    margin?: Partial<{ left: number; right: number; top: number; bottom: number }>;
    /**
     * false: the axis across is neither ticked nor named under the last lane. For Figures stacked on one axis across
     * that the screen draws once for all of them (the Tracks rows under their time ruler).
     */
    acrossAxis?: boolean;
    /**
     * Where the screen's own axis across has its ticks, as fractions (0–1) of the plot's width: a faint line is drawn
     * down every lane at each, lines and images alike (a row of a screen whose rows share one time ruler; with
     * `acrossAxis` false the Figure has no ticks across of its own).
     */
    acrossGrid?: () => readonly number[];
    /** How a level image is coloured where not in grey (a Tracks row's spectrogram: viridis). Signed values keep their own. */
    imagePalette?: 'viridis';
    /**
     * The answer (its key) whose image an image lane keeps drawn under the one it draws: the widest picture of that
     * answer the lane has drawn stays, and fills the plot where the picture drawn now has no cell (a Tracks row
     * scrolled past its picture, or drawing a zoom's finer levels that reach less far: the whole file's levels are
     * there at once, coarser, until the picture of that place comes). Drawn and nothing else: it is never read.
     */
    imageUnder?: (lane: string) => string | undefined;
    /**
     * A lane of lines keeps, of each line, the widest picture's points of its answer (its key), and draws them where
     * the line drawn now does not reach the plot's sides (a Tracks row scrolled past the part its picture was made
     * for: the whole recording's waveform is there at once, coarser, until the picture of that place comes). Drawn
     * and nothing else: it is never read.
     */
    lineUnder?: boolean;
    /**
     * A press on the plot gives its canvas the focus, and while it has the focus ← → are left to the screen (a Tracks
     * row: the screen's cursor keys, ← → and Space, are the focused row's; R7's one exception). Elsewhere a press
     * leaves the focus where it is: the keys are the plot's under the pointer.
     */
    pressFocuses?: boolean;
    /**
     * The point the pointer read is read no more once the pointer is off the plots (on an axis, off the canvas): the
     * Tracks rows, which share one readout and mark each other's time. Elsewhere it stays read until another is. A
     * point the keys read stays either way.
     */
    leaveForgets?: boolean;
}

/** What the Figure drew and reads now, for tests and the browser checks: places in canvas CSS px. */
export interface FigureInspection {
    figureId: string;
    generation: number;
    pictureId: string | null;
    waiting: boolean;
    mapped: boolean;
    held: boolean;
    failure: 'failed' | 'too-large' | 'busy' | null;
    readout: string;
    /** The data id of the picture drawn (null while none): what the screen, the PNG and the CSV of it share. */
    dataId: string | null;
    /** The Δ lane's headline as written (empty while waiting, or without a Δ lane). */
    headline: string;
    /** The whole axis across (its ends with nothing specified), as the range popover and the zoom steps take it. */
    whole: [number, number] | null;
    /** The box being dragged (canvas CSS px), while one is. */
    box: { left: number; top: number; width: number; height: number } | null;
    lanes: Array<{
        id: string;
        frame: { left: number; top: number; width: number; height: number };
        range: { x: [number, number]; y: [number, number] } | null;
        /** The whole value axis (its ends with nothing specified there). */
        wholeY: [number, number] | null;
        /** The part of each whole axis shown (fractions 0–1, across on a log axis by its logarithm), for tests. */
        part: { x: { start: number; end: number }; y: { start: number; end: number } } | null;
        axisNames: { x: string; y: string };
        /** Whether the axis across is a log axis. */
        xLog: boolean;
        /** Whether the axis up is a log axis (an image's frequencies). */
        yLog: boolean;
        xTicks: Array<{ value: number; text: string; px: number }>;
        yTicks: Array<{ value: number; text: string; px: number }>;
        /** Where the faint lines of the screen's own axis across are drawn down the lane (px; acrossGrid); absent without one. */
        grid?: number[];
        order: string[];
        /** `bars`: a line of bands as drawn, a bar a point from its band's left edge to its right one (px) at its value's place; absent on any other line. */
        /** `under`: the stretches (px, left to right) where the line's kept points are drawn under it (lineUnder); absent where none are. */
        lines: Array<{ id: string; colour: string; width: number; under?: Array<[number, number]>; points: Array<[number, number] | null>; bars?: Array<[number, number, number] | null> }>;
        /**
         * An image lane's picture as drawn: how many cells, the colour axis (its confirmed ends, its name, its ticks
         * beside the colour bar) and the px its outer cell edges fall at. Absent on a lane of lines.
         */
        image?: {
            line: string; key: string; rows: number; columns: number; colour: [number, number]; colourName: string;
            colourTicks: Array<{ value: number; text: string; px: number }>;
            edges: { left: number; right: number; top: number; bottom: number };
            /** The image kept under it (FigureOptions.imageUnder): the px its outer column edges fall at; absent with none. */
            under?: { left: number; right: number };
            /** The stretch (px) painted with the colour of no value: the whole axis across (a recording's length) inside the frame. */
            ground: [number, number];
        };
        /** A bins lane's bars, dots, ticks and role lines as placed (binsLane.ts); absent on every other lane. */
        bins?: PlacedBins;
        /** A bins lane's heading: its group's name and how many rows with a number it holds (the picture's n), as written. */
        tag?: string;
        /** 目安の線 (guide lines) as drawn: the axis, the place on it and where (px across for x, up for y). Never read. */
        guides: Array<{ axis: 'x' | 'y'; at: number; px: number; id?: string; out?: boolean }>;
        /** The stretches a trigger's events used were cut over, as shaded (px across, inside the frame); absent on any other lane. */
        spans?: Array<{ start: number; end: number; left: number; right: number }>;
        /** How many of the trigger's events are used, of how many (the service's count); absent on any other lane. */
        events?: { used: number; total: number; missing?: 'pending' | 'stale' | 'failed' | 'evicted' | 'too-large' };
    }>;
    /** The read mark: on a line at its point's value; on an image at its cell's place up the axis (`y`). */
    mark: {
        lane: string; line: string; index: number; x: number; value: number; px: number; py: number; row?: number; y?: number;
        /**
         * The cross drawn through the point read, to the ends of its lane's frame: a line down at the point's x and a
         * line across at its value, so both can be read off the axes at a glance (R7). None on a lane of bins.
         */
        cross?: { top: number; bottom: number; left: number; right: number };
    } | null;
    /** The place followed from outside (Figure.follow) and where its line is drawn (px across); null with none, or one out of the range shown. */
    followed: { x: number; px: number } | null;
}

/**
 * What an export of the Figure gives: its table of every answer (間引かない), named as its axes and lines are, with the
 * data id it is of; or why there is none: the answers changed since the picture (its data id is not the service's now),
 * none is drawn yet, or the service could not.
 */
export type FigureTable =
    | { status: 'rows'; dataId: string; header: string[]; rows: string[][] }
    | { status: 'changed' | 'none' | 'too-large' | 'failed' };

/** An export that will never be answered (a newer one took its place, or the Figure was disposed): its promise's rejection. */
export class FigureExportDropped extends Error {
    constructor(readonly reason: ExportDropReason) {
        super(`the export was ${reason} before its answer came`);
        this.name = 'FigureExportDropped';
    }
}

/**
 * What an export writes beside its answers, taken when it is asked: each line's name and
 * the recording it is of, and each lane's value axis name, as the picture on screen then had them. A reply is written
 * only with these and its own columns, never with what the screen shows when it comes.
 */
interface ExportNames {
    lines: ReadonlyMap<string, { name: string; key?: string }>;
    axes: ReadonlyMap<string, string>;
    /** Per lane: its axis across's name (a column of places is headed by it). */
    across: ReadonlyMap<string, string>;
}

export interface Figure {
    readonly figureId: string;
    readonly canvas: HTMLCanvasElement;
    readonly readout: HTMLElement;
    /** `selection`: a distribution's selected value range (範囲の選択: what its bars and dots are lit by), or none. */
    show(spec: FigureSpec, view: FigureView | null, selection?: FigureSelection | null): void;
    resize(width: number, height: number): void;
    /**
     * Asks for the picture of the spec shown once more, though nothing of the spec changed: the last picture left
     * something out that the service can draw now (a kept answer it had let go was asked again under the same key).
     * The last picture stays meanwhile, as for a range change.
     */
    refresh(): void;
    /** + / − / 0 with the pointer on no plot (the screen's keys): the axis across zoomed about its middle, or reset. */
    zoom(action: 'in' | 'out' | 'reset'): void;
    /**
     * Marks a place across given from outside (the point another figure of the same axis reads: FigureSignals.across)
     * with a line down every lane, or takes the mark away (null). A mark only: nothing is read at it, and the readout
     * says nothing of it.
     */
    follow(x: number | null): void;
    on<K extends keyof FigureSignals>(signal: K, listener: FigureSignals[K]): () => void;
    inspect(): FigureInspection;
    /**
     * The CSV's table (第 6 節「取り置きの寿命」: the spec and the specified range are sent with the picture's data id;
     * the service makes the answers again and answers "no-picture" when they are another data's). Every answer, never a
     * drawn point; each written exactly (no rounding). The picture's own data id, or why there is none.
     */
    exportTable(): Promise<FigureTable>;
    dispose(): void;
}

const MARGIN = { left: 56, right: 14, top: 10, bottom: 30 };
/** The room above the first bins lane, for its heading (a line of 11 px). */
export const BINS_HEADING_ROOM = 16;
const LANE_GAP = 22;
/** Half the height (px) a tick's name takes up the canvas (its 10 px font, drawn about its middle). */
const TICK_NAME_HALF = 5;
type Box = { top: number; height: number };
/**
 * Where up the canvas the name of a value-axis tick at `px` is written (its middle). Beside its tick, but never cut
 * by the canvas's edge nor written into the lane next to it (the Tracks rows have no room above, below or between
 * their lanes): it stays in the canvas and on its own side of the middle of the gap to the lane above or below. With
 * room around the lane it is beside its tick. The tick itself is not moved: only its name.
 */
export function tickNameAt(px: number, frame: Box, above: Box | undefined, below: Box | undefined, canvasHeight: number): number {
    const highest = (above ? (above.top + above.height + frame.top) / 2 : 0) + TICK_NAME_HALF;
    const lowest = (below ? (frame.top + frame.height + below.top) / 2 : canvasHeight) - TICK_NAME_HALF;
    return Math.max(highest, Math.min(lowest, px));
}
const ROLE_COLOURS: Record<string, string> = { base: '#9aa0a6', compare1: '#e8710a', compare2: '#1a73e8', compare3: '#188038' };
const OTHER_COLOUR = '#7f7f7f';

/** Whose a lane is (an image's recording, a recording's own lane of lines): its name on a dark tag in the lane's corner, with its colour. */
function paintLaneTitle(ctx: CanvasRenderingContext2D, frame: { left: number; top: number; width: number }, title: string, colour: string): void {
    ctx.save();
    ctx.font = '11px sans-serif';
    const wide = Math.min(frame.width - 12, ctx.measureText(title).width + 16);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(frame.left + 4, frame.top + 4, wide, 16);
    ctx.fillStyle = colour;
    ctx.fillRect(frame.left + 4, frame.top + 4, 3, 16);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, frame.left + 12, frame.top + 12, wide - 12);
    ctx.restore();
}
/** The lines at a lane's ticks, under its lines: faint, so no line of the data is mistaken for one. */
const GRID_COLOUR = 'rgba(255, 255, 255, 0.08)';
/**
 * The lines down a lane of lines at the ticks across, drawn over its lines (as the old plots drew them): dark, so they
 * show through a waveform's filled band as thin breaks, and are never mistaken for a line of the data.
 */
const ACROSS_GRID_COLOUR = 'rgba(52, 57, 66, 0.9)';

interface LaneView {
    id: string;
    frame: { left: number; top: number; width: number; height: number };
    lane: PictureLane;
    range: { x: [number, number]; y: [number, number] };
    x: AxisScale;
    y: ValueScale;
    /** The axis up as a scale of fractions (logarithmic on an image lane: frequency). */
    up: AxisScale;
}

/**
 * The selected point: its name as the service gave it (lane, line, role, recording key,
 * the line's answer version, the point: index, place, answer, step), the read that gave it, and the picture it was
 * read from. `by`: the pointer's read, or the arrow keys' (read again by its name after a redraw).
 */
type Selected = {
    lane: string; line: string; role?: string; key?: string; version: string; point: FigurePoint; near?: boolean;
    pictureId: string; dataId: string; generation: number; number: number; by: 'pointer' | 'keys';
};
/** The arrow keys' read on its way (a step, or the selected point read again by its name): its number and the points it moves. */
type KeyRead = { number: number; steps: number; rows: number };
/** What a click acts on: a point read (pick), or a stretch of the axis across (a distribution's bin: range). */
type Hit = { pick: FigurePick } | { range: FigureRange };
type PressRead = { state: 'in'; read: Hit | null; generation: number } | { state: 'waiting'; arrive: ((read: Hit | null) => void) | null; got?: Hit | null };

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const viewOf = (view: FigureView | null): FigureView => ({ x: view?.x ?? [null, null], lanes: (view?.lanes ?? []).filter(lane => lane.y.some(end => end !== null) || !!lane.colour?.some(end => end !== null)) });

/** Which Figure wrote a page's shared readout last (writeReadout). */
const readoutWriters = new WeakMap<HTMLElement, object>();

export function createFigure(options: FigureOptions): Figure {
    const { document: doc, requests, words } = options;
    const canvas = doc.createElement('canvas');
    canvas.dataset.figure = requests.figureId;
    canvas.tabIndex = 0;
    if (options.label) { canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', options.label); }
    const readout = options.readout ?? doc.createElement('div');
    readout.dataset.figureReadout = '';
    options.host.append(canvas);
    if (!options.readout) { readout.className = 'plot-readout figure-readout'; (options.readoutHost ?? options.host).append(readout); }
    const presses = pagePresses(doc);
    const token = {};
    const listeners: { [K in keyof FigureSignals]: Set<FigureSignals[K]> } = { pick: new Set(), view: new Set(), range: new Set(), picture: new Set(), read: new Set(), across: new Set(), reset: new Set(), placed: new Set(), shift: new Set(), ranging: new Set(), place: new Set() };
    /** The line last told as read (`lane line`; empty: none). */
    let toldRead = '';
    let toldPlaced = '';
    let toldAcross: number | null = null;
    /** The place across followed from outside (Figure.follow). */
    let followed: number | null = null;
    let size = options.size ?? { width: canvas.clientWidth || 600, height: canvas.clientHeight || 300 };
    let spec: FigureSpec | null = null;
    let view: FigureView = viewOf(null);
    let selection: FigureSelection | null = null;
    let generation = 0;
    /** The newest picture drawn, of `generation` unless `waiting`. */
    let last: Picture | null = null;
    let waiting = false;
    /** Waiting after a change of the range or the size alone: the last picture is drawn on the new view. */
    let mapped = false;
    let failure: 'failed' | 'too-large' | 'busy' | null = null;
    let disposed = false;
    let unusable: ReadonlySet<string> = new Set();
    /** The generation the last picture was drawn at. */
    let drawnGeneration = 0;
    /** The generation since which only the range or the size changed, and the one the picture shown meanwhile was asked at. */
    let movedFrom = 0;
    let shownFrom = 0;
    /** The selected point; shown only while `valid`. */
    let selected: Selected | null = null;
    /** The newest read shown (its number), and what it said when it read no point ('no-value', 'outside', 'failed'). */
    let shownNumber = 0;
    let said: FigureReadResult['status'] | null = null;
    /** The bin under the pointer where the newest hover read no point of a bins lane (the service's): what a click there picks. */
    let under: { range: FigureRange; pictureId: string } | null = null;
    let keyRead: KeyRead | null = null;
    /** Arrow keys pressed while the keys' read was on its way: one step of this many points once it comes. */
    let pendingSteps = 0;
    /** ↑ / ↓ pressed on an image's cell while a keys' read is on its way: the rows the next step moves. */
    let pendingRows = 0;
    /** Hover replies to reads up to this number are not used: an arrow key moved after them. */
    let hoverFloor = 0;
    let lastRead: { number: number; lane: string; x: number; y: number; ticket: ReturnType<FigureRequests['read']> } | null = null;
    /** The pointer over the canvas (CSS px from its top left), null when it is not over it. */
    let pointer: { x: number; y: number } | null = null;
    let press: { x: number; y: number; clientX: number; clientY: number; lane: LaneView; isDrag: boolean; to: { x: number; y: number }; alt: boolean; shift: boolean; read: PressRead } | null = null;
    let box: { lane: string; from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
    const popover: RangePopover = installRangePopover(doc, {
        rootId: `${requests.figureId}-range-popover`, badgeId: `${requests.figureId}-range-axis-badge`, idPrefix: `${requests.figureId}-range`, strings: words.range,
        position: (clientX, clientY, width, height, viewportWidth, viewportHeight) => ({ left: Math.max(4, Math.min(clientX, viewportWidth - width - 4)), top: Math.max(4, Math.min(clientY, viewportHeight - height - 4)) }),
    });

    const ground = { generation: () => generation, disposed: () => disposed };
    const held = (): boolean => requests.readsHeld();
    const current = (): Picture | null => (waiting ? null : last);

    // ── Geometry ──────────────────────────────────────────────────────────────────────────────────────────────────

    /** The room right of the plots: an image lane's colour bar takes its own (of every lane: they share the axis across). */
    const laneGap = options.laneGap ?? LANE_GAP;
    const margin = { ...MARGIN, ...options.margin };
    const rightRoom = (): number => margin.right + (spec?.lanes.some(lane => lane.kind === 'image') ? COLOUR_BAR_ROOM : 0);
    const plotWidth = (): number => Math.max(1, size.width - margin.left - rightRoom());
    /** Each lane's frame, by the lanes' ids in order (a picture's, or the spec's before its picture comes). */
    const frames = (picture: { lanes: ReadonlyArray<{ id: string }> }): Map<string, { left: number; top: number; width: number; height: number }> => {
        const out = new Map<string, { left: number; top: number; width: number; height: number }>();
        const width = plotWidth();
        const named = typeof options.laneHeights === 'function' ? options.laneHeights(size.height) : options.laneHeights ?? {};
        const free = picture.lanes.filter(lane => named[lane.id] === undefined);
        const taken = picture.lanes.reduce((sum, lane) => sum + (named[lane.id] ?? 0), 0);
        // (A bins lane's heading is written above its frame: the first one's needs the room of its line.)
        const above = spec?.lanes.some(lane => lane.kind === 'bins') ? BINS_HEADING_ROOM : margin.top;
        const rest = Math.max(1, size.height - above - margin.bottom - laneGap * (picture.lanes.length - 1) - taken);
        let top = above;
        for (const lane of picture.lanes) {
            const height = named[lane.id] ?? rest / Math.max(1, free.length);
            out.set(lane.id, { left: margin.left, top, width, height });
            top += height + laneGap;
        }
        return out;
    };
    const specifiedY = (laneId: string): (number | null)[] => view.lanes?.find(lane => lane.lane === laneId)?.y ?? [null, null];
    /** Each lane as drawn now: the picture's confirmed range, or, waiting on a range or size change, the new view on the last picture. */
    const laneViews = (): LaneView[] => {
        const picture = waiting ? (mapped ? last : null) : last;
        if (!picture) return [];
        const placed = frames(picture);
        return picture.lanes.flatMap(lane => {
            if (!lane.range) return [];
            const frame = placed.get(lane.id);
            if (!frame) return [];
            // While a picture is on its way, the last one is mapped onto the view asked for: an end not specified is the
            // whole axis's end (a reset or a zoom out asked for), not the last picture's, so a gesture made meanwhile
            // starts from the view asked for.
            const specX = view.x ?? [null, null], specY = specifiedY(lane.id);
            const wholeAcross = lane.whole?.x ?? lane.range.x, wholeUp = lane.whole?.y ?? lane.range.y;
            const x: [number, number] = waiting ? [specX[0] ?? wholeAcross[0], specX[1] ?? wholeAcross[1]] : [lane.range.x[0], lane.range.x[1]];
            const y: [number, number] = waiting ? [specY[0] ?? wholeUp[0], specY[1] ?? wholeUp[1]] : [lane.range.y[0], lane.range.y[1]];
            const up = axisScale(y[0], y[1], lane.axis.yScale === 'log');
            return [{ id: lane.id, frame, lane, range: { x, y }, x: axisScale(x[0], x[1], lane.axis.xScale === 'log'), y: up.log ? upScale(up, frame) : valueScale({ min: y[0], max: y[1] }, frame), up }];
        });
    };
    const xPx = (lane: LaneView, value: number): number => lane.frame.left + lane.x.fraction(value) * lane.frame.width;
    const laneAt = (lanes: readonly LaneView[], x: number, y: number): LaneView | null =>
        lanes.find(lane => y >= lane.frame.top && y <= lane.frame.top + lane.frame.height && x >= lane.frame.left && x <= lane.frame.left + lane.frame.width) ?? null;
    /** The scale a read carries: px per unit across (per natural-log unit on a log axis) and up. */
    const scaleOf = (lane: LaneView): [number, number] => [
        lane.x.log ? lane.frame.width / Math.log(lane.range.x[1] / lane.range.x[0]) : lane.frame.width / (lane.range.x[1] - lane.range.x[0]),
        lane.y.pixelsPerUnit,
    ];

    // ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

    const lineKeys = (lineId: string): readonly string[] => last?.members?.lines.find(line => line.line === lineId)?.used ?? [];
    const readable = (lineId: string | undefined): boolean => !!lineId && !lineKeys(lineId).some(key => unusable.has(key));
    /**
     * The one check of the selected point (paint, the mark, a step, a late reply, a click): of the picture drawn now
     * (its picture id, data id and generation), its line there of the same recording, and no answer of it stale.
     */
    const valid = (point: Selected | null): point is Selected => {
        const picture = current();
        if (!point || !picture || held() || failure || disposed) return false;
        if (point.pictureId !== picture.pictureId || point.dataId !== picture.dataId || point.generation !== drawnGeneration) return false;
        const lane = picture.lanes.find(item => item.id === point.lane);
        // A bins lane's point: a bar, a row (still that row there) or a role's line, of a column not gone stale.
        if (lane?.bins) return binsPointStands(lane.bins, point) && !unusable.has(lane.bins.column);
        // An image lane's one line is its image's; a lane of lines' is among its lines.
        const line = lane?.image && lane.image.line === point.line ? lane.image : lane?.lines.find(item => item.id === point.line);
        return !!line && line.key === point.key && readable(point.line);
    };
    const binsPointStands = (bins: PictureBins, point: Selected): boolean => {
        if (point.line === bins.bars) return point.key === undefined && point.point.index < bins.edges.length - 1;
        if (point.line === bins.rows) return bins.members[point.point.index]?.key === point.key;
        return bins.marks.some(mark => mark.id === point.line && mark.key === point.key);
    };
    /** The selected point a reply names, on the picture drawn now; null for any other reply. */
    const selectionOf = (reply: FigureReadResult | null, number: number, by: Selected['by']): Selected | null => {
        const picture = current();
        if (!picture || !reply || reply.status !== 'point' || !reply.point || !reply.line || !reply.lane || reply.pictureId !== picture.pictureId) return null;
        return {
            lane: reply.lane, line: reply.line, ...(reply.role !== undefined ? { role: reply.role } : {}), ...(reply.point.key !== undefined ? { key: reply.point.key } : {}),
            version: reply.version ?? '', point: reply.point, ...(reply.near ? { near: true } : {}), pictureId: picture.pictureId, dataId: picture.dataId, generation: drawnGeneration, number, by,
        };
    };
    /** The selected range as a request carries it. */
    const selectionSent = (): { selection?: number[]; selectionClosed?: boolean } => (selection ? { selection: [selection[0], selection[1]], ...(selection[2] ? { selectionClosed: true } : {}) } : {});
    /**
     * A stretch across `lane` picked, from `low` to `high`: closed when it reaches the top of the lane's whole axis (the
     * picture's: the last bin holds the top, so a range up to it takes the values on it).
     */
    const rangeOf = (lane: string, low: number, high: number): FigureRange => {
        const top = current()?.lanes.find(item => item.id === lane)?.whole?.x?.[1];
        return { lane, x: [low, high], ...(top !== undefined && high >= top ? { closed: true } : {}) };
    };
    const pickOf = (point: Selected | null): FigurePick | null => (valid(point) ? { lane: point.lane, line: point.line, ...(point.role !== undefined ? { role: point.role } : {}), point: point.point, near: point.by === 'keys' || !!point.near } : null);
    /** What a click on the selected point acts on: a bar's bin (the picture's own edges, 配置), any other point itself. */
    const hitOf = (point: Selected | null): Hit | null => {
        const read = pickOf(point);
        if (!read) return null;
        const bins = current()?.lanes.find(lane => lane.id === read.lane)?.bins;
        if (bins && read.line === bins.bars) return { range: rangeOf(read.lane, bins.edges[read.point.index], bins.edges[read.point.index + 1]) };
        return { pick: read };
    };
    /** The bin a reply says is under the pointer (a bins lane's read of no point), on the picture drawn now. */
    const binOf = (reply: FigureReadResult | null): typeof under => {
        const picture = current();
        if (!picture || !reply?.bin || !reply.lane || reply.status === 'point' || reply.pictureId !== picture.pictureId) return null;
        return { range: rangeOf(reply.lane, reply.bin.low, reply.bin.high), pictureId: picture.pictureId };
    };
    /** (Of a column not gone stale since: a click picks nothing of an old table's bins, as none of its points is read.) */
    const underNow = (): Hit | null => {
        const column = under ? current()?.lanes.find(lane => lane.id === under?.range.lane)?.bins?.column : undefined;
        return under && !held() && !failure && under.pictureId === current()?.pictureId && !(column !== undefined && unusable.has(column)) ? { range: under.range } : null;
    };
    const send = (payload: Omit<FigureReadPayload, 'figureId' | 'requestNumber' | 'pictureId'>, deliver: (reply: FigureReadResult | null, number: number) => void): ReturnType<FigureRequests['read']> => {
        const picture = current();
        if (!picture || held() || disposed) return null;
        return requests.read({ pictureId: picture.pictureId, ...payload }, deliver);
    };
    /** Read at the canvas place (x, y): the hover's read (one already asked there is not asked again). */
    const readAt = (x: number, y: number): typeof lastRead => {
        const lane = laneAt(laneViews(), x, y);
        if (!lane || !current()) return null;
        const at = { lane: lane.id, x: lane.x.at((x - lane.frame.left) / lane.frame.width), y: lane.y.levelOf(y) };
        // Asked here already (on its way, or answered and shown): not asked again.
        if (lastRead && lastRead.lane === at.lane && lastRead.x === at.x && lastRead.y === at.y && lastRead.number >= shownNumber) return lastRead;
        const ticket = send({ pointer: { ...at, scale: scaleOf(lane) } }, hoverReply);
        if (!ticket) return null;
        lastRead = { number: ticket.requestNumber, ...at, ticket };
        return lastRead;
    };
    /** A read's "no-picture" (redraw, at most twice in a row) or its failure; true when the reply is taken no further. */
    const retried = (reply: FigureReadResult): boolean => {
        const verdict = requests.readStatus(reply.status);
        if (verdict === 'redraw') { redraw(true, true); return true; }
        if (verdict === 'failed') { failure = 'failed'; paint(); return true; }
        return false;
    };
    const hoverReply = (reply: FigureReadResult | null, number: number): void => {
        const picture = current();
        if (disposed || !picture) return;
        if (reply && reply.pictureId !== picture.pictureId) return;
        if (number <= hoverFloor || number < shownNumber) return;
        if (reply && retried(reply)) return;
        shownNumber = number;
        selected = selectionOf(reply, number, 'pointer');
        said = selected ? null : reply?.status ?? 'failed';
        under = selected ? null : binOf(reply);
        paint();
    };
    /** The arrow keys' read (a step or a name): sent from the selected point, its reply used only while it is the newest. */
    const keysAsk = (payload: Omit<FigureReadPayload, 'figureId' | 'requestNumber' | 'pictureId'>, steps: number, from: Selected, done: (reply: FigureReadResult, number: number) => void, rows = 0): boolean => {
        const ticket = send(payload, (reply, number) => {
            // Not the keys' newest read (the pointer moved, a redraw, a long computation dropped it): not used.
            if (keyRead?.number !== number) return;
            const asked = keyRead.steps, askedRows = keyRead.rows;
            keyRead = null;
            // The host failed the read: the keys pressed are let go and the point read stays, so the next key steps
            // from it. A gesture's read is not sent again later by itself (the point would move with nobody pressing).
            if (!disposed && !reply) { pendingSteps = 0; pendingRows = 0; paint(); return; }
            if (disposed || !reply || reply.pictureId !== current()?.pictureId) { selected = null; pendingSteps = 0; pendingRows = 0; paint(); return; }
            // "No picture": drawn again and the point read again by its name; its steps are taken from there.
            if (reply.status === 'no-picture') { pendingSteps += asked; pendingRows += askedRows; }
            if (retried(reply)) return;
            hoverFloor = Math.max(hoverFloor, number);
            // The point it was asked from is no longer the selected one: an older identity's reply is dropped.
            if (selected !== from) { pendingSteps = 0; pendingRows = 0; paint(); return; }
            done(reply, number);
        });
        if (!ticket) return false;
        keyRead = { number: ticket.requestNumber, steps, rows };
        return true;
    };
    /** The selected point taken from a keys' reply; a point of none ('outside' past the side, 'no-point') clears it. */
    const takeKeysReply = (reply: FigureReadResult, number: number): void => {
        shownNumber = number;
        selected = selectionOf(reply, number, 'keys');
        said = selected ? null : reply.status;
        under = null;
        if (!selected) { pendingSteps = 0; pendingRows = 0; }
        paint();
        sendPending();
    };
    /** A step (b) of `steps` points from the selected point, on the current picture. */
    const sendStep = (from: Selected, steps: number, rows = 0): boolean => keysAsk(
        // From an image's cell: its row too, and the rows on (↑ / ↓).
        { dataId: from.dataId, generation: from.generation, step: { lane: from.lane, line: from.line, ...(from.key !== undefined ? { key: from.key } : {}), version: from.version, index: from.point.index, steps, ...(from.point.row !== undefined ? { row: from.point.row, rows } : {}) } },
        steps, from, takeKeysReply, rows,
    );
    const sendPending = (): void => {
        if (keyRead || !(pendingSteps || pendingRows) || !valid(selected)) return;
        const steps = pendingSteps, rows = selected.point.row !== undefined ? pendingRows : 0;
        pendingSteps = 0;
        pendingRows = 0;
        if (steps || rows) sendStep(selected, steps, rows);
    };
    /** A read by the selected point's name (c), with its recording key, after a redraw: kept if the new picture has it. */
    const readAgain = (from: Selected): void => {
        const sent = keysAsk({ name: { lane: from.lane, line: from.line, ...(from.key !== undefined ? { key: from.key } : {}), x: from.point.x, ...(from.point.y !== undefined ? { y: from.point.y } : {}) } }, 0, from, (reply, number) => {
            if (reply.status === 'point') { takeKeysReply(reply, number); return; }
            // Not in the new picture: the pointer's place is read.
            selected = null;
            pendingSteps = 0; pendingRows = 0;
            if (pointer) readAt(pointer.x, pointer.y);
            paint();
        });
        if (!sent) { selected = null; pendingSteps = 0; pendingRows = 0; }
    };
    /** ← / →: a step read from the selected point; keys pressed while one is on its way add to the next. */
    const step = (delta: -1 | 1): boolean => {
        if (held() || !current()) return false;
        if (keyRead) { pendingSteps += delta; return true; }
        if (!valid(selected)) return false;
        // Hover replies asked before this key are not used: they would move the point the key chose (第 6 節).
        hoverFloor = Math.max(hoverFloor, lastRead?.number ?? 0, shownNumber);
        return sendStep(selected, delta);
    };
    /** ↑ / ↓ on an image's cell: a step of one row from it; keys pressed while a read is on its way add to the next (as ← / →). */
    const stepUp = (delta: -1 | 1): boolean => {
        if (held() || !current() || !valid(selected) || selected.point.row === undefined) return false;
        if (keyRead) { pendingRows += delta; return true; }
        hoverFloor = Math.max(hoverFloor, lastRead?.number ?? 0, shownNumber);
        return sendStep(selected, 0, delta);
    };

    // ── Drawing ───────────────────────────────────────────────────────────────────────────────────────────────────

    /** A level's unit as its axis names it (its dB reference: "dBFS", "dB SPL"), written after a level read. */
    const levelUnit = (lane: PictureLane | undefined): string => {
        if (!lane) return '';
        // A gain's unit is its axis's own (a plain dB, or a transfer level's dB re its units' ratio), never the recording's level reference.
        if (lane.kind === 'lines' && lane.axis.of === 'gain') return levelUnitOfName(lineAxisNames(words, lane.axis).y);
        return lane.axis.referenceLabel.startsWith('dB') ? lane.axis.referenceLabel : '';
    };
    /** A place across a lane of lines, in its axis's unit and to the digits that tell its neighbours apart (R7). */
    const acrossText = (lane: PictureLane | undefined, x: number, step: number | undefined): string => {
        const across = lane?.axis.x;
        return across === 'time' ? secondsText(x, spacingDecimals(step, 2, 9)) : across === 'quefrency' ? quefrencyText(x, step) : across === 'lag' ? lagText(x, step) : frequencyText(x, step);
    };
    /** A value of a lane of lines: a Δ signed (in dB, or in the values' own unit), a level in its reference, any other amount in its unit (R4, R7). */
    const lineValueText = (lane: PictureLane | undefined, value: number): string => {
        const db = !lane || inDb(lane.axis);
        if (lane?.axis.quantity === 'delta') return signedText(value, db, db ? undefined : lane.axis.valueUnit);
        // A phase is read in degrees with their sign ("−90°"), as its axis names it.
        return db ? levelText(value, levelUnit(lane)) : amountText(value, lane.axis.of === 'phase' ? '°' : lane.axis.valueUnit);
    };
    /** A line's calibration word (計算ア): an uncalibrated line on an axis named calibrated says so after its name (R4). */
    const calibrationWord = (lineId: string, lane: PictureLane | undefined): string => {
        if (!lane || lane.axis.quantity === 'delta' || lane.axis.calibration !== 'calibrated') return '';
        return last?.members?.lines.find(line => line.line === lineId)?.calibration === 'uncalibrated' ? words.axisUncalibrated : '';
    };
    const nameOf = (line: FigureLineName, lane: PictureLane | undefined): string => `${options.lineLabel ? options.lineLabel(line) : line.id}${calibrationWord(line.id, lane)}`;
    const styleOf = (line: DrawnLine, read: boolean): { colour: string; width: number } => {
        const own = options.lineStyle?.({ id: line.id, ...(line.role !== undefined ? { role: line.role } : {}), ...(line.key !== undefined ? { key: line.key } : {}) });
        const style = own ?? { colour: ROLE_COLOURS[line.role ?? ''] ?? OTHER_COLOUR, width: 1.25 };
        // The line read is drawn wider, to tell it from the others of its lane. (A lane's one line is not: there is none
        // to tell it from, and a time signal drawn wider looks like another signal, its short peaks taller.)
        return read ? { ...style, width: Math.max(2, style.width + 0.6) } : style;
    };
    /** A role line's colour on a bins lane: its role's, as the screen's legend shows it. */
    const markColour = (mark: { id: string; role?: string; key: string }): string =>
        options.lineStyle?.(mark)?.colour ?? ROLE_COLOURS[mark.role ?? ''] ?? BINS_COLOURS.bar;
    /** Why a declared Δ line is not drawn, as the service counted it (計算ア): '' while it may still come. */
    const noDeltaReason = (picture: Picture): string => {
        const declared = spec?.lanes.flatMap(lane => lane.lines.filter(line => 'delta' in line.of).map(line => ({ id: line.id, band: lane.kind === 'band' }))) ?? [];
        for (const line of declared) {
            const counted = picture.members?.lines.find(item => item.line === line.id);
            if (!counted || counted.drawn) continue;
            const reasons = counted.excluded.map(item => item.reason);
            if (reasons.includes('other-reference')) return words.stageNoDeltaUnit;
            if (reasons.includes('other-axis')) return line.band ? words.stageNoDeltaRate : words.stageNoDelta;
        }
        return '';
    };
    /** The Δ lane's headline (第 5 節 オ): its point in the readout's form, or why there is none. Empty while waiting. */
    const headlineText = (): string => {
        const picture = current();
        const lane = picture?.lanes.find(item => item.axis.quantity === 'delta');
        // No Δ drawn: nothing to head while its base is on its way (計算ア); where the service left a recording out of
        // the Δ for good (another unit or reference, another axis or sample rate), the headline says why there is none.
        if (!picture) return '';
        if (!lane || !lane.lines.length) return noDeltaReason(picture);
        // Of an answer gone stale (either side of the Δ: its compared recording or its base), not shown, as the readout
        // and the mark are not: the same check (readable) as every read of the line.
        if (!lane.lines.every(line => readable(line.id))) return '';
        const peak = picture.headlines.find(item => item.lane === lane.id);
        if (!peak) return words.stageNoDelta;
        // A time signal's Δ: its sample's time (to its sample period) and its value, signed, in the signal's unit.
        if (lane.kind === 'band') return words.stageMaxDelta.replace('{at}', secondsText(peak.x, spacingDecimals(peak.xStep, 2, 6))).replace('{delta}', signedText(peak.value, false, lane.axis.unit));
        return words.stageMaxDelta.replace('{at}', acrossText(lane, peak.x, peak.xStep)).replace('{delta}', lineValueText(lane, peak.value));
    };
    /** A lane's level words (its colour axis on an image lane, its axis up on a lane of level lines). */
    const levelName = (lane: PictureLane): string => (lane.kind === 'image' && lane.axis.quantity !== 'level' ? colourAxisName(words, lane.axis) : levelAxisName(words, lane.axis.referenceLabel, lane.axis.calibration));
    /** An image lane of signed values (a cepstrogram's coefficients) is coloured about zero. */
    const paletteOf = (lane: PictureLane): ImagePalette => (lane.kind === 'image' && lane.axis.of === 'cepstrum' ? 'signed' : options.imagePalette ?? 'grey');
    const axisNames = (lane: PictureLane): { x: string; y: string } => {
        if (lane.kind === 'image') return { x: words.axisTime, y: rowsAxisName(words, lane.axis.y) };
        // A time signal: its values in their unit (none where the recording has none), said uncalibrated where the
        // picture's calibration word says so (R4).
        if (lane.kind === 'band') {
            const name = `${words.waveRangeAxisAmplitude}${lane.axis.calibration === 'uncalibrated' ? words.axisUncalibrated : ''}`;
            const y = lane.axis.unit ? `${name} [${lane.axis.unit}]` : name;
            // A trigger's events are over the time from their trigger. A Δ says what it is the difference of (#848).
            return { x: lane.axis.x === 'triggerTime' ? words.axisTriggerTime : words.axisTime, y: lane.axis.quantity === 'delta' ? deltaAxisName(words, y) : y };
        }
        // A distribution: across, the table column's own name (the screen's); up, how many rows.
        if (lane.kind === 'bins') return { x: lane.bins ? options.columnName?.(lane.bins.column) ?? lane.bins.column : '', y: words.dsDistCountAxis.replace('{unit}', words.dsUnitRecording) };
        return lineAxisNames(words, lane.axis);
    };
    /**
     * A bins lane's readout (R7): a bar says its group, its bin's ends and how many rows it holds (with a range
     * selected, how many of them it takes first); a row's dot or tick its group, the row and its value; a role's
     * line the row and its value. The count is the read's; the ends and the selected share are the picture's.
     */
    /** A bins lane's heading: whose it is and its n, the picture's count (nothing is counted here). */
    const binsTag = (lane: PictureLane, bins: PictureBins): string => `${options.laneLabel?.(lane.id) ?? lane.id} · ${bins.n} ${words.dsUnitRecording}`;
    const binsReadout = (lane: PictureLane, bins: PictureBins, mark: NonNullable<ReturnType<typeof markNow>>): string => {
        const text = (value: number): string => tableValueText(value, bins.step);
        const group = options.laneLabel?.(lane.id) ?? lane.id;
        if (mark.line === bins.bars) {
            const picked = bins.countsPicked ? `${bins.countsPicked[mark.index] ?? 0} / ` : '';
            return [group, `${text(bins.edges[mark.index])}–${text(bins.edges[mark.index + 1])}`, `${picked}${mark.point.value} ${words.dsUnitRecording}`].join(' / ');
        }
        const row = nameOf({ id: mark.line, ...(mark.role !== undefined ? { role: mark.role } : {}), ...(mark.key !== undefined ? { key: mark.key } : {}) }, lane);
        return [...(mark.line === bins.rows ? [group] : []), row, text(mark.point.x)].join(' / ');
    };
    const markNow = (): (FigurePick & { index: number; key?: string }) | null => {
        const read = pickOf(selected);
        return read ? { ...read, index: read.point.index, ...(selected?.key !== undefined ? { key: selected.key } : {}) } : null;
    };
    const readoutText = (): string => {
        if (held()) return words.pairWaiting;
        if (failure === 'too-large') return words.stageTooLarge;
        if (failure === 'busy') return words.stageBusy;
        if (failure) return words.stageCombineFailed;
        if (waiting) return '';
        const mark = markNow();
        if (mark) {
            const lane = last?.lanes.find(item => item.id === mark.lane);
            if (lane?.bins) return binsReadout(lane, lane.bins, mark);
            const band = lane?.kind === 'band';
            const value = band ? (lane.axis.quantity === 'delta' ? signedText(mark.point.value, false, lane.axis.unit) : amountText(mark.point.value, lane.axis.unit)) : lane?.kind === 'lines' ? lineValueText(lane, mark.point.value) : lane?.axis.quantity === 'delta' ? signedText(mark.point.value) : lane?.kind === 'image' && lane.axis.quantity !== 'level' ? amountText(mark.point.value, lane.axis.valueUnit) : levelText(mark.point.value, levelUnit(lane));
            // An image's cell: when (to its columns' step) and at what row (a frequency, a quefrency, a Bark band; to its rows' step); a signal's sample:
            // when (to its sample period); a line's point: its place across, in its axis's unit.
            const when = (): string => secondsText(mark.point.x, spacingDecimals(mark.point.xStep, 2, 6));
            const rows = lane?.axis.y;
            const rowText = (y: number): string => (rows === 'quefrency' ? quefrencyText(y, mark.point.yStep) : rows === 'bark' ? amountText(y, 'Bark') : frequencyText(y, mark.point.yStep));
            const where = mark.point.y !== undefined ? [when(), rowText(mark.point.y)] : band ? [when()] : [acrossText(lane, mark.point.x, mark.point.xStep)];
            // As every plot's readout row writes it: the line's name (of the recording the point was read of), then where and what (R7).
            return [nameOf({ id: mark.line, ...(mark.role !== undefined ? { role: mark.role } : {}), ...(mark.key !== undefined ? { key: mark.key } : {}) }, lane), ...where, value].filter(Boolean).join(' / ');
        }
        if (selected) return '';
        if (said === 'no-value') return words.plotNoValue;
        if (said === 'failed') return words.stageCombineFailed;
        return '';
    };
    /** A line of bands as drawn: a bar a band between its edges' places, at its value's (a gap: no value). */
    const barsOf = (lane: LaneView, edges: readonly number[], values: ReadonlyArray<number | null>): Array<[number, number, number] | null> =>
        values.map((value, at) => (value === null || value === undefined ? null : [xPx(lane, edges[at]), xPx(lane, edges[at + 1]), lane.y.yOf(value)]));
    const inspect = (): FigureInspection => {
        const lanes = laneViews();
        const mark = markNow();
        const markLane = mark ? lanes.find(lane => lane.id === mark.lane) : undefined;
        return {
            figureId: requests.figureId, generation, pictureId: current()?.pictureId ?? null, waiting, mapped: waiting && mapped && lanes.length > 0, held: held(), failure,
            readout: readoutText(), headline: headlineText(), dataId: current()?.dataId ?? null, whole: wholeOf(lanes[0], 'x'),
            box: box ? { left: Math.min(box.from.x, box.to.x), top: Math.min(box.from.y, box.to.y), width: Math.abs(box.to.x - box.from.x), height: Math.abs(box.to.y - box.from.y) } : null,
            lanes: lanes.map(lane => {
                const order = drawOrder(lane.lane.lines, mark?.lane === lane.id ? mark.line : null);
                return {
                    id: lane.id, frame: lane.frame, range: lane.range, wholeY: wholeOf(lane, 'y'), part: partOf(lane), axisNames: axisNames(lane.lane), xLog: lane.x.log, yLog: lane.up.log,
                    // The axis across is shared: its ticks are written under the last lane, at its places on each.
                    xTicks: options.acrossAxis === false ? [] : alongAxisTicks(lane.range.x[0], lane.range.x[1], lane.x.log).map(tick => ({ ...tick, px: xPx(lane, tick.value) })),
                    yTicks: lane.up.log
                        ? alongAxisTicks(lane.range.y[0], lane.range.y[1], true).map(tick => ({ ...tick, px: lane.y.yOf(tick.value) }))
                        : valueAxisTicks({ min: lane.range.y[0], max: lane.range.y[1] }, lane.frame.height).map(tick => ({ value: tick.value, text: tick.text, px: lane.y.yOf(tick.value) })),
                    ...(imageOf(lane) ? { image: imageOf(lane) } : {}),
                    ...(options.acrossGrid ? { grid: gridOf(lane.frame) } : {}),
                    ...(lane.lane.bins ? { bins: placeBins(lane.lane.bins, lane.frame, lane.x, lane.y), tag: binsTag(lane.lane, lane.lane.bins) } : {}),
                    order: order.map(line => line.id),
                    guides: lane.lane.guides.map(guide => ({ ...guide, px: guide.axis === 'x' ? xPx(lane, guide.at) : lane.y.yOf(guide.at) })),
                    ...(lane.lane.spans ? { spans: lane.lane.spans.map(span => ({ ...span, left: Math.max(lane.frame.left, Math.min(lane.frame.left + lane.frame.width, xPx(lane, span.start))), right: Math.max(lane.frame.left, Math.min(lane.frame.left + lane.frame.width, xPx(lane, span.end))) })) } : {}),
                    ...(lane.lane.events ? { events: lane.lane.events } : {}),
                    lines: order.map(line => ({ id: line.id, ...styleOf(line, order.length > 1 && mark?.lane === lane.id && mark.line === line.id), ...(lineUnderOf(lane, line) ? { under: lineUnderOf(lane, line)?.spans } : {}), points: line.xs.map((x, at) => { const value = line.values[at]; return value === null || value === undefined ? null : [xPx(lane, x), lane.y.yOf(value)] as [number, number]; }),
                        ...(line.edges ? { bars: barsOf(lane, line.edges, line.values) } : {}) })),
                };
            }),
            // On a line at its point's value; on an image at its cell's place up the axis.
            mark: mark && markLane ? {
                lane: mark.lane, line: mark.line, index: mark.index, x: mark.point.x, value: mark.point.value, px: xPx(markLane, mark.point.x),
                py: Math.max(markLane.frame.top, Math.min(markLane.frame.top + markLane.frame.height, markLane.y.yOf(mark.point.y ?? mark.point.value))),
                ...(mark.point.row !== undefined && mark.point.y !== undefined ? { row: mark.point.row, y: mark.point.y } : {}),
                ...(markLane.lane.bins ? {} : { cross: { top: markLane.frame.top, bottom: markLane.frame.top + markLane.frame.height, left: markLane.frame.left, right: markLane.frame.left + markLane.frame.width } }),
            } : null,
            followed: ((): { x: number; px: number } | null => { const px = followed !== null && lanes[0] ? followedPx(lanes[0]) : null; return followed !== null && px !== null ? { x: followed, px } : null; })(),
        };
    };
    /** An image lane's picture as drawn (FigureInspection's `image`); undefined on a lane of lines or with no image. */
    const imageOf = (lane: LaneView): NonNullable<FigureInspection['lanes'][number]['image']> | undefined => {
        const image = lane.lane.image, colour = lane.lane.range?.colour;
        if (!image || !colour) return undefined;
        const bar = valueScale({ min: colour[0], max: colour[1] }, lane.frame);
        const under = underOf(lane.id);
        return {
            ...(under ? { under: { left: xPx(lane, under.columnEdges[0]), right: xPx(lane, under.columnEdges[under.columnEdges.length - 1]) } } : {}),
            ground: groundOf(lane.frame, lane.x, wholeOf(lane, 'x')),
            line: image.line, key: image.key, rows: image.cells.length, columns: image.cells[0]?.length ?? 0, colour: [colour[0], colour[1]], colourName: levelName(lane.lane),
            colourTicks: valueAxisTicks({ min: colour[0], max: colour[1] }, lane.frame.height).map(tick => ({ value: tick.value, text: tick.text, px: bar.yOf(tick.value) })),
            edges: {
                left: xPx(lane, image.columnEdges[0]), right: xPx(lane, image.columnEdges[image.columnEdges.length - 1]),
                bottom: lane.y.yOf(image.rowEdges[0]), top: lane.y.yOf(image.rowEdges[image.rowEdges.length - 1]),
            },
        };
    };
    /** The declared order (spec 1), the line read (hovered) drawn last, on top. */
    const drawOrder = (lines: readonly DrawnLine[], hovered: string | null): DrawnLine[] => [...lines.filter(line => line.id !== hovered), ...lines.filter(line => line.id === hovered)];
    /** The part of each whole axis `lane` shows, as fractions of it. */
    const partOf = (lane: LaneView): { x: { start: number; end: number }; y: { start: number; end: number } } => {
        const across = wholeScale(lane, 'x'), up = wholeScale(lane, 'y');
        const of = (scale: AxisScale, value: number): number => Math.max(0, Math.min(1, scale.fraction(value)));
        return { x: { start: of(across, lane.range.x[0]), end: of(across, lane.range.x[1]) }, y: { start: of(up, lane.range.y[0]), end: of(up, lane.range.y[1]) } };
    };
    /** An axis name fitted to `room` px along it (fitAxisTitle: smaller, on two lines, its quantity shortened), centred at (x, y). */
    const drawName = (ctx: CanvasRenderingContext2D, name: string, x: number, y: number, room: number, lines: 1 | 2): void => {
        const font = ctx.font;
        const fitted = fitAxisTitle(name, room, text => ctx.measureText(text).width, { lines });
        ctx.font = scaledFont(font, fitted.scale);
        const step = fontPixels(ctx.font) + 1;
        fitted.lines.forEach((line, at) => ctx.fillText(line, x, y + at * step));
        ctx.font = font;
    };
    /** The names an export writes, of the picture shown when it is asked (ExportNames). */
    const exportNames = (picture: Picture): ExportNames => ({
        lines: new Map(picture.lanes.flatMap(lane => lane.lines.map(line => [line.id, {
            name: nameOf({ id: line.id, ...(line.role !== undefined ? { role: line.role } : {}), ...(line.key !== undefined ? { key: line.key } : {}) }, lane),
            ...(line.key !== undefined ? { key: line.key } : {}),
        }] as const))),
        axes: new Map(picture.lanes.map(lane => [lane.id, axisNames(lane).y] as const)),
        across: new Map(picture.lanes.map(lane => [lane.id, axisNames(lane).x] as const)),
    });
    /** The export's table: per line its places and its answers, two columns each, named as they were when asked. */
    const tableOf = (reply: FigureExportResult | null, asked: string, names: ExportNames): FigureTable => {
        if (!reply) return { status: 'failed' };
        if (reply.status === 'no-picture' || (reply.dataId !== undefined && reply.dataId !== asked)) return { status: 'changed' };
        if (reply.status === 'too-large') return { status: 'too-large' };
        const columns = reply.columns ?? [];
        // A column of a line the picture asked of did not have, or of another recording: not the data asked for.
        if (columns.some(column => !names.lines.has(column.line) || names.lines.get(column.line)?.key !== column.key)) return { status: 'changed' };
        const header = columns.flatMap(column => {
            const name = names.lines.get(column.line)?.name ?? column.line;
            return [`${name} ${names.across.get(column.lane) ?? words.axisFrequency}`, `${name} ${names.axes.get(column.lane) ?? ''}`.trimEnd()];
        });
        const length = Math.max(0, ...columns.map(column => column.xs.length));
        const rows = Array.from({ length }, (_, at) => columns.flatMap(column => {
            const x = column.xs[at], value = column.values[at];
            return [x === undefined ? '' : exactFieldText(x), value === undefined || value === null ? '' : exactFieldText(value)];
        }));
        return { status: 'rows', dataId: asked, header, rows };
    };
    /**
     * The readout row's text: into a page's readout element's name and values, as every plot's row writes them. A
     * page's readout may be several Figures' (the Tracks rows share one): the one with something to say writes it, and
     * only the one that wrote it last takes it away. False when it is another Figure's now.
     */
    const writeReadout = (text: string): boolean => {
        if (options.readout) {
            if (text) readoutWriters.set(readout, token);
            else if (readoutWriters.get(readout) !== token) return false;
        }
        const [nameEl, valuesEl] = Array.from(readout.children) as HTMLElement[];
        if (options.readout && nameEl && valuesEl) {
            const at = text.indexOf(' / ');
            nameEl.textContent = at < 0 ? '' : text.slice(0, at);
            valuesEl.textContent = at < 0 ? text : text.slice(at);
        } else {
            readout.textContent = text;
        }
        readout.hidden = !text;
        return true;
    };
    const context = (): CanvasRenderingContext2D | null => {
        try { return canvas.getContext('2d'); } catch { return null; }
    };
    /**
     * An image lane's cells as pixels, kept: the pixels are of the image itself (imagePixelsOf), so a read's mark
     * moving over it, and the image moved across while the time shown is scrolled, put the kept pixels again and
     * make none. They are made again when the picture's image, the plot's size, the scale across or up, or the
     * colour range are another.
     */
    const imagePixels = new Map<string, { image: unknown; key: string; canvas: HTMLCanvasElement }>();
    const putImage = (ctx: CanvasRenderingContext2D, slot: string, image: DrawnImage, frame: { left: number; top: number; width: number; height: number }, x: AxisScale, up: AxisScale, colour: readonly [number, number], ratio: number, palette: ImagePalette): void => {
        const pixels = imagePixelsOf(image, Math.max(1, Math.round(frame.width * ratio)), Math.max(1, Math.round(frame.height * ratio)), x, up, colour, palette);
        // (Pixels made for the plot's part alone are of where the image is: its place is in their key.)
        const key = [pixels.width, pixels.height, pixels.whole ? '' : x.fraction(image.columnEdges[0]), up.fraction(image.rowEdges[0]), up.fraction(image.rowEdges.at(-1) ?? 0), colour[0], colour[1], palette].join(' ');
        let kept = imagePixels.get(slot);
        if (!kept || kept.image !== image || kept.key !== key) {
            const canvas = kept?.canvas ?? doc.createElement('canvas');
            canvas.width = pixels.width;
            canvas.height = pixels.height;
            const own = canvas.getContext('2d');
            if (!own) return;
            const made = own.createImageData(pixels.width, pixels.height);
            made.data.set(pixels.data());
            own.putImageData(made, 0, 0);
            kept = { image, key, canvas };
            imagePixels.set(slot, kept);
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(kept.canvas, frame.left + pixels.left / ratio, frame.top, pixels.width / ratio, pixels.height / ratio);
    };
    /** The images kept under the lanes' own (FigureOptions.imageUnder), by lane. */
    const unders = new Map<string, DrawnImage>();
    const imageAcross = (image: DrawnImage): number => Math.abs((image.columnEdges.at(-1) ?? 0) - image.columnEdges[0]);
    /** A picture came: an image of the answer a lane keeps under is kept when it reaches at least as far across as the one kept. */
    /** The lines kept under (lineUnder), by lane and line: the answer they are of and their points as the picture gave them. */
    const lineUnders = new Map<string, { key: string | undefined; xs: readonly number[]; values: ReadonlyArray<number | null>; across: readonly [number, number] | null }>();
    const lineAcross = (xs: readonly number[]): number => (xs.length ? Math.abs(xs[xs.length - 1] - xs[0]) : 0);
    /** The stretches (px) of a lane's frame a line drawn from `first` to `last` (px; none: null) leaves without it. */
    const uncovered = (frame: { left: number; width: number }, ends: [number, number] | null): Array<[number, number]> => {
        const right = frame.left + frame.width;
        if (!ends) return [[frame.left, right]];
        const out: Array<[number, number]> = [];
        if (ends[0] > frame.left + 1) out.push([frame.left, Math.min(right, ends[0])]);
        if (ends[1] < right - 1) out.push([Math.max(frame.left, ends[1]), right]);
        return out;
    };
    /** Where a line's kept points are drawn under it now: the stretches its own points leave, where the kept ones reach. */
    const lineUnderOf = (lane: LaneView, line: PictureLane['lines'][number]): { xs: readonly number[]; values: ReadonlyArray<number | null>; across: readonly [number, number] | null; spans: Array<[number, number]> } | null => {
        const kept = options.lineUnder ? lineUnders.get(`${lane.id} ${line.id}`) : undefined;
        if (!kept || kept.key !== line.key || kept.xs === line.xs || !kept.xs.length) return null;
        const ends: [number, number] | null = line.xs.length ? [xPx(lane, line.xs[0]), xPx(lane, line.xs[line.xs.length - 1])] : null;
        const from = xPx(lane, kept.xs[0]), to = xPx(lane, kept.xs[kept.xs.length - 1]);
        const spans = uncovered(lane.frame, ends).map(([left, right]): [number, number] => [Math.max(left, from), Math.min(right, to)]).filter(([left, right]) => right > left);
        return spans.length ? { xs: kept.xs, values: kept.values, across: kept.across, spans } : null;
    };
    const keepUnder = (picture: Picture): void => {
        if (options.lineUnder) for (const lane of picture.lanes) {
            if (lane.image || lane.bins) continue;
            for (const line of lane.lines) {
                const name = `${lane.id} ${line.id}`, had = lineUnders.get(name);
                if (!had || had.key !== line.key || lineAcross(line.xs) >= lineAcross(had.xs)) { lineUnders.set(name, { key: line.key, xs: line.xs, values: line.values, across: lane.range?.x ?? null }); keptCount += 1; }
            }
        }
        if (!options.imageUnder) return;
        for (const lane of picture.lanes) {
            const image = lane.image;
            if (!image || image.key !== options.imageUnder(lane.id)) continue;
            const had = unders.get(lane.id);
            if (!had || had.key !== image.key || imageAcross(image) >= imageAcross(had)) { unders.set(lane.id, image); keptCount += 1; }
        }
    };
    /** The image kept under a lane's own now: of the answer the screen names now, or none. */
    const underOf = (lane: string): DrawnImage | undefined => {
        const had = unders.get(lane);
        if (had && had.key !== options.imageUnder?.(lane)) { unders.delete(lane); imagePixels.delete(`${lane} under`); return undefined; }
        return had;
    };
    /** Where the screen's axis across has its ticks on a frame (px): the faint lines down a lane (acrossGrid). */
    const gridOf = (frame: { left: number; width: number }): number[] => (options.acrossGrid?.() ?? []).filter(at => at >= 0 && at <= 1).map(at => Math.round(frame.left + at * frame.width));
    /**
     * The stretch (px) of an image lane's frame painted with the colour of no value: where the image's whole axis
     * across lies (a recording's start to its end). Past it nothing is painted, so the plot does not read as silence
     * where there is no recording.
     */
    const groundOf = (frame: { left: number; width: number }, x: AxisScale, whole: readonly [number, number] | null): [number, number] => {
        const ends = whole ? [x.fraction(whole[0]), x.fraction(whole[1])].map(at => Math.max(0, Math.min(1, at))) : [0, 1];
        return [Math.round(frame.left + Math.min(ends[0], ends[1]) * frame.width), Math.round(frame.left + Math.max(ends[0], ends[1]) * frame.width)];
    };
    const drawImageLane = (ctx: CanvasRenderingContext2D, id: string, image: DrawnImage, frame: { left: number; top: number; width: number; height: number }, x: AxisScale, up: AxisScale, colour: readonly [number, number], ratio: number, palette: ImagePalette, whole: readonly [number, number] | null): void => {
        const [from, to] = groundOf(frame, x, whole);
        ctx.fillStyle = emptyColourOf(palette);
        if (to > from) ctx.fillRect(from, frame.top, to - from, frame.height);
        // The image kept under, where the lane's own does not reach both sides of the plot.
        const under = underOf(id);
        const first = x.fraction(image.columnEdges[0]), last = x.fraction(image.columnEdges.at(-1) ?? 0);
        if (under && under !== image && (Math.min(first, last) > 0 || Math.max(first, last) < 1)) putImage(ctx, `${id} under`, under, frame, x, up, colour, ratio, palette);
        putImage(ctx, id, image, frame, x, up, colour, ratio, palette);
    };
    /** Tells the screen the line read now, when it is another than the one told last (FigureSignals.read). */
    const tellRead = (mark: { lane: string; line: string } | null): void => {
        // (The point read stays while the pointer is on an axis; a click there is the axis's, not the point's.)
        const nearNow = !!selected && (selected.by === 'keys' || (!!selected.near && !!pointer && !!laneAt(laneViews(), pointer.x, pointer.y)));
        const readNow = mark ? `${mark.lane} ${mark.line} ${nearNow}` : '';
        if (readNow === toldRead) return;
        toldRead = readNow;
        for (const listener of [...listeners.read]) listener(mark ? { lane: mark.lane, line: mark.line, near: nearNow } : null);
    };
    /** Tells the screen the place across read now, when it is another than the one told last (FigureSignals.across). */
    const tellAcross = (mark: { x: number } | null): void => {
        // The point read stays drawn when the pointer leaves; it is followed only while the pointer, or a key, reads it.
        const now = mark && (pointer || selected?.by === 'keys') ? mark.x : null;
        if (now === toldAcross) return;
        toldAcross = now;
        for (const listener of [...listeners.across]) listener(now);
    };
    /** Where the followed place's line is drawn on a lane; null when it is out of the range shown. */
    const followedPx = (lane: LaneView): number | null => {
        if (followed === null || followed < Math.min(...lane.range.x) || followed > Math.max(...lane.range.x)) return null;
        return xPx(lane, followed);
    };
    /** The canvas a lane's dense lines are made on (denseLine.ts), kept. */
    let denseCanvas: HTMLCanvasElement | null = null;
    const denseScratch = (): HTMLCanvasElement => (denseCanvas ??= doc.createElement('canvas'));
    /**
     * The lanes as last painted (everything but the marks over them: the cross and dot read, the followed line, the
     * box), kept as pixels by the line read (it is drawn last, on top, and wider). `key` says what they were painted
     * of; another key drops them all.
     */
    const layers = { key: '', byRead: new Map<string, HTMLCanvasElement>() };
    /** A number for each picture shown and each line or image kept under: what the points drawn are of. */
    const pictureNumbers = new WeakMap<object, number>();
    let pictureCount = 0, keptCount = 0;
    const numberOf = (item: object | null): number => {
        if (!item) return 0;
        let number = pictureNumbers.get(item);
        if (number === undefined) { number = ++pictureCount; pictureNumbers.set(item, number); }
        return number;
    };
    const lastPoint = (points: ReadonlyArray<[number, number] | null>): [number, number] | null => {
        for (let at = points.length - 1; at >= 0; at -= 1) if (points[at]) return points[at];
        return null;
    };
    /** Where a scale puts two values: two scales that put them alike are the same scale (linear or log). */
    const scaleKey = (lane: LaneView): number[] => [lane.x.fraction(1), lane.x.fraction(10), lane.up.fraction(1), lane.up.fraction(10), lane.y.yOf(0), lane.y.yOf(1)];
    /**
     * What the lanes are painted of, as text: the picture and what is kept under, the size, the scales, and what the
     * Figure says of each lane but its lines' points (a line's points are of the picture and the scales; their count
     * and ends are said too). Whatever the painting reads that may change between two paintings is in it.
     */
    const layerKeyOf = (seen: FigureInspection, views: readonly LaneView[], ratio: number): string => JSON.stringify([
        numberOf(last), keptCount, size.width, size.height, ratio, seen.waiting, seen.mapped, seen.failure,
        views.map(view => [view.id, scaleKey(view), paletteOf(view.lane), options.laneLabel?.(view.id) ?? null, options.laneTitle?.(view.id) ?? null, options.imageUnder?.(view.id) ?? null, gridOf(view.frame), wholeOf(view, 'x')]),
        // (Of the lines in their declared order and their own style: which is read, so drawn last and wider, is the
        // layer's own name, not its key.)
        seen.lanes.map(({ order: _order, ...lane }) => ({
            ...lane,
            guides: lane.guides.map(guide => ({ ...guide, label: options.guideLabel?.(lane.id, guide) ?? null })),
            lines: [...lane.lines].sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0)).map(({ points, colour: _colour, width: _width, ...line }) => ({ ...line, count: points.length, first: points.find(Boolean) ?? null, last: lastPoint(points) })),
            styles: views.find(view => view.id === lane.id)?.lane.lines.map(line => [line.id, styleOf(line, false)]) ?? [],
            ...(lane.bins ? { colours: lane.bins.marks.map(mark => markColour(mark)) } : {}),
        })),
    ]);
    /** Keeps what the canvas holds now (the lanes, before any mark is drawn over them) for the line read `read`. */
    const keepLayer = (read: string): void => {
        if (!canvas.width || !canvas.height) return;
        const kept = layers.byRead.get(read) ?? doc.createElement('canvas');
        kept.width = canvas.width;
        kept.height = canvas.height;
        kept.getContext('2d')?.drawImage(canvas, 0, 0);
        layers.byRead.delete(read);
        layers.byRead.set(read, kept);
        // (A line read each, and none: a few at most; the oldest goes first.)
        while (layers.byRead.size > 4) layers.byRead.delete(layers.byRead.keys().next().value as string);
    };
    const paint = (): void => {
        if (disposed) return;
        const seen = inspect();
        const ownReadout = writeReadout(seen.readout);
        tellRead(seen.mark);
        // A drag under way tells the place under the pointer itself (onMove): a paint meanwhile (the loop drawn as it is
        // dragged) does not take it back to the mark, which is none while dragging (R7).
        if (!press?.isDrag) tellAcross(seen.mark);
        if (listeners.placed.size) {
            const lanes: FigurePlacedLane[] = seen.lanes.map(lane => ({ id: lane.id, frame: lane.frame, guides: lane.guides, ...(lane.events ? { events: lane.events } : {}) }));
            const now = JSON.stringify(lanes);
            if (now !== toldPlaced) { toldPlaced = now; for (const listener of [...listeners.placed]) listener(lanes); }
        }
        // In the colour of the line read, as every plot's readout row (R7): a role's line on a distribution too.
        const readLane = seen.mark ? seen.lanes.find(lane => lane.id === seen.mark?.lane) : undefined;
        const readMark = readLane?.bins?.marks.find(mark => mark.id === seen.mark?.line);
        if (ownReadout) readout.style.color = readMark ? markColour(readMark) : readLane?.lines.find(line => line.id === seen.mark?.line)?.colour ?? '';
        if (options.headlineHost) options.headlineHost.textContent = seen.headline;
        canvas.dataset.figureGeneration = String(generation);
        canvas.dataset.figureWaiting = seen.waiting ? 'true' : 'false';
        const ratio = doc.defaultView?.devicePixelRatio ?? 1;
        canvas.width = Math.round(size.width * ratio);
        canvas.height = Math.round(size.height * ratio);
        if (!options.fill) {
            canvas.style.width = `${size.width}px`;
            canvas.style.height = `${size.height}px`;
        }
        const ctx = context();
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        ctx.font = '10px sans-serif';
        const views = laneViews();
        // The lanes as painted last time, copied back when nothing of them is another (a pointer's move, a box being
        // dragged): only the marks over them are drawn again. Stroking a dense signal again took 100 ms and more.
        const layerKey = layerKeyOf(seen, views, ratio);
        if (layerKey !== layers.key) { layers.key = layerKey; layers.byRead.clear(); }
        const readKey = seen.mark ? `${seen.mark.lane} ${seen.mark.line}` : '';
        const keptLayer = layers.byRead.get(readKey);
        if (keptLayer) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(keptLayer, 0, 0);
            ctx.restore();
        } else seen.lanes.forEach((lane, index) => {
            const { frame } = lane;
            const viewed = views.find(item => item.id === lane.id);
            if (viewed?.lane.image && lane.image) {
                // The image under its frame's stroke, cut at the frame; its colour bar beside it with the colour axis's ticks and name.
                ctx.save();
                ctx.beginPath();
                ctx.rect(frame.left, frame.top, frame.width, frame.height);
                ctx.clip();
                drawImageLane(ctx, lane.id, viewed.lane.image, frame, viewed.x, viewed.up, lane.image.colour, ratio, paletteOf(viewed.lane), wholeOf(viewed, 'x'));
                // The shared axis's ticks across, over the image (faint: a time is read down the rows).
                ctx.fillStyle = GRID_COLOUR;
                for (const px of gridOf(frame)) ctx.fillRect(px, frame.top, 1, frame.height);
                ctx.restore();
                paintColourBar(ctx, frame, lane.image.colour, paletteOf(viewed.lane));
                const bar = colourBarBox(frame);
                ctx.fillStyle = '#888';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                for (const tick of lane.image.colourTicks) ctx.fillText(tick.text, bar.left + bar.width + 4, tick.px);
                ctx.save();
                ctx.translate(bar.left + bar.width + COLOUR_BAR.labels + COLOUR_BAR.name / 2, frame.top + frame.height / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                drawName(ctx, lane.image.colourName, 0, -5, frame.height, 1);
                ctx.restore();
                // Whose image the lane is (images are a lane each, never overlaid): its recording's name in the corner, with its colour.
                const title = options.laneLabel?.(lane.id);
                if (title) {
                    const own = viewed.lane.image;
                    paintLaneTitle(ctx, frame, title, options.lineStyle?.({ id: own.line, ...(own.role !== undefined ? { role: own.role } : {}), key: own.key })?.colour ?? ROLE_COLOURS[own.role ?? ''] ?? OTHER_COLOUR);
                }
            }
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1;
            ctx.strokeRect(frame.left, frame.top, frame.width, frame.height);
            ctx.fillStyle = '#888';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            // (A name at the lane's end is kept in the canvas and out of the next lane: tickNameAt.)
            for (const tick of lane.yTicks) ctx.fillText(tick.text, frame.left - 4, tickNameAt(tick.px, frame, seen.lanes[index - 1]?.frame, seen.lanes[index + 1]?.frame, size.height));
            if (index === seen.lanes.length - 1 && options.acrossAxis !== false) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                // On a narrow plot, only the labels that fit beside the last one written (R4: no two tick labels over
                // each other); a tick left unnamed is read off its neighbours.
                let written = -Infinity;
                for (const tick of [...lane.xTicks].sort((one, other) => one.px - other.px)) {
                    const half = ctx.measureText(tick.text).width / 2;
                    if (tick.px - half < written + 3) continue;
                    ctx.fillText(tick.text, tick.px, frame.top + frame.height + 4);
                    written = tick.px + half;
                }
                // Its name fitted to the room across the plot (R4: never drawn outside the canvas).
                drawName(ctx, lane.axisNames.x, frame.left + frame.width / 2, frame.top + frame.height + 16, Math.min(frame.width, size.width - 4), 1);
            }
            ctx.save();
            ctx.translate(12, frame.top + frame.height / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            // Up the lane, fitted to its height (two lines where it is short).
            drawName(ctx, lane.axisNames.y, 0, -5, frame.height, 2);
            ctx.restore();
            // Whose distribution a bins lane is: its group's name and its n (the picture's count), above its frame
            // (in the room between two lanes, so it covers no bar).
            if (lane.bins && lane.tag) {
                ctx.save();
                ctx.font = '11px sans-serif';
                ctx.fillStyle = '#c8ccd2';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(lane.tag, frame.left + 2, frame.top - 1, frame.width - 4);
                ctx.restore();
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(frame.left, frame.top, frame.width, frame.height);
            ctx.clip();
            // A faint line at every value tick of a lane of lines, under the lines: a value is read off the axis across the plot.
            if (!lane.bins && !lane.image) {
                ctx.fillStyle = GRID_COLOUR;
                for (const tick of lane.yTicks) ctx.fillRect(frame.left, Math.round(tick.px), frame.width, 1);
            }
            if (lane.bins) paintBins(ctx, lane.bins, frame, markColour);
            // Each line, after the points kept under it (lineUnder) in the stretches it leaves.
            const painted = lane.lines.map(line => {
                const own = viewed?.lane.lines.find(item => item.id === line.id);
                const under = viewed && own ? lineUnderOf(viewed, own) : null;
                const unders = (under?.spans ?? []).map(([left, right]) => ({
                    left, right,
                    // (A point more than a plot's width off either side joins nothing in sight.)
                    points: viewed && under ? under.xs.map((x, at): [number, number] | null => {
                        const value = under.values[at], px = xPx(viewed, x);
                        return value === null || value === undefined || px < left - frame.width || px > right + frame.width ? null : [px, viewed.y.yOf(value)];
                    }) : [],
                }));
                // (Thinned as its picture drew it, at the picture's own range across: so still while that picture is shown
                // stretched on a range zoomed into, waiting for the range's own; stroked stretched, six took 650 ms.)
                const thinned = !!own && isThinnedAsDrawn(own.xs, own.values, viewed?.lane.range?.x ?? null, frame.width);
                return { line, unders, thinned, undersThinned: !!under && isThinnedAsDrawn(under.xs, under.values, under.across, frame.width) };
            });
            // A time signal thinned to several points a pixel: its pixels are worked out and put as one image
            // (denseLine.ts). Stroked, three took 130 ms and more a painting, over 600 ms zoomed to a second or so.
            const dense = viewed?.lane.kind === 'band' && painted.every(({ line, unders, thinned, undersThinned }) => !line.bars && pixelOf(line.colour) !== null
                && (thinned || isDense(line.points) || !line.points.some(Boolean)) && unders.every(part => undersThinned || isDense(part.points) || !part.points.some(Boolean)));
            const paintedDense = dense && paintDenseLines(ctx, denseScratch(), painted.flatMap(({ line, unders }): DenseLine[] => [
                ...unders.map(part => ({ points: part.points, colour: line.colour, width: line.width, from: part.left, to: part.right })),
                { points: line.points, colour: line.colour, width: line.width, from: frame.left, to: frame.left + frame.width },
            ]), frame, ratio);
            if (!paintedDense) for (const { line, unders } of painted) {
                ctx.strokeStyle = line.colour;
                ctx.lineWidth = line.width;
                for (const part of unders) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(part.left, frame.top, part.right - part.left, frame.height);
                    ctx.clip();
                    ctx.beginPath();
                    let joined = false;
                    for (const point of part.points) {
                        if (!point) { joined = false; continue; }
                        if (joined) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
                        joined = true;
                    }
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.beginPath();
                let open = false;
                if (line.bars) {
                    // Bands: a step a band, from its left edge to its right one, joined to the next band's (bars overlaid
                    // are drawn as their tops, so every recording's stay readable under the others').
                    for (const bar of line.bars) {
                        if (!bar) { open = false; continue; }
                        if (open) ctx.lineTo(bar[0], bar[2]); else ctx.moveTo(bar[0], bar[2]);
                        ctx.lineTo(bar[1], bar[2]);
                        open = true;
                    }
                } else for (const point of line.points) {
                    if (!point) { open = false; continue; }
                    if (open) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
                    open = true;
                }
                ctx.stroke();
            }
            // The lines down at every tick of the axis across, over the lines (as the old plots drew them): a dense
            // signal fills its lane (a waveform), and lines under it were hidden, so no time could be read down it.
            if (!lane.bins && !lane.image) {
                ctx.fillStyle = ACROSS_GRID_COLOUR;
                for (const tick of lane.xTicks) ctx.fillRect(Math.round(tick.px), frame.top, 1, frame.height);
                for (const px of gridOf(frame)) ctx.fillRect(px, frame.top, 1, frame.height);
            }
            // Whose lane of lines it is, where the screen names it (a recording's own lane), as an image lane's.
            const owner = !lane.bins && !lane.image ? options.laneTitle?.(lane.id) : undefined;
            if (owner) paintLaneTitle(ctx, frame, owner, lane.lines[0]?.colour ?? OTHER_COLOUR);
            // Where a trigger's events used were cut: shaded, under the guide lines.
            ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
            for (const span of lane.spans ?? []) if (span.right > span.left) ctx.fillRect(span.left, frame.top, span.right - span.left, frame.height);
            // 目安の線 (guide lines): at their place, dashed and muted, under nothing read. One of an event left out is fainter.
            ctx.save();
            ctx.lineWidth = 1;
            for (const guide of lane.guides) {
                ctx.setLineDash(guide.axis === 'x' ? [] : [4, 3]);
                ctx.strokeStyle = guide.axis === 'x' ? (guide.out ? 'rgba(136, 136, 136, 0.25)' : 'rgba(136, 136, 136, 0.6)') : '#bbb';
                ctx.beginPath();
                if (guide.axis === 'x') { ctx.moveTo(guide.px, frame.top); ctx.lineTo(guide.px, frame.top + frame.height); } else { ctx.moveTo(frame.left, guide.px); ctx.lineTo(frame.left + frame.width, guide.px); }
                ctx.stroke();
                const named = options.guideLabel?.(lane.id, guide);
                if (named && guide.axis === 'y') {
                    // (On a dark ground of its own: it is written over the signal.)
                    ctx.font = '11px sans-serif';
                    const wide = Math.min(frame.width - 8, ctx.measureText(named).width + 8);
                    ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    ctx.fillRect(frame.left + frame.width - 4 - wide, guide.px - 17, wide, 15);
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(named, frame.left + frame.width - 8, guide.px - 3, wide - 8);
                }
            }
            ctx.restore();
            // Whose signal a trigger's lane is (a lane a recording): its recording's name in the corner, with its colour.
            const whose = lane.spans ? options.laneLabel?.(lane.id) : undefined;
            if (whose) {
                const own = viewed?.lane.lines[0];
                const chip = (own && options.lineStyle?.({ id: own.id, ...(own.role !== undefined ? { role: own.role } : {}), ...(own.key !== undefined ? { key: own.key } : {}) })?.colour) ?? OTHER_COLOUR;
                ctx.save();
                ctx.font = '11px sans-serif';
                const wide = Math.min(frame.width - 12, ctx.measureText(whose).width + 16);
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(frame.left + 4, frame.top + frame.height - 20, wide, 16);
                ctx.fillStyle = chip;
                ctx.fillRect(frame.left + 4, frame.top + frame.height - 20, 3, 16);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(whose, frame.left + 12, frame.top + frame.height - 12, wide - 12);
                ctx.restore();
            }
            ctx.restore();
        });
        if (!keptLayer) keepLayer(readKey);
        if (seen.mark) {
            // The cross through the point read (R7): down the lane at its x, across it at its value in the colour of the
            // line read, so where the point is on both axes is seen at once. The dot alone left both to be guessed.
            const cross = seen.mark.cross, px = seen.mark.px, py = seen.mark.py;
            if (cross && px >= cross.left && px <= cross.right) {
                const readLine = seen.lanes.find(lane => lane.id === seen.mark?.lane)?.lines.find(line => line.id === seen.mark?.line);
                ctx.save();
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                ctx.beginPath();
                ctx.moveTo(px, cross.top);
                ctx.lineTo(px, cross.bottom);
                ctx.stroke();
                ctx.strokeStyle = readLine?.colour ?? 'rgba(255,255,255,0.7)';
                ctx.beginPath();
                ctx.moveTo(cross.left, py);
                ctx.lineTo(cross.right, py);
                ctx.stroke();
                ctx.restore();
            }
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.beginPath();
            ctx.arc(seen.mark.px, seen.mark.py, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        for (const lane of views) {
            const px = followedPx(lane);
            if (px === null) continue;
            ctx.save();
            ctx.strokeStyle = '#c8ccd2';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(px, lane.frame.top);
            ctx.lineTo(px, lane.frame.top + lane.frame.height);
            ctx.stroke();
            ctx.restore();
        }
        if (box) {
            ctx.strokeStyle = '#4a90d9';
            ctx.strokeRect(Math.min(box.from.x, box.to.x), Math.min(box.from.y, box.to.y), Math.abs(box.to.x - box.from.x), Math.abs(box.to.y - box.from.y));
        }
    };

    // ── Generations ───────────────────────────────────────────────────────────────────────────────────────────────

    /** Advance the generation and ask for a picture; `map`: the range or the size alone changed. */
    const redraw = (map: boolean, retry = false): void => {
        if (!spec || disposed) return;
        generation += 1;
        if (!retry) requests.resetRetries();
        const keep = map || !!options.keepWhileWaiting;
        if (!map) movedFrom = generation;
        mapped = keep && !!last;
        if (!keep) last = null;
        waiting = true;
        failure = null;
        // A point the keys selected is kept to be read again by its name (shown only once valid on the new picture);
        // the keys' read on its way is of the picture before: its points are taken again from the point read again.
        if (selected?.by !== 'keys') selected = null;
        if (keyRead) { pendingSteps += keyRead.steps; pendingRows += keyRead.rows; keyRead = null; }
        said = null;
        under = null;
        shownNumber = 0;
        // A hover read asked of the picture before is not used on the one to come, even where that is the same
        // picture again (a zoom and back: the same picture id).
        hoverFloor = Math.max(hoverFloor, lastRead?.number ?? 0);
        lastRead = null;
        const asked = generation;
        const width = plotWidth();
        const height = Math.max(1, size.height - margin.top - margin.bottom);
        // An image's drawn rows depend on its own lane's height: each lane's is said where the spec has an image lane.
        const heights = spec.lanes.some(lane => lane.kind === 'image') ? { laneHeights: [...frames(spec)].map(([lane, frame]) => ({ lane, height: frame.height })) } : {};
        requests.draw({ generation: asked, spec, view, ...selectionSent(), width, height, ...heights, ...(options.ahead ? { ahead: options.ahead } : {}) }, reply => drawn(reply, asked), map);
        paint();
    };
    const drawn = (reply: FigureDrawResult | null, asked: number): void => {
        if (disposed) return;
        if (asked !== generation) {
            // A picture of the same spec asked for a moment ago, while the range or the size went on changing: shown
            // on the newest view until the newest comes (never one older than the one shown, never read).
            const meanwhile = waiting && asked >= movedFrom && asked > shownFrom && reply?.status === 'picture' && reply.generation === asked ? pictureOf(reply) : null;
            if (meanwhile) { last = meanwhile; keepUnder(meanwhile); shownFrom = asked; mapped = true; paint(); }
            return;
        }
        if (reply && reply.generation !== generation) return;
        if (reply?.status === 'superseded') return;
        const picture = reply ? pictureOf(reply) : null;
        if (!picture) { failure = reply?.status === 'too-large' || reply?.status === 'busy' ? reply.status : 'failed'; waiting = false; mapped = false; last = null; paint(); tellPicture(); return; }
        last = picture;
        keepUnder(picture);
        shownFrom = generation;
        drawnGeneration = generation;
        waiting = false;
        mapped = false;
        paint();
        tellPicture();
        // The pointer still where it was: what it can do there is said again on what is now drawn.
        if (pointer) hintAt(pointer);
        refreshField();
        if (selected?.by === 'keys') readAgain(selected);
        else if (pointer) readAt(pointer.x, pointer.y);
    };
    const tellPicture = (): void => { for (const listener of [...listeners.picture]) listener(current()?.members ?? null); };

    // ── Gestures ──────────────────────────────────────────────────────────────────────────────────────────────────

    const placeOf = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const doPick = (read: FigurePick): (() => void) | void => {
        const undos = [...listeners.pick].map(listener => listener(read)).filter((undo): undo is () => void => typeof undo === 'function');
        return undos.length ? () => { for (const undo of undos) undo(); } : undefined;
    };
    /**
     * The whole axis across or up `lane` (its picture's answers' whole axes, the service's: never kept from an earlier
     * picture, whose answers may be others), for fractions (the range popover, the zoom steps, the box zoom).
     */
    const wholeOf = (lane: LaneView | undefined, axis: 'x' | 'y' | 'colour'): [number, number] | null => {
        const ends = lane ? lane.lane.whole?.[axis] ?? lane.lane.range?.[axis] : null;
        return ends ? [ends[0], ends[1]] : null;
    };
    const wholeScale = (lane: LaneView, axis: 'x' | 'y' | 'colour'): AxisScale => {
        const ends = wholeOf(lane, axis) ?? (axis === 'x' ? lane.range.x : lane.range.y);
        return axisScale(ends[0], ends[1], axis === 'x' ? lane.x.log : axis === 'y' && lane.up.log);
    };
    /** The specified ends of the part `part` of a whole axis, by today's rule (fieldWindow, R9); null at a whole end. */
    const endsOf = (whole: AxisScale, part: AxisPart): [number | null, number | null] => specifiedEnds(whole, part);
    /** A stretch across picked: told to the screen, which may say how to take it back. */
    const tellRange = (range: FigureRange): (() => void) | void => {
        const undos = [...listeners.range].map(listener => listener(range)).filter((undo): undo is () => void => typeof undo === 'function');
        return undos.length ? () => { for (const undo of undos) undo(); } : undefined;
    };
    const doHit = (hit: Hit): (() => void) | void => ('range' in hit ? tellRange(hit.range) : doPick(hit.pick));
    const setView = (next: FigureView, typed?: FigureTypedAxis): void => { for (const listener of [...listeners.view]) listener(next, typed); };
    const resetView = (): void => setView({ x: [null, null], lanes: [] });
    /**
     * A lane's specified ends up (`y`) or of its colour axis written into the view. The image lanes of one figure are
     * looked at together (the base's and the compared recordings' images over the same rows, in the same colours): ends
     * specified on one are specified on all of them.
     */
    const withEnds = (laneId: string, axis: 'y' | 'colour', ends: [number | null, number | null]): FigureView['lanes'] => {
        const images = spec?.lanes.filter(lane => lane.kind === 'image').map(lane => lane.id) ?? [];
        const ids = images.includes(laneId) ? images : [laneId];
        const none: (number | null)[] = [null, null];
        const made = ids.map(id => {
            const old = view.lanes?.find(lane => lane.lane === id);
            const y = axis === 'y' ? ends : old?.y ?? none, colour = axis === 'colour' ? ends : old?.colour ?? none;
            return { lane: id, y, ...(colour.some(end => end !== null) ? { colour } : {}) };
        }).filter(lane => lane.y.some(end => end !== null) || lane.colour);
        return [...(view.lanes ?? []).filter(lane => !ids.includes(lane.lane)), ...made];
    };
    const withY = (laneId: string, y: [number | null, number | null]): FigureView['lanes'] => withEnds(laneId, 'y', y);

    /** What a click acts on: the read at the press (its reply, now or once it comes), or the point the arrow keys marked. */
    const tap = (read: PressRead | null, stands: () => boolean): PressClick | void => {
        if (held() || !read) return undefined;
        if (read.state === 'in') {
            const got = read.read;
            return got && stands() && read.generation === generation && !disposed ? () => doHit(got) : undefined;
        }
        const click = waitingClick<Hit>(stands, ground, got => doHit(got));
        if (read.got !== undefined) click.arrived(read.got);
        else read.arrive = got => click.arrived(held() ? null : got);
        return () => () => click.takeBack();
    };
    /**
     * A click where the screen takes its place across (FigureSignals.place): the place of the point read at the press
     * (R7, R13: a click acts on what the readout reads; a read on its way is waited for), and where nothing is read
     * (off the recording, a lane with no readout) the place under the pointer.
     */
    const placeTap = (done: { x: number; lane: LaneView; read: PressRead }, stands: () => boolean): PressClick | void => {
        const lane = done.lane;
        const under = lane.x.at(Math.max(0, Math.min(1, (done.x - lane.frame.left) / lane.frame.width)));
        const tell = (got: Hit | null): (() => void) | void => {
            const at = { lane: lane.id, x: got && 'pick' in got && got.pick.lane === lane.id ? got.pick.point.x : under };
            const undos = [...listeners.place].map(listener => listener(at)).filter((undo): undo is () => void => typeof undo === 'function');
            return undos.length ? () => { for (const undo of undos) undo(); } : undefined;
        };
        const read = done.read;
        if (held() || read.state === 'in') {
            if (!stands() || disposed) return undefined;
            const got = read.state === 'in' && read.generation === generation ? read.read : null;
            return () => tell(got);
        }
        const click = waitingClick<{ got: Hit | null }>(stands, ground, arrived => tell(arrived.got));
        if (read.got !== undefined) click.arrived({ got: read.got });
        else read.arrive = got => click.arrived({ got: held() ? null : got });
        return () => () => click.takeBack();
    };
    /** The read a press acts on, taken at the press (R7, R13): the readout's if it was read here, else this place's read. */
    const pressRead = (at: { x: number; y: number }): PressRead => {
        if (held() || !current()) return { state: 'in', read: null, generation };
        if (selected?.by === 'keys' && valid(selected)) return { state: 'in', read: hitOf(selected), generation };
        const asked = readAt(at.x, at.y);
        if (!asked?.ticket) return { state: 'in', read: null, generation };
        if (shownNumber === asked.number) return { state: 'in', read: hitOf(selected) ?? underNow(), generation };
        const waitingRead: PressRead = { state: 'waiting', arrive: null };
        asked.ticket.claimForClick(reply => {
            const bin = binOf(reply);
            const got = hitOf(selectionOf(reply, asked.number, 'pointer')) ?? (bin ? { range: bin.range } : null);
            if (waitingRead.state !== 'waiting') return;
            if (waitingRead.arrive) waitingRead.arrive(got); else waitingRead.got = got;
        });
        return waitingRead;
    };

    /** Where the pointer was last, on the page: a scroll moves another place, or another plot, under it. */
    let lastClient: { clientX: number; clientY: number } | null = null;
    const onMove = (event: MouseEvent): void => {
        if (disposed) return;
        lastClient = { clientX: event.clientX, clientY: event.clientY };
        if (press) {
            if (event.buttons === 0) { abandon(); return; }
            const at = placeOf(event);
            if (!press.isDrag && exceedsDragThreshold(event.clientX - press.clientX, event.clientY - press.clientY)) { press.isDrag = true; presses.dragging = true; }
            // Shift+drag where the screen takes one: told how far, and no box is drawn (nothing is zoomed).
            if (press.isDrag && press.shift) { press.to = at; tellShift(press, false); return; }
            // Alt+drag where the screen shows the stretch itself (ranging): told the stretch, and no box is drawn.
            if (press.isDrag && showsRanging(press)) {
                press.to = at;
                pointer = at;
                const lane = press.lane;
                const to = lane.x.at(Math.max(0, Math.min(1, (at.x - lane.frame.left) / lane.frame.width)));
                // The readout reads the pointer's place first (R7), then the screen shows the stretch.
                tellAcross({ x: to });
                for (const listener of listeners.ranging) listener({ lane: lane.id, from: lane.x.at(Math.max(0, Math.min(1, (press.x - lane.frame.left) / lane.frame.width))), to });
                return;
            }
            if (press.isDrag) {
                press.to = at;
                // The pointer is where the drag is now: what is read once it ends is read there, not where it began.
                pointer = at;
                box = { lane: press.lane.id, from: { x: press.x, y: press.y }, to: at };
                paint();
                // Nothing is read while dragging (R7); the screen is told the place across under the pointer, the box's edge.
                const lane = press.lane;
                tellAcross({ x: lane.x.at(Math.max(0, Math.min(1, (at.x - lane.frame.left) / lane.frame.width))) });
            }
            return;
        }
        if (event.target !== canvas) { if (pointer) hintAt(null); return; }
        // A drag under way on another plot reads nothing (R7).
        if (presses.dragging) return;
        pointer = placeOf(event);
        presses.over = token;
        hintAt(pointer);
        const under = laneOrAxisAt(pointer.x, pointer.y);
        // The pointer takes the readout back: the keys' read on its way and the keys pressed are of no use now.
        keyRead = null;
        pendingSteps = 0; pendingRows = 0;
        if (selected?.by === 'keys') selected = { ...selected, by: 'pointer' };
        if (!under || under.axis) forget();
        readAt(pointer.x, pointer.y);
        // Onto an axis, or off one: no new read comes of it, and what a click acts on is another.
        tellRead(markNow());
        tellAcross(acrossOf(markNow()));
    };
    const acrossOf = (mark: ReturnType<typeof markNow>): { x: number } | null => (mark ? { x: mark.point.x } : null);
    /** Off the plots, where the screen asks it (leaveForgets): the pointer's read is let go. */
    const forget = (): void => { if (options.leaveForgets && selected?.by === 'pointer') { selected = null; lastRead = null; paint(); } };
    const onLeave = (): void => { pointer = null; if (presses.over === token) presses.over = null; hintAt(null); forget(); const mark = markNow(); tellRead(mark); tellAcross(acrossOf(mark)); };
    /**
     * A scroll under a still pointer (R7): the plot now under it reads there as a pointer moved onto it would, and the
     * plot it left reads no more. No pointer event comes of a scroll, so each Figure looks where the pointer was last.
     */
    const onScroll = (): void => {
        if (disposed || press || presses.dragging || !lastClient) return;
        const under = doc.elementFromPoint(lastClient.clientX, lastClient.clientY) === canvas;
        if (under) onMove({ clientX: lastClient.clientX, clientY: lastClient.clientY, target: canvas, buttons: 0 } as unknown as MouseEvent);
        else if (pointer) onLeave();
    };
    /** An Alt+drag the screen shows as it goes (FigureSignals.ranging), not as a box. */
    const showsRanging = (drag: { alt: boolean }): boolean => drag.alt && listeners.range.size > 0 && listeners.ranging.size > 0;
    /** An Alt+drag shown as it went ended picking nothing: the screen puts back what it showed. */
    const rangingDropped = (drag: { isDrag: boolean; alt: boolean } | null): void => {
        if (drag?.isDrag && showsRanging(drag)) for (const listener of listeners.ranging) listener(null);
    };
    /** How far a Shift+drag is from its press, in the lane's values across (its axis is linear: a time axis). */
    const tellShift = (drag: { x: number; to: { x: number }; lane: LaneView }, done: boolean, abandoned = false): void => {
        const lane = drag.lane;
        const by = abandoned ? null : lane.x.at((drag.to.x - lane.frame.left) / lane.frame.width) - lane.x.at((drag.x - lane.frame.left) / lane.frame.width);
        for (const listener of listeners.shift) listener({ lane: lane.id, by, done });
    };
    const onDown = (event: MouseEvent): void => {
        if (event.button !== 0 || disposed) return;
        const at = placeOf(event);
        const lane = laneAt(laneViews(), at.x, at.y);
        if (!lane) return;
        pointer = at;
        if (options.pressFocuses && doc.activeElement !== canvas) canvas.focus({ preventScroll: true });
        const read = pressRead(at);
        pressBegan(presses);
        press = { ...at, clientX: event.clientX, clientY: event.clientY, lane, isDrag: false, to: at, alt: event.altKey, shift: event.shiftKey && listeners.shift.size > 0, read };
        event.preventDefault();
    };
    const abandon = (): void => {
        const done = press;
        press = null;
        box = null;
        presses.dragging = false;
        if (done?.isDrag && done.shift) tellShift(done, true, true);
        rangingDropped(done);
        // Its release lost: nothing is done; a click waiting is no longer current.
        if (done && !done.isDrag) tap(done.read, () => false);
        paint();
    };
    /** The release will not come (the window lost focus or was hidden, the pointer was cancelled): the press is let go (R7). */
    const onLost = (): void => { if (press) abandon(); };
    const onHidden = (): void => { if (doc.hidden) onLost(); };
    const onUp = (event: MouseEvent): void => {
        const done = press;
        if (!done) return;
        press = null;
        presses.dragging = false;
        if (!done.isDrag) {
            clickReleased(presses, token, event.detail, current => (listeners.place.size ? placeTap(done, current) : tap(done.read, current)), resetView);
            // Let go a few pixels from the press (within the drag threshold): what is read from now is read where it was let go.
            const at = placeOf(event);
            if (event.target === canvas && (at.x !== done.x || at.y !== done.y)) { pointer = at; readAt(at.x, at.y); }
            return;
        }
        box = null;
        if (done.shift) { tellShift(done, true); return; }
        const lane = done.lane, to = done.to;
        const fx = (x: number): number => Math.max(0, Math.min(1, (x - lane.frame.left) / lane.frame.width));
        const fy = (y: number): number => Math.max(0, Math.min(1, 1 - (y - lane.frame.top) / lane.frame.height));
        const [x0, x1] = [Math.min(fx(done.x), fx(to.x)), Math.max(fx(done.x), fx(to.x))];
        const [y0, y1] = [Math.min(fy(done.y), fy(to.y)), Math.max(fy(done.y), fy(to.y))];
        if (x1 - x0 <= 0.005) { rangingDropped(done); paint(); return; }
        const across = [lane.x.at(x0), lane.x.at(x1)] as const;
        // Alt+drag picks a stretch across where the screen takes one (range); elsewhere it is a drag as any (a box zoom).
        if (done.alt && listeners.range.size) { tellRange({ ...rangeOf(lane.id, across[0], across[1]), from: across[fx(done.x) <= fx(to.x) ? 0 : 1] }); paint(); return; }
        const wx = wholeScale(lane, 'x'), wy = wholeScale(lane, 'y');
        const shownY = lane.up;
        const x = endsOf(wx, { start: Math.max(0, wx.fraction(across[0])), end: Math.min(1, wx.fraction(across[1])) });
        const next: FigureView = { x, lanes: view.lanes ?? [] };
        // (A distribution's count axis always shows every count: a box zooms its value axis only.)
        if (y1 - y0 > 0.005 && !lane.lane.bins) {
            const up = [shownY.at(y0), shownY.at(y1)];
            next.lanes = withY(lane.id, endsOf(wy, { start: Math.max(0, wy.fraction(up[0])), end: Math.min(1, wy.fraction(up[1])) }));
        }
        setView(next);
    };
    const onSecondPress = (event: MouseEvent): void => {
        if (event.detail > 1) secondPress(presses, plot => plot === token && event.target === canvas);
    };
    const onDouble = (event: MouseEvent): void => {
        const at = placeOf(event);
        const lanes = laneViews();
        // On an axis: its range popover (the axis under the last lane across, the axis left of a lane up).
        const bottom = lanes[lanes.length - 1];
        const up = lanes.find(lane => at.x < lane.frame.left && at.y >= lane.frame.top && at.y <= lane.frame.top + lane.frame.height);
        if (bottom && at.y > bottom.frame.top + bottom.frame.height && at.x >= bottom.frame.left) { openRange(bottom, 'x', event); return; }
        // (No range is typed for a distribution's count axis: it always shows every count.)
        if (up && !up.lane.bins) { openRange(up, 'y', event); return; }
        if (up) return;
        // On an image lane's colour bar (right of its plot): the colour axis's range.
        const bar = lanes.find(lane => !!lane.lane.image && at.x > lane.frame.left + lane.frame.width && at.y >= lane.frame.top && at.y <= lane.frame.top + lane.frame.height);
        if (bar) { openRange(bar, 'colour', event); return; }
        resetView();
    };
    /** The range popover of an axis: its fields write the confirmed ends exactly; typed ends are made by today's rule (R9). */
    /** The range field open now: its lane and axis, where it was opened, and the ends its fields were filled with. */
    let openField: { lane: string; axis: 'x' | 'y' | 'colour'; at: { clientX: number; clientY: number }; shown: { min: string; max: string } } | null = null;
    const fieldElement = (suffix: string): HTMLInputElement | null => doc.getElementById(`${requests.figureId}-range-${suffix}`) as HTMLInputElement | null;
    const fieldOpen = (): boolean => (doc.getElementById(`${requests.figureId}-range-popover`)?.style.display ?? 'none') !== 'none';
    const openRange = (lane: LaneView, axis: 'x' | 'y' | 'colour', event: { clientX: number; clientY: number }): void => {
        const whole = wholeScale(lane, axis);
        const ends = axis === 'x' ? lane.range.x : axis === 'y' ? lane.range.y : lane.lane.range?.colour ?? lane.range.y;
        const specified = axis === 'x' ? view.x ?? [null, null] : axis === 'y' ? specifiedY(lane.id) : view.lanes?.find(item => item.lane === lane.id)?.colour ?? [null, null];
        const current = { start: specified[0] === null ? 0 : whole.fraction(ends[0]), end: specified[1] === null ? 1 : whole.fraction(ends[1]) };
        // The whole axis of the picture drawn when the value is applied: never the one captured at open.
        const wholeNow = (): AxisScale => { const now = laneViews().find(item => item.id === lane.id); return now ? wholeScale(now, axis) : whole; };
        openAxisPart(popover, {
            mapping: { at: fraction => wholeNow().at(fraction), of: value => wholeNow().fraction(value), label: axis === 'colour' ? levelName(lane.lane) : axisNames(lane.lane)[axis] },
            horizontal: axis === 'x', current, clientX: event.clientX, clientY: event.clientY, shown: { min: ends[0], max: ends[1] }, invalid: words.range.invalid,
            // Up a waveform or a lane of lines any values may be typed: wider than the automatic range too (to full
            // scale, a level range fixed for every comparison). Frequency up an image, and counts, end where they do.
            past: axis === 'y' && ['band', 'lines', undefined].includes(spec?.lanes.find(item => item.id === lane.id)?.kind),
            set: part => {
                openField = null;
                const made = endsOf(wholeNow(), part);
                setView(axis === 'x' ? { x: made, lanes: view.lanes ?? [] } : { x: view.x ?? [null, null], lanes: withEnds(lane.id, axis, made) }, { lane: lane.id, axis });
            },
        });
        openField = { lane: lane.id, axis, at: { clientX: event.clientX, clientY: event.clientY }, shown: { min: fieldElement('min')?.value ?? '', max: fieldElement('max')?.value ?? '' } };
    };
    /** A new picture drawn while a range field is open: its fields show the new picture's ends, unless something was typed. */
    const refreshField = (): void => {
        if (!openField || !fieldOpen()) { openField = null; return; }
        const lane = laneViews().find(item => item.id === openField?.lane);
        const untouched = fieldElement('min')?.value === openField.shown.min && fieldElement('max')?.value === openField.shown.max;
        if (lane && untouched) openRange(lane, openField.axis, openField.at);
    };
    /** The part of the whole axis across shown on `lane` (fractions, for the zoom and pan steps). */
    const shownPart = (lane: LaneView): NormalizedRange => {
        const whole = wholeScale(lane, 'x');
        return { start: Math.max(0, Math.min(1, whole.fraction(lane.range.x[0]))), end: Math.max(0, Math.min(1, whole.fraction(lane.range.x[1]))) };
    };
    /** The axis across set to the part `part` of the whole (zoomRangeAroundPivot or a pan), by today's rule (R9). */
    const setAcross = (lane: LaneView, part: NormalizedRange): void => setView({ x: endsOf(wholeScale(lane, 'x'), part), lanes: view.lanes ?? [] });
    /** Zoom across by `factor` about `pivot` (a fraction of what is shown; its middle by default): + / −, Ctrl+wheel. */
    const zoomAcross = (lane: LaneView, factor: number, pivot = 0.5): void => {
        const part = shownPart(lane);
        setAcross(lane, zoomRangeAroundPivot(part, part.start + pivot * (part.end - part.start), factor));
    };
    /** Zoom keys and the screen's zoom: the axis across about its middle, or every axis back to its whole (R13). */
    const zoomBy = (action: 'in' | 'out' | 'reset'): boolean => {
        // A drag under way owns the view: no key changes it until it ends.
        if (presses.dragging || disposed) return true;
        if (action === 'reset') { resetView(); return true; }
        const lane = laneViews().at(-1);
        if (!lane) return false;
        zoomAcross(lane, action === 'in' ? ZOOM_IN_FACTOR : 1 / ZOOM_IN_FACTOR);
        return true;
    };
    /** The lane under (x, y), or under the axis there (the axis across under the last lane, a lane's own axis up). */
    let onBar = false;
    /** What the pointer is over, for the page's hint; over a colour bar the pointer shows it can be pressed. */
    const hintAt = (at: { x: number; y: number } | null): void => {
        const under = at ? laneOrAxisAt(at.x, at.y) : null;
        const bar = !!at && !under && laneViews().some(lane => !!lane.lane.image && at.x > lane.frame.left + lane.frame.width && at.y >= lane.frame.top && at.y <= lane.frame.top + lane.frame.height);
        // Only the bar's own pointer is put on and taken off here: any other cursor on the canvas is its screen's.
        if (bar !== onBar) { onBar = bar; canvas.style.cursor = bar ? 'pointer' : ''; }
        options.hint?.(bar ? 'colour' : under ? (under.axis ? 'axis' : 'plot') : null);
    };
    const laneOrAxisAt = (x: number, y: number): { lane: LaneView; axis: boolean } | null => {
        const lanes = laneViews();
        const on = laneAt(lanes, x, y);
        if (on) return { lane: on, axis: false };
        const bottom = lanes.at(-1);
        if (bottom && y > bottom.frame.top + bottom.frame.height && x >= bottom.frame.left) return { lane: bottom, axis: true };
        const up = lanes.find(lane => x < lane.frame.left && y >= lane.frame.top && y <= lane.frame.top + lane.frame.height);
        return up ? { lane: up, axis: true } : null;
    };
    let swipe: { sideways: boolean; at: number } | null = null;
    /** Ctrl+wheel zooms across about the pointer (over an axis, about its middle); Shift+wheel and a sideways swipe pan (R13). */
    const onWheel = (event: WheelEvent): void => {
        // While a picture is on its way, the one drawn on the new view takes the wheel as it would (第 6 節 2).
        if (disposed || !laneViews().length) return;
        const at = placeOf(event);
        const hit = laneOrAxisAt(at.x, at.y);
        if (event.ctrlKey || event.shiftKey) {
            swipe = null;
            event.preventDefault();
            if (!hit || presses.dragging) return;
            if (event.ctrlKey) zoomAcross(hit.lane, wheelZoomFactor(event.deltaY), hit.axis ? 0.5 : Math.max(0, Math.min(1, (at.x - hit.lane.frame.left) / hit.lane.frame.width)));
            else setAcross(hit.lane, panNormalizedRangeBy(shownPart(hit.lane), wheelStepDirection(event) * PAN_STEP_RATIO));
            return;
        }
        const sideways = swipe && event.timeStamp - swipe.at < SWIPE_PAUSE_MS ? swipe.sideways : Math.abs(event.deltaX) > Math.abs(event.deltaY);
        swipe = { sideways, at: event.timeStamp };
        if (!sideways || !hit || hit.axis) return;
        // A sideways swipe on the plot pans it as far as the fingers went, rather than scrolling the page.
        event.preventDefault();
        if (presses.dragging) return;
        const width = hit.lane.frame.width;
        setAcross(hit.lane, panNormalizedRangeBy(shownPart(hit.lane), wheelPanPixels(event, width) / width));
    };
    const removeKeys = keyRouterFor(doc.defaultView ?? (doc)).add({
        layer: 'plot',
        keydown: event => {
            // The keys are the Figure's with the pointer on it, or with the keyboard's focus on its canvas (Tab: R7).
            // Focus is the fallback: with the pointer on another plot, the keys are that plot's.
            const focused = !pointer && doc.activeElement === canvas && (presses.over === null || presses.over === token);
            if ((!pointer && !focused) || disposed) return false;
            const zoom = zoomKeyAction(event.key);
            if (zoom) {
                if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return false;
                if (!zoomBy(zoom)) return false;
                if (zoom === 'reset') for (const listener of [...listeners.reset]) listener();
                event.preventDefault();
                return true;
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                // Typed into a field (the range popover's, any text input), or with a drag under way: not a step (as
                // the zoom keys).
                if (isTextEntryTarget(event.target) || presses.dragging) return false;
                // Shift+← → is the screen's where it takes it (the Tracks cursor's coarse step), never a step along the line.
                if (event.shiftKey) return false;
                // A row that takes the focus at a press (pressFocuses) keeps ← → for the screen while it has the focus: they
                // move the Tracks cursor (where to listen), not the readout (docs/display-rules.md R7's one exception).
                if (options.pressFocuses && doc.activeElement === canvas) return false;
                // Focused from the keyboard with no point read yet: the first key reads the point at the middle of the
                // first lane, as a pointer put there would; the keys after it step from that point.
                if (focused && !valid(selected)) {
                    const first = laneViews()[0];
                    return !!first && !!readAt(first.frame.left + first.frame.width / 2, first.frame.top + first.frame.height / 2);
                }
                return step(event.key === 'ArrowRight' ? 1 : -1);
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                if (isTextEntryTarget(event.target) || presses.dragging) return false;
                return stepUp(event.key === 'ArrowUp' ? 1 : -1);
            }
            if (event.key === 'Enter' && selected?.by === 'keys') { const read = hitOf(selected); if (read) doHit(read); return !!read; }
            return false;
        },
    });
    // What the Figure drew and reads now, on its canvas for the browser checks (as the old plots keep their places there).
    (canvas as HTMLCanvasElement & { __figureInspect?: () => FigureInspection }).__figureInspect = () => inspect();
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);
    doc.addEventListener('pointercancel', onLost, true);
    doc.addEventListener('visibilitychange', onHidden);
    doc.defaultView?.addEventListener('blur', onLost);
    doc.addEventListener('mousedown', onSecondPress, true);
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const stopHold = requests.onReadsHeld(nowHeld => {
        // Spec 4: a read on its way when the computations began, or answered while they run, is dropped by answers/
        // (its reply never comes): its place is not "asked already". Once they are over, the pointer's place is read
        // once, moved or not (第 6 節「読む要求の上限」).
        // The keys' read too (its reply never comes): its points are kept, sent once the computations are over.
        lastRead = null;
        if (keyRead) { pendingSteps += keyRead.steps; pendingRows += keyRead.rows; keyRead = null; }
        paint();
        if (nowHeld) return;
        if (selected?.by === 'keys') { if (valid(selected)) sendPending(); else if (current()) readAgain(selected); } else if (pointer) readAt(pointer.x, pointer.y);
    });

    return {
        figureId: requests.figureId,
        canvas,
        readout,
        show(nextSpec, nextView, nextSelection = null) {
            if (disposed) return;
            const nextViewNorm = viewOf(nextView);
            const selectionSame = sameJson(selection, nextSelection);
            selection = nextSelection;
            if (!spec) { spec = nextSpec; view = nextViewNorm; unusable = unusableKeys(nextSpec.keys); redraw(false); return; }
            const lanesSame = sameJson(spec.lanes, nextSpec.lanes);
            const keys = keysChange(spec.keys, nextSpec.keys);
            const viewSame = sameJson(view, nextViewNorm);
            spec = nextSpec;
            view = nextViewNorm;
            unusable = unusableKeys(nextSpec.keys);
            if (lanesSame && keys !== 'changed' && viewSame && selectionSame) { paint(); return; }
            redraw(lanesSame && keys !== 'changed');
        },
        zoom(action) { zoomBy(action); },
        follow(x) {
            if (x === followed || disposed) return;
            followed = x;
            // The pointer reads on the other figure now: this one's last read (kept since the pointer left it) gives
            // way to the mark, so the two figures never show two reads at once.
            if (x !== null && !pointer && selected) {
                selected = null; said = null; keyRead = null; pendingSteps = 0; pendingRows = 0;
                paint();
                const mark = markNow();
                tellRead(mark); tellAcross(acrossOf(mark));
                return;
            }
            paint();
        },
        exportTable() {
            const picture = current(), declared = spec;
            if (!picture || !declared || disposed) return Promise.resolve({ status: 'none' as const });
            // Taken now (class 4): the declaration, the range, the data id and the names; the reply is written with these only.
            const asked = picture.dataId, names = exportNames(picture), viewAsked = view;
            return new Promise<FigureTable>((resolve, reject) => {
                requests.export({ spec: declared, view: viewAsked, ...selectionSent(), dataId: asked }, reply => resolve(tableOf(reply, asked, names)), reason => reject(new FigureExportDropped(reason)));
            });
        },
        resize(width, height) {
            if (disposed || (width === size.width && height === size.height)) return;
            size = { width, height };
            redraw(true);
        },
        refresh() { redraw(true); },
        on(signal, listener) {
            const set = listeners[signal] as Set<typeof listener>;
            set.add(listener);
            return () => { set.delete(listener); };
        },
        inspect,
        dispose() {
            if (disposed) return;
            // An Alt+drag shown as it went ends with its Figure (the row scrolled away): the screen puts back what it showed.
            rangingDropped(press);
            disposed = true;
            press = null;
            imagePixels.clear();
            unders.clear();
            lineUnders.clear();
            selected = null;
            keyRead = null;
            forgetClick(presses, token);
            requests.dispose();
            stopHold();
            removeKeys();
            canvas.removeEventListener('mouseleave', onLeave);
            canvas.removeEventListener('mousedown', onDown);
            canvas.removeEventListener('dblclick', onDouble);
            canvas.removeEventListener('wheel', onWheel);
            doc.removeEventListener('mousemove', onMove);
            doc.removeEventListener('mouseup', onUp);
            doc.removeEventListener('pointercancel', onLost, true);
            doc.removeEventListener('visibilitychange', onHidden);
            doc.defaultView?.removeEventListener('blur', onLost);
            if (presses.over === token) presses.over = null;
            doc.removeEventListener('mousedown', onSecondPress, true);
            doc.removeEventListener('scroll', onScroll, true);
            popover.close();
            // Its document listener and key context go with it (rangePopover's dispose, #799).
            popover.dispose();
            doc.getElementById(`${requests.figureId}-range-popover`)?.remove();
            canvas.remove();
            // A readout element the page lent is left empty; one of the Figure's own goes with it.
            if (options.readout) { if (writeReadout('')) readout.style.color = ''; delete readout.dataset.figureReadout; } else readout.remove();
        },
    };
}

/**
 * The specified ends (指定範囲) of the part `part` of the whole axis `whole`, made by today's rule (fieldWindow, R9:
 * typed 123.456789 Hz is 123.457): an end at the whole axis's own end is not specified (null, layer 2 decides it).
 * Layer 2 takes the others exactly.
 */
export function specifiedEnds(whole: AxisScale, part: AxisPart): [number | null, number | null] {
    const shown = windowedScale(whole, part, fieldWindow);
    return [part.start === 0 ? null : shown.low, part.end === 1 ? null : shown.high];
}
