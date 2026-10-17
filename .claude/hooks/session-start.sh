#!/bin/bash
# Claude Code cloud sessions only: install what `npm run verify` and
# `npm run test:ui` need. The container is snapshotted after this hook, so
# idempotent installs (npm install, reused .venv) are cheap on later starts.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install --no-audit --no-fund

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet -e ".[dev]"

echo "export PATH=\"$CLAUDE_PROJECT_DIR/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

# The cloud network policy may block the Playwright CDN. When the pinned
# Chromium cannot be downloaded, fall back to the image's preinstalled one.
if ! npx playwright install chromium; then
  if [ -f /opt/pw-browsers/chromium ] && [ -x /opt/pw-browsers/chromium ]; then
    echo "session-start: using preinstalled Chromium /opt/pw-browsers/chromium" >&2
    echo "export AWA_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium" >> "$CLAUDE_ENV_FILE"
  else
    echo "session-start: no Chromium available; npm run test:ui will fail" >&2
  fi
fi
