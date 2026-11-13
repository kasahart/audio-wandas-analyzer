/**
 * Class sweep 3 (reference, aggregation): every value names its own row's reference and calibration, and every
 * figure counts one set, listing what it left out with why. Each test injects the violation the sweep found and
 * checks the layer refuses it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Answer, AnswerIdentity } from '../webview/runtime/answerTypes';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult, StageView } from '../shared/protocol/backendProtocol';
import { datasetRows, type DatasetRow, type GroupId } from '../shared/dataset/datasetTable';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import type { LevelInput } from '../webview/runtime/comparePanes';
import { entryMeasure, remeasured } from '../webview/runtime/compareReport';
import { createEntryBase, type EntryBaseDeps } from '../webview/runtime/entryBase';
import type { DerivedRow } from '../webview/runtime/entryTable';
import {
    folderReference, gainUnit, levelKeyOf, medianInputOf, ownLevelName, ownReferenceMark, paneNames, pictureAxis, pictureLevelOf, pictureSet,
    plainNames, stageNames, unreferencedName,
} from '../webview/runtime/figureModel';
import { spectrogramDisplayBounds } from '../webview/runtime/spectrogramRaster';
import { compareOf } from './helpers/compareInput';
import { buildEntryModel } from '../webview/runtime/entryTable';

/** A picture as the answer store answers it (stageSource.answer): pending until in, failed as null, under a fixed version. */
const identity = (path: string): AnswerIdentity => ({ path, fileVersion: 'v', calibrationSignature: 'c', level: { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: false }, recipeKey: 'r', region: '', conditionId: '' });
const answered = (views: Record<string, StageView | null | undefined>) => (path: string): Answer<StageView> => {
    const view = views[path];
    return view === undefined ? { state: 'pending', identity: identity(path) } : view === null ? { state: 'failed', identity: identity(path) } : { state: 'ready', value: view, identity: identity(path) };
};

const strings = getStrings('en');
const FS: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const FS_CAL: LevelInput = { ...FS, calibrationStatus: 'calibrated' };
const SPL: LevelInput = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false };

/** A scan of `levels` (one per channel) in `input`'s reference. */
const scan = (levels: number[], input: LevelInput = SPL): ScanResult => ({
    ok: true, input: { id: 'x', fs: 48000, channels: levels.map((_, index) => index), durationS: 1, ...input },
    leqDbA: levels, peakHz: levels.map(() => 100), crest: levels.map(() => 3),
    spectrumDb: levels.map(level => [level, level]), thirdOctDb: levels.map(level => [level, level + 1]), specVersion: 5,
});

test('every value names its own row\'s reference and calibration, never the folder\'s (reference V1, V2, V6, V9)', () => {
    // V1: a row's value is named by its own level; a heading over rows of several references names none.
    assert.equal(ownLevelName(strings, strings.dsLeq, SPL), 'Leq A-weighted [dB SPL re 20 µPa]');
    assert.equal(ownLevelName(strings, strings.dsLeq, FS), 'Leq A-weighted, uncalibrated [dBFS]');
    assert.equal(ownLevelName(strings, strings.dsLeq, undefined), null, 'a level not known yet is not named by another row\'s');
    assert.equal(unreferencedName(strings.dsLeq), 'Leq A-weighted');
    // V2: under a heading of the folder's dBFS, the dB SPL row and a stale row each say their own reference.
    const answers: ScanAnswer[] = [scanAnswer('/a.wav', scan([-20], FS)), scanAnswer('/b.wav', scan([-22], FS)), scanAnswer('/c.wav', scan([60]))];
    const folder = folderReference(answers);
    assert.equal(folder.label, 'dBFS');
    assert.equal(ownReferenceMark(strings, folder, answers[0]), '');
    assert.equal(ownReferenceMark(strings, folder, answers[2]), ' [dB SPL re 20 µPa]');
    const stale = { ...answers[0], state: 'stale' } as ScanAnswer;
    assert.equal(ownReferenceMark(strings, folder, stale), ', uncalibrated [dBFS]', 'a stale value names the reference it was read in');
    // V6: no CSV column of an absolute level in bare dB(A), in either language.
    for (const locale of ['en', 'ja'] as const) {
        const words = getStrings(locale);
        for (const column of [words.entryColLeq, words.reportBaseLeq]) assert.doesNotMatch(column, /dB/u, `${locale}: ${column}`);
    }
});

test('a transfer function is of its pair\'s unit ratio and a cross spectrum of its pair\'s reference (reference V3, V7, R1)', () => {
    // Gains of one unit compare whatever their channels are calibrated in: a Pa recording's and a full-scale one's are one identity.
    const gain = (values: number[]): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', quantity: 'gain', pair: { output: 2, input: 1 }, xs: [1, 2], values, xSource: { count: 2, first: 1, last: 2, step: 1 }, data: 'k' });
    assert.equal(levelKeyOf(pictureLevelOf(gain([0, 1]), SPL)), levelKeyOf(pictureLevelOf(gain([0, 1]), FS)));
    const views: Record<string, StageView> = { '/a.wav': gain([1, 2]), '/c.wav': gain([3, 4]) };
    const own: Record<string, LevelInput> = { '/a.wav': SPL, '/c.wav': FS, '/b.wav': FS };
    views['/b.wav'] = gain([0, 0]);
    // A member whose picture is not in yet (/p.wav) has no identity: never its channels' level (sweep 4, V7).
    const levelOf = (path: string): LevelInput | undefined => pictureLevelOf(views[path], own[path] ?? FS, true);
    const set = pictureSet(['/a.wav', '/c.wav', '/p.wav'], answered(views), levelOf, { level: levelOf('/b.wav'), view: views['/b.wav'] }, true);
    assert.deepEqual(set.paths, ['/a.wav', '/c.wav'], 'the Pa recording\'s gain is counted beside the full-scale one\'s');
    assert.deepEqual(set.excluded, [{ path: '/p.wav', reason: 'pending' }], 'a member on its way is pending, never of another reference');
    // Gains of another unit ratio are not.
    const ratio = { ...gain([1, 2]), unit: 'dB re 1 Pa/V' };
    assert.notEqual(levelKeyOf(pictureLevelOf(ratio, SPL)), levelKeyOf(pictureLevelOf(gain([1, 2]), SPL)));
    assert.equal(gainUnit({ levelReferenceLabel: 'dB re 1 Pa/V' }), 'dB re 1 Pa/V');
    assert.equal(gainUnit(undefined), 'dB', 'a gain of one unit is a plain ratio');
    // V7: a cross spectrum against the base slot is re its pair's reference, as the backend names it, not the compared channel's.
    const csd: StageView = { frame: 'CrossSpectralFrame', kind: 'line', x: 'frequency', quantity: 'level', pair: { output: 1, input: 1, base: true }, unit: 'dB re 20 µPa·1 FS', xs: [1, 2], values: [0, 0], xSource: { count: 2, first: 1, last: 2, step: 1 }, data: 'k' };
    const named = stageNames(strings, csd, pictureLevelOf(csd, SPL)).y;
    assert.ok(named.includes('dB re 20 µPa·1 FS'), named);
    assert.ok(!named.includes('dB SPL re 20 µPa'), named);
    // Its full-scale side is uncalibrated, so the pair is (sweep 4, reference #3): its name says so.
    const pairInput = pictureLevelOf(csd, { ...SPL, baseCalibrationStatus: 'uncalibrated' });
    assert.equal(pairInput?.calibrationStatus, 'uncalibrated');
    assert.ok(stageNames(strings, csd, pairInput).y.includes(strings.axisUncalibrated), stageNames(strings, csd, pairInput).y);
});

test('a median line of mixed calibration is uncalibrated on the screen and in the report alike (reference V4)', () => {
    assert.equal(medianInputOf([FS_CAL, FS])?.calibrationStatus, 'uncalibrated');
    assert.equal(medianInputOf([FS_CAL, FS_CAL])?.calibrationStatus, 'calibrated');
    assert.equal(medianInputOf([undefined, null]), undefined);
    assert.ok(paneNames(strings, medianInputOf([FS_CAL, FS])).level.y.includes(strings.axisUncalibrated.trim().replace(/^,\s*/u, '')));
});

test('a typed colour range stays with the level identity it was typed for (reference V5)', () => {
    const spec = { minDb: 30, maxDb: 90, maxFrequencyHz: 8000 };
    const typed = { dbMin: -100, dbMax: 0, maxFrequencyHz: null, dbLevelKey: 'fs' };
    assert.deepEqual([spectrogramDisplayBounds(spec, typed, spec, { lane: 'fs', typed: 'fs' }).dbLo, spectrogramDisplayBounds(spec, typed, spec, { lane: 'fs', typed: 'fs' }).dbHi], [-100, 0]);
    const other = spectrogramDisplayBounds(spec, typed, spec, { lane: 'spl', typed: 'fs' });
    assert.ok(other.dbLo >= 30 - 60 && other.dbHi >= 90, `a dB SPL lane keeps its own auto range: ${other.dbLo}..${other.dbHi}`);
    assert.notEqual(other.dbLo, -100);
});

test('only names made in the layer can be wrapped: a bare level name written elsewhere is refused by the type (reference: plainNames)', () => {
    // @ts-expect-error a level axis' name written outside figureModel cannot become a figure's names
    const names = plainNames('Level [dB]', '');
    assert.equal(names.x, 'Level [dB]');
});

test('a step picture set has no identity while the compared picture is pending or failed, and a time axis ±1 sample is one axis (aggregation V5, V6)', () => {
    const view = (n: number): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'level', xs: Array.from({ length: n }, (_, index) => index / 48000), values: Array(n).fill(0), xSource: { count: n, first: 0, last: (n - 1) / 48000, step: 1 / 48000 }, data: 'k' });
    assert.equal(pictureAxis(view(48000)), pictureAxis(view(48001)), 'recordings a sample apart share the time axis');
    const views: Record<string, StageView> = { '/a.wav': view(10), '/b.wav': view(11) };
    for (const compared of [undefined, null]) {
        const set = pictureSet(['/a.wav', '/b.wav'], answered(views), () => FS, { level: FS, view: compared }, true);
        assert.equal(set.n, 0, String(compared));
        assert.deepEqual(set.excluded.map(item => item.reason), ['no-identity', 'no-identity']);
    }
    assert.equal(pictureSet(['/a.wav', '/b.wav'], answered(views), () => FS, { level: FS, view: view(10) }, true).n, 2);
});

function setup(options: { slots?: (string | null)[]; group?: GroupId; channels?: Record<string, number[]>; pending?: string[] } = {}) {
    const attributes = new Map([['/d/a.wav', { rpm: '900' }], ['/d/b.wav', { rpm: '900' }], ['/d/c.wav', { rpm: '900' }], ['/d/d.wav', { rpm: '1500' }]]);
    const results = new Map<string, ScanResult>([...attributes.keys()].map((path, index) => [path, scan(options.channels?.[path] ?? [40 + index * 2])]));
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, results);
    for (const path of options.pending ?? []) results.delete(path);
    const byKey = new Map(rows.map(row => [row.key, row]));
    const answersOf = (paths: readonly string[]): ScanAnswer[] => paths.map(path => scanAnswer(path, results.get(path)));
    const deps: EntryBaseDeps = {
        strings, slots: () => options.slots ?? [null, null, null, null], rows: () => rows, rowOf: key => (key ? byKey.get(key) : undefined), pool: () => rows,
        group: () => options.group ?? 'csv:rpm', baseGroup: () => null, narrowedBy: () => [], groupLabel: id => id.replace(/^csv:/, ''), rowName: key => (byKey.get(key)?.name ?? key),
        answersOf, reference: () => folderReference(answersOf([...attributes.keys()])),
    };
    return { base: createEntryBase(deps), rows, results };
}

test('a channel-split group is measured as its channel, a member without it is left out with why, and a waveform heading counts the same set (aggregation V4, V7)', () => {
    const channels = { '/d/a.wav': [40, 50], '/d/b.wav': [42, 60], '/d/c.wav': [44] };
    const { base } = setup({ slots: [null, '/d/a.wav#ch2', null, null], channels });
    const resolved = base.resolve('/d/a.wav');
    assert.equal(resolved.channel, 2);
    assert.deepEqual(resolved.paths, ['/d/b.wav']);
    assert.equal(resolved.definition.left?.['no-channel'], 1, 'c.wav has no ch2: left out, and said');
    assert.ok(resolved.title.includes(strings.dsBaseFewer.replace('{n}', '1').replace('{ch}', '2')), resolved.title);
    assert.ok(resolved.heading(resolved.set, strings.entryBaseCount).includes(strings.entryBaseCount.replace('{count}', '1')), 'drawn each: n files, the set\'s own n');
    // Grouped by channel, the ch2 group's base line is the median of its recordings' ch2, not their channels together.
    const byChannel = setup({ slots: [null, '/d/a.wav#ch2', null, null], channels, group: 'ch' });
    assert.deepEqual(byChannel.base.groupBase('leq'), { group: '2', value: 60 });
});

test('slot 0\'s spread is of the base set: the other compared slots are not its peers (aggregation V12)', () => {
    const { base } = setup({ slots: ['/d/a.wav', '/d/b.wav', '/d/c.wav', null] });
    const resolved = base.resolve('/d/b.wav');
    assert.equal(resolved.compareBase?.kind, 'file');
    const peers = resolved.compareBase?.kind === 'file' ? resolved.compareBase.peers : undefined;
    assert.deepEqual(peers?.paths ?? [], [], 'c.wav is compared in slot 2: never a peer of slot 0');
});

test('a fixed Δ measured again keeps its channel, and an empty base writes n 0 with what it left out (aggregation V1, V8)', () => {
    const row: DerivedRow = { parentPath: '/c.wav', ch: 2, region: 'all', result: scan([30, 70]), recipeKey: 'old', stale: true, base: { leq: 0, bands: [], paths: ['/a.wav', '/b.wav'] } };
    const again = remeasured(row, scanAnswer('/c.wav', scan([30, 70])), [scanAnswer('/a.wav', scan([20, 50])), scanAnswer('/b.wav', scan([22, 54]))], 'new');
    assert.ok(again);
    assert.equal(again.base.leq, 52, 'the base\'s ch2 median, not its channels together');
    assert.deepEqual(again.result.ok ? again.result.leqDbA : null, [70], 'the compared row as its channel');
    // A group whose members are all still computing: no Δ, n 0 and why, never n 1.
    const results = new Map<string, ScanResult>([['/f/c.wav', scan([60])]]);
    const model = buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null, { band: 0 });
    const comparison = compareOf(model, results, '/f/c.wav', null, strings, false, undefined, { paths: ['/f/p.wav', '/f/q.wav'], title: 'group' });
    const measured = entryMeasure(comparison, 0, strings);
    assert.equal(measured?.count, 0);
    assert.equal(measured?.leq, null);
    assert.match(measured?.left ?? '', /2/u);
});

test('the folder\'s set lists every recording a level figure left out, with why (aggregation V11)', () => {
    const { base } = setup({ pending: ['/d/c.wav'] });
    const set = base.folderSet(['/d/a.wav', '/d/b.wav', '/d/c.wav', '/d/d.wav']);
    assert.equal(set.n, 3);
    assert.deepEqual(set.excluded.map(item => `${item.path}:${item.reason}`), ['/d/c.wav:pending']);
});
