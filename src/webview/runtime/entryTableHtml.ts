/**
 * Markup for the entry screen: one row per recording and channel with four columns (the file, its channel, the
 * group it belongs to and the value on show), each header with a spreadsheet-like ▾ (sort, search, a check list
 * or a range); the row's tools (▶, its slot, a memo, take it out) right after its name; the filters as chips;
 * the CSV rows and recordings that did not match, with why. Text is limited to names, numbers and short labels;
 * actions are `data-action` attributes handled by entryRuntime.ts.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { titledHintAttr as hintAttr } from './hintFooter';
import { summarizeAudioCandidates } from '../../shared/dataset/asdData';
import { groupOf, middleEllipsis, valueOf, type ColumnId, type DatasetFilter, type DatasetRow, type GroupId, type Results, type Unmatched, type ValueId } from '../../shared/dataset/datasetTable';

export type EntryStrings = UiStrings;

/** A column of the table, as its header names it. */
export interface DatasetColumn { id: ColumnId; label: string; numeric: boolean; title?: string }

export interface DatasetScreenView {
    /** The rows on screen (filtered, sorted) and how many rows there are in all. */
    rows: readonly DatasetRow[];
    results: Results;
    group: GroupId;
    value: ValueId;
    columns: { name: DatasetColumn; ch: DatasetColumn; group?: DatasetColumn; value: DatasetColumn };
    filters: readonly DatasetFilter[];
    sort: { column: 'name' | 'ch' | 'group' | 'value'; descending: boolean };
    /** Row keys in slots 0–3. */
    slots: readonly (string | null)[];
    focused: string | null;
    playing: string | null;
    memo: ReadonlyMap<string, string>;
    /** Whether the value on show is computed for every row on screen. */
    valueReady: boolean;
    /** Files whose results are of an earlier chain: greyed. */
    stale?: ReadonlySet<string>;
    /** Files shown as tracks in the track view: ☑ in the first column and a bold name. */
    shown?: ReadonlySet<string>;
    /** The head's ⊟ takes the listed files off: showing the rest was just tried and they did not all come (the browser's limit). */
    tracksAllOff?: boolean;
    mode: 'all' | 'unmatched' | 'excluded';
    unmatched: readonly Unmatched[];
    /** A filter of a column shows ▼ (on) in its header. */
    filtered: ReadonlySet<ColumnId>;
    /** Differences fixed with D, under the row they were fixed on (muted, not counted anywhere). */
    derived?: (row: DatasetRow) => readonly DerivedItem[];
}

/** A difference fixed on the comparison (D), as its row under its parent shows it. */
export interface DerivedItem { key: string; label: string; value: string; stale: boolean; title: string; parentPath: string; region: string; baseLabel: string }

/**
 * The lines drawn for a scroll position: those on screen and a margin around them (10 above, 20 below), the
 * rest left to spacers, so 100,000 rows scroll as 40 do. A height not known yet counts as 600 px.
 */
export function rowWindow(scrollTop: number, clientHeight: number, lines: number, rowHeight: number): { first: number; last: number } {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 10);
    return { first, last: Math.min(lines, first + Math.ceil((clientHeight || 600) / rowHeight) + 20) };
}

/** The table's lines: each row, then the differences fixed on it. */
/** Each view's lines, made once: scrolling 100,000 rows asks for them on every frame. */
const linesOf = new WeakMap<object, Array<DatasetRow | DerivedItem>>();
export function tableLines(view: Pick<DatasetScreenView, 'rows' | 'derived' | 'mode'>): Array<DatasetRow | DerivedItem> {
    let lines = linesOf.get(view);
    if (!lines) {
        lines = !view.derived || view.mode !== 'all' ? [...view.rows] : view.rows.flatMap(row => [row, ...view.derived!(row)]);
        linesOf.set(view, lines);
    }
    return lines;
}
const isDerived = (line: DatasetRow | DerivedItem): line is DerivedItem => 'baseLabel' in line;

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
                <div class="entry-held" data-entry-held hidden>
                    <span data-entry-held-title></span>
                    <canvas data-entry-held-canvas></canvas>
                </div>
            </div>
            <canvas class="entry-overview" data-entry-overview aria-label="${escapeHtml(strings.ariaEntryOverview)}"${hintAttr(strings.hintOverview)}></canvas>
        </aside>
    </div>
    <div class="entry-footer">
        <span data-entry-slots></span>
        <span class="entry-spacer"></span>
        <span class="entry-keys" data-entry-keys></span>
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
                        <span class="entry-dist-n" data-entry-dist-count></span>
                        <span class="entry-compute" data-entry-compute></span>
                        <span class="entry-spacer"></span>
                        <span class="entry-dist-legend" data-entry-dist-legend></span>
                    </div>
                    <div class="entry-dist-note" data-entry-dist-note></div>
                    <div class="entry-dist-groups" data-entry-dist-groups></div>
                    <div class="entry-dist-axis" data-entry-dist-axis></div>
                    <div class="entry-dist-empty" data-entry-dist-empty hidden></div>
                </div>`;
}

/** The value and group selects' options: the CSV's numeric columns, then what is computed from the sound. */
export function valueOptionsHtml(options: ReadonlyArray<{ id: ValueId; label: string; computed: boolean; ready: boolean }>, chosen: ValueId, strings: EntryStrings): string {
    const group = (computed: boolean, title: string): string => {
        const items = options.filter(option => option.computed === computed);
        return items.length ? `<optgroup label="${escapeHtml(title)}">${items.map(option => `<option value="${escapeHtml(option.id)}"${option.id === chosen ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</optgroup>` : '';
    };
    return group(false, strings.dsFromCsv) + group(true, strings.dsFromSound);
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
        ? `<span class="entry-tracks-confirm" role="alert">${escapeHtml(strings.dsTracksConfirm.replace('{n}', tracks.confirm.toLocaleString()))}`
            + `<button type="button" class="is-primary" data-action="entry-tracks-all-go">${escapeHtml(strings.dsTracksConfirmGo)}</button>`
            + `<button type="button" data-action="entry-tracks-all-cancel">${escapeHtml(strings.dsCancel)}</button></span>`
        : '';
    return confirm + tracksChip + chips + `<button type="button" class="entry-fadd" data-action="entry-fadd">${escapeHtml(strings.dsFilterAdd)}</button>`;
}

export function datasetColsHtml(view: Pick<DatasetScreenView, 'columns' | 'mode'>): string {
    // The name and its four tools, then the channel, group and value right after them; spare width stays at the right end.
    const group = view.mode === 'all' && view.columns.group ? '<col class="entry-col-group-w">' : '';
    return view.mode === 'unmatched'
        ? '<col class="entry-col-name-w"><col class="entry-col-reason-w"><col>'
        : `<col class="entry-col-mark-w"><col class="entry-col-name-w"><col class="entry-col-ch-w">${group}<col class="entry-col-value-w"><col class="entry-col-fill-w">`;
}

export function datasetHeadHtml(view: DatasetScreenView, strings: EntryStrings): string {
    if (view.mode === 'unmatched') return `<tr><th>${escapeHtml(strings.entryColFile)}</th><th>${escapeHtml(strings.dsReason)}</th><th></th></tr>`;
    const head = (sortKey: DatasetScreenView['sort']['column'], column: DatasetColumn, extra = '', disabled = false): string => {
        const sorted = view.sort.column === sortKey;
        const on = view.filtered.has(column.id);
        const arrow = sorted ? (view.sort.descending ? ' ↓' : ' ↑') : '';
        const hint = disabled ? strings.dsNotComputed : on ? strings.dsFilterOn : strings.dsFilterHead;
        return `<th class="${column.numeric ? 'entry-num ' : ''}${sorted ? 'is-sorted' : ''}" data-column="${escapeHtml(column.id)}"><span class="entry-th">`
            + `<span class="entry-th-label"${disabled ? hintAttr(strings.dsNotComputed) : column.title ? hintAttr(column.title) : ''}>${escapeHtml(column.label)}${extra}${arrow}</span>`
            // A value not computed yet has nothing to sort or filter by: no ▾, and its header says why.
            + (disabled ? '' : `<button type="button" class="entry-fbtn${on ? ' is-on' : ''}" data-action="entry-fhead" data-column="${escapeHtml(column.id)}" data-sort="${sortKey}" aria-label="${escapeHtml(`${column.label} ${strings.dsFilterHead}`)}"${hintAttr(hint)}>${on ? '▼' : '▾'}</button>`) + '</span></th>';
    };
    const count = ` <span class="entry-th-count">${escapeHtml(strings.dsRows.replace('{n}', view.rows.length.toLocaleString()))}</span>`;
    return `<tr>${trackHeadHtml(view, strings)}${head('name', view.columns.name, count)}${head('ch', view.columns.ch)}${view.columns.group ? head('group', view.columns.group) : ''}${head('value', view.columns.value, '', !view.valueReady)}<th></th></tr>`;
}

/** The ☐/⊟/☑ over the marks: none, some or all of the listed files on a track; a click shows them all, or takes them all off. */
function trackHeadHtml(view: DatasetScreenView, strings: EntryStrings): string {
    const files = new Set(view.rows.map(row => row.filePath));
    if (view.mode !== 'all' || !files.size) return '<th class="entry-mark"></th>';
    const on = [...files].filter(filePath => view.shown?.has(filePath)).length;
    const state = on === 0 ? 'none' : on === files.size ? 'all' : 'some';
    const label = state === 'all' || (state === 'some' && view.tracksAllOff) ? strings.dsTracksNone.replace('{n}', files.size.toLocaleString())
        : state === 'some' ? strings.dsTracksRest.replace('{n}', (files.size - on).toLocaleString())
            : strings.dsTracksAll.replace('{n}', files.size.toLocaleString());
    return `<th class="entry-mark is-${state}"><button type="button" class="entry-mark-all" data-action="entry-tracks-all" aria-pressed="${state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}" aria-label="${escapeHtml(label)}"${hintAttr(label)}>${state === 'all' ? '☑' : state === 'some' ? '⊟' : '☐'}</button></th>`;
}

/** The value as the table shows it: one decimal for levels, whole hertz, two decimals for a ratio or a CSV number as written. */
export function formatValue(value: ValueId, number: number | null): string {
    if (number === null) return '—';
    const text = value === 'peak' ? String(Math.round(number)) : value === 'crest' ? number.toFixed(2) : value.startsWith('csv:') ? String(+number.toPrecision(6)) : number.toFixed(1);
    return text.replace(/^-/, '−');
}

/** How many of a name's last characters stay in sight however narrow its column: the run number and the extension. */
const NAME_TAIL = 10;

/** A file's name cut in its middle when the column is narrow (the head takes the ellipsis); the full path is its tooltip. */
function nameHtml(name: string, title: string): string {
    const short = middleEllipsis(name, 48);
    const attrs = `title="${escapeHtml(title)}"`;
    if (short.length <= NAME_TAIL + 4) return `<span class="entry-nm" ${attrs}>${escapeHtml(short)}</span>`;
    const cut = short.length - NAME_TAIL;
    // The two halves are separate boxes, which a screen reader would read with a space between: it reads the whole name instead.
    return `<span class="entry-nm is-split" ${attrs}><span class="entry-nm-head" aria-hidden="true">${escapeHtml(short.slice(0, cut))}</span><span class="entry-nm-tail" aria-hidden="true">${escapeHtml(short.slice(cut))}</span><span class="entry-nm-full">${escapeHtml(name)}</span></span>`;
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
        if (isDerived(line)) {
            return `<tr class="entry-row is-derived${line.stale ? ' is-stale' : ''}" data-derived="${escapeHtml(line.key)}"><td class="entry-mark"></td>`
                + `<td class="entry-name"><span class="entry-ncell"><span class="entry-nm" title="${escapeHtml(line.title)}">${escapeHtml(line.label)}</span><span class="entry-rowtools"><button type="button" class="entry-rbtn" data-action="entry-derived-remove" data-parent="${escapeHtml(line.parentPath)}" data-region="${escapeHtml(line.region)}" data-base="${escapeHtml(line.baseLabel)}" aria-label="${escapeHtml(strings.dsDerivedRemove)}"${hintAttr(strings.dsDerivedRemove)}>×</button></span></span></td>`
                + `<td class="entry-num entry-col-ch is-single"></td>${view.columns.group ? '<td class="entry-col-group"></td>' : ''}<td class="entry-num entry-col-value">${escapeHtml(line.value)}</td><td></td></tr>`;
        }
        const row = line;
        const classes = ['entry-row'];
        if (row.key === view.focused) classes.push('is-focused');
        if (view.stale?.has(row.filePath)) classes.push('is-stale');
        const shown = !!view.shown?.has(row.filePath);
        if (shown) classes.push('is-shown');
        if (view.mode === 'excluded') classes.push('is-excluded');
        const value = view.valueReady || valueOf(row, view.value, view.results) !== null ? formatValue(view.value, valueOf(row, view.value, view.results)) : '—';
        const group = view.columns.group ? `<td class="entry-col-group" title="${escapeHtml(groupOf(row, view.group))}">${escapeHtml(middleEllipsis(groupOf(row, view.group), 16) || '—')}</td>` : '';
        return `<tr class="${classes.join(' ')}" data-key="${escapeHtml(row.key)}" data-file-path="${escapeHtml(row.filePath)}" aria-selected="${row.key === view.focused}">`
            // ☑ on a track, ☐ not (not ●, a step's output): a click, T, or Enter / Space on it shows or takes off its track.
            // The focused row's is the one Tab reaches.
            + (view.mode === 'excluded' ? '<td class="entry-mark"></td>' : `<td class="entry-mark" data-action="entry-row-track" data-key="${escapeHtml(row.key)}" role="checkbox" tabindex="${row.key === view.focused ? 0 : -1}" aria-checked="${shown}" aria-label="${escapeHtml(`${strings.dsTrackMark}: ${row.name}`)}">${shown ? '☑' : '☐'}</td>`)
            + `<td class="entry-name"><span class="entry-ncell">${nameHtml(row.name, `${row.filePath}${(row.channels ?? 1) > 1 ? ` · ch ${row.ch} / ${row.channels}` : ''}`)}<span class="entry-rowtools">${toolsHtml(row, view, strings)}</span></span></td>`
            + `<td class="entry-num entry-col-ch${(row.channels ?? 1) > 1 ? '' : ' is-single'}">${row.channels === undefined ? '—' : row.ch}</td>${group}`
            + `<td class="entry-num entry-col-value">${value}</td><td></td></tr>`;
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
        + hit.slice(0, LIST_MAX).map(([value, count]) => `<label class="entry-ck" title="${escapeHtml(value)}"><input type="checkbox" data-entry-fvalue="${escapeHtml(value)}"${checked.has(value) ? ' checked' : ''}><span class="entry-ck-v">${escapeHtml(value ? middleEllipsis(value, 28) : strings.dsFilterBlank)}</span><span class="entry-ck-n">${count.toLocaleString()}</span></label>`).join('')
        + (hit.length > LIST_MAX ? `<div class="entry-ck-more">${escapeHtml(strings.dsFilterMore.replace('{n}', (hit.length - LIST_MAX).toLocaleString()))}</div>` : '')
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
    const say = (text: string, count: { recordings: number; channels: number }): string => text.replace('{n}', count.recordings.toLocaleString()).replace('{m}', count.channels.toLocaleString());
    return `<div class="entry-batch" role="dialog" aria-label="${escapeHtml(strings.dsBatch)}" data-entry-batch><b>${escapeHtml(strings.dsBatch)}</b>`
        + option('filtered', say(strings.dsBatchFiltered, filtered)) + option('all', say(strings.dsBatchAll, all))
        + `<div class="entry-fpop-label">${escapeHtml(strings.dsBatchNote)}</div>`
        + `<div class="entry-fpop-bar"><button type="button" class="entry-primary" data-action="entry-batch-go">${escapeHtml(strings.dsBatchGo)}</button><button type="button" data-action="entry-batch-cancel">${escapeHtml(strings.dsCancel)}</button></div></div>`;
}

/** The empty base chip's menu: which group's median is the base (slot 1's by default), or the selected recording. */
export function baseMenuHtml(groups: ReadonlyArray<{ name: string; label: string }>, chosen: string | null, canUseRow: boolean, strings: EntryStrings): string {
    const item = (name: string | null, label: string): string => `<button type="button" role="menuitemradio" aria-checked="${chosen === name}" class="entry-mi" data-action="entry-base-group" data-group="${escapeHtml(name ?? '')}" data-auto="${name === null}">${escapeHtml(label)}${chosen === name ? ' ✓' : ''}</button>`;
    return `<div class="entry-slotmenu entry-basemenu" role="menu" aria-label="${escapeHtml(strings.dsBaseMenu)}" data-entry-basemenu><b>${escapeHtml(strings.dsBaseMenu)}</b>`
        + item(null, strings.dsBaseAuto)
        + groups.map(group => item(group.name, strings.dsBaseGroupMedian.replace('{group}', group.label))).join('')
        + `<button type="button" role="menuitem" class="entry-mi" data-action="entry-base-row"${canUseRow ? '' : ' disabled'}>${escapeHtml(strings.dsBaseRow)}</button></div>`;
}

export function memoPopHtml(name: string, text: string, strings: EntryStrings): string {
    return `<div class="entry-memo" role="dialog" aria-label="${escapeHtml(strings.dsRowMemo)}" data-entry-memo><b>${escapeHtml(name)}</b>`
        + `<textarea data-entry-memo-text aria-label="${escapeHtml(strings.dsRowMemo)}" placeholder="${escapeHtml(strings.dsMemoPlaceholder)}">${escapeHtml(text)}</textarea>`
        + `<div class="entry-fpop-bar"><button type="button" class="entry-primary" data-action="entry-memo-close">${escapeHtml(strings.dsMemoClose)}</button></div></div>`;
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

/**
 * The slots 0–3: an empty one puts the selected row in when pressed; a filled one goes to its row (it is never
 * overwritten by a press); × empties it. Slot 0 empty is the group's median, which compares need no choice for.
 */
export function entrySlotsHtml(slots: readonly (string | null)[], label: (key: string) => string, baseLabel: string, strings: EntryStrings, heldSlot: number | null = null,
    /** Per slot, a note on its chip: e.g. its file is another slot's track, shown as that slot's channel. */
    notes: readonly (string | null)[] = []): string {
    // The base (a file, or a group's median when slot 0 is empty), then only the slots in use: an empty one says nothing the keys 1–3 do not.
    // While nothing is compared, an empty slot 1 shows where a recording goes (and lights up when Enter finds nothing to compare).
    const comparing = slots.slice(1).some(Boolean);
    return [0, 1, 2, 3].filter(slot => slot === 0 || slots[slot] || (slot === 1 && !comparing)).map(slot => {
        const key = slots[slot] ?? null;
        const hint = (key ? strings.dsSlotFilledHint : strings.dsSlotEmptyHint) + (notes[slot] ? ` · ${notes[slot]}` : '');
        const chip = slotHtml({
            slot, label: key ? label(key) : slot === 0 ? baseLabel : strings.slotEmpty, empty: !key && slot !== 0, active: slot === 0, held: heldSlot === slot && !!key, classes: 'entry-chip',
            attributes: ` data-action="entry-slot" data-slot="${slot}"${hintAttr(hint.replaceAll('{n}', String(slot)))}`,
        });
        const clear = key ? `<button type="button" class="entry-slot-x" data-action="entry-slot-clear" data-slot="${slot}" aria-label="${escapeHtml(strings.dsSlotClear.replace('{n}', String(slot)))}"${hintAttr(strings.dsSlotClear.replace('{n}', String(slot)))}>×</button>` : '';
        return `<span class="entry-slot-wrap">${chip}${clear}</span>`;
    }).join('');
}

/** Dialogs close on Escape, like every dialog in the panel. */
export function closesEntryDialog(event: Pick<KeyboardEvent, 'key'>): boolean {
    return event.key === 'Escape';
}

