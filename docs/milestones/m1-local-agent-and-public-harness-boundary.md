# Milestone 1, Local Agent + Public Harness Boundary

**Status:** in progress. M1-T1 is `completed`; M1-T2 through M1-T9 are `not started`.

**Goal (from the build plan):** run one neutral `eve` agent locally through the harness API. Do
not add compilation yet.

**Blocked by:** M0.

**Parallel work:** the eve adapter and the neutral fixture can proceed in parallel once contracts
exist.

**Deliverable:** the first real reusable harness call.

## Neutral reference job

The milestone uses a **vendor triage agent** as its fixture domain.

Input:

```text
vendor name
vendor website text / fixture evidence
procurement SOP
```

Output:

```text
category
risk flags
missing information
recommendation
evidence
```

Why this fixture:

- repetitive
- structured
- has research-like behavior
- supports clear bounded judgments
- supports deterministic rules
- can later demonstrate Jev
- can later demonstrate early stopping
- is not coupled to marketing or another future domain

Use deterministic local fixture tools before adding live web research.

## Before starting

These prerequisites come from M0's output and from the dependency-boundary rules already enforced
in the repository. Read them before opening any M1 task.

- **Read `../development/source-of-truth-protocol.md` before any framework-facing M1 task.** It
  documents the mandatory Vercel source precedence from AD-011 and the commands for inspecting
  installed package docs and types. Web examples are references, not version authority.
- **Every framework-facing M1 task needs a research checkpoint before any code.** Per AD-011 and
  the source-of-truth protocol, an "Implementation references" checkpoint must be recorded in
  `../progress/WORKLOG.md` before a line of code is written, and no such task may move to
  `in_progress` without it. M1-T1 did this and its findings are in
  [`../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`](../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md);
  reading that note does not excuse M1-T2, M1-T5 and M1-T6 from inspecting the installed packages
  for their own questions.
- **Extend the boundary table only for real adapters.** Installing `eve` and `ai` brings them
  under `BOUNDARY_RULES.adapterOnlyDependencies` in
  [`../../tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts), which
  already lists `eve`, `@supabase/*`, `ai`, `@ai-sdk/*`, `@vercel/*` and `workflow`. The
  `adapterPackages` array in that same file already names `@internal/runtime-eve` and
  `@internal/runtime-ai-sdk` (alongside `@internal/decision-jev`, `@internal/storage-supabase`,
  `@internal/workflow-vercel` and `@internal/sandbox-vercel`), reserved ahead of time so no
  hurried edit is needed. M1-T1 created the first two of those packages without touching the
  array. Add a package to that array only if it is genuinely an adapter. Which *version* a package
  may pin is a separate rule, in
  [ADR-0024](../decisions/0024-framework-dependency-versioning-policy.md).
- **The architecture test fails automatically for non-adapters.**
  [`../../tests/architecture/package-boundaries.test.ts`](../../tests/architecture/package-boundaries.test.ts)
  runs the rule engine against the real workspace on every `pnpm test` and `pnpm check`. `eve` and
  `ai` are installed as of M1-T1, so any M1 package that is not itself a declared adapter and
  declares a dependency on them fails the test today; M1-T1 proved it by adding `eve` to
  `@internal/core` and watching the assertion name the adapter-only rule. Non-adapter packages,
  `@internal/core` above all, must reach those libraries only through an adapter.

## Tasks

M1-T1 is `completed`. M1-T2 through M1-T9 are `not started`.

### M1-T1, Install AI SDK and `eve`

**Status:** completed (2026-09-19).

Install current compatible versions of the AI SDK and `eve`. After installing, inspect the package
docs shipped with `eve`, record the exact installed versions, add an ADR for the versioning
policy, and avoid undocumented internal imports.

**Result.** Two adapter packages were created to hold the dependencies, because the architecture
boundary permits `eve` and `ai` only inside a declared adapter: `@internal/runtime-eve` pins
`eve@0.63.0`, `ai@7.0.107` and `zod@4.6.5`, and `@internal/runtime-ai-sdk` pins `ai@7.0.107` and
`zod@4.6.5`. `ai` is declared directly by the eve adapter rather than taken transitively, because
the installed `eve` makes it a required peer and exposes AI SDK types on its own public surface.
There was no eve-versus-ai conflict to resolve: `ai@7.0.107` satisfies eve's `^7.0.105` peer
range. No `@ai-sdk/*` provider package was installed, since the built-in AI Gateway path needs
only `ai`; choosing a provider is M1-T5's decision. Neither package contains an adapter yet, only
a one-type re-export that proves the public entrypoint resolves under typecheck, plus a unit test
asserting the installed version equals the declared pin and that no `^`/`~` range is declared.
The survey of what the installed packages actually document is
[`../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`](../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md),
and the versioning policy it grounds is
[ADR-0024](../decisions/0024-framework-dependency-versioning-policy.md). One correction to the
repository's own docs came out of it: `eve` 0.63.0 ships no `eve check` command, so `eve info` is
the equivalent diagnostic. `pnpm check` passes.

### M1-T2, Scaffold example agent

**Status:** not started.

Scaffold the example agent using the normal `eve` structure (`agent/agent.ts`,
`agent/instructions.md`, `agent/skills/`, `agent/tools/`, `agent/lib/`), and create one read-only
fixture tool for it.

### M1-T3, `defineDomain()`

**Status:** not started.

Implement the public `defineDomain()` API. Target shape from the plan:

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

### M1-T4, `createHarness()`

**Status:** not started.

Implement the public `createHarness()` API. Target shape from the plan:

```ts
const harness = createHarness({
  agentRuntime,
  storage,
});

const result = await harness.run({
  domain: vendorTriage,
  input,
});
```

### M1-T5, AI SDK runtime contract

**Status:** not started.

Implement the `AgentRuntime` contract. AI SDK concepts stay at this boundary and must not leak
past it.

### M1-T6, Eve adapter

**Status:** not started.

Implement `EveAgentRuntime`. Do not leak `eve` session details into the core contracts.

### M1-T7, Runtime context

**Status:** not started.

Create a typed `ExecutionContext` containing the run ID, job ID, domain, attempt, budget,
permissions, trace writer, abort signal and runtime metadata.

### M1-T8, Error taxonomy

**Status:** not started.

Define the error taxonomy early:

```text
ValidationError
BudgetExceededError
PermissionDeniedError
ToolExecutionError
AgentExecutionError
DecisionError
WorkflowError
StorageError
ReplayMismatchError
```

Every error must be serializable into a trace-safe representation.

### M1-T9, Domain capability registry

**Status:** not started.

Implement `CapabilityRegistry` and `CapabilityManifest`. The neutral domain must register its
input/output schemas, the full agent, the fixture read-only tool, one deterministic handler and
one policy. Registration validates duplicate IDs and incompatible version metadata, and the
serializable manifest must not contain function bodies or secrets.

## Acceptance criteria

From the build plan. None are met yet: M1-T1 installed the dependencies but built no runtime, and
every criterion below needs M1-T2 or later.

- `pnpm example:run` executes the neutral agent locally.
- Input is validated before execution.
- Output is validated before success.
- Core imports neither `eve` nor Supabase.
- The example calls the harness API rather than the `eve` runtime directly.
- A fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test.
- Cancellation/abort signal reaches the runtime.
- One intentionally invalid output fails closed.
- The example domain can serialize its capability manifest.
- Duplicate capability ID/version registration fails.
- The manifest contains module/export metadata but no executable source or secrets.
