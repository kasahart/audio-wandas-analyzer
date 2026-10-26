import assert from 'node:assert/strict';
import test from 'node:test';
import { channelsFromHeader } from '../shared/analysis/audioHeader';
import { runEntryProbe, type EntryProbePublication, type EntryScanPorts } from '../shared/analysis/entryScan';

const ascii = (text: string): number[] => [...text].map(char => char.charCodeAt(0));
const le32 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];

function wav(channels: number, before: number[][] = []): Uint8Array {
    const chunks = before.flat();
    const fmt = [...ascii('fmt '), ...le32(16), ...le16(1), ...le16(channels), ...le32(48000), ...le32(48000 * 2 * channels), ...le16(2 * channels), ...le16(16)];
    return new Uint8Array([...ascii('RIFF'), ...le32(0), ...ascii('WAVE'), ...chunks, ...fmt, ...ascii('data'), ...le32(0)]);
}

test('a WAV header says its channels, a chunk before fmt (odd-sized, padded) skipped', () => {
    assert.deepEqual(channelsFromHeader(wav(2), 'a.wav'), { channels: 2, durationS: 0 });
    const list = [...ascii('LIST'), ...le32(3), 1, 2, 3, 0];
    assert.deepEqual(channelsFromHeader(wav(8, [list]), 'a.wav'), { channels: 8, durationS: 0 });
    // The length: the data chunk's size over the byte rate (10 minutes of 48 kHz 16-bit stereo).
    const long = wav(2);
    new DataView(long.buffer).setUint32(long.length - 4, 600 * 48000 * 2 * 2, true);
    assert.deepEqual(channelsFromHeader(long, 'long.wav'), { channels: 2, durationS: 600 });
    assert.ok('error' in channelsFromHeader(wav(0), 'a.wav'));
    assert.ok('error' in channelsFromHeader(new Uint8Array(ascii('not a wav file')), 'b.wav'));
    assert.ok('error' in channelsFromHeader(new Uint8Array(), 'empty.wav'));
});

test('a WAV whose chunks before fmt reach past the bytes read is unknown, not broken', () => {
    const big = [...ascii('LIST'), ...le32(70 * 1024), ...new Array<number>(70 * 1024).fill(0)];
    assert.deepEqual(channelsFromHeader(wav(2, [big]).subarray(0, 64 * 1024), 'a.wav'), { unknown: true });
    // The whole file read and still no fmt chunk: broken.
    assert.ok('error' in channelsFromHeader(wav(2, [big]).subarray(0, 1000), 'a.wav'));
});

test('FLAC, Ogg and MP3 headers; a format without one here is unknown', () => {
    const flac = new Uint8Array(42);
    flac.set(ascii('fLaC'));
    flac[4] = 0x80; // the last metadata block, STREAMINFO
    flac[20] = (3 << 1); // 4 channels
    assert.deepEqual(channelsFromHeader(flac, 'a.flac'), { channels: 4 });
    // 48 kHz and 28,800,000 samples: 10 minutes.
    flac[18] = 0x0b; flac[19] = 0xb8; flac[20] = (0x0 << 4) | (3 << 1);
    const samples = 600 * 48000;
    flac[21] = Math.floor(samples / 2 ** 32) & 0x0f; flac[22] = (samples >>> 24) & 0xff; flac[23] = (samples >>> 16) & 0xff; flac[24] = (samples >>> 8) & 0xff; flac[25] = samples & 0xff;
    assert.deepEqual(channelsFromHeader(flac, 'a.flac'), { channels: 4, durationS: 600 });
    const ogg = new Uint8Array(60);
    ogg.set(ascii('OggS'));
    ogg[26] = 1;
    ogg.set([1, ...ascii('vorbis'), 0, 0, 0, 0, 2], 28);
    assert.deepEqual(channelsFromHeader(ogg, 'a.ogg'), { channels: 2 });
    const mono = new Uint8Array([...ascii('ID3'), 4, 0, 0, 0, 0, 0, 2, 9, 9, 0xff, 0xfb, 0x90, 0xc4]);
    assert.deepEqual(channelsFromHeader(mono, 'a.mp3'), { channels: 1 });
    assert.deepEqual(channelsFromHeader(new Uint8Array(64), 'a.m4a'), { unknown: true });
});

test('the probe reads only each header, says each file, then is done; a file it cannot read is an error', async () => {
    const reads: Array<[string, number]> = [];
    const ports = {
        readHead: async (filePath: string, length: number) => {
            reads.push([filePath, length]);
            if (filePath === '/gone.wav') throw new Error('gone');
            return wav(2);
        },
    } as unknown as EntryScanPorts;
    const published: EntryProbePublication[] = [];
    await runEntryProbe(ports, { type: 'entry-probe', requestId: 'p1', filePaths: ['/a.wav', '/gone.wav'] }, message => { published.push(message); }, () => true);
    assert.deepEqual(reads.map(([path]) => path), ['/a.wav', '/gone.wav']);
    assert.ok(reads.every(([, length]) => length === 64 * 1024));
    assert.deepEqual(published.map(item => item.type === 'entry-probe-result' ? [item.filePath, item.channels ?? item.error] : [item.type]),
        [['/a.wav', 2], ['/gone.wav', 'gone'], ['entry-probe-done']]);
    // Cancelled: nothing more is said.
    published.length = 0;
    await runEntryProbe(ports, { type: 'entry-probe', requestId: 'p2', filePaths: ['/a.wav'] }, message => { published.push(message); }, () => false);
    assert.deepEqual(published, []);
});
