"""Run the bundle's wandas Recipe over every recording in targets.csv, outside the Analyzer.

Written by Audio Wandas Analyzer with 「レシピをまとめて書き出す」. Uses only the wandas public API:
``wandas.read`` reads each recording, ``RecipePlan.load`` the Recipe (a channel's Recipe starts with
``get_channel``), ``RecipePlan.apply`` runs it, and the output Frame is saved with ``save`` (WDF; read it back
with ``wandas.load``). One recording that fails does not stop the rest: ``results_index.csv`` says, per
recording, whether it ran and why not.

    python run_recipe.py --root /path/to/recordings --out outputs --jobs 4
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

REQUIRES_WANDAS = (0, 10, 0)
HERE = Path(__file__).resolve().parent


def _version(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", text)[:3])


def _check_wandas() -> None:
    import wandas

    wanted = ".".join(map(str, REQUIRES_WANDAS))
    if _version(wandas.__version__) < REQUIRES_WANDAS:
        found = wandas.__version__
        sys.exit(f'wandas {wanted} or later is needed (found {found}): pip install -U "wandas[io]>={wanted}"')
    # Outputs are saved as WDF, which needs wandas' optional io dependencies.
    try:
        import h5netcdf  # noqa: F401
    except ImportError:
        sys.exit(f'Saving WDF needs wandas[io]: pip install -U "wandas[io]>={wanted}"')


def _output_name(relative: str, channel: str) -> str:
    stem = re.sub(r"[\\/:]+", "__", relative.rsplit(".", 1)[0])
    return f"{stem}{f'.ch{channel}' if channel else ''}.wdf"


def run_one(root: str, out: str, row: dict[str, str]) -> dict[str, str]:
    """Runs the row's Recipe on its recording and saves the output; an error is returned, not raised."""
    import wandas
    from wandas.pipeline import RecipePlan

    started = time.perf_counter()
    relative, channel = row["path"], row.get("channel", "")
    output = Path(out) / _output_name(relative, channel)
    try:
        plan = RecipePlan.load(HERE / row["recipe"])
        frame = wandas.read(Path(root) / relative)
        result = plan.apply({plan.inputs[0].name: frame})
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, overwrite=True)
        status, error = "ok", ""
    except Exception as failure:  # noqa: BLE001 - one recording's failure is written down, the rest go on.
        status, error = "error", f"{type(failure).__name__}: {failure}".splitlines()[0]
        traceback.print_exc(file=sys.stderr)
    return {
        **row,
        "status": status,
        "output": output.name if status == "ok" else "",
        "error": error,
        "seconds": f"{time.perf_counter() - started:.2f}",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the bundle's wandas Recipe over the recordings in targets.csv.")
    parser.add_argument("--root", required=True, help="the folder the paths in targets.csv are relative to")
    parser.add_argument("--out", default="outputs", help="where the outputs and results_index.csv go")
    parser.add_argument("--jobs", type=int, default=1, help="recordings run at the same time (processes)")
    parser.add_argument("--targets", default=str(HERE / "targets.csv"), help="the list of recordings")
    args = parser.parse_args(argv)
    _check_wandas()
    with open(args.targets, encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    Path(args.out).mkdir(parents=True, exist_ok=True)
    if args.jobs > 1:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            results = list(pool.map(run_one, [args.root] * len(rows), [args.out] * len(rows), rows))
    else:
        results = [run_one(args.root, args.out, row) for row in rows]
    fields = [*(rows[0].keys() if rows else ["path", "channel", "recipe"]), "status", "output", "error", "seconds"]
    with open(Path(args.out) / "results_index.csv", "w", encoding="utf-8", newline="") as index:
        writer = csv.DictWriter(index, fieldnames=fields)
        writer.writeheader()
        writer.writerows(results)
    failed = sum(result["status"] != "ok" for result in results)
    print(f"{len(results) - failed} ok, {failed} failed -> {Path(args.out) / 'results_index.csv'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
