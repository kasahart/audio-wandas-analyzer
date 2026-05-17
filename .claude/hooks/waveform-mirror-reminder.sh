#!/usr/bin/env bash
# PostToolUse hook: when an agent edits one of the two waveform mirror files,
# remind it that the other must stay in sync.
#
# Reads the Claude Code hook payload from stdin (JSON) and looks at
# tool_input.file_path. Prints a one-line reminder to stderr when relevant.

set -euo pipefail

payload="$(cat)"

# Extract file_path with python (avoids a hard jq dependency).
file_path="$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print((d.get("tool_input") or {}).get("file_path", ""))
' 2>/dev/null || true)"

case "$file_path" in
    */src/webview/waveform/waveformRenderer.ts)
        echo "REMINDER: waveformRenderer.ts changed — mirror the change in media/comparisonWaveform.js (AGENTS.md §5)." >&2
        ;;
    */media/comparisonWaveform.js)
        echo "REMINDER: comparisonWaveform.js changed — mirror the change in src/webview/waveform/waveformRenderer.ts (AGENTS.md §5)." >&2
        ;;
esac

exit 0
