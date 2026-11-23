/**
 * A picture (絵) as the Figure draws it: the figure service's draw reply with its drawn points (描く用の点) turned into
 * places on the axes. The drawn points' type is the Figure's own and never leaves src/webview/figure/ (rule B,
 * figure-design.md 第 2 節; ESLint forbids importing this file from outside the folder). A drawn point is
 * drawn and nothing else: it is never written as text, never read, never counted, never used to set a range.
 */
import type { FigureAxis, FigureDrawn, FigureDrawResult, FigureHeadline, FigureMembers } from '../answers/protocol';

declare const drawnBrand: unique symbol;
/** A line's drawn points: places on its lane's axes, for drawing only. A gap is null. */
export interface DrawnLine {
    readonly id: string;
    readonly role?: string;
    readonly key?: string;
    readonly xs: readonly number[];
    readonly values: ReadonlyArray<number | null>;
    /** A line of bands (配置): the edges its bars are drawn between, one more than its points. Absent on any other line. */
    readonly edges?: readonly number[];
    readonly [drawnBrand]: 'drawn';
}

/**
 * An image lane's drawn cells (描く用のセル) and where they are (配置): column c is between columnEdges[c] and [c + 1]
 * across, row r between rowEdges[r] and [r + 1] up. Drawn and nothing else, as a line's drawn points.
 */
export interface DrawnImage {
    readonly line: string;
    readonly role?: string;
    readonly key: string;
    readonly columnEdges: readonly number[];
    readonly rowEdges: readonly number[];
    readonly cells: ReadonlyArray<ReadonlyArray<number | null>>;
    readonly [drawnBrand]: 'drawn';
}

/**
 * A bins lane's picture (one group of a distribution): its placement (配置: the bins' edges, each dot's level) and
 * its counts (計算ア), as the service made them. Not drawn points: nothing of it was thinned, so a readout may write a
 * bin's ends and its count from here. `counts` null: so few rows that each is drawn as a dot.
 */
export interface PictureBins {
    readonly column: string;
    /** The line ids a read names a bar (its point's index is the bin) and a row (its index is the member) by. */
    readonly bars: string;
    readonly rows: string;
    readonly edges: readonly number[];
    /** A bin's width: the step a readout takes its digits from. */
    readonly step: number;
    readonly counts: readonly number[] | null;
    /** Rows per bin the selected range takes; null with none selected. */
    readonly countsPicked: readonly number[] | null;
    /** (`at`: where up the count axis a row's dot is, in a group of few.) */
    readonly members: ReadonlyArray<{ readonly key: string; readonly value: number; readonly at?: number; readonly picked?: boolean }>;
    /** The group's rows with a number, and of them those a selected range takes (absent: none selected): the service's counts. */
    readonly n: number;
    readonly nPicked?: number;
    readonly blank: number;
    readonly marks: ReadonlyArray<{ readonly id: string; readonly role?: string; readonly key: string; readonly value: number }>;
}

/** A lane's confirmed ends: across, up and (an image lane's) its colour axis. */
export interface PictureRange {
    readonly x: readonly [number, number];
    readonly y: readonly [number, number];
    readonly colour?: readonly [number, number];
}

/** One lane of a picture: its axis words, its confirmed range (null while there is no answer) and its lines in order. */
export interface PictureLane {
    readonly id: string;
    /**
     * What the lane draws: a line each of its lines, one recording's image, or each recording's time signal (a band:
     * its lines are each signal's lowest and highest samples in time order, drawn as one line), or one group of a
     * distribution (bins: it has no lines; what it draws is in `bins`).
     */
    readonly kind: 'lines' | 'image' | 'band' | 'bins';
    readonly axis: FigureAxis;
    readonly range: PictureRange | null;
    /** The whole axes of this picture's answers (its confirmed range with nothing specified); its range without one. */
    readonly whole: PictureRange | null;
    /** An image lane's drawn cells; null on a lane of lines, or with nothing to draw. */
    readonly image: DrawnImage | null;
    /** A bins lane's placement and counts; null on every other lane, or with nothing to draw. */
    readonly bins: PictureBins | null;
    readonly lines: readonly DrawnLine[];
    /** 目安の線 (guide lines): at a place of one axis, drawn and never read (apart from the mark on the point read, 印). */
    readonly guides: ReadonlyArray<{ readonly axis: 'x' | 'y'; readonly at: number; readonly id?: string; readonly out?: boolean }>;
    /** A lane that shows a recording as a trigger takes it: the stretches its events used were cut over; null on any other. */
    readonly spans: ReadonlyArray<{ readonly start: number; readonly end: number }> | null;
    /** …and how many of the trigger's events are used, of how many (the service's count). */
    readonly events: { readonly used: number; readonly total: number; readonly missing?: 'pending' | 'stale' | 'failed' | 'evicted' | 'too-large' } | null;
}

/** A line's drawn points, made here only (the reply's, or the previous picture's mapped onto a new view). */
export const drawnLine = (line: Omit<DrawnLine, typeof drawnBrand>): DrawnLine => line as DrawnLine;
/** An image lane's drawn cells, made here only (the reply's). */
const drawnImage = (image: Omit<DrawnImage, typeof drawnBrand>): DrawnImage => image as DrawnImage;

/** The picture of one draw reply. */
export interface Picture {
    readonly pictureId: string;
    readonly dataId: string;
    readonly generation: number;
    readonly lanes: readonly PictureLane[];
    readonly headlines: readonly FigureHeadline[];
    readonly members: FigureMembers | null;
}

/** The one place a wire drawn point becomes a place on the canvas's axes. */
const place = (value: FigureDrawn | null): number | null => value as unknown as number | null;

type WireRange = { x: number[]; y: number[]; colour?: number[] } | undefined;
const rangeOf = (range: WireRange): PictureRange | null => {
    if (!range || range.x.length !== 2 || range.y.length !== 2) return null;
    return { x: [range.x[0], range.x[1]], y: [range.y[0], range.y[1]], ...(range.colour?.length === 2 ? { colour: [range.colour[0], range.colour[1]] as const } : {}) };
};

/** The picture a draw reply carries, or null for a reply with none (too large, superseded, failed). */
export function pictureOf(reply: FigureDrawResult): Picture | null {
    if (reply.status !== 'picture' || !reply.pictureId || !reply.lanes) return null;
    return {
        pictureId: reply.pictureId,
        dataId: reply.dataId ?? '',
        generation: reply.generation,
        headlines: reply.headlines ?? [],
        members: reply.members ?? null,
        lanes: reply.lanes.map(lane => ({
            id: lane.id,
            kind: lane.kind ?? 'lines',
            axis: lane.axis,
            range: rangeOf(lane.range),
            whole: rangeOf(lane.whole),
            image: lane.image ? drawnImage({
                line: lane.image.line, ...(lane.image.role !== undefined ? { role: lane.image.role } : {}), key: lane.image.key,
                columnEdges: lane.image.columnEdges, rowEdges: lane.image.rowEdges, cells: lane.image.cells.map(row => row.map(place)),
            }) : null,
            bins: lane.bins ? { ...lane.bins, counts: lane.bins.counts ?? null, countsPicked: lane.bins.countsPicked ?? null } : null,
            guides: (lane.guides ?? []).map(guide => ({ axis: guide.axis, at: guide.at, ...(guide.id !== undefined ? { id: guide.id } : {}), ...(guide.out ? { out: true } : {}) })),
            spans: lane.spans ?? null,
            events: lane.events ?? null,
            lines: lane.lines.map(line => drawnLine({ id: line.id, ...(line.role !== undefined ? { role: line.role } : {}), ...(line.key !== undefined ? { key: line.key } : {}), xs: line.xs, values: line.values.map(place), ...(line.edges ? { edges: line.edges } : {}) })),
        })),
    };
}
