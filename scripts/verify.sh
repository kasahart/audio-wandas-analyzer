#!/usr/bin/env bash
# Single source of truth for "is the working tree green?".
# An agent's task is not done until this script exits 0.
#
# Runs:
#   - tsc compile
#   - dependency pin / browser limit single-source check
#   - node:test against compiled output
#   - ruff lint + format check on python-backend
#   - pytest on python-backend
#
# E2E (npm run verify:e2e) is intentionally NOT here; it needs a display
# and is slow. CI runs it as a separate job.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ -d "$repo_root/.venv/bin" ]; then
    PATH="$repo_root/.venv/bin:$PATH"
fi

echo "==> tsc compile"
npm run compile

echo "==> webview pattern lint"
node scripts/lint-webview-patterns.js

echo "==> single-source consistency (dependency pins, browser limits)"
node scripts/check-single-sources.mjs

echo "==> gui triggerability audit"
npm run lint:gui-triggerability

echo "==> node:test"
node --test dist/test/**/*.test.js

if command -v ruff >/dev/null 2>&1; then
    echo "==> ruff check"
    ruff check python-backend
    echo "==> ruff format --check"
    ruff format --check python-backend
else
    echo "ruff not found — install dev deps with: pip install -e \".[dev]\"" >&2
    exit 1
fi

echo "==> pytest"
python -m pytest python-backend

if [ "${AWA_VERIFY_BROWSER:-0}" = "1" ]; then
    echo "==> browser runtime asset integrity and Worker/native parity"
    python3 scripts/prepare-browser-runtime.py --check
    npm run test:browser
fi

echo "==> authored runtime source sharing audit"
python3 scripts/audit-runtime-sharing.py --output test-results/runtime-sharing.json

echo "verify: OK"
