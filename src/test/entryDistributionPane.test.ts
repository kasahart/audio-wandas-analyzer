import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows, type DatasetRow } from '../shared/dataset/datasetTable';
import { DISTRIBUTION_BINS } from '../shared/dataset/distribution';
import { distributionLegendHtml, distributionScale, pickedRange } from '../webview/runtime/entryDistribution';
import { createDistributionPane, type DistributionInputs } from '../webview/runtime/entryDistributionPane';
import { entryScreenHtml } from '../webview/runtime/entryTableHtml';

const strings = getStrings('en');

test('a drag picks the values between its ends, clipped to the axis; a press that stays put picks its bin', () => {
    const scale = distributionScale({ low: 0, high: 100 }, 92 + 12 + 200, 100);
    const range = pickedRange(scale, scale.x(60), scale.x(20), true);
    assert.ok(range);
    assert.ok(Math.abs(range.low - 20) < 1e-9 && Math.abs(range.high - 60) < 1e-9);
    assert.deepEqual(pickedRange(scale, 0, scale.x(150), true), { low: 0, high: 100 });
    const width = 100 / DISTRIBUTION_BINS;
    const bin = pickedRange(scale, scale.x(width * 2.5), scale.x(width * 2.5), false);
    assert.ok(bin && Math.abs(bin.low - 2 * width) < 1e-9 && Math.abs(bin.high - 3 * width) < 1e-9);
    assert.equal(pickedRange(scale, scale.x(150), scale.x(160), true), null, 'beyond the axis picks nothing');
});

test('the legend names the base (a file, or a group\'s median) and the filled compared slots, escaped', () => {
    assert.equal(distributionLegendHtml([null, null, null, null], null, strings), '');
    const file = distributionLegendHtml(['/a.wav', '/b.wav', null, '/c.wav'], 'ignored', strings);
    assert.equal(file.split('entry-dist-key').length - 1, 3);
    assert.match(file, /slot-0"><\/span>Base<\/span>/);
    assert.match(file, /slot-3"><\/span>Compare 3<\/span>/);
    const group = distributionLegendHtml([null, '/b.wav', null, null], 'rpm <900>', strings);
    assert.match(group, /slot-0 is-dashed"><\/span>Base \(median of rpm &lt;900&gt;\)/);
});

function setup() {
    const dom = new JSDOM('<!doctype html><body></body>');
    const { document } = dom.window;
    const host = document.createElement('div');
    host.innerHTML = entryScreenHtml(strings);
    const screen = host.firstElementChild as HTMLElement;
    document.body.append(screen);
    // Shown, as open() does.
    screen.hidden = false;
    const calls: Array<[string, unknown]> = [];
    const pane = createDistributionPane({ screen, strings, pick: range => calls.push(['pick', range]), dot: key => calls.push(['dot', key]) });
    const attributes = new Map([['/d/a.wav', { rpm: '900', score: '0.2' }], ['/d/b.wav', { rpm: '900', score: '0.4' }], ['/d/c.wav', { rpm: '1500', score: '0.9' }]]);
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, new Map());
    const byKey = new Map(rows.map(row => [row.key, row]));
    const inputs: DistributionInputs = {
        pool: rows, value: 'csv:score', group: 'csv:rpm', results: new Map(), range: null, usable: () => true, slots: [null, '/d/b.wav', null, null],
        rowOf: key => (key ? byKey.get(key) : undefined), baseGroup: '900', valueLabel: 'score', format: String, rowName: key => key,
    };
    return { dom, screen, pane, calls, inputs };
}

test('the pane draws the groups, folds above the table beside the tracks and spreads on the right maximized', () => {
    const { screen, pane, inputs } = setup();
    const box = screen.querySelector<HTMLElement>('[data-entry-dist]');
    assert.ok(box);
    pane.place(false);
    assert.ok(screen.classList.contains('is-dist-strip'));
    assert.equal(box.nextElementSibling, screen.querySelector('.entry-body'));
    pane.paint(inputs);
    assert.deepEqual([box.dataset.groups, box.dataset.drawn, box.dataset.unit], ['2', '3', 'recording']);
    assert.deepEqual(pane.last()?.groups.map(group => [group.name, group.members.length]), [['900', 2], ['1500', 1]]);
    assert.match(screen.querySelector('[data-entry-dist-legend]')?.innerHTML ?? '', /median of 900/);
    assert.equal(screen.querySelector('[data-entry-dist-note]')?.textContent, '', 'folded, it does not ask for a drag');
    pane.place(true);
    assert.ok(!screen.classList.contains('is-dist-strip'));
    assert.equal(box.parentElement, screen.querySelector('[data-entry-dist-area]'));
    pane.paint(inputs);
    assert.equal(screen.querySelector('[data-entry-dist-note]')?.textContent, strings.dsDistDrag);
    pane.paint({ ...inputs, pool: [] });
    assert.equal(box.dataset.drawn, '0');
    assert.equal(screen.querySelector<HTMLElement>('[data-entry-dist-empty]')?.hidden, false);
});

test('Alt+drag on a row picks a range, as Alt+drag is on every plot (plotInteraction.ts); a plain drag is the plot\'s box zoom, not a pick', () => {
    const { dom, screen, pane, calls, inputs } = setup();
    pane.place(true);
    pane.paint(inputs);
    const groups = screen.querySelector<HTMLElement>('[data-entry-dist-groups]');
    const canvas = groups?.querySelector('[data-dist-canvas]');
    assert.ok(groups && canvas);
    const { document } = dom.window;
    const fire = (target: EventTarget, type: string, clientX: number, altKey = false): void => { target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX, altKey })); };
    fire(canvas, 'mousedown', 120, true);
    fire(document, 'mousemove', 300, true);
    assert.equal(groups.querySelector<HTMLElement>('[data-dist-brush]')?.hidden, false);
    fire(document, 'mouseup', 300, true);
    assert.equal(groups.querySelector<HTMLElement>('[data-dist-brush]')?.hidden, true);
    assert.equal(calls.length, 1);
    const [kind, range] = calls[0] as [string, { low: number; high: number }];
    assert.equal(kind, 'pick');
    assert.ok(range.low < range.high);
    fire(canvas, 'mousedown', 120);
    fire(document, 'mousemove', 300);
    fire(document, 'mouseup', 300);
    assert.equal(calls.length, 1, 'a plain drag picks nothing');
});

test('each group is a row of the plot component: its dots, its slots and the base on it', () => {
    const { screen, pane, inputs } = setup();
    pane.place(true);
    pane.paint(inputs);
    const rows = [...screen.querySelectorAll<HTMLElement>('[data-dist-group]')];
    assert.deepEqual(rows.map(row => row.dataset.distGroup), ['900', '1500']);
    // A group of few draws a dot per recording; slot 1 (b) is ticked on 900, whose median is the base.
    assert.deepEqual(rows[0].querySelector<HTMLElement>('[data-dist-canvas]')?.dataset.dots?.split('\n').map(line => line.split('\t')[0]), ['/d/a.wav', '/d/b.wav']);
    assert.equal(rows[0].dataset.distSlots, '1');
    assert.ok(rows[0].hasAttribute('data-dist-base'));
    assert.equal(rows[1].dataset.distSlots, '');
});
