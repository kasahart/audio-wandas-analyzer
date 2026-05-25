#!/usr/bin/env bash
# Single source of truth for "is the working tree green?".
# An agent's task is not done until this script exits 0.
#
# Runs:
#   - tsc compile
#   - node:test against compiled output
#   - ruff lint + format check on python-backend
#   - pytest on python-backend
#
# E2E (npm run verify:e2e) is intentionally NOT here; it needs a display
# and is slow. CI runs it as a separate job.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "==> tsc compile"
npm run compile

echo "==> webview pattern lint"
node scripts/lint-webview-patterns.js

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

echo "verify: OK"
