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
import type { ScanResult, StageView } from '../shared/protocol/backendProtocol';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import { setMedian } from '../webview/runtime/comparePanes';
import { buildEntryModel, entryCsv } from '../webview/runtime/entryTable';
import {
    baseLevelOf, bandLevelColumns, figureUsed, folderReference, levelColumns, pictureSet, referenceIdentity, scanIdentity, setCountText, setExclusionText, type FigureSet,
} from '../webview/runtime/figureModel';

const STR = getStrings('en');
const root = path.resolve(__dirname, '..', '..', 'src');

/** Where each builder of a figure's set (or of the answers it is built of) may be called: nowhere else. */
const BUILDERS: Record<string, { pattern: RegExp; places: string[] }> = {
    // The base sets: entryBase (the comparison's, slot 0's, its peers'), a fixed Δ measured again (compareReport.remeasured).
    'figureUsed': { pattern: /\bfigureUsed\(/gu, places: ['webview/runtime/entryBase.ts', 'webview/runtime/compareReport.ts'] },
    // The step figure's one set.
    'pictureSet': { pattern: /\bpictureSet\(/gu, places: ['webview/runtime/trackStageMode.ts'] },
    // The folder's one reference: the entry model's, which the header, overview, distribution and table all take.
    'folderReference': { pattern: /\bfolderReference\(/gu, places: ['webview/runtime/entryTable.ts'] },
    // Answers made of scans outside the store: the region's and the files measured now (entryBase), the model's reference.
    'scanAnswer': { pattern: /\bscanAnswer\(/gu, places: ['webview/runtime/entryBase.ts', 'webview/runtime/entryTable.ts'] },
};

/** What makes a figure's n, median, heading or identity of something other than its one set. */
const BYPASSES: Record<string, RegExp> = {
    // A set made by hand (a cast) instead of by figureUsed.
    'cast-set': /as (?:unknown as )?FigureSet\b/gu,
    // The base's heading count written outside figureModel (setCountText / setExclusionText).
    'heading-count': /\b(?:entryBaseMedian|entryBaseCount|entryCount|dsBase(?:Failed|Missing|Pending|Stale|OtherUnits|OtherBins|NoIdentity|Fewer)|dsDistApart)\.replace\(|\$\{[\w.?]*members\??\.length\}|\bmembers\??\.toLocaleString\(/gu,
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
const FIGURE_FILES = new Set(['webview/runtime/entryBase.ts', 'webview/runtime/comparePanes.ts', 'webview/runtime/compareReport.ts', 'webview/runtime/entryTable.ts', 'webview/runtime/entryRuntime.ts', 'webview/runtime/trackStageMode.ts', 'webview/runtime/trackStageModel.ts', 'webview/runtime/comparisonRuntime.ts', 'webview/runtime/entryHeldPlot.ts', 'webview/runtime/entrySidePlots.ts']);

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
        ['webview/runtime/entrySidePlots.ts', 'const set = figureUsed(null, answers);', 'figureUsed'],
        // reference V2: a second most-common-reference choice beside the entry model's.
        ['webview/runtime/entrySidePlots.ts', 'const folder = folderReference(deps.answers(paths));', 'folderReference'],
        ['webview/runtime/entryHeldPlot.ts', 'const own = scanAnswer(path, binned.get(path));', 'scanAnswer'],
        // Class sweep 3: counts outside the set (the distribution's heading, the waveform heading, the channel-less
        // members), the first ready one by another spelling, a level read off another raw map, a literal n=1.
        ['webview/runtime/entryDistributionPane.ts', 'count.textContent = `${group.members.length} ${unit}`;', 'heading-count'],
        ['webview/runtime/entryDistributionPane.ts', 'count.textContent = members.toLocaleString();', 'heading-count'],
        ['webview/runtime/entryBase.ts', 'const without = strings.dsBaseFewer.replace(\'{n}\', String(fewer));', 'heading-count'],
        ['webview/runtime/trackStageMode.ts', 'const title = strings.entryBaseCount.replace(\'{count}\', String(paths.length));', 'heading-count'],
        ['webview/runtime/entryBase.ts', 'const first = answers.filter(isReady)[0];', 'first-ready'],
        ['webview/runtime/trackStageMode.ts', 'const input = shown.get(path)?.input;', 'raw-level'],
        ['webview/runtime/compareReport.ts', 'const text = `n=1`;', 'literal-n'],
    ];
    for (const [name, line, kind] of injected) {
        const problems = figureSetProblems(name, `${read(name)}\n${line}\n`);
        assert.ok(problems.some(problem => problem.includes(kind)), `${name}: ${line} → ${JSON.stringify(problems)}`);
    }
});

test('the median, the heading\'s n and left-out reasons, and a base\'s reference cell accept only a FigureSet', () => {
    const never = (): void => {
        const plain = { used: [], excluded: [], n: 0, paths: [], level: null };
        // @ts-expect-error a set not made by figureUsed
        setMedian(plain);
        // @ts-expect-error a set not made by figureUsed
        setCountText(plain, STR);
        // @ts-expect-error a set not made by figureUsed
        setExclusionText(plain, STR);
        // @ts-expect-error a set not made by figureUsed
        baseLevelOf(plain);
        // @ts-expect-error answers are not an identity: the identity is decided from the compared file's answer
        figureUsed([], []);
    };
    void never;
});

// ── The sweep's items as behaviour ───────────────────────────────────────────────────────────────────────────────

const scan = (leq: number, calibrated = false): ScanResult => ({
    ok: true, conditionId: `c${leq}`, specVersion: 5,
    input: calibrated
        ? { id: 'i', fs: 16000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false }
        : { id: 'i', fs: 16000, channels: [0], durationS: 1, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true },
    leqDbA: [leq], peakHz: [100], crest: [1], spectrumDb: [[leq, leq]], thirdOctDb: [[leq, leq]],
});
const stale = (answer: ScanAnswer): ScanAnswer => (answer.state === 'ready' ? { state: 'stale', value: answer.value, identity: answer.identity } : answer);

test('a set\'s identity is the compared file\'s answer: none compared or still pending counts nothing; a stale compared file has none (aggregation V1, V5, V6)', () => {
    const members = [scanAnswer('/a.wav', scan(-20)), scanAnswer('/b.wav', scan(-22)), scanAnswer('/s.wav', scan(60, true))];
    assert.equal(figureUsed(scanIdentity(scanAnswer('/c.wav', scan(-21))), members).n, 2);
    assert.equal(figureUsed(scanIdentity(scanAnswer('/c.wav', undefined)), members).n, 0, 'pending compared: nothing counted yet');
    assert.equal(figureUsed(scanIdentity(stale(scanAnswer('/c.wav', scan(60, true)))), members).n, 0, 'a stale compared file names no identity');
    // Nothing compared: the folder's one reference (the most common, ties to the first in the table), never the first ready member's.
    const folder = folderReference([scanAnswer('/t.wav', scan(61, true)), ...members]);
    assert.equal(folder.label, 'dB SPL re 20 µPa', 'two each: the tie goes to the first in the table');
    assert.equal(folderReference(members).label, 'dBFS');
    assert.deepEqual(figureUsed(referenceIdentity(folderReference(members)), members).paths, ['/a.wav', '/b.wav']);
    // Slot 0's n is its set's: one when it is of the compared identity, none when of another.
    assert.equal(figureUsed(scanIdentity(scanAnswer('/c.wav', scan(-21))), [members[0]]).n, 1);
    assert.equal(figureUsed(scanIdentity(scanAnswer('/c.wav', scan(-21))), [members[2]]).n, 0);
});

test('a stale row is written to the entry CSV with no numbers and is never in a group; what a base left out is its own column (aggregation V2, V7)', () => {
    const model = buildEntryModel([
        { filePath: '/f/L1_900rpm_run1.wav', result: scan(-20) }, { filePath: '/f/L1_900rpm_run2.wav', result: scan(-21), stale: true },
    ], null);
    assert.ok([...model.groups.values()].every(rows => rows.every(row => !row.stale)));
    const labels = { file: 'File', condition: (n: number) => `c${n}`, regionStart: 's', regionEnd: 'e', level: levelColumns(STR), peak: 'p', bandLevel: bandLevelColumns(STR, '1 kHz'), deltaLeq: 'dl', deltaBand: 'db', groupSize: 'n', groupLeft: 'left', stale: 'previous chain', status: 'st' };
    const lines = entryCsv(model, labels, () => ({ leq: 1, band: 1, peak: null, count: 1, left: '1 failed' })).slice(1).trimEnd().split('\r\n');
    const header = lines[0].split(',');
    assert.equal(header[header.indexOf('n') + 1], 'left');
    const run2 = lines.find(line => line.startsWith('L1_900rpm_run2.wav'))!.split(',');
    assert.equal(run2.at(-1), 'previous chain');
    assert.ok(!run2.includes('-21.0'), run2.join(','));
    const run1 = lines.find(line => line.startsWith('L1_900rpm_run1.wav'))!.split(',');
    assert.equal(run1[header.indexOf('left')], '1 failed');
});

test('the step figure\'s set: a member of unknown level or picture still coming is pending, one on another axis is left out, never assumed the compared one\'s (aggregation V3, V4, V8, V9, reference V4)', () => {
    const view = (xs: number[]): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', xs, values: xs.map(() => 0), data: 'k' });
    const level = scan(0).input!;
    const views: Record<string, StageView | undefined> = { '/a.wav': view([1, 2]), '/b.wav': view([1, 2]), '/c.wav': view([1, 2, 3]), '/u.wav': view([1, 2]) };
    const levels: Record<string, typeof level | undefined> = { '/a.wav': level, '/b.wav': level, '/c.wav': level, '/p.wav': level };
    const set: FigureSet<StageView> = pictureSet(['/a.wav', '/b.wav', '/c.wav', '/p.wav', '/u.wav'], path => views[path], path => levels[path], { level, view: view([1, 2]) }, true);
    assert.deepEqual(set.paths, ['/a.wav', '/b.wav']);
    assert.deepEqual(set.excluded.map(item => `${item.path}:${item.reason}`), ['/c.wav:other-axis', '/p.wav:pending', '/u.wav:pending']);
    // Drawn each as it is, another axis is drawn too: no median is taken of them.
    assert.equal(pictureSet(['/a.wav', '/c.wav'], path => views[path], path => levels[path], { level, view: view([1, 2]) }, false).n, 2);
});
