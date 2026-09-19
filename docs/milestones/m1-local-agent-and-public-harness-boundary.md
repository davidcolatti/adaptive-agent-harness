# Milestone 1, Local Agent + Public Harness Boundary

**Status:** every task is `completed` (M1-T1 through M1-T9).

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

M1-T1 through M1-T9 are `completed`.

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

**Status:** completed (2026-09-19).

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

**Result.** `packages/core/src/harness.ts` is the single choke point Milestone 1 needs: it
validates an input against the domain's `inputSchema` before anything executes and re-validates
the runtime's claimed output against the domain's `outputSchema` before anything is called a
success. Those two sentences are what turn "input is validated before execution", "output is
validated before success" and "one intentionally invalid output fails closed" from promises about
a runtime's good behaviour into properties of this file.

`harness.run()` **throws** for exactly one thing, an input the domain's own schema rejects,
because that is a caller bug found before a run exists and nothing has been spent. Every other
outcome is a `HarnessRunResult`, a discriminated union on `status` over
`completed` / `failed` / `aborted`. All three variants carry `runId`, `jobId`, `domain`,
`attempt`, `usage` and `runtime`, because a failed or cancelled attempt still cost something and
what it cost has to be reportable next to why it stopped. The `failed` variant has **no `output`
field at all**: a value that failed validation is not a result, and making it unstatable is
stronger than documenting that it must not be read.

Four decisions the build plan left open, recorded here and in the WORKLOG rather than as separate
ADRs:

- **`storage` is omitted, not stubbed.** The plan's target API names it and M2 defines the
  `Storage` contract. A placeholder type would publish a guess as a contract and force M2 to break
  it; adding an optional option later is not a breaking change.
- **`runtime` became optional on `createExecutionContext`.** The harness builds the context
  *before* it calls an adapter, so it does not know which adapter will run the job. Rather than
  change the `AgentRuntime` contract or invent a version at runtime, `CreateExecutionContextInput.runtime`
  now defaults to the exported `HARNESS_RUNTIME_INFO` (`{ name: "harness", version: "0.0.0" }`).
  The adapter identifies itself where it actually can, in `AgentExecution.runtime`.
  `docs/contracts/execution-context.md` records it.
- **A `Clock` interface in core**, `{ now(): Date }`, so the package keeps zero dependencies and
  never imports the testing package while `createFakeClock()` still satisfies it structurally.
- **An already-aborted signal short-circuits.** The runtime is not called at all; a signal that
  fires *during* a run is the adapter's to honour and it reports `aborted` itself.

Two trace events per run, `run.started` then one terminal event, sequenced from 0 and flushed
once. **The four type strings are M1 placeholders**; M2-T3 owns the taxonomy.
`createRecordingTraceWriter()` was added to `@internal/testing` so a test can assert on them,
which the M1-T7 handoff had predicted would be the first thing to need it.

One thing was tried and deliberately reverted. The task first added `@internal/testing` to
`@internal/core`'s `devDependencies` so the harness's own tests could use the shared fakes. That
makes the workspace graph cyclic, because `@internal/testing` depends on `@internal/core` for its
types: pnpm warns on every install, and turbo refuses the resulting `build` task cycle unless the
package overrides the root task definition. A cyclic graph plus a per-package turbo override is a
new architectural pattern under AGENTS.md rule 11, adopted to save sixty lines of test code, so it
was removed. `packages/core/src/harness.test.ts` declares its own scripted runtime, recording
trace writer and fixed clock inline, excluded from the build by the `src/**/*.test.ts` rule that
already exists, and a comment there records why. `@internal/testing` remains the canonical home
for fakes that consuming packages and applications share, and
`apps/example-agent/src/domain/harness.test.ts` uses all three of them.

Contract: [`../contracts/harness.md`](../contracts/harness.md). `pnpm check` passes.

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

**Status:** completed (2026-09-19).

Implement `EveAgentRuntime`. Do not leak `eve` session details into the core contracts.

**Result.** `packages/runtime-eve` holds the harness's first real `AgentRuntime`, and
`pnpm example:run` / `pnpm example:run:mock` run the vendor-triage domain end to end through it.
How it works, what it enforces and what it cannot yet enforce is
[`../architecture/runtime.md`](../architecture/runtime.md); the decisions are
[ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md);
the evidence is [`../research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md).

The research note settled the shape before a line was written: **`eve` 0.63.0 has no in-process
run API.** Its documented programmatic surface is `eve/client` against a running server, its own
Next, Nuxt and SvelteKit adapters spawn `eve dev --no-ui --port 0` as a child, and `eve eval`
targets an HTTP URL. So the adapter takes a **URL and never spawns**, and a separate helper,
`startEveDevServer()` behind `@internal/runtime-eve/testing`, is what a test or a demonstration
uses to get a server. A runtime adapter that owned process lifecycle would be harder to reason
about inside `createHarness()` and useless against a deployment.

A run is one turn of one fresh session: `message` is `job.objective`, `clientContext` is
`{ jobId, domain, jobType, input }`, and the domain's `outputSchema` is requested per turn. The
turn's event stream is consumed **live** with `for await`, rather than through
`MessageResponse.result()`, because the adapter has to trace, police permissions and enforce the
budget as the run proceeds. That reading of ADR-0012 is recorded as an amendment rather than left
implicit: agent-runtime observation goes through the documented eve event stream, via `eve/hooks`
in-process **or** `eve/client` from a caller, which eve's own docs say carry the same envelope. A
hook could not do it anyway: it runs in the server process and holds no reference to the caller's
`TraceWriter`.

Four things `eve` does not provide are therefore harness-owned, and each is documented as such:
per-run tool permissions (`SendTurnOptions` has no tool field), `Job.budget` enforcement (eve's
own limits are authored, per session, token and cost only, and prompt a human on breach), the
`{ modelCalls, toolCalls, durationMs, costUsd? }` roll-up (eve reports usage per step and no
duration at all), and the mapping from eve failure codes to `AgentExecutionError` (eve publishes
no catalogue, so the adapter carries the code rather than switching on it).

**Permission enforcement is detection, not prevention**, and the milestone should record that
plainly. The adapter watches `actions.requested` and cancels on the first ungranted tool, by which
point the call was requested and may already have run. The documented composition that actually
prevents it, a channel `AuthFn` minting a short-lived per-run token whose claims carry the job's
grants plus a per-tool `approval` policy that denies, is the M2/M5 upgrade path.

Three findings the installed package settled that neither the docs nor the research note had:

- **`SendTurnOptions.outputSchema` is narrower than the prose.** The docs say the client "accepts
  Standard Schema implementations"; the type is `StandardJSONSchemaV1 | JsonObject`, which needs
  `~standard.jsonSchema`, while ADR-0027's `Schema<T>` declares only `~standard.validate`. eve's
  `serializeOutputSchema` confirms it at runtime. The adapter lowers the schema itself through the
  converter and sends plain JSON Schema; `zod@4.6.5` publishes the converter, so a domain written
  the ADR-0027 way is unaffected.
- **eve replaces every authored model with its own runtime mock when `NODE_ENV=test`** (or
  `EVE_MOCK_AUTHORED_MODELS=1`), answering a turn's schema from an internal sample generator and
  never calling the authored responder. Vitest sets `NODE_ENV=test`, so a `mockModel` fixture is
  silently ignored inside a test run and only inside one. `startEveDevServer()` strips both names,
  along with `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN`. This is in no eve document.
- **Node 24.21.0 does not rewrite a relative `./x.js` specifier to `./x.ts`.** Every module here
  uses the `.js` extension, as `module: nodenext` requires, so `node src/run.ts` cannot resolve
  its own imports. `apps/example-agent` therefore compiles `src/` with the already-pinned `tsc`
  before `eve build`, rather than the repository gaining a TypeScript runner nothing else needs.

The example agent was hardened in the same task: `defaultTools: false` plus a one-line re-export
restoring `load_skill`, taking `eve info` from nine tools to two. The `agent` default tool is the
one worth naming, because a model calling it spawns a second full copy of the agent in its own
durable session, whose usage and tool calls the harness's accounting would never see.

`apps/eve-fixture-agent` is a new workspace package: a credential-free eve project whose model is
eve's `mockModel` with a scripted responder. It exists because an eve app root is the nearest
enclosing `package.json` and eve recognizes a project only once `eve` is in its dependencies, so a
fixture cannot live inside `packages/runtime-eve`. It is what makes the contract suite
credential-free.

Verification: `pnpm check` passes (364 tests across 29 files, including 5 contract tests that
start a real eve server in about 4 seconds). `pnpm example:run:mock` exits 0 with a `completed`
result. **`pnpm example:run` against a live Gateway model is unverified**: no credential was
available.

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

**Status:** completed (2026-09-19).

Implement `CapabilityRegistry` and `CapabilityManifest`. The neutral domain must register its
input/output schemas, the full agent, the fixture read-only tool, one deterministic handler and
one policy. Registration validates duplicate IDs and incompatible version metadata, and the
serializable manifest must not contain function bodies or secrets.

**Result.** `packages/core/src/capabilities.ts` implements the split build plan section 5 states:
the runtime registry holds executable values, the serializable manifest holds only metadata.
`CapabilityManifestEntry` is the plan's shape character for character, and every one of its
fields is a string, a string array or an `{ id, version }` pair, so "no executable source or
secrets" is a property of the **type** rather than of care at each call site. A test proves it the
other way round too, by registering a function and an object carrying a fake credential and
asserting the serialized manifest contains neither.

It lives in `@internal/core`, not in `packages/registry`. `packages/registry` is the **workflow**
registry (M5); the capability registry is a core contract with no dependency of its own that
`defineDomain()`, the harness and the compiler all rest on. The system map's package table was
corrected to say so.

Registration rejects a malformed id or version, an empty module or export name, a duplicate
`(kind, id, version)`, a missing value, a `schema` whose value is not a Standard Schema, and a
non-string permission declaration. Two rules are worth naming:

- **An id's kind is fixed across its versions.** Registering `vendor-triage.input@2.0.0` as a
  `tool` when `1.0.0` is a `schema` is the "incompatible version metadata" the task requires
  registration to catch: every existing reference to that id would silently come to mean something
  else.
- **A referenced schema must already be registered**, which is what makes a manifest closed:
  every reference inside it resolves within it, so codegen and validation need no second lookup
  table.

Five kinds, not AD-015's seven. `evaluator` and `artifact` are left out rather than declared
empty, because M6 owns evaluators and M4 owns artifact nodes and a kind nothing can register yet
would be a promise rather than a contract. `CapabilityRef` is a deliberate **alias** of
`DomainRef` rather than a structural twin, since the plan writes the identical shape for both and
one type cannot drift. `parseCapabilityRefString("id@version")` was added so the string contract
references a `Job` already carries resolve directly; a test runs
`vendorTriage.createJob(...).contracts.inputSchema` through the populated registry.

The fingerprint is the part that needed an ADR.
[ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md) records
RFC 8785-style canonical JSON plus SHA-256, emitted as `sha256:<hex>` so the algorithm can change
later, and records that the Node built-in `node:crypto` is permitted in `@internal/core` because
a built-in adds nothing to `package.json`, the lockfile or the boundary test. AD-016 names
"canonical JSON encoding used for fingerprints" as its first example of a choice that must be
recorded rather than implied. `capabilityFingerprint()` hashes an entry's behavior-affecting
metadata and never the registered value, because a function's source is not stable across a
formatter or a compiler version. **M2-T8 extends what is fingerprinted, not how.**

`apps/example-agent/src/capabilities.ts` registers all five kinds, including two new pure modules
written for the purpose: `src/handlers/detect-payment-detail-change.ts`, which flags Cobalt
Harbor Logistics' unverified banking-detail change and deliberately does not flag the other two
fixture vendors, and `src/policies/no-proceed-with-open-risk-flags.ts`, which refuses only an
unconditional `proceed`. The agent is registered as a plain descriptor rather than the `eve`
definition, so nothing under `src/` imports `eve`. `procurement-sop` is deliberately not
registered: a SOP is content, not an executable capability, and fingerprinting its content is
M2-T8 and M5 territory.

Contract: [`../contracts/capability-registry.md`](../contracts/capability-registry.md).
`pnpm check` passes.

## Acceptance criteria

From the build plan. **Every criterion is met**, with one qualification stated in full below:
one of them is met by observed runs against a scripted model rather than a live one.

How each was checked matters, so the wording distinguishes three kinds of evidence:

- **observed against a real eve server** (`pnpm example:run:mock`, and
  `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts`, which start `eve dev` and drive
  a real durable session);
- **observed with the fake runtime** (`createFakeAgentRuntime()`, no server at all);
- **unverified**: `pnpm example:run` against a live AI Gateway model, because no credential was
  available. Everything below the model is covered by the first kind.

- `pnpm example:run` executes the neutral agent locally. **Met, observed against a real eve
  server** for `pnpm example:run:mock`, which runs the real domain, the real `EveAgentRuntime`,
  `createHarness()` and a real `eve dev` server, and exits 0 with a `completed` result and a
  schema-valid output. `pnpm example:run` is the same script against `apps/example-agent`, and is
  **unverified against a live Gateway model**: without a credential it exits 1 by design, naming
  `.env.example`.
- Input is validated before execution. **Met** (M1-T4). `harness.run()` validates against the
  domain's `inputSchema` before a job, a run ID or a trace event exists, and **throws** rather
  than reporting a failed run, because nothing has been spent yet. A unit test asserts the runtime
  is never reached.
- Output is validated before success. **Met** (M1-T4). A completed execution's claimed output is
  re-validated against the domain's `outputSchema` before the result says `completed`.
- Core imports neither `eve` nor Supabase. **Met**, and enforced by the boundary test.
  `@internal/core` still declares no third-party dependency at all. M1-T9 added one Node built-in,
  `node:crypto`, which is not a dependency; [ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md)
  records that explicitly.
- The example calls the harness API rather than the `eve` runtime directly. **Met, observed
  against a real eve server** (M1-T6). `apps/example-agent/src/run.ts` goes through
  `createHarness()`; nothing under `src/` imports `eve`, and nothing under `agent/` imports the
  harness. The one `eve` import in the run path is `EveAgentRuntime`, which is the adapter, not
  the runtime.
- A fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test. **Met**, and no longer
  conditional: `createFakeAgentRuntime()` (M1-T5) and `EveAgentRuntime` (M1-T6) both implement
  `AgentRuntime` and nothing else, and `apps/example-agent/src/domain/harness.test.ts` swaps in
  the fake against the real domain while `src/run.ts` uses the real adapter on the same call.
- Cancellation/abort signal reaches the runtime. **Met, observed against a real eve server**
  (M1-T6), which is what M1-T5 left open. A contract test starts a turn whose tool sleeps for 30
  seconds, waits for the tool call to appear on the stream, aborts, and asserts the run resolves
  `aborted` within seconds rather than waiting the tool out. The adapter propagates the signal
  twice on purpose: to the client calls, so a hung transport cannot outlive the job, and to
  `response.cancel()`, so the durable run stops server-side rather than only the HTTP request.
  The contract-level assertions from M1-T5 and M1-T4 still hold for the fake and the harness.
- One intentionally invalid output fails closed. **Met end to end, observed with the fake
  runtime** (M1-T4); the adapter's own half is observed against a real eve server, where a turn
  that settles without producing the requested structured output fails with `code: "VALIDATION"`. A fake runtime that
  returns `{ category: 1 }`, and one that invents a decision the SOP does not allow, both produce
  `status: "failed"` with `code: "VALIDATION"` and **no `output` field on the result**
  (`apps/example-agent/src/domain/harness.test.ts`). The schema-level form remains in
  `src/domain/domain.test.ts`.
- The example domain can serialize its capability manifest. **Met**, unit-level (M1-T9).
  `vendorTriageManifest` in `apps/example-agent/src/capabilities.ts` holds six entries across the
  five kinds and round-trips through `JSON.parse(JSON.stringify(...))` unchanged.
- Duplicate capability ID/version registration fails. **Met**, unit-level (M1-T9), with `ValidationError`, and
  so does registering the same id under a second kind, which is the "incompatible version
  metadata" half of the same requirement.
- The manifest contains module/export metadata but no executable source or secrets. **Met**,
  unit-level (M1-T9), by the type as well as by test: every `CapabilityManifestEntry` field is a string, a
  string array or an `{ id, version }` pair. A test registers a function and an object carrying a
  fake credential and asserts the serialized manifest contains neither.
