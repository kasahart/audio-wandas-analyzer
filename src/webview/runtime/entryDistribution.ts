/**
 * Markup for the entry screen's distribution: one row per group, a histogram of the chosen value (a dot per
 * recording when a group has few), a rug tick per member, the slotted rows as ticks in their role colours and
 * the base as a dashed median. The x axis sits in its own strip, so many groups scroll and the axis stays.
 * Bars are neutral; only the slots carry colour. Pure markup: entryRuntime.ts handles the drag that picks a range.
 */
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { UiStrings } from '../../shared/i18n/strings';
import { binCounts, DISTRIBUTION_BINS, DOTS_BELOW, median, type Distribution } from '../../shared/dataset/distribution';
import { niceTicks } from '../../shared/utils/ticks';

/** The group's name and count on the left, a little room on the right, the axis strip below. */
export const DIST_MARGINS = { left: 92, right: 12, axis: 38 };
/** On the right the groups share the height between these; folded above the table they are low. */
export const DIST_ROW_MIN = 52, DIST_ROW_MAX = 120, DIST_STRIP_ROW = 30;

/** Role colours, as the slot chips have them (CSS custom properties of the entry screen). */
const SLOT_COLORS = ['var(--entry-base)', 'var(--entry-compare)', 'var(--entry-slot-2)', 'var(--entry-slot-3)'];

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
    format(value: number): string;
    name(key: string): string;
}

export interface DistributionScale { low: number; high: number; width: number; height: number; x(value: number): number; at(x: number): number }

const num = (value: number): string => value.toFixed(1);

export function distributionScale(dist: Distribution, width: number, height: number): DistributionScale {
    const { left, right } = DIST_MARGINS;
    const span = Math.max(1, width - left - right);
    return {
        low: dist.low, high: dist.high, width, height,
        x: value => left + (value - dist.low) / (dist.high - dist.low) * span,
        at: x => dist.low + (x - left) / span * (dist.high - dist.low),
    };
}

/** The groups' rows (an SVG of the plot) and the axis strip (another SVG), with the scale both were drawn on. */
export function distributionSvg(dist: Distribution, picture: DistributionPicture, strings: UiStrings): { plot: string; axis: string; scale: DistributionScale } {
    const { width, rowHeight, strip, range } = picture;
    const { left, right } = DIST_MARGINS;
    const height = dist.groups.length * rowHeight + 6;
    const scale = distributionScale(dist, width, height);
    const { x } = scale;
    const binWidth = (dist.high - dist.low) / DISTRIBUTION_BINS;
    let svg = `<svg class="entry-dist-plot" data-entry-dist-plot width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(strings.dsDistLabel)}">`;
    if (range) svg += `<rect data-dist-range x="${num(x(range.low))}" y="0" width="${num(Math.max(1, x(range.high) - x(range.low)))}" height="${height}" fill="currentColor" fill-opacity="0.07"/>`;
    dist.groups.forEach((group, index) => {
        const top = index * rowHeight + 4, base = top + rowHeight - 6;
        const label = `${picture.groupPrefix}${picture.labels.get(group.name) ?? group.name}` || strings.dsFilterBlank;
        svg += `<g data-dist-group="${escapeHtml(group.name)}">`;
        svg += `<text x="4" y="${top + 16}" class="entry-dist-name">${escapeHtml(label.length > 11 ? `${label.slice(0, 10)}…` : label)}<title>${escapeHtml(group.name || strings.dsFilterBlank)}</title></text>`;
        if (!strip) svg += `<text x="4" y="${top + 31}" class="entry-dist-count">${group.members.length} ${escapeHtml(picture.unitLabel)}</text>`;
        svg += `<line x1="${left}" x2="${width - right}" y1="${base}" y2="${base}" class="entry-dist-floor"/>`;
        if (group.members.length < DOTS_BELOW) {
            // Too few for a histogram: one dot per member, stacked upward where they would cover each other
            // (two channels of one recording often land on the same value), so each can be pointed at.
            const levels: number[] = [];
            for (const member of [...group.members].sort((a, b) => a.value - b.value)) {
                const cx = x(member.value);
                let level = levels.findIndex(last => cx - last >= 8);
                if (level < 0) level = levels.length;
                levels[level] = cx;
                const cy = Math.max(top + 4, base - 6 - 8 * level);
                svg += `<circle data-dist-dot data-key="${escapeHtml(member.key)}" cx="${num(cx)}" cy="${cy}" r="3.5" class="${member.inRange && range ? 'is-in' : ''}"><title>${escapeHtml(`${picture.name(member.key)} ${picture.format(member.value)}`)}</title></circle>`;
            }
        } else {
            const { counts, inRange, max } = binCounts(group.members, dist.low, dist.high);
            counts.forEach((count, bin) => {
                if (!count) return;
                // A bin of a few still shows: at least 2 px.
                const barHeight = Math.max(2, count / max * (rowHeight - 12));
                const x0 = x(dist.low + bin * binWidth), x1 = x(dist.low + (bin + 1) * binWidth);
                const from = picture.format(dist.low + bin * binWidth), to = picture.format(dist.low + (bin + 1) * binWidth);
                svg += `<rect data-bin="${bin}" x="${num(x0)}" y="${num(base - barHeight)}" width="${num(Math.max(1, x1 - x0 - 1))}" height="${num(barHeight)}" class="${range && inRange[bin] ? 'is-in' : ''}"><title>${escapeHtml(`${label} · ${from}–${to} · ${count} ${picture.unitLabel}`)}</title></rect>`;
            });
            // The rug: a tick per member, so a few far from the rest show even where their bar is 2 px.
            // Thinned to one tick per half pixel: 30,000 members draw what can be seen, not 30,000 segments.
            const ticks = [...new Set(group.members.map(member => Math.round(x(member.value) * 2) / 2))];
            svg += `<path class="entry-dist-rug" d="${ticks.map(tick => `M${tick} ${base + 1}v5`).join('')}"/>`;
            if (!strip) svg += `<text x="4" y="${top + 43}" class="entry-dist-max">${escapeHtml(strings.dsDistMax.replace('{n}', String(max)))}</text>`;
        }
        // The slots: the rows in 1–3 (and 0) as ticks in their colours; the base as the group's median when 0 is empty.
        for (const slot of picture.slots) {
            if (slot.group !== group.name) continue;
            svg += `<line data-dist-slot="${slot.slot}" x1="${num(x(slot.value))}" x2="${num(x(slot.value))}" y1="${top + 2}" y2="${base}" stroke="${SLOT_COLORS[slot.slot]}" stroke-width="2"><title>${escapeHtml(picture.name(slot.key))}</title></line>`;
        }
        if (picture.baseGroup === group.name) {
            const middle = median(group.members.map(member => member.value));
            if (middle !== null) svg += `<line data-dist-base x1="${num(x(middle))}" x2="${num(x(middle))}" y1="${top + 2}" y2="${base}" stroke="${SLOT_COLORS[0]}" stroke-width="2" stroke-dasharray="3 2"/>`;
        }
        svg += '</g>';
    });
    svg += `<rect data-dist-brush x="0" y="0" width="0" height="${height}" class="entry-dist-brush" visibility="hidden"/></svg>`;
    // The axis: the quantity and its unit below the numbers; on the left, what a bar's height counts.
    let axis = `<svg class="entry-dist-axis-svg" width="${width}" height="${DIST_MARGINS.axis}" viewBox="0 0 ${width} ${DIST_MARGINS.axis}" aria-hidden="true">`;
    axis += `<line x1="${left}" x2="${width - right}" y1="2" y2="2" class="entry-dist-axis-line"/>`;
    for (const tick of niceTicks(dist.low, dist.high, Math.max(2, Math.floor((width - left - right) / 70)))) {
        axis += `<line x1="${num(x(tick))}" x2="${num(x(tick))}" y1="2" y2="6" class="entry-dist-axis-line"/><text x="${num(x(tick))}" y="17" text-anchor="middle" class="entry-dist-tick">${escapeHtml(String(+tick.toPrecision(6)))}</text>`;
    }
    axis += `<text data-dist-axis-label x="${(left + width - right) / 2}" y="32" text-anchor="middle" class="entry-dist-quantity">${escapeHtml(picture.axisLabel)}</text>`;
    if (!strip) axis += `<text x="4" y="32" class="entry-dist-count">${escapeHtml(strings.dsDistCountAxis.replace('{unit}', picture.unitLabel))}</text>`;
    axis += '</svg>';
    return { plot: svg, axis, scale };
}
