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
                pyodide.globals.set('_source_id', data.sourceId);
                pyodide.globals.set('_source_bytes', new Uint8Array(data.bytes));
                try { output = pyodide.runPython('load_source(_source_id, _source_bytes.to_py())'); }
                finally { pyodide.globals.delete('_source_bytes'); pyodide.globals.delete('_source_id'); }
            } else if (data.cmd === 'export-plan') {
                pyodide.globals.set('_export_plan', JSON.stringify(data.commands));
                try { output = pyodide.runPython('prepare_export_json(_export_plan)'); }
                finally { pyodide.globals.delete('_export_plan'); }
            } else if (data.cmd === 'unload') {
                pyodide.globals.set('_source_path', data.filePath);
                try { output = pyodide.runPython('release_source(_source_path)'); }
                finally { pyodide.globals.delete('_source_path'); }
            } else {
                const { bytes, ...command } = data;
                pyodide.globals.set('_command', JSON.stringify(command));
                try { output = pyodide.runPython('dispatch_json(_command)'); }
                finally { pyodide.globals.delete('_command'); }
            }
            self.postMessage({ requestId: data.requestId, result: JSON.parse(output) });
        } catch (error) {
            self.postMessage({ requestId: data.requestId, error: String(error).slice(-1200) });
        }
    });
};
