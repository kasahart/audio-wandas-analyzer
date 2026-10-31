/**
 * The track view's "steps" mode, drawn: each track's lane side by side, or the base, the tracks and the compared
 * file overlaid on one plot with its legend and, on request, their difference under it. The mode works out what is
 * shown (trackStageMode.ts); these draw it and remember what each plot drew, for the pointer's readout.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { baseName } from '../../shared/analysis/entryMetadata';
import { DIFF_COLOR, NO_ROLE_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import type { LegendItem, PaneRange } from './comparePanes';
import { paintOverlay, paintStage, stageAxes, stageDiffRange, stageHeadline, stageLevelsHeadline, stageRange, type StageAxes, type StageLayer } from './stagePanes';
import type { PlotWindow } from './plotInteraction';
import type { StagePlots } from './trackStageModel';

/** A track as the mode draws it: its lane's canvas, and the lane's own axis canvas (cleared: the painter draws the axes on the lane). */
export interface StageTrack {
    filePath: string;
    color: string;
    canvas: HTMLCanvasElement | null;
    axis: HTMLCanvasElement | null;
    input?: { unit?: string; ref?: number };
}

/**
 * What each plot last drew, for the pointer's readout and an axis's range: the whole picture whose axes it
 * uses, its level range before the vertical zoom, its axes' names, and the pictures read under the pointer.
 */
export type Drawn = { picture: StageView | null; range: PaneRange; axes: StageAxes; views: { base: StageView | null; compare: StageView | null; diff: StageView | null } };

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

const narrowed = (range: PaneRange, y: { start: number; end: number }): PaneRange => ({ min: range.min + y.start * (range.max - range.min), max: range.min + y.end * (range.max - range.min) });

/** The region on the plots: its part of a whole-file picture (a step before the region's), else a corner tag. */
export type RegionMark = { start: number; end: number; mark: 'range' | 'tag'; label: string };
/** The files in of all asked for, said on the plots while any is missing. */
export type Pending = { done: number; total: number; label: string };

/** No chain or no step to show: the lanes, each saying so. */
export function paintNoStage(dom: StageDom, tracks: readonly StageTrack[], strings: Pick<UiStrings, 'stepOpenCompare'>): void {
    dom.panel.hidden = true;
    for (const track of tracks) if (track.canvas) paintStage(track.canvas, null, { min: 0, max: 1 }, track.color, { x: '', y: '' }, { empty: strings.stepOpenCompare });
}

/** A step that cannot run, or a base recording to measure against that is not there: the plot says why, and how to fix it. */
export function paintNoPicture(dom: StageDom, id: string, message: string): void {
    dom.root.dataset.pending = '';
    dom.panel.hidden = false;
    dom.query<HTMLElement>('[data-stage-headline]').textContent = '';
    dom.query<HTMLElement>('[data-stage-diff]').hidden = true;
    dom.bar.dataset.drawn = '0';
    dom.bar.dataset.stage = id;
    paintOverlay(dom.query<HTMLCanvasElement>('[data-stage-canvas="overlay"]'), { layers: [] }, { min: 0, max: 1 }, { x: '', y: '' }, { empty: message });
}

/** The layout and difference toggles: images cannot be overlaid, and without a compared file there is no difference. */
export function paintStageControls(dom: StageDom, strings: Pick<UiStrings, 'stageLayoutSide' | 'stageLayoutOverlay' | 'compareDiffHide' | 'compareDiffShow'>, view: { overlaid: boolean; images: boolean; showDiff: boolean; overlay: boolean; measuredAgainstBase: boolean; nothingCompared: boolean }): void {
    const layout = dom.query<HTMLButtonElement>('[data-action="stage-layout"]');
    layout.textContent = view.overlaid ? strings.stageLayoutSide : strings.stageLayoutOverlay;
    layout.setAttribute('aria-pressed', String(view.overlaid));
    // Images cannot be overlaid: the toggle has nothing to offer then.
    layout.hidden = view.images;
    const diffButton = dom.query<HTMLButtonElement>('[data-action="stage-diff"]');
    diffButton.textContent = view.showDiff ? strings.compareDiffHide : strings.compareDiffShow;
    diffButton.setAttribute('aria-pressed', String(view.showDiff));
    diffButton.hidden = !view.overlay || view.measuredAgainstBase;
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
    /** The base slot's recording each other is measured against, when a step is. */
    referencePath: string | null;
    comparePath: string | null;
    /** A file's coarse picture (undefined while not in), and the one drawn (the fine one once in). */
    coarse: (path: string) => StageView | null | undefined;
    shown: (path: string) => StageView | null | undefined;
    /** The first picture in, whose axes the plots use. */
    picture: StageView | null;
    coarsePlots: StagePlots<StageTrack>;
    window: PlotWindow;
    regionMark?: RegionMark;
    pending?: Pending;
    waiting: boolean;
    role: (path: string) => number | undefined;
    /** A file in the legend: its role, name and channel, its value on show, ✎ with its memo. */
    named: (path: string, slot: number | undefined) => Pick<LegendItem, 'label' | 'value' | 'memo' | 'chipHtml'>;
    drawnOn: Map<Element, Drawn>;
}

/**
 * The headline over the plots: the recording measured against, or which difference is shown and where it is
 * largest, or what to do while nothing is compared; then the steps bypassed and the region. Empty while computing.
 */
export function stageModeHeadline(frame: Pick<StageFrame, 'strings' | 'waiting' | 'referencePath' | 'comparePath' | 'role' | 'named' | 'coarsePlots'>, bypassed: readonly string[], region: { start: number; end: number } | null): string {
    const { strings, waiting, referencePath, comparePath, coarsePlots } = frame;
    const role = comparePath ? frame.role(comparePath) : undefined;
    // While computing, the plots say so (with the files in): the headline waits for the levels.
    let text = waiting ? ''
        : referencePath ? strings.stageVsBase.replace('{file}', frame.named(referencePath, 0).label)
        // Which difference is shown: the compared slot against the base.
        : comparePath ? (role ? strings.stageCompareMinusBase.replace('{n}', String(role)) : '')
            + stageLevelsHeadline(coarsePlots.base, coarsePlots.compare, coarsePlots.diff, strings)
        // No compare role yet: the lines are there, but nothing to measure against a base; the legend's chips set one.
        : strings.stageChooseRoles;
    // The steps bypassed are named: what is drawn is the chain without them.
    if (bypassed.length && !waiting) text += strings.stepBypassing.replace('{ops}', bypassed.join(', '));
    // The part of the files compared, while a region is set.
    if (region && !waiting && comparePath) text += ` · ${strings.stepRegion} ${region.start.toFixed(2)}–${region.end.toFixed(2)} s`;
    return text;
}

/** Colour is the role's: a recording without one is grey, its name in the legend telling it apart. */
const colorOf = (role: StageFrame['role'], path: string, fallback = NO_ROLE_COLOR): string => ROLE_COLORS[role(path) ?? -1] ?? fallback;
const widthOf = (role: StageFrame['role'], path: string, width: number): number => (role(path) === undefined ? 1.2 : width);

/** Side by side: every track's lane, on one range so the tracks compare at a glance; how many lanes drew a picture. */
export function paintStageLanes(frame: StageFrame): number {
    const { strings, tracks, coarse, shown, picture, coarsePlots, window, regionMark, pending } = frame;
    const range = stageRange(tracks.map(track => coarse(track.filePath) ?? null));
    const heat = picture?.kind === 'heatmap';
    let drawn = 0;
    // Every lane in while the base group is still computed: the first lane says so, in its corner.
    const anyMissing = tracks.some(track => track.canvas && coarse(track.filePath) === undefined);
    const progressLane = anyMissing ? null : tracks.find(track => track.canvas)?.filePath;
    tracks.forEach(track => {
        track.axis?.getContext('2d')?.clearRect(0, 0, track.axis.width, track.axis.height);
        if (!track.canvas) return;
        // The lane shows the step now, not its waveform: its name says so until the comparison closes.
        track.canvas.dataset.laneLabel ??= track.canvas.getAttribute('aria-label') ?? '';
        track.canvas.setAttribute('aria-label', strings.ariaStageLaneCanvas.replace('{file}', baseName(track.filePath)));
        const view = shown(track.filePath) ?? null;
        const missing = coarse(track.filePath) === undefined;
        const empty = missing ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
        const axes = stageAxes(strings, coarse(track.filePath) ?? picture, track.input);
        frame.drawnOn.set(track.canvas, { picture: coarse(track.filePath) ?? picture, range, axes, views: { base: coarsePlots.base, compare: coarse(track.filePath) ?? null, diff: null } });
        // A lane holds one picture, drawn as it is (1/3-octave levels as steps, without a fill).
        paintOverlay(track.canvas, { layers: view ? [{ view, color: colorOf(frame.role, track.filePath), width: widthOf(frame.role, track.filePath, 2) }] : [] }, heat ? range : narrowed(range, window.y), axes,
            { empty, window: { x: window.x, ...(heat ? { y: window.y } : {}) }, axisView: coarse(track.filePath) ?? picture, ...(regionMark ? { region: regionMark } : {}), ...((missing || track.filePath === progressLane) && pending ? { pending } : {}) });
        if (view) drawn++;
    });
    // The base slot's lane: the reference the others are measured against, not a picture of its own.
    const referencePath = frame.referencePath;
    const referenceTrack = referencePath ? frame.allTracks.find(track => track.filePath === referencePath) : undefined;
    if (referencePath && referenceTrack?.canvas) paintStage(referenceTrack.canvas, null, { min: 0, max: 1 }, referenceTrack.color, { x: '', y: '' }, { empty: strings.stageBaseLane.replace('{file}', frame.named(referencePath, 0).label) });
    return drawn;
}

/** The overlaid plot's lines: the grey ones (no role) under the roles' ones, the base, the other tracks, the compared file on top. */
export function overlayLayers(frame: Pick<StageFrame, 'comparePath' | 'role'>, plots: StagePlots<StageTrack>): StageLayer[] {
    const roleColor = (path: string, fallback?: string): string => colorOf(frame.role, path, fallback);
    const { comparePath } = frame;
    return [
        // The grey lines (no role) under the roles' ones.
        ...plots.others.filter(item => frame.role(item.track.filePath) === undefined).flatMap(item => (item.view ? [{ view: item.view, color: NO_ROLE_COLOR, width: 1.2 }] : [])),
        ...(plots.base ? [{ view: plots.base, color: ROLE_COLORS[0], width: 2 }] : []),
        ...plots.others.filter(item => frame.role(item.track.filePath) !== undefined).flatMap(item => (item.view ? [{ view: item.view, color: roleColor(item.track.filePath), width: 1.8 }] : [])),
        ...(plots.compare && comparePath ? [{ view: plots.compare, color: roleColor(comparePath, ROLE_COLORS[1]), width: 2.2 }] : []),
    ];
}

/** The overlaid plot's legend: the base (with how a group's curve is made), the compared file, the other tracks. */
export function overlayLegendItems(frame: Pick<StageFrame, 'comparePath' | 'referencePath' | 'role' | 'named' | 'strings'>, plots: StagePlots<StageTrack>, base: {
    title: string;
    /** A base group (not a slot-0 file): its ▾ says how its curve is made. */
    group: boolean;
    gated: boolean;
    tableBase: StageView | null;
    tableBands: { count: number } | null;
    count: number;
    held: boolean;
    playable: (path: string) => Pick<LegendItem, 'path' | 'playing'>;
}): LegendItem[] {
    const { comparePath, referencePath, strings } = frame;
    const roleColor = (path: string, fallback?: string): string => colorOf(frame.role, path, fallback);
    return [
        // A base group not analysed: drawn from the table's whole-file values, or not drawn at all, as its entry says.
        ...(comparePath && !referencePath ? [{ color: ROLE_COLORS[0], label: base.title + (!base.gated ? '' : base.tableBase ? strings.stageBaseTableNote : strings.stageBaseNoLine),
            ...(base.gated && base.tableBase && base.tableBands ? { hint: strings.stageBaseTableHint.replace('{m}', String(base.tableBands.count)).replace('{n}', String(base.count)) } : {}),
            ...(base.group ? { trailingHtml: `<button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(strings.stageBaseAggregate)}">▾</button>` } : {}) }] : []),
        ...(comparePath ? [{ color: roleColor(comparePath, ROLE_COLORS[1]), ...frame.named(comparePath, frame.role(comparePath)), active: true, held: base.held, ...base.playable(comparePath) }] : []),
        ...plots.others.map(item => ({ color: roleColor(item.track.filePath), ...frame.named(item.track.filePath, frame.role(item.track.filePath)), ...base.playable(item.track.filePath) })),
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

/** Overlaid: the base, the other tracks and the compared one on one plot, then their difference under it on request. */
export function paintStageOverlay(dom: StageDom, frame: StageFrame, plots: StagePlots<StageTrack>, layers: StageLayer[], showDiff: boolean): void {
    const { strings, tracks, picture, coarsePlots, window, regionMark, pending, waiting, comparePath, referencePath } = frame;
    const range = stageRange([coarsePlots.base, coarsePlots.compare, ...coarsePlots.others.map(item => item.view)]);
    const axes = stageAxes(strings, picture, tracks[0]?.input);
    const empty = waiting ? '' : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
    const overlay = dom.query<HTMLCanvasElement>('[data-stage-canvas="overlay"]');
    frame.drawnOn.set(overlay, { picture, range, axes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff } });
    paintOverlay(overlay, { layers }, narrowed(range, window.y), axes, { empty, window: { x: window.x }, axisView: picture, ...(regionMark ? { region: regionMark } : {}), ...(pending ? { pending } : {}) });
    const diffBox = dom.query<HTMLElement>('[data-stage-diff]');
    diffBox.hidden = !showDiff || !!referencePath || !comparePath;
    if (!showDiff || referencePath || !comparePath) return;
    dom.query<HTMLElement>('[data-stage-diff-headline]').textContent = waiting ? '' : stageHeadline(plots.diff, strings);
    const diffAxes = stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true);
    const diffCanvas = dom.query<HTMLCanvasElement>('[data-stage-canvas="diff"]');
    frame.drawnOn.set(diffCanvas, { picture: coarsePlots.diff, range: stageDiffRange(coarsePlots.diff), axes: diffAxes, views: { base: coarsePlots.base, compare: coarsePlots.compare, diff: coarsePlots.diff } });
    paintStage(diffCanvas, plots.diff, stageDiffRange(coarsePlots.diff), DIFF_COLOR, stageAxes(strings, coarsePlots.diff, tracks[0]?.input, true),
        { diff: true, empty: waiting ? '' : strings.stageNoDelta, window: { x: window.x }, axisView: coarsePlots.diff, ...(pending ? { pending } : {}) });
}
