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

test('package.json contributes GUI entry points for analysis', () => {
    const manifest = readJson<{
        contributes?: {
            commands?: Array<{ command: string; title: string }>;
            menus?: { 'explorer/context'?: Array<{ command: string; when?: string }> };
            viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
            views?: Record<string, Array<{ id: string; name: string }>>;
            viewsWelcome?: Array<{ view: string; contents: string }>;
        };
    }>('package.json');

    assert.match(
        JSON.stringify(manifest.contributes?.commands ?? []),
        /"command":"audioWandasAnalyzer\.analyzeThisTarget"/,
    );
    assert.deepEqual(
        manifest.contributes?.menus?.['explorer/context']?.map((item) => item.command),
        ['audioWandasAnalyzer.analyzeThisTarget', 'audioWandasAnalyzer.analyzeThisTarget'],
    );
    assert.equal(
        manifest.contributes?.menus?.['explorer/context']?.[0]?.when,
        'resourceExtname =~ /^\\.(wav|flac|ogg|aiff|aif|snd)$/i',
    );
    assert.deepEqual(manifest.contributes?.viewsContainers?.activitybar, [
        {
            id: 'audioWandasAnalyzer',
            title: 'Audio Analyzer',
            icon: 'media/icon.svg',
        },
    ]);
    assert.deepEqual(manifest.contributes?.views?.audioWandasAnalyzer, [
        {
            id: 'audioWandasAnalyzer.welcomeView',
            name: 'Audio Analyzer',
        },
    ]);
    assert.equal(manifest.contributes?.viewsWelcome?.[0]?.view, 'audioWandasAnalyzer.welcomeView');
    assert.match(manifest.contributes?.viewsWelcome?.[0]?.contents ?? '', /Analyze with Audio Analyzer/);
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
