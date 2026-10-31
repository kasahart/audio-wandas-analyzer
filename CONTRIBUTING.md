# Contributing

[AGENTS.md](AGENTS.md) is the guide for people and AI agents alike: setup, commands, architecture, conventions and the completion bar. The short version:

1. Set up with `npm install` and `pip install -e ".[dev]"` (Node 22, Python 3.11; see `.nvmrc` and AGENTS.md §2).
2. Work on a branch in a worktree (`bash scripts/worktree-new.sh <slug>`).
3. `npm run verify` must pass; also `npm run test:ui` for Webview runtime changes and `npm run verify:e2e` for extension-host changes.
4. User-facing GUI features need an entry in `src/shared/gui/guiTriggerabilityInventory.ts` and a regression test (AGENTS.md §6).
5. Add a line to [CHANGELOG.md](CHANGELOG.md) under **Unreleased** for user-visible changes, and fill in the pull request template.

More detail: [docs/developer-guide.md](docs/developer-guide.md) and [docs/architecture.md](docs/architecture.md).
