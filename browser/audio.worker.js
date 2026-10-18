let pyodide;
let queue = Promise.resolve();
const networkFetch = self.fetch.bind(self);
const RUNTIME_CACHE = 'awa-runtime';
async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function initialize() {
    const base = new URL('./runtime/', self.location.href);
    const lock = await (await networkFetch(new URL('lock.json', base))).json();
    // Entries are keyed by the locked sha256, so a cached runtime file is reused across visits until the lock changes it.
    const cache = await self.caches?.open(RUNTIME_CACHE).catch(() => undefined);
    const cacheKey = asset => `${new URL(asset.path, base).href}?sha256=${asset.sha256}`;
    const download = async asset => {
        const cached = await cache?.match(cacheKey(asset)).catch(() => undefined);
        if (cached) {
            const bytes = new Uint8Array(await cached.arrayBuffer());
            if (await sha256Hex(bytes) === asset.sha256) return bytes;
        }
        const response = await networkFetch(new URL(asset.path, base));
        if (!response.ok) throw new Error(`Missing runtime asset: ${asset.path}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (await sha256Hex(bytes) !== asset.sha256) throw new Error(`Runtime integrity mismatch: ${asset.path}`);
        cache?.put(cacheKey(asset), new Response(bytes)).catch(() => {});
        return bytes;
    };
    const downloads = new Map(lock.assets.map(asset => [new URL(asset.path, base).href, { asset, bytes: download(asset) }]));
    // Every runtime file starts downloading at once; a boot that fails earlier would otherwise leave these rejections unhandled.
    for (const { bytes } of downloads.values()) bytes.catch(() => {});
    const fetchVerified = path => {
        const entry = downloads.get(new URL(path, base).href);
        if (!entry) throw new Error(`Missing runtime asset: ${path}`);
        return entry.bytes;
    };
    // Pyodide fetches the wasm, the stdlib and the native wheels itself; answering from the downloads above hands it
    // the verified, possibly cached bytes instead of a second, unverified request.
    self.fetch = async (input, init) => {
        const entry = downloads.get(new URL(input instanceof Request ? input.url : input, self.location.href).href);
        if (!entry) return networkFetch(input, init);
        const type = entry.asset.path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
        return new Response(await entry.bytes, { headers: { 'Content-Type': type } });
    };
    const pureWheels = Promise.all(lock.pureWheels.map(fetchVerified));
    const sources = fetch('./python/manifest.json').then(response => response.json()).then(files => Promise.all(files.map(async name => {
        const response = await fetch(`./python/${name}`);
        if (!response.ok) throw new Error(`Missing Python module: ${name}`);
        return [name, await response.text()];
    })));
    pureWheels.catch(() => {});
    sources.catch(() => {});
    await Promise.all(lock.assets.filter(asset => !asset.path.endsWith('.whl')).map(asset => fetchVerified(asset.path)));
    // Handing Pyodide the verified bytes keeps a second, unverified fetch from supplying the wheel hashes.
    const lockFileContents = new TextDecoder().decode(await fetchVerified('pyodide-lock.json'));
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
    downloads.clear();
    // Files from an earlier lock are dropped so the cache holds one runtime.
    const current = new Set(lock.assets.map(cacheKey));
    cache?.keys().then(keys => Promise.all(keys.filter(key => !current.has(key.url)).map(key => cache.delete(key)))).catch(() => {});
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
