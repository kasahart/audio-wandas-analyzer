/**
 * One FigureSet per figure (class sweep 2): every n, median and heading count of a figure is of the one set
 * figureModel builds from answers, its identity from the compared file's answer. These tests fail when any of them is
 * computed from anything else, and each sweep item is injected to show the check catches it.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { setCountText, setExclusionText } from '../webview/runtime/figureModel';

const STR = getStrings('en');
const root = path.resolve(__dirname, '..', '..', 'src');

/** Where each builder of a figure's set (or of the answers it is built of) may be called: nowhere else. */
const BUILDERS: Record<string, { pattern: RegExp; places: string[] }> = {
    // A set is made in figureModel alone, of the counts the figure service returned: the step figure's heading takes it.
    'countedSet': { pattern: /\bcountedSet\(/gu, places: ['webview/runtime/trackStageMode.ts'] },
    // An answer made of a scan: the answer store's alone.
    'scanAnswer': { pattern: /\bscanAnswer\(/gu, places: [] },
};

/** What makes a figure's n, median, heading or identity of something other than its one set. */
const BYPASSES: Record<string, RegExp> = {
    // A set made by hand (a cast) instead of by countedSet.
    'cast-set': /as (?:unknown as )?FigureSet\b/gu,
    // The base's heading count written outside figureModel (setCountText / setExclusionText).
    'heading-count': /\b(?:entryBaseMedian|entryBaseCount|entryCount|dsBase(?:Failed|Empty|Missing|Pending|Stale|OtherUnits|OtherChannels|OtherBins|NoIdentity|Fewer)|dsDistApart)\.replace\(|\$\{[\w.?]*members\??\.length\}|\b(?:members|shown|drawn|counted)\??\.toLocaleString\(/gu,
    // An identity taken from "the first ready one" or the compared file's level assumed for a member (`?? like`).
    'first-ready': /\.find\(\(?\w+\)? => \w+\.state === 'ready'\)|\.filter\(isReady\)\[0\]|\.find\(isReady\)/gu,
    'assumed-level': /\?\?\s*like\b/gu,
    // A one-recording n written as a literal rather than counted by the set (slot 0's n).
    'literal-n': /\b(?:count|n):\s*1\b|[`'][^`'\n]*\bn=1\b[^`'\n]*[`']/gu,
    // A level read off a raw results map (a stale scan's calibration) for an axis, identity or set.
    'raw-level': /\b(?:results|entryResults|shown|scans|data\.results|deps\.results|input\.results)\.get\([^)]*\)\??\.input\b(?!\??\.durationS)/gu,
    // While a member is pending the figure is drawn of every member asked for, not of its set.
    'all-asked': /\?\s*allowed\s*:\s*stageSet\.paths/gu,
};

/** The files that make or show a figure's set (a literal n elsewhere counts something else: tracks, sources). */
const FIGURE_FILES = new Set(['webview/runtime/entryBase.ts', 'webview/runtime/comparePanes.ts', 'webview/runtime/compareReport.ts', 'webview/runtime/entryRuntime.ts', 'webview/runtime/trackStageMode.ts', 'webview/runtime/trackStageModel.ts', 'webview/runtime/comparisonRuntime.ts']);

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? (entry.name === 'test' ? [] : sources(full)) : full.endsWith('.ts') ? [full] : [];
    });
}

/** Each problem of one source: a builder called outside its places, or a bypass of the set. */
function figureSetProblems(name: string, text: string): string[] {
    if (name === 'webview/runtime/figureModel.ts' || name === 'webview/runtime/answerStore.ts') return [];
    const problems: string[] = [];
    for (const [builder, { pattern, places }] of Object.entries(BUILDERS)) {
        if (!places.includes(name) && (text.match(pattern) ?? []).length) problems.push(`${name}: ${builder} outside ${places.join(', ')}`);
    }
    for (const [bypass, pattern] of Object.entries(BYPASSES)) {
        if (bypass === 'literal-n' && !FIGURE_FILES.has(name)) continue;
        for (const hit of text.match(pattern) ?? []) problems.push(`${name}: ${bypass} (${hit})`);
    }
    return problems;
}

test('every n, median and heading count is of a FigureSet: no source builds a set, counts or names a base any other way', () => {
    const problems = sources(root).flatMap(file => figureSetProblems(path.relative(root, file).split(path.sep).join('/'), readFileSync(file, 'utf8')));
    assert.deepEqual(problems, []);
});

test('each class-sweep-2 bypass injected into a real source is caught', () => {
    const read = (name: string): string => readFileSync(path.join(root, name), 'utf8');
    const injected: Array<[string, string, string]> = [
        // aggregation V1, reference V1/V3: a stale table scan's level read for the track's axis or a fixed Δ's base.
        ['webview/runtime/comparisonRuntime.ts', 'const input = entryResults.get(path)?.input;', 'raw-level'],
        ['webview/runtime/entryRuntime.ts', 'levelOf: path => results.get(path)?.input,', 'raw-level'],
        // aggregation V3/V4/V8/V9: the stage drawing and asking the median of every member while one is pending.
        ['webview/runtime/trackStageMode.ts', 'const basePaths = waitingBase ? allowed : stageSet.paths;', 'all-asked'],
        // reference V4: a member of unknown level taken as the compared one's.
        ['webview/runtime/trackStageMode.ts', 'const level = levelOf(path) ?? like;', 'assumed-level'],
        // aggregation V5: a group with nothing compared counted against the first ready member's identity.
        ['webview/runtime/entryBase.ts', 'const first = answers.find(answer => answer.state === \'ready\');', 'first-ready'],
        // aggregation V6: slot 0's n written as one, not its set's.
        ['webview/runtime/entryBase.ts', 'definition: { kind: \'file\', count: 1 },', 'literal-n'],
        // aggregation V7/V10 and the heading: a count or a left-out reason written outside figureModel.
        ['webview/runtime/entryBase.ts', 'const title = strings.entryBaseMedian.replace(\'{count}\', String(paths.length));', 'heading-count'],
        ['webview/runtime/trackStageMode.ts', 'const left = strings.dsBaseFailed.replace(\'{n}\', String(failed));', 'heading-count'],
        // A second set beside the figure's: one made by hand, or a builder called where the figure is drawn.
        ['webview/runtime/comparePanes.ts', 'const set = { used, excluded: [], n: used.length, paths, level } as unknown as FigureSet<ScanOk>;', 'cast-set'],
        ['webview/runtime/entryBase.ts', 'const set = countedSet(paths, []);', 'countedSet'],
        // An answer made of a scan beside the store's.
        ['webview/runtime/entryBase.ts', 'const own = scanAnswer(path, binned.get(path));', 'scanAnswer'],
        // Class sweep 3: counts outside the set (the distribution's heading, the waveform heading, the channel-less
        // members), the first ready one by another spelling, a level read off another raw map, a literal n=1.
        ['webview/runtime/entryBase.ts', 'const without = strings.dsBaseFewer.replace(\'{n}\', String(fewer));', 'heading-count'],
        ['webview/runtime/trackStageMode.ts', 'const title = strings.entryBaseCount.replace(\'{count}\', String(paths.length));', 'heading-count'],
        ['webview/runtime/entryBase.ts', 'const first = answers.filter(isReady)[0];', 'first-ready'],
        ['webview/runtime/trackStageMode.ts', 'const input = shown.get(path)?.input;', 'raw-level'],
        ['webview/runtime/compareReport.ts', 'const text = `n=1`;', 'literal-n'],
        // Class sweep 4: the distribution heading's n by another name, an empty answer's reason written by hand.
        ['webview/runtime/trackStageMode.ts', 'const left = strings.dsBaseEmpty.replace(\'{n}\', String(empty));', 'heading-count'],
    ];
    for (const [name, line, kind] of injected) {
        const problems = figureSetProblems(name, `${read(name)}\n${line}\n`);
        assert.ok(problems.some(problem => problem.includes(kind)), `${name}: ${line} → ${JSON.stringify(problems)}`);
    }
});

test('the heading\'s n and left-out reasons accept only a FigureSet', () => {
    const never = (): void => {
        const plain = { excluded: [], n: 0, paths: [] };
        // @ts-expect-error a set not made by countedSet
        setCountText(plain, STR);
        // @ts-expect-error a set not made by countedSet
        setExclusionText(plain, STR);
    };
    void never;
});

// ── The sweep's items as behaviour ───────────────────────────────────────────────────────────────────────────────

test('figureModel never makes an answer identity with an empty version or recipe: an identity is the answer store\'s (class sweep 4, B2)', () => {
    const source = readFileSync(path.join(root, 'webview/runtime/figureModel.ts'), 'utf8');
    const made = /\bfileVersion:\s*(['"`])\1|\brecipeKey:\s*(['"`])\2/u;
    assert.ok(!made.test(source), 'an AnswerIdentity with an empty version or recipe is built in figureModel.ts');
    // The check fails on the identity sweep 4 took out.
    assert.ok(made.test(`${source}\nconst id = { path, fileVersion: '', calibrationSignature: '', recipeKey: '' };\n`));
});
