import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

test('extension runtime lives under src/extension and package main points to nested dist entrypoint', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { main?: string };

    assert.equal(packageJson.main, './dist/extension/index.js');
    assert.equal(existsSync(path.join(repoRoot, 'src', 'extension', 'index.ts')), true);
    assert.equal(existsSync(path.join(repoRoot, 'src', 'extension', 'waveformServer.ts')), true);
});
