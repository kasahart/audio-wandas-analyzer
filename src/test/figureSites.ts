/**
 * The structural checks of the figure layer (docs/plot-layers.md), as functions of the code they scan, so the same
 * checks run on the repository (figureModel.test.ts, whose ALLOWED lists the sites that may match) and on code that
 * exists only in memory (guideExamples.test.ts runs the guide's worked example through them).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ContractRow } from './plotContracts/model';

/**
 * What only figureModel.ts may do, found three ways, each the strongest the thing allows:
 *
 * - GUARDED_FUNCTIONS: a function, followed by the type checker from every use to its declaration. Importing it under
 *   another name, through a namespace, or handing it on as a value is found all the same.
 * - GUARDED_PROPERTIES: a UI string read off any object (`s.axisGain`, `s['axisGain']`, `const { axisGain } = s`). A
 *   property can only be read by its name, so the name is what is looked for, in the syntax tree.
 * - UNIT_EDITS: a unit string with an exponent written onto it (`${unit}²`, `unit + '^2'`), found in the syntax tree:
 *   a template's text or a string added straight after an expression, starting with a power mark. The unit of a
 *   picture's values is the backend's (stage_view.signal_unit), already raised; nothing here edits it (R4).
 * - TEXT_PATTERNS: a shape of code or of a string's content that has no declaration to follow (a template ending in
 *   " dB", a default of 'dBFS'). These are text, and can be written around; they hold the forms that have been bugs.
 *
 * Each match is a site: the names of everything named it is in (a function, a const in it, a property of that).
 * ALLOWED (figureModel.test.ts) lists the sites that may match, by name. A new site fails and names itself; so does a listed site that is gone.
 */
export const GUARDED_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
    /** The axis builders and the calibration words. */
    'axis-builder': ['webview/runtime/comparePanes.ts:paneAxes', 'webview/runtime/stagePanes.ts:stageAxes', 'webview/runtime/figureModel.ts:calibrationWords'],
    /** Lines or files keyed by level identity. */
    'identity': ['webview/runtime/comparePanes.ts:levelIdentityOf', 'webview/runtime/figureModel.ts:levelIdentity'],
    /**
     * A picture's axis names (stageNames) or level axes named by their caller (levelAxes' `names`): each listed site
     * names one picture by itself (a Δ, a held plot). The stage overlay's two level axes are named in
     * figureModel.stageLevelAxes by each axis's own lines, and a stage lane in figureModel.laneNames by its own
     * picture or the pending name, so trackStagePainter.byReference and paintStageLanes are never sites (R4).
     */
    'axis-namer': ['webview/runtime/figureModel.ts:stageNames', 'webview/runtime/figureModel.ts:levelAxes'],
    /** R9's range rules. */
    'range-rule': ['shared/utils/ticks.ts:niceRange', 'shared/utils/ticks.ts:heatmapDbRange', 'webview/runtime/stagePanes.ts:stageRange', 'webview/runtime/stagePanes.ts:stageDiffRange'],
};

export const GUARDED_PROPERTIES: Readonly<Record<string, RegExp>> = {
    /** An axis's name built from the UI strings of a level, a gain, a Δ or the calibration word. */
    'axis-name': /^axis(?:Level\w*|Uncalibrated|Gain|TransferLevel|Delta)$/u,
    /** A CSV level column or reference column named outside the layer. */
    'csv-column': /^(?:reportLevelReference|reportBaseLevelReference|reportBaseLeq|entryColBandLevel)$/u,
};

/** A power mark at the start of text written onto an expression: a superscript digit or minus, or a caret. */
export const UNIT_EDITS = /^[\u00b2\u00b3\u00b9\u2070-\u207b^]/u;

export const TEXT_PATTERNS: Readonly<Record<string, RegExp>> = {
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

export type Sites = Record<string, Record<string, string[]>>;


export function each(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, child => each(child, visit));
}

/** Where `node` is, as the names of everything named it is in, outermost first (`paintStage.range`, `STRINGS.ja.axisGain`); `<module>` outside any. */
export function siteOf(node: ts.Node): string {
    const names: string[] = [];
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
        if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at) || ts.isVariableDeclaration(at) || ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) && at.name && (ts.isIdentifier(at.name) || ts.isStringLiteral(at.name))) names.unshift(at.name.text);
    }
    return names.join('.') || '<module>';
}

export function note(sites: Sites, rel: string, group: string, site: string): void {
    const names = ((sites[rel] ??= {})[group] ??= []);
    if (!names.includes(site)) names.push(site);
    names.sort();
}

/** One file's sites of GUARDED_PROPERTIES and TEXT_PATTERNS: found in its syntax tree and its text, no types needed. */
export function fileSites(rel: string, text: string, sites: Sites = {}): Sites {
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
export function functionSites(program: ts.Program, sites: Sites = {}): Sites {
    const checker = program.getTypeChecker();
    const guarded = new Map<ts.Node, string>();
    for (const [group, entries] of Object.entries(GUARDED_FUNCTIONS)) {
        for (const entry of entries) {
            const [rel, name] = entry.split(':');
            const declared = program.getSourceFile(path.join(srcRoot, rel))?.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
            assert.ok(declared, `${entry} is not a function of its file any more: name what replaced it in GUARDED_FUNCTIONS (src/test/figureSites.ts)`);
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

export const srcRoot = path.join(__dirname, '..', '..', 'src');
export function sources(): Array<{ rel: string; source: string }> {
    const files: Array<{ rel: string; source: string }> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated' && name !== 'e2e') walk(full); } else if (name.endsWith('.ts')) files.push({ rel: path.relative(srcRoot, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
        }
    };
    walk(srcRoot);
    return files;
}

/** The product's sources with their types, `extra` (path under src → text) added: for the injections. */
export function typed(files: ReadonlyArray<{ rel: string }>, extra: Readonly<Record<string, string>> = {}): ts.Program {
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


/**
 * What is wrong with the sites found, against the sites `allowed` to match (figureModel.test.ts ALLOWED): each new
 * site names itself and the fix, and so does a listed site that no longer matches (the list only shrinks).
 */
export function siteProblems(sites: Sites, allowed: Sites): string[] {
    const problems: string[] = [];
    for (const rel of new Set([...Object.keys(sites), ...Object.keys(allowed)])) {
        for (const group of new Set([...Object.keys(sites[rel] ?? {}), ...Object.keys(allowed[rel] ?? {})])) {
            const found = sites[rel]?.[group] ?? [], listed = allowed[rel]?.[group] ?? [];
            for (const site of found.filter(name => !listed.includes(name))) problems.push(group === 'axis-namer' ? `src/${rel}: ${site} names an axis by a picture or names level axes itself (axis-namer, R4). A plot of two level axes takes each axis's name from figureModel.stageLevelAxes, which names it by the lines assigned to it, never by the first picture in. If ${site} names one picture by itself (a lane, a Δ), add '${site}' to ALLOWED['${rel}']['axis-namer'] in src/test/figureModel.test.ts with a comment saying why.` : group === 'unit-edit' ? `src/${rel}: ${site} writes an exponent onto a unit (R4): the unit of a picture's values is sent raised by the backend (stage_view.signal_unit); show view.unit as it is, through figureModel's names.` : `src/${rel}: ${site} does what only the figure layer may (${group}). Take the name, range, identity or count from src/webview/runtime/figureModel.ts (docs/plot-layers.md). If this is not a figure's (say, a definition figureModel.ts wraps), add '${site}' to ALLOWED['${rel}']['${group}'] in src/test/figureModel.test.ts with a comment saying why.`);
            for (const site of listed.filter(name => !found.includes(name))) problems.push(`src/${rel}: ${site} no longer matches ${group}: take it off ALLOWED in src/test/figureModel.test.ts (the list only shrinks).`);
        }
    }
    return problems;
}

/** The rows of a level axis, a range or a file count that name no figureModel.ts function (docs/plot-layers.md). */
export function rowsOutsideFigureModel(rows: readonly ContractRow[]): string[] {
    return rows.filter(row => row.value === 'axis' || row.value === 'range' || row.value === 'count')
        .filter(row => !row.computedIn.some(where => where.startsWith('src/webview/runtime/figureModel.ts:'))).map(row => row.id).sort();
}
