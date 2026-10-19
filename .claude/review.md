# Pull request review instructions

Used by `.github/workflows/claude-code-review.yml` and by "@claude review"
(`.github/workflows/claude.yml`). It lives under `.claude/` because
claude-code-action restores that directory from the base branch on pull
requests, so a PR cannot rewrite the rules it is reviewed by.

Review the pull request as if no other reviewer will look for bugs after you.
Read AGENTS.md first and judge the change against its conventions and
guardrails. Write every comment in Japanese.

## How to review

1. Read the whole diff with `gh pr diff`, then read the code each changed
   function is called from and calls into, on both hosts (Web static host and
   VS Code extension) and in the Python backend. Do not review hunks in
   isolation.
2. For every changed behaviour, try to break it. Walk the checklist below and,
   for each item, either name a concrete failing input or state, or move on.
3. When a claim depends on runtime behaviour, verify it. Node and Python
   dependencies are installed. Compile with `npm run compile` and run unit
   tests with `node --test dist/test/...`, or put a short probe script under
   `review-scratch/` (gitignored) and run it with `node` or `python`.
   Run backend tests with `python -m pytest`. Browsers are not installed, so
   Playwright specs cannot run. Say in the finding what you ran and what it
   printed.
4. Dependencies may have been installed from the default branch. If the PR
   changes dependency files, say which results could differ with the PR's
   own dependencies.
5. Drop any finding you cannot back with a concrete scenario.

## Checklist

- State and async: stale caches keyed too loosely (for example by name and
  byte length), results shown as current after inputs changed, races between
  Clear/cancel and work still in flight (folder walks, backend requests, Worker
  boot), debounces or timers firing mid-interaction, listeners, audio nodes and
  other resources never released, values read from a stale snapshot (for
  example `AudioParam.value` during a ramp).
- Numerics in the backend: padded or partial STFT frames treated as data,
  off-by-one frame or sample origins, overlap settings other than the one the
  tests use, units or sampling rates combined as if comparable, frequency
  ranges rescaled with the wrong Nyquist. Compare against SciPy or wandas
  where an equivalent exists.
- Playback: fades at track and loop boundaries, pause or stop near the end,
  loops outside the playing track, slow animation frames skipping a window.
- UI layout: small or resized viewports, containers that can reach 0 px,
  popovers off-screen, Esc or other shortcuts also triggering another handler,
  focus lost when an element hides, feedback only in `aria-hidden` regions.
- Parallel entry points: a change made for one host, one protocol command or
  one panel but not for its counterparts; protocol schema and generated types
  out of step.
- Integrity and security: verified bytes discarded and fetched again
  unverified, cached copies checked instead of what actually runs, paths not
  validated.
- Edge inputs: empty, very short, very long, different sample rates,
  unsupported formats, invalid user input reaching a crash.
- Docs, comments and UI strings that state something false about the code.
- Tests that pass without exercising the new behaviour.

## Severity

- **blocking**: any defect you can describe with a concrete input or state
  that gives wrong output, a crash, a hang, data loss, a security gap, or a
  visibly broken UI, even if the scenario is uncommon. If you reproduced it,
  it is blocking. Do not downgrade a reproducible defect because it is rare or
  the fix is small.
- **optional**: style, naming, refactoring, cosmetic glitches that fix
  themselves on the next interaction, and concerns without a concrete
  scenario.

For each finding give the file and line, the severity, the failing scenario,
what you ran to confirm it, and the fix.

## Output

Post findings tied to lines with
`mcp__github_inline_comment__create_inline_comment` (with `confirmed: true`)
and one overall summary with `gh pr comment`. The summary lists blocking
findings first. If nothing is blocking, it says which checklist areas you
verified and how. Only post GitHub comments; do not return the review as a
message.
