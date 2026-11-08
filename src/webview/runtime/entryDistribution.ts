/**
 * The entry screen's distribution as pictures for the plot component (R13): one row per group on the value's axis, a
 * histogram of the chosen value (a dot per recording when a group has few), a rug tick per member, the slotted rows
 * as ticks in their role colours and the base as a dashed median. The rows are stacked on one value axis, drawn below
 * them on its own strip, so many groups scroll and the axis stays. Bars are neutral; only the slots carry colour.
 * Pure layers and scale math: entryDistributionPane.ts lays them out and handles the gestures.
 */
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { UiStrings } from '../../shared/i18n/strings';
import { binCounts, DISTRIBUTION_BINS, DOTS_BELOW, median, type Distribution } from '../../shared/dataset/distribution';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { PaneRange } from './comparePanes';
import type { StageLayer } from './stagePanes';

/** The group's name and count on the left, a little room on the right, the axis strip below. */
export const DIST_MARGINS = { left: 92, right: 12, axis: 20 };
/** On the right the groups share the height between these; folded above the table they are low. */
export const DIST_ROW_MIN = 52, DIST_ROW_MAX = 120, DIST_STRIP_ROW = 30;
/** Each row's plot sits this far below its top and ends this far above its bottom. */
export const DIST_ROW_PAD = { top: 4, bottom: 2 };

export interface DistributionPicture {
    width: number;
    rowHeight: number;
    /** Folded above the table: no counts, no "max n". */
    strip: boolean;
    range: { low: number; high: number } | null;
    /** The slotted rows: their slot, group and value (rows not drawn, e.g. without the value, are left out). */
    slots: ReadonlyArray<{ slot: number; key: string; group: string; value: number }>;
    /** The group whose median is the base (slot 0 empty), or null. */
    baseGroup: string | null;
    labels: ReadonlyMap<string, string>;
    /** "ch " before a channel number when grouped by channel. */
    groupPrefix: string;
    axisLabel: string;
    unitLabel: string;
    /** A value's text; `step`, the bins' width, adds the digits that tell neighbouring bins apart. */
    format(value: number, step?: number): string;
    name(key: string): string;
}

/** The colours the rows are drawn in (resolved from the entry screen's CSS): neutral bars, the slots' role colours. */
export interface DistributionColours {
    bar: string;
    barIn: string;
    slots: readonly string[];
}

/** One group's row: its names beside the plot, and the plot's pictures on the value axis and its count range. */
export interface DistributionRow {
    group: string;
    label: string;
    title: string;
    count: string;
    max: string;
    layers: StageLayer[];
    range: PaneRange;
    /** The slots ticked on it, and whether the base's median is drawn on it. */
    slots: number[];
    base: boolean;
    /** Its dots (a group of few): each recording, its value and how high it is stacked (in counts). */
    dots: Array<{ key: string; value: number; level: number }>;
}

export interface DistributionScale { low: number; high: number; width: number; height: number; x: (value: number) => number; at: (x: number) => number }

/**
 * What a drag over the plot from `x0` to `x` picks: the values between (clipped to the axis), or the bin under a
 * press that stayed put; null when that leaves nothing.
 */
export function pickedRange(scale: Pick<DistributionScale, 'low' | 'high' | 'at'>, x0: number, x: number, moved: boolean): { low: number; high: number } | null {
    let low = scale.at(Math.min(x, x0)), high = scale.at(Math.max(x, x0));
    if (!moved) {
        const width = (scale.high - scale.low) / DISTRIBUTION_BINS;
        low = scale.low + Math.floor((low - scale.low) / width) * width;
        high = low + width;
    }
    low = Math.max(low, scale.low); high = Math.min(high, scale.high);
    return high > low ? { low, high } : null;
}

/**
 * The legend: what the coloured ticks are (only the slots carry colour): the slot-0 file, or the group whose
 * median is the base (`baseGroup`, its label), then the filled compared slots.
 */
export function distributionLegendHtml(slots: readonly (string | null)[], baseGroup: string | null, strings: Pick<UiStrings, 'entryBase' | 'dsLegendBaseMedian' | 'dsSlotCompare'>): string {
    const swatch = (slot: number, dashed = false): string => `<span class="entry-dist-swatch slot-${slot}${dashed ? ' is-dashed' : ''}"></span>`;
    return [
        slots[0] ? `${swatch(0)}${escapeHtml(strings.entryBase)}` : baseGroup !== null ? `${swatch(0, true)}${escapeHtml(strings.dsLegendBaseMedian.replace('{group}', baseGroup))}` : '',
        ...[1, 2, 3].filter(slot => slots[slot]).map(slot => `${swatch(slot)}${escapeHtml(strings.dsSlotCompare.replace('{n}', String(slot)))}`),
    ].filter(Boolean).map(item => `<span class="entry-dist-key">${item}</span>`).join('');
}

/** The value axis across the rows' plots: `window` (fractions of the whole axis) stretched over them. */
export function distributionScale(dist: Pick<Distribution, 'low' | 'high'>, width: number, height: number, window: { start: number; end: number } = { start: 0, end: 1 }): DistributionScale {
    const { left, right } = DIST_MARGINS;
    const span = Math.max(1, width - left - right);
    const low = dist.low + window.start * (dist.high - dist.low), high = dist.low + window.end * (dist.high - dist.low);
    return {
        low: dist.low, high: dist.high, width, height,
        x: value => left + (value - low) / (high - low) * span,
        at: x => low + (x - left) / span * (high - low),
    };
}

/** The whole value axis as a picture's axes: what every row's pictures are placed on (linear, low to high). */
export function distributionAxisView(dist: Pick<Distribution, 'low' | 'high'>): StageView {
    return { frame: 'Distribution', kind: 'line', xScale: 'linear', xs: [dist.low, dist.high], values: [null, null] };
}

const line = (xs: number[], values: (number | null)[], kind: StageView['kind'] = 'line'): StageView => ({ frame: 'Distribution', kind, xScale: 'linear', xs, values });

/** Each group's row as pictures on the value axis: the histogram or dots, the rug, the slots' ticks and the base. */
export function distributionRows(dist: Distribution, picture: DistributionPicture, colours: DistributionColours, strings: UiStrings): DistributionRow[] {
    const binWidth = (dist.high - dist.low) / DISTRIBUTION_BINS;
    const centres = Array.from({ length: DISTRIBUTION_BINS }, (_, bin) => dist.low + (bin + 0.5) * binWidth);
    const unit = picture.unitLabel;
    return dist.groups.map(group => {
        const label = `${picture.groupPrefix}${picture.labels.get(group.name) ?? group.name}` || strings.dsFilterBlank;
        const members = [...group.members].sort((a, b) => a.value - b.value);
        const memberText = (index: number): string[] => [picture.name(members[index].key), picture.format(members[index].value, binWidth)];
        const layers: StageLayer[] = [];
        const dots: DistributionRow['dots'] = [];
        let top = 1, max = '';
        if (members.length < DOTS_BELOW) {
            // Too few for a histogram: a dot per member, stacked upward where they would cover each other (two
            // channels of one recording often land on the same value), so each can be pointed at.
            const levels: number[] = [];
            const spacing = (dist.high - dist.low) / 60;
            for (const member of members) {
                let level = levels.findIndex(last => member.value - last >= spacing);
                if (level < 0) level = levels.length;
                levels[level] = member.value;
                dots.push({ key: member.key, value: member.value, level });
            }
            top = Math.max(3, levels.length);
            // Out of a picked range (or with none picked) in the bars' colour; in it, lighter.
            const all = members.map((_, index) => index);
            const parts: Array<[number[], string]> = picture.range
                ? [[all.filter(index => !members[index].inRange), colours.bar], [all.filter(index => members[index].inRange), colours.barIn]]
                : [[all, colours.bar]];
            for (const [these, color] of parts) {
                if (!these.length) continue;
                layers.push({ view: line(these.map(index => members[index].value), these.map(index => dots[index].level + 0.5)), color, width: 3.5, marks: 'dots', label, readout: at => memberText(these[at]) });
            }
        } else {
            const { counts, inRange, max: most } = binCounts(group.members, dist.low, dist.high);
            top = most * 1.08;
            if (!picture.strip) max = strings.dsDistMax.replace('{n}', String(most));
            const binText = (bin: number, count: number): string[] => [`${picture.format(dist.low + bin * binWidth, binWidth)}–${picture.format(dist.low + (bin + 1) * binWidth, binWidth)}`, `${count} ${unit}`];
            layers.push({ view: line(centres, counts.map(count => count || null), 'bar'), color: colours.bar, filled: true, fill: 1, label, readout: bin => binText(bin, counts[bin]) });
            if (picture.range) layers.push({ view: line(centres, inRange.map(count => count || null), 'bar'), color: colours.barIn, filled: true, fill: 1, label, readout: bin => binText(bin, inRange[bin]) });
            // The rug: a tick per member, so a few far from the rest show even where their bar is thin.
            layers.push({ view: line(members.map(member => member.value), members.map(() => 0)), color: colours.barIn, alpha: 0.55, width: 1, marks: 'rug', label, readout: memberText });
        }
        const range = { min: 0, max: top };
        // The slots: the rows in 1–3 (and 0) as ticks in their colours; the base as the group's median when 0 is empty.
        const slots: number[] = [];
        for (const slot of picture.slots) {
            if (slot.group !== group.name) continue;
            slots.push(slot.slot);
            layers.push({ view: line([slot.value, slot.value], [0, top]), color: colours.slots[slot.slot] ?? colours.bar, width: 2, label: picture.name(slot.key), readout: () => [picture.format(slot.value, binWidth)] });
        }
        let base = false;
        if (picture.baseGroup === group.name) {
            const middle = median(group.members.map(member => member.value));
            if (middle !== null) {
                base = true;
                layers.push({ view: line([middle, middle], [0, top]), color: colours.slots[0] ?? colours.bar, width: 2, dash: [3, 2], label: strings.dsLegendBaseMedian.replace('{group}', label), readout: () => [picture.format(middle, binWidth)] });
            }
        }
        return {
            group: group.name, label: label.length > 11 ? `${label.slice(0, 10)}…` : label, title: group.name || strings.dsFilterBlank,
            // Every bin, dot, tick and member is drawn as it is: nothing is thinned, so the drawn points are read (R7).
            count: picture.strip ? '' : `${group.members.length} ${unit}`, max, layers: layers.map(layer => ({ ...layer, full: 'drawn' as const })), range, slots, base, dots,
        };
    });
}
