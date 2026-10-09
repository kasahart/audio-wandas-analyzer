let initialization;
let pyodide;
let queue = Promise.resolve();
async function initialize() {
    const base = new URL('./runtime/', self.location.href);
    const lock = await (await fetch(new URL('lock.json', base))).json();
    for (const asset of lock.assets) {
        const response = await fetch(new URL(asset.path, base));
        if (!response.ok) throw new Error(`Missing runtime asset: ${asset.path}`);
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== asset.sha256) throw new Error(`Runtime integrity mismatch: ${asset.path}`);
    }
    const module = await import(new URL('pyodide.mjs', base).href);
    if (module.version !== lock.pyodideVersion) throw new Error('Pyodide version mismatch');
    pyodide = await module.loadPyodide({ indexURL: base.href, packageBaseUrl: base.href, cdnUrl: base.href });
    await pyodide.loadPackage(lock.nativePackages);
    const purelib = pyodide.runPython('import sysconfig; sysconfig.get_path("purelib")');
    for (const name of lock.pureWheels) {
        const response = await fetch(new URL(name, base));
        if (!response.ok) throw new Error(`Missing runtime wheel: ${name}`);
        pyodide.unpackArchive(new Uint8Array(await response.arrayBuffer()), 'zip', { extractDir: purelib });
    }
    const files = await (await fetch('./python/manifest.json')).json();
    for (const name of files) {
        const response = await fetch(`./python/${name}`);
        if (!response.ok) throw new Error(`Missing Python module: ${name}`);
        pyodide.FS.writeFile(`/home/pyodide/${name}`, await response.text());
    }
    pyodide.runPython('from browser_service import load_source, release_source, prepare_export_json, dispatch_json');
}
self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            await (initialization ??= initialize());
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
            } else if (data.cmd === 'unload') {
                const release = pyodide.globals.get('release_source');
                try { output = release(data.filePath); }
                finally { release.destroy(); }
            } else {
                const { bytes, ...command } = data;
                const dispatch = pyodide.globals.get('dispatch_json');
                try { output = dispatch(JSON.stringify(command)); }
                finally { dispatch.destroy(); }
            }
            const result = JSON.parse(output);
            if (data.cmd === 'load' && result.inputError) {
                self.postMessage({ requestId: data.requestId, error: result.inputError });
            } else {
                self.postMessage({ requestId: data.requestId, result });
            }
        } catch (error) {
            self.postMessage({ requestId: data.requestId, error: String(error).slice(-1200) });
        }
    });
};
