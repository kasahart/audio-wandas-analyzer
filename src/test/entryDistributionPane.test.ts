import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows, type DatasetRow } from '../shared/dataset/datasetTable';
import { DISTRIBUTION_BINS } from '../shared/dataset/distribution';
import { distributionLegendHtml, distributionScale, pickedRange } from '../webview/runtime/entryDistribution';
import { createDistributionPane, type DistributionInputs } from '../webview/runtime/entryDistributionPane';
import { entryScreenHtml } from '../webview/runtime/entryTableHtml';
import { P } from './helpers/figure';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import { figureUsed, folderReference, referenceIdentity } from '../webview/runtime/figureModel';

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

function setup(attributes = new Map([['/d/a.wav', { rpm: '900', score: '0.2' }], ['/d/b.wav', { rpm: '900', score: '0.4' }], ['/d/c.wav', { rpm: '1500', score: '0.9' }]])) {
    const dom = new JSDOM('<!doctype html><body></body>');
    const { document } = dom.window;
    const host = document.createElement('div');
    host.innerHTML = entryScreenHtml(strings);
    const screen = host.firstElementChild as HTMLElement;
    document.body.append(screen);
    // Shown, as open() does.
    screen.hidden = false;
    const calls: Array<[string, unknown]> = [];
    const pane = createDistributionPane({ screen, strings, pick: range => { calls.push(['pick', range]); return () => { calls.push(['unpick', range]); }; }, dot: key => { calls.push(['dot', key]); return () => { calls.push(['undot', key]); }; } });
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, new Map());
    const byKey = new Map(rows.map(row => [row.key, row]));
    const inputs: DistributionInputs = {
        pool: rows, value: 'csv:score', group: 'csv:rpm', results: new Map(), range: null, usable: () => true, slots: [null, '/d/b.wav', null, null],
        rowOf: key => (key ? byKey.get(key) : undefined), base: { group: '900', value: 0.2 }, onAxis: () => true, valueLabel: P('score'), format: String, rowName: key => key,
    };
    return { dom, screen, pane, calls, inputs };
}

test('a level\'s heading counts its set and says what it left out, with why (aggregation V11)', () => {
    const { screen, pane, inputs } = setup();
    const ready = (path: string): ScanAnswer => scanAnswer(path, { ok: true, input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true }, leqDbA: [-20], peakHz: [1], crest: [1], spectrumDb: [[0]], thirdOctDb: [[0]], specVersion: 5 });
    const answers = [ready('/d/a.wav'), ready('/d/b.wav'), ready('/d/c.wav'), scanAnswer('/d/p.wav', undefined), scanAnswer('/d/x.wav', { ok: false, reason: 'unreadable' })];
    const set = figureUsed(referenceIdentity(folderReference(answers)), answers);
    pane.paint({ ...inputs, set });
    const heading = screen.querySelector('[data-entry-dist-count]')?.textContent ?? '';
    assert.ok(heading.startsWith(`3 ${strings.dsUnitRecording}`), heading);
    assert.ok(heading.includes(strings.dsBasePending.replace('{n}', '1')), heading);
    assert.ok(heading.includes(strings.dsBaseFailed.replace('{n}', '1')), heading);
});

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
    const fire = (target: EventTarget, type: string, clientX: number, altKey = false): void => { target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...(type === 'mousemove' ? { buttons: 1 } : {}), clientX, altKey })); };
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

/**
 * The pane's rows drawn as on a page (a context that draws nothing), each row's canvas `width` × 34 px, 40 px below the
 * one before from (100, 0), scrolled up by `scrolled()`: the pointer's marks and readout are shown, so a click has a read.
 */
function drawingPane(dom: JSDOM, screen: HTMLElement, width = 300, scrolled = (): number => 0): { rows: () => HTMLCanvasElement[]; rowRect: (index: number) => DOMRect; restore: () => void } {
    const context = new Proxy({}, {
        get: (_target, key) => key === 'font' ? '10px sans-serif' : key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : key === 'getImageData' || key === 'createImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }) : () => undefined,
        set: () => true,
    });
    dom.window.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    // The pane finds the row under the pointer as a canvas of the page (instanceof HTMLCanvasElement).
    const globals = globalThis as { HTMLCanvasElement?: unknown };
    const before = globals.HTMLCanvasElement;
    globals.HTMLCanvasElement = dom.window.HTMLCanvasElement;
    const rowRect = (index: number): DOMRect => ({ left: 100, top: index * 40 - scrolled(), width, height: 34, right: 100 + width, bottom: index * 40 - scrolled() + 34, x: 100, y: index * 40 - scrolled(), toJSON: () => ({}) });
    // Every row's canvas, as painted now (a paint makes them anew), placed by its index.
    const rows = (): HTMLCanvasElement[] => [...screen.querySelectorAll<HTMLCanvasElement>('[data-dist-canvas]')];
    const proto = dom.window.HTMLCanvasElement.prototype;
    proto.getBoundingClientRect = function (this: HTMLCanvasElement) { const index = rows().indexOf(this); return rowRect(Math.max(0, index)); };
    Object.defineProperty(proto, 'clientWidth', { get: () => width, configurable: true });
    Object.defineProperty(proto, 'clientHeight', { get: () => 34, configurable: true });
    (dom.window.document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (_x, y) => rows().find((_c, index) => y >= rowRect(index).top && y < rowRect(index).bottom) ?? null;
    return { rows, rowRect, restore: () => { globals.HTMLCanvasElement = before; } };
}

test('a click on a row acts on what its readout reads at the press, never on a hit test of its own: on a dot beside another of its height, that dot\'s row; half way between, the first; off any point, the bin of the value the readout says; a double click\'s second press puts the table back (R7, R13)', () => {
    // Two recordings of one group a dot's spacing apart (the axis / 60): drawn at one height, about 4 px apart.
    const { dom, screen, pane, calls, inputs } = setup(new Map([['/d/a.wav', { rpm: '900', score: '0' }], ['/d/b.wav', { rpm: '900', score: '0.0201' }], ['/d/c.wav', { rpm: '1500', score: '1' }]]));
    const { rows, rowRect, restore } = drawingPane(dom, screen, 240);
    try {
        pane.place(true);
        pane.paint({ ...inputs, slots: [null, null, null, null], base: null });
        const canvas = rows()[0];
        const dots = (canvas.dataset.dots ?? '').split('\n').map(line => { const [key, x, y] = line.split('\t'); return { key, x: Number(x), y: Number(y) }; });
        assert.deepEqual(dots.map(dot => dot.key), ['/d/a.wav', '/d/b.wav']);
        const [a, b] = dots;
        assert.equal(a.y, b.y, 'the two dots are drawn at one height');
        assert.ok(Math.abs(b.x - a.x) <= 5, `the two dots are close enough that a 5 px hit test of the click's own would take the first for the second (${a.x}, ${b.x})`);
        const readout = screen.querySelector<HTMLElement>('.entry-dist-note > [data-plot-readout]');
        const shown = (): string => (readout && !readout.hidden ? readout.textContent ?? '' : '');
        const { document } = dom.window;
        const fix = 'R7/R13 (docs/display-rules.md, "a click acts on the point the readout reads"): the distribution\'s click must act on PlotHoverLayer.clicked\'s read (entryDistributionPane.ts tap through clickOnRead, entryDistribution.distributionClick), never on a hit test of its own (the old dotAt took the first dot within 5 px).';
        const click = (x: number, y: number, detail = 1): string => {
            const at = { bubbles: true, button: 0, clientX: rowRect(0).left + x, clientY: rowRect(0).top + y, detail };
            canvas.dispatchEvent(new dom.window.MouseEvent('mousemove', at));
            const read = shown();
            canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', at));
            document.dispatchEvent(new dom.window.MouseEvent('mouseup', at));
            return read;
        };
        // On b's centre: the readout reads b, and the click goes to b's row.
        assert.match(click(b.x, b.y), /\/d\/b\.wav/u);
        assert.deepEqual(calls, [['dot', '/d/b.wav']], fix);
        // Half way between them: as near to each, the first in the data's order (pick_cases.json), read and gone to.
        calls.length = 0;
        assert.match(click((a.x + b.x) / 2, a.y), /\/d\/a\.wav/u);
        assert.deepEqual(calls, [['dot', '/d/a.wav']], fix);
        // Off any point (the row's right part, out of the pick radius of every dot): the readout says where on the
        // value axis the pointer is, and the click picks the bin of that value.
        calls.length = 0;
        const said = click(200, 2);
        const value = Number(said.split(' / ').pop());
        assert.ok(Number.isFinite(value), `off any point the readout says a value (${said})`);
        assert.equal(calls.length, 1, fix);
        const [kind, range] = calls[0] as [string, { low: number; high: number }];
        assert.equal(kind, 'pick', fix);
        assert.ok(range.low <= value + 1e-3 && value - 1e-3 <= range.high && range.high - range.low <= ((pane.last()?.high ?? 0) - (pane.last()?.low ?? 0)) / DISTRIBUTION_BINS + 1e-9, `the bin picked (${range.low}–${range.high}) holds the value the readout said (${value}). ${fix}`);
        // A double click there: its first press picks the bin, its second puts the table back (R13).
        calls.length = 0;
        for (const detail of [1, 2]) click(200, 2, detail);
        assert.deepEqual(calls.map(call => call[0]), ['pick', 'unpick'], 'a double click left a bin picked: it resets the zoom only (plotInteraction.ts release(); docs/display-rules.md R13)');
        assert.deepEqual(calls[1][1], calls[0][1], 'the bin its first press picked is the one put back');
    } finally {
        restore();
    }
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

test('a double-click on the value axis strip opens its range through the plot component, as on every plot\'s axis', () => {
    const { dom, screen, pane, inputs } = setup();
    pane.place(true);
    pane.paint(inputs);
    const axis = screen.querySelector<HTMLElement>('[data-entry-dist-axis-canvas]');
    assert.ok(axis);
    axis.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 40, clientY: 5 }));
    assert.equal(dom.window.document.getElementById('entry-dist-range-popover')?.style.display, 'block');
});

test('the readout off a bar says where on the value axis the pointer is, and keeps saying it after a redraw; a scroll under a still pointer reads the row now under it (R7)', () => {
    const { dom, screen, pane, inputs } = setup();
    // Each row 40 px tall, 300 wide, one under the other; the groups' list scrolls them by `scrolled`.
    let scrolled = 0;
    const { rows, restore } = drawingPane(dom, screen, 300, () => scrolled);
    pane.place(true);
    pane.paint(inputs);
    let canvases = rows();
    assert.equal(canvases.length, 2);
    const readout = screen.querySelector<HTMLElement>('.entry-dist-note > [data-plot-readout]');
    const shown = (): string => (readout && !readout.hidden ? readout.textContent ?? '' : '');
    const pointer = { clientX: 395, clientY: 5 };
    canvases[0].dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, ...pointer }));
    const said = shown();
    assert.match(said, /score/, `off a bar: where on the value axis (${said})`);
    // Drawn again (a scan's results, a zoom) under the still pointer: still said.
    pane.paint(inputs);
    assert.equal(shown(), said, 'after a redraw, still where on the value axis');
    // Scrolled by a row: the second row is under the pointer, and it is the one read.
    canvases = rows();
    assert.equal(canvases[1].dataset.plotRead, undefined, 'the second row not read before');
    scrolled = 40;
    screen.querySelector<HTMLElement>('[data-entry-dist-groups]')?.dispatchEvent(new dom.window.Event('scroll'));
    assert.notEqual(canvases[1].dataset.plotRead, undefined, 'the row now under the pointer is read');
    restore();
});
