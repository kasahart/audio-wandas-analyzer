#!/usr/bin/env python3
"""Block repository edits from the primary checkout."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def git_path(*args: str) -> Path | None:
    try:
        raw = subprocess.check_output(
            ["git", "rev-parse", *args],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None

    return Path(raw).resolve()


def main() -> int:
    git_dir = git_path("--git-dir")
    git_common = git_path("--git-common-dir")
    if not git_dir or not git_common or git_dir != git_common:
        return 0

    message = (
        "Repository edits are blocked in the primary checkout. "
        "Run `bash scripts/worktree-new.sh <feature-slug>` and work from "
        "`.worktrees/<feature-slug>/`."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": message,
                }
            }
        )
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
