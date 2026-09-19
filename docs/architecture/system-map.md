---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/decisions/README.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md
  - docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md
implementation:
  - apps/example-agent
  - packages/core
  - packages/testing
  - packages/config
  - packages/runtime-eve
  - packages/runtime-ai-sdk
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

## Current state (Milestone 1, in progress)

Five packages and one application exist. Everything else in the repository layout is planned.

- `packages/config` (`@internal/config`) holds the shared TypeScript config bases
  (`tsconfig.base.json`, `tsconfig.package.json`). It contains no runtime code and no `src/`
  directory.
- `packages/testing` (`@internal/testing`) is the test-helpers package required by M0-T4. It
  contains exactly one real helper, `createFakeClock`, plus its test.
- `packages/core` (`@internal/core`) holds the first two harness contracts, added by M1-T7 and
  M1-T8. It is no longer the empty boundary Milestone 0 left behind.

  - The **execution context** (M1-T7): `ExecutionContext` plus `DomainRef`, `Budget`, `ToolGrant`
    and `RuntimeInfo`, with a `createExecutionContext()` factory that applies the documented
    defaults. Documented in [`../contracts/execution-context.md`](../contracts/execution-context.md).
  - The **error taxonomy** (M1-T8): the nine classes the build plan names, under one abstract
    `HarnessError` with a stable `code` discriminant, plus `serializeError()` and the whitelisted,
    stack-free `SerializedHarnessError` shape that [ADR-0026](../decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md)
    records. Documented in [`../contracts/errors.md`](../contracts/errors.md).
  - A **JSON value model** (`JsonValue`, `JsonObject`) that every serializable field is typed
    with, and a minimal `TraceEvent`/`TraceWriter` pair. `TraceWriter` is stated verbatim by
    M2-T4 and lives here only because the execution context has to hold one; **M2-T3 owns the
    full trace event schema and replaces `TraceEvent`**.

  The rest of build plan section 5 is still to come: `Job` and `DomainDefinition` in M1-T3,
  `AgentRuntime` in M1-T5, `CapabilityRegistry` in M1-T9. The package still declares no runtime
  dependency and must keep none.
- `packages/runtime-eve` (`@internal/runtime-eve`) and `packages/runtime-ai-sdk`
  (`@internal/runtime-ai-sdk`) were created by M1-T1 to hold the framework dependencies it
  installed: `eve@0.63.0`, `ai@7.0.107` and `zod@4.6.5` for the first,
  `ai@7.0.107` and `zod@4.6.5` for the second. Both are exact pins under ADR-0024, and both are
  already listed in `BOUNDARY_RULES.adapterPackages`, so they are the only packages permitted to
  declare those dependencies.

  **Neither contains an adapter yet.** Each `src/index.ts` re-exports exactly one documented
  public type from the framework it adapts (`AgentDefinition` from `eve`, `LanguageModel` from
  `ai`), which proves the public entrypoint resolves under typecheck and nothing more. The
  `AgentRuntime` contract is M1-T5 and `EveAgentRuntime` is M1-T6. Each package's unit test
  asserts that the installed version matches its own pin and that it declares no `^`/`~` range,
  which is ADR-0024's enforcement mechanism.

  What the installed packages actually document is recorded in
  [`../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`](../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md).
- `apps/example-agent` (`@internal/example-agent`) was created by M1-T2. It is the neutral
  vendor-triage fixture domain, authored as a real `eve` project: `agent/agent.ts`,
  `agent/instructions.md`, one Markdown skill under `agent/skills/`, one read-only fixture tool
  under `agent/tools/`, and the frozen fixture data plus its pure lookup under `agent/lib/`. It
  declares `eve`, `ai` and `zod` at the same exact pins the adapters use.

  It is **not** an adapter and **not** a harness package. It is a domain consumer, which is the
  distinction [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md)
  records: an `apps/*` package may author agents with `eve`, while `@supabase/*`, `@vercel/*` and
  `workflow` stay adapter-only for it too. **Nothing executes it yet.** `eve info` discovers it
  with zero diagnostics and `eve build` bundles it, but no harness call exists until
  `createHarness()` lands in M1-T4, and Milestone 1's acceptance criterion is that the example
  calls the harness API rather than the `eve` runtime directly.

  What the installed `eve` required of the scaffold is recorded in
  [`../research/vercel/2026-09-19-m1-eve-project-scaffold.md`](../research/vercel/2026-09-19-m1-eve-project-scaffold.md).

### Package status

Milestone attributions below are "the milestone that first needs the package", read off the build
plan's milestone sections.

| Package | Status |
| --- | --- |
| `packages/config` | exists (Milestone 0) |
| `packages/core` | exists (Milestone 0; contracts land from M1-T7/M1-T8 onward) |
| `packages/testing` | exists (Milestone 0) |
| `packages/runtime-ai-sdk` | exists (M1-T1, dependency boundary only; `AgentRuntime` is M1-T5) |
| `packages/runtime-eve` | exists (M1-T1, dependency boundary only; `EveAgentRuntime` is M1-T6) |
| `packages/registry` | planned (M1), capability registry, per M1-T9 |
| `apps/example-agent` | exists (M1-T2, authored eve project; no harness call until M1-T4) |
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

`eve` and the AI SDK are now installed, but no code calls either. The source files in the
workspace packages are:

- `packages/core/src/index.ts` (the named re-export barrel)
- `packages/core/src/json.ts`, `context.ts`, `trace.ts`, `errors.ts` and their four co-located
  `*.test.ts` files (the M1-T7 and M1-T8 contracts described above)
- `packages/testing/src/index.ts`
- `packages/testing/src/clock.ts`
- `packages/testing/src/clock.test.ts`
- `packages/runtime-eve/src/index.ts` and `index.test.ts`
- `packages/runtime-ai-sdk/src/index.ts` and `index.test.ts`
- `apps/example-agent/agent/agent.ts`, `agent/tools/lookup_vendor_evidence.ts`,
  `agent/tools/web_search.ts` and `agent/tools/web_fetch.ts` (the last two disable eve's live web
  defaults), `agent/lib/vendor-fixtures.ts`, `agent/lib/vendor-evidence.ts` and its test, and
  `src/dependency-pins.test.ts`

The four files in the two adapter packages contain one type re-export and one dependency-pin test
each. The example agent's files are authored `eve` definitions plus frozen fixture data: they are
compiled by `eve`, not by anything in this workspace, and none of them calls a model. There is no
agent runtime, no model call and no Supabase dependency anywhere in the workspace. `@internal/core` still declares no runtime dependency; its only devDependencies are
`@internal/config` for the tsconfig bases and `vitest` for its co-located tests. The supporting TypeScript
outside the packages is tooling only: `scripts/verify-handoff.ts` (and its test),
`tests/architecture/`, and `tests/toolchain/`.

## How the boundary is enforced today

The dependency rule is not documentation-only. It is a test that runs against the real workspace.

- [`tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts) is the rule engine.
  It defines a data table, `BOUNDARY_RULES`, and pure functions over it. The table has four
  parts:
  - `adapterOnlyDependencies`: third-party package name patterns that only a declared adapter may
    depend on. Today that is `eve`, `@supabase/*`, `ai`, `@ai-sdk/*`, `@vercel/*` and `workflow`.
    This is how "Vercel-specific behavior lives behind adapter packages" becomes mechanical.
  - `adapterPackages`: the workspace packages allowed to depend on those patterns. The list is
    populated ahead of the packages themselves (`@internal/runtime-eve`, `@internal/decision-jev`,
    `@internal/storage-supabase`, `@internal/runtime-ai-sdk`, `@internal/workflow-vercel`,
    `@internal/sandbox-vercel`), so a milestone that adds an adapter does not have to redesign the
    table under time pressure.
  - `appPackagesMayDependOn`: the subset of `adapterOnlyDependencies` that a package under
    `apps/*` may depend on anyway, today `eve`, `ai` and `@ai-sdk/*`. This is
    [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md): an
    application is a domain consumer, and a real consuming domain repository is an `eve` project,
    so it must be able to author agents. `@supabase/*`, `@vercel/*` and `workflow` are
    deliberately absent, and the allowance reaches no `packages/*` package.
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

This is live as of M1-T1: `eve` and `ai` are installed, so any library package that declares a
dependency on them without being in `adapterPackages` fails the test. It was proven by adding `eve`
to `@internal/core` and watching the test fail naming the adapter-only rule (M1-T1 WORKLOG entry),
and re-proven in M1-T2 by adding `@supabase/supabase-js` to `apps/example-agent` and watching the
same rule bite an application package that is otherwise allowed `eve`. Adapter status is a
deliberate, reviewable edit to `BOUNDARY_RULES`, not an accident. Version policy is separate and
lives in ADR-0024.

## Per-topic architecture documents

The build plan's repository layout lists further documents under `docs/architecture/`:
`runtime.md`, `workflow-ir.md`, `compiler.md`, `learning-loop.md`, `tracing.md`, `evals.md`,
`storage.md` and `security.md`. **None of them exist yet, and none should be created yet.**

Each is written by the milestone that first implements its topic, describing what the code
actually does, not preemptively as an empty placeholder. An empty or speculative architecture
document is worse than a missing one: it invites a future agent to treat a guess as authoritative.
Until then, this file plus the build plan are the architecture record.
