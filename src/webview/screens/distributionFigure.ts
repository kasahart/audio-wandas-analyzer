/**
 * The entry screen's distribution of a table column: a bins lane of the Figure per group, in the
 * screen's own box. It decides nothing of what is drawn: the spec names the column, each group's rows and the rows
 * holding a role, and the figure service bins, counts and reads (python-backend/figures/). The screen's alone: where the
 * Figure is put, how high a lane is, and the names (a group's, a row's, the column's).
 */
import type { FigureAnswers } from '../answers/figureRequests';
import { createFigure, type Figure, type FigureColumn, type FigureInspection, type FigureSelection, type FigureSpec, type FigureView, type FigureWords } from '../figure/index';

/** A distribution as the entry screen has it: a number column of its table, its rows by group, the rows holding a role. */
export interface DistributionInput {
    /** The column's values (its key, its version, a value per table row). */
    column: FigureColumn;
    /** The column's name, as its axis writes it. */
    columnName: string;
    /** Each group, in the order they are shown: its name and its rows' keys. */
    groups: ReadonlyArray<{ name: string; rows: readonly string[] }>;
    /** A group's name as the screen writes it (its lane's corner, the readout). */
    groupLabel(name: string): string;
    /** The rows holding a role (a slot's recording). */
    roles: ReadonlyArray<{ row: string; role: string }>;
    rowName(row: string): string;
    /** The range of the value selected in the table (its filter), or none. */
    selection: { low: number; high: number; closed?: boolean } | null;
    /** What the axes are of (the column and the grouping): another one starts whole, its zoom forgotten. */
    axes: string;
}

export interface DistributionFigureDeps {
    document: Document;
    /** The element the Figure is put in (the screen's; shown while a distribution is, hidden otherwise). */
    host: HTMLElement;
    /** The screen's readout row for the distribution. */
    readout?: HTMLElement;
    answers: FigureAnswers;
    words: FigureWords;
    /** A bar or an empty place clicked, or an Alt+drag: the range of the value picked (`closed`: up to the top of the axis, which it takes). */
    pickRange(range: { low: number; high: number; closed?: boolean }): (() => void) | void;
    /** A row's dot, tick or role line clicked. */
    pickRow(row: string): (() => void) | void;
    /** A picture was drawn (or none could be): for the screen to put the lanes in view. */
    drawn?(): void;
}

export interface DistributionFigure {
    /** Shows `input` in a Figure `width` wide, each group's lane `lane` high (CSS px). */
    show(input: DistributionInput, width: number, lane: number): void;
    hide(): void;
    /** Whether a distribution is shown now. */
    shown(): boolean;
    inspect(): FigureInspection | null;
    dispose(): void;
}

/** Before a group's name in its lane's id: a lane's id is never empty, and a group's name can be (ungrouped, or a blank cell). */
export const BINS_LANE_ID = 'group:';
/** The Figure's own room around its lanes (its axis below, the gap between two lanes): figure.ts MARGIN and LANE_GAP. */
const AROUND = 46, BETWEEN = 22;

/** How high a Figure of `groups` lanes `lane` high is. */
export const distributionHeight = (groups: number, lane: number): number => AROUND + groups * lane + Math.max(0, groups - 1) * BETWEEN;

/** How high each of `groups` lanes is in a Figure `height` high. */
export const distributionLane = (height: number, groups: number): number => Math.floor((height - AROUND - Math.max(0, groups - 1) * BETWEEN) / Math.max(1, groups));

export function createDistributionFigure(deps: DistributionFigureDeps): DistributionFigure {
    const selectionOf = (input: DistributionInput): FigureSelection | null => (input.selection ? [input.selection.low, input.selection.high, input.selection.closed === true] : null);
    let figure: Figure | null = null;
    let view: FigureView | null = null;
    let shown: { spec: FigureSpec; input: DistributionInput } | null = null;
    const leave = (): void => {
        figure?.dispose();
        figure = null;
        view = null;
        shown = null;
        deps.host.hidden = true;
    };
    return {
        show(input, width, lane) {
            const height = distributionHeight(input.groups.length, lane);
            deps.host.hidden = false;
            if (shown && shown.input.axes !== input.axes) view = null;
            if (!figure) {
                figure = createFigure({
                    document: deps.document, host: deps.host, requests: deps.answers.figure(), words: deps.words, size: { width, height }, label: input.columnName,
                    ...(deps.readout ? { readout: deps.readout } : {}),
                    laneLabel: id => shown?.input.groupLabel(id.slice(BINS_LANE_ID.length)) ?? id.slice(BINS_LANE_ID.length),
                    lineLabel: line => (line.key !== undefined ? shown?.input.rowName(line.key) ?? line.key : line.id),
                    columnName: () => shown?.input.columnName ?? '',
                });
                figure.on('view', next => { view = next; if (shown) figure?.show(shown.spec, view, selectionOf(shown.input)); });
                figure.on('range', range => deps.pickRange({ low: range.x[0], high: range.x[1], ...(range.closed ? { closed: true } : {}) }));
                figure.on('pick', read => (read.point.key !== undefined ? deps.pickRow(read.point.key) : undefined));
                figure.on('picture', () => deps.drawn?.());
            } else figure.resize(width, height);
            deps.answers.column(input.column);
            const spec: FigureSpec = {
                lanes: input.groups.map(group => ({
                    id: BINS_LANE_ID + group.name, kind: 'bins' as const, column: input.column.key, rows: [...group.rows],
                    lines: input.roles.filter(item => group.rows.includes(item.row)).map(item => ({ id: `${group.name}:${item.role}`, role: item.role, of: { key: item.row } })),
                })),
                keys: [{ key: input.column.key, state: 'usable', version: input.column.version }],
            };
            shown = { spec, input };
            figure.show(spec, view, selectionOf(input));
        },
        hide: leave,
        shown: () => shown !== null,
        inspect: () => figure?.inspect() ?? null,
        dispose: leave,
    };
}
