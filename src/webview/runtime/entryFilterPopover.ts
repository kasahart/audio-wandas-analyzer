/**
 * The entry table's column filter, like a spreadsheet's ▾: sort, clear, and a search with a check list (a column
 * of text) or a range (a column of numbers), then OK / Cancel. It keeps the draft while it is open; the screen
 * owns the one popover box it is drawn in, and what the user chose (the filters and the order).
 */
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { finiteNumber } from '../../shared/dataset/asdData';
import { columnValues, valueOf, type ColumnId, type DatasetCsv, type DatasetFilter, type DatasetRow, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { checkListHtml, filterPopHtml, type DatasetColumn, type DatasetScreenView, type EntryStrings } from './entryTableHtml';

type SortColumn = DatasetScreenView['sort']['column'];

/** The filter open: its column, whether it hangs from that column's header, and its draft (search, checked values). */
export interface FilterDraft {
    column: ColumnId;
    anchored: boolean;
    search: string;
    /** The values ticked in the check list; null until the list is first drawn (then every value is). */
    checked: Set<string> | null;
}

export interface FilterPopoverDeps {
    screen: HTMLElement;
    /** The table's head (a header's ▾) and the chips' box (＋ filter): what the popover hangs from. */
    head: HTMLElement;
    chipsBox: HTMLElement;
    text: EntryStrings;
    /** Every row of the table, and the results its computed values come from. */
    rows(): readonly DatasetRow[];
    excluded: ReadonlySet<string>;
    results: ReadonlyMap<string, ScanResult>;
    csv(): DatasetCsv | null;
    groupOptions(): Array<{ id: GroupId; label: string }>;
    valueOptions(): Array<{ id: ValueId; label: string; computed: boolean }>;
    /** What the user chose: the filters, the order, and the columns the table groups by and shows as the value. */
    filters(): readonly DatasetFilter[];
    sort(): DatasetScreenView['sort'];
    group(): GroupId;
    value(): ValueId;
    columnLabel(column: ColumnId): string;
    numericColumn(column: ColumnId): boolean;
    formatColumn(column: ColumnId, number: number): string;
    /** A new filter or order: the rows are listed again (from the top). */
    choose(patch: { filters?: DatasetFilter[]; sort?: DatasetScreenView['sort']; mode?: 'all' }, toTop?: boolean): void;
    /** Runs once the table is drawn again. */
    after(fn: () => void): void;
    /** Draws the screen's open popover again (this one, while it is open). */
    renderPopovers(): void;
    announce(text: string): void;
    /** How many rows the table shows now. */
    shownCount(): number;
}

export interface FilterPopover {
    /** The filter open, or null. */
    draft(): FilterDraft | null;
    /** Opens the filter on a column (the values it filters by already ticked); the screen draws it. */
    open(column: ColumnId, anchored: boolean): void;
    close(): void;
    /** The first column without a filter (not the file name), which ＋ opens on. */
    nextColumn(): ColumnId;
    /** The filter's markup, for the screen's popover box. */
    html(): string;
    /** What the open filter hangs from: its column's header, or ＋ among the chips. */
    anchor(): HTMLElement | null;
    /** OK: the draft becomes the column's filter (none when it keeps every value). */
    apply(): void;
    /** ⊘ or a chip's ×: the column's filter goes. */
    clear(column: ColumnId): void;
    setSort(column: SortColumn, descending: boolean): void;
    /** A change inside the popover (its column, a tick, "all"); false for anything else. */
    change(target: HTMLElement): boolean;
    /** Typing in its search; false for anything else. */
    input(target: HTMLInputElement): boolean;
}

export function createFilterPopover(deps: FilterPopoverDeps): FilterPopover {
    const { screen, text } = deps;
    let draft: FilterDraft | null = null;
    /** The rows the check list counts and offers: every row not excluded. */
    const pool = (): DatasetRow[] => deps.rows().filter(row => !deps.excluded.has(row.key));
    const valuesOf = (column: ColumnId): Array<[string, number]> => columnValues(pool(), column, deps.results);
    const needleOf = (search: string): string => search.trim().toLowerCase();
    const sortKeyOf = (column: ColumnId): SortColumn | undefined => (column === 'name' ? 'name' : column === 'ch' ? 'ch' : column === deps.group() ? 'group' : column === deps.value() ? 'value' : undefined);

    function columns(): DatasetColumn[] {
        const csv = deps.csv();
        const own = (csv?.attributes ?? []).map(column => ({ id: `csv:${column}` as ColumnId, label: column, numeric: !!csv?.numeric[column] }));
        const folders = deps.groupOptions().filter(option => option.id.startsWith('folder:')).map(option => ({ id: option.id, label: option.label, numeric: false }));
        const rows = deps.rows();
        const computed = deps.valueOptions().filter(option => option.computed && rows.some(row => valueOf(row, option.id, deps.results) !== null)).map(option => ({ id: option.id, label: option.label, numeric: true }));
        return [{ id: 'name', label: text.entryColFile, numeric: false }, { id: 'ch', label: text.dsCh, numeric: false }, ...own, ...folders, ...computed];
    }
    function open(column: ColumnId, anchored: boolean): void {
        const existing = deps.filters().find(filter => filter.column === column);
        draft = { column, anchored, search: '', checked: existing?.kind === 'values' ? new Set(existing.values) : null };
    }
    function redrawCheckList(): void {
        if (!draft?.checked) return;
        const list = screen.querySelector('[data-entry-flist]');
        if (list) list.innerHTML = checkListHtml(valuesOf(draft.column), draft.checked, draft.search, text);
        const all = screen.querySelector<HTMLInputElement>('[data-entry-fall]');
        if (all) all.indeterminate = all.getAttribute('aria-checked') === 'mixed';
    }
    /** The filter changed or went: listed again, then the popover drawn again and what happened said. */
    function settle(patch: Parameters<FilterPopoverDeps['choose']>[0], toTop: boolean, said?: () => string): void {
        draft = null;
        deps.choose(patch, toTop);
        deps.after(() => {
            deps.renderPopovers();
            if (said) deps.announce(said());
        });
    }
    const without = (column: ColumnId): DatasetFilter[] => deps.filters().filter(filter => filter.column !== column);

    return {
        draft: () => draft,
        open,
        close() { draft = null; },
        nextColumn: () => columns().find(column => !deps.filters().some(filter => filter.column === column.id) && column.id !== 'name')?.id ?? 'name',
        html(): string {
            if (!draft) return '';
            const { column: id } = draft;
            const column = columns().find(item => item.id === id) ?? { id, label: deps.columnLabel(id), numeric: deps.numericColumn(id) };
            const existing = deps.filters().find(item => item.column === id);
            const common = { column, anchored: draft.anchored, columns: columns(), sortKey: sortKeyOf(id), sort: deps.sort(), filter: existing };
            if (column.numeric) {
                const numbers = pool().map(row => (id.startsWith('csv:') ? finiteNumber(row.attributes?.[id.slice(4)] ?? '') : valueOf(row, id as ValueId, deps.results))).filter((item): item is number => item !== null);
                const min = numbers.length ? deps.formatColumn(id, numbers.reduce((least, item) => Math.min(least, item))) : '', max = numbers.length ? deps.formatColumn(id, numbers.reduce((most, item) => Math.max(most, item))) : '';
                return filterPopHtml({ ...common, search: '',
                    range: { low: existing?.kind === 'range' ? deps.formatColumn(id, existing.low) : '', high: existing?.kind === 'range' ? deps.formatColumn(id, existing.high) : '', min, max } }, text);
            }
            const values = valuesOf(id);
            draft.checked ??= new Set(values.map(([item]) => item));
            return filterPopHtml({ ...common, search: draft.search, values, checked: draft.checked }, text);
        },
        anchor(): HTMLElement | null {
            if (!draft) return null;
            return draft.anchored ? deps.head.querySelector<HTMLElement>(`th[data-column="${CSS.escape(draft.column)}"]`) : deps.chipsBox.querySelector<HTMLElement>('[data-action="entry-fadd"]');
        },
        apply(): void {
            if (!draft) return;
            const column = draft.column;
            let next: DatasetFilter | null = null;
            if (deps.numericColumn(column)) {
                const low = parseFloat(screen.querySelector<HTMLInputElement>('[data-entry-flow]')?.value ?? ''), high = parseFloat(screen.querySelector<HTMLInputElement>('[data-entry-fhigh]')?.value ?? '');
                if (!(Number.isNaN(low) && Number.isNaN(high))) {
                    next = { column, kind: 'range', low: Number.isNaN(low) ? -Infinity : low, high: Number.isNaN(high) ? Infinity : high };
                    if (next.low > next.high) next = { ...next, low: next.high, high: next.low };
                }
            } else {
                const all = valuesOf(column).map(([item]) => item);
                const needle = needleOf(draft.search);
                const checked = draft.checked;
                const keep = all.filter(item => (!needle || item.toLowerCase().includes(needle)) && checked?.has(item));
                if (!keep.length) { deps.announce(text.dsFilterPickOne); return; }
                if (keep.length < all.length) next = { column, kind: 'values', values: keep };
            }
            const applied = next;
            settle({ filters: [...without(column), ...(applied ? [applied] : [])], mode: 'all' }, true,
                () => (applied ? text.dsFilterApplied.replace('{n}', String(deps.shownCount())) : text.dsFilterRemoved.replace('{col}', deps.columnLabel(column))));
        },
        clear(column: ColumnId): void {
            settle({ filters: without(column) }, false, () => text.dsFilterRemoved.replace('{col}', deps.columnLabel(column)));
        },
        setSort(column: SortColumn, descending: boolean): void {
            settle({ sort: { column, descending } }, true);
        },
        change(target: HTMLElement): boolean {
            if (target.matches('[data-action="entry-fcol"]') && draft) {
                open((target as HTMLSelectElement).value as ColumnId, false);
                deps.renderPopovers();
                return true;
            }
            const checked = draft?.checked;
            if (target.matches('[data-entry-fall]') && draft && checked) {
                const needle = needleOf(draft.search);
                for (const [item] of valuesOf(draft.column)) {
                    if (needle && !item.toLowerCase().includes(needle)) continue;
                    if ((target as HTMLInputElement).checked) checked.add(item); else checked.delete(item);
                }
                redrawCheckList();
                return true;
            }
            const item = target.getAttribute('data-entry-fvalue');
            if (item !== null && checked) {
                if ((target as HTMLInputElement).checked) checked.add(item); else checked.delete(item);
                redrawCheckList();
                return true;
            }
            return false;
        },
        // The search narrows the check list to what it finds, all of it checked, as a spreadsheet's does.
        input(target: HTMLInputElement): boolean {
            if (!target.matches('[data-entry-fsearch]') || !draft) return false;
            draft.search = target.value;
            const needle = needleOf(draft.search);
            const values = valuesOf(draft.column).map(([item]) => item);
            draft.checked = new Set(needle ? values.filter(item => item.toLowerCase().includes(needle)) : values);
            redrawCheckList();
            return true;
        },
    };
}
