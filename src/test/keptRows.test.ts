import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows, type Results } from '../shared/dataset/datasetTable';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { datasetRowsHtml, ENTRY_ROW_HEIGHT, type DatasetScreenView } from '../webview/runtime/entryTableHtml';
import { writeKeptRows } from '../webview/runtime/keptRows';

const strings = getStrings('en');
const files = ['/d/a.wav', '/d/b.wav', '/d/c.wav'];
const rows = datasetRows(files, '/d', new Map(), new Map(), new Map(files.map(file => [file, 1])));
const view = (results: Results, extra: Partial<DatasetScreenView> = {}): DatasetScreenView => ({
    rows, results, group: 'none', value: 'leq', valueReady: results.size === files.length, mode: 'all', unmatched: [], filtered: new Set(),
    columns: { name: { id: 'name', label: 'File', numeric: false }, ch: { id: 'ch', label: 'ch', numeric: true }, value: { id: 'leq', label: 'Leq', numeric: true } },
    filters: [], sort: { column: 'name', descending: false }, slots: [null, null, null, null], focused: null, playing: null, memo: new Map(), ...extra,
});
const result = (leq: number): ScanResult => JSON.parse(JSON.stringify({ ok: true, leqDbA: [leq] })) as ScanResult;
const tbody = (): HTMLElement => {
    const { document } = new JSDOM('<table><tbody></tbody></table>').window;
    return document.querySelector('tbody')!;
};
const write = (body: HTMLElement, screen: DatasetScreenView, first = 0, last = rows.length): void => writeKeptRows(body, datasetRowsHtml(screen, first, last, ENTRY_ROW_HEIGHT, strings));

test('a value that arrives goes into the cell that was drawn while it was pending: no row or cell is drawn anew (#781)', () => {
    const body = tbody();
    write(body, view(new Map()));
    const cells = [...body.querySelectorAll('tr.entry-row td')];
    assert.deepEqual([...body.querySelectorAll('.entry-col-value')].map(cell => cell.textContent), ['—', '—', '—']);
    write(body, view(new Map([['/d/a.wav', result(-34.2)]])));
    write(body, view(new Map(files.map((file, index) => [file, result(-30 - index)]))));
    assert.deepEqual([...body.querySelectorAll('.entry-col-value')].map(cell => cell.textContent), ['−30.0', '−31.0', '−32.0']);
    const now = [...body.querySelectorAll('tr.entry-row td')];
    assert.equal(now.length, cells.length);
    assert.ok(now.every((cell, index) => cell === cells[index]), 'each cell is the one drawn while pending');
});

test('the rows end as the markup says: a focused row\'s class, a row scrolled out and its spacer, attributes the runtime added taken off', () => {
    const body = tbody();
    write(body, view(new Map()));
    const second = body.querySelector('tr[data-key="/d/b.wav"]')!;
    second.classList.add('is-linked');
    // Scrolled by one row: the first row becomes a spacer, the other two stay the same elements.
    write(body, view(new Map(), { focused: '/d/c.wav' }), 1, 3);
    assert.equal(body.querySelector('tr[data-key="/d/b.wav"]'), second, 'a row still drawn is kept');
    assert.equal(second.classList.contains('is-linked'), false, 'what the runtime added after the last write is taken off, as a rewrite would');
    assert.equal(body.querySelector('tr[data-key="/d/a.wav"]'), null);
    assert.equal(body.firstElementChild!.className, 'entry-spacer-row');
    assert.equal((body.firstElementChild as HTMLElement).style.height, `${ENTRY_ROW_HEIGHT}px`);
    assert.ok(body.querySelector('tr[data-key="/d/c.wav"]')!.classList.contains('is-focused'));
    // The DOM is exactly what a fresh write of the same markup gives.
    const fresh = tbody();
    fresh.innerHTML = datasetRowsHtml(view(new Map(), { focused: '/d/c.wav' }), 1, 3, ENTRY_ROW_HEIGHT, strings);
    assert.equal(body.innerHTML, fresh.innerHTML);
});

test('rows sorted anew keep their elements in the new order', () => {
    const body = tbody();
    write(body, view(new Map()));
    const before = new Map([...body.querySelectorAll<HTMLElement>('tr.entry-row')].map(row => [row.dataset.key!, row]));
    write(body, view(new Map(), { rows: [...rows].reverse(), sort: { column: 'name', descending: true } }));
    const after = [...body.querySelectorAll<HTMLElement>('tr.entry-row')];
    assert.deepEqual(after.map(row => row.dataset.key), ['/d/c.wav', '/d/b.wav', '/d/a.wav']);
    assert.ok(after.every(row => before.get(row.dataset.key!) === row));
    assert.equal(body.children.length, 3);
});
