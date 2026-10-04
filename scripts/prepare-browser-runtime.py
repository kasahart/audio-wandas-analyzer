"""Download only hash-locked public runtime assets; never accepts input data."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "runtime/lock.json"
DESTINATION = ROOT / "browser-dist/runtime"


def verified(path: Path, expected: str) -> bool:
    return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify prepared assets without network access")
    options = parser.parse_args()
    lock_bytes = LOCK.read_bytes()
    lock = json.loads(lock_bytes)
    if not options.check:
        DESTINATION.mkdir(parents=True, exist_ok=True)

    def generated(target: Path, content: bytes) -> None:
        if target.is_file() and target.read_bytes() == content:
            return
        if options.check:
            raise RuntimeError(f"Missing or mismatched generated runtime file: {target.name}")
        target.write_bytes(content)

    def prepare(asset: dict) -> None:
        name = asset["path"]
        if Path(name).name != name:
            raise ValueError("Runtime asset paths must be filenames")
        target = DESTINATION / name
        if verified(target, asset["sha256"]):
            return
        if options.check:
            raise RuntimeError(f"Missing or mismatched runtime asset: {name}")
        url = asset["url"]
        if not url.startswith(("https://cdn.jsdelivr.net/", "https://files.pythonhosted.org/")):
            raise ValueError("Unexpected runtime source")
        with urllib.request.urlopen(url, timeout=120) as response:
            payload = response.read(160 * 1024 * 1024 + 1)
        if len(payload) > 160 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != asset["sha256"]:
            raise RuntimeError(f"Runtime hash mismatch: {name}")
        temporary = target.with_suffix(target.suffix + ".download")
        temporary.write_bytes(payload)
        temporary.replace(target)
        print(f"Prepared {asset['component']} {asset['version']}", flush=True)

    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(prepare, lock["assets"]))

    # Preserve embedded upstream notices beside the redistributed artifacts.
    licenses = DESTINATION / "licenses"
    if not options.check:
        licenses.mkdir(exist_ok=True)
    for notice in lock["notices"]:
        source = ROOT / "runtime/licenses" / notice["path"]
        if not verified(source, notice["sha256"]):
            raise RuntimeError("A bundled upstream license notice is missing or modified")
        generated(licenses / notice["path"], source.read_bytes())
    for asset in lock["assets"]:
        if not asset["path"].endswith(".whl"):
            continue
        with zipfile.ZipFile(DESTINATION / asset["path"]) as wheel:
            for item in wheel.infolist():
                lower = item.filename.lower()
                if item.is_dir() or item.file_size > 4 * 1024 * 1024:
                    continue
                if ".dist-info/" in lower and any(word in lower for word in ["license", "licence", "copying", "notice"]):
                    name = asset["component"] + "--" + item.filename.replace("/", "--")
                    generated(licenses / name, wheel.read(item))
    print(f"Verified {len(lock['assets'])} runtime assets")


if __name__ == "__main__":
    main()
