/**
 * Class sweep 4 (reference, aggregation): a pair's picture is counted by its own identity and calibrated only when
 * both of its sides are; a channel names its own calibration; every figure counts one set, of the same channels on
 * both sides, with what it left out said with why. Each test injects the violation the sweep found.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnswerIdentity } from '../webview/runtime/answerTypes';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult, StageView } from '../shared/protocol/backendProtocol';
import { channelResult } from '../shared/recipe/channelSelection';
import { datasetRows, type DatasetRow, type GroupId } from '../shared/dataset/datasetTable';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import { trackLevelInput, type LevelInput } from '../webview/runtime/comparePanes';
import { createEntryBase, type EntryBaseDeps } from '../webview/runtime/entryBase';
import {
    figureUsed, folderReference, gainAxisName, pairCalibration, pictureAxis, pictureLevelOf, pictureSet, scanIdentity, setDrawnCount, setExclusionText,
} from '../webview/runtime/figureModel';
import { stageAxes } from '../webview/runtime/stagePanes';

/** The identity the answer store keeps for a picture (stageSource.identity): the tests' fixed version. */
const asked = (path: string): AnswerIdentity => ({ path, fileVersion: 'v', calibrationSignature: 'c', level: { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: false }, recipeKey: 'r', region: '', conditionId: '' });

const strings = getStrings('en');
const FS: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const FS_CAL: LevelInput = { ...FS, calibrationStatus: 'calibrated' };

const scan = (levels: number[], input: LevelInput = FS, fs = 48000, channelCalibration?: LevelInput['calibrationStatus'][]): ScanResult => ({
    ok: true, input: { id: 'x', fs, channels: levels.map((_, index) => index), durationS: 1, ...input, ...(channelCalibration ? { channelCalibration } : {}) },
    leqDbA: levels, peakHz: levels.map((_, index) => 100 * (index + 1)), crest: levels.map((_, index) => 3 + index),
    spectrumDb: levels.map(level => [level, level]), thirdOctDb: levels.map(level => [level, level + 1]), specVersion: 5,
});

const gain = (pair: StageView['pair'], unit?: string): StageView => ({ frame: 'TransferFunctionFrame', kind: 'line', x: 'frequency', quantity: 'gain', pair, ...(unit ? { unit } : {}), xs: [1, 2], values: [0, 1], data: 'k' });

test('a pair is calibrated only when both of its sides are, and its axis says so (reference #2, #3, #4)', () => {
    // Within one recording: ch1 gain-corrected, ch2 not: the gain ch2 / ch1 is uncalibrated, though the file's dBFS matches.
    const own = { ...FS_CAL, calibrationStatus: 'uncalibrated' as const, channelCalibration: ['calibrated', 'uncalibrated'] as const };
    assert.equal(pairCalibration(gain({ output: 2, input: 1 }), { ...own, channelCalibration: [...own.channelCalibration] }), 'uncalibrated');
    assert.equal(pairCalibration(gain({ output: 1, input: 1 }), { ...own, channelCalibration: ['calibrated', 'uncalibrated'] }), 'calibrated');
    // Against the base slot: the recording's and the base's own status.
    assert.equal(pairCalibration(gain({ output: 1, input: 1, base: true }), { ...FS_CAL, baseCalibrationStatus: 'uncalibrated' }), 'uncalibrated');
    assert.equal(pairCalibration(gain({ output: 1, input: 1, base: true }), { ...FS_CAL, baseCalibrationStatus: 'calibrated' }), 'calibrated');
    assert.equal(pairCalibration(gain({ output: 1, input: 1, base: true }), FS_CAL), 'uncalibrated', 'a base side not known is not calibrated');
    // Never fixed as calibrated by the gain's own identity.
    const input = pictureLevelOf(gain({ output: 2, input: 1 }), { ...FS, channelCalibration: ['calibrated', 'uncalibrated'] });
    assert.equal(input?.calibrationStatus, 'uncalibrated');
    assert.ok(stageAxes(strings, gain({ output: 2, input: 1 }), input).y.includes(strings.axisUncalibrated), stageAxes(strings, gain({ output: 2, input: 1 }), input).y);
    // The pair view: the backend's status of both channels.
    assert.ok(gainAxisName({ levelReferenceLabel: 'dB', calibrationStatus: 'uncalibrated' }, strings).includes(strings.axisUncalibrated));
    assert.ok(!gainAxisName({ levelReferenceLabel: 'dB', calibrationStatus: 'calibrated' }, strings).includes(strings.axisUncalibrated));
});

test('a pair step\'s member whose picture is not in is pending, and one the table left out is counted by its picture once (reference #1, aggregation V3, V4, V7)', () => {
    const views: Record<string, StageView | undefined> = { '/c.wav': gain({ output: 2, input: 1 }), '/a.wav': gain({ output: 2, input: 1 }) };
    const own: Record<string, LevelInput> = { '/c.wav': FS, '/a.wav': { ...FS, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa' }, '/p.wav': FS };
    const levelOf = (path: string): LevelInput | undefined => pictureLevelOf(views[path], own[path], true);
    // /a.wav was other-reference by the table's channel level; as a gain it is of one unit: counted, never also left out.
    const set = pictureSet(['/a.wav', '/p.wav'], path => views[path], levelOf, { level: levelOf('/c.wav'), view: views['/c.wav'] }, true, asked, []);
    assert.deepEqual(set.paths, ['/a.wav']);
    assert.deepEqual(set.excluded, [{ path: '/p.wav', reason: 'pending' }]);
    // A member also in `left` and drawn would be said twice: the caller passes only those not asked for.
    const twice = pictureSet(['/a.wav'], path => views[path], levelOf, { level: levelOf('/c.wav'), view: views['/c.wav'] }, true, asked, [{ path: '/b.wav', reason: 'other-reference' }]);
    assert.equal(twice.excluded.length, 1);
    // The store's identity is the one counted (never one rebuilt with an empty version).
    const kept = pictureSet(['/a.wav'], path => views[path], levelOf, { level: levelOf('/c.wav'), view: views['/c.wav'] }, true, path => ({ path, fileVersion: 'v1', calibrationSignature: 'c', level: FS, recipeKey: 'r', region: '', conditionId: 'k' }));
    assert.equal(kept.used[0]?.identity.fileVersion, 'v1');
    assert.equal(kept.used[0]?.identity.level.unit, '1', 'counted in the gain\'s identity');
});

test('time lines of another step are on another axis, as the backend\'s _aligned (aggregation V6)', () => {
    const line = (start: number, step: number, n: number): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', quantity: 'level', xs: Array.from({ length: n }, (_, i) => start + i * step), values: Array(n).fill(0), timeAxis: { start, step }, data: 'k' });
    assert.equal(pictureAxis(line(0, 1 / 48000 * 512, 10)), pictureAxis(line(0, 1 / 48000 * 512, 12)), 'other lengths share the axis');
    assert.notEqual(pictureAxis(line(0, 1 / 48000 * 512, 10)), pictureAxis(line(0, 1 / 44100 * 512, 10)), 'another step does not');
    const views: Record<string, StageView> = { '/a.wav': line(0, 512 / 48000, 10), '/b.wav': line(0, 512 / 44100, 10) };
    const set = pictureSet(['/b.wav'], path => views[path], () => FS, { level: FS, view: views['/a.wav'] }, true, asked);
    assert.deepEqual(set.excluded, [{ path: '/b.wav', reason: 'other-axis' }]);
});

test('a channel taken from a file names that channel\'s calibration (reference #5)', () => {
    const file = scan([-20, -30], FS, 48000, ['calibrated', 'uncalibrated']);
    const one = channelResult(file, 1);
    assert.equal(one?.ok && one.input?.calibrationStatus, 'calibrated');
    const two = channelResult(file, 2);
    assert.equal(two?.ok && two.input?.calibrationStatus, 'uncalibrated');
    assert.equal(trackLevelInput([], { ...FS, channelCalibration: ['calibrated', 'uncalibrated'] }, 1).calibrationStatus, 'calibrated');
    assert.equal(trackLevelInput([], { ...FS, channelCalibration: ['calibrated', 'uncalibrated'] }, null).calibrationStatus, 'uncalibrated');
});

function setup(options: { slots?: (string | null)[]; group?: GroupId; results?: Record<string, ScanResult | undefined> } = {}) {
    const attributes = new Map([['/d/a.wav', { rpm: '900' }], ['/d/b.wav', { rpm: '900' }], ['/d/c.wav', { rpm: '900' }], ['/d/d.wav', { rpm: '900' }]]);
    const results = new Map<string, ScanResult>([...attributes.keys()].flatMap((path, index): Array<[string, ScanResult]> => {
        const given = options.results && path in options.results ? options.results[path] : scan([40 + index * 2]);
        return given ? [[path, given]] : [];
    }));
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, results);
    const byKey = new Map(rows.map(row => [row.key, row]));
    const answersOf = (paths: readonly string[]): ScanAnswer[] => paths.map(path => scanAnswer(path, results.get(path)));
    const deps: EntryBaseDeps = {
        strings, slots: () => options.slots ?? [null, null, null, null], rows: () => rows, rowOf: key => (key ? byKey.get(key) : undefined), pool: () => rows,
        group: () => options.group ?? 'csv:rpm', baseGroup: () => null, narrowedBy: () => [], groupLabel: id => id.replace(/^csv:/, ''), rowName: key => (byKey.get(key)?.name ?? key),
        answersOf, reference: () => folderReference(answersOf([...attributes.keys()])),
    };
    return { base: createEntryBase(deps), rows, results };
}

test('slot 0 on another frequency axis gives no Δ beside its n of 0, and nothing to fix (aggregation V1)', () => {
    const { base } = setup({ slots: ['/d/a.wav', '/d/b.wav', null, null], results: { '/d/a.wav': scan([40], FS, 44100) } });
    const comparison = base.comparison('/d/b.wav');
    assert.equal(comparison.baseSet?.n, 0);
    assert.equal(comparison.blocked, 'empty');
    assert.equal(comparison.diffDb, null);
    assert.ok(!comparison.leq || Number.isNaN(comparison.leq.delta), 'no Leq Δ');
});

test('an unslotted compared row, a file row against slot 0, and slot 2 with slot 1 empty: the same channels and set on both sides (aggregation V2, V5, V14)', () => {
    const two = { '/d/a.wav': scan([40, 50]), '/d/b.wav': scan([42, 52]), '/d/c.wav': scan([44, 54]), '/d/d.wav': scan([46, 56]) };
    // V14: slot 0 is a.wav's ch2; a file row (all channels) is measured against a.wav's channels together.
    const slot0 = setup({ slots: ['/d/a.wav#ch2', null, null, null], results: two });
    const file = slot0.base.fileComparison('/d/b.wav');
    assert.equal(file.leq?.base, file.base?.leq);
    assert.notEqual(file.base?.leq, 50, 'never a.wav\'s ch2 alone against b.wav\'s channels together');
    // V2: an unslotted 2-ch recording compared with its group: both sides of its first row's channel.
    const held = setup({ results: two });
    const comparison = held.base.comparison('/d/b.wav', true);
    const resolved = held.base.resolve('/d/b.wav', true);
    assert.equal(resolved.channel, 1);
    assert.equal(comparison.compare?.leq, 42, 'the compared side is ch1, as its base is');
    // V5: slot 2 compared with slot 1 empty: the chip and the distribution's base line are of its set.
    const anchored = setup({ slots: [null, null, '/d/b.wav', null], results: { '/d/d.wav': scan([46], FS, 44100) } });
    const base = anchored.base.resolve('/d/b.wav');
    assert.equal(base.set.n, 2);
    assert.ok(anchored.base.text().includes('median of 2'), anchored.base.text());
});

test('peak and crest base lines read the channel picked, never the row\'s ch − 1 of a one-channel value (aggregation V10)', () => {
    const two = { '/d/a.wav': scan([40, 50]), '/d/b.wav': scan([42, 52]), '/d/c.wav': scan([44, 54]), '/d/d.wav': scan([46, 56]) };
    const { base } = setup({ slots: [null, '/d/a.wav#ch2', null, null], results: two, group: 'ch' });
    assert.deepEqual(base.groupBase('peak'), { group: '2', value: 200 }, 'ch2\'s peak of each, never undefined at row.ch − 1');
    assert.deepEqual(base.groupBase('crest'), { group: '2', value: 4 });
});

test('another channel count, an empty answer, an unreadable member are each said with why (aggregation V8, V9, V13)', () => {
    const compared = scanAnswer('/a.wav', scan([40]));
    const set = figureUsed(scanIdentity(compared), [scanAnswer('/b.wav', scan([40, 41])), { state: 'empty', identity: compared.identity }, scanAnswer('/c.wav', { ok: false, reason: 'unreadable' })]);
    assert.deepEqual(set.excluded.map(item => item.reason), ['other-channels', 'empty', 'failed']);
    const text = setExclusionText(set, strings);
    assert.ok(text.includes(strings.dsBaseOtherChannels.replace('{n}', '1')), text);
    assert.ok(text.includes(strings.dsBaseEmpty.replace('{n}', '1')), text);
    assert.ok(text.includes(strings.dsBaseFailed.replace('{n}', '1')), 'empty is not said as failed');
    // V12: a level's distribution counts the drawn channels of the set's recordings alone.
    assert.equal(setDrawnCount(set, [{ filePath: '/b.wav' }], true), 0);
});
