const fs = require('node:fs');
const path = require('node:path');
const { renderComparisonDocument } = require('../dist/webview/panels/comparisonDocument');
const { DEFAULT_SPECTROGRAM_SETTINGS } = require('../dist/shared/analysis/analysisTypes');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'browser-dist');
fs.mkdirSync(path.join(out, 'python'), { recursive: true });
fs.mkdirSync(path.join(out, 'runtime'), { recursive: true });
for (const name of ['comparisonWaveform.js', 'comparisonRuntime.js', 'staticHost.js']) {
    fs.copyFileSync(path.join(root, 'dist/webview', name), path.join(out, name));
}
fs.copyFileSync(path.join(root, 'browser/audio.worker.js'), path.join(out, 'audio.worker.js'));
fs.copyFileSync(path.join(root, 'runtime/lock.json'), path.join(out, 'runtime/lock.json'));
const pythonModules = ['analysis_engine.py', 'analysis_service.py', 'analyzer.py', 'backend_server.py', 'browser_service.py', 'calibration_profile.py', 'decimator.py'];
for (const name of pythonModules) fs.copyFileSync(path.join(root, 'python-backend', name), path.join(out, 'python', name));
fs.writeFileSync(path.join(out, 'python/manifest.json'), JSON.stringify(pythonModules));
fs.writeFileSync(path.join(out, 'index.html'), renderComparisonDocument({ mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS }, {
    waveformScriptUri: './comparisonWaveform.js', runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en',
}));
console.log('Built browser-dist/ (relative URLs, suitable for a GitHub Pages project subpath)');
