const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderComparisonDocument } = require('../dist/webview/panels/comparisonDocument');
const { DEFAULT_SPECTROGRAM_SETTINGS } = require('../dist/shared/analysis/analysisTypes');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'browser-dist');
fs.mkdirSync(path.join(out, 'python'), { recursive: true });
fs.mkdirSync(path.join(out, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(out, 'recipes'), { recursive: true });
for (const name of ['comparisonWaveform.js', 'comparisonRuntime.js', 'staticHost.js', 'chartSpecRuntime.js']) {
    fs.copyFileSync(path.join(root, 'dist/webview', name), path.join(out, name));
}
fs.copyFileSync(path.join(root, 'browser/audio.worker.js'), path.join(out, 'audio.worker.js'));
fs.copyFileSync(path.join(root, 'runtime/lock.json'), path.join(out, 'runtime/lock.json'));
const recipeNames = fs.readdirSync(path.join(root, 'python-backend/recipes')).filter(name => name.endsWith('.json')).sort();
for (const name of fs.readdirSync(path.join(out, 'recipes'))) {
    if (!recipeNames.includes(name) && name !== 'manifest.json') fs.unlinkSync(path.join(out, 'recipes', name));
}
const recipeManifest = recipeNames.map(name => {
    fs.copyFileSync(path.join(root, 'python-backend/recipes', name), path.join(out, 'recipes', name));
    return { name, location: `./recipes/${name}` };
});
fs.writeFileSync(path.join(out, 'recipes/manifest.json'), JSON.stringify(recipeManifest));
// The Worker imports browser_service and optional_packages (browser/audio.worker.js); ship what they import.
function pythonImportClosure(entries) {
    const dir = path.join(root, 'python-backend');
    const local = new Set(fs.readdirSync(dir).filter(name => name.endsWith('.py') && !name.startsWith('test_') && name !== 'conftest.py').map(name => name.slice(0, -3)));
    const seen = new Set();
    const pending = [...entries];
    while (pending.length) {
        const module = pending.pop();
        if (seen.has(module)) continue;
        seen.add(module);
        const source = fs.readFileSync(path.join(dir, `${module}.py`), 'utf8');
        for (const match of source.matchAll(/^\s*(?:from\s+(\w+)[\w.]*\s+import|import\s+([\w., ]+))/gm)) {
            const names = match[1] ? [match[1]] : match[2].split(',').map(name => name.trim().split(/[.\s]/)[0]);
            pending.push(...names.filter(name => local.has(name)));
        }
    }
    return [...seen].sort().map(module => `${module}.py`);
}
const pythonModules = pythonImportClosure(['browser_service', 'optional_packages']);
for (const name of fs.readdirSync(path.join(out, 'python'))) {
    if (name.endsWith('.py') && !pythonModules.includes(name)) fs.unlinkSync(path.join(out, 'python', name));
}
for (const name of pythonModules) fs.copyFileSync(path.join(root, 'python-backend', name), path.join(out, 'python', name));
fs.writeFileSync(path.join(out, 'python/manifest.json'), JSON.stringify(pythonModules));
// A source archive (no .git) or no git on PATH still builds; CI's GITHUB_SHA names the commit there.
function commit() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown';
    }
}
fs.writeFileSync(path.join(out, 'index.html'), renderComparisonDocument({ mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS }, {
    waveformScriptUri: './comparisonWaveform.js', runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en',
    appVersion: `${require('../package.json').version} (${commit()})`,
}));
console.log('Built browser-dist/ (relative URLs, suitable for a GitHub Pages project subpath)');
