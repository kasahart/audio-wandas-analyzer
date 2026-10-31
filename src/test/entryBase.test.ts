import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { datasetRows, type DatasetRow, type GroupId } from '../shared/dataset/datasetTable';
import { channelOfRow, createEntryBase, type EntryBaseDeps } from '../webview/runtime/entryBase';
import { buildEntryModel } from '../webview/runtime/entryTable';

const strings = getStrings('en');

/** A scanned recording of `channels` channels whose bands are all `level` dB. */
const scanned = (level: number, channels = 1): ScanResult => ({
    ok: true, input: { id: 'x', fs: 48000, channels: Array.from({ length: channels }, (_, index) => index), durationS: 1, unit: 'Pa', ref: 2e-5 },
    leqDbA: Array(channels).fill(level), peakHz: Array(channels).fill(100), crest: Array(channels).fill(3),
    spectrumDb: Array.from({ length: channels }, () => [level, level]), thirdOctDb: Array.from({ length: channels }, () => [level, level + 1]), specVersion: 5,
});

function setup(options: { slots?: (string | null)[]; group?: GroupId; baseGroup?: string | null; channels?: Record<string, number>; narrowedBy?: string[]; stale?: string[] } = {}) {
    const attributes = new Map([
        ['/d/a.wav', { rpm: '900' }], ['/d/b.wav', { rpm: '900' }], ['/d/c.wav', { rpm: '900' }], ['/d/d.wav', { rpm: '1500' }],
    ]);
    const results = new Map<string, ScanResult>([...attributes.keys()].map((path, index) => [path, scanned(40 + index * 2, options.channels?.[path] ?? 1)]));
    const rows: DatasetRow[] = datasetRows([...attributes.keys()], '/d', attributes, results);
    const byKey = new Map(rows.map(row => [row.key, row]));
    const state = { slots: options.slots ?? [null, null, null, null], group: options.group ?? 'csv:rpm', baseGroup: options.baseGroup ?? null };
    const deps: EntryBaseDeps = {
        strings, slots: () => state.slots, rows: () => rows, rowOf: key => (key ? byKey.get(key) : undefined), pool: () => rows,
        group: () => state.group, baseGroup: () => state.baseGroup, narrowedBy: () => options.narrowedBy ?? [],
        groupLabel: id => id.replace(/^csv:/, ''), rowName: key => (byKey.get(key)?.name ?? key), results, isStale: path => (options.stale ?? []).includes(path),
        entryModel: () => buildEntryModel([...results].map(([filePath, result]) => ({ filePath, result })), null),
    };
    return { base: createEntryBase(deps), state, rows };
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
    assert.equal(base.slotRowOf('/d/a.wav')?.key, '/d/a.wav#ch2');
});

test('the comparison and the table\'s base bands come from the base it resolves', () => {
    const { base } = setup({ slots: [null, '/d/a.wav', null, null], stale: ['/d/c.wav'] });
    const model = base.comparison('/d/a.wav');
    assert.equal(model.compare?.leq, 40);
    assert.ok(model.base, 'the group median of b and c');
    const bands = base.tableBands('/d/a.wav');
    assert.deepEqual(bands, { centers: bands?.centers, values: [42, 43], count: 1 }, 'c is of an earlier chain');
    assert.equal(bands?.centers.length, 2);
    const { base: lone } = setup({ slots: [null, '/d/d.wav', null, null] });
    assert.equal(lone.tableBands('/d/d.wav'), null, 'a group of one has no base bands');
});
