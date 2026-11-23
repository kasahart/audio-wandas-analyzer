import assert from 'node:assert/strict';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isNewPath } from './helpers/newPath';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import { ROWS } from './plotContracts';

// ── The contract table points at the layer ───────────────────────────────────────────────────────────────────────

/**
 * Rows of an axis, a range or a count of files that are not a figure's level axis, range or n, with why. Every other
 * axis, range and count row of every chart says it is computed in figureModel.ts. Exact: it only shrinks.
 */
const NOT_FIGURE_ROWS: Readonly<Record<string, string>> = {
    'entry-table.count': 'the table head\'s counts of files in the folder and the filters, not a figure\'s n',
    'time-ruler.axis': 'the name of the time axis the rows share, written by the ruler at its right end (timeRuler.ts, fitted as the Figure fits a name), not a level axis of a figure',
};

test('every chart\'s level axis, range and file count row says it is computed in figureModel.ts (docs/plot-layers.md)', () => {
    const rows = ROWS.filter(row => row.value === 'axis' || row.value === 'range' || row.value === 'count');
    assert.ok(rows.length >= 1, String(rows.length));
    const outside = rows.filter(row => !row.computedIn.some(where => where.startsWith('src/webview/runtime/figureModel.ts:'))).map(row => row.id).sort();
    const exempt = Object.keys(NOT_FIGURE_ROWS).filter(id => !outside.includes(id));
    assert.deepEqual(outside.filter(id => !NOT_FIGURE_ROWS[id]), [], 'these rows name no figureModel.ts function');
    assert.deepEqual(exempt, [], 'NOT_FIGURE_ROWS lists a row that is gone or now names figureModel.ts: take it off');
    for (const [id, why] of Object.entries(NOT_FIGURE_ROWS)) assert.ok(why.trim(), id);
});

const GUARDED_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
    /** Lines or files keyed by level identity. */
    'identity': ['webview/runtime/comparePanes.ts:levelIdentityOf'],
    /** R9's range rules. */
    'range-rule': ['shared/utils/ticks.ts:niceRange', 'shared/utils/ticks.ts:heatmapDbRange'],
};

const GUARDED_PROPERTIES: Readonly<Record<string, RegExp>> = {
    /** An axis's name built from the UI strings of a level, a gain, a Δ or the calibration word. */
    'axis-name': /^axis(?:Level\w*|Uncalibrated|Gain|TransferLevel|Delta)$/u,
    /** A CSV level column or reference column named outside the layer. */
    'csv-column': /^(?:reportLevelReference|reportBaseLevelReference|reportBaseLeq|entryColBandLevel)$/u,
};

/** A power mark at the start of text written onto an expression: a superscript digit or minus, or a caret. */
const UNIT_EDITS = /^[\u00b2\u00b3\u00b9\u2070-\u207b^]/u;

const TEXT_PATTERNS: Readonly<Record<string, RegExp>> = {
    /** A level named in bare dB by a template ("${band} dB"), not a Δ. */
    'bare-db': /`(?![^`]*Δ)[^`]*\$\{[^}]+\} dB`/gu,
    /**
     * Lines or files keyed by level identity by hand: a key of unit and reference, units or references compared, and
     * axis names or level labels compared as text. (The identity functions themselves are in GUARDED_FUNCTIONS.)
     */
    'identity': /JSON\.stringify\(\[[^\]\n]*\.unit\b[^\]\n]*\.ref\b|\.(?:unit|ref)\s*[!=]==\s*[\w.?]+\.(?:unit|ref)\b|\.(?:axisLabel|levelReferenceLabel)\s*[!=]==/gu,
    /** A line read on the first track's reference rather than its own recording's. */
    'first-track-input': /tracks\[0\]\??\.input/gu,
    /** An axis named calibrated only when every one is: the rule is any (axisInputOf), each uncalibrated one saying so. */
    'every-calibrated': /\.(?:every|some)\([^;\n]*?calibrat(?!edWord)|calibrationStatus:\s*'calibrated'/gu,
    /** An absolute level written in wandas' levelUnit (bare "dB" for every reference but FS and SPL), not its reference's name. */
    'bare-level-unit': /measurement\??\.levelUnit\b/gu,
    /** A level named "[dB]" in a UI string: only a gain and a Δ are in plain dB. */
    'bracket-db': /:\s*'[^'\n]*\[dB\]'/gu,
    /** A page's calibration note taken from the table's rows, which a ≠ row leaves without one, not the recordings' scans. */
    'table-calibration': /model\.rows[^\n]*\.uncalibrated/gu,
    /** Results over a region mixed with the whole files' (a base recording measured over the other). */
    'mixed-results': /new Map\(\[\.\.\.[\w.]*results, \.\.\.measured\]\)/gu,
    /** A figure's n, a heading's count or a CSV's 基準群 n written from the files asked for, not the figure's set. */
    'file-count': /(?:String\(|count:\s*|eachBaseTitle\([^,\n]+,\s*)[\w.?]*(?:filePaths|basePaths|allBase|paths|members|sides)\??\.length\b|\.filter\([^\n]*?\.ok\b\)\.length\b/gu,
    /**
     * An absolute level given a reference nobody sent: a default of bare dB or dBFS (`?? 'dB'`, `|| 'dBFS'`), or a
     * column or name in "dB(A)" (an A-weighted level is in dB re its channel's reference, R4, R7), not a Δ.
     */
    'default-reference': /(?:\?\?|\|\|)\s*(['"`])dB(?:FS)?\1|\buncalibratedUnits\(true\)\.level\b|(['"`])(?![^'"`\n]*Δ)[^'"`\n]*\bdB\(A\)[^'"`\n]*\2/gu,
};

type Sites = Record<string, Record<string, string[]>>;

/** The sites outside figureModel.ts that may match, and figureModel.ts's own, each file's with why. */
const ALLOWED: Sites = {
    // A calibration profile's own equality (its channels' factors and units): which profile applies, not a level identity.
    'shared/analysis/calibrationModel.ts': { 'identity': ['profilesEqual'] },
    // Which saved profile is the latest that calibrates anything: a profile's choice, not a line's calibration.
    'extension/calibrationStore.ts': { 'every-calibrated': ['persistChannel'] },
    // A gain (one unit's ratio) and a Δ are plain dB: 'Gain [dB]', 'Difference Δ [dB]' in each language.
    'shared/i18n/strings.ts': { 'bracket-db': ['STRINGS.en.axisDelta', 'STRINGS.en.axisGain', 'STRINGS.ja.axisDelta', 'STRINGS.ja.axisGain'] },
    // A signed difference's text ("+1.2 dB"): a Δ, not a level.
    // The number rules moved to shell/numberText.ts (shared by the old plots and the Figure).
    'webview/shell/numberText.ts': { 'bare-db': ['signedText'] },
    // The Figure's axis names: the level axis's (levelAxisName) and the other lines' (a metric or a level over time, a
    // cepstrum, a correlation, a gain).
    'webview/figure/axisNames.ts': { 'axis-name': ['levelAxisName', 'lineAxisNames.y', 'metricName', 'valueAxisName.name', 'valueAxisName.named', 'valueAxisName.uncal'] },
    // levelIdentityOf, defined (figureModel.ts levelKeyOf wraps it).
    'webview/runtime/comparePanes.ts': { 'identity': ['levelIdentityOf'] },
    // The CSV match's "{matched} of {total}" files (the folder's count).
    'webview/runtime/entryRuntime.ts': { 'file-count': ['createEntryScreen.paint', 'createEntryScreen.readCsvFile'] },
    // The gate's "analyse the base group's n recordings": how many would be scanned, not a figure's n.
    'webview/runtime/trackStageMode.ts': { 'file-count': ['createTrackStageMode.paintNow.count'] },
    // figureModel.ts itself, looked at too: the rules it defines and wraps, and never a default reference
    // ('default-reference'): a guessed reference here would be every figure's. Its definitions: medianInputOf, the one
    // place a line of several recordings is calibrated only when every one is; levelIdentityOf wrapped by levelKeyOf.
    'webview/runtime/figureModel.ts': { 'every-calibrated': ['medianInputOf.calibrationStatus'], 'identity': ['levelKeyOf.identity'] },
};

function each(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, child => each(child, visit));
}

/** Where `node` is, as the names of everything named it is in, outermost first (`paintStage.range`, `STRINGS.ja.axisGain`); `<module>` outside any. */
function siteOf(node: ts.Node): string {
    const names: string[] = [];
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
        if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isVariableDeclaration(at) || ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) && at.name && (ts.isIdentifier(at.name) || ts.isStringLiteral(at.name))) names.unshift(at.name.text);
    }
    return names.join('.') || '<module>';
}

function note(sites: Sites, rel: string, group: string, site: string): void {
    const names = ((sites[rel] ??= {})[group] ??= []);
    if (!names.includes(site)) names.push(site);
    names.sort();
}

/** One file's sites of GUARDED_PROPERTIES and TEXT_PATTERNS: found in its syntax tree and its text, no types needed. */
function fileSites(rel: string, text: string, sites: Sites = {}): Sites {
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    each(source, node => {
        // A property read: `s.name`, `s['name']`, `const { name } = s` (the property's name, whatever it is bound to).
        const bound = ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) ? node.propertyName ?? node.name : undefined;
        const read = ts.isPropertyAccessExpression(node) ? node.name : ts.isElementAccessExpression(node) ? node.argumentExpression : bound;
        // A unit raised by hand: `${unit}²` (a template's text right after an expression) or `unit + '²'`.
        const after = ts.isTemplateSpan(node) ? node.literal.text
            : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteralLike(node.right) && !ts.isStringLiteralLike(node.left) ? node.right.text : undefined;
        if (after !== undefined && UNIT_EDITS.test(after)) note(sites, rel, 'unit-edit', siteOf(node));
        if (!read || !(ts.isIdentifier(read) || ts.isStringLiteralLike(read))) return;
        for (const [group, pattern] of Object.entries(GUARDED_PROPERTIES)) if (pattern.test(read.text)) note(sites, rel, group, siteOf(node));
    });
    // Comments say what the code does; only the code is looked at. Blanked in place, so a match keeps its position.
    const code = text.replace(/^[ \t]*(?:\/\/|\/?\*).*$/gmu, line => ' '.repeat(line.length));
    for (const [group, pattern] of Object.entries(TEXT_PATTERNS)) {
        for (const match of code.matchAll(pattern)) {
            let at: ts.Node = source;
            for (let inner: ts.Node | undefined = at; inner; inner = ts.forEachChild(at, child => (child.getStart(source) <= match.index && match.index < child.end ? child : undefined))) at = inner;
            note(sites, rel, group, siteOf(at));
        }
    }
    return sites;
}

/** Every use of a GUARDED_FUNCTIONS function in `program`, by what the name declares. */
function functionSites(program: ts.Program, sites: Sites = {}): Sites {
    const checker = program.getTypeChecker();
    const guarded = new Map<ts.Node, string>();
    for (const [group, entries] of Object.entries(GUARDED_FUNCTIONS)) {
        for (const entry of entries) {
            const [rel, name] = entry.split(':');
            const declared = program.getSourceFile(path.join(srcRoot, rel))?.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
            assert.ok(declared, `${entry} is not a function of its file any more: name what replaced it in GUARDED_FUNCTIONS (src/test/figureModel.test.ts)`);
            guarded.set(declared, group);
        }
    }
    for (const source of program.getSourceFiles()) {
        const rel = path.relative(srcRoot, source.fileName).split(path.sep).join('/');
        if (rel.startsWith('..') || rel.startsWith('test/') || source.isDeclarationFile) continue;
        each(source, node => {
            // An import or export only passes the name on, and a declaration's own name is not a use of it.
            if (!ts.isIdentifier(node) || ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent) || ts.isImportClause(node.parent) || (ts.isFunctionDeclaration(node.parent) && node.parent.name === node)) return;
            let symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
            const group = symbol?.declarations?.[0] ? guarded.get(symbol.declarations[0]) : undefined;
            if (group) note(sites, rel, group, siteOf(node));
        });
    }
    return sites;
}

const srcRoot = path.join(__dirname, '..', '..', 'src');
function sources(): Array<{ rel: string; source: string }> {
    const files: Array<{ rel: string; source: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated' && name !== 'e2e') walk(full); } else if (name.endsWith('.ts') && !isNewPath(`src/${path.relative(srcRoot, full).split(path.sep).join('/')}`)) files.push({ rel: path.relative(srcRoot, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
        }
    };
    walk(srcRoot);
    return files;
}

/** The product's sources with their types, `extra` (path under src → text) added: for the injections. */
function typed(files: ReadonlyArray<{ rel: string }>, extra: Readonly<Record<string, string>> = {}): ts.Program {
    const config = ts.getParsedCommandLineOfConfigFile(path.join(srcRoot, '..', 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
    const options = { ...config?.options, noEmit: true };
    const host = ts.createCompilerHost(options, true);
    const added = new Map(Object.entries(extra).map(([rel, text]) => [path.join(srcRoot, rel), text]));
    const own = host.getSourceFile.bind(host), exists = host.fileExists.bind(host), reads = host.readFile.bind(host);
    host.getSourceFile = (fileName, version, onError, create) => {
        const text = added.get(path.resolve(fileName));
        return text !== undefined ? ts.createSourceFile(fileName, text, version, true) : own(fileName, version, onError, create);
    };
    host.fileExists = fileName => added.has(path.resolve(fileName)) || exists(fileName);
    host.readFile = fileName => added.get(path.resolve(fileName)) ?? reads(fileName);
    return ts.createProgram([...files.map(file => path.join(srcRoot, file.rel)), ...added.keys()], options, host);
}

const INJECTED_FILE = 'webview/runtime/injectedFigure.ts';
/** Uses of the guarded functions under other names: what a search for their spelling would miss. */
const INJECTED_USES = [
    "import { niceRange as nice, heatmapDbRange } from '../../shared/utils/ticks';",
    "import { levelIdentityOf as keyOf } from './comparePanes';",
    'export const renamed = (low: number, high: number) => nice(low, high);',
    'export const handedOn = [heatmapDbRange].map(rule => rule(0, 1));',
    'export const identity = (input: Parameters<typeof keyOf>[0]) => keyOf(input);',
].join('\n');

test('outside figureModel.ts nothing builds an axis name, calls an axis builder, keys by level identity, applies a range rule, counts files for n or defaults a reference, but the exact list; figureModel.ts only its own definitions (docs/plot-layers.md)', () => {
    const files = sources();
    assert.ok(files.length > 100, String(files.length));
    // One program for the real sources and the injected uses: the injected file's sites are taken out and checked apart.
    const sites = functionSites(typed(files, { [INJECTED_FILE]: INJECTED_USES }));
    const injected = sites[INJECTED_FILE];
    delete sites[INJECTED_FILE];
    for (const { rel, source } of files) fileSites(rel, source, sites);
    const problems: string[] = [];
    for (const rel of new Set([...Object.keys(sites), ...Object.keys(ALLOWED)])) {
        for (const group of new Set([...Object.keys(sites[rel] ?? {}), ...Object.keys(ALLOWED[rel] ?? {})])) {
            const found = sites[rel]?.[group] ?? [], allowed = ALLOWED[rel]?.[group] ?? [];
            for (const site of found.filter(name => !allowed.includes(name))) problems.push(group === 'unit-edit' ? `src/${rel}: ${site} writes an exponent onto a unit (R4): the unit of a picture's values is sent raised by the backend (stage_view.channel_unit); show view.unit as it is, through figureModel's names.` : `src/${rel}: ${site} does what only the figure layer may (${group}). Take the name, range, identity or count from src/webview/runtime/figureModel.ts (docs/plot-layers.md). If this is not a figure's (say, a definition figureModel.ts wraps), add '${site}' to ALLOWED['${rel}']['${group}'] in src/test/figureModel.test.ts with a comment saying why.`);
            for (const site of allowed.filter(name => !found.includes(name))) problems.push(`src/${rel}: ${site} no longer matches ${group}: take it off ALLOWED in src/test/figureModel.test.ts (the list only shrinks).`);
        }
    }
    assert.deepEqual(problems, []);
    // The same scan finds a guarded function used under another name, through a namespace, or handed on as a value.
    assert.deepEqual(injected, { 'identity': ['identity'], 'range-rule': ['handedOn', 'renamed'] });
});

test('the structural check fails on each injected bug: every violation of class sweep 1 (reference, aggregation) and the first ones (an axis name, pending in n, two identities on one axis, a CSV header without its reference)', () => {
    const files = new Map(sources().map(file => [file.rel, file.source]));
    const inject = (rel: string, code: string): Sites => fileSites(rel, `${files.get(rel) ?? ''}\n${code}\n`);
    const injected: Array<[string, string, string]> = [
        ['webview/runtime/trackStagePainter.ts', 'const y = `${STR.axisLevelCal} [dB]`;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const y = s.axisLevelCal;', 'axis-name'],
        ['webview/runtime/trackStagePainter.ts', 'const { axisUncalibrated } = strings;', 'axis-name'],
        // V1: a line without a recording read on the first track's reference.
        ['webview/runtime/trackStagePainter.ts', 'const inputOf = (layer: StageLayer) => tracks[0]?.input;', 'first-track-input'],
        // A1, A3, A7: a base group chosen by hand, of another reference or with pending files kept.
        // V9, B2: rows compared by a key of unit and reference of their own.
        ['webview/runtime/entryTable.ts', 'const key = JSON.stringify([input.channels.length, input.unit, input.ref]);', 'identity'],
        // V8: lines put on an axis by the text of their axis name.
        ['webview/runtime/pairSpectrum.ts', 'const drawn = ok.filter(curve => curve.response.axisLabel === axisLabel);', 'identity'],
        // Pending counted in n; A10: a heading's count of every recording asked for; a count of ok answers by hand.
        ['webview/runtime/entryBase.ts', 'const definition = { count: basePaths.length };', 'file-count'],
        ['webview/runtime/trackStageMode.ts', 'const title = eachBaseTitle(base, allBase.length, strings);', 'file-count'],
        ['webview/runtime/entryBase.ts', 'const measured = paths.filter(path => results.get(path)?.ok).length;', 'file-count'],
        // V3: a level CSV column in bare dB.
        ['webview/runtime/entryRuntime.ts', 'const band = `${bandLabel(model.band)} dB`;', 'bare-db'],
        ['webview/runtime/entryRuntime.ts', 'const header = [strings.entryColLeq, strings.reportBaseLeq];', 'csv-column'],
        // V5: an axis named uncalibrated while any recording on it is.
        ['webview/runtime/entrySidePlots.ts', 'const calibrated = files.every(path => !!scanned.get(path)?.calibrated);', 'every-calibrated'],
        // V6: the page's calibration note from the table's rows.
        ['webview/runtime/compareReport.ts', 'const uncalibrated = new Set(input.model.rows.map(row => row.uncalibrated));', 'table-calibration'],
        // V7: a level written in wandas' bare levelUnit.
        ['shared/report/analysisReport.ts', 'const text = formatReportDb(value, measurement.levelUnit);', 'bare-level-unit'],
        // V11: a UI string naming a level "[dB]".
        ['shared/i18n/strings.ts', "const preset = { presetLevelGraph: 'A-weighted RMS level [dB]' };", 'bracket-db'],
        // A4, A5: a region's results mixed with the whole files'.
        ['webview/runtime/comparisonRuntime.ts', 'const results = new Map([...data.results, ...measured]);', 'mixed-results'],
        // Class sweep 3: a CSV column in "dB(A)" (V6), a reference defaulted before anything is read (V9), in the layer too.
        ['shared/i18n/strings.ts', "const columns = { entryColLeq: 'Leq dB(A)' };", 'default-reference'],
        ['webview/runtime/entrySidePlots.ts', "const label = folder.label || 'dBFS';", 'default-reference'],
        ['webview/runtime/figureModel.ts', "const unit = response?.levelReferenceLabel ?? 'dB';", 'default-reference'],
        // V4: a median line calibrated when any one is, outside medianInputOf; V8: empty axes named by the first track.
        ['webview/runtime/trackStageMode.ts', "const calibrated = inputs.every(input => input?.calibrationStatus === 'calibrated');", 'every-calibrated'],
        ['webview/runtime/trackStagePainter.ts', 'const mainNames = stageNames(strings, picture, tracks[0]?.input);', 'first-track-input'],
        // Class sweep 4: a median's calibration by `.some(`, a gain fixed as calibrated, a bare levelUnit after a label,
        // a dBFS assumed for an input nobody gave.
        ['webview/runtime/comparePanes.ts', 'const uncalibrated = sides.some(side => side.uncalibrated);', 'every-calibrated'],
        ['webview/runtime/figureModel.ts', "const gain = { unit: '1', calibrationStatus: 'calibrated' };", 'every-calibrated'],
        ['shared/report/analysisReport.ts', 'const text = measurement.levelReferenceLabel || measurement.levelUnit;', 'bare-level-unit'],
        ['webview/runtime/trackStagePainter.ts', 'const reference = input ?? { levelReferenceLabel: uncalibratedUnits(true).level };', 'default-reference'],
        // A power's unit squared in the webview (the axis said Pa², the readout Pa): the backend sends it raised.
        ['webview/runtime/trackStagePainter.ts', "const title = `${name} [${measure === 'power' ? `${base}\u00b2` : base}]`;", 'unit-edit'],
        ['webview/runtime/figureModel.ts', "const shown = view.unit + '^0.5';", 'unit-edit'],
    ];
    for (const [rel, code, pattern] of injected) {
        const before = fileSites(rel, files.get(rel) ?? '')[rel]?.[pattern] ?? [];
        const added = (inject(rel, code)[rel]?.[pattern] ?? []).filter(site => !before.includes(site));
        assert.equal(added.length, 1, `${rel}: ${pattern}: ${code}`);
    }
});

/**
 * The class closed (A43, A49): nothing outside the layer keys lines by a label, an axis title or a unit string; every
 * file that builds a second level axis or a range per group takes its groups from figureModel.ts.
 */
test('every place that groups lines onto a level axis, range or colour scale goes through figureModel (A43, A49, R1, R4)', () => {
    const LABEL = '(?:levelReferenceLabel|axisLabel|spectrumLevelReference|shownLevelOf|levelUnit|referenceUnit|levelLabel)';
    const keyedByLabel = new RegExp(`\\.(?:get|set|has)\\(\\s*[^,()\\n]*\\b${LABEL}\\b|new (?:Set|Map)\\([^\\n]*\\b${LABEL}\\b|statuses\\.(?:get|set)\\(`, 'u');
    const buildsSecondary = /secondary:\s*\{\s*layers:/u;
    const rangesPerGroup = /new Map<string,\s*PaneRange>/u;
    const grouped = /from '\.\/figureModel'/u;
    const problems: string[] = [];
    let builders = 0;
    for (const { rel, source } of sources()) {
        if (rel !== 'webview/runtime/figureModel.ts' && keyedByLabel.test(source)) problems.push(`${rel}: keys levels by a label or unit (${keyedByLabel.exec(source)?.[0]})`);
        if (buildsSecondary.test(source) || rangesPerGroup.test(source)) {
            builders++;
            if (!grouped.test(source)) problems.push(`${rel}: builds a level axis per group without figureModel`);
        }
    }
    // The one figure of two level axes (the old cursor spectrum) is on the figure path now (a lane a unit and
    // reference: charts/cursorSpectrum.ts): no file builds a second axis here any more, and one that starts to is held.
    assert.equal(builders, 0, 'a file builds a level axis per group again: name it here and hold it to figureModel');
    assert.deepEqual(problems, []);
});
