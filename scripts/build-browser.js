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
for (const name of ['comparisonRuntime.js', 'staticHost.js']) {
    fs.copyFileSync(path.join(root, 'dist/webview', name), path.join(out, name));
}
fs.copyFileSync(path.join(root, 'browser/audio.worker.js'), path.join(out, 'audio.worker.js'));
fs.copyFileSync(path.join(root, 'runtime/lock.json'), path.join(out, 'runtime/lock.json'));
const recipeNames = fs.readdirSync(path.join(root, 'python-backend/recipes')).filter(name => name.endsWith('.json')).sort();
for (const name of fs.readdirSync(path.join(out, 'recipes'))) {
    if (!recipeNames.includes(name)) fs.unlinkSync(path.join(out, 'recipes', name));
}
for (const name of recipeNames) fs.copyFileSync(path.join(root, 'python-backend/recipes', name), path.join(out, 'recipes', name));
// The Worker imports browser_service and services.optional_packages (browser/audio.worker.js); ship what they import.
// Modules are top-level files of python-backend/ or files of its packages (a folder with __init__.py, such as
// figures/, services/, transport/): `import a`, `from a import b`, `from a.b import c` (c a submodule or a name), and
// a package's relative `from . import b` / `from .b import c`. A package's __init__.py ships with any of its modules.
function pythonImportClosure(entries) {
    const dir = path.join(root, 'python-backend');
    const fileOf = dotted => {
        const parts = dotted.split('.');
        for (const candidate of [`${parts.join('/')}.py`, `${parts.join('/')}/__init__.py`]) {
            if (fs.existsSync(path.join(dir, candidate)) && !path.basename(candidate).startsWith('test_') && candidate !== 'conftest.py') return candidate;
        }
        return null;
    };
    const seen = new Set();
    const pending = entries.map(fileOf).filter(Boolean);
    while (pending.length) {
        const file = pending.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        const parts = file.replace(/\.py$/, '').split('/');
        const isInit = parts[parts.length - 1] === '__init__';
        const pkg = isInit ? parts.slice(0, -1) : parts.slice(0, -1);
        // Every enclosing package's __init__.py runs before the module.
        for (let depth = 1; depth <= pkg.length; depth++) {
            const init = `${pkg.slice(0, depth).join('/')}/__init__.py`;
            if (fs.existsSync(path.join(dir, init))) pending.push(init);
        }
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const match of source.matchAll(/^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(?:\(([^)]*)\)|([^\n#]+))|import[ \t]+([\w., \t]+))/gm)) {
            const dotted = [];
            if (match[4]) {
                dotted.push(...match[4].split(',').map(name => name.trim().split(/\s/)[0]));
            } else {
                let from = match[1];
                const dots = from.match(/^\.*/)[0].length;
                if (dots) from = [...pkg.slice(0, pkg.length - (dots - 1)), ...(from.slice(dots) ? [from.slice(dots)] : [])].join('.');
                if (from) dotted.push(from);
                const names = (match[2] ?? match[3]).split(',').map(name => name.trim().split(/\s/)[0]).filter(Boolean);
                dotted.push(...names.map(name => `${from ? `${from}.` : ''}${name}`));
            }
            for (const name of dotted) {
                const found = fileOf(name);
                if (found) pending.push(found);
            }
        }
    }
    return [...seen].sort();
}
const pythonModules = pythonImportClosure(['browser_service', 'services.optional_packages']);
const shipped = dir => fs.readdirSync(path.join(out, 'python', dir), { withFileTypes: true }).flatMap(entry => {
    const name = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? shipped(name) : [name];
});
for (const name of shipped('')) {
    if (name.endsWith('.py') && !pythonModules.includes(name)) fs.unlinkSync(path.join(out, 'python', name));
}
for (const name of pythonModules) {
    fs.mkdirSync(path.dirname(path.join(out, 'python', name)), { recursive: true });
    fs.copyFileSync(path.join(root, 'python-backend', name), path.join(out, 'python', name));
}
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
    runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en',
    appVersion: `${require('../package.json').version} (${commit()})`,
}));
console.log('Built browser-dist/ (relative URLs, suitable for a GitHub Pages project subpath)');
