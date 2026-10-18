let pyodide;
let queue = Promise.resolve();
async function initialize() {
    const base = new URL('./runtime/', self.location.href);
    const lock = await (await fetch(new URL('lock.json', base))).json();
    const fetchVerified = async asset => {
        const response = await fetch(new URL(asset.path, base));
        if (!response.ok) throw new Error(`Missing runtime asset: ${asset.path}`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== asset.sha256) throw new Error(`Runtime integrity mismatch: ${asset.path}`);
        return new Uint8Array(bytes);
    };
    // Every file is fetched once and concurrently. Native wheels are left to loadPackage, which checks each
    // against the sha256 in the pyodide-lock.json verified here.
    const pureWheels = Promise.all(lock.pureWheels.map(name => {
        const asset = lock.assets.find(candidate => candidate.path === name);
        if (!asset) throw new Error(`Missing runtime asset: ${name}`);
        return fetchVerified(asset);
    }));
    const sources = fetch('./python/manifest.json').then(response => response.json()).then(files => Promise.all(files.map(async name => {
        const response = await fetch(`./python/${name}`);
        if (!response.ok) throw new Error(`Missing Python module: ${name}`);
        return [name, await response.text()];
    })));
    // A boot that fails earlier would otherwise leave these rejections unhandled.
    pureWheels.catch(() => {});
    sources.catch(() => {});
    const coreAssets = lock.assets.filter(asset => !asset.path.endsWith('.whl'));
    const coreBytes = await Promise.all(coreAssets.map(fetchVerified));
    // Handing Pyodide the verified bytes keeps a second, unverified fetch from supplying the wheel hashes.
    const lockFileContents = new TextDecoder().decode(coreBytes[coreAssets.findIndex(asset => asset.path === 'pyodide-lock.json')]);
    const module = await import(new URL('pyodide.mjs', base).href);
    if (module.version !== lock.pyodideVersion) throw new Error('Pyodide version mismatch');
    pyodide = await module.loadPyodide({ indexURL: base.href, packageBaseUrl: base.href, cdnUrl: base.href, lockFileContents });
    // loadPackage may only report a wheel that fails to download or verify, so either outcome fails the boot here.
    const packageErrors = [];
    await pyodide.loadPackage(lock.nativePackages, { checkIntegrity: true, errorCallback: message => packageErrors.push(message) })
        .catch(error => packageErrors.push(String(error)));
    if (packageErrors.length) throw new Error(`Failed to load runtime packages: ${packageErrors.join('; ')}`);
    const purelib = pyodide.runPython('import sysconfig; sysconfig.get_path("purelib")');
    for (const wheel of await pureWheels) pyodide.unpackArchive(wheel, 'zip', { extractDir: purelib });
    for (const [name, text] of await sources) pyodide.FS.writeFile(`/home/pyodide/${name}`, text);
    // perf.py logs by default; a Worker has no one reading stderr, so it is silenced before the import.
    pyodide.runPython('import os; os.environ.setdefault("AWA_PERF_LOG", "0")');
    pyodide.runPython('from browser_service import browser_limits_json, load_source, release_source, prepare_export_json, dispatch_json');
}
// Booting at Worker start (not on the first message) lets the host start Pyodide before any WAV is chosen.
// The unsolicited `ready` message only drives the host's Python indicator; each command still reports a failed boot itself.
const initialization = initialize();
initialization.then(() => self.postMessage({ ready: true }), () => self.postMessage({ ready: false }));
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            await initialization;
            let output;
            if (data.cmd === 'load') {
                const sourceBytes = pyodide.toPy(new Uint8Array(data.bytes));
                const load = pyodide.globals.get('load_source');
                try { output = load(data.sourceId, sourceBytes); }
                finally { load.destroy(); sourceBytes.destroy(); }
            } else if (data.cmd === 'export-plan') {
                const prepare = pyodide.globals.get('prepare_export_json');
                try { output = prepare(JSON.stringify(data.commands)); }
                finally { prepare.destroy(); }
            } else if (data.cmd === 'limits') {
                const limits = pyodide.globals.get('browser_limits_json');
                try { output = limits(); }
                finally { limits.destroy(); }
            } else if (data.cmd === 'unload') {
                const release = pyodide.globals.get('release_source');
                try { output = release(data.filePath); }
                finally { release.destroy(); }
            } else if (data.cmd === 'clear') {
                // Imported on use, so a stale cached browser_service.py without it fails only this command, not the boot.
                output = pyodide.runPython('import browser_service; browser_service.release_all_sources()');
            } else {
                const { bytes, ...command } = data;
                const dispatch = pyodide.globals.get('dispatch_json');
                try { output = dispatch(JSON.stringify(command)); }
                finally { dispatch.destroy(); }
            }
            const result = JSON.parse(output);
            if (result.error) {
                self.postMessage({ requestId: data.requestId, error: result.error });
            } else {
                self.postMessage({ requestId: data.requestId, result });
            }
        } catch (error) {
            self.postMessage({ requestId: data.requestId, error: { code: 'internal-error', message: String(error).slice(-1200) } });
        }
    });
};
