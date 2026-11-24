/**
 * The comparison's own markup around its Figure: the controls, the headline's notes, the base group's gate and the
 * legend. The plots themselves are the Figure's (screens/compareOverlay.ts, screens/triggerLanes.ts): nothing is drawn
 * here.
 */
import { secondsSpanText } from '../shell/numberText';
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { ROLE_COLORS } from '../../shared/gui/roleColors';
import { type LegendItem } from './comparePanes';
import type { LevelInput } from './figureModel';
import type { StageView } from '../../shared/protocol/backendProtocol';

/** A recording on screen as the comparison has it: its own colour and what its levels are in. */
export interface StageTrack {
    filePath: string;
    color: string;
    input?: LevelInput;
}

/** The mode's own elements: its root (controls, legend, the Figure's hosts) and the step bar in it. */
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

/** How a recording is named in the legend and the readout. */
type Named = (path: string, slot: number | undefined) => Pick<LegendItem, 'label' | 'value' | 'memo' | 'chipHtml'>;

/**
 * The notes in the row over the plots (its numbers are the pointer's readout, R7; a Δ's headline is the Figure's own):
 * the recording measured against, or what to do while nothing is compared; then the steps bypassed and the region.
 * Empty while computing.
 */
export function stageModeHeadline(frame: { strings: Pick<UiStrings, 'stageVsBase' | 'stageChooseRoles' | 'stepBypassing' | 'stepRegion'>; waiting: boolean; referencePath: string | null; comparePath: string | null; named: Named }, bypassed: readonly string[], region: { start: number; end: number } | null): string {
    const { strings, waiting, referencePath, comparePath } = frame;
    // While computing, the plots say so (with the files in): the headline waits for the levels.
    let text = waiting ? ''
        : referencePath ? strings.stageVsBase.replace('{file}', frame.named(referencePath, 0).label)
        // No compare role yet: the lines are there, but nothing to measure against a base; the legend's chips set one.
        : comparePath ? '' : strings.stageChooseRoles;
    // The steps bypassed are named: what is drawn is the chain without them.
    if (bypassed.length && !waiting) text += strings.stepBypassing.replace('{ops}', bypassed.join(', '));
    // The part of the files compared, while a region is set.
    if (region && !waiting && comparePath) text += ` · ${strings.stepRegion} ${secondsSpanText(region.start, region.end)}`;
    // With nothing named before them, the bypassed steps and the region lead.
    return text.replace(/^\s*(·\s*)?/, '');
}

/** Colour is the role's: a recording without one has its own (`fallback`, the track's colour), its name in the legend too. */
export const colorOf = (role: (path: string) => number | undefined, path: string, fallback: string): string => ROLE_COLORS[role(path) ?? -1] ?? fallback;

/** The legend: the base (with how a group's curve is made), the compared recording, the other recordings on screen. */
export function overlayLegendItems(frame: { comparePath: string | null; referencePath: string | null; role: (path: string) => number | undefined; named: Named; strings: Pick<UiStrings, 'stageBaseNoLine' | 'stageBaseAggregate'> }, others: readonly StageTrack[], base: {
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
        // A base group not analysed is not drawn, as its entry says. (Measured against the base slot's recording, the base has no line.)
        ...(comparePath && !referencePath ? [{ color: ROLE_COLORS[0], label: base.title + (base.gated ? strings.stageBaseNoLine : ''),
            ...(base.group ? { trailingHtml: `<button type="button" class="tb-link stage-base-more" data-action="stage-base-info" aria-label="${escapeHtml(base.aggregate ?? strings.stageBaseAggregate)}">▾</button>` } : {}) }] : []),
        ...(comparePath ? [{ color: roleColor(comparePath, ROLE_COLORS[1]), ...frame.named(comparePath, frame.role(comparePath)), active: true, held: base.held, ...base.playable(comparePath) }] : []),
        ...others.map(track => ({ color: roleColor(track.filePath, track.color), ...frame.named(track.filePath, frame.role(track.filePath)), ...base.playable(track.filePath) })),
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

/** What the comparison says with no figure to show: a trigger that found no event says so (and what to do), else that the step is not drawn. */
export function emptyStageText(strings: Pick<UiStrings, 'stepNotDrawable' | 'stageNoEvents'>, picture: StageView | null | undefined): string {
    return picture?.events ? strings.stageNoEvents : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
}
