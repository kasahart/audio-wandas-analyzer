/**
 * Markup for the entry screen: one row per recording and channel with its columns (the file, its channel, what its
 * header says of it (length, sample rate) and whether it is calibrated, the group it belongs to and the CSV value
 * on show), each header with a spreadsheet-like ▾ (sort, search, a check list
 * or a range); the row's tools (▶, its slot, a memo, take it out) right after its name; the filters as chips;
 * the CSV rows and recordings that did not match, with why. Text is limited to names, numbers and short labels;
 * actions are `data-action` attributes handled by entryRuntime.ts.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { uiNumber } from '../../shared/utils/format';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { withMinus } from '../shell/numberText';
import { summarizeAudioCandidates } from '../../shared/dataset/asdData';
import { graphemes } from '../../shared/utils/graphemes';
import { groupOf, infoNumber, middleEllipsis, valueOf, type ColumnId, type DatasetFilter, type DatasetRow, type GroupId, type InfoId, type SortColumn, type Unmatched, type ValueId } from '../../shared/dataset/datasetTable';

export type EntryStrings = UiStrings;

/** A column of the table, as its header names it. */
export interface DatasetColumn { id: ColumnId; label: string; numeric: boolean; title?: string }

export interface DatasetScreenView {
    /** The rows on screen (filtered, sorted) and how many rows there are in all. */
    rows: readonly DatasetRow[];
    group: GroupId;
    value: ValueId;
    /** `info`: the file's own information (length, sample rate, calibration); `value`: the CSV column on show, when there is one. */
    columns: { name: DatasetColumn; ch: DatasetColumn; info: ReadonlyArray<DatasetColumn & { id: InfoId }>; group?: DatasetColumn; value?: DatasetColumn };
    filters: readonly DatasetFilter[];
    sort: { column: SortColumn; descending: boolean };
    /** Row keys in slots 0–3. */
    slots: readonly (string | null)[];
    focused: string | null;
    playing: string | null;
    memo: ReadonlyMap<string, string>;
    /** Files shown as tracks in the track view: ☑ in the first column and a bold name. */
    shown?: ReadonlySet<string>;
    /** The head's ⊟ takes the listed files off: showing the rest was just tried and they did not all come (the browser's limit). */
    tracksAllOff?: boolean;
    mode: 'all' | 'unmatched' | 'excluded';
    unmatched: readonly Unmatched[];
    /** A filter of a column shows ▼ (on) in its header. */
    filtered: ReadonlySet<ColumnId>;
}


/**
 * Every row of the table is exactly this tall, whatever it holds (#781): a value that arrives, a tool that shows on
 * hover or a level's own calibration word never moves the rows under it. The CSS sets it (comparisonDocument.ts) and
 * rowWindow counts with it, so the spacers stand for exactly the rows they replace.
 */
export const ENTRY_ROW_HEIGHT = 24;
/**
 * Widened (where the value column shows), the head is this many lines tall from the start, whatever the value
 * column's name is (#781); beside the tracks it is one row (ENTRY_ROW_HEIGHT): the name grows when
 * the folder's reference is known ("Leq A-weighted" becomes "Leq A-weighted, uncalibrated [dBFS]"), and the rows
 * under the head must not move when it does. A name that needs more lines than this is clamped; its hint is whole.
 */
export const ENTRY_HEAD_LINES = 3;
/** The head's line height in px (CSS), so its height is ENTRY_HEAD_LINES of them whatever font is on screen. */
export const ENTRY_HEAD_LINE_PX = 15;

/**
 * The lines drawn for a scroll position: those on screen and a margin around them (10 above, 20 below), the
 * rest left to spacers, so 100,000 rows scroll as 40 do. A height not known yet counts as 600 px.
 */
export function rowWindow(scrollTop: number, clientHeight: number, lines: number, rowHeight: number): { first: number; last: number } {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 10);
    return { first, last: Math.min(lines, first + Math.ceil((clientHeight || 600) / rowHeight) + 20) };
}

/** The table's lines: its rows. */
export const tableLines = (view: Pick<DatasetScreenView, 'rows'>): readonly DatasetRow[] => view.rows;

export function entryScreenHtml(strings: EntryStrings): string {
    return `<section id="entry-screen" class="entry-screen" data-entry-screen hidden aria-label="${escapeHtml(strings.entryColFile)}">
    <div class="entry-bar">
        <span class="entry-spacer"></span>
        <button type="button" class="entry-filter" data-action="entry-view-unmatched" aria-pressed="false" hidden></button>
        <button type="button" class="entry-filter" data-action="entry-view-excluded" aria-pressed="false"${hintAttr(strings.hintExcluded)}></button>
        <button type="button" class="step-chip entry-csv-pick" data-action="entry-pick-csv"${hintAttr(strings.hintPickCsv)}><span data-entry-source>${escapeHtml(strings.dsPickCsv)}</span></button>
        <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" data-entry-csv-input hidden>
        <details class="entry-export" id="entry-export-menu"><summary${hintAttr(strings.hintEntryExport)}>${escapeHtml(strings.toolbarExportLabel)} ▾</summary><div class="entry-export-pop">
            <button type="button" data-action="entry-batch"${hintAttr(strings.hintBatch)}>${escapeHtml(strings.dsBatch)}</button>
            <button type="button" data-action="entry-export-csv"${hintAttr(strings.dsExportTable)}>${escapeHtml(strings.dsExportTable)}</button>
            <button type="button" data-action="entry-export-notes"${hintAttr(strings.hintExportNotes)}>${escapeHtml(strings.dsExportNotes)}</button>
        </div></details>
        <button type="button" class="entry-primary" data-action="entry-open">${escapeHtml(strings.entryOpen)} <kbd>Enter</kbd></button>
        <button type="button" class="entry-size" data-action="entry-maximize" aria-pressed="false"${hintAttr(strings.hintEntryMaximize)}>⤢</button>
    </div>
    <div class="entry-chips" data-entry-chips></div>
    <div class="entry-body">
        <div class="entry-table-wrap"><table class="entry-table" data-entry-table><colgroup data-entry-cols></colgroup><thead data-entry-head></thead><tbody data-entry-rows></tbody></table></div>
        <aside class="entry-side">
            <div class="entry-dist-area" data-entry-dist-area>
                ${distributionHtml(strings)}
            </div>
        </aside>
    </div>
</section>`;
}

/**
 * The distribution: what it draws (value, group) and its count, the computation and its progress, the slots'
 * legend; the groups' rows (they scroll) and the axis (it stays). Above the table while a comparison is open.
 */
function distributionHtml(strings: EntryStrings): string {
    return `<div class="entry-dist" data-entry-dist>
                    <div class="entry-dist-head">
                        <label class="entry-pick">${escapeHtml(strings.dsValue)} <select data-action="entry-value" aria-label="${escapeHtml(strings.dsValue)}"></select></label>
                        <label class="entry-pick">${escapeHtml(strings.dsGroup)} <select data-action="entry-group" aria-label="${escapeHtml(strings.dsGroup)}"></select></label>
                        <label class="entry-pick" data-entry-base-pick hidden>${escapeHtml(strings.entryBase)} <select data-action="entry-base" aria-label="${escapeHtml(strings.entryBase)}"></select></label>
                        <span class="entry-dist-n" data-entry-dist-count></span>
                        <span class="entry-compute" data-entry-compute></span>
                        <span class="entry-spacer"></span>
                        <span class="entry-dist-legend" data-entry-dist-legend></span>
                    </div>
                    <div class="entry-dist-note"><span data-entry-dist-note></span><span class="plot-readout" data-plot-readout hidden><span class="plot-readout-name"></span><span class="plot-readout-values"></span></span></div>
                    <div class="entry-dist-figure" data-entry-dist-figure hidden></div>
                    <div class="entry-dist-empty" data-entry-dist-empty hidden></div>
                </div>`;
}

/** The value select's options: the CSV's columns of numbers (the entry computes no value); with none, one option that says so. */
export function valueOptionsHtml(options: ReadonlyArray<{ id: ValueId; label: string }>, chosen: ValueId, strings: EntryStrings): string {
    if (!options.length) return `<option value="none" selected>${escapeHtml(strings.dsValueNone)}</option>`;
    return options.map(option => `<option value="${escapeHtml(option.id)}"${option.id === chosen ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

/** The distribution's legend: the slots holding a recording, each a line in its role's colour. */
export function distributionLegendHtml(slots: readonly (string | null)[], strings: Pick<UiStrings, 'entryBase' | 'dsSlotCompare'>): string {
    const swatch = (slot: number): string => `<span class="entry-dist-swatch slot-${slot}"></span>`;
    return [
        slots[0] ? `${swatch(0)}${escapeHtml(strings.entryBase)}` : '',
        ...[1, 2, 3].filter(slot => slots[slot]).map(slot => `${swatch(slot)}${escapeHtml(strings.dsSlotCompare.replace('{n}', String(slot)))}`),
    ].filter(Boolean).map(item => `<span class="entry-dist-key">${item}</span>`).join('');
}

/** A file's information as its cell writes it: its length in seconds, its sample rate in Hz, whether it is calibrated; — where not known. */
export function infoCell(row: DatasetRow, column: InfoId): string {
    if (column === 'calibration') return row.info?.calibration || '—';
    const number = infoNumber(row, column);
    if (number === null) return '—';
    return column === 'duration' ? number.toFixed(number < 10 ? 2 : 1) : String(Math.round(number));
}

export function groupOptionsHtml(options: ReadonlyArray<{ id: GroupId; label: string }>, chosen: GroupId): string {
    return options.map(option => `<option value="${escapeHtml(option.id)}"${option.id === chosen ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

/** A filter as its chip says it: "ch = 2", "score 0.30 – 0.90", "line = L1 +2 more". */
export function filterChipText(filter: DatasetFilter, label: (column: ColumnId) => string, format: (column: ColumnId, value: number) => string, strings: EntryStrings): string {
    const short = (text: string): string => middleEllipsis(text || strings.dsFilterBlank, 18);
    const name = label(filter.column);
    return filter.kind === 'range'
        ? `${name} ${format(filter.column, filter.low)} ${strings.dsFilterRangeSeparator} ${format(filter.column, filter.high)}`
        : `${name} = ${filter.values.length > 2 ? strings.dsFilterMoreValues.replace('{first}', () => short(filter.values[0])).replace('{count}', String(filter.values.length - 1)) : filter.values.map(short).join(', ')}`;
}

/** The filters as chips (× takes one off), then ＋ to filter by a column that is not on screen. */
export function filterChipsHtml(filters: readonly DatasetFilter[], label: (column: ColumnId) => string, format: (column: ColumnId, value: number) => string, strings: EntryStrings, tracks?: { count: number; only: boolean; confirm?: number }): string {
    const chips = filters.map(filter => {
        const text = filterChipText(filter, label, format, strings);
        return `<span class="entry-fchip" data-testid="fchip"><button type="button" class="entry-fchip-body" data-action="entry-fchip" data-column="${escapeHtml(filter.column)}"${hintAttr(strings.dsFilterOn)}>${escapeHtml(text)}</button>`
            + `<button type="button" class="entry-fchip-x" data-action="entry-fchip-clear" data-column="${escapeHtml(filter.column)}" aria-label="${escapeHtml(strings.dsChipRemove)}"${hintAttr(strings.dsChipRemove)}>×</button></span>`;
    }).join('');
    // The rows on a track, as a filter that is there whenever a file is on one.
    const tracksChip = tracks && (tracks.count > 0 || tracks.only)
        ? `<button type="button" class="entry-ftracks${tracks.only ? ' is-on' : ''}" data-action="entry-tracks-only" aria-pressed="${tracks.only}"${hintAttr(strings.hintTracksOnly)}>${escapeHtml(strings.dsTracksOnly.replace('{n}', String(tracks.count)))}</button>`
        : '';
    // Many files at once are analysed only once the count is confirmed.
    const confirm = tracks?.confirm
        ? `<span class="entry-tracks-confirm" role="alert">${escapeHtml(strings.dsTracksConfirm.replace('{n}', uiNumber(tracks.confirm, strings.uiLocale)))}`
            + `<button type="button" class="is-primary" data-action="entry-tracks-all-go">${escapeHtml(strings.dsTracksConfirmGo)}</button>`
            + `<button type="button" data-action="entry-tracks-all-cancel">${escapeHtml(strings.dsCancel)}</button></span>`
        : '';
    return confirm + tracksChip + chips + `<button type="button" class="entry-fadd" data-action="entry-fadd">${escapeHtml(strings.dsFilterAdd)}</button>`;
}

export function datasetColsHtml(view: Pick<DatasetScreenView, 'columns' | 'mode'>): string {
    // The name and its four tools, then the channel, group and value right after them; spare width stays at the right end.
    const group = view.mode === 'all' && view.columns.group ? '<col class="entry-col-group-w">' : '';
    const info = view.columns.info.map(column => `<col class="entry-col-info-w entry-col-${column.id}-w">`).join('');
    return view.mode === 'unmatched'
        ? '<col class="entry-col-name-w"><col class="entry-col-reason-w"><col>'
        : `<col class="entry-col-mark-w"><col class="entry-col-name-w"><col class="entry-col-ch-w">${info}${group}${view.columns.value ? '<col class="entry-col-value-w">' : ''}<col class="entry-col-fill-w">`;
}

export function datasetHeadHtml(view: DatasetScreenView, strings: EntryStrings): string {
    if (view.mode === 'unmatched') return `<tr><th>${escapeHtml(strings.entryColFile)}</th><th>${escapeHtml(strings.dsReason)}</th><th></th></tr>`;
    const head = (sortKey: DatasetScreenView['sort']['column'], column: DatasetColumn, extra = ''): string => {
        const sorted = view.sort.column === sortKey;
        const on = view.filtered.has(column.id);
        const arrow = sorted ? (view.sort.descending ? ' ↓' : ' ↑') : '';
        const hint = on ? strings.dsFilterOn : strings.dsFilterHead;
        const kind = sortKey === 'value' ? 'entry-col-value ' : sortKey === 'group' ? 'entry-col-group ' : sortKey === 'name' || sortKey === 'ch' ? '' : 'entry-col-info ';
        return `<th class="${column.numeric ? 'entry-num ' : ''}${kind}${sorted ? 'is-sorted' : ''}" data-column="${escapeHtml(column.id)}"><span class="entry-th">`
            + `<span class="entry-th-label"${column.title ? hintAttr(column.title) : sortKey === 'value' ? hintAttr(column.label) : ''}>${escapeHtml(column.label)}${extra}${arrow}</span>`
            + `<button type="button" class="entry-fbtn${on ? ' is-on' : ''}" data-action="entry-fhead" data-column="${escapeHtml(column.id)}" data-sort="${sortKey}" aria-label="${escapeHtml(`${column.label} ${strings.dsFilterHead}`)}"${hintAttr(hint)}>${on ? '▼' : '▾'}</button></span></th>`;
    };
    const count = ` <span class="entry-th-count">${escapeHtml(strings.dsRows.replace('{n}', uiNumber(view.rows.length, strings.uiLocale)))}</span>`;
    return `<tr>${trackHeadHtml(view, strings)}${head('name', view.columns.name, count)}${head('ch', view.columns.ch)}${view.columns.info.map(column => head(column.id, column)).join('')}${view.columns.group ? head('group', view.columns.group) : ''}${view.columns.value ? head('value', view.columns.value) : ''}<th></th></tr>`;
}

/** The ☐/⊟/☑ over the marks: none, some or all of the listed files on a track; a click shows them all, or takes them all off. */
function trackHeadHtml(view: DatasetScreenView, strings: EntryStrings): string {
    const files = new Set(view.rows.map(row => row.filePath));
    if (view.mode !== 'all' || !files.size) return '<th class="entry-mark"></th>';
    const on = [...files].filter(filePath => view.shown?.has(filePath)).length;
    const state = on === 0 ? 'none' : on === files.size ? 'all' : 'some';
    const label = state === 'all' || (state === 'some' && view.tracksAllOff) ? strings.dsTracksNone.replace('{n}', uiNumber(files.size, strings.uiLocale))
        : state === 'some' ? strings.dsTracksRest.replace('{n}', uiNumber(files.size - on, strings.uiLocale))
            : strings.dsTracksAll.replace('{n}', uiNumber(files.size, strings.uiLocale));
    return `<th class="entry-mark is-${state}"><button type="button" class="entry-mark-all" data-action="entry-tracks-all" aria-pressed="${state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}" aria-label="${escapeHtml(label)}"${hintAttr(label)}>${state === 'all' ? '☑' : state === 'some' ? '⊟' : '☐'}</button></th>`;
}

/** A CSV number as the table shows it: as written, to six significant figures; — for a blank. */
export function formatValue(number: number | null): string {
    return number === null ? '—' : withMinus(String(+number.toPrecision(6)));
}

/** How many of a name's last characters stay in sight however narrow its column: the run number and the extension. */
const NAME_TAIL = 10;

/** A file's name cut in its middle when the column is narrow (the head takes the ellipsis); the full path is its tooltip. */
export function nameHtml(name: string, title: string): string {
    const short = middleEllipsis(name, 48);
    const attrs = `title="${escapeHtml(title)}"`;
    // Counted in characters as seen (graphemes): the halves are separate boxes, so a cut inside an emoji or between a
    // base and its combining mark (a macOS name in NFD: カ + ゙) would never join again (#845).
    const characters = graphemes(short);
    if (characters.length <= NAME_TAIL + 4) return `<span class="entry-nm" ${attrs}>${escapeHtml(short)}</span>`;
    const cut = characters.length - NAME_TAIL;
    // The two halves are separate boxes, which a screen reader would read with a space between: it reads the whole name instead.
    return `<span class="entry-nm is-split" ${attrs}><span class="entry-nm-head" aria-hidden="true">${escapeHtml(characters.slice(0, cut).join(''))}</span><span class="entry-nm-tail" aria-hidden="true">${escapeHtml(characters.slice(cut).join(''))}</span><span class="entry-nm-full">${escapeHtml(name)}</span></span>`;
}

/** A row's tools right after its name: ▶, its slot (the badge once in one), ✎, 外す; those carrying state always show. */
function toolsHtml(row: DatasetRow, view: DatasetScreenView, strings: EntryStrings): string {
    const key = escapeHtml(row.key);
    if (view.mode === 'excluded') return `<button type="button" class="entry-rbtn" data-action="entry-row-restore" data-key="${key}"${hintAttr(strings.dsRowRestore)}>${escapeHtml(strings.dsRowRestore)}</button>`;
    const playing = view.playing === row.filePath;
    const slot = view.slots.indexOf(row.key);
    const memo = view.memo.get(row.key);
    const playHint = playing ? strings.hintRowStop : strings.hintRowPlay;
    return `<button type="button" class="entry-rbtn${playing ? ' is-on' : ' is-hover'}" data-action="entry-row-play" data-key="${key}" aria-pressed="${playing}" aria-label="${escapeHtml(playHint)}"${hintAttr(playHint)}>${playing ? '■' : '▶'}</button>`
        + `<button type="button" class="entry-rbtn entry-rbtn-slot${slot >= 0 ? ` is-on slot-${slot}` : ' is-hover'}" data-action="entry-row-slotmenu" data-key="${key}" aria-haspopup="menu" aria-label="${escapeHtml(strings.dsRowSlot)}"${hintAttr(strings.dsRowSlot)}>${slot >= 0 ? `<span class="entry-badge entry-slot-${slot}">${slot}</span>` : '0–3'}</button>`
        + `<button type="button" class="entry-rbtn${memo ? ' is-on' : ' is-hover'}" data-action="entry-row-memo" data-key="${key}" aria-label="${escapeHtml(strings.dsRowMemo)}"${hintAttr(memo ?? strings.dsRowMemo)}>✎</button>`
        + `<button type="button" class="entry-rbtn is-hover" data-action="entry-row-exclude" data-key="${key}" aria-label="${escapeHtml(strings.dsRowExclude)}"${hintAttr(strings.dsRowExclude)}>${escapeHtml(strings.dsRowExcludeShort)}</button>`;
}

/** The rows `first` to `last` of the view (the rest as spacers of `rowHeight`), so a table of 100,000 rows draws only what is on screen. */
export function datasetRowsHtml(view: DatasetScreenView, first: number, last: number, rowHeight: number, strings: EntryStrings): string {
    const spacer = (rows: number): string => (rows > 0 ? `<tr class="entry-spacer-row" aria-hidden="true" style="height:${rows * rowHeight}px"></tr>` : '');
    const lines = tableLines(view);
    const rows = lines.slice(first, last).map(line => {
        const row = line;
        const classes = ['entry-row'];
        if (row.key === view.focused) classes.push('is-focused');
        const shown = !!view.shown?.has(row.filePath);
        if (shown) classes.push('is-shown');
        if (view.mode === 'excluded') classes.push('is-excluded');
        const info = view.columns.info.map(column => `<td class="${column.numeric ? 'entry-num ' : ''}entry-col-info">${escapeHtml(infoCell(row, column.id))}</td>`).join('');
        const group = view.columns.group ? `<td class="entry-col-group" title="${escapeHtml(groupOf(row, view.group))}">${escapeHtml(middleEllipsis(groupOf(row, view.group), 16) || '—')}</td>` : '';
        return `<tr class="${classes.join(' ')}" data-key="${escapeHtml(row.key)}" data-file-path="${escapeHtml(row.filePath)}" aria-selected="${row.key === view.focused}">`
            // ☑ on a track, ☐ not (not ●, a step's output): a click, T, or Enter / Space on it shows or takes off its track.
            // The focused row's is the one Tab reaches.
            + (view.mode === 'excluded' ? '<td class="entry-mark"></td>' : `<td class="entry-mark" data-action="entry-row-track" data-key="${escapeHtml(row.key)}" role="checkbox" tabindex="${row.key === view.focused ? 0 : -1}" aria-checked="${shown}" aria-label="${escapeHtml(`${strings.dsTrackMark}: ${row.name}`)}">${shown ? '☑' : '☐'}</td>`)
            + `<td class="entry-name"><span class="entry-ncell">${nameHtml(row.name, `${row.filePath}${(row.channels ?? 1) > 1 ? ` · ch ${row.ch} / ${row.channels}` : ''}`)}<span class="entry-rowtools">${toolsHtml(row, view, strings)}</span></span></td>`
            + `<td class="entry-num entry-col-ch${(row.channels ?? 1) > 1 ? '' : ' is-single'}">${row.channels === undefined ? '—' : row.ch}</td>${info}${group}`
            + `${view.columns.value ? `<td class="entry-num entry-col-value">${formatValue(valueOf(row, view.value))}</td>` : ''}<td></td></tr>`;
    }).join('');
    return spacer(first) + rows + spacer(lines.length - last);
}

/** The CSV rows and recordings that did not match, and the recordings that could not be read, with why. */
export function unmatchedRowsHtml(items: readonly Unmatched[], unreadable: ReadonlyArray<{ filePath: string; reason: string }>, strings: EntryStrings): string {
    const reason: Record<Unmatched['reason'], string> = { missing: strings.dsReasonMissing, ambiguous: strings.dsReasonAmbiguous, repeated: strings.dsReasonRepeated, 'no-row': strings.dsReasonNoRow };
    const name = (path: string): string => path.slice(path.replace(/\\/g, '/').lastIndexOf('/') + 1);
    const detailOf = (item: Unmatched): string => item.candidates ? summarizeAudioCandidates(item.candidates, { separator: strings.dsListSeparator, more: strings.dsMoreCandidates }) : item.detail;
    return [
        ...unreadable.map(item => `<tr class="entry-row is-unmatched"><td class="entry-name" title="${escapeHtml(item.filePath)}">${escapeHtml(middleEllipsis(name(item.filePath)))}</td><td class="entry-why">${escapeHtml(strings.dsReasonUnreadable)}</td><td class="entry-why-detail">${escapeHtml(item.reason)}</td></tr>`),
        ...items.map(item => `<tr class="entry-row is-unmatched"${item.filePath ? ` data-file-path="${escapeHtml(item.filePath)}"` : ''}><td class="entry-name">${escapeHtml(item.filePath ? middleEllipsis(name(item.filePath)) : strings.dsCsvRow.replace('{n}', String(item.row)))}</td>`
            + `<td class="entry-why">${escapeHtml(reason[item.reason])}</td><td class="entry-why-detail" title="${escapeHtml(detailOf(item))}">${escapeHtml(detailOf(item))}</td></tr>`),
    ].join('');
}

/** The column's ▾: sort, clear, then a search and check list with each value's row count (a range for numbers); OK / Cancel. */
export function filterPopHtml(options: {
    column: DatasetColumn; anchored: boolean; columns: readonly DatasetColumn[]; sortKey?: DatasetScreenView['sort']['column']; sort: DatasetScreenView['sort'];
    filter?: DatasetFilter; search: string; values?: ReadonlyArray<[string, number]>; checked?: ReadonlySet<string>; range?: { low: string; high: string; min: string; max: string };
}, strings: EntryStrings): string {
    const { column } = options;
    const title = options.anchored ? `<b>${escapeHtml(column.label)}</b>`
        : `<label class="entry-fpop-col">${escapeHtml(strings.dsFilterColumn)} <select data-action="entry-fcol" aria-label="${escapeHtml(strings.dsFilterColumn)}">${options.columns.map(item => `<option value="${escapeHtml(item.id)}"${item.id === column.id ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>`;
    const sort = options.sortKey ? [false, true].map(descending => `<button type="button" class="entry-mi" data-action="entry-fsort" data-sort="${options.sortKey}" data-descending="${descending}"><span class="entry-mi-ic">${column.numeric ? (descending ? '9↓' : '1↓') : (descending ? 'Z↓' : 'A↓')}</span>${escapeHtml(descending ? strings.dsSortDesc : strings.dsSortAsc)}${options.sort.column === options.sortKey && options.sort.descending === descending ? ' ✓' : ''}</button>`).join('') + '<hr>' : '';
    const clear = `<button type="button" class="entry-mi" data-action="entry-fclear"${options.filter ? '' : ' disabled'}><span class="entry-mi-ic">⊘</span>${escapeHtml(strings.dsFilterClear.replace('{col}', column.label))}</button>`;
    const body = options.range
        ? `<div class="entry-fpop-label">${escapeHtml(strings.dsFilterRange)}</div><div class="entry-frange"><input type="number" step="any" data-entry-flow aria-label="${escapeHtml(strings.dsFilterLow)}" placeholder="${escapeHtml(options.range.min)}" value="${escapeHtml(options.range.low)}"> ${escapeHtml(strings.dsFilterRangeSeparator)} <input type="number" step="any" data-entry-fhigh aria-label="${escapeHtml(strings.dsFilterHigh)}" placeholder="${escapeHtml(options.range.max)}" value="${escapeHtml(options.range.high)}"></div>`
        : `<input type="search" data-entry-fsearch aria-label="${escapeHtml(strings.dsFilterSearch)}" placeholder="${escapeHtml(strings.dsFilterSearch)}" value="${escapeHtml(options.search)}"><div class="entry-flist" data-entry-flist role="group" aria-label="${escapeHtml(column.label)}">${checkListHtml(options.values ?? [], options.checked ?? new Set(), options.search, strings)}</div>`;
    return `<div class="entry-fpop" role="dialog" aria-label="${escapeHtml(column.label)}" data-entry-fpop>${title}${sort}${clear}${body}`
        + `<div class="entry-fpop-bar"><button type="button" class="entry-primary" data-action="entry-fok">OK</button><button type="button" data-action="entry-fcancel">${escapeHtml(strings.dsCancel)}</button></div></div>`;
}

const LIST_MAX = 200;

/** The check list of a column's values matching `search` (a tri-state "select all" over them), at most 200 drawn. */
export function checkListHtml(values: ReadonlyArray<[string, number]>, checked: ReadonlySet<string>, search: string, strings: EntryStrings): string {
    const needle = search.trim().toLowerCase();
    const hit = values.filter(([value]) => !needle || value.toLowerCase().includes(needle));
    const on = hit.filter(([value]) => checked.has(value)).length;
    const all = on === 0 ? 'false' : on === hit.length ? 'true' : 'mixed';
    return `<label class="entry-ck"><input type="checkbox" data-entry-fall${all === 'true' ? ' checked' : ''} aria-checked="${all}">${escapeHtml(needle ? strings.dsFilterAllFound : strings.dsFilterAll)}</label>`
        + hit.slice(0, LIST_MAX).map(([value, count]) => `<label class="entry-ck" title="${escapeHtml(value)}"><input type="checkbox" data-entry-fvalue="${escapeHtml(value)}"${checked.has(value) ? ' checked' : ''}><span class="entry-ck-v">${escapeHtml(value ? middleEllipsis(value, 28) : strings.dsFilterBlank)}</span><span class="entry-ck-n">${uiNumber(count, strings.uiLocale)}</span></label>`).join('')
        + (hit.length > LIST_MAX ? `<div class="entry-ck-more">${escapeHtml(strings.dsFilterMore.replace('{n}', uiNumber(hit.length - LIST_MAX, strings.uiLocale)))}</div>` : '')
        + (hit.length ? '' : `<div class="entry-ck-more">${escapeHtml(strings.dsFilterNone)}</div>`);
}

export function slotMenuHtml(key: string, slots: readonly (string | null)[], strings: EntryStrings): string {
    const at = slots.indexOf(key);
    return `<div class="entry-slotmenu" role="menu" aria-label="${escapeHtml(strings.dsRowSlot)}" data-entry-slotmenu>`
        + [0, 1, 2, 3].map(slot => `<button type="button" role="menuitemradio" aria-checked="${at === slot}" class="entry-mi" data-action="entry-row-slot" data-slot="${slot}" data-key="${escapeHtml(key)}"><span class="entry-badge entry-slot-${slot}">${slot}</span> ${escapeHtml(slot === 0 ? strings.entryBase : strings.dsSlotCompare.replace('{n}', String(slot)))}<kbd>${slot}</kbd></button>`).join('')
        + (at >= 0 ? `<button type="button" role="menuitem" class="entry-mi" data-action="entry-row-slot" data-slot="-1" data-key="${escapeHtml(key)}">${escapeHtml(strings.dsSlotOut)}</button>` : '')
        + '</div>';
}

/** 「レシピをまとめて書き出す」: the rows it is for (the filtered ones, or all), then 書き出す. */
export function batchPopHtml(filtered: { recordings: number; channels: number }, all: { recordings: number; channels: number }, choice: 'filtered' | 'all', strings: EntryStrings): string {
    const option = (value: 'filtered' | 'all', text: string): string => `<label class="entry-batch-opt"><input type="radio" name="entry-batch-scope" value="${value}" data-entry-batch-scope${choice === value ? ' checked' : ''}> ${escapeHtml(text)}</label>`;
    const say = (text: string, count: { recordings: number; channels: number }): string => text.replace('{n}', uiNumber(count.recordings, strings.uiLocale)).replace('{m}', uiNumber(count.channels, strings.uiLocale));
    return `<div class="entry-batch" role="dialog" aria-label="${escapeHtml(strings.dsBatch)}" data-entry-batch><b>${escapeHtml(strings.dsBatch)}</b>`
        + option('filtered', say(strings.dsBatchFiltered, filtered)) + option('all', say(strings.dsBatchAll, all))
        + `<div class="entry-fpop-label">${escapeHtml(strings.dsBatchNote)}</div>`
        + `<div class="entry-fpop-bar"><button type="button" class="entry-primary" data-action="entry-batch-go">${escapeHtml(strings.dsBatchGo)}</button><button type="button" data-action="entry-batch-cancel">${escapeHtml(strings.dsCancel)}</button></div></div>`;
}

/**
 * The base select beside the group one: slot 1's group median (auto), a chosen group's median, or the recording in
 * slot 0 when one is there (choosing a median takes it out). A recording is made the base from its row's 0–3 menu.
 */
export function baseOptionsHtml(groups: ReadonlyArray<{ name: string; label: string }>, chosen: string | null, slotRow: string | null, strings: EntryStrings): string {
    const option = (value: string, label: string, selected: boolean): string => `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    return (slotRow !== null ? option('row', `0 ${slotRow}`, true) : '')
        + option('auto', strings.dsBaseAuto, slotRow === null && chosen === null)
        + groups.map(group => option(`group:${group.name}`, strings.dsBaseGroupMedian.replace('{group}', group.label), slotRow === null && chosen === group.name)).join('');
}

export function memoPopHtml(name: string, text: string, strings: EntryStrings): string {
    return `<div class="entry-memo" role="dialog" aria-label="${escapeHtml(strings.dsRowMemo)}" data-entry-memo><b>${escapeHtml(name)}</b>`
        + `<textarea data-entry-memo-text aria-label="${escapeHtml(strings.dsRowMemo)}" placeholder="${escapeHtml(strings.dsMemoPlaceholder)}">${escapeHtml(text)}</textarea>`
        + `<div class="entry-fpop-bar"><button type="button" class="entry-primary" data-action="entry-memo-close">${escapeHtml(strings.dsMemoClose)}</button></div></div>`;
}

/** Dialogs close on Escape, like every dialog in the panel. */
export function closesEntryDialog(event: Pick<KeyboardEvent, 'key'>): boolean {
    return event.key === 'Escape';
}

