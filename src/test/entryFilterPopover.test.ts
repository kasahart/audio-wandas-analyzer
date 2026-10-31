import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows, type DatasetCsv, type DatasetFilter, type DatasetRow } from '../shared/dataset/datasetTable';
import { createFilterPopover, type FilterPopoverDeps } from '../webview/runtime/entryFilterPopover';
import { entryScreenHtml, type DatasetScreenView } from '../webview/runtime/entryTableHtml';

const strings = getStrings('en');

function setup(filters: DatasetFilter[] = []) {
    const dom = new JSDOM('<!doctype html><body></body>');
    const { document } = dom.window;
    (globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value.replace(/["\\]/g, '\\$&') };
    const host = document.createElement('div');
    host.innerHTML = entryScreenHtml(strings);
    const screen = host.firstElementChild as HTMLElement;
    document.body.append(screen);
    const query = (selector: string): HTMLElement => {
        const element = screen.querySelector<HTMLElement>(selector);
        assert.ok(element, selector);
        return element;
    };
    const attributes = new Map([
        ['/d/a.wav', { rpm: '900', score: '0.2' }], ['/d/b.wav', { rpm: '900', score: '0.4' }],
        ['/d/c.wav', { rpm: '1500', score: '0.9' }], ['/d/x.wav', { rpm: '3000', score: '5' }],
    ]);
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, new Map());
    const csv: DatasetCsv = { name: 'meta.csv', columns: ['file', 'rpm', 'score'], rows: [], attributes: ['rpm', 'score'], numeric: { rpm: false, score: true }, idColumn: '', audioColumn: 'file' };
    const state = { filters, sort: { column: 'name', descending: false } as DatasetScreenView['sort'] };
    const calls: Array<[string, unknown]> = [];
    const later: Array<() => void> = [];
    const deps: FilterPopoverDeps = {
        screen, head: query('[data-entry-head]'), chipsBox: query('[data-entry-chips]'), text: strings,
        rows: () => rows, excluded: new Set(['/d/x.wav']), results: new Map(), csv: () => csv,
        groupOptions: () => [{ id: 'csv:rpm', label: 'rpm' }, { id: 'none', label: strings.dsGroupNone }],
        valueOptions: () => [{ id: 'csv:score', label: 'score', computed: false }, { id: 'leq', label: strings.dsLeq, computed: true }],
        filters: () => state.filters, sort: () => state.sort, group: () => 'csv:rpm', value: () => 'csv:score',
        columnLabel: column => column, numericColumn: column => column === 'csv:score', formatColumn: (_, number) => String(number),
        choose(patch, toTop) {
            if (patch.filters) state.filters = patch.filters;
            if (patch.sort) state.sort = patch.sort;
            calls.push(['choose', { ...patch, toTop: !!toTop }]);
        },
        after: fn => later.push(fn),
        renderPopovers: () => calls.push(['render', null]),
        announce: text => calls.push(['announce', text]),
        shownCount: () => 2,
    };
    const pop = createFilterPopover(deps);
    /** Draws the popover as the screen does, so its fields can be used. */
    const draw = (): HTMLElement => {
        screen.querySelector('[data-entry-pop]')?.remove();
        const box = document.createElement('div');
        box.setAttribute('data-entry-pop', '');
        box.innerHTML = pop.html();
        screen.append(box);
        return box;
    };
    const flush = (): void => { for (const fn of later.splice(0)) fn(); };
    return { document, screen, pop, calls, state, draw, flush };
}

test('a text column lists the values of the rows not excluded, all ticked, and offers its sort', () => {
    const { pop, draw } = setup();
    assert.equal(pop.draft(), null);
    assert.equal(pop.html(), '', 'nothing open draws nothing');
    pop.open('csv:rpm', true);
    const box = draw();
    const values = [...box.querySelectorAll<HTMLInputElement>('[data-entry-fvalue]')].map(input => [input.getAttribute('data-entry-fvalue'), input.checked]);
    assert.deepEqual(values, [['900', true], ['1500', true]], 'the excluded row\'s 3000 is not offered');
    assert.deepEqual(pop.draft()?.checked && [...pop.draft()!.checked!], ['900', '1500']);
    assert.ok(box.querySelector('[data-action="entry-fsort"][data-sort="group"]'), 'the grouping column sorts as the group');
    assert.ok(box.querySelector('b'), 'anchored on its header, it names the column instead of offering a choice');
});

test('the search narrows the list and ticks what it finds; OK keeps only those, then redraws and says so', () => {
    const { screen, pop, calls, state, draw, flush } = setup();
    pop.open('csv:rpm', false);
    draw();
    const search = screen.querySelector<HTMLInputElement>('[data-entry-fsearch]');
    assert.ok(search);
    search.value = '15';
    assert.equal(pop.input(search), true);
    assert.deepEqual([...pop.draft()?.checked ?? []], ['1500']);
    assert.deepEqual([...screen.querySelectorAll('[data-entry-fvalue]')].map(input => input.getAttribute('data-entry-fvalue')), ['1500']);
    pop.apply();
    assert.equal(pop.draft(), null);
    assert.deepEqual(state.filters, [{ column: 'csv:rpm', kind: 'values', values: ['1500'] }]);
    assert.deepEqual(calls.at(-1), ['choose', { filters: state.filters, mode: 'all', toTop: true }]);
    flush();
    assert.deepEqual(calls.slice(-2), [['render', null], ['announce', strings.dsFilterApplied.replace('{n}', '2')]]);
    assert.equal(pop.input(search), false, 'closed, the search is not the filter\'s');
});

test('ticks and "all" change the draft; nothing ticked is refused, everything ticked removes the filter', () => {
    const { screen, pop, calls, state, draw, flush } = setup([{ column: 'csv:rpm', kind: 'values', values: ['900'] }]);
    pop.open('csv:rpm', true);
    assert.deepEqual([...pop.draft()?.checked ?? []], ['900'], 'it opens on the filter it has');
    draw();
    const all = screen.querySelector<HTMLInputElement>('[data-entry-fall]');
    assert.ok(all);
    assert.equal(all.indeterminate, false);
    all.checked = false;
    assert.equal(pop.change(all), true);
    assert.deepEqual([...pop.draft()?.checked ?? []], []);
    pop.apply();
    assert.deepEqual(calls.at(-1), ['announce', strings.dsFilterPickOne]);
    assert.ok(pop.draft(), 'a refused OK keeps the popover open');
    const tick = screen.querySelector<HTMLInputElement>('[data-entry-fvalue="1500"]');
    assert.ok(tick);
    tick.checked = true;
    assert.equal(pop.change(tick), true);
    assert.equal(screen.querySelector<HTMLInputElement>('[data-entry-fall]')?.indeterminate, true, 'one of two ticked is mixed');
    const other = screen.querySelector<HTMLInputElement>('[data-entry-fvalue="900"]');
    assert.ok(other);
    other.checked = true;
    pop.change(other);
    pop.apply();
    assert.deepEqual(state.filters, [], 'every value kept is no filter');
    flush();
    assert.deepEqual(calls.at(-1), ['announce', strings.dsFilterRemoved.replace('{col}', 'csv:rpm')]);
});

test('a numeric column takes a range: either end may be open, and reversed ends are swapped', () => {
    const { screen, pop, state, draw } = setup();
    pop.open('csv:score', false);
    let box = draw();
    assert.equal(box.querySelector<HTMLInputElement>('[data-entry-flow]')?.placeholder, '0.2', 'the excluded row\'s 5 is not the top');
    assert.equal(box.querySelector<HTMLInputElement>('[data-entry-fhigh]')?.placeholder, '0.9');
    const set = (low: string, high: string): void => {
        const [lowInput, highInput] = [screen.querySelector<HTMLInputElement>('[data-entry-flow]'), screen.querySelector<HTMLInputElement>('[data-entry-fhigh]')];
        assert.ok(lowInput && highInput);
        lowInput.value = low;
        highInput.value = high;
    };
    set('0.8', '0.3');
    pop.apply();
    assert.deepEqual(state.filters, [{ column: 'csv:score', kind: 'range', low: 0.3, high: 0.8 }]);
    pop.open('csv:score', false);
    box = draw();
    assert.equal(box.querySelector<HTMLInputElement>('[data-entry-flow]')?.value, '0.3', 'it opens on its range');
    set('', '0.5');
    pop.apply();
    assert.deepEqual(state.filters, [{ column: 'csv:score', kind: 'range', low: -Infinity, high: 0.5 }]);
    pop.open('csv:score', false);
    draw();
    set('', '');
    pop.apply();
    assert.deepEqual(state.filters, [], 'both ends empty is no filter');
});

test('clear, sort, the column picker, ＋\'s next column and the anchor', () => {
    const { screen, pop, calls, state, draw, flush } = setup([{ column: 'name', kind: 'values', values: ['a.wav'] }]);
    assert.equal(pop.nextColumn(), 'ch', 'the first column without a filter, never the file name');
    state.filters = [{ column: 'ch', kind: 'values', values: ['1'] }];
    assert.equal(pop.nextColumn(), 'csv:rpm');
    pop.open('csv:rpm', false);
    draw();
    const picker = screen.querySelector<HTMLSelectElement>('[data-action="entry-fcol"]');
    assert.ok(picker);
    assert.deepEqual([...picker.options].map(option => option.value), ['name', 'ch', 'csv:rpm', 'csv:score'], 'no computed column without values');
    picker.value = 'ch';
    assert.equal(pop.change(picker), true);
    assert.deepEqual(pop.draft(), { column: 'ch', anchored: false, search: '', checked: new Set(['1']) });
    assert.deepEqual(calls.at(-1), ['render', null]);
    assert.equal(pop.anchor(), screen.querySelector('[data-action="entry-fadd"]'));
    pop.clear('ch');
    assert.equal(pop.draft(), null);
    assert.deepEqual(state.filters, []);
    assert.deepEqual(calls.at(-1), ['choose', { filters: [], toTop: false }]);
    flush();
    assert.deepEqual(calls.at(-1), ['announce', strings.dsFilterRemoved.replace('{col}', 'ch')]);
    pop.open('name', true);
    pop.setSort('name', true);
    assert.equal(pop.draft(), null);
    assert.deepEqual(state.sort, { column: 'name', descending: true });
    flush();
    assert.deepEqual(calls.at(-1), ['render', null], 'a new order says nothing');
    assert.equal(pop.change(screen), false, 'anything else is not the filter\'s');
    pop.close();
    assert.equal(pop.anchor(), null);
});
