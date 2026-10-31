#!/usr/bin/env bash
# Kept for muscle memory and agent allowlists; scripts/verify.mjs is the verify script.
exec node "$(dirname "${BASH_SOURCE[0]}")/verify.mjs" "$@"
