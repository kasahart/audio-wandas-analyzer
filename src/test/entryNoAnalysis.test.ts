import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/**
 * The entry is a recording picker: putting recordings in starts no analysis,
 * and its screen makes no answer. Checked on the entry's own files: the messages they send to the host, and the
 * modules and names they reach. What the entry shows of a file is its header (entry-probe) and the picked CSV; its
 * one figure, the distribution, is the figure service's.
 */
const SRC = path.resolve(__dirname, '..', '..', 'src');
const RUNTIME = path.join(SRC, 'webview', 'runtime');
/** The entry screen's files: every entry*.ts of the runtime, and what writes its report. */
const ENTRY = [
    ...fs.readdirSync(RUNTIME).filter(name => /^entry[A-Z].*\.ts$/.test(name)).map(name => `webview/runtime/${name}`),
    'webview/runtime/compareReport.ts', 'webview/runtime/compareBasics.ts', 'webview/runtime/keptRows.ts', 'webview/screens/distributionFigure.ts',
    'shared/dataset/datasetTable.ts', 'shared/dataset/distribution.ts',
];
/** Every message a webview may send the host: the cases parsePanelMessage knows. */
const HOST_MESSAGES = new Set([...fs.readFileSync(path.join(SRC, 'shared', 'protocol', 'panelMessages.ts'), 'utf8').matchAll(/case '([a-z-]+)':/g)].map(match => match[1]));
/** What the entry asks its host: the folder's Recipe and session, the files' headers, and to keep its session. */
const ENTRY_ASKS = ['entry-open', 'entry-probe', 'entry-probe-cancel', 'entry-save-session'];
/** The comparison's own scans, their answers and its gestures: none is the entry's. */
const NOT_ENTRY_MODULES = ['comparePanes', 'stageSource', 'plotInteraction', 'trackStagePainter'];
const NOT_ENTRY_NAMES = ['attachPlotInteraction', 'createStageSource', 'createAnswerStore'];

function found(rel: string, source: string): { asks: string[]; problems: string[] } {
    const asks: string[] = [];
    const problems: string[] = [];
    const file = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && NOT_ENTRY_MODULES.includes(path.basename(node.moduleSpecifier.text))) {
            problems.push(`${rel}: imports ${node.moduleSpecifier.text}`);
        }
        if (ts.isIdentifier(node) && NOT_ENTRY_NAMES.includes(node.text)) problems.push(`${rel}: names ${node.text}`);
        // A message made here: an object literal's `type` that is one of the host's messages.
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'type' && ts.isStringLiteralLike(node.initializer) && HOST_MESSAGES.has(node.initializer.text)) {
            asks.push(node.initializer.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return { asks, problems };
}

const FIX = 'Rule: the entry picks recordings; it starts no analysis and makes no answer. '
    + 'Fix: show a value of a file from its header (entry-probe) or the picked CSV; a figure of the entry is a chart spec drawn by the figure service (src/webview/screens/distributionFigure.ts). '
    + 'A value of an analysis belongs to the comparison, not here.';

test('putting recordings in starts no analysis: the entry sends the host only its open, its header reads and its session, never a scan', () => {
    assert.ok(HOST_MESSAGES.has('compare-scan') && HOST_MESSAGES.has('figure-request') && HOST_MESSAGES.has('entry-open'), 'the host\'s messages are read off panelMessages.ts');
    assert.ok(ENTRY.includes('webview/runtime/entryRuntime.ts') && ENTRY.length >= 10, ENTRY.join(', '));
    const asks = new Set(ENTRY.flatMap(rel => found(rel, fs.readFileSync(path.join(SRC, rel), 'utf8')).asks));
    assert.deepEqual([...asks].sort(), ENTRY_ASKS, FIX);
});

test('the entry\'s own files reach none of the comparison\'s scans, answers or gestures', () => {
    assert.deepEqual(ENTRY.flatMap(rel => found(rel, fs.readFileSync(path.join(SRC, rel), 'utf8')).problems), [], FIX);
});

test('the check finds a scan asked, a module of the comparison imported and a function of it named (mutation)', () => {
    assert.deepEqual(found('probe.ts', "export const ask = (post: (m: unknown) => void) => post({ type: 'compare-scan', requestId: 'x', filePaths: [] });").asks, ['compare-scan']);
    assert.deepEqual(found('probe.ts', "export const say = () => ({ type: 'entry-conditions' });").asks, [], 'a host\'s reply is not an ask');
    const cases: Array<[string, string]> = [
        ["import { stageDom } from './trackStagePainter';", 'imports ./trackStagePainter'],
        ["import { legendHtml } from '../runtime/comparePanes';", 'imports ../runtime/comparePanes'],
        ["import { createStageSource as source } from './somewhere';", 'names createStageSource'],
    ];
    for (const [code, said] of cases) assert.ok(found('probe.ts', code).problems.some(problem => problem.includes(said)), `${code}: ${said}`);
});
