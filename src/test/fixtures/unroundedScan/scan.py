"""Scan three recordings with the backend's own scan: ``python scan.py <directory>``, one JSON object of results.

Three 1 kHz tones of two seconds at 16 kHz, a group of one condition (L1 · 900rpm): run 1 at 0.5, run 2 at
0.5 × (1 + 4·10⁻⁶) and run 3 at 0.5 × (1 + 3·10⁻⁶). Their levels lie within 3.5·10⁻⁵ dB of each other, so rounded to
1e-4 dB (or to the 0.1 dB written) they are one level. Run 3's Δ from the median of runs 1 and 2 is
20·log10(1 + 3·10⁻⁶) − 10·log10(1 + 4·10⁻⁶) ≈ 8.7·10⁻⁶ dB. Each is scanned with every Welch bin
(``spectrumBins``), as a report asks, by the scan command the webview sends (command_dispatch.dispatch).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "python-backend"))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from analysis_engine import AnalysisEngine  # noqa: E402
from analysis_service import AnalysisService  # noqa: E402
from command_dispatch import dispatch, validate_request  # noqa: E402

RATE = 16000
BACKEND = Path(__file__).resolve().parents[4] / "python-backend"
RECIPE = json.loads((BACKEND / "recipes" / "entry-scan.recipe.json").read_text())
GAINS = {"L1_900rpm_run1.wav": 1.0, "L1_900rpm_run2.wav": 1.0 + 4e-6, "L1_900rpm_run3.wav": 1.0 + 3e-6}


def main() -> None:
    directory = Path(sys.argv[1])
    service = AnalysisService(AnalysisEngine())
    tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(2 * RATE) / RATE)
    results: dict[str, object] = {}
    for name, gain in GAINS.items():
        path = directory / name
        sf.write(path, (tone * gain)[:, None], RATE, subtype="DOUBLE")
        command = {"cmd": "scan", "requestId": name, "filePath": str(path), "recipe": RECIPE, "spectrumBins": True}
        request = validate_request(command)
        results[str(path)] = dispatch(request, service)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
