from __future__ import annotations

import argparse
import json
import sys


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
    args = parse_args()

    try:
        if args.range_start is not None and args.range_end is not None:
            from range_analyzer import analyze_range  # noqa: PLC0415 — skip wandas import

            result: object = analyze_range(
                args.file,
                args.range_start,
                args.range_end,
                args.range_points,
            )
        else:
            from analyzer import analyze_audio  # noqa: PLC0415

            stft_options = None
            if args.stft_n_fft is not None and args.stft_hop is not None:
                stft_options = {
                    "n_fft": args.stft_n_fft,
                    "hop_size": args.stft_hop,
                    "window": args.stft_window or "hann",
                }
            result = analyze_audio(args.file, peak_count=args.peaks, stft_options=stft_options)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
