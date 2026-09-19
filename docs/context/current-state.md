# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; the frozen Milestone 0
> record is `docs/progress/milestones/m0.md`.

**Last updated:** 2026-09-19 (M1-T1 complete)
**Current milestone:** M1, Local Agent + Public Harness Boundary (in progress)
**Current task:** M1-T2, Scaffold example agent (not started)
**Last commit SHA:** not committed (orchestrator commits after review). The last
commit on disk is the M0 handoff commit; run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** M0-T1 through M0-T11 all
  completed and verified. Snapshot: `docs/progress/milestones/m0.md`.
- **M1-T1, Install AI SDK and `eve`: complete.** Two adapter packages now hold
  the framework dependencies. See `docs/progress/WORKLOG.md` (the 17:04 result
  entry) and `docs/milestones/m1-local-agent-and-public-harness-boundary.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (verified 2026-09-19
  after M1-T1). `pnpm check` = format:check, lint, typecheck, test, build,
  check:handoff.
- Five workspace packages build and typecheck independently:
  - `@internal/config` (tsconfig bases), `@internal/testing` (`createFakeClock`),
    `@internal/core` (intentionally empty, `export {}`, still zero dependencies).
  - `@internal/runtime-eve` pins `eve@0.63.0`, `ai@7.0.107`, `zod@4.6.5`.
  - `@internal/runtime-ai-sdk` pins `ai@7.0.107`, `zod@4.6.5`.
- Both adapter packages are dependency boundaries only. Each `src/index.ts`
  re-exports exactly one documented public type (`AgentDefinition` from `eve`,
  `LanguageModel` from `ai`) so that typecheck fails if the public entrypoint
  stops resolving. Neither contains an adapter.
- Each adapter package has a unit test asserting its installed versions match
  its own pins and that it declares no `^`/`~` range. That is ADR-0024's
  enforcement mechanism.
- Test taxonomy wired: `unit`, `integration`, `contract`, `replay` Vitest
  projects; only unit tests exist (51 tests across 6 files).
- Architecture boundary test fails if a non-adapter package depends on `eve`,
  `ai`, `@ai-sdk/*`, `@supabase/*`, `@vercel/*` or `workflow`. Now that `eve`
  and `ai` are really installed this is live, and it was proven by adding `eve`
  to `@internal/core` and watching it fail.
- Husky hooks installed by `pnpm install`: pre-commit (secretlint + Biome on
  staged files), pre-push (typecheck + unit tests).
- The `eve` CLI runs (`pnpm --filter @internal/runtime-eve exec eve info`
  reports v0.63.0) but has no project to inspect yet.
- CI workflow exists (`.github/workflows/ci.yml`) but has never run: no remote
  is configured.

## What is partially working

- Nothing is partial. The two adapter packages are complete for M1-T1's scope,
  which was install plus research plus policy, not implementation.

## What does not exist yet

- No agent runtime, no Jev, no trace, no Supabase, no workflow IR/runtime, no
  registry, no replay, no evals, no learner, no compiler, no CLI, no `apps/`.
  `packages/core` exports nothing. `eve` and `ai` are installed but nothing
  calls them.

## Known failures

- None.

## Current blockers

- None. A GitHub remote is not required for M1 but is needed before the
  "deliberate failure fails CI" criteria can be upgraded from local proof to an
  observed CI run.

## Important active decisions

- ADR-0001..0017: plan decisions and owner constraints. ADR-0018..0023:
  toolchain. **ADR-0024: framework dependency versioning policy** (exact pins,
  required peers declared explicitly, optional peers not installed, upgrades as
  their own re-verified task, eve-compatible `ai` wins for the eve adapter).
  Next free ADR number: **0025**.
- TypeScript stays on 6.0.x until TypeScript 7.1 ships its API (ADR-0019).
- Framework-facing work follows `docs/development/source-of-truth-protocol.md`:
  installed docs win, no guessed APIs, Implementation references logged before
  code. Its §10 inspection commands were corrected in M1-T1 and now resolve
  pnpm's isolated store properly; use them as written.

## Findings from M1-T1 that the next agent needs

Full detail: `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`.

- `eve` 0.63.0 ships **no `eve check` command**. `eve info` is the equivalent
  diagnostic, and it requires an authored `agent/` directory.
- `eve` ships 110 doc files under its own `docs/` directory. That is the primary
  source for any `eve` task, ahead of the web.
- `ai@7.0.107` satisfies eve's required peer `ai: "^7.0.105"`, so there is no
  version conflict to manage today.
- The AI SDK's agent class is `ToolLoopAgent`. `Agent` is a *type*;
  `Experimental_Agent` is an alias. Do not use the experimental name (M1-T5).
- `eve/internal/*` and `ai/internal` are exported but internal. Never import
  them.
- The AI SDK's shipped `.mdx` docs contain unresolved `__MODEL__` placeholders
  in 82 files. Read shapes from `ai/dist/index.d.ts`, not from the examples.

## Uncommitted / generated artifacts

- **Everything from M1-T1 is uncommitted**, pending orchestrator review: the two
  new packages, ADR-0024, the research note, the doc updates, and the
  `pnpm-lock.yaml` / `pnpm-workspace.yaml` changes the install produced.
- `pnpm install` appended `@ai-sdk/gateway@4.0.87`,
  `@ai-sdk/provider-utils@5.0.45`, `ai@7.0.107` and `eve@0.63.0` to
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. That is pnpm's own
  supply-chain release-age bookkeeping, not a hand edit.
- `dist/` and `.turbo/` are build outputs and are git-ignored.

## Exact next task

**M1-T2, Scaffold example agent**
(`docs/milestones/m1-local-agent-and-public-harness-boundary.md`). Scaffold the
example agent with the normal `eve` structure (`agent/agent.ts`,
`agent/instructions.md`, `agent/skills/`, `agent/tools/`, `agent/lib/`) plus one
read-only fixture tool, for the vendor-triage fixture domain.

It is framework-facing, so before any code: append a `started` WORKLOG entry
with an `Implementation references` section, and read the installed eve docs
for this task, at minimum `docs/concepts/project-structure.mdx`,
`docs/reference/agent-files.md` and `docs/tools/overview.mdx`. The M1-T1
research note is a starting point, not a substitute for reading them.

Note that the example agent will live under `apps/`, which
`pnpm-workspace.yaml` does not yet include; its `packages:` globs list only
`packages/*`.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check
```

(Node 24.21.0 and pnpm 12.4.2 must be on PATH; see
`docs/development/local-setup.md`.) Then read, in order: `AGENTS.md`, this file,
`docs/README.md`, `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
`docs/development/source-of-truth-protocol.md`, and
`docs/decisions/0024-framework-dependency-versioning-policy.md`.

To read the installed eve docs, resolve the real path first (pnpm isolates
packages, so `node_modules/eve` is not a directory):

```bash
EVE=$(dirname "$(node -e "console.log(require.resolve('eve/package.json', { paths: ['packages/runtime-eve'] }))")")
cat "$EVE/docs/README.md"
```

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M1-T1 (format:check, lint, typecheck,
  test 51/51, build, check:handoff).
- `eve check`: not applicable. The command does not exist in `eve` 0.63.0.
- `eve info`: not yet runnable. It needs the authored `agent/` directory that
  M1-T2 creates.
