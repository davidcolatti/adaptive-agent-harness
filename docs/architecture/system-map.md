---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/decisions/README.md
implementation:
  - packages/core
  - packages/testing
  - packages/config
  - tests/architecture/boundaries.ts
---

# System map

This document is the single orientation page for the harness architecture. It reproduces the
target system, the runtime responsibility matrix and the package dependency rule from
`../milestones/build-plan.md` (sections 2, 3 and 4), then states honestly how much of that target
actually exists today.

The build plan is authoritative for the target. This document is authoritative for the *current*
state. Where the two disagree, the build plan describes the future and this file describes the
present; where this file disagrees with the code, the code wins and this file must be corrected in
the same task that found the discrepancy.

## 1. Target system

Reproduced verbatim from the build plan, section 2 ("Target System").

```text
                         Domain Package
              instructions / SOP / skills / tools
                            schemas / evals
                                 |
                                 v
                           Job Contract
                                 |
                                 v
                         Execution Router
                         /              \
                  workflow match       no match
                       |                  |
                       v                  v
                 Compiled Runtime     Full Agent
                       |                  |
        +--------------+-------------+    |
        |              |             |    |
       Jev            Code         Agent  |
        |              |             |    |
        +--------------+-------------+----+
                       |
                       v
                 Normalized Trace
                       |
               +-------+--------+
               |                |
               v                v
             Result          Learning
                                |
                                v
                            Compiler
                                |
                                v
                        Candidate Workflow
                                |
                                v
                    Validate / Replay / Evals
                                |
                                v
                         Promotion Decision
                                |
                                v
                        Workflow Registry
```

None of this pipeline is implemented yet. See "Current state (Milestone 0)" below.

## 2. Runtime responsibility matrix

Reproduced from the build plan, section 3. Every responsibility/owner pairing is preserved; only
the table formatting is changed from the plan's fixed-width layout to Markdown.

| Responsibility | Owner |
| --- | --- |
| General agent behavior | `eve` |
| Agent/model interface | AI SDK 7 |
| Model access | AI Gateway |
| Bounded probabilistic decisions | Jev |
| Workflow durability later | Vercel Workflow |
| Isolated code execution later | Vercel Sandbox |
| Domain instructions | Consuming agent |
| Domain tools | Consuming agent |
| Domain skills | Consuming agent |
| Job contract | Harness |
| Trace schema | Harness |
| Workflow IR / DSL | Harness |
| Router | Harness |
| Registry | Harness |
| Learning | Harness |
| Compiler | Harness |
| Replay | Harness |
| Promotion policy | Harness |
| Local persistence | Supabase |
| GitHub PR creation | Optional consuming-repo integration |

The two columns matter for boundaries: anything owned by the *harness* is a contract this
repository defines and may change only through an ADR. Anything owned by `eve`, the AI SDK, AI
Gateway, Jev, Vercel Workflow, Vercel Sandbox or Supabase is a third-party surface that must be
reached through an adapter package, never imported from `core`.

## 3. Package dependency rule

Reproduced verbatim from the build plan, section 4 ("Dependency rule").

```text
apps/* / consuming domains
           |
           v
          core
     /      |       \
 runtime   trace   workflow
   |        |       /   \
  eve    storage registry decision
                     \      /
                      evals
                        |
                      replay
                        |
                     learner
                        |
                     compiler
```

Rules, as the plan states them:

- `core` cannot import domain code.
- `core` cannot import `eve`.
- `core` cannot import Supabase.
- Vercel-specific behavior lives behind adapter packages.
- Compiler output targets the workflow IR, not arbitrary runtime internals.
- No domain package may mutate harness registry tables directly.

## Current state (Milestone 0)

Only three packages exist. Everything else in the repository layout is planned.

- `packages/config` (`@internal/config`) holds the shared TypeScript config bases
  (`tsconfig.base.json`, `tsconfig.package.json`). It contains no runtime code and no `src/`
  directory.
- `packages/testing` (`@internal/testing`) is the test-helpers package required by M0-T4. It
  contains exactly one real helper, `createFakeClock`, plus its test.
- `packages/core` (`@internal/core`) is an intentionally empty boundary: a comment explaining why,
  and `export {}`. The contracts in build plan section 5 land in Milestone 1. The package exists
  now only to prove that the build, typecheck and packaging pipeline works end to end.

### Package status

Milestone attributions below are "the milestone that first needs the package", read off the build
plan's milestone sections.

| Package | Status |
| --- | --- |
| `packages/config` | exists (Milestone 0) |
| `packages/core` | exists (Milestone 0, empty boundary) |
| `packages/testing` | exists (Milestone 0) |
| `packages/runtime-ai-sdk` | planned (M1) |
| `packages/runtime-eve` | planned (M1) |
| `packages/registry` | planned (M1), capability registry, per M1-T9 |
| `apps/example-agent` | planned (M1) |
| `packages/trace` | planned (M2) |
| `packages/storage-supabase` | planned (M2) |
| `packages/observability` | planned (M2) |
| `packages/decision-jev` | planned (M3) |
| `packages/workflow` | planned (M4) |
| `packages/replay` | planned (M6) |
| `packages/evals` | planned (M6) |
| `packages/learner` | planned (M7) |
| `packages/compiler` | planned (M8) |
| `packages/codegen` | planned (M8) |
| `apps/playground` | planned (unscheduled) |

`apps/playground` appears in the build plan's repository layout but no milestone section assigns
it, so it has no scheduled milestone.

### No AI runtime code exists yet

This is a Milestone 0 acceptance criterion, and it holds. The only source files in the workspace
packages are:

- `packages/core/src/index.ts` (the empty boundary described above)
- `packages/testing/src/index.ts`
- `packages/testing/src/clock.ts`
- `packages/testing/src/clock.test.ts`

There is no agent runtime, no model call, no `eve` dependency, no AI SDK dependency and no
Supabase dependency anywhere in the workspace. The supporting TypeScript outside the packages is
tooling only: `scripts/verify-handoff.ts` (and its test), `tests/architecture/`, and
`tests/toolchain/`.

## How the boundary is enforced today

The dependency rule is not documentation-only. It is a test that runs against the real workspace.

- [`tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts) is the rule engine.
  It defines a data table, `BOUNDARY_RULES`, and pure functions over it. The table has three
  parts:
  - `adapterOnlyDependencies`: third-party package name patterns that only a declared adapter may
    depend on. Today that is `eve`, `@supabase/*`, `ai`, `@ai-sdk/*`, `@vercel/*` and `workflow`.
    This is how "Vercel-specific behavior lives behind adapter packages" becomes mechanical.
  - `adapterPackages`: the workspace packages allowed to depend on those patterns. The list is
    populated ahead of the packages themselves (`@internal/runtime-eve`, `@internal/decision-jev`,
    `@internal/storage-supabase`, `@internal/runtime-ai-sdk`, `@internal/workflow-vercel`,
    `@internal/sandbox-vercel`), so a milestone that adds an adapter does not have to redesign the
    table under time pressure.
  - `forbiddenByPackage`: narrower per-package bans. `@internal/core` is listed explicitly,
    because it is the boundary the plan names by hand.

  The functions are `matchesPattern` (exact name, or `@scope/*`), `findBoundaryViolations`
  (takes the workspace as data and returns every violation) and `formatViolations` (renders them
  into the assertion message). Because the engine is pure and takes packages as data, it can be
  unit-tested with fabricated packages instead of by breaking the real repository.

- [`tests/architecture/package-boundaries.test.ts`](../../tests/architecture/package-boundaries.test.ts)
  reads the real `pnpm-workspace.yaml` and every workspace `package.json`, then runs the engine
  against them. It executes on every `pnpm test` and therefore on every `pnpm check`, on the
  pre-push hook, and in CI.

The practical consequence for Milestone 1: the moment `eve` or `ai` is installed, any package that
declares a dependency on them without being in `adapterPackages` fails the test. Adapter status is
a deliberate, reviewable edit to `BOUNDARY_RULES`, not an accident.

## Per-topic architecture documents

The build plan's repository layout lists further documents under `docs/architecture/`:
`runtime.md`, `workflow-ir.md`, `compiler.md`, `learning-loop.md`, `tracing.md`, `evals.md`,
`storage.md` and `security.md`. **None of them exist yet, and none should be created yet.**

Each is written by the milestone that first implements its topic, describing what the code
actually does, not preemptively as an empty placeholder. An empty or speculative architecture
document is worse than a missing one: it invites a future agent to treat a guess as authoritative.
Until then, this file plus the build plan are the architecture record.
