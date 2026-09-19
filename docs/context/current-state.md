# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; the frozen Milestone 0
> record is `docs/progress/milestones/m0.md`.

**Last updated:** 2026-09-19 (M1-T2, M1-T7, M1-T8 complete)
**Current milestone:** M1, Local Agent + Public Harness Boundary (in progress)
**Current task:** M1-T3, `defineDomain()` (not started)
**Last commit SHA:** PENDING_SHA (M1-T2/T7/T8). M1-T1 is `bdb4a23`. Run
`git log --oneline` for the full history.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** Snapshot:
  `docs/progress/milestones/m0.md`.
- **M1-T1, Install AI SDK and `eve`: complete** (`bdb4a23`). Two adapter
  packages hold the framework dependencies. ADR-0024.
- **M1-T2, Scaffold example agent: complete.** `apps/example-agent` is a real
  `eve` project (`eve info` reports `Compile ready`, 0 diagnostics) with one
  read-only fixture tool. ADR-0025 lets `apps/*` author `eve` agents directly.
- **M1-T7, Runtime context: complete.** `ExecutionContext` and supporting types
  in `@internal/core`. Contract: `docs/contracts/execution-context.md`.
- **M1-T8, Error taxonomy: complete.** Nine `HarnessError` classes plus
  `serializeError` in `@internal/core`. Contract: `docs/contracts/errors.md`.
  ADR-0026.

Per-task detail: `docs/progress/WORKLOG.md` (entries dated 2026-09-19 16:53
through 17:28) and `docs/milestones/m1-local-agent-and-public-harness-boundary.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (verified 2026-09-19
  after the M1-T2/T7/T8 wave). `pnpm check` = format:check, lint, typecheck,
  test, build, check:handoff. Tests: 156 across 12 files, all in the `unit`
  project.
- Six workspace packages build and typecheck:
  - `@internal/config` (tsconfig bases), `@internal/testing` (`createFakeClock`).
  - `@internal/core`: zero dependencies. Exports `ExecutionContext`,
    `createExecutionContext`, `DomainRef`, `Budget`, `ToolGrant`,
    `RuntimeInfo`, `JsonValue`/`JsonObject`, `TraceWriter`, `TraceEvent` (M1
    placeholder), `createNoopTraceWriter`, `HarnessError` and its nine
    subclasses, `HarnessErrorCode`, `serializeError`, `isHarnessError`.
  - `@internal/runtime-eve` (`eve@0.63.0`, `ai@7.0.107`, `zod@4.6.5`) and
    `@internal/runtime-ai-sdk` (`ai@7.0.107`, `zod@4.6.5`): dependency
    boundaries with one type re-export each. No adapter code yet.
  - `@internal/example-agent` (`apps/example-agent`): `agent/agent.ts`
    (`defineAgent`, Gateway model id from `EXAMPLE_AGENT_MODEL`),
    `agent/instructions.md`, `agent/skills/triage-vendor.md`,
    `agent/tools/lookup_vendor_evidence.ts` (`defineTool`, `approval: never()`),
    `agent/tools/web_search.ts` and `web_fetch.ts` (`disableTool()`),
    `agent/lib/vendor-fixtures.ts` (three fictional vendors) and the pure
    `lookupVendorEvidence` with its test. `pnpm --filter @internal/example-agent
    info` and `eve build` run offline without a credential.
- Architecture boundary test: adapter-only rule for every `packages/*`
  package; `apps/*` may depend on `eve`, `ai`, `@ai-sdk/*` only (ADR-0025);
  `@supabase/*`, `@vercel/*`, `workflow` stay adapter-only for everyone.
  Proven to bite in all three directions during M1-T2.
- Dependency-pin tests in the three packages that declare framework deps
  (ADR-0024).
- Husky hooks: pre-commit (secretlint + Biome on staged files), pre-push
  (typecheck + unit tests).
- CI workflow exists (`.github/workflows/ci.yml`) but has never run: no remote.

## What is partially working

- Nothing is partial. Everything present is complete for its task's scope.

## What does not exist yet

- No `defineDomain()`, no `createHarness()`, no `AgentRuntime` contract, no
  `EveAgentRuntime`, no capability registry. Nothing executes the example agent.
  No Jev, trace package, Supabase, workflow IR, registry, replay, evals,
  learner, compiler, CLI.

## Known failures

- None.

## Current blockers

- None. A GitHub remote is needed before "deliberate failure fails CI" can be
  upgraded from local proof to an observed CI run.

## Important active decisions

- ADR-0001..0017 plan decisions; ADR-0018..0023 toolchain; **ADR-0024** exact
  pins and upgrade-as-a-task for framework deps; **ADR-0025** `apps/*` author
  `eve` agents directly, execution goes through the harness API; **ADR-0026**
  errors serialize to a whitelisted, stack-free shape with a stable `code`.
  Next free ADR number: **0027**.
- TypeScript stays on 6.0.x until TypeScript 7.1 ships its API (ADR-0019).
- Framework-facing work follows `docs/development/source-of-truth-protocol.md`.
  Its §10 commands resolve pnpm's isolated store correctly; use them as written.

## Findings the next agent needs

Research notes: `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`
and `docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`.

- `eve` derives tool identity from the file path; authored tools carry no
  `name`. Relative imports inside `agent/` need the `.js` extension.
- `eve` has no declarative read-only flag on tools; `approval: never()` is the
  nearest documented mechanism. Read-only-ness is enforced by keeping tool
  logic in a pure `lib/` module with its own test.
- `eve`'s default tool set for the example agent still includes `bash`,
  `read_file`, `write_file`, `todo`, `load_skill`, `ask_question`,
  `task_cancel`, `agent`. Only the two web tools are disabled. Harness
  permission semantics (`ToolGrant`, `PermissionDeniedError`) must gate these
  when M1-T6 wires execution; decide then whether to disable more by file.
- `eve/client` is the documented programmatic surface; M1-T6 must read its
  guide (`$EVE/docs/guides/client/*`) before designing `EveAgentRuntime`.
  Nothing yet establishes how to drive an agent run from TypeScript.
- AI SDK 7's agent class is `ToolLoopAgent`; `Agent` is a type. `ai`'s shipped
  `.mdx` examples contain unresolved `__MODEL__` placeholders; read shapes from
  `ai/dist/index.d.ts`.
- `ValidationError.issues` is schema-agnostic (`{ path, message }[]`). M1-T3
  picks the schema mechanism and writes the normalizer. `@internal/core` must
  stay zero-dependency, so a concrete library binding cannot live in core.
- `runId`/`jobId` are opaque strings in M1; M2-T1 picks the ID scheme.
- `ExecutionContext.signal` exists but nothing yet proves an adapter propagates
  it. That acceptance criterion is open until M1-T5/T6.
- No recording `TraceWriter` exists. The first test that needs to assert on
  emitted events should add one to `@internal/testing`, not core.

## Uncommitted / generated artifacts

- None after the handoff commit. `dist/`, `.turbo/`, and eve's `.eve/` and
  `.output/` under `apps/example-agent` are build outputs and git-ignored.

## Exact next task

**M1-T3, `defineDomain()`**
(`docs/milestones/m1-local-agent-and-public-harness-boundary.md`). Target
shape from the build plan:

```ts
export const vendorTriage = defineDomain({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  createJob,
  evals,
});
```

It requires the `Job` and `DomainDefinition` contracts from build plan
section 5 in `@internal/core`, a `Schema<T>` abstraction that keeps core free
of a schema library, and the vendor-triage input/output schemas in the example
app. Suggested order after T3: T4 `createHarness()`, T5 `AgentRuntime`
contract, T6 `EveAgentRuntime` (framework-facing, needs its own Implementation
references), T9 capability registry.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check
```

(Node 24.21.0 and pnpm 12.4.2 must be on PATH; see
`docs/development/local-setup.md`.) Then read, in order: `AGENTS.md`, this
file, `docs/README.md`, `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
`docs/contracts/execution-context.md`, `docs/contracts/errors.md`, and
`docs/decisions/0025-application-packages-may-author-eve-agents-directly.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M1-T2/T7/T8 (format:check, lint,
  typecheck, test 156/156, build including `eve build`, check:handoff).
- `eve info` (`pnpm --filter @internal/example-agent info`): `Compile ready`,
  `0 errors, 0 warnings`, 1 skill, 9 tools.
- `eve check`: not applicable. The command does not exist in `eve` 0.63.0.
