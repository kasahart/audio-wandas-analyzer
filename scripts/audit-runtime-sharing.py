"""Audit authored runtime source reachability; generated copies and vendor are excluded."""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI_ROOTS = [
    'src/webview/runtime/comparisonEntry.ts',
    'src/webview/waveform/waveformRenderer.ts',
    'src/webview/draw/canvasDrawers.ts',
    'src/webview/panels/comparisonDocument.ts',
]
EXCLUDED = ('src/test/', 'src/e2e/', 'src/testing/', 'src/tools/', 'src/shared/gui-core/', 'src/webview/runtime/testBridge.ts')
IMPORT = re.compile(r'^\s*(?:import|export)\s+[^;]*?\bfrom\s*[\'\"]([^\'\"]+)[\'\"]', re.M)


def sources(ref: str | None) -> dict[str, str]:
    if ref:
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref], cwd=ROOT, text=True).splitlines()
        return {p: subprocess.check_output(['git', 'show', f'{ref}:{p}'], cwd=ROOT, text=True) for p in paths
                if p.endswith(('.ts', '.py')) and p.startswith(('src/', 'python-backend/')) or p == 'browser/audio.worker.js'}
    return {str(p.relative_to(ROOT)): p.read_text() for folder in ['src', 'python-backend', 'browser']
            for p in (ROOT / folder).rglob('*') if p.is_file() and p.suffix in {'.ts', '.py', '.js'} and '__pycache__' not in p.parts}


def audit(ref: str | None) -> dict:
    data = sources(ref)
    ts = {p for p in data if p.startswith('src/') and p.endswith('.ts') and not p.startswith(EXCLUDED)}
    py = {Path(p).stem: p for p in data if p.startswith('python-backend/') and p.endswith('.py') and not Path(p).name.startswith('test_')}

    def edges(p: str) -> list[str]:
        if p.endswith('.ts'):
            requests = IMPORT.findall(data[p]) + re.findall(r'^\s*import\s*[\'\"]([^\'\"]+)[\'\"]', data[p], re.M)
            found = []
            for request in requests:
                if not request.startswith('.'): continue
                stem = (ROOT / Path(p).parent / request).resolve()
                for candidate in [stem.with_suffix('.ts'), stem / 'index.ts']:
                    name = str(candidate.relative_to(ROOT))
                    if name in ts: found.append(name); break
            return found
        names = []
        for node in ast.walk(ast.parse(data[p])):
            if isinstance(node, ast.ImportFrom) and node.module: names.append(node.module.split('.')[0])
            elif isinstance(node, ast.Import): names.extend(a.name.split('.')[0] for a in node.names)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'import_module' and node.args and isinstance(node.args[0], ast.Constant): names.append(node.args[0].value)
        return [py[name] for name in names if name in py]

    def reach(roots: list[str]) -> dict[str, str]:
        parents = {p: 'root' for p in roots}
        queue = list(roots)
        for p in queue:
            for child in edges(p):
                if child not in parents: parents[child] = p; queue.append(child)
        return parents

    desktop = reach(['src/extension/bootstrap.ts', 'python-backend/backend_server.py', 'python-backend/recipe_runner.py', *UI_ROOTS])
    web = reach(['src/webview/runtime/staticHost.ts', 'src/shared/analysis/analysisTypes.ts', 'python-backend/browser_service.py', *UI_ROOTS])
    web['browser/audio.worker.js'] = 'copied:scripts/build-browser.js'
    files = [{'path': p, 'language': {'.ts': 'TS', '.py': 'Python', '.js': 'JS'}[Path(p).suffix],
              'classification': 'shared' if p in desktop and p in web else 'desktopOnly' if p in desktop else 'webOnly',
              'desktopParent': desktop.get(p), 'webParent': web.get(p),
              'nonblankLines': sum(bool(line.strip()) for line in data[p].splitlines())}
             for p in sorted(desktop.keys() | web.keys())]
    counts = {kind: sum(f['classification'] == kind for f in files) for kind in ['shared', 'desktopOnly', 'webOnly']}
    lines = {kind: sum(f['nonblankLines'] for f in files if f['classification'] == kind) for kind in counts}
    def rates(values: dict[str, int]) -> dict:
        shared, desktop_only, web_only = (values[k] for k in ['shared', 'desktopOnly', 'webOnly'])
        return {**values, 'union': shared + desktop_only + web_only,
                'unionSharedPercent': round(100 * shared / (shared + desktop_only + web_only), 4),
                'desktopSharedPercent': round(100 * shared / (shared + desktop_only), 4),
                'webSharedPercent': round(100 * shared / (shared + web_only), 4)}
    return {'ref': ref or 'working-tree', 'files': files, 'fileCounts': rates(counts), 'nonblankLines': rates(lines)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', help='Optional baseline commit; omit for shallow CI checkouts')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = {'method': 'Same baseline source roots/import closure including type references; file reachability is not all-lines execution or feature parity. Embedded HTML/CSS counted within TS; standalone authored HTML/CSS=0. Tests, vendor, generated files, docs, build/dev tools, config/data assets excluded.',
              'baseline': audit(args.baseline) if args.baseline else None, 'current': audit(None)}
    value = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output: args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(value)
    else: print(value)


if __name__ == '__main__':
    main()
