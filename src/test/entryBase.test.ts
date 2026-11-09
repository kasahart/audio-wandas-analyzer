import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { datasetRows, type DatasetRow, type GroupId } from '../shared/dataset/datasetTable';
import { channelOfRow, createEntryBase, regionAnswers, type EntryBaseDeps } from '../webview/runtime/entryBase';
import { buildEntryModel } from '../webview/runtime/entryTable';
import { entryMeasure, remeasured, reportCsv, reportStale } from '../webview/runtime/compareReport';
import type { DerivedRow } from '../webview/runtime/entryTable';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import { folderReference } from '../webview/runtime/figureModel';

const strings = getStrings('en');

/** A scanned recording of `channels` channels whose bands are all `level` dB. */
const scanned = (level: number, channels = 1): ScanResult => ({
    ok: true, input: { id: 'x', fs: 48000, channels: Array.from({ length: channels }, (_, index) => index), durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true },
    leqDbA: Array(channels).fill(level), peakHz: Array(channels).fill(100), crest: Array(channels).fill(3),
    spectrumDb: Array.from({ length: channels }, () => [level, level]), thirdOctDb: Array.from({ length: channels }, () => [level, level + 1]), specVersion: 5,
});

function setup(options: { slots?: (string | null)[]; group?: GroupId; baseGroup?: string | null; channels?: Record<string, number>; narrowedBy?: string[]; stale?: string[]; uncalibrated?: string[]; gainCorrected?: string[]; failed?: string[]; pending?: string[] } = {}) {
    const attributes = new Map([
        ['/d/a.wav', { rpm: '900' }], ['/d/b.wav', { rpm: '900' }], ['/d/c.wav', { rpm: '900' }], ['/d/d.wav', { rpm: '1500' }],
    ]);
    const uncalibrated = (result: ScanResult): ScanResult => ({ ...result, input: { ...result.input!, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated' } });
    const results = new Map<string, ScanResult>([...attributes.keys()].map((path, index) => {
        const result = scanned(40 + index * 2, options.channels?.[path] ?? 1);
        // A gain-corrected FS file: dBFS as a raw one is, only its calibration status differs.
        const corrected = (raw: ScanResult): ScanResult => ({ ...raw, input: { ...raw.input!, calibrationStatus: 'calibrated' } });
        return [path, options.gainCorrected?.includes(path) ? corrected(uncalibrated(result)) : options.uncalibrated?.includes(path) ? uncalibrated(result) : result];
    }));
    for (const path of options.failed ?? []) results.set(path, { ok: false, error: 'failed' } as ScanResult);
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, results);
    for (const path of options.pending ?? []) results.delete(path);
    const byKey = new Map(rows.map(row => [row.key, row]));
    const answersOf = (paths: readonly string[]): ScanAnswer[] => paths.map(path => { const answer = scanAnswer(path, results.get(path)); return answer.state === 'ready' && options.stale?.includes(path) ? { ...answer, state: 'stale' } : answer; });
    const state = { slots: options.slots ?? [null, null, null, null], group: options.group ?? 'csv:rpm', baseGroup: options.baseGroup ?? null };
    const deps: EntryBaseDeps = {
        strings, slots: () => state.slots, rows: () => rows, rowOf: key => (key ? byKey.get(key) : undefined), pool: () => rows,
        group: () => state.group, baseGroup: () => state.baseGroup, narrowedBy: () => options.narrowedBy ?? [],
        groupLabel: id => id.replace(/^csv:/, ''), rowName: key => (byKey.get(key)?.name ?? key),
        // The answer store's answer: a result of an earlier chain is stale (shown greyed, never counted).
        answersOf: paths => answersOf(paths),
        reference: () => folderReference(answersOf([...attributes.keys()])),
    };
    return { base: createEntryBase(deps), state, rows, results };
}

test('with slot 0 filled the base is that recording, unless the group is asked for', () => {
    const { base } = setup({ slots: ['/d/d.wav', '/d/a.wav', null, null], narrowedBy: ['rpm: 900'] });
    const file = base.resolve('/d/a.wav');
    assert.deepEqual(file.paths, ['/d/d.wav']);
    assert.equal(file.title, `${strings.entryBase} · d.wav`);
    assert.deepEqual(file.definition, { kind: 'file', file: 'd.wav', count: 1, channel: null, filters: ['rpm: 900'], fewerChannels: 0 });
    assert.equal(base.text(), 'd.wav');
    assert.equal(base.groupName(), null);
    const group = base.resolve('/d/a.wav', true);
    assert.deepEqual(group.paths, ['/d/b.wav', '/d/c.wav'], 'the compared row\'s group, without itself');
    assert.ok(group.title.endsWith(strings.dsBaseNarrowed.replace('{filters}', 'rpm: 900')));
});

test('with slot 0 empty the base is the median of the compared row\'s group, without the other compared files', () => {
    const { base, state } = setup({ slots: [null, '/d/a.wav', '/d/b.wav', null] });
    const resolved = base.resolve('/d/a.wav');
    assert.deepEqual(resolved.paths, ['/d/c.wav'], 'b is compared itself');
    assert.equal(resolved.title, `${strings.entryBaseGroup} rpm 900 · ${strings.entryBaseMedian.replace('{count}', '1')}`);
    assert.deepEqual(resolved.definition, { kind: 'group', group: { column: 'rpm', name: '900' }, count: 1, channel: null, filters: [], fewerChannels: 0 });
    assert.equal(base.text(), resolved.title, 'the chip names slot 1\'s base');
    assert.equal(base.groupName(), '900');
    state.baseGroup = '1500';
    assert.deepEqual(base.resolve('/d/a.wav').paths, ['/d/d.wav'], 'a group chosen on the base chip wins');
    assert.equal(base.groupName(), '1500');
    state.slots = [null, null, null, null];
    assert.equal(base.text(), `rpm 1500 · ${strings.entryBaseMedian.replace('{count}', '1')}`, 'no slot: the chosen group and its size');
    state.baseGroup = null;
    assert.equal(base.text(), strings.entryBaseGroup, 'nothing to anchor a group on');
    state.group = 'none';
    assert.deepEqual(base.resolve('/d/a.wav').paths, ['/d/b.wav', '/d/c.wav', '/d/d.wav'], 'no grouping: every other recording');
    assert.ok(base.resolve('/d/a.wav').title.includes(strings.dsDistAll));
    assert.equal(base.groupName(), null);
});

test('a channel row is compared as its channel; recordings without it are left out and said', () => {
    const { base } = setup({ channels: { '/d/a.wav': 2, '/d/b.wav': 2 }, slots: [null, '/d/a.wav#ch2', null, null] });
    assert.equal(channelOfRow(undefined), null);
    const resolved = base.resolve('/d/a.wav');
    assert.equal(resolved.channel, 2);
    assert.deepEqual(resolved.paths, ['/d/b.wav']);
    assert.equal(resolved.definition.fewerChannels, 1, 'c has no ch 2');
    assert.ok(resolved.title.includes(strings.dsBaseFewer.replace('{n}', '1').replace('{ch}', '2')));
    assert.equal(base.stageChannel('/d/b.wav', '/d/a.wav'), 2, 'a base file is drawn as the compared channel');
    assert.equal(base.stageChannel('/d/a.wav', '/d/a.wav'), 2, 'the compared file as its slotted row');
    assert.equal(base.stageChannel('/d/d.wav', null), null);
    assert.equal(base.stageChannel('/d/b.wav', null), 1, 'a recording without a role as the row its legend names, not its channels\' mean');
    assert.equal(base.slotRowOf('/d/a.wav')?.key, '/d/a.wav#ch2');
});

test('the comparison comes from the base it resolves', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null] });
    const model = base.comparison('/d/a.wav');
    assert.equal(model.compare?.leq, 40);
    assert.deepEqual(model.base?.filePaths, ['/d/b.wav', '/d/c.wav'], 'the group median of b and c');
});

test('a base group\'s recording of an earlier chain is in no median, n or Δ, and the base says it is left out', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null], stale: ['/d/c.wav'] });
    const model = base.comparison('/d/a.wav');
    assert.deepEqual(model.base?.filePaths, ['/d/b.wav'], 'c (stale) is not in the median');
    assert.equal(model.leq?.base, 42);
    const resolved = base.resolve('/d/a.wav');
    assert.equal(resolved.definition.count, 1);
    assert.ok(resolved.title.includes(strings.dsBaseStale.replace('{n}', '1')), resolved.title);
    assert.deepEqual(base.groupBase('leq'), { group: '900', value: 42 }, 'the distribution\'s base line is of the same recordings');
    assert.equal(base.fileComparison('/d/a.wav').leq?.base, 42, 'the entry CSV\'s Δ too');
    // The compared recording of an earlier chain has no Δ at all.
    const staleCompared = setup({ slots: [null, '/d/a.wav', null, null], stale: ['/d/a.wav'] }).base.comparison('/d/a.wav');
    assert.equal(staleCompared.compare, null);
});

test('a group\'s recordings in another unit, reference or calibration than the compared one are left out and said', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null], uncalibrated: ['/d/b.wav'] });
    const resolved = base.resolve('/d/a.wav');
    assert.deepEqual(resolved.paths, ['/d/c.wav']);
    assert.equal(resolved.definition.count, 1);
    assert.equal(resolved.definition.left?.['other-reference'], 1);
    assert.ok(resolved.title.includes(strings.dsBaseOtherUnits.replace('{n}', '1')));
    const comparison = base.comparison('/d/a.wav');
    assert.deepEqual(comparison.base!.filePaths, ['/d/c.wav']);
    assert.equal(comparison.blocked, undefined);
});

test('a base group keeps to the one level identity the backend uses: a gain-corrected FS file and a raw one are both dBFS and are one group (A34, R1)', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null], uncalibrated: ['/d/a.wav', '/d/b.wav'], gainCorrected: ['/d/c.wav'] });
    const resolved = base.resolve('/d/a.wav');
    assert.deepEqual(resolved.paths, ['/d/b.wav', '/d/c.wav']);
    assert.equal(resolved.definition.left?.['other-reference'], undefined);
    assert.equal(base.comparison('/d/a.wav').blocked, undefined);
});

test('one base group everywhere: the distribution\'s base line, the comparison\'s Δ and the entry CSV\'s Δ are of the same recordings', () => {
    // Group L3: a −30, b −25, c −20, d −15, e −10 dB; e compared in slot 1, d in slot 2, c excluded (out of the pool).
    const levels: Record<string, number> = { a: -30, b: -25, c: -20, d: -15, e: -10 };
    const paths = Object.keys(levels).map(name => `/d/${name}.wav`);
    const attributes = new Map(paths.map(path => [path, { line: 'L3' }]));
    const results = new Map<string, ScanResult>(paths.map(path => [path, scanned(levels[path.slice(3, 4)])]));
    const rows: DatasetRow[] = datasetRows(paths, '/d', attributes, results);
    const byKey = new Map(rows.map(row => [row.key, row]));
    const state = { slots: [null, '/d/e.wav', '/d/d.wav', null] as (string | null)[], baseGroup: null as string | null };
    const base = createEntryBase({
        strings, slots: () => state.slots, rows: () => rows, rowOf: key => (key ? byKey.get(key) : undefined), pool: () => rows.filter(row => row.filePath !== '/d/c.wav'),
        group: () => 'csv:line', baseGroup: () => state.baseGroup, narrowedBy: () => [], groupLabel: id => id.replace(/^csv:/, ''), rowName: key => key,
        answersOf: paths => paths.map(path => scanAnswer(path, results.get(path))), reference: () => folderReference(paths.map(path => scanAnswer(path, results.get(path)))),
    });
    const comparison = base.comparison('/d/e.wav');
    assert.deepEqual(comparison.base?.filePaths, ['/d/a.wav', '/d/b.wav'], 'not e itself, not d (compared), not c (excluded)');
    assert.equal(comparison.leq?.base, -27.5);
    assert.deepEqual(base.groupBase('leq'), { group: 'L3', value: -27.5 }, 'the line sits where the Δ is measured from');
    assert.deepEqual(base.groupBase('band:0'), { group: 'L3', value: comparison.base?.bands[0] ?? null });
    assert.equal(base.fileComparison('/d/e.wav').leq?.delta, comparison.leq?.delta, 'the CSV\'s Δ is the comparison\'s');
    assert.equal(base.text(), base.resolve('/d/e.wav').title);
    // A level is drawn only on an axis of the set's own identity: on another reference's axis there is no line.
    assert.deepEqual(base.groupBase('leq', folderReference(paths.map(path => scanAnswer(path, results.get(path)))).level), { group: 'L3', value: -27.5 });
    assert.deepEqual(base.groupBase('leq', 'another reference'), { group: 'L3', value: null });
    // No compared row, a group chosen: the group's recordings but the compared slots, as the chip counts them.
    state.slots = [null, null, '/d/d.wav', null];
    state.baseGroup = 'L3';
    assert.deepEqual(base.groupBase('leq'), { group: 'L3', value: -25 }, 'median of a, b, e');
    assert.equal(base.text(), `line L3 · ${strings.entryBaseMedian.replace('{count}', '3')}`);
    // Slot 0 filled: the base is that recording, no group line.
    state.slots = ['/d/a.wav', '/d/e.wav', null, null];
    assert.equal(base.groupBase('leq'), null);
    assert.equal(base.fileComparison('/d/e.wav').leq?.delta, 20);
});

test('only the entry base builds a comparison or a base group: no screen, file or report makes its own', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..', '..', 'src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? (entry.name === 'test' ? [] : files(full)) : full.endsWith('.ts') ? [full] : [];
    });
    const allowed: Record<string, string[]> = {
        'buildCompareModel(': ['webview/runtime/entryBase.ts', 'webview/runtime/comparePanes.ts'],
        'baseGroupMembers(': ['webview/runtime/entryBase.ts', 'shared/dataset/datasetTable.ts'],
        'setMedian(': ['webview/runtime/entryBase.ts', 'webview/runtime/comparePanes.ts', 'webview/runtime/compareReport.ts'],
    };
    for (const file of files(root)) {
        const text = readFileSync(file, 'utf8');
        const name = path.relative(root, file).split(path.sep).join('/');
        for (const [call, places] of Object.entries(allowed)) {
            assert.ok(!text.includes(call) || places.includes(name), `${name} calls ${call}: a base is resolved only in entryBase.ts`);
        }
    }
    // The distribution draws the base it is given; it takes no median of its own rows.
    assert.doesNotMatch(readFileSync(path.join(root, 'webview/runtime/entryDistribution.ts'), 'utf8'), /\bmedian\(/);
});

test('a base group counts, names and measures only the recordings its median is of: never a failed or still-computing one', () => {
    const cases: Array<{ options: Parameters<typeof setup>[0]; measured: string[]; failed: number; pending: number }> = [
        { options: { slots: [null, '/d/a.wav', null, null] }, measured: ['/d/b.wav', '/d/c.wav'], failed: 0, pending: 0 },
        { options: { slots: [null, '/d/a.wav', null, null], failed: ['/d/b.wav'] }, measured: ['/d/c.wav'], failed: 1, pending: 0 },
        { options: { slots: [null, '/d/a.wav', null, null], pending: ['/d/b.wav'] }, measured: ['/d/c.wav'], failed: 0, pending: 1 },
        { options: { slots: [null, '/d/a.wav', null, null], group: 'none', failed: ['/d/b.wav'], pending: ['/d/d.wav'] }, measured: ['/d/c.wav'], failed: 1, pending: 1 },
    ];
    for (const { options, measured, failed, pending } of cases) {
        const { base } = setup(options);
        const resolved = base.resolve('/d/a.wav');
        const what = JSON.stringify(options);
        assert.equal(resolved.definition.count, measured.length, what);
        assert.equal((resolved.definition.left?.failed ?? 0) + (resolved.definition.left?.empty ?? 0), failed, what);
        assert.equal(resolved.definition.left?.pending ?? 0, pending, what);
        assert.ok(resolved.title.includes(strings.entryBaseMedian.replace('{count}', String(measured.length))), `${what}: ${resolved.title}`);
        assert.equal(resolved.title.includes(strings.dsBaseFailed.replace('{n}', String(failed))), failed > 0, what);
        assert.equal(resolved.title.includes(strings.dsBasePending.replace('{n}', String(pending))), pending > 0, what);
        // Every reader of the base (the comparison, the entry CSV, 報告.csv) sees the same recordings the median is of.
        for (const comparison of [base.comparison('/d/a.wav'), base.fileComparison('/d/a.wav')]) {
            assert.deepEqual(comparison.base?.filePaths, measured, what);
            assert.equal(entryMeasure(comparison, 0, strings)?.count, measured.length, what);
            assert.equal(!!comparison.pending, pending > 0, `${what}: still computing keeps the comparison pending`);
        }
    }
});

test('a slot-0 recording that failed or is still computing leaves no base: never the group\'s median in its place', () => {
    for (const options of [{ failed: ['/d/d.wav'] }, { pending: ['/d/d.wav'] }]) {
        const { base } = setup({ slots: ['/d/d.wav', '/d/a.wav', null, null], ...options });
        const comparison = base.comparison('/d/a.wav');
        assert.equal(comparison.base, null, JSON.stringify(options));
        assert.equal(!!comparison.pending, !!options.pending, JSON.stringify(options));
    }
});

test('over a region the base counts what was measured there now: a recording stale in the table is in its median, one without a region value is pending, and the report\'s rows are of the current chain', () => {
    const { base, results } = setup({ slots: [null, '/d/a.wav', null, null], stale: ['/d/c.wav'] });
    const measured: Array<[string, ScanResult]> = [['/d/a.wav', scanned(30)], ['/d/b.wav', scanned(32)], ['/d/c.wav', scanned(36)]];
    const region = regionAnswers(new Map(measured));
    const regionMap = new Map(measured);
    const over = base.comparison('/d/a.wav', false, region);
    assert.deepEqual(over.base?.filePaths, ['/d/b.wav', '/d/c.wav'], 'c measured over the region now is counted');
    assert.equal(base.resolve('/d/a.wav', false, undefined, region).definition.count, 2);
    assert.ok(!base.resolve('/d/a.wav', false, undefined, region).title.includes(strings.dsBaseStale.replace('{n}', '1')));
    // The table's own answers (binnedAnswers keeps each one's state): the table's state stands, c is stale.
    assert.deepEqual(base.comparison('/d/a.wav').base?.filePaths, ['/d/b.wav']);
    // A base recording the region has no value of yet is pending there, never its whole file's value instead.
    const partial = regionAnswers(new Map(measured.slice(0, 2)));
    const pending = base.resolve('/d/a.wav', false, undefined, partial);
    assert.equal(pending.definition.left?.pending, 1);
    assert.deepEqual(base.comparison('/d/a.wav', false, partial).base?.filePaths, ['/d/b.wav']);
    // The report over the region (its stale set empty: every number is measured now) writes c's base as current: n 2.
    const report = (stale: ReadonlySet<string>): string[][] => reportCsv({ model: buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null), results: regionMap, slots: [null, '/d/a.wav', null, null],
        compare: path => base.comparison(path, false, region), region: { start: 0, end: 1 }, recipe: null, recipeName: 'r', now: new Date(), stale }, strings).slice(1).trimEnd().split('\r\n').map(line => line.split(','));
    const [header, row] = report(reportStale(new Set(['/d/c.wav']), regionMap));
    assert.equal(row[header.indexOf(strings.entryCsvGroupSize)], '2');
    assert.ok(row.includes(strings.reportChainCurrent) && !row.includes(strings.reportChainPrevious), row.join(','));
    // Not measured afresh (no region's scans), the table's stale file marks the row of an earlier chain.
    assert.ok(report(reportStale(new Set(['/d/c.wav']), new Map()))[1].includes(strings.reportChainPrevious));
});

test('a fixed Δ is measured again only when every file it was fixed with is counted now: one stale, pending, failed or of another reference keeps it ≠', () => {
    const ready = (path: string, result = scanned(40)) => scanAnswer(path, result);
    const row: DerivedRow = { parentPath: '/d/a.wav', region: 'all', result: scanned(40), recipeKey: 'old', stale: true, base: { leq: 0, bands: [], paths: ['/d/b.wav', '/d/c.wav'] } };
    const remeasurable = (compared: ScanAnswer, base: ScanAnswer[]): boolean => remeasured(row, compared, base, 'new') !== null;
    const compared = ready('/d/a.wav');
    assert.equal(remeasurable(compared, [ready('/d/b.wav'), ready('/d/c.wav')]), true);
    const b = ready('/d/b.wav');
    assert.equal(remeasurable(compared, [b, b.state === 'ready' ? { state: 'stale', value: b.value, identity: b.identity } : b]), false, 'a stale base file');
    assert.equal(remeasurable(compared, [b, scanAnswer('/d/c.wav', undefined)]), false, 'a pending base file');
    assert.equal(remeasurable(compared, [b, scanAnswer('/d/c.wav', { ok: false, error: 'x' } as ScanResult)]), false, 'a failed base file');
    const fs = scanned(40);
    assert.equal(remeasurable(compared, [b, ready('/d/c.wav', { ...fs, input: { ...fs.input!, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated' } })]), false, 'another reference');
    const a = compared.state === 'ready' ? { state: 'stale' as const, value: compared.value, identity: compared.identity } : compared;
    assert.equal(remeasurable(a, [b]), false, 'the compared file stale');
    assert.equal(remeasurable(compared, []), false, 'no base');
});

test('a base asks for and draws its members, counts its set: a pending or stale member is asked for, never counted, one of another reference neither', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null], stale: ['/d/c.wav'], pending: ['/d/b.wav'], uncalibrated: [] });
    const resolved = base.resolve('/d/a.wav');
    assert.deepEqual(resolved.paths, []);
    assert.deepEqual(resolved.members, ['/d/b.wav', '/d/c.wav']);
    assert.equal(base.stageChannel('/d/b.wav', '/d/a.wav'), resolved.channel, 'a pending member is drawn with the base\'s channel');
    const other = setup({ slots: [null, '/d/a.wav', null, null], uncalibrated: ['/d/c.wav'] }).base.resolve('/d/a.wav');
    assert.deepEqual([other.paths, other.members], [['/d/b.wav'], ['/d/b.wav']]);
});
