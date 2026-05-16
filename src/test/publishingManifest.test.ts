import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '../..');

function readText(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
    return JSON.parse(readText(relativePath)) as T;
}

test('package.json defines publish and packaging scripts for VS Code releases', () => {
    const manifest = readJson<{ scripts?: Record<string, string> }>('package.json');

    assert.equal(manifest.scripts?.['vscode:prepublish'], 'npm run compile');
    assert.equal(manifest.scripts?.['package:vsix'], 'vsce package --no-yarn --allow-missing-repository --skip-license');
});

test('package.json activates on analyze commands so installed extensions can register handlers on demand', () => {
    const manifest = readJson<{ activationEvents?: string[] }>('package.json');

    assert.ok(manifest.activationEvents?.includes('onCommand:audioWandasAnalyzer.analyzeFile'));
    assert.ok(manifest.activationEvents?.includes('onCommand:audioWandasAnalyzer.analyzeDebugFile'));
});

test('README avoids relative markdown links that break Marketplace packaging', () => {
    const readme = readText('README.md');
    const relativeMarkdownLinks = readme.match(/\]\((?!https?:\/\/|mailto:|#)[^)]+\)/g) ?? [];

    assert.deepEqual(relativeMarkdownLinks, []);
});

test('.vscodeignore excludes development-only assets from the published VSIX', () => {
    const vscodeIgnore = readText('.vscodeignore');

    for (const entry of [
        '.pytest_cache/**',
        '.superpowers/**',
        '.venv/**',
        '.devcontainer/**',
        '.vscode/**',
        'docs/**',
        'node_modules/**',
        'plot_helper/**',
        'src/**',
        'dist/e2e/**',
        'dist/test/**',
        'python-backend/__pycache__/**',
        'python-backend/.pytest_cache/**',
        'python-backend/test_*.py',
    ]) {
        assert.match(vscodeIgnore, new RegExp(`(^|\\n)${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`));
    }
});
