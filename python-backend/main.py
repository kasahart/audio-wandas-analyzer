from __future__ import annotations

import argparse
import json
import os
import sys
import time

_PERF_ENABLED = os.environ.get("AWA_PERF_LOG", "0") == "1"


def _perf(phase: str, started: float, **extra: object) -> None:
    if not _PERF_ENABLED:
        return
    ms = (time.perf_counter() - started) * 1000.0
    parts = [f"phase={phase}", f"ms={ms:.2f}"]
    parts.extend(f"{k}={v}" for k, v in extra.items())
    print("[perf] " + " ".join(parts), file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze an audio file with wandas")
    parser.add_argument("--file", required=True, help="Path to the audio file")
    parser.add_argument("--peaks", type=int, default=5, help="Number of dominant frequency peaks to return")
    parser.add_argument("--range-start", type=float, default=None, dest="range_start")
    parser.add_argument("--range-end", type=float, default=None, dest="range_end")
    parser.add_argument("--range-points", type=int, default=2000, dest="range_points")
    parser.add_argument("--stft-n-fft", type=int, default=None, dest="stft_n_fft")
    parser.add_argument("--stft-hop", type=int, default=None, dest="stft_hop")
    parser.add_argument("--stft-window", type=str, default=None, dest="stft_window")
    return parser.parse_args()


def main() -> int:
    t_start = time.perf_counter()
    args = parse_args()

    try:
        if args.range_start is not None and args.range_end is not None:
            t_imp = time.perf_counter()
            from range_analyzer import analyze_range  # noqa: PLC0415 — skip wandas import

            _perf("import_range_analyzer", t_imp)

            result: object = analyze_range(
                args.file,
                args.range_start,
                args.range_end,
                args.range_points,
            )
        else:
            t_imp = time.perf_counter()
            from analyzer import analyze_audio  # noqa: PLC0415

            _perf("import_analyzer", t_imp)

            stft_options = None
            if args.stft_n_fft is not None and args.stft_hop is not None:
                stft_options = {
                    "n_fft": args.stft_n_fft,
                    "hop_size": args.stft_hop,
                    "window": args.stft_window or "hann",
                }
            t_an = time.perf_counter()
            result = analyze_audio(args.file, peak_count=args.peaks, stft_options=stft_options)
            _perf("analyze_audio_total", t_an)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    t_dump = time.perf_counter()
    payload = json.dumps(result, ensure_ascii=False)
    _perf("json_dumps", t_dump, bytes=len(payload))
    print(payload)
    _perf("main_total", t_start)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
