import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows, fileOfKey, type DatasetRow, type GroupId } from '../shared/dataset/datasetTable';
import { channelOfRow, createEntryBase, regionCells, type EntryBase } from '../webview/runtime/entryBase';

const strings = getStrings('en');

/** Six recordings of two lines (a CSV column); run6 is of two channels, the others of one. */
function table(options: { slots: (string | null)[]; group?: GroupId; baseGroup?: string | null; pool?: (row: DatasetRow) => boolean; narrowedBy?: string[] }): { base: EntryBase; rows: DatasetRow[]; key(name: string, ch?: number): string } {
    const paths = [1, 2, 3, 4, 5, 6].map(n => `/d/run${n}.wav`);
    const attributes = new Map(paths.map((path, index) => [path, { line: index < 3 ? 'L1' : 'L2' }]));
    const rows = datasetRows(paths, '/d', attributes, new Map(paths.map(path => [path, path.endsWith('run6.wav') ? 2 : 1])));
    const key = (name: string, ch = 1): string => rows.find(row => row.name === `${name}.wav` && row.ch === ch)!.key;
    const slots = options.slots.map(slot => { if (!slot) return null; const [name, ch] = slot.split('#'); return key(name, ch ? Number(ch) : 1); });
    const rowOf = (found: string | null): DatasetRow | undefined => rows.find(row => row.key === found);
    const base = createEntryBase({
        strings, slots: () => slots, rows: () => rows, rowOf, pool: () => rows.filter(options.pool ?? (() => true)),
        group: () => options.group ?? 'none', baseGroup: () => options.baseGroup ?? null, narrowedBy: () => options.narrowedBy ?? [],
        groupLabel: id => id.replace(/^csv:/, ''), rowName: found => { const row = rowOf(found)!; return (row.channels ?? 1) > 1 ? `${row.name} ch${row.ch}` : row.name; },
        fileName: path => path.slice(path.lastIndexOf('/') + 1),
    });
    return { base, rows, key };
}

test('a base is the slot-0 recording, else the compared recording\'s group without the compared ones: only which recordings, no value of them', () => {
    const file = table({ slots: ['run1', 'run2', null, null], group: 'csv:line' });
    const single = file.base.resolve('/d/run2.wav');
    assert.deepEqual(single.members, ['/d/run1.wav']);
    assert.equal(single.name, 'Base · run1.wav');
    assert.deepEqual(single.definition, { kind: 'file', file: 'run1.wav', channel: null, filters: [], files: ['run1.wav'] });
    assert.equal(file.base.text(), 'run1.wav');
    assert.equal(file.base.groupName(), null);
    // The same slots, asked for the group although slot 0 is filled: run2's line without run2 itself.
    assert.deepEqual(file.base.resolve('/d/run2.wav', true).members, ['/d/run1.wav', '/d/run3.wav']);

    const group = table({ slots: [null, 'run4', 'run5', null], group: 'csv:line' });
    const of = group.base.resolve('/d/run4.wav');
    assert.deepEqual(of.members, ['/d/run6.wav'], 'the line\'s recordings without the compared one and the other compared slot');
    assert.equal(of.name, 'Base group line L2');
    assert.deepEqual(of.definition, { kind: 'group', group: { column: 'line', name: 'L2' }, channel: null, filters: [], files: ['run6.wav'] });
    assert.equal(group.base.groupName(), 'L2');
    assert.equal(group.base.text(), 'Base group line L2');
    // What a base holds is which recordings and words: every field is a string, a path list or a channel number.
    assert.deepEqual(Object.keys(of).sort(), ['channel', 'definition', 'fewer', 'heading', 'members', 'name']);
});

test('a group chosen on the base select is the base whatever the compared row\'s group; ungrouped, every other recording is', () => {
    const chosen = table({ slots: [null, 'run4', null, null], group: 'csv:line', baseGroup: 'L1' });
    assert.deepEqual(chosen.base.resolve('/d/run4.wav').members, ['/d/run1.wav', '/d/run2.wav', '/d/run3.wav']);
    assert.equal(chosen.base.groupName(), 'L1');
    const all = table({ slots: [null, 'run4', null, null] });
    assert.deepEqual(all.base.resolve('/d/run4.wav').members, ['/d/run1.wav', '/d/run2.wav', '/d/run3.wav', '/d/run5.wav', '/d/run6.wav']);
    assert.equal(all.base.resolve('/d/run4.wav').name, 'Base group All');
    assert.equal(all.base.groupName(), null);
});

test('the base is taken within the table\'s filters and exclusions (the pool), and its name says which', () => {
    const narrowed = table({ slots: [null, 'run1', null, null], group: 'csv:line', pool: row => row.name !== 'run3.wav', narrowedBy: ['name: run'] });
    const of = narrowed.base.resolve('/d/run1.wav');
    assert.deepEqual(of.members, ['/d/run2.wav']);
    assert.equal(of.name, 'Base group line L1 (within name: run)');
    assert.deepEqual(of.definition.filters, ['name: run']);
});

test('a channel row is compared as its channel: the base is of that channel, and recordings without it are named as left out', () => {
    const channel = table({ slots: [null, 'run6#2', null, null], group: 'csv:line' });
    assert.equal(channelOfRow(channel.rows.find(row => row.key === channel.key('run6', 2))), 2);
    assert.equal(channelOfRow(channel.rows.find(row => row.name === 'run1.wav')), null, 'a recording of one channel is compared as it is');
    const of = channel.base.resolve('/d/run6.wav');
    assert.equal(of.channel, 2);
    assert.deepEqual(of.members, [], 'run4 and run5 have no channel 2');
    assert.deepEqual(of.fewer, ['/d/run4.wav', '/d/run5.wav']);
    assert.equal(of.name, 'Base group line L2 · ch2');
    // The comparison draws each file with the channel of its role: a base member as the compared row's channel.
    const single = table({ slots: ['run6#2', 'run5', null, null] });
    assert.equal(single.base.stageChannel('/d/run6.wav', '/d/run5.wav'), 2, 'slot 0\'s row is channel 2');
    assert.equal(single.base.stageChannel('/d/run5.wav', '/d/run5.wav'), null);
    assert.equal(fileOfKey(single.key('run6', 2)), '/d/run6.wav');
});

test('a region is written as two cells in seconds, finer where its ends would read alike; the whole file as two empty cells', () => {
    assert.deepEqual(regionCells(null), ['', '']);
    assert.deepEqual(regionCells({ start: 0.5, end: 1.5 }), ['0.50', '1.50']);
    assert.deepEqual(regionCells({ start: 1.0001, end: 1.0004 }), ['1.00010', '1.00040']);
});

test('only the entry base builds a base group: no screen, file or report makes its own', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..', '..', 'src');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? (entry.name === 'test' ? [] : files(full)) : full.endsWith('.ts') ? [full] : [];
    });
    const allowed: Record<string, string[]> = {
        'baseGroupMembers(': ['webview/runtime/entryBase.ts', 'shared/dataset/datasetTable.ts'],
    };
    for (const file of files(root)) {
        const text = readFileSync(file, 'utf8');
        const name = path.relative(root, file).split(path.sep).join('/');
        for (const [call, places] of Object.entries(allowed)) {
            assert.ok(!text.includes(call) || places.includes(name), `${name} calls ${call}: a base is resolved only in entryBase.ts`);
        }
    }
});
