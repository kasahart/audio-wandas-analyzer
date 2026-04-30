from __future__ import annotations

import argparse
import json
import sys

from analyzer import analyze_audio


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze an audio file with wandas")
    parser.add_argument("--file", required=True, help="Path to the audio file")
    parser.add_argument("--peaks", type=int, default=5, help="Number of dominant frequency peaks to return")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        result = analyze_audio(args.file, peak_count=args.peaks)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())