# Runbooks

This directory holds step-by-step operational procedures for recurring situations: the exact
commands to run, in order, to accomplish something a human or coding agent needs to do repeatedly.
This is distinct from `docs/architecture/`, which explains how the system works rather than what
to type to operate it.

No runbooks beyond the standard development workflow are needed in Milestone 0. The two below
cover everything a contributor needs to verify the repository and recover from a failed git hook.

## Runbook: verify the repository

Run this to confirm the repository is healthy, from a clean checkout or after pulling changes:

```bash
pnpm install
pnpm check
```

Node 24.21.0 and pnpm 12.4.2 must be on PATH; see
[`../development/local-setup.md`](../development/local-setup.md).

`pnpm check` runs, in order: format check, lint, typecheck, test, build, and handoff-documentation
verification (`check:handoff`). All six must pass. If any stage fails, fix the underlying issue
before continuing; do not skip a stage or treat a partial pass as good enough.

## Runbook: recover from a broken pre-commit hook

The pre-commit hook (`.husky/pre-commit`) runs a secret scan then Biome on staged files. The
pre-push hook (`.husky/pre-push`) runs typecheck and unit tests. When a hook fails, the terminal
output from `git commit` or `git push` is often truncated or hard to read. Run the hook's commands
manually to see the full output and fix the underlying issue:

```bash
sh .husky/pre-commit
sh .husky/pre-push
```

Never bypass a hook with `git commit --no-verify` or `git push --no-verify` except in a genuine
emergency. If you do, log the justification in `docs/progress/WORKLOG.md` in the same session.

## Runbooks later milestones must add

- Local Supabase lifecycle (start/stop/reset/types), Milestone 2.
- Run inspector (`pnpm harness run show <run-id>`), Milestone 2.
- Promotion runbook (how a human reviews and approves a candidate workflow for production),
  Milestone 9.
