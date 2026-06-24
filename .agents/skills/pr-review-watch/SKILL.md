---
name: pr-review-watch
description: Use after opening or updating a pull request when the user asks Codex to watch for GitHub review comments, CI results, or requested changes for a bounded time window, periodically check the PR, address any actionable review feedback, reply in review threads, resolve handled threads, and stop after the requested no-new-review interval.
---

# pr-review-watch

Use this skill to run a bounded post-PR monitoring loop. It coordinates review checks, CI checks, review-feedback handling, thread replies, and stop conditions.

## Inputs

Before starting the loop, identify:

- PR repository and number
- PR head SHA
- polling interval, defaulting to 10 minutes if the user gave none
- quiet window, defaulting to 30 minutes after the last new review/comment if the user gave none
- required local validation command, usually `npm run verify` in this repo

If the PR is not known, resolve it from the current branch or ask for the PR.

## Initial Check

1. Fetch PR metadata and head SHA.
2. Fetch existing reviews, review threads, PR comments, and CI runs for the head SHA.
3. Record the latest known review/comment timestamps and unresolved thread IDs.
4. If CI is already failing, route to the CI debugging workflow before waiting.
5. If unresolved actionable review threads already exist, handle them before starting the quiet-window clock.

Prefer the GitHub app tools for PR metadata, comments, reviews, thread resolution, and workflow status. Use `gh` only when connector coverage is insufficient.

## Watch Loop

At each polling interval:

1. Re-fetch reviews, review threads, PR comments, and head-SHA CI runs.
2. Treat a new non-self review comment, unresolved thread, or requested-changes review as activity.
3. Treat CI failure as activity requiring investigation.
4. If no activity appears, continue waiting until the quiet window expires.
5. If the PR head SHA changes externally, reset the baseline to the new head and inspect the new diff before acting.

Do not spin continuously. Use real waits between checks unless the user asks for a different cadence.

## Handling Review Feedback

When review feedback appears:

1. Read each actionable thread completely.
2. Verify the feedback against the current code before changing anything.
3. If the feedback is valid, implement the smallest targeted fix.
4. If the feedback is not valid, reply with concise technical reasoning and leave the thread unresolved unless the reviewer accepts or the user tells you to resolve it.
5. Run focused tests first when available, then the repo completion bar.
6. Commit and push the fix.
7. Reply in each handled review thread with what changed and the validation run.
8. Resolve only the threads that were actually handled.
9. Reset the quiet-window timer after pushing/replying.

Use the `github:gh-address-comments` skill if the task becomes primarily about understanding unresolved inline review threads. Use the `github:gh-fix-ci` skill if the task becomes primarily about failing GitHub Actions checks.

## Required Verification

Before replying that a review item is fixed:

- run the most focused regression command that covers the change
- run this repo's completion bar: `npm run verify`
- check the updated PR head CI after pushing when time allows

If a command cannot be run, say that explicitly in the thread reply and final summary.

## Thread Reply Style

Reply in the inline review thread, not as a top-level PR comment.

Good reply shape:

```text
Fixed in <sha>. <Specific change>. Verified with <command>.
```

Avoid vague acknowledgements. Do not resolve a thread before the fix is pushed and verified.

## Stop Conditions

Stop the watch loop when one of these is true:

- the requested quiet window passes with no new review activity
- the PR is merged or closed
- the user asks to stop
- a blocker requires user input or external credentials

Final summary must include:

- PR link
- issue link if relevant
- commits pushed
- review threads handled and resolved
- local validation result
- CI result for the latest head if available
- whether the quiet-window condition was met
