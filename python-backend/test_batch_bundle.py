from __future__ import annotations

import csv
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
import wandas as wd

REPO = Path(__file__).parents[1]
BUNDLE_JS = REPO / "dist" / "shared" / "batch" / "batchBundle.js"
DATASET_JS = REPO / "dist" / "shared" / "dataset" / "datasetTable.js"
RECIPE = REPO / "python-backend" / "recipes" / "entry-scan.recipe.json"

# The webview's own bundle builder (compiled TypeScript), given rows as the entry table has them.
EXPORT = """
const { batchBundle } = require(process.argv[1]);
const { datasetRows } = require(process.argv[2]);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const attributes = new Map(Object.entries(input.attributes));
const all = datasetRows(input.files, input.root, attributes, new Map(), new Map(Object.entries(input.channels)));
const rows = all.filter(row => input.keep.includes(row.key));
const bundle = batchBundle({
    recipe: input.recipe, recipeName: 'Standard', rows, allRows: all, rootPath: input.root,
    idColumn: 'sample_id', now: new Date(),
});
process.stdout.write(JSON.stringify(bundle));
"""


@pytest.mark.skipif(
    not BUNDLE_JS.exists() or shutil.which("node") is None,
    reason="needs the compiled webview (npm run compile) and node",
)
def test_an_exported_bundle_runs_its_recipe_over_its_targets_and_the_outputs_load_back(tmp_path: Path) -> None:
    root = tmp_path / "recordings"
    (root / "L1").mkdir(parents=True)
    rate = 16000
    t = np.arange(2 * rate) / rate
    sf.write(root / "L1" / "mono.wav", 0.3 * np.sin(2 * np.pi * 440 * t), rate, subtype="FLOAT")
    two = np.stack([0.5 * np.sin(2 * np.pi * 1000 * t), 0.1 * np.sin(2 * np.pi * 3150 * t)], axis=1)
    sf.write(root / "two.wav", two, rate, subtype="FLOAT")
    files = [str(root / "L1" / "mono.wav"), str(root / "two.wav")]
    payload = {
        "files": files,
        "root": str(root),
        "attributes": {files[0]: {"sample_id": "S1"}, files[1]: {"sample_id": "S2"}},
        "channels": {files[0]: 1, files[1]: 2},
        # The table narrowed to ch 2 of the two-channel recording, and the mono one.
        "keep": [files[0], f"{files[1]}#ch2"],
        "recipe": json.loads(RECIPE.read_text()),
    }
    made = subprocess.run(
        ["node", "-e", EXPORT, str(BUNDLE_JS), str(DATASET_JS)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=True,
    )
    bundle = json.loads(made.stdout)
    folder = tmp_path / bundle["folder"]
    folder.mkdir()
    for file in bundle["files"]:
        (folder / file["name"]).write_text(file["text"], encoding="utf-8")
    assert sorted(file["name"] for file in bundle["files"]) == [
        "README.txt",
        "Standard.ch2.recipe.json",
        "Standard.recipe.json",
        "run_recipe.py",
        "targets.csv",
    ]
    # A missing recording is written down and does not stop the rest.
    with open(folder / "targets.csv", "a", encoding="utf-8", newline="") as targets:
        targets.write("gone.wav,,Standard.recipe.json,S9\r\n")
    out = tmp_path / "out"
    run = subprocess.run(
        [sys.executable, str(folder / "run_recipe.py"), "--root", str(root), "--out", str(out), "--jobs", "2"],
        capture_output=True,
        text=True,
    )
    assert run.returncode == 1, run.stderr
    with open(out / "results_index.csv", encoding="utf-8") as index:
        results = {row["path"]: row for row in csv.DictReader(index)}
    assert [results[path]["status"] for path in ("L1/mono.wav", "two.wav", "gone.wav")] == ["ok", "ok", "error"]
    assert results["two.wav"]["channel"] == "2"
    assert results["gone.wav"]["error"]
    # The outputs load back as wandas Frames; the channel's Recipe gave one channel: the 3.15 kHz one.
    mono = wd.load(out / results["L1/mono.wav"]["output"])
    ch2 = wd.load(out / results["two.wav"]["output"])
    assert type(mono).__name__ == type(ch2).__name__ == "SpectralFrame"
    assert ch2.n_channels == 1
    levels = np.atleast_2d(np.asarray(ch2.data))[0]
    peak = ch2.freqs[int(np.argmax(np.abs(levels)))]
    assert 3000 < peak < 3300


def test_outputs_keep_the_recordings_path_and_extension_so_no_two_share_one() -> None:
    spec = importlib.util.spec_from_file_location("run_recipe", REPO / "python-backend" / "batch" / "run_recipe.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    names = [module._output_name(path, "") for path in ("rec.wav", "rec.flac", "L1/a.wav", "L1__a.wav")]
    assert names == ["rec.wav.wdf", "rec.flac.wdf", "L1/a.wav.wdf", "L1__a.wav.wdf"]
    assert module._output_name("two.wav", "2") == "two.wav.ch2.wdf"
