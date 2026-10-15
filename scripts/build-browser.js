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
const lock = JSON.parse(fs.readFileSync(path.join(root, 'runtime/lock.json'), 'utf8'));
const bundledDistributions = new Set([
    ...lock.nativePackages.map(name => name.toLowerCase()),
    ...lock.pureWheels.map(name => name.split('-')[0].toLowerCase()),
]);
const recipeNames = fs.readdirSync(path.join(root, 'python-backend/recipes')).filter(name => name.endsWith('.json')).sort();
for (const name of fs.readdirSync(path.join(out, 'recipes'))) {
    if (!recipeNames.includes(name) && name !== 'manifest.json') fs.unlinkSync(path.join(out, 'recipes', name));
}
const recipeManifest = recipeNames.map(name => {
    fs.copyFileSync(path.join(root, 'python-backend/recipes', name), path.join(out, 'recipes', name));
    const recipe = JSON.parse(fs.readFileSync(path.join(root, 'python-backend/recipes', name), 'utf8'));
    const missing = (recipe.requires ?? []).filter(dist => !bundledDistributions.has(String(dist).toLowerCase()));
    return { name, location: `./recipes/${name}`, ...(missing.length ? { missing } : {}) };
});
fs.writeFileSync(path.join(out, 'recipes/manifest.json'), JSON.stringify(recipeManifest));
const pythonModules = ['analysis_engine.py', 'analysis_service.py', 'analyzer.py', 'backend_errors.py', 'command_dispatch.py', 'browser_service.py', 'calibration_profile.py', 'chart_spec.py', 'decimator.py', 'perf.py', 'protocol_schema.py', 'recipe_runner.py', 'wandas_to_chart.py'];
for (const name of fs.readdirSync(path.join(out, 'python'))) {
    if (name.endsWith('.py') && !pythonModules.includes(name)) fs.unlinkSync(path.join(out, 'python', name));
}
for (const name of pythonModules) fs.copyFileSync(path.join(root, 'python-backend', name), path.join(out, 'python', name));
fs.writeFileSync(path.join(out, 'python/manifest.json'), JSON.stringify(pythonModules));
fs.writeFileSync(path.join(out, 'index.html'), renderComparisonDocument({ mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS }, {
    waveformScriptUri: './comparisonWaveform.js', runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en',
    appVersion: `${require('../package.json').version} (${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()})`,
}));
console.log('Built browser-dist/ (relative URLs, suitable for a GitHub Pages project subpath)');
