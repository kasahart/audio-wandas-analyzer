/**
 * Markup for the entry screen: one row per file, the condition the row belongs to, and three numbers.
 * Text is limited to column names, numbers and a few button labels; actions are `data-action`
 * attributes handled by entryRuntime.ts.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { BAND_CENTERS_HZ, bandLabel, isOutlierRow, maxBandDelta, type EntryColumn, type EntryConditionColumn, type EntryModel, type EntryRow } from './entryTable';

export type EntryStrings = Pick<UiStrings,
    | 'entryColFile' | 'entryColCondition' | 'entryColLeq' | 'entryColPeak' | 'entryOpen' | 'entryPasteConditions'
    | 'entryOutliers' | 'entryBaseGroup' | 'entryBase' | 'entryCount' | 'entryNoOutliers' | 'entryKeyHoldDelta'
    | 'entryKeySlot' | 'entryUnreadable' | 'entryConditionsApply' | 'entryConditionsClear' | 'entryConditionsClose'
    | 'entryConditionsPlaceholder' | 'hintColumnsMore' | 'hintFailedFilter' | 'hintOutlierFilter' | 'hintSortMark' | 'hintOverview'
    | 'slotEmpty' | 'entryUnavailable' | 'entryShape' | 'entryCalibrated' | 'entryBandUnit' | 'hintCalibratedColumn' | 'hintRowSlot' | 'hintRowBase' | 'hintRowHide' | 'hintRowRemove' | 'hintEntryMaximize' | 'hintLeqUncalibrated' | 'hintScatterAxis' | 'hintBandSelect' | 'hintEntryProgress' | 'hintBaseChip' | 'hintSlotCard' | 'hintSlotEmpty' | 'hintRowPlay' | 'hintRowStop' | 'hintComparedFilter' | 'entryCompared'>;

export interface EntryView {
    model: EntryModel;
    /** Files with a result so far, for the progress count. */
    scanned: number;
    total: number;
    /** File paths in slots 0–3. */
    slots: readonly (string | null)[];
    focused: string | null;
    delta: boolean;
    filter: 'all' | 'outliers' | 'failed' | 'compared';
    /** Shows the metadata columns that do not decide the condition. */
    expanded: boolean;
    /** While 0 is held with a file in slot 0, Δ is against that file instead of each row's condition. */
    baseRow?: EntryRow;
    /** The Recipe's chain does not end in a spectrum or band levels: Leq only, no band columns. */
    leqOnly?: boolean;
    /** Rows measured with an earlier chain: shown greyed until scanned again. */
    stale?: ReadonlySet<string>;
    /** Files shown as tracks in the track view, and whether each is hidden there (👁). */
    shown?: ReadonlyMap<string, boolean>;
    /** What the files in slots 1–3 are compared against: the slot-0 file, or the other files of their conditions. */
    base?: ReadonlySet<string>;
    /** The file playing in the track view. */
    playing?: string | null;
    /**
     * The rows in groups (the side panel's: by subfolder, files added from elsewhere first), each with its heading;
     * a folded group shows its heading only. Without it, or with one group, the rows are not grouped.
     */
    groups?: { of(row: EntryRow): string; label(key: string): string; folded: ReadonlySet<string> };
}

/** The rows group by group, by key; each group keeps the rows' own order (the table's sort). */
function grouped(rows: EntryRow[], of: (row: EntryRow) => string): Array<[string, EntryRow[]]> {
    const groups = new Map<string, EntryRow[]>();
    for (const row of rows) {
        const key = of(row);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    // Keys sort as the groups are shown: files added from elsewhere ('0') first, then the folders ('1…') by name.
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A row's own controls: ▶ plays it, 0 makes it the base, 1 2 3 put it in a slot; a file shown as a track has 👁 (show / hide) and ×. */
function trackCell(row: EntryRow, view: Pick<EntryView, 'shown' | 'playing' | 'slots'>, strings: EntryStrings): string {
    if (row.derived) return '<td class="entry-track-col"></td>';
    const path = escapeHtml(row.filePath);
    const hidden = view.shown?.get(row.filePath);
    // ▶ plays the file alone (shown as a track while it plays); ■ stops it.
    const playing = view.playing === row.filePath;
    const playHint = playing ? strings.hintRowStop : strings.hintRowPlay;
    const play = row.status === 'failed' ? ''
        : `<button type="button" class="entry-row-btn entry-row-play${playing ? ' is-playing' : ''}" data-action="entry-row-play" data-path="${path}" aria-pressed="${playing}" aria-label="${escapeHtml(playHint)}"${hintAttr(playHint)}>${playing ? '■' : '▶'}</button>`;
    const slotButtons = row.status !== 'ok' ? '' : [0, 1, 2, 3].map(slot => {
        const hint = slot === 0 ? strings.hintRowBase : strings.hintRowSlot.replaceAll('{n}', String(slot));
        const inSlot = view.slots[slot] === row.filePath;
        return `<button type="button" class="entry-row-btn entry-row-slot slot-${slot}${inSlot ? ' is-in' : ''}" data-action="entry-row-slot" data-slot="${slot}" data-path="${path}" aria-pressed="${inSlot}" aria-label="${escapeHtml(hint)}"${hintAttr(hint)}>${slot}</button>`;
    }).join('');
    if (hidden === undefined) return `<td class="entry-track-col">${play}${slotButtons}</td>`;
    return `<td class="entry-track-col is-shown">${play}${slotButtons}<button type="button" class="entry-row-btn" data-action="entry-row-hide" data-path="${path}" aria-pressed="${hidden}" aria-label="${escapeHtml(strings.hintRowHide)}"${hintAttr(strings.hintRowHide)}>${hidden ? '◌' : '👁'}</button>`
        + `<button type="button" class="entry-row-btn" data-action="entry-row-remove" data-path="${path}" aria-label="${escapeHtml(strings.hintRowRemove)}"${hintAttr(strings.hintRowRemove)}>×</button></td>`;
}

/** The condition columns on screen: the checked ones, and the rest while expanded. */
export function shownColumns(view: Pick<EntryView, 'model' | 'expanded'>): EntryConditionColumn[] {
    return view.model.columns.filter(column => column.checked || view.expanded);
}

/** The calibration column is shown only when some file is calibrated: a column that is always empty says nothing. */
function calibratedColumn(model: EntryModel): boolean {
    return model.rows.some(row => row.status === 'ok' && !row.derived && !row.uncalibrated);
}

function hiddenCount(view: Pick<EntryView, 'model'>): number {
    return view.model.columns.filter(column => !column.checked).length;
}

const fmt = (value: number | null, digits: number): string => (value === null ? '—' : value.toFixed(digits).replace(/^-/, '−'));
const signed = (value: number | null): string => (value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`);

export function entryScreenHtml(strings: EntryStrings): string {
    return `<section id="entry-screen" class="entry-screen" data-entry-screen hidden aria-label="${escapeHtml(strings.entryColFile)}">
    <div class="entry-bar">
        <div class="entry-seg" role="group">
            <button type="button" class="entry-filter" data-action="entry-filter-outliers" aria-pressed="false"${hintAttr(strings.hintOutlierFilter)}><span class="entry-seg-dot" aria-hidden="true"></span>${escapeHtml(strings.entryOutliers)} <span data-entry-count="outliers">0</span></button>
            <button type="button" class="entry-filter" data-action="entry-filter-failed" aria-pressed="false"${hintAttr(strings.hintFailedFilter)}>${escapeHtml(strings.entryUnavailable)} <span data-entry-count="failed">0</span></button>
            <button type="button" class="entry-filter entry-filter-compared" data-action="entry-filter-compared" aria-pressed="false" hidden${hintAttr(strings.hintComparedFilter)}>${escapeHtml(strings.entryCompared)} <span data-entry-count="compared">0</span></button>
        </div>
        <button type="button" class="step-chip" data-action="entry-paste-conditions"><span data-entry-source>${escapeHtml(strings.entryPasteConditions)}</span><svg class="step-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3h10M1 9h10"/><circle cx="4" cy="3" r="1.6"/><circle cx="8" cy="9" r="1.6"/></svg></button>
        <span class="entry-progress awa-tag" data-entry-progress${hintAttr(strings.hintEntryProgress)}>0 / 0</span>
        <span class="entry-stale" data-entry-stale></span>
        <span class="entry-spacer"></span>
        <button type="button" data-action="entry-export-csv">CSV</button>
        <button type="button" class="entry-primary" data-action="entry-open">${escapeHtml(strings.entryOpen)} <kbd>Enter</kbd></button>
        <button type="button" class="entry-size" data-action="entry-maximize" aria-pressed="false"${hintAttr(strings.hintEntryMaximize)}>⤢</button>
    </div>
    <div class="entry-body">
        <div class="entry-table-wrap"><table class="entry-table" data-entry-table><thead data-entry-head></thead><tbody data-entry-rows></tbody></table></div>
        <aside class="entry-side">
            <div class="entry-scatter">
                <select data-action="entry-axis-y" aria-label="y"${hintAttr(strings.hintScatterAxis)}></select>
                <canvas data-entry-scatter></canvas>
                <select class="entry-axis-x" data-action="entry-axis-x" aria-label="x"${hintAttr(strings.hintScatterAxis)}></select>
                <span class="entry-point-tip" data-entry-point-tip hidden></span>
                <div class="entry-held" data-entry-held hidden>
                    <span data-entry-held-title></span>
                    <canvas data-entry-held-canvas></canvas>
                </div>
            </div>
            <canvas class="entry-overview" data-entry-overview aria-label="1/3 oct"${hintAttr(strings.hintOverview)}></canvas>
        </aside>
    </div>
    <div class="entry-footer">
        <span data-entry-slots></span>
        <span class="entry-spacer"></span>
        <span class="entry-keys" data-entry-keys></span>
    </div>
    <div class="entry-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(strings.entryPasteConditions)}" data-entry-dialog hidden>
        <textarea data-entry-paste rows="6" placeholder="${escapeHtml(strings.entryConditionsPlaceholder)}"></textarea>
        <div class="entry-dialog-columns" data-entry-columns></div>
        <div class="entry-dialog-bar">
            <span data-entry-unmatched></span>
            <span class="entry-spacer"></span>
            <button type="button" data-action="entry-conditions-clear">${escapeHtml(strings.entryConditionsClear)}</button>
            <button type="button" data-action="entry-conditions-close">${escapeHtml(strings.entryConditionsClose)}</button>
            <button type="button" class="entry-primary" data-action="entry-conditions-apply">${escapeHtml(strings.entryConditionsApply)}</button>
        </div>
    </div>
</section>`;
}

export function entryHeadHtml(view: Pick<EntryView, 'model' | 'delta' | 'expanded' | 'leqOnly'>, strings: EntryStrings): string {
    const { model, delta } = view;
    // While the scan runs the rows keep the files' order, so the arrow is greyed until they sort by Δ.
    const sortMark = (column: EntryColumn): string => (model.sort === column
        ? ` <span class="entry-sort${model.order === 'file' ? ' is-pending' : ''}"${hintAttr(strings.hintSortMark)}>▼Δ</span>` : '');
    const level = (label: string, column: EntryColumn): string => (delta && column !== 'peak' ? `Δ ${label}` : label);
    const conditionHeads = shownColumns(view).map((column, position) => (column.index < 0
        ? `<th class="entry-col-cond">${escapeHtml(strings.entryColCondition.replace('{n}', String(position + 1)))}</th>`
        : `<th class="entry-col-cond"><button type="button" class="entry-column${column.checked ? ' is-checked' : ''}" data-action="entry-column" data-column="${column.index}" aria-pressed="${column.checked}">${escapeHtml(column.name)}</button></th>`)).join('');
    const hidden = hiddenCount(view);
    const more = hidden ? `<th class="entry-more-col entry-col-cond"><button type="button" data-action="entry-columns-more" aria-expanded="${view.expanded}"${hintAttr(strings.hintColumnsMore)}>${view.expanded ? '−' : `+${hidden}`}</button></th>` : '';
    // Only bands some file has a level for: the rest would fill the column with "—".
    const measured = BAND_CENTERS_HZ.map((_, band) => band).filter(band => band === model.band || model.rows.some(row => row.levels?.[band] !== null && row.levels?.[band] !== undefined));
    const bandOptions = measured.map(band => `<option value="${band}"${band === model.band ? ' selected' : ''}>${escapeHtml(bandLabel(band))}</option>`).join('');
    const calibration = calibratedColumn(view.model) ? `<th class="entry-col-cal"${hintAttr(strings.hintCalibratedColumn)}>${escapeHtml(strings.entryCalibrated)}</th>` : '';
    const unit = strings.entryBandUnit.replace('{unit}', view.model.rows.some(row => row.status === 'ok' && row.uncalibrated) && !calibratedColumn(view.model) ? 'dBFS' : 'dB');
    return `<tr>
        <th class="entry-badge-col"></th>
        <th>${escapeHtml(strings.entryColFile)}</th>
        <th class="entry-track-col"></th>
        ${calibration}
        ${conditionHeads}${more}
        <th class="entry-num entry-col-leq${model.sort === 'leq' ? ' is-sorted' : ''}"><button type="button" class="entry-sort-button" data-action="entry-sort-leq"${model.rows.some(row => row.uncalibrated) ? hintAttr(strings.hintLeqUncalibrated) : ''}>${escapeHtml(level(strings.entryColLeq, 'leq'))}</button>${sortMark('leq')}</th>
        ${view.leqOnly ? '' : `<th class="entry-num entry-col-peak">${escapeHtml(strings.entryColPeak)}</th>
        <th class="entry-num entry-col-band${model.sort === 'band' ? ' is-sorted' : ''}"><select data-action="entry-band" aria-label="1/3 oct"${hintAttr(strings.hintBandSelect)}>${bandOptions}</select><button type="button" class="entry-sort-button" data-action="entry-sort-band">${delta ? 'Δ dB' : escapeHtml(unit)}</button>${sortMark('band')}</th>`}
    </tr>`;
}

function badge(row: EntryRow, slots: readonly (string | null)[]): string {
    const slot = slots.indexOf(row.filePath);
    if (slot >= 0) return `<span class="entry-badge entry-slot-${slot}">${slot}</span>`;
    if (row.status === 'failed') return '<span class="entry-badge entry-failed">✕</span>';
    return '';
}

/** The row's Δ in `column`: against its condition's other files, or against the slot-0 file while 0 is held. */
function deltaOf(row: EntryRow, column: EntryColumn, base: EntryRow | undefined): { value: number | null; band?: number } {
    if (!base || row.derived) {
        return column === 'peak' ? { value: row.delta.peak, band: row.values.peak === null ? undefined : BAND_CENTERS_HZ.indexOf(row.values.peak as typeof BAND_CENTERS_HZ[number]) } : { value: row.delta[column] };
    }
    if (column === 'peak') {
        const max = row.levels && base.levels && row !== base ? maxBandDelta(row.levels, [base.levels]) : null;
        return max ? { value: max.delta, band: max.band } : { value: null };
    }
    const value = row.values[column], reference = base.values[column];
    return { value: value === null || reference === null ? null : value - reference };
}

/** One number of a row; its column's class lets a narrow table show only the columns that fit (the sorted one first). */
function cell(row: EntryRow, column: EntryColumn, delta: boolean, sorted: EntryColumn, base?: EntryRow): string {
    const columnClass = `entry-num entry-col-${column}${column === sorted ? ' is-sorted' : ''}`;
    if (row.status !== 'ok') return `<td class="${columnClass}">—</td>`;
    // A row fixed with D is a difference: it always reads as Δ.
    if (row.derived) delta = true;
    const classes = [columnClass];
    if (row.outlier[column] && isOutlierRow(row) && !delta) classes.push('entry-outlier');
    const shown = deltaOf(row, column, delta ? base : undefined);
    // "Δ max band" always reads as a band and its Δ: "3.15 kHz +14.9".
    if (column === 'peak') {
        if (delta) classes.push('entry-delta');
        return `<td class="${classes.join(' ')}">${shown.band === undefined || shown.band < 0 ? '—' : `${escapeHtml(bandLabel(shown.band))} ${signed(shown.value)}`}</td>`;
    }
    if (delta) {
        classes.push('entry-delta');
        return `<td class="${classes.join(' ')}">${signed(shown.value)}</td>`;
    }
    return `<td class="${classes.join(' ')}">${fmt(row.values[column], 1)}</td>`;
}

function rowVisible(row: EntryRow, filter: EntryView['filter']): boolean {
    return filter === 'all' || (filter === 'failed' ? row.status === 'failed' || (row.status === 'mismatch' && !row.derived) : isOutlierRow(row));
}

/**
 * "Compared only": the files in slots 1–3, then their base, nearest its median first (the smallest
 * Δ max band), so the top base row is the one to listen to as the base's typical sound.
 */
export function comparedRows(view: Pick<EntryView, 'model' | 'slots' | 'base'>): EntryRow[] {
    const live = view.model.rows.filter(row => !row.derived);
    const slotted = view.slots.slice(1).flatMap(path => live.filter(row => row.filePath === path));
    const distance = (row: EntryRow): number => Math.abs(row.delta.peak ?? row.delta.leq ?? Infinity);
    const base = live.filter(row => view.base?.has(row.filePath) && !slotted.includes(row)).sort((a, b) => distance(a) - distance(b));
    // Each compared file is followed by its own base (its condition's files), so two conditions do not mix.
    const listed = new Set<EntryRow>();
    const rows: EntryRow[] = [];
    for (const row of slotted) {
        rows.push(row);
        const own = view.slots[0] ? base : base.filter(member => member.group !== undefined && member.group === row.group);
        for (const member of own) if (!listed.has(member)) { listed.add(member); rows.push(member); }
    }
    return [...rows, ...base.filter(member => !listed.has(member))];
}

export function entryRowsHtml(view: EntryView, strings: EntryStrings): string {
    if (view.filter === 'compared') return rowsHtml(comparedRows(view), view, strings);
    const rows = view.model.rows.filter(row => rowVisible(row, view.filter));
    const groups = view.groups ? grouped(rows, view.groups.of) : [];
    if (!view.groups || groups.length < 2) return rowsHtml(rows, view, strings);
    // A group's heading folds or opens it; the number is how many of its rows the filter shows.
    return groups.map(([key, members]) => {
        const folded = view.groups!.folded.has(key);
        return `<tr class="entry-group" data-group="${escapeHtml(key)}"><td colspan="99"><button type="button" data-action="entry-group-toggle" data-group="${escapeHtml(key)}" aria-expanded="${!folded}">`
            + `${folded ? '▸' : '▾'} ${escapeHtml(view.groups!.label(key))} <span class="entry-group-count">${members.length}</span></button></td></tr>`
            + (folded ? '' : rowsHtml(members, view, strings));
    }).join('');
}

function rowsHtml(rows: EntryRow[], view: EntryView, strings: EntryStrings): string {
    const withCalibration = calibratedColumn(view.model);
    const calibration = (row: EntryRow): string => (withCalibration ? `<td class="entry-col-cal">${row.status === 'ok' && !row.uncalibrated ? '✓' : ''}</td>` : '');
    const columns = shownColumns(view);
    const span = columns.length + (hiddenCount(view) ? 1 : 0);
    return rows.map(row => {
        const classes = ['entry-row'];
        if (row.filePath === view.focused) classes.push('is-focused');
        if (isOutlierRow(row)) classes.push('is-outlier');
        if (row.status !== 'ok') classes.push(`is-${row.status}`);
        const cells = columns.map(column => {
            const value = row.cells[view.model.columns.indexOf(column)];
            return `<td class="entry-col-cond${column.numeric ? ' entry-num' : ''}">${escapeHtml(value || '—')}</td>`;
        }).join('') + (hiddenCount(view) ? '<td class="entry-col-cond"></td>' : '');
        const conditions = row.status === 'mismatch'
            ? `<td colspan="${span}" class="entry-mark entry-col-cond">${escapeHtml(row.derived ? row.mismatch! : `${strings.entryShape}：${row.mismatch!.replace(/^≠ /, '')}`)}</td>`
            : row.status === 'failed'
                ? `<td colspan="${span}" class="entry-mark entry-col-cond"${row.reason ? ' ' + hintAttr(row.reason) : ''}>${escapeHtml(strings.entryUnreadable)}</td>`
                : cells;
        if (row.derived) classes.push('is-derived');
        if (view.stale?.has(row.filePath)) classes.push('is-stale');
        if (view.shown?.has(row.filePath)) classes.push('is-shown');
        if (view.base?.has(row.filePath)) classes.push('is-base');
        return `<tr class="${classes.join(' ')}" data-file-path="${escapeHtml(row.filePath)}" aria-selected="${row.filePath === view.focused}">`
            + `<td class="entry-badge-col">${badge(row, view.slots)}</td><td class="entry-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>${trackCell(row, view, strings)}${calibration(row)}${conditions}`
            + `${cell(row, 'leq', view.delta, view.model.sort, view.baseRow)}${view.leqOnly ? '' : cell(row, 'peak', view.delta, view.model.sort, view.baseRow) + cell(row, 'band', view.delta, view.model.sort, view.baseRow)}</tr>`;
    }).join('');
}

/** The base-group chip's text: "Base group · L3 · 900rpm · 7 files", or the slot-0 file when the row has no condition. */
export function baseChipText(view: Pick<EntryView, 'model' | 'slots' | 'focused'>, strings: EntryStrings): string {
    // A file in slot 0 is the base that holding 0 measures against.
    const slotted = view.slots[0] ? view.model.rows.find(row => row.filePath === view.slots[0]) : undefined;
    if (slotted) return `${strings.entryBase} · ${slotted.name}`;
    // The comparison measures slot 1 against its group, so the chip names that group once slot 1 is set.
    const anchor = view.model.rows.find(row => row.filePath === (view.slots[1] ?? view.focused));
    const members = anchor?.group ? view.model.groups.get(anchor.group) : undefined;
    if (anchor && members) {
        // The focused row is measured against the others of its condition, so they are what the chip counts.
        const others = members.length - (members.includes(anchor) ? 1 : 0);
        // Too few files to tell an outlier: the count only, never a reassuring "no outliers".
        const count = members.length < 3 ? `n ${others}` : strings.entryCount.replace('{count}', String(others));
        return [strings.entryBaseGroup, ...anchor.conditions, count].join(' · ');
    }
    const base = view.slots[0] ? view.model.rows.find(row => row.filePath === view.slots[0]) : undefined;
    return base ? `${strings.entryBase} · ${base.name}` : `${strings.entryBaseGroup} · —`;
}

/**
 * One slot as both screens draw it: a number box in its role's colour (0 blue, 1–3 yellow) and a label.
 * Empty is a dashed outline with an outlined box; in use is the box filled; active (the base, the file
 * compared) is tinted in the role colour; held is filled with it.
 */
export function slotHtml(options: {
    slot: number; label: string; empty?: boolean; active?: boolean; held?: boolean; classes?: string; attributes?: string; disabled?: boolean;
}): string {
    const role = options.slot === 0 ? 'base' : 'compare';
    const states = [options.empty ? 'is-empty' : '', options.active ? 'is-active' : '', options.held ? 'is-held' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="awa-slot role-${role} slot-${options.slot} ${options.classes ?? ''} ${states}"${options.attributes ?? ''}${options.disabled ? ' disabled' : ''}>`
        + `<span class="awa-slot-num">${options.slot}</span> <span class="awa-slot-label">${escapeHtml(options.label)}</span></button>`;
}

export function entrySlotsHtml(view: EntryView, strings: EntryStrings, heldSlot: number | null = null): string {
    const name = (filePath: string | null): string => (filePath ? view.model.rows.find(row => row.filePath === filePath)?.name ?? '' : '');
    const chips = [slotHtml({
        slot: 0, label: baseChipText(view, strings), active: true, held: view.delta, classes: 'entry-chip entry-chip-base',
        attributes: ` data-action="entry-slot" data-slot="0"${hintAttr(strings.hintBaseChip)}`,
    })];
    for (let slot = 1; slot <= 3; slot++) {
        const path = view.slots[slot] ?? null;
        chips.push(slotHtml({
            slot, label: path ? name(path) : strings.slotEmpty, empty: !path, held: heldSlot === slot && !!path, classes: 'entry-chip',
            attributes: ` data-action="entry-slot" data-slot="${slot}"${hintAttr(path ? strings.hintSlotCard : strings.hintSlotEmpty.replace('{n}', String(slot)))}`,
        }));
    }
    return chips.join('');
}

export function conditionColumnsHtml(columns: readonly string[], checked: readonly number[]): string {
    return columns.map((column, index) => `<label><input type="checkbox" data-entry-column="${index}"${checked.includes(index) ? ' checked' : ''}> ${escapeHtml(column)}</label>`).join('');
}

/** The paste dialog closes on Escape, like every dialog in the panel. */
export function closesEntryDialog(event: Pick<KeyboardEvent, 'key'>): boolean {
    return event.key === 'Escape';
}
