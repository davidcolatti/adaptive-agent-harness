# Milestone 1, Local Agent + Public Harness Boundary

**Status:** in progress. M1-T1, M1-T2, M1-T3, M1-T5, M1-T7 and M1-T8 are `completed`; M1-T4,
M1-T6 and M1-T9 are `not started`.

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
- **Application packages are the one exception, and it is narrow.** M1-T2 added
  `BOUNDARY_RULES.appPackagesMayDependOn`, an allowlist letting a package under `apps/*` depend on
  `eve`, `ai` and `@ai-sdk/*` so it can author an agent at all, per
  [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md).
  `@supabase/*`, `@vercel/*` and `workflow` stay adapter-only for applications too, and the
  allowance reaches no `packages/*` package. Widening it is itself an architecture change.

## Tasks

M1-T1, M1-T2, M1-T3, M1-T5, M1-T7 and M1-T8 are `completed`. M1-T4, M1-T6 and M1-T9 are
`not started`.

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

**Status:** completed (2026-09-19).

Scaffold the example agent using the normal `eve` structure (`agent/agent.ts`,
`agent/instructions.md`, `agent/skills/`, `agent/tools/`, `agent/lib/`), and create one read-only
fixture tool for it.

**Result.** `apps/example-agent` (`@internal/example-agent`) is a real `eve` project, and the
structure the build plan assumed turned out to be exactly what the installed `eve` 0.63.0
documents, so there was no layout deviation: `agent/agent.ts` (`defineAgent` with an AI Gateway
model id), `agent/instructions.md`, one flat Markdown skill `agent/skills/triage-vendor.md`,
the read-only fixture tool `agent/tools/lookup_vendor_evidence.ts`, and `agent/lib/` holding the
frozen fixture data for three fictional vendors plus the pure lookup the tool calls. `eve info`
reports `Compile ready`, `Diagnostics 0 errors, 0 warnings`, the skill, and the tool; `eve build`
bundles the app offline with no model credential. The task made no model call, and neither does
any test.

Three things the installed package settled that the task had to decide rather than assume, all
recorded in [`../research/vercel/2026-09-19-m1-eve-project-scaffold.md`](../research/vercel/2026-09-19-m1-eve-project-scaffold.md):

- **`eve` has no read-only or side-effect flag on a tool definition.** The complete authored tool
  shape in `eve/dist/src/tools/definition.d.ts` offers `approval` and nothing else in that
  direction. "Read-only" is therefore harness-owned here: the tool declares `approval: never()`,
  documents what it does not touch, and keeps its implementation in a pure `agent/lib/` module
  whose unit test is what actually holds the guarantee. A machine-readable version of this
  property is work for M1-T9's `CapabilityManifest`.
- **eve's optional default tools include `web_search` and `web_fetch`**, which would have given
  this fixture domain live web research by default, against the milestone's own instruction to use
  deterministic local fixture tools first. Both are disabled with `disableTool()` at their own
  slots, which is the documented per-tool mechanism; `defaultTools: false` was rejected because it
  would also remove `load_skill` and break the skill.
- **Relative imports need the `.js` extension** to satisfy this repository's `module: nodenext`
  baseline, and eve's compiler resolves them to the TypeScript source, so no
  `moduleResolution: bundler` override was needed.

The task also forced one architecture change, because the boundary rule applied the adapter-only
ban to `apps/*` as well and an `eve` project must import `eve`:
[ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md) records that
application packages are domain consumers and may author agents with `eve`, `ai` and `@ai-sdk/*`,
while `@supabase/*`, `@vercel/*` and `workflow` stay adapter-only for them too. It is implemented
as a new `appPackagesMayDependOn` allowlist in `BOUNDARY_RULES`, not as a special case in the rule
engine, and the engine's unit tests cover both directions.

**Not done here, by design.** Nothing executes the agent. There is no `defineDomain()`
registration (M1-T3), no `createHarness()` call (M1-T4) and therefore no `pnpm example:run`. How
to drive `eve` programmatically is still unestablished and remains M1-T6's question. `pnpm check`
passes.

### M1-T3, `defineDomain()`

**Status:** completed (2026-09-19).

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

**Result.** `@internal/core` now has `Job`, `DomainDefinition`, `defineDomain()` and the schema
boundary the build plan names but never defines, and `apps/example-agent/src/domain/` is the
worked example: `zod` schemas, an invented procurement SOP, and the `defineDomain()` call above,
character for character. The example agent therefore has both halves a consuming domain
repository has, and neither crosses: nothing under `agent/` imports the harness, nothing under
`src/domain/` imports `eve`, and `eve info` still reports `Compile ready`, 0 diagnostics, 1 skill
and 9 tools.

The one question the build plan left open was what `Schema<T>` is.
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md) answers it:
**Standard Schema v1, declared structurally in core.** `packages/core/src/schema.ts` holds a
harness-owned copy of the specification's interface, so `@internal/core` keeps zero dependencies
while a domain writes plain `zod` and it just fits, with no adapter and no registration. The
installed `zod@4.6.5` declares `"~standard": $ZodStandardSchema<this>` on every schema type
(`zod/v4/core/schemas.d.ts`), and the copy it ships of the specification
(`zod/v4/core/standard-schema.d.ts`) is identical to the one published at
<https://standardschema.dev>. `validateWith()` is the single point where a schema failure becomes
a `ValidationError`, normalizing both path forms the specification allows; a `symbol` segment is
rendered with `String()` rather than dropped, because dropping a middle segment would point the
path at a different field.

Three project decisions beyond the ADR, recorded in the WORKLOG rather than as separate ADRs:

- **A domain cannot state its own `domain` reference.** Its `createJob` returns
  `CreateJobInput<TInput>`, a `Job` minus `id` and `domain`, and `defineDomain()` stamps both.
  Making the disagreement unstatable is stronger than validating it away.
- **`createJob` does not validate its input.** Validation before execution belongs to
  `createHarness()` (M1-T4), so there is one choke point rather than two. A unit test asserts it:
  `createJob` succeeds even when the domain's `inputSchema` rejects everything.
- **`DomainEval` is the smallest shape a fixture case needs** (`id`, `description`, `input`, and
  an optional `expect` that throws to fail). M6 owns evals, and nothing runs these cases yet.

Job ids come from `crypto.randomUUID()`; **M2-T1 replaces the scheme** and nothing may parse the
current format. Contracts:
[`../contracts/domain-definition.md`](../contracts/domain-definition.md) and
[`../contracts/job.md`](../contracts/job.md). `pnpm check` passes.

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

**Status:** completed (2026-09-19).

Implement the `AgentRuntime` contract. AI SDK concepts stay at this boundary and must not leak
past it.

**Result.** `packages/core/src/agent-runtime.ts` declares `AgentRuntime.run(job, context)`
exactly as build plan section 5 states it, plus the `AgentExecution<TOutput>` result the plan
names but does not define. It is a discriminated union on `status`, so "completed with no output"
is not expressible: `completed` carries `output`, `failed` carries a `SerializedHarnessError`, and
`aborted` carries neither. Every variant carries `usage` (the four dimensions `Budget` limits,
with `costUsd` optional because a faked runtime genuinely has none), `runtime` and optional
`metadata`. No type guard is exported, because `execution.status === "completed"` already narrows.

Nothing from `eve` or the AI SDK appears in the type: no messages, no steps, no sessions, no
tool-call transcript. Those reach the outside world as trace events (M2) or through `metadata`,
which is the boundary ADR-0003 draws. Two obligations the signature cannot express are documented
instead: an implementation must propagate `context.signal` and resolve `aborted` rather than
hanging, and must not throw for an agent failure. A failure is returned rather than thrown because
a failed run is a result with usage attached.

`createFakeAgentRuntime()` in `@internal/testing` is the first implementation and the one that
meets the acceptance criterion "a fake `AgentRuntime` can replace `EveAgentRuntime` in a unit
test". It takes a fixed `result` or a `handler`, records every call as `{ job, context }`, and
honours cancellation the way the contract requires: an already-aborted signal resolves `aborted`
without consulting the handler at all, and a signal firing during the configurable `delayMs` does
the same, with the call still recorded either way. That is the first proof in the repository that
**cancellation reaches a runtime**; proving it reaches `eve` is M1-T6's. `@internal/testing` now
depends on `@internal/core`, which is library-to-library and untouched by the boundary rule.

The re-validation of a claimed output is deliberately **not** here: a runtime asserts its output
type, it does not prove it, so `createHarness()` (M1-T4) re-validates against the domain's
`outputSchema`. Contract: [`../contracts/agent-runtime.md`](../contracts/agent-runtime.md).
`pnpm check` passes.

### M1-T6, Eve adapter

**Status:** not started.

Implement `EveAgentRuntime`. Do not leak `eve` session details into the core contracts.

### M1-T7, Runtime context

**Status:** completed (2026-09-19).

Create a typed `ExecutionContext` containing the run ID, job ID, domain, attempt, budget,
permissions, trace writer, abort signal and runtime metadata.

**Result.** `packages/core` now exports `ExecutionContext` with all nine fields, every one
readonly, plus the supporting types the build plan names but does not define: `DomainRef`
(`{ id, version }`, the shape section 5 uses for both `Job.domain` and `CapabilityRef`), `Budget`
(exactly `Job.budget`), `ToolGrant`/`ToolGrantMode`, `RuntimeInfo`, and a recursive `JsonValue`/
`JsonObject` model so `Job.metadata`-style fields have a type with no `any` in it. `ToolGrant`
(`{ toolId, mode: "read" | "write", scope? }`) is a harness-owned M1 shape, recorded as a project
decision in the WORKLOG rather than an ADR, and documented as extensible by M2 and M5.
`createExecutionContext()` applies the defaults in one place, all of them the conservative
reading: no budget is unlimited rather than zero, no permissions is the empty list because
permission is explicit, and no signal is one that never aborts rather than one already aborted.
It validates only that `attempt` is an integer of at least 1, because an off-by-one there would
mislabel every retry in the trace. `TraceWriter` is declared verbatim as M2-T4 states it, because
the context has to hold one; `TraceEvent` is a deliberately minimal five-field placeholder that
**M2-T3 replaces**, with `createNoopTraceWriter()` as the default. Contract:
[`../contracts/execution-context.md`](../contracts/execution-context.md). `pnpm check` passes.

### M1-T8, Error taxonomy

**Status:** completed (2026-09-19).

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

**Result.** All nine classes exist in `packages/core/src/errors.ts` under one abstract
`HarnessError extends Error`, each with a stable `SCREAMING_SNAKE_CASE` `code` discriminant, the
class name in `name`, standard `ErrorOptions` `cause` support, and an optional `details: JsonObject`
the thrower controls. Classes carry only the fields their domain needs: `ValidationError.issues`,
`BudgetExceededError`'s `dimension` (typed `keyof Budget`, so it cannot drift from the budget
contract), `limit` and `actual`, `PermissionDeniedError`'s `toolId`/`requested`,
`ToolExecutionError.toolId`, and `ReplayMismatchError`'s `nodeId` plus the two fingerprints as
opaque strings. Each of those merges its own fields into `details` so a serialized error does not
lose them.

"Trace-safe" was undefined by the build plan, so it was defined and recorded in
[ADR-0026](../decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md):
`serializeError(error: unknown)` is a **whitelist** of `name`, `code`, `message`, `details` and a
`cause` chain bounded at depth 5 with an explicit truncation marker; it never enumerates an
error's own properties, and it omits `stack` unless asked. It is total, accepting `unknown`
because `catch` binds `unknown` here, and it handles a `HarnessError`, any other `Error`, a thrown
string or object, and a value that cannot even be stringified. `HarnessError.prototype.toJSON()`
returns the same value, so `JSON.stringify(error)` is safe by default rather than by convention,
and `SerializedHarnessError` is assignable to `JsonObject` so it embeds directly in a trace
payload. Redaction of what a caller deliberately published stays M2-T9's job. Contract:
[`../contracts/errors.md`](../contracts/errors.md). `pnpm check` passes.

### M1-T9, Domain capability registry

**Status:** not started.

Implement `CapabilityRegistry` and `CapabilityManifest`. The neutral domain must register its
input/output schemas, the full agent, the fixture read-only tool, one deterministic handler and
one policy. Registration validates duplicate IDs and incompatible version metadata, and the
serializable manifest must not contain function bodies or secrets.

## Acceptance criteria

From the build plan. Two are met as of M1-T3/M1-T5, and one more is met at the schema level;
every other needs M1-T4, M1-T6 or M1-T9.

- `pnpm example:run` executes the neutral agent locally. **Not met** (M1-T4).
- Input is validated before execution. **Not met** (M1-T4 owns the choke point); the schema and
  its `ValidationError` exist and are tested.
- Output is validated before success. **Not met** (M1-T4).
- Core imports neither `eve` nor Supabase. **Met**, and enforced by the boundary test.
  `@internal/core` still declares no dependency at all.
- The example calls the harness API rather than the `eve` runtime directly. **Not met** (M1-T4).
- A fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test. **Met** by
  `createFakeAgentRuntime()` (M1-T5), pending the real adapter to be replaced.
- Cancellation/abort signal reaches the runtime. **Met for the contract and the fake** (M1-T5);
  that it reaches `eve` is M1-T6's to prove.
- One intentionally invalid output fails closed. **Met at the schema level**: an output inventing a
  decision the SOP does not allow is rejected with the issue pointing at
  `recommendation.decision` (`apps/example-agent/src/domain/domain.test.ts`). End to end through
  the harness is M1-T4.
- The example domain can serialize its capability manifest.
- Duplicate capability ID/version registration fails.
- The manifest contains module/export metadata but no executable source or secrets.
