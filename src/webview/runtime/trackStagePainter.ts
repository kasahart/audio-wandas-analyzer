/**
 * The track view's "steps" mode, drawn: each track's lane side by side, or the base, the tracks and the compared
 * file overlaid on one plot with its legend and, on request, their difference under it. The mode works out what is
 * shown (trackStageMode.ts); these draw it and remember what each plot drew, for the pointer's readout.
 */
import { secondsSpanText } from '../plot/plotText';
import type { UiStrings } from '../../shared/i18n/strings';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { baseName } from '../../shared/analysis/entryMetadata';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { dataRange, diffRange as figureDiffRange, emptyFigure, levelAxes, levelKeyOf, membersOf, byLevelKey, narrowedRange, stageNames, titleOf, type FigureNames, type FigureRange, type FigureTitle } from './figureModel';
import { type LegendItem, type LevelInput } from './comparePanes';
import { clearSideAxis, emptyStageText, isEventsView, paintOverlay, paintStage, stageEventCounts, stageHeadline, type StageLayer, type StagePlot } from './stagePanes';
import type { PlotWindow } from './plotInteraction';
import { noDeltaNote } from './combineSource';
import { SECONDARY_AXIS_DASH } from './overlaySpectrumPainter';
import type { StagePlots } from './trackStageModel';
import { NO_FULL_DATA, type FullRead } from './fullRead';

/** A track as the mode draws it: its lane's canvas, and the lane's own axis canvas (cleared: the painter draws the axes on the lane). */
export interface StageTrack {
    filePath: string;
    color: string;
    canvas: HTMLCanvasElement | null;
    axis: HTMLCanvasElement | null;
    input?: LevelInput;
}

/**
 * What each plot last drew, for the pointer's readout and an axis's range: the whole picture whose axes it
 * uses, its level range before the vertical zoom, its axes' names, the pictures read under the pointer, and
 * where its lines are (the line nearest the pointer is picked from them).
 */
/** `second`: the right-hand level axis of a plot with two (byReference), its whole range and its name, for its range popover. */
export type Drawn = { picture: StageView | null; range: FigureRange; axes: FigureNames; plot?: StagePlot | null; second?: { range: FigureRange; title: string } };

/** The mode's own elements: its root (controls, overlaid plot, legend, diff) and the step bar in it. */
export interface StageDom {
    root: HTMLElement;
    panel: HTMLElement;
    bar: HTMLElement;
    /** An element of the mode's markup, which is always there. */
    query: <T extends Element>(selector: string) => T;
}

/** The mode's markup under its root; `query` finds its parts. */
export function stageDom(root: HTMLElement, bar: HTMLElement): StageDom {
    const query = <T extends Element>(selector: string): T => {
        const found = root.querySelector<T>(selector);
        if (!found) throw new Error(`track stage: no ${selector} in its markup`);
        return found;
    };
    return { root, bar, panel: query<HTMLElement>('[data-stage-panel]'), query };
}

/** The region on the plots: its part of a whole-file picture (a step before the region's), else a corner tag. */
export type RegionMark = { start: number; end: number; mark: 'range' | 'tag'; label: string };
/** The files in of all asked for, said on the plots while any is missing. */
export type Pending = { done: number; total: number; label: string };

/** No chain or no step to show: the lanes, each saying so. */
export function paintNoStage(dom: StageDom, tracks: readonly StageTrack[], strings: Pick<UiStrings, 'stepOpenCompare'>): void {
    dom.panel.hidden = true;
    const none = emptyFigure();
    for (const track of tracks) if (track.canvas) paintStage(track.canvas, null, none.range, track.color, none.names, { empty: strings.stepOpenCompare });
}

/** A step that cannot run, or a base recording to measure against that is not there: the plot says why, and how to fix it. */
export function paintNoPicture(dom: StageDom, id: string, message: string): void {
    dom.root.dataset.pending = '';
    dom.panel.hidden = false;
    dom.query<HTMLElement>('[data-stage-headline]').textContent = '';
    dom.query<HTMLElement>('[data-stage-diff]').hidden = true;
    dom.bar.dataset.drawn = '0';
    dom.bar.dataset.stage = id;
    const none = emptyFigure();
    paintOverlay(dom.query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers: [] }, none.range, none.names, { empty: message });
}

/** The layout and difference toggles: images cannot be overlaid, and without a compared file there is no difference. */
export function paintStageControls(dom: StageDom, strings: Pick<UiStrings, 'stageLayoutSide' | 'stageLayoutOverlay' | 'compareDiffHide' | 'compareDiffShow'>, view: { overlaid: boolean; images: boolean; showDiff: boolean; overlay: boolean; measuredAgainstBase: boolean; nothingCompared: boolean; baseEach?: boolean; events?: boolean }): void {
    const layout = dom.query<HTMLButtonElement>('[data-action="stage-layout"]');
    layout.textContent = view.overlaid ? strings.stageLayoutSide : strings.stageLayoutOverlay;
    layout.setAttribute('aria-pressed', String(view.overlaid));
    // Images cannot be overlaid: the toggle has nothing to offer then.
    layout.hidden = view.images;
    const diffButton = dom.query<HTMLButtonElement>('[data-action="stage-diff"]');
    diffButton.textContent = view.showDiff ? strings.compareDiffHide : strings.compareDiffShow;
    diffButton.setAttribute('aria-pressed', String(view.showDiff));
    diffButton.hidden = !view.overlay || view.measuredAgainstBase || !!view.baseEach || !!view.events;
    diffButton.disabled = view.nothingCompared;
}

/** A base group too large to scan unasked: its button says how many recordings and about how long. */
export function paintBaseGate(dom: StageDom, strings: Pick<UiStrings, 'entryMinutes' | 'entrySeconds' | 'stageBaseScan'>, gate: { gated: boolean; count: number; ms: number }): void {
    dom.query<HTMLElement>('[data-stage-base-gate]').hidden = !gate.gated;
    dom.root.dataset.baseGate = gate.gated ? String(gate.count) : '';
    if (!gate.gated) return;
    const seconds = Math.ceil(gate.ms / 1000);
    const time = seconds >= 60 ? strings.entryMinutes.replace('{n}', String(Math.ceil(seconds / 60))) : strings.entrySeconds.replace('{n}', String(seconds));
    dom.query<HTMLElement>('[data-action="stage-base-scan"]').textContent = strings.stageBaseScan.replace('{n}', String(gate.count)).replace('{time}', time);
}

/** What a paint draws with: the pictures as they are in, the zoom, and how the files are named and coloured. */
export interface StageFrame {
    strings: UiStrings;
    tracks: readonly StageTrack[];
    /** Every track, the base recording measured against included. */
    allTracks: readonly StageTrack[];
    /** What a recording's levels are in when it is no track (a base group's): its scan's input. */
    levelOf?: (path: string) => StageTrack['input'];
    /** What the base's median line's levels are in: its recordings' (axisInputOf), never a track's it is not of. */
    baseInput?: StageTrack['input'];
    /** The base slot's recording each other is measured against, when a step is. */
    referencePath: string | null;
    comparePath: string | null;
    /** A file's coarse picture (undefined while not in), and the one drawn (the fine one once in). */
    coarse: (path: string) => StageView | null | undefined;
    shown: (path: string) => StageView | null | undefined;
    /** The first picture in, whose axes the plots use. */
    picture: StageView | null;
    /** Where a picture's numbers are read (R7): its full data, or the median's and the difference's; undefined without any. */
    fullOf?: (view: StageView | null | undefined) => FullRead | undefined;
    coarsePlots: StagePlots<StageTrack>;
    window: PlotWindow;
    /** The Δ pane's own vertical zoom (its horizontal one is the window's). */
    diffY: { start: number; end: number };
    /** Zoomed, whether the difference drawn is this window's own (its peak looked for on screen): else its headline names no point. */
    diffOfWindow?: boolean;
    regionMark?: RegionMark;
    pending?: Pending;
    waiting: boolean;
    role: (path: string) => number | undefined;
    /** A file in the legend: its role, name and channel, its value on show, ✎ with its memo. */
    named: (path: string, slot: number | undefined) => Pick<LegendItem, 'label' | 'value' | 'memo' | 'chipHtml'>;
    drawnOn: Map<Element, Drawn>;
    /**
     * A base group drawn as each of its waveforms: its median level is on no line, so no level difference is
     * measured against it (the headline names none, and Δ is not offered).
     */
    baseEach?: boolean;
    /** The events left out of a recording's (its trigger's), drawn faint; a click on one puts it back. */
    excluded?: (path: string) => readonly number[];
    /** The backend could not keep every recording's values to take the median and the difference from. */
    tooLarge?: boolean;
    /** Why there is no difference when it is not the axes (combineSource's ``noDelta``). */
    noDelta?: 'rate' | 'unit';
    /** The backend failed to take the median and difference (combineSource's ``failed``). */
    failed?: boolean;
}

/**
 * The notes in the row over the plots (its numbers are the pointer's readout, R7): the recording measured against, a
 * trigger's event counts, a base too large, or what to do while nothing is compared; then the steps bypassed and
 * the region. Empty while computing.
 */
export function stageModeHeadline(frame: Pick<StageFrame, 'strings' | 'waiting' | 'referencePath' | 'comparePath' | 'role' | 'named' | 'coarsePlots' | 'baseEach' | 'tooLarge' | 'failed'>, bypassed: readonly string[], region: { start: number; end: number } | null): string {
    const { strings, waiting, referencePath, comparePath, coarsePlots, baseEach } = frame;
    // While computing, the plots say so (with the files in): the headline waits for the levels.
    let text = waiting ? ''
        : referencePath ? strings.stageVsBase.replace('{file}', frame.named(referencePath, 0).label)
        // The row's numbers are the pointer's readout (R7, as over the cursor spectrum): no difference is named here.
        // A trigger's events say how many each found; a base too large for the median says so.
        : comparePath ? (baseEach ? '' : frame.failed ? strings.stageCombineFailed : frame.tooLarge ? strings.stageTooLarge
            : isEventsView(coarsePlots.compare) || isEventsView(coarsePlots.base) ? stageEventCounts(coarsePlots.base, coarsePlots.compare, strings) : '')
        // No compare role yet: the lines are there, but nothing to measure against a base; the legend's chips set one.
        : strings.stageChooseRoles;
    // The steps bypassed are named: what is drawn is the chain without them.
    if (bypassed.length && !waiting) text += strings.stepBypassing.replace('{ops}', bypassed.join(', '));
    // The part of the files compared, while a region is set.
    if (region && !waiting && comparePath) text += ` · ${strings.stepRegion} ${secondsSpanText(region.start, region.end)}`;
    // With no difference named (a base group drawn as its waveforms), the bypassed steps and the region lead.
    return text.replace(/^\s*(·\s*)?/, '');
}

/** Colour is the role's: a recording without one has its own (`fallback`, the track's colour), its name in the legend too. */
export const colorOf = (role: StageFrame['role'], path: string, fallback: string): string => ROLE_COLORS[role(path) ?? -1] ?? fallback;
const widthOf = (role: StageFrame['role'], path: string, width: number): number => (role(path) === undefined ? 1.2 : width);

/** What a lane's levels are in (figureModel.levelKeyOf). */
const referenceOf = (track: StageTrack): string => levelKeyOf(track.input);

/**
 * Side by side: every track's lane, on one range with the lanes in its reference so they compare at a glance, and a
 * lane in another reference on its own (A32, C1: a level in dBFS is never laid on a dB SPL scale); how many lanes drew
 * a picture.
 */
export function paintStageLanes(frame: StageFrame): number {
    const { strings, tracks, coarse, shown, picture, window, regionMark, pending } = frame;
    // One range per level identity, over its lanes alone (figureModel).
    const groups = byLevelKey(tracks, referenceOf);
    const rangeOf = (track: StageTrack): FigureRange => dataRange(membersOf(groups, referenceOf(track)).map(other => coarse(other.filePath) ?? null));
    const heat = picture?.kind === 'heatmap';
    let drawn = 0;
    // Every lane in while the base group is still computed: the first lane says so, in its corner.
    const anyMissing = tracks.some(track => track.canvas && coarse(track.filePath) === undefined);
    const progressLane = anyMissing ? null : tracks.find(track => track.canvas)?.filePath;
    tracks.forEach(track => {
        if (track.axis) clearSideAxis(track.axis);
        if (!track.canvas) return;
        // The lane shows the step now, not its waveform: its name says so until the comparison closes.
        track.canvas.dataset.laneLabel ??= track.canvas.getAttribute('aria-label') ?? '';
        track.canvas.setAttribute('aria-label', strings.ariaStageLaneCanvas.replace('{file}', baseName(track.filePath)));
        const view = shown(track.filePath) ?? null;
        const missing = coarse(track.filePath) === undefined;
        const empty = missing ? '' : emptyStageText(strings, coarse(track.filePath) ?? picture);
        const axes = stageNames(strings, coarse(track.filePath) ?? picture, track.input);
        // A lane holds one picture, drawn as it is (1/3-octave levels as steps, without a fill).
        const range = rangeOf(track);
        const lanePlot = paintOverlay(track.canvas, { layers: view ? [{ view, color: colorOf(frame.role, track.filePath, track.color), width: widthOf(frame.role, track.filePath, 2), label: frame.named(track.filePath, frame.role(track.filePath)).label, ...eventsOf(frame, track.filePath, view), ...fullOf(frame, view) }] : [] }, heat ? range : narrowedRange(range, window.y), axes,
            { empty, window: { x: window.x, ...(heat ? { y: window.y } : {}) }, axisView: coarse(track.filePath) ?? picture, ...(regionMark ? { region: regionMark } : {}), ...((missing || track.filePath === progressLane) && pending ? { pending } : {}) });
        frame.drawnOn.set(track.canvas, { picture: coarse(track.filePath) ?? picture, range, axes, plot: lanePlot });
        if (view) drawn++;
    });
    // The base slot's lane: the reference the others are measured against, not a picture of its own.
    const referencePath = frame.referencePath;
    const referenceTrack = referencePath ? frame.allTracks.find(track => track.filePath === referencePath) : undefined;
    // Its side axis held the waveform's: cleared, as the lanes' are, since the lane draws no picture of its own.
    if (referenceTrack?.axis) clearSideAxis(referenceTrack.axis);
    const none = emptyFigure();
    if (referencePath && referenceTrack?.canvas) paintStage(referenceTrack.canvas, null, none.range, referenceTrack.color, none.names, { empty: strings.stageBaseLane.replace('{file}', frame.named(referencePath, 0).label) });
    return drawn;
}

/** Where a picture's numbers are read (R7): its full data, as the mode gives it. */
function fullOf(frame: Pick<StageFrame, 'fullOf'>, view: StageView): Pick<StageLayer, 'full'> {
    return { full: frame.fullOf?.(view) ?? NO_FULL_DATA };
}

/** A recording's events as a line each can be left out of: whose they are, and those left out. */
function eventsOf(frame: Pick<StageFrame, 'excluded'>, path: string, view: StageView): Pick<StageLayer, 'source' | 'excluded'> {
    return view.events && frame.excluded ? { source: path, excluded: frame.excluded(path) } : {};
}

/**
 * The overlaid plot's lines: those without a role (each its own colour), the base, the other tracks, the compared file. The plot
 * draws them by level, the quietest on top (R6, paintOverlay). Each carries its legend name (the base's `baseLabel`), for the
 * readout of the line under the pointer.
 */
export function overlayLayers(frame: Pick<StageFrame, 'comparePath' | 'role' | 'named' | 'excluded' | 'fullOf'> & Partial<Pick<StageFrame, 'baseInput'>>, plots: StagePlots<StageTrack>, baseLabel?: string, basePath?: string): StageLayer[] {
    const roleColor = (path: string, fallback: string): string => colorOf(frame.role, path, fallback);
    const nameOf = (path: string): string => frame.named(path, frame.role(path)).label;
    const { comparePath } = frame;
    return [
        // The lines without a role, each in its recording's own colour, under the roles' ones.
        ...plots.others.filter(item => frame.role(item.track.filePath) === undefined).flatMap(item => (item.view ? [{ view: item.view, color: item.track.color, width: 1.2, label: nameOf(item.track.filePath), recording: item.track.filePath, ...eventsOf(frame, item.track.filePath, item.view) }] : [])),
        // A base group's waveforms, each thin in the base's colour (a group has no median signal).
        ...plots.baseMembers.map(({ path, view }) => ({ view, color: ROLE_COLORS[0], width: 1, recording: path, label: baseLabel !== undefined ? `${baseLabel} · ${baseName(path)}` : baseName(path) })),
        ...(plots.base && !plots.baseMembers.length ? [{ view: plots.base, color: ROLE_COLORS[0], width: 2, ...(basePath !== undefined ? { recording: basePath } : frame.baseInput ? { levelInput: frame.baseInput } : {}), ...(baseLabel !== undefined ? { label: baseLabel } : {}), ...(basePath !== undefined ? eventsOf(frame, basePath, plots.base) : {}) }] : []),
        ...plots.others.filter(item => frame.role(item.track.filePath) !== undefined).flatMap(item => (item.view ? [{ view: item.view, color: roleColor(item.track.filePath, item.track.color), width: 1.8, label: nameOf(item.track.filePath), recording: item.track.filePath, ...eventsOf(frame, item.track.filePath, item.view) }] : [])),
        ...(plots.compare && comparePath ? [{ view: plots.compare, color: roleColor(comparePath, ROLE_COLORS[1]), width: 2.2, label: nameOf(comparePath), recording: comparePath, ...eventsOf(frame, comparePath, plots.compare) }] : []),
    ].map(layer => ({ ...layer, ...fullOf(frame, layer.view) }));
}

/** The overlaid plot's legend: the base (with how a group's curve is made), the compared file, the other tracks. */
export function overlayLegendItems(frame: Pick<StageFrame, 'comparePath' | 'referencePath' | 'role' | 'named' | 'strings'>, plots: StagePlots<StageTrack>, base: {
    title: string;
    /** A base group (not a slot-0 file): its ▾ says how its curve is made. */
    group: boolean;
    /** What the ▾ says (the median, or each waveform as is); the median without it. */
    aggregate?: string;
    gated: boolean;
    count: number;
    held: boolean;
    playable: (path: string) => Pick<LegendItem, 'path' | 'playing'>;
}): LegendItem[] {
    const { comparePath, referencePath, strings } = frame;
    const roleColor = (path: string, fallback: string): string => colorOf(frame.role, path, fallback);
    return [
        // A base group not analysed is not drawn, as its entry says.
        ...(comparePath && !referencePath ? [{ color: ROLE_COLORS[0], label: base.title + (base.gated ? strings.stageBaseNoLine : ''),
            ...(base.group ? { trailingHtml: `<button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(base.aggregate ?? strings.stageBaseAggregate)}">▾</button>` } : {}) }] : []),
        ...(comparePath ? [{ color: roleColor(comparePath, ROLE_COLORS[1]), ...frame.named(comparePath, frame.role(comparePath)), active: true, held: base.held, ...base.playable(comparePath) }] : []),
        ...plots.others.map(item => ({ color: roleColor(item.track.filePath, item.track.color), ...frame.named(item.track.filePath, frame.role(item.track.filePath)), ...base.playable(item.track.filePath) })),
    ];
}

/**
 * Writes the legend unless it is what was written, or a role chip's menu is open (drawn again once it closes); a
 * focused ▶ or role chip is focused again once drawn anew. Returns what the legend now holds.
 */
export function writeStageLegend(legend: HTMLElement, html: string, written: string, document: Document): string {
    // Compared with what was written, not with innerHTML (which the browser serializes its own way): a redraw while
    // playing leaves the legend's buttons, and the focus on them, in place.
    if (written === html || legend.querySelector('details.role-chip[open]')) return written;
    // A focused ▶ or role chip is focused again once drawn anew (its ■ / role changed under the keyboard).
    const focused = legend.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const path = focused?.closest<HTMLElement>('[data-path], [data-file-path]');
    const again = path ? (path.dataset.path !== undefined ? `[data-action="compare-play"][data-path="${CSS.escape(path.dataset.path)}"]` : `details.role-chip[data-file-path="${CSS.escape(path.dataset.filePath ?? '')}"] > summary`) : null;
    legend.innerHTML = html;
    if (again) legend.querySelector<HTMLElement>(again)?.focus();
    return html;
}

/**
 * The overlay's lines by the level identity of their own recordings (R1, levelIdentityOf: unit, reference value,
 * level reference name; C1, as the cursor spectrum's): all on one axis when they share one; with two, the base's on
 * the left and the other's on the right, its lines dashed; with more, none overlaid (`tooMany`). An axis is named by
 * axisInputOf its lines' inputs. An image keeps one axis; a trigger's events are split as any line (A43).
 */
export function byReference(frame: Pick<StageFrame, 'strings' | 'picture' | 'allTracks' | 'tracks' | 'role'> & Partial<Pick<StageFrame, 'window' | 'levelOf' | 'comparePath'>>, layers: readonly StageLayer[]): {
    mainLayers: StageLayer[]; secondary?: { layers: StageLayer[]; range: FigureRange; title: FigureTitle }; secondWhole?: FigureRange; mainInput: StageTrack['input']; mainNames: FigureNames; tooMany: boolean;
} {
    const { strings, picture, tracks } = frame;
    // A line's own recording's input (a track's, else its scan's), the base median's its recordings'; a line of neither
    // is the compared recording's, whose identity the base set is of, never the first track's (R1).
    const trackInput = (path: string | null | undefined): StageTrack['input'] => (path ? frame.allTracks.find(track => track.filePath === path)?.input ?? frame.levelOf?.(path) : undefined);
    const inputOf = (layer: StageLayer): StageTrack['input'] => layer.levelInput ?? trackInput(layer.recording) ?? trackInput(frame.comparePath);
    const base = layers.find(layer => layer.recording !== undefined && frame.role(layer.recording) === 0);
    // An image has one colour bar; a trigger's events are their recordings' lines, split by identity as any line (A43).
    const { axes, tooMany } = levelAxes(layers, {
        inputOf, ...(base ? { first: base } : {}), one: picture?.kind === 'heatmap', fallback: tracks[0]?.input,
        names: input => stageNames(strings, picture, input),
        range: members => dataRange(members.map(layer => layer.view)),
    });
    if (tooMany) return { mainLayers: [], mainInput: tracks[0]?.input, mainNames: stageNames(strings, picture, tracks[0]?.input), tooMany: true };
    const [main, second] = axes;
    if (!main) return { mainLayers: [], mainInput: tracks[0]?.input, mainNames: stageNames(strings, picture, tracks[0]?.input), tooMany: false };
    if (!second) return { mainLayers: main.lines, mainInput: main.input, mainNames: main.names, tooMany: false };
    // A vertical zoom narrows the right-hand axis by the same part of it as the left (A45, R13), as the cursor spectrum's.
    return {
        mainLayers: main.lines, mainInput: main.input, mainNames: main.names, tooMany: false, secondWhole: second.range,
        secondary: { layers: second.lines.map(layer => ({ ...layer, dash: SECONDARY_AXIS_DASH })), range: frame.window ? narrowedRange(second.range, frame.window.y) : second.range, title: titleOf(second.names) },
    };
}

/** Overlaid: the base, the other tracks and the compared one on one plot, then their difference under it on request. */
export function paintStageOverlay(dom: StageDom, frame: StageFrame, plots: StagePlots<StageTrack>, layers: StageLayer[], showDiff: boolean): void {
    const { strings, tracks, picture, coarsePlots, window, regionMark, pending, waiting, comparePath, referencePath } = frame;
    const range = dataRange([coarsePlots.base, ...coarsePlots.baseMembers.map(item => item.view), coarsePlots.compare, ...coarsePlots.others.map(item => item.view)]);
    const { mainLayers, secondary, secondWhole, mainNames: axes, tooMany } = byReference(frame, layers);
    const empty = tooMany ? strings.stageTooManyReferences : waiting ? '' : emptyStageText(strings, picture);
    // The difference shown or hidden first: it takes part of the overlay's height, which the overlay is measured at.
    const diffBox = dom.query<HTMLElement>('[data-stage-diff]');
    // A trigger's events have no difference between recordings: no pane for one.
    const withDiff = showDiff && !referencePath && !!comparePath && !frame.baseEach && !isEventsView(picture);
    diffBox.hidden = !withDiff;
    const overlay = dom.query<HTMLCanvasElement>('[data-stage-canvas="overlay"]');
    const mainRange = secondary ? dataRange(mainLayers.map(layer => layer.view)) : range;
    const overlayPlot = paintOverlay(overlay, { layers: mainLayers }, narrowedRange(mainRange, window.y), axes, { empty, window: { x: window.x }, axisView: picture, ...(secondary ? { secondary } : {}), ...(regionMark ? { region: regionMark } : {}), ...(pending ? { pending } : {}) });
    frame.drawnOn.set(overlay, { picture, range: mainRange, axes, plot: overlayPlot, ...(secondary && secondWhole ? { second: { range: secondWhole, title: secondary.title } } : {}) });
    if (!withDiff) return;
    // Zoomed, the largest difference on screen, once this window's own difference is in (C4).
    const zoomed = window.x.start > 0 || window.x.end < 1 || (plots.diff?.kind === 'heatmap' && (window.y.start > 0 || window.y.end < 1));
    dom.query<HTMLElement>('[data-stage-diff-headline]').textContent = waiting ? '' : plots.diff ? stageHeadline(plots.diff, strings, !zoomed || !!frame.diffOfWindow) : noDeltaNote(frame, strings);
    // A Δ is only of recordings of one reference (stage_combine._no_delta_reason): the compared one's names it.
    const diffAxes = stageNames(strings, coarsePlots.diff, frame.allTracks.find(track => track.filePath === comparePath)?.input ?? tracks[0]?.input, true);
    const diffCanvas = dom.query<HTMLCanvasElement>('[data-stage-canvas="diff"]');
    const diffRange = figureDiffRange(coarsePlots.diff);
    const diffPlot = paintStage(diffCanvas, plots.diff, narrowedRange(diffRange, frame.diffY), DIFF_COLOR, diffAxes,
        { diff: true, empty: waiting ? '' : noDeltaNote(frame, strings), window: { x: window.x }, axisView: coarsePlots.diff, ...(pending ? { pending } : {}) }, frame.fullOf?.(plots.diff));
    frame.drawnOn.set(diffCanvas, { picture: coarsePlots.diff, range: diffRange, axes: diffAxes, plot: diffPlot });
}
