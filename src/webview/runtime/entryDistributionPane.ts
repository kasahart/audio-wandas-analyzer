/**
 * The entry screen's distribution of the value over the groups: on the right while choosing, folded above the
 * table (low rows, two in view) while a comparison is open. Rows without the value are counted, not drawn. A drag
 * on it picks a range of the value; a press that stays put picks that bin; on a dot, it goes to that row.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { distribution, groupLabels, type Distribution } from '../../shared/dataset/distribution';
import { groupOf, isComputed, valueOf, type DatasetRow, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { DIST_ROW_MAX, DIST_ROW_MIN, DIST_STRIP_ROW, distributionLegendHtml, distributionSvg, pickedRange, type DistributionScale } from './entryDistribution';

/** The axis strip below the groups, and the room it needs. */
const DIST_AXIS_SPACE = 44;
/** A press that moves less than this is a click (a bin, a dot), not a drag. */
const DRAG_PX = 4;

/** What the table gives the distribution each time it is drawn. */
export interface DistributionInputs {
    /** The rows it draws from: not excluded, through every filter but the one on the value itself. */
    pool: readonly DatasetRow[];
    value: ValueId;
    group: GroupId;
    results: ReadonlyMap<string, ScanResult>;
    /** The range picked on the value. */
    range: { low: number; high: number } | null;
    /** Whether a row's value counts (a computed one only when it is of the current chain). */
    usable(row: DatasetRow): boolean;
    slots: readonly (string | null)[];
    rowOf(key: string | null): DatasetRow | undefined;
    /** The group whose median is the base (slot 0 empty, a grouping chosen), or null. */
    baseGroup: string | null;
    valueLabel: string;
    format(value: number): string;
    rowName(key: string): string;
}

export interface DistributionPaneDeps {
    screen: HTMLElement;
    strings: UiStrings;
    /** A range of the value picked on the plot. */
    pick(range: { low: number; high: number }): void;
    /** A dot pressed: that row. */
    dot(key: string): void;
    /** A drag given up. */
    cancelled(): void;
}

export interface DistributionPane {
    /** On the right (maximized) or folded above the table. */
    place(maximized: boolean): void;
    paint(inputs: DistributionInputs): void;
    /** What was drawn last, for tests. */
    last(): Distribution | null;
}

export function createDistributionPane(deps: DistributionPaneDeps): DistributionPane {
    const { screen, strings } = deps;
    const query = <T extends Element>(selector: string): T => {
        const element = screen.querySelector<T>(selector);
        if (!element) throw new Error(`entry screen: no ${selector}`);
        return element;
    };
    const box = query<HTMLElement>('[data-entry-dist]');
    const area = query<HTMLElement>('[data-entry-dist-area]');
    const groups = query<HTMLElement>('[data-entry-dist-groups]');
    const axis = query<HTMLElement>('[data-entry-dist-axis]');
    const empty = query<HTMLElement>('[data-entry-dist-empty]');
    const note = query<HTMLElement>('[data-entry-dist-note]');
    const count = query<HTMLElement>('[data-entry-dist-count]');
    const legend = query<HTMLElement>('[data-entry-dist-legend]');
    const entryBody = query<HTMLElement>('.entry-body');
    let strip = true;
    /** Just folded above the table: its two rows in view go to the compared row's group. */
    let scrollToSlot = false;
    /** What was drawn last: its scale maps a drag on it to the value's range. */
    let scale: DistributionScale | null = null;
    let drawn: Distribution | null = null;
    let drag: { x0: number; left: number; moved: boolean; dot: string | null } | null = null;

    function place(maximized: boolean): void {
        if (maximized) { if (box.parentElement !== area) area.prepend(box); }
        else if (box.nextElementSibling !== entryBody) entryBody.before(box);
        if (!maximized && !screen.classList.contains('is-dist-strip')) scrollToSlot = true;
        screen.classList.toggle('is-dist-strip', !maximized);
        strip = !maximized;
    }

    function paint(inputs: DistributionInputs): void {
        if (screen.hidden) return;
        const { pool, value, group, results, range, usable, slots, rowOf, baseGroup } = inputs;
        const dist = distribution(pool, value, group, results, range, usable);
        drawn = dist;
        const members = dist.groups.reduce((sum, item) => sum + item.members.length, 0);
        const unit = dist.unit === 'ch' ? strings.dsCh : strings.dsUnitRecording;
        const labels = groupLabels(dist.groups.map(item => item.name));
        if (group === 'none') labels.set('', strings.dsDistAll);
        const prefix = group === 'ch' ? `${strings.dsCh} ` : '';
        count.textContent = members
            ? `${members.toLocaleString()} ${unit}${dist.groups.length > 4 ? ` · ${strings.dsDistGroups.replace('{n}', String(dist.groups.length))}` : ''}`
            : strings.dsRows.replace('{n}', pool.length.toLocaleString());
        const legendHtml = members ? distributionLegendHtml(slots, baseGroup !== null ? `${prefix}${labels.get(baseGroup) ?? baseGroup}` : null, strings) : '';
        if (legend.innerHTML !== legendHtml) legend.innerHTML = legendHtml;
        note.textContent = members && !range && !strip ? strings.dsDistDrag : '';
        box.dataset.groups = String(dist.groups.length);
        box.dataset.drawn = String(members);
        box.dataset.missing = String(dist.missing);
        box.dataset.unit = dist.unit;
        if (!members) {
            groups.innerHTML = ''; axis.innerHTML = ''; scale = null;
            // Folded beside the tracks, nothing drawn says nothing: 「計算」 in the head is the way on.
            empty.hidden = strip;
            empty.textContent = isComputed(value) && dist.missing ? strings.dsDistNotComputed.replace('{value}', inputs.valueLabel) : strings.dsDistEmpty;
            return;
        }
        empty.hidden = true;
        // On the right the groups share the height (taller bars read better); above the table they stay low.
        const available = Math.max(0, area.clientHeight - groups.offsetTop - DIST_AXIS_SPACE);
        const rowHeight = strip ? DIST_STRIP_ROW : Math.max(DIST_ROW_MIN, Math.min(DIST_ROW_MAX, Math.floor(available / dist.groups.length)));
        groups.style.maxHeight = `${strip ? 2 * DIST_STRIP_ROW + 8 : Math.max(available, 2 * DIST_ROW_MIN)}px`;
        const width = Math.max(240, groups.clientWidth || box.clientWidth || 400);
        const keys = new Set(pool.map(row => row.key));
        const slotted = slots.flatMap((key, slot) => {
            const row = rowOf(key);
            const number = row && keys.has(row.key) && usable(row) ? valueOf(row, value, results) : null;
            return row && number !== null ? [{ slot, key: row.key, group: groupOf(row, group), value: number }] : [];
        });
        const picture = distributionSvg(dist, {
            width, rowHeight, strip, range, slots: slotted, baseGroup, labels, groupPrefix: prefix, unitLabel: unit,
            axisLabel: value.startsWith('csv:') ? strings.dsDistCsvAxis.replace('{col}', value.slice(4)) : inputs.valueLabel,
            format: inputs.format, name: inputs.rowName,
        }, strings);
        scale = picture.scale;
        groups.innerHTML = picture.plot;
        axis.innerHTML = picture.axis;
        if (strip && scrollToSlot) {
            scrollToSlot = false;
            const compared = slotted.find(item => item.slot > 0) ?? slotted[0];
            const index = compared ? dist.groups.findIndex(item => item.name === compared.group) : -1;
            if (index >= 0) groups.scrollTop = Math.max(0, index * rowHeight - 4);
        }
    }

    groups.addEventListener('pointerdown', event => {
        const plot = (event.target as Element).closest?.('[data-entry-dist-plot]');
        if (!plot || !scale || event.button !== 0) return;
        const bounds = plot.getBoundingClientRect();
        drag = { x0: event.clientX - bounds.left, left: bounds.left, moved: false, dot: (event.target as Element).closest?.('[data-dist-dot]')?.getAttribute('data-key') ?? null };
        (plot as Element & { setPointerCapture?(id: number): void }).setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    groups.addEventListener('pointermove', event => {
        if (!drag) return;
        const x = event.clientX - drag.left;
        if (Math.abs(x - drag.x0) >= DRAG_PX) drag.moved = true;
        const brush = groups.querySelector('[data-dist-brush]');
        brush?.setAttribute('x', String(Math.min(x, drag.x0)));
        brush?.setAttribute('width', String(Math.abs(x - drag.x0)));
        brush?.setAttribute('visibility', drag.moved ? 'visible' : 'hidden');
    });
    groups.addEventListener('pointerup', event => {
        const ended = drag, on = scale;
        drag = null;
        if (!ended || !on) return;
        if (!ended.moved && ended.dot) { deps.dot(ended.dot); return; }
        const range = pickedRange(on, ended.x0, event.clientX - ended.left, ended.moved);
        if (range) deps.pick(range);
    });
    groups.addEventListener('pointercancel', () => { drag = null; deps.cancelled(); });

    return { place, paint, last: () => drawn };
}
