import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipStore } from '../webview/runtime/zipStore';
import { testPython } from './helpers/python';

const LIMITS = { maxEntries: 8, maxBytes: 32 * 1024 * 1024 };

const root = resolve(__dirname, '../..');
test('browser multi-WAV archive is a valid lossless UTF-8 stored ZIP', () => {
    const directory = mkdtempSync(join(tmpdir(), 'awa-zip-'));
    try {
        const wavPath = join(root, 'src/test/fixtures/short-stereo.wav');
        const wav = readFileSync(wavPath);
        const output = join(directory, 'regions.zip');
        writeFileSync(output, zipStore([{ name: '1-region.wav', bytes: wav }, { name: '2-日本語.wav', bytes: wav }], LIMITS));
        // The tests' Python (helpers/python.ts): a command and its own arguments, such as `py -3`.
        const python = testPython();
        assert.ok(python, 'no Python found (helpers/python.ts testPython)');
        const checked = spawnSync(python.command, [...python.args, '-c',
            'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.namelist()==["1-region.wav","2-日本語.wav"]\nassert z.testzip() is None\nraw=open(sys.argv[2],"rb").read()\nassert all(z.read(i)==raw and i.compress_type==zipfile.ZIP_STORED for i in z.infolist())',
            output, wavPath], { encoding: 'utf8' });
        assert.equal(checked.status, 0, checked.stderr);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('browser ZIP rejects unsafe paths and excessive entries', () => {
    assert.throws(() => zipStore([{ name: '../audio.wav', bytes: new Uint8Array() }], LIMITS), /limits/);
    assert.throws(() => zipStore(Array.from({ length: 9 }, () => ({ name: 'audio.wav', bytes: new Uint8Array() })), LIMITS), /limits/);
});
