# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; the frozen Milestone 0
> record is `docs/progress/milestones/m0.md`.

**Last updated:** 2026-09-19 (session close)
**Current milestone:** M1, Local Agent + Public Harness Boundary (not started)
**Current task:** M1-T1, Install AI SDK and `eve` (not started)
**Last commit SHA:** the handoff commit that adds this file is `HEAD`; the
last content commit before it is `7c09f10` (run `git log --oneline`).

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** M0-T1 through M0-T11 all
  completed and verified. Snapshot: `docs/progress/milestones/m0.md`. Status
  detail: `docs/milestones/m0-repository-foundation.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass from a fresh clone
  (verified 2026-09-19). `pnpm check` = format:check, lint, typecheck, test,
  build, check:handoff.
- Three workspace packages build and typecheck independently:
  `@internal/config` (tsconfig bases), `@internal/testing` (`createFakeClock`),
  `@internal/core` (intentionally empty, `export {}`).
- Test taxonomy wired: `unit`, `integration`, `contract`, `replay` Vitest
  projects; only unit tests exist (42 tests across 4 files).
- Architecture boundary test (`tests/architecture/`) fails if a non-adapter
  package depends on `eve`, `ai`, `@ai-sdk/*`, `@supabase/*`, `@vercel/*`, or
  `workflow`.
- Husky hooks installed by `pnpm install`: pre-commit (secretlint + Biome on
  staged files), pre-push (typecheck + unit tests).
- `pnpm check:handoff` enforces the WORKLOG/current-state protocol.
- CI workflow exists (`.github/workflows/ci.yml`) but has never run: no remote
  is configured.

## What is partially working

- Nothing is partial. Everything present is complete for M0; everything from
  M1 onward does not exist.

## What does not exist yet

- No agent runtime, no `eve`, no AI SDK, no Jev, no trace, no Supabase, no
  workflow IR/runtime, no registry, no replay, no evals, no learner, no
  compiler, no CLI, no `apps/`. `packages/core` exports nothing.

## Known failures

- None.

## Current blockers

- None. A GitHub remote is not required for M1 but is needed before the
  "deliberate failure fails CI" criteria can be upgraded from local proof to an
  observed CI run.

## Important active decisions

- ADR-0001..0017: plan decisions and owner constraints. ADR-0018..0023:
  toolchain (pnpm/Turbo/Node 24, TypeScript 6.0.x, `@internal/source` export
  condition, Biome, Vitest projects, hooks/CI). Next free ADR number: 0024.
- TypeScript stays on 6.0.x until TypeScript 7.1 ships its API (ADR-0019).
- Framework-facing work follows `docs/development/source-of-truth-protocol.md`:
  installed docs win, no guessed APIs, Implementation references logged before
  code.

## Uncommitted / generated artifacts

- None after the handoff commit. `dist/` and `.turbo/` are build outputs and
  are git-ignored.

## Exact next task

**M1-T1, Install AI SDK and `eve`** (`docs/milestones/m1-local-agent-and-public-harness-boundary.md`).
It is framework-facing: before any code, append a `started` WORKLOG entry
with an `Implementation references` section (installed versions,
`node_modules/eve/docs/README.md`, public exports/types read). Installing
`eve`/`ai` into any package other than a declared adapter will fail the
architecture test by design; M1 must add real adapter packages
(`@internal/runtime-eve`, `@internal/runtime-ai-sdk`) rather than editing the
rule table to allow `core`. Observed on 2026-09-19 (registry error message,
not yet verified as the version to use): latest `eve` is 0.63.0.

## Exact first command for the next agent

```bash
pnpm install && pnpm check
```

(Node 24.21.0 and pnpm 12.4.2 must be on PATH; see
`docs/development/local-setup.md`.) Then read, in order: `AGENTS.md`,
this file, `docs/README.md`, `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
`docs/development/source-of-truth-protocol.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, fresh clone of `7c09f10` plus handoff files.
- `eve check`: not applicable (eve not installed).
