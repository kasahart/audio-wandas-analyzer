import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { testProblem } from './namedTest';
import {
    checkBackendReaders, checkChartFilesGathered, checkContractDoc, checkGaps, checkNamedFunctionsExist, checkNamedTestsRun, checkNumberWriters, checkPlotCallers, checkProofs,
    checkProtocolFields, checkRowsAndKinds, checkRuleQuotes, codeWith, each, enclosing, numericTextWriters, plotCallers, proofProblem, pythonDrawn, pythonFlowReaders, pythonProof,
    pythonSources, REPO, repoRoot, STAGE_PANES, tellsProblems, writersIn,
} from './plotContracts/checks';
import { CHARTS, GAP_CEILING, ROWS } from './plotContracts/index';
import { CLICK_READ, CLICK_TEST, TICK_PLACES } from './plotContracts/model';
import { BACKEND_READERS, VALUE_HELPERS } from './plotContracts/values';
import { SURFACES } from './plotContracts/surfaces';
import { PLOTS_PENDING } from './uiSmoke/plotRegistry';

// The checks are functions of the code and the table (plotContracts/checks.ts), so that the guide's worked example
// runs through the same checks in memory (guideExamples.test.ts). Here they run on the repository as it is.
const read = (file: string): string => REPO.read(file);
const parse = (file: string): ts.SourceFile => REPO.parse(file);
const sourceFiles = (): string[] => [...REPO.files];
const typed = (): ts.Program => REPO.program();
/** `typed()` with `overlay` (repo-relative path → source) added, or in place of a file's own source: for injections. */
const typedWith = (overlay: ReadonlyMap<string, string>): ts.Program => codeWith(overlay).program();

test('every row has its own id, on a chart the table lists, and every chart has a row of each kind it shows', () => {
    checkRowsAndKinds();
});

test('no row says a difference or a median is taken of rounded values: rounding is for writing only (R1)', () => {
    // "round(a) − round(b)", or "subtracts … (rounded to …)": the contract would invite a "fix" that breaks R1.
    const roundedFirst = [/round\([^)]*\)\s*[−-]\s*round\(/u, /引く（[^）]*丸める）/u, /(中央値|Δ|差)[^。]*を丸めてから/u, /subtract\w*[^.]*\(rounded/iu];
    for (const row of ROWS) {
        for (const pattern of roundedFirst) assert.ok(!pattern.test(row.trace ?? ''), `${row.id}: "${row.trace}" takes a value of rounded numbers`);
    }
    const source = read('src/webview/runtime/comparePanes.ts');
    assert.ok(!/Rounded so that base \+ delta/u.test(source), 'comparePanes.ts says the Δ is of rounded levels');
});

test('every call of the plot component, and every plot plotRegistry.ts lists, is a chart of the table', () => {
    checkPlotCallers();
    const registered = CHARTS.flatMap(chart => chart.registry ?? []);
    assert.deepEqual(PLOTS_PENDING.map(plot => plot.selector).filter(selector => !registered.includes(selector)), [], 'a plot plotRegistry.ts lists is in no chart');
    assert.deepEqual(registered.filter(selector => !PLOTS_PENDING.some(plot => plot.selector === selector)), [], 'a chart lists a canvas plotRegistry.ts does not');
});


/**
 * Every place in `files` that makes a drawing surface, by the function it is in: a canvas's context taken (by the
 * receiver's type, HTMLCanvasElement or OffscreenCanvas), a canvas or an SVG element created (createElement,
 * createElementNS with the SVG namespace, new OffscreenCanvas), or written as markup (`<canvas`, `<svg` in a string or
 * a template). A function that makes a surface and is not listed fails, so a new chart drawn its own way is found.
 *
 * This scan is a ledger of where surfaces are made. It is NOT the guarantee that every chart is drawn by the plot
 * component, and it does not look inside a function that is already listed: a registered painter that also draws
 * on its canvas by hand passes here. The guarantee is the audit every UI test runs in a real browser
 * (src/test/uiSmoke/canvasAudit.ts): a canvas on screen that the component did not mark, and any 2D drawing call
 * made into a plot's canvas while the component is not painting, fail the test. See "Adding a canvas or an SVG" in
 * docs/plot-contracts-guide.md for what the audit sees and what it cannot.
 */
function drawingSurfaces(program: ts.Program, files: readonly string[]): Map<string, Set<string>> {
    const checker = program.getTypeChecker();
    const found = new Map<string, Set<string>>();
    const add = (node: ts.Node, what: string): void => {
        const where = `${path.relative(repoRoot, node.getSourceFile().fileName).split(path.sep).join('/')}:${enclosing(node)}`;
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const set = found.get(where) ?? new Set<string>();
        set.add(`${what} at line ${line}`);
        found.set(where, set);
    };
    const canvasTyped = (node: ts.Expression): boolean => {
        const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
        return (type.isUnion() ? type.types : [type]).some(part => ['HTMLCanvasElement', 'OffscreenCanvas'].includes(part.getSymbol()?.getName() ?? ''));
    };
    for (const file of files) {
        const source = program.getSourceFile(path.join(repoRoot, file));
        if (!source) continue;
        each(source, node => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
                const method = node.expression.name.text;
                const first = node.arguments[0];
                if (method === 'getContext' && canvasTyped(node.expression.expression)) add(node, 'a canvas\'s context');
                if (method === 'createElement' && first && ts.isStringLiteralLike(first) && ['canvas', 'svg'].includes(first.text.toLowerCase())) add(node, `a ${first.text} created`);
                if (method === 'createElementNS' && first && ts.isStringLiteralLike(first) && first.text.includes('svg')) add(node, 'an SVG element created');
            }
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'OffscreenCanvas') add(node, 'an OffscreenCanvas');
            const text = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : undefined;
            const tag = text !== undefined ? /<(canvas|svg)\b/iu.exec(text)?.[1] : undefined;
            if (tag) add(node, `<${tag.toLowerCase()}> markup`);
        });
    }
    return found;
}

/**
 * Every plot's click (the `tap` handed to attachPlotInteraction), as `file:function`: the function that makes the click,
 * the tap itself or the function of its file it hands the click to, and whether that function acts through
 * clickOnRead (the readout's read, R7, R13).
 */
function plotClicks(sources: ReadonlyArray<{ file: string; source: ts.SourceFile }> = sourceFiles().filter(file => read(file).includes('attachPlotInteraction(')).map(file => ({ file, source: parse(file) }))): Map<string, boolean> {
    const clicks = new Map<string, boolean>();
    for (const { file, source } of sources) {
        // The file's own functions by name (a declaration, or an arrow given to a const), never a property of an object.
        const named = new Map<string, ts.Node>();
        each(source, node => {
            const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text
                : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : null;
            if (name && !named.has(name)) named.set(name, node);
        });
        const acts = (node: ts.Node | undefined): boolean => !!node && /\bclickOnRead\(/u.test(node.getText(source));
        each(source, node => {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'attachPlotInteraction') return;
            const deps = node.arguments[3];
            if (!deps || !ts.isObjectLiteralExpression(deps)) return;
            for (const property of deps.properties) {
                if (!property.name || property.name.getText(source) !== 'tap') continue;
                // The tap: a function of the file it names, or written here (a method, an arrow).
                const own = ts.isShorthandPropertyAssignment(property) ? named.get('tap')
                    : ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? named.get(property.initializer.text) : property;
                const ownName = ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? property.initializer.text : 'tap';
                if (acts(own)) { clicks.set(`${file}:${ownName}`, true); continue; }
                // A tap that hands the click to a function of its file (the lanes' endLaneDrag).
                let handed: string | null = null;
                if (own) each(own, inner => { if (!handed && ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && acts(named.get(inner.expression.text))) handed = inner.expression.text; });
                clicks.set(`${file}:${handed ?? ownName}`, !!handed);
            }
        });
    }
    return clicks;
}

test('every plot\'s click is a click row of the table and acts on the point its readout reads, through clickOnRead, never a hit test of its own (R7, R13)', () => {
    const clicks = plotClicks();
    assert.ok(clicks.size >= 4, `the scan finds the plots' clicks (${[...clicks.keys()].join(', ')})`);
    const own = [...clicks].filter(([, through]) => !through).map(([at]) => at);
    assert.deepEqual(own, [], 'Rule (docs/display-rules.md R7, R13: "a click acts on the point the readout reads"): every plot\'s click acts on what its readout read at the press, the same pick and the same identity. These taps do not act through clickOnRead (plotHoverLayer.ts), so they decide by a hit test of their own. Fix: return clickOnRead(marks, plot, current, got => ...) from the tap, acting on got.read (or, where the readout reads no point, on what its words say there), and delete the tap\'s own geometry.');
    const rows = ROWS.filter(row => row.value === 'click');
    const listed = new Set(rows.flatMap(row => row.computedIn));
    assert.deepEqual([...clicks.keys()].filter(at => !listed.has(at)).sort(), [], 'Rule (R7, R13): every plot with a click has a click row in the contract table, which the browser test (CLICK_TEST in src/test/plotContracts/model.ts) clicks at ties, overlapping points, bin edges and gaps. These clicks have none. Fix: add a row of value \'click\' to the chart\'s file in src/test/plotContracts/charts (computedIn: ...CLICK_READ and this function), add \'click\' to its requires, and give it a case in plotContract.spec.ts CLICK_CASES.');
    for (const row of rows) {
        assert.ok(CLICK_READ.every(at => row.computedIn.includes(at)), `${row.id}: a click row names the readout's read it acts on (CLICK_READ)`);
        assert.ok(row.tests.some(item => item.file === 'src/test/uiSmoke/plotContract.spec.ts' && item.name === CLICK_TEST), `${row.id}: a click row is held by the browser test of every plot's click (CLICK_TEST)`);
    }
});

/** Charts with a ticks row and no vertical axis whose ticks are placed by a transform, each with why. */
const NO_TICK_AXIS: Readonly<Record<string, string>> = {
    'colour-bar': 'its numbers are a colour bar\'s two ends, held to the scale its colours are painted from (R9, canvasAudit.ts colour ends), not ticks up an axis',
};

test('every chart with a level, value or row axis names in its ticks row a test that holds each tick label at the place its axis paints that number, at several vertical zooms (R9, R14)', () => {
    const holding = new Set(Object.values(TICK_PLACES).map(ref => `${ref.file} › ${ref.name}`));
    const ticked = [...new Set(ROWS.filter(row => row.value === 'ticks').map(row => row.chart))];
    const unheld = ticked.filter(chart => !NO_TICK_AXIS[chart] && !ROWS.some(row => row.chart === chart && row.value === 'ticks' && row.tests.some(ref => holding.has(`${ref.file} › ${ref.name}`))));
    assert.deepEqual(unheld, [], 'charts whose ticks row names no test of TICK_PLACES (plotContracts/model.ts): give the chart\'s plot the plot contract (plotContract.spec.ts expectContract, whose \'tick places\' holds every tick at its place at several vertical zooms), or for a figure painted off screen a node test with helpers/tickPlaces.ts, and name it in the ticks row (display rules R9, R14)');
    assert.deepEqual(Object.keys(NO_TICK_AXIS).filter(chart => !ticked.includes(chart)), [], 'NO_TICK_AXIS lists a chart with no ticks row: take it off');
});

test('the click scan finds a plot\'s own hit test: a tap that does not act through clickOnRead', () => {
    const text = [
        'function handOn(current) { return clickOnRead(marks, plot, current, got => act(got.read)); }',
        'attachPlotInteraction(a, document, ".a", { tap: (plot, event, current) => handOn(current) });',
        // The old distribution's click: the first dot within 5 px of the pointer, a hit test of its own.
        'const tap = (plot, event) => { const dot = dotAt(plot, event.clientX, event.clientY); return dot ? () => go(dot) : undefined; };',
        'attachPlotInteraction(b, document, ".b", { tap });',
    ].join('\n');
    const clicks = plotClicks([{ file: 'fixture.ts', source: ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true) }]);
    assert.deepEqual([...clicks].sort(), [['fixture.ts:handOn', true], ['fixture.ts:tap', false]]);
});

test('a use of the plot component is found under any name: imported under another, through a namespace, or handed on as a value', () => {
    const file = 'src/webview/runtime/injectedPainter.ts';
    const program = typedWith(new Map([[file, [
        "import { paintOverlay as draw } from './stagePanes';",
        "import * as panes from './stagePanes';",
        'export function renamed(...args: Parameters<typeof draw>) { return draw(...args); }',
        'export function spaced(...args: Parameters<typeof panes.paintStage>) { return panes.paintStage(...args); }',
        'export function handedOn() { const painter = panes.paintOverlay; return painter; }',
        "export function unrelated() { const paintOverlay = (): number => 1; return paintOverlay(); }",
    ].join('\n')]]));
    assert.deepEqual([...plotCallers(program, [file])].sort(), ['handedOn', 'renamed', 'spaced'].map(name => `${file}:${name}`));
});

test('every drawing surface of the webview (a canvas or an SVG made, or a context taken) is the plot component\'s, a chart\'s, or says why it is no chart', () => {
    const found = drawingSurfaces(typed(), sourceFiles().filter(file => file !== STAGE_PANES));
    const painted = new Set(CHARTS.flatMap(chart => chart.paintedBy));
    const charts = new Set(CHARTS.map(chart => chart.id));
    const unlisted = [...found].filter(([where]) => !painted.has(where) && !Object.hasOwn(SURFACES, where)).map(([where, what]) => `${where} (${[...what].join(', ')})`).sort();
    assert.deepEqual(unlisted, [], 'Rule: every canvas or SVG the webview makes or draws on is the plot component\'s, a chart\'s, or explained. These functions make one (a context taken, an element created, <canvas>/<svg> markup) and nothing lists them. Fix: if it shows data, draw it with the plot component (paintOverlay) and add the function to its chart\'s paintedBy in src/test/plotContracts/charts; if it only holds a chart\'s canvas, add it to src/test/plotContracts/surfaces.ts as { charts: [...] }; if it draws no data (an icon, a cursor layer), add it there with one sentence saying why. See docs/plot-contracts-guide.md.');
    assert.deepEqual(Object.keys(SURFACES).filter(where => !found.has(where)).sort(), [], 'Rule: surfaces.ts lists only functions that make a drawing surface today. Fix: remove these lines from src/test/plotContracts/surfaces.ts (the function was renamed, moved, or no longer makes a canvas or SVG).');
    for (const [where, whose] of Object.entries(SURFACES)) {
        if (typeof whose === 'string') assert.ok(whose.trim().length > 0, `${where}: says no why. Rule: a surface that is no chart's says in one sentence why it draws no data. Fix: write that sentence as its entry in src/test/plotContracts/surfaces.ts.`);
        else assert.deepEqual(whose.charts.filter(chart => !charts.has(chart)), [], `${where}: names charts that do not exist. Rule: a surface that holds a chart's canvas names that chart by its id. Fix: use an id from src/test/plotContracts/charts (the chart's \`id\`), or remove the ones that were renamed or deleted.`);
    }
});

test('the surface scan finds a chart drawn its own way: a canvas made and drawn, an SVG chart, markup of either', () => {
    const file = 'src/webview/runtime/fakeChart.ts';
    const program = typedWith(new Map([[file, [
        'export function ownCanvas(host: HTMLElement): void { const canvas = document.createElement("canvas"); host.append(canvas); canvas.getContext("2d")?.fillRect(0, 0, 4, 4); }',
        'export function drawsOn(canvas: HTMLCanvasElement | null): void { const ctx = canvas?.getContext("2d"); ctx?.stroke(); }',
        'export function svgChart(host: HTMLElement): void { host.append(document.createElementNS("http://www.w3.org/2000/svg", "svg")); }',
        'export function markup(height: number): string { return `<div><canvas height="${height}"></canvas></div>`; }',
        "export function svgMarkup(): string { return '<svg viewBox=\"0 0 4 4\"><path d=\"M0 0L4 4\"/></svg>'; }",
        'export function offscreen(): void { new OffscreenCanvas(4, 4).getContext("2d"); }',
        // A context of anything else, and words, are no surface.
        'export function other(element: { getContext(kind: string): unknown }): void { element.getContext("2d"); }',
        'export function words(): string { return "a canvas of svg"; }',
    ].join('\n')]]));
    const found = drawingSurfaces(program, [file]);
    assert.deepEqual([...found.keys()].map(name => name.slice(file.length + 1)).sort(), ['drawsOn', 'markup', 'offscreen', 'ownCanvas', 'svgChart', 'svgMarkup']);
    // Not in a chart, not in SURFACES: the inventory test fails on each.
    const painted = new Set(CHARTS.flatMap(chart => chart.paintedBy));
    assert.ok([...found.keys()].every(where => !painted.has(where) && !Object.hasOwn(SURFACES, where)));
});

test('every test the table names runs and asserts something', () => {
    checkNamedTestsRun();
});

test('every function the table names exists, as a function of its file or a def of its Python module', () => {
    checkNamedFunctionsExist();
});

test('every function that writes a number in the webview is in the table, a value helper, or not a chart\'s value with why', () => {
    checkNumberWriters();
});

test('the detector finds a number written by a primitive, a helper imported under another name, a local alias of one, and rounding to decimals by arithmetic', () => {
    const file = 'src/webview/runtime/fake.ts';
    const code = codeWith(new Map([[file, [
        "import { frequencyText as hz } from '../plot/plotText';",
        'const fmt = hz;',
        'export function a(value: number): string { return value.toFixed(2); }',
        'export const b = (value: number): string => hz(value);',
        'export function c(value: number): string { return fmt(value); }',
        'export function d(): string { return "none"; }',
        'export function e(value: number, reference: number): number { return Math.round(value * 10) - Math.round(reference * 10); }',
        'const round1 = (value: number): number => Math.round(value * 10) / 10;',
        'export function f(value: number, reference: number): number { return round1(round1(value) - round1(reference)); }',
        'export function g(x: number): number { return Math.round(x) + Math.floor(x / 2); }',
    ].join('\n')]]));
    {
        const writers = new Map<string, Set<string>>();
        writersIn(file, new Set([...VALUE_HELPERS, `${file}:round1`]), writers, code);
        assert.deepEqual(Object.fromEntries([...writers].map(([writer, calls]) => [writer, [...calls]])), {
            [`${file}:a`]: ['toFixed'],
            [`${file}:b`]: ['src/webview/plot/plotText.ts:frequencyText'],
            [`${file}:c`]: ['src/webview/plot/plotText.ts:frequencyText'],
            // Rounding to decimals by arithmetic writes a number, and so does a helper that does it: a pixel's Math.round does not.
            [`${file}:e`]: ['Math.round'],
            [`${file}:round1`]: ['Math.round'],
            [`${file}:f`]: [`${file}:round1`],
        });
    }
});


test('the detector finds a number written into text by its type: String(n), a template, n + text, a local, a function that makes such text, and a number itself', () => {
    const file = 'src/webview/runtime/fakeText.ts';
    const program = typedWith(new Map([[file, [
        'export function viaString(el: HTMLElement, value: number): void { el.textContent = String(value); }',
        'export function viaTemplate(el: HTMLElement, value: number): void { el.textContent = `${value} dB`; }',
        "export function viaJoin(ctx: CanvasRenderingContext2D, value: number): void { ctx.fillText(value + ' Hz', 0, 0); }",
        'export function viaLocal(el: HTMLElement, value: number): void { const label = `${value}`; el.title = label; }',
        'function made(value: number): string { return `${value.toString()} s`; }',
        'export function viaMaker(el: HTMLElement, value: number): void { el.innerHTML = `<b>${made(value)}</b>`; }',
        'export function viaAttribute(el: HTMLElement, value: number): void { el.setAttribute(\'aria-valuetext\', String(value)); el.dataset.level = `${value}`; }',
        'export function viaNumbers(el: HTMLElement, values: number[]): void { el.append(values.join(\', \')); }',
        'export function itself(input: HTMLInputElement, value: number): void { input.valueAsNumber = value; (input as unknown as { textContent: number }).textContent = value; }',
        // Words, and a number given to a style, are no number a user reads.
        'export function words(el: HTMLElement, name: string, width: number): void { el.textContent = `${name}!`; el.style.width = `${width}px`; }',
    ].join('\n')]]));
    const found = numericTextWriters(program, [file]);
    const names = [...found.keys()].map(name => name.slice(file.length + 1)).sort();
    assert.deepEqual(names, ['itself', 'viaAttribute', 'viaJoin', 'viaLocal', 'viaMaker', 'viaNumbers', 'viaString', 'viaTemplate'], [...found].map(([name, how]) => `${name}: ${[...how].join(', ')}`).join('\n'));
    assert.match([...found.get(`${file}:viaMaker`) ?? []].join(), /fakeText\.ts:made/u);
});

test('every chart\'s file in plotContracts/charts is gathered by index.ts, and holds only its own rows\' gaps', () => {
    checkChartFilesGathered();
});

// ── What reads drawn points ──

test('the backend\'s readers are found by data flow: a def that takes a returned view\'s values and sends their max is one, with no decimator call in it', () => {
    const sources = pythonSources();
    // Injected (Codex round 1, P2): no decimator is called here; the drawn values come back from stage_view.
    sources.scan_service += '\n\ndef _peak_of(frame):\n    view = stage_view(frame)\n    return {"peakDb": float(np.max(view["values"]))}\n';
    sources.stage_combine += '\n\ndef _top_of(view):\n    return max(view["values"])\n';
    sources.scan_service += '\n\nfrom stage_combine import _top_of\n\n\ndef _send_top(frame):\n    return {"peakDb": _top_of({"p": stage_view(frame)}["p"])}\n';
    const found = pythonFlowReaders(sources);
    assert.ok(found['python-backend/scan_service.py:_peak_of']?.some(origin => origin.startsWith('stage_view:')), JSON.stringify(found['python-backend/scan_service.py:_peak_of']));
    assert.ok(found['python-backend/stage_combine.py:_top_of'], 'a helper in another module given the drawn view through a dict is a reader');
    // As the contract test reads them, both are unclassified readers: the injection fails it.
    const python = pythonDrawn(found);
    assert.deepEqual(['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of'].filter(def => python.has(def) && !Object.hasOwn(BACKEND_READERS, def)), ['python-backend/scan_service.py:_peak_of', 'python-backend/stage_combine.py:_top_of']);
});

test('every backend function that computes with thinned points says what it does with them (drawn_points_contract.json)', () => {
    checkBackendReaders();
});

test('every number the backend\'s protocol sends back is a value of a row, or says why it is not shown', () => {
    checkProtocolFields();
});

// ── Gaps ──

test('every test a row says tells full data from drawn points proves it: it reaches the row\'s code and asserts its answer is not the drawn points\' answer', () => {
    checkProofs();
});

test('a pytest proof moved into a test class is one test, named TestX::test_y, for both the name check and the proof check', () => {
    // One discovery (scripts/check_test_proofs.py tests_of, which namedTest.ts asks): before #777 namedTest found the
    // method by its bare name and the proof check did not find it at all, so one check passed what the other failed.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'awa-proof-'));
    try {
        const file = path.join(dir, 'test_held.py');
        const text = [
            'import numpy as np', 'from conftest import assert_not_drawn', 'from decimator import decimated_waveform', '', '',
            'class TestHeld:', '    def test_it(self):', '        samples = np.sin(np.arange(5000) * 0.3)', '        samples[3210] = -0.95',
            '        result = decimated_waveform(samples, 50, 0, 5000)', '        assert result["absolutePeak"] == 0.95',
            '        averaged = np.abs(samples.reshape(50, -1).mean(axis=1))', '        assert_not_drawn(result["absolutePeak"], float(averaged.max()))', '',
        ].join('\n');
        writeFileSync(file, text);
        const targets = ['python-backend/decimator.py:decimated_waveform'];
        assert.equal(testProblem('test_held.py', text, 'TestHeld::test_it'), null);
        assert.equal(pythonProof(targets, { file, name: 'TestHeld::test_it' }), null);
        // By its bare name it is a test of neither, and the proof check names the name that is.
        assert.match(testProblem('test_held.py', text, 'test_it') ?? '', /is not a test/);
        assert.equal(pythonProof(targets, { file, name: 'test_it' }), "is not a test of its file: name it 'TestHeld::test_it'");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the proof check follows names to what they declare: only a use of the row\'s code, its answer asserted outright, and assertNotDrawn(answer, drawnAnswer) make a proof', () => {
    // Proofs written here for the injection, compiled over the real sources and never written to disk.
    const file = 'src/test/injectedWholeProof.test.ts';
    const range = 'src/webview/runtime/stagePanes.ts:stageRange';
    const full = "    const full = stageRange([line([-43, -12], { min: -61, max: -2 })]);";
    const outright = "    assert.deepEqual(full, stageRange([line([-61, -2])]));";
    const cases: Array<{ name: string; body: string[]; problem: RegExp | null }> = [
        // A drawn line whose extremes were thinned away: its full range asserted, and told from the drawn points'.
        { name: 'proven', body: [full, outright, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: null },
        // The same under other names: the import renamed, the code reached through a namespace.
        { name: 'renamed', body: ["    const full = panes.stageRange([line([-43, -12], { min: -61, max: -2 })]);", "    assert.deepEqual(full, panes.stageRange([line([-61, -2])]));", "    apart(full, panes.stageRange([line([-43, -12])]));"], problem: null },
        // Full and drawn data that give one answer say nothing of which one the code takes.
        { name: 'no helper', body: [full, outright], problem: /asserts no case where the full data and the drawn points give different answers/u },
        // Another negative assertion is not the helper: one form, so a reader finds every proof the same way.
        { name: 'another assertion', body: [full, outright, "    assert.notDeepEqual(full, stageRange([line([-43, -12])]));"], problem: /asserts no case/u },
        // A function of the helper's spelling that is not the helper.
        { name: 'look-alike', body: ["    const assertNotDrawn = (..._: unknown[]): void => undefined;", full, outright, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: /asserts no case/u },
        // Told apart from null, a constant, a local holding one, or itself is not told apart from the drawn points.
        { name: 'null', body: [full, outright, "    assertNotDrawn(full, null);"], problem: /asserts no case/u },
        { name: 'constant', body: [full, outright, "    assertNotDrawn(full, { min: 0, max: 0 });"], problem: /asserts no case/u },
        { name: 'local constant', body: [full, outright, "    const zero = { min: 0, max: 0 };", "    assertNotDrawn(full, zero);"], problem: /asserts no case/u },
        { name: 'itself', body: [full, outright, "    assertNotDrawn(full, full);"], problem: /asserts no case/u },
        // The answer never stated: only that it differs.
        { name: 'not outright', body: [full, "    assertNotDrawn(full, stageRange([line([-43, -12])]));"], problem: /never asserts the answer of the row's code outright/u },
        // One answer stated outright and another told apart: the two halves must be of the same value.
        { name: 'two values', body: [full, outright, "    assertNotDrawn(stageRange([line([-43, -12], { min: -60, max: -2 })]).max, stageRange([line([-43, -12])]).max);"], problem: /states one value outright .* and tells another apart/u },
        // A test that never uses the row's code proves nothing of it, whatever it asserts.
        { name: 'unreached', body: ["    const full = { min: -61, max: -2 }, drawn = [full].map(item => ({ ...item, min: -43 }))[0];", "    assert.deepEqual(full, { min: -61, max: -2 });", "    assertNotDrawn(full, drawn);"], problem: /never uses the row's code/u },
    ];
    const program = typedWith(new Map([[file, [
        "import assert from 'node:assert/strict';",
        "import test from 'node:test';",
        "import type { StageView } from '../shared/protocol/backendProtocol';",
        "import { stageRange } from '../webview/runtime/stagePanes';",
        "import * as panes from '../webview/runtime/stagePanes';",
        "import { assertNotDrawn, assertNotDrawn as apart } from './fullNotDrawn';",
        "const line = (values: number[], valueRange?: StageView['valueRange']): StageView => ({ frame: 'SpectralFrame', kind: 'line', xs: values.map((_, i) => i), values, ...(valueRange ? { valueRange } : {}) });",
        ...cases.flatMap(item => [`test('${item.name}', () => {`, ...item.body, '});']),
    ].join('\n')]]));
    for (const item of cases) {
        const problem = proofProblem([range], { file, name: item.name }, program);
        if (item.problem) assert.match(problem ?? 'no problem', item.problem, item.name);
        else assert.equal(problem, null, item.name);
    }
    // A row's failure says the rule and what to write.
    const row = tellsProblems([{ id: 'injected.range', chart: 'injected', value: 'range', what: 'x', computedIn: [range], from: 'full', trace: 'x', tests: [{ file, name: 'null', tells: true }] }], (targets, proof) => proofProblem(targets, proof, program));
    assert.match(row.join('\n'), /injected\.range: .* asserts no case where the full data and the drawn points give different answers\. Rule: .*assertNotDrawn\(answer, drawnAnswer\)/u);
    // A UI test is never the proof.
    assert.match(proofProblem([range], { file: 'src/test/uiSmoke/plotContract.spec.ts', name: 'any' }) ?? '', /is a UI test/u);
});

test('every gap is in its chart\'s knownGaps at its severity, and a row is a gap until a test holds it from full data', () => {
    checkGaps();
});

test('the number of gaps of each severity is GAP_CEILING, which only goes down', () => {
    for (const severity of ['P1', 'P2', 'P3'] as const) {
        const count = ROWS.filter(row => row.gap?.severity === severity).length;
        assert.ok(count <= GAP_CEILING[severity], `${count} ${severity} gaps, more than the ${GAP_CEILING[severity]} allowed: a new gap is a change review should stop`);
        assert.equal(GAP_CEILING[severity], count, `${severity} gaps are down to ${count}: lower GAP_CEILING.${severity} to it`);
    }
});

test('every exception a row takes is one docs/display-rules.md approves, and every rule it breaks says so, in the rule\'s own words', () => {
    checkRuleQuotes();
});

test('docs/plot-contracts.md is the table as plotContracts renders it', () => {
    checkContractDoc();
});
